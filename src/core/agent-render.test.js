import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { renderAgentForScreen } from "./agent-render.js";
import { createLiveArtifact } from "./artifact.js";
import { loadEngineByName } from "./engine-by-name.js";

function secondAgent() {
  return {
    name: "second",
    instructions: "second agent instructions",
    tools: [
      { name: "custom.alpha", description: "first custom tool", expectation: "immediate" },
      { name: "custom.beta", description: "second custom tool", expectation: "done" },
    ],
    artifacts: [
      {
        id: "second-artifact",
        state: () => ({ id: "second-artifact", root: "", open: [], focus: null, modified: [] }),
      },
    ],
    children: [
      {
        name: "helper",
        role: "helps",
        goal: "help out",
        tools: ["custom.alpha"],
        status: "running",
        currentPhase: null,
        history: [],
      },
    ],
    goal: { snapshot: () => ({ id: "g2", statement: "second goal", status: "open" }) },
    liveState: { state: "second state", history: "second history" },
    loopState: { currentPhase: "idle", currentToolCall: null, subagents: [], waiting: 0, running: 0, done: 0 },
  };
}

describe("agent-render: dynamic rendering, no hardcoding", () => {
  test("different agents render different dashboard/canvas through the same function", () => {
    const first = renderAgentForScreen(loadEngineByName("developer"));
    const second = renderAgentForScreen(secondAgent());
    const firstText = JSON.stringify(first);
    const secondText = JSON.stringify(second);
    // Second agent's own ids are present…
    expect(secondText).toContain("custom.alpha");
    expect(secondText).toContain("custom.beta");
    expect(secondText).toContain("second-artifact");
    expect(secondText).toContain("helper");
    expect(secondText).toContain("second goal");
    // …and the first agent's ids are absent: no change to the
    // rendering code, different input, different output.
    expect(secondText).not.toContain("files.list");
    expect(secondText).not.toContain("terminal.run");
    expect(firstText).toContain("files.list");
    // Dashboard order is the engine schema order, for both.
    const ids = second.dashboard.map((entry) => entry.id);
    expect(ids).toEqual([
      "agent",
      "instructions",
      "tools",
      "artifacts",
      "goal",
      "state",
      "history",
      "skills",
      "scripts",
      "watchers",
      "children",
      "activity",
    ]);
    // Canvas holds children + artifacts + goal, in that order.
    expect(second.canvas.map((entry) => entry.id)).toEqual([
      "helper",
      "second-artifact",
      "goal",
    ]);
  });

  test("initialized unit = live object: mutating the engine changes the next render", () => {
    const engine = loadEngineByName("developer");
    const before = renderAgentForScreen(engine);
    const activityBefore = before.dashboard.find((e) => e.id === "activity");
    // Fresh loop state starts with no current phase (null, not invented).
    expect(activityBefore.snapshot.currentPhase).toBe(null);
    // Mutate the LIVE object — no re-creation, no second copy.
    engine.loopState.currentPhase = "execute";
    engine.tools.push({ name: "custom.added", description: "added live" });
    const after = renderAgentForScreen(engine);
    const activityAfter = after.dashboard.find((e) => e.id === "activity");
    expect(activityAfter.snapshot.currentPhase).toBe("execute");
    const toolsAfter = after.dashboard.find((e) => e.id === "tools");
    expect(toolsAfter.snapshot.tools.map((t) => t.name)).toContain("custom.added");
    expect(toolsAfter.snapshot.count).toBe(9);
  });

  test("initialized artifact = live object: an artifact write shows in the next render", async () => {
    const dir = mkdtempSync(join(tmpdir(), "askk-render-"));
    writeFileSync(join(dir, "note.txt"), "hello\n", "utf8");
    const artifact = createLiveArtifact({ id: "renderart", location: dir });
    const engine = {
      name: "holder",
      instructions: "holds an artifact",
      tools: [],
      artifacts: [artifact],
      liveState: { state: "", history: "" },
    };
    const before = renderAgentForScreen(engine);
    const artBefore = before.canvas.find((e) => e.id === "renderart");
    expect(artBefore.snapshot.modified).toEqual([]);
    await artifact.write("note.txt", "hello changed\n", "test change");
    const after = renderAgentForScreen(engine);
    const artAfter = after.canvas.find((e) => e.id === "renderart");
    expect(artAfter.snapshot.modified.map((m) => m.path)).toContain("note.txt");
  });

  test("rendering needs an agent/engine object and carries no tool-name list", () => {
    expect(() => renderAgentForScreen(null)).toThrow(/needs an agent or engine/);
    const tree = renderAgentForScreen(secondAgent());
    expect(JSON.stringify(tree.dashboard.map((e) => e.id))).not.toContain("files.");
  });
});
