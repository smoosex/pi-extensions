// ============================================================
// pi-persona — 扩展入口
// ============================================================
import type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { MoodEngine } from "../src/mood-engine.js";
import { soulPreamble } from "../src/preamble.js";
import {
  restorePersistentState,
} from "../src/persistence.js";
import { applyGlobalMoodEvent, refreshGlobalMood } from "../src/global-mood.js";
import { loadSoul } from "../src/soul-loader.js";
import { getFooterStatusText } from "../src/footer.js";
import { registerPersonaCommands } from "../src/commands.js";
import {
  createRepeatedErrorState,
  detectExplicitUserFeedback,
  detectFromBashResult,
  detectFromUserMessage,
  detectImplicitAcceptance,
  detectRepeatedErrors,
  resetErrorStreak,
  detectLateNight,
} from "../src/triggers.js";
import {
  DEFAULT_EMOTION_CONFIG,
  nearestEmotion,
} from "../src/types.js";
import type { EmotionChange, EmotionalEvent } from "../src/types.js";
import type { RepeatedErrorState } from "../src/triggers.js";

interface PersonaRuntimeState {
  engine: MoodEngine | null;
  repeatedErrors: RepeatedErrorState;
  pendingImplicitAcceptance: boolean;
  currentAgentHadNegativeEvent: boolean;
}

const MOOD_MESSAGE_TYPE = "persona-mood";

export default function personaExtension(pi: ExtensionAPI) {
  const state: PersonaRuntimeState = {
    engine: null,
    repeatedErrors: createRepeatedErrorState(),
    pendingImplicitAcceptance: false,
    currentAgentHadNegativeEvent: false,
  };

  registerAllHooks(pi, state);
  registerPersonaCommands(pi, () => state.engine, (engine) => {
    state.engine = engine;
  });

  pi.on("session_start", async (_event, ctx) => {
    const persistent = restorePersistentState();

    const soulDef = loadSoul({
      onWarning: (message) => {
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
      },
    });
    if (!soulDef) {
      if (ctx.hasUI) ctx.ui.setStatus("soul-mood", "");
      state.engine = null;
      resetRuntimeState(state);
      return;
    }

    state.engine = new MoodEngine(soulDef, persistent, DEFAULT_EMOTION_CONFIG);
    resetRuntimeState(state);

    // 从持久化恢复情绪坐标（含时间衰减）
    state.engine.restoreState(
      persistent.lastAngle,
      persistent.lastIntensity,
      persistent.lastInteraction,
    );

    // 只读磁盘最新状态；自然衰减不写回，也不改变衰减锚点。
    await refreshGlobalMood(state.engine, false);

    if (ctx.hasUI) {
      ctx.ui.setStatus("soul-mood", getFooterStatusText(state.engine));
    }

  });

  pi.on("session_shutdown", async () => {
    if (state.engine) {
      await refreshGlobalMood(state.engine, false);
    }
    state.engine = null;
    resetRuntimeState(state);
  });
}

// ==============================================================
// Hooks
// ==============================================================

function registerAllHooks(pi: ExtensionAPI, state: PersonaRuntimeState): void {
  pi.on("agent_start", async () => {
    state.currentAgentHadNegativeEvent = false;
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const engine = await refreshRuntimeEngine(state);
    if (!engine) return;

    const input = event.input as { command?: string } | undefined;
    const command = input?.command ?? "";
    // Pi 1.x 只在 structuredContent 里报告退出码；details 不含 exitCode。
    const result = event.structuredContent as { exit_code?: number } | undefined;
    const exitCode = result?.exit_code;
    const isError = event.isError || false;
    const hasFailed = isError || (exitCode !== undefined && exitCode !== 0);

    const repeatEvent = detectRepeatedErrors(command, hasFailed, DEFAULT_EMOTION_CONFIG, state.repeatedErrors);
    if (repeatEvent) {
      if (repeatEvent.valence === "negative") state.currentAgentHadNegativeEvent = true;
      await applyAndNotify(engine, repeatEvent, ctx);
      return;
    }

    const bashEvent = detectFromBashResult(
      exitCode,
      isError,
      command,
      DEFAULT_EMOTION_CONFIG,
    );
    if (bashEvent) {
      if (bashEvent.valence === "negative") state.currentAgentHadNegativeEvent = true;
      await applyAndNotify(engine, bashEvent, ctx);
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    const engine = await refreshRuntimeEngine(state);
    if (!engine) return;

    let sawUserMessage = false;
    let lastUserEvent: EmotionalEvent | null = null;

    for (const msg of event.messages) {
      if (msg.role === "user") {
        sawUserMessage = true;
        const content = extractUserText(msg.content);
        if (content) {
          const userEvent = detectFromUserMessage(
            content,
            DEFAULT_EMOTION_CONFIG,
            engine.soul.traits.agreeableness,
          );
          if (userEvent) lastUserEvent = userEvent;
        }
      }
    }

    // 同一轮可能包含 steering / follow-up 等多条 user message。
    // 用户反馈情绪只应用最后一个有效事件，避免多句表扬或纠正连续叠加强度。
    if (lastUserEvent) {
      state.pendingImplicitAcceptance = false;
      await applyAndNotify(engine, lastUserEvent, ctx);
    } else if (sawUserMessage && !state.currentAgentHadNegativeEvent) {
      // 用户通常不会额外发一句 “good job” 来省 token。
      // 若上一轮没有明显失败，且下一轮不是纠错而是继续提新需求，再视为被隐式接受。
      state.pendingImplicitAcceptance = true;
    }

    // late_night 表示“用户深夜还在互动”，不是“agent 深夜结束了一轮”。
    // 只在本轮真的包含用户消息时触发，避免 retry / follow-up / 工具续跑空转时污染情绪。
    if (sawUserMessage) {
      const lateEvent = detectLateNight(
        DEFAULT_EMOTION_CONFIG,
        engine.soul.traits.extraversion,
      );
      if (lateEvent) await applyAndNotify(engine, lateEvent, ctx);
    }

    await refreshGlobalMood(engine, false);
    if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(engine));
    resetErrorStreak(state.repeatedErrors);
  });

  pi.on("turn_end", async (_event, ctx) => {
    const engine = await refreshRuntimeEngine(state);
    if (!engine) return;
    if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(engine));
  });

  pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
    const engine = await refreshRuntimeEngine(state);
    if (!engine) {
      state.engine = null;
      resetRuntimeState(state);
      if (ctx.hasUI) ctx.ui.setStatus("soul-mood", "");
      return;
    }

    // 只有用户真正发出的新提示才代表接受上一轮；后台 custom 消息触发的轮次不算。
    if (event.messageType === "user" && state.pendingImplicitAcceptance) {
      const explicitUserEvent = detectExplicitUserFeedback(
        event.prompt,
        DEFAULT_EMOTION_CONFIG,
        engine.soul.traits.agreeableness,
      );
      if (explicitUserEvent) {
        state.pendingImplicitAcceptance = false;
      } else {
        state.pendingImplicitAcceptance = false;
        await applyAndNotify(
          engine,
          detectImplicitAcceptance(DEFAULT_EMOTION_CONFIG, engine.soul.traits.agreeableness),
          ctx,
        );
      }
    }

    if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(engine));

    // 避免强制替换整段提示词，以保留结构化章节及其会话记录；心情仍作为隐藏消息追加。
    if (!event.systemPromptOptions.customPrompt) {
      event.systemPromptOptions.sections.persona = soulPreamble(engine.soul, join(getAgentDir(), "SOUL.md"), new Date());
    }
    return { message: moodMessage(engine, ctx) };
  });

  pi.on("session_compact", async (event, ctx) => {
    // 溢出重试与已排队的续跑不会再触发 before_agent_start，压缩又可能移除了最新心情快照。
    // 只搭上已经要发生的续跑；普通压缩不能额外启动一轮模型调用，等下次提示时自然补齐。
    if (!event.willRetry && !ctx.hasPendingMessages()) return;
    const engine = await refreshRuntimeEngine(state);
    if (!engine) return;
    const message = moodMessage(engine, ctx);
    if (message) pi.sendMessage(message, { deliverAs: "steer" });
  });
}

// ==============================================================
// Helpers
// ==============================================================

async function refreshRuntimeEngine(state: PersonaRuntimeState): Promise<MoodEngine | null> {
  const soul = loadSoul();
  if (!soul) {
    state.engine = null;
    resetRuntimeState(state);
    return null;
  }
  const engine = new MoodEngine(soul, restorePersistentState(), DEFAULT_EMOTION_CONFIG);
  await refreshGlobalMood(engine, false);
  state.engine = engine;
  return engine;
}

function resetRuntimeState(state: PersonaRuntimeState): void {
  resetErrorStreak(state.repeatedErrors);
  state.pendingImplicitAcceptance = false;
  state.currentAgentHadNegativeEvent = false;
}

/**
 * 只在当前分支的有效上下文里没有相同快照时才追加。按会话投影判断，而不是内存标记，
 * 这样分支切换、压缩和上下文编辑移除旧快照后都会正确补发；旧快照保留在历史里，不改写缓存前缀。
 */
function moodMessage(engine: MoodEngine, ctx: ExtensionContext) {
  const content = engine.getEmotionPrompt();
  const messages = ctx.sessionManager.buildSessionProjection().messages;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "custom" || message.customType !== MOOD_MESSAGE_TYPE) continue;
    if (message.content === content) return undefined;
    break;
  }
  return { customType: MOOD_MESSAGE_TYPE, content, display: false };
}

function extractUserText(content: Extract<AgentEndEvent["messages"][number], { role: "user" }>["content"]): string {
  if (typeof content === "string") return content;

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function applyAndNotify(
  engine: MoodEngine,
  event: EmotionalEvent,
  ctx: ExtensionContext,
): Promise<void> {
  const change: EmotionChange = await applyGlobalMoodEvent(engine, event);
  if (change.notify && ctx.hasUI && change.catchphrase) {
    const emo = nearestEmotion(change.newAngle);
    ctx.ui.notify(
      `${engine.soul.emoji} ${change.catchphrase}`,
      emo === "anger" || emo === "sadness" || emo === "fear" || emo === "disgust"
        ? "warning"
        : "info",
    );
  }
  if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(engine));
}
