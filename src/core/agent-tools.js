// Agent tools — tools an agent creates, in memory folders.
//
// Desk tools live in src/core (core-tools.js) only. Agent-created
// tools live in memory folders, never in core:
//   function tool -> memory/agent/<agent>/<name>.tool.md
//   script        -> memory/scripts/<agent>/<name>.script.md
//   watcher       -> memory/watchers/<agent>/<name>.watcher.md
// A shared tool replaces <agent> with "shared" in the same layout.
// Loading is shared first, then agent-specific: agent-specific
// wins on the same name, no duplicates (placement.mergePlacement).
// An agent-specific tool is visible/runnable ONLY by that agent:
// loadAgentTools(desk, agent) returns shared + that agent's tools
// and never another agent's. Writes go to the PERSONAL desk folder
// only — never to public/defaults/ (a missing personalDir is an
// error, not a fallback to public).
//
// Standards (separate, not one blurred object) — Milestone 4:
//   function: needs a description AND an args schema (see below);
//     its run() is a REAL method binding, never a fake return of
//     the definition. A function tool with no JS implementation
//     bound has a run() that THROWS honestly ("no JS
//     implementation bound"), so the loop can never call it and
//     get a fake success. Bind an implementation by passing
//     { implementations: { "<name>": async (input) => ... } }
//     to loadAgentTools(), or by creating the tool as a JS
//     method in a deterministic location and passing it in —
//     the .md file alone is a definition, not a method.
//   shortcut script: needs a non-empty commands list; its run()
//     returns the commands when no terminal runner is supplied
//     (definition tool: execution is terminal.run's job), and
//     EXECUTES them via the supplied terminal runner when one
//     is supplied to loadAgentTools() ({ terminalRun }).
//   watcher/notify script: needs a watch/event trigger and a
//     notify target; its run() returns the subscription record
//     (watch, event, notify, started: false) — it is NOT a
//     stream executor, so its expectation is "immediate", not
//     "stream" (a true stream watcher is future work, not claimed).
//   args schema (all kinds, from the .md file itself): a
//     "- args: path: the file, query: what to search" line,
//     parsed into input { path: "the file", query: ... } —
//     so the single reader (tool.js describeTool) produces a
//     real "- name {arg: doc, ...} — description" string from
//     the definition's own args and documentation, never {}.
// Lanes: a tool's lanes must be narrowed to the caller's lanes;
// anything wider is refused.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { mergePlacement, validateLanesSubset } from "./placement.js";
import { Tool } from "./tool.js";

export const AGENT_TOOL_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
export const AGENT_TOOL_KINDS = Object.freeze([
  "function",
  "script",
  "watcher",
]);

export function checkAgentToolName(name) {
  if (typeof name !== "string" || !AGENT_TOOL_NAME.test(name)) {
    throw new Error(
      `agent tool name must match [a-z][a-z0-9-]* (dotted allowed), got ${JSON.stringify(name)}`,
    );
  }
  return name;
}

export function agentToolRelPath({ agent, name, kind, shared }) {
  checkAgentToolName(name);
  const folder = shared ? "shared" : agent;
  if (kind === "script") {
    return `memory/scripts/${folder}/${name}.script.md`;
  }
  if (kind === "watcher") {
    return `memory/watchers/${folder}/${name}.watcher.md`;
  }
  return `memory/agent/${folder}/${name}.tool.md`;
}

export function agentToolFileText(def) {
  const lines = [
    `# Tool: ${def.name}`,
    "",
    `- name: ${def.name}`,
    `- kind: ${def.kind}`,
    `- scope: ${def.shared ? "shared" : "agent"}`,
    `- agent: ${def.agent}`,
    ...(def.description ? [`- description: ${def.description}`] : []),
    ...(def.args && Object.keys(def.args).length > 0
      ? [
          `- args: ${Object.entries(def.args)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")}`,
        ]
      : []),
    ...(def.commands ? [`- commands: ${def.commands.join(" | ")}`] : []),
    ...(def.watch ? [`- watch: ${def.watch}`] : []),
    ...(def.event ? [`- event: ${def.event}`] : []),
    ...(def.notify ? [`- notify: ${def.notify}`] : []),
    ...(def.lanes ? [`- lanes: ${def.lanes.join(", ")}`] : []),
    "",
    def.body ?? "",
    "",
  ];
  return lines.join("\n");
}

export function parseAgentToolFile(text) {
  const meta = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(/^- ([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)$/);
    if (match) {
      meta[match[1]] = match[2].trim();
    }
  }
  return meta;
}

// Parse an "- args: path: the file, query: what to search" value
// into an input schema { path: "the file", query: ... }. Splitting
// is on ", " followed by a "key:" — so a description containing a
// comma does not split it, and a description containing a colon
// after the first one is kept whole.
export function parseArgsValue(value) {
  const out = {};
  if (typeof value !== "string" || value.trim() === "") {
    return out;
  }
  for (const part of value.split(/,\s+(?=[a-zA-Z_][a-zA-Z0-9_-]*:\s)/)) {
    const at = part.indexOf(":");
    if (at > 0) {
      out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
  }
  return out;
}

export function createAgentTool(input = {}) {
  const agent = input.agent;
  if (typeof agent !== "string" || agent.trim() === "") {
    throw new Error("agent tool needs an agent");
  }
  const name = checkAgentToolName(input.name);
  const kind = input.kind;
  if (!AGENT_TOOL_KINDS.includes(kind)) {
    throw new Error(
      `agent tool kind must be one of ${AGENT_TOOL_KINDS.join(", ")}`,
    );
  }
  if (kind === "function" && !input.description) {
    throw new Error("function tool needs a description");
  }
  if (
    kind === "script" &&
    (!Array.isArray(input.commands) || input.commands.length === 0)
  ) {
    throw new Error("shortcut script needs a non-empty commands list");
  }
  if (kind === "watcher" && !(input.watch || input.event)) {
    throw new Error("watcher script needs a watch/event trigger");
  }
  if (kind === "watcher" && !input.notify) {
    throw new Error("watcher script needs a notify target");
  }
  const lanes = input.lanes
    ? validateLanesSubset(input.lanes, input.callerLanes ?? [])
    : [];
  const personalDir = input.personalDir ?? input.deskLocation;
  if (typeof personalDir !== "string" || personalDir.trim() === "") {
    throw new Error(
      "agent tool needs a personal desk folder: writes never go to public/defaults/",
    );
  }
  const base = isAbsolute(personalDir)
    ? personalDir
    : join(process.cwd(), personalDir);
  const shared = Boolean(input.shared);
  const def = {
    name,
    kind,
    agent,
    shared,
    description: input.description ?? "",
    args: input.args ?? null,
    commands: input.commands ?? null,
    watch: input.watch ?? null,
    event: input.event ?? null,
    notify: input.notify ?? null,
    lanes,
    body: input.body ?? "",
  };
  const rel = agentToolRelPath({ agent, name, kind, shared });
  const path = join(base, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, agentToolFileText(def), "utf8");
  return { ...def, scope: shared ? "shared" : "agent", path: rel };
}

function listToolFiles(dir) {
  try {
    if (!existsSync(dir)) {
      return [];
    }
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function definitionFromFile(path, scope) {
  const meta = parseAgentToolFile(readFileSync(path, "utf8"));
  return {
    name: meta.name ?? "",
    kind: meta.kind ?? "function",
    scope,
    description: meta.description ?? "",
    args: meta.args ? parseArgsValue(meta.args) : {},
    implementation: meta.implementation ?? null,
    commands: meta.commands
      ? meta.commands
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean)
      : null,
    watch: meta.watch ?? null,
    event: meta.event ?? null,
    notify: meta.notify ?? null,
    path,
  };
}

export function listAgentToolDefinitions({ personalDir, defaultsDir }, agent) {
  const personal = personalDir
    ? isAbsolute(personalDir)
      ? personalDir
      : join(process.cwd(), personalDir)
    : null;
  const defaults = defaultsDir
    ? isAbsolute(defaultsDir)
      ? defaultsDir
      : join(process.cwd(), defaultsDir)
    : null;
  const kinds = [
    { dir: "agent", suffix: ".tool.md", kind: "function" },
    { dir: "scripts", suffix: ".script.md", kind: "script" },
    { dir: "watchers", suffix: ".watcher.md", kind: "watcher" },
  ];
  const shared = [];
  const agentSpecific = [];
  for (const root of [defaults, personal]) {
    if (!root) {
      continue;
    }
    for (const { dir, suffix, kind } of kinds) {
      for (const file of listToolFiles(join(root, "memory", dir, "shared"))) {
        if (file.endsWith(suffix)) {
          shared.push({ ...definitionFromFile(file, "shared"), kind });
        }
      }
      if (agent) {
        for (const file of listToolFiles(join(root, "memory", dir, agent))) {
          if (file.endsWith(suffix)) {
            agentSpecific.push({ ...definitionFromFile(file, "agent"), kind });
          }
        }
      }
    }
  }
  // Shared first, agent-specific wins, no duplicates.
  return mergePlacement(shared, agentSpecific);
}

// Bind a JS method to a function-tool definition. The .md file
// is the definition (name, args, documentation); this is the
// method itself. Callers that want a runnable function tool pass
// implementations into loadAgentTools(); without one, the tool's
// run() throws honestly instead of returning a fake value.
export function bindFunctionTool(def, run) {
  if (typeof run !== "function") {
    throw new Error(
      `agent function tool ${def.name} has no JS implementation bound — define it as a JS method and pass it in implementations to loadAgentTools(), do not call the .md definition as if it were a method`,
    );
  }
  return new Tool({
    name: def.name,
    description: def.description || `agent tool ${def.name}`,
    input: def.args ?? {},
    type: "function",
    expectation: "immediate",
    run,
  });
}

export function loadAgentTools(
  desk = {},
  agent,
  { implementations = {}, terminalRun = null } = {},
) {
  const personalDir =
    desk.personalDir ??
    (typeof desk.location === "string" ? desk.location : null);
  const defaultsDir = desk.defaultsDir ?? null;
  const defs = listAgentToolDefinitions({ personalDir, defaultsDir }, agent);
  return defs.map((def) => {
    if (def.kind === "script") {
      return new Tool({
        name: def.name,
        description: def.description || `agent script ${def.name}`,
        input: def.args ?? {},
        type: "script",
        expectation: "done",
        run: async (input) => {
          const commands = def.commands ?? [];
          if (!terminalRun) {
            // Definition tool: supply the commands for the caller
            // (terminal.run) to execute. This is not a claim that
            // the script executed itself.
            return { commands, scope: def.scope, executed: false };
          }
          const outputs = [];
          for (const command of commands) {
            const result =
              typeof terminalRun === "function"
                ? await terminalRun(command)
                : await terminalRun.run({ command, ...(input ?? {}) });
            outputs.push({ command, result });
          }
          return { commands, scope: def.scope, executed: true, outputs };
        },
      });
    }
    if (def.kind === "watcher") {
      return new Tool({
        name: def.name,
        description: def.description || `agent watcher ${def.name}`,
        input: def.args ?? {},
        type: "watcher",
        expectation: "immediate",
        run: async () => ({
          watch: def.watch,
          event: def.event,
          notify: def.notify,
          scope: def.scope,
          started: false,
        }),
      });
    }
    const implementation =
      implementations[def.name] ??
      (def.implementation ? implementations[def.implementation] : null);
    if (implementation) {
      return bindFunctionTool(def, implementation);
    }
    return new Tool({
      name: def.name,
      description: def.description || `agent tool ${def.name}`,
      input: def.args ?? {},
      type: "function",
      expectation: "immediate",
      run: async () => {
        throw new Error(
          `agent function tool ${def.name} has no JS implementation bound — define it as a JS method and pass it in implementations to loadAgentTools(), do not call the .md definition as if it were a method`,
        );
      },
    });
  });
}
