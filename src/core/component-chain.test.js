import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearComponentRegistry,
  createArtifactComponent,
  createEngineComponent,
  getComponent,
} from "./component.js";
import {
  createGoal,
  deliverGoal,
  loadGoalArtifactFile,
} from "./goal-artifact.js";
import { clearTwinRegistry } from "./kernel-twin.js";

// Real-chain walkthrough, mocked model/tools only (no real
// model, no real CLI): harness-equivalent flow through
// components — goal.create (statement only) -> goal artifact
// twin mounts -> delivered to the developer component ->
// developer loop plan -> execute -> critique -> report ->
// goal done, UI state changes driven by events, state saved
// to personal memory and restored on simulated restart.
describe("component chain — goal -> developer loop -> report -> done", () => {
  test("harness chain with UI state driven by events", async () => {
    clearComponentRegistry();
    clearTwinRegistry();
    const dir = mkdtempSync(join(tmpdir(), "component-chain-"));
    const goalsDir = join(dir, "memory", "goals");

    // goal.create: statement only. A plan smuggled in is refused.
    expect(() =>
      createGoal({ statement: "x", phases: ["plan"] }, { goalsDir }),
    ).toThrow("statement only");
    const goal = createGoal(
      { statement: "Add a small feature to completion.", id: "feature-chain" },
      { goalsDir },
    );
    const goalComponent = createArtifactComponent(goal);
    expect(goalComponent.mounted).toBe(true);
    expect(goalComponent.artifactKind).toBe("goal");

    // Delivered to the executing agent: kernel + twin snapshot,
    // not the raw owner request.
    const delivered = deliverGoal(goal);
    expect(delivered.snapshot.statement).toBe(
      "Add a small feature to completion.",
    );

    const developer = createEngineComponent("developer");
    expect(developer.mounted).toBe(true);

    const fake = (name, result) => ({
      name,
      description: `fake ${name}`,
      run: async () => result,
    });
    goal.addStep("plan the feature");
    goal.addStep("execute the feature");
    await developer.runLoop([
      { type: "phase", phase: "plan" },
      { type: "tool", tool: fake("files.list", ["a.md"]), input: {} },
      { type: "phase", phase: "execute" },
      { type: "tool", tool: fake("files.write", "written"), input: {} },
      { type: "phase", phase: "critique" },
      { type: "tool", tool: fake("files.read", "written"), input: {} },
      {
        type: "spawn",
        agent: {
          name: "reviewer",
          goal: "review the change",
          tools: ["files.read"],
        },
      },
    ]);
    goal.completeStep("plan the feature");
    goal.completeStep("execute the feature");
    goal.addEvidence("bun test passed in the loop");
    goal.setReport("Done: feature added, checked, and reported back.");
    goal.complete();

    // UI state, driven by events, not by a refetch:
    expect(developer.loopState.currentPhase).toBe("critique");
    expect(developer.loopState.toolCalls.done).toBe(3);
    expect(developer.signal.peek().loopState.toolCalls.done).toBe(3);
    expect(developer.children).toHaveLength(1);
    expect(getComponent("reviewer", "agent")).not.toBeNull();
    expect(goalComponent.signal.peek().twin.status).toBe("done");
    expect(goalComponent.signal.peek().twin.report).toContain("Done:");
    expect(
      goalComponent.snapshot().twin.steps.filter((s) => s.done),
    ).toHaveLength(2);

    // Restart: the goal file re-creates goal + component exactly.
    const restored = loadGoalArtifactFile(
      join(goalsDir, "feature-chain.goal.md"),
    );
    expect(restored.status).toBe("done");
    expect(restored.report).toContain("Done:");
    clearComponentRegistry();
    clearTwinRegistry();
    const restoredComponent = createArtifactComponent(restored);
    expect(restoredComponent.mounted).toBe(true);
    expect(restoredComponent.snapshot().twin.status).toBe("done");

    // Dismissing the developer unmounts it and its child.
    developer.dismiss();
    expect(getComponent("developer", "engine")).toBeNull();
    expect(getComponent("reviewer", "agent")).toBeNull();
  });
});
