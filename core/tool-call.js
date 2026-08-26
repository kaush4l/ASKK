/**
 * One callable — the thing a `Toolbox` holds and the model names.
 *
 *     Tool.fromFunction(fn) / Tool.fromAgent(agent) / Tool.fromMcp(client, spec)
 *     ├─ usage()      -> "name({...}): what it does"
 *     └─ call(args)   -> ToolResult
 *
 * A sub-agent is a tool: an Agent already carries the `name` and `description`
 * the model needs, and `invoke` is the call. MCP tools are wrapped the same
 * way. The model is never told which is which — everything is invoked
 * identically, so the distinction would only be noise in the prompt. The three
 * constructors are the pillar's three concretes (PHILOSOPHY §2).
 *
 * Nothing here throws. A tool that blows up comes back as a failed
 * `ToolResult`, because that error text is what lets the model correct itself
 * on the next pass. A failing tool must never take the session down with it.
 */

/** @typedef {{ warn: (message: string) => void }} Log */
/** @typedef {(args: Record<string, any>) => any} ToolFn */

/** A pure core does not own a logger. @type {Log} */
export const NO_LOG = { warn: () => {} };

/** Shared by everything that turns a thrown value into text a model reads.
 * @param {unknown} e @returns {string} */
export const reason = (e) => (e instanceof Error ? e.message : String(e));

/** Outcome of one tool call. Always returned, never raised. */
export class ToolResult {
  /** @param {{ tool: string, ok: boolean, output?: string, error?: string }} d */
  constructor(d) {
    /** @type {string} */ this.tool = d.tool;
    /** @type {boolean} */ this.ok = d.ok;
    /** @type {string} */ this.output = d.output ?? "";
    /** @type {string} */ this.error = d.error ?? "";
    Object.freeze(this);
  }
  /** Render for the transcript the model reads next. @returns {string} */
  toString() {
    return `${this.tool}: ${this.ok ? this.output : this.error}`;
  }
}

/** One callable the model can name, plus how to describe it. */
export class Tool {
  /** @param {{ name: string, description?: string, usageArgs?: string, fn: ToolFn }} d */
  constructor(d) {
    /** @type {string} */ this.name = d.name;
    /** @type {string} */ this.description = d.description ?? "";
    /** @type {string} */ this.usageArgs = d.usageArgs ?? '{"key": "value"}';
    /** @type {ToolFn} */ this.fn = d.fn;
  }

  /**
   * A plain function, which declares its own shape. Python read the parameter
   * names off the signature; JavaScript cannot, because
   * `Function.prototype.toString` is the only route and a minifier renames
   * every argument — so the function says what it is instead (`tool()` below
   * attaches it). An undeclared shape falls back to the generic placeholder and
   * not to `{}`, because `{}` states the tool takes nothing, which is a claim
   * we have not got; the placeholder is an honest unknown.
   * @param {any} fn @returns {Tool}
   */
  static fromFunction(fn) {
    const { toolName, description, usageArgs } = fn;
    return new Tool({ name: toolName ?? fn.name, description, usageArgs, fn: (a) => fn(a) });
  }

  /**
   * A sub-agent: its own name and description are the tool's.
   *
   * The goal is taken from `query` or, failing that, from whatever single
   * string the caller did write — a model that says `{"task": ...}` meant the
   * same thing, and dropping it would start the sub-agent on nothing. Nothing
   * usable is an error, not an empty run: a sub-agent cannot tell an empty goal
   * from a hard one and will answer either way.
   * @param {any} agent @returns {Tool}
   */
  static fromAgent(agent) {
    const fn = async (/** @type {Record<string, any>} */ args) => {
      const spare = Object.entries(args ?? {})
        .filter(([k]) => k !== "query")
        .map(([, v]) => String(v ?? "").trim());
      const goal = String(args?.query ?? "").trim() || spare.find(Boolean) || "";
      if (!goal) {
        const shape = '{"query": "<the whole task, in one string>"}';
        throw new Error(`no goal given. Call it as ${agent.name}(${shape})`);
      }
      const out = await agent.invoke(goal);
      return out && typeof out === "object" && "answer" in out ? out.answer : out;
    };
    const usageArgs = '{"query": "<your detailed task description>"}';
    return new Tool({ name: agent.name, description: agent.description, usageArgs, fn });
  }

  /**
   * An MCP tool. `client` is any object with `call_tool(name, args)`.
   * Duck-typed on purpose — no MCP SDK import here, so that dependency is only
   * needed by whoever actually wires up a server. It sits beside the other two
   * constructors rather than in `tool-mcp.js`, because what it decodes is one
   * call's *result*; that file's job is a whole catalogue's *schemas*.
   * @param {any} client
   * @param {{ name: string, description?: string, usageArgs?: string }} spec
   * @returns {Tool}
   */
  static fromMcp(client, spec) {
    const fn = async (/** @type {Record<string, any>} */ args) => {
      const result = await client.call_tool(spec.name, args);
      /** @type {any[]} */
      const content = result?.content;
      if (!content || content.length === 0) return String(result);
      /** @type {string[]} */
      const parts = [];
      for (const b of content) {
        // image blocks carry base64 + mime — keep them as data URLs so a
        // screenshot can be forwarded to a vision model rather than lost
        if (b?.data && b?.mimeType) parts.push(`data:${b.mimeType};base64,${b.data}`);
        else if (b?.text !== null && b?.text !== undefined) parts.push(b.text);
      }
      return parts.join("\n");
    };
    const description = spec.description || "MCP tool";
    return new Tool({ name: spec.name, description, usageArgs: spec.usageArgs, fn });
  }

  /** One line: exactly the call shape and what it does. @returns {string} */
  usage() {
    return `${this.name}(${this.usageArgs}): ${this.description}`;
  }

  /** Run it. Any failure comes back as a result, never as an exception.
   * @param {Record<string, any>} args @returns {Promise<ToolResult>} */
  async call(args) {
    try {
      return new ToolResult({ tool: this.name, ok: true, output: String(await this.fn(args)) });
    } catch (e) {
      const error = `Error executing ${this.name}: ${reason(e)}`;
      return new ToolResult({ tool: this.name, ok: false, error });
    }
  }
}

/** Attach the shape a JS function cannot be asked for.
 * @param {string} name @param {string} description
 * @param {string} usageArgs @param {ToolFn} fn @returns {any} */
export function tool(name, description, usageArgs, fn) {
  return Object.assign(fn, { toolName: name, description, usageArgs });
}
