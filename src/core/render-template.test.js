import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesk } from "./desk.js";
import { templateData } from "./render-template.js";

describe("templateData defaults", () => {
  test("null desk and no messages never crash, all sections empty", () => {
    const props = templateData(null, []);
    expect(props.soul.instructions).toBe("");
    expect(props.agent.status).toBe("No model configured");
    expect(props.agent.model).toBeNull();
    expect(props.agent.messageCount).toBe(0);
    expect(props.history.session).toEqual([]);
    expect(props.history.agent).toEqual([]);
    expect(props.tools.list).toEqual([]);
    expect(props.liveArtifacts).toEqual([]);
    expect(props.skills).toEqual([]);
    expect(props.messages).toEqual([]);
  });

  test("missing artifact, skills, and history render as empty/placeholder", () => {
    const props = templateData(
      { engine: { instructions: "You are ASKK.", model: null } },
      [{ role: "user", content: "hi" }],
    );
    expect(props.liveArtifacts).toEqual([]);
    expect(props.skills).toEqual([]);
    expect(props.history.agent).toEqual([]);
    expect(props.history.session).toEqual([{ role: "user", content: "hi" }]);
    expect(props.agent.messageCount).toBe(1);
  });

  test("maps a full desk: engine, default inference, tools, artifacts, agent history", () => {
    const desk = {
      engine: {
        instructions: "You are ASKK, a helpful assistant.",
        model: "ollama-llama",
        metadata: { source: "personal" },
        twin: () => ({
          element: "engine",
          model: "ollama-llama",
          metadata: { source: "personal" },
          instructionsPreview: "You are ASKK, a helpful assistant.",
        }),
      },
      defaultInference: {
        id: "ollama-llama",
        provider: "ollama",
        endpoint: "http://localhost:11434/v1",
        model: "llama",
      },
      inferences: [{ id: "ollama-llama" }],
      listTools: () => [
        {
          name: "files.list",
          description: "List a folder.",
          input: { path: "folder" },
          expectation: "immediate",
          type: "function",
        },
      ],
      listArtifacts: () => [
        {
          id: "default",
          root: "",
          treeCount: 3,
          open: ["src/core/tool.js"],
          focus: null,
          modified: [],
        },
      ],
      agentHistory: [
        {
          timestamp: "2026-11-03T22:15:00.000Z",
          action: "files.open",
          agent: "default",
          path: "src/core/tool.js",
          detail: "opened, 120 lines",
        },
      ],
    };
    const props = templateData(desk, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
    expect(props.soul.instructions).toBe("You are ASKK, a helpful assistant.");
    expect(props.soul.source).toBe("personal");
    expect(props.agent.status).toBe("Ready");
    expect(props.agent.provider).toBe("ollama");
    expect(props.agent.endpoint).toBe("http://localhost:11434/v1");
    expect(props.agent.inferenceCount).toBe(1);
    expect(props.agent.messageCount).toBe(2);
    expect(props.tools.list.map((t) => t.name)).toEqual(["files.list"]);
    expect(props.liveArtifacts.map((a) => a.id)).toEqual(["default"]);
    expect(props.history.agent[0].action).toBe("files.open");
    expect(props.history.agent[0].path).toBe("src/core/tool.js");
    expect(props.skills).toEqual([]);
  });
});

describe("soul data shape via the desk loader", () => {
  test("personal instructions win over public defaults", () => {
    const personal = mkdtempSync(join(tmpdir(), "askk-personal-"));
    const defaults = mkdtempSync(join(tmpdir(), "askk-defaults-"));
    writeFileSync(join(personal, "instructions.md"), "Personal soul.");
    writeFileSync(join(defaults, "instructions.md"), "Public soul.");
    const desk = createDesk(personal, { defaultsDir: defaults });
    // This is exactly what GET /api/soul returns.
    const soul = {
      instructions: desk.engine.instructions,
      source: desk.engine.metadata?.source ?? "public",
    };
    expect(soul.instructions).toBe("Personal soul.");
    expect(soul.source).toBe("personal");
  });

  test("absent personal instructions fall back to public, never error", () => {
    const personal = mkdtempSync(join(tmpdir(), "askk-personal-"));
    const defaults = mkdtempSync(join(tmpdir(), "askk-defaults-"));
    mkdirSync(join(defaults), { recursive: true });
    writeFileSync(join(defaults, "instructions.md"), "Public soul.");
    const desk = createDesk(personal, { defaultsDir: defaults });
    const soul = {
      instructions: desk.engine.instructions,
      source: desk.engine.metadata?.source ?? "public",
    };
    expect(soul.instructions).toBe("Public soul.");
    expect(soul.source).toBe("public");
  });
});
