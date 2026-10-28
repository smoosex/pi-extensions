import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, chmodSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readPersistentStateLocked,
  restorePersistentState,
  syncMoodToPersistent,
  updatePersistentState,
} from "./persistence.js";
import type { PersistentState } from "./types.js";

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

function lockDir(home: string): string {
  return path.join(home, ".pi", "agent", "mood-state.lock");
}

function writeState(home: string, state: unknown): void {
  mkdirSync(path.dirname(stateFile(home)), { recursive: true });
  writeFileSync(stateFile(home), JSON.stringify(state, null, 2), "utf-8");
}

function createState(overrides: Partial<PersistentState> = {}): PersistentState {
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

test("restorePersistentState returns defaults when state file is missing", async () => {
  await withTemporaryHome(async () => {
    const state = restorePersistentState();

    assert.equal(state.version, 2);
    assert.equal(state.lastAngle, 0);
    assert.equal(state.lastIntensity, 0.15);
    assert.equal(state.emotionUpdatesEnabled, true);
    assert.equal(state.nextHistorySequence, 1);
    assert.deepEqual(state.history, []);
  });
});

test("restorePersistentState normalizes persisted angle, intensity, and history", async () => {
  await withTemporaryHome(async (home) => {
    const now = Date.now();
    writeState(home, {
      version: 2,
      lastInteraction: now,
      lastAngle: -90,
      lastIntensity: 2,
      emotionUpdatesEnabled: false,
      nextHistorySequence: 1,
      history: [
        {
          id: "b",
          sessionId: "s",
          sequence: 2,
          angle: 450,
          intensity: -1,
          emotion: "trust",
          level: 1,
          timestamp: now,
          trigger: "manual_set",
        },
        {
          id: "a",
          sessionId: "s",
          sequence: 1,
          angle: -45,
          intensity: 0.5,
          emotion: "anticipation",
          level: 2,
          timestamp: now,
          trigger: "manual_set",
        },
      ],
    });

    const state = restorePersistentState();

    assert.equal(state.lastAngle, 270);
    assert.equal(state.lastIntensity, 1);
    assert.equal(state.emotionUpdatesEnabled, false);
    assert.equal(state.nextHistorySequence, 3);
    assert.deepEqual(
      state.history.map((snap) => [snap.id, snap.angle, snap.intensity]),
      [
        ["a", 315, 0.5],
        ["b", 90, 0],
      ],
    );
  });
});

test("invalid state and malformed JSON are surfaced without overwriting", async () => {
  await withTemporaryHome(async (home) => {
    writeState(home, { version: 1, history: [] });
    assert.throws(() => restorePersistentState(), /Invalid mood-state/);
    await assert.rejects(updatePersistentState((state) => state), /Invalid mood-state/);
    writeFileSync(stateFile(home), "not json");
    assert.throws(() => restorePersistentState(), SyntaxError);
    await assert.rejects(updatePersistentState((state) => state), SyntaxError);
    assert.equal(readFileSync(stateFile(home), "utf8"), "not json");
  });
});

test("updatePersistentState writes normalized state and releases lock", async () => {
  await withTemporaryHome(async (home) => {
    const updated = await updatePersistentState((state) => ({
      ...state,
      lastAngle: 765,
      lastIntensity: -0.5,
    }));

    const raw = JSON.parse(readFileSync(stateFile(home), "utf-8")) as PersistentState;
    assert.equal(updated.lastAngle, 45);
    assert.equal(updated.lastIntensity, 0);
    assert.equal(raw.lastAngle, 45);
    assert.equal(raw.lastIntensity, 0);
    assert.equal(existsSync(lockDir(home)), false);
  });
});

test("readPersistentStateLocked is lock-free and leaves even invalid locks untouched", async () => {
  await withTemporaryHome(async (home) => {
    const staleLock = lockDir(home);
    mkdirSync(staleLock, { recursive: true });
    writeFileSync(path.join(staleLock, "owner.json"), "not json", "utf-8");
    const old = new Date(Date.now() - 60_000);
    utimesSync(staleLock, old, old);
    writeState(home, createState({ lastAngle: 180, lastIntensity: 0.4 }));

    const state = await readPersistentStateLocked();

    assert.equal(state.lastAngle, 180);
    assert.equal(state.lastIntensity, 0.4);
    assert.equal(existsSync(staleLock), true);
  });
});

test("syncMoodToPersistent copies engine state coordinates", () => {
  const persistent = createState();
  syncMoodToPersistent({ persistent, state: { angle: 225, intensity: 0.65 } });

  assert.equal(persistent.lastAngle, 225);
  assert.equal(persistent.lastIntensity, 0.65);
});

test("reads do not create directories and no-op transactions do not create a state file", async () => {
  await withTemporaryHome(async (home) => {
    await readPersistentStateLocked();
    assert.equal(existsSync(path.dirname(stateFile(home))), false);
    await updatePersistentState((state) => state);
    assert.equal(existsSync(stateFile(home)), false);
  });
});

test("atomic writes use 0600 without chmodding the shared agent directory", async () => {
  await withTemporaryHome(async (home) => {
    mkdirSync(path.dirname(stateFile(home)), { recursive: true });
    chmodSync(path.dirname(stateFile(home)), 0o755);
    await updatePersistentState((state) => ({ ...state, lastAngle: 90 }));
    assert.equal(statSync(stateFile(home)).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(stateFile(home))).mode & 0o777, 0o755);
    const before = statSync(stateFile(home)).mtimeMs;
    await updatePersistentState((state) => state);
    assert.equal(statSync(stateFile(home)).mtimeMs, before);
  });
});

test("transactions serialize async updaters without lost updates", async () => {
  await withTemporaryHome(async () => {
    await Promise.all(Array.from({ length: 8 }, () =>
      updatePersistentState(async (state) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ...state, lastAngle: state.lastAngle + 1 };
      })));
    assert.equal(restorePersistentState().lastAngle, 8);
  });
});

test("abandoned ownerless locks and recovery directories are reclaimed after 30 seconds", async () => {
  await withTemporaryHome(async (home) => {
    const lock = lockDir(home);
    const recovery = lock + ".recovery";
    mkdirSync(lock, { recursive: true });
    mkdirSync(recovery);
    const old = new Date(Date.now() - 31_000);
    utimesSync(lock, old, old);
    utimesSync(recovery, old, old);
    await updatePersistentState((state) => ({ ...state, lastAngle: 90 }));
    assert.equal(restorePersistentState().lastAngle, 90);
    assert.equal(existsSync(lock), false);
    assert.equal(existsSync(recovery), false);
  });
});

test("transactions serialize across independent processes", async () => {
  await withTemporaryHome(async () => {
    const moduleUrl = new URL("./persistence.js", import.meta.url).href;
    const script = `(async () => {
      const { updatePersistentState } = await import(${JSON.stringify(moduleUrl)});
      for (let i = 0; i < 4; i++) await updatePersistentState(async (state) => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return { ...state, lastAngle: state.lastAngle + 1 };
      });
    })().catch(error => { console.error(error); process.exitCode = 1; });`;
    await Promise.all(Array.from({ length: 3 }, () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", script], { env: { ...process.env }, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    })));
    assert.equal(restorePersistentState().lastAngle, 12);
  });
});

test("malformed lock owner JSON is not silently reclaimed", async () => {
  await withTemporaryHome(async (home) => {
    mkdirSync(lockDir(home), { recursive: true });
    writeFileSync(path.join(lockDir(home), "owner.json"), "broken");
    await assert.rejects(updatePersistentState((state) => state), SyntaxError);
    assert.equal(existsSync(stateFile(home)), false);
  });
});

test("atomic write failure is surfaced and temporary files are cleaned", async () => {
  await withTemporaryHome(async (home) => {
    await assert.rejects(updatePersistentState((state) => {
      mkdirSync(stateFile(home));
      return { ...state, lastAngle: 90 };
    }));
    assert.equal(existsSync(lockDir(home)), false);
    assert.deepEqual(readdirSync(path.dirname(stateFile(home))), ["mood-state.json"]);
  });
});

test("I/O and updater failures propagate and release their locks", async () => {
  await withTemporaryHome(async (home) => {
    mkdirSync(stateFile(home), { recursive: true });
    assert.throws(() => restorePersistentState());
    await assert.rejects(updatePersistentState((state) => state));
    assert.equal(existsSync(lockDir(home)), false);
    rmSync(stateFile(home), { recursive: true });
    await assert.rejects(updatePersistentState(() => { throw new Error("updater failed"); }), /updater failed/);
    await assert.rejects(updatePersistentState((state) => ({ ...state, lastAngle: NaN })), /Invalid mood-state/);
    assert.equal(existsSync(stateFile(home)), false);
    assert.equal(existsSync(lockDir(home)), false);
  });
});
