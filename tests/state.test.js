import { test, expect } from "bun:test";
import { AgentState, State, Status } from "../core/state.js";

/**
 * A frozen clock. The core takes one so the report line's `%H:%M:%S` is a fact
 * about the test, not about when the test ran.
 * @param {string} iso
 */
function clockAt(iso) {
  let at = new Date(iso);
  return {
    now: () => at,
    /** @param {string} next */
    move(next) {
      at = new Date(next);
    },
  };
}

test("six statuses, and their values are the strings a report prints", () => {
  expect(Object.values(Status)).toEqual([
    "starting",
    "idle",
    "working",
    "waiting",
    "failed",
    "closed",
  ]);
});

test("register starts an agent at starting with no turns", () => {
  const state = new State(clockAt("2026-08-26T09:05:00"));
  state.register("alice", "worker-1", true);
  const row = state.get("alice");
  expect(row?.status).toBe(Status.STARTING);
  expect(row?.turns).toBe(0);
  expect(row?.thread).toBe("worker-1");
  expect(row?.builtin).toBe(true);
});

test("get of an unknown agent is null, not a throw", () => {
  const state = new State(clockAt("2026-08-26T09:05:00"));
  expect(state.get("nobody")).toBeNull();
});

test("set counts a turn each time the agent enters working, and only then", () => {
  const state = new State(clockAt("2026-08-26T09:05:00"));
  state.register("alice");
  state.set("alice", Status.WORKING);
  expect(state.get("alice")?.turns).toBe(1);
  state.set("alice", Status.WAITING);
  expect(state.get("alice")?.turns).toBe(1);
  state.set("alice", Status.WORKING);
  state.set("alice", Status.WORKING);
  expect(state.get("alice")?.turns).toBe(3);
  state.set("alice", Status.CLOSED);
  expect(state.get("alice")?.turns).toBe(3);
});

test("set keeps thread and builtin, and replaces status, detail and since", () => {
  const clock = clockAt("2026-08-26T09:05:00");
  const state = new State(clock);
  state.register("alice", "worker-1", true);
  clock.move("2026-08-26T10:15:30");
  state.set("alice", Status.FAILED, "boom");
  const row = state.get("alice");
  expect(row?.thread).toBe("worker-1");
  expect(row?.builtin).toBe(true);
  expect(row?.status).toBe(Status.FAILED);
  expect(row?.detail).toBe("boom");
  expect(row?.since.getHours()).toBe(10);
});

test("set on an unregistered name creates the row", () => {
  const state = new State(clockAt("2026-08-26T09:05:00"));
  state.set("ghost", Status.WORKING);
  expect(state.get("ghost")?.turns).toBe(1);
  expect(state.get("ghost")?.builtin).toBe(false);
});

test("a row is frozen, so a snapshot cannot change under its reader", () => {
  const state = new State(clockAt("2026-08-26T09:05:00"));
  state.register("alice");
  const [row] = state.snapshot();
  expect(Object.isFrozen(row)).toBe(true);
  state.set("alice", Status.WORKING);
  expect(row.status).toBe(Status.STARTING);
  expect(row.turns).toBe(0);
});

test("snapshot is sorted by name", () => {
  const state = new State(clockAt("2026-08-26T09:05:00"));
  state.register("zoe");
  state.register("alice");
  state.register("Bob");
  expect(state.snapshot().map((row) => row.name)).toEqual(["Bob", "alice", "zoe"]);
});

test("the report line format, with and without a detail", () => {
  const state = new State(clockAt("2026-08-26T09:05:07"));
  state.register("alice", "worker-1", true);
  state.set("alice", Status.WORKING);
  state.register("bob");
  state.set("bob", Status.FAILED, "no model");
  expect(state.report()).toBe(
    "alice [builtin]: working (1 turns, since 09:05:07)\n" +
      "bob [agents]: failed (0 turns, since 09:05:07) — no model",
  );
});

test("an empty table reports that it is empty", () => {
  const state = new State(clockAt("2026-08-26T09:05:00"));
  expect(state.report()).toBe("no agents loaded");
  state.register("alice");
  state.clear();
  expect(state.report()).toBe("no agents loaded");
});

test("a clock that answers with a timestamp works the same as one with a Date", () => {
  const at = new Date("2026-08-26T09:05:07");
  const state = new State({ now: () => at.getTime() });
  state.register("alice");
  expect(state.report()).toBe("alice [agents]: starting (0 turns, since 09:05:07)");
});

test("AgentState renders itself when interpolated", () => {
  const row = new AgentState({ name: "alice", since: new Date("2026-08-26T09:05:07") });
  expect(`${row}`).toBe("alice [agents]: starting (0 turns, since 09:05:07)");
});
