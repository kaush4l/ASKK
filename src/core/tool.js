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
    return this._run(input ?? {}, ctx);
  }
}

// THE single tool-to-string reader (Milestone 4). Every place that
// turns a tool into a string — the prompt's tools element, the
// registry's describeAll(), /api/tools, the UI — must use this
// function, never a second formatter. It reads the name, the args
// (input keys + descriptions) and the documentation (description)
// FROM THE TOOL/METHOD OBJECT ITSELF:
//   - a Tool instance: its own describe(), which reads its input
//     and description fields (the method's own fields);
//   - a plain spec (a Tool.spec() snapshot): the same fields,
//     formatted with the same fieldLine() rule, so the string is
//     identical to the instance's describe() for the same tool.
// There is no second reader anywhere in the tree: elements.js
// toolSpecToString was deleted in Milestone 4, and toolsElement
// calls describeTool().
export function describeTool(tool) {
  if (!tool || typeof tool !== "object") {
    throw new Error("describeTool needs a tool or tool spec");
  }
  if (typeof tool.describe === "function") {
    return tool.describe();
  }
  const fields = Object.entries(tool.input ?? {})
    .map(([key, value]) => fieldLine(key, value))
    .join(", ");
  return `- ${tool.name} {${fields}} — ${tool.description ?? ""}`;
}

// Wrap a plain spec (or any tool-like object) into a real Tool
// instance, so a registry always holds instances with a run(),
// never spec-only data pretending to be a method. A spec-only
// tool's run() throws honestly — it cannot be invoked until a
// real run function is bound — instead of returning a fake value.
export function toToolInstance(tool) {
  if (!tool || typeof tool !== "object" || typeof tool.name !== "string") {
    throw new Error("toToolInstance needs a tool or tool spec with a name");
  }
  if (tool instanceof Tool) {
    return tool;
  }
  if (typeof tool.run === "function" && typeof tool.describe === "function") {
    return tool;
  }
  const spec = typeof tool.spec === "function" ? tool.spec() : tool;
  return new Tool({
    name: spec.name,
    description: spec.description ?? "",
    input: spec.input ?? {},
    type: spec.type ?? "function",
    view: spec.view ?? null,
    outside: spec.outside ?? null,
    expectation: spec.expectation ?? "immediate",
    run: async () => {
      throw new Error(
        `${spec.name}: spec-only tool, no run function bound — bind a real method before calling it`,
      );
    },
  });
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
