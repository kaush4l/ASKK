// choose-base — let Kaushal choose the base branch for a PR/feature.
//
// Usage:
//   node scripts/choose-base.mjs [base] [--allow-main] [--verify-count]
//
// - Default base: askk-skeleton.
// - Refuses main unless --allow-main is passed explicitly (main is
//   the old tree; merging it back into askk-skeleton would restore
//   the old tree — see the cleanup rule).
// - Verifies the base via git ls-remote (public repo, no auth):
//   prints the branch head SHA. With --verify-count, it clones the
//   branch shallowly into a temp dir and counts tracked files.
// - Prints the compare URL for a feature branch against the base.
//   It does not create a branch, push, or merge anything.
//
// Example:
//   node scripts/choose-base.mjs askk-skeleton --verify-count
//   node scripts/choose-base.mjs feature/my-feature --allow-main  # only if you mean it

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "https://github.com/kaush4l/ASKK.git";
const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--")) ?? "askk-skeleton";
const allowMain = args.includes("--allow-main");
const verifyCount = args.includes("--verify-count");

if (base === "main" && !allowMain) {
  console.error(
    "Refusing base 'main': it holds the old tree. Pass --allow-main explicitly if you really mean it.",
  );
  process.exit(1);
}

function run(cmd) {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

let head = "";
try {
  const out = run(`git ls-remote ${REPO} ${base}`);
  head = out.split(/\s+/)[0] ?? "";
} catch {
  console.error(`Base branch not found on remote: ${base}`);
  process.exit(1);
}
if (!head) {
  console.error(`Base branch not found on remote: ${base}`);
  process.exit(1);
}
console.log(`Base: ${base}`);
console.log(`Head: ${head}`);

if (verifyCount) {
  const dir = mkdtempSync(join(tmpdir(), "choose-base-"));
  try {
    run(`git clone -q --single-branch --branch ${base} ${REPO} ${dir}`);
    const count = run(`git -C ${dir} ls-files | wc -l`).trim();
    console.log(`Tracked files: ${count}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(
  `Compare URL: https://github.com/kaush4l/ASKK/compare/${base}...<feature-branch>`,
);
console.log("This script creates nothing, pushes nothing, merges nothing.");
