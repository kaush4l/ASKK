// Dev checks — the gate before a final answer.
//
// runChecks() runs `bun test src/core` and `next build`
// (workspace-scoped, via the supplied runner) and records
// { name, command, status, exit, tail } per check. The runner is
// a function (command, { cwd }) -> { exit, output } | string;
// in tests it is mocked, so no real build runs. Without a runner,
// node:child_process runs the command in the workspace root.
// A check passes only when exit === 0. No final answer is given
// while a file is unchecked since checks passed — see the gate
// in src/core/loop.js, which consults runState.checksPassed.

import { execSync } from "node:child_process";

export const DEFAULT_CHECKS = Object.freeze([
  { name: "bun test src/core", command: "bun test src/core" },
  { name: "next build", command: "next build" },
]);

function tailOf(output, lines = 20) {
  const all = String(output ?? "").split(/\r?\n/);
  return all.slice(-lines).join("\n");
}

export function runChecks({ run, root, commands = DEFAULT_CHECKS } = {}) {
  const results = [];
  for (const check of commands) {
    let exit = -1;
    let output = "";
    try {
      if (typeof run === "function") {
        const res = run(check.command, { cwd: root ?? process.cwd() });
        if (typeof res === "string") {
          output = res;
          exit = 0;
        } else {
          exit = res?.exit ?? -1;
          output = res?.output ?? res?.stdout ?? "";
        }
      } else {
        output = execSync(check.command, {
          cwd: root ?? process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        exit = 0;
      }
    } catch (error) {
      exit = error?.status ?? -1;
      output = error?.stdout
        ? String(error.stdout)
        : (error?.stderr ?? error?.message ?? "");
    }
    results.push({
      name: check.name,
      command: check.command,
      status: exit === 0 ? "passed" : "failed",
      exit,
      tail: tailOf(output),
    });
  }
  return {
    checks: results,
    passed: results.every((c) => c.status === "passed"),
    failed: results.filter((c) => c.status !== "passed"),
  };
}
