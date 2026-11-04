// Slice A tests — the kernel twin contract, in four parts:
//   (1) created -> twin exists, same id;
//   (2) updated + event -> snapshot updates via event, no refetch,
//       no new kernel object;
//   (3) dismissed -> twin removed;
//   (4) restart -> kernel file load re-creates object + twin exactly.
// Plus: illegal transitions throw, unregistered objects are
// flagged, and the engine/agent twins from this slice behave.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadEngineByName } from "./engine-by-name.js";
import {
  AGENT_TWIN_DEFINITION,
  ENGINE_TWIN_DEFINITION,
  assertTwinExists,
  clearTwinRegistry,
  createTwinFor,
  defineTwinDefinition,
  getTwin,
  getTwinDefinition,
  hasTwin,
  listTwins,
  removeTwin,
} from "./kernel-twin.js";
import { createAgent, createChildrenRegistry } from "./spawn.js";

const COUNTER = defineTwinDefinition({
  kind: "counter",
  snapshotFields: ["name", "count"],
  events: ["counter:update"],
});

function makePersonal(agentName, { state, history } = {}) {
  const personal = mkdtempSync(join(tmpdir(), "kernel-twin-"));
  mkdirSync(join(personal, "memory", "agent", agentName), { recursive: true });
  writeFileSync(
    join(personal, "memory", `${agentName}.agent.md`),
    `# Agent: ${agentName}\n\n- name: ${agentName}\n- role: tester\n- tools: files.read, files.list\n- keep: run\n`,
  );
  writeFileSync(
    join(personal, "memory", `${agentName}.instructions.md`),
    "You test things. Read only, never invent.",
  );
  if (state !== undefined) {
    writeFileSync(join(personal, "memory", "agent", agentName, "state.md"), state);
  }
  if (history !== undefined) {
    writeFileSync(
      join(personal, "memory", "agent", agentName, "history.md"),
      history,
    );
  }
  return personal;
}

describe("kernel twin — registry and lifecycle", () => {
  test("(1) object created -> twin exists in registry with same id", () => {
    clearTwinRegistry();
    const kernel = { id: "c1", name: "counter-one", count: 0 };
    const twin = createTwinFor(kernel, COUNTER);
    expect(twin.id).toBe("c1");
    expect(twin.kernelId).toBe("c1");
    expect(twin.kind).toBe("counter");
    expect(twin.lifecycle).toBe("created");
    expect(getTwin("c1", "counter")).toBe(twin);
    expect(hasTwin(kernel, "counter")).toBe(true);
    expect(assertTwinExists(kernel, "counter")).toBe(twin);
    expect(listTwins("counter").map((t) => t.id)).toContain("c1");
  });

  test("(2) updated + event -> snapshot updates via event, no refetch", () => {
    clearTwinRegistry();
    const kernel = { id: "c2", name: "counter-two", count: 1 };
    const twin = createTwinFor(kernel, COUNTER);
    const before = twin.snapshot();
    expect(before.count).toBe(1);
    const seen = [];
    twin.subscribe("counter:update", () => {
      seen.push(twin.snapshot());
    });
    kernel.count = 2;
    twin.emit("counter:update", { count: 2 });
    const after = twin.snapshot();
    expect(after.count).toBe(2);
    expect(after).not.toEqual(before);
    // No refetch, no new kernel object: the listener read the
    // same kernel object, updated in place.
    expect(seen).toHaveLength(1);
    expect(seen[0].count).toBe(2);
    expect(seen[0].id).toBe("c2");
  });

  test("(3) object dismissed -> twin removed from registry", () => {
    clearTwinRegistry();
    const kernel = { id: "c3", name: "counter-three", count: 0 };
    const twin = createTwinFor(kernel, COUNTER);
    expect(getTwin("c3", "counter")).toBe(twin);
    twin.dismiss();
    expect(twin.lifecycle).toBe("dismissed");
    expect(getTwin("c3", "counter")).toBeNull();
    expect(hasTwin("c3", "counter")).toBe(false);
    expect(() => assertTwinExists("c3", "counter")).toThrow(/no twin/);
    // removeTwin on a missing id is a no-op, not an error.
    expect(removeTwin("c3", "counter")).toBeNull();
  });

  test("illegal lifecycle transitions throw; unregistered objects are flagged", () => {
    clearTwinRegistry();
    const kernel = { id: "c4", name: "counter-four", count: 0 };
    const twin = createTwinFor(kernel, COUNTER);
    expect(() => twin.transitionTo("done")).toThrow(/illegal twin transition/);
    expect(() => twin.transitionTo("explode")).toThrow(/unknown twin lifecycle/);
    expect(twin.lifecycle).toBe("created");
    twin.transitionTo("initialized");
    twin.transitionTo("idle");
    expect(twin.lifecycle).toBe("idle");
    expect(() => assertTwinExists({ id: "ghost" })).toThrow(/no twin/);
    expect(() => assertTwinExists("ghost")).toThrow(/no twin/);
  });

  test("engine twin: live snapshot updates on liveState change + event, no refetch", () => {
    clearTwinRegistry();
    const personal = makePersonal("tester", {
      state: "# State\n\n- step: done\n",
      history: "# History\n\n- run: first\n",
    });
    const engine = loadEngineByName("tester", { personalDir: personal });
    // Same id as the engine, kind engine, idle after load.
    expect(engine.twin.id).toBe(engine.id);
    expect(engine.twin.id).toBe("tester");
    expect(engine.twin.kind).toBe("engine");
    expect(engine.twin.lifecycle).toBe("idle");
    expect(getTwin("tester", "engine")).toBe(engine.twin);
    // Step-1 callable shape still works: twin() is the snapshot.
    expect(engine.twin().name).toBe("tester");
    expect(engine.twin().toolNames).toEqual(["files.read", "files.list"]);
    const before = engine.twin.snapshot();
    expect(before.name).toBe("tester");
    expect(before.instructionsSource).toBe("personal");
    expect(before.toolNames).toEqual(["files.read", "files.list"]);
    expect(before.liveStateFound).toBe(true);
    expect(before.activity).toBe("idle");
    expect(before.liveState.state).toContain("step: done");
    const seen = [];
    engine.twin.subscribe("engine:update", () => {
      seen.push(engine.twin.snapshot());
    });
    engine.liveState.state = "# State\n\n- step: changed\n";
    engine.activity = "working";
    engine.twin.emit("engine:update", { activity: "working" });
    const after = engine.twin.snapshot();
    expect(after.liveState.state).toContain("step: changed");
    expect(after.activity).toBe("working");
    expect(seen).toHaveLength(1);
    expect(seen[0].liveState.state).toContain("step: changed");
    // No refetch: the twin still reads the same engine object.
    expect(engine.twin.snapshot().id).toBe(engine.id);
  });

  test("agent twin: spawn creates it in the same call, dismiss removes it", () => {
    clearTwinRegistry();
    const caller = {
      name: "harness",
      tools: ["files.read", "files.edit", "terminal.run"],
      reads: ["src/**"],
      writes: ["src/**"],
    };
    const registry = createChildrenRegistry();
    const agent = createAgent(
      { name: "dev", goal: "g", tools: ["files.read"], keep: "run" },
      caller,
    );
    expect(agent.twin.id).toBe(agent.id);
    expect(agent.twin.id).toBe("dev");
    expect(agent.twin.kind).toBe("agent");
    expect(agent.twin.lifecycle).toBe("running");
    expect(getTwin("dev", "agent")).toBe(agent.twin);
    const snap = agent.twin.snapshot();
    expect(snap.name).toBe("dev");
    expect(snap.toolNames).toEqual(["files.read"]);
    expect(snap.keep).toBe("run");
    expect(snap.lifecycle).toBe("running");
    registry.add(agent);
    registry.dismiss("dev");
    expect(getTwin("dev", "agent")).toBeNull();
    expect(() => assertTwinExists("dev", "agent")).toThrow(/no twin/);
  });

  test("(4) restart -> kernel file load re-creates object + twin exactly", () => {
    clearTwinRegistry();
    const personal = makePersonal("tester", {
      state: "# State\n\n- step: saved\n",
      history: "# History\n\n- run: saved\n",
    });
    const first = loadEngineByName("tester", { personalDir: personal });
    const firstSnap = first.twin.snapshot();
    expect(firstSnap.liveStateFound).toBe(true);
    // Simulated restart: the registry is empty, the kernel
    // files are untouched. Loading by name again must
    // re-create both the object and its twin, same id, same
    // snapshot fields — never a stale twin carried over.
    clearTwinRegistry();
    expect(getTwin("tester", "engine")).toBeNull();
    const second = loadEngineByName("tester", { personalDir: personal });
    expect(second).not.toBe(first);
    expect(second.twin).not.toBe(first.twin);
    expect(second.twin.id).toBe("tester");
    expect(second.twin.lifecycle).toBe("idle");
    const secondSnap = second.twin.snapshot();
    expect(secondSnap.name).toBe(firstSnap.name);
    expect(secondSnap.instructionsSource).toBe(firstSnap.instructionsSource);
    expect(secondSnap.toolNames).toEqual(firstSnap.toolNames);
    expect(secondSnap.liveStateFound).toBe(true);
    expect(secondSnap.liveState.state).toBe(firstSnap.liveState.state);
    expect(secondSnap.liveState.history).toBe(firstSnap.liveState.history);
    expect(secondSnap.activity).toBe("idle");
  });

  test("definitions for later slices are importable from kernel-twin.js", () => {
    expect(getTwinDefinition("engine")).toBe(ENGINE_TWIN_DEFINITION);
    expect(getTwinDefinition("agent")).toBe(AGENT_TWIN_DEFINITION);
    expect(ENGINE_TWIN_DEFINITION.snapshotFields.length).toBeGreaterThan(0);
    expect(AGENT_TWIN_DEFINITION.snapshotFields.length).toBeGreaterThan(0);
    expect(() => defineTwinDefinition({ kind: "bad" })).toThrow(
      /snapshotFields/,
    );
  });
});
