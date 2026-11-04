import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoal, writeGoalArtifactFile } from "./goal-artifact.js";
import {
  checkpoint,
  healthCheck,
  loadCheckpoint,
  restartState,
  restoreFromMarkdown,
  rollback,
} from "./restart.js";
import { createTemplateAgentSkin } from "./template-skin.js";

describe("restart: kept agents + goal survive from markdown, run-only does not", () => {
  test("restartState splits kept vs run-only, records phase + artifact open/focus", () => {
    const state = restartState({
      runningSubagents: [
        { name: "keeper", keep: "desk" },
        { name: "runner", keep: "run" },
      ],
      phase: "execute",
      artifact: { open: ["a.txt"], focus: { path: "a.txt" } },
    });
    expect(state.restartList).toEqual([{ type: "agent", name: "keeper" }]);
    expect(state.runOnlyNotRestarted).toEqual(["runner"]);
    expect(state.artifact).toEqual({
      open: ["a.txt"],
      focus: { path: "a.txt" },
    });
  });

  test("checkpoint before restart is bounded, newest kept, rollback restores", () => {
    const storeDir = mkdtempSync(join(tmpdir(), "askk-ckpt-"));
    const base = { "a.txt": "old", "b.txt": "same" };
    const files = { "a.txt": "new", "b.txt": "same", "c.txt": "added" };
    const record = checkpoint({ why: "before restart", files, base, storeDir });
    expect(Object.keys(record.files).sort()).toEqual(["a.txt", "c.txt"]);
    expect(record.truncated).toBe(false);
    expect(loadCheckpoint(storeDir, record.id).why).toBe("before restart");
    const written = {};
    rollback(record, {
      write: (path, content) => {
        written[path] = content;
      },
    });
    expect(written).toEqual({ "a.txt": "new", "c.txt": "added" });
    // Newest 5 kept: 6 checkpoints leave 5 files behind.
    for (let i = 0; i < 5; i += 1) {
      checkpoint({ why: `ckpt ${i}`, files, base, storeDir });
    }
    expect(
      readdirSync(storeDir).filter((n) => n.endsWith(".json")),
    ).toHaveLength(5);
  });

  test("restore from markdown: desk-kept agent + goal return, run-only does not", () => {
    const dir = mkdtempSync(join(tmpdir(), "askk-restore-"));
    createTemplateAgentSkin({
      name: "keeper",
      baseDir: dir,
      role: "keeps",
      goal: "g",
      tools: ["files.read"],
      keep: "desk",
    });
    createTemplateAgentSkin({
      name: "runner",
      baseDir: dir,
      role: "runs",
      goal: "g",
      tools: ["files.read"],
      keep: "run",
    });
    const goal = createGoal({ id: "g1", statement: "restore me" });
    goal.addStep("step-1");
    const goalDir = join(dir, "memory", "agent", "keeper");
    mkdirSync(goalDir, { recursive: true });
    const goalFile = writeGoalArtifactFile(goalDir, goal);
    const restored = restoreFromMarkdown({
      personalDir: dir,
      agentNames: ["keeper", "runner"],
      goalFiles: [goalFile],
    });
    expect(restored.agents.map((a) => a.name)).toEqual(["keeper"]);
    expect(restored.goals[0].statement).toBe("restore me");
    expect(restored.goals[0].state().stepsRemaining).toBe(1);
  });

  test("healthCheck reports missing desk plainly; supervisor never runs agent code here", () => {
    const missing = healthCheck({
      deskDir: "/definitely/not/a/desk",
      requiredFiles: ["memory/soul.md"],
    });
    expect(missing.ok).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "askk-health-"));
    writeFileSync(join(dir, "soul.md"), "soul", "utf8");
    const ok = healthCheck({ deskDir: dir, requiredFiles: ["soul.md"] });
    expect(ok.ok).toBe(true);
    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(join(dir, "soul.md"), "utf8")).toBe("soul");
  });
});
