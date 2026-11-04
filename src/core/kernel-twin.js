// Kernel twin registry — Slice A (KERNEL-TWIN-SHIFT.md).
//
// DOUBTS (recorded, not guessed — for Kaushal / later slices):
//   D1. Push transport across HTTP is UNDECIDED. Twins here are
//       in-process only: kernel emits -> twin listeners fire ->
//       snapshot() re-reads the kernel at call time. No SSE /
//       WebSocket push is claimed, and no twin is fetched over a
//       route. A later slice must name the transport before any
//       cross-process twin is promised.
//   D2. Twin persistence format is NOT defined here, by design:
//       twins are never persisted separately. Persistence belongs
//       to the kernel (personal memory files). If a later slice
//       wants a twin cache, it must be derived from kernel files
//       on load, never a second stored copy.
//   D3. Desk-kept agents on dismiss: registry.dismiss() with
//       keep "desk" KEEPS the twin (the agent persists, it is not
//       dismissed — dismiss returns kept:true). Only run agents
//       dismissed (removed:true) lose their twin. If Kaushal
//       wants kept agents twin-less in-process until reload, that
//       is a one-line change in spawn.js, not a registry change.
//   D4. Registry key is kind:id, while twin.id is the kernel id
//       alone. An engine named "developer" and an agent named
//       "developer" therefore hold different registry entries but
//       the same twin.id. getTwin(id) without a kind returns the
//       entry only when it is unambiguous, and throws when two
//       kinds share the id. Later slices must pass kind when
//       both an engine and an agent of one name can coexist.
//
// The rules (from KERNEL-TWIN-SHIFT.md), as implemented here:
//   1. Creation creates the twin in the same call, same id.
//      No object without a twin: assertTwinExists() throws for
//      any kernel object that was never registered.
//   2. The twin is the UI counterpart, NOT a copy. snapshot()
//      reads the kernel object's fields AT CALL TIME (strings
//      are dotted paths on the kernel, functions receive the
//      kernel). Nothing is cached, so a kernel update + event
//      is visible in the next snapshot() with no refetch and no
//      new kernel object.
//   3. Lifecycle is shared. States: created -> initialized ->
//      idle -> running/working/planning/executing/critiquing/
//      reporting -> waiting -> done | needs-review | halted |
//      dismissed. transitionTo() throws on an illegal step.
//      dismiss()/removeTwin() are terminal operations: they
//      force the lifecycle to "dismissed" and drop the registry
//      entry (a done object can still be dismissed; it cannot
//      transitionTo("dismissed") from a terminal state).
//   4. Updates are events, not refetches. subscribe(event, fn)
//      / emit(event, detail) are in-process only (see D1).
//      subscribe("*", fn) hears every event. Listeners receive
//      (detail, event) and re-read snapshot() themselves; the
//      twin never pushes a stale copy.
//   5. Persistence belongs to the kernel, not the twin (see D2).
//      On restart, loading kernel state re-creates the object,
//      and that re-creation re-creates its twin. Re-registering
//      the same kind:id replaces the old twin (restart /
//      supersede semantics) instead of throwing a duplicate.
//   6. Expansion = one twin definition per kind, imported from
//      here by later slices:
//
//        defineTwinDefinition({
//          kind: "goal",                       // required
//          snapshotFields: ["name", ...],     // strings = dotted
//          //   kernel paths; functions = (kernel) => value
//          lifecycle: ["created", ...],        // optional note
//          events: ["goal:phase", ...],        // canonical list;
//          //   the bus itself stays open: emit() does not throw
//          //   for an unlisted event, so a slice can add an
//          //   event without a registry change.
//          render: (snapshot) => ...,           // optional, UI use
//        })
//
//      Later slices (B goal, C tool/artifact, D script/watcher/
//      skill, E model/infer/response/machine-state/history)
//      should import: defineTwinDefinition, registerTwinDefinition,
//      getTwinDefinition, createTwinFor, getTwin, listTwins,
//      assertTwinExists, hasTwin, removeTwin, and the two
//      predefined definitions below. They must NOT re-implement
//      a registry, a lifecycle table, or a snapshot copy.
//
// Engine/agent compat notes (step-1 contract preserved):
//   - The engine twin is CALLABLE: engine.twin() returns
//     engine.twin.snapshot(), exactly as step 1's plain twin()
//     method did. engine.twin.snapshot(), .subscribe, .emit,
//     .transitionTo, .id, .kind, .lifecycle all live on that
//     same function object, so no existing engine-by-name test
//     changes shape.
//   - The engine snapshot keeps step-1 legacy fields (tools,
//     liveState, role, goal, keep, missingTools) alongside the
//     twin fields (name, instructionsSource, toolNames,
//     liveStateFound, activity), so the old twin test still
//     passes against a LIVE snapshot instead of a captured one.
//   - Soul is still NOT loaded by the name engine and is not a
//     twin field here; the desk injects soul later (step 2).

import { deepCopy } from "./snapshot.js";

export const TWIN_LIFECYCLE_STATES = Object.freeze([
  "created",
  "initialized",
  "idle",
  "running",
  "working",
  "planning",
  "executing",
  "critiquing",
  "reporting",
  "waiting",
  "done",
  "needs-review",
  "halted",
  "dismissed",
]);

// Allowed transitions. Terminal states (done, needs-review,
// halted, dismissed) have no outgoing transitionTo() edge;
// dismiss()/removeTwin() force "dismissed" instead (rule 3).
export const TWIN_TRANSITIONS = Object.freeze({
  created: ["initialized", "dismissed"],
  initialized: ["idle", "halted", "dismissed"],
  idle: [
    "running",
    "working",
    "planning",
    "waiting",
    "done",
    "halted",
    "dismissed",
  ],
  running: ["working", "waiting", "done", "needs-review", "halted", "dismissed"],
  working: ["running", "waiting", "done", "needs-review", "halted", "dismissed"],
  planning: ["executing", "done", "halted", "dismissed"],
  executing: ["critiquing", "done", "halted", "dismissed"],
  critiquing: [
    "planning",
    "executing",
    "reporting",
    "done",
    "needs-review",
    "halted",
    "dismissed",
  ],
  reporting: ["done", "needs-review", "halted", "dismissed"],
  waiting: ["running", "working", "idle", "done", "halted", "dismissed"],
  done: [],
  "needs-review": [],
  halted: [],
  dismissed: [],
});

const definitions = new Map();
const twins = new Map();

function twinKey(kind, id) {
  return `${kind}:${id}`;
}

function resolveId(kernel) {
  const id = kernel?.id ?? kernel?.name;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("twin needs a kernel object with an id or a name");
  }
  return id;
}

function resolvePath(kernel, path) {
  let current = kernel;
  for (const part of String(path).split(".")) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function defineTwinDefinition(def = {}) {
  if (typeof def.kind !== "string" || def.kind.trim() === "") {
    throw new Error("twin definition needs a kind");
  }
  if (!Array.isArray(def.snapshotFields)) {
    throw new Error(`twin definition "${def.kind}" needs snapshotFields`);
  }
  for (const field of def.snapshotFields) {
    if (typeof field !== "string" && typeof field !== "function") {
      throw new Error(
        `twin definition "${def.kind}" snapshotFields must be strings or functions`,
      );
    }
  }
  return Object.freeze({
    kind: def.kind,
    snapshotFields: [...def.snapshotFields],
    lifecycle: def.lifecycle ? [...def.lifecycle] : [...TWIN_LIFECYCLE_STATES],
    events: def.events ? [...def.events] : [],
    render: typeof def.render === "function" ? def.render : null,
  });
}

export function registerTwinDefinition(def) {
  const defined = defineTwinDefinition(def);
  definitions.set(defined.kind, defined);
  return defined;
}

export function getTwinDefinition(kind) {
  return definitions.get(kind) ?? null;
}

export function listTwinDefinitions() {
  return [...definitions.values()];
}

// Predefined definitions for this slice. Later slices register
// their own kinds the same way; they do not edit these two.
export const ENGINE_TWIN_DEFINITION = registerTwinDefinition({
  kind: "engine",
  snapshotFields: [
    "name",
    "instructionsSource",
    "toolNames",
    (kernel) =>
      Boolean(kernel?.liveState?.stateFound || kernel?.liveState?.historyFound),
    "activity",
    // Step-1 legacy fields, kept so engine.twin() stays the
    // shape step 1 promised — now read live, not captured.
    "role",
    "goal",
    "keep",
    "missingTools",
    "instructions",
    (kernel) => (kernel?.tools ?? []).map((tool) => tool?.name ?? tool),
    (kernel) => ({
      stateFound: Boolean(kernel?.liveState?.stateFound),
      historyFound: Boolean(kernel?.liveState?.historyFound),
      state: kernel?.liveState?.state ?? "",
      history: kernel?.liveState?.history ?? "",
    }),
  ],
  events: ["engine:update", "engine:activity", "lifecycle"],
});

export const AGENT_TWIN_DEFINITION = registerTwinDefinition({
  kind: "agent",
  snapshotFields: [
    "name",
    "role",
    (kernel) => kernel?.instructionsSource ?? "",
    (kernel) => [...(kernel?.tools ?? [])],
    "keep",
    (kernel) => kernel?.status ?? "",
  ],
  events: ["agent:spawn", "agent:report", "agent:dismiss", "lifecycle"],
});

// Snapshot field names for the function-valued fields above, in
// definition order. String fields use their own (dotted) name;
// function fields need an explicit name, supplied here in the
// same order the functions appear in the definition.
const FUNCTION_FIELD_NAMES = {
  engine: ["liveStateFound", "tools", "liveState"],
  agent: ["instructionsSource", "toolNames", "status"],
  // Slice C extension (tool only): the tool twin's one function
  // field is description, read from the tool itself at call time.
  tool: ["description"],
  // Slice B, goal-as-artifact-kind (correction 2026-11-04 12:46 EST):
  // the goal twin is kind "artifact" with artifactKind "goal"
  // (see goal-artifact.js GOAL_ARTIFACT_TWIN_DEFINITION). Its
  // function fields, in definition order, are folder, phase,
  // attempts, report. Slice C deliberately adds NO generic-
  // artifact function fields, so this entry is untouched: the
  // Slice C artifact definition uses string fields only, with
  // live values supplied by plain properties or getters on the
  // kernel object (see tool-artifact-twin.js). Overwriting this
  // entry would break goal snapshots; merging the two artifact
  // definitions is a coordinator decision, not a Slice C edit.
  artifact: ["folder", "phase", "attempts", "report"],
};

function snapshotFieldName(definition, field, functionIndex) {
  if (typeof field === "string") {
    return field.split(".").pop();
  }
  const names = FUNCTION_FIELD_NAMES[definition.kind] ?? [];
  return names[functionIndex] ?? `field${functionIndex}`;
}

export function createTwinFor(kernel, definitionOrKind, opts = {}) {
  if (!kernel || typeof kernel !== "object") {
    throw new Error("createTwinFor needs a kernel object");
  }
  const definition =
    typeof definitionOrKind === "string"
      ? getTwinDefinition(definitionOrKind)
      : definitionOrKind;
  if (!definition || typeof definition.kind !== "string") {
    throw new Error(
      `createTwinFor needs a registered twin definition, got ${String(definitionOrKind)}`,
    );
  }
  const id = resolveId(kernel);
  const key = twinKey(definition.kind, id);
  let lifecycle = "created";
  const listeners = new Map();

  // Callable twins (engine, for step-1 compat): calling the twin
  // returns its snapshot. Plain twins are ordinary objects.
  // Either way every property below lives on the twin itself,
  // and lifecycle is a live getter over the closure variable,
  // so transitionTo() is visible through every reference.
  const twin = opts.callable
    ? function twinFn() {
        return twin.snapshot();
      }
    : {};
  Object.defineProperties(twin, {
    id: { value: id, enumerable: true },
    kind: { value: definition.kind, enumerable: true },
    kernelId: { value: id, enumerable: true },
    lifecycle: {
      enumerable: true,
      get: () => lifecycle,
    },
  });

  twin.snapshot = () => {
    const out = { id, kind: definition.kind, lifecycle };
    let functionIndex = 0;
    for (const field of definition.snapshotFields) {
      const name = snapshotFieldName(definition, field, functionIndex);
      if (typeof field === "function") {
        functionIndex += 1;
        out[name] = deepCopy(field(kernel));
      } else {
        out[name] = deepCopy(resolvePath(kernel, field));
      }
    }
    return out;
  };

  twin.subscribe = (event, listener) => {
    if (typeof listener !== "function") {
      throw new Error("twin subscribe needs a listener function");
    }
    const type = typeof event === "string" && event !== "" ? event : "*";
    if (!listeners.has(type)) {
      listeners.set(type, new Set());
    }
    listeners.get(type).add(listener);
    return () => listeners.get(type)?.delete(listener);
  };

  twin.emit = (event, detail = {}) => {
    const record = {
      type: event,
      detail,
      twinId: id,
      kind: definition.kind,
      at: new Date().toISOString(),
    };
    for (const fn of listeners.get(event) ?? []) {
      fn(detail, record);
    }
    for (const fn of listeners.get("*") ?? []) {
      fn(detail, record);
    }
    return record;
  };

  twin.transitionTo = (next) => {
    if (!TWIN_LIFECYCLE_STATES.includes(next)) {
      throw new Error(`unknown twin lifecycle state: ${next}`);
    }
    const allowed = TWIN_TRANSITIONS[lifecycle] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(
        `illegal twin transition: ${lifecycle} -> ${next} (twin ${definition.kind}:${id})`,
      );
    }
    const from = lifecycle;
    lifecycle = next;
    twin.emit("lifecycle", { from, to: next });
    return twin;
  };

  twin.dismiss = () => {
    const from = lifecycle;
    lifecycle = "dismissed";
    twin.emit("lifecycle", { from, to: "dismissed" });
    twins.delete(key);
    return twin;
  };

  twin.remove = () => removeTwin(id, definition.kind);

  // Restart / supersede semantics: re-registering the same
  // kind:id replaces the old twin instead of throwing.
  twins.set(key, twin);
  return twin;
}

export function getTwin(id, kind = null) {
  if (kind) {
    return twins.get(twinKey(kind, id)) ?? null;
  }
  const matches = [...twins.entries()].filter(([, twin]) => twin.id === id);
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw new Error(
      `ambiguous twin id "${id}": pass a kind (found ${matches.map(([k]) => k).join(", ")})`,
    );
  }
  return matches[0][1];
}

export function listTwins(kind = null) {
  const all = [...twins.values()];
  return kind ? all.filter((twin) => twin.kind === kind) : all;
}

export function hasTwin(kernelOrId, kind = null) {
  if (typeof kernelOrId === "object" && kernelOrId !== null) {
    const id = resolveId(kernelOrId);
    const twinKind = kind ?? kernelOrId.twinKind ?? null;
    return twinKind ? twins.has(twinKey(twinKind, id)) : getTwin(id) !== null;
  }
  return kind ? twins.has(twinKey(kind, kernelOrId)) : getTwin(kernelOrId) !== null;
}

// The "no object without a twin" rule: returns the twin, or
// throws plainly for an object that was never registered.
export function assertTwinExists(kernelOrId, kind = null) {
  const twin =
    typeof kernelOrId === "object" && kernelOrId !== null
      ? (kind
          ? twins.get(twinKey(kind, resolveId(kernelOrId)))
          : getTwin(resolveId(kernelOrId))) ?? null
      : getTwin(kernelOrId, kind);
  if (!twin) {
    const id =
      typeof kernelOrId === "object" && kernelOrId !== null
        ? resolveId(kernelOrId)
        : kernelOrId;
    throw new Error(`no twin for ${kind ? `${kind}:` : ""}${id}`);
  }
  return twin;
}

export function removeTwin(id, kind = null) {
  const twin = getTwin(id, kind);
  if (!twin) {
    return null;
  }
  // Terminal operation: force "dismissed" even from a terminal
  // lifecycle state, then drop the registry entry.
  twin.dismiss();
  return twin;
}

export function clearTwinRegistry() {
  twins.clear();
}
