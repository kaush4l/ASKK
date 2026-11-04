// Harness — the HARNESS agent, not a task agent.
//
// The harness translates owner requests into the right subagent
// call. Its duty ENDS there (correction 2026-11-04):
//   1. Translate the owner request into a goal statement.
//   2. Make exactly ONE goal.create call, with the statement only
//      (goal.create refuses phases, plans, and tool lists — see
//      goal-artifact.js).
//   3. Pass that goal to the right executing agent (the developer,
//      first) and return the developer's report to the owner.
// The harness does NOT plan, does NOT write phases into the goal,
// and does NOT give the developer all tools: at spawn it passes
// the goal plus the RULES — the curated developer tool subset
// from memory/developer.agent.md (a strict subset of the kernel
// tools), lanes, gates, and soul reference — on agent.rules.
// The developer's tools are narrowed per internal phase by the
// loop on top of that subset.
//
// The developer owns its loop internally (spawn.js):
// plan -> execute -> critique, looping back to plan/execute on
// critique failure, until done. Internal phases live on the
// developer agent record (agent.internalPhases, agent.currentPhase)
// and in its history — never in the goal artifact.
//
// Startup / desk discovery (desk-folder rule, same as desk.js):
//   personal/ else public/defaults/ else an honest empty state
//   (source "none", empty true — never an invented desk).
// discoverDesk({ personalDir, defaultsDir }) reports which one
// was found; createHarnessFromDeskFolder() builds a harness from
// a desk folder alone (kernel tools from createCoreTools over the
// workspace folder), which is what the cold-start path uses.
// createHarness(desk) wraps an already-loaded desk (createDesk).
// engine.js single-turn chat is untouched for compatibility.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createCoreTools } from "./core-tools.js";
import { parseAgentFile } from "./desk-reader.js";
import { createEngineObject } from "./engine-object.js";
import { createGoal, loadGoalArtifact } from "./goal-artifact.js";
import { runPhase } from "./loop.js";
import {
  createAgent,
  createChildrenRegistry,
  critiqueFailed,
  developerPersona,
} from "./spawn.js";

export function discoverDesk({
  personalDir = "personal",
  defaultsDir = "public/defaults",
} = {}) {
  const personal = isAbsolute(personalDir)
    ? personalDir
    : join(process.cwd(), personalDir);
  const defaults = isAbsolute(defaultsDir)
    ? defaultsDir
    : join(process.cwd(), defaultsDir);
  if (existsSync(personal)) {
    return {
      source: "personal",
      personalDir: personal,
      defaultsDir: defaults,
      empty: false,
    };
  }
  if (existsSync(defaults)) {
    return {
      source: "public",
      personalDir: personal,
      defaultsDir: defaults,
      empty: false,
    };
  }
  return {
    source: "none",
    personalDir: personal,
    defaultsDir: defaults,
    empty: true,
  };
}

// Default goal text, loaded from a template file — never hardcoded
// in engine.js/harness.js. personal/memory/goal-default.md wins,
// else public/defaults/memory/goal-default.md. If the template is
// missing, the fallback is a short string LABELLED "default".
export function loadGoalDefault({
  personalDir = null,
  defaultsDir = null,
} = {}) {
  const candidates = [];
  if (personalDir) {
    candidates.push(join(personalDir, "memory", "goal-default.md"));
  }
  if (defaultsDir) {
    candidates.push(join(defaultsDir, "memory", "goal-default.md"));
  }
  candidates.push(
    join(process.cwd(), "public/defaults/memory/goal-default.md"),
  );
  for (const file of candidates) {
    try {
      if (existsSync(file)) {
        return {
          text: readFileSync(file, "utf8").trim(),
          source: file,
          default: false,
        };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return {
    text: "[default] Take as little human attention as possible, and give as much value as possible; act only when asked or a written rule allows; one concrete structured question at a time; stop by impact not effort; report honestly.",
    source: null,
    default: true,
  };
}

// Load a curated agent definition from memory files, personal
// else public defaults — the SAME per-file fallback as the desk
// reader, for <name>.agent.md + <name>.instructions.md ONLY.
// Milestone 3: <name>.tools.md is DELETED as a source, on
// purpose. It was a prose contract duplicating the agent file's
// tool list, and it was never a registry source — loadAgentDefinition
// already parsed tool NAMES from agent.md and stored the prose
// only as toolsText. That duplication is confusing and is gone:
// agent.md is the ONLY metadata source for an agent's tools
// (names only, on its "- tools:" line), and each tool's OWN
// documentation/description is its registry spec (name,
// description, input schema from the tool object in src/core),
// which is what the prompt's tools element carries — never prose
// from a tools.md file. Returns null when no agent file exists
// at all: a missing definition is an honest null, never an
// invented agent. The instructions file is text for the agent,
// not a registry tool.
export function loadAgentDefinition(
  name,
  { personalDir = null, defaultsDir = null } = {},
) {
  const readCandidate = (rel) => {
    const candidates = [];
    if (personalDir) {
      candidates.push(join(personalDir, "memory", rel));
    }
    if (defaultsDir) {
      candidates.push(join(defaultsDir, "memory", rel));
    }
    candidates.push(join(process.cwd(), "public/defaults/memory", rel));
    for (const file of candidates) {
      try {
        if (existsSync(file)) {
          return { text: readFileSync(file, "utf8"), source: file };
        }
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  };
  const agentFile = readCandidate(`${name}.agent.md`);
  if (!agentFile) {
    return null;
  }
  const meta = parseAgentFile(agentFile.text);
  const instructions = readCandidate(`${name}.instructions.md`);
  // Deliberately NO readCandidate(`${name}.tools.md`): that file
  // no longer exists as a source (Milestone 3). A tools.md file
  // left in a desk folder is ignored by this reader, never read,
  // never merged into the tool list — agent.md names only.
  return {
    name,
    role: meta.role ?? "",
    goal: meta.goal ?? "",
    tools: (meta.tools ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    keep: meta.keep ?? "run",
    instructions: instructions ? instructions.text.trim() : "",
    instructionsSource: instructions ? instructions.source : null,
    agentFile: agentFile.text,
    source: agentFile.source,
    default: false,
  };
}

// The default (harness/desk) agent, loaded from its curated
// files. A short fallback LABELLED "default" only when the files
// are missing everywhere — it carries no tools and no invented
// instructions, so a missing definition can never silently act
// as a curated one.
export function loadDefaultAgent(opts = {}) {
  return (
    loadAgentDefinition("default", opts) ?? {
      name: "default",
      role: "",
      goal: "",
      tools: [],
      keep: "desk",
      instructions: "",
      instructionsSource: null,
      agentFile: "",
      source: null,
      default: true,
    }
  );
}

export function loadDeveloperAgent(opts = {}) {
  return loadAgentDefinition("developer", opts);
}

export function createHarness(desk, opts = {}) {
  if (!desk) {
    throw new Error("harness needs a desk");
  }
  const kernel = desk.tools ?? desk.coreTools?.tools ?? [];
  const kernelNames = kernel.map((t) => t.name);
  // The harness runs on the ONE engine object: its live state IS
  // engine.state, and its prompts ARE engine.renderPrompt().
  // An explicit opts.live is honoured by building the engine
  // object on that live state, never by keeping a second state.
  const engine = opts.engine ?? createEngineObject(desk, { live: opts.live });
  const live = engine.state;
  const children = createChildrenRegistry();
  const harness = {
    desk,
    engine,
    tools: kernel,
    kernelToolNames: kernelNames,
    live,
    children,
    goalCreateCalls: 0,
    goals: [],
    history: [],
    defaultAgent: loadDefaultAgent({
      personalDir: desk.location ?? null,
      defaultsDir: opts.defaultsDir ?? null,
    }),
    developerDefinition: loadDeveloperAgent({
      personalDir: desk.location ?? null,
      defaultsDir: opts.defaultsDir ?? null,
    }),
  };
  // Owner guidance channel: the engine's channel, shared with
  // the loop. guide(text) is seen once at the next step, then
  // consumed (see loop.js createGuidanceChannel).
  harness.guide = (text) => engine.guide(text);

  // Spawn the developer: tools are the CURATED developer subset
  // from developer.agent.md, intersected with the kernel tools
  // the caller actually holds — a strict subset, never all
  // kernel tools (createAgent refuses an all-tools spawn).
  // The developer also receives the RULES at spawn: its tool
  // subset, lanes, gates (its internal phases), and soul
  // reference — on agent.rules, not in the goal. keep "run" by
  // default. A missing developer definition is refused plainly,
  // never replaced by a generic template skin.
  harness.spawnDeveloper = (goal, { keep = "run" } = {}) => {
    const persona = developerPersona();
    const definition = harness.developerDefinition;
    if (!definition) {
      throw new Error(
        "developer agent definition not found: add memory/developer.agent.md (personal) or public/defaults/memory/developer.agent.md",
      );
    }
    const tools = definition.tools.filter((tool) => kernelNames.includes(tool));
    if (tools.length === 0) {
      throw new Error(
        "developer agent definition names no tools held by the caller",
      );
    }
    const rules = {
      tools,
      lanes: ["**"],
      gates: persona.internalPhases.map((phase) => ({
        id: phase.id,
        duty: phase.duty,
      })),
      soul: "desk soul (memory/soul.md, inherited, never copied)",
    };
    const agent = createAgent(
      {
        name: "developer",
        goal: goal.statement,
        role: definition.role || persona.role,
        tools,
        keep,
        persona: "developer",
      },
      { name: "harness", tools: kernelNames, lanes: ["**"] },
      {
        onReport: (entry) => {
          live.appendHistory(`developer ${entry.channel}: ${entry.text}`);
          harness.history.push(`report from developer: ${entry.text}`);
        },
      },
    );
    agent.rules = rules;
    agent.definition = {
      name: definition.name,
      source: definition.source,
    };
    agent.internalPhases = persona.internalPhases.map((phase) => ({
      ...phase,
    }));
    agent.currentPhase = null;
    agent.goalId = goal.id;
    children.add(agent);
    live.setAgent("developer", {
      name: "developer",
      status: "running",
      goal: goal.id,
      currentPhase: null,
    });
    live.emit("agent:spawn", { agent: "developer", goal: goal.id });
    return agent;
  };

  // Run the developer's OWN loop: plan -> execute -> critique,
  // looping back on critique failure (max 3 attempts). Each
  // internal phase runs through runPhase(), which narrows the
  // registry to that phase's allowedTools — the developer's
  // phases, not the harness's, decide what it may call.
  harness.runDeveloper = async (
    agent,
    goal,
    { inference, maxAttempts = 3 } = {},
  ) => {
    const model =
      inference ?? desk.defaultInference ?? desk.engine?.inference ?? null;
    if (!model || typeof model.infer !== "function") {
      throw new Error(
        "no model configured: pass an inference to harness.ask(), or add a default inference",
      );
    }
    const runState = { modified: [], checksPassed: false };
    const goalRegistry = [...kernel];
    loadGoalArtifact(goalRegistry, goal);
    engine.setGoal(goal);
    const phaseResults = [];
    let attempts = 0;
    let done = false;
    while (!done && attempts < maxAttempts) {
      attempts += 1;
      for (const phase of agent.internalPhases) {
        if (phase.id === "done") {
          continue;
        }
        agent.currentPhase = phase.id;
        live.setAgent("developer", {
          name: "developer",
          status: "running",
          goal: goal.id,
          currentPhase: phase.id,
        });
        engine.recordPhaseTransition({
          goal: goal.id,
          from: phaseResults.at(-1)?.phase ?? null,
          to: phase.id,
        });
        agent.history.push(`internal phase: ${phase.id}`);
        // The phase prompt IS the engine object's rendered
        // elements, in insert order — the same object the UI
        // shows. runPhase appends the phase line (id + duty),
        // and narrows the registry to the phase's allowedTools.
        // Owner guidance travels on the engine's guidance
        // channel: the loop consumes it once, at the next step.
        const prompt = engine.renderPrompt();
        const result = await runPhase(phase, {
          registry: goalRegistry,
          inference: model,
          prompt,
          phase,
          goal: goal.snapshot(),
          live,
          runState,
          requireChecks: false,
          guidance: engine.guidance,
        });
        // The phase's own exit gate, evaluated by the harness from
        // the phase result (the gate lives on the developer's
        // internal phase, not on the goal).
        const gatePassed =
          typeof phase.exitGate === "function" ? phase.exitGate(result) : true;
        phaseResults.push({
          phase: phase.id,
          attempt: attempts,
          result,
          gatePassed,
        });
        if (phase.id === "critique") {
          if (gatePassed && !critiqueFailed(result.answer)) {
            done = true;
          }
          break; // critique ends the attempt: pass -> done, fail -> loop back
        }
      }
    }
    agent.currentPhase = "done";
    live.setAgent("developer", {
      name: "developer",
      status: done ? "done" : "needs-review",
      goal: goal.id,
      currentPhase: "done",
    });
    return { phaseResults, attempts, done, runState };
  };

  // ask(): the harness's whole duty. Translate -> ONE goal.create
  // call (statement only) -> pass to developer -> report back.
  harness.ask = async (request, { inference = null, goalId = "goal" } = {}) => {
    if (typeof request !== "string" || request.trim() === "") {
      throw new Error("harness ask needs an owner request");
    }
    const goalDefault = loadGoalDefault({
      personalDir: desk.location ?? null,
      defaultsDir: opts.defaultsDir ?? null,
    });
    const statement = `${request.trim()}\n\nDefault goal: ${goalDefault.text}`;
    // Exactly one goal.create call, statement only.
    harness.goalCreateCalls += 1;
    const goal = createGoal({ id: goalId, statement });
    harness.goals.push(goal);
    // Owner history, labelled separately from developer reports:
    // "owner request:" here, "report from developer:" on report.
    harness.history.push(`owner request: ${request.trim()}`);
    engine.setRequest(request.trim());
    engine.setGoal(goal);
    engine.runLifecycle(
      { kind: "goal" },
      { step: "create", payload: { goal } },
    );
    const developer = harness.spawnDeveloper(goal);
    const run = await harness.runDeveloper(developer, goal, { inference });
    const lastCritique = [...run.phaseResults]
      .reverse()
      .find((entry) => entry.phase === "critique");
    const reportText = run.done
      ? `Done: ${lastCritique?.result?.answer ?? "developer completed the goal."}`
      : `Needs review after ${run.attempts} attempt(s): critique did not pass.`;
    developer.report(reportText, "report");
    engine.runLifecycle(
      { kind: "goal" },
      { step: "report-back", payload: { goal } },
    );
    if (run.done) {
      goal.setStatus("done");
      engine.runLifecycle(
        { kind: "goal" },
        { step: "complete", payload: { goal } },
      );
    }
    engine.setGoal(goal);
    live.emit("agent:report", { agent: "developer", goal: goal.id });
    return {
      report: reportText,
      goal: goal.snapshot(),
      goalCreateCalls: harness.goalCreateCalls,
      developer: {
        name: developer.name,
        currentPhase: developer.currentPhase,
        internalPhases: developer.internalPhases.map((p) => p.id),
        history: developer.history,
        rules: developer.rules,
        tools: developer.tools,
        definition: developer.definition,
      },
      harnessHistory: [...harness.history],
      run,
    };
  };

  harness.dispatch = harness.ask;
  return harness;
}

// Cold start from a desk folder alone: desk config (soul /
// instructions, when present) + kernel tools + harness. No
// createDesk() required, so a temp folder is a whole desk.
export function createHarnessFromDeskFolder({
  deskDir,
  workspaceDir,
  inference = null,
  defaultsDir = null,
} = {}) {
  if (typeof deskDir !== "string" || deskDir.trim() === "") {
    throw new Error("harness needs a desk folder");
  }
  const resolvedDesk = isAbsolute(deskDir)
    ? deskDir
    : join(process.cwd(), deskDir);
  const resolvedWorkspace = workspaceDir
    ? isAbsolute(workspaceDir)
      ? workspaceDir
      : join(process.cwd(), workspaceDir)
    : resolvedDesk;
  const soulFile = join(resolvedDesk, "memory", "soul.md");
  const soul = existsSync(soulFile) ? readFileSync(soulFile, "utf8") : "";
  const core = createCoreTools({ filesLocation: resolvedWorkspace });
  const desk = {
    location: resolvedDesk,
    soul,
    tools: core.tools,
    coreTools: core,
    listTools: () => core.listTools(),
    inferences: inference ? [inference] : [],
    defaultInference: inference ?? null,
    engine: { instructions: soul, inference: inference ?? null },
  };
  const harness = createHarness(desk, { defaultsDir });
  harness.deskConfig = discoverDesk({
    personalDir: resolvedDesk,
    defaultsDir: defaultsDir ?? "public/defaults",
  });
  return harness;
}
