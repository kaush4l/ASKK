// Snapshot state v2 — include everything live, not just messages.
//
// A snapshot shows context as it was at that moment: every element's
// toString() (soul, instructions, tools, artifact, watchers running,
// scripts, models, response format, history), plus watchers running,
// scripts we have, tools, artifact state, phase state (if any),
// activity and counts. Deep-copied, so later live changes never
// rewrite it.
//
// Restart state: record what was running, so a restart can restart
// what was running. Kept agents/watchers/scripts respawn; run-only
// items do not. A restart record is evidence, not a live object.

import { deepCopy } from "./snapshot.js";

export function createDeskSnapshotState({
  id,
  at,
  elements = [],
  watchersRunning = [],
  scripts = [],
  tools = [],
  artifact = null,
  phase = null,
  activity = "idle",
  counts = {},
  messages = [],
} = {}) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("snapshot state needs an id");
  }
  const elementStrings = {};
  for (const el of elements) {
    elementStrings[el.id] = el.toString();
  }
  return deepCopy({
    id,
    at: at ?? new Date().toISOString(),
    elementStrings,
    watchersRunning,
    scripts,
    tools: tools.map((t) => (typeof t === "string" ? t : t.name)),
    artifact,
    phase,
    activity,
    counts,
    messages,
  });
}

// Restart: split what was running into kept (respawn) vs run-only
// (do not respawn). Kept = keep:"desk" agents, keep:"desk" watchers/
// scripts, and the current phase if it is a kept workflow. Run-only
// items are recorded for evidence, but never restarted.
export function createRestartState({
  runningWatchers = [],
  runningScripts = [],
  runningSubagents = [],
  phase = null,
  artifact = null,
} = {}) {
  const keptWatchers = runningWatchers.filter((w) => w.keep === "desk");
  const keptScripts = runningScripts.filter((s) => s.keep === "desk");
  const keptSubagents = runningSubagents.filter((a) => a.keep === "desk");
  return deepCopy({
    restartList: [
      ...keptWatchers.map((w) => ({ type: "watcher", name: w.name })),
      ...keptScripts.map((s) => ({ type: "script", name: s.name })),
      ...keptSubagents.map((a) => ({ type: "agent", name: a.name })),
    ],
    runOnlyNotRestarted: [
      ...runningWatchers.filter((w) => w.keep !== "desk").map((w) => w.name),
      ...runningScripts.filter((s) => s.keep !== "desk").map((s) => s.name),
      ...runningSubagents.filter((a) => a.keep !== "desk").map((a) => a.name),
    ],
    phase,
    artifact: artifact
      ? { open: artifact.open ?? [], focus: artifact.focus ?? null }
      : null,
  });
}
