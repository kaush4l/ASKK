import { test, expect } from "bun:test";
import { memoryFs } from "../core/ports/memory-fs.js";
import {
  AnthropicCompatible,
  DEFAULT_KIND,
  Inference,
  KINDS,
  Message,
  Multimodality,
  OpenAICompatible,
  PLACEHOLDER_KEY,
  getInference,
  loadModels,
} from "../core/inference.js";

const PNG = "data:image/png;base64,QUFB";

/**
 * A fetch port that records what it was handed and plays a canned reply.
 * @param {unknown} body @param {{ status?: number, text?: string }} [options]
 */
function fakeFetch(body, options = {}) {
  /** @type {{ url: string, init: any, body: any }[]} */
  const calls = [];
  /** @type {any} */
  const port = async (/** @type {any} */ url, /** @type {any} */ init) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    const ok = (options.status ?? 200) < 300;
    return {
      ok,
      status: options.status ?? 200,
      async json() {
        return body;
      },
      async text() {
        return options.text ?? "";
      },
    };
  };
  port.calls = calls;
  return port;
}

/** @param {Record<string, unknown>} catalogue */
function catalogueFs(catalogue) {
  return memoryFs({ files: { "agents/models.json": JSON.stringify(catalogue) } });
}

const LOCAL = {
  default: "local",
  models: {
    local: { model: "qwen", base_url: "http://127.0.0.1:8873/v1", api: "completions", api_key_env: "OMLX_API_KEY" },
    sonnet: { kind: "anthropic", model: "claude-sonnet-5", api_key_env: "ANTHROPIC_API_KEY" },
    "claude-cli": { kind: "claude" },
  },
};

test("Message is one turn and nothing more", () => {
  expect(new Message({ role: "user", content: "hi" }).asDict()).toEqual({ role: "user", content: "hi" });
});

test("Multimodality.of reads the modality off a data URL, or refuses", () => {
  expect(Multimodality.of(PNG)?.modalityType).toBe("image");
  expect(Multimodality.of("data:audio/wav;base64,AA")?.modalityType).toBe("audio");
  expect(Multimodality.of("data:video/mp4;base64,AA")?.modalityType).toBe("video");
  expect(Multimodality.of("data:text/plain;base64,AA")).toBeNull();
  expect(Multimodality.of("http://x/y.png")).toBeNull();
  expect(Multimodality.of(7)).toBeNull();
});

test("splitDataUrl gives back the mime and the payload", () => {
  expect(Multimodality.splitDataUrl("data:image/png;base64,AAA")).toEqual(["image/png", "AAA"]);
});

test("data URLs and remote URLs pass through; a path is read and encoded", async () => {
  const fs = memoryFs({ files: { "shots/a.png": "AAA" } });
  const item = new Multimodality({
    modalityType: "image",
    collection: [PNG, "https://x/y.png", "shots/a.png", ""],
  });
  expect(await item.asDataUrls(fs)).toEqual([PNG, "https://x/y.png", "data:image/png;base64,QUFB"]);
});

test("an unreadable file is skipped with a warning, never a throw", async () => {
  /** @type {string[]} */
  const warnings = [];
  const item = new Multimodality({ modalityType: "image", collection: ["gone.png", PNG] });
  const urls = await item.asDataUrls(memoryFs(), { warn: (m) => warnings.push(m) });
  expect(urls).toEqual([PNG]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("Skipping unreadable image file gone.png");
});

test("an extension with no mime falls back to the modality default", async () => {
  const fs = memoryFs({ files: { "notes": "AAA", "clip.weird": "AAA" } });
  const audio = new Multimodality({ modalityType: "audio", collection: ["notes", "clip.weird"] });
  expect(await audio.asDataUrls(fs)).toEqual([
    "data:audio/wav;base64,QUFB",
    "data:audio/wav;base64,QUFB",
  ]);
});

test("the base is abstract, and its defaults are the Python's", async () => {
  const base = new Inference({ model: "m" });
  expect([base.temperature, base.maxTokens, base.timeout]).toEqual([0.7, 131072, 300]);
  expect(base.infer("hi")).rejects.toThrow("Inference does not implement infer");
  await base.close();
});

test("completions posts to /chat/completions and reads the choice", async () => {
  const port = fakeFetch({ choices: [{ message: { content: "hello" } }] });
  const client = new OpenAICompatible({
    model: "qwen",
    baseUrl: "http://host/v1",
    apiKey: "k",
    fetch: port,
  });
  expect(await client.infer("say hi")).toBe("hello");
  const [call] = port.calls;
  expect(call.url).toBe("http://host/v1/chat/completions");
  expect(call.init.headers.Authorization).toBe("Bearer k");
  expect(call.body).toEqual({
    model: "qwen",
    messages: [{ role: "user", content: "say hi" }],
    temperature: 0.7,
    max_tokens: 131072,
  });
});

test("a content-less choice comes back as the empty string", async () => {
  const port = fakeFetch({ choices: [{ message: { content: null } }] });
  const client = new OpenAICompatible({ baseUrl: "http://host/v1", fetch: port });
  expect(await client.infer("x")).toBe("");
});

test("attachments become image_url, input_audio and video_url parts", async () => {
  const port = fakeFetch({ choices: [{ message: { content: "ok" } }] });
  const client = new OpenAICompatible({ baseUrl: "http://host/v1", fetch: port });
  await client.infer("look", [
    new Multimodality({ modalityType: "image", collection: [PNG] }),
    new Multimodality({ modalityType: "audio", collection: ["data:audio/wav;base64,BBB"] }),
    new Multimodality({ modalityType: "video", collection: ["https://x/y.mp4"] }),
  ]);
  expect(port.calls[0].body.messages[0].content).toEqual([
    { type: "text", text: "look" },
    { type: "image_url", image_url: { url: PNG } },
    { type: "input_audio", input_audio: { data: "BBB", format: "wav" } },
    { type: "video_url", video_url: { url: "https://x/y.mp4" } },
  ]);
});

test("api: responses posts to /responses, images only, and takes output_text", async () => {
  const port = fakeFetch({ output_text: "seen" });
  const client = new OpenAICompatible({ api: "responses", baseUrl: "http://host/v1", fetch: port });
  const said = await client.infer("look", [
    new Multimodality({ modalityType: "image", collection: [PNG] }),
    new Multimodality({ modalityType: "audio", collection: ["data:audio/wav;base64,BBB"] }),
  ]);
  expect(said).toBe("seen");
  expect(port.calls[0].url).toBe("http://host/v1/responses");
  expect(port.calls[0].body.max_output_tokens).toBe(131072);
  expect(port.calls[0].body.input).toEqual([
    { role: "user", content: [{ type: "input_text", text: "look" }, { type: "input_image", image_url: PNG }] },
  ]);
});

test("a responses reply without output_text is read from its blocks", async () => {
  const port = fakeFetch({ output: [{ content: [{ type: "output_text", text: "a" }, { type: "x" }] }] });
  const client = new OpenAICompatible({ api: "responses", baseUrl: "http://host/v1", fetch: port });
  expect(await client.infer("x")).toBe("a");
});

test("anthropic posts to /messages with its own headers and joins the text blocks", async () => {
  const port = fakeFetch({ content: [{ type: "text", text: "he" }, { type: "tool_use" }, { type: "text", text: "y" }] });
  const client = new AnthropicCompatible({ model: "claude-sonnet-5", apiKey: "sk", fetch: port });
  expect(await client.infer("hi")).toBe("hey");
  const [call] = port.calls;
  expect(call.url).toBe("https://api.anthropic.com/v1/messages");
  expect(call.init.headers["x-api-key"]).toBe("sk");
  expect(call.init.headers["anthropic-version"]).toBe("2023-06-01");
  expect(call.body).toEqual({
    model: "claude-sonnet-5",
    max_tokens: 131072,
    temperature: 0.7,
    messages: [{ role: "user", content: "hi" }],
  });
});

test("anthropic takes images only, base64 or url", async () => {
  const port = fakeFetch({ content: [] });
  const client = new AnthropicCompatible({ fetch: port });
  await client.infer("look", [
    new Multimodality({ modalityType: "image", collection: [PNG, "https://x/y.png"] }),
    new Multimodality({ modalityType: "audio", collection: ["data:audio/wav;base64,BBB"] }),
  ]);
  expect(port.calls[0].body.messages[0].content).toEqual([
    { type: "text", text: "look" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "QUFB" } },
    { type: "image", source: { type: "url", url: "https://x/y.png" } },
  ]);
});

test("a non-2xx carries the status and the first 500 characters of the body", async () => {
  const long = "e".repeat(900);
  const port = fakeFetch(null, { status: 503, text: long });
  const client = new OpenAICompatible({ baseUrl: "http://host/v1", fetch: port });
  const failure = await client.infer("x").catch((/** @type {Error} */ e) => e);
  expect(String(failure)).toContain("http://host/v1/chat/completions returned 503");
  expect(String(failure)).toContain("e".repeat(500));
  expect(String(failure)).not.toContain("e".repeat(501));
});

test("the timeout rides on the request as an abort signal", async () => {
  const port = fakeFetch({ choices: [{ message: { content: "" } }] });
  const client = new OpenAICompatible({ baseUrl: "http://host/v1", timeout: 5, fetch: port });
  await client.infer("x");
  expect(port.calls[0].init.signal).toBeInstanceOf(AbortSignal);
});

test("KINDS names the two wire protocols, and claude is not one of them", () => {
  expect(Object.keys(KINDS)).toEqual(["openai", "anthropic"]);
  expect(DEFAULT_KIND).toBe("openai");
});

test("a missing or unreadable catalogue is empty, not an error", async () => {
  expect(await loadModels(memoryFs())).toEqual({});
  /** @type {string[]} */
  const errors = [];
  const fs = memoryFs({ files: { "agents/models.json": "{ nope" } });
  expect(await loadModels(fs, "agents/models.json", { error: (m) => errors.push(m) })).toEqual({});
  expect(errors[0]).toContain("agents/models.json: could not be read (");
  expect(errors[0]).toContain("— agents must give their own base_url");
});

test("a catalogue that is not an object is refused by name", async () => {
  /** @type {string[]} */
  const errors = [];
  const fs = memoryFs({ files: { "agents/models.json": "[1,2]" } });
  expect(await loadModels(fs, "agents/models.json", { error: (m) => errors.push(m) })).toEqual({});
  expect(errors[0]).toBe("agents/models.json: must be a JSON object, got list");
});

test("unnamed takes the default entry; a name takes its own", async () => {
  const fs = catalogueFs(LOCAL);
  const unnamed = await getInference("", {}, { fs });
  expect(unnamed).toBeInstanceOf(OpenAICompatible);
  expect(unnamed.model).toBe("qwen");
  expect(unnamed.baseUrl).toBe("http://127.0.0.1:8873/v1");
  const sonnet = await getInference("sonnet", {}, { fs, env: { ANTHROPIC_API_KEY: "sk-a" } });
  expect(sonnet).toBeInstanceOf(AnthropicCompatible);
  expect(sonnet.apiKey).toBe("sk-a");
});

test("overrides win over everything, catalogue or not", async () => {
  const fs = catalogueFs(LOCAL);
  const tuned = await getInference("local", { temperature: 0.2, base_url: "http://elsewhere/v1" }, { fs });
  expect(tuned.temperature).toBe(0.2);
  expect(tuned.baseUrl).toBe("http://elsewhere/v1");
  const bare = await getInference("x", { base_url: "http://only/v1" }, { fs: memoryFs() });
  expect(bare.model).toBe("x");
  expect(bare.baseUrl).toBe("http://only/v1");
});

test("a name that is not a key is a model id on the default endpoint", async () => {
  const other = await getInference("some-other-model", {}, { fs: catalogueFs(LOCAL) });
  expect(other.model).toBe("some-other-model");
  expect(other.baseUrl).toBe("http://127.0.0.1:8873/v1");
});

test("api_key_env resolves from the env bag, and an absent key gets the placeholder", async () => {
  const fs = catalogueFs(LOCAL);
  expect((await getInference("local", {}, { fs, env: { OMLX_API_KEY: "sk-l" } })).apiKey).toBe("sk-l");
  expect((await getInference("local", {}, { fs })).apiKey).toBe(PLACEHOLDER_KEY);
  expect(PLACEHOLDER_KEY).toBe("none");
});

test("an openai entry with no endpoint says so, naming the file", async () => {
  const fs = catalogueFs({ default: "d", models: { d: { model: "m" } } });
  expect(getInference("", {}, { fs })).rejects.toThrow(
    "No endpoint for model 'd': add it to models.json or give the agent a 'base_url'.",
  );
  expect(getInference("", {}, { fs: memoryFs() })).rejects.toThrow("No endpoint for model '(unnamed)'");
});

test("an unknown kind names the known ones; claude says what it needs", async () => {
  const fs = catalogueFs(LOCAL);
  expect(getInference("claude-cli", {}, { fs })).rejects.toThrow(
    "Unknown model kind 'claude' for 'claude-cli'. Known: openai, anthropic. " +
      "The 'claude' kind drives the local CLI and needs a host with subprocesses.",
  );
  expect(getInference("x", { kind: "wat" }, { fs })).rejects.toThrow(
    "Unknown model kind 'wat' for 'x'. Known: openai, anthropic",
  );
});

test("the catalogue is read once per filesystem", async () => {
  let reads = 0;
  const inner = catalogueFs(LOCAL);
  /** @type {any} */
  const fs = { ...inner, read: async (/** @type {string} */ p) => (reads++, inner.read(p)) };
  await getInference("local", {}, { fs });
  await getInference("sonnet", {}, { fs });
  expect(reads).toBe(1);
});

test("the built client carries the fetch port it will use", async () => {
  const port = fakeFetch({ choices: [{ message: { content: "hi" } }] });
  const client = await getInference("local", {}, { fs: catalogueFs(LOCAL), fetch: port });
  expect(await client.infer("x")).toBe("hi");
  expect(port.calls[0].url).toBe("http://127.0.0.1:8873/v1/chat/completions");
});
