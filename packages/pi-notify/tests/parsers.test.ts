import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMessageMax, parseMessageSource } from "../src/parsers.ts";

describe("parsers", () => {
  it("parses message source", () => {
    assert.equal(parseMessageSource("assistant"), "assistant");
    assert.equal(parseMessageSource(" user "), "user");
    assert.equal(parseMessageSource("invalid"), "assistant");
  });

  it("parses and clamps message max", () => {
    assert.equal(parseMessageMax(undefined), 80);
    assert.equal(parseMessageMax("12"), 12);
    assert.equal(parseMessageMax("-1"), 0);
    assert.equal(parseMessageMax("999"), 500);
    assert.equal(parseMessageMax("nope"), 80);
  });
});
