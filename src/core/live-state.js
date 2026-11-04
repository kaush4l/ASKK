// Live state — ONE single live object per desk/agent.
//
// Singleton per location+id, extending the existing per-location
// singleton pattern (files.js, terminal.js): createLiveState() with
// the same location+id returns the same object, a different id
// returns a different one. There is no second copy that can drift:
// the dashboard card and the canvas both render from snapshot()
// of this object (see src/core/ui-data.js).
//
// snapshot() returns the exact object shape as a deep copy for
// transport; the live object itself is mutated through mutate()
// and the helpers below, never by replacing it wholesale.
// Events follow the src/lib/live-events.js vocabulary and extend
// it with goal:/agent: events (llm:start/end, tool:start/end,
// goal:phase, agent:spawn, agent:report, agent:dismiss, compaction).
// This module's bus is its own: src/lib/live-events.js validates
// against a fixed list that does not include goal:/agent: types,
// so live-state does not route through it (and does not change it).

import { deepCopy } from "./snapshot.js";

export const LIVE_STATE_EVENT_TYPES = Object.freeze([
  "llm:start",
  "llm:end",
  "llm:error",
  "tool:start",
  "tool:end",
  "tool:error",
  "goal:phase",
  "goal:complete",
  "agent:spawn",
  "agent:report",
  "agent:dismiss",
  "artifact:open",
  "artifact:expand",
  "run:success",
  "run:error",
  "run:waiting",
  "run:idle",
  "compaction",
]);

const METHOD_NAMES = new Set([
  "snapshot",
  "mutate",
  "emit",
  "subscribe",
  "setActivity",
  "addCall",
  "updateCall",
  "setAgent",
  "setGoal",
  "appendHistory",
  "recordPhaseTransition",
]);

const registry = new Map();

export function clearLiveStates() {
  registry.clear();
}

export function createLiveState({
  location = "desk",
  id = "default",
  initial = {},
} = {}) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("live state needs an id");
  }
  const key = `${location}::${id}`;
  if (registry.has(key)) {
    return registry.get(key);
  }
  const listeners = new Map();
  const state = {
    id,
    location,
    activity: "idle",
    agents: {},
    goals: {},
    calls: [],
    events: [],
    history: [],
    tools: [],
    phases: [],
    phaseTransitions: [],
    artifact: null,
    ...deepCopy(initial),
  };
  state.snapshot = () => {
    const out = {};
    for (const [k, v] of Object.entries(state)) {
      if (!METHOD_NAMES.has(k)) {
        out[k] = deepCopy(v);
      }
    }
    return out;
  };
  state.mutate = (fn) => {
    if (typeof fn !== "function") {
      throw new Error("live state mutate needs a function");
    }
    fn(state);
    return state;
  };
  state.subscribe = (type, handler) => {
    if (!LIVE_STATE_EVENT_TYPES.includes(type)) {
      throw new Error(`unknown live event: ${type}`);
    }
    if (!listeners.has(type)) {
      listeners.set(type, new Set());
    }
    listeners.get(type).add(handler);
    return () => listeners.get(type)?.delete(handler);
  };
  state.emit = (type, detail = {}) => {
    if (!LIVE_STATE_EVENT_TYPES.includes(type)) {
      throw new Error(`unknown live event: ${type}`);
    }
    const event = { type, detail, at: new Date().toISOString() };
    state.events.push(event);
    for (const fn of listeners.get(type) ?? []) {
      fn(event.detail, event);
    }
    return event;
  };
  state.setActivity = (activity) => {
    state.activity = activity;
    return state;
  };
  state.addCall = (call) => {
    const entry = {
      id: call?.id ?? `call-${state.calls.length + 1}`,
      name: call?.name ?? "",
      status: call?.status ?? "running",
      partial: Boolean(call?.partial),
      parallelGroup: call?.parallelGroup ?? null,
      startedAt: call?.startedAt ?? Date.now(),
      endedAt: call?.endedAt ?? null,
      ...(call?.input !== undefined ? { input: deepCopy(call.input) } : {}),
    };
    state.calls.push(entry);
    return entry;
  };
  state.updateCall = (id, patch) => {
    const entry = state.calls.find((c) => c.id === id);
    if (!entry) {
      throw new Error(`live state has no call ${id}`);
    }
    Object.assign(entry, patch);
    return entry;
  };
  state.setAgent = (name, agent) => {
    state.agents[name] = deepCopy(agent ?? { name });
    return state.agents[name];
  };
  state.setGoal = (goalId, goal) => {
    state.goals[goalId] = deepCopy(goal ?? { id: goalId });
    return state.goals[goalId];
  };
  state.appendHistory = (entry) => {
    state.history.push(typeof entry === "string" ? entry : deepCopy(entry));
    return state.history.length;
  };
  state.recordPhaseTransition = ({ goal, from, to }) => {
    const transition = {
      goal: goal ?? null,
      from: from ?? null,
      to,
      at: new Date().toISOString(),
    };
    state.phaseTransitions.push(transition);
    state.emit("goal:phase", transition);
    return transition;
  };
  registry.set(key, state);
  return state;
}
