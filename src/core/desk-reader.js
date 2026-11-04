// Desk reader — snapshot version.
//
// CORRECTED STRUCTURE (supersedes earlier desk-root readings):
// The snapshot folder is the MEMORY folder, and personal/ and
// public/defaults/ are EXACT replicas following the SAME logical
// structure:
//
//   personal/memory/soul.md
//   personal/memory/developer.agent.md        (<name>.<type>.md)
//   personal/memory/developer.instructions.md
//   personal/memory/model.json (or <agent>.model.json)
//   personal/memory/agent/<name>/state.md, history.md, snapshots/
//   personal/memory/scripts/shared/, scripts/<agent>/
//   personal/memory/watchers/shared/, watchers/<agent>/  (notify scripts)
//
//   public/defaults/memory/  — the same tree, as templates.
//
// Per-file fallback: personal/memory/<file> wins if present, else
// public/defaults/memory/<file>. Legacy locations (personal/<file>,
// public/defaults/<file>) are still read as a last fallback, so the
// existing checkout keeps working, but new writes go to the memory
// folder only. Never write to public/. Agent name is a variable,
// never hardcoded "default": pass agent, and the reader reads
// <agent>.agent.md / <agent>.instructions.md for that agent.
//
// Server-side only (Node fs). Pure helpers are exported for tests.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function resolveDir(location, fallback) {
  if (typeof location === "string" && location.trim() !== "") {
    return isAbsolute(location)
      ? location
      : join(/* turbopackIgnore: true */ process.cwd(), location);
  }
  return join(/* turbopackIgnore: true */ process.cwd(), fallback);
}

export function readTextFile(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// Candidates in order: personal/memory, public/memory, personal legacy,
// public legacy. Returns {text, source, path} or null. `path` is kept
// server-side only and must be stripped before any API response.
export function readSnapshotFile(personalDir, defaultsDir, rel) {
  const candidates = [
    { path: join(personalDir, "memory", rel), source: "personal" },
    { path: join(defaultsDir, "memory", rel), source: "public" },
    { path: join(personalDir, rel), source: "personal-legacy" },
    { path: join(defaultsDir, rel), source: "public-legacy" },
  ];
  for (const c of candidates) {
    const text = readTextFile(c.path);
    if (text !== null) return { text, source: c.source, path: c.path };
  }
  return null;
}

export function parseAgentFile(text) {
  // Simple metadata: lines "- key: value" at the top of the file.
  // The rest of the file is the agent's own text, kept verbatim.
  const meta = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^-\s*([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return meta;
}

export function listNames(dir) {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// Read a desk snapshot for one agent. Returns plain data (no keys,
// no absolute paths in the public twin — see deskSnapshotTwin).
export function readDeskSnapshot({
  personalDir,
  defaultsDir,
  agent = "default",
} = {}) {
  const personal = resolveDir(personalDir, "personal");
  const defaults = resolveDir(defaultsDir, "public/defaults");
  const soul = readSnapshotFile(personal, defaults, "soul.md");
  const agentFile = readSnapshotFile(personal, defaults, `${agent}.agent.md`);
  const instructions =
    readSnapshotFile(personal, defaults, `${agent}.instructions.md`) ??
    readSnapshotFile(personal, defaults, "instructions.md");
  const modelRaw =
    readSnapshotFile(personal, defaults, `${agent}.model.json`) ??
    readSnapshotFile(personal, defaults, "model.json");
  let models = [];
  if (modelRaw) {
    try {
      const parsed = JSON.parse(modelRaw.text);
      models = Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new Error("desk reader could not parse model.json");
    }
  }
  // Scripts / watchers: definition names only, placement resolved
  // by placement.js (shared first, agent-specific wins).
  const scriptsShared = [
    ...listNames(join(personal, "memory", "scripts", "shared")),
    ...listNames(join(defaults, "memory", "scripts", "shared")),
  ];
  const scriptsAgent = [
    ...listNames(join(personal, "memory", "scripts", agent)),
    ...listNames(join(defaults, "memory", "scripts", agent)),
  ];
  const watchersShared = [
    ...listNames(join(personal, "memory", "watchers", "shared")),
    ...listNames(join(defaults, "memory", "watchers", "shared")),
  ];
  const watchersAgent = [
    ...listNames(join(personal, "memory", "watchers", agent)),
    ...listNames(join(defaults, "memory", "watchers", agent)),
  ];
  return {
    agent,
    soul: soul ? soul.text : "",
    soulSource: soul ? soul.source : "none",
    agentFile: agentFile ? agentFile.text : "",
    agentFileSource: agentFile ? agentFile.source : "none",
    agentMeta: agentFile ? parseAgentFile(agentFile.text) : {},
    instructions: instructions ? instructions.text.trim() : "",
    instructionsSource: instructions ? instructions.source : "none",
    models,
    modelsSource: modelRaw ? modelRaw.source : "none",
    scriptsShared: [...new Set(scriptsShared)].sort(),
    scriptsAgent: [...new Set(scriptsAgent)].sort(),
    watchersShared: [...new Set(watchersShared)].sort(),
    watchersAgent: [...new Set(watchersAgent)].sort(),
  };
}

// Public twin: strip paths, strip any key-like fields from models.
export function deskSnapshotTwin(snap) {
  return {
    agent: snap.agent,
    soulSource: snap.soulSource,
    agentFileSource: snap.agentFileSource,
    agentMeta: snap.agentMeta,
    instructionsSource: snap.instructionsSource,
    // Soul/instructions text is configuration, not a secret, and the
    // UI needs it — but never return a model key or apiKeyEnv here.
    soulPreview: String(snap.soul ?? "")
      .split("\n")[0]
      .slice(0, 120),
    models: (snap.models ?? []).map((m) => ({
      id: m.id,
      provider: m.provider,
      endpoint: m.endpoint,
      model: m.model,
      kind: m.kind ?? "api",
    })),
    scriptsShared: snap.scriptsShared,
    scriptsAgent: snap.scriptsAgent,
    watchersShared: snap.watchersShared,
    watchersAgent: snap.watchersAgent,
  };
}
