// Minimal tests for the agent-template correction (frozen scope):
// template parsing, runtime render from the live registry,
// per-element cache, soul fallback, public memory template,
// and template-level observations vs run-specific history.
// Temp folders only; no real model and no network are called.
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendTemplateObservation,
  clearTemplateCache,
  loadAgentMd,
  parseAgentMd,
  renderAgentInstructions,
  renderAgentTwin,
} from "./agent-md.js";
import { appendHistoryEntry, loadLiveArtifact } from "./artifact.js";
import { createDesk } from "./desk.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "askk-agent-md-"));
}

function fakeDesk(tools, messages = []) {
  return {
    engine: {
      instructions: "You are ASKK, a helpful assistant. Answer plainly.",
      twin: () => ({
        element: "engine",
        model: "demo-model",
        instructionsPreview: "You are ASKK, a helpful assistant.",
      }),
    },
    defaultInference: {
      id: "demo",
      provider: "demo",
      endpoint: "http://example.invalid/v1",
      model: "demo-model",
    },
    inferences: [{ id: "demo" }],
    listTools: () => tools,
    listArtifacts: () => [],
    skills: [],
    messages,
  };
}

const TOOLS_A = [
  {
    name: "files.list",
    description: "List a folder.",
    input: {},
    expectation: "immediate",
  },
];
const TOOLS_B = [
  ...TOOLS_A,
  {
    name: "demo.echo",
    description: "Echo.",
    input: {},
    expectation: "immediate",
  },
];

const SHIPPED = readFileSync(
  join(process.cwd(), "public/defaults/agent.md"),
  "utf8",
);

describe("agent.md is a template, not an inventory", () => {
  test("shipped template: no literal tool names, sections incl. soul/instructions/memory/observations", () => {
    expect(SHIPPED).not.toContain("files.list");
    expect(SHIPPED).not.toContain("terminal.run");
    const parsed = parseAgentMd(SHIPPED);
    expect(parsed.version).toBe(2);
    expect(parsed.tools.variable).toBe("desk.tools");
    expect(parsed.soul.variable).toBe("desk.soul");
    expect(parsed.instructions.variable).toBe("desk.engine.instructions");
    expect(parsed.memory.variable).toContain("desk.memory");
    expect(parsed.sections.map((s) => s.id)).toContain("observations");
    expect(JSON.stringify(parsed)).not.toContain("files.list");
  });

  test("a literal tool list in the Tools section is rejected", () => {
    expect(() =>
      parseAgentMd("# Agent: default\n\n## Tools\n\n- files.list — list\n"),
    ).toThrow("must not list tools literally");
  });

  test("personal agent.md wins, public fallback loads, missing both gives built-in", () => {
    const personal = tempDir();
    const defaults = tempDir();
    try {
      writeFileSync(join(personal, "agent.md"), SHIPPED);
      const personalLoaded = loadAgentMd(personal, defaults);
      expect(personalLoaded.source).toBe("personal");
      const publicLoaded = loadAgentMd(
        tempDir(),
        join(process.cwd(), "public/defaults"),
      );
      expect(publicLoaded.source).toBe("public");
      const builtin = loadAgentMd(tempDir(), tempDir());
      expect(builtin.source).toBe("built-in");
      expect(builtin.template.tools.variable).toBe("desk.tools");
    } finally {
      rmSync(personal, { recursive: true, force: true });
      rmSync(defaults, { recursive: true, force: true });
    }
  });
});

describe("runtime render + per-element cache", () => {
  test("changing desk.tools changes rendered instructions, agent.md untouched", () => {
    clearTemplateCache();
    const template = parseAgentMd(SHIPPED);
    const first = renderAgentInstructions(template, fakeDesk(TOOLS_A), []);
    const second = renderAgentInstructions(template, fakeDesk(TOOLS_B), []);
    expect(first.instructions).toContain("files.list");
    expect(first.instructions).not.toContain("demo.echo");
    expect(second.instructions).toContain("demo.echo");
    expect(SHIPPED).toBe(
      readFileSync(join(process.cwd(), "public/defaults/agent.md"), "utf8"),
    );
  });

  test("rendering twice unchanged returns cache; tools change re-renders Tools only", () => {
    clearTemplateCache();
    const template = parseAgentMd(SHIPPED);
    const desk = fakeDesk(TOOLS_A);
    const first = renderAgentInstructions(template, desk, []);
    const second = renderAgentInstructions(template, desk, []);
    expect(second.instructions).toBe(first.instructions);
    expect(second.sections.every((s) => s.cached)).toBe(true);
    const changed = renderAgentInstructions(template, fakeDesk(TOOLS_B), []);
    const byId = Object.fromEntries(changed.sections.map((s) => [s.id, s]));
    expect(byId.tools.cached).toBe(false);
    expect(byId.tools.rendered).toContain("demo.echo");
    expect(byId.soul.cached).toBe(true);
    expect(byId.history.cached).toBe(true);
  });

  test("rendered twin carries live tools, 0 web, and soul/instructions/memory distinctly", () => {
    clearTemplateCache();
    const template = parseAgentMd(SHIPPED);
    const twin = renderAgentTwin(template, fakeDesk(TOOLS_A), [
      { role: "user", content: "hi" },
    ]);
    expect(twin.tools.count).toBe(1);
    expect(twin.tools.webCount).toBe(0);
    expect(twin.soul.text).toContain("ASKK");
    expect(twin.instructions.text).toContain("You are ASKK");
    expect(twin.soul.text).not.toBe(twin.instructions.text);
    expect(twin.memory).toBeDefined();
  });
});

describe("soul fallback", () => {
  test("personal soul.md wins over public defaults", () => {
    clearTemplateCache();
    const personal = tempDir();
    try {
      writeFileSync(join(personal, "soul.md"), "Personal soul text.\n");
      const template = parseAgentMd(SHIPPED);
      const twin = renderAgentTwin(template, {
        ...fakeDesk(TOOLS_A),
        location: personal,
      });
      expect(twin.soul.text).toBe("Personal soul text.");
      expect(twin.soul.source).toBe("personal");
    } finally {
      rmSync(personal, { recursive: true, force: true });
    }
  });

  test("missing personal soul.md falls back to public, never an error", () => {
    clearTemplateCache();
    const personal = tempDir();
    try {
      const template = parseAgentMd(SHIPPED);
      const twin = renderAgentTwin(template, {
        ...fakeDesk(TOOLS_A),
        location: personal,
      });
      expect(twin.soul.source).toBe("public");
      expect(twin.soul.text.length).toBeGreaterThan(0);
      expect(twin.soul.text).toContain("Soul");
    } finally {
      rmSync(personal, { recursive: true, force: true });
    }
  });
});

describe("public memory template", () => {
  test("loads empty state/history from public template, writes nothing to public/", () => {
    const personal = tempDir();
    const defaults = join(process.cwd(), "public/defaults");
    const beforeState = readFileSync(
      join(defaults, "memory/agent/default/state.md"),
      "utf8",
    );
    const beforeHistory = readFileSync(
      join(defaults, "memory/agent/default/history.md"),
      "utf8",
    );
    try {
      const artifact = loadLiveArtifact({
        id: "default",
        location: process.cwd(),
        personalBase: personal,
        defaultsBase: defaults,
      });
      expect(artifact.memorySource).toBe("public");
      expect(artifact.state().open).toEqual([]);
      expect(artifact.history()).toEqual([]);
      expect(existsSync(join(personal, "memory"))).toBe(false);
    } finally {
      rmSync(personal, { recursive: true, force: true });
    }
    expect(
      readFileSync(join(defaults, "memory/agent/default/state.md"), "utf8"),
    ).toBe(beforeState);
    expect(
      readFileSync(join(defaults, "memory/agent/default/history.md"), "utf8"),
    ).toBe(beforeHistory);
  });

  test("personal memory wins over the public template", () => {
    const personal = tempDir();
    try {
      const artifact = loadLiveArtifact({
        id: "default",
        location: process.cwd(),
        personalBase: personal,
        defaultsBase: join(process.cwd(), "public/defaults"),
      });
      appendHistoryEntry(artifact, {
        action: "files.open",
        agent: "default",
        path: "src/core/tool.js",
        detail: "opened for a test",
      });
      const reloaded = loadLiveArtifact({
        id: "default",
        location: process.cwd(),
        personalBase: personal,
        defaultsBase: join(process.cwd(), "public/defaults"),
      });
      expect(reloaded.memorySource).toBe("personal");
      expect(reloaded.history().length).toBe(1);
      expect(reloaded.history()[0].action).toBe("files.open");
    } finally {
      rmSync(personal, { recursive: true, force: true });
    }
  });
});

describe("observations: template-level vs run-specific", () => {
  test("append observation -> version/improvesOn update, renderer includes it, cache invalidates", () => {
    clearTemplateCache();
    const template = parseAgentMd(SHIPPED);
    renderAgentInstructions(template, fakeDesk(TOOLS_A), []);
    const { text, template: next } = appendTemplateObservation(SHIPPED, {
      date: "2026-11-03",
      agentId: "subagent-1",
      observation: "Tools section renders from the registry at runtime.",
      improvement: "Render Tools from desk.tools, never from the file.",
      improvesOn: "tools v1 (hardcoded list)",
    });
    expect(next.version).toBe(template.version + 1);
    expect(next.improvesOn).toBe("tools v1 (hardcoded list)");
    expect(next.observations).toHaveLength(1);
    expect(next.observations[0].agentId).toBe("subagent-1");
    const rendered = renderAgentInstructions(next, fakeDesk(TOOLS_A), []);
    const obs = rendered.sections.find((s) => s.id === "observations");
    expect(obs.cached).toBe(false);
    expect(obs.rendered).toContain("Tools section renders from the registry");
    expect(rendered.instructions).toContain("subagent-1");
    // Appending to the template text does not rewrite the shipped file.
    expect(text).toContain("subagent-1");
    expect(SHIPPED).not.toContain("subagent-1");
  });

  test("run-specific observation stays in personal history, not in public template output", () => {
    const personal = tempDir();
    try {
      const artifact = loadLiveArtifact({
        id: "default",
        location: process.cwd(),
        personalBase: personal,
        defaultsBase: join(process.cwd(), "public/defaults"),
      });
      appendHistoryEntry(artifact, {
        action: "run.note",
        agent: "default",
        path: null,
        detail: "run-specific-only-xyz",
      });
      const template = parseAgentMd(SHIPPED);
      expect(JSON.stringify(template.observations)).not.toContain(
        "run-specific-only-xyz",
      );
      clearTemplateCache();
      const rendered = renderAgentInstructions(template, fakeDesk(TOOLS_A), []);
      const obs = rendered.sections.find((s) => s.id === "observations");
      expect(obs.rendered).not.toContain("run-specific-only-xyz");
      // And the personal history itself does carry it (the other destination).
      expect(JSON.stringify(artifact.history())).toContain(
        "run-specific-only-xyz",
      );
    } finally {
      rmSync(personal, { recursive: true, force: true });
    }
  });

  test("desk agent twin still renders 16 core tools, 0 web, from the registry", () => {
    const personal = tempDir();
    try {
      writeFileSync(join(personal, "instructions.md"), "You are ASKK.\n");
      const desk = createDesk(personal);
      expect(desk.agent.tools.count).toBe(16);
      expect(desk.agent.tools.webCount).toBe(0);
      expect(desk.agent.soul.text.length).toBeGreaterThan(0);
    } finally {
      rmSync(personal, { recursive: true, force: true });
    }
  });
});
