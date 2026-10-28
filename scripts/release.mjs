import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import semver from "semver";

export function changedPackages(paths, packageNames) {
  const available = new Set(packageNames);
  return [...new Set(paths.map((path) => /^packages\/([^/]+)\//.exec(path)?.[1]).filter((name) => available.has(name)))].sort();
}

export function nextVersion(current, published) {
  if (!semver.valid(current) || semver.prerelease(current)) throw new Error(`Expected a stable version, got ${current}`);
  const stable = published.filter((version) => semver.valid(version) && !semver.prerelease(version)).sort(semver.rcompare);
  if (!stable.length || semver.gt(current, stable[0])) return current;
  return semver.inc(stable[0], "patch");
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options })?.trim() ?? "";
}

function publishedVersions(name) {
  const result = spawnSync("npm", ["view", name, "versions", "--json", "--registry=https://registry.npmjs.org/"], { encoding: "utf8" });
  if (result.status !== 0) {
    let error;
    try { error = JSON.parse(result.stdout).error; } catch {}
    if (error?.code === "E404") return [];
    throw new Error(`Cannot query npm for ${name}: ${result.stderr || result.error || result.stdout}`);
  }
  const versions = JSON.parse(result.stdout);
  return Array.isArray(versions) ? versions : [versions];
}

function manifest(dir) {
  const path = `packages/${dir}/package.json`;
  return { path, data: JSON.parse(readFileSync(path, "utf8")) };
}

function main() {
  const [phase, before, after] = process.argv.slice(2);
  if (!["prepare", "publish"].includes(phase) || !before || !after || !process.env.GITHUB_RUN_ID) {
    throw new Error("Usage: release.mjs <prepare|publish> <before-sha> <after-sha>; GITHUB_RUN_ID is required");
  }
  const names = readdirSync("packages", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const marker = `Release-Run: ${process.env.GITHUB_RUN_ID}`;
  const headMessage = run("git", ["log", "-1", "--format=%B"]);
  const alreadyPrepared = headMessage.split("\n").includes(marker);
  let changed;
  if (alreadyPrepared) {
    const line = headMessage.split("\n").find((value) => value.startsWith("Release-Packages: "));
    if (!line) throw new Error("Release commit has no package list.");
    changed = JSON.parse(line.slice("Release-Packages: ".length));
  } else {
    const previous = run("git", ["log", "--fixed-strings", "--grep=Release-Run: ", "--format=%H", "-1"]);
    if (previous) {
      const message = run("git", ["show", "-s", "--format=%B", previous]);
      const line = message.split("\n").find((value) => value.startsWith("Release-Packages: "));
      if (!line) throw new Error("Previous release commit has no package list.");
      for (const dir of JSON.parse(line.slice("Release-Packages: ".length))) {
        const data = JSON.parse(run("git", ["show", `${previous}:packages/${dir}/package.json`]));
        if (!publishedVersions(data.name).includes(data.version)) {
          throw new Error(`Previous release ${data.name}@${data.version} is incomplete. Resolve it before another release.`);
        }
      }
    }
    const baseline = previous || run("git", ["rev-list", "--max-parents=0", "HEAD"]).split("\n")[0];
    const files = run("git", ["diff", "--name-only", baseline, "HEAD"]).split("\n").filter(Boolean);
    changed = changedPackages(files, names);
  }
  if (!changed.length) {
    console.log("No packages changed.");
    return;
  }

  if (phase === "prepare") {
    if (alreadyPrepared) {
      console.log("Reusing this run's existing release commit.");
      return;
    }
    const previousRelease = run("git", ["log", "--all", "--fixed-strings", `--grep=${marker}`, "--format=%H", "-1"]);
    if (previousRelease) throw new Error("This run's release commit is no longer HEAD; reconcile it before retrying.");
    for (const dir of changed) {
      const { path, data } = manifest(dir);
      const version = nextVersion(data.version, publishedVersions(data.name));
      console.log(`${data.name}: ${data.version} -> ${version}`);
      data.version = version;
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    }
    run("bun", ["install", "--lockfile-only", "--ignore-scripts"], { stdio: "inherit" });
    run("git", ["add", "bun.lock", ...changed.map((dir) => `packages/${dir}/package.json`)]);
    run("git", ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "--allow-empty", "-m", "chore(release): update package versions [skip ci]", "-m", `${marker}\nRelease-Packages: ${JSON.stringify(changed)}`], { stdio: "inherit" });
    run("git", ["push", "origin", "HEAD:main"], { stdio: "inherit" });
    return;
  }

  if (!alreadyPrepared) throw new Error("HEAD is not this run's release commit; refusing to publish.");
  for (const dir of changed) {
    const { data } = manifest(dir);
    if (publishedVersions(data.name).includes(data.version)) {
      console.log(`${data.name}@${data.version} is already published; skipping.`);
      continue;
    }
    console.log(`Publishing ${data.name}@${data.version}`);
    run("npm", ["publish", "--access", "public", "--provenance"], { cwd: `packages/${dir}`, stdio: "inherit" });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
