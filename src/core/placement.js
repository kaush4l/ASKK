// Runtime placement — SAME tool, CORRECT folder.
//
// Every agent calls the SAME create tool. At runtime, placement
// decides where the created item lives and what the calling agent
// can see:
//
// - Load shared first, then agent-specific. Agent-specific wins on
//   the same name. No duplicates.
// - Shared items are available to any agent, but still narrowed to
//   the caller's tools/lanes. Availability is not permission.
// - Agent-specific items are visible/runnable only by that agent.
// - Items created during a run go to shared ONLY if explicitly
//   chosen, else to <agent>/. Because they are files, they survive
//   restarts; in-memory state does not.
// - Soul is immutable: any spawn/create input that tries to set a
//   soul is refused, with the reason stated.

export const AGENT_NAME = /^[a-z][a-z0-9-]*$/;

export function checkAgentName(name) {
  if (typeof name !== "string" || !AGENT_NAME.test(name)) {
    throw new Error(
      `agent name must match [a-z][a-z0-9-]*, got ${JSON.stringify(name)}`,
    );
  }
  return name;
}

export function mergePlacement(shared, agentSpecific) {
  const byName = new Map();
  for (const item of shared ?? []) {
    const name = typeof item === "string" ? item : item.name;
    if (name)
      byName.set(name, {
        ...(typeof item === "object" ? item : { name }),
        scope: "shared",
      });
  }
  for (const item of agentSpecific ?? []) {
    const name = typeof item === "string" ? item : item.name;
    if (name)
      byName.set(name, {
        ...(typeof item === "object" ? item : { name }),
        scope: "agent",
      });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function laneCovers(callerLane, requestedLane) {
  if (callerLane === requestedLane) return true;
  if (callerLane.endsWith("/**")) {
    const prefix = callerLane.slice(0, -3);
    return requestedLane.startsWith(prefix);
  }
  return false;
}

export function validateToolsSubset(requested, callerTools) {
  const caller = new Set(callerTools ?? []);
  const bad = (requested ?? []).filter((t) => !caller.has(t));
  if (bad.length) {
    throw new Error(
      `tools not held by caller, cannot give to subagent: ${bad.join(", ")}`,
    );
  }
  return [...(requested ?? [])];
}

export function validateLanesSubset(requested, callerLanes) {
  const bad = (requested ?? []).filter(
    (lane) => !(callerLanes ?? []).some((c) => laneCovers(c, lane)),
  );
  if (bad.length) {
    throw new Error(
      `lanes not held by caller, cannot give to subagent: ${bad.join(", ")}`,
    );
  }
  return [...(requested ?? [])];
}

// The create-subagent tool, validated (mocked in tests, same rules
// in production): name, tools subset, lanes narrowed, keep policy,
// soul immutable, agent file + memory placement.
export function validateSpawn(input, caller) {
  if (
    input &&
    "soul" in input &&
    input.soul !== undefined &&
    input.soul !== ""
  ) {
    throw new Error("soul is immutable: no tool can change the soul");
  }
  const name = checkAgentName(input?.name);
  const tools = validateToolsSubset(input?.tools ?? [], caller?.tools ?? []);
  const writes = validateLanesSubset(input?.writes ?? [], caller?.writes ?? []);
  const reads = validateLanesSubset(input?.reads ?? [], caller?.reads ?? []);
  const keep = input?.keep ?? "run";
  if (keep !== "run" && keep !== "desk") {
    throw new Error(
      `keep must be "run" or "desk", got ${JSON.stringify(keep)}`,
    );
  }
  if (typeof input?.goal !== "string" || input.goal.trim() === "") {
    throw new Error("spawn needs a task-level goal");
  }
  return {
    name,
    goal: input.goal.trim(),
    role: input.role ?? "",
    tools,
    writes,
    reads,
    model: input.model ?? caller?.model ?? null,
    maxSteps:
      typeof input.maxSteps === "number"
        ? Math.min(input.maxSteps, caller?.maxSteps ?? input.maxSteps)
        : (caller?.maxSteps ?? null),
    keep,
    report: input.report !== false,
    // Where this agent's file + memory live (logical, not absolute).
    agentFile: `memory/${name}.agent.md`,
    memoryDir: `memory/agent/${name}`,
    spawnedBy: caller?.name ?? "desk",
  };
}

export function placeCreatedItem({ agent, shared, name, kind }) {
  checkAgentName(agent);
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("created item needs a name");
  }
  const folder = shared ? "shared" : agent;
  // Scripts/watchers live under memory/scripts/ or memory/watchers/
  // in the corrected snapshot structure; kind is "script" or "watcher".
  const dir = kind === "watcher" ? "watchers" : "scripts";
  return `memory/${dir}/${folder}/${name}.${kind}.md`;
}

export function validateScript(input) {
  const kind = input?.kind;
  if (kind !== "notify" && kind !== "shortcut") {
    throw new Error(
      `script kind must be "notify" or "shortcut", got ${JSON.stringify(kind)}`,
    );
  }
  if (kind === "notify") {
    if (!input.watch && !input.event) {
      throw new Error("notify script needs a watch/event trigger");
    }
    if (!input.notify) {
      throw new Error("notify script needs a notify target");
    }
  }
  if (kind === "shortcut") {
    if (!Array.isArray(input.commands) || input.commands.length === 0) {
      throw new Error("shortcut script needs a non-empty commands list");
    }
  }
  return { ...input, kind };
}
