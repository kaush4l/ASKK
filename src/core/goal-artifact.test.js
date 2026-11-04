import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGoal,
  goalTools,
  loadGoalArtifact,
  loadGoalArtifactFile,
  unloadGoalArtifact,
  writeGoalArtifactFile,
} from "./goal-artifact.js";

describe("goal.create: statement only, by design", () => {
  test("goal.create({statement}) succeeds", () => {
    const goal = createGoal({ statement: "add a feature" });
    expect(goal.statement).toBe("add a feature");
    expect(goal.status).toBe("open");
  });

  test("goal.create with phases, plan, or a tool list is REFUSED, not silently ignored", () => {
    expect(() => createGoal({ statement: "x", phases: [] })).toThrow(
      /statement only/,
    );
    expect(() => createGoal({ statement: "x", plan: "step 1" })).toThrow(
      /statement only/,
    );
    expect(() => createGoal({ statement: "x", tools: ["files.read"] })).toThrow(
      /statement only/,
    );
    expect(() =>
      createGoal({ statement: "x", allowedTools: ["files.read"] }),
    ).toThrow(/statement only/);
    expect(() => createGoal({})).toThrow(/needs a statement/);
    expect(() => createGoal({ statement: "   " })).toThrow(/needs a statement/);
  });

  test("the created goal artifact has NO harness-written phases field", () => {
    const goal = createGoal({ id: "g1", statement: "do it" });
    expect("phases" in goal).toBe(false);
    expect(goal.snapshot()).not.toHaveProperty("phases");
  });

  test("goal tools are statement/status/steps/evidence only — no set-phase or next-phase tool exists", () => {
    const goal = createGoal({ statement: "do it" });
    const names = goalTools(goal).map((tool) => tool.name);
    expect(names).toEqual([
      "goal.set-statement",
      "goal.set-status",
      "goal.add-step",
      "goal.complete-step",
      "goal.add-evidence",
    ]);
    expect(names).not.toContain("goal.set-phase");
    expect(names).not.toContain("goal.next-phase");
  });

  test("goal tools load on load, leave on unload; status change snapshots", async () => {
    const goal = createGoal({ statement: "do it" });
    const registry = [];
    const loaded = loadGoalArtifact(registry, goal);
    expect(registry.map((t) => t.name)).toContain("goal.set-statement");
    await registry
      .find((t) => t.name === "goal.add-step")
      .run({ step: "step-1" });
    await registry
      .find((t) => t.name === "goal.complete-step")
      .run({ step: "step-1" });
    expect(goal.state().stepsDone).toBe(1);
    expect(goal.state().progress).toBe(1);
    goal.setStatus("done");
    expect(goal.snapshots.length).toBeGreaterThan(0);
    expect(unloadGoalArtifact(registry, goal)).toBe(5);
    expect(registry).toHaveLength(0);
    expect(loaded.tools).toHaveLength(5);
  });

  test("goal survives a markdown round-trip (restart form), with no phases", () => {
    const goal = createGoal({ id: "g2", statement: "persist me" });
    goal.addStep("step-1");
    goal.completeStep("step-1");
    const dir = mkdtempSync(join(tmpdir(), "askk-goal-"));
    const path = writeGoalArtifactFile(dir, goal);
    const restored = loadGoalArtifactFile(path);
    expect(restored.statement).toBe("persist me");
    expect(restored.state().stepsDone).toBe(1);
    expect("phases" in restored).toBe(false);
    expect(readFileSync(path, "utf8")).not.toContain("Phases");
  });
});
