/**
 * The set of tools one agent may call, and how model text becomes calls.
 *
 *     Toolbox.of(echo, researcherAgent, mcpTool)
 *     ├─ component()             tools           -> instructions for the model
 *     ├─ parseBatches(text)      "a(), b()\nc()" -> [[a, b], [c]]
 *     └─ call(name, args)        dispatch        -> ToolResult
 *
 * Layout carries the schedule. Calls written on one line, comma separated, are
 * independent and run together; a new line means "after everything above". So
 *
 *     navigate_page({"url": "..."})
 *     take_snapshot(), list_pages()
 *
 * is one navigation, then a snapshot and a page list at the same time. Each
 * batch hands its results to the `onResults` callback as soon as they are all
 * back and the agent carries on from there.
 *
 * Nothing here throws. An unknown tool and unreadable arguments each come back
 * as a failed `ToolResult`, because that error text is what lets the model
 * correct itself on the next pass.
 *
 * The three neighbours: `tool-call.js` is one callable, `tool-mcp.js` turns a
 * server's catalogue into callables, `tool-prompt.js` is the TOOLS block.
 */

import { NO_LOG, Tool, ToolResult, reason } from "./tool-call.js";
import { pyStr, pyStrOr } from "./py-str.js";
import { ToolboxComponent } from "./tool-prompt.js";

/** @typedef {import("./tool-call.js").Log} Log */
/** @typedef {[string, Record<string, any>]} Call */

/** Python's `re.DOTALL` is `[\s\S]` here; `g` is what lets us walk the gaps. */
const CALL_PATTERN = /([A-Za-z_]\w*)\s*\(\s*(\{[\s\S]*?\})?\s*\)/g;

// Carried in place of the arguments when their JSON could not be read. A call
// whose arguments are unreadable must not look like one that had none: run it
// anyway and a sub-agent is handed an empty goal, which it answers regardless.
export const ARG_ERROR = "__arg_error__";

/** The three kinds in acceptance order, so a fourth is an entry here rather
 * than an edit to a type-test chain. Nothing matches `null`, so `null` is
 * skipped. @type {{ match: (i: any) => boolean, build: (i: any) => Tool }[]} */
const KINDS = [
  { match: (i) => i instanceof Tool, build: (i) => i },
  { match: (i) => Boolean(i?.invoke && i?.name), build: (i) => Tool.fromAgent(i) },
  { match: (i) => typeof i === "function", build: (i) => Tool.fromFunction(i) },
];

/** @param {string | undefined} source @returns {Record<string, any>} */
function readArgs(source) {
  if (!source) return {};
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    // Kept, not discarded: the call still happens, but as a failure that tells
    // the model what was wrong with what it wrote.
    //
    // Python appends `(at character {e.pos})` here and the offset is the
    // actionable half of the message. JavaScriptCore — Bun's engine and
    // Safari's — gives no such offset: it is absent from the message, and the
    // `line`/`column` on the SyntaxError are the *call site of JSON.parse*, not
    // a position in the JSON (measured: they read 4:36 for two different
    // failures on two different inputs). Deriving one ourselves would mean a
    // second JSON scanner that has to name the same character CPython names,
    // and an offset that disagrees is worse than none. Recorded as D-7.
    return { [ARG_ERROR]: reason(e) };
  }
}

/** The set of tools one agent may call. */
export class Toolbox {
  /** @param {Tool[]} [tools] @param {Log} [log] */
  constructor(tools = [], log = NO_LOG) {
    /** @type {Tool[]} */ this.tools = tools;
    /** @type {Log} */ this.log = log;
  }

  /** Build from a mixed list of Tools, functions, and agents.
   * @param {...any} items @returns {Toolbox} */
  static of(...items) {
    /** @type {Tool[]} */
    const tools = [];
    for (const item of items) {
      const kind = item === null || item === undefined ? undefined : KINDS.find((k) => k.match(item));
      if (kind) tools.push(kind.build(item));
    }
    return new Toolbox(tools);
  }

  /** @returns {string[]} */
  get names() {
    return this.tools.map((t) => t.name);
  }

  /** @param {string} name @returns {Tool | null} */
  get(name) {
    return this.tools.find((t) => t.name === name) ?? null;
  }

  /** Python's `__bool__`: an empty toolbox contributes nothing. @returns {boolean} */
  get any() {
    return this.tools.length > 0;
  }

  /** The toolbox as a prompt component — the TOOLS block. @returns {ToolboxComponent} */
  component() {
    return new ToolboxComponent({ usages: this.tools.map((t) => t.usage()) });
  }

  /**
   * Group every `name({...})` in model text into batches to run in order.
   *
   * A newline between two calls starts a new batch; anything else (a comma, a
   * space) keeps them in the current one. Splitting on the *gaps between
   * matches* rather than on lines keeps a call whose JSON argument spans
   * several lines in one piece.
   * @param {any} text @returns {Call[][]}
   */
  static parseBatches(text) {
    const raw = Array.isArray(text) ? text.map((i) => pyStr(i)).join("\n") : pyStrOr(text);
    /** @type {Call[][]} */
    const batches = [];
    let previousEnd = 0;
    CALL_PATTERN.lastIndex = 0;
    for (let m = CALL_PATTERN.exec(raw); m; m = CALL_PATTERN.exec(raw)) {
      /** @type {Call} */
      const call = [m[1], readArgs(m[2])];
      const joined = batches.length > 0 && !raw.slice(previousEnd, m.index).includes("\n");
      if (joined) batches[batches.length - 1].push(call);
      else batches.push([call]);
      previousEnd = m.index + m[0].length;
    }
    return batches;
  }

  /** Dispatch by name. An unknown tool comes back as a failed result.
   * @param {string} name @param {Record<string, any>} [args] @returns {Promise<ToolResult>} */
  async call(name, args) {
    const found = this.get(name);
    if (found === null) {
      const available = this.names.join(", ") || "none";
      return new ToolResult({ tool: name, ok: false, error: `Tool not found. Available: ${available}` });
    }
    const problem = (args ?? {})[ARG_ERROR];
    if (problem) {
      // Refused rather than run empty: the arguments are what the call was for,
      // and this text is what lets the model write them again.
      const error =
        `Could not read the arguments: ${problem}. Write them as JSON on one line, ` +
        `escaping any " inside a string and using \\n for a line break — ${found.usage()}`;
      return new ToolResult({ tool: name, ok: false, error });
    }
    return found.call(args ?? {});
  }

  /**
   * Run every call in `text` — batch by batch — and return the observation.
   *
   * Within a batch the calls all go out at once and the batch is done when the
   * last one lands; `onResults` is handed that batch's results there and then,
   * so a caller can react to them before the next batch starts. Never throws.
   * @param {any} text
   * @param {((results: ToolResult[]) => unknown) | null} [onResults]
   * @returns {Promise<string>}
   */
  async invoke(text, onResults = null) {
    const batches = Toolbox.parseBatches(text);
    if (batches.length === 0) {
      return `Error: No valid tool call found in: ${pyStrOr(text).slice(0, 120)}`;
    }
    /** @type {ToolResult[]} */
    const results = [];
    for (const batch of batches) {
      // call() never rejects, so Promise.all cannot come back with an error
      const landed = await Promise.all(batch.map(([name, args]) => this.call(name, args)));
      await this.#notify(onResults, landed);
      results.push(...landed);
    }
    return results.map((r) => r.toString()).join("\n");
  }

  /** Hand results to the callback. Sync or async, and it may not throw.
   * @param {((results: ToolResult[]) => unknown) | null | undefined} callback
   * @param {ToolResult[]} results */
  async #notify(callback, results) {
    if (!callback) return;
    try {
      await callback(results);
    } catch (e) {
      this.log.warn(`tool result callback failed: ${reason(e)}`);
    }
  }
}
