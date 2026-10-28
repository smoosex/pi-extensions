// ============================================================
// pi-persona — 持久化
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { atomicWrite, isMissing, withPersonaLock } from "./storage.js";
import type { Emotion, PersistentEmotionSnapshot, PersistentState } from "./types.js";

function stateFile(): string {
  return path.join(getAgentDir(), "mood-state.json");
}

const FUTURE_INTERACTION_TOLERANCE_MS = 5 * 60 * 1000;
export const MAX_PERSISTENT_HISTORY = 50;

const EMOTIONS = new Set<Emotion>([
  "joy",
  "trust",
  "fear",
  "surprise",
  "sadness",
  "disgust",
  "anger",
  "anticipation",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function isEmotion(value: unknown): value is Emotion {
  return typeof value === "string" && EMOTIONS.has(value as Emotion);
}

function parseHistorySnapshot(data: unknown, now: number): PersistentEmotionSnapshot | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const snap = data as Record<string, unknown>;
  if (
    typeof snap.id !== "string" ||
    snap.id.length === 0 ||
    typeof snap.sessionId !== "string" ||
    snap.sessionId.length === 0 ||
    typeof snap.sequence !== "number" ||
    !Number.isInteger(snap.sequence) ||
    snap.sequence < 1 ||
    typeof snap.angle !== "number" ||
    typeof snap.intensity !== "number" ||
    !isEmotion(snap.emotion) ||
    (snap.level !== 1 && snap.level !== 2 && snap.level !== 3) ||
    (snap.compound !== undefined && typeof snap.compound !== "string") ||
    typeof snap.timestamp !== "number" ||
    typeof snap.trigger !== "string" ||
    snap.trigger.length === 0 ||
    !Number.isFinite(snap.angle) ||
    !Number.isFinite(snap.intensity) ||
    !Number.isFinite(snap.timestamp)
  ) {
    return null;
  }

  return {
    id: snap.id,
    sessionId: snap.sessionId,
    sequence: snap.sequence,
    angle: normalizeAngle(snap.angle),
    intensity: clamp(snap.intensity, 0, 1),
    emotion: snap.emotion,
    level: snap.level,
    ...(snap.compound ? { compound: snap.compound } : {}),
    timestamp:
      snap.timestamp > 0 && snap.timestamp <= now + FUTURE_INTERACTION_TOLERANCE_MS
        ? snap.timestamp
        : now,
    trigger: snap.trigger,
  };
}

function normalizeHistory(history: unknown, now: number): PersistentEmotionSnapshot[] | null {
  if (!Array.isArray(history)) return null;

  const seen = new Set<string>();
  const snapshots: PersistentEmotionSnapshot[] = [];
  for (const item of history) {
    const snap = parseHistorySnapshot(item, now);
    if (!snap || seen.has(snap.id)) return null;
    seen.add(snap.id);
    snapshots.push(snap);
  }

  return snapshots
    .sort((a, b) => a.sequence - b.sequence || a.timestamp - b.timestamp)
    .slice(-MAX_PERSISTENT_HISTORY);
}

function parsePersistentState(data: unknown, now: number = Date.now()): PersistentState | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const state = data as Record<string, unknown>;
  if (
    state.version !== 2 ||
    typeof state.lastInteraction !== "number" ||
    typeof state.lastAngle !== "number" ||
    typeof state.lastIntensity !== "number" ||
    typeof state.nextHistorySequence !== "number" ||
    !Number.isInteger(state.nextHistorySequence) ||
    state.nextHistorySequence < 1 ||
    (state.emotionUpdatesEnabled !== undefined && typeof state.emotionUpdatesEnabled !== "boolean") ||
    !Number.isFinite(state.lastInteraction) ||
    !Number.isFinite(state.lastAngle) ||
    !Number.isFinite(state.lastIntensity) ||
    (state.lastLateNightTrigger !== undefined &&
      (typeof state.lastLateNightTrigger !== "number" || !Number.isFinite(state.lastLateNightTrigger) || state.lastLateNightTrigger < 0))
  ) {
    return null;
  }

  const history = normalizeHistory(state.history, now);
  if (!history) return null;

  const maxSequence = history.reduce((max, snap) => Math.max(max, snap.sequence), 0);
  const nextHistorySequence = Math.max(state.nextHistorySequence, maxSequence + 1);
  const lastInteraction =
    state.lastInteraction > 0 && state.lastInteraction <= now + FUTURE_INTERACTION_TOLERANCE_MS
      ? state.lastInteraction
      : now;

  return {
    version: 2,
    lastInteraction,
    lastAngle: normalizeAngle(state.lastAngle),
    lastIntensity: clamp(state.lastIntensity, 0, 1),
    emotionUpdatesEnabled: typeof state.emotionUpdatesEnabled === "boolean" ? state.emotionUpdatesEnabled : true,
    ...(state.lastLateNightTrigger === undefined ? {} : { lastLateNightTrigger: state.lastLateNightTrigger as number }),
    nextHistorySequence,
    history,
  };
}

function defaultPersistentState(now: number = Date.now()): PersistentState {
  return {
    version: 2,
    lastInteraction: now,
    lastAngle: 0,
    lastIntensity: 0.15,
    emotionUpdatesEnabled: true,
    nextHistorySequence: 1,
    history: [],
  };
}

function normalizePersistentState(state: PersistentState): PersistentState {
  const parsed = parsePersistentState(state);
  if (!parsed) throw new Error("Invalid mood-state.json");
  return parsed;
}

export function restorePersistentState(): PersistentState {
  let raw: string;
  try {
    raw = fs.readFileSync(stateFile(), "utf-8");
  } catch (error) {
    if (isMissing(error)) return defaultPersistentState();
    throw error;
  }
  return normalizePersistentState(JSON.parse(raw));
}

export async function updatePersistentState(
  updater: (state: PersistentState) => PersistentState | Promise<PersistentState>,
): Promise<PersistentState> {
  return withPersonaLock(async (dir) => {
    const current = restorePersistentState();
    // Capture before the updater, which may mutate its input.
    const original = JSON.stringify(current);
    const next = normalizePersistentState(await updater(current));
    if (JSON.stringify(next) !== original) {
      await atomicWrite(dir, "mood-state.json", JSON.stringify(next, null, 2));
    }
    return next;
  });
}

/** Kept for API compatibility; atomic replacement makes reads lock-free. */
export async function readPersistentStateLocked(): Promise<PersistentState> {
  return restorePersistentState();
}

/** 同步引擎情绪坐标到持久化状态，不改 history。 */
export function syncMoodToPersistent(engine: { persistent: PersistentState; state: { angle: number; intensity: number } }): void {
  engine.persistent.lastAngle = engine.state.angle;
  engine.persistent.lastIntensity = engine.state.intensity;
}
