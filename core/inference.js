/** Inference — one abstract base, the transports, one factory.
 *
 *     Inference (abstract)          .infer(prompt, multimodal) -> string
 *     ├─ OpenAICompatible           /v1/responses or /v1/chat/completions
 *     └─ AnthropicCompatible        /v1/messages
 *
 *     getInference("local")   -> Inference   (an entry in models.json)
 *     getInference()          -> Inference   (that file's default entry)
 *
 * omlx, LM Studio, vLLM and api.openai.com are one class and differ only in
 * their base_url, which is why there is no provider table: the endpoints live
 * in ``models.json``, where a new server is a new entry rather than a code
 * change. Anthropic gets the second class for its different wire format.
 *
 * The Python's third transport shelled out to the local `claude` binary; a page
 * has no subprocesses, so it joins `KINDS` only where a spawner does (R5).
 *
 * The base and the transports live in `inference-base.js` and
 * `inference-http.js`, re-exported here, because one file holding all three
 * parts does not fit in 200 lines. To a caller this module is the whole of it.
 */

import { Inference, Message, Multimodality } from "./inference-base.js";
import { AnthropicCompatible, OpenAICompatible } from "./inference-http.js";

export { AnthropicCompatible, Inference, Message, Multimodality, OpenAICompatible };

/**
 * @typedef {import("./inference-base.js").InferenceOptions} InferenceOptions
 * @typedef {import("./inference-base.js").Log} Log
 * @typedef {import("./ports.js").FsPort} FsPort
 * @typedef {import("./ports.js").FetchPort} FetchPort
 * @typedef {Record<string, unknown>} Settings
 */

/** Where the catalogue lives by default. The Python resolved a path beside its
 *  own source, which a page cannot do, so the path arrives with the call. */
export const MODELS_FILE = "agents/models.json";

// There is no provider table any more. Nearly every server speaks the OpenAI
// protocol and differs only in its base_url, so a provider name bought nothing
// but a place to hardcode a URL. What is left is the wire protocol.
/** @type {Record<string, new (options?: InferenceOptions) => Inference>} */
export const KINDS = {
  openai: OpenAICompatible,
  anthropic: AnthropicCompatible,
};
export const DEFAULT_KIND = "openai";

// Most local servers ignore the key, but the OpenAI client refuses to start
// without one — so an entry that names no key gets a placeholder rather than a
// crash. A real provider answers a placeholder with 401, which says as much.
export const PLACEHOLDER_KEY = "none";

/** The catalogue's key names, in the file's spelling, mapped to the classes'.
 *  @type {Record<string, string>} */
const SETTING_NAMES = {
  base_url: "baseUrl",
  api_key: "apiKey",
  max_tokens: "maxTokens",
  anthropic_version: "anthropicVersion",
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `functools.cache` by another name: one read per file per filesystem.
 *  @type {WeakMap<FsPort, Map<string, Promise<Record<string, unknown>>>>} */
const CACHE = new WeakMap();

/**
 * The model catalogue — ``models.json``, read once.
 *
 *     {"default": "local",
 *      "models": {"local": {"model": "...", "base_url": "http://...", ...}}}
 *
 * A model entry is the keyword arguments for an inference object, so anything
 * the class takes may be set there: api, temperature, max_tokens, timeout.
 * Two keys are the catalogue's own — ``kind`` picks the wire protocol, and
 * ``api_key_env`` names the environment variable holding the key, so no secret
 * is written into the file.
 *
 * @param {FsPort} fs @param {string} [path] @param {Log} [log]
 * @returns {Promise<Record<string, unknown>>}
 */
export function loadModels(fs, path = MODELS_FILE, log = {}) {
  let byPath = CACHE.get(fs);
  if (!byPath) CACHE.set(fs, (byPath = new Map()));
  const hit = byPath.get(path);
  if (hit) return hit;
  const pending = readCatalogue(fs, path, log);
  byPath.set(path, pending);
  return pending;
}

/** @param {FsPort} fs @param {string} path @param {Log} log @returns {Promise<Record<string, unknown>>} */
async function readCatalogue(fs, path, log) {
  /** @type {unknown} */
  let loaded;
  try {
    const text = await fs.read(path);
    if (text === null) return {};
    loaded = JSON.parse(text);
  } catch (error) {
    log.error?.(`${path}: could not be read (${error}) — agents must give their own base_url`);
    return {};
  }
  if (!isObject(loaded)) {
    log.error?.(`${path}: must be a JSON object, got ${Array.isArray(loaded) ? "list" : typeof loaded}`);
    return {};
  }
  return loaded;
}

/** @param {string} kind @param {string} key @returns {string} */
function unknownKind(kind, key) {
  const known = `Unknown model kind '${kind}' for '${key}'. Known: ${Object.keys(KINDS).join(", ")}`;
  // `claude` is a real kind of this system that this build cannot have. Saying
  // only "unknown" would send a reader looking for a typo they did not make.
  if (kind === "claude") return `${known}. The 'claude' kind drives the local CLI and needs a host with subprocesses.`;
  return known;
}

/**
 * The catalogue speaks the file's snake_case; the classes speak camelCase.
 * @param {Settings} settings @returns {InferenceOptions}
 */
function toOptions(settings) {
  /** @type {Settings} */
  const options = {};
  for (const [name, value] of Object.entries(settings)) options[SETTING_NAMES[name] ?? name] = value;
  return /** @type {InferenceOptions} */ (options);
}

/**
 * @typedef {object} Catalogue
 * @property {FsPort} [fs] where `models.json` is read from
 * @property {FetchPort} [fetch] the transports' only way out
 * @property {Record<string, string>} [env] what `os.getenv` was — a page has no
 *   ambient environment, so `api_key_env` resolves against a bag handed in
 * @property {Log} [log] @property {string} [modelsPath]
 */

/**
 * Build an inference object from a catalogue key.
 *
 * ``name`` is that key, not a model id — the two differ, and calling the
 * parameter ``model`` would make ``model=`` unusable as an override.
 *
 *     getInference()                             // the catalogue's default entry
 *     getInference("local")                      // a named entry
 *     getInference("local", {temperature: 0.2})  // ...with one setting changed
 *     getInference("some-other-model")           // not a key: a model id on the default endpoint
 *     getInference("x", {base_url: "http://..."})// no catalogue involved at all
 *
 * A name that is not in the catalogue is taken as a model id served by the
 * default entry's endpoint — one line in an agent file is enough to point it
 * at another model on the same server. ``overrides`` win over everything, so
 * an agent that names its own ``base_url`` needs no catalogue entry at all.
 *
 * @param {string} [name] @param {Settings} [overrides] @param {Catalogue} [deps]
 * @returns {Promise<Inference>}
 */
export async function getInference(name = "", overrides = {}, deps = {}) {
  const { fs, fetch: fetchPort, env = {}, log = {}, modelsPath = MODELS_FILE } = deps;
  const catalogue = fs ? await loadModels(fs, modelsPath, log) : {};
  const entries = isObject(catalogue.models) ? catalogue.models : {};
  const key = String(name).trim() || String(catalogue.default ?? "");

  const entry = entries[key];
  /** @type {Settings} */
  let settings;
  if (isObject(entry)) settings = { ...entry };
  else {
    // Not a key. Serve it from the default entry's endpoint, whatever that is.
    const fallback = entries[String(catalogue.default ?? "")];
    settings = { ...(isObject(fallback) ? fallback : {}), model: key };
  }
  Object.assign(settings, overrides);

  const kind = String(settings.kind ?? DEFAULT_KIND).toLowerCase();
  delete settings.kind;
  const Transport = KINDS[kind];
  if (!Transport) throw new Error(unknownKind(kind, key));

  const keyEnv = settings.api_key_env;
  delete settings.api_key_env;
  if (keyEnv && settings.api_key === undefined) settings.api_key = env[String(keyEnv)] ?? "";
  if (!settings.api_key) settings.api_key = PLACEHOLDER_KEY;

  if (kind === DEFAULT_KIND && !settings.base_url) {
    const file = modelsPath.split("/").pop();
    throw new Error(
      `No endpoint for model '${key || "(unnamed)"}': add it to ${file} ` + "or give the agent a 'base_url'.",
    );
  }
  return new Transport({ ...toOptions(settings), fetch: fetchPort, fs, log });
}
