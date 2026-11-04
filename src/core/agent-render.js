// Agent render — send the agent to the screen, dynamically.
//
// renderAgentForScreen(agentOrEngine) returns the render tree
// the dashboard + canvas UI renders:
//
//   { dashboard: [...], canvas: [...] }
//
// dashboard = the agent's elements, from defineEngineElements
// (engine-core.js), in engine order. canvas = the agent's
// children + artifacts + goal.
//
// NOTHING here is a hardcoded list of tools, elements, or
// panels: every entry comes from iterating what the agent
// HOLDS (its tools array, its artifacts array, its children,
// its goal, its state) through the engine-core schema. The same
// function on a different agent renders a different tree, with
// no change to this code — that is the no-hardcode proof, and
// the tests assert it.
//
// snapshot is read LIVE at call time from the held object (a
// tool's spec(), an artifact's state(), a child's current
// fields, the loop state's current phase). It is a fresh read
// on every call, never a stored copy: mutate the live object
// and the next render shows the mutation, with no re-creation
// and no separate copy. (The snapshot object itself is plain
// data for transport — the live object is never handed to the
// UI by reference.)

import { defineEngineElements, resolveEngineElement } from "./engine-core.js";

function plainFields(value) {
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "function") out[key] = entry;
  }
  return out;
}

function toolSnapshot(tool) {
  if (typeof tool === "string") return { name: tool };
  if (tool && typeof tool.spec === "function") {
    try {
      return tool.spec();
    } catch {
      return { name: tool.name ?? "" };
    }
  }
  if (tool && typeof tool === "object") {
    return {
      name: tool.name ?? "",
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      ...(tool.expectation !== undefined ? { expectation: tool.expectation } : {}),
      ...(tool.type !== undefined ? { type: tool.type } : {}),
      ...(tool.input !== undefined ? { input: tool.input } : {}),
    };
  }
  return { name: String(tool ?? "") };
}

function toolId(tool) {
  if (typeof tool === "string") return tool;
  return tool?.name ?? "";
}

function artifactSnapshot(artifact) {
  if (artifact && typeof artifact.state === "function") {
    try {
      return artifact.state();
    } catch {
      // Fall through to the twin.
    }
  }
  if (artifact && typeof artifact.twin === "function") {
    try {
      return artifact.twin();
    } catch {
      // Fall through to plain fields.
    }
  }
  return plainFields(artifact);
}

function artifactId(artifact) {
  if (typeof artifact === "string") return artifact;
  return artifact?.id ?? artifactSnapshot(artifact)?.id ?? "artifact";
}

function childSnapshot(child) {
  if (!child || typeof child !== "object") return { name: String(child ?? "") };
  const tools = Array.isArray(child.tools)
    ? child.tools.map(toolId)
    : (child.tools ?? null);
  return {
    name: child.name ?? child.id ?? "",
    ...(child.role !== undefined ? { role: child.role } : {}),
    ...(child.goal !== undefined
      ? { goal: typeof child.goal === "string" ? child.goal : child.goal?.statement ?? "" }
      : {}),
    ...(tools !== null ? { tools } : {}),
    ...(child.status !== undefined ? { status: child.status } : {}),
    ...(child.currentPhase !== undefined ? { currentPhase: child.currentPhase } : {}),
    ...(Array.isArray(child.history) ? { historyLength: child.history.length } : {}),
  };
}

function childId(child) {
  if (typeof child === "string") return child;
  return child?.name ?? child?.id ?? "child";
}

function goalSnapshot(goal) {
  if (typeof goal === "string") return { statement: goal };
  if (goal && typeof goal.snapshot === "function") {
    try {
      return goal.snapshot();
    } catch {
      return plainFields(goal);
    }
  }
  return plainFields(goal);
}

// Dashboard snapshot for one element, read live from the engine.
// Tools, artifacts, children and goal get shaped entries; every
// other element gets its held value's live fields, generically.
function dashboardSnapshot(element, engine) {
  const value = resolveEngineElement(engine, element.id);
  if (value === null || value === undefined) {
    return { present: false };
  }
  switch (element.id) {
    case "agent":
      return plainFields(value);
    case "instructions": {
      const text = typeof value.text === "string" ? value.text : "";
      const firstLine = text.split(/\r?\n/)[0] ?? "";
      return {
        length: text.length,
        source: value.source ?? null,
        preview: firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine,
      };
    }
    case "tools":
      return { count: value.length, tools: value.map(toolSnapshot) };
    case "artifacts":
      return { count: value.length, artifacts: value.map(artifactSnapshot) };
    case "goal":
      return goalSnapshot(value);
    case "state": {
      if (value && typeof value.snapshot === "function") {
        try {
          return value.snapshot();
        } catch {
          return plainFields(value);
        }
      }
      return plainFields(value);
    }
    case "history": {
      if (Array.isArray(value)) {
        return { count: value.length, last: value.at(-1) ?? null };
      }
      if (typeof value === "string") {
        return { length: value.length, present: value !== "" };
      }
      return plainFields(value);
    }
    case "skills":
    case "scripts":
    case "watchers":
      return {
        count: value.length,
        items: value.map((item) =>
          typeof item === "string" ? item : (item?.name ?? item?.id ?? plainFields(item)),
        ),
      };
    case "children":
      return { count: value.length, children: value.map(childSnapshot) };
    case "activity":
      return plainFields(value);
    default:
      return plainFields(value);
  }
}

export function renderAgentForScreen(agentOrEngine) {
  if (!agentOrEngine || typeof agentOrEngine !== "object") {
    throw new Error("renderAgentForScreen needs an agent or engine object");
  }
  const elements = defineEngineElements(agentOrEngine);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const dashboard = elements.map((element) => ({
    id: element.id,
    kind: element.kind,
    attributes: element.attributes,
    snapshot: dashboardSnapshot(element, agentOrEngine),
  }));

  const canvas = [];
  const children = resolveEngineElement(agentOrEngine, "children") ?? [];
  for (const child of children) {
    canvas.push({
      id: childId(child),
      kind: byId.get("children")?.kind ?? "subagent",
      attributes: byId.get("children")?.attributes ?? [],
      snapshot: childSnapshot(child),
    });
  }
  const artifacts = resolveEngineElement(agentOrEngine, "artifacts") ?? [];
  for (const artifact of artifacts) {
    canvas.push({
      id: artifactId(artifact),
      kind: byId.get("artifacts")?.kind ?? "artifact",
      attributes: byId.get("artifacts")?.attributes ?? [],
      snapshot: artifactSnapshot(artifact),
    });
  }
  const goal = resolveEngineElement(agentOrEngine, "goal");
  if (goal !== null && goal !== undefined && goal !== "") {
    canvas.push({
      id: "goal",
      kind: byId.get("goal")?.kind ?? "goal",
      attributes: byId.get("goal")?.attributes ?? [],
      snapshot: goalSnapshot(goal),
    });
  }
  return { dashboard, canvas };
}
