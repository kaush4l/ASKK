// Default agent.md — the default way to write and initialize an
// agent, and the loader for it.
//
//   parseAgentMd(text)
//     -> { name, soul, model, tools, liveArtifact, initialization }
//   loadAgentMd(personalDir, defaultsDir)
//     -> { agent, source: "personal" | "public" | "built-in" }
//   agentTwin(parsed, { defaultInference })
//     -> plain data for the UI / /api/agent
//
// The file is human-readable and machine-parseable by headings and
// lists, like history.md entries: "## Soul" / "## Model" /
// "## Tools" with "### files" / "### terminal" subsections,
// "## Live artifact", "## Initialization" (numbered steps).
// A key is NEVER carried through: a "key:" line in Model is read
// only as "never written here — resolved server-side from
// personal/.env", and any value after it is dropped, so a key can
// never reach the browser through this loader, even if a user
// mistakenly writes one into agent.md. No absolute paths are
// carried either: location/state/history are kept as the logical
// strings written in the file (project root, personal/memory/…).
//
// Fallback, like instructions/model.json: personal/agent.md wins
// if present, else public/defaults/agent.md, else a built-in
// default with the same 16 core tools (so createDesk() never fails
// for a missing agent.md in a test or a partial checkout).
// User-added agent.md saves go to personal/, never to
// public/defaults/ — this loader only reads; it never writes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_TOOL_NAMES } from "./core-tools.js";

export const EXPECTATIONS = Object.freeze([
  "immediate",
  "done",
  "stream",
  "live-state",
]);

const BUILT_IN_EXPECTATIONS = Object.freeze({
  "files.list": "immediate",
  "files.read": "immediate",
  "files.write": "immediate",
  "files.edit": "immediate",
  "files.append": "immediate",
  "files.search": "immediate",
  "files.open": "live-state",
  "files.close": "live-state",
  "files.focus": "live-state",
  "terminal.run": "done",
  "terminal.start": "stream",
  "terminal.wait": "stream",
  "terminal.read": "stream",
  "terminal.send": "stream",
  "terminal.stop": "stream",
  "terminal.list": "immediate",
});

const BUILT_IN_PURPOSES = Object.freeze({
  "files.list": "list files under the live artifact root",
  "files.read": "read a file, with from/lines slice for big files",
  "files.write": "write a file inside the root",
  "files.edit": "replace one exact passage, old must match once",
  "files.append": "append to a file",
  "files.search": "case-insensitive text search under a folder/file",
  "files.open": "keep a file open, re-read on open (max 25)",
  "files.close": "close an open file",
  "files.focus": "focus a section of a big file, or a folder as tree root",
  "terminal.run": "run a command to its end, return exit + last lines",
  "terminal.start": "start a long session, keep it running",
  "terminal.wait": "wait until exit, until text appears, or seconds pass",
  "terminal.read": "read a session's last lines",
  "terminal.send": "send a line to a session's stdin",
  "terminal.stop": "stop a session",
  "terminal.list": "list every session",
});

export function builtInAgent() {
  const tools = CORE_TOOL_NAMES.map((name) => ({
    name,
    expectation: BUILT_IN_EXPECTATIONS[name] ?? "immediate",
    purpose: BUILT_IN_PURPOSES[name] ?? "",
  }));
  return {
    name: "default",
    soul: {
      instructions: "personal/instructions.md",
      fallback: "public/defaults/instructions.md",
      preview: "You are ASKK, a helpful assistant. Answer plainly.",
    },
    model: {
      default: "desk default (first entry in personal/model.json)",
      model: null,
      keyNote: "never written here — resolved server-side from personal/.env",
    },
    tools: {
      files: tools.filter((tool) => tool.name.startsWith("files.")),
      terminal: tools.filter((tool) => tool.name.startsWith("terminal.")),
      web: [],
    },
    liveArtifact: {
      id: "default",
      location: "project root",
      state: "personal/memory/agent/default/state.md",
      history: "personal/memory/agent/default/history.md",
    },
    initialization: [
      "createDesk — load the desk (personal/ else public/defaults/ fallback)",
      "load agent.md — read Soul, Model, Tools, and Live artifact above",
      "createEngine — create the engine with the soul instructions",
      "load core tools — attach the 16 default tools listed above",
      "create/load live artifact — create or load the live artifact for the location",
      "twin — return the live object (engine twin + tools + artifact twin) for the UI",
    ],
  };
}

function splitSections(text) {
  const sections = {};
  let current = null;
  let sub = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);
    const h1 = line.match(/^#\s+Agent:\s*(.+)$/i);
    if (h1) {
      sections.__name = h1[1].trim();
      current = null;
      sub = null;
      continue;
    }
    if (h2) {
      current = h2[1].trim().toLowerCase();
      sub = null;
      sections[current] = sections[current] ?? { lines: [], subs: {} };
      continue;
    }
    if (h3 && current) {
      sub = h3[1].trim().toLowerCase();
      sections[current].subs[sub] = [];
      continue;
    }
    if (!current) {
      continue;
    }
    if (sub) {
      sections[current].subs[sub].push(rawLine);
    } else {
      sections[current].lines.push(rawLine);
    }
  }
  return sections;
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

// "- files.open — live-state — keep a file open…" (em/en dash,
// or a spaced hyphen as separator). A hyphen inside a word
// ("re-read") is NOT a separator — only a dash surrounded by
// spaces, or an em/en dash, splits name/expectation/purpose.
function toolLines(lines) {
  const tools = [];
  for (const rawLine of lines ?? []) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) {
      continue;
    }
    const parts = line
      .slice(2)
      .split(/\s*[—–]\s*|\s+-\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 1 || !parts[0].includes(".")) {
      continue;
    }
    const name = parts[0];
    const expectation = EXPECTATIONS.includes(parts[1])
      ? parts[1]
      : "immediate";
    const purpose =
      parts.length > 2 ? parts.slice(2).join(" — ") : (parts[1] ?? "");
    tools.push({ name, expectation, purpose });
  }
  return tools;
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

export function parseAgentMd(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("agent.md needs text to parse");
  }
  const sections = splitSections(text);
  const soul = keyValueLines(sections.soul?.lines);
  const model = keyValueLines(sections.model?.lines);
  const artifact = keyValueLines(sections["live artifact"]?.lines);
  const files = toolLines(sections.tools?.subs.files);
  const terminal = toolLines(sections.tools?.subs.terminal);
  // Any "web" subsection, or a web.* tool listed anywhere, is
  // recorded as web: [] only if none — web tools are ignored for
  // now, and a file that claims them must not silently ship them.
  const web = toolLines(sections.tools?.subs.web).filter((tool) =>
    tool.name.startsWith("web."),
  );
  const all = [...files, ...terminal];
  const webFromLists = all.filter((tool) => tool.name.startsWith("web."));
  const parsed = {
    name: sections.__name ?? "default",
    soul: {
      instructions: soul.instructions ?? "personal/instructions.md",
      fallback: soul.fallback ?? "public/defaults/instructions.md",
      preview: soul.preview ?? "",
    },
    model: {
      default: model.default ?? "desk default",
      // "model:" is a resolved-at-load note, not a value to keep:
      // a parenthesised note stays, anything else is dropped so a
      // mistakenly written model string is not treated as config.
      model: model.model?.startsWith("(") ? model.model : null,
      keyNote: "never written here — resolved server-side from personal/.env",
    },
    tools: {
      files: files.filter((tool) => !tool.name.startsWith("web.")),
      terminal: terminal.filter((tool) => !tool.name.startsWith("web.")),
      web: [...web, ...webFromLists],
    },
    liveArtifact: {
      id: artifact.id ?? "default",
      location: artifact.location ?? "project root",
      state: artifact.state ?? "personal/memory/agent/default/state.md",
      history: artifact.history ?? "personal/memory/agent/default/history.md",
    },
    initialization: numberedLines(sections.initialization?.lines),
  };
  return parsed;
}

export function loadAgentMd(personalDir, defaultsDir) {
  const personalFile = join(personalDir, "agent.md");
  if (existsSync(personalFile)) {
    return {
      agent: parseAgentMd(readFileSync(personalFile, "utf8")),
      source: "personal",
    };
  }
  const defaultsFile = join(defaultsDir, "agent.md");
  if (existsSync(defaultsFile)) {
    return {
      agent: parseAgentMd(readFileSync(defaultsFile, "utf8")),
      source: "public",
    };
  }
  return { agent: builtInAgent(), source: "built-in" };
}

// Plain-data twin for the UI / /api/agent: no keys, no absolute
// paths, no .env content — only the logical strings from the file,
// the tool list, and the desk default resolved by the caller.
export function agentTwin(parsed, { defaultInference } = {}) {
  if (!parsed) {
    throw new Error("agent twin needs a parsed agent.md");
  }
  const files = parsed.tools?.files ?? [];
  const terminal = parsed.tools?.terminal ?? [];
  const list = [...files, ...terminal];
  return {
    id: parsed.liveArtifact?.id ?? "default",
    name: parsed.name ?? "default",
    source: parsed.source ?? "public",
    soul: parsed.soul,
    model: {
      default: parsed.model?.default ?? "desk default",
      resolved: defaultInference
        ? {
            id: defaultInference.id,
            provider: defaultInference.provider,
            endpoint: defaultInference.endpoint,
            model: defaultInference.model,
          }
        : null,
    },
    tools: {
      list,
      count: list.length,
      web: [],
      webCount: 0,
    },
    liveArtifact: parsed.liveArtifact,
    initialization: parsed.initialization ?? [],
  };
}
