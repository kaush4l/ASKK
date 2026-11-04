import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadEngineByName } from "./engine-by-name.js";

function makePersonal(agentName, { instructions, agent, state, history } = {}) {
  const personal = mkdtempSync(join(tmpdir(), "engine-by-name-"));
  mkdirSync(join(personal, "memory", "agent", agentName), { recursive: true });
  writeFileSync(
    join(personal, "memory", `${agentName}.agent.md`),
    agent ??
      `# Agent: ${agentName}\n\n- name: ${agentName}\n- role: tester\n- tools: files.read, files.list, terminal.run\n- keep: run\n`,
  );
  writeFileSync(
    join(personal, "memory", `${agentName}.instructions.md`),
    instructions ?? "You test things. Read only, never invent.",
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

describe("loadEngineByName — name only", () => {
  test("loads instructions, tools, and live state from the name alone", () => {
    const personal = makePersonal("tester", {
      state: "# State\n\n- step: done\n",
      history: "# History\n\n- run: first\n",
    });
    const engine = loadEngineByName("tester", { personalDir: personal });
    expect(engine.name).toBe("tester");
    expect(engine.instructions).toContain("Read only, never invent");
    expect(engine.toolNames).toEqual([
      "files.read",
      "files.list",
      "terminal.run",
    ]);
    expect(engine.tools.map((t) => t.name)).toEqual(engine.toolNames);
    expect(engine.missingTools).toEqual([]);
    expect(engine.liveState.stateFound).toBe(true);
    expect(engine.liveState.state).toContain("step: done");
    expect(engine.liveState.historyFound).toBe(true);
    expect(engine.liveState.history).toContain("run: first");
  });

  test("missing live state is empty, never invented", () => {
    const personal = makePersonal("tester");
    const engine = loadEngineByName("tester", { personalDir: personal });
    expect(engine.liveState.stateFound).toBe(false);
    expect(engine.liveState.state).toBe("");
    expect(engine.liveState.historyFound).toBe(false);
    expect(engine.liveState.history).toBe("");
  });

  test("tool descriptions come from the tools themselves, not the agent file", () => {
    const personal = makePersonal("tester");
    const engine = loadEngineByName("tester", { personalDir: personal });
    const described = engine.describeTools();
    expect(described).toContain("files.read");
    // The agent file contains no tool descriptions; the description
    // must come from the tool instance's describe() method.
    expect(described.length).toBeGreaterThan(engine.toolNames.join(",").length);
  });

  test("a tool name with no registry tool is recorded, never invented", () => {
    const personal = makePersonal("tester", {
      agent:
        "# Agent: tester\n\n- name: tester\n- tools: files.read, goal.create\n",
    });
    const engine = loadEngineByName("tester", { personalDir: personal });
    expect(engine.tools.map((t) => t.name)).toEqual(["files.read"]);
    expect(engine.missingTools).toEqual(["goal.create"]);
  });

  test("unknown agent and bad names throw plainly", () => {
    const personal = makePersonal("tester");
    expect(() => loadEngineByName("nobody", { personalDir: personal })).toThrow(
      'no agent named "nobody"',
    );
    expect(() => loadEngineByName("")).toThrow("engine needs a name");
    expect(() => loadEngineByName("../tester")).toThrow("not a path");
  });

  test("twin is plain data with no tool instances", () => {
    const personal = makePersonal("tester", { state: "state here" });
    const engine = loadEngineByName("tester", { personalDir: personal });
    const twin = engine.twin();
    expect(twin.name).toBe("tester");
    expect(twin.tools).toEqual(["files.read", "files.list", "terminal.run"]);
    expect(typeof twin.liveState.state).toBe("string");
  });
});
