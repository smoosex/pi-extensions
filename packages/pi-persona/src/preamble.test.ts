import assert from "node:assert/strict";
import test from "node:test";
import { soulPreamble } from "./preamble.js";
import { DEFAULT_TRAITS } from "./types.js";

const soul = {
  name: "Susan", emoji: "S", description: "UI-only metadata", traits: DEFAULT_TRAITS,
  systemPrompt: "A familiar who values accuracy.", userProfile: "Call me boss.",
};

test("preamble includes the soul path, evolution, profile and safety rules without metadata or mood", () => {
  const prompt = soulPreamble(soul, "/tmp/persona/SOUL.md", new Date(2026, 9, 23, 12));
  assert.match(prompt, /LANGUAGE RULE/);
  assert.match(prompt, /Never fabricate tool outputs/);
  assert.match(prompt, /Never expose API keys/);
  assert.match(prompt, /Authoritative local date: 2026-10-23/);
  assert.match(prompt, /Weekday: Friday/);
  assert.match(prompt, /A familiar who values accuracy/);
  assert.match(prompt, /SOUL.md at \/tmp\/persona\/SOUL.md/);
  assert.match(prompt, /## Evolved Traits/);
  assert.match(prompt, /USER PROFILE[\s\S]*Call me boss/);
  assert.match(prompt, /Only the latest snapshot/);
  assert.doesNotMatch(prompt, /UI-only metadata|Your Current Emotion/);
});

test("preamble remains stable within a day and changes at the local date boundary", () => {
  const first = soulPreamble(soul, "/tmp/SOUL.md", new Date(2026, 9, 23, 0));
  assert.equal(soulPreamble(soul, "/tmp/SOUL.md", new Date(2026, 9, 23, 23, 59)), first);
  const next = soulPreamble(soul, "/tmp/SOUL.md", new Date(2026, 9, 24, 0));
  assert.notEqual(next, first);
  assert.match(next, /2026-10-24/);
  assert.match(next, /Saturday/);
  assert.doesNotMatch(soulPreamble({ ...soul, userProfile: undefined }, "/tmp/SOUL.md", new Date()), /USER PROFILE/);
});
