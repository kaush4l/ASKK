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
// and does NOT choose the executing agent's tools beyond spawn
// lanes (the developer's tools are the kernel tools narrowed by
// the developer's own internal phases, per phase, in the loop).
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
import { renderContext, selectContext } from "./context.js";
import { createCoreTools } from "./core-tools.js";
import { createGoal, loadGoalArtifact } from "./goal-artifact.js";
import { createLiveState } from "./live-state.js";
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

export function createHarness(desk, opts = {}) {
  if (!desk) {
    throw new Error("harness needs a desk");
  }
  const kernel = desk.tools ?? desk.coreTools?.tools ?? [];
  const kernelNames = kernel.map((t) => t.name);
  const live =
    opts.live ??
    createLiveState({ location: desk.location ?? "desk", id: "harness" });
  const children = createChildrenRegistry();
  const harness = {
    desk,
    tools: kernel,
    kernelToolNames: kernelNames,
    live,
    children,
    goalCreateCalls: 0,
    goals: [],
  };

  // Spawn the developer: tools are the kernel tools (the caller's
  // lanes), narrowed per internal phase by the loop — never a
  // harness-chosen tool list for the goal. keep "run" by default.
  harness.spawnDeveloper = (goal, { keep = "run" } = {}) => {
    const persona = developerPersona();
    const agent = createAgent(
      {
        name: "developer",
        goal: goal.statement,
        role: persona.role,
        tools: kernelNames,
        keep,
        persona: "developer",
      },
      { name: "harness", tools: kernelNames, lanes: ["**"] },
      {
        onReport: (entry) => {
          live.appendHistory(`developer ${entry.channel}: ${entry.text}`);
        },
      },
    );
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
        live.recordPhaseTransition({
          goal: goal.id,
          from: phaseResults.at(-1)?.phase ?? null,
          to: phase.id,
        });
        agent.history.push(`internal phase: ${phase.id}`);
        const selection = selectContext(
          {
            soul: desk.soul ?? "",
            tools: goalRegistry.map((t) => ({
              name: t.name,
              description: t.description,
            })),
            goal: goal.snapshot(),
            history: goal.history,
            phase,
          },
          { phase, goal: goal.snapshot() },
        );
        const { prompt } = renderContext(selection);
        const result = await runPhase(phase, {
          registry: goalRegistry,
          inference: model,
          prompt,
          phase,
          goal: goal.snapshot(),
          live,
          runState,
          requireChecks: false,
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
    live.setGoal(goal.id, goal.snapshot());
    const developer = harness.spawnDeveloper(goal);
    const run = await harness.runDeveloper(developer, goal, { inference });
    const lastCritique = [...run.phaseResults]
      .reverse()
      .find((entry) => entry.phase === "critique");
    const reportText = run.done
      ? `Done: ${lastCritique?.result?.answer ?? "developer completed the goal."}`
      : `Needs review after ${run.attempts} attempt(s): critique did not pass.`;
    developer.report(reportText, "report");
    if (run.done) {
      goal.setStatus("done");
    }
    live.setGoal(goal.id, goal.snapshot());
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
      },
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
