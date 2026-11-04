// Default agent.md — the render template, its loader, and its
// runtime renderer.
//
//   parseAgentMd(text) -> template
//   loadAgentMd(personalDir, defaultsDir)
//     -> { template, source: "personal" | "public" | "built-in" }
//   renderAgentInstructions(template, desk, messages = [])
//     -> { instructions, sections }
//   renderAgentTwin(template, desk, messages = [])
//     -> plain data for the UI / /api/agent
//   agentTwin(parsed, opts) -> rendered twin (desk compat shim)
//   appendTemplateObservation(text, observation) -> new text
//   clearTemplateCache()
//
// agent.md is a RENDER TEMPLATE, not an inventory. It must NOT
// list tools literally: the parser REJECTS a Tools section that
// names tools (e.g. "- files.list — …") with a clear error, so a
// hardcoded tool list can never drift back in through this file.
// What the template carries, per section, is a variable reference
// and a note of what that variable carries:
//
//   Soul          -> desk.soul (soul.md: who the agent is)
//   Instructions  -> desk.engine.instructions (how it answers)
//   Agent         -> desk.engine twin + desk.defaultInference
//   History       -> session messages + agent history.md entries
//   Tools         -> desk.tools (the live tool registry)
//   Live Artifacts-> desk.liveArtifact twin
//   Skills        -> desk.skills
//   Memory        -> desk.memory (live artifact state + history)
//   Observations  -> template-level lessons (see below)
//
// Soul and Instructions are SEPARATE: soul.md is character,
// role and north star; instructions.md is operating rules. The
// two are never merged into one string.
//
// CONFIGURATION-DRIVEN RENDER: the instructions string is
// generated AT RUNTIME from the current desk object. The Tools
// section is filled from the live registry at that moment —
// changing the registry (add/remove/change a tool) changes the
// rendered instructions with NO edit to agent.md.
//
// PER-ELEMENT CACHE: the cache is keyed per element by a stable
// hash of THAT element's data (tool specs for Tools, soul text
// for Soul, and so on). Rendering twice with an unchanged object
// returns the cached sections; changing a tool re-renders Tools
// ONLY — Soul, History and the rest stay cached. A registry
// change therefore invalidates the Tools cache, never serving a
// stale tool list.
//
// OBSERVATIONS (subagent improvement mechanism): any subagent
// can append a template-level observation to the template's
// Observations section AND improve the element it observed
// (bump that element's version, update its improvesOn note,
// keep its data shape), so the next subagent starts from the
// improved template, not from scratch. Shape, machine-parseable
// like history.md entries:
//   - <date> · <agent-id> · <observation> · <improvement>
//   improvesOn: <previous version/element>   (when it changes
//                                            the template)
// DISTINCTION, kept clean: run-specific observations (what
// happened in one run, file paths, results) go to
// personal/memory/agent/<id>/history.md and are NOT pushed
// (personal/ is gitignored). Template-level observations (a
// better rendering, a better tool description, a better gate,
// a lesson that applies to every agent) go to the public
// template's Observations section and ARE pushed with the
// branch, because the template file is tracked. No keys, no
// absolute paths, no .env content in either destination.
// The renderer includes template-level observations only —
// it never reads personal history, so a run-specific
// observation can never leak into the rendered instructions.
//
// A key is NEVER carried through: a "key:" line in the template
// is dropped, so a key can never reach the browser through this
// loader, even if a user mistakenly writes one into agent.md.
//
// Fallback, like instructions/model.json: personal/agent.md wins
// if present, else public/defaults/agent.md, else a built-in
// template with the same section structure (so createDesk()
// never fails for a missing agent.md in a test or a partial
// checkout). User-added agent.md saves go to personal/, never
// to public/defaults/ — this loader only reads; it never writes
// (appendTemplateObservation returns new text; the caller
// decides where to write it).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SECTION_IDS = Object.freeze([
  "soul",
  "instructions",
  "agent",
  "history",
  "tools",
  "live artifacts",
  "skills",
  "memory",
  "observations",
]);

function splitSections(text) {
  const sections = {};
  let name = "default";
  let version = 1;
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const h1 = line.match(/^#\s+Agent:\s*(.+)$/i);
    const versionLine = line.match(/^Version:\s*(\d+)$/i);
    const h2 = line.match(/^##\s+(.+)$/);
    if (h1) {
      name = h1[1].trim();
      continue;
    }
    if (versionLine && !current) {
      version = Number.parseInt(versionLine[1], 10);
      continue;
    }
    if (h2) {
      current = h2[1].trim().toLowerCase();
      sections[current] = sections[current] ?? [];
      continue;
    }
    if (current) {
      sections[current].push(rawLine);
    }
  }
  return { name, version, sections };
}

function keyValueLines(lines) {
  const out = {};
  for (const rawLine of lines ?? []) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) {
      continue;
    }
    const body = line.slice(2).trim();
    const colon = body.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    out[body.slice(0, colon).trim().toLowerCase()] = body
      .slice(colon + 1)
      .trim();
  }
  return out;
}

function numberedLines(lines) {
  const steps = [];
  for (const rawLine of lines ?? []) {
    const line = rawLine.trim();
    const match = line.match(/^\d+[.)]\s+(.+)$/);
    if (match) {
      steps.push(match[1].trim());
    }
  }
  return steps;
}

// A literal tool line in the Tools section is the drift this
// parser exists to stop: "- files.list — immediate — …" is a
// hardcoded inventory, not a variable reference, and it goes
// stale the moment the registry changes. Reject it loudly.
function assertNoLiteralTools(lines) {
  for (const rawLine of lines ?? []) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) {
      continue;
    }
    const first = line.slice(2).trim().split(/\s+/)[0] ?? "";
    if (/^(files|terminal|web)\.[a-z]+$/i.test(first)) {
      throw new Error(
        `agent.md must not list tools literally (${first}); Tools is a variable (desk.tools), filled from the live registry at render time`,
      );
    }
  }
}

// Parse the Observations section: one standard entry per line,
// "- <date> · <agent-id> · <observation> · <improvement>", with
// an optional following "improvesOn: <previous version/element>"
// line that applies to the entry just above it. Malformed lines
// are skipped, never thrown on — a tool reading observations
// must not fail the whole read on one bad entry.
export function parseObservations(lines) {
  const observations = [];
  let current = null;
  for (const rawLine of lines ?? []) {
    const line = rawLine.trim();
    const entry = line.match(/^-\s+(\S+)\s+·\s+(\S+)\s+·\s+(.+?)\s+·\s+(.+)$/);
    if (entry) {
      current = {
        date: entry[1],
        agentId: entry[2],
        observation: entry[3].trim(),
        improvement: entry[4].trim(),
        improvesOn: null,
      };
      observations.push(current);
      continue;
    }
    const improves = line.match(/^improvesOn:\s*(.+)$/);
    if (improves && current) {
      current.improvesOn = improves[1].trim();
    }
  }
  return observations;
}

// Append a template-level observation to template text and
// return the new text (the caller writes it, this function does
// not). The entry goes into the ## Observations section,
// created before ## Initialization if absent. If the
// observation improves a template element, the caller also
// bumps that element's version — see appendTemplateObservation
// returning the parsed template with version +1 and improvesOn
// recorded, so the improvement is visible in the object, not
// just in the text.
export function appendTemplateObservation(text, observation) {
  if (!observation?.date || !observation?.agentId) {
    throw new Error("observation needs a date and an agent-id");
  }
  if (!observation?.observation || !observation?.improvement) {
    throw new Error("observation needs an observation and an improvement");
  }
  const entry = `- ${observation.date} · ${observation.agentId} · ${observation.observation} · ${observation.improvement}`;
  const improvesLine = observation.improvesOn
    ? `\nimprovesOn: ${observation.improvesOn}`
    : "";
  const lines = String(text ?? "").split(/\r?\n/);
  const obsAt = lines.findIndex((line) =>
    /^##\s+Observations\s*$/i.test(line.trim()),
  );
  let next;
  if (obsAt >= 0) {
    // Append at the end of the Observations section (before the
    // next ## heading, or at end of file).
    let end = obsAt + 1;
    while (end < lines.length && !/^##\s+/.test(lines[end].trim())) {
      end += 1;
    }
    next = [...lines];
    next.splice(end, 0, entry + improvesLine);
  } else {
    const initAt = lines.findIndex((line) =>
      /^##\s+Initialization\s*$/i.test(line.trim()),
    );
    const block = ["", "## Observations", "", entry + improvesLine, ""];
    if (initAt >= 0) {
      next = [...lines.slice(0, initAt), ...block, ...lines.slice(initAt)];
    } else {
      next = [...lines, ...block];
    }
  }
  const newText = next.join("\n");
  const template = parseAgentMd(newText);
  // An observation that improves the template bumps the template
  // version and records what it improves on.
  if (observation.improvesOn) {
    template.version = (template.version ?? 1) + 1;
    template.improvesOn = observation.improvesOn;
  }
  return { text: newText, template };
}

export function parseAgentMd(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("agent.md needs text to parse");
  }
  const { name, version, sections } = splitSections(text);
  assertNoLiteralTools(sections.tools);
  const sectionList = [];
  for (const id of SECTION_IDS) {
    if (!sections[id]) {
      continue;
    }
    const values = keyValueLines(sections[id]);
    delete values.key;
    sectionList.push({
      id,
      variable: values.variable ?? null,
      carries: values.carries ?? "",
      values,
    });
  }
  const soul = keyValueLines(sections.soul);
  const instructions = keyValueLines(sections.instructions);
  const agent = keyValueLines(sections.agent);
  const artifact = keyValueLines(sections["live artifacts"]);
  const memory = keyValueLines(sections.memory);
  return {
    name,
    version,
    sections: sectionList,
    soul: {
      variable: soul.variable ?? "desk.soul",
      carries: soul.carries ?? "soul text (character, role, north star)",
    },
    instructions: {
      variable: instructions.variable ?? "desk.engine.instructions",
      carries: instructions.carries ?? "instructions text (how it answers)",
    },
    agent: {
      variable: agent.variable ?? "desk.engine twin + desk.defaultInference",
      carries: agent.carries ?? "engine twin, desk default",
      keyNote: "never written here — resolved server-side from personal/.env",
    },
    history: {
      variable:
        keyValueLines(sections.history).variable ??
        "session messages + agent history.md entries",
      carries:
        keyValueLines(sections.history).carries ??
        "session history AND agent history, labelled separately, never merged",
    },
    tools: {
      variable:
        keyValueLines(sections.tools).variable?.split(/\s+/)[0] ?? "desk.tools",
      carries:
        keyValueLines(sections.tools).carries ??
        "tool specs at render time, from the live registry",
      web: "none",
    },
    liveArtifact: {
      variable: artifact.variable ?? "desk.liveArtifact twin",
      carries: artifact.carries ?? "artifact id, open, focus, modified",
      id: artifact.id ?? "default",
      state: artifact.state ?? "personal/memory/agent/default/state.md",
      history: artifact.history ?? "personal/memory/agent/default/history.md",
    },
    skills: {
      variable: keyValueLines(sections.skills).variable ?? "desk.skills",
      carries:
        keyValueLines(sections.skills).carries ??
        "the skills list at render time",
    },
    memory: {
      variable:
        memory.variable ?? "desk.memory (live artifact state + history)",
      carries:
        memory.carries ??
        "agent memory: state (open, focus, modified) + agent history entries, labelled, never merged with session chat",
      state: memory.state ?? "personal/memory/agent/default/state.md",
      history: memory.history ?? "personal/memory/agent/default/history.md",
    },
    observations: parseObservations(sections.observations),
    initialization: numberedLines(sections.initialization),
  };
}

export function builtInTemplate() {
  return {
    name: "default",
    version: 2,
    sections: [
      {
        id: "soul",
        variable: "desk.soul",
        carries: "soul text (character, role, north star)",
        values: {},
      },
      {
        id: "instructions",
        variable: "desk.engine.instructions",
        carries: "instructions text (how it answers)",
        values: {},
      },
      {
        id: "agent",
        variable: "desk.engine twin + desk.defaultInference",
        carries: "engine twin, desk default",
        values: {},
      },
      {
        id: "history",
        variable: "session messages + agent history.md entries",
        carries:
          "session history AND agent history, labelled separately, never merged",
        values: {},
      },
      {
        id: "tools",
        variable: "desk.tools",
        carries: "tool specs at render time, from the live registry",
        values: {},
      },
      {
        id: "live artifacts",
        variable: "desk.liveArtifact twin",
        carries: "artifact id, open, focus, modified",
        values: {},
      },
      {
        id: "skills",
        variable: "desk.skills",
        carries: "the skills list at render time",
        values: {},
      },
      {
        id: "memory",
        variable: "desk.memory (live artifact state + history)",
        carries:
          "agent memory: state (open, focus, modified) + agent history entries, labelled, never merged with session chat",
        values: {},
      },
      {
        id: "observations",
        variable: "template.observations",
        carries: "template-level observations (not run-specific history)",
        values: {},
      },
    ],
    soul: {
      variable: "desk.soul",
      carries: "soul text (character, role, north star)",
    },
    instructions: {
      variable: "desk.engine.instructions",
      carries: "instructions text (how it answers)",
    },
    agent: {
      variable: "desk.engine twin + desk.defaultInference",
      carries: "engine twin, desk default",
      keyNote: "never written here — resolved server-side from personal/.env",
    },
    history: {
      variable: "session messages + agent history.md entries",
      carries:
        "session history AND agent history, labelled separately, never merged",
    },
    tools: {
      variable: "desk.tools",
      carries: "tool specs at render time, from the live registry",
      web: "none",
    },
    liveArtifact: {
      variable: "desk.liveArtifact twin",
      carries: "artifact id, open, focus, modified",
      id: "default",
      state: "personal/memory/agent/default/state.md",
      history: "personal/memory/agent/default/history.md",
    },
    skills: {
      variable: "desk.skills",
      carries: "the skills list at render time",
    },
    memory: {
      variable: "desk.memory (live artifact state + history)",
      carries:
        "agent memory: state (open, focus, modified) + agent history entries, labelled, never merged with session chat",
      state: "personal/memory/agent/default/state.md",
      history: "personal/memory/agent/default/history.md",
    },
    observations: [],
    initialization: [
      "createDesk — load the desk (personal/ else public/defaults/ fallback)",
      "load agent.md — read this template: section structure + variable references",
      "createEngine — create the engine with the soul instructions",
      "load core tools — attach the live tool registry (the Tools variable's source)",
      "create/load live artifact — create or load the live artifact for the location",
      "render — renderAgentInstructions(template, desk): fill each element from the desk at runtime, per-element cached",
      "twin — return the rendered twin (engine twin + rendered sections) for the UI",
    ],
  };
}

export function loadAgentMd(personalDir, defaultsDir) {
  const personalFile = join(personalDir, "agent.md");
  if (existsSync(personalFile)) {
    const template = parseAgentMd(readFileSync(personalFile, "utf8"));
    return { template, agent: template, source: "personal" };
  }
  const defaultsFile = join(defaultsDir, "agent.md");
  if (existsSync(defaultsFile)) {
    const template = parseAgentMd(readFileSync(defaultsFile, "utf8"));
    return { template, agent: template, source: "public" };
  }
  const template = builtInTemplate();
  return { template, agent: template, source: "built-in" };
}

// --- runtime render + per-element cache -------------------------------

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function hashKey(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function previewOf(text) {
  const firstLine = String(text ?? "")
    .split(/\r?\n/)[0]
    .trim();
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

function toolSpecsOf(desk) {
  let list = [];
  if (typeof desk?.listTools === "function") {
    try {
      list = desk.listTools();
    } catch {
      list = [];
    }
  } else if (Array.isArray(desk?.tools)) {
    list = desk.tools
      .map((tool) => (typeof tool?.spec === "function" ? tool.spec() : tool))
      .filter(Boolean);
  } else if (Array.isArray(desk?.tools?.list)) {
    list = desk.tools.list;
  }
  return list;
}

function artifactsOf(desk) {
  if (typeof desk?.listArtifacts === "function") {
    try {
      return desk.listArtifacts();
    } catch {
      return [];
    }
  }
  if (Array.isArray(desk?.artifacts)) {
    return desk.artifacts.map((artifact) =>
      typeof artifact?.twin === "function" ? artifact.twin() : artifact,
    );
  }
  if (desk?.liveArtifact) {
    const twin =
      typeof desk.liveArtifact.twin === "function"
        ? desk.liveArtifact.twin()
        : desk.liveArtifact;
    return twin ? [twin] : [];
  }
  return [];
}

function agentHistoryOf(desk) {
  const raw = desk?.agentHistory ?? desk?.memory?.history ?? [];
  if (Array.isArray(raw)) {
    return raw;
  }
  try {
    return desk?.liveArtifact?.history?.() ?? [];
  } catch {
    return [];
  }
}

// Soul for rendering: desk.soul if the desk carries it, else
// read personal/soul.md else public/defaults/soul.md from disk
// (desk.location is the personal dir; defaults live under the
// project public/defaults/). Never an error, never a key/path.
function soulOf(desk) {
  if (typeof desk?.soul?.text === "string") {
    return { text: desk.soul.text, source: desk.soul.source ?? "public" };
  }
  if (typeof desk?.soul === "string") {
    return { text: desk.soul, source: "public" };
  }
  try {
    const personalDir = desk?.location;
    const personalFile = personalDir ? join(personalDir, "soul.md") : null;
    if (personalFile && existsSync(personalFile)) {
      return {
        text: readFileSync(personalFile, "utf8").trim(),
        source: "personal",
      };
    }
    const defaultsFile = join(process.cwd(), "public/defaults/soul.md");
    if (existsSync(defaultsFile)) {
      return {
        text: readFileSync(defaultsFile, "utf8").trim(),
        source: "public",
      };
    }
  } catch {
    // Soul is never an error: fall through to empty.
  }
  return { text: "", source: "none" };
}

// Memory for rendering: desk.memory if carried, else the live
// artifact twin + history, with source personal if a personal
// memory file exists, else public if a defaults template file
// exists, else none. Read-only: this never writes anywhere.
function memoryOf(desk) {
  if (desk?.memory) {
    return desk.memory;
  }
  const artifacts = artifactsOf(desk);
  const state = artifacts[0] ?? null;
  const history = agentHistoryOf(desk);
  let source = "none";
  try {
    const dir = desk?.liveArtifact?.dir;
    if (
      dir &&
      (existsSync(join(dir, "state.md")) || existsSync(join(dir, "history.md")))
    ) {
      source = "personal";
    } else if (
      existsSync(
        join(process.cwd(), "public/defaults/memory/agent/default/state.md"),
      ) ||
      existsSync(
        join(process.cwd(), "public/defaults/memory/agent/default/history.md"),
      )
    ) {
      source = "public";
    }
  } catch {
    source = "none";
  }
  return { state, history, source };
}

// Element data, per section id. Each element carries different
// things, from the live desk — never from agent.md text.
function elementData(id, template, desk, messages) {
  switch (id) {
    case "soul": {
      const soul = soulOf(desk);
      return {
        text: soul.text,
        source: soul.source,
        preview: previewOf(soul.text),
      };
    }
    case "instructions": {
      const text =
        typeof desk?.engine?.instructions === "string"
          ? desk.engine.instructions
          : "";
      const source =
        desk?.instructions?.source ??
        desk?.engine?.metadata?.source ??
        "public";
      return { text, source, preview: previewOf(text) };
    }
    case "agent": {
      const engine = desk?.engine ?? null;
      const twin =
        engine && typeof engine.twin === "function" ? engine.twin() : null;
      const defaultInference = desk?.defaultInference ?? null;
      return {
        model: twin?.model ?? defaultInference?.model ?? null,
        provider: defaultInference?.provider ?? null,
        endpoint: defaultInference?.endpoint ?? null,
        status:
          defaultInference || twin?.model ? "Ready" : "No model configured",
        hasDefault: Boolean(defaultInference ?? twin?.model),
        inferenceCount: Array.isArray(desk?.inferences)
          ? desk.inferences.length
          : 0,
        messageCount: messages.length,
        instructionsPreview: twin?.instructionsPreview ?? null,
      };
    }
    case "history": {
      const session = messages.map((message) => ({
        role: message?.role ?? "user",
        content: typeof message?.content === "string" ? message.content : "",
      }));
      return { session, agent: agentHistoryOf(desk) };
    }
    case "tools": {
      const list = toolSpecsOf(desk);
      return {
        list,
        count: list.length,
        web: list.filter((tool) => tool.name?.startsWith("web.")),
      };
    }
    case "live-artifacts":
      return artifactsOf(desk);
    case "skills":
      return Array.isArray(desk?.skills) ? desk.skills : [];
    case "memory":
      return memoryOf(desk);
    case "observations":
      // Template-level observations only: they come from the
      // template object, never from personal history.
      return Array.isArray(template?.observations) ? template.observations : [];
    default:
      return null;
  }
}

function renderElementData(id, data) {
  switch (id) {
    case "soul":
      return [
        "## Soul",
        data.text || "(no soul configured)",
        `Source: ${data.source ?? "public"}`,
      ].join("\n");
    case "instructions":
      return [
        "## Instructions",
        data.text || "(no instructions configured)",
        `Source: ${data.source ?? "public"}`,
      ].join("\n");
    case "agent":
      return [
        "## Agent",
        `Status: ${data.status ?? "—"}`,
        `Model: ${data.model ?? "—"}`,
        `Provider: ${data.provider ?? "—"}`,
        `Endpoint: ${data.endpoint ?? "—"}`,
        `Models in store: ${data.inferenceCount ?? 0}`,
        `Messages: ${data.messageCount ?? 0}`,
      ].join("\n");
    case "history": {
      const session = (data.session ?? [])
        .map((message) => `- ${message.role}: ${message.content}`)
        .join("\n");
      const agent = (data.agent ?? [])
        .map(
          (entry) =>
            `- ${entry.timestamp ? `${entry.timestamp} · ` : ""}${entry.action}${entry.path ? ` · ${entry.path}` : ""}${entry.detail ? ` — ${entry.detail}` : ""}`,
        )
        .join("\n");
      return [
        "## History",
        "Session history:",
        session || "(no session messages yet)",
        "Agent history:",
        agent || "(no agent history yet)",
      ].join("\n");
    }
    case "tools": {
      const lines = (data.list ?? []).map(
        (tool) =>
          `- ${tool.name} (${tool.expectation ?? "immediate"}) — ${tool.description ?? ""}`,
      );
      return [
        "## Tools",
        `Core tools (${data.count ?? 0}), web tools: ${data.web?.length ?? 0}`,
        ...(lines.length > 0 ? lines : ["(no tools loaded)"]),
      ].join("\n");
    }
    case "live-artifacts":
      if (!Array.isArray(data) || data.length === 0) {
        return "## Live Artifacts\n(no live artifact yet)";
      }
      return [
        "## Live Artifacts",
        ...data.map(
          (artifact) =>
            `- ${artifact.id ?? "default"}: open: ${(artifact.open ?? []).join(", ") || "none"} · focus: ${artifact.focus?.path ?? artifact.focus ?? "none"} · modified: ${(artifact.modified ?? []).map((entry) => entry.path ?? entry).join(", ") || "none"}`,
        ),
      ].join("\n");
    case "skills":
      if (!Array.isArray(data) || data.length === 0) {
        return "## Skills\nSkills will be added later.";
      }
      return [
        "## Skills",
        ...data.map((skill) => `- ${skill?.name ?? skill}`),
      ].join("\n");
    case "memory": {
      const state = data.state ?? null;
      const history = (data.history ?? [])
        .map(
          (entry) =>
            `- ${entry.timestamp ? `${entry.timestamp} · ` : ""}${entry.action}${entry.path ? ` · ${entry.path}` : ""}${entry.detail ? ` — ${entry.detail}` : ""}`,
        )
        .join("\n");
      return [
        "## Memory",
        `Source: ${data.source ?? "none"}`,
        state
          ? `State: open: ${(state.open ?? []).join(", ") || "none"} · focus: ${state.focus?.path ?? state.focus ?? "none"} · modified: ${(state.modified ?? []).map((entry) => entry.path ?? entry).join(", ") || "none"}`
          : "State: (no live artifact yet)",
        "Agent history:",
        history || "(no agent history yet)",
      ].join("\n");
    }
    case "observations":
      if (!Array.isArray(data) || data.length === 0) {
        return "## Observations\n(no template observations yet)";
      }
      return [
        "## Observations",
        ...data.map(
          (obs) =>
            `- ${obs.date} · ${obs.agentId} · ${obs.observation} · ${obs.improvement}${obs.improvesOn ? `\nimprovesOn: ${obs.improvesOn}` : ""}`,
        ),
      ].join("\n");
    default:
      return "";
  }
}

const templateCache = new Map();

export function clearTemplateCache() {
  templateCache.clear();
}

function elementKey(id, data) {
  return `${id}:${hashKey(stableStringify(data))}`;
}

// Render one element, per-element cached. Returns
// { id, data, rendered, cached, cacheKey }.
export function renderTemplateElement(id, template, desk, messages = []) {
  const data = elementData(id, template, desk, messages);
  const key = elementKey(id, data);
  const cached = templateCache.get(id);
  if (cached && cached.key === key) {
    return { id, data, rendered: cached.rendered, cached: true, cacheKey: key };
  }
  const rendered = renderElementData(id, data);
  templateCache.set(id, { key, rendered });
  return { id, data, rendered, cached: false, cacheKey: key };
}

// Render the full instructions string from a template + a live
// desk object. Section order follows the template's sections
// (normalised: "live artifacts" -> "live-artifacts"); a template
// section with no renderer is ignored, never invented. The
// Observations section renders only when the template carries
// observations (template-level); an empty list renders the
// placeholder line, never personal history.
export function renderAgentInstructions(template, desk, messages = []) {
  const order =
    Array.isArray(template?.sections) && template.sections.length > 0
      ? template.sections.map((section) =>
          String(section.id).trim().toLowerCase().replace(/\s+/g, "-"),
        )
      : [
          "soul",
          "instructions",
          "agent",
          "history",
          "tools",
          "live-artifacts",
          "skills",
          "memory",
          "observations",
        ];
  const sections = [];
  for (const id of order) {
    const data = elementData(id, template, desk, messages);
    if (data === null) {
      continue;
    }
    sections.push(renderTemplateElement(id, template, desk, messages));
  }
  return {
    instructions: sections.map((section) => section.rendered).join("\n\n"),
    sections,
    templateVersion: template?.version ?? 2,
  };
}

// The rendered twin for the UI / /api/agent: the rendered
// instructions string + per-element sections + live data. No
// keys, no absolute paths, no .env content.
export function renderAgentTwin(template, desk, messages = []) {
  const rendered = renderAgentInstructions(template, desk, messages);
  const byId = Object.fromEntries(
    rendered.sections.map((section) => [section.id, section]),
  );
  const tools = byId.tools?.data ?? { list: [], count: 0, web: [] };
  return {
    id: template?.liveArtifact?.id ?? "default",
    name: template?.name ?? "default",
    source: template?.source ?? "public",
    templateVersion: rendered.templateVersion,
    improvesOn: template?.improvesOn ?? null,
    instructionsText: rendered.instructions,
    sections: rendered.sections.map((section) => ({
      id: section.id,
      rendered: section.rendered,
      cached: section.cached,
      cacheKey: section.cacheKey,
    })),
    soul: byId.soul?.data ?? null,
    instructions: byId.instructions?.data ?? null,
    agent: byId.agent?.data ?? null,
    history: byId.history?.data ?? null,
    tools: {
      list: tools.list,
      count: tools.count,
      web: tools.web,
      webCount: tools.web.length,
    },
    liveArtifacts: byId["live-artifacts"]?.data ?? [],
    skills: byId.skills?.data ?? [],
    memory: byId.memory?.data ?? null,
    observations: byId.observations?.data ?? [],
    initialization: template?.initialization ?? [],
  };
}

// Desk compat: the old agentTwin(parsed, { defaultInference,
// source }) shape, now backed by the runtime renderer. The desk
// passes its live objects through opts (listTools, engine,
// liveArtifact, location) so the twin is filled from the live
// registry, not from the file.
export function agentTwin(parsed, opts = {}) {
  const template = {
    ...parsed,
    source: opts.source ?? parsed.source ?? "public",
  };
  const desk = {
    engine: opts.engine ?? null,
    defaultInference: opts.defaultInference ?? null,
    inferences:
      opts.inferences ?? (opts.defaultInference ? [opts.defaultInference] : []),
    listTools: opts.listTools ?? (() => []),
    listArtifacts: opts.listArtifacts,
    liveArtifact: opts.liveArtifact ?? null,
    artifacts: opts.artifacts ?? null,
    skills: opts.skills ?? [],
    location: opts.location ?? null,
    soul: opts.soul ?? null,
    agentHistory: opts.agentHistory ?? [],
  };
  return renderAgentTwin(template, desk, opts.messages ?? []);
}
