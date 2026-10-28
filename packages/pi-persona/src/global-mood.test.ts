import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { applyGlobalMoodEvent, refreshGlobalMood, setGlobalEmotionUpdatesEnabled, setGlobalMood } from "./global-mood.js";
import { MoodEngine } from "./mood-engine.js";
import { DEFAULT_EMOTION_CONFIG, type PersistentState, type SoulDefinition } from "./types.js";

async function withTemporaryHome(fn: (home: string) => Promise<void>): Promise<void> {
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const home = await mkdtemp(path.join(tmpdir(), "pi-persona-home-"));

  try {
    process.env.HOME = home;
    // Bun may cache os.homedir(), so HOME alone does not isolate SDK storage.
    process.env.PI_CODING_AGENT_DIR = path.join(home, ".pi", "agent");
    await fn(home);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function stateFile(home: string): string {
  return path.join(home, ".pi", "agent", "mood-state.json");
}

function createPersistentState(overrides: Partial<PersistentState> = {}): PersistentState {
  return {
    version: 2,
    lastInteraction: Date.now(),
    lastAngle: 0,
    lastIntensity: 0.15,
    emotionUpdatesEnabled: true,
    nextHistorySequence: 1,
    history: [],
    ...overrides,
  };
}

function createSoul(): SoulDefinition {
  return {
    name: "Test Soul",
    emoji: "✨",
    description: "Test soul",
    traits: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
      formality: 0.5,
      tsundere: 0,
      sarcasm: 0,
    },
    systemPrompt: "You are Test Soul.",
  };
}

function createEngine(persistent = createPersistentState()): MoodEngine {
  return new MoodEngine(createSoul(), persistent, DEFAULT_EMOTION_CONFIG);
}

function readState(home: string): PersistentState {
  return JSON.parse(readFileSync(stateFile(home), "utf-8")) as PersistentState;
}

test("refreshGlobalMood never creates storage even with the legacy persist flag", async () => {
  await withTemporaryHome(async (home) => {
    const engine = createEngine();
    await refreshGlobalMood(engine, true);
    assert.equal(existsSync(path.dirname(stateFile(home))), false);
    assert.equal(engine.state.intensity, 0.15);
  });
});

test("refreshGlobalMood reads persisted state without writing new event", async () => {
  await withTemporaryHome(async () => {
    const first = createEngine();
    await setGlobalMood(first, "sadness", 0.6, "manual_set");

    const second = createEngine();
    await refreshGlobalMood(second, false);

    assert.equal(second.state.angle, 180);
    assert.equal(second.getCurrentEmotion(), "sadness");
    assert.equal(second.persistent.history.length, 1);
  });
});

test("applyGlobalMoodEvent applies event and appends persistent history", async () => {
  await withTemporaryHome(async () => {
    const engine = createEngine();

    const change = await applyGlobalMoodEvent(engine, {
      trigger: "test_pass",
      ...DEFAULT_EMOTION_CONFIG.triggers.test_pass,
    });

    assert.equal(change.newAngle, engine.state.angle);
    assert.equal(engine.getCurrentEmotion(), "joy");
    assert.equal(engine.persistent.history.length, 1);
    assert.equal(engine.persistent.history[0]?.trigger, "test_pass");
    assert.equal(engine.persistent.history[0]?.sequence, 1);
  });
});

test("applyGlobalMoodEvent does nothing when emotion updates are disabled", async () => {
  await withTemporaryHome(async () => {
    const engine = createEngine();
    await setGlobalEmotionUpdatesEnabled(engine, false);

    const change = await applyGlobalMoodEvent(engine, {
      trigger: "test_fail",
      ...DEFAULT_EMOTION_CONFIG.triggers.test_fail,
    });

    assert.equal(change.notify, false);
    assert.equal(engine.state.angle, 0);
    assert.equal(engine.state.intensity, 0.15);
    assert.equal(engine.persistent.history.length, 0);
  });
});

test("setGlobalEmotionUpdatesEnabled persists the switch", async () => {
  await withTemporaryHome(async (home) => {
    const engine = createEngine();

    await setGlobalEmotionUpdatesEnabled(engine, false);

    assert.equal(engine.persistent.emotionUpdatesEnabled, false);
    assert.equal(readState(home).emotionUpdatesEnabled, false);
  });
});

test("setGlobalMood directly sets emotion and appends persistent history", async () => {
  await withTemporaryHome(async () => {
    const engine = createEngine();

    await setGlobalMood(engine, "anger", 0.8, "manual_set");

    assert.equal(engine.state.angle, 270);
    assert.ok(Math.abs(engine.state.intensity - 0.8) < 0.001);
    assert.equal(engine.persistent.lastAngle, 270);
    assert.ok(Math.abs(engine.persistent.lastIntensity - 0.8) < 0.001);
    assert.equal(engine.persistent.history.length, 1);
    assert.equal(engine.persistent.history[0]?.emotion, "anger");
    assert.equal(engine.persistent.history[0]?.trigger, "manual_set");
  });
});

test("refresh recomputes decay from disk without changing its anchor or file", async () => {
  await withTemporaryHome(async (home) => {
    const engine = createEngine();
    const original = createPersistentState({ lastInteraction: Date.now() - 60_000, lastIntensity: 0.9 });
    mkdirSync(path.dirname(stateFile(home)), { recursive: true });
    writeFileSync(stateFile(home), JSON.stringify(original));
    const before = statSync(stateFile(home)).mtimeMs;
    await refreshGlobalMood(engine, true);
    const first = engine.state.intensity;
    assert.ok(first < 0.9);
    assert.equal(engine.persistent.lastInteraction, original.lastInteraction);
    await refreshGlobalMood(engine, false);
    assert.ok(Math.abs(engine.state.intensity - first) < 0.001);
    assert.deepEqual(readState(home), original);
    assert.equal(statSync(stateFile(home)).mtimeMs, before);
  });
});

test("disabled mood freezes decay and no-op events and toggles do not write", async () => {
  await withTemporaryHome(async (home) => {
    const original = createPersistentState({
      lastInteraction: Date.now() - 60_000, lastIntensity: 0.9, emotionUpdatesEnabled: false,
    });
    mkdirSync(path.dirname(stateFile(home)), { recursive: true });
    writeFileSync(stateFile(home), JSON.stringify(original));
    const before = statSync(stateFile(home)).mtimeMs;
    const engine = createEngine();
    await refreshGlobalMood(engine, true);
    assert.equal(engine.state.intensity, 0.9);
    await applyGlobalMoodEvent(engine, { trigger: "test_fail", ...DEFAULT_EMOTION_CONFIG.triggers.test_fail });
    await setGlobalEmotionUpdatesEnabled(engine, false);
    assert.deepEqual(readState(home), original);
    assert.equal(statSync(stateFile(home)).mtimeMs, before);
    await setGlobalMood(engine, "anger", 0.8, "manual_set");
    assert.equal(engine.state.intensity, 0.8);
    assert.equal(engine.persistent.emotionUpdatesEnabled, false);
    await setGlobalEmotionUpdatesEnabled(engine, true);
    assert.ok(Math.abs(engine.state.intensity - 0.8) < 0.001);
  });
});

test("independent engines transact against latest disk history", async () => {
  await withTemporaryHome(async (home) => {
    const first = createEngine();
    const second = createEngine();
    await Promise.all([
      setGlobalMood(first, "anger", 0.7, "first"),
      setGlobalMood(second, "joy", 0.6, "second"),
    ]);
    await refreshGlobalMood(first, false);
    assert.equal(readState(home).history.length, 2);
    assert.deepEqual(first.persistent.history.map((entry) => entry.sequence), [1, 2]);
  });
});

test("late-night cooldown is shared across processes and reloads, not session-local", async () => {
  await withTemporaryHome(async (home) => {
    const event = { trigger: "late_night", ...DEFAULT_EMOTION_CONFIG.triggers.late_night };
    await Promise.all([applyGlobalMoodEvent(createEngine(), event), applyGlobalMoodEvent(createEngine(), event)]);
    const first = readState(home);
    assert.equal(first.history.length, 1);
    assert.ok(first.lastLateNightTrigger);
    await applyGlobalMoodEvent(createEngine(), event);
    assert.deepEqual(readState(home), first);
    writeFileSync(stateFile(home), JSON.stringify({ ...first, lastLateNightTrigger: Date.now() - 31 * 60_000 }));
    await applyGlobalMoodEvent(createEngine(), event);
    assert.equal(readState(home).history.length, 2);
  });
});

test("disabled automatic events do not acquire the write lock", async () => {
  await withTemporaryHome(async (home) => {
    mkdirSync(path.dirname(stateFile(home)), { recursive: true });
    writeFileSync(stateFile(home), JSON.stringify(createPersistentState({ emotionUpdatesEnabled: false })));
    const lock = path.join(path.dirname(stateFile(home)), "mood-state.lock");
    mkdirSync(lock);
    writeFileSync(path.join(lock, "owner.json"), "invalid");
    await applyGlobalMoodEvent(createEngine(), { trigger: "test_pass", ...DEFAULT_EMOTION_CONFIG.triggers.test_pass });
    assert.equal(readFileSync(path.join(lock, "owner.json"), "utf8"), "invalid");
  });
});

test("storage failures reject without changing the caller engine", async () => {
  await withTemporaryHome(async (home) => {
    mkdirSync(path.dirname(stateFile(home)), { recursive: true });
    writeFileSync(stateFile(home), "broken");
    const engine = createEngine();
    const before = structuredClone({ state: engine.state, persistent: engine.persistent });
    await assert.rejects(refreshGlobalMood(engine, true), SyntaxError);
    await assert.rejects(setGlobalMood(engine, "anger", 0.9, "manual_set"), SyntaxError);
    await assert.rejects(applyGlobalMoodEvent(engine, {
      trigger: "test_pass", ...DEFAULT_EMOTION_CONFIG.triggers.test_pass,
    }), SyntaxError);
    await assert.rejects(setGlobalEmotionUpdatesEnabled(engine, false), SyntaxError);
    assert.deepEqual({ state: engine.state, persistent: engine.persistent }, before);
  });
});
