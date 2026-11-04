// Live events — the client-side live-event bus for the combined
// view. This is the event-driven model in v1:
//
//   1. Initial snapshot on load: the page fetches /api/engine,
//      /api/tools, /api/artifact, /api/agent and /api/soul once.
//   2. Then events, not refetches: the chat flow emits events on
//      this bus (llm:start, llm:end, llm:error, artifact:open,
//      artifact:expand, run:success, run:error, run:waiting,
//      run:idle) and the combined view subscribes — face, glow,
//      status, stats and feed update IMMEDIATELY on the event,
//      with no manual refresh and no refetch after a reply.
//
// What is NOT yet here: a server SSE stream. That is a later step.
// Do not claim SSE for this bus: it is an in-page EventTarget,
// with no new dependency, and it carries no server state — the
// snapshot is still fetched once on load, and recovery after a
// full page reload is that same snapshot, not a replayed stream.
//
//   emitLiveEvent("llm:start", { detail: "…" })
//   const off = subscribeLiveEvent("llm:start", (event) => …)
//   off() // unsubscribe
//   mapEventToState("llm:start")
//     -> { phase, face, glow, status }
//     // phase: idle | llm | tool | waiting | error | success
//     // face: same vocabulary as the prototype (idle, llm, tool,
//     //   waiting, error, success); glow: grey | sky | violet |
//     //   amber | red | emerald — the shared colour system,
//     //   unchanged (LLM sky, tool violet, success emerald,
//     //   error red, waiting amber, idle grey, running emerald
//     //   pulse). No new colour is added here.

// Milestone 2: extended with the engine signal types. The
// server-side live-state bus (src/core/live-state.js) already
// carried goal:/agent: events, but this client bus validated
// against a fixed list without them — so a goal:/agent: event
// emitted on this bus was refused as "unknown" and dropped.
// That gap is closed here: the bus now accepts every engine
// signal type (llm:, tool:, goal:, agent:, artifact:, run:,
// compaction), with a state mapping for each. Canonical bus
// for the live-agent section is still the state-based signal
// (src/lib/signals.js, fed by /api/engine-object); this bus is
// kept for the legacy chat flow only, and now forwards
// goal:/agent: events to a route refetch (page.js) instead of
// dropping them. No SSE/WebSocket is claimed for either bus.
export const LIVE_EVENT_TYPES = Object.freeze([
  "llm:start",
  "llm:end",
  "llm:error",
  "artifact:open",
  "artifact:expand",
  "run:success",
  "run:error",
  "run:waiting",
  "run:idle",
  "tool:start",
  "tool:end",
  "tool:error",
  "goal:phase",
  "goal:complete",
  "agent:spawn",
  "agent:report",
  "agent:dismiss",
  "compaction",
]);

const EVENT_STATE = Object.freeze({
  "llm:start": {
    phase: "llm",
    face: "llm",
    glow: "sky",
    status: "Calling LLM…",
  },
  "llm:end": {
    phase: "idle",
    face: "idle",
    glow: "grey",
    status: "Idle — ready when you are.",
  },
  "llm:error": {
    phase: "error",
    face: "error",
    glow: "red",
    status: "Error — LLM call failed.",
  },
  "artifact:open": {
    phase: "tool",
    face: "tool",
    glow: "violet",
    status: "Calling tool files.open…",
  },
  "artifact:expand": {
    phase: "tool",
    face: "tool",
    glow: "violet",
    status: "Artifact expanded.",
  },
  "run:success": {
    phase: "success",
    face: "success",
    glow: "emerald",
    status: "Success — run complete.",
  },
  "run:error": {
    phase: "error",
    face: "error",
    glow: "red",
    status: "Error — run failed, recovering…",
  },
  "run:waiting": {
    phase: "waiting",
    face: "waiting",
    glow: "amber",
    status: "Waiting for a reply…",
  },
  "run:idle": {
    phase: "idle",
    face: "idle",
    glow: "grey",
    status: "Idle — ready when you are.",
  },
  "tool:start": {
    phase: "tool",
    face: "tool",
    glow: "violet",
    status: "Calling tool…",
  },
  "tool:end": {
    phase: "tool",
    face: "tool",
    glow: "violet",
    status: "Tool call finished.",
  },
  "tool:error": {
    phase: "error",
    face: "error",
    glow: "red",
    status: "Error — tool call failed.",
  },
  "goal:phase": {
    phase: "tool",
    face: "tool",
    glow: "violet",
    status: "Goal phase changed.",
  },
  "goal:complete": {
    phase: "success",
    face: "success",
    glow: "emerald",
    status: "Success — goal complete.",
  },
  "agent:spawn": {
    phase: "tool",
    face: "tool",
    glow: "violet",
    status: "Agent spawned.",
  },
  "agent:report": {
    phase: "success",
    face: "success",
    glow: "emerald",
    status: "Agent reported back.",
  },
  "agent:dismiss": {
    phase: "idle",
    face: "idle",
    glow: "grey",
    status: "Agent dismissed.",
  },
  compaction: {
    phase: "waiting",
    face: "waiting",
    glow: "amber",
    status: "Compacting history…",
  },
});

export function mapEventToState(type) {
  const state = EVENT_STATE[type];
  if (!state) {
    throw new Error(`unknown live event: ${type}`);
  }
  return { ...state };
}

// The bus itself. In the browser this is a plain EventTarget;
// in a non-DOM context (tests) a minimal fallback is used so the
// mapping and emit/subscribe contract can still be tested.
function createBus() {
  if (typeof EventTarget !== "undefined") {
    return new EventTarget();
  }
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) ?? []) {
        fn(event);
      }
      return true;
    },
  };
}

export const liveBus = createBus();

export function emitLiveEvent(type, detail = {}) {
  if (!LIVE_EVENT_TYPES.includes(type)) {
    throw new Error(`unknown live event: ${type}`);
  }
  const event =
    typeof CustomEvent !== "undefined"
      ? new CustomEvent(type, { detail })
      : { type, detail };
  liveBus.dispatchEvent(event);
  return mapEventToState(type);
}

export function subscribeLiveEvent(type, handler) {
  if (!LIVE_EVENT_TYPES.includes(type)) {
    throw new Error(`unknown live event: ${type}`);
  }
  const listener = (event) => handler(event.detail ?? {}, event);
  liveBus.addEventListener(type, listener);
  return () => liveBus.removeEventListener(type, listener);
}

// Subscribe to every live event type at once; returns an
// unsubscribe-all function. The handler receives (type, detail).
export function subscribeAllLiveEvents(handler) {
  const offs = LIVE_EVENT_TYPES.map((type) =>
    subscribeLiveEvent(type, (detail) => handler(type, detail)),
  );
  return () => {
    for (const off of offs) {
      off();
    }
  };
}
