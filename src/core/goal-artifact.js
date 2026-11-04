// Goal artifact — CORRECTION (2026-11-04): a goal is a SINGLE
// tool call, and the agent writes ONLY the goal statement.
//
//   goal.create({ statement })            -> succeeds
//   goal.create({ statement, phases })    -> REFUSED
//   goal.create({ statement, plan })      -> REFUSED
//   goal.create({ statement, tools })     -> REFUSED (any pre-filled
//     tool list, allowedTools, or steps list is refused the same way)
//   goal.create({})                        -> REFUSED (no statement)
//
// The goal-writer CANNOT plan. The harness CANNOT plan either:
// its duty ends at translating the owner request into that one
// goal.create call and passing the goal to the right executing
// agent. Execution is always the executing agent's task, and the
// executing agent owns its own plan -> execute -> critique loop
// internally, looping back on critique failure (see spawn.js
// DEVELOPER_INTERNAL_PHASES and harness.js).
//
// Consequences, enforced in code:
//   - The goal artifact has NO harness-written phases field. There
//     is no goal.phases, no goal.set-phase, and no goal.next-phase
//     tool. (An earlier draft of this module had them; they were
//     removed by this correction, not left behind.)
//   - Developer-internal phases, if they exist at all, live in the
//     developer agent's own state/history (agent.internalPhases,
//     agent.currentPhase), never in the goal artifact. The goal's
//     singular `phase` field (below) is only a MIRROR of the
//     developer's current internal phase, for the artifact twin's
//     display — it is not a plan, not a tool, and not written by
//     the harness as a phase list. It is set by
//     artifact.setPhase(), called by the harness as the developer
//     moves, and it never replaces agent.internalPhases.
//   - What the goal artifact DOES keep: statement, status, live
//     folder for that goal, steps (added during execution, never
//     pre-filled), evidence, decisions, openQuestions, history,
//     and snapshots (deep copies, taken on status change).
//   - Tools to change a goal, loaded by loadGoalArtifact():
//     goal.set-statement, goal.add-step, goal.complete-step,
//     goal.set-status, goal.add-evidence. Nothing phase-shaped.
//
// SLICE B — goal as an ARTIFACT KIND (correction 2026-11-04
// 12:46 EST, superseding the 13-kind twin list as the core):
// the goal twin is NOT a separate kernel kind. It is an artifact
// twin: registry kind "artifact", discriminator artifactKind
// "goal", on the same kernel-twin registry Slice A built, with
// the same snapshotFields mechanism, the same defined state
// attributes, the same shared lifecycle, and the same rule that
// persistence belongs to the kernel file, never to the twin.
// Slice A defines no generic "artifact" definition yet (that is
// Slice C); this module therefore registers the artifact-kind
// definition for goals here, holding a direct reference to it
// (createTwinFor with the definition object, not a kind-string
// lookup), so a later Slice C registration of kind "artifact"
// cannot silently change what a goal twin snapshots — see
// DOUBT D-B5. The twin snapshot is the artifact twin's snapshot:
// it deliberately EXCLUDES history (no chat transcript, no
// session history — engine loop state is Slice A / core
// verification, not this slice).
//
// EVENT-DRIVEN (the governing ideology): every twin update is
// driven by a kernel event emitted by a goal mutation — the
// twin snapshot re-reads the kernel at call time, so a listener
// that re-reads snapshot() on the event sees the new state with
// no refetch and no new kernel object. No polling, no refetch
// fallback. The full event -> twin-update table is in the header
// of goal-twin.test.js and in the final slice report:
//
//   goal:add-step        -> snapshot.steps gains the step
//   goal:complete-step   -> that step's done becomes true
//   goal:add-evidence    -> snapshot.evidence grows
//   goal:add-decision    -> snapshot.decisions grows
//   goal:add-open-question -> snapshot.openQuestions grows
//   goal:phase           -> snapshot.phase changes; lifecycle
//                           stays "running" (a phase mirror is
//                           not a lifecycle transition)
//   goal:loop-back       -> snapshot.attempts increments
//   goal:report          -> snapshot.report changes
//   goal:update          -> set-statement / reopen: statement
//                           or status re-read from the kernel
//   goal:complete        -> status "done", twin lifecycle "done"
//   goal:needs-review    -> status "needs-review", twin
//                           lifecycle "needs-review"
//   goal:dismiss         -> twin removed from the registry
//                           (lifecycle "dismissed")
//
// Persistence (kernel, not twin): the goal file
// personal/memory/goals/<id>.goal.md is written on create and
// on every twin-field mutation above, when a persistence dir is
// configured (personalDir -> <personalDir>/memory/goals, or an
// explicit goalsDir). The directory is created only at write
// time, never on load, and never under public/defaults. Loading
// that file (loadGoalFromFile / loadGoalArtifactFile) re-creates
// the goal kernel object AND its artifact-kind twin exactly.
// A bare createGoal with no persistence dir creates the twin
// but writes no file — see DOUBT D-B1.
//
// Folder: { root, tree, open, focus, modified }. The tree comes
// from the files tool, which already gitignore-filters tree/list/
// search/expand views. An explicit open of a named path is the
// documented exception (see files.js): it is not gitignore-
// filtered, only safety-refused. Gitignored files are NEVER
// loaded into the file artifact through a view.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  createTwinFor,
  getTwin,
  registerTwinDefinition,
} from "./kernel-twin.js";
import { deepCopy } from "./snapshot.js";
import { Tool } from "./tool.js";

// Keys goal.create accepts: statement, plus id/name for addressing.
// Everything else that would smuggle in a plan is refused, not
// silently ignored — a caller that passes phases must hear that
// it is refused, or it will keep passing them.
export const GOAL_CREATE_KEYS = Object.freeze(["statement", "id", "name"]);
export const GOAL_CREATE_REFUSED_KEYS = Object.freeze([
  "phases",
  "plan",
  "tools",
  "toolList",
  "allowedTools",
  "steps",
]);

// Defined state attributes of a goal artifact — the artifact
// twin's state, exactly. A write to any other attribute through
// setStateAttribute() throws; the artifact methods below only
// ever write these (plus the artifactKind discriminator and the
// history/snapshots bookkeeping, which are not twin fields).
export const GOAL_ARTIFACT_STATE_ATTRIBUTES = Object.freeze([
  "statement",
  "status",
  "folder",
  "steps",
  "evidence",
  "decisions",
  "openQuestions",
  "phase",
  "attempts",
  "report",
]);

export const GOAL_STATUSES = Object.freeze([
  "open",
  "done",
  "needs-review",
  "dismissed",
]);

// Artifact-kind twin definition for goals. Kind is "artifact";
// artifactKind "goal" is the discriminator inside that kind, so
// a goal twin, a live-artifact twin and (later) a watcher/script
// twin all live in one registry kind without expanding the core
// list. Function fields need their names in kernel-twin.js
// FUNCTION_FIELD_NAMES.artifact, in definition order here:
// folder, phase, attempts, report.
export const GOAL_ARTIFACT_TWIN_DEFINITION = registerTwinDefinition({
  kind: "artifact",
  snapshotFields: [
    "artifactKind",
    "statement",
    "status",
    (kernel) => kernel?.folder ?? { root: "", tree: [], open: [], focus: null, modified: [] },
    "steps",
    "evidence",
    "decisions",
    "openQuestions",
    (kernel) => kernel?.phase ?? null,
    (kernel) => (typeof kernel?.attempts === "number" ? kernel.attempts : 0),
    (kernel) => kernel?.report ?? null,
  ],
  events: [
    "goal:add-step",
    "goal:complete-step",
    "goal:add-evidence",
    "goal:add-decision",
    "goal:add-open-question",
    "goal:phase",
    "goal:loop-back",
    "goal:report",
    "goal:update",
    "goal:complete",
    "goal:needs-review",
    "goal:dismiss",
    "lifecycle",
  ],
});

// Alias, not a second kind: same definition object, kind
// "artifact". Slices C/D/E that look for a goal twin definition
// import this name and get the artifact-kind definition.
export const GOAL_TWIN_DEFINITION = GOAL_ARTIFACT_TWIN_DEFINITION;

function goalsDirFromOpts(opts = {}) {
  if (typeof opts.goalsDir === "string" && opts.goalsDir.trim() !== "") {
    return opts.goalsDir;
  }
  if (typeof opts.personalDir === "string" && opts.personalDir.trim() !== "") {
    return join(opts.personalDir, "memory", "goals");
  }
  return null;
}

function twinTargetForStatus(status) {
  if (status === "done") return "done";
  if (status === "needs-review") return "needs-review";
  if (status === "dismissed") return "dismissed";
  return "running";
}

function isTerminalLifecycle(lifecycle) {
  return ["done", "needs-review", "halted", "dismissed"].includes(lifecycle);
}

// Walk a FRESH twin (lifecycle "created") to the target state.
// Every path goes through running, because idle -> needs-review
// is not a legal registry transition (idle allows running, but
// not needs-review directly) while running -> done and running
// -> needs-review both are.
function walkFreshTwinTo(twin, target) {
  twin.transitionTo("initialized");
  twin.transitionTo("idle");
  if (target === "running") {
    twin.transitionTo("running");
    return twin;
  }
  twin.transitionTo("running");
  if (target === "done") {
    twin.transitionTo("done");
  } else if (target === "needs-review") {
    twin.transitionTo("needs-review");
  } else if (target === "dismissed") {
    twin.dismiss();
  }
  return twin;
}

function createGoalTwin(artifact) {
  const twin = createTwinFor(artifact, GOAL_ARTIFACT_TWIN_DEFINITION);
  twin.artifactKind = "goal";
  artifact.twin = twin;
  walkFreshTwinTo(twin, twinTargetForStatus(artifact.status ?? "open"));
  return twin;
}

// Bring the twin's lifecycle in line with a new status. Terminal
// twins cannot transition out, so a reopen from done /
// needs-review re-creates the twin (Slice A supersede semantics:
// re-registering the same kind:id replaces the old twin).
function syncTwinForStatus(artifact, status) {
  const target = twinTargetForStatus(status);
  const twin = artifact.twin;
  if (!twin || twin.lifecycle === "dismissed") {
    if (target === "dismissed") {
      return twin ?? null;
    }
    const fresh = createTwinFor(artifact, GOAL_ARTIFACT_TWIN_DEFINITION);
    fresh.artifactKind = "goal";
    artifact.twin = fresh;
    walkFreshTwinTo(fresh, target);
    return fresh;
  }
  if (twin.lifecycle === target) {
    return twin;
  }
  if (isTerminalLifecycle(twin.lifecycle)) {
    const fresh = createTwinFor(artifact, GOAL_ARTIFACT_TWIN_DEFINITION);
    fresh.artifactKind = "goal";
    artifact.twin = fresh;
    walkFreshTwinTo(fresh, target);
    return fresh;
  }
  if (twin.lifecycle === "idle") {
    twin.transitionTo("running");
  }
  if (twin.lifecycle === "running") {
    if (target === "done") twin.transitionTo("done");
    else if (target === "needs-review") twin.transitionTo("needs-review");
    else if (target === "dismissed") twin.dismiss();
    return twin;
  }
  // Any other non-terminal state: recreate rather than force an
  // illegal transition through the registry table.
  const fresh = createTwinFor(artifact, GOAL_ARTIFACT_TWIN_DEFINITION);
  fresh.artifactKind = "goal";
  artifact.twin = fresh;
  walkFreshTwinTo(fresh, target);
  return fresh;
}

function emitGoal(artifact, event, detail = {}) {
  try {
    artifact.twin?.emit?.(event, detail);
  } catch {
    // A twin event never breaks the kernel mutation it reports.
  }
}

// Kernel persistence: write the goal file, creating the goals
// directory only at write time. Returns the file path, or null
// when no persistence dir is configured (see D-B1). Errors from
// a configured write propagate — a configured write that fails
// is not silently swallowed.
function persistGoal(artifact) {
  if (!artifact._goalsDir) {
    return null;
  }
  return writeGoalArtifactFile(artifact._goalsDir, artifact);
}

export function createGoal(input = {}, opts = {}) {
  const refused = GOAL_CREATE_REFUSED_KEYS.filter((key) => key in input);
  if (refused.length > 0) {
    throw new Error(
      `goal.create refused: a goal is a statement only — it cannot carry ${refused.join(", ")}. The executing agent owns its own plan.`,
    );
  }
  const statement = input.statement;
  if (typeof statement !== "string" || statement.trim() === "") {
    throw new Error("goal.create needs a statement");
  }
  const id =
    typeof input.id === "string" && input.id.trim() !== ""
      ? input.id.trim()
      : typeof input.name === "string" && input.name.trim() !== ""
        ? input.name.trim()
        : "goal";
  // Persistence dirs may arrive in opts (the harness path) or
  // on the input itself (a test path); neither is a refused key
  // and neither smuggles a plan — they only say where the kernel
  // file lives. Phase / attempts / report are NOT accepted here:
  // they are set by artifact methods / file load, never by a
  // goal.create caller (see D-B3).
  const personalDir = opts.personalDir ?? input.personalDir ?? null;
  const goalsDir = opts.goalsDir ?? input.goalsDir ?? null;
  return createGoalArtifact({
    id,
    statement: statement.trim(),
    ...(personalDir ? { personalDir } : {}),
    ...(goalsDir ? { goalsDir } : {}),
  });
}

export function goalState(artifact) {
  const steps = artifact.steps ?? [];
  const done = steps.filter((s) => s.done).length;
  return {
    status: artifact.status ?? "open",
    stepsDone: done,
    stepsRemaining: steps.length - done,
    progress: steps.length === 0 ? 0 : done / steps.length,
    evidence: [...(artifact.evidence ?? [])],
    decisions: [...(artifact.decisions ?? [])],
    openQuestions: [...(artifact.openQuestions ?? [])],
  };
}

export function createGoalArtifact({
  id,
  statement,
  owner = null,
  folder = {},
  status = "open",
  phase = null,
  attempts = 0,
  report = null,
  personalDir = null,
  goalsDir = null,
  saveOnCreate = true,
} = {}) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("goal artifact needs an id");
  }
  if (typeof statement !== "string" || statement.trim() === "") {
    throw new Error("goal artifact needs a statement");
  }
  if (!GOAL_STATUSES.includes(status)) {
    throw new Error(`goal status must be one of ${GOAL_STATUSES.join(", ")}`);
  }
  const artifact = {
    id,
    artifactKind: "goal",
    statement,
    owner,
    status,
    phase: phase ?? null,
    attempts: typeof attempts === "number" ? attempts : 0,
    report: report ?? null,
    folder: {
      root: folder.root ?? "",
      tree: folder.tree ?? [],
      open: folder.open ?? [],
      focus: folder.focus ?? null,
      modified: folder.modified ?? [],
    },
    steps: [],
    evidence: [],
    decisions: [],
    openQuestions: [],
    history: [],
    snapshots: [],
    _goalsDir: goalsDirFromOpts({ personalDir, goalsDir }),
  };
  artifact.state = () => goalState(artifact);
  artifact.snapshot = () =>
    deepCopy({
      id: artifact.id,
      artifactKind: artifact.artifactKind,
      statement: artifact.statement,
      owner: artifact.owner,
      status: artifact.status,
      phase: artifact.phase,
      attempts: artifact.attempts,
      report: artifact.report,
      folder: artifact.folder,
      steps: artifact.steps,
      evidence: artifact.evidence,
      decisions: artifact.decisions,
      openQuestions: artifact.openQuestions,
      history: artifact.history,
    });
  artifact.appendHistory = (entry) => {
    artifact.history.push(
      typeof entry === "string"
        ? entry
        : `${entry?.type ?? "event"}: ${JSON.stringify(entry)}`,
    );
    // History is NOT a twin field (no transcript in the twin),
    // so this emits no twin event — but the kernel file, which
    // carries a History section, is rewritten so the file never
    // diverges from the kernel on a history-only change.
    persistGoal(artifact);
    return artifact.history.length;
  };
  artifact.takeSnapshot = (why) => {
    const snap = artifact.snapshot();
    artifact.snapshots.push({ at: new Date().toISOString(), why, snap });
    return snap;
  };
  // Defined-state-attribute write, artifact style: an unknown
  // attribute throws instead of being silently stored. The
  // twin-field mutations below do not go through this (they
  // need their events), but Slice C callers that write goal
  // state generically must use it.
  artifact.setStateAttribute = (name, value) => {
    if (!GOAL_ARTIFACT_STATE_ATTRIBUTES.includes(name)) {
      throw new Error(
        `goal artifact has no state attribute "${name}" (defined: ${GOAL_ARTIFACT_STATE_ATTRIBUTES.join(", ")})`,
      );
    }
    artifact[name] = value;
    return artifact[name];
  };
  artifact.setGoalsDir = (dir) => {
    if (typeof dir !== "string" || dir.trim() === "") {
      throw new Error("goal needs a goals directory");
    }
    artifact._goalsDir = dir;
    return persistGoal(artifact);
  };
  artifact.setPersonalDir = (dir) => {
    if (typeof dir !== "string" || dir.trim() === "") {
      throw new Error("goal needs a personal directory");
    }
    artifact._goalsDir = join(dir, "memory", "goals");
    return persistGoal(artifact);
  };
  artifact.goalFilePath = () =>
    artifact._goalsDir ? join(artifact._goalsDir, `${artifact.id}.goal.md`) : null;
  artifact.saveGoalFile = () => persistGoal(artifact);
  artifact.setStatement = (next) => {
    if (typeof next !== "string" || next.trim() === "") {
      throw new Error("goal.set-statement needs a statement");
    }
    artifact.statement = next;
    artifact.appendHistory(`statement set: ${next}`);
    emitGoal(artifact, "goal:update", { statement: next });
    persistGoal(artifact);
    return artifact.statement;
  };
  artifact.setStatus = (next) => {
    if (!GOAL_STATUSES.includes(next)) {
      throw new Error(
        `goal.set-status must be one of ${GOAL_STATUSES.join(", ")}, got ${JSON.stringify(next)}`,
      );
    }
    artifact.status = next;
    artifact.takeSnapshot(`status -> ${next}`);
    artifact.appendHistory(`status set: ${next}`);
    const event =
      next === "done"
        ? "goal:complete"
        : next === "needs-review"
          ? "goal:needs-review"
          : next === "dismissed"
            ? "goal:dismiss"
            : "goal:update";
    emitGoal(artifact, event, { status: next });
    // Lifecycle is shared: the twin follows the status. For
    // "dismissed" this removes the twin from the registry; the
    // file is still written (kernel history), and loading that
    // file later re-creates a twin that is immediately dismissed
    // (see createGoalTwin / walkFreshTwinTo).
    syncTwinForStatus(artifact, next);
    persistGoal(artifact);
    return artifact.status;
  };
  artifact.complete = () => artifact.setStatus("done");
  artifact.markNeedsReview = () => artifact.setStatus("needs-review");
  artifact.dismiss = () => artifact.setStatus("dismissed");
  // Phase mirror (see header): developer-internal phase label,
  // not a plan and not a tool. Lifecycle stays "running" — a
  // phase change is an event on a running artifact, not a
  // lifecycle transition through the registry table.
  artifact.setPhase = (next) => {
    if (next !== null && (typeof next !== "string" || next.trim() === "")) {
      throw new Error("goal.setPhase needs a phase id or null");
    }
    const from = artifact.phase;
    artifact.phase = next === null ? null : next.trim();
    artifact.appendHistory(`phase: ${from ?? "none"} -> ${artifact.phase ?? "none"}`);
    emitGoal(artifact, "goal:phase", { from, to: artifact.phase });
    persistGoal(artifact);
    return artifact.phase;
  };
  // Critique loop-back: the executing agent failed critique and
  // loops back to plan/execute. Attempts counts loop-backs, not
  // total run attempts — see D-B4.
  artifact.recordLoopBack = (detail = {}) => {
    artifact.attempts += 1;
    artifact.appendHistory(`loop-back: attempt ${artifact.attempts}`);
    emitGoal(artifact, "goal:loop-back", { attempts: artifact.attempts, ...detail });
    persistGoal(artifact);
    return artifact.attempts;
  };
  artifact.setReport = (text) => {
    artifact.report = typeof text === "string" ? text : null;
    artifact.appendHistory(`report set`);
    emitGoal(artifact, "goal:report", { report: artifact.report });
    persistGoal(artifact);
    return artifact.report;
  };
  artifact.addStep = (step) => {
    const entry = {
      id:
        typeof step === "string"
          ? step
          : (step?.id ?? `step-${artifact.steps.length + 1}`),
      text: typeof step === "string" ? step : (step?.text ?? step?.id ?? ""),
      done: false,
    };
    artifact.steps.push(entry);
    artifact.appendHistory(`step added: ${entry.id}`);
    emitGoal(artifact, "goal:add-step", { step: entry });
    persistGoal(artifact);
    return entry;
  };
  artifact.completeStep = (stepId) => {
    const step = artifact.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`goal has no step ${stepId}`);
    }
    step.done = true;
    artifact.appendHistory(`step completed: ${stepId}`);
    emitGoal(artifact, "goal:complete-step", { step: stepId });
    persistGoal(artifact);
    return step;
  };
  artifact.addEvidence = (item) => {
    artifact.evidence.push(item);
    artifact.appendHistory(`evidence added`);
    emitGoal(artifact, "goal:add-evidence", { evidenceCount: artifact.evidence.length });
    persistGoal(artifact);
    return artifact.evidence.length;
  };
  artifact.addDecision = (item) => {
    artifact.decisions.push(item);
    artifact.appendHistory(`decision added`);
    emitGoal(artifact, "goal:add-decision", { decisionsCount: artifact.decisions.length });
    persistGoal(artifact);
    return artifact.decisions.length;
  };
  artifact.addOpenQuestion = (item) => {
    artifact.openQuestions.push(item);
    artifact.appendHistory(`open question added`);
    emitGoal(artifact, "goal:add-open-question", {
      openQuestionsCount: artifact.openQuestions.length,
    });
    persistGoal(artifact);
    return artifact.openQuestions.length;
  };
  // Creation creates the twin in the same call, same id, kind
  // "artifact" / artifactKind "goal" — no goal without a twin.
  createGoalTwin(artifact);
  if (saveOnCreate) {
    persistGoal(artifact);
  }
  return artifact;
}

// Deliver the goal to the executing agent: the kernel object
// plus its ARTIFACT twin's live snapshot, which becomes the goal
// element in the agent's prompt (see loop.js formatGoalElement).
// The snapshot is read at call time, never a stale copy, and it
// carries no history transcript.
export function deliverGoal(goal) {
  if (!goal || typeof goal !== "object" || typeof goal.id !== "string") {
    throw new Error("deliverGoal needs a goal artifact");
  }
  const twin =
    goal.twin ?? getTwin(goal.id, "artifact") ?? getTwin(goal.id, "goal");
  if (!twin) {
    throw new Error(`goal "${goal.id}" has no artifact twin to deliver`);
  }
  const snapshot = twin.snapshot();
  return {
    goal,
    twin,
    snapshot,
    artifactKind: "goal",
    element: formatGoalTwinSnapshot(snapshot),
  };
}

// Render an artifact twin snapshot as the goal element for a
// prompt. Plain data only, no history, no absolute paths.
export function formatGoalTwinSnapshot(snapshot) {
  const snap = snapshot ?? {};
  const steps = Array.isArray(snap.steps) ? snap.steps : [];
  const done = steps.filter((s) => s.done).length;
  const lines = [
    `Goal (artifact twin, artifactKind: goal):`,
    `- id: ${snap.id ?? ""}`,
    `- statement: ${snap.statement ?? ""}`,
    `- status: ${snap.status ?? ""}`,
    `- phase: ${snap.phase ?? "none"}`,
    `- attempts: ${typeof snap.attempts === "number" ? snap.attempts : 0}`,
    `- steps: ${done} of ${steps.length} done`,
  ];
  for (const step of steps) {
    lines.push(`  - [${step.done ? "x" : " "}] ${step.id}: ${step.text ?? ""}`);
  }
  const list = (label, values) => {
    if (!Array.isArray(values) || values.length === 0) {
      lines.push(`- ${label}: none`);
      return;
    }
    lines.push(`- ${label}:`);
    for (const value of values) {
      lines.push(
        `  - ${typeof value === "string" ? value : JSON.stringify(value)}`,
      );
    }
  };
  list("evidence", snap.evidence);
  list("decisions", snap.decisions);
  list("open questions", snap.openQuestions);
  if (snap.folder?.root) {
    lines.push(`- folder root: ${snap.folder.root}`);
  }
  if (snap.report) {
    lines.push(`- report: ${snap.report}`);
  }
  return lines.join("\n");
}

// A Tool for goal.create, for registries that expose it. Its run
// is exactly one call: statement (+id/name) in, goal artifact out.
// onCreate, when given, receives the created artifact (the harness
// uses it to pass the goal to the executing agent).
export function goalCreateTool({ onCreate = null } = {}) {
  return new Tool({
    name: "goal.create",
    description:
      "create a goal from a statement only; no plan, phases, or tool list",
    input: { statement: "the goal statement", id: "goal id (optional)" },
    expectation: "done",
    run: async (input) => {
      const goal = createGoal(input ?? {});
      if (typeof onCreate === "function") {
        onCreate(goal);
      }
      return { id: goal.id, statement: goal.statement, status: goal.status };
    },
  });
}

// Tools attached to a goal artifact (see the header: statement /
// status / steps / evidence only — no phase tools exist anymore).
// NOTE (D-B2): decisions / openQuestions have artifact METHODS
// (addDecision / addOpenQuestion) but NO goal.* tools here, so
// the existing 5-tool list — and the test that asserts it — is
// unchanged. Whether the model should get goal.add-decision /
// goal.add-open-question tools is a recorded doubt, not a guess.
export function goalTools(artifact) {
  return [
    new Tool({
      name: "goal.set-statement",
      description: "set the goal statement",
      input: { statement: "the new goal statement" },
      expectation: "done",
      run: async (input) => ({
        statement: artifact.setStatement(input?.statement),
      }),
    }),
    new Tool({
      name: "goal.set-status",
      description:
        'set the goal status ("open", "done", "needs-review", or "dismissed")',
      input: { status: "the new status" },
      expectation: "done",
      run: async (input) => ({ status: artifact.setStatus(input?.status) }),
    }),
    new Tool({
      name: "goal.add-step",
      description: "add a step to the goal during execution",
      input: { step: "the step id or text" },
      expectation: "done",
      run: async (input) => artifact.addStep(input?.step ?? input?.text),
    }),
    new Tool({
      name: "goal.complete-step",
      description: "mark a goal step done",
      input: { step: "the step id" },
      expectation: "done",
      run: async (input) => artifact.completeStep(input?.step),
    }),
    new Tool({
      name: "goal.add-evidence",
      description: "add evidence to the goal",
      input: { evidence: "the evidence" },
      expectation: "done",
      run: async (input) => {
        artifact.addEvidence(input?.evidence);
        return { evidenceCount: artifact.evidence.length };
      },
    }),
  ];
}

function registryList(registry) {
  if (Array.isArray(registry)) {
    return registry;
  }
  if (registry && Array.isArray(registry.tools)) {
    return registry.tools;
  }
  return null;
}

export function loadGoalArtifact(registry, artifact) {
  const list = registryList(registry);
  if (!list) {
    throw new Error("loadGoalArtifact needs a tool array or registry");
  }
  const tools = goalTools(artifact);
  for (const tool of tools) {
    if (!list.some((entry) => entry.name === tool.name)) {
      list.push(tool);
    }
  }
  return {
    artifact,
    tools,
    unload: () => unloadGoalArtifact(registry, artifact),
  };
}

export function unloadGoalArtifact(registry, artifact) {
  const list = registryList(registry);
  if (!list) {
    return 0;
  }
  const names = new Set(goalTools(artifact).map((t) => t.name));
  let removed = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (names.has(list[i]?.name)) {
      list.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}

// Markdown file form, for restart: the artifact twin's defined
// state attributes, in sections. No "Phases" section exists in
// this form (see the correction) — the singular header field is
// "- phase:", the mirror of the developer's current phase.
// Lists that are empty are written as "- none" so an empty list
// round-trips as empty, not as a spurious "none" item.
export function goalFileText(artifact) {
  const lines = [
    `# Goal: ${artifact.id}`,
    "",
    `- statement: ${artifact.statement}`,
    `- owner: ${artifact.owner ?? ""}`,
    `- status: ${artifact.status ?? "open"}`,
    `- phase: ${artifact.phase ?? ""}`,
    `- attempts: ${typeof artifact.attempts === "number" ? artifact.attempts : 0}`,
    "",
    "## Steps",
  ];
  if (!artifact.steps || artifact.steps.length === 0) {
    lines.push("- none");
  } else {
    for (const step of artifact.steps) {
      lines.push(`- [${step.done ? "x" : " "}] ${step.id}: ${step.text}`);
    }
  }
  lines.push("");
  const listSection = (title, values) => {
    lines.push(`## ${title}`);
    if (!values || values.length === 0) {
      lines.push("- none");
    } else {
      for (const value of values) {
        lines.push(
          `- ${typeof value === "string" ? value : JSON.stringify(value)}`,
        );
      }
    }
    lines.push("");
  };
  listSection("Evidence", artifact.evidence);
  listSection("Decisions", artifact.decisions);
  listSection("Open Questions", artifact.openQuestions);
  const folder = artifact.folder ?? {};
  lines.push("## Folder");
  lines.push(`- root: ${folder.root ?? ""}`);
  lines.push(`- tree: ${JSON.stringify(folder.tree ?? [])}`);
  lines.push(`- open: ${JSON.stringify(folder.open ?? [])}`);
  lines.push(`- focus: ${JSON.stringify(folder.focus ?? null)}`);
  lines.push(`- modified: ${JSON.stringify(folder.modified ?? [])}`);
  lines.push("");
  lines.push("## Report");
  lines.push(artifact.report ? String(artifact.report) : "- none");
  lines.push("");
  lines.push("## History");
  if (!artifact.history || artifact.history.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of artifact.history) {
      lines.push(`- ${entry}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function writeGoalArtifactFile(dir, artifact) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${artifact.id}.goal.md`);
  writeFileSync(path, goalFileText(artifact), "utf8");
  // Writing explicitly to a dir wires that dir as the artifact's
  // persistence dir, so later mutations rewrite the same file.
  if (artifact && typeof artifact === "object") {
    artifact._goalsDir = dir;
  }
  return path;
}

function parseListValue(raw) {
  const text = raw.trim();
  if (text === "" || text === "none") {
    return null;
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

// Section-aware parser for goalFileText(). Returns a plain
// kernel-data object (not yet an artifact); the loaders below
// turn it into an artifact + artifact twin.
export function parseGoalFileText(text) {
  const raw = String(text ?? "");
  const idMatch = raw.match(/^# Goal:\s*(.+)$/m);
  const header = raw.split(/^## /m)[0] ?? "";
  const field = (name) => {
    const match = header.match(new RegExp(`^- ${name}:\\s*(.*)$`, "m"));
    return match ? match[1].trim() : null;
  };
  const data = {
    id: idMatch ? idMatch[1].trim() : "goal",
    statement: field("statement") ?? "",
    owner: field("owner") || null,
    status: field("status") || "open",
    phase: field("phase") || null,
    attempts: Number.parseInt(field("attempts") ?? "0", 10) || 0,
    steps: [],
    evidence: [],
    decisions: [],
    openQuestions: [],
    folder: { root: "", tree: [], open: [], focus: null, modified: [] },
    report: null,
    history: [],
  };
  if (!GOAL_STATUSES.includes(data.status)) {
    data.status = "open";
  }
  let section = null;
  const reportLines = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = rawLine.match(/^## (.+)$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }
    if (section === null) {
      continue;
    }
    if (section === "steps") {
      const match = line.match(/^- \[(x| )\] ([^:]+):\s*(.*)$/);
      if (match) {
        data.steps.push({
          id: match[2].trim(),
          text: match[3].trim(),
          done: match[1] === "x",
        });
      }
      continue;
    }
    if (section === "report") {
      reportLines.push(rawLine);
      continue;
    }
    if (section === "folder") {
      const root = line.match(/^- root:\s*(.*)$/);
      if (root) {
        data.folder.root = root[1].trim();
        continue;
      }
      const jsonField = line.match(/^- (tree|open|focus|modified):\s*(.*)$/);
      if (jsonField) {
        try {
          data.folder[jsonField[1]] = JSON.parse(jsonField[2]);
        } catch {
          // Keep the default for that field.
        }
        continue;
      }
      continue;
    }
    const target =
      section === "evidence"
        ? data.evidence
        : section === "decisions"
          ? data.decisions
          : section === "open questions"
            ? data.openQuestions
            : section === "history"
              ? data.history
              : null;
    if (target && line.startsWith("- ")) {
      const value = parseListValue(line.slice(2));
      if (value !== null) {
        target.push(value);
      }
    }
  }
  const reportText = reportLines.join("\n").trim();
  data.report = reportText === "" || reportText === "- none" ? null : reportText;
  return data;
}

function artifactFromParsed(data, fileDir) {
  const artifact = createGoalArtifact({
    id: data.id,
    statement: data.statement,
    owner: data.owner,
    folder: data.folder,
    status: data.status,
    phase: data.phase,
    attempts: data.attempts,
    report: data.report,
    saveOnCreate: false,
  });
  // Restore steps / lists / history in file order, without
  // re-emitting events or rewriting the file on load: load
  // writes nothing (the file is already the source of truth).
  // Steps are pushed directly so their done flags survive.
  artifact.steps = data.steps.map((step) => ({ ...step }));
  artifact.evidence = [...data.evidence];
  artifact.decisions = [...data.decisions];
  artifact.openQuestions = [...data.openQuestions];
  artifact.history = [...data.history];
  // Wiring the persistence dir (without a save) means the next
  // mutation rewrites exactly this file.
  if (fileDir) {
    artifact._goalsDir = fileDir;
  }
  return artifact;
}

export function loadGoalArtifactFile(path) {
  if (!existsSync(path)) {
    return null;
  }
  const data = parseGoalFileText(readFileSync(path, "utf8"));
  return artifactFromParsed(data, dirname(path));
}

// Load a goal + its artifact-kind twin from a goal file.
// pathOrDir may be:
//   - a <id>.goal.md file path, or
//   - a directory holding <id>.goal.md (with id given), or
//   - a personal directory (with id given: <dir>/memory/goals/
//     <id>.goal.md), or
//   - a directory holding exactly one *.goal.md (id optional).
// Returns null for a missing file path; throws plainly for an
// ambiguous directory (more than one goal file, no id given).
export function loadGoalFromFile(pathOrDir, id = null) {
  if (typeof pathOrDir !== "string" || pathOrDir.trim() === "") {
    throw new Error("loadGoalFromFile needs a file path or directory");
  }
  const target = pathOrDir.trim();
  let file = null;
  if (existsSync(target)) {
    const stat = statSync(target);
    if (stat.isFile()) {
      file = target;
    } else if (stat.isDirectory()) {
      const candidates = [];
      if (id) {
        candidates.push(join(target, `${id}.goal.md`));
        candidates.push(join(target, "memory", "goals", `${id}.goal.md`));
      }
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          file = candidate;
          break;
        }
      }
      if (!file) {
        const direct = readdirSync(target).filter((n) => n.endsWith(".goal.md"));
        const nestedDir = join(target, "memory", "goals");
        const nested = existsSync(nestedDir)
          ? readdirSync(nestedDir).filter((n) => n.endsWith(".goal.md"))
          : [];
        const all = [
          ...direct.map((n) => join(target, n)),
          ...nested.map((n) => join(nestedDir, n)),
        ];
        if (all.length === 1) {
          file = all[0];
        } else if (all.length > 1) {
          throw new Error(
            `loadGoalFromFile: directory ${target} holds ${all.length} goal files — pass an id`,
          );
        }
      }
    }
  } else if (id) {
    // A not-yet-existing path with an id is treated as a missing
    // file, not an error, like loadGoalArtifactFile.
    file = null;
  }
  if (!file) {
    return null;
  }
  const data = parseGoalFileText(readFileSync(file, "utf8"));
  return artifactFromParsed(data, dirname(file));
}
