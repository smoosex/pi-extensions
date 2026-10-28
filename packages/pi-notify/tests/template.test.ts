import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderTemplate } from "../src/template.ts";

function context(): ExtensionContext {
  return {
    cwd: "/tmp/pi-notify",
    model: { provider: "ollama", id: "qwen3" },
  } as ExtensionContext;
}

describe("template", () => {
  it("renders built-in values and keeps unknown placeholders", () => {
    const output = renderTemplate(
      "{project} {cwd} {model} {model_short} {duration} {duration_ms} {missing}",
      context(),
      4200,
    );

    assert.equal(output, "/tmp/pi-notify".split("/").at(-1) + " /tmp/pi-notify ollama/qwen3 qwen3 4.2s 4200 {missing}");
  });

  it("allows extra values to override built-ins", () => {
    assert.equal(renderTemplate("{project} {message}", context(), 0, { project: "custom", message: "done" }), "custom done");
  });
});
