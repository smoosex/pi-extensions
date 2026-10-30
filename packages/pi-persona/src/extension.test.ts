// ============================================================
// pi-persona — extension hooks against a real in-memory session
//
// Covers prompt-cache safety (the system prompt never carries mood; mood is a
// hidden message appended only when it changes), compaction recovery, the Pi
// 1.x bash exit code location and unsafe frontmatter rejection.
// ============================================================
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import personaExtension from "../extensions/index.js";
import { restorePersistentState, updatePersistentState } from "./persistence.js";
import { invalidateSoulCache, loadSoul } from "./soul-loader.js";

type Hook = (event: unknown, ctx: unknown) => Promise<unknown>;
interface MoodMessage { customType: string; content: string; display: boolean }

async function withAgentDir(fn: (agentDir: string) => Promise<void>): Promise<void> {
  const original = process.env.PI_CODING_AGENT_DIR;
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-persona-extension-"));
  try {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    invalidateSoulCache();
    await fn(agentDir);
  } finally {
    invalidateSoulCache();
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
    rmSync(agentDir, { recursive: true, force: true });
  }
}

function runtime() {
  const session = SessionManager.inMemory();
  const hooks = new Map<string, Hook>();
  const sent: { message: MoodMessage; options: unknown }[] = [];
  const queued = { pending: false };
  personaExtension({
    on: (name: string, handler: Hook) => { hooks.set(name, handler); },
    sendMessage: (message: MoodMessage, options: unknown) => { sent.push({ message, options }); },
    registerCommand: () => {},
  } as unknown as ExtensionAPI);
  const ctx = { hasUI: false, sessionManager: session, hasPendingMessages: () => queued.pending };
  const run = async (name: string, event: unknown = {}) => {
    const sections: Record<string, string> = {};
    const prepared = name === "before_agent_start" ? { ...(event as object), systemPromptOptions: { sections, customPrompt: (event as { customPrompt?: string }).customPrompt } } : event;
    const result = await hooks.get(name)!(prepared, ctx) as { systemPrompt?: string; message?: MoodMessage } | undefined;
    const message = result?.message;
    if (name === "before_agent_start" && message) {
      session.appendCustomMessageEntry(message.customType, message.content, message.display);
    }
    return { ...result, persona: sections.persona, sections };
  };
  return Object.assign(run, { session, sent, queued });
}

const start = (messageType: "user" | "custom" = "user", prompt = "next task") =>
  messageType === "user"
    ? { messageType, prompt }
    : { messageType, message: {} };

test("mood is a hidden appended snapshot, never part of the system prompt", async () => {
  await withAgentDir(async (agentDir) => {
    writeFileSync(path.join(agentDir, "SOUL.md"), "A helpful familiar.");
    const run = runtime();
    await run("session_start");

    const first = await run("before_agent_start", start());
    assert.equal(first!.systemPrompt, undefined, "a forced prompt would be unrecorded and collapse section patches");
    assert.match(first!.persona!, /A helpful familiar\./);
    assert.match(first!.persona!, /LANGUAGE RULE/);
    assert.match(first!.persona!, /DATE AWARENESS/);
    assert.match(first!.persona!, /PERSONALITY EVOLUTION/);
    assert.ok(first!.persona!.includes(path.join(agentDir, "SOUL.md")));
    assert.equal(first!.sections.preamble, undefined);
    assert.doesNotMatch(first!.persona!, /## Your Current Emotion|%/);
    assert.equal(first!.message?.display, false);
    assert.match(first!.message!.content, /## Your Current Emotion/);

    const second = await run("before_agent_start", start());
    assert.equal(second!.persona, first!.persona, "the cached prefix stays identical");
    assert.equal(second!.message, undefined, "an unchanged mood is not appended again");

    await updatePersistentState((state) => ({ ...state, lastAngle: 270, lastIntensity: 0.9, lastInteraction: Date.now() }));
    const third = await run("before_agent_start", start());
    assert.equal(third!.persona, first!.persona);
    assert.ok(third!.message, "a changed mood appends a new snapshot");
    assert.notEqual(third!.message.content, first!.message!.content);
  });
});

test("persona section is accepted and rendered by the installed Pi prompt builder", async () => {
  await withAgentDir(async (agentDir) => {
    writeFileSync(path.join(agentDir, "SOUL.md"), "A helpful familiar.");
    const run = runtime();
    await run("session_start");
    const result = await run("before_agent_start", start());
    const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const builderPath = path.join(path.dirname(piEntry), "core/system-prompt.js");
    const { buildSystemPromptSections } = await import(pathToFileURL(builderPath).href);
    const sections = buildSystemPromptSections({ cwd: agentDir, sections: result.sections });
    assert.match(sections.preamble, /expert coding assistant/);
    assert.match(sections.persona, /^<persona>\n[\s\S]*A helpful familiar\.[\s\S]*\n<\/persona>$/);
    assert.doesNotMatch(sections.persona, /## Your Current Emotion/);
  });
});

test("custom SYSTEM.md retains its preamble while mood still reaches the model", async () => {
  await withAgentDir(async (agentDir) => {
    writeFileSync(path.join(agentDir, "SOUL.md"), "A helpful familiar.");
    const run = runtime();
    await run("session_start");
    const result = await run("before_agent_start", { ...start(), customPrompt: "My custom identity" });
    assert.equal(result.persona, undefined);
    assert.equal(result.sections.persona, undefined);
    assert.equal(result.message?.customType, "persona-mood");
  });
});

test("removed or empty soul disables both identity and mood on subsequent hooks", async () => {
  await withAgentDir(async (agentDir) => {
    writeFileSync(path.join(agentDir, "SOUL.md"), "A helpful familiar.");
    const run = runtime();
    await run("session_start");
    await run("before_agent_start", start());
    writeFileSync(path.join(agentDir, "SOUL.md"), "");
    const result = await run("before_agent_start", start());
    assert.equal(result.persona, undefined);
    assert.equal(result.message, undefined);
    await run("tool_result", { toolName: "bash", input: { command: "bun test" }, structuredContent: { exit_code: 0 } });
    assert.equal(restorePersistentState().history.length, 0);
  });
});

test("compaction recovery resends a dropped snapshot only for an existing continuation", async () => {
  await withAgentDir(async (agentDir) => {
    writeFileSync(path.join(agentDir, "SOUL.md"), "A helpful familiar.");
    const run = runtime();
    await run("session_start");

    await run("session_compact", { reason: "threshold", willRetry: false });
    assert.equal(run.sent.length, 0, "an ordinary compaction starts no extra turn");

    await run("session_compact", { reason: "overflow", willRetry: true });
    assert.equal(run.sent.length, 1);
    assert.deepEqual(run.sent[0].options, { deliverAs: "steer" });
    const message = run.sent[0].message;
    run.session.appendCustomMessageEntry(message.customType, message.content, message.display);

    await run("session_compact", { reason: "overflow", willRetry: true });
    assert.equal(run.sent.length, 1, "a snapshot still in context is not resent");
  });
});

test("bash exit codes come from structuredContent, and custom runs never count as acceptance", async () => {
  await withAgentDir(async (agentDir) => {
    writeFileSync(path.join(agentDir, "SOUL.md"), "A helpful familiar.");
    const run = runtime();
    await run("session_start");
    const triggers = () => restorePersistentState().history.map((entry) => entry.trigger);

    await run("tool_result", { toolName: "bash", input: { command: "npm test" }, details: {}, structuredContent: { exit_code: 0 }, isError: false });
    assert.deepEqual(triggers(), ["test_pass"]);

    await run("agent_start");
    await run("agent_end", { messages: [{ role: "user", content: "add a button", timestamp: 1 }] });
    await run("before_agent_start", start("custom"));
    assert.ok(!triggers().includes("implicit_acceptance"), "a background custom message is not user acceptance");
    await run("before_agent_start", start("user", "now add another one"));
    assert.equal(triggers().filter((trigger) => trigger === "implicit_acceptance").length, 1);
  });
});

test("executable or malformed frontmatter is rejected and never evaluated", async () => {
  await withAgentDir(async (agentDir) => {
    const probe = globalThis as typeof globalThis & { __personaUnsafe?: boolean };
    for (const fence of ["---js", "---javascript", "\uFEFF---javascript"]) {
      invalidateSoulCache();
      writeFileSync(path.join(agentDir, "SOUL.md"), `${fence}\n(globalThis.__personaUnsafe = true, {})\n---\nBody`);
      assert.throws(() => loadSoul(), /YAML|frontmatter/);
      assert.equal(probe.__personaUnsafe, undefined);
    }

    invalidateSoulCache();
    writeFileSync(path.join(agentDir, "SOUL.md"), "Body");
    writeFileSync(path.join(agentDir, "IDENTIFY.md"), "\uFEFF---\nname: BOM persona\n---\n");
    assert.equal(loadSoul()?.name, "BOM persona");
  });
});
