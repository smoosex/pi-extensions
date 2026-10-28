import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

for (const entry of readdirSync("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = `packages/${entry.name}`;
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  console.log(`\nChecking ${pkg.name}`);
  for (const script of ["typecheck", "test"]) {
    if (pkg.scripts?.[script]) execFileSync("bun", ["run", script], { cwd: dir, stdio: "inherit" });
  }
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: dir, encoding: "utf8" }));
  const files = pack.files.map((file) => file.path);
  for (const resource of [...(pkg.pi?.extensions ?? []), ...(pkg.pi?.themes ?? [])]) {
    const path = resource.replace(/^\.\//, "").replace(/\/$/, "");
    if (!files.some((file) => file === path || file.startsWith(`${path}/`))) {
      throw new Error(`${pkg.name}: ${resource} is missing from the npm package`);
    }
  }
}
