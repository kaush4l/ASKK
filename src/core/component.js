// Component lifecycle — the completion of the kernel twin.
//
// A component, an object, or an instance should have its UI. A
// LIVE UI. Like a React component lifecycle:
//
//   Component instance = object + INTERNAL LOOP + UI + DOM
//   equivalent, in ONE thing.
//
//   - MOUNT on initialization: creating a component mounts it
//     (twin created -> initialized -> idle, registered in the
//     component registry, signal holds its first snapshot).
//   - UPDATE by SIGNALS as events happen: every loop event
//     (tool call, phase change, spawn, report, artifact state
//     change) updates the component's loop state, emits on its
//     twin, and sets its signal. A React component subscribes
//     to that signal (src/lib/use-live-state.js) and re-renders
//     — no refetch, no poll, no chat window in the middle. The
//     signal's value IS the DOM equivalent's data: snapshot().
//   - UNMOUNT on dismiss: dismissing the object removes its
//     component (registry entry removed, twin dismissed, signal
//     holds the dismissed snapshot). Keep-desk components are
//     the one exception, stated plainly: keep "desk" keeps the
//     twin and the component, it is not dismissed.
//
// The INTERNAL LOOP is the gap this module closes. Before it,
// twins held loopState read from elsewhere (engine-by-name's
// applyLoopEvent) but no twin RAN a loop. Here the component
// runs its loop itself:
//   - runLoop(actions): a deterministic action list — phase,
//     tool call, spawn — executed by the component, each step
//     updating loopState and the signal.
//   - runModelLoop({ registry, inference, prompt, phase, goal }):
//     the REAL loop (loop.js runLoop, TOON by default, mocked
//     inference in tests, real inference in production), with
//     onEvent wired into this component's loopState + twin +
//     signal. The component does not re-implement the loop; it
//     OWNS the loop run, and the loop's events drive its UI.
//
// Core component kinds are engine, tool, artifact — the core
// elements. Watcher and script are ARTIFACT kinds (artifactKind
// "watcher" / "script"), goal is artifact kind "goal". "agent"
// is a DERIVED kind: a spawned subagent's component (an engine
// instance for that agent), not a core base, and it is labelled
// as such wherever it appears. No other kind is a core base.
//
// The component never persists itself: persistence belongs to
// the kernel (personal memory files). On restart, loading the
// kernel state re-creates the kernel object, and re-creating
// its component mounts its UI again.

import { loadEngineByName } from "./engine-by-name.js";
import {
  createTwinFor,
  ENGINE_TWIN_DEFINITION,
  getTwin,
  removeTwin,
} from "./kernel-twin.js";
import { runLoop } from "./loop.js";
import { createSignal } from "./signals.js";
import { deepCopy } from "./snapshot.js";
import { createAgent } from "./spawn.js";
import {
  applyLoopEvent,
  createArtifactTwin,
  createLoopState,
  createToolTwin,
} from "./tool-artifact-twin.js";

export const COMPONENT_KINDS = Object.freeze([
  "engine",
  "tool",
  "artifact",
  "agent",
]);

const components = new Map();

function componentKey(kind, id) {
  return `${kind}:${id}`;
}

function resolveComponentId(kernel) {
  const id = kernel?.id ?? kernel?.name;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("component needs a kernel object with an id or a name");
  }
  return id;
}

// Illegal twin transitions are ignored here (the twin keeps its
// current state), exactly as tool-artifact-twin.js does for tool
// twins: a component must never crash a loop because the twin
// table has no edge for a phase name. Anything else rethrows.
function tryTransition(twin, next) {
  if (!twin || twin.lifecycle === next) {
    return;
  }
  try {
    twin.transitionTo(next);
  } catch (error) {
    if (!/illegal twin transition/.test(error?.message ?? "")) {
      throw error;
    }
  }
}

const PHASE_TWIN_STATES = {
  plan: "planning",
  execute: "executing",
  critique: "critiquing",
  report: "reporting",
};

export function createComponent({
  kind,
  kernel,
  twin = null,
  artifactKind = null,
  keep = null,
} = {}) {
  if (!COMPONENT_KINDS.includes(kind)) {
    throw new Error(
      `unknown component kind ${JSON.stringify(kind)} (expected ${COMPONENT_KINDS.join(" | ")})`,
    );
  }
  if (!kernel || typeof kernel !== "object") {
    throw new Error("createComponent needs a kernel object");
  }
  const id = resolveComponentId(kernel);
  // Engine kernels carry a callable twin (engine-by-name);
  // agent kernels carry agent.twin (spawn.js); artifact kernels
  // carry artifact.twin (goal / artifact twins). If none is
  // attached, the caller must pass one — a component is never
  // built on a twinless kernel, or "no object without a twin"
  // would be a slogan, not a rule.
  const componentTwin = twin ?? kernel.twin ?? null;
  if (!componentTwin || typeof componentTwin.snapshot !== "function") {
    throw new Error(
      `component ${kind}:${id} needs a twin: pass twin, or use createEngineComponent / createToolComponent / createArtifactComponent`,
    );
  }
  const resolvedKeep = keep ?? kernel.keep ?? "run";
  const loopState =
    kernel.loopState && typeof kernel.loopState === "object"
      ? kernel.loopState
      : createLoopState();
  if (!kernel.loopState) {
    kernel.loopState = loopState;
  }

  const component = {
    id,
    kind,
    artifactKind:
      artifactKind ??
      kernel.artifactKind ??
      (kind === "artifact" ? "generic" : null),
    kernel,
    twin: componentTwin,
    keep: resolvedKeep,
    mounted: false,
    children: [],
    loopState,
    calls: [],
  };

  const refreshSignal = () => {
    component.signal.set(component.snapshot());
  };

  component.signal = createSignal(null, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  component.snapshot = () => ({
    id,
    kind,
    artifactKind: component.artifactKind,
    mounted: component.mounted,
    keep: resolvedKeep,
    lifecycle: componentTwin.lifecycle,
    loopState: deepCopy(loopState),
    children: component.children.map((child) => child.snapshot()),
    calls: deepCopy(component.calls),
    twin: componentTwin.snapshot(),
  });

  // Every twin event refreshes the signal: the signal IS the
  // DOM equivalent's data, updated as the event happens.
  componentTwin.subscribe("*", () => refreshSignal());

  component.emit = (event, detail = {}) => {
    if (kernel.applyLoopEvent && typeof kernel.applyLoopEvent === "function") {
      // Engine kernels: applyLoopEvent also emits on the twin,
      // which refreshes the signal via the subscription above.
      kernel.applyLoopEvent(event, detail);
    } else {
      applyLoopEvent(loopState, event, detail);
      componentTwin.emit(event, detail);
    }
    refreshSignal();
    return component;
  };

  component.mount = () => {
    if (component.mounted) {
      return component;
    }
    tryTransition(componentTwin, "initialized");
    tryTransition(componentTwin, "idle");
    component.mounted = true;
    components.set(componentKey(kind, id), component);
    componentTwin.emit("component:mount", { id, kind });
    refreshSignal();
    return component;
  };

  component.dismiss = () => {
    if (resolvedKeep === "desk") {
      // Keep-desk components persist: they are not dismissed,
      // their twin is kept, their UI stays. Stated, not hidden.
      return { removed: false, kept: true, component };
    }
    // Dismiss children first, so no child UI is left behind.
    for (const child of [...component.children]) {
      child.dismiss();
    }
    component.children = [];
    component.mounted = false;
    components.delete(componentKey(kind, id));
    try {
      removeTwin(id, componentTwin.kind);
    } catch {
      // Twin already gone (e.g. children-registry dismiss):
      // unmounting must still complete.
      if (typeof componentTwin.dismiss === "function") {
        try {
          componentTwin.dismiss();
        } catch {
          // Already dismissed — the registry entry is gone.
        }
      }
    }
    componentTwin.emit("component:unmount", { id, kind });
    refreshSignal();
    return { removed: true, kept: false, component };
  };

  component.spawnChild = (agentInput = {}, caller = {}) => {
    const callerTools =
      caller.tools ??
      (Array.isArray(kernel.tools)
        ? kernel.tools.map((tool) => tool?.name ?? tool)
        : []);
    const agent = createAgent(
      agentInput,
      { ...caller, tools: callerTools, name: caller.name ?? kernel.name ?? id },
      {},
    );
    const child = createComponent({
      kind: "agent",
      kernel: agent,
      twin: agent.twin,
      keep: agent.keep ?? "run",
    });
    child.mount();
    component.children.push(child);
    component.emit("agent:spawn", { name: agent.name, agent });
    return child;
  };

  component.dismissChild = (name) => {
    const index = component.children.findIndex((child) => child.id === name);
    if (index === -1) {
      throw new Error(`no child component ${name}`);
    }
    const [child] = component.children.splice(index, 1);
    const result = child.dismiss();
    component.emit("agent:dismiss", { name });
    return result;
  };

  // The internal loop, action by action. Each action updates
  // loopState, emits on the twin, and refreshes the signal, so
  // the UI state changes WITH the loop, not after it.
  component.runLoop = async (actions = []) => {
    if (!Array.isArray(actions)) {
      throw new Error("component runLoop needs an actions list");
    }
    component.mount();
    const results = [];
    for (const action of actions) {
      if (!action || typeof action.type !== "string") {
        throw new Error("component loop action needs a type");
      }
      if (action.type === "phase") {
        const phase = action.phase ?? action.id ?? null;
        component.emit("loop:phase", { phase });
        tryTransition(componentTwin, PHASE_TWIN_STATES[phase] ?? "running");
        results.push({ type: "phase", phase });
        refreshSignal();
        continue;
      }
      if (action.type === "tool") {
        const tool = action.tool;
        const toolName = tool?.name ?? action.name ?? "";
        if (!toolName) {
          throw new Error("component loop tool action needs a tool");
        }
        component.emit("tool:start", { name: toolName });
        const startedAt = Date.now();
        try {
          const result =
            typeof tool.run === "function"
              ? await tool.run(action.input ?? {}, action.ctx)
              : typeof action.run === "function"
                ? await action.run(action.input ?? {})
                : null;
          const record = {
            name: toolName,
            result,
            duration: Date.now() - startedAt,
            error: null,
          };
          component.calls.push(record);
          component.emit("tool:end", { name: toolName, result });
          results.push({ type: "tool", ...record });
        } catch (error) {
          const record = {
            name: toolName,
            result: null,
            duration: Date.now() - startedAt,
            error: error?.message ?? String(error),
          };
          component.calls.push(record);
          component.emit("tool:error", { name: toolName, error: record.error });
          results.push({ type: "tool", ...record });
        }
        refreshSignal();
        continue;
      }
      if (action.type === "spawn") {
        const child = component.spawnChild(
          action.agent ?? {},
          action.caller ?? {},
        );
        results.push({ type: "spawn", name: child.id });
        refreshSignal();
        continue;
      }
      throw new Error(`unknown component loop action type ${action.type}`);
    }
    return results;
  };

  // The REAL loop, owned by the component: loop.js runLoop
  // (TOON by default), with onEvent wired into this component's
  // loopState + twin + signal. The component does not
  // re-implement the loop; it runs it, and the loop's events
  // drive its UI.
  component.runModelLoop = async (opts = {}) => {
    component.mount();
    const result = await runLoop({
      ...opts,
      onEvent: (type, detail) => {
        component.emit(type, detail);
        if (typeof opts.onEvent === "function") {
          opts.onEvent(type, detail);
        }
      },
    });
    refreshSignal();
    return result;
  };

  // Mount on initialization: creating the component mounts it.
  component.mount();
  return component;
}

// Name-only, as step 1 specified: the engine component is
// built from a name alone, through loadEngineByName. No import
// cycle: engine-by-name imports kernel-twin and
// tool-artifact-twin, never component.js.
export function createEngineComponent(name, opts = {}) {
  const engine = loadEngineByName(name, opts);
  return createComponent({ kind: "engine", kernel: engine, twin: engine.twin });
}

// Pass an already-loaded engine (same twin, same kernel) when
// the caller already holds it — e.g. a test that built the
// engine with a temp personal dir.
export function createEngineComponentFromEngine(engine) {
  if (!engine || !engine.twin) {
    throw new Error(
      "createEngineComponentFromEngine needs an engine with a twin",
    );
  }
  return createComponent({ kind: "engine", kernel: engine, twin: engine.twin });
}

export function createToolComponent(tool) {
  if (!tool || typeof tool.name !== "string") {
    throw new Error("createToolComponent needs a tool with a name");
  }
  const twin = createToolTwin(tool);
  return createComponent({ kind: "tool", kernel: tool, twin });
}

export function createArtifactComponent(artifact) {
  if (!artifact || typeof artifact.id !== "string") {
    throw new Error("createArtifactComponent needs an artifact with an id");
  }
  const twin =
    artifact.twin && typeof artifact.twin.snapshot === "function"
      ? artifact.twin
      : createArtifactTwin(artifact);
  return createComponent({
    kind: "artifact",
    kernel: artifact,
    twin,
    artifactKind: artifact.artifactKind ?? null,
  });
}

export function getComponent(id, kind = null) {
  if (kind) {
    return components.get(componentKey(kind, id)) ?? null;
  }
  const matches = [...components.values()].filter((c) => c.id === id);
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw new Error(
      `ambiguous component id "${id}": pass a kind (found ${matches.map((c) => c.kind).join(", ")})`,
    );
  }
  return matches[0];
}

export function listComponents(kind = null) {
  const all = [...components.values()];
  return kind ? all.filter((c) => c.kind === kind) : all;
}

export function hasComponent(id, kind = null) {
  return getComponent(id, kind) !== null;
}

export function clearComponentRegistry() {
  components.clear();
}

export { ENGINE_TWIN_DEFINITION, createTwinFor, getTwin };
