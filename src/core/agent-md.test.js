// Tests for the default agent.md loader: heading/list parsing,
// personal-wins / public-fallback, the 16 core tools with no web
// tools, and the twin carrying no keys and no absolute paths.
// Temp folders only; no real model and no network are called.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentTwin,
  builtInAgent,
  loadAgentMd,
  parseAgentMd,
} from "./agent-md.js";
import { createDesk } from "./desk.js";

const SAMPLE = `# Agent: default

## Soul

- instructions: personal/instructions.md
- fallback: public/defaults/instructions.md
- preview: You are ASKK, a helpful assistant. Answer plainly.

## Model

- default: desk default (first entry in personal/model.json)
- model: (resolved from the desk default at load time, never written here)
- key: sk-secret-that-must-never-leak

## Tools

### files

- files.list — immediate — list files under the live artifact root
- files.open — live-state — keep a file open, re-read on open (max 25)

### terminal

- terminal.run — done — run a command to its end, return exit + last lines
- terminal.list — immediate — list every session

## Live artifact

- id: default
- location: (project root — the desk's root at load time)
- state: personal/memory/agent/default/state.md
- history: personal/memory/agent/default/history.md

## Initialization

1. createDesk — load the desk
2. twin — return the live object for the UI
`;

function tempDir() {
  return mkdtempSync(join(tmpdir(), "askk-agent-md-"));
}

describe("parseAgentMd", () => {
  test("parses soul, model, tools, live artifact and initialization", () => {
    const parsed = parseAgentMd(SAMPLE);
    expect(parsed.name).toBe("default");
    expect(parsed.soul.preview).toBe(
      "You are ASKK, a helpful assistant. Answer plainly.",
    );
    expect(parsed.model.default).toContain("desk default");
    expect(parsed.tools.files).toHaveLength(2);
    expect(parsed.tools.files[1]).toEqual({
      name: "files.open",
      expectation: "live-state",
      purpose: "keep a file open, re-read on open (max 25)",
    });
    expect(parsed.tools.terminal).toHaveLength(2);
    expect(parsed.liveArtifact.id).toBe("default");
    expect(parsed.liveArtifact.state).toBe(
      "personal/memory/agent/default/state.md",
    );
    expect(parsed.initialization).toHaveLength(2);
  });

  test("a key value in agent.md is dropped, never carried", () => {
    const parsed = parseAgentMd(SAMPLE);
    const twin = agentTwin(parsed, {});
    expect(JSON.stringify(twin)).not.toContain(
      "sk-secret-that-must-never-leak",
    );
    expect(twin.model).not.toHaveProperty("key");
    expect(twin.soul).not.toHaveProperty("key");
  });

  test("no absolute paths in the twin", () => {
    const parsed = parseAgentMd(SAMPLE);
    const twin = agentTwin(parsed, {});
    expect(JSON.stringify(twin)).not.toContain("/home/");
    expect(JSON.stringify(twin)).not.toContain("/tmp/");
    expect(twin.liveArtifact.location).not.toContain("/");
  });

  test("empty text is an error, not a silent default", () => {
    expect(() => parseAgentMd("")).toThrow("needs text");
  });
});

describe("loadAgentMd fallback", () => {
  test("personal agent.md wins over public defaults", () => {
    const personal = tempDir();
    const defaults = tempDir();
    try {
      writeFileSync(join(personal, "agent.md"), SAMPLE);
      writeFileSync(
        join(defaults, "agent.md"),
        SAMPLE.replace("You are ASKK", "You are PUBLIC"),
      );
      const { agent, source } = loadAgentMd(personal, defaults);
      expect(source).toBe("personal");
      expect(agent.soul.preview).toContain("You are ASKK");
    } finally {
      rmSync(personal, { recursive: true, force: true });
      rmSync(defaults, { recursive: true, force: true });
    }
  });

  test("public defaults load when personal agent.md is absent", () => {
    const personal = tempDir();
    const defaults = tempDir();
    try {
      writeFileSync(
        join(defaults, "agent.md"),
        SAMPLE.replace("You are ASKK", "You are PUBLIC"),
      );
      const { agent, source } = loadAgentMd(personal, defaults);
      expect(source).toBe("public");
      expect(agent.soul.preview).toContain("You are PUBLIC");
    } finally {
      rmSync(personal, { recursive: true, force: true });
      rmSync(defaults, { recursive: true, force: true });
    }
  });

  test("missing both files yields the built-in 16 core tools, 0 web", () => {
    const personal = tempDir();
    const defaults = tempDir();
    try {
      const { agent, source } = loadAgentMd(personal, defaults);
      expect(source).toBe("built-in");
      const twin = agentTwin(agent, {});
      expect(twin.tools.count).toBe(16);
      expect(twin.tools.web).toEqual([]);
      expect(twin.tools.webCount).toBe(0);
      expect(twin.tools.list.map((tool) => tool.name)).toContain("files.open");
      expect(twin.tools.list.map((tool) => tool.name)).toContain(
        "terminal.run",
      );
    } finally {
      rmSync(personal, { recursive: true, force: true });
      rmSync(defaults, { recursive: true, force: true });
    }
  });
});

describe("desk agent + shipped defaults", () => {
  test("desk.agent twin has 16 tools, 0 web, no keys", async () => {
    const { readFileSync } = await import("node:fs");
    const shipped = readFileSync(
      join(process.cwd(), "public/defaults/agent.md"),
      "utf8",
    );
    const parsed = parseAgentMd(shipped);
    const twin = agentTwin(parsed, {});
    expect(twin.tools.count).toBe(16);
    expect(twin.tools.webCount).toBe(0);
    expect(twin.tools.list.some((tool) => tool.name.startsWith("web."))).toBe(
      false,
    );
    expect(JSON.stringify(twin)).not.toContain("sk-");
    expect(builtInAgent().tools.files).toHaveLength(9);
    expect(builtInAgent().tools.terminal).toHaveLength(7);
  });

  test("createDesk loads an agent twin from the shipped default", () => {
    const personal = tempDir();
    try {
      writeFileSync(join(personal, "instructions.md"), "You are ASKK.\n");
      const desk = createDesk(personal);
      expect(desk.agent).toBeDefined();
      expect(desk.agent.tools.count).toBe(16);
      expect(desk.agent.tools.webCount).toBe(0);
      expect(desk.listAgents).toBeDefined();
      expect(desk.listAgents()).toHaveLength(1);
      expect(desk.listAgents()[0].id).toBe("default");
    } finally {
      rmSync(personal, { recursive: true, force: true });
    }
  });
});
