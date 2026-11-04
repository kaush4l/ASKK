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
import { createEngineObject } from "./engine-object.js";
import { loadAgentDefinition } from "./harness.js";
import {
  initializeAgent,
  initializeDeskObjects,
  scanAgents,
  scanScripts,
  scanWatchers,
  startupSequence,
} from "./startup.js";

function tempDesk() {
  const personal = mkdtempSync(join(tmpdir(), "askk-startup-personal-"));
  const defaults = mkdtempSync(join(tmpdir(), "askk-startup-defaults-"));
  mkdirSync(join(personal, "memory", "scripts", "shared"), { recursive: true });
  mkdirSync(join(personal, "memory", "watchers", "shared"), {
    recursive: true,
  });
  mkdirSync(join(personal, "memory", "skills", "shared"), { recursive: true });
  mkdirSync(join(personal, "memory", "agent", "tester"), { recursive: true });
  // A scanned agent, defined ONLY by its agent.md metadata.
  writeFileSync(
    join(personal, "memory", "tester.agent.md"),
    "# Agent: tester\n\n- name: tester\n- role: test agent\n- goal: test goals\n- tools: files.read, files.list, no.such.tool\n- keep: run\n- version: 3\n",
    "utf8",
  );
  writeFileSync(
    join(personal, "memory", "tester.instructions.md"),
    "Test instructions.",
    "utf8",
  );
  // A tools.md file that MUST be ignored: it names a fake tool
  // and must never reach the agent's tool list.
  writeFileSync(
    join(personal, "memory", "tester.tools.md"),
    "# Tools: tester\n\n- fake.tool — invented by a prose file\n",
    "utf8",
  );
  // A script definition and a watcher definition, both .md.
  writeFileSync(
    join(personal, "memory", "scripts", "shared", "hi.shortcut.script.md"),
    "# Script: hi\n\n- kind: shortcut\n- trigger: on-demand\n- commands:\n  - bun test src/core\n- notify: caller, on done\n",
    "utf8",
  );
  writeFileSync(
    join(personal, "memory", "watchers", "shared", "done.notify.script.md"),
    "# Script: done\n\n- kind: notify\n- trigger: on-event\n- watch: build exits\n- notify: owner\n- halt: after 3 failures\n",
    "utf8",
  );
  writeFileSync(
    join(personal, "memory", "skills", "shared", "read.skill.md"),
    "- id: read\n- duty: read only\n- allowedTools: files.read\n\nRead, do not edit.\n",
    "utf8",
  );
  return { personal, defaults };
}

function fakeEngine(location) {
  return createEngineObject({
    location,
    soul: "Soul.",
    engine: { instructions: "YOU ARE test.", inference: null },
    tools: [
      {
        name: "files.read",
        description: "read",
        input: {},
        spec: () => ({ name: "files.read", description: "read", input: {} }),
      },
      {
        name: "files.list",
        description: "list",
        input: {},
        spec: () => ({ name: "files.list", description: "list", input: {} }),
      },
    ],
    listTools: () => [
      { name: "files.read", description: "read", input: {} },
      { name: "files.list", description: "list", input: {} },
    ],
    artifacts: [],
    agent: { name: "tester", id: "tester" },
  });
}

describe("startup: scan-and-initialize, agent.md names only, tools.md ignored", () => {
  test("loadAgentDefinition never reads <name>.tools.md", () => {
    const { personal, defaults } = tempDesk();
    const agent = loadAgentDefinition("tester", {
      personalDir: personal,
      defaultsDir: defaults,
    });
    expect(agent).not.toBeNull();
    expect(agent.tools).toEqual(["files.read", "files.list", "no.such.tool"]);
    expect("toolsText" in agent).toBe(false);
    expect("toolsSource" in agent).toBe(false);
    expect(JSON.stringify(agent)).not.toContain("fake.tool");
  });

  test("initializeAgent resolves names from the registry, missing names are honest errors, never invented", () => {
    const { personal, defaults } = tempDesk();
    const agent = initializeAgent("tester", {
      personalDir: personal,
      defaultsDir: defaults,
    });
    expect(agent.toolNames).toEqual([
      "files.read",
      "files.list",
      "no.such.tool",
    ]);
    expect(agent.tools.map((t) => t.name)).toEqual([
      "files.read",
      "files.list",
    ]);
    expect(agent.missingTools).toEqual(["no.such.tool"]);
    expect(agent.errors.join(" ")).toContain("no.such.tool");
    expect(agent.version).toBe("3");
    expect(
      agent.tools.every(
        (t) => typeof t.description === "string" && t.description !== "",
      ),
    ).toBe(true);
  });

  test("scanAgents finds agents by scanning, personal wins over defaults, no hardcoded names", () => {
    const { personal, defaults } = tempDesk();
    mkdirSync(join(defaults, "memory"), { recursive: true });
    writeFileSync(
      join(defaults, "memory", "tester.agent.md"),
      "# Agent: tester\n\n- name: tester\n- role: defaults role\n- tools: files.read\n",
      "utf8",
    );
    writeFileSync(
      join(defaults, "memory", "other.agent.md"),
      "# Agent: other\n\n- name: other\n- role: other role\n- tools: files.read\n",
      "utf8",
    );
    const agents = scanAgents({ personalDir: personal, defaultsDir: defaults });
    expect(agents.map((a) => a.name)).toEqual(["other", "tester"]);
    expect(agents.find((a) => a.name === "tester").source).toBe("personal");
    expect(agents.find((a) => a.name === "tester").meta.role).toBe(
      "test agent",
    );
  });

  test("scripts and watchers are initialized as objects, not auto-started, state lives on the object not the file", () => {
    const { personal, defaults } = tempDesk();
    const scripts = scanScripts({
      personalDir: personal,
      defaultsDir: defaults,
      agents: [{ name: "tester" }],
    });
    const watchers = scanWatchers({
      personalDir: personal,
      defaultsDir: defaults,
      agents: [{ name: "tester" }],
    });
    expect(scripts.map((s) => s.name)).toContain("hi");
    expect(scripts.find((s) => s.name === "hi").trigger).toBe("on-demand");
    expect(scripts.find((s) => s.name === "hi").started).toBe(false);
    expect(scripts.find((s) => s.name === "hi").runnable).toBe(true);
    expect(scripts.find((s) => s.name === "hi").commands).toContain(
      "bun test src/core",
    );
    expect(watchers.map((w) => w.name)).toContain("done");
    expect(watchers.find((w) => w.name === "done").trigger).toBe("on-event");
    expect(watchers.find((w) => w.name === "done").started).toBe(false);
    expect(watchers.find((w) => w.name === "done").watch).toBe("build exits");
    expect(watchers.find((w) => w.name === "done").halt).toContain(
      "3 failures",
    );
    // State is on the object: mutating it does not rewrite the file.
    const before = readFileSync(
      join(personal, "memory", "watchers", "shared", "done.notify.script.md"),
      "utf8",
    );
    watchers.find((w) => w.name === "done").state.fires = 2;
    expect(
      readFileSync(
        join(personal, "memory", "watchers", "shared", "done.notify.script.md"),
        "utf8",
      ),
    ).toBe(before);
  });

  test("dynamic: adding a tool definition file makes it appear, removing it makes it disappear, no code change", () => {
    const { personal, defaults } = tempDesk();
    const engine = fakeEngine(
      join(tmpdir(), `askk-startup-engine-${Date.now()}`),
    );
    const opts = { personalDir: personal, defaultsDir: defaults };
    const first = initializeDeskObjects(engine, opts);
    expect(
      first.agents
        .find((a) => a.name === "tester")
        .agentDefinitions.map((d) => d.name),
    ).not.toContain("my.tool");
    // Add a tool definition file in the scanned folder.
    writeFileSync(
      join(personal, "memory", "agent", "tester", "my.tool.md"),
      "# Tool: my.tool\n\n- name: my.tool\n- kind: function\n- description: a scanned tool\n",
      "utf8",
    );
    const second = engine.refreshScanned();
    expect(
      second.agents
        .find((a) => a.name === "tester")
        .agentDefinitions.map((d) => d.name),
    ).toContain("my.tool");
    // Remove it again: it disappears on the next refresh.
    rmSync(join(personal, "memory", "agent", "tester", "my.tool.md"));
    const third = engine.refreshScanned();
    expect(
      third.agents
        .find((a) => a.name === "tester")
        .agentDefinitions.map((d) => d.name),
    ).not.toContain("my.tool");
    expect(
      existsSync(join(personal, "memory", "agent", "tester", "my.tool.md")),
    ).toBe(false);
  });

  test("startup sequence is documented in order, desk -> engine -> scan -> harness -> goal -> developer -> report", () => {
    const steps = startupSequence();
    // Milestone 4: the single startup entry is step 0, and
    // desk-discovery is step 1 after it.
    expect(steps[0]).toContain("startup-entry");
    expect(steps[1]).toContain("desk-discovery");
    expect(steps.join("\n")).toContain("getEngineObject-singleton");
    expect(steps.join("\n")).toContain("loadAgentDefinition-per-agent");
    expect(steps.join("\n")).toContain("goal-create");
    expect(steps.join("\n")).toContain("spawn-developer-with-rules");
    expect(steps.join("\n")).toContain("report-back");
    const order = [
      "desk-discovery:",
      "createDesk:",
      "getEngineObject-singleton:",
      "scan-registry-and-memory-tree:",
      "loadAgentDefinition-per-agent:",
      "harness:",
      "dashboard-snapshot-signal:",
      "api-harness:",
      "goal-create:",
      "spawn-developer-with-rules:",
      "report-back:",
    ];
    const joined = steps.join("\n");
    let last = -1;
    for (const step of order) {
      const at = joined.indexOf(step);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });
});
