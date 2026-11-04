// Spawn — agent.spawn / dismiss / update, in code not prose.
//
// createAgent(input, caller, opts):
//   - validates with placement.validateSpawn(): soul is immutable
//     (any soul in the input is refused), name pattern, keep
//     "run"|"desk", and a task-level goal.
//   - tools are an EXPLICIT subset: absent or empty tools are
//     refused — no silent inherit-everything from the caller —
//     and any tool the caller does not hold is refused.
//   - lanes are narrowed the same way (validateLanesSubset).
// Children registry: createChildrenRegistry() holds spawned
// agents; dismiss() removes run agents and persists desk-kept
// agents as <name>.agent.md (via template-skin, soul untouched).
// report(channel): "report" appends a report to both histories
// (agent + parent, labelled separately); "ask" records exactly
// ONE concrete structured question at a time (more than one "?"
// is refused, so a bundled multi-question is never smuggled in).
// loadAgent(baseDir, name) restores a desk-kept agent from its
// <name>.agent.md file on restart.
//
// Developer persona — CORRECTION (2026-11-04): the executing
// agent owns its own loop internally: plan -> execute -> critique,
// looping back to plan/execute on critique failure, until done.
// These phases are DEVELOPER-INTERNAL: they live in the developer
// agent's own state/history (agent.internalPhases, agent.currentPhase),
// never in the goal artifact, and never written by the harness.
// (The old implement -> build -> critique -> review -> done graph
// was harness-driven and is replaced by this loop; review is not
// a harness phase — if the developer creates a review step during
// execution, it is developer-created, recorded in its history.)
// Enforcement is by allowedTools per internal phase, checked by
// the loop's registry narrowing (runPhase in loop.js):
//   plan: files.list/read/search only (explore, never apply)
//   execute: files.* + terminal.run (the work itself)
//   critique: files.read only (judge, never apply: no write/edit
//     tools, so critique can propose but never change code)
//   done: no tools.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAgentFile } from "./desk-reader.js";
import {
  checkAgentName,
  validateLanesSubset,
  validateSpawn,
  validateToolsSubset,
} from "./placement.js";
import { agentFileText, createTemplateAgentSkin } from "./template-skin.js";

export const DEVELOPER_INTERNAL_PHASES = Object.freeze([
  {
    id: "plan",
    duty: "plan the work: explore files, never apply changes",
    allowedTools: ["files.list", "files.read", "files.search"],
    exitGate: (result) => Boolean((result?.answer ?? "").trim()),
  },
  {
    id: "execute",
    duty: "execute the plan: open files, edit, write, run checks",
    allowedTools: [
      "files.list",
      "files.read",
      "files.open",
      "files.write",
      "files.edit",
      "files.append",
      "files.search",
      "files.focus",
      "terminal.run",
    ],
    exitGate: (result) =>
      (result?.calls ?? []).some((c) => c.status === "done"),
  },
  {
    id: "critique",
    duty: "critique the executed change: read only, judge, never apply",
    allowedTools: ["files.read"],
    // Critique passes when its answer does not report failure.
    // Failure words loop back to plan/execute (harness.js).
    exitGate: (result) =>
      Boolean((result?.answer ?? "").trim()) &&
      !/fail|needs work|not ready/i.test(result?.answer ?? ""),
  },
  {
    id: "done",
    duty: "done: report back, no tools",
    allowedTools: [],
    exitGate: null,
  },
]);

// Critique failure rule, shared by harness and tests: an answer
// that reports failure (and does not pass) loops back.
export function critiqueFailed(answer) {
  const text = String(answer ?? "");
  return (
    /fail|needs work|not ready/i.test(text) && !/\bpass(es|ed)?\b/i.test(text)
  );
}

export function developerPersona() {
  return {
    name: "developer",
    role: "builds features for the application",
    goal: "implement a feature, run checks, and propose it for merge",
    // Internal phases only — owned by the developer, not the goal.
    internalPhases: DEVELOPER_INTERNAL_PHASES.map((phase) => ({ ...phase })),
  };
}

export function createAgent(input = {}, caller = {}, opts = {}) {
  const validated = validateSpawn(input, caller);
  if (!Array.isArray(input?.tools) || input.tools.length === 0) {
    throw new Error(
      "spawn needs an explicit tools subset: absent tools are refused, never inherited silently",
    );
  }
  // validateSpawn already checked the subset against caller.tools;
  // re-check explicitly so the refusal names the rule.
  validateToolsSubset(input.tools, caller.tools ?? []);
  if (input.lanes) {
    validateLanesSubset(input.lanes, caller.lanes ?? caller.reads ?? []);
  }
  const agent = {
    name: validated.name,
    goal: validated.goal,
    role: validated.role,
    tools: validated.tools,
    reads: validated.reads,
    writes: validated.writes,
    keep: validated.keep,
    spawnedBy: validated.spawnedBy,
    persona: input.persona ?? null,
    status: "running",
    history: [],
    children: [],
    reportChannel: [],
  };
  agent.report = (text, channel = "report") => {
    if (channel !== "report" && channel !== "ask") {
      throw new Error(
        `report channel must be "report" or "ask", got ${channel}`,
      );
    }
    if (channel === "ask") {
      const questions = (String(text ?? "").match(/\?/g) ?? []).length;
      if (questions !== 1) {
        throw new Error(
          "ask takes exactly one concrete structured question at a time",
        );
      }
    }
    const entry = { channel, text, at: new Date().toISOString() };
    agent.history.push(entry);
    agent.reportChannel.push(entry);
    if (typeof opts.onReport === "function") {
      opts.onReport(entry, agent);
    }
    return entry;
  };
  agent.ask = (question) => agent.report(question, "ask");
  return agent;
}

export function createChildrenRegistry() {
  const children = new Map();
  return {
    list: () => [...children.values()],
    get: (name) => children.get(name) ?? null,
    add: (agent) => {
      checkAgentName(agent?.name);
      if (children.has(agent.name)) {
        throw new Error(`child agent already exists: ${agent.name}`);
      }
      children.set(agent.name, agent);
      return agent;
    },
    dismiss: (name, { baseDir = null } = {}) => {
      const agent = children.get(name);
      if (!agent) {
        throw new Error(`no child agent ${name}`);
      }
      if (agent.keep === "desk") {
        // Desk-kept agents persist as <name>.agent.md; soul untouched.
        if (baseDir) {
          const file = join(baseDir, "memory", `${name}.agent.md`);
          if (!existsSync(file)) {
            createTemplateAgentSkin({
              name,
              baseDir,
              role: agent.role ?? "",
              goal: agent.goal ?? "",
              tools: agent.tools ?? [],
              keep: "desk",
            });
          }
        }
        agent.status = "kept";
        return { removed: false, kept: true, agent };
      }
      children.delete(name);
      agent.status = "dismissed";
      return { removed: true, kept: false, agent };
    },
    update: (name, patch) => {
      const agent = children.get(name);
      if (!agent) {
        throw new Error(`no child agent ${name}`);
      }
      if (
        patch &&
        "soul" in patch &&
        patch.soul !== undefined &&
        patch.soul !== ""
      ) {
        throw new Error("soul is immutable: no tool can change the soul");
      }
      if (patch?.tools) {
        throw new Error(
          "agent tools are set at spawn and cannot be widened by update",
        );
      }
      Object.assign(agent, patch ?? {});
      return agent;
    },
  };
}

export function loadAgent(baseDir, name) {
  checkAgentName(name);
  const file = join(baseDir, "memory", `${name}.agent.md`);
  if (!existsSync(file)) {
    return null;
  }
  const meta = parseAgentFile(readFileSync(file, "utf8"));
  return {
    name,
    role: meta.role ?? "",
    goal: meta.goal ?? "",
    tools: meta.tools
      ? meta.tools
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    keep: meta.keep ?? "run",
    agentFile: `memory/${name}.agent.md`,
    memoryDir: `memory/agent/${name}`,
    status: "restored",
  };
}

export function agentFileFor(agent) {
  return agentFileText({
    name: agent.name,
    role: agent.role ?? "",
    goal: agent.goal ?? "",
    tools: agent.tools ?? [],
    keep: agent.keep ?? "run",
  });
}
