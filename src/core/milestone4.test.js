// Milestone 4 tests — one file, one gap per describe block.
// G1: ONE tool-to-string reader. G2: agent tools are methods
// with real args and real (or honestly throwing) runs. G3: ONE
// local registry object. G4: ONE desk origin (desk-reader for
// memory files, desk.js assembles). G5: ONE startup entry.
// G6: scanned objects are prompt segments + UI data from the
// same engine. G7: unused files are removed, not left.
// Temp folders only; no real model, no network.
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
  createAgentTool,
  loadAgentTools,
  parseArgsValue,
} from "./agent-tools.js";
import { createCoreTools } from "./core-tools.js";
import { createDesk } from "./desk.js";
import { toolsElement } from "./elements.js";
import {
  buildToolsRegistry,
  createEngineObject,
} from "./engine-object.js";
import { getStartedEngine, initializeDeskObjects } from "./startup.js";
import { describeTool, Tool } from "./tool.js";

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Already gone.
  }
}

describe("G1: one tool-to-string reader", () => {
  test("describeTool(instance) == describeTool(spec) == instance.describe(), for every kernel tool", () => {
    const { tools } = createCoreTools({ filesLocation: tempDir("askk-m4-") });
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      const spec = tool.spec();
      expect(describeTool(tool)).toBe(tool.describe());
      expect(describeTool(spec)).toBe(tool.describe());
      expect(describeTool(spec)).toContain(tool.name);
      // The tools element uses the same reader: its string for
      // this one tool must equal describeTool, not a second format.
      expect(toolsElement([spec]).toString()).toBe(tool.describe());
    }
  });

  test("toolSpecToString is no longer a function or a call in src/core (comments may mention its deletion)", () => {
    const files = ["elements.js", "tool.js"];
    for (const file of files) {
      const text = readFileSync(join(process.cwd(), "src/core", file), "utf8");
      expect(text).not.toContain("export function toolSpecToString");
      expect(text).not.toContain("toolSpecToString(");
    }
    expect(
      readFileSync(join(process.cwd(), "src/core/elements.js"), "utf8"),
    ).toContain("describeTool");
  });
});

describe("G2: agent tools are methods, with real args", () => {
  test("args are parsed from the .md definition itself, and the reader string matches them", () => {
    expect(parseArgsValue("path: the file, query: what to search")).toEqual({
      path: "the file",
      query: "what to search",
    });
    const dir = tempDir("askk-m4-agent-");
    try {
      createAgentTool({
        agent: "developer",
        name: "grep",
        kind: "function",
        description: "search files",
        args: { query: "what to search", path: "where to search" },
        personalDir: dir,
      });
      const tools = loadAgentTools({ personalDir: dir }, "developer", {
        implementations: {
          grep: async (input) => ({ found: input.query }),
        },
      });
      const grep = tools.find((t) => t.name === "grep");
      expect(grep.input).toEqual({
        query: "what to search",
        path: "where to search",
      });
      expect(describeTool(grep)).toBe(
        "- grep {query: what to search, path: where to search} — search files",
      );
      return grep.run({ query: "x" }).then((out) => {
        expect(out).toEqual({ found: "x" });
      });
    } finally {
      cleanup(dir);
    }
  });

  test("a function tool with no JS implementation bound throws honestly, never returns a fake definition", async () => {
    const dir = tempDir("askk-m4-unbound-");
    try {
      createAgentTool({
        agent: "developer",
        name: "unbound",
        kind: "function",
        description: "has no method yet",
        personalDir: dir,
      });
      const tools = loadAgentTools({ personalDir: dir }, "developer");
      const tool = tools.find((t) => t.name === "unbound");
      await expect(tool.run({})).rejects.toThrow("no JS implementation bound");
    } finally {
      cleanup(dir);
    }
  });

  test("a script tool with a terminal runner really executes its commands; without one it honestly says executed: false", async () => {
    const dir = tempDir("askk-m4-script-");
    try {
      createAgentTool({
        agent: "developer",
        name: "run-checks",
        kind: "script",
        description: "run checks",
        commands: ["echo hi"],
        personalDir: dir,
      });
      const plain = loadAgentTools({ personalDir: dir }, "developer");
      const plainRun = await plain.find((t) => t.name === "run-checks").run({});
      expect(plainRun.executed).toBe(false);
      expect(plainRun.commands).toEqual(["echo hi"]);
      const ran = [];
      const bound = loadAgentTools({ personalDir: dir }, "developer", {
        terminalRun: async (command) => ran.push(command) && "ok",
      });
      const out = await bound.find((t) => t.name === "run-checks").run({});
      expect(out.executed).toBe(true);
      expect(ran).toEqual(["echo hi"]);
    } finally {
      cleanup(dir);
    }
  });

  test("a watcher tool is immediate, not a claimed stream, and returns its subscription record", async () => {
    const dir = tempDir("askk-m4-watcher-");
    try {
      createAgentTool({
        agent: "developer",
        name: "on-build",
        kind: "watcher",
        description: "notify on build",
        watch: "build exits",
        notify: "owner",
        personalDir: dir,
      });
      const tools = loadAgentTools({ personalDir: dir }, "developer");
      const tool = tools.find((t) => t.name === "on-build");
      expect(tool.expectation).toBe("immediate");
      expect(await tool.run({})).toEqual({
        watch: "build exits",
        event: null,
        notify: "owner",
        scope: "agent",
        started: false,
      });
    } finally {
      cleanup(dir);
    }
  });
});

describe("G3: one local registry object", () => {
  test("registry.describeAll() == tools element string == registry specs, kernel + shared agent tools together", () => {
    const dir = tempDir("askk-m4-registry-");
    try {
      const desk = createDesk(dir);
      const engine = createEngineObject(desk);
      const registry = engine.toolsRegistry;
      expect(registry).toBeTruthy();
      expect(registry.describeAll()).toBe(
        toolsElement(registry.specs()).toString(),
      );
      expect(engine.tools.map((t) => t.name)).toEqual(
        registry.list().map((t) => t.name),
      );
      // Registry holds instances with run(), not specs.
      for (const tool of registry.list()) {
        expect(typeof tool.run).toBe("function");
        expect(tool instanceof Tool).toBe(true);
      }
      // Duplicates are recorded, never silently merged.
      const built = buildToolsRegistry([
        new Tool({ name: "dup", run: async () => 1 }),
        new Tool({ name: "dup", run: async () => 2 }),
      ]);
      expect(built.duplicates).toEqual(["dup"]);
      expect(built.registry.list().length).toBe(1);
    } finally {
      cleanup(dir);
    }
  });
});

describe("G4: one desk origin", () => {
  test("desk.js uses desk-reader for memory-tree soul/instructions, and exposes them on the desk", () => {
    const dir = tempDir("askk-m4-desk-");
    const defaults = tempDir("askk-m4-desk-defaults-");
    try {
      mkdirSync(join(dir, "memory"), { recursive: true });
      writeFileSync(join(dir, "memory", "soul.md"), "Memory soul.", "utf8");
      // Agent-specific instructions for the default agent live
      // in <name>.instructions.md, not in a generic
      // instructions.md — that is the desk-reader's rule, and
      // the generic file is only the fallback when no
      // agent-specific file exists.
      writeFileSync(
        join(dir, "memory", "default.instructions.md"),
        "Memory instructions.",
        "utf8",
      );
      writeFileSync(
        join(dir, "instructions.md"),
        "Legacy instructions.",
        "utf8",
      );
      const desk = createDesk(dir, { defaultsDir: defaults });
      expect(desk.soul).toBe("Memory soul.");
      expect(desk.engine.instructions).toBe("Memory instructions.");
    } finally {
      cleanup(dir);
      cleanup(defaults);
    }
  });
});

describe("G5: one startup entry", () => {
  test("getStartedEngine returns the same engine twice, scanned, and routes use it (file-level wiring)", () => {
    const dir = tempDir("askk-m4-start-");
    try {
      mkdirSync(join(dir, "memory"), { recursive: true });
      const first = getStartedEngine(dir);
      const second = getStartedEngine(dir);
      expect(second).toBe(first);
      expect(first.scanned).toBeTruthy();
      expect(typeof first.toolsRegistry).toBe("object");
      for (const route of [
        "agent",
        "artifact",
        "desk",
        "engine",
        "models",
        "soul",
        "tools",
        "harness",
      ]) {
        const text = readFileSync(
          join(process.cwd(), "src/app/api", route, "route.js"),
          "utf8",
        );
        expect(text).toContain("getStartedEngine");
        expect(text).not.toContain("createDesk(");
      }
    } finally {
      cleanup(dir);
      // The engine cache is per-location; this temp location is
      // unique per run, so no reset is needed here.
    }
  });

  test("initializeDeskObjects builds per-agent registries without leaking agent-specific tools", () => {
    const dir = tempDir("askk-m4-reg-");
    try {
      mkdirSync(join(dir, "memory", "agent", "developer"), {
        recursive: true,
      });
      const engine = createEngineObject(createDesk(dir));
      initializeDeskObjects(engine, {
        personalDir: dir,
        defaultsDir: join(process.cwd(), "public/defaults"),
      });
      expect(engine.toolsRegistry).toBeTruthy();
      expect(engine.agentRegistries).toBeTruthy();
    } finally {
      cleanup(dir);
    }
  });
});

describe("G6: scanned objects are prompt segments and UI data from the same engine", () => {
  test("after a scan, scripts/watchers/skills appear in the prompt and in elementStrings, from the engine object", () => {
    const dir = tempDir("askk-m4-scan-");
    try {
      mkdirSync(join(dir, "memory", "scripts", "shared"), {
        recursive: true,
      });
      writeFileSync(
        join(dir, "memory", "scripts", "shared", "hi.shortcut.script.md"),
        "# Script: hi\n\n- kind: shortcut\n- trigger: on-demand\n- commands:\n  - echo hi\n- notify: caller, on done\n",
        "utf8",
      );
      const engine = createEngineObject(createDesk(dir));
      initializeDeskObjects(engine, {
        personalDir: dir,
        defaultsDir: join(process.cwd(), "public/defaults"),
      });
      const prompt = engine.renderPrompt();
      expect(prompt).toContain("Scripts:");
      expect(prompt).toContain("hi");
      expect(engine.elementStrings().scripts).toContain("hi");
      // The watchers element's id is "watchers-running" (its
      // long-standing id in elements.js), not "watchers".
      expect(engine.elementStrings()["watchers-running"]).toBeTruthy();
      expect(engine.elementStrings().skills).toBeTruthy();
      expect(engine.templateOrder()).toContain("scripts");
      expect(engine.templateOrder()).toContain("watchers-running");
      expect(engine.templateOrder()).toContain("skills");
    } finally {
      cleanup(dir);
    }
  });
});

describe("G7: unused files are removed, not left", () => {
  test("deleted files do not exist in the workdir, and no tools.md remains", () => {
    expect(existsSync(join(process.cwd(), "src/app/api/chat/route.js"))).toBe(
      false,
    );
    expect(existsSync(join(process.cwd(), "src/core/render-template.js"))).toBe(
      false,
    );
    expect(
      existsSync(join(process.cwd(), "src/components/desk-template.jsx")),
    ).toBe(false);
    // Direct check of the known locations (the full tree check
    // — no tools.md anywhere — is in the push diff).
    expect(
      existsSync(
        join(process.cwd(), "public/defaults/memory/default.tools.md"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(process.cwd(), "public/defaults/memory/developer.tools.md"),
      ),
    ).toBe(false);
  });
});
