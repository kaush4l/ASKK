// Tests for the single chat engine. No real model is called: fetch is
// mocked, and the engine's one infer call is observed through it.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chat, createEngine, loadEngineFromLocation } from "./engine.js";
import { listModels } from "./inference.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("createEngine", () => {
  test("stores instructions and metadata", () => {
    const engine = createEngine({
      instructions: "Be helpful.",
      metadata: { location: "personal", note: "expand later" },
    });
    expect(engine.instructions).toBe("Be helpful.");
    expect(engine.metadata).toEqual({
      location: "personal",
      note: "expand later",
    });
  });

  test("defaults metadata to an empty object", () => {
    expect(createEngine({ instructions: "Hi." }).metadata).toEqual({});
  });

  test("rejects missing instructions", () => {
    expect(() => createEngine({})).toThrow("string instructions");
  });
});

describe("loadEngineFromLocation", () => {
  test("reads instructions.md from a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "askk-engine-"));
    try {
      writeFileSync(join(dir, "instructions.md"), "You are ASKK.\n");
      const engine = loadEngineFromLocation(dir);
      expect(engine.instructions).toBe("You are ASKK.");
      expect(engine.metadata).toEqual({ location: dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws a clear error when instructions.md is missing", () => {
    expect(() => loadEngineFromLocation("/definitely/not/a/real/dir")).toThrow(
      "instructions.md",
    );
  });
});

describe("chat", () => {
  test("prepends system instructions and makes exactly one infer call", async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({
        choices: [{ message: { content: "Hello back." } }],
      });
    };
    const engine = createEngine({ instructions: "You are ASKK." });
    const reply = await chat(engine, {
      endpoint: "http://localhost:11434/v1/",
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(reply).toBe("Hello back.");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0].body.model).toBe("test-model");
    expect(calls[0].body.messages).toEqual([
      { role: "system", content: "You are ASKK." },
      { role: "user", content: "Hi" },
    ]);
  });
});

describe("listModels", () => {
  test("returns model ids from data[].id", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ data: [{ id: "model-a" }, { id: "model-b" }] });
    const models = await listModels({ endpoint: "http://localhost:11434/v1" });
    expect(models).toEqual(["model-a", "model-b"]);
  });
});
