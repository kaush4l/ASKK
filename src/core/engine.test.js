// Tests for the single chat engine and the inference object.
// No real model is called: fetch is mocked, and the engine's one
// infer call is observed through it.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chat, createEngine, loadEngineFromLocation } from "./engine.js";
import { createInference, listModels } from "./inference.js";

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
  test("stores instructions, metadata, and an optional model", () => {
    const engine = createEngine({
      instructions: "Be helpful.",
      metadata: { location: "personal" },
      model: "local-llama",
    });
    expect(engine.instructions).toBe("Be helpful.");
    expect(engine.metadata).toEqual({ location: "personal" });
    expect(engine.model).toBe("local-llama");
  });

  test("defaults metadata to an empty object and model to absent", () => {
    const engine = createEngine({ instructions: "Hi." });
    expect(engine.metadata).toEqual({});
    expect(engine.model).toBeUndefined();
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

describe("chat with an inference object", () => {
  test("prepends system instructions and makes exactly one infer call", async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({
        choices: [{ message: { content: "Hello back." } }],
      });
    };
    const engine = createEngine({ instructions: "You are ASKK." });
    const inference = createInference({
      id: "local-llama",
      provider: "ollama",
      endpoint: "http://localhost:11434/v1/",
      model: "test-model",
    });
    const reply = await chat(engine, {
      inference,
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

  test("resolves an engine model by inference id, then by model string", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ choices: [{ message: { content: "ok" } }] });
    const byId = createInference({
      id: "local-llama",
      provider: "ollama",
      endpoint: "http://example.invalid/v1",
      model: "other-model",
    });
    const byModel = createInference({
      id: "other-id",
      provider: "ollama",
      endpoint: "http://example.invalid/v1",
      model: "llama-model",
    });
    const engine = createEngine({
      instructions: "Hi.",
      model: "local-llama",
    });
    expect(
      await chat(engine, {
        inferences: [byId, byModel],
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).toBe("ok");
    const engineByModel = createEngine({
      instructions: "Hi.",
      model: "llama-model",
    });
    expect(
      await chat(engineByModel, {
        inferences: [byId, byModel],
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).toBe("ok");
  });

  test("throws a clear error when no model is configured", async () => {
    const engine = createEngine({ instructions: "Hi." });
    expect(
      chat(engine, { messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow("no model configured");
  });
});

describe("listModels", () => {
  test("returns model ids from data[].id", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ data: [{ id: "model-a" }, { id: "model-b" }] });
    const models = await listModels({ endpoint: "http://localhost:11434/v1" });
    expect(models).toEqual(["model-a", "model-b"]);
  });

  test("an inference object lists models from its endpoint", async () => {
    const seen = [];
    const inference = createInference({
      endpoint: "http://localhost:11434/v1",
      model: "model-a",
      fetchImpl: async (url) => {
        seen.push(url);
        return jsonResponse({ data: [{ id: "model-a" }] });
      },
    });
    expect(await inference.listModels()).toEqual(["model-a"]);
    expect(seen).toEqual(["http://localhost:11434/v1/models"]);
  });
});
