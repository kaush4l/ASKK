// Slice B tests — goal as an ARTIFACT-KIND twin (correction
// 2026-11-04 12:46 EST: core kinds are engine, tool, artifact
// only; goal is an artifact kind, NOT a separate kernel kind).
// The goal twin is therefore registry kind "artifact" with
// artifactKind "goal" (see goal-artifact.js
// GOAL_ARTIFACT_TWIN_DEFINITION), sharing the artifact twin's
// snapshotFields mechanism, defined state attributes, shared
// lifecycle, and kernel-file persistence — not a parallel goal
// persistence scheme. No chat transcript is in the twin: the
// snapshot excludes history; engine loop state (current phase,
// current tool call, subagents, waiting/running/done) is Slice A
// / core verification, not this slice.
//
// The four-part twin test, as specified:
//   (1) goal.create -> artifact twin exists, same id;
//   (2) updated via event -> snapshot updates, no refetch, no
//       new kernel object;
//   (3) complete / needs-review / dismiss -> lifecycle updates
//       to done / needs-review, twin removed on dismiss;
//   (4) restart -> clear registry, loadGoalFromFile from the
//       written .goal.md -> goal + artifact twin re-created
//       with statement/status/steps/evidence/decisions/
//       openQuestions/phase/attempts/report exactly matching.
//
// EVENT -> TWIN UPDATE TABLE (event-driven: each mutation
// emits, and a listener re-reading snapshot() on the event sees
// the new state; nothing polls or refetches):
//   goal:add-step         -> steps gains the step
//   goal:complete-step    -> that step.done becomes true
//   goal:add-evidence     -> evidence grows
//   goal:add-decision     -> decisions grows
//   goal:add-open-question -> openQuestions grows
//   goal:phase            -> phase changes; lifecycle stays
//                            "running" (phase mirror, not a
//                            lifecycle transition)
//   goal:loop-back        -> attempts increments
//   goal:report           -> report changes
//   goal:update           -> set-statement / reopen re-read
//   goal:complete         -> status done, lifecycle done
//   goal:needs-review     -> status needs-review, lifecycle
//                            needs-review
//   goal:dismiss          -> twin removed from registry
// GAPS (recorded, not covered by polling):
//   G1. Direct writes to goal.folder.* emit no event and write
//       no file — folder mutation has no goal method yet, so a
//       direct folder write is invisible to the twin until the
//       next twin-field mutation persists the file. The twin
//       snapshot would still read the new folder on its next
//       snapshot() call, but no event drives a UI update.
//   G2. History-only appends emit no twin event by design
//       (history is not a twin field), though the file IS
//       rewritten on appendHistory so kernel and file agree.
//
// DOUBTS (recorded, not guessed — for Kaushal / coordinator):
//   D-B1. Bare createGoal with no personalDir/goalsDir creates
//       the twin but writes NO file (no cwd personal/ invented).
//       The harness supplies desk.location as personalDir, so
//       the production path writes immediately. Is the opt-in
//       acceptable, or should bare createGoal default to
//       process.cwd()/personal/memory/goals?
//   D-B2. Decisions / openQuestions have artifact METHODS
//       (addDecision / addOpenQuestion) but NO goal.* tools, so
//       the existing 5-tool list is unchanged. Should the model
//       get goal.add-decision / goal.add-open-question tools?
//   D-B3. createGoal ignores (does not refuse) singular
//       phase / attempts / report inputs — only the listed
//       refused keys (phases, plan, tools, ...) throw. Those
//       fields are set only via artifact methods / file load.
//       Should createGoal refuse them too?
//   D-B4. attempts counts LOOP-BACKS, not total run attempts:
//       a harness run with 2 attempts and 1 critique failure
//       shows goal.attempts = 1. Which should the twin show?
//   D-B5. Slice C's generic artifact definition will share
//       registry kind "artifact" with this goal definition.
//       This module holds a direct definition reference, so
//       goal snapshots are stable, but getTwinDefinition(
//       "artifact") returns whichever definition registered
//       last. Slice C / the coordinator must reconcile this
//       (merge, or make the goal definition delegate) — and
//       FUNCTION_FIELD_NAMES.artifact in kernel-twin.js must be
//       merged, never overwritten, if C adds generic-artifact
//       function fields.
//   D-B6. A dismissed goal's file REMAINS on disk, and loading
//       it re-creates a twin that is immediately dismissed (no
//       live registry entry). Should a dismissed goal's file be
//       purged instead, or is the dismissed file the history?
//   D-B7. The .goal.md format extends the old format with
//       Evidence / Decisions / Open Questions / Folder /
//       Report / History sections; the old parser still reads
//       statement/status/steps from it. Statement stays a
//       single header line (the old limitation — a multiline
//       statement's later lines are not round-tripped), while
//       report is a full section and round-trips multiline.
//       Is that split acceptable, or should statement move to
//       a section too?
//   D-B8. goal.phase mirrors the developer's current internal
//       phase for twin display. Engine loop state (Slice A /
//       core) is the authoritative loop view. Should goal.phase
//       be dropped in favour of the engine twin alone, or is
//       the mirror wanted on the goal artifact twin?

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GOAL_ARTIFACT_TWIN_DEFINITION,
  createGoal,
  createGoalArtifact,
  deliverGoal,
  loadGoalFromFile,
} from "./goal-artifact.js";
import { createCoreTools } from "./core-tools.js";
import { createHarness } from "./harness.js";
import {
  clearTwinRegistry,
  getTwin,
  getTwinDefinition,
} from "./kernel-twin.js";
import { runLoop } from "./loop.js";
import { Tool } from "./tool.js";

function tempPersonal() {
  return mkdtempSync(join(tmpdir(), "askk-goal-twin-"));
}

describe("goal twin — artifact kind (Slice B)", () => {
  test("(1) goal.create -> artifact twin exists in registry with same id", () => {
    clearTwinRegistry();
    const personal = tempPersonal();
    const goal = createGoal(
      { id: "g-twin-1", statement: "build the thing" },
      { personalDir: personal },
    );
    // Kind is "artifact", discriminator is artifactKind "goal"
    // — not a separate "goal" kernel kind.
    expect(goal.artifactKind).toBe("goal");
    expect(goal.twin.kind).toBe("artifact");
    expect(goal.twin.artifactKind).toBe("goal");
    expect(goal.twin.id).toBe("g-twin-1");
    expect(goal.twin.kernelId).toBe("g-twin-1");
    expect(goal.twin.lifecycle).toBe("running");
    expect(getTwin("g-twin-1", "artifact")).toBe(goal.twin);
    expect(getTwin("g-twin-1", "goal")).toBeNull();
    const snap = goal.twin.snapshot();
    expect(snap.kind).toBe("artifact");
    expect(snap.artifactKind).toBe("goal");
    expect(snap.statement).toBe("build the thing");
    expect(snap.status).toBe("open");
    expect(snap.steps).toEqual([]);
    expect(snap.phase).toBeNull();
    expect(snap.attempts).toBe(0);
    expect(snap.report).toBeNull();
    // No history transcript in the twin snapshot.
    expect("history" in snap).toBe(false);
    // File written immediately on create, under personal only.
    const file = join(personal, "memory", "goals", "g-twin-1.goal.md");
    expect(goal.goalFilePath()).toBe(file);
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("build the thing");
    expect(text).not.toContain("Phases");
    expect(text).not.toContain("public/defaults");
    // The artifact-kind definition is importable and is kind
    // "artifact" (the Slice C reconciliation point, D-B5).
    expect(GOAL_ARTIFACT_TWIN_DEFINITION.kind).toBe("artifact");
    expect(getTwinDefinition("artifact")).toBe(GOAL_ARTIFACT_TWIN_DEFINITION);
  });

  test("(2) updated via event -> twin snapshot updates, no refetch, no new goal", () => {
    clearTwinRegistry();
    const personal = tempPersonal();
    const goal = createGoal(
      { id: "g-twin-2", statement: "event driven goal" },
      { personalDir: personal },
    );
    const twin = goal.twin;
    const seen = [];
    twin.subscribe("*", (_detail, record) => {
      seen.push([record.type, twin.snapshot()]);
    });
    goal.addStep("step-1");
    goal.addEvidence("evidence-1");
    goal.addDecision("decision-1");
    goal.addOpenQuestion("question-1");
    goal.setPhase("execute");
    goal.recordLoopBack();
    goal.completeStep("step-1");
    const after = twin.snapshot();
    expect(after.steps).toEqual([
      { id: "step-1", text: "step-1", done: true },
    ]);
    expect(after.evidence).toEqual(["evidence-1"]);
    expect(after.decisions).toEqual(["decision-1"]);
    expect(after.openQuestions).toEqual(["question-1"]);
    expect(after.phase).toBe("execute");
    expect(after.attempts).toBe(1);
    // Every mutation drove an event, and the listener's snapshot
    // at that event already showed the new state.
    const types = seen.map(([type]) => type);
    for (const expected of [
      "goal:add-step",
      "goal:add-evidence",
      "goal:add-decision",
      "goal:add-open-question",
      "goal:phase",
      "goal:loop-back",
      "goal:complete-step",
    ]) {
      expect(types).toContain(expected);
    }
    const stepSnap = seen.find(([type]) => type === "goal:add-step")?.[1];
    expect(stepSnap.steps).toHaveLength(1);
    const phaseSnap = seen.find(([type]) => type === "goal:phase")?.[1];
    expect(phaseSnap.phase).toBe("execute");
    // No refetch, no new kernel object: same goal, same twin.
    expect(twin.snapshot().id).toBe(goal.id);
    expect(getTwin("g-twin-2", "artifact")).toBe(twin);
    // The file was rewritten on every mutation (kernel
    // persistence, not a twin copy).
    const text = readFileSync(goal.goalFilePath(), "utf8");
    expect(text).toContain("evidence-1");
    expect(text).toContain("decision-1");
    expect(text).toContain("question-1");
    expect(text).toContain("- phase: execute");
    expect(text).toContain("- attempts: 1");
  });

  test("(3) complete / needs-review -> lifecycle updates; dismiss -> twin removed", () => {
    clearTwinRegistry();
    const personal = tempPersonal();
    const doneGoal = createGoal(
      { id: "g-done", statement: "finish me" },
      { personalDir: personal },
    );
    doneGoal.complete();
    expect(doneGoal.status).toBe("done");
    expect(doneGoal.twin.lifecycle).toBe("done");
    expect(doneGoal.twin.snapshot().lifecycle).toBe("done");
    // Terminal twins cannot transition out by registry rule;
    // reopening re-creates the twin (supersede), same id.
    doneGoal.setStatus("open");
    expect(doneGoal.status).toBe("open");
    expect(doneGoal.twin.lifecycle).toBe("running");
    expect(getTwin("g-done", "artifact")).toBe(doneGoal.twin);

    const reviewGoal = createGoal(
      { id: "g-review", statement: "review me" },
      { personalDir: personal },
    );
    reviewGoal.markNeedsReview();
    expect(reviewGoal.status).toBe("needs-review");
    expect(reviewGoal.twin.lifecycle).toBe("needs-review");

    const dismissedGoal = createGoal(
      { id: "g-dismiss", statement: "drop me" },
      { personalDir: personal },
    );
    dismissedGoal.dismiss();
    expect(dismissedGoal.status).toBe("dismissed");
    expect(dismissedGoal.twin.lifecycle).toBe("dismissed");
    expect(getTwin("g-dismiss", "artifact")).toBeNull();
  });

  test("(4) restart -> file load re-creates goal + artifact twin exactly", () => {
    clearTwinRegistry();
    const personal = tempPersonal();
    const goal = createGoalArtifact({
      id: "g-restart",
      statement: "persist me exactly",
      folder: { root: "work" },
      personalDir: personal,
    });
    goal.addStep("step-1");
    goal.addStep("step-2");
    goal.completeStep("step-1");
    goal.addEvidence("proof-1");
    goal.addDecision("choice-1");
    goal.addOpenQuestion("open-1");
    goal.setPhase("execute");
    goal.recordLoopBack();
    goal.recordLoopBack();
    goal.setReport("Done: first pass");
    const before = goal.twin.snapshot();
    const file = goal.goalFilePath();
    expect(existsSync(file)).toBe(true);

    // Simulated restart: registry empty, kernel file untouched.
    clearTwinRegistry();
    expect(getTwin("g-restart", "artifact")).toBeNull();
    const restored = loadGoalFromFile(file);
    expect(restored).not.toBe(goal);
    expect(restored.twin).not.toBe(goal.twin);
    expect(restored.twin.kind).toBe("artifact");
    expect(restored.twin.artifactKind).toBe("goal");
    expect(restored.twin.lifecycle).toBe("running");
    const after = restored.twin.snapshot();
    // Exact match on the whole artifact twin snapshot (history
    // is not a twin field, so it is not part of this equality).
    expect(after).toEqual(before);
    expect(after.statement).toBe("persist me exactly");
    expect(after.status).toBe("open");
    expect(after.steps).toEqual([
      { id: "step-1", text: "step-1", done: true },
      { id: "step-2", text: "step-2", done: false },
    ]);
    expect(after.evidence).toEqual(["proof-1"]);
    expect(after.decisions).toEqual(["choice-1"]);
    expect(after.openQuestions).toEqual(["open-1"]);
    expect(after.phase).toBe("execute");
    expect(after.attempts).toBe(2);
    expect(after.report).toBe("Done: first pass");
    expect(after.folder.root).toBe("work");

    // The directory + id form finds the same file, and a
    // personal-dir + id form finds it under memory/goals.
    clearTwinRegistry();
    const viaDir = loadGoalFromFile(join(personal, "memory", "goals"), "g-restart");
    expect(viaDir.twin.snapshot()).toEqual(before);
    clearTwinRegistry();
    const viaPersonal = loadGoalFromFile(personal, "g-restart");
    expect(viaPersonal.twin.snapshot()).toEqual(before);
    // A mutation after restart rewrites the same file.
    viaPersonal.addEvidence("proof-2");
    expect(readFileSync(file, "utf8")).toContain("proof-2");
    expect(loadGoalFromFile(join(personal, "no-such-dir-xyz"), "g-restart")).toBeNull();
  });

  test("deliverGoal: kernel + artifact twin snapshot as the prompt goal element, no transcript", () => {
    clearTwinRegistry();
    const personal = tempPersonal();
    const goal = createGoal(
      { id: "g-deliver", statement: "deliver me" },
      { personalDir: personal },
    );
    goal.addStep("step-1");
    goal.addEvidence("proof-1");
    goal.addOpenQuestion("q-1");
    goal.setPhase("execute");
    goal.appendHistory("unique-history-marker-xyz");
    const delivered = deliverGoal(goal);
    expect(delivered.goal).toBe(goal);
    expect(delivered.twin).toBe(goal.twin);
    expect(delivered.artifactKind).toBe("goal");
    expect(delivered.snapshot).toEqual(goal.twin.snapshot());
    expect(delivered.element).toContain("deliver me");
    expect(delivered.element).toContain("status: open");
    expect(delivered.element).toContain("step-1");
    expect(delivered.element).toContain("proof-1");
    expect(delivered.element).toContain("q-1");
    expect(delivered.element).toContain("phase: execute");
    expect(delivered.element).not.toContain("unique-history-marker-xyz");
    expect(delivered.element).not.toContain("History");
  });

  test("loop delivery: runLoop carries the live goal element, per run, not a stale snapshot", async () => {
    clearTwinRegistry();
    const personal = tempPersonal();
    const goal = createGoal(
      { id: "g-loop", statement: "loop goal" },
      { personalDir: personal },
    );
    const seen = [];
    const model = {
      infer: async (messages) => {
        seen.push(messages.map((m) => String(m.content ?? "")).join("\n"));
        return "answer: done";
      },
    };
    await runLoop({ registry: [], inference: model, prompt: "base", goal });
    expect(seen[0]).toContain("Goal (artifact twin");
    expect(seen[0]).toContain("loop goal");
    expect(seen[0]).toContain("phase: none");
    // Live, not stale: a step + phase added after the first run
    // appear in the second run's goal element.
    goal.setPhase("execute");
    goal.addStep("fresh-step");
    await runLoop({ registry: [], inference: model, prompt: "base", goal });
    expect(seen[1]).toContain("fresh-step");
    expect(seen[1]).toContain("phase: execute");
  });

  test("harness delivery: developer receives goal kernel + artifact twin snapshot in its prompt", async () => {
    clearTwinRegistry();
    const workspaceDir = mkdtempSync(join(tmpdir(), "askk-goal-twin-work-"));
    const personalDir = mkdtempSync(join(tmpdir(), "askk-goal-twin-desk-"));
    const core = createCoreTools({ filesLocation: workspaceDir });
    const mockTerminal = new Tool({
      name: "terminal.run",
      description: "mocked terminal run",
      input: { command: "the command" },
      expectation: "done",
      run: async () => ({ exit: 0, output: "mocked tests pass" }),
    });
    const tools = [
      ...core.tools.filter((tool) => !tool.name.startsWith("terminal.")),
      mockTerminal,
    ];
    const desk = {
      location: personalDir,
      soul: "Harness soul.",
      tools,
      coreTools: core,
      listTools: () => tools.map((tool) => tool.spec()),
      inferences: [],
      defaultInference: null,
      engine: { instructions: "Harness soul.", inference: null },
    };
    const harness = createHarness(desk);
    const prompts = [];
    const model = {
      infer: async (messages) => {
        const text = messages.map((m) => String(m.content ?? "")).join("\n");
        prompts.push(text);
        if (text.includes("plan the work")) return "plan: explore files";
        if (text.includes("execute the plan")) return "executed: work done";
        if (text.includes("critique the executed")) return "critique: pass — correct";
        return "answer: unknown phase";
      },
    };
    const result = await harness.ask("change the widget", { inference: model });
    expect(result.goalCreateCalls).toBe(1);
    expect("phases" in result.goal).toBe(false);
    expect(result.goal.status).toBe("done");
    expect(result.goalTwin.kind).toBe("artifact");
    expect(result.goalTwin.artifactKind).toBe("goal");
    expect(result.goalTwin.statement).toContain("change the widget");
    expect(result.deliveredGoal.snapshot.id).toBe(result.goal.id);
    expect(result.goalElement).toContain("change the widget");
    // At least one phase prompt carried the goal element, not
    // just the raw owner request in the engine prompt.
    expect(prompts.some((text) => text.includes("Goal (artifact twin"))).toBe(true);
    expect(prompts.some((text) => text.includes("change the widget"))).toBe(true);
    // The goal file was written under the desk (personal) dir.
    expect(
      existsSync(join(personalDir, "memory", "goals", "goal.goal.md")),
    ).toBe(true);
  });

  test("statement-only is preserved; defined state attributes only", () => {
    clearTwinRegistry();
    expect(() => createGoal({ statement: "x", phases: [] })).toThrow(
      /statement only/,
    );
    const goal = createGoal({ statement: "attrs" });
    expect("phases" in goal).toBe(false);
    expect(() => goal.setStateAttribute("surprise", 1)).toThrow(
      /no state attribute/,
    );
    expect(goal.setStateAttribute("phase", "execute")).toBe("execute");
  });
});
