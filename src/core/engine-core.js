// Engine core — the engine's elements and attributes, as data.
//
// This is the SINGLE list of what an engine holds. UI code must
// read this schema (via defineEngineElements) instead of carrying
// its own list of elements, panels, or tools: changing what the
// engine holds changes the rendered dashboard/canvas with no UI
// code change, because the renderer iterates this schema.
//
// The two live engine shapes in this base are both supported:
//   - loadEngineByName(name) — the name-only engine (plain
//     object: name, instructions, tools, liveState, loopState)
//   - createEngineObject(desk) — the live engine object
//     (desk, agent, state/live, tools specs, artifacts, goal,
//     history, skills, elementStrings())
// Each element definition below names its source as the field(s)
// on the engine object where it lives; defineEngineElements
// resolves those fields at call time, so the descriptor always
// describes the engine as it is NOW, never a stored copy.
// An element is LISTED even when the engine does not currently
// hold it (present: false) — listing is the schema, presence is
// the instance. Only REQUIRED elements fail validation when
// absent; the rest are optional and render as empty.
//
// Required elements: agent, instructions, tools, state. An engine
// without a name/agent, without instructions, without a tools
// list, or without live state is not renderable, and
// validateEngine throws plainly instead of letting the UI
// render a partial engine silently.

// One definition per engine element, in dashboard order.
// attributes = the attribute names the element carries.
// source = where on the engine object it lives (prose, kept
// next to the resolver below so the two cannot drift silently
// — a source string that names a field no resolver reads is a
// bug, caught by the tests asserting presence on both shapes).
export const ENGINE_ELEMENTS = Object.freeze([
  {
    id: "agent",
    kind: "agent",
    required: true,
    source: "engine.agent ?? engine.name",
    attributes: ["name", "role", "goal", "keep", "version", "status"],
  },
  {
    id: "instructions",
    kind: "instructions",
    required: true,
    source: "engine.instructions ?? engine.elementStrings().instructions ?? engine.desk.engine.instructions",
    attributes: ["text", "source"],
  },
  {
    id: "tools",
    kind: "tools",
    required: true,
    source: "engine.tools",
    attributes: ["name", "description", "input", "expectation", "type"],
  },
  {
    id: "artifacts",
    kind: "artifact",
    required: false,
    source: "engine.artifacts ?? engine.artifact",
    attributes: ["id", "root", "open", "focus", "modified"],
  },
  {
    id: "goal",
    kind: "goal",
    required: false,
    source: "engine.goal",
    attributes: [
      "id",
      "statement",
      "status",
      "phase",
      "steps",
      "evidence",
      "decisions",
      "openQuestions",
      "report",
    ],
  },
  {
    id: "state",
    kind: "state",
    required: true,
    source: "engine.state ?? engine.live ?? engine.liveState",
    attributes: ["activity", "agents", "goals", "calls", "history", "artifact"],
  },
  {
    id: "history",
    kind: "history",
    required: false,
    source: "engine.history ?? engine.liveState.history ?? engine.state.history",
    attributes: ["entries"],
  },
  {
    id: "skills",
    kind: "skills",
    required: false,
    source: "engine.skills ?? engine.desk.skills",
    attributes: ["id", "duty", "inputs", "outputs", "gate"],
  },
  {
    id: "scripts",
    kind: "scripts",
    required: false,
    source: "engine.scripts ?? engine.desk.scripts",
    attributes: ["name", "trigger", "commands", "notify", "halt"],
  },
  {
    id: "watchers",
    kind: "watchers",
    required: false,
    source: "engine.watchers ?? engine.desk.watchers",
    attributes: ["name", "watch", "event", "notify", "halt"],
  },
  {
    id: "children",
    kind: "subagent",
    required: false,
    source: "engine.children",
    attributes: ["name", "role", "goal", "tools", "status", "currentPhase"],
  },
  {
    id: "activity",
    kind: "activity",
    required: false,
    source: "engine.loopState ?? engine.state.activity ?? engine.liveState",
    attributes: [
      "currentPhase",
      "currentToolCall",
      "subagents",
      "waiting",
      "running",
      "done",
    ],
  },
]);

// --- Resolvers: each reads its element LIVE from the engine. ---

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value.list === "function") {
    try {
      const listed = value.list();
      return Array.isArray(listed) ? listed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function resolveEngineElement(engine, id) {
  if (!engine || typeof engine !== "object") return null;
  switch (id) {
    case "agent": {
      if (engine.agent && typeof engine.agent === "object") return engine.agent;
      if (typeof engine.name === "string" && engine.name !== "") {
        return {
          name: engine.name,
          role: engine.role ?? "",
          goal: engine.goal ?? "",
          keep: engine.keep ?? "",
          version: engine.version ?? "",
          status: engine.status ?? "",
        };
      }
      return null;
    }
    case "instructions": {
      if (typeof engine.instructions === "string" && engine.instructions !== "") {
        return { text: engine.instructions, source: engine.instructionsSource ?? null };
      }
      try {
        const strings =
          typeof engine.elementStrings === "function" ? engine.elementStrings() : null;
        if (typeof strings?.instructions === "string" && strings.instructions !== "") {
          return { text: strings.instructions, source: "engine-object" };
        }
      } catch {
        // Fall through to the desk fallback.
      }
      const deskInstructions = engine.desk?.engine?.instructions ?? engine.desk?.instructions;
      if (typeof deskInstructions === "string" && deskInstructions !== "") {
        return { text: deskInstructions, source: "desk" };
      }
      return null;
    }
    case "tools":
      return asArray(engine.tools);
    case "artifacts": {
      const list = asArray(engine.artifacts);
      if (list) return list;
      return engine.artifact ? [engine.artifact] : null;
    }
    case "goal":
      return engine.goal ?? null;
    case "state":
      return engine.state ?? engine.live ?? engine.liveState ?? null;
    case "history": {
      if (Array.isArray(engine.history)) return engine.history;
      if (engine.liveState && typeof engine.liveState.history !== "undefined") {
        return engine.liveState.history;
      }
      if (engine.state && Array.isArray(engine.state.history)) return engine.state.history;
      return null;
    }
    case "skills":
      return asArray(engine.skills) ?? asArray(engine.desk?.skills);
    case "scripts":
      return asArray(engine.scripts) ?? asArray(engine.desk?.scripts);
    case "watchers":
      return asArray(engine.watchers) ?? asArray(engine.desk?.watchers);
    case "children": {
      const list = asArray(engine.children);
      if (list) return list;
      if (engine.children && typeof engine.children === "object") {
        return Object.values(engine.children);
      }
      return null;
    }
    case "activity": {
      if (engine.loopState && typeof engine.loopState === "object") return engine.loopState;
      if (engine.state && typeof engine.state.activity !== "undefined") {
        return { activity: engine.state.activity };
      }
      return null;
    }
    default:
      return null;
  }
}

function isPresent(id, value) {
  if (value === null || value === undefined) return false;
  switch (id) {
    case "agent":
      return typeof value.name === "string" && value.name !== "";
    case "instructions":
      return typeof value.text === "string" && value.text.trim() !== "";
    case "goal":
      return value !== "";
    case "history":
      return Array.isArray(value) || typeof value === "string";
    default:
      return true;
  }
}

// The engine's elements, as data, in dashboard order. Each entry:
//   { id, kind, attributes, source, present }
// present says whether THIS engine currently holds the element;
// an absent optional element is still listed, so the schema is
// stable across engines and the renderer never needs its own list.
export function defineEngineElements(engine) {
  if (!engine || typeof engine !== "object") {
    throw new Error("defineEngineElements needs an engine object");
  }
  return ENGINE_ELEMENTS.map((definition) => {
    const value = resolveEngineElement(engine, definition.id);
    return {
      id: definition.id,
      kind: definition.kind,
      attributes: [...definition.attributes],
      source: definition.source,
      present: isPresent(definition.id, value),
    };
  });
}

// Throws plainly when a required element/attribute is missing,
// instead of rendering a partial engine silently. An optional
// element that is absent is not an error.
export function validateEngine(engine) {
  if (!engine || typeof engine !== "object") {
    throw new Error("validateEngine needs an engine object");
  }
  for (const definition of ENGINE_ELEMENTS) {
    if (!definition.required) continue;
    const value = resolveEngineElement(engine, definition.id);
    if (!isPresent(definition.id, value)) {
      throw new Error(
        `engine is missing required element "${definition.id}" (${definition.source})`,
      );
    }
  }
  return true;
}
