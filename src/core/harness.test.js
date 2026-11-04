import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCoreTools } from "./core-tools.js";
import { createGoal } from "./goal-artifact.js";
import {
  createHarness,
  createHarnessFromDeskFolder,
  discoverDesk,
  loadGoalDefault,
} from "./harness.js";
import { Tool } from "./tool.js";

function tempDirs() {
  const deskDir = mkdtempSync(join(tmpdir(), "askk-harness-desk-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "askk-harness-work-"));
  mkdirSync(join(deskDir, "memory"), { recursive: true });
  writeFileSync(join(deskDir, "memory", "soul.md"), "Harness soul.", "utf8");
  writeFileSync(join(workspaceDir, "feature.txt"), "old", "utf8");
  return { deskDir, workspaceDir };
}

// Mocked TOON model, phase-aware: it reads the phase duty from the
// prompt messages and answers per internal phase, per turn.
// Critique fails on its first attempt and passes on the second,
// so the test proves the loop-back, not just the happy path.
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

describe("harness chain: one goal.create call -> developer plan->execute->critique loop", () => {
  test("owner request -> goal statement only -> developer edits, mocked tests, critique loops back, completes, reports", async () => {
    const { workspaceDir } = tempDirs();
    const { harness, terminalCalls } = harnessWithMockedTerminal(workspaceDir);
    const result = await harness.ask("change feature.txt from old to new", {
      inference: phaseMockModel(),
    });
    // Exactly ONE goal.create call, statement only.
    expect(result.goalCreateCalls).toBe(1);
    expect(harness.goalCreateCalls).toBe(1);
    // The goal carries no harness-written phases at all.
    expect("phases" in result.goal).toBe(false);
    expect(result.goal.statement).toContain(
      "change feature.txt from old to new",
    );
    // The developer owned its loop: internal phases live on the
    // developer record, and the critique loop-back happened.
    expect(result.developer.internalPhases).toEqual([
      "plan",
      "execute",
      "critique",
      "done",
    ]);
    expect(result.developer.currentPhase).toBe("done");
    expect(result.run.attempts).toBe(2);
    expect(result.run.done).toBe(true);
    const critiques = result.run.phaseResults.filter(
      (entry) => entry.phase === "critique",
    );
    expect(critiques).toHaveLength(2);
    expect(critiques[0].gatePassed).toBe(false);
    expect(critiques[1].gatePassed).toBe(true);
    // The real chain ran: file edited, mocked test command run.
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(workspaceDir, "feature.txt"), "utf8")).toBe("new");
    expect(terminalCalls).toContain("bun test src/core");
    // Report back to the owner, goal marked done.
    expect(result.report).toContain("Done:");
    expect(result.goal.status).toBe("done");
    // The live snapshot shows the same goal the harness made.
    expect(harness.live.snapshot().goals.goal.statement).toContain(
      "change feature.txt",
    );
  });

  test("harness without a model refuses plainly instead of inventing one", async () => {
    const { workspaceDir } = tempDirs();
    const { harness } = harnessWithMockedTerminal(workspaceDir);
    await expect(
      harness.ask("do something", { inference: null }),
    ).rejects.toThrow(/no model configured/);
  });
});

describe("cold start: desk folder -> config -> kernel tools -> harness -> developer -> goal", () => {
  test("from a temp desk folder alone, everything loads and a goal can be created", async () => {
    const { deskDir, workspaceDir } = tempDirs();
    const harness = createHarnessFromDeskFolder({
      deskDir,
      workspaceDir,
    });
    expect(harness.deskConfig.source).toBe("personal");
    expect(harness.kernelToolNames).toContain("files.read");
    expect(harness.kernelToolNames).toContain("terminal.run");
    expect(harness.kernelToolNames).not.toContain("web.search");
    expect(harness.desk.soul).toContain("Harness soul.");
    const goal = createGoal({ statement: "cold start goal" });
    const developer = harness.spawnDeveloper(goal);
    expect(developer.name).toBe("developer");
    expect(developer.internalPhases.map((p) => p.id)).toEqual([
      "plan",
      "execute",
      "critique",
      "done",
    ]);
    expect(harness.children.get("developer")).toBe(developer);
  });

  test("discoverDesk reports an honest empty state when neither folder exists", () => {
    const found = discoverDesk({
      personalDir: join(tmpdir(), "askk-no-such-personal-xyz"),
      defaultsDir: join(tmpdir(), "askk-no-such-defaults-xyz"),
    });
    expect(found.empty).toBe(true);
    expect(found.source).toBe("none");
  });

  test("default goal loads from the template file, not from hardcoded code", () => {
    const loaded = loadGoalDefault({
      defaultsDir: join(process.cwd(), "public/defaults"),
    });
    expect(loaded.default).toBe(false);
    expect(loaded.text).toContain("Take as little human attention as possible");
  });
});
