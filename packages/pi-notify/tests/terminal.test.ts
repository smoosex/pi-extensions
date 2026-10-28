import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createNotifier, sendNotification } from "../src/terminal.ts";
import type { NotifyConfig } from "../src/types.ts";

const ESC = "\x1b";
const ST = `${ESC}\\`;
const savedEnv = {
  KITTY_WINDOW_ID: process.env.KITTY_WINDOW_ID,
  TMUX: process.env.TMUX,
  TERM_PROGRAM: process.env.TERM_PROGRAM,
  TERM: process.env.TERM,
  GHOSTTY_RESOURCES_DIR: process.env.GHOSTTY_RESOURCES_DIR,
};

let originalWrite: typeof process.stdout.write;
let output = "";

beforeEach(() => {
  delete process.env.KITTY_WINDOW_ID;
  delete process.env.TMUX;
  delete process.env.TERM_PROGRAM;
  delete process.env.GHOSTTY_RESOURCES_DIR;
  process.env.TERM = "xterm-256color";
  resetFixedId();
});

afterEach(() => {
  process.stdout.write = originalWrite;
  output = "";
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function captureStdout(): void {
  originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
}

function config(title = "Title", body = "Body"): NotifyConfig {
  return { title, body };
}

function captureSpawn(): { calls: unknown[][]; spawn: typeof import("node:child_process").spawn } {
  const calls: unknown[][] = [];
  const spawn = ((...args: unknown[]) => {
    calls.push(args);
    return { unref() {} };
  }) as typeof import("node:child_process").spawn;
  return { calls, spawn };
}

let nextId = 0;
function fixedId(): string {
  return `pi-test-${nextId++}`;
}

function resetFixedId(): void {
  nextId = 0;
}

describe("terminal notifications", () => {
  it("writes Kitty OSC 99 payloads when Kitty is detected", () => {
    process.env.KITTY_WINDOW_ID = "1";
    const notifier = createNotifier({ generateId: fixedId });
    captureStdout();
    notifier.sendNotification(config("π - pi-notify", "done\nnow"));

    const title = Buffer.from("π - pi-notify", "utf8").toString("base64");
    const body = Buffer.from("done\nnow", "utf8").toString("base64");
    assert.equal(output, `${ESC}]99;i=pi-test-0:d=0:e=1:o=always;${title}${ST}${ESC}]99;i=pi-test-0:p=body:e=1;${body}${ST}`);
  });

  it("wraps Kitty OSC 99 sequences for tmux passthrough", () => {
    process.env.TMUX = "/tmp/tmux";
    const notifier = createNotifier({ readTmuxClientInfo: () => "xterm-kitty xterm-kitty", generateId: fixedId });
    captureStdout();
    notifier.sendNotification(config("Pi", "done"));

    const title = Buffer.from("Pi", "utf8").toString("base64");
    const body = Buffer.from("done", "utf8").toString("base64");
    const titleSequence = `${ESC}]99;i=pi-test-0:d=0:e=1:o=always;${title}${ST}`.replaceAll(ESC, ESC + ESC);
    const bodySequence = `${ESC}]99;i=pi-test-0:p=body:e=1;${body}${ST}`.replaceAll(ESC, ESC + ESC);
    assert.equal(output, `${ESC}Ptmux;${titleSequence}${ST}${ESC}Ptmux;${bodySequence}${ST}`);
  });

  it("uses AppleScript when Kitty is not detected", () => {
    const { calls, spawn } = captureSpawn();
    const notifier = createNotifier({ spawn });

    captureStdout();
    notifier.sendNotification(config('Pi "notify"', "done\\now"));

    assert.equal(output, "");
    assert.deepEqual(calls, [
      ["osascript", ["-e", 'display notification "done\\\\now" with title "Pi \\"notify\\""'], { detached: true, stdio: "ignore" }],
    ]);
  });

  it("uses AppleScript for a non-Kitty tmux client even when KITTY_WINDOW_ID is stale", () => {
    process.env.TMUX = "/tmp/tmux";
    process.env.KITTY_WINDOW_ID = "stale";
    const { calls, spawn } = captureSpawn();
    const notifier = createNotifier({
      spawn,
      readTmuxClientInfo: () => "xterm-256color xterm-256color",
    });

    captureStdout();
    notifier.sendNotification(config("Pi", "done"));

    assert.equal(output, "");
    assert.deepEqual(calls, [
      ["osascript", ["-e", 'display notification "done" with title "Pi"'], { detached: true, stdio: "ignore" }],
    ]);
  });

  it("writes Ghostty OSC 777 payload when Ghostty env is detected", () => {
    process.env.TERM_PROGRAM = "ghostty";
    const { calls, spawn } = captureSpawn();
    const notifier = createNotifier({ spawn });
    captureStdout();
    notifier.sendNotification(config("Pi", "done"));

    assert.equal(output, `${ESC}]777;notify;Pi;done\x07`);
    assert.deepEqual(calls, []);
  });

  it("detects Ghostty via TERM or GHOSTTY_RESOURCES_DIR", () => {
    const { calls, spawn } = captureSpawn();
    const notifier = createNotifier({ spawn });
    captureStdout();
    for (const env of [{ TERM: "xterm-ghostty" }, { GHOSTTY_RESOURCES_DIR: "/app" }]) {
      delete process.env.TERM_PROGRAM;
      delete process.env.GHOSTTY_RESOURCES_DIR;
      process.env.TERM = "xterm-256color";
      Object.assign(process.env, env);
      output = "";
      calls.length = 0;
      notifier.sendNotification(config("Pi", "done"));
      assert.equal(output, `${ESC}]777;notify;Pi;done\x07`);
      assert.deepEqual(calls, []);
    }
  });

  it("sanitizes Ghostty title semicolons and prefers tmux client info over stale env", () => {
    process.env.TMUX = "/tmp/tmux";
    process.env.KITTY_WINDOW_ID = "stale";
    const { calls, spawn } = captureSpawn();
    const notifier = createNotifier({ spawn, readTmuxClientInfo: () => "xterm-ghostty ghostty" });
    captureStdout();
    notifier.sendNotification(config("a;b\\c", "x\ny"));

    const inner = `${ESC}]777;notify;a b\\c;x y\x07`.replaceAll(ESC, ESC + ESC);
    assert.equal(output, `${ESC}Ptmux;${inner}${ST}`);
    assert.deepEqual(calls, []);
  });
});
