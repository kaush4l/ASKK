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
