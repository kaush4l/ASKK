import { test, expect } from "bun:test";

import { FLOWS, FlowError, MAX_TRANSITIONS, getFlow, validateFlow } from "../core/flows.js";

/**
 * The outcome contract, stated here because `core/phases.js` is increment 3.2
 * and lands beside this one: every phase declares `static OUTCOMES`, the set of
 * outcome names its `run` can return. These are the sets read off the Python's
 * eight `Phase.run` bodies — each `return "..."` literal, renamed to what it
 * means rather than to where it went, which is the whole of R2.
 * @type {Record<string, { OUTCOMES: readonly string[] }>}
 */
const PHASES = {
  understand: { OUTCOMES: ["simple", "complex"] },
  select_skills: { OUTCOMES: ["done"] },
  plan: { OUTCOMES: ["done"] },
  work: { OUTCOMES: ["done"] },
  verify: { OUTCOMES: ["pass", "retry", "exhausted"] },
  critique: { OUTCOMES: ["done", "retry", "exhausted"] },
  respond: { OUTCOMES: ["done"] },
  react: { OUTCOMES: ["done"] },
};

/** @param {import("../core/flows.js").Flow} flow */
const clone = (flow) => structuredClone(flow);

test("both shipped flows validate against the declared phases", () => {
  for (const [name, flow] of Object.entries(FLOWS)) {
    expect(validateFlow(flow, PHASES, name)).toBe(flow);
  }
});

test("the shipped flows walk the Python's two phase orders", () => {
  expect(walk(FLOWS.full, ["complex", "done", "done", "done", "pass", "done", "done"])).toEqual([
    "understand",
    "select_skills",
    "plan",
    "work",
    "verify",
    "critique",
    "respond",
  ]);
  expect(walk(FLOWS.full, ["simple", "done"])).toEqual(["understand", "react"]);
  expect(walk(FLOWS.react, ["done"])).toEqual(["react"]);
});

test("a retry edge sends the run back to plan, as the Python did", () => {
  expect(FLOWS.full.edges.verify?.retry).toBe("plan");
  expect(FLOWS.full.edges.critique?.retry).toBe("plan");
  expect(FLOWS.full.edges.verify?.exhausted).toBe("respond");
  expect(FLOWS.full.edges.critique?.exhausted).toBe("respond");
});

test("terminals are declared as null, not as an absent edge", () => {
  expect(FLOWS.react.edges.react?.done).toBeNull();
  expect(FLOWS.full.edges.respond?.done).toBeNull();
  expect(FLOWS.full.edges.react?.done).toBeNull();
});

test("MAX_TRANSITIONS is the Python's runaway guard, unchanged", () => {
  expect(MAX_TRANSITIONS).toBe(64);
});

test("getFlow names the flows it knows", () => {
  expect(getFlow("full")).toBe(FLOWS.full);
  expect(getFlow("react")).toBe(FLOWS.react);
  expect(() => getFlow("plan")).toThrow(new FlowError("Unknown flow 'plan'. Known: full, react"));
});

test("a dangling edge is a load error naming it", () => {
  const flow = clone(FLOWS.full);
  flow.edges.verify = { pass: "critque", retry: "plan", exhausted: "respond" };
  expect(() => validateFlow(flow, PHASES, "full")).toThrow(/edge verify --pass--> 'critque' names a phase that does not exist/);
});

test("an edge into a phase this flow left out is a load error naming it", () => {
  const flow = { entry: "react", edges: { react: { done: "respond" } } };
  expect(() => validateFlow(flow, PHASES, "react")).toThrow(
    /edge react --done--> 'respond' names a phase this flow declares no edges for/,
  );
});

test("an unreachable phase is a load error naming it", () => {
  const flow = clone(FLOWS.full);
  flow.edges.understand = { simple: "select_skills", complex: "select_skills" };
  expect(() => validateFlow(flow, PHASES, "full")).toThrow(/phase 'react' unreachable from entry 'understand'/);
});

test("an outcome with no edge is a load error naming it", () => {
  const flow = clone(FLOWS.full);
  delete flow.edges.verify?.exhausted;
  expect(() => validateFlow(flow, PHASES, "full")).toThrow(
    /phase 'verify' can return 'exhausted' and this flow declares no edge for it/,
  );
});

test("an edge for an outcome the phase never returns is a load error naming it", () => {
  const flow = clone(FLOWS.full);
  flow.edges.plan = { done: "work", retry: "plan" };
  expect(() => validateFlow(flow, PHASES, "full")).toThrow(
    /edge plan --retry--> is declared for an outcome 'plan' never returns. It returns: done/,
  );
});

test("an undeclared terminal is a load error naming the edge", () => {
  const flow = { entry: "react", edges: { react: { done: undefined } } };
  expect(() => validateFlow(/** @type {any} */ (flow), PHASES, "react")).toThrow(
    /edge react --done--> is neither a phase name nor null/,
  );
});

test("a missing entry phase and an entry with no edges are both load errors", () => {
  expect(() => validateFlow({ entry: "begin", edges: { react: { done: null } } }, PHASES, "react")).toThrow(
    /entry phase 'begin' does not exist/,
  );
  expect(() => validateFlow({ entry: "react", edges: { respond: { done: null } } }, PHASES, "x")).toThrow(
    /entry phase 'react' has no edges declared/,
  );
});

test("edges for a phase that does not exist is a load error naming it", () => {
  const flow = clone(FLOWS.react);
  flow.edges.reflect = { done: null };
  expect(() => validateFlow(flow, PHASES, "react")).toThrow(/edges declared for phase 'reflect', which does not exist/);
});

test("a bare list of phase names still catches every structural error", () => {
  const names = Object.keys(PHASES);
  expect(validateFlow(FLOWS.full, names, "full")).toBe(FLOWS.full);
  const flow = clone(FLOWS.full);
  flow.edges.work = { done: "verfy" };
  expect(() => validateFlow(flow, names, "full")).toThrow(/edge work --done--> 'verfy' names a phase that does not exist/);
});

/**
 * Walk a flow, taking the given outcome at each step. The phases the run would
 * have entered, in order.
 * @param {import("../core/flows.js").Flow} flow
 * @param {readonly string[]} outcomes
 * @returns {string[]}
 */
function walk(flow, outcomes) {
  const seen = [];
  let current = /** @type {string|null} */ (flow.entry);
  for (const outcome of outcomes) {
    if (current === null) break;
    seen.push(current);
    current = flow.edges[current]?.[outcome] ?? null;
  }
  return seen;
}
