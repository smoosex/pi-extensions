import test from "node:test";
import assert from "node:assert/strict";
import { changedPackages, nextVersion, selectPackages } from "./release.mjs";

test("selects each changed existing package once", () => {
  assert.deepEqual(changedPackages([
    "packages/pi-persona/src/a.ts",
    "packages/pi-persona/README.md",
    "packages/pi-tps/index.ts",
    "packages/deleted/file.ts",
    "README.md",
  ], ["pi-persona", "pi-tps"]), ["pi-persona", "pi-tps"]);
});

test("manual all-packages mode includes unchanged packages", () => {
  const names = ["pi-tps", "pi-persona"];
  assert.deepEqual(selectPackages(["packages/pi-tps/index.ts"], names, true), ["pi-persona", "pi-tps"]);
  assert.deepEqual(selectPackages(["packages/pi-tps/index.ts"], names, false), ["pi-tps"]);
});

test("bumps published versions and respects newer manually selected versions", () => {
  assert.equal(nextVersion("0.1.2", ["0.1.2", "0.1.3-beta.1"]), "0.1.3");
  assert.equal(nextVersion("0.1.2", ["0.1.4"]), "0.1.5");
  assert.equal(nextVersion("0.2.0", ["0.1.9"]), "0.2.0");
  assert.equal(nextVersion("0.1.0", []), "0.1.0");
  assert.throws(() => nextVersion("0.1.0-beta.1", []));
});
