/** Build an Agent from an agent markdown file.
 *
 *     await loadAgent("main", deps)   ->  Agent   (reads agents/main/agent.md)
 *
 * File layout: YAML frontmatter for metadata, markdown body for the system message.
 *
 *     ---
 *     name: main
 *     engine: react
 *     tools: [list_cron_jobs, chrome, navigate_page]
 *     ---
 *     You are a helpful assistant.
 *
 * Say only what differs from the defaults. `model` is a key into `models.json` — that
 * file holds the endpoint, the model id and the settings, so an agent names an entry
 * rather than repeating a URL, and leaving it out takes the default entry. Any
 * inference setting written here overrides that entry, `base_url` included, which is
 * what lets one agent talk to a different server. The engine brings its own response
 * contract — a react engine already answers in react fields, and every engine already
 * answers in TOON — so writing those out again only creates a second place to change.
 *
 * `space` puts the agent in a shared space: a folder to work in, plus the facts and
 * notes the group keeps. Every agent naming the same space gets the same one, and the
 * tools for writing to it come with it — see `core/space.js`.
 *
 * `tools` is the agent's whole toolkit, written as plain names. Each is resolved
 * against this agent's own `tools.js`, the agents next door, and the catalogue of any
 * MCP server under `config` — so one list mixes a local function, a sub-agent and an
 * MCP tool without having to say which is which. Sub-agents are left to the registry,
 * which owns their workers; `agentNames` tells the loader which names those are.
 * Leaving `tools` out gives the agent everything its own `tools.js` defines.
 *
 * Four things the Python reached for ambiently arrive as arguments, because a pure
 * core has none of them: `loadModule`, `connectMcp` (a connection is not the core's
 * to open — the same reason `tool-mcp.js` takes a client), `getSpace` and `log`.
 */

import { Agent } from "./agent.js";
import { SILENT, attachOutstanding, equip, loadTools, toolName } from "./agentfile-tools.js";
import { parseAgentFile } from "./frontmatter.js";
import { getInference } from "./inference.js";
import { getResponseModel } from "./responses.js";

export { loadTools, toolName };

/** @typedef {import("./frontmatter.js").YamlValue} YamlValue */
/** @typedef {Record<string, YamlValue>} Metadata */
/** @typedef {import("./agent-config.js").Log} Log */

/**
 * @typedef {object} LoaderDeps
 * @property {import("./ports.js").Ports} ports the environment (PHILOSOPHY S9)
 * @property {string} [agentsDir] where the agent folders live
 * @property {ReadonlySet<string> | string[]} [agentNames] names that belong to other
 *   agents — skipped here, because their engines live in other workers and the
 *   registry attaches them once every agent is up
 * @property {(path: string) => Promise<Record<string, any>>} [loadModule] import
 *   `<dir>/tools.js` and hand back its exports
 * @property {(name: string) => any} [getSpace] the shared space called `name`
 * @property {(config: unknown) => Promise<any>} [connectMcp] an entered MCP client
 *   with `list_tools()` and `close()`
 * @property {Record<string, string>} [env] what `os.getenv` was
 * @property {string} [modelsPath]
 * @property {Log} [log]
 */

export const AGENTS_DIR = "agents";

// Handled by name, never passed through as-is.
// 'tools' is the toolkit, resolved name by name — not a value the engine takes directly.
export const RESERVED_KEYS = new Set([
  "model", "engine", "response_model", "config", "tools", "multimodal", "preload_history", "space",
]);

// Set by the loader itself, not by frontmatter.
export const LOADER_KEYS = new Set(["system", "inference", "messages", "log_path", "summarizer", "space"]);

/** The agent's own config keys, in the frontmatter's spelling, mapped to the field
 * each one sets.
 *
 * The Python computed this as `set(Agent.model_fields) - LOADER_KEYS`, a trick that
 * only works because config and runtime share one class (finding F-5) and that
 * JavaScript has no reflection for. Writing it out is what the reflection was
 * reaching for anyway. The mapping is here too: the file speaks snake_case and the
 * class speaks camelCase. */
export const AGENT_KEYS = /** @type {Record<string, string>} */ ({
  name: "name", description: "description", soul: "soul",
  response_layer: "responseLayer", response_model: "responseModel", response_format: "responseFormat",
  tools: "tools", repeat_limit: "repeatLimit", compact_at: "compactAt", keep_recent: "keepRecent",
  stateless: "stateless", flow: "flow", max_rounds: "maxRounds", skills_dir: "skillsDir",
  components: "components", verifier: "verifier", critic: "critic",
});

// One per agent folder, so an agent's conversation travels with the agent.
export const LOG_FILE = "log.txt";
export const HISTORY_HEADING = "## EARLIER CONVERSATIONS";

/** Whatever `metadata[key]` holds, as a list of strings.
 *
 * A non-list yields `[]`. Python iterated the value, so a scalar `tools: read_file`
 * became nine bogus one-character tool names, silently — the same defect
 * FOUND-IN-THE-PYTHON D-2 already ruled on in `skills.py`.
 * @param {Metadata} metadata @param {string} key @returns {string[]} */
const names = (metadata, key) =>
  Array.isArray(metadata[key]) ? metadata[key].map((item) => String(item)) : [];

/** Just the frontmatter — for a caller that must know what an agent wants before it
 * is built. @param {string} name @param {LoaderDeps} deps @returns {Promise<Metadata>} */
export async function agentMetadata(name, deps) {
  const path = `${deps.agentsDir ?? AGENTS_DIR}/${name}/agent.md`;
  const text = await deps.ports.fs.read(path);
  if (text === null) throw new Error(`No agent file at ${path}`);
  return parseAgentFile(text, path).metadata;
}

/** The keys the Agent class declares, in the shape it takes them.
 *
 * `engine` survives as a compatibility spelling: 'base' was the single-turn engine
 * with no response contract, 'react' the looping one — both are the react flow now,
 * differing only in the response model. `flow: full` is the phase graph.
 * @param {string} name @param {Metadata} metadata @returns {Record<string, any>} */
function agentOptions(name, metadata) {
  /** @type {Record<string, any>} */
  const options = {};
  for (const [key, field] of Object.entries(AGENT_KEYS)) {
    if (Object.hasOwn(metadata, key)) options[field] = metadata[key];
  }
  if (options.name === undefined) options.name = name;
  const engineKind = metadata.engine ?? "base";
  if (engineKind === "base" && !Object.hasOwn(metadata, "response_model")) options.responseModel = null;
  if (metadata.response_model) options.responseModel = getResponseModel(String(metadata.response_model));
  return options;
}

/** Reading the log back at startup is opt-in: most agents want a clean slate, and
 * the ones that do not say so. @param {string} name @param {string} system
 * @param {string | null} stored @param {Log} log @returns {string} */
function foldHistory(name, system, stored, log) {
  // The whole file: compaction keeps it to the window the engine held, so there is
  // nothing here that the agent had already summarised away.
  const earlier = (stored ?? "").trim();
  if (!earlier) return system;
  log.info(`${name}: preloaded ${earlier.length} characters of history`);
  // Folded into the system block rather than replayed as turns: it is background,
  // and turns it never took would read as things it said.
  return `${system}\n\n${HISTORY_HEADING}\n\n${earlier}`;
}

/** Whatever is left over is for the inference client, and it wins over the catalogue
 * entry: base_url, api, temperature, max_tokens, timeout. `model` is a key into
 * `models.json`, not a model id — leaving it out takes that file's default entry.
 * @param {Metadata} metadata @param {Log} log @param {LoaderDeps} deps
 * @returns {Promise<import("./inference.js").Inference>} */
function inferenceFor(metadata, log, deps) {
  const settings = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !Object.hasOwn(AGENT_KEYS, key) && !RESERVED_KEYS.has(key)),
  );
  const { fs, fetch } = deps.ports;
  const catalogue = { fs, fetch, env: deps.env, log, modelsPath: deps.modelsPath };
  return getInference(String(metadata.model ?? ""), settings, catalogue);
}

/** Build an Agent from `agents/<name>/agent.md`.
 *
 * The markdown body becomes the engine's system block, `tools` names the toolkit —
 * local functions, MCP tools and sub-agents in one list — and every setting the
 * engine does not claim is forwarded to the inference client, so an agent can point
 * itself at another server without a catalogue entry.
 * @param {string} name @param {LoaderDeps} deps @returns {Promise<Agent>} */
export async function loadAgent(name, deps) {
  const log = deps.log ?? SILENT;
  const directory = `${deps.agentsDir ?? AGENTS_DIR}/${name}`;
  const text = await deps.ports.fs.read(`${directory}/agent.md`);
  if (text === null) throw new Error(`No agent file at ${directory}/agent.md`);
  const { metadata, body } = parseAgentFile(text, `${directory}/agent.md`);

  const options = agentOptions(name, metadata);
  const declared = names(metadata, "tools");
  const modalityNames = names(metadata, "multimodal");
  const { local, tools, space } = await equip(name, directory, metadata, declared, deps);
  options.tools = tools;
  if (space) options.space = space;

  // Where this agent's conversation is kept — its own folder, beside the agent file.
  options.logPath = `${directory}/${LOG_FILE}`;
  options.system = metadata.preload_history
    ? foldHistory(name, body, await deps.ports.fs.read(options.logPath), log)
    : body;

  const inference = await inferenceFor(metadata, log, deps);
  const engine = new Agent({ ...options, ports: deps.ports, log, inference });

  // Modality providers named in frontmatter, resolved against this agent's own tools.js.
  engine.addModalities(...modalityNames.filter((n) => local.has(n)).map((n) => local.get(n)));

  const known = new Set(deps.agentNames ?? []);
  const outstanding = declared.filter((n) => !local.has(n) && !known.has(n));
  await attachOutstanding(engine, metadata.config, outstanding, modalityNames, deps);
  return engine;
}
