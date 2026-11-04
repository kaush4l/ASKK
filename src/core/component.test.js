import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearComponentRegistry,
  createArtifactComponent,
  createComponent,
  createEngineComponent,
  createToolComponent,
  getComponent,
  listComponents,
} from "./component.js";
import { loadEngineByName } from "./engine-by-name.js";
import {
  createGoalArtifact,
  loadGoalArtifactFile,
  writeGoalArtifactFile,
} from "./goal-artifact.js";
import { clearTwinRegistry } from "./kernel-twin.js";
import { Tool } from "./tool.js";
import { createArtifact, updateArtifactTwin } from "./tool-artifact-twin.js";

function fakeTool(name, result = "ok") {
  return {
    name,
    description: `fake ${name}`,
    run: async () => result,
  };
}

function reset() {
  clearComponentRegistry();
  clearTwinRegistry();
}

describe("component lifecycle — object + internal loop + UI + DOM equivalent", () => {
  test("mount on initialization: component present, twin idle, signal holds snapshot", () => {
    reset();
    const component = createEngineComponent("developer");
    expect(component.mounted).toBe(true);
    expect(getComponent("developer", "engine")).toBe(component);
    expect(component.twin.lifecycle).toBe("idle");
    const snapshot = component.signal.peek();
    expect(snapshot).not.toBeNull();
    expect(snapshot.id).toBe("developer");
    expect(snapshot.kind).toBe("engine");
    expect(snapshot.mounted).toBe(true);
  });

  test("signal updates as events happen: loop tool call changes UI state, no refetch", async () => {
    reset();
    const component = createEngineComponent("developer");
    const seen = [];
    component.signal.subscribe((value) => seen.push(value));
    await component.runLoop([
      { type: "phase", phase: "plan" },
      { type: "tool", tool: fakeTool("files.list", ["a.md"]), input: {} },
      { type: "phase", phase: "execute" },
    ]);
    const latest = component.signal.peek();
    expect(latest.loopState.currentPhase).toBe("execute");
    expect(latest.loopState.toolCalls.done).toBe(1);
    expect(latest.loopState.currentToolCall).toBeNull();
    expect(latest.calls).toHaveLength(1);
    expect(latest.calls[0].name).toBe("files.list");
    // The signal fired on events (mount + phase + tool start/end),
    // not on a poll: every seen value is a fresh snapshot, and
    // at least one seen value shows the tool call done.
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.some((v) => v.loopState.toolCalls.done === 1)).toBe(true);
  });

  test("loop spawns a subagent: child component mounts; dismissing it unmounts it", async () => {
    reset();
    const component = createEngineComponent("developer");
    await component.runLoop([
      {
        type: "spawn",
        agent: {
          name: "worker",
          goal: "do one small task",
          tools: ["files.list"],
          keep: "run",
        },
      },
    ]);
    expect(component.children).toHaveLength(1);
    const child = component.children[0];
    expect(child.mounted).toBe(true);
    expect(getComponent("worker", "agent")).toBe(child);
    expect(component.snapshot().loopState.subagents).toHaveLength(1);
    const result = component.dismissChild("worker");
    expect(result.removed).toBe(true);
    expect(getComponent("worker", "agent")).toBeNull();
    expect(component.children).toHaveLength(0);
  });

  test("unmount on dismiss: component absent, twin gone, no twin left behind", () => {
    reset();
    const component = createEngineComponent("developer");
    const result = component.dismiss();
    expect(result.removed).toBe(true);
    expect(component.mounted).toBe(false);
    expect(getComponent("developer", "engine")).toBeNull();
    expect(listComponents()).toHaveLength(0);
  });

  test("keep-desk component is not dismissed: twin kept, UI stays", () => {
    reset();
    const engine = loadEngineByName("developer");
    const component = createComponent({
      kind: "engine",
      kernel: engine,
      twin: engine.twin,
      keep: "desk",
    });
    const result = component.dismiss();
    expect(result).toMatchObject({ removed: false, kept: true });
    expect(component.mounted).toBe(true);
    expect(getComponent("developer", "engine")).toBe(component);
  });

  test("tool component: a real Tool instance runs inside the component loop", async () => {
    reset();
    const tool = new Tool({
      name: "echo.tool",
      description: "echoes its input",
      run: async (input) => ({ echoed: input?.value ?? null }),
    });
    const component = createToolComponent(tool);
    expect(component.mounted).toBe(true);
    await component.runLoop([{ type: "tool", tool, input: { value: 42 } }]);
    expect(component.calls[0].result).toEqual({ echoed: 42 });
    expect(component.signal.peek().calls[0].result).toEqual({ echoed: 42 });
  });

  test("artifact components: script and watcher are artifact kinds, not core kinds", () => {
    reset();
    const script = createArtifact({
      id: "build-shortcut",
      artifactKind: "script",
      attributes: { name: "build-shortcut", commands: ["bun test"] },
    });
    const watcher = createArtifact({
      id: "file-watcher",
      artifactKind: "watcher",
      attributes: { name: "file-watcher", watch: "src/**", event: "change" },
    });
    const scriptComponent = createArtifactComponent(script);
    const watcherComponent = createArtifactComponent(watcher);
    expect(scriptComponent.kind).toBe("artifact");
    expect(scriptComponent.artifactKind).toBe("script");
    expect(watcherComponent.artifactKind).toBe("watcher");
    updateArtifactTwin(script, { runStatus: "done" });
    expect(scriptComponent.signal.peek().twin.attributes.runStatus).toBe(
      "done",
    );
    scriptComponent.dismiss();
    watcherComponent.dismiss();
    expect(listComponents("artifact")).toHaveLength(0);
  });

  test("goal as artifact kind: goal component mounts, state saves and restores on restart", () => {
    reset();
    const dir = mkdtempSync(join(tmpdir(), "component-goal-"));
    const goal = createGoalArtifact({
      id: "feature-x",
      statement: "Build feature X to completion.",
      goalsDir: dir,
      saveOnCreate: true,
    });
    const component = createArtifactComponent(goal);
    expect(component.artifactKind).toBe("goal");
    expect(component.mounted).toBe(true);
    goal.addStep?.("plan the feature");
    // State saved exactly: the file on disk carries the goal,
    // and loading it re-creates the goal + a fresh component.
    const file = writeGoalArtifactFile(dir, goal);
    const restored = loadGoalArtifactFile(file);
    expect(restored.statement).toBe("Build feature X to completion.");
    reset();
    const restoredComponent = createArtifactComponent(restored);
    expect(restoredComponent.mounted).toBe(true);
    expect(restoredComponent.snapshot().twin.statement).toBe(
      "Build feature X to completion.",
    );
  });

  test("model loop owned by the component: mocked TOON reply drives loop state + signal", async () => {
    reset();
    const component = createEngineComponent("developer");
    const registry = {
      get: (name) =>
        name === "files.list" ? fakeTool("files.list", ["a.md"]) : null,
      run: async (name, input) => {
        const tool = registry.get(name);
        if (!tool) throw new Error(`no tool ${name}`);
        return tool.run(input);
      },
    };
    const replies = [
      "thought: list files\ncall: files.list {}",
      "Done: listed files.",
    ];
    const inference = {
      infer: async () => replies.shift() ?? "Done.",
    };
    const result = await component.runModelLoop({
      registry,
      inference,
      prompt: "You are the developer.",
    });
    expect(component.loopState.toolCalls.done).toBeGreaterThanOrEqual(1);
    expect(
      component.signal.peek().loopState.toolCalls.done,
    ).toBeGreaterThanOrEqual(1);
    expect(result).toBeDefined();
  });

  test("different agent renders different dashboard/canvas with no rendering-code change", () => {
    reset();
    const a = createEngineComponent("developer");
    const b = createEngineComponent("default");
    expect(a.snapshot().twin.toolNames).not.toEqual(
      b.snapshot().twin.toolNames,
    );
    expect(a.signal.peek().twin.toolNames).toContain("files.list");
    // Default holds goal.create (plus harness functions dispatch /
    // spawn / report / guide, recorded as missingTools because they
    // are harness functions, not kernel Tool instances — never
    // invented as tools; see the lifecycle redraft note).
    expect(b.signal.peek().twin.toolNames).toContain("goal.create");
    expect(b.signal.peek().twin.toolNames).not.toContain("files.list");
  });
});
