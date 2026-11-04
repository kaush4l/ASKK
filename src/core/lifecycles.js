// Lifecycles — EVERY element type has a defined default
// lifecycle, and lifecycles are CONFIGURATION, not engine code.
//
// A lifecycle definition is data:
//
//   {
//     steps: ["call", "update-state", "render-view", ...],
//     onCall, onStateChange, onRender, onPersist, onStop,
//   }
//
// Each step maps to one hook phase (STEP_PHASE below); the
// engine runs the hooks, it does not switch() on element type.
// defineElementLifecycle(type, def) registers a type;
// runLifecycle(engine, element, event) runs one step;
// runLifecycleSequence(engine, element) runs all steps in
// order. If a NEW element type is added, its lifecycle comes
// with its definition and the engine runs it with no engine
// change — that is the no-hardcoding test for lifecycles.
// Removing a definition removes its lifecycle: runLifecycle
// then throws for that type, instead of falling back to an
// invented default.
//
// Canonical registry: THIS file. elements.js does not hold a
// second registry, and loop.js holds none either — the loop
// emits tool events, and the engine object (engine-object.js)
// runs lifecycles from those events. There is exactly one
// registry, here.
//
// The twelve defined lifecycles (see the table in PR.md and
// src/core/README.md — a step not in that table is not defined
// and must not be built):
//   function, live-artifact, soul, instructions, history, goal,
//   subagent, watcher, script, skill-phase, model-call, snapshot.
//
// Completeness rule for live artifacts: a live-artifact call
// that only returns a value, without updating state + view +
// prompt, is INCOMPLETE by definition. artifactCallComplete()
// is that definition as a predicate, and the engine's
// applyArtifactCall() returns (and can assert) it.

const registry = new Map();

export const STEP_PHASE = Object.freeze({
  call: "onCall",
  run: "onCall",
  load: "onCall",
  "deep-copy": "onCall",
  subscribe: "onCall",
  sequence: "onCall",
  infer: "onCall",
  "entry-gate": "onCall",
  create: "onCall",
  "report-back": "onCall",
  "update-state": "onStateChange",
  "version-change": "onStateChange",
  "phase-change": "onStateChange",
  clip: "onStateChange",
  event: "onStateChange",
  update: "onStateChange",
  quest: "onStateChange",
  plan: "onStateChange",
  execute: "onStateChange",
  critique: "onStateChange",
  "exit-gate": "onStateChange",
  "render-view": "onRender",
  "re-render-prompt": "onRender",
  render: "onRender",
  "next-step": "onRender",
  "update-meter": "onRender",
  record: "onPersist",
  return: "onPersist",
  persist: "onPersist",
  append: "onPersist",
  notify: "onPersist",
  done: "onPersist",
  handoff: "onPersist",
  "record-timings": "onPersist",
  store: "onPersist",
  report: "onPersist",
  ask: "onPersist",
  dismiss: "onPersist",
  complete: "onPersist",
  halt: "onStop",
  stop: "onStop",
});

// Tool name -> element kind, as DATA (a table, not a switch):
// artifact-affecting file tools are live-artifact calls, every
// other tool call is a function call. The engine uses this
// table to run lifecycles from loop tool events.
export const TOOL_ELEMENT_KIND = Object.freeze({
  "files.open": "live-artifact",
  "files.close": "live-artifact",
  "files.focus": "live-artifact",
  "files.write": "live-artifact",
  "files.edit": "live-artifact",
  "files.append": "live-artifact",
});

export function toolElementKind(toolName) {
  return TOOL_ELEMENT_KIND[toolName] ?? "function";
}

function history(engine, text) {
  try {
    if (engine && typeof engine.appendHistory === "function") {
      engine.appendHistory(text);
    }
  } catch {
    // Lifecycle recording never breaks the run it records.
  }
}

function refresh(engine) {
  try {
    if (engine && typeof engine.refreshElements === "function") {
      engine.refreshElements();
    }
  } catch {
    // Same: a view refresh failure is recorded nowhere silently
    // — it surfaces as a stale view, which the completeness
    // checks (artifactCallComplete) catch.
  }
}

const BUILTINS = {
  function: {
    steps: ["call", "run", "return", "record", "next-step"],
    onCall: (engine, element) =>
      history(engine, `tool call: ${element?.name ?? element?.id ?? "tool"}`),
    onPersist: (engine, element) =>
      history(
        engine,
        `tool result recorded: ${element?.name ?? element?.id ?? "tool"}`,
      ),
    onRender: (engine) => refresh(engine),
  },
  "live-artifact": {
    steps: [
      "call",
      "update-state",
      "render-view",
      "re-render-prompt",
      "record",
    ],
    onCall: (engine, _element, event) =>
      history(
        engine,
        `artifact call: ${event?.payload?.action ?? "call"} ${event?.payload?.path ?? ""}`.trim(),
      ),
    onStateChange: (engine, _element, event) => {
      const path = event?.payload?.path;
      const action = event?.payload?.action ?? "open";
      if (!path || typeof engine?.mutate !== "function") {
        return null;
      }
      engine.mutate((state) => {
        const artifact = state.artifact ?? {
          id: "default",
          open: [],
          focus: null,
          modified: [],
        };
        if (!artifact.open.includes(path)) {
          artifact.open.push(path);
        }
        artifact.focus = { path };
        if (action === "write" || action === "edit" || action === "append") {
          if (!artifact.modified.includes(path)) {
            artifact.modified.push(path);
          }
        }
        state.artifact = artifact;
      });
      return path;
    },
    onRender: (engine) => {
      refresh(engine);
      return typeof engine?.renderPrompt === "function"
        ? engine.renderPrompt()
        : null;
    },
    onPersist: (engine, _element, event) =>
      history(engine, `artifact updated: ${event?.payload?.path ?? ""}`.trim()),
  },
  soul: {
    steps: ["load", "render", "version-change"],
    onCall: () => "soul loaded once",
    onRender: (engine) => refresh(engine),
    onStateChange: (engine, _element, event) => {
      if (event?.payload?.element && typeof engine?.setElement === "function") {
        engine.setElement(event.payload.element);
      }
      return "soul version changed";
    },
  },
  instructions: {
    steps: ["load", "render", "phase-change"],
    onCall: () => "instructions loaded",
    onRender: (engine) => refresh(engine),
    onStateChange: (engine) => refresh(engine),
  },
  history: {
    steps: ["append", "clip"],
    onPersist: (engine, _element, event) => {
      if (event?.payload?.entry !== undefined) {
        history(engine, event.payload.entry);
      }
      return "history appended";
    },
    onStateChange: (engine) => history(engine, "history clipped by compaction"),
  },
  goal: {
    steps: ["create", "plan", "execute", "critique", "report-back", "complete"],
    onCall: (engine, _element, event) =>
      history(
        engine,
        `goal ${event?.step ?? "event"}: ${event?.payload?.goal?.id ?? ""}`.trim(),
      ),
    onStateChange: (engine, _element, event) =>
      history(engine, `goal phase: ${event?.step ?? ""}`),
    onPersist: (engine, _element, event) =>
      history(engine, `goal ${event?.step ?? "complete"}`),
  },
  subagent: {
    steps: ["spawn", "quest", "report", "ask", "dismiss", "update"],
    onCall: (engine, _element, event) =>
      history(engine, `agent spawned: ${event?.payload?.agent ?? ""}`.trim()),
    onStateChange: (engine, _element, event) =>
      history(
        engine,
        `agent ${event?.step ?? ""}: ${event?.payload?.agent ?? ""}`.trim(),
      ),
    onPersist: (engine, _element, event) =>
      history(
        engine,
        `agent ${event?.step ?? ""}: ${event?.payload?.agent ?? ""}`.trim(),
      ),
  },
  watcher: {
    steps: ["subscribe", "event", "notify", "halt"],
    onCall: (engine, _element, event) =>
      history(
        engine,
        `watcher subscribed: ${event?.payload?.name ?? ""}`.trim(),
      ),
    onStateChange: (engine, _element, event) =>
      history(engine, `watcher event: ${event?.payload?.name ?? ""}`.trim()),
    onPersist: (engine, _element, event) =>
      history(engine, `watcher notified: ${event?.payload?.name ?? ""}`.trim()),
    onStop: (engine, _element, event) =>
      history(engine, `watcher halted: ${event?.payload?.name ?? ""}`.trim()),
  },
  script: {
    steps: ["sequence", "done"],
    onCall: (engine, _element, event) =>
      history(engine, `script sequence: ${event?.payload?.name ?? ""}`.trim()),
    onPersist: (engine, _element, event) =>
      history(
        engine,
        `script done, notified: ${event?.payload?.name ?? ""}`.trim(),
      ),
  },
  "skill-phase": {
    steps: ["entry-gate", "run", "exit-gate", "handoff"],
    onCall: (engine, _element, event) =>
      history(
        engine,
        `skill-phase ${event?.step ?? ""}: ${event?.payload?.name ?? ""}`.trim(),
      ),
    onStateChange: (engine, _element, event) =>
      history(
        engine,
        `skill-phase ${event?.step ?? ""}: ${event?.payload?.name ?? ""}`.trim(),
      ),
    onPersist: (engine, _element, event) =>
      history(
        engine,
        `skill-phase handoff: ${event?.payload?.name ?? ""}`.trim(),
      ),
  },
  "model-call": {
    steps: ["infer", "record-timings", "update-meter"],
    onCall: (engine, _element, event) =>
      history(engine, `model call: ${event?.payload?.model ?? ""}`.trim()),
    onPersist: (engine, _element, event) =>
      history(
        engine,
        `model timings recorded: ${event?.payload?.model ?? ""}`.trim(),
      ),
    onRender: (engine) => refresh(engine),
  },
  snapshot: {
    steps: ["deep-copy", "store"],
    onCall: () => "snapshot deep-copied at transition",
    onPersist: (engine, _element, event) =>
      history(engine, `snapshot stored: ${event?.payload?.id ?? ""}`.trim()),
  },
};

for (const [type, def] of Object.entries(BUILTINS)) {
  registry.set(type, { type, ...def });
}

export function defineElementLifecycle(type, def = {}) {
  if (typeof type !== "string" || type.trim() === "") {
    throw new Error("lifecycle needs an element type");
  }
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    throw new Error(`lifecycle ${type} needs a non-empty steps list`);
  }
  for (const step of def.steps) {
    if (!(step in STEP_PHASE)) {
      throw new Error(`lifecycle ${type} has an unknown step ${step}`);
    }
  }
  const entry = { type, steps: [...def.steps], ...def };
  registry.set(type, entry);
  return entry;
}

export function removeElementLifecycle(type) {
  return registry.delete(type);
}

export function getElementLifecycle(type) {
  return registry.get(type) ?? null;
}

export function listElementLifecycles() {
  return [...registry.keys()].sort();
}

function kindOf(element) {
  if (typeof element === "string") {
    return element;
  }
  return element?.kind ?? element?.type ?? element?.id ?? null;
}

export function runLifecycle(engine, element, event = {}) {
  const type = kindOf(element);
  const lifecycle = type ? registry.get(type) : null;
  if (!lifecycle) {
    throw new Error(`no lifecycle for element type ${type ?? "unknown"}`);
  }
  const step = typeof event === "string" ? event : event?.step;
  if (!step || !lifecycle.steps.includes(step)) {
    throw new Error(`lifecycle ${type} has no step ${step ?? "undefined"}`);
  }
  const phase = STEP_PHASE[step];
  const hook = lifecycle[phase];
  const eventObj = typeof event === "string" ? { step } : { ...event, step };
  let result = null;
  let ran = false;
  if (typeof hook === "function") {
    result = hook(engine, element, eventObj);
    ran = true;
  }
  if (engine && Array.isArray(engine.lifecycleTrace)) {
    engine.lifecycleTrace.push({
      type,
      step,
      at: new Date().toISOString(),
    });
  }
  return { type, step, ran, result };
}

export function runLifecycleSequence(engine, element, opts = {}) {
  const type = kindOf(element);
  const lifecycle = type ? registry.get(type) : null;
  if (!lifecycle) {
    throw new Error(`no lifecycle for element type ${type ?? "unknown"}`);
  }
  const sequence = Array.isArray(opts) ? opts : (opts.steps ?? lifecycle.steps);
  const payload = Array.isArray(opts) ? null : (opts.payload ?? null);
  return sequence.map((step) =>
    runLifecycle(engine, element, { step, payload }),
  );
}

// Completeness predicate for a live-artifact call: state, view,
// prompt, and record must ALL have changed. A call that only
// returns a value fails every clause and is incomplete.
export function artifactCallComplete(before, after) {
  const stateChanged =
    JSON.stringify(before?.artifact ?? null) !==
    JSON.stringify(after?.artifact ?? null);
  const viewChanged =
    (before?.artifactElement ?? null) !== (after?.artifactElement ?? null);
  const promptChanged = (before?.prompt ?? null) !== (after?.prompt ?? null);
  const recorded = (after?.historyLength ?? 0) > (before?.historyLength ?? 0);
  const complete = stateChanged && viewChanged && promptChanged && recorded;
  return {
    stateChanged,
    viewChanged,
    promptChanged,
    recorded,
    signalFired: Boolean(after?.signalFired),
    complete: complete && Boolean(after?.signalFired),
  };
}

export function assertArtifactCallComplete(report) {
  if (!report?.complete) {
    throw new Error(
      `incomplete live artifact call: state=${report?.stateChanged} view=${report?.viewChanged} prompt=${report?.promptChanged} recorded=${report?.recorded} signal=${report?.signalFired}`,
    );
  }
  return report;
}
