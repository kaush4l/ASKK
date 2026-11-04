import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentTool, loadAgentTools } from "./agent-tools.js";

function tempDesk() {
  return mkdtempSync(join(tmpdir(), "askk-agent-tools-"));
}

describe("agent-created tools live in memory folders, scoped by agent", () => {
  test("function/script/watcher standards validated; shared vs agent placement", () => {
    const dir = tempDesk();
    const fn = createAgentTool({
      agent: "developer",
      name: "notes.search",
      kind: "function",
      description: "search notes",
      personalDir: dir,
    });
    expect(fn.path).toBe("memory/agent/developer/notes.search.tool.md");
    const script = createAgentTool({
      agent: "developer",
      name: "run-checks",
      kind: "script",
      commands: ["bun test src/core"],
      personalDir: dir,
    });
    expect(script.path).toBe("memory/scripts/developer/run-checks.script.md");
    const watcher = createAgentTool({
      agent: "developer",
      name: "on-build",
      kind: "watcher",
      watch: "build/**",
      notify: "developer",
      personalDir: dir,
    });
    expect(watcher.path).toBe("memory/watchers/developer/on-build.watcher.md");
    const shared = createAgentTool({
      agent: "developer",
      name: "shared.tool",
      kind: "function",
      description: "shared",
      shared: true,
      personalDir: dir,
    });
    expect(shared.path).toBe("memory/agent/shared/shared.tool.tool.md");
    expect(() =>
      createAgentTool({
        agent: "developer",
        name: "Bad Name",
        kind: "function",
        description: "x",
        personalDir: dir,
      }),
    ).toThrow(/tool name/);
    expect(() =>
      createAgentTool({
        agent: "developer",
        name: "x",
        kind: "script",
        personalDir: dir,
      }),
    ).toThrow(/commands/);
    expect(() =>
      createAgentTool({
        agent: "developer",
        name: "x",
        kind: "watcher",
        personalDir: dir,
      }),
    ).toThrow(/watch/);
    expect(() =>
      createAgentTool({
        agent: "developer",
        name: "x",
        kind: "function",
        description: "x",
        lanes: ["secret/**"],
        callerLanes: ["src/**"],
        personalDir: dir,
      }),
    ).toThrow(/lanes not held/);
  });

  test("load returns shared + this agent only, agent-specific wins, never another agent's", async () => {
    const dir = tempDesk();
    createAgentTool({
      agent: "developer",
      name: "mine",
      kind: "function",
      description: "mine",
      personalDir: dir,
    });
    createAgentTool({
      agent: "other",
      name: "theirs",
      kind: "function",
      description: "theirs",
      personalDir: dir,
    });
    createAgentTool({
      agent: "developer",
      name: "shared.one",
      kind: "function",
      description: "shared",
      shared: true,
      personalDir: dir,
    });
    // Agent-specific wins over shared on the same name.
    createAgentTool({
      agent: "developer",
      name: "shared.one",
      kind: "function",
      description: "agent wins",
      personalDir: dir,
    });
    const tools = loadAgentTools({ personalDir: dir }, "developer");
    const names = tools.map((t) => t.name);
    expect(names).toContain("mine");
    expect(names).toContain("shared.one");
    expect(names).not.toContain("theirs");
    const sharedOne = tools.find((t) => t.name === "shared.one");
    expect(sharedOne.description).toBe("agent wins");
    // Milestone 4: a function tool with no JS implementation
    // bound throws honestly, instead of returning a fake
    // { definition, scope } value as it did before.
    await expect(tools.find((t) => t.name === "mine").run({})).rejects.toThrow(
      "no JS implementation bound",
    );
  });
});
