import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractMessageText, truncateText } from "../src/messages.ts";

describe("messages", () => {
  it("extracts the latest text message for a role", () => {
    const messages = [
      { role: "user", content: "first user" },
      { role: "assistant", content: [{ type: "text", text: "first assistant" }] },
      { role: "user", content: [{ type: "text", text: "latest\nuser" }] },
    ];

    assert.equal(extractMessageText(messages, "user"), "latest user");
    assert.equal(extractMessageText(messages, "assistant"), "first assistant");
  });

  it("ignores non-text content blocks", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "image", text: "ignore me" },
          { type: "text", text: "keep me" },
        ],
      },
    ];

    assert.equal(extractMessageText(messages, "assistant"), "keep me");
  });

  it("truncates by unicode code points", () => {
    assert.equal(truncateText("hello", 10), "hello");
    assert.equal(truncateText("hello", 4), "hel…");
    assert.equal(truncateText("🤖abc", 3), "🤖a…");
    assert.equal(truncateText("hello", 1), "…");
    assert.equal(truncateText("hello", 0), "");
  });
});
