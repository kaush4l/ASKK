// Tool + Artifact CORE twins — Slice C, checkpoint 1
// (KERNEL-TWIN-SHIFT.md, correction 2026-11-04 12:46 EST:
// event-driven, core kinds ONLY engine/tool/artifact; watcher
// and script are ARTIFACT KINDS, not separate kernel kinds;
// goal is an artifact kind owned by Slice B; skill/model/infer/
// response/history/call-step are secondary/derived and are NOT
// built here. Interactive UI first, not chat-first: at core
// level this means twin snapshots + events, not a chat view.)
//
// PHILOSOPHY (same rules as kernel-twin.js, applied here):
//   - Creation creates the twin in the same call, same id.
//   - The twin is the UI counterpart, not a copy: snapshot()
//     reads the kernel object at call time (plain properties,
//     or getters on an adapter for LiveArtifact objects).
//   - Lifecycle is shared; dismissing removes the twin.
//   - Updates are events, not refetches: tool:start/end/error
//     and artifact state-change events drive twin updates.
//   - Persistence belongs to the kernel, not the twin: a
//     generic artifact's state.md is written by the kernel
//     state-change call, and loading state.md re-creates the
//     artifact + twin. A tool twin is re-created from the tool
//     registry on load — tool call history is NOT persisted
//     (a re-created tool twin starts with lastCall null).
//
// EVENT -> TWIN-UPDATE MAPPING (every event emitted here, and
// what it updates; gaps are listed after the mapping):
//   Tool (tool.js Tool.run emits; tool-artifact-twin subscribes
//   in createToolTwin, or recordToolCall is called manually):
//     tool:start -> tool twin: args + lastCall set, lastError
//       cleared, lifecycle -> running, twin emits tool:start.
//     tool:end   -> tool twin: lastResult + lastDuration set,
//       lifecycle -> done, twin emits tool:end.
//     tool:error -> tool twin: lastError + lastDuration set,
//       lifecycle -> halted (see D-C1), twin emits tool:error.
//   Generic artifact (updateArtifactTwin, the state-change call):
//     artifact:state-change -> artifact twin snapshot updates
//       (attributes/history read live), state.md saved exactly
//       first, twin emits artifact:state-change. A script whose
//       runStatus becomes "done" also walks its twin to done.
//   LiveArtifact (artifact.js _saveState emits):
//     artifact:state-change -> the artifact twin re-emits the
//       event; its snapshot re-reads the live artifact state.
//       No separate save is added: _saveState already saves
//       state.md exactly on every state-changing call.
//   Engine loop state (engine-by-name.js wires this in):
//     tool:start -> loopState.currentToolCall = name.
//     tool:end / tool:error -> currentToolCall = null.
//     agent:spawn -> subagent added (status running).
//     agent:dismiss -> subagent status -> done.
//     agent:waiting / agent:running -> subagent status updated.
//     phase / engine:phase / loop:phase -> currentPhase set.
//     waiting/running/done counts are ALWAYS recomputed from
//     the subagents array (see D-C4).
//
// GAPS — events with NO twin update defined (recorded, not
// papered over with polling):
//   G1. loop.js llm:start / llm:end, guidance, compaction have
//       no loop-state field; the engine twin shows loop state
//       (phase, tool call, subagents), not model calls.
//   G2. agent:report does not change a subagent's status: a
//       report is not completion, so waiting/running/done are
//       untouched by it.
//   G3. Loop tool:end events carry {id, name, group} but no
//       result/duration, so they update currentToolCall only —
//       never a tool twin's lastResult. Tool twin results come
//       from Tool.run events, which carry result + duration.
//   G4. History-only writes bypass the state-change event:
//       appendHistoryEntry called directly (not through a
//       LiveArtifact state-changing call) emits nothing.
//   G5. Concurrent calls to the SAME tool share one twin (see
//       D-C3): the twin tracks the latest call, not each call.
//
// DOUBTS (recorded, not guessed — for Kaushal / coordinator):
//   D-C1. Slice A has NO "error" lifecycle state (states are
//       created/initialized/idle/running/.../done/needs-review/
//       halted/dismissed). A tool error therefore maps to
//       "halted", with the message in lastError. If Kaushal
//       wants a literal "error" state, that is a registry-table
//       change in kernel-twin.js, not a Slice C change.
//   D-C2. Artifact state.md format vs goal .goal.md format
//       convergence is UNDECIDED. Generic artifact state.md
//       here encodes attributes as JSON lines (exact round-
//       trip); it does NOT parse .goal.md files, and
//       loadArtifactTwinFromState does NOT load goal artifacts.
//       Slice B owns goal persistence; a shared artifact file
//       format, if wanted, is a coordinator decision.
//   D-C3. Tool twin granularity: one twin per tool, tracking
//       the LATEST call. Parallel calls to the same tool are
//       not modelled as separate twins; a second start while
//       running updates args/lastCall without a transition,
//       and the last end/error wins lastResult/lastError.
//   D-C4. Engine loop waiting/running/done counts are
//       SUBAGENT counts (recomputed from subagents). Tool-call
//       counts live separately in loopState.toolCalls
//       ({running, done, failed}) and are NOT the top-level
//       counts. If the coordinator wants tool-call counts on
//       top, that is a one-line snapshot change in
//       engine-by-name.js.
//   D-C5. Tool call event payload shape is split: Tool.run
//       events carry {name, args, result/error, duration};
//       loop.js tool events carry {id, name, group} only.
//       The two are not unified here; unifying them would
//       change loop.js event payloads (out of this slice).
//   D-C6. LiveArtifact has no "expanded" boolean, so its
//       expandedView is {expanded: false, open: [paths]} unless
//       the caller sets artifact.expanded. The generic
//       artifact's expandedView is {expanded: bool}.
//   D-C7. DEFINITION OVERLAP (coordinator must resolve): Slice
//       B already registered kind "artifact" for goals
//       (GOAL_ARTIFACT_TWIN_DEFINITION, function fields folder/
//       phase/attempts/report in FUNCTION_FIELD_NAMES.artifact).
//       This slice therefore does NOT register its generic
//       artifact definition under kind "artifact" — it defines
//       it (defineTwinDefinition, no map overwrite) and passes
//       the definition OBJECT to createTwinFor, exactly as B
//       does. Its snapshot uses STRING fields only, with live
//       values from plain properties or getters, so B's
//       function-name list is untouched. A future merge may
//       unify the two artifact definitions into one; until
//       then, getTwinDefinition("artifact") returns B's goal
//       definition, and generic artifacts use the object
//       ARTIFACT_TWIN_DEFINITION exported here.
//   D-C8. Kernel-twin.js FUNCTION_FIELD_NAMES was extended
//       for tool ONLY (["description"]). The artifact entry
//       was deliberately left as B's — see D-C7.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createTwinFor,
  defineTwinDefinition,
  getTwin,
  registerTwinDefinition,
} from "./kernel-twin.js";

// ------------------------------------------------------------------
// Tool twin
// ------------------------------------------------------------------

// Snapshot fields: name, description (from the tool itself, via
// a function — hence FUNCTION_FIELD_NAMES.tool = ["description"]
// in kernel-twin.js), args, lastCall, lastResult, lastDuration,
// lastError. Lifecycle comes from the twin itself (snapshot()
// always includes it); it is NOT a snapshot field, because a
// string field named "lifecycle" would overwrite the twin's
// live lifecycle with the kernel's (absent) property.
export const TOOL_TWIN_DEFINITION = registerTwinDefinition({
  kind: "tool",
  snapshotFields: [
    "name",
    (kernel) => kernel?.tool?.description ?? kernel?.description ?? "",
    "args",
    "lastCall",
    "lastResult",
    "lastDuration",
    "lastError",
  ],
  events: ["tool:start", "tool:end", "tool:error", "lifecycle"],
});

// A transition attempt that ignores illegal-transition errors
// (the twin keeps its current state) but rethrows anything else.
// Tool twins are latest-call trackers (D-C3): a start on a
// running twin updates the call fields without forcing a
// lifecycle step the registry table does not allow.
function tryTransition(twin, next) {
  if (!twin || twin.lifecycle === next) {
    return;
  }
  try {
    twin.transitionTo(next);
  } catch (error) {
    if (!/illegal twin transition/.test(error?.message ?? "")) {
      throw error;
    }
  }
}

function tryTransitionChain(twin, steps) {
  for (const step of steps) {
    tryTransition(twin, step);
  }
}

function normalizeToolEvent(event, payload = {}) {
  const text = String(event ?? "");
  if (text.includes("error")) {
    return "error";
  }
  if (text.includes("start")) {
    return "start";
  }
  if (text.includes("end")) {
    return "end";
  }
  if (payload.error !== undefined && payload.error !== null) {
    return "error";
  }
  return "end";
}

// Create a tool twin in the same call as the tool's twin state,
// same id as the tool name. If the tool emits Tool.run events
// (Tool instances do), the twin subscribes and updates from
// them automatically; otherwise recordToolCall drives it.
// opts.subscribe === false skips the subscription (used when a
// terminal twin is superseded — the existing subscription
// closure is then re-pointed at the fresh twin).
export function createToolTwin(tool, opts = {}) {
  if (!tool || typeof tool.name !== "string" || tool.name.trim() === "") {
    throw new Error("tool twin needs a tool with a name");
  }
  const state = {
    id: tool.name,
    name: tool.name,
    tool,
    args: null,
    lastCall: null,
    lastResult: null,
    lastDuration: null,
    lastError: null,
    _startedAt: null,
  };
  // Description is read from the tool itself at snapshot time,
  // never copied: a tool's describe() text stays authoritative.
  Object.defineProperty(state, "description", {
    enumerable: true,
    get: () => state.tool?.description ?? "",
  });
  const twin = createTwinFor(state, TOOL_TWIN_DEFINITION);
  Object.defineProperty(twin, "toolState", {
    enumerable: false,
    value: state,
  });
  twin.transitionTo("initialized");
  twin.transitionTo("idle");
  if (opts.subscribe !== false && typeof tool.onToolEvent === "function") {
    let current = twin;
    tool.onToolEvent((event, detail = {}) => {
      try {
        const next = recordToolCall(current, {
          args: detail?.args,
          result: detail?.result,
          duration: detail?.duration,
          error: detail?.error,
          event,
        });
        if (next) {
          current = next;
        }
      } catch {
        // Twin updates never break tool execution (tool.js
        // already guards listeners; this is the second guard).
      }
    });
  }
  return twin;
}

// Drive a tool twin from a tool:start/end/error event. Returns
// the twin to use afterwards: normally the same twin, but a
// start on a terminal (done/halted) twin supersedes it with a
// fresh twin for the same tool (registry supersede semantics),
// because a terminal twin cannot transition back to running.
// Callers must use the returned twin after a restart.
export function recordToolCall(twin, payload = {}) {
  if (!twin || typeof twin !== "object") {
    throw new Error("recordToolCall needs a tool twin");
  }
  const kind = normalizeToolEvent(payload.event, payload);
  const state = twin.toolState ?? null;
  if (kind === "start" && state?.tool) {
    if (twin.lifecycle === "done" || twin.lifecycle === "halted") {
      const fresh = createToolTwin(state.tool, { subscribe: false });
      return recordToolCall(fresh, payload);
    }
  }
  if (kind === "start") {
    if (state) {
      state.args = payload.args ?? null;
      state.lastCall = {
        args: payload.args ?? null,
        at: new Date().toISOString(),
      };
      state._startedAt = Date.now();
      state.lastError = null;
    }
    tryTransitionChain(twin, ["initialized", "idle", "running"]);
    twin.emit("tool:start", {
      name: twin.id,
      args: payload.args ?? null,
    });
    return twin;
  }
  if (kind === "end") {
    if (state) {
      state.lastResult = payload.result ?? null;
      state.lastDuration =
        payload.duration ??
        (state._startedAt ? Date.now() - state._startedAt : null);
      state._startedAt = null;
    }
    tryTransitionChain(twin, ["initialized", "idle", "done"]);
    twin.emit("tool:end", { name: twin.id, result: payload.result ?? null });
    return twin;
  }
  // error — lifecycle "halted" (D-C1: no "error" state exists).
  if (state) {
    state.lastError =
      payload.error instanceof Error
        ? payload.error.message
        : String(payload.error ?? "tool error");
    state.lastDuration =
      payload.duration ??
      (state._startedAt ? Date.now() - state._startedAt : null);
    state._startedAt = null;
  }
  tryTransitionChain(twin, ["initialized", "idle", "halted"]);
  twin.emit("tool:error", { name: twin.id, error: state?.lastError ?? null });
  return twin;
}

// ------------------------------------------------------------------
// Generic artifact twin (kind "artifact", discriminator
// artifactKind). See D-C7: defined, NOT registered, so B's goal
// definition keeps the kind map slot.
// ------------------------------------------------------------------

export const ARTIFACT_KINDS = Object.freeze([
  "generic",
  "script",
  "watcher",
  "goal",
]);

// Defined state attributes per artifact kind, exactly. A write
// to any other attribute throws (never silently added). The
// "goal" schema exists so a generic artifact can carry the goal
// discriminator; Slice B's goal artifacts have their own shape
// and are NOT created or updated through this module (D-C2).
export const ARTIFACT_ATTRIBUTE_SCHEMAS = Object.freeze({
  generic: Object.freeze(["title", "content"]),
  script: Object.freeze([
    "name",
    "trigger",
    "commands",
    "steps",
    "notify",
    "haltRule",
    "runStatus",
    "doneNotification",
  ]),
  watcher: Object.freeze([
    "name",
    "watch",
    "event",
    "notify",
    "haltRule",
    "started",
    "lastEvent",
  ]),
  goal: Object.freeze([
    "statement",
    "status",
    "steps",
    "evidence",
    "decisions",
    "openQuestions",
  ]),
});

const ARTIFACT_ATTRIBUTE_DEFAULTS = Object.freeze({
  generic: Object.freeze({ title: "", content: "" }),
  script: Object.freeze({
    name: "",
    trigger: "on-demand",
    commands: [],
    steps: [],
    notify: "",
    haltRule: "",
    runStatus: "idle",
    doneNotification: "",
  }),
  watcher: Object.freeze({
    name: "",
    watch: "",
    event: "",
    notify: "",
    haltRule: "",
    started: false,
    lastEvent: null,
  }),
  goal: Object.freeze({
    statement: "",
    status: "open",
    steps: [],
    evidence: [],
    decisions: [],
    openQuestions: [],
  }),
});

const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Snapshot fields are STRINGS only (D-C7): live values come
// from plain properties (generic artifacts) or getters (the
// LiveArtifact adapter in createArtifactTwin), so no function
// field names are needed and B's artifact name list is intact.
// Lifecycle, as with tools, comes from the twin itself.
export const ARTIFACT_TWIN_DEFINITION = defineTwinDefinition({
  kind: "artifact",
  snapshotFields: [
    "id",
    "artifactKind",
    "attributes",
    "history",
    "expanded",
    "expandedView",
  ],
  events: [
    "artifact:state-change",
    "artifact:open",
    "artifact:expand",
    "lifecycle",
  ],
});

function checkArtifactId(id) {
  if (typeof id !== "string" || !ARTIFACT_ID.test(id)) {
    throw new Error(
      `artifact id must be letters, digits, "-" or "_", got ${JSON.stringify(id)}`,
    );
  }
  return id;
}

function schemaFor(kind) {
  const schema = ARTIFACT_ATTRIBUTE_SCHEMAS[kind];
  if (!schema) {
    throw new Error(
      `unknown artifactKind ${JSON.stringify(kind)} (expected ${ARTIFACT_KINDS.join(" | ")})`,
    );
  }
  return schema;
}

function assertKnownAttributes(kind, attributes) {
  const schema = new Set(schemaFor(kind));
  for (const key of Object.keys(attributes ?? {})) {
    if (!schema.has(key)) {
      throw new Error(
        `unknown artifact attribute "${key}" for artifactKind "${kind}"`,
      );
    }
  }
}

// A generic artifact kernel object: defined attributes exactly
// (schema order, defaults filled), history, expanded flag with
// a live expandedView getter, and optional persistence (dir /
// statePath — state.md lives directly in dir).
export function createArtifact({
  id,
  artifactKind = "generic",
  attributes = {},
  dir = null,
} = {}) {
  checkArtifactId(id);
  assertKnownAttributes(artifactKind, attributes);
  const artifact = {
    id,
    artifactKind,
    attributes: {
      ...ARTIFACT_ATTRIBUTE_DEFAULTS[artifactKind],
      ...attributes,
    },
    history: [],
    expanded: false,
    dir: dir ?? null,
    statePath: dir ? join(dir, "state.md") : null,
  };
  Object.defineProperty(artifact, "expandedView", {
    enumerable: true,
    get: () => ({ expanded: Boolean(artifact.expanded) }),
  });
  return artifact;
}

// Exact state.md form for a generic artifact. Attributes are
// JSON-encoded lines (exact round-trip for arrays/objects);
// history entries are JSON lines. This is NOT the goal .goal.md
// form (D-C2).
export function artifactStateToMarkdown(artifact) {
  const lines = [
    `# Artifact: ${artifact.id}`,
    "",
    `- artifactKind: ${artifact.artifactKind}`,
    `- expanded: ${artifact.expanded ? "true" : "false"}`,
    "",
    "## Attributes",
    "",
  ];
  for (const key of schemaFor(artifact.artifactKind)) {
    lines.push(`- ${key}: ${JSON.stringify(artifact.attributes?.[key] ?? null)}`);
  }
  lines.push("");
  lines.push("## History");
  lines.push("");
  for (const entry of artifact.history ?? []) {
    lines.push(`- ${JSON.stringify(entry)}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function parseArtifactState(text) {
  const parsed = {
    id: null,
    artifactKind: null,
    expanded: false,
    attributes: {},
    history: [],
  };
  let section = null;
  const attributeLines = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const title = line.match(/^# Artifact:\s*(.+)$/);
    if (title) {
      parsed.id = title[1].trim();
      continue;
    }
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }
    if (section === null) {
      const kind = line.match(/^- artifactKind:\s*(.+)$/);
      if (kind) {
        parsed.artifactKind = kind[1].trim();
        continue;
      }
      const expanded = line.match(/^- expanded:\s*(.+)$/);
      if (expanded) {
        parsed.expanded = expanded[1].trim() === "true";
      }
      continue;
    }
    if (section === "attributes") {
      const entry = line.match(/^- ([A-Za-z0-9_-]+): (.*)$/);
      if (entry) {
        attributeLines.push([entry[1], entry[2]]);
      }
    } else if (section === "history") {
      if (line.startsWith("- ")) {
        const rawEntry = line.slice(2);
        try {
          parsed.history.push(JSON.parse(rawEntry));
        } catch {
          parsed.history.push(rawEntry);
        }
      }
    }
  }
  const kind = parsed.artifactKind ?? "generic";
  // Unknown attributes in the file throw, exactly as unknown
  // attributes on write throw — a saved file must hold defined
  // attributes only, or the load is not exact.
  assertKnownAttributes(
    kind,
    Object.fromEntries(attributeLines.map(([key]) => [key, true])),
  );
  parsed.artifactKind = kind;
  for (const [key, rawValue] of attributeLines) {
    try {
      parsed.attributes[key] = JSON.parse(rawValue);
    } catch {
      parsed.attributes[key] = rawValue;
    }
  }
  return parsed;
}

// Save a generic artifact's state exactly (defined attributes
// only). No-op for in-memory artifacts (no dir). Returns the
// path written, or null.
export function saveArtifactState(artifact) {
  if (!artifact?.statePath) {
    return null;
  }
  mkdirSync(dirname(artifact.statePath), { recursive: true });
  writeFileSync(artifact.statePath, artifactStateToMarkdown(artifact), "utf8");
  return artifact.statePath;
}

// Create an artifact twin in the same call, same id.
// Generic artifacts (with .attributes) are the twin kernel
// directly. LiveArtifact objects (state() method, no
// .attributes) get an adapter kernel whose getters re-read the
// live artifact at snapshot time — the twin stays live without
// copying state, and artifact.twin() (a method) is untouched.
export function createArtifactTwin(artifact) {
  if (!artifact || typeof artifact.id !== "string") {
    throw new Error("artifact twin needs an artifact with an id");
  }
  let kernel = artifact;
  let isLive = false;
  if (!artifact.attributes || typeof artifact.attributes !== "object") {
    if (
      typeof artifact.state === "function" &&
      typeof artifact.subscribeStateChange === "function"
    ) {
      isLive = true;
      const live = artifact;
      kernel = { id: live.id, artifactKind: "generic" };
      Object.defineProperty(kernel, "attributes", {
        enumerable: true,
        get: () => {
          const state = live.state();
          return {
            id: state.id,
            root: state.root,
            tree: state.tree,
            open: state.open,
            focus: state.focus,
            modified: state.modified,
          };
        },
      });
      Object.defineProperty(kernel, "history", {
        enumerable: true,
        get: () => live.history(),
      });
      Object.defineProperty(kernel, "expanded", {
        enumerable: true,
        get: () => Boolean(live.expanded),
      });
      Object.defineProperty(kernel, "expandedView", {
        enumerable: true,
        get: () => ({
          expanded: Boolean(live.expanded),
          open: live.state().open.map((entry) => entry.path),
        }),
      });
    } else {
      throw new Error(
        "artifact twin needs a generic artifact (attributes) or a LiveArtifact (state/subscribeStateChange)",
      );
    }
  }
  const twin = createTwinFor(kernel, ARTIFACT_TWIN_DEFINITION);
  twin.transitionTo("initialized");
  twin.transitionTo("idle");
  if (isLive) {
    kernel.twin = twin;
    artifact.subscribeStateChange((detail) => {
      twin.emit("artifact:state-change", detail);
    });
  } else if (typeof artifact.twin !== "function") {
    artifact.twin = twin;
  }
  return twin;
}

// The state-change call for a generic artifact: validate (unknown
// attribute throws BEFORE any mutation or save, so the file and
// the snapshot stay unchanged on refusal), apply, record history,
// save state.md exactly, then emit artifact:state-change on the
// twin (created first if missing). A script whose runStatus
// becomes "done" walks its twin to done. LiveArtifact objects
// are refused here — their own state-changing calls already
// save + emit (artifact.js _saveState).
export function updateArtifactTwin(artifact, changedAttributes = {}, opts = {}) {
  if (!artifact || typeof artifact.id !== "string") {
    throw new Error("updateArtifactTwin needs an artifact with an id");
  }
  if (!artifact.attributes || typeof artifact.attributes !== "object") {
    throw new Error(
      "updateArtifactTwin needs a generic artifact: LiveArtifact state changes go through its own calls (open/write/expand), which already save and emit",
    );
  }
  if (
    !changedAttributes ||
    typeof changedAttributes !== "object" ||
    Array.isArray(changedAttributes)
  ) {
    throw new Error("updateArtifactTwin needs changed attributes as an object");
  }
  assertKnownAttributes(artifact.artifactKind, changedAttributes);
  Object.assign(artifact.attributes, changedAttributes);
  if (opts.expanded !== undefined) {
    artifact.expanded = Boolean(opts.expanded);
  }
  artifact.history.push({
    at: new Date().toISOString(),
    changed: Object.keys(changedAttributes),
    event: "artifact:state-change",
  });
  saveArtifactState(artifact);
  const twin = getTwin(artifact.id, "artifact") ?? createArtifactTwin(artifact);
  twin.emit("artifact:state-change", {
    id: artifact.id,
    changed: Object.keys(changedAttributes),
    attributes: artifact.attributes,
  });
  if (
    artifact.artifactKind === "script" &&
    artifact.attributes.runStatus === "done"
  ) {
    tryTransitionChain(twin, ["running", "done"]);
  }
  return twin;
}

// Restart: re-create a generic artifact + twin from state.md
// text, exactly. The id argument must match the file's id when
// both are present; attributes come back identical (JSON round-
// trip), history identical, expanded identical. opts.dir, when
// given, re-attaches persistence for the next state change.
export function loadArtifactTwinFromState(stateMdText, id, opts = {}) {
  const parsed = parseArtifactState(stateMdText);
  const finalId = id ?? parsed.id;
  if (!finalId) {
    throw new Error("loadArtifactTwinFromState needs an id");
  }
  if (parsed.id && id && parsed.id !== id) {
    throw new Error(
      `artifact state id mismatch: file says ${parsed.id}, asked for ${id}`,
    );
  }
  const artifact = createArtifact({
    id: finalId,
    artifactKind: parsed.artifactKind ?? "generic",
    attributes: parsed.attributes,
    dir: opts.dir ?? null,
  });
  artifact.history = parsed.history ?? [];
  artifact.expanded = parsed.expanded ?? false;
  const twin = createArtifactTwin(artifact);
  return { artifact, twin };
}

// ------------------------------------------------------------------
// Engine loop state (tiny event listener helper, wired in by
// engine-by-name.js — no new engine file, no loop rewrite).
// The engine twin shows LOOP state, not a chat transcript:
// current phase, current tool call, subagents created, and
// waiting/running/done counts. All of it is event-derived:
// applyLoopEvent mutates this object; the twin snapshot reads
// it live. Nothing here polls.
// ------------------------------------------------------------------

export function createLoopState() {
  return {
    currentPhase: null,
    currentToolCall: null,
    subagents: [],
    waiting: 0,
    running: 0,
    done: 0,
    toolCalls: { running: 0, done: 0, failed: 0 },
  };
}

function recomputeSubagentCounts(loopState) {
  loopState.waiting = loopState.subagents.filter(
    (agent) => agent.status === "waiting",
  ).length;
  loopState.running = loopState.subagents.filter(
    (agent) => agent.status === "running",
  ).length;
  loopState.done = loopState.subagents.filter(
    (agent) => agent.status === "done",
  ).length;
}

function markSubagent(loopState, name, status) {
  if (typeof name !== "string" || name === "") {
    return;
  }
  const existing = loopState.subagents.find((agent) => agent.name === name);
  if (existing) {
    existing.status = status;
  } else {
    loopState.subagents.push({ name, status });
  }
  recomputeSubagentCounts(loopState);
}

// Apply ONE loop event to loop state. Unknown events are
// ignored (they are gaps G1/G2, not errors). Returns loopState.
export function applyLoopEvent(loopState, event, detail = {}) {
  if (!loopState || typeof loopState !== "object") {
    throw new Error("applyLoopEvent needs a loop state object");
  }
  const name =
    detail?.name ?? detail?.agent?.name ?? detail?.agent ?? null;
  switch (event) {
    case "tool:start":
      loopState.currentToolCall = name;
      loopState.toolCalls.running += 1;
      break;
    case "tool:end":
      loopState.currentToolCall = null;
      loopState.toolCalls.running = Math.max(
        0,
        loopState.toolCalls.running - 1,
      );
      loopState.toolCalls.done += 1;
      break;
    case "tool:error":
      loopState.currentToolCall = null;
      loopState.toolCalls.running = Math.max(
        0,
        loopState.toolCalls.running - 1,
      );
      loopState.toolCalls.failed += 1;
      break;
    case "agent:spawn":
      markSubagent(loopState, name, "running");
      break;
    case "agent:dismiss":
      markSubagent(loopState, name, "done");
      break;
    case "agent:waiting":
      markSubagent(loopState, name, "waiting");
      break;
    case "agent:running":
    case "agent:resume":
      markSubagent(loopState, name, "running");
      break;
    case "phase":
    case "engine:phase":
    case "loop:phase":
      loopState.currentPhase =
        detail?.phase ?? detail?.id ?? detail?.name ?? null;
      break;
    case "engine:update":
      if (detail?.currentPhase !== undefined) {
        loopState.currentPhase = detail.currentPhase;
      }
      break;
    default:
      // Gaps G1/G2: llm:*, guidance, compaction, agent:report
      // carry no loop-state field and change nothing here.
      break;
  }
  return loopState;
}
