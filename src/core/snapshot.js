// Simulate agent — snapshot + replay, pure core (no Node imports,
// so the replay UI can import this module in the browser).
//
// A snapshot is a point-in-time capture of a run, frozen by deep
// copy at take time, so later live changes never rewrite it:
//
//   { id, at, deskTwin, messages, steps, progress, partial }
//
//   deskTwin: { model, provider, endpoint, status, inferenceCount }
//     Plain data only — no keys, no apiKeyEnv, no absolute paths.
//   messages: [{ role, content }] — the session conversation, in
//     order. Nothing else from a message is kept.
//   steps: [{ step, thought, calls, context, activity, counts }]
//     step: 1-based, in order.
//     thought: a string when the step recorded one, else null.
//       Null is NOT a missing value to fill in — it means
//       "not captured at this step" (today's single-turn chat
//       records no thought field, so its steps have null here).
//     calls: [{ id, name, inputs, result, expectation }] —
//       expectation is one of immediate | done | stream |
//       live-state, or "" when unknown. A call's result is the
//       final recorded result only; a live stream is never a
//       call result.
//     context: { soulVersion, toolsVersion, artifactState }
//       artifactState: { open: [logical paths], focus: path|null,
//         modified: [logical paths] }.
//       terminalStream: always "not captured" — a live stream
//         cannot be frozen; only final lines recorded as a tool
//         result are replayable.
//       modelInternalState: always "not captured" — weights and
//         hidden activations are never part of a snapshot.
//       externalChange: null, or "not captured" when a file
//         changed outside the run after the step — such a change
//         is labelled, never merged into the step's context.
//   progress: e.g. "3 of 5 steps done" — derived from steps when
//     not supplied. partial: true when the snapshot was taken
//     before the run reached success (the last step's activity
//     is not "success"), so replay ends where it was taken.
//
// No cross-pollination: a snapshot carries each element's own
// context only. Instructions/soul carry no tool or history data,
// tools carry no history, history carries no tool specs, and a
// step's context is that step's own versions and artifact state
// — never another element's data copied into it. The renderer
// (replay UI) composes elements at display time; elements
// themselves are ignorant of each other.
//
// Nothing here is hardcoded to a particular desk, tool list, or
// response format: soulVersion and toolsVersion are derived from
// the live desk object at capture time (see captureFromDesk in
// snapshot-store.js, and toolsVersion below), and the replay UI
// renders whatever steps, calls, and artifact state the snapshot
// actually contains — it does not assume a panel, a tool, or a
// desk organisation in advance.

const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function checkSnapshotId(id) {
  if (typeof id !== "string" || !SNAPSHOT_ID.test(id)) {
    throw new Error(
      `snapshot id must be letters, digits, "-" or "_", got ${JSON.stringify(id)}`,
    );
  }
  return id;
}

export function deepCopy(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : typeof entry?.path === "string"
          ? entry.path
          : "",
    )
    .filter((entry) => entry !== "");
}

// Stable, runtime-derived version for a tool registry: a hash of
// the sorted tool specs (name + expectation) actually present.
// Adding, removing, or changing a tool changes the version, so a
// snapshot's toolsVersion always names the registry at that step —
// it is never a hardcoded list, and it never stores tool specs.
export function toolsVersion(tools) {
  const specs = (Array.isArray(tools) ? tools : [])
    .map((tool) => {
      const spec =
        typeof tool?.spec === "function" ? tool.spec() : (tool ?? {});
      return `${spec.name ?? ""}:${spec.expectation ?? ""}`;
    })
    .sort()
    .join("|");
  let hash = 5381;
  for (let i = 0; i < specs.length; i++) {
    hash = ((hash << 5) + hash + specs.charCodeAt(i)) >>> 0;
  }
  return `tools-v${hash.toString(16)}`;
}

export function sanitizeDeskTwin(twin) {
  return {
    model: asString(twin?.model ?? twin?.defaultModel ?? ""),
    provider: asString(twin?.provider ?? ""),
    endpoint: asString(twin?.endpoint ?? ""),
    status: asString(twin?.status ?? ""),
    inferenceCount:
      typeof twin?.inferenceCount === "number" ? twin.inferenceCount : 0,
  };
}

export function normalizeArtifactState(state) {
  return {
    open: asStringList(state?.open),
    focus:
      typeof state?.focus === "string"
        ? state.focus
        : typeof state?.focus?.path === "string"
          ? state.focus.path
          : null,
    modified: asStringList(state?.modified),
  };
}

export function normalizeStep(raw, index, defaults = {}) {
  const step = index + 1;
  const context = raw?.context ?? {};
  const artifactState = normalizeArtifactState(
    context.artifactState ?? defaults.artifactState,
  );
  return {
    step,
    thought:
      typeof raw?.thought === "string" && raw.thought !== ""
        ? raw.thought
        : null,
    calls: (Array.isArray(raw?.calls) ? raw.calls : []).map((call, i) => ({
      id: asString(call?.id, `call-${step}-${i + 1}`),
      name: asString(call?.name, "unknown"),
      inputs: asString(call?.inputs, ""),
      result: asString(call?.result, ""),
      expectation: asString(call?.expectation, ""),
    })),
    context: {
      soulVersion: asString(
        context.soulVersion ?? defaults.soulVersion,
        "soul:unknown",
      ),
      toolsVersion: asString(
        context.toolsVersion ?? defaults.toolsVersion,
        "tools:unknown",
      ),
      artifactState,
      // Best effort, honestly labelled — these are never invented:
      terminalStream: "not captured",
      modelInternalState: "not captured",
      externalChange:
        context.externalChange === "not captured" ? "not captured" : null,
    },
    activity: asString(raw?.activity, "idle"),
    counts: {
      llm: typeof raw?.counts?.llm === "number" ? raw.counts.llm : 0,
      tool: typeof raw?.counts?.tool === "number" ? raw.counts.tool : 0,
      ok: typeof raw?.counts?.ok === "number" ? raw.counts.ok : 0,
      err: typeof raw?.counts?.err === "number" ? raw.counts.err : 0,
    },
    ...(typeof raw?.message === "object" && raw.message !== null
      ? {
          message: {
            role: asString(raw.message.role, "assistant"),
            content: asString(raw.message.content, ""),
          },
        }
      : {}),
  };
}

// Steps derived from session messages alone (the state of the app
// today: single-turn chat, no loop, no recorded tool calls). Each
// message becomes one step with no thought and no calls — the
// replay labels both as not captured, rather than inventing a
// tool call or a thought the chat never recorded. The artifact
// state is the current live state for every message-step; the
// honesty label below still applies when later steps change it.
export function stepsFromMessages(messages, defaults = {}) {
  return (Array.isArray(messages) ? messages : []).map((message, i) =>
    normalizeStep(
      {
        message: {
          role: asString(message?.role, "assistant"),
          content: asString(message?.content, ""),
        },
        activity: message?.role === "user" ? "idle" : "llm",
        counts: { llm: 0, tool: 0, ok: 0, err: 0 },
      },
      i,
      defaults,
    ),
  );
}

export function createSnapshot(input = {}) {
  const id =
    typeof input.id === "string" && input.id !== ""
      ? checkSnapshotId(input.id)
      : `snap-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  const at =
    typeof input.at === "string" && input.at !== ""
      ? input.at
      : new Date().toISOString();
  const deskTwin = sanitizeDeskTwin(input.deskTwin);
  const messages = (Array.isArray(input.messages) ? input.messages : []).map(
    (message) => ({
      role: asString(message?.role, "assistant"),
      content: asString(message?.content, ""),
    }),
  );
  const defaults = {
    soulVersion: input.soulVersion,
    toolsVersion: input.toolsVersion,
    artifactState: input.artifactState,
  };
  let steps = (Array.isArray(input.steps) ? input.steps : []).map(
    (raw, i) => normalizeStep(raw, i, defaults),
  );
  if (steps.length === 0 && messages.length > 0) {
    steps = stepsFromMessages(messages, defaults);
  }
  const progress =
    typeof input.progress === "string" && input.progress !== ""
      ? input.progress
      : `${steps.length} of ${steps.length} steps done`;
  const partial =
    typeof input.partial === "boolean"
      ? input.partial
      : steps.length === 0 ||
        steps[steps.length - 1].activity !== "success";
  return deepCopy({ id, at, deskTwin, messages, steps, progress, partial });
}

// Honesty label for one replay step, computed from the snapshot
// alone (never from the live run, which may have moved on):
// "Context at this step" when no later step in this snapshot
// changed the artifact state, otherwise "now — N later calls
// changed it since (within this snapshot)", where N counts later
// steps whose artifact state differs from this step's.
export function honestyLabel(snapshot, stepIndex) {
  const steps = snapshot?.steps ?? [];
  const here = JSON.stringify(steps[stepIndex]?.context?.artifactState ?? null);
  let later = 0;
  for (let i = stepIndex + 1; i < steps.length; i++) {
    if (JSON.stringify(steps[i].context?.artifactState ?? null) !== here) {
      later++;
    }
  }
  return later === 0
    ? "Context at this step"
    : `now — ${later} later call${later === 1 ? "" : "s"} changed it since (within this snapshot)`;
}

// What this step did NOT capture, labelled in place — never
// invented. A replay UI renders exactly these labels.
export function notCapturedLabels(step) {
  const labels = [];
  if (!step?.thought) {
    labels.push(
      "Thinking: not captured at this step — no thought field was recorded for this step, so no thought is shown rather than an invented one.",
    );
  }
  labels.push(
    "Terminal stream: not captured — a live stream cannot be frozen; only final lines recorded as a tool result are replayable.",
  );
  labels.push("Model internal state: not captured — never part of a snapshot.");
  if (step?.context?.externalChange === "not captured") {
    labels.push(
      "External change: not captured — a file changed outside the run after this step is not part of this step's context.",
    );
  }
  return labels;
}

// Twin for the list route: identity and counts only. No keys, no
// absolute paths, and no artifact file paths (those live in the
// full snapshot, behind the per-id route, as logical paths).
export function snapshotTwin(snapshot) {
  return {
    id: snapshot.id,
    at: snapshot.at,
    deskTwin: {
      model: snapshot.deskTwin?.model ?? "",
      provider: snapshot.deskTwin?.provider ?? "",
      status: snapshot.deskTwin?.status ?? "",
    },
    messageCount: (snapshot.messages ?? []).length,
    stepCount: (snapshot.steps ?? []).length,
    progress: snapshot.progress,
    partial: snapshot.partial,
  };
}

// Human-readable summary beside the JSON file. It is a summary,
// not a second source of truth: the JSON file is the snapshot,
// and replay always reads the JSON.
export function snapshotToMarkdown(snapshot) {
  const lines = [
    `# Snapshot: ${snapshot.id}`,
    "",
    `- at: ${snapshot.at}`,
    `- desk: ${snapshot.deskTwin?.provider ?? ""} ${snapshot.deskTwin?.model ?? ""} (${snapshot.deskTwin?.status ?? ""})`,
    `- messages: ${(snapshot.messages ?? []).length}`,
    `- steps: ${(snapshot.steps ?? []).length}`,
    `- progress: ${snapshot.progress}`,
    `- partial: ${snapshot.partial ? "yes — ends where it was taken, not at success" : "no"}`,
    "",
    "## Steps",
    "",
  ];
  for (const step of snapshot.steps ?? []) {
    const callNames = step.calls.map((call) => call.name).join(", ");
    lines.push(
      `- step ${step.step}: ${step.activity}${callNames ? ` — ${callNames}` : ""}${step.thought ? "" : " (thinking not captured)"}`,
    );
  }
  lines.push("");
  lines.push(
    "Not captured, by design: terminal streams, model internal state, and external file changes after a step. Thinking is shown only when a thought field was recorded.",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}
