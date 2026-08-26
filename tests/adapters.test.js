/** Wave 4.5 — the real adapters.
 *
 * The host filesystem and the host crontab are exercised against the real
 * things, in a temporary directory and against a fake `crontab` binary: an
 * adapter tested only through a double proves nothing about the platform it
 * exists to reach. OPFS has no host implementation, so it is driven through a
 * handle double that keeps the spec's shapes.
 */

import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunFs } from "../core/ports/bun-fs.js";
import { cronHost } from "../core/ports/cron-host.js";

/** @returns {Promise<string>} */
async function scratch() {
  return await mkdtemp(join(tmpdir(), "harness-test-"));
}

// ── the host filesystem ──────────────────────────────────────────────────

test("bunFs: a miss is a value, not a throw", async () => {
  const root = await scratch();
  const fs = bunFs(root);
  expect(await fs.read("nothing.txt")).toBe(null);
  expect(await fs.exists("nothing.txt")).toBe(false);
  expect(await fs.list("no/such/dir")).toEqual([]);
  await fs.remove("nothing.txt"); // not an error
  await rm(root, { recursive: true, force: true });
});

test("bunFs: write creates parents, append adds, replace swaps", async () => {
  const root = await scratch();
  const fs = bunFs(root);
  await fs.write("a/b/c.txt", "one");
  expect(await fs.read("a/b/c.txt")).toBe("one");
  await fs.append("a/b/c.txt", "-two");
  expect(await fs.read("a/b/c.txt")).toBe("one-two");
  await fs.replace("a/b/c.txt", "three");
  expect(await fs.read("a/b/c.txt")).toBe("three");
  // The temporary does not survive a successful replace.
  expect(await fs.exists("a/b/c.txt.tmp")).toBe(false);
  await rm(root, { recursive: true, force: true });
});

test("bunFs: replace appends the suffix rather than substituting it (D-5)", async () => {
  const root = await scratch();
  const fs = bunFs(root);
  // The Python's `with_suffix` turned `log.txt.old` into `log.txt.tmp`, which
  // is a different file from the one it meant to guard.
  await fs.write("log.txt.old", "before");
  await fs.replace("log.txt.old", "after");
  expect(await fs.read("log.txt.old")).toBe("after");
  await rm(root, { recursive: true, force: true });
});

test("bunFs: a failed replace leaves the old file whole", async () => {
  const root = await scratch();
  const fs = bunFs(root);
  await fs.write("keep.txt", "original");
  // A directory where the temporary wants to be: the write fails, and what
  // the caller bought is that `keep.txt` is still `keep.txt`.
  await mkdir(join(root, "keep.txt.tmp"));
  await expect(fs.replace("keep.txt", "new")).rejects.toBeDefined();
  expect(await fs.read("keep.txt")).toBe("original");
  await rm(root, { recursive: true, force: true });
});

test("bunFs: list sorts on the bare name and marks directories", async () => {
  const root = await scratch();
  const fs = bunFs(root);
  await fs.write("skills/a.md", "");
  await fs.write("skills/a/SKILL.md", "");
  await fs.write("skills/b.md", "");
  // `a` before `a.md`: marking first would invert the pair, and skills.js
  // tells a folder skill from a bare one by exactly this marker.
  expect(await fs.list("skills")).toEqual(["a/", "a.md", "b.md"]);
  await rm(root, { recursive: true, force: true });
});

test("bunFs: remove takes a whole tree — fs.rmdir would have thrown on Bun 1.4", async () => {
  const root = await scratch();
  const fs = bunFs(root);
  await fs.write("tree/deep/file.txt", "x");
  await fs.remove("tree");
  expect(await fs.exists("tree")).toBe(false);
  await rm(root, { recursive: true, force: true });
});

// ── the host crontab ─────────────────────────────────────────────────────

/** A crontab binary that keeps its table in a file, so nothing here can reach
 *  the real schedule. That is what AGENT_CRONTAB is for. */
async function fakeCrontab(behaviour = "") {
  const dir = await scratch();
  const table = join(dir, "table");
  const binary = join(dir, "crontab");
  await writeFile(
    binary,
    `#!/bin/sh
case "$1" in
  -l) ${behaviour === "unreadable" ? 'echo "crontab: permission denied" >&2; exit 1' : `[ -f ${table} ] || { echo "crontab: no crontab for nobody" >&2; exit 1; }; cat ${table}`} ;;
  -)  cat > ${table} ;;
esac
`,
    "utf8",
  );
  await chmod(binary, 0o755);
  return { dir, table, env: { AGENT_CRONTAB: binary } };
}

test("cronHost: no crontab yet is no lines, not a failure", async () => {
  const { dir, env } = await fakeCrontab();
  const cron = cronHost({ spawn: hostSpawn, env });
  expect(await cron.readLines()).toEqual([]);
  await rm(dir, { recursive: true, force: true });
});

test("cronHost: lines round-trip, and other people's lines come back untouched", async () => {
  const { dir, table, env } = await fakeCrontab();
  const cron = cronHost({ spawn: hostSpawn, env });
  await cron.writeLines(["0 9 * * * somebody-elses-job", "@daily mine # agent-cron:mine"]);
  expect(await readFile(table, "utf8")).toBe("0 9 * * * somebody-elses-job\n@daily mine # agent-cron:mine\n");
  expect(await cron.readLines()).toEqual(["0 9 * * * somebody-elses-job", "@daily mine # agent-cron:mine"]);
  await rm(dir, { recursive: true, force: true });
});

test("cronHost: a read that fails throws, so the caller never writes over what it could not see", async () => {
  const { dir, env } = await fakeCrontab("unreadable");
  const cron = cronHost({ spawn: hostSpawn, env });
  await expect(cron.readLines()).rejects.toThrow("permission denied");
  await rm(dir, { recursive: true, force: true });
});

test("cronHost: an empty table writes an empty file, not a blank line", async () => {
  const { dir, table, env } = await fakeCrontab();
  const cron = cronHost({ spawn: hostSpawn, env });
  await cron.writeLines([]);
  expect(await readFile(table, "utf8")).toBe("");
  await rm(dir, { recursive: true, force: true });
});

test("cronHost: no crontab on this system is said plainly", async () => {
  const cron = cronHost({ spawn: hostSpawn, env: { PATH: "/nonexistent" } });
  await expect(cron.readLines()).rejects.toThrow("no 'crontab' command on this system");
});

/** The host spawn port. Wave 4.5 owns no adapter file for it, so the shape the
 *  ports contract declares is built here and handed in. */
/** @type {import("../core/ports.js").SpawnPort} */
async function hostSpawn(command, args, options = {}) {
  const proc = Bun.spawn([command, ...args], { stdin: new TextEncoder().encode(options.stdin ?? ""), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}
