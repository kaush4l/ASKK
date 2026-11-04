import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCoreTools } from "./core-tools.js";
import { readDeskSnapshot } from "./desk-reader.js";
import {
  createHarness,
  loadDefaultAgent,
  loadDeveloperAgent,
} from "./harness.js";
import { createAgent } from "./spawn.js";
import { Tool } from "./tool.js";
import { liveStatusData } from "./ui-data.js";

function tempDirs() {
  const deskDir = mkdtempSync(join(tmpdir(), "askk-addendum-desk-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "askk-addendum-work-"));
  mkdirSync(join(deskDir, "memory"), { recursive: true });
  writeFileSync(join(deskDir, "memory", "soul.md"), "Harness soul.", "utf8");
  writeFileSync(join(workspaceDir, "feature.txt"), "old", "utf8");
  return { deskDir, workspaceDir };
}

// Same phase-aware mocked TOON model as the harness chain test:
// critique fails on attempt 1, passes on attempt 2 (loop-back).
function phaseMockModel() {
  const counts = { plan: 0, execute: 0, critique: 0 };
  return {
    infer: async (messages) => {
      const text = messages.map((m) => String(m.content ?? "")).join("\n");
      if (text.includes("plan the work")) {
        counts.plan += 1;
        if (counts.plan === 1) {
          return 'thought: explore\ncall: files.list {}\ncall: files.read {"path":"feature.txt"}';
        }
        if (counts.plan === 2) {
          return "plan: change feature.txt from old to new";
        }
        return "plan: re-plan after critique";
      }
      if (text.includes("execute the plan")) {
        counts.execute += 1;
        if (counts.execute === 1) {
          return 'call: files.open {"paths":["feature.txt"]}';
        }
        if (counts.execute === 2) {
          return 'call: files.edit {"path":"feature.txt","old":"old","new":"new"}\ncall: terminal.run {"command":"bun test src/core"}';
        }
        if (counts.execute === 3) {
          return "executed: feature edited, mocked tests pass";
        }
        return "executed again: no change needed";
      }
      if (text.includes("critique the executed")) {
        counts.critique += 1;
        if (counts.critique === 1) {
          return 'call: files.read {"path":"feature.txt"}';
        }
        if (counts.critique === 2) {
          return "critique: fail — needs work";
        }
        if (counts.critique === 3) {
          return 'call: files.read {"path":"feature.txt"}';
        }
        return "critique: pass — change is correct";
      }
      return "answer: unknown phase";
    },
  };
}

function harnessWithMockedTerminal(workspaceDir) {
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
  const desk = {
    location: workspaceDir,
    soul: "Harness soul.",
    tools,
    coreTools: core,
    listTools: () => tools.map((tool) => tool.spec()),
    inferences: [],
    defaultInference: null,
    engine: { instructions: "Harness soul.", inference: null },
  };
  return { harness: createHarness(desk), terminalCalls };
}

describe("curated agents load from memory files, not generic skins", () => {
  test("default agent: curated files, DeepSeek goal via goal-default, narrowed tools", () => {
    const agent = loadDefaultAgent({
      defaultsDir: join(process.cwd(), "public/defaults"),
    });
    expect(agent.default).toBe(false);
    expect(agent.name).toBe("default");
    expect(agent.source).toContain("default.agent.md");
    expect(agent.tools).toContain("goal.create");
    expect(agent.instructions).toContain("goal.create");
    expect(agent.instructions).toContain("exactly once");
    // The goal philosophy is NOT duplicated here: it lives in
    // goal-default.md, which the harness loads separately.
    expect(agent.agentFile).not.toContain("It acts only when asked");
  });

  test("developer agent: curated files, narrowed 8-tool subset, own script", () => {
    const agent = loadDeveloperAgent({
      defaultsDir: join(process.cwd(), "public/defaults"),
    });
    expect(agent).not.toBeNull();
    expect(agent.tools).toEqual([
      "files.list",
      "files.read",
      "files.open",
      "files.write",
      "files.edit",
      "files.append",
      "files.search",
      "terminal.run",
    ]);
    expect(agent.tools).not.toContain("files.close");
    expect(agent.tools).not.toContain("web.search");
    // Milestone 3: <name>.tools.md is deleted as a source, so
    // there is no toolsText at all — the tool list is agent.md
    // names only, and each tool's spec comes from the registry.
    // (The old assertion here read developer.tools.md's prose
    // about goal tools attached separately; that prose file is
    // gone, and the registry spec is the source now.)
    expect("toolsText" in agent).toBe(false);
    expect("toolsSource" in agent).toBe(false);
    expect(agent.instructions).toContain("plan");
    expect(agent.instructions).toContain("critique");
    // The desk reader sees the curated files and scripts.
    const snap = readDeskSnapshot({
      personalDir: join(tmpdir(), "askk-no-such-personal-xyz"),
      defaultsDir: join(process.cwd(), "public/defaults"),
      agent: "developer",
    });
    expect(snap.scriptsAgent).toContain("dev-checks.shortcut.script.md");
    const defaultSnap = readDeskSnapshot({
      personalDir: join(tmpdir(), "askk-no-such-personal-xyz"),
      defaultsDir: join(process.cwd(), "public/defaults"),
      agent: "default",
    });
    expect(defaultSnap.scriptsAgent).toContain("dispatch.shortcut.script.md");
  });
});

describe("success flow: goal + rules at spawn, narrowed tools, message back", () => {
  test("desk -> developer (curated) -> feature done -> report in both histories, labelled", async () => {
    const { workspaceDir } = tempDirs();
    const { harness, terminalCalls } = harnessWithMockedTerminal(workspaceDir);
    const result = await harness.ask("change feature.txt from old to new", {
      inference: phaseMockModel(),
    });
    // Goal correction intact: one goal.create, statement only.
    expect(result.goalCreateCalls).toBe(1);
    expect("phases" in result.goal).toBe(false);
    expect(result.goal.status).toBe("done");
    // Rules passed at spawn, from the curated developer file.
    expect(result.developer.definition.source).toContain("developer.agent.md");
    expect(result.developer.rules.tools).toEqual(result.developer.tools);
    expect(result.developer.rules.gates.map((g) => g.id)).toEqual([
      "plan",
      "execute",
      "critique",
      "done",
    ]);
    expect(result.developer.rules.soul).toContain("soul");
    // Narrowed: a STRICT subset of the caller's tools, never all.
    const kernel = harness.kernelToolNames;
    expect(result.developer.tools.length).toBeLessThan(kernel.length);
    for (const tool of result.developer.tools) {
      expect(kernel).toContain(tool);
    }
    // The feature itself: edited, checked, critique looped back.
    expect(readFileSync(join(workspaceDir, "feature.txt"), "utf8")).toBe("new");
    expect(terminalCalls).toContain("bun test src/core");
    expect(result.run.attempts).toBe(2);
    expect(result.run.done).toBe(true);
    // Message back: developer history AND harness history,
    // labelled separately.
    expect(
      result.developer.history.some(
        (entry) => entry.channel === "report" && entry.text.includes("Done:"),
      ),
    ).toBe(true);
    expect(
      result.harnessHistory.some((entry) => entry.startsWith("owner request:")),
    ).toBe(true);
    expect(
      result.harnessHistory.some((entry) =>
        entry.startsWith("report from developer:"),
      ),
    ).toBe(true);
    // Guidance channel: stored, then consumed by the loop.
    harness.guide("prefer the simpler edit");
    expect(harness.engine.guidance.peek()).toBe("prefer the simpler edit");
  });

  test("fail by design: all-tools spawn refused, wider lanes refused", () => {
    const caller = {
      name: "harness",
      tools: ["files.read", "files.edit", "terminal.run"],
      lanes: ["src/**"],
    };
    expect(() =>
      createAgent({ name: "dev", goal: "g", tools: [...caller.tools] }, caller),
    ).toThrow(/never gets all caller tools/);
    expect(() =>
      createAgent(
        {
          name: "dev",
          goal: "g",
          tools: ["files.read"],
          lanes: ["**"],
        },
        caller,
      ),
    ).toThrow(/lanes not held by caller/);
    // A strict subset still spawns fine.
    const agent = createAgent(
      { name: "dev", goal: "g", tools: ["files.read"] },
      caller,
    );
    expect(agent.tools).toEqual(["files.read"]);
  });
});

describe("live status data: typing-style status + steps from the snapshot", () => {
  test("running call -> tool call word + step; failed + partial visible; idle settles", () => {
    const running = liveStatusData({
      id: "engine",
      activity: "llm",
      agents: {
        developer: {
          name: "developer",
          status: "running",
          currentPhase: "execute",
        },
      },
      calls: [
        {
          id: "call-1",
          name: "files.edit",
          status: "running",
          partial: true,
          parallelGroup: "stage-1",
        },
        {
          id: "call-2",
          name: "files.read",
          status: "failed",
          parallelGroup: "stage-1",
        },
      ],
    });
    expect(running.running).toBe(true);
    expect(running.word).toBe("tool call");
    expect(running.currentStep).toBe("files.edit");
    expect(running.steps.find((s) => s.id === "call-1").partial).toBe(true);
    expect(running.steps.find((s) => s.id === "call-2").status).toBe("failed");
    const idle = liveStatusData({ id: "engine", activity: "idle", calls: [] });
    expect(idle.running).toBe(false);
    expect(idle.word).toBe("idle");
    expect(idle.steps).toEqual([]);
  });
});
