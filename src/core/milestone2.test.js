// Milestone 2 tests — one file, one gap per describe block.
// Gap 1: harness route chain through the exact function the
// route calls (route handler itself needs Next imports, so it
// is NOT executed here; its wiring is asserted by reading the
// route file — function level proven, wiring asserted).
// Gap 4: engine models through the single engine object, with
// persistence verified in a temp personal folder.
// Gap 5: client bus accepts goal:/agent: events.
// Gap 6: harness gate nuance as a DESIGNED rule — critique is
// the judge, the execute gate is advisory (see PR.md).
// Gap 7: lifecycle table accuracy — registry steps equal the
// documented steps for all 12 types, in PR.md and README.md.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emitLiveEvent,
  LIVE_EVENT_TYPES,
  mapEventToState,
  subscribeLiveEvent,
} from "../lib/live-events.js";
import { createCoreTools } from "./core-tools.js";
import { applyEngineModelsAction, getEngineModels } from "./engine-models.js";
import { createEngineObject } from "./engine-object.js";
import { createHarness } from "./harness.js";
import { runHarnessRequest } from "./harness-route.js";
import { getElementLifecycle, listElementLifecycles } from "./lifecycles.js";
import { Tool } from "./tool.js";

function tempDeskAndWorkspace() {
  const deskDir = mkdtempSync(join(tmpdir(), "askk-m2-desk-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "askk-m2-work-"));
  mkdirSync(join(deskDir, "memory"), { recursive: true });
  writeFileSync(join(deskDir, "memory", "soul.md"), "M2 soul.", "utf8");
  writeFileSync(join(workspaceDir, "feature.txt"), "old", "utf8");
  return { deskDir, workspaceDir };
}

function mockedTerminalDesk(workspaceDir) {
  const core = createCoreTools({ filesLocation: workspaceDir });
  const terminalCalls = [];
  const mockTerminal = new Tool({
    name: "terminal.run",
    description: "mocked terminal run",
    input: { command: "the command" },
    expectation: "done",
    run: async (input) => {
      terminalCalls.push(input?.command);
      return { exit: 0, output: "mocked tests pass" };
    },
  });
  const tools = [
    ...core.tools.filter((tool) => !tool.name.startsWith("terminal.")),
    mockTerminal,
  ];
  return {
    desk: {
      location: workspaceDir,
      soul: "M2 soul.",
      tools,
      coreTools: core,
      listTools: () => tools.map((tool) => tool.spec()),
      inferences: [],
      defaultInference: null,
      engine: { instructions: "M2 soul.", inference: null },
    },
    terminalCalls,
  };
}

// Phase-aware mocked TOON model: plan explores, execute edits
// + runs mocked checks, critique reads then passes. One attempt.
function routeMockModel() {
  const counts = { plan: 0, execute: 0, critique: 0 };
  return {
    infer: async (messages) => {
      const text = messages.map((m) => String(m.content ?? "")).join("\n");
      if (text.includes("plan the work")) {
        counts.plan += 1;
        if (counts.plan === 1) {
          return "call: files.list {}";
        }
        return "plan: change feature.txt from old to new";
      }
      if (text.includes("execute the plan")) {
        counts.execute += 1;
        if (counts.execute === 1) {
          return 'call: files.edit {"path":"feature.txt","old":"old","new":"new"}\ncall: terminal.run {"command":"bun test src/core"}';
        }
        return "executed: feature edited, mocked tests pass";
      }
      if (text.includes("critique the executed")) {
        counts.critique += 1;
        if (counts.critique === 1) {
          return 'call: files.read {"path":"feature.txt"}';
        }
        return "critique: pass — change is correct";
      }
      return "answer: unknown phase";
    },
  };
}

describe("gap 1: dashboard chat entry is the harness route chain", () => {
  test("runHarnessRequest (the function /api/harness calls) -> goal -> developer -> complete -> report", async () => {
    const { workspaceDir } = tempDeskAndWorkspace();
    const { desk, terminalCalls } = mockedTerminalDesk(workspaceDir);
    const engine = createEngineObject(desk);
    const result = await runHarnessRequest(engine, {
      request: "change feature.txt from old to new",
      inference: routeMockModel(),
    });
    expect(result.goalCreateCalls).toBe(1);
    expect("phases" in result.goal).toBe(false);
    expect(result.goal.statement).toContain(
      "change feature.txt from old to new",
    );
    expect(result.report.startsWith("Done:")).toBe(true);
    expect(result.developer.currentPhase).toBe("done");
    expect(result.developer.tools.length).toBeLessThan(desk.tools.length);
    expect(terminalCalls).toContain("bun test src/core");
    expect(readFileSync(join(workspaceDir, "feature.txt"), "utf8")).toBe("new");
    // The same engine object the UI reads now holds the goal.
    expect(engine.goal?.id).toBe(result.goal.id);
    expect(engine.goal?.status).toBe("done");
  });

  test("route wiring asserted by reading the route and page files", () => {
    const harnessRoute = readFileSync(
      join(process.cwd(), "src/app/api/harness/route.js"),
      "utf8",
    );
    expect(harnessRoute).toContain("runHarnessRequest");
    // Milestone 4: routes go through the single startup entry,
    // getStartedEngine(), not getEngineObject() alone.
    expect(harnessRoute).toContain("getStartedEngine");
    const page = readFileSync(join(process.cwd(), "src/app/page.js"), "utf8");
    expect(page).toContain('"/api/harness"');
    expect(page).not.toContain('fetch("/api/chat"');
    // Milestone 4: the unused /api/chat route was DELETED, not
    // left as a legacy comment — so its file must not exist.
    expect(existsSync(join(process.cwd(), "src/app/api/chat/route.js"))).toBe(
      false,
    );
  });
});

describe("gap 4: models actions through the single engine object", () => {
  function fakeDesk(location) {
    return {
      location,
      soul: "",
      engine: { instructions: "" },
      tools: [],
      listTools: () => [],
      artifacts: [],
      skills: [],
      agent: null,
    };
  }

  test("use/edit through the engine object persist to the temp personal folder and a second read sees them", () => {
    const dir = mkdtempSync(join(tmpdir(), "askk-m2-models-"));
    mkdirSync(join(dir, "memory"), { recursive: true });
    writeFileSync(
      join(dir, "memory", "model.json"),
      JSON.stringify(
        [
          {
            id: "local-1",
            kind: "api-local",
            label: "Local",
            model: "qwen",
            endpoint: "http://127.0.0.1:8873/v1",
          },
          {
            id: "gem-1",
            kind: "cli-gemini",
            label: "Gemini",
            model: "gemini",
            command: "gemini",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );
    const engine = createEngineObject(fakeDesk(dir));
    const first = getEngineModels(engine);
    expect(first.providers.map((p) => p.id)).toEqual(["local-1", "gem-1"]);
    const used = applyEngineModelsAction(engine, {
      action: "use",
      id: "local-1",
    });
    expect(used.persisted).toBe(true);
    expect(used.defaultId).toBe("local-1");
    const written = JSON.parse(
      readFileSync(join(dir, "memory", "model.json"), "utf8"),
    );
    expect(written.find((p) => p.id === "local-1").isDefault).toBe(true);
    // Second read through the SAME engine object sees the change.
    expect(getEngineModels(engine)).toBe(first);
    expect(getEngineModels(engine).defaultId).toBe("local-1");
    applyEngineModelsAction(engine, {
      action: "edit",
      id: "gem-1",
      patch: { label: "Gemini 2" },
    });
    const rewritten = JSON.parse(
      readFileSync(join(dir, "memory", "model.json"), "utf8"),
    );
    expect(rewritten.find((p) => p.id === "gem-1").label).toBe("Gemini 2");
    expect(
      getEngineModels(engine).providers.find((p) => p.id === "gem-1").label,
    ).toBe("Gemini 2");
  });

  test("no desk folder -> in-memory only, persisted false, state still updated", () => {
    const dir = mkdtempSync(join(tmpdir(), "askk-m2-models-"));
    mkdirSync(join(dir, "memory"), { recursive: true });
    writeFileSync(
      join(dir, "memory", "model.json"),
      JSON.stringify([
        {
          id: "local-1",
          kind: "api-local",
          label: "Local",
          model: "qwen",
          endpoint: "http://127.0.0.1:8873/v1",
        },
      ]),
      "utf8",
    );
    const engine = createEngineObject(fakeDesk(dir));
    getEngineModels(engine);
    // The desk folder disappears mid-session: persistence must
    // degrade to in-memory-only, never invent or crash.
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
    const used = applyEngineModelsAction(engine, {
      action: "use",
      id: "local-1",
    });
    expect(used.persisted).toBe(false);
    expect(used.note).toContain("not persisted");
    expect(getEngineModels(engine).defaultId).toBe("local-1");
  });
});

describe("gap 5: client bus accepts goal:/agent: events", () => {
  test("goal:phase, goal:complete, agent:spawn/report/dismiss, tool:*, compaction emit and subscribe", () => {
    for (const type of [
      "goal:phase",
      "goal:complete",
      "agent:spawn",
      "agent:report",
      "agent:dismiss",
      "tool:start",
      "tool:end",
      "tool:error",
      "compaction",
    ]) {
      expect(LIVE_EVENT_TYPES).toContain(type);
      expect(() => mapEventToState(type)).not.toThrow();
    }
    const seen = [];
    const offGoal = subscribeLiveEvent("goal:phase", (detail) =>
      seen.push(["goal:phase", detail]),
    );
    const offAgent = subscribeLiveEvent("agent:report", (detail) =>
      seen.push(["agent:report", detail]),
    );
    emitLiveEvent("goal:phase", { to: "execute" });
    emitLiveEvent("agent:report", { agent: "developer" });
    expect(seen).toEqual([
      ["goal:phase", { to: "execute" }],
      ["agent:report", { agent: "developer" }],
    ]);
    offGoal();
    offAgent();
    expect(() => emitLiveEvent("nope:unknown", {})).toThrow(
      "unknown live event",
    );
  });
});

describe("gap 6: gate nuance is a designed rule — critique is the judge", () => {
  test("failed execute gate + passing critique -> done, not halted", async () => {
    const { workspaceDir } = tempDeskAndWorkspace();
    const { desk } = mockedTerminalDesk(workspaceDir);
    const harness = createHarness(desk);
    const model = {
      infer: async (messages) => {
        const text = messages.map((m) => String(m.content ?? "")).join("\n");
        if (text.includes("plan the work")) {
          return "plan: do it";
        }
        if (text.includes("execute the plan")) {
          // No tool calls at all: the execute exit gate fails
          // (it needs a done call), by design advisory only.
          return "executed: no tool calls needed";
        }
        if (text.includes("critique the executed")) {
          return "critique: pass — fine";
        }
        return "answer: unknown phase";
      },
    };
    const result = await harness.ask("do a trivial thing", {
      inference: model,
    });
    const execute = result.run.phaseResults.find(
      (entry) => entry.phase === "execute",
    );
    expect(execute.gatePassed).toBe(false);
    expect(result.run.done).toBe(true);
    expect(result.report.startsWith("Done:")).toBe(true);
  });
});

describe("gap 7: lifecycle table accuracy — registry steps equal the documented steps", () => {
  test("all 12 types, steps exactly as in PR.md and src/core/README.md", () => {
    const expected = {
      function: ["call", "run", "return", "record", "next-step"],
      "live-artifact": [
        "call",
        "update-state",
        "render-view",
        "re-render-prompt",
        "record",
      ],
      soul: ["load", "render", "version-change"],
      instructions: ["load", "render", "phase-change"],
      history: ["append", "clip"],
      goal: [
        "create",
        "plan",
        "execute",
        "critique",
        "report-back",
        "complete",
      ],
      subagent: ["spawn", "quest", "report", "ask", "dismiss", "update"],
      watcher: ["subscribe", "event", "notify", "halt"],
      script: ["sequence", "done"],
      "skill-phase": ["entry-gate", "run", "exit-gate", "handoff"],
      "model-call": ["infer", "record-timings", "update-meter"],
      snapshot: ["deep-copy", "store"],
    };
    expect(listElementLifecycles().sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [type, steps] of Object.entries(expected)) {
      expect(getElementLifecycle(type).steps).toEqual(steps);
    }
  });
});
