// Startup — SCAN AND INITIALIZE, never hardcode.
//
// Milestone 3. On startup, the desk loads and initializes ALL
// objects by SCANNING deterministic locations, rather than
// hardcoding lists in engine/harness/page code:
//
//   kernel tools        src/core (createCoreTools)
//   agent definitions   <desk>/memory/<name>.agent.md
//                         (personal wins, public/defaults fallback)
//   agent instructions  <desk>/memory/<name>.instructions.md
//   agent-created tools <desk>/memory/agent/<agent>/<name>.tool.md
//                         <desk>/memory/scripts/<agent or shared>/*.script.md
//                         <desk>/memory/watchers/<agent or shared>/*.md
//   skills              <desk>/memory/skills/<agent or shared>/*.skill.md
//   goals               <desk>/memory/goals/*.md (when present)
//   models              <desk>/memory/model.json (per-file fallback)
//
// agent.md is the ONLY metadata source for an agent's tools:
// it carries tool NAMES only (its "- tools:" line). On load,
// the agent.md reader reads that metadata, looks each name up
// in the scanned registry, and initializes the agent object
// with exactly those tools — intersected with the tools the
// caller actually holds, strict subset, all-tools refused. A
// tool name in agent.md that is not in the scanned registry is
// recorded as missing (an honest error in the agent record),
// never invented, never silently dropped from the record.
// Each tool's OWN documentation/description is its registry
// spec (name, description, input schema from the tool object),
// and that spec is what the prompt's tools element carries.
//
// <name>.tools.md files are NOT sources: they were prose
// contracts duplicating agent.md's list, and loadAgentDefinition
// (harness.js) never reads them. A tools.md file left in a desk
// folder is ignored by this scanner, never merged.
//
// Scripts are .md files for a reason, not by accident: a script
// is a DEFINITION — kind, trigger, commands, notify, halt rule
// — following <name>.<type>.md, human- and agent-readable,
// versioned, creatable via tools. The runtime parses the
// definition and executes its commands via the terminal tool;
// the .md file itself is NOT executable code, and is never
// passed to terminal.run as a shell script. The same holds for
// watchers (notify scripts): a definition with a watch/event
// trigger, a notify target, and a halt rule.
//
// Scripts/watchers are initialized as OBJECTS at startup, not
// validated on demand and not auto-started: a script object is
// on-demand (runnable, not running); a watcher object is
// initialized (subscribed in state, not started) unless its
// definition's trigger is on-start/always. Their runtime state
// (lastRun, fires, running, errors) lives on the object in
// runtime memory, never in the definition folder — so a
// definition file is never rewritten by a run.
//
// Every dynamic element is configurable and dynamic: adding or
// removing a tool, agent, skill, script, watcher, or phase file
// in a scanned folder, then re-running initializeDeskObjects
// (engine.refreshScanned), makes it appear/disappear in the
// engine object, the prompt, and the UI with NO code change.
// The scanner caches nothing: every initialize/refresh re-reads
// the folders, so a removed file disappears instead of lingering.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { listAgentToolDefinitions, loadAgentTools } from "./agent-tools.js";
import { createCoreTools } from "./core-tools.js";
import { createDesk } from "./desk.js";
import { parseAgentFile } from "./desk-reader.js";
import { getEngineObject } from "./engine-object.js";
import { createHarness, loadAgentDefinition } from "./harness.js";
import { parseSkill } from "./skills.js";

function resolveDir(dir, fallback) {
  if (typeof dir === "string" && dir.trim() !== "") {
    return isAbsolute(dir)
      ? dir
      : join(/* turbopackIgnore: true */ process.cwd(), dir);
  }
  return join(/* turbopackIgnore: true */ process.cwd(), fallback);
}

function listFiles(dir) {
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

// Parse "- key: value" definition lines, plus list items under
// a "- commands:" key (the shape the shipped script files use).
export function parseDefinitionFile(text) {
  const fields = {};
  const commands = [];
  let title = "";
  let currentKey = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw;
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }
    const kv = line.match(/^- ([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (kv) {
      fields[kv[1]] = kv[2].trim();
      currentKey = kv[1];
      continue;
    }
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && currentKey === "commands") {
      commands.push(item[1].trim());
    }
  }
  if (commands.length > 0) {
    fields.commands = commands;
  } else if (typeof fields.commands === "string" && fields.commands !== "") {
    fields.commands = fields.commands
      .split(/[|,]/)
      .map((c) => c.trim())
      .filter(Boolean);
  }
  return { fields, title };
}

function stem(filename) {
  let name = filename.replace(/\.md$/, "");
  // Strip suffixes repeatedly: hi.shortcut.script -> hi,
  // done.notify.script -> done, build-complete.notify.script -> build-complete.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of [
      ".shortcut",
      ".notify",
      ".watcher",
      ".script",
      ".skill",
      ".tool",
    ]) {
      if (name.endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return name;
}

// Scan <name>.agent.md files: defaults first, personal wins on
// the same name, sorted by name. No agent name is hardcoded.
export function scanAgents({ personalDir, defaultsDir } = {}) {
  const personal = resolveDir(personalDir, "personal");
  const defaults = resolveDir(defaultsDir, "public/defaults");
  const byName = new Map();
  for (const [root, source] of [
    [defaults, "public"],
    [personal, "personal"],
  ]) {
    for (const file of listFiles(join(root, "memory"))) {
      const match = file.match(/\/([a-z][a-z0-9-]*)\.agent\.md$/);
      if (!match) {
        continue;
      }
      byName.set(match[1], {
        name: match[1],
        source,
        path: file,
        text: readFileSync(file, "utf8"),
      });
    }
  }
  return [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      ...entry,
      meta: parseAgentFile(entry.text),
    }));
}

function scanDefinitionFolder(roots, relFolders, suffixTest, kind) {
  const byPath = new Map();
  for (const [root, source] of roots) {
    for (const rel of relFolders) {
      const dir = join(root, "memory", rel);
      for (const file of listFiles(dir)) {
        if (!suffixTest(file)) {
          continue;
        }
        const agent = rel.split("/").at(-1);
        const scope = agent === "shared" ? "shared" : "agent";
        const parsed = parseDefinitionFile(readFileSync(file, "utf8"));
        const filename = file.split("/").at(-1);
        byPath.set(file, {
          id: file,
          name: stem(filename),
          filename,
          kind,
          title: parsed.title,
          fields: parsed.fields,
          trigger: parsed.fields.trigger ?? null,
          commands: parsed.fields.commands ?? null,
          watch: parsed.fields.watch ?? null,
          event: parsed.fields.event ?? null,
          notify: parsed.fields.notify ?? null,
          halt: parsed.fields.halt ?? null,
          scope,
          agent: scope === "shared" ? null : agent,
          source,
          path: file,
          // Runtime state lives HERE, never in the definition file.
          state: { lastRun: null, fires: 0, running: false, errors: [] },
          // Initialized, not auto-started: only an on-start/always
          // trigger starts a watcher at startup; scripts are
          // on-demand objects, never run at startup.
          started:
            parsed.fields.trigger === "on-start" ||
            parsed.fields.trigger === "always",
          runnable: kind === "script",
        });
      }
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function scanScripts({ personalDir, defaultsDir, agents = [] } = {}) {
  const personal = resolveDir(personalDir, "personal");
  const defaults = resolveDir(defaultsDir, "public/defaults");
  const agentNames = [...new Set(agents.map((a) => a.name))];
  const relFolders = [
    "scripts/shared",
    ...agentNames.map((name) => `scripts/${name}`),
  ];
  return scanDefinitionFolder(
    [
      [defaults, "public"],
      [personal, "personal"],
    ],
    relFolders,
    (file) => file.endsWith(".script.md"),
    "script",
  );
}

export function scanWatchers({ personalDir, defaultsDir, agents = [] } = {}) {
  const personal = resolveDir(personalDir, "personal");
  const defaults = resolveDir(defaultsDir, "public/defaults");
  const agentNames = [...new Set(agents.map((a) => a.name))];
  const relFolders = [
    "watchers/shared",
    ...agentNames.map((name) => `watchers/${name}`),
  ];
  return scanDefinitionFolder(
    [
      [defaults, "public"],
      [personal, "personal"],
    ],
    relFolders,
    (file) => file.endsWith(".md"),
    "watcher",
  );
}

export function scanSkills({ personalDir, defaultsDir, agents = [] } = {}) {
  const personal = resolveDir(personalDir, "personal");
  const defaults = resolveDir(defaultsDir, "public/defaults");
  const agentNames = [...new Set(agents.map((a) => a.name))];
  const relFolders = [
    "skills/shared",
    ...agentNames.map((name) => `skills/${name}`),
  ];
  const byPath = new Map();
  for (const [root, source] of [
    [defaults, "public"],
    [personal, "personal"],
  ]) {
    for (const rel of relFolders) {
      for (const file of listFiles(join(root, "memory", rel))) {
        if (!file.endsWith(".skill.md")) {
          continue;
        }
        const parsed = parseSkill(
          readFileSync(file, "utf8"),
          stem(file.split("/").at(-1)),
        );
        byPath.set(file, {
          ...parsed,
          kind: "skill-phase",
          source,
          path: file,
        });
      }
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function scanGoals({ personalDir, defaultsDir } = {}) {
  const personal = resolveDir(personalDir, "personal");
  const defaults = resolveDir(defaultsDir, "public/defaults");
  const byPath = new Map();
  for (const [root, source] of [
    [defaults, "public"],
    [personal, "personal"],
  ]) {
    for (const file of listFiles(join(root, "memory", "goals"))) {
      if (!file.endsWith(".md")) {
        continue;
      }
      byPath.set(file, {
        name: stem(file.split("/").at(-1)),
        source,
        path: file,
        text: readFileSync(file, "utf8"),
      });
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// The scanned registry for one agent: kernel tools + that
// agent's memory-folder tool definitions, by name. Re-scanned
// on every call — nothing is cached, so a removed definition
// disappears on the next scan.
export function scanRegistry({
  personalDir,
  defaultsDir,
  agent = null,
  workspaceDir = null,
} = {}) {
  const personal = resolveDir(personalDir, "personal");
  const defaults = resolveDir(defaultsDir, "public/defaults");
  let kernel = [];
  try {
    kernel = createCoreTools({
      filesLocation: workspaceDir ?? process.cwd(),
    }).tools;
  } catch {
    kernel = [];
  }
  const kernelSpecs = kernel.map((tool) =>
    typeof tool?.spec === "function" ? tool.spec() : tool,
  );
  const agentDefs = agent
    ? listAgentToolDefinitions(
        { personalDir: personal, defaultsDir: defaults },
        agent,
      )
    : [];
  const agentTools = agent
    ? loadAgentTools({ personalDir: personal, defaultsDir: defaults }, agent)
    : [];
  return {
    kernel: kernelSpecs,
    kernelNames: kernelSpecs.map((t) => t?.name).filter(Boolean),
    agentDefinitions: agentDefs,
    agentTools: agentTools.map((tool) =>
      typeof tool?.spec === "function" ? tool.spec() : tool,
    ),
    names: [
      ...new Set([
        ...kernelSpecs.map((t) => t?.name).filter(Boolean),
        ...agentDefs.map((d) => d?.name).filter(Boolean),
        "goal.create",
      ]),
    ],
  };
}

// Initialize ONE agent from its agent.md metadata: names only,
// looked up in the scanned registry. Missing names are recorded
// in missingTools + errors, never invented, never silently
// dropped from the record.
export function initializeAgent(
  name,
  { personalDir, defaultsDir, workspaceDir = null } = {},
) {
  const definition = loadAgentDefinition(name, { personalDir, defaultsDir });
  if (!definition) {
    return null;
  }
  const registry = scanRegistry({
    personalDir,
    defaultsDir,
    agent: name,
    workspaceDir,
  });
  const byName = new Map();
  for (const spec of [...registry.kernel, ...registry.agentTools]) {
    if (spec?.name) {
      byName.set(spec.name, spec);
    }
  }
  const tools = [];
  const missingTools = [];
  for (const toolName of definition.tools) {
    if (byName.has(toolName)) {
      tools.push(byName.get(toolName));
    } else if (toolName === "goal.create") {
      // A goal-artifact tool, registered when a goal is loaded
      // (goal-artifact.js loadGoalArtifact), not a kernel tool.
      // Its spec is the goal.create contract, not an invention.
      tools.push({
        name: "goal.create",
        description: "create a goal from a statement only",
        input: { statement: "the goal statement" },
        kind: "goal-tool",
      });
    } else {
      missingTools.push(toolName);
    }
  }
  return {
    name: definition.name,
    role: definition.role,
    goal: definition.goal,
    keep: definition.keep,
    version: parseAgentFile(definition.agentFile ?? "").version ?? null,
    source: definition.source,
    instructions: definition.instructions,
    instructionsSource: definition.instructionsSource,
    toolNames: [...definition.tools],
    tools,
    missingTools,
    errors:
      missingTools.length > 0
        ? [
            `tool names in ${name}.agent.md not in the scanned registry: ${missingTools.join(", ")}`,
          ]
        : [],
    agentDefinitions: registry.agentDefinitions,
  };
}

// Scan-and-initialize ALL objects for an engine, and attach
// them to it. Re-running this (engine.refreshScanned) re-scans
// from disk, so added files appear and removed files disappear.
export function initializeDeskObjects(engine, opts = {}) {
  if (!engine || typeof engine !== "object") {
    throw new Error("startup needs an engine object");
  }
  const personalDir = resolveDir(
    opts.personalDir ?? engine.desk?.location ?? engine.desk?.personalDir,
    "personal",
  );
  const defaultsDir = resolveDir(
    opts.defaultsDir ?? engine.desk?.defaultsDir,
    "public/defaults",
  );
  const agentsMeta = scanAgents({ personalDir, defaultsDir });
  const agents = agentsMeta
    .map((meta) => initializeAgent(meta.name, { personalDir, defaultsDir }))
    .filter(Boolean);
  const scripts = scanScripts({ personalDir, defaultsDir, agents: agentsMeta });
  const watchers = scanWatchers({
    personalDir,
    defaultsDir,
    agents: agentsMeta,
  });
  const skills = scanSkills({ personalDir, defaultsDir, agents: agentsMeta });
  const goals = scanGoals({ personalDir, defaultsDir });
  const scanned = {
    personalDir,
    defaultsDir,
    agents,
    scripts,
    watchers,
    skills,
    goals,
    counts: {
      agents: agents.length,
      scripts: scripts.length,
      watchers: watchers.length,
      skills: skills.length,
      goals: goals.length,
    },
  };
  engine.scanned = scanned;
  engine.agents = agents;
  engine.scripts = scripts;
  engine.watchers = watchers;
  engine.skills = skills;
  engine.goals = goals;
  engine.refreshScanned = () => initializeDeskObjects(engine, opts);
  return scanned;
}

// Full startup, in order. The dashboard snapshot/signal and the
// /api/harness request follow this — they are the next steps in
// the documented sequence, not part of initializeEngine itself.
export function initializeEngine(location = "personal", opts = {}) {
  const personalDir = resolveDir(
    opts.personalDir ??
      (typeof location === "string" && location.includes("/")
        ? location
        : null),
    "personal",
  );
  const defaultsDir = resolveDir(opts.defaultsDir, "public/defaults");
  const desk = opts.desk ?? createDesk(location, { defaultsDir });
  const engine = getEngineObject(location, { desk });
  const scanned = initializeDeskObjects(engine, { personalDir, defaultsDir });
  const harness =
    opts.harness === false ? null : createHarness(desk, { engine });
  return {
    engine,
    desk,
    scanned,
    harness,
    steps: [
      "desk-discovery",
      "createDesk",
      "getEngineObject-singleton",
      "scan-registry-and-memory-tree",
      "loadAgentDefinition-per-agent",
      "harness",
    ],
    personalDir,
    defaultsDir,
  };
}

export function startupSequence() {
  return [
    "desk-discovery: desk folder looked for — personal/ else public/defaults/ else honest empty state (harness.js discoverDesk; desk.js per-file fallback)",
    "createDesk: desk config loaded — instructions, model.json, inferences, kernel tools, live artifact (desk.js createDesk; core-tools.js createCoreTools)",
    "getEngineObject-singleton: ONE engine object per location in the server process, cached in engine-object.js (never a per-request fresh desk)",
    "scan-registry-and-memory-tree: startup.js scans kernel registry + memory tree — agents, scripts, watchers, skills, goals — no hardcoded lists",
    "loadAgentDefinition-per-agent: agent.md reader reads metadata (tool names only), looks each name up in the scanned registry, initializes the agent object with exactly those tools (harness.js loadAgentDefinition; startup.js initializeAgent)",
    "harness: harness agent created on the same engine object (harness.js createHarness; startup.js initializeEngine)",
    "dashboard-snapshot-signal: dashboard loads /api/engine-object, subscribes to the engine signal — UI is the twin of the same object (src/app/page.js; src/lib/signals.js)",
    "api-harness: POST /api/harness — owner request in plain words (src/app/api/harness/route.js; src/core/harness-route.js runHarnessRequest)",
    "goal-create: harness translates the request into exactly ONE goal.create call, statement only (harness.js ask; goal-artifact.js createGoal)",
    "spawn-developer-with-rules: developer spawned with its narrowed tool subset, lanes, gates, soul reference — never all tools (spawn.js createAgent; harness.js spawnDeveloper)",
    "developer-plan-execute-critique: developer owns its loop, looping back on critique failure, max 3 attempts (spawn.js developerPersona; loop.js runPhase)",
    "report-back: developer reports to the harness, harness returns the report to the owner, labelled separately in both histories (spawn.js report; harness.js ask)",
  ];
}
