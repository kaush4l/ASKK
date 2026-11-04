// UI data — card and canvas render from the SAME live snapshot.
//
// agentCardData(snapshot) and canvasData(snapshot) are pure data
// functions over a live-state snapshot (live-state.js snapshot()).
// NO hardcoded panels, tools, phases, or agent names: a section /
// node / edge appears ONLY if the corresponding field is present
// in the snapshot, and disappears when it is removed. The JSX
// components (agent-card.jsx, live-canvas.jsx) render exactly
// these data functions, so the no-hardcoding test can run the
// data functions under bun test without a DOM.
//
// Snapshot shape (all fields optional):
//   { id, activity, agents: {name: {name, status, currentPhase}},
//     goals: {id: {id, statement, status}}, calls: [{id, name,
//     status, partial, parallelGroup}], tools: [names|specs],
//     artifact: {open, focus, modified}, phaseTransitions: [...],
//     edges: [{from, to, kind}] }

function asList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return Object.values(value);
  }
  return [];
}

function toolName(tool) {
  return typeof tool === "string" ? tool : (tool?.name ?? "");
}

export function agentCardData(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return { id: null, activity: "idle", sections: [] };
  }
  const sections = [];
  const agents = asList(snapshot.agents);
  if (agents.length > 0) {
    sections.push({
      kind: "agents",
      agents: agents.map((agent) => ({
        name: agent?.name ?? "",
        status: agent?.status ?? agent?.activity ?? "idle",
        ...(agent?.currentPhase ? { currentPhase: agent.currentPhase } : {}),
        ...(agent?.goal ? { goal: agent.goal } : {}),
      })),
    });
  }
  const calls = asList(snapshot.calls);
  if (calls.length > 0) {
    const groups = new Map();
    for (const call of calls) {
      const group = call?.parallelGroup ?? "sequential";
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group).push({
        id: call?.id ?? "",
        name: call?.name ?? "",
        status: call?.status ?? "running",
        partial: Boolean(call?.partial),
        ...(call?.startedAt !== undefined ? { startedAt: call.startedAt } : {}),
        ...(call?.endedAt !== undefined ? { endedAt: call.endedAt } : {}),
      });
    }
    sections.push({
      kind: "calls",
      groups: [...groups.entries()].map(([group, groupCalls]) => ({
        group,
        calls: groupCalls,
      })),
    });
  }
  const goals = asList(snapshot.goals);
  if (goals.length > 0) {
    sections.push({
      kind: "goals",
      goals: goals.map((goal) => ({
        id: goal?.id ?? "",
        statement: goal?.statement ?? "",
        status: goal?.status ?? "open",
      })),
    });
  }
  const phases = asList(snapshot.phases);
  if (phases.length > 0) {
    sections.push({
      kind: "phases",
      phases: phases.map((phase) => ({
        id: phase?.id ?? "",
        duty: phase?.duty ?? "",
        status: phase?.status ?? "",
      })),
    });
  }
  const tools = asList(snapshot.tools).map(toolName).filter(Boolean);
  if (tools.length > 0) {
    sections.push({ kind: "tools", tools });
  }
  if (snapshot.artifact) {
    sections.push({
      kind: "artifact",
      artifact: {
        open: snapshot.artifact.open ?? [],
        focus: snapshot.artifact.focus ?? null,
        modified: snapshot.artifact.modified ?? [],
      },
    });
  }
  return {
    id: snapshot.id ?? null,
    activity: snapshot.activity ?? "idle",
    sections,
  };
}

export function canvasData(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return { nodes: [], edges: [] };
  }
  const nodes = [];
  const edges = [];
  for (const agent of asList(snapshot.agents)) {
    if (!agent?.name) {
      continue;
    }
    nodes.push({ id: `agent:${agent.name}`, kind: "agent", label: agent.name });
    if (agent.spawnedBy) {
      edges.push({
        from: `agent:${agent.spawnedBy}`,
        to: `agent:${agent.name}`,
        kind: "spawn",
      });
    }
    if (agent.goal) {
      edges.push({
        from: `goal:${agent.goal}`,
        to: `agent:${agent.name}`,
        kind: "report",
      });
    }
  }
  for (const goal of asList(snapshot.goals)) {
    if (!goal?.id) {
      continue;
    }
    nodes.push({
      id: `goal:${goal.id}`,
      kind: "goal",
      label: goal.statement ?? goal.id,
    });
  }
  for (const call of asList(snapshot.calls)) {
    if (!call?.id) {
      continue;
    }
    nodes.push({
      id: `call:${call.id}`,
      kind: "tool-call",
      label: call.name ?? call.id,
      status: call.status ?? "running",
    });
  }
  for (const transition of asList(snapshot.phaseTransitions)) {
    if (!transition?.to) {
      continue;
    }
    edges.push({
      from: transition.from
        ? `phase:${transition.from}`
        : `goal:${transition.goal ?? ""}`,
      to: `phase:${transition.to}`,
      kind: "phase-transition",
    });
  }
  for (const edge of asList(snapshot.edges)) {
    if (edge?.from && edge?.to) {
      edges.push({ from: edge.from, to: edge.to, kind: edge.kind ?? "edge" });
    }
  }
  return { nodes, edges };
}

// Live status — the typing-icon status data for the live-agent
// section, derived from the SAME live snapshot the card and the
// canvas render (ui-data rule: a field appears only if it is in
// the snapshot). No hardcoded steps, agents, or tool names: the
// current step is the running call's name, else the working
// agent's current phase, else null. Running calls, partial
// results, and failed calls stay visible in `steps` with their
// stable ids and parallel groups.
export function liveStatusData(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      running: false,
      glyph: "○",
      word: "idle",
      currentStep: null,
      activity: "idle",
      steps: [],
    };
  }
  const calls = asList(snapshot.calls);
  const steps = calls.map((call) => ({
    id: call?.id ?? "",
    name: call?.name ?? "",
    status: call?.status ?? "running",
    partial: Boolean(call?.partial),
    parallelGroup: call?.parallelGroup ?? null,
  }));
  const runningCall = calls.find((call) => call?.status === "running");
  const agents = asList(snapshot.agents);
  const workingAgent = agents.find((agent) =>
    ["running", "working"].includes(agent?.status),
  );
  const activity = snapshot.activity ?? "idle";
  let running = true;
  let word = "working";
  let currentStep = null;
  if (runningCall) {
    word = "tool call";
    currentStep = runningCall.name ?? runningCall.id ?? null;
  } else if (activity === "llm") {
    word = "thinking";
    currentStep = workingAgent?.currentPhase
      ? `phase: ${workingAgent.currentPhase}`
      : null;
  } else if (workingAgent) {
    word = "working";
    currentStep = workingAgent.currentPhase
      ? `phase: ${workingAgent.currentPhase}`
      : (workingAgent.name ?? null);
  } else {
    running = false;
    word = activity === "done" ? "done" : "idle";
  }
  return {
    running,
    glyph: running ? "●" : "○",
    word,
    currentStep,
    activity,
    steps,
  };
}

// Lifecycle twins — the UI view of EVERY element lifecycle
// type, from the one engine object. A state change with no twin
// here is a failure: the lifecycle-twins test iterates the
// lifecycle registry (lifecycles.js) and asserts every type has
// a key in this object. Twins are data-level (the JSX stays
// simple); what matters is that no element state exists only
// in the backend. engine is the engine object
// (engine-object.js): state from engine.snapshot(), element
// strings from engine.elementStrings(), goal snapshots from
// the goal artifact itself (goal.snapshot() deliberately
// excludes snapshots, so the twin reads the artifact).
export function lifecycleTwins(engine) {
  if (!engine || typeof engine.snapshot !== "function") {
    throw new Error("lifecycleTwins needs an engine object");
  }
  const state = engine.snapshot();
  const strings =
    typeof engine.elementStrings === "function" ? engine.elementStrings() : {};
  const goalArtifact = engine.goal ?? null;
  const llmEvents = (state.events ?? []).filter((event) =>
    String(event?.type ?? "").startsWith("llm:"),
  );
  return {
    function: { calls: state.calls ?? [] },
    "live-artifact": {
      artifact: state.artifact ?? null,
      artifactElement: strings.artifact ?? null,
    },
    soul: { text: strings.soul ?? null },
    instructions: { text: strings.instructions ?? null },
    history: { entries: state.history ?? [] },
    goal: {
      goals: state.goals ?? {},
      current: goalArtifact ? goalArtifact.snapshot() : null,
    },
    subagent: { agents: state.agents ?? {} },
    watcher: { watchers: state.watchers ?? [] },
    script: { scripts: state.scripts ?? [] },
    "skill-phase": {
      phases: state.phases ?? [],
      skillPhases: state.skillPhases ?? [],
    },
    "model-call": {
      events: llmEvents,
      modelCalls: state.modelCalls ?? [],
      activity: state.activity ?? "idle",
    },
    snapshot: {
      count: goalArtifact?.snapshots?.length ?? 0,
      latest: goalArtifact?.snapshots?.at(-1)?.why ?? null,
    },
  };
}
