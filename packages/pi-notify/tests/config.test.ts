import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getConfig } from "../src/config.ts";

const envKeys = [
  "PI_NOTIFY_TITLE",
  "PI_NOTIFY_BODY",
  "PI_NOTIFY_MESSAGE_SOURCE",
  "PI_NOTIFY_MESSAGE_MAX",
  "PI_NOTIFY_SOUND_CMD",
] as const;

const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  mock.restoreAll();
});

function context(): ExtensionContext {
  return {
    cwd: "/tmp/pi-notify",
    model: { provider: "openai", id: "gpt-4.1" },
  } as ExtensionContext;
}

describe("config", () => {
  it("builds the default notification from assistant output", () => {
    mock.method(Date, "now", () => 5_000);
    const config = getConfig(context(), 800, [
      { role: "user", content: "please fix this" },
      { role: "assistant", content: "fixed it" },
    ]);

    assert.deepEqual(config, {
      title: "π - pi-notify",
      body: "fixed it",
      soundCommand: undefined,
    });
  });

  it("falls back to a non-empty test message", () => {
    const config = getConfig(context());

    assert.equal(config.body, "Ready for input");
  });

  it("applies custom templates, selected message, truncation, and sound command", () => {
    mock.method(Date, "now", () => 2_000);
    process.env.PI_NOTIFY_TITLE = "{project} {duration_ms}";
    process.env.PI_NOTIFY_BODY = "{message}";
    process.env.PI_NOTIFY_MESSAGE_SOURCE = "user";
    process.env.PI_NOTIFY_MESSAGE_MAX = "5";
    process.env.PI_NOTIFY_SOUND_CMD = " say done ";

    const config = getConfig(context(), 1_000, [
      { role: "user", content: "hello world" },
      { role: "assistant", content: "assistant output" },
    ]);

    assert.deepEqual(config, {
      title: "pi-notify 1000",
      body: "hell…",
      soundCommand: "say done",
    });
  });
});
