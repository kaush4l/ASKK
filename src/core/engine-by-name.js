// Engine prototype, step 1 — the engine takes just a name.
//
//   const engine = loadEngineByName("developer");
//
// That is the whole input. From the name alone, the engine loads:
//   1. the instructions file — that agent's OWN <name>.instructions.md
//      (personal else public defaults, per-file fallback), never a
//      shared template, never invented text;
//   2. the tools — tool NAMES only from <name>.agent.md's "- tools:"
//      line, looked up in the one kernel registry. A tool's
//      description comes from the tool object itself (its
//      describe() method), never from the agent file, never from a
//      tools.md file (tools.md is never read here). A name with no
//      tool in the registry is recorded in missingTools, never
//      invented;
//   3. any live state that can be retrieved — that agent's own
//      personal/memory/agent/<name>/state.md and history.md, when
//      they exist. Missing state is empty, never invented, and a
//      public-defaults template state.md is NOT live state, so it
//      is never read as state.
//
// Soul is deliberately NOT loaded here: soul is desk-wide and
// immutable, not per-agent (see the lifecycle redraft). The desk
// injects soul into the prompt; this engine, by name, loads only
// what belongs to the agent. That is step 2, not a gap in step 1.
//
// Live state is plain text on the engine (state.md / history.md
// contents), not a second engine object. Writing state back is a
// later step (artifact state attributes), not step 1.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCoreTools } from "./core-tools.js";
import { parseAgentFile, readSnapshotFile } from "./desk-reader.js";
import { ENGINE_TWIN_DEFINITION, createTwinFor } from "./kernel-twin.js";
import { deepCopy } from "./snapshot.js";
// Slice C: engine LOOP STATE (not a chat transcript) — the
// event listener helper lives in tool-artifact-twin.js and is
// wired in here only. Step-1 contract intact: name only, soul
// not loaded here, tools.md never read.
import {
  applyLoopEvent,
  createLoopState,
} from "./tool-artifact-twin.js";

function resolveRoots(opts = {}) {
  return {
    personalDir: opts.personalDir ?? join(process.cwd(), "personal"),
    defaultsDir: opts.defaultsDir ?? join(process.cwd(), "public", "defaults"),
  };
}

function validateName(name) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("engine needs a name");
  }
  const clean = name.trim();
  if (clean.includes("/") || clean.includes("\\") || clean.includes("..")) {
    throw new Error("engine name must be a plain agent name, not a path");
  }
  return clean;
}

export function loadEngineByName(name, opts = {}) {
  const agentName = validateName(name);
  const { personalDir, defaultsDir } = resolveRoots(opts);

  // 1. Agent definition + instructions, personal else public.
  const agentFile = readSnapshotFile(
    personalDir,
    defaultsDir,
    `${agentName}.agent.md`,
  );
  if (!agentFile) {
    throw new Error(`no agent named "${agentName}"`);
  }
  const meta = parseAgentFile(agentFile.text);
  const instructions = readSnapshotFile(
    personalDir,
    defaultsDir,
    `${agentName}.instructions.md`,
  );
  if (!instructions) {
    throw new Error(`agent "${agentName}" has no instructions file`);
  }

  // 2. Tools: names only from the agent file, instances from the
  //    one kernel registry, descriptions from the tools themselves.
  const toolNames = (meta.tools ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const core = opts.coreTools ?? createCoreTools();
  const byName = new Map(core.tools.map((tool) => [tool.name, tool]));
  const tools = [];
  const missingTools = [];
  for (const toolName of toolNames) {
    const tool = byName.get(toolName);
    if (tool) tools.push(tool);
    else missingTools.push(toolName);
  }

  // 3. Live state that can be retrieved, personal only.
  const readPersonal = (rel) => {
    const path = join(personalDir, "memory", "agent", agentName, rel);
    try {
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    } catch {
      return null;
    }
  };
  const stateText = readPersonal("state.md");
  const historyText = readPersonal("history.md");

  const engine = {
    id: agentName,
    name: agentName,
    activity: "idle",
    role: meta.role ?? "",
    goal: meta.goal ?? "",
    keep: meta.keep ?? "run",
    version: meta.version ?? "",
    instructions: instructions.text.trim(),
    instructionsSource: instructions.source,
    agentSource: agentFile.source,
    toolNames,
    tools,
    missingTools,
    liveState: {
      state: stateText ?? "",
      stateFound: stateText !== null,
      history: historyText ?? "",
      historyFound: historyText !== null,
    },
    // Descriptions from the tools themselves — the single reader.
    describeTools() {
      return tools
        .map((tool) =>
          typeof tool.describe === "function" ? tool.describe() : tool.name,
        )
        .join("\n");
    },
    // No twin() method here any more: the live twin is attached
    // below, after the engine exists, so its snapshot can read
    // this same engine object at call time (see kernel-twin.js).
    // Calling engine.twin() still returns the snapshot, for the
    // step-1 shape: the twin is a callable twin object.
  };
  // Live twin, same id as the engine, created in the same call.
  // Snapshot fields (kernel-twin.js ENGINE_TWIN_DEFINITION):
  // name, instructionsSource, toolNames, liveStateFound,
  // activity, plus the step-1 legacy fields read live.
  const twin = createTwinFor(engine, ENGINE_TWIN_DEFINITION, {
    callable: true,
  });
  twin.transitionTo("initialized");
  twin.transitionTo("idle");
  engine.twin = twin;
  // Slice C loop state: event-derived, read live by the twin
  // snapshot below — never polled, never a chat transcript.
  // applyLoopEvent(event, detail) updates loopState and emits
  // the same event on the twin, so subscribers re-read the
  // snapshot. Waiting/running/done are subagent counts (see
  // tool-artifact-twin.js D-C4); tool-call counts live in
  // loopState.toolCalls.
  engine.loopState = createLoopState();
  engine.applyLoopEvent = (event, detail = {}) => {
    applyLoopEvent(engine.loopState, event, detail);
    engine.twin?.emit(event, detail);
    return engine.loopState;
  };
  engine.emitLoopEvent = engine.applyLoopEvent;
  const baseSnapshot = twin.snapshot;
  twin.snapshot = () => ({
    ...baseSnapshot(),
    currentPhase: engine.loopState.currentPhase,
    currentToolCall: engine.loopState.currentToolCall,
    subagents: deepCopy(engine.loopState.subagents),
    waiting: engine.loopState.waiting,
    running: engine.loopState.running,
    done: engine.loopState.done,
  });
  return engine;
}
