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
//     agent.currentPhase), never in the goal artifact.
//   - What the goal artifact DOES keep: statement, status, live
//     folder for that goal, steps (added during execution, never
//     pre-filled), evidence, decisions, openQuestions, history,
//     and snapshots (deep copies, taken on status change).
//   - Tools to change a goal, loaded by loadGoalArtifact():
//     goal.set-statement, goal.add-step, goal.complete-step,
//     goal.set-status, goal.add-evidence. Nothing phase-shaped.
//
// Folder: { root, tree, open, focus, modified }. The tree comes
// from the files tool, which already gitignore-filters tree/list/
// search/expand views. An explicit open of a named path is the
// documented exception (see files.js): it is not gitignore-
// filtered, only safety-refused. Gitignored files are NEVER
// loaded into the file artifact through a view.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

export function createGoal(input = {}) {
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
  return createGoalArtifact({ id, statement: statement.trim() });
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
} = {}) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("goal artifact needs an id");
  }
  if (typeof statement !== "string" || statement.trim() === "") {
    throw new Error("goal artifact needs a statement");
  }
  const artifact = {
    id,
    statement,
    owner,
    status: "open",
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
  };
  artifact.state = () => goalState(artifact);
  artifact.snapshot = () =>
    deepCopy({
      id: artifact.id,
      statement: artifact.statement,
      owner: artifact.owner,
      status: artifact.status,
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
    return artifact.history.length;
  };
  artifact.takeSnapshot = (why) => {
    const snap = artifact.snapshot();
    artifact.snapshots.push({ at: new Date().toISOString(), why, snap });
    return snap;
  };
  artifact.setStatement = (next) => {
    if (typeof next !== "string" || next.trim() === "") {
      throw new Error("goal.set-statement needs a statement");
    }
    artifact.statement = next;
    artifact.appendHistory(`statement set: ${next}`);
    return artifact.statement;
  };
  artifact.setStatus = (next) => {
    if (next !== "open" && next !== "done") {
      throw new Error(
        `goal.set-status must be "open" or "done", got ${JSON.stringify(next)}`,
      );
    }
    artifact.status = next;
    artifact.takeSnapshot(`status -> ${next}`);
    artifact.appendHistory(`status set: ${next}`);
    return artifact.status;
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
    return entry;
  };
  artifact.completeStep = (stepId) => {
    const step = artifact.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`goal has no step ${stepId}`);
    }
    step.done = true;
    artifact.appendHistory(`step completed: ${stepId}`);
    return step;
  };
  artifact.addEvidence = (item) => {
    artifact.evidence.push(item);
    return artifact.evidence.length;
  };
  artifact.addDecision = (item) => {
    artifact.decisions.push(item);
    return artifact.decisions.length;
  };
  return artifact;
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
      description: 'set the goal status ("open" or "done")',
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

// Markdown file form, for restart: statement + status + steps.
// No phases section exists in this form (see the correction).
export function goalFileText(artifact) {
  const lines = [
    `# Goal: ${artifact.id}`,
    "",
    `- statement: ${artifact.statement}`,
    `- owner: ${artifact.owner ?? ""}`,
    `- status: ${artifact.status ?? "open"}`,
    "",
    "## Steps",
  ];
  for (const step of artifact.steps) {
    lines.push(`- [${step.done ? "x" : " "}] ${step.id}: ${step.text}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeGoalArtifactFile(dir, artifact) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${artifact.id}.goal.md`);
  writeFileSync(path, goalFileText(artifact), "utf8");
  return path;
}

export function loadGoalArtifactFile(path) {
  if (!existsSync(path)) {
    return null;
  }
  const text = readFileSync(path, "utf8");
  const idMatch = text.match(/^# Goal:\s*(.+)$/m);
  const statementMatch = text.match(/^- statement:\s*(.+)$/m);
  const ownerMatch = text.match(/^- owner:\s*(.*)$/m);
  const statusMatch = text.match(/^- status:\s*(.*)$/m);
  const artifact = createGoalArtifact({
    id: idMatch ? idMatch[1].trim() : "goal",
    statement: statementMatch ? statementMatch[1].trim() : "",
    owner: ownerMatch?.[1]?.trim() || null,
  });
  if (statusMatch?.[1]?.trim() === "done") {
    artifact.status = "done";
  }
  for (const match of text.matchAll(/^- \[(x| )\] ([^:]+):\s*(.*)$/gm)) {
    const step = artifact.addStep({
      id: match[2].trim(),
      text: match[3].trim(),
    });
    if (match[1] === "x") {
      step.done = true;
    }
  }
  return artifact;
}
