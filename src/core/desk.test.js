// Tests for the desk: personal/model.json (a list), the first-entry
// default, engine model override, empty-list behaviour, apiKeyEnv
// resolution, and Save-style append without storing a key.
// No real model is called: fetch is mocked.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendInference,
  createDesk,
  defaultApiKeyEnv,
  moveInferenceToFront,
  parseEnvText,
  publicDesk,
  upsertEnvText,
} from "./desk.js";
import { chat } from "./engine.js";

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeDeskDir({ models, env } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "askk-desk-"));
  writeFileSync(join(dir, "instructions.md"), "You are ASKK.\n");
  if (models !== undefined) {
    writeFileSync(join(dir, "model.json"), JSON.stringify(models, null, 2));
  }
  if (env !== undefined) {
    writeFileSync(join(dir, ".env"), env);
  }
  return dir;
}

describe("model.json list and desk default", () => {
  test("first entry is the desk default", () => {
    const dir = makeDeskDir({
      models: [
        {
          id: "local-llama",
          provider: "ollama",
          endpoint: "http://localhost:11434/v1",
          model: "llama-...",
        },
        {
          id: "remote-gpt",
          provider: "openai",
          endpoint: "https://api.openai.com/v1",
          model: "gpt-...",
        },
      ],
    });
    try {
      const desk = createDesk(dir);
      expect(desk.defaultInference.id).toBe("local-llama");
      expect(desk.engine.model).toBe("local-llama");
      expect(desk.inferences).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("absent model.json means an empty list and no default", () => {
    const dir = makeDeskDir({});
    try {
      const desk = createDesk(dir);
      expect(desk.inferences).toEqual([]);
      expect(desk.defaultInference).toBeUndefined();
      expect(desk.engine.model).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a non-list model.json is an error, not a silent default", () => {
    const dir = makeDeskDir({
      models: { id: "solo", provider: "ollama" },
    });
    try {
      expect(() => createDesk(dir)).toThrow("to be a list");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("engine model overrides the desk default by id", async () => {
    const dir = makeDeskDir({
      models: [
        {
          id: "first",
          provider: "ollama",
          endpoint: "http://example.invalid/v1",
          model: "model-one",
        },
        {
          id: "second",
          provider: "ollama",
          endpoint: "http://example.invalid/v1",
          model: "model-two",
        },
      ],
    });
    try {
      const calls = [];
      const desk = createDesk(dir, {
        fetchImpl: async (_url, options) => {
          calls.push(JSON.parse(options.body).model);
          return jsonResponse({
            choices: [{ message: { content: "ok" } }],
          });
        },
      });
      // Desk default is "first" / model-one.
      expect(desk.defaultInference.id).toBe("first");
      // An engine carrying model "second" resolves to model-two.
      const engine = { ...desk.engine, model: "second" };
      await chat(engine, {
        inferences: desk.inferences,
        messages: [{ role: "user", content: "Hi" }],
      });
      expect(calls).toEqual(["model-two"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty list means chat throws a clear no-model error", async () => {
    const dir = makeDeskDir({});
    try {
      const desk = createDesk(dir);
      await expect(
        chat(desk.engine, {
          inferences: desk.inferences,
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toThrow("no model configured");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("apiKeyEnv resolution", () => {
  test("resolves a key from a temp .env file and never puts it in model.json", () => {
    const dir = makeDeskDir({
      models: [
        {
          id: "remote-gpt",
          provider: "openai",
          endpoint: "https://api.openai.com/v1",
          model: "gpt-...",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      ],
      env: "OPENAI_API_KEY=sk-test-secret\n",
    });
    try {
      const desk = createDesk(dir);
      expect(desk.inferences[0].apiKey).toBe("sk-test-secret");
      // The key lives on the server-side inference object for the
      // call, but the public desk view (what API routes return) and
      // the model.json entry itself carry no key.
      expect(JSON.stringify(publicDesk(desk))).not.toContain("sk-test");
      expect(readFileSync(join(dir, "model.json"), "utf8")).not.toContain(
        "sk-test",
      );
      // parseEnvText: comments and quoting.
      expect(parseEnvText("# note\nA=\"1\"\nB='2'\nC=3\n")).toEqual({
        A: "1",
        B: "2",
        C: "3",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("defaultApiKeyEnv derives a name from the provider", () => {
    expect(defaultApiKeyEnv("ollama")).toBe("OLLAMA_API_KEY");
    expect(defaultApiKeyEnv("my provider")).toBe("MY_PROVIDER_API_KEY");
  });
});

describe("personal / public fallback", () => {
  function makeDir(files) {
    const dir = mkdtempSync(join(tmpdir(), "askk-fallback-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return dir;
  }

  test("personal present wins over public defaults, per file", () => {
    const personal = makeDir({
      "instructions.md": "Personal instructions.\n",
    });
    const defaults = makeDir({
      "instructions.md": "Default instructions.\n",
      "model.json": JSON.stringify([
        {
          id: "def",
          provider: "ollama",
          endpoint: "http://localhost:11434/v1",
          model: "default-model",
        },
      ]),
    });
    try {
      const desk = createDesk(personal, { defaultsDir: defaults });
      // Instructions from personal, model list from defaults.
      expect(desk.engine.instructions).toBe("Personal instructions.");
      expect(desk.defaultInference.id).toBe("def");
      expect(desk.engine.metadata.source).toBe("personal");
    } finally {
      rmSync(personal, { recursive: true, force: true });
      rmSync(defaults, { recursive: true, force: true });
    }
  });

  test("personal absent entirely loads public defaults", () => {
    const defaults = makeDir({
      "instructions.md": "Default instructions.\n",
      "model.json": "[]",
    });
    const missing = join(tmpdir(), "askk-no-personal-xyz");
    try {
      const desk = createDesk(missing, { defaultsDir: defaults });
      expect(desk.engine.instructions).toBe("Default instructions.");
      expect(desk.inferences).toEqual([]);
      expect(desk.defaultInference).toBeUndefined();
      expect(desk.engine.metadata.source).toBe("public");
    } finally {
      rmSync(defaults, { recursive: true, force: true });
    }
  });

  test("personal model.json absent falls back to defaults model list, .env stays personal-only", () => {
    const personal = makeDir({
      "instructions.md": "Personal instructions.\n",
      ".env": "OLLAMA_API_KEY=sk-personal\n",
    });
    const defaults = makeDir({
      "instructions.md": "Default instructions.\n",
      "model.json": JSON.stringify([
        {
          id: "def",
          provider: "ollama",
          endpoint: "http://localhost:11434/v1",
          model: "default-model",
          apiKeyEnv: "OLLAMA_API_KEY",
        },
      ]),
      // Even if a public .env existed, it must NOT be read.
      ".env": "OLLAMA_API_KEY=sk-public-must-not-win\n",
    });
    try {
      const desk = createDesk(personal, { defaultsDir: defaults });
      expect(desk.defaultInference.id).toBe("def");
      expect(desk.inferences[0].apiKey).toBe("sk-personal");
    } finally {
      rmSync(personal, { recursive: true, force: true });
      rmSync(defaults, { recursive: true, force: true });
    }
  });
});

describe("Save-style append and default change", () => {
  test("append adds an entry without storing the key in model.json", () => {
    const list = appendInference([], {
      provider: "ollama",
      endpoint: "http://localhost:11434/v1",
      model: "llama-...",
      apiKey: "must-not-be-saved",
    });
    expect(list).toHaveLength(1);
    expect(list[0].apiKeyEnv).toBe("OLLAMA_API_KEY");
    expect(JSON.stringify(list)).not.toContain("must-not-be-saved");
    expect(list[0]).not.toHaveProperty("apiKey");
    // Saving the same id again updates in place, not a duplicate.
    const again = appendInference(list, {
      provider: "ollama",
      endpoint: "http://localhost:11434/v1",
      model: "llama-...",
    });
    expect(again).toHaveLength(1);
  });

  test("moveInferenceToFront changes the default", () => {
    const list = [
      { id: "a", provider: "x", endpoint: "http://e/v1", model: "m1" },
      { id: "b", provider: "y", endpoint: "http://e/v1", model: "m2" },
    ];
    const next = moveInferenceToFront(list, "b");
    expect(next.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(() => moveInferenceToFront(list, "missing")).toThrow(
      "no inference with id",
    );
  });

  test("upsertEnvText updates a line and preserves the rest", () => {
    const out = upsertEnvText("A=1\nB=old\n", "B", "new");
    expect(out).toBe("A=1\nB=new\n");
    expect(upsertEnvText("A=1\n", "C", "3")).toBe("A=1\nC=3\n");
  });
});
