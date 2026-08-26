/** The toolkit half of the agent loader: what a name in `tools:` resolves to.
 *
 * A name is looked up in three places — the agent's own `tools.js`, the agents next
 * door, and the catalogue of any MCP server under `config` — and the model is never
 * told which it got. `agentfile.js` owns the first two; this owns loading the module
 * and attaching what is left over. The split is the 200-line rule, and it falls
 * where `agent.js` and `agent-recipe.js` already split.
 *
 * `agents/<name>/tools.py` had no browser counterpart: a page cannot import and run
 * a Python module. Agent-owned tools are an ES module now, and the import itself is
 * handed in — the browser needs a blob URL or a dynamic import against its own
 * origin, the host can just `import`, and a pure core may reach for neither.
 */

import { initMcpTools } from "./tool-mcp.js";

/** @typedef {import("./agentfile.js").LoaderDeps} LoaderDeps */
/** @typedef {import("./agent-config.js").Log} Log */

/** A pure core does not own a logger, so one arrives with the deps. @type {Log} */
export const SILENT = { warning() {}, info() {}, error() {} };

/** The name a toolkit entry answers to: a function's, or a Tool's.
 *
 * Python read `__name__`. A JavaScript function's `name` is the same thing until a
 * minifier or a `tool()` wrapper renames it, so a declared `toolName` wins.
 * @param {unknown} item @returns {string} */
export function toolName(item) {
  if (item === null || (typeof item !== "function" && typeof item !== "object")) return "";
  const held = /** @type {{ toolName?: unknown, name?: unknown }} */ (item);
  return String(held.toolName ?? held.name ?? "") || "";
}

/** Import `<directory>/tools.js` and return its tools.
 *
 * Uses the module's `TOOLS` list when present, else every public exported function.
 * A missing or broken tools file costs the agent its tools, never its startup.
 *
 * Python also required `obj.__module__ == module.__name__`, which dropped functions
 * the file merely imported. An ES module's exports carry no such origin, so a
 * re-exported import counts as a tool here — declare `TOOLS` to be exact.
 * @param {string} directory @param {LoaderDeps} deps @returns {Promise<unknown[]>} */
export async function loadTools(directory, deps) {
  const log = deps.log ?? SILENT;
  const path = `${directory}/tools.js`;
  if (!deps.loadModule || !(await deps.ports.fs.exists(path))) return [];

  /** @type {Record<string, unknown>} */
  let module;
  try {
    module = await deps.loadModule(path);
  } catch (error) {
    log.warning(`Skipping tools in ${path}: ${String(error)}`);
    return [];
  }
  if (Array.isArray(module.TOOLS)) return module.TOOLS;
  return Object.entries(module)
    .filter(([key, value]) => !key.startsWith("_") && typeof value === "function")
    .map(([, value]) => value);
}

/** The agent's toolkit before anything outstanding is attached: its own `tools.js`,
 * filtered by the `tools:` list, plus whatever its space brings.
 *
 * The toolkit picks from `tools.js` by name; no toolkit at all takes the lot.
 * @param {string} name @param {string} directory @param {Record<string, any>} metadata
 * @param {string[]} declared @param {LoaderDeps} deps
 * @returns {Promise<{ local: Map<string, unknown>, tools: unknown[], space: any }>} */
export async function equip(name, directory, metadata, declared, deps) {
  const log = deps.log ?? SILENT;
  /** @type {Map<string, unknown>} */
  const local = new Map();
  for (const item of await loadTools(directory, deps)) {
    if (toolName(item)) local.set(toolName(item), item);
  }
  const picked = declared.length ? declared.filter((n) => local.has(n)).map((n) => local.get(n)) : [...local.values()];

  // A space is shared by whoever names it, so this hands back the same object to
  // every agent that asks. Its tools come with it rather than having to be listed
  // too — naming the space is the request, and writing three tool names underneath
  // it would only be a second place to keep in step.
  if (!metadata.space || !deps.getSpace) return { local, tools: picked, space: null };
  const space = await deps.getSpace(String(metadata.space));
  log.info(`${name}: working in the '${space.name}' space (${space.path})`);
  return { local, tools: [...picked, ...space.toolsFor(name)], space };
}

/** Whatever is left is either an MCP tool or another agent — and the agents are the
 * registry's to attach, since they run in their own workers.
 * @param {any} engine @param {unknown} config @param {string[]} outstanding
 * @param {string[]} modalityNames @param {LoaderDeps} deps @returns {Promise<void>} */
export async function attachOutstanding(engine, config, outstanding, modalityNames, deps) {
  const log = deps.log ?? SILENT;
  if (!config || !deps.connectMcp) {
    // Nowhere left for these to come from — say so rather than quietly handing the
    // model a prompt that never mentions them.
    if (outstanding.length) {
      log.warning(`${engine.name}: nothing named ${outstanding.join(", ")} in tools.js or agents/`);
    }
    return;
  }
  try {
    // Fetch the modality providers too, but never advertise them: they run before
    // every call, so the model must not also invoke them by hand.
    const client = await deps.connectMcp(config);
    const wanted = new Set(outstanding);
    const modal = new Set(modalityNames.filter((n) => !wanted.has(n)));
    const warn = { warn: /** @param {string} m */ (m) => log.warning(m) };
    const mcpTools = await initMcpTools(client, [...outstanding, ...modalityNames], warn);
    engine.addTools(...mcpTools.filter((t) => wanted.has(t.name)));
    engine.addModalities(...mcpTools.filter((t) => modal.has(t.name)));
    engine.onClose(() => client.close());
  } catch (error) {
    // An unreachable MCP server costs this agent its tools, not the session.
    log.error(`${engine.name}: MCP init failed: ${String(error)}`);
  }
}
