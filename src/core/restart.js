// Restart — checkpoint, health, rollback, restore.
//
// Supervisor interface (documented, not implemented as a process
// here): the SUPERVISOR is a separate process that owns the worker
// lifecycle — it starts the worker, watches healthCheck(), and on
// an unhealthy worker restores rollback(checkpointId) and restarts
// it. The WORKER NEVER RESTARTS ITSELF: no agent code calls
// process.exit to restart, and no tool in the registry restarts
// the process. A supervisor that ran agent code would let the
// agent restart itself around a gate; keeping them separate is
// the whole point.
//
// restartState: kept desk agents respawn, run-only agents are
// recorded-not-restarted, and the current phase + artifact
// open/focus are recorded (see snapshot-state.js, re-exported
// here so restart callers have one module).
//
// checkpoint({ why, files, base, storeDir, store, keep }): files
// differing from a base snapshot (added, changed, or deleted),
// bounded (CHECKPOINT_MAX_FILES; over that, the record is marked
// truncated and the newest files win). Newest `keep` checkpoints
// are kept; older ones are dropped. Restore from markdown on
// restart: loadGoalArtifact + loadAgent from memory files
// (restoreFromMarkdown), never from a live object.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { loadGoalArtifactFile } from "./goal-artifact.js";
import { createRestartState } from "./snapshot-state.js";
import { loadAgent } from "./spawn.js";

export { createRestartState };
export const CHECKPOINT_MAX_FILES = 200;
export const CHECKPOINT_KEEP = 5;

let checkpointCounter = 0;

export function restartState(input = {}) {
  return createRestartState(input);
}

export function diffFiles(base = {}, files = {}) {
  const out = {};
  const names = new Set([...Object.keys(base), ...Object.keys(files)]);
  for (const name of names) {
    if (!(name in files)) {
      out[name] = { deleted: true, content: null };
    } else if (base[name] !== files[name]) {
      out[name] = { deleted: false, content: files[name] };
    }
  }
  return out;
}

export function checkpoint({
  why = "",
  files = {},
  base = {},
  storeDir = null,
  store = null,
  keep = CHECKPOINT_KEEP,
} = {}) {
  const differing = diffFiles(base, files);
  const names = Object.keys(differing).sort();
  const truncated = names.length > CHECKPOINT_MAX_FILES;
  const keptNames = truncated ? names.slice(-CHECKPOINT_MAX_FILES) : names;
  checkpointCounter += 1;
  const record = {
    id: `ckpt-${Date.now()}-${checkpointCounter}`,
    why,
    at: new Date().toISOString(),
    files: Object.fromEntries(keptNames.map((name) => [name, differing[name]])),
    count: keptNames.length,
    truncated,
  };
  if (storeDir) {
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(
      join(storeDir, `${record.id}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
    const existing = readdirSync(storeDir)
      .filter((name) => name.startsWith("ckpt-") && name.endsWith(".json"))
      .sort();
    for (const old of existing.slice(0, Math.max(0, existing.length - keep))) {
      rmSync(join(storeDir, old), { force: true });
    }
  } else if (store && Array.isArray(store.records)) {
    store.records.push(record);
    while (store.records.length > keep) {
      store.records.shift();
    }
  }
  return record;
}

export function loadCheckpoint(storeDir, id) {
  const file = join(storeDir, `${id}.json`);
  if (!existsSync(file)) {
    return null;
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

export function healthCheck({ deskDir = null, requiredFiles = [] } = {}) {
  const checks = [];
  if (deskDir) {
    checks.push({
      name: "desk dir exists",
      ok: existsSync(deskDir),
      detail: deskDir,
    });
    for (const rel of requiredFiles) {
      checks.push({
        name: `file exists: ${rel}`,
        ok: existsSync(join(deskDir, rel)),
        detail: rel,
      });
    }
  }
  return { ok: checks.every((c) => c.ok), checks };
}

// Rollback restores checkpoint files: write(content) for changed
// files, delete for { deleted: true }. write is a function
// (path, content) -> void, or, when baseDir is given, the default
// fs writer under baseDir. Returns { restored: [paths] }.
export function rollback(record, { write = null, baseDir = null } = {}) {
  if (!record || typeof record.files !== "object") {
    throw new Error("rollback needs a checkpoint record");
  }
  const writer =
    write ??
    ((path, content) => {
      if (!baseDir) {
        throw new Error("rollback needs a write function or baseDir");
      }
      const full = join(baseDir, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content, "utf8");
    });
  const restored = [];
  for (const [path, entry] of Object.entries(record.files)) {
    if (entry?.deleted) {
      if (baseDir) {
        rmSync(join(baseDir, path), { force: true });
      }
      restored.push(path);
    } else {
      writer(path, entry.content);
      restored.push(path);
    }
  }
  return { restored };
}

// Restore from markdown on restart: desk-kept agents from their
// <name>.agent.md files, goals from their <id>.goal.md files.
// Run-only agents are NOT restored (they are recorded, not
// respawned — see restartState()).
export function restoreFromMarkdown({
  personalDir,
  agentNames = [],
  goalFiles = [],
} = {}) {
  const agents = [];
  for (const name of agentNames) {
    const agent = loadAgent(personalDir, name);
    if (agent && agent.keep === "desk") {
      agents.push(agent);
    }
  }
  const goals = [];
  for (const file of goalFiles) {
    const goal = loadGoalArtifactFile(file);
    if (goal) {
      goals.push(goal);
    }
  }
  return { agents, goals };
}
