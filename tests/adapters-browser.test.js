/** Wave 4.5 — the browser adapters, on doubles that keep the platform's shapes.
 *
 * There is no OPFS on the host, so the directory handles are stood up here
 * with the spec's method names and the spec's commit-at-close behaviour. The
 * point of the exercise is the contract `FsPort` declares — a miss is a value,
 * `list` marks directories, `replace` cannot leave the old file destroyed —
 * because that contract is the whole of what the core above it can rely on.
 */

import { test, expect } from "bun:test";
import { opfsFs } from "../core/ports/opfs-fs.js";
import { cronBrowser, fires, managedLine } from "../core/ports/cron-browser.js";
import { memoryFs, fixedClock } from "../core/ports/memory-fs.js";

// ── an OPFS double ───────────────────────────────────────────────────────

/** @returns {any} */
function fakeDirectory(name = "") {
  /** @type {Map<string, any>} */
  const children = new Map();
  const handle = {
    kind: "directory",
    name,
    /** @param {string} key @param {{create?: boolean}} [options] */
    async getDirectoryHandle(key, options = {}) {
      const found = children.get(key);
      if (found?.kind === "directory") return found;
      if (found) throw Object.assign(new Error("not a directory"), { name: "TypeMismatchError" });
      if (!options.create) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      const made = fakeDirectory(key);
      children.set(key, made);
      return made;
    },
    /** @param {string} key @param {{create?: boolean}} [options] */
    async getFileHandle(key, options = {}) {
      const found = children.get(key);
      if (found?.kind === "file") return found;
      if (found) throw Object.assign(new Error("not a file"), { name: "TypeMismatchError" });
      if (!options.create) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      const made = fakeFile(key, children);
      children.set(key, made);
      return made;
    },
    /** @param {string} key */
    async removeEntry(key) {
      if (!children.has(key)) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      children.delete(key);
    },
    async *entries() {
      for (const [key, value] of children) yield [key, value];
    },
    children,
  };
  return handle;
}

/** @param {string} name @param {Map<string, any>} siblings @returns {any} */
function fakeFile(name, siblings) {
  const file = {
    kind: "file",
    name,
    text: "",
    /** Held back until `close`, exactly as a writable stream commits. */
    async createWritable({ keepExistingData = false } = {}) {
      let buffer = keepExistingData ? file.text : "";
      return {
        /** @param {any} data */
        async write(data) {
          if (typeof data === "string") buffer = data;
          else buffer = buffer.slice(0, data.position) + data.data;
        },
        async close() {
          file.text = buffer;
        },
        async abort() {},
      };
    },
    async getFile() {
      return { size: file.text.length, async text() { return file.text; } };
    },
    siblings,
  };
  return file;
}

test("opfsFs: a miss is a value, and nothing is created by reading", async () => {
  const root = fakeDirectory();
  const fs = opfsFs({ open: async () => root });
  expect(await fs.read("a/b.txt")).toBe(null);
  expect(await fs.exists("a/b.txt")).toBe(false);
  expect(await fs.list("a")).toEqual([]);
  await fs.remove("a/b.txt");
  expect(root.children.size).toBe(0);
});

test("opfsFs: write, append, list and remove keep the FsPort contract", async () => {
  const root = fakeDirectory();
  const fs = opfsFs({ open: async () => root });
  await fs.write("skills/a.md", "one");
  await fs.append("skills/a.md", "-two");
  await fs.write("skills/a/SKILL.md", "");
  await fs.write("skills/b.md", "");
  expect(await fs.read("skills/a.md")).toBe("one-two");
  expect(await fs.list("skills")).toEqual(["a/", "a.md", "b.md"]);
  expect(await fs.exists("skills/a")).toBe(true);
  await fs.remove("skills/a");
  expect(await fs.list("skills")).toEqual(["a.md", "b.md"]);
});

test("opfsFs: replace lands the bytes and leaves no temporary behind", async () => {
  const root = fakeDirectory();
  const fs = opfsFs({ open: async () => root });
  await fs.write("space.json", "old");
  await fs.replace("space.json", "new");
  expect(await fs.read("space.json")).toBe("new");
  expect(await fs.exists("space.json.tmp")).toBe(false);
});

test("opfsFs: a replace that fails on the target leaves the old content readable", async () => {
  const root = fakeDirectory();
  const fs = opfsFs({ open: async () => root });
  await fs.write("space.json", "old");
  const target = await root.getFileHandle("space.json");
  target.createWritable = async () => ({
    async write() {},
    async close() { throw new Error("disk gave out"); },
    async abort() {},
  });
  await expect(fs.replace("space.json", "new")).rejects.toThrow("disk gave out");
  // The whole point of the temporary: what was there is still there, whole.
  expect(await fs.read("space.json")).toBe("old");
  expect(await fs.exists("space.json.tmp")).toBe(false);
});

test("opfsFs: a root confines everything written under it", async () => {
  const root = fakeDirectory();
  const fs = opfsFs({ open: async () => root, root: "harness" });
  await fs.write("a.txt", "x");
  expect([...root.children.keys()]).toEqual(["harness"]);
  expect(await fs.read("a.txt")).toBe("x");
});

// ── the browser schedule ─────────────────────────────────────────────────

const ZONE = "America/Los_Angeles";
/** @param {string} iso */
const at = (iso) => new Date(iso);

test("managedLine: a line without the marker belongs to somebody else", () => {
  expect(managedLine("0 9 * * * backup.sh")).toBe(null);
  expect(managedLine("# agent-cron:x")).toBe(null); // no schedule, no command
  expect(managedLine("30 9 * * 1-5 run 'build' # agent-cron:build")).toEqual({
    name: "build",
    schedule: "30 9 * * 1-5",
    command: "run 'build'",
  });
  expect(managedLine("@daily run 'x' # agent-cron:daily")?.schedule).toBe("@daily");
});

test("fires: fields, ranges, lists, steps and the shortcuts", () => {
  expect(fires("30 9 * * *", at("2026-08-17T09:30:00-07:00"), ZONE)).toBe(true);
  expect(fires("30 9 * * *", at("2026-08-17T09:31:00-07:00"), ZONE)).toBe(false);
  expect(fires("*/15 * * * *", at("2026-08-17T09:45:00-07:00"), ZONE)).toBe(true);
  expect(fires("0 9,17 * * *", at("2026-08-17T17:00:00-07:00"), ZONE)).toBe(true);
  expect(fires("0 9 * * 1-5", at("2026-08-16T09:00:00-07:00"), ZONE)).toBe(false); // a Sunday
  expect(fires("@daily", at("2026-08-17T00:00:00-07:00"), ZONE)).toBe(true);
  expect(fires("@reboot", at("2026-08-17T00:00:00-07:00"), ZONE)).toBe(false);
  expect(fires("nonsense", at("2026-08-17T00:00:00-07:00"), ZONE)).toBe(false);
});

test("fires: day-of-month and day-of-week are OR-ed when both are restricted", () => {
  // Cron's oldest surprise, and what every crontab on the host already does.
  expect(fires("0 0 1 * 5", at("2026-08-01T00:00:00-07:00"), ZONE)).toBe(true); // the 1st, a Saturday
  expect(fires("0 0 1 * 5", at("2026-08-07T00:00:00-07:00"), ZONE)).toBe(true); // a Friday
  expect(fires("0 0 1 * 5", at("2026-08-06T00:00:00-07:00"), ZONE)).toBe(false);
});

test("fires: the clock's zone decides, not the host's", () => {
  const noon = at("2026-08-17T12:00:00-07:00");
  expect(fires("0 12 * * *", noon, ZONE)).toBe(true);
  expect(fires("0 12 * * *", noon, "UTC")).toBe(false);
});

test("cronBrowser: lines round-trip through schedule.json", async () => {
  const fs = memoryFs();
  const cron = cronBrowser({ fs, clock: fixedClock("2026-08-17T09:00:00-07:00") });
  expect(await cron.readLines()).toEqual([]);
  await cron.writeLines(["30 9 * * * run # agent-cron:build"]);
  expect(await cron.readLines()).toEqual(["30 9 * * * run # agent-cron:build"]);
});

test("cronBrowser: a file that cannot be understood throws rather than read as empty", async () => {
  const fs = memoryFs({ files: { "agents/schedule.json": "{ not json" } });
  const cron = cronBrowser({ fs, clock: fixedClock("2026-08-17T09:00:00-07:00") });
  await expect(cron.readLines()).rejects.toBeDefined();
});

test("cronBrowser: jobs missed while the page was closed are reported, never replayed", async () => {
  const fs = memoryFs({
    files: {
      "agents/schedule.json": JSON.stringify({
        lines: ["0 * * * * run # agent-cron:hourly"],
        checked: "2026-08-17T00:00:00.000-07:00",
      }),
    },
  });
  /** @type {string[]} */
  const ran = [];
  /** @type {any[]} */
  let reported = [];
  const cron = cronBrowser({
    fs,
    clock: fixedClock("2026-08-17T11:30:00-07:00"),
    setTimer: () => 0,
    clearTimer: () => {},
  });
  await cron.start({ run: (job) => ran.push(job.name), onMissed: (missed) => (reported = missed) });
  // Eleven queued agent runs help nobody. The count is the answer.
  expect(ran).toEqual([]);
  expect(reported).toHaveLength(1);
  expect(reported[0].job.name).toBe("hourly");
  expect(reported[0].runs).toBe(11);
  expect(reported[0].since.toISOString()).toBe("2026-08-17T08:00:00.000Z");
});

test("cronBrowser: @reboot fires on start, because a page opening is this boot", async () => {
  const fs = memoryFs({
    files: { "agents/schedule.json": JSON.stringify({ lines: ["@reboot run # agent-cron:wake"], checked: "" }) },
  });
  /** @type {string[]} */
  const ran = [];
  const cron = cronBrowser({ fs, clock: fixedClock("2026-08-17T09:00:00-07:00"), setTimer: () => 0, clearTimer: () => {} });
  await cron.start({ run: (job) => ran.push(job.name) });
  expect(ran).toEqual(["wake"]);
  // The mark moves, so a second open reports nothing missed before it.
  expect(JSON.parse(String(await fs.read("agents/schedule.json"))).checked).toBe("2026-08-17T16:00:00.000Z");
});

test("cronBrowser: a tick fires the minute that just passed, re-reading the file", async () => {
  const fs = memoryFs();
  let minutes = 0;
  const clock = { now: () => new Date(Date.parse("2026-08-17T09:29:00-07:00") + minutes * 60_000), zone: () => ZONE };
  /** @type {{ fn: (() => void) | null }} */
  const timer = { fn: null };
  const cron = cronBrowser({ fs, clock, setTimer: (fn) => ((timer.fn = fn), 0), clearTimer: () => {} });
  /** @type {string[]} */
  const ran = [];
  const stop = await cron.start({ run: (job) => ran.push(job.name) });
  // Written after start: a list captured at start would never see it.
  await cron.writeLines(["30 9 * * * run # agent-cron:build"]);
  minutes = 1;
  timer.fn?.();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(ran).toEqual(["build"]);
  stop();
});
