import { test, expect } from "bun:test";
import { defaultPorts, isConfigured } from "../core/ports.js";
import { memoryFs, fixedClock } from "../core/ports/memory-fs.js";

test("every default port fails loudly, naming itself", () => {
  const ports = defaultPorts();
  expect(() => ports.fs.read("a.txt")).toThrow("no fs.read port configured");
  expect(() => ports.fs.replace("a.txt", "x")).toThrow("no fs.replace port configured");
  expect(() => ports.clock.now()).toThrow("no clock.now port configured");
  expect(() => ports.clock.zone()).toThrow("no clock.zone port configured");
  expect(() => ports.fetch("http://x")).toThrow("no fetch port configured");
  expect(() => ports.spawnWorker("w.js")).toThrow("no spawnWorker port configured");
  expect(() => ports.cron.readLines()).toThrow("no cron.readLines port configured");
});

test("a stub is not a configured port, but a real one is", () => {
  const ports = defaultPorts();
  // R5 leans on this: a truthy stub would register the `claude` kind and only
  // then explode.
  expect(isConfigured(ports.spawn)).toBe(false);
  expect(isConfigured(undefined)).toBe(false);
  expect(isConfigured(memoryFs())).toBe(true);
  expect(isConfigured(() => 1)).toBe(true);
});

test("a missing file reads as null, not a throw", async () => {
  const fs = memoryFs();
  expect(await fs.read("agents/a/log.txt")).toBeNull();
  expect(await fs.exists("agents/a/log.txt")).toBe(false);
});

test("write creates the parents, append extends, remove clears", async () => {
  const fs = memoryFs();
  await fs.write("agents/a/log.txt", "one\n");
  expect(await fs.exists("agents")).toBe(true);
  expect(await fs.exists("agents/a")).toBe(true);
  await fs.append("agents/a/log.txt", "two\n");
  expect(await fs.read("agents/a/log.txt")).toBe("one\ntwo\n");
  await fs.append("agents/a/new.txt", "fresh");
  expect(await fs.read("agents/a/new.txt")).toBe("fresh");
  await fs.remove("agents/a");
  expect(await fs.exists("agents/a/log.txt")).toBe(false);
  await fs.remove("nothing/here"); // a missing path is not an error
});

test("paths normalize, so one file has one key", async () => {
  const fs = memoryFs();
  await fs.write("./a//b/c.txt", "x");
  expect(await fs.read("a/b/c.txt")).toBe("x");
  expect(Object.keys(fs.dump())).toEqual(["a/b/c.txt"]);
});

test("list is sorted, marks directories, and gives [] for a missing one", async () => {
  const fs = memoryFs({
    files: {
      "skills/zebra.md": "z",
      "skills/alpha/SKILL.md": "a",
      "skills/alpha/ref.txt": "r",
      "skills/beta.md": "b",
      "skills/notes.txt": "n",
    },
  });
  expect(await fs.list("skills")).toEqual(["alpha/", "beta.md", "notes.txt", "zebra.md"]);
  expect(await fs.list("skills/alpha")).toEqual(["SKILL.md", "ref.txt"]);
  expect(await fs.list("skills/nope")).toEqual([]);
});

test("list sorts on the bare name, as sorted(Path.iterdir()) did", async () => {
  const fs = memoryFs({ files: { "d/a/x": "1", "d/a.md": "2" } });
  expect(await fs.list("d")).toEqual(["a/", "a.md"]);
});

test("replace swaps the whole file", async () => {
  const fs = memoryFs({ files: { "space/space.json": "old" } });
  await fs.replace("space/space.json", "new");
  expect(await fs.read("space/space.json")).toBe("new");
  expect(Object.keys(fs.dump())).toEqual(["space/space.json"]); // no temp left behind
});

test("a failed replace leaves the old content whole and readable", async () => {
  const fs = memoryFs({
    files: { "agents/a/log.txt": "the whole conversation" },
    fault: (op) => (op === "rename" ? new Error("disk full") : null),
  });
  await expect(fs.replace("agents/a/log.txt", "half a write")).rejects.toThrow("disk full");
  expect(await fs.read("agents/a/log.txt")).toBe("the whole conversation");
  expect(Object.keys(fs.dump())).toEqual(["agents/a/log.txt"]);
});

test("a replace that dies before the rename writes nothing at all", async () => {
  const fs = memoryFs({
    files: { "s.json": "old" },
    fault: (op) => (op === "write-temp" ? new Error("no room") : null),
  });
  await expect(fs.replace("s.json", "new")).rejects.toThrow("no room");
  expect(await fs.read("s.json")).toBe("old");
});

test("the fixed clock does not move, and hands out its own Date", () => {
  const clock = fixedClock("2026-08-16T12:00:00-07:00");
  expect(clock.now().toISOString()).toBe("2026-08-16T19:00:00.000Z");
  expect(clock.zone()).toBe("America/Los_Angeles");
  const first = clock.now();
  first.setFullYear(1999);
  expect(clock.now().toISOString()).toBe("2026-08-16T19:00:00.000Z");
});

test("the fixed clock renders the goldens' timestamp, but not their weekday", () => {
  const clock = fixedClock("2026-08-16T12:00:00-07:00");
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: clock.zone(),
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZoneName: "short",
  }).format(clock.now());
  expect(stamp.replace(",", "")).toBe("2026-08-16 12:00:00 PDT");
  // The goldens say Saturday beside that date. It is a Sunday; the fixture
  // hardcoded both strings. Pinned here so the parity porter is not surprised.
  const day = new Intl.DateTimeFormat("en-US", { timeZone: clock.zone(), weekday: "long" })
    .format(clock.now());
  expect(day).toBe("Sunday");
});

test("a bad date is rejected at construction", () => {
  expect(() => fixedClock("not a date")).toThrow("is not a date");
});
