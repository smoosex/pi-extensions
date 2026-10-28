import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { invalidateSoulCache, loadSoul } from "./soul-loader.js";
import { DEFAULT_TRAITS } from "./types.js";

function withAgentDir(fn: (dir: string) => void): void {
  const original = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(path.join(tmpdir(), "pi-persona-documents-"));
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    invalidateSoulCache();
    fn(dir);
  } finally {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
    invalidateSoulCache();
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(dir: string, name: string, content: string): void {
  writeFileSync(path.join(dir, name), content);
}

const frontmatter = (metadata: string) => `---\n${metadata}\n---\n`;

test("missing documents retain CLI metadata defaults and missing SOUL disables persona", () => {
  withAgentDir((dir) => {
    assert.equal(loadSoul(), null);
    write(dir, "SOUL.md", "Soul body");
    const soul = loadSoul();
    assert.equal(soul?.name, "Soul");
    assert.equal(soul?.emoji, "󰊠");
    assert.equal(soul?.description, "用户自定义灵魂");
    assert.deepEqual(soul?.traits, DEFAULT_TRAITS);
  });
});

test("YAML metadata accepts numeric boundary traits and description without injecting frontmatter", () => {
  withAgentDir((dir) => {
    write(dir, "SOUL.md", "Soul body");
    write(dir, "IDENTIFY.md", frontmatter("name: ' Test '\nemoji: ✨\ndescription: Metadata only\nopenness: 0\nsarcasm: 1"));
    const soul = loadSoul();
    assert.equal(soul?.name, "Test");
    assert.equal(soul?.description, "Metadata only");
    assert.equal(soul?.traits.openness, 0);
    assert.equal(soul?.traits.sarcasm, 1);
    assert.equal(soul?.systemPrompt, "Soul body");
  });
});

for (const metadata of [
  "openness: '0.5'", "openness: true", "openness: null", "openness: .nan",
  "openness: .inf", "openness: -0.1", "openness: 1.1", "name: 1", "name: ' '",
  "emoji: false", "emoji: ''", "description: []", "description: null",
  "- not-a-mapping", "scalar",
]) {
  test(`invalid metadata throws: ${metadata}`, () => {
    withAgentDir((dir) => {
      write(dir, "SOUL.md", "Soul body");
      write(dir, "IDENTIFY.md", frontmatter(metadata));
      assert.throws(() => loadSoul());
    });
  });
}

for (const name of ["SOUL.md", "IDENTIFY.md", "USER.md"]) {
  test(`${name} rejects malformed, unterminated, and executable frontmatter`, () => {
    withAgentDir((dir) => {
      write(dir, "SOUL.md", "Soul body");
      for (const raw of [
        frontmatter("value: ["), "---\nvalue: 1", "---js\nthrow new Error('executed')\n---",
        "\uFEFF---javascript\nthrow new Error('executed')\n---", "---json\n{}\n---",
      ]) {
        write(dir, name, raw);
        invalidateSoulCache();
        assert.throws(() => loadSoul());
      }
    });
  });

  test(`${name} reports non-file IO errors even with no SOUL`, () => {
    withAgentDir((dir) => {
      mkdirSync(path.join(dir, name));
      assert.throws(() => loadSoul(), /Expected a file/);
    });
  });
}

test("invalid IDENTIFY metadata is not masked by absent SOUL", () => {
  withAgentDir((dir) => {
    write(dir, "IDENTIFY.md", frontmatter("description: false"));
    assert.throws(() => loadSoul(), /description/);
  });
});

test("agent directory changes invalidate identical file stamps", () => {
  withAgentDir((dir) => {
    const second = path.join(dir, "second");
    mkdirSync(second);
    const stamp = new Date("2020-01-01T00:00:00Z");
    for (const [folder, body] of [[dir, "First"], [second, "Other"]]) {
      write(folder, "SOUL.md", body);
      utimesSync(path.join(folder, "SOUL.md"), stamp, stamp);
    }
    assert.equal(loadSoul()?.systemPrompt, "First");
    process.env.PI_CODING_AGENT_DIR = second;
    assert.equal(loadSoul()?.systemPrompt, "Other");
  });
});
