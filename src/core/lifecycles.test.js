import { describe, expect, test } from "bun:test";
import { instructionsElement, soulElement } from "./elements.js";
import { createEngineObject } from "./engine-object.js";
import { createGoal } from "./goal-artifact.js";
import {
  artifactCallComplete,
  defineElementLifecycle,
  getElementLifecycle,
  listElementLifecycles,
  removeElementLifecycle,
  runLifecycle,
  toolElementKind,
} from "./lifecycles.js";
import { lifecycleTwins } from "./ui-data.js";

function fakeDesk(location) {
  const toolSpecs = [
    {
      name: "files.read",
      description: "read a file",
      input: { path: "the file" },
      expectation: "immediate",
    },
    {
      name: "files.edit",
      description: "edit a file",
      input: { path: "the file" },
      expectation: "done",
    },
    {
      name: "terminal.run",
      description: "run a command",
      input: { command: "the command" },
      expectation: "done",
    },
  ];
  return {
    location,
    soul: "Engine soul.",
    engine: { instructions: "YOU ARE the engine.", inference: null },
    tools: toolSpecs.map((spec) => ({ ...spec, spec: () => spec })),
    listTools: () => toolSpecs,
    artifacts: [],
    agent: { name: "default", id: "default" },
    defaultInference: null,
    inferences: [],
  };
}

describe("lifecycle registry: configuration, not engine code", () => {
  test("all twelve element lifecycles are defined, with steps", () => {
    const types = listElementLifecycles();
    for (const type of [
      "function",
      "live-artifact",
      "soul",
      "instructions",
      "history",
      "goal",
      "subagent",
      "watcher",
      "script",
      "skill-phase",
      "model-call",
      "snapshot",
    ]) {
      expect(types).toContain(type);
      expect(getElementLifecycle(type).steps.length).toBeGreaterThan(0);
    }
  });

  test("tool -> element kind is a table, not a switch", () => {
    expect(toolElementKind("files.open")).toBe("live-artifact");
    expect(toolElementKind("files.edit")).toBe("live-artifact");
    expect(toolElementKind("terminal.run")).toBe("function");
    expect(toolElementKind("something.new")).toBe("function");
  });

  test("unknown type and undefined step are refused, never invented", () => {
    const engine = createEngineObject(fakeDesk("lc-unknown"));
    expect(() => runLifecycle(engine, { kind: "nope" }, "call")).toThrow(
      /no lifecycle/,
    );
    expect(() =>
      runLifecycle(engine, { kind: "function" }, "teleport"),
    ).toThrow(/has no step/);
    expect(() =>
      defineElementLifecycle("bad", { steps: ["teleport"] }),
    ).toThrow(/unknown step/);
  });

  test("a NEW element type runs its lifecycle with no engine change; removing it removes the lifecycle", () => {
    const engine = createEngineObject(fakeDesk("lc-note"));
    const ran = [];
    defineElementLifecycle("note", {
      steps: ["call", "record"],
      onCall: (_engine, _el, event) => {
        ran.push(`call:${event?.payload?.text ?? ""}`);
        return "called";
      },
      onPersist: (_engine, _el, event) => {
        ran.push(`record:${event?.payload?.text ?? ""}`);
        return "recorded";
      },
    });
    expect(listElementLifecycles()).toContain("note");
    // The engine runs it through the same runLifecycle entry
    // point as every built-in type — no engine-code change.
    const results = engine.runLifecycleSequence(
      { kind: "note" },
      { payload: { text: "hello" } },
    );
    expect(results.map((r) => r.step)).toEqual(["call", "record"]);
    expect(ran).toEqual(["call:hello", "record:hello"]);
    expect(
      engine.lifecycleTrace.filter((entry) => entry.type === "note"),
    ).toHaveLength(2);
    expect(removeElementLifecycle("note")).toBe(true);
    expect(listElementLifecycles()).not.toContain("note");
    expect(() => engine.runLifecycle({ kind: "note" }, "call")).toThrow(
      /no lifecycle/,
    );
  });

  test("loop tool events run lifecycles through the engine (no loop switch)", () => {
    const engine = createEngineObject(fakeDesk("lc-events"));
    engine.state.emit("tool:end", { id: "call-1", name: "files.read" });
    expect(
      engine.lifecycleTrace.some(
        (entry) => entry.type === "function" && entry.step === "record",
      ),
    ).toBe(true);
    engine.state.emit("agent:spawn", { agent: "developer", goal: "goal" });
    expect(
      engine.lifecycleTrace.some(
        (entry) => entry.type === "subagent" && entry.step === "spawn",
      ),
    ).toBe(true);
  });
});

describe("live-artifact lifecycle: state + view + prompt or incomplete", () => {
  test("a real artifact call updates state, view, prompt, history, and signal", () => {
    const engine = createEngineObject(fakeDesk("lc-artifact"));
    const report = engine.applyArtifactCall({
      path: "feature.txt",
      action: "open",
    });
    expect(report.complete).toBe(true);
    expect(report.stateChanged).toBe(true);
    expect(report.viewChanged).toBe(true);
    expect(report.promptChanged).toBe(true);
    expect(report.recorded).toBe(true);
    expect(report.signalFired).toBe(true);
    expect(engine.snapshot().artifact.open).toContain("feature.txt");
    expect(engine.renderPrompt()).toContain("feature.txt");
    expect(engine.assertArtifactCallComplete(report)).toBe(report);
  });

  test("a call that only returns a value is incomplete by definition and is rejected", () => {
    const engine = createEngineObject(fakeDesk("lc-incomplete"));
    // The bypass path: a tool returns a value and nothing else
    // touches the engine — no state, view, prompt, or record.
    const before = {
      artifact: JSON.parse(JSON.stringify(engine.snapshot().artifact ?? null)),
      artifactElement: engine.elementStrings().artifact ?? null,
      prompt: engine.renderPrompt(),
      historyLength: engine.snapshot().history.length,
      signalFired: false,
    };
    const returnedValue = { ok: true, content: "file content" };
    expect(returnedValue.ok).toBe(true);
    const after = {
      artifact: JSON.parse(JSON.stringify(engine.snapshot().artifact ?? null)),
      artifactElement: engine.elementStrings().artifact ?? null,
      prompt: engine.renderPrompt(),
      historyLength: engine.snapshot().history.length,
      signalFired: false,
    };
    const report = artifactCallComplete(before, after);
    expect(report.complete).toBe(false);
    expect(report.stateChanged).toBe(false);
    expect(report.promptChanged).toBe(false);
    expect(report.recorded).toBe(false);
    expect(() => engine.assertArtifactCallComplete(report)).toThrow(
      /incomplete live artifact call/,
    );
  });
});

describe("UI priority: every lifecycle state change has a UI twin", () => {
  test("iterating the registry: each type's mutation is visible in lifecycleTwins, immediately", () => {
    const engine = createEngineObject(fakeDesk("lc-twins"));
    // function: a tool call recorded in state.
    engine.addCall({ id: "c1", name: "files.read", status: "done" });
    // live-artifact: the full lifecycle, not a bare return.
    engine.applyArtifactCall({ path: "notes.md", action: "open" });
    // soul: load once, re-rendered only on version change.
    engine.setElement(soulElement("Version two soul."));
    // instructions: re-rendered on phase change.
    engine.setElement(instructionsElement("Phase instructions."));
    // history: append-only.
    engine.appendHistory("did x");
    // goal: create -> report -> complete, snapshots at transitions.
    const goal = createGoal({ id: "goal", statement: "do the thing" });
    engine.setGoal(goal);
    goal.takeSnapshot("test snap");
    engine.setGoal(goal);
    // subagent: spawn state.
    engine.setAgent("helper", { name: "helper", status: "running" });
    // watcher / script / skill-phase: state fields the twins read.
    engine.mutate((state) => {
      state.watchers = [{ name: "build", status: "running" }];
      state.scripts = [{ name: "dev-checks", status: "done" }];
      state.phases = [{ id: "review", duty: "review", status: "running" }];
      state.modelCalls = [{ model: "mock", chars: 42 }];
    });
    // model-call: an llm event in the event log.
    engine.state.emit("llm:start", { step: 1 });
    // snapshot: the goal artifact's snapshots, never mutated after.
    const twins = lifecycleTwins(engine);
    // Coverage gate: every registered type has a twin key. A new
    // type without a twin fails this test by design.
    for (const type of listElementLifecycles()) {
      expect(Object.keys(twins)).toContain(type);
    }
    expect(twins.function.calls.map((c) => c.id)).toContain("c1");
    expect(twins["live-artifact"].artifact.open).toContain("notes.md");
    expect(twins["live-artifact"].artifactElement).toContain("notes.md");
    expect(twins.soul.text).toBe("Version two soul.");
    expect(twins.instructions.text).toBe("Phase instructions.");
    expect(twins.history.entries).toContain("did x");
    expect(twins.goal.current.statement).toBe("do the thing");
    expect(twins.subagent.agents.helper.status).toBe("running");
    expect(twins.watcher.watchers.map((w) => w.name)).toContain("build");
    expect(twins.script.scripts.map((s) => s.name)).toContain("dev-checks");
    expect(twins["skill-phase"].phases.map((p) => p.id)).toContain("review");
    expect(twins["model-call"].events.map((e) => e.type)).toContain(
      "llm:start",
    );
    expect(twins["model-call"].modelCalls).toHaveLength(1);
    expect(twins.snapshot.count).toBe(1);
    expect(twins.snapshot.latest).toBe("test snap");
  });
});
