import { type AgentToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getVisionMaxConcurrency, getVisionProviderSelection } from "./config.ts";
import { resolveInputImagePath } from "./images.ts";
import { errorMessageFor, getProviderExecutionOutput, tailText } from "./process.ts";
import { resolveVisionProvider } from "./providers/index.ts";
import { loadVisionState, saveVisionState } from "./state.ts";
import { renderVisionCall, renderVisionResult } from "./render.ts";
import type { VisionOverrideState, VisionParams, VisionProviderId, VisionProviderSelection, VisionToolDetails } from "./types.ts";

const PROVIDER_OPTIONS: VisionProviderSelection[] = ["auto", "codex", "agy"];

interface ModelLike {
  input?: readonly ("text" | "image")[];
}

let activeVisionRuns = 0;
const pendingVisionGrants: Array<() => void> = [];

let runtimeProviderSelection: VisionProviderSelection | undefined;
let runtimeOverride: VisionOverrideState | undefined;

function pumpVisionQueue() {
  const maxConcurrency = getVisionMaxConcurrency();
  while (activeVisionRuns < maxConcurrency && pendingVisionGrants.length > 0) {
    pendingVisionGrants.shift()?.();
  }
}

async function acquireVisionSlot(signal: AbortSignal | undefined, onUpdate?: (update: AgentToolResult<unknown>) => void): Promise<() => void> {
  const maxConcurrency = getVisionMaxConcurrency();
  if (signal?.aborted) throw new Error("Image recognition was aborted.");
  if (activeVisionRuns >= maxConcurrency) {
    onUpdate?.({
      content: [{ type: "text", text: `Queued image recognition (${activeVisionRuns}/${maxConcurrency} running)...` }],
      details: { queued: true, activeVisionRuns, maxConcurrency },
    });
  }

  return new Promise((resolve, reject) => {
    let queued = true;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const grant = () => {
      if (!queued) return;
      queued = false;
      cleanup();
      activeVisionRuns += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        activeVisionRuns = Math.max(0, activeVisionRuns - 1);
        pumpVisionQueue();
      });
    };
    const onAbort = () => {
      if (!queued) return;
      queued = false;
      const index = pendingVisionGrants.indexOf(grant);
      if (index >= 0) pendingVisionGrants.splice(index, 1);
      cleanup();
      reject(new Error("Image recognition was aborted while queued."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    pendingVisionGrants.push(grant);
    pumpVisionQueue();
  });
}

function parseProviderSelection(value: string): VisionProviderSelection | undefined {
  const normalized = value.trim().toLowerCase();
  return PROVIDER_OPTIONS.find((provider) => provider === normalized);
}

function getDefaultProviderSelection(): VisionProviderSelection {
  return runtimeProviderSelection ?? getVisionProviderSelection();
}

function getConfiguredProviderSelection(): VisionProviderSelection | undefined {
  return runtimeProviderSelection ?? (process.env.PI_VISION_PROVIDER?.trim() ? getVisionProviderSelection() : undefined);
}

function getEffectiveProviderSelection(value?: unknown): VisionProviderSelection {
  const requested = typeof value === "string" && value.trim() ? parseProviderSelection(value) : undefined;
  if (requested === "codex" || requested === "agy") return requested;
  if (requested === "auto") return getConfiguredProviderSelection() ?? "auto";
  return getDefaultProviderSelection();
}

function getEffectiveOverride(): VisionOverrideState {
  if (runtimeOverride) return runtimeOverride;
  const env = process.env.PI_VISION_FORCE?.trim().toLowerCase();
  if (env === "on" || env === "off" || env === "auto") return env;
  return "auto";
}

function modelSupportsImage(model: unknown): boolean {
  const input = (model as ModelLike | null | undefined)?.input;
  return Array.isArray(input) && (input as readonly string[]).includes("image");
}

function computeVisionEnabled(model: unknown): boolean {
  const override = getEffectiveOverride();
  if (override === "on") return true;
  if (override === "off") return false;
  return !modelSupportsImage(model);
}

async function getProviderStatusText(): Promise<string> {
  const selection = getDefaultProviderSelection();
  if (selection !== "auto") return `👁 ${selection}`;
  const provider = await resolveVisionProvider("auto").catch(() => undefined);
  return provider ? `👁 auto→${provider.id}` : `👁 auto`;
}

interface StatusContext {
  hasUI?: boolean;
  ui?: { setStatus?: (key: string, value: string | undefined) => void };
}

async function setVisionFooter(ctx: StatusContext | undefined, enabled: boolean): Promise<void> {
  if (!ctx?.hasUI || !ctx.ui?.setStatus) return;
  ctx.ui.setStatus("vision-provider", enabled ? await getProviderStatusText() : undefined);
}

async function syncVisionTool(pi: ExtensionAPI, model: unknown, ctx?: StatusContext): Promise<void> {
  const enable = computeVisionEnabled(model);
  const active = pi.getActiveTools();
  const has = active.includes("image_vision");
  if (enable && !has) {
    pi.setActiveTools([...active, "image_vision"]);
  } else if (!enable && has) {
    pi.setActiveTools(active.filter((name) => name !== "image_vision"));
  }
  await setVisionFooter(ctx, enable);
}

function createFailureResult(
  message: string,
  provider: VisionProviderId | VisionProviderSelection,
  imagePaths: string[],
  output?: { stdout?: string; stderr?: string },
  metadata?: Record<string, unknown>,
): AgentToolResult<VisionToolDetails> {
  return {
    content: [
      {
        type: "text",
        text: `Image recognition failed via ${provider}: ${message}\nNo fallback was attempted.`,
      },
    ],
    details: {
      ...(metadata ?? {}),
      provider,
      ok: false,
      inputImages: imagePaths,
      errorMessage: message,
      stdout: output?.stdout ? tailText(output.stdout) : undefined,
      stderr: output?.stderr ? tailText(output.stderr) : undefined,
    } as VisionToolDetails,
    terminate: true,
  };
}

export default async function visionExtension(pi: ExtensionAPI) {
  const loaded = await loadVisionState();
  runtimeOverride = loaded.override;
  runtimeProviderSelection = loaded.provider;

  pi.on("session_start", async (_event, ctx) => {
    await syncVisionTool(pi, ctx.model, ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    await syncVisionTool(pi, event.model, ctx);
  });

  pi.registerCommand("vision", {
    description: "image_vision: show status or force on/off/auto (auto = enabled only for text-only models)",
    getArgumentCompletions(prefix: string) {
      const normalized = prefix.trim().toLowerCase();
      return ["on", "off", "auto"]
        .filter((option) => option.startsWith(normalized))
        .map((option) => ({ value: option, label: option }));
    },
    handler: async (args, ctx) => {
      const raw = args.trim().toLowerCase();
      if (!raw) {
        const active = pi.getActiveTools().includes("image_vision");
        const override = getEffectiveOverride();
        const supports = modelSupportsImage(ctx.model);
        const provider = getDefaultProviderSelection();
        ctx.ui.notify(`vision ${active ? "ON" : "off"} · model sees images: ${supports ? "yes" : "no"} · override: ${override} · provider: ${provider}`, "info");
        return;
      }
      if (raw !== "on" && raw !== "off" && raw !== "auto") {
        ctx.ui.notify("Usage: /vision [on|off|auto]", "warning");
        return;
      }
      runtimeOverride = raw;
      await saveVisionState({ override: raw });
      await syncVisionTool(pi, ctx.model, ctx);
      ctx.ui.notify(`image_vision override: ${raw}`, "info");
    },
  });

  pi.registerCommand("vision-provider", {
    description: "Switch image_vision provider: auto, codex, or agy",
    getArgumentCompletions(prefix: string) {
      const normalized = prefix.trim().toLowerCase();
      return PROVIDER_OPTIONS.filter((provider) => provider.startsWith(normalized)).map((provider) => ({ value: provider, label: provider }));
    },
    handler: async (args, ctx) => {
      const rawValue = args.trim();
      let nextProvider = parseProviderSelection(rawValue);
      if (!nextProvider && rawValue) {
        ctx.ui.notify(`Unknown image provider: ${rawValue}`, "error");
        return;
      }
      if (!nextProvider) {
        const choice = await ctx.ui.select("Select image_vision provider", PROVIDER_OPTIONS);
        nextProvider = choice ? parseProviderSelection(choice) : undefined;
      }
      if (!nextProvider) return;
      runtimeProviderSelection = nextProvider;
      await saveVisionState({ provider: nextProvider });
      await syncVisionTool(pi, ctx.model, ctx);
      ctx.ui.notify(`image_vision provider set to ${nextProvider}`, "info");
    },
  });

  pi.registerTool({
    name: "image_vision",
    label: "Image Vision",
    description:
      "Recognize and describe images through a local CLI provider (codex or agy) whose models can see images. Returns a text description of the image content (scene, OCR text, objects, layout). Use when you need to understand image content but the active model cannot view images directly.",
    promptSnippet: "Recognize/describe/OCR images via local vision-capable CLIs (codex/agy); use when you must understand image content.",
    promptGuidelines: [
      "Use image_vision when the user asks to describe, recognize, read text from (OCR), or otherwise understand an image, and image content is needed to answer.",
      "Pass one or more local image paths via image_vision.images; multiple images are recognized together in a single combined description per call.",
      "Use the optional prompt parameter to focus the description, e.g. 'OCR all text', 'extract chart data', 'describe the UI layout'.",
      "Do not call bash, python, or write to inspect images; image_vision is the dedicated path to understand image content.",
    ],
    parameters: Type.Object({
      images: Type.Array(Type.String(), {
        description: "Local image paths to recognize (including Pi temporary attachment paths). At least one is required. Supported formats: png, jpg, jpeg, webp.",
      }),
      prompt: Type.Optional(
        Type.String({
          description: "What to focus on when recognizing the image(s), e.g. 'describe the scene', 'OCR all text', 'extract chart data', 'describe the UI layout'. Omit for a full default description.",
        }),
      ),
      provider: Type.Optional(
        Type.String({
          enum: PROVIDER_OPTIONS,
          description: "Vision provider. Defaults to PI_VISION_PROVIDER or codex.",
        }),
      ),
      model: Type.Optional(Type.String({ description: "Optional provider-specific model. For agy, overrides PI_VISION_AGY_MODEL." })),
    }),
    executionMode: "parallel",
    renderCall(args, theme, context) {
      const displayArgs = typeof args === "object" && args !== null ? { ...args, provider: getEffectiveProviderSelection((args as VisionParams).provider) } : args;
      return renderVisionCall(displayArgs, theme, context);
    },
    renderResult: renderVisionResult,
    async execute(_toolCallId, params: VisionParams, signal, onUpdate, ctx) {
      const startedAt = Date.now();
      const providerSelection = getEffectiveProviderSelection(params.provider);
      let providerId: VisionProviderId | VisionProviderSelection = providerSelection;
      let imagePaths: string[] = [];

      try {
        if (!Array.isArray(params.images) || params.images.length === 0) {
          throw new Error("At least one image path is required.");
        }
        imagePaths = await Promise.all(params.images.map((imagePath) => resolveInputImagePath(imagePath, ctx.cwd)));
        const provider = await resolveVisionProvider(providerSelection);
        providerId = provider.id;
        await setVisionFooter(ctx, true);
        const releaseSlot = await acquireVisionSlot(signal, onUpdate);
        const providerResult = await (async () => {
          try {
            return await provider.run({
              prompt: params.prompt,
              imagePaths,
              cwd: ctx.cwd,
              model: params.model,
              signal,
              startedAt,
              onUpdate,
            });
          } finally {
            releaseSlot();
          }
        })();

        const description = providerResult.description;

        onUpdate?.({
          content: [{ type: "text", text: `${provider.label} recognized ${imagePaths.length} image(s).` }],
          details: { provider: providerResult.provider, descriptionLength: description.length },
        });

        return {
          content: [{ type: "text", text: description }],
          details: {
            ...(providerResult.metadata ?? {}),
            provider: providerResult.provider,
            ok: true,
            descriptionLength: description.length,
            inputImages: imagePaths,
            stdout: providerResult.stdout,
            stderr: providerResult.stderr,
          } as VisionToolDetails,
        };
      } catch (error) {
        const message = errorMessageFor(error);
        const output = getProviderExecutionOutput(error);
        const failure = createFailureResult(message, providerId, imagePaths, output, output.details);
        onUpdate?.(failure);
        return failure;
      }
    },
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "image_vision") return;
    const details = event.details as VisionToolDetails | undefined;
    if (details?.ok === false) return { isError: true };
  });
}
