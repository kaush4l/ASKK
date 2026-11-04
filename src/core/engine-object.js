// Engine object — the LIVE OBJECT, and the ONLY one.
//
// GOVERNING ARCHITECTURE (correction 2026-11-04): there is one
// engine object per location in the server process, and the UI
// is its twin/view — not a second copy. Backend state and UI
// state are the same object, seen through different views:
//
//   engine = {
//     desk,        // createDesk() result (config, inferences)
//     agent,       // desk.agent (the desk's agent twin)
//     state,       // the live-state object (live-state.js) —
//                  // the SAME reference getEngineObject returns
//     live,        // alias of state
//     elements,    // ordered template (template-order.js), insert order
//     tools,       // desk tool specs, refreshed with elements
//     artifacts,   // desk artifacts
//     goal,        // current goal artifact (or null)
//     history,     // live.history — the same array, not a copy
//     skills,      // desk skills (or [])
//     signal,      // state-based signal over live.snapshot()
//   }
//
// Canonical singleton: getEngineObject(location) returns the
// SAME object for every call in the same process (module-level
// cache, keyed by location). live-state.js is NOT a competing
// singleton: it is the state container the engine object owns
// (createLiveState, one id "engine" per location). server-desk.js
// is NOT a second singleton either: it is a thin redirect to
// getEngineObject (see that file). There is exactly one cache,
// here.
//
// Elements: engine.elementsList() is the ordered template's
// list; engine.renderPrompt() renders it in insertion order
// (default = soul -> YOU ARE -> TOOLS -> artifacts -> REQUEST
// -> OWNER GUIDANCE -> EARLIER RUNS -> WORK DONE -> RESPONSE,
// plus goal/skills as properties, not prompt segments). The chat
// path (askEngine, below) and the loop path (harness.js) both
// call engine.renderPrompt() — what the model reads IS what the
// UI shows, rendered from this same object. That closes the
// "what tools do you have" bug: the card showed Tools, but the
// old chat sent only instructions + history, so the model
// answered generically and denied connected tools. The prompt
// now contains the engine's actual tools element.
//
// Signals: engine.signal holds live.snapshot(), refreshed on
// every live event AND on every engine mutation method, with a
// JSON equality so an identical snapshot never double-notifies.
// engine.subscribe(fn) is the UI subscription: mutate engine
// state -> signal fires -> subscribed UI data shows exactly the
// new state, with no API refetch and no manual sync step.
// Mutations MUST go through the engine methods (mutate,
// setAgent, setGoal, addCall, ...) — direct writes to
// engine.state bypass the signal, by design of live-state.js.
//
// Honest boundary (no server push is claimed): the signal chain
// is in-process. Across HTTP, the client holds a signal fed by
// route responses (/api/engine-object returns THIS object's
// current state/elements on every call — never a per-request
// fresh desk, never a cached stale copy) and by the existing
// client live-event bus. There is no SSE/WebSocket push yet:
// the next route call returns the same object's current state.

import { createDesk, publicDesk } from "./desk.js";
import {
  artifactElement,
  earlierRunsElement,
  instructionsElement,
  ownerGuidanceElement,
  requestElement,
  responseElement,
  soulElement,
  toolsElement,
  workDoneElement,
} from "./elements.js";
import {
  artifactCallComplete,
  assertArtifactCallComplete,
  runLifecycle,
  runLifecycleSequence,
  toolElementKind,
} from "./lifecycles.js";
import {
  clearLiveStates,
  createLiveState,
  LIVE_STATE_EVENT_TYPES,
} from "./live-state.js";
import { createGuidanceChannel } from "./loop.js";
import { createSignal } from "./signals.js";
import {
  createTemplate,
  DEFAULT_TEMPLATE_ORDER,
  defaultTemplate,
} from "./template-order.js";

const engineCache = new Map();

export function resetEngineObjects() {
  engineCache.clear();
  clearLiveStates();
}

function artifactStateOf(desk) {
  try {
    const artifact = desk?.artifacts?.[0] ?? desk?.liveArtifact ?? null;
    if (artifact && typeof artifact.state === "function") {
      return artifact.state();
    }
  } catch {
    // An artifact that cannot report state renders as empty, never fake.
  }
  return null;
}

function toolSpecsOf(desk) {
  try {
    if (typeof desk?.listTools === "function") {
      return desk.listTools();
    }
  } catch {
    // Fall through to the raw tool list.
  }
  return (desk?.tools ?? []).map((tool) =>
    typeof tool?.spec === "function" ? tool.spec() : tool,
  );
}

function asText(entry) {
  if (typeof entry === "string") {
    return entry;
  }
  try {
    return JSON.stringify(entry);
  } catch {
    return String(entry);
  }
}

export function createEngineObject(desk, opts = {}) {
  if (!desk || typeof desk !== "object") {
    throw new Error("engine object needs a desk");
  }
  const live =
    opts.live ??
    createLiveState({
      location: desk.location ?? "desk",
      id: "engine",
    });
  const guidance = opts.guidance ?? createGuidanceChannel();
  const responseFormat = opts.responseFormat ?? "TOON";
  let goal = opts.goal ?? null;
  let request = opts.request ?? "";
  let customOrder = false;
  let template = null;
  // Manually set elements (soul version change, per-phase
  // instructions) survive refresh: refresh rebuilds from desk
  // data, then overrides replace their ids. Without this, a
  // setElement would be silently reverted on the next render.
  const overrides = new Map();
  const lifecycleTrace = [];

  const soulOf = () =>
    typeof desk.soul === "string" && desk.soul !== ""
      ? desk.soul
      : (desk.engine?.instructions ?? "");
  const instructionsOf = () =>
    typeof desk.engine?.instructions === "string"
      ? desk.engine.instructions
      : soulOf();

  const buildMap = () => ({
    soul: soulElement(soulOf()),
    instructions: instructionsElement(instructionsOf()),
    tools: toolsElement(toolSpecsOf(desk)),
    // The artifact element reads the LIVE artifact state first:
    // a live-artifact call updates live.artifact, and the next
    // prompt render must show that new state, not the desk's
    // load-time artifact. Desk artifact is the fallback only.
    artifact: artifactElement(live.artifact ?? artifactStateOf(desk)),
    request: requestElement(request),
    "owner-guidance": ownerGuidanceElement(guidance.peek() ?? ""),
    "earlier-runs": earlierRunsElement(live.history.slice(-20).map(asText)),
    "work-done": workDoneElement(
      (goal?.steps ?? [])
        .filter((step) => step.done)
        .map((step) => `${step.id}: ${step.text ?? ""}`),
    ),
    response: responseElement(responseFormat),
  });
  template = defaultTemplate(buildMap());

  const signal = createSignal(live.snapshot(), {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const syncSignal = () => signal.set(live.snapshot());
  // engineRef is filled after the engine literal below; the
  // subscriptions above only fire later, once it exists.
  let engineRef = null;
  // In-process signal chain: every live event refreshes the
  // signal, so loop progress (llm:/tool: events) reaches
  // subscribers without a refetch. JSON equality collapses the
  // double-set when an engine method below also syncs.
  for (const type of LIVE_STATE_EVENT_TYPES) {
    live.subscribe(type, syncSignal);
  }
  // Lifecycle wiring (no per-type switch anywhere): loop tool
  // events and agent events run the lifecycle for the element
  // kind the event belongs to (table in lifecycles.js). The
  // trace is best-effort: a lifecycle failure never breaks the
  // run it records — the completeness checks catch it instead.
  const runBestEffort = (element, event) => {
    try {
      runLifecycle(engineRef, element, event);
    } catch {
      // Best-effort only; see the trace for what did run.
    }
  };
  live.subscribe("tool:end", (detail) => {
    runBestEffort(
      { kind: toolElementKind(detail?.name) },
      { step: "record", payload: detail ?? {} },
    );
  });
  live.subscribe("agent:spawn", (detail) => {
    runBestEffort(
      { kind: "subagent" },
      { step: "spawn", payload: detail ?? {} },
    );
  });
  live.subscribe("agent:report", (detail) => {
    runBestEffort(
      { kind: "subagent" },
      { step: "report", payload: detail ?? {} },
    );
  });

  const refreshElements = () => {
    const map = buildMap();
    for (const [id, element] of overrides) {
      if (id in map) {
        map[id] = element;
      }
    }
    if (customOrder) {
      const next = template.list().map((el) => map[el.id] ?? el);
      const rebuilt = createTemplate(next);
      template = rebuilt;
    } else {
      template = defaultTemplate(map);
    }
    return template;
  };

  const engine = {
    desk,
    agent: desk.agent ?? null,
    state: live,
    live,
    lifecycleTrace,
    get goal() {
      return goal;
    },
    history: live.history,
    artifacts: desk.artifacts ?? [],
    skills: desk.skills ?? [],
    guidance,
    signal,
    get tools() {
      return toolSpecsOf(desk);
    },
    elementsList: () => {
      refreshElements();
      return template.list();
    },
    elementStrings: () => {
      refreshElements();
      const out = {};
      for (const el of template.list()) {
        out[el.id] = el.toString();
      }
      return out;
    },
    templateOrder: () => template.list().map((el) => el.id),
    defaultOrder: () => [...DEFAULT_TEMPLATE_ORDER],
    renderPrompt: () => {
      refreshElements();
      return template.render();
    },
    refreshElements,
    setElement: (element) => {
      if (element?.id) {
        overrides.set(element.id, element);
      }
      const list = template.list();
      const at = list.findIndex((el) => el?.id === element?.id);
      if (at >= 0) {
        const next = [...list];
        next[at] = element;
        template = createTemplate(next);
      } else {
        template.insert(element);
      }
      return engine;
    },
    insertElement: (element) => {
      customOrder = true;
      template.insert(element);
      return engine;
    },
    moveElement: (id, index) => {
      customOrder = true;
      template.move(id, index);
      return engine;
    },
    removeElement: (id) => {
      overrides.delete(id);
      return template.remove(id);
    },
    setRequest: (text) => {
      request = typeof text === "string" ? text : "";
      return engine;
    },
    setGoal: (nextGoal) => {
      goal = nextGoal ?? null;
      if (goal) {
        try {
          live.setGoal(goal.id, goal.snapshot());
        } catch {
          // A goal without a snapshot still becomes engine.goal.
        }
      }
      syncSignal();
      return engine;
    },
    guide: (text) => guidance.guide(text),
    takeGuidance: () => guidance.take(),
    subscribe: (fn) => signal.subscribe(fn),
    snapshot: () => live.snapshot(),
    mutate: (fn) => {
      if (typeof fn !== "function") {
        throw new Error("engine mutate needs a function");
      }
      fn(live);
      syncSignal();
      return live;
    },
    setAgent: (name, agent) => {
      const out = live.setAgent(name, agent);
      syncSignal();
      return out;
    },
    setActivity: (activity) => {
      const out = live.setActivity(activity);
      syncSignal();
      return out;
    },
    addCall: (call) => {
      const out = live.addCall(call);
      syncSignal();
      return out;
    },
    updateCall: (id, patch) => {
      const out = live.updateCall(id, patch);
      syncSignal();
      return out;
    },
    appendHistory: (entry) => {
      const out = live.appendHistory(entry);
      syncSignal();
      return out;
    },
    recordPhaseTransition: (transition) => {
      const out = live.recordPhaseTransition(transition);
      syncSignal();
      // Goal lifecycle: a phase transition IS the goal's
      // plan/execute/critique step. Best-effort: the transition
      // itself is already recorded above.
      if (["plan", "execute", "critique"].includes(transition?.to)) {
        try {
          runLifecycle(engine, { kind: "goal" }, { step: transition.to });
        } catch {
          // Best-effort only.
        }
      }
      return out;
    },
    twin: () => ({
      agent: engine.agent?.name ?? engine.agent?.id ?? null,
      state: live.snapshot(),
      elementStrings: engine.elementStrings(),
      tools: toolSpecsOf(desk).map((t) => t?.name ?? t),
      goal: goal ? goal.snapshot() : null,
    }),
    // Lifecycles, run by the engine from configuration
    // (lifecycles.js) — never a switch() on element type here.
    runLifecycle: (element, event) => runLifecycle(engine, element, event),
    runLifecycleSequence: (element, opts) =>
      runLifecycleSequence(engine, element, opts),
    // Live-artifact call driver: runs the full lifecycle and
    // returns the completeness report. A call that only returns
    // a value scores complete=false — see artifactCallComplete.
    applyArtifactCall: ({ path, action = "open" } = {}) => {
      if (typeof path !== "string" || path.trim() === "") {
        throw new Error("applyArtifactCall needs a file path");
      }
      let signalFired = false;
      const off = signal.subscribe(() => {
        signalFired = true;
      });
      const before = {
        artifact: JSON.parse(JSON.stringify(live.artifact ?? null)),
        artifactElement: engine.elementStrings().artifact ?? null,
        prompt: engine.renderPrompt(),
        historyLength: live.history.length,
        signalFired: false,
      };
      runLifecycleSequence(
        engine,
        { kind: "live-artifact" },
        {
          payload: { path, action },
        },
      );
      syncSignal();
      off();
      const after = {
        artifact: JSON.parse(JSON.stringify(live.artifact ?? null)),
        artifactElement: engine.elementStrings().artifact ?? null,
        prompt: engine.renderPrompt(),
        historyLength: live.history.length,
        signalFired,
      };
      return artifactCallComplete(before, after);
    },
    assertArtifactCallComplete: (report) => assertArtifactCallComplete(report),
  };
  engineRef = engine;
  return engine;
}

// The chat path through the engine object: the prompt IS
// engine.renderPrompt() — the same ordered elements the UI
// shows — followed by the caller's messages. The model therefore
// reads the engine's actual tools, soul, instructions, artifact,
// request, guidance, earlier runs, work done, and response
// format. Returns { reply, prompt, messages } so tests can
// capture the exact prompt sent.
export async function askEngine(engine, { inference, messages } = {}) {
  if (!engine || typeof engine.renderPrompt !== "function") {
    throw new Error("askEngine needs an engine object");
  }
  const resolved =
    inference ??
    engine.desk?.defaultInference ??
    engine.desk?.engine?.inference ??
    null;
  if (!resolved || typeof resolved.infer !== "function") {
    throw new Error(
      "no model configured: add a default inference to personal/model.json, or pass an inference to askEngine()",
    );
  }
  const prompt = engine.renderPrompt();
  const history = Array.isArray(messages) ? messages : [];
  const sent = [{ role: "system", content: prompt }, ...history];
  const reply = await resolved.infer(sent);
  return { reply, prompt, messages: sent };
}

export function getEngineObject(location = "personal", opts = {}) {
  const key = opts.desk?.location
    ? String(opts.desk.location)
    : String(location);
  if (engineCache.has(key)) {
    return engineCache.get(key);
  }
  const desk = opts.desk ?? createDesk(location);
  const engine = createEngineObject(desk, opts);
  engineCache.set(key, engine);
  if (desk.location && String(desk.location) !== key) {
    engineCache.set(String(desk.location), engine);
  }
  return engine;
}

export function publicEngineObject(engine) {
  return {
    ...publicDesk(engine?.desk),
    twin: engine?.twin ? engine.twin() : null,
  };
}
