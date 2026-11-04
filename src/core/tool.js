// Tool — the abstract contract for anything an agent can invoke.
//
// By definition, everything the agent invokes is a tool. The
// distinction is not a different kind of code, it is the expectation
// of the answer (see src/core/activity.js and the tools taxonomy):
//
//   immediate  — invoke, get an answer right away (read a file)
//   done       — invoke, get a "done, here's the result" notification
//                when the whole sequence finishes (run a build)
//   stream     — invoke/subscribe, get a stream of events, no final
//                answer (watch a long session, wait for output)
//   live-state — invoke/access, get live state that changes as the
//                instance it depends on changes (an open file, a
//                focused section, a session list)
//
// A Tool is: name, description, input fields, a run function, and
// that expectation. `type` is "function" by default (other types —
// "agent", "artifact", "mcp" — are later, not core). `view` says how
// a live UI draws it, or null. `outside` says whether its results
// are text this desk did not write (web reads, etc.); null means
// "decide by kind", and core tools that read outside must set it.
//
//   const tool = new Tool({
//     name: "files.read",
//     description: "read a file once, with line numbers",
//     input: { path: "the file" },
//     expectation: "immediate",
//     run: async (input) => { ... },
//   });
//   tool.spec();     // plain data for the UI / API
//   tool.describe(); // "- files.read {path: the file} — read a file…"
//   await tool.run({ path: "README.md" });

export const EXPECTATIONS = Object.freeze([
  "immediate",
  "done",
  "stream",
  "live-state",
]);

const OPTIONAL = [
  [/^optional$/i, ""],
  [/\s*\(optional\)$/i, ""],
  [/\s*[;,]\s*optional$/i, ""],
  [/\s*;\s*optional\)/i, ")"],
  [/\(optional,\s*(?:and\s+)?/i, "("],
];

function fieldLine(key, value) {
  const text = String(value);
  const rule = OPTIONAL.find(([re]) => re.test(text));
  if (!rule) {
    return `${key}: ${text}`;
  }
  const rest = text.replace(...rule);
  return rest ? `${key}?: ${rest}` : `${key}?`;
}

export class Tool {
  constructor({
    name,
    description = "",
    input = {},
    run,
    type = "function",
    view = null,
    outside = null,
    expectation = "immediate",
  } = {}) {
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error("tool needs a name");
    }
    if (!EXPECTATIONS.includes(expectation)) {
      throw new Error(
        `tool ${name} needs an expectation: ${EXPECTATIONS.join(" | ")}`,
      );
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`tool ${name} needs input as an object`);
    }
    this.name = name;
    this.description = description;
    this.input = input;
    this.type = type;
    this.view = view;
    this.outside = typeof outside === "boolean" ? outside : null;
    this.expectation = expectation;
    if (run) {
      this._run = run;
    }
    // Slice C: tool-call event listeners (tool:start/end/error).
    // A tool twin subscribes here (see tool-artifact-twin.js);
    // with no listeners this is a no-op and execution is
    // unchanged. Listener errors never break the tool call.
    this._toolListeners = new Set();
  }

  // Subscribe to tool:start / tool:end / tool:error events.
  // Listener signature: (event, detail). Returns unsubscribe.
  onToolEvent(listener) {
    if (typeof listener !== "function") {
      throw new Error("tool event listener must be a function");
    }
    this._toolListeners.add(listener);
    return () => this._toolListeners.delete(listener);
  }

  emitToolEvent(event, detail = {}) {
    for (const listener of [...this._toolListeners]) {
      try {
        listener(event, detail);
      } catch {
        // A twin update must never break the tool call it reports.
      }
    }
  }

  // Plain data for the UI and for /api/tools. No run function, no
  // secrets, nothing the browser can call back into.
  spec() {
    return {
      name: this.name,
      type: this.type,
      view: this.view,
      description: this.description,
      input: this.input,
      expectation: this.expectation,
      ...(this.outside === true ? { outside: true } : {}),
    };
  }

  describe() {
    const fields = Object.entries(this.input)
      .map(([key, value]) => fieldLine(key, value))
      .join(", ");
    return `- ${this.name} {${fields}} — ${this.description}`;
  }

  async run(input, ctx) {
    if (!this._run) {
      throw new Error(`${this.name}: no run()`);
    }
    // Slice C: every tool call emits tool:start, then tool:end
    // on success or tool:error on failure, so a subscribed tool
    // twin updates from the event — no polling, no behaviour
    // change to the result or the error itself.
    const args = input ?? {};
    const startedAt = Date.now();
    this.emitToolEvent("tool:start", {
      name: this.name,
      args,
      at: new Date().toISOString(),
    });
    try {
      const result = await this._run(args, ctx);
      this.emitToolEvent("tool:end", {
        name: this.name,
        args,
        result,
        duration: Date.now() - startedAt,
        at: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      this.emitToolEvent("tool:error", {
        name: this.name,
        args,
        error: error?.message ?? String(error),
        duration: Date.now() - startedAt,
        at: new Date().toISOString(),
      });
      throw error;
    }
  }
}

// A registry: a flat list of Tool instances, with lookup by name
// and a plain-data view for the UI. Duplicate names are refused —
// the agent must never have two tools answering to one name.
export function createToolRegistry(tools = []) {
  const list = Array.isArray(tools) ? [...tools] : [];
  const seen = new Set();
  for (const tool of list) {
    if (!tool || typeof tool.name !== "string") {
      throw new Error("tool registry needs Tool instances");
    }
    if (seen.has(tool.name)) {
      throw new Error(`tool registry has two tools named ${tool.name}`);
    }
    seen.add(tool.name);
  }
  return {
    tools: list,
    list() {
      return [...list];
    },
    specs() {
      return list.map((tool) => tool.spec());
    },
    get(name) {
      return list.find((tool) => tool.name === name) ?? null;
    },
    describeAll() {
      return list.map((tool) => tool.describe()).join("\n");
    },
    async run(name, input, ctx) {
      const tool = list.find((entry) => entry.name === name);
      if (!tool) {
        throw new Error(`no tool named ${name}`);
      }
      return tool.run(input, ctx);
    },
  };
}

// Plain-data specs for a list of tools (or a registry).
export function listTools(tools) {
  const list = Array.isArray(tools) ? tools : (tools?.list?.() ?? []);
  return list.map((tool) =>
    typeof tool.spec === "function" ? tool.spec() : tool,
  );
}
