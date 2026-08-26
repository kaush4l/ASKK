/** What the runtime keeps of a run, so a view that mounts after one can show it.
 *
 * `app/` is the browser half and nothing else in `tests/` reaches into it — but
 * this much of `Runtime` is plain bookkeeping over an event table, and the two
 * things that can go wrong are invisible to the browser smoke check: a buffer
 * that never empties is a leak no assertion trips over, and a cap that never
 * bites is the same leak with a number on it. So they are measured here, on the
 * host, and `scripts/smoke.js` assertions 8 and 11 prove the live and the late
 * mount in a real browser.
 *
 * `Runtime` is constructed with a ports double rather than started: `start()`
 * spawns workers and this touches none of that.
 */

import { expect, test } from "bun:test";
import { Runtime, WORKER_EVENTS } from "../app/runtime.js";
import { fixedClock, memoryFs } from "../core/ports/memory-fs.js";

/** @returns {any} */
const ports = () => ({
  fs: memoryFs(), clock: fixedClock("2026-01-01T00:00:00Z"), fetch: async () => new Response(""),
  spawnWorker: () => { throw new Error("no workers in this test"); },
  cron: { readLines: async () => [], writeLines: async () => {} },
});

/** @returns {Runtime} */
const runtime = () => new Runtime({ ports: ports() });

test("a late listener asking for a replay hears the run it missed", () => {
  const rt = runtime();
  rt.emit("turn:start", { input: "hi" });
  rt.emit("phase:enter", { phase: "react" });
  rt.emit("tool:results", { results: [{ tool: "list_cron_jobs" }] });
  rt.emit("turn:end", { answer: "there" });

  /** @type {any[]} */ const heard = [];
  rt.on("phase:enter", (p) => heard.push(p), { replay: true });
  expect(heard).toEqual([{ phase: "react" }]);
});

test("a replay is opt-in — the same subscription without it hears nothing", () => {
  const rt = runtime();
  rt.emit("turn:start", {});
  rt.emit("phase:enter", { phase: "react" });

  /** @type {any[]} */ const heard = [];
  rt.on("phase:enter", (p) => heard.push(p));
  expect(heard).toEqual([]);
});

test("a replay reaches only the listener that asked, and is not retained again", () => {
  const rt = runtime();
  rt.emit("turn:start", {});
  rt.emit("phase:enter", { phase: "react" });

  /** @type {any[]} */ const first = [];
  rt.on("phase:enter", (p) => first.push(p));
  /** @type {any[]} */ const second = [];
  rt.on("phase:enter", (p) => second.push(p), { replay: true });

  expect(first).toEqual([]);          // the earlier listener is not re-delivered to
  expect(second).toHaveLength(1);

  /** @type {any[]} */ const third = [];
  rt.on("phase:enter", (p) => third.push(p), { replay: true });
  expect(third).toHaveLength(1);      // still one arrival, not two
});

test("the next turn drops the last one — this is a run's worth, not a session's", () => {
  const rt = runtime();
  rt.emit("turn:start", {});
  rt.emit("phase:enter", { phase: "plan" });
  rt.emit("turn:start", {});
  rt.emit("phase:enter", { phase: "work" });

  /** @type {any[]} */ const heard = [];
  rt.on("phase:enter", (p) => heard.push(p), { replay: true });
  expect(heard).toEqual([{ phase: "work" }]);
});

test("a runaway run is bounded — the oldest arrivals go, the newest stay", () => {
  const rt = runtime();
  rt.emit("turn:start", {});
  for (let n = 0; n < 1000; n++) rt.emit("phase:enter", { phase: `p${n}` });

  /** @type {any[]} */ const heard = [];
  rt.on("phase:enter", (p) => heard.push(p), { replay: true });
  expect(heard.length).toBeLessThanOrEqual(200);
  expect(heard.at(-1)).toEqual({ phase: "p999" });
});

test("only what the worker reported is retained — a turn is this thread's own to know", () => {
  const rt = runtime();
  rt.emit("turn:start", {});
  for (const type of ["turn:end", "state:change", "log", "error"]) rt.emit(type, { type });

  /** @type {any[]} */ const heard = [];
  for (const type of ["turn:end", "state:change", "log", "error"]) rt.on(type, (p) => heard.push(p), { replay: true });
  expect(heard).toEqual([]);
  expect([...WORKER_EVENTS]).toEqual(["phase:enter", "prompt:assembled", "tool:results"]);
});
