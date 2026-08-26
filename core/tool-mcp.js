/**
 * An MCP server's catalogue, turned into tools.
 *
 * The Python imported fastmcp here and built the client itself; a pure core
 * cannot open a connection, so the caller owns the client and hands it in —
 * which is what kept MCP an optional dependency there too.
 *
 * The job is schema → prompt bytes: a JSON Schema of a dozen params has to
 * become one honest call example. That is a different job from wrapping one
 * callable, which is why it is not in `tool-call.js`; `Tool.fromMcp` stays
 * there beside its two siblings because it decodes a *result*, not a schema.
 */

import { NO_LOG, Tool } from "./tool-call.js";

/** @typedef {import("./tool-call.js").Log} Log */

/** Python's `json.dumps` spaces `": "` and `", "`; `JSON.stringify` does not.
 * @param {readonly string[]} names @returns {string} */
const usageJson = (names) =>
  `{${names.map((n) => `${JSON.stringify(n)}: ${JSON.stringify(`<${n}>`)}`).join(", ")}}`;

// When a tool declares nothing required, these are the params worth showing.
export const PREFERRED_PARAMS = ["url", "text", "query", "value", "uid", "selector", "key"];

/**
 * Build a call example from an MCP inputSchema — required params only.
 *
 * A server can expose a dozen optional params per tool; sending them all would
 * bury the prompt. Where nothing is required, fall back to the one optional
 * param that actually carries the intent (`navigate_page` requires nothing but
 * is useless without `url`), and otherwise show an empty call.
 * @param {{ properties?: Record<string, unknown>, required?: string[] } | null} [schema]
 * @returns {string}
 */
export function usageFromSchema(schema) {
  const properties = schema?.properties ?? {};
  const declared = schema?.required ?? [];
  const wanted = declared.length ? declared : PREFERRED_PARAMS.filter((p) => p in properties).slice(0, 1);
  return wanted.length ? usageJson(wanted) : "{}";
}

/**
 * Wrap the wanted tools of an already-connected MCP client. `names` filters the
 * catalogue, because servers commonly expose far more tools than one agent
 * needs.
 * @param {any} client @param {string[] | null} [names] @param {Log} [log]
 * @returns {Promise<Tool[]>}
 */
export async function initMcpTools(client, names = null, log = NO_LOG) {
  /** @type {any[]} */
  const catalogue = await client.list_tools();
  const wanted = names ? new Set(names) : null;
  if (wanted) {
    const present = new Set(catalogue.map((spec) => spec.name));
    const missing = [...wanted].filter((n) => !present.has(n)).sort();
    if (missing.length) log.warn(`MCP tools not found on server: ${missing.join(", ")}`);
  }
  return catalogue
    .filter((spec) => wanted === null || wanted.has(spec.name))
    .map((spec) => {
      const description = (spec.description || "").trim().split("\n")[0];
      const usageArgs = usageFromSchema(spec.inputSchema);
      return Tool.fromMcp(client, { name: spec.name, description, usageArgs });
    });
}
