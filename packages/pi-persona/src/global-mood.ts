// ============================================================
// pi-persona — 全局共享心情状态
// ============================================================
import { MoodEngine } from "./mood-engine.js";
import { readPersistentStateLocked, syncMoodToPersistent, updatePersistentState } from "./persistence.js";
import type { EmotionalEvent, Emotion, EmotionChange, PersistentState } from "./types.js";

const MAX_PERSISTENT_HISTORY = 50;
const SESSION_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let localEventCounter = 0;

function restoreEngineFromPersistent(engine: MoodEngine): void {
  const anchor = engine.persistent.lastInteraction;
  engine.restoreState(
    engine.persistent.lastAngle,
    engine.persistent.lastIntensity,
    engine.persistent.lastInteraction,
  );
  engine.state.history = engine.persistent.history.map(({ id: _id, sessionId: _sessionId, sequence: _sequence, ...snapshot }) => snapshot);
  engine.persistent.lastInteraction = anchor;
}

function replaceEnginePersistent(engine: MoodEngine, persistent: PersistentState): void {
  engine.persistent.version = persistent.version;
  engine.persistent.lastInteraction = persistent.lastInteraction;
  engine.persistent.lastAngle = persistent.lastAngle;
  engine.persistent.lastIntensity = persistent.lastIntensity;
  engine.persistent.emotionUpdatesEnabled = persistent.emotionUpdatesEnabled;
  engine.persistent.lastLateNightTrigger = persistent.lastLateNightTrigger;
  engine.persistent.nextHistorySequence = persistent.nextHistorySequence;
  engine.persistent.history = persistent.history;
}

function appendLatestHistorySnapshot(engine: MoodEngine): void {
  const snapshot = engine.state.history.at(-1);
  if (!snapshot) return;

  const sequence = engine.persistent.nextHistorySequence;
  engine.persistent.history = [
    ...engine.persistent.history,
    {
      ...snapshot,
      id: `${SESSION_ID}-${++localEventCounter}`,
      sessionId: SESSION_ID,
      sequence,
    },
  ].slice(-MAX_PERSISTENT_HISTORY);
  engine.persistent.nextHistorySequence = sequence + 1;
}

/** Reads never persist decay, even for callers using the legacy persist flag. */
export async function refreshGlobalMood(engine: MoodEngine, _persist: boolean): Promise<void> {
  publishEngine(engine, await readPersistentStateLocked());
}

function createEngine(engine: MoodEngine, persistent: PersistentState): MoodEngine {
  const fresh = new MoodEngine(engine.soul, structuredClone(persistent), engine.emotionConfig);
  restoreEngineFromPersistent(fresh);
  return fresh;
}

function publishEngine(engine: MoodEngine, persistent: PersistentState): void {
  const fresh = createEngine(engine, persistent);
  replaceEnginePersistent(engine, persistent);
  // Restore lastTick as well, but keep persisted coordinates and their original decay anchor.
  engine.restoreState(persistent.lastAngle, persistent.lastIntensity, persistent.lastInteraction);
  engine.state.history = fresh.state.history;
  replaceEnginePersistent(engine, persistent);
}

async function transact<T>(
  engine: MoodEngine,
  action: (fresh: MoodEngine) => T,
): Promise<T> {
  let result!: T;
  const next = await updatePersistentState((persistent) => {
    const fresh = createEngine(engine, persistent);
    result = action(fresh);
    return fresh.persistent;
  });
  publishEngine(engine, next);
  return result;
}

export async function applyGlobalMoodEvent(
  engine: MoodEngine,
  event: EmotionalEvent,
): Promise<EmotionChange> {
  const skip = (fresh: MoodEngine) => !fresh.persistent.emotionUpdatesEnabled ||
    (event.trigger === "late_night" && Date.now() - (fresh.persistent.lastLateNightTrigger ?? 0) < 30 * 60 * 1000);
  const unchanged = (fresh: MoodEngine): EmotionChange => ({
    previousAngle: fresh.state.angle, newAngle: fresh.state.angle,
    intensityChange: 0, catchphrase: fresh.getEmotionPhrase(), notify: false,
  });
  const current = await readPersistentStateLocked();
  const view = createEngine(engine, current);
  if (skip(view)) {
    publishEngine(engine, current);
    return unchanged(view);
  }
  return transact(engine, (fresh) => {
    // Recheck under the lock: another process may have disabled updates or fired the nightly event.
    if (skip(fresh)) return unchanged(fresh);
    const change = fresh.processEvent(event);
    if (event.trigger === "late_night") fresh.persistent.lastLateNightTrigger = Date.now();
    syncMoodToPersistent(fresh);
    appendLatestHistorySnapshot(fresh);
    return change;
  });
}

export async function setGlobalMood(
  engine: MoodEngine,
  emotion: Emotion,
  intensity: number,
  trigger: string,
): Promise<EmotionChange> {
  return transact(engine, (fresh) => {
    const change = fresh.setEmotion(emotion, intensity, trigger);
    syncMoodToPersistent(fresh);
    appendLatestHistorySnapshot(fresh);
    return change;
  });
}

export async function setGlobalEmotionUpdatesEnabled(
  engine: MoodEngine,
  enabled: boolean,
): Promise<boolean> {
  return transact(engine, (fresh) => {
    if (fresh.persistent.emotionUpdatesEnabled !== enabled) {
      syncMoodToPersistent(fresh);
      fresh.persistent.emotionUpdatesEnabled = enabled;
      fresh.persistent.lastInteraction = Date.now();
    }
    return enabled;
  });
}
