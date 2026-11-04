// Slice C tests — Tool + Artifact CORE twins, in four parts
// each (Slice A pattern): (1) created -> twin exists, same id;
// (2) updated via event -> snapshot updates, no refetch, no new
// object; (3) dismissed/error -> lifecycle updates / twin
// removed; (4) restart -> kernel file load (artifact state.md)
// or tool registry re-load (tool) re-creates object + twin.
// Plus: script and watcher are the SAME artifact twin
// definition with a different artifactKind (not separate twin
// systems), unknown artifact attributes throw, and the engine
// loop-state snapshot is event-derived, not polled.

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createLiveArtifact } from "./artifact.js";
import { loadEngineByName } from "./engine-by-name.js";
import {
  clearTwinRegistry,
  getTwin,
  getTwinDefinition,
  listTwins,
  removeTwin,
} from "./kernel-twin.js";
import {
  ARTIFACT_TWIN_DEFINITION,
  TOOL_TWIN_DEFINITION,
  applyLoopEvent,
  artifactStateToMarkdown,
  createArtifact,
  createArtifactTwin,
  createLoopState,
  createToolTwin,
  loadArtifactTwinFromState,
  recordToolCall,
  updateArtifactTwin,
} from "./tool-artifact-twin.js";
import { Tool } from "./tool.js";

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makePersonal(agentName) {
  const personal = tempDir("tool-artifact-twin-personal-");
  mkdirSync(join(personal, "memory"), { recursive: true });
  writeFileSync(
    join(personal, "memory", `${agentName}.agent.md`),
    `# Agent: ${agentName}\n\n- name: ${agentName}\n- role: tester\n- tools: files.read, files.list\n- keep: run\n`,
  );
  writeFileSync(
    join(personal, "memory", `${agentName}.instructions.md`),
    "You test things. Read only, never invent.",
  );
  return personal;
}

describe("tool twin", () => {
  test("(1) created -> twin exists in registry, same id, description from the tool", () => {
    clearTwinRegistry();
    const tool = new Tool({
      name: "demo.echo",
      description: "echo the input",
      input: { text: "what to echo" },
      run: async (input) => input.text,
    });
    const twin = createToolTwin(tool);
    expect(twin.id).toBe("demo.echo");
    expect(twin.kind).toBe("tool");
    expect(twin.lifecycle).toBe("idle");
    expect(getTwin("demo.echo", "tool")).toBe(twin);
    const snap = twin.snapshot();
    expect(snap.name).toBe("demo.echo");
    expect(snap.description).toBe("echo the input");
    expect(snap.args).toBeNull();
    expect(snap.lastCall).toBeNull();
    expect(snap.lastResult).toBeNull();
    expect(snap.lastError).toBeNull();
    expect(TOOL_TWIN_DEFINITION.kind).toBe("tool");
    expect(getTwinDefinition("tool")).toBe(TOOL_TWIN_DEFINITION);
  });

  test("(2) tool call via Tool.run events -> snapshot updates, same twin, no refetch", async () => {
    clearTwinRegistry();
    const tool = new Tool({
      name: "demo.add",
      description: "add one",
      input: { n: "a number" },
      run: async (input) => input.n + 1,
    });
    const twin = createToolTwin(tool);
    const seen = [];
    twin.subscribe("tool:end", () => {
      seen.push(twin.snapshot());
    });
    const result = await tool.run({ n: 41 });
    expect(result).toBe(42);
    // Same twin object, still in the registry, now done.
    expect(getTwin("demo.add", "tool")).toBe(twin);
    const snap = twin.snapshot();
    expect(snap.lifecycle).toBe("done");
    expect(snap.args).toEqual({ n: 41 });
    expect(snap.lastCall.args).toEqual({ n: 41 });
    expect(snap.lastResult).toBe(42);
    expect(typeof snap.lastDuration).toBe("number");
    expect(snap.lastError).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0].lastResult).toBe(42);
    // Manual recordToolCall on a fresh twin: start -> running.
    clearTwinRegistry();
    const plain = new Tool({ name: "demo.manual", run: async () => "ok" });
    const manual = createToolTwin(plain, { subscribe: false });
    const started = recordToolCall(manual, {
      args: { x: 1 },
      event: "tool:start",
    });
    expect(started).toBe(manual);
    expect(manual.lifecycle).toBe("running");
    expect(manual.snapshot().args).toEqual({ x: 1 });
    recordToolCall(manual, { result: "ok", duration: 5, event: "tool:end" });
    expect(manual.lifecycle).toBe("done");
    expect(manual.snapshot().lastResult).toBe("ok");
    expect(manual.snapshot().lastDuration).toBe(5);
  });

  test("(2b) a second call after done supersedes the twin, same id, new object", async () => {
    clearTwinRegistry();
    const tool = new Tool({
      name: "demo.twice",
      description: "twice",
      run: async (input) => input.n * 2,
    });
    const first = createToolTwin(tool);
    await tool.run({ n: 3 });
    expect(first.lifecycle).toBe("done");
    await tool.run({ n: 4 });
    const second = getTwin("demo.twice", "tool");
    expect(second).not.toBe(first);
    expect(second.id).toBe("demo.twice");
    expect(second.snapshot().lastResult).toBe(8);
    expect(second.snapshot().args).toEqual({ n: 4 });
  });

  test("(3) tool error -> lastError set, lifecycle halted; dismiss -> twin removed", async () => {
    clearTwinRegistry();
    const tool = new Tool({
      name: "demo.fail",
      description: "always fails",
      run: async () => {
        throw new Error("boom");
      },
    });
    const twin = createToolTwin(tool);
    await expect(tool.run({})).rejects.toThrow("boom");
    const snap = twin.snapshot();
    expect(snap.lastError).toBe("boom");
    // No "error" lifecycle state exists in Slice A (D-C1):
    // a tool error maps to halted, with the message in lastError.
    expect(snap.lifecycle).toBe("halted");
    expect(getTwin("demo.fail", "tool")).toBe(twin);
    removeTwin("demo.fail", "tool");
    expect(getTwin("demo.fail", "tool")).toBeNull();
    expect(listTwins("tool").map((t) => t.id)).not.toContain("demo.fail");
  });

  test("(3b) tool.js emits tool:start/end/error in order, without changing results", async () => {
    const events = [];
    const tool = new Tool({
      name: "demo.events",
      run: async (input) => input.v,
    });
    tool.onToolEvent((event, detail) => {
      events.push([event, detail.name]);
    });
    expect(await tool.run({ v: "yes" })).toBe("yes");
    expect(events).toEqual([
      ["tool:start", "demo.events"],
      ["tool:end", "demo.events"],
    ]);
    const failing = new Tool({
      name: "demo.events-fail",
      run: async () => {
        throw new Error("nope");
      },
    });
    const failEvents = [];
    failing.onToolEvent((event) => {
      failEvents.push(event);
    });
    await expect(failing.run({})).rejects.toThrow("nope");
    expect(failEvents).toEqual(["tool:start", "tool:error"]);
  });

  test("(4) restart -> tool twin re-created from the tool registry on load", () => {
    clearTwinRegistry();
    const tool = new Tool({
      name: "demo.reload",
      description: "reloadable",
      run: async () => "v1",
    });
    const first = createToolTwin(tool);
    expect(first.snapshot().description).toBe("reloadable");
    // Simulated restart: registry empty, tool registry (the Tool
    // instance) intact. Re-creating the twin gives the same id
    // and description; call history is NOT persisted (honest:
    // a fresh twin starts with lastCall null).
    clearTwinRegistry();
    expect(getTwin("demo.reload", "tool")).toBeNull();
    const second = createToolTwin(tool);
    expect(second).not.toBe(first);
    expect(second.id).toBe("demo.reload");
    expect(second.snapshot().description).toBe("reloadable");
    expect(second.snapshot().lastCall).toBeNull();
    expect(second.snapshot().lastResult).toBeNull();
  });
});

describe("artifact twin (generic)", () => {
  test("(1) created -> twin exists in registry, same id, defined attributes exactly", () => {
    clearTwinRegistry();
    const artifact = createArtifact({
      id: "notes",
      attributes: { title: "hello", content: "world" },
    });
    const twin = createArtifactTwin(artifact);
    expect(twin.id).toBe("notes");
    expect(twin.kind).toBe("artifact");
    expect(twin.lifecycle).toBe("idle");
    expect(getTwin("notes", "artifact")).toBe(twin);
    const snap = twin.snapshot();
    expect(snap.artifactKind).toBe("generic");
    expect(snap.attributes).toEqual({ title: "hello", content: "world" });
    expect(snap.history).toEqual([]);
    expect(snap.expanded).toBe(false);
    expect(snap.expandedView).toEqual({ expanded: false });
    expect(ARTIFACT_TWIN_DEFINITION.kind).toBe("artifact");
  });

  test("(2) updated via state-change event -> snapshot updates, same twin, file saved exactly", () => {
    clearTwinRegistry();
    const dir = tempDir("tool-artifact-twin-art-");
    const artifact = createArtifact({
      id: "notes",
      attributes: { title: "before", content: "" },
      dir,
    });
    const twin = createArtifactTwin(artifact);
    const seen = [];
    twin.subscribe("artifact:state-change", () => {
      seen.push(twin.snapshot());
    });
    const returned = updateArtifactTwin(artifact, { title: "after" });
    expect(returned).toBe(twin);
    expect(getTwin("notes", "artifact")).toBe(twin);
    const snap = twin.snapshot();
    expect(snap.attributes.title).toBe("after");
    expect(snap.attributes.content).toBe("");
    expect(snap.history).toHaveLength(1);
    expect(snap.history[0].changed).toEqual(["title"]);
    expect(seen).toHaveLength(1);
    expect(seen[0].attributes.title).toBe("after");
    // State-change call saved state.md exactly.
    const text = readFileSync(join(dir, "state.md"), "utf8");
    expect(text).toContain("# Artifact: notes");
    expect(text).toContain('- title: "after"');
    expect(text).toContain('- content: ""');
  });

  test("(3) dismissed -> twin removed; script runStatus done -> twin done", () => {
    clearTwinRegistry();
    const artifact = createArtifact({ id: "gone" });
    const twin = createArtifactTwin(artifact);
    expect(getTwin("gone", "artifact")).toBe(twin);
    removeTwin("gone", "artifact");
    expect(getTwin("gone", "artifact")).toBeNull();

    clearTwinRegistry();
    const script = createArtifact({
      id: "build",
      artifactKind: "script",
      attributes: { name: "build", runStatus: "running" },
    });
    const scriptTwin = createArtifactTwin(script);
    expect(scriptTwin.lifecycle).toBe("idle");
    updateArtifactTwin(script, { runStatus: "done" });
    expect(scriptTwin.lifecycle).toBe("done");
  });

  test("(4) restart -> state.md load re-creates artifact + twin exactly", () => {
    clearTwinRegistry();
    const dir = tempDir("tool-artifact-twin-restart-");
    const artifact = createArtifact({
      id: "notes",
      attributes: { title: "saved", content: "exact" },
      dir,
    });
    createArtifactTwin(artifact);
    updateArtifactTwin(artifact, { content: "exact-v2" }, { expanded: true });
    const text = readFileSync(join(dir, "state.md"), "utf8");
    const before = getTwin("notes", "artifact").snapshot();

    clearTwinRegistry();
    expect(getTwin("notes", "artifact")).toBeNull();
    const { artifact: reloaded, twin } = loadArtifactTwinFromState(text, "notes", {
      dir,
    });
    expect(reloaded).not.toBe(artifact);
    expect(twin).not.toBeNull();
    expect(twin.id).toBe("notes");
    expect(twin.lifecycle).toBe("idle");
    const after = twin.snapshot();
    expect(after.artifactKind).toBe(before.artifactKind);
    expect(after.attributes).toEqual(before.attributes);
    expect(after.history).toEqual(before.history);
    expect(after.expanded).toBe(true);
    expect(after.expandedView).toEqual({ expanded: true });
    // And the reloaded artifact keeps saving to the same file.
    updateArtifactTwin(reloaded, { title: "saved-v2" });
    expect(readFileSync(join(dir, "state.md"), "utf8")).toContain(
      '- title: "saved-v2"',
    );
    expect(() => loadArtifactTwinFromState(text, "other-id")).toThrow(
      /mismatch/,
    );
  });

  test("unknown artifact attribute on write throws, file and snapshot unchanged", () => {
    clearTwinRegistry();
    const dir = tempDir("tool-artifact-twin-unknown-");
    const artifact = createArtifact({
      id: "notes",
      attributes: { title: "kept" },
      dir,
    });
    const twin = createArtifactTwin(artifact);
    updateArtifactTwin(artifact, { content: "first" });
    const fileBefore = readFileSync(join(dir, "state.md"), "utf8");
    expect(() =>
      updateArtifactTwin(artifact, { surprise: "nope" }),
    ).toThrow(/unknown artifact attribute "surprise"/);
    expect(twin.snapshot().attributes).toEqual({
      title: "kept",
      content: "first",
    });
    expect(readFileSync(join(dir, "state.md"), "utf8")).toBe(fileBefore);
    expect(() =>
      createArtifact({ id: "bad", attributes: { nope: 1 } }),
    ).toThrow(/unknown artifact attribute "nope"/);
    expect(artifactStateToMarkdown(artifact)).toContain('- title: "kept"');
  });

  test("LiveArtifact state change saves + emits, twin snapshot reads live state", async () => {
    clearTwinRegistry();
    const work = tempDir("tool-artifact-twin-live-work-");
    const personal = tempDir("tool-artifact-twin-live-personal-");
    writeFileSync(join(work, "a.txt"), "hello\n");
    const live = createLiveArtifact({
      id: "live1",
      location: work,
      personalBase: personal,
    });
    const twin = createArtifactTwin(live);
    expect(twin.id).toBe("live1");
    expect(twin.kind).toBe("artifact");
    const seen = [];
    twin.subscribe("artifact:state-change", () => {
      seen.push(twin.snapshot());
    });
    await live.open("a.txt");
    expect(seen.length).toBeGreaterThan(0);
    const snap = twin.snapshot();
    expect(snap.artifactKind).toBe("generic");
    expect(snap.attributes.open.map((entry) => entry.path)).toContain("a.txt");
    expect(snap.expandedView.open).toContain("a.txt");
    // LiveArtifact's own twin() method is untouched (not
    // overwritten by the kernel twin).
    expect(typeof live.twin).toBe("function");
    expect(live.twin().id).toBe("live1");
  });
});

describe("script and watcher as artifact kinds", () => {
  test("same artifact twin definition, different artifactKind, kind-specific fields", () => {
    clearTwinRegistry();
    const script = createArtifact({
      id: "build",
      artifactKind: "script",
      attributes: {
        name: "build",
        trigger: "on-demand",
        commands: ["bun test"],
        steps: ["test"],
        notify: "owner",
        doneNotification: "build done",
      },
    });
    const watcher = createArtifact({
      id: "watch-prices",
      artifactKind: "watcher",
      attributes: {
        name: "watch-prices",
        watch: "prices",
        event: "price-drop",
        notify: "owner",
        haltRule: "stop on error",
        started: true,
        lastEvent: "price-drop at 10:00",
      },
    });
    const scriptTwin = createArtifactTwin(script);
    const watcherTwin = createArtifactTwin(watcher);
    expect(scriptTwin.kind).toBe("artifact");
    expect(watcherTwin.kind).toBe("artifact");
    // Not separate twin systems: both twins were created from
    // the same definition object.
    expect(scriptTwin.snapshot().artifactKind).toBe("script");
    expect(watcherTwin.snapshot().artifactKind).toBe("watcher");
    expect(scriptTwin.snapshot().attributes.steps).toEqual(["test"]);
    expect(scriptTwin.snapshot().attributes.doneNotification).toBe(
      "build done",
    );
    expect(watcherTwin.snapshot().attributes.event).toBe("price-drop");
    expect(watcherTwin.snapshot().attributes.notify).toBe("owner");
    expect(watcherTwin.snapshot().attributes.haltRule).toBe("stop on error");
    expect(watcherTwin.snapshot().attributes.started).toBe(true);
    // Script steps and watcher events are different attributes
    // of the same definition — a script has no event field, a
    // watcher has no doneNotification field, and writing either
    // cross-kind attribute throws.
    expect(() =>
      updateArtifactTwin(script, { event: "x" }),
    ).toThrow(/unknown artifact attribute "event"/);
    expect(() =>
      updateArtifactTwin(watcher, { doneNotification: "x" }),
    ).toThrow(/unknown artifact attribute "doneNotification"/);
    // Script done notification flows through a state change.
    updateArtifactTwin(script, {
      steps: ["test", "build"],
      runStatus: "done",
      doneNotification: "build done: 2 steps",
    });
    const snap = scriptTwin.snapshot();
    expect(snap.attributes.steps).toEqual(["test", "build"]);
    expect(snap.attributes.doneNotification).toBe("build done: 2 steps");
    expect(snap.lifecycle).toBe("done");
    // Watcher event flows through a state change, twin stays idle.
    updateArtifactTwin(watcher, { lastEvent: "price-drop at 11:00" });
    expect(watcherTwin.snapshot().attributes.lastEvent).toBe(
      "price-drop at 11:00",
    );
    expect(watcherTwin.lifecycle).toBe("idle");
  });

  test("script and watcher restart from state.md keeps artifactKind", () => {
    clearTwinRegistry();
    const dir = tempDir("tool-artifact-twin-kinds-");
    const watcher = createArtifact({
      id: "watch1",
      artifactKind: "watcher",
      attributes: { name: "w", event: "tick", notify: "owner" },
      dir,
    });
    createArtifactTwin(watcher);
    updateArtifactTwin(watcher, { lastEvent: "tick at 12:00" });
    const text = readFileSync(join(dir, "state.md"), "utf8");
    clearTwinRegistry();
    const { artifact, twin } = loadArtifactTwinFromState(text, "watch1");
    expect(artifact.artifactKind).toBe("watcher");
    expect(twin.snapshot().artifactKind).toBe("watcher");
    expect(twin.snapshot().attributes.lastEvent).toBe("tick at 12:00");
  });
});

describe("engine loop state (Slice C, wired in engine-by-name.js)", () => {
  test("engine twin snapshot carries loop state, initially empty", () => {
    clearTwinRegistry();
    const personal = makePersonal("looper");
    const engine = loadEngineByName("looper", { personalDir: personal });
    const snap = engine.twin.snapshot();
    expect(snap.id).toBe("looper");
    expect(snap.currentPhase).toBeNull();
    expect(snap.currentToolCall).toBeNull();
    expect(snap.subagents).toEqual([]);
    expect(snap.waiting).toBe(0);
    expect(snap.running).toBe(0);
    expect(snap.done).toBe(0);
    // Step-1 contract intact: name only, tools from the agent
    // file, live state still present, callable twin still works.
    expect(engine.twin().name).toBe("looper");
    expect(engine.twin().currentPhase).toBeNull();
  });

  test("loop events drive the snapshot: phase, tool call, spawn, dismiss — no polling", () => {
    clearTwinRegistry();
    const personal = makePersonal("looper");
    const engine = loadEngineByName("looper", { personalDir: personal });
    const seen = [];
    engine.twin.subscribe("agent:spawn", () => {
      seen.push(engine.twin.snapshot());
    });
    engine.applyLoopEvent("phase", { phase: "execute" });
    expect(engine.twin.snapshot().currentPhase).toBe("execute");
    engine.applyLoopEvent("tool:start", { name: "files.read" });
    expect(engine.twin.snapshot().currentToolCall).toBe("files.read");
    engine.applyLoopEvent("agent:spawn", { name: "dev" });
    const afterSpawn = engine.twin.snapshot();
    expect(afterSpawn.subagents).toEqual([
      { name: "dev", status: "running" },
    ]);
    expect(afterSpawn.running).toBe(1);
    expect(afterSpawn.waiting).toBe(0);
    expect(afterSpawn.done).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].subagents).toEqual([{ name: "dev", status: "running" }]);
    engine.applyLoopEvent("tool:end", { name: "files.read" });
    const afterEnd = engine.twin.snapshot();
    expect(afterEnd.currentToolCall).toBeNull();
    // Subagent counts are untouched by tool calls (D-C4).
    expect(afterEnd.running).toBe(1);
    engine.applyLoopEvent("agent:waiting", { name: "dev" });
    expect(engine.twin.snapshot().waiting).toBe(1);
    expect(engine.twin.snapshot().running).toBe(0);
    engine.applyLoopEvent("agent:dismiss", { name: "dev" });
    const afterDismiss = engine.twin.snapshot();
    expect(afterDismiss.done).toBe(1);
    expect(afterDismiss.waiting).toBe(0);
    // No polling, no new engine: the snapshot reads the same
    // loopState object the events mutated.
    expect(engine.twin.snapshot().currentPhase).toBe("execute");
    expect(engine.loopState.currentPhase).toBe("execute");
  });

  test("applyLoopEvent helper: tool-call counts are separate from subagent counts", () => {
    const loopState = createLoopState();
    applyLoopEvent(loopState, "tool:start", { name: "files.read" });
    applyLoopEvent(loopState, "tool:start", { name: "files.list" });
    applyLoopEvent(loopState, "tool:end", { name: "files.read" });
    applyLoopEvent(loopState, "tool:error", { name: "files.list" });
    expect(loopState.toolCalls).toEqual({ running: 0, done: 1, failed: 1 });
    expect(loopState.currentToolCall).toBeNull();
    expect(loopState.running).toBe(0);
    expect(loopState.done).toBe(0);
    // Gaps G1/G2: llm and report events change nothing.
    applyLoopEvent(loopState, "llm:start", { step: 1 });
    applyLoopEvent(loopState, "agent:report", { name: "dev" });
    expect(loopState.toolCalls).toEqual({ running: 0, done: 1, failed: 1 });
  });
});
