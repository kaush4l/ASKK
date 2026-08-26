/**
 * Flows — the phase graph, as data.
 *
 *     understand ──simple──▶ react ──▶ END
 *          │complex
 *          ▼
 *     select_skills ─▶ plan ─▶ work ─▶ verify ──pass──▶ critique ──done──▶ respond ─▶ END
 *                       ▲               │retry              │retry
 *                       └───────────────┴───────────────────┘
 *                         (rounds exhausted: respond, unresolved findings stated)
 *
 * The Python had this graph too, but it existed nowhere as data: every edge was
 * a bare string literal returned from one of eight `Phase.run` bodies, so the
 * edge set could only be recovered by reading all eight, `flow` was a
 * two-valued string with no third value expressible from configuration, and the
 * entry point was hardcoded. Its architecture doc names that its top finding
 * (F-1); PORT-MAP R2 is the ruling.
 *
 * What changes is only where the edges live. Same phases, same edges, same
 * predicates, same caps — the two flows below produce phase call orders
 * identical to the Python's. A phase now returns an **outcome name** and this
 * table maps `(phase, outcome) -> next phase`; the predicates that pick the
 * outcome stay inside the phase, because they read the session and a session is
 * not something a table can interrogate.
 *
 * The payoff is `validateFlow`. In the Python a mistyped edge was a silent
 * stop: `PHASES.get(current)` returned `None`, a line went to the log, and the
 * run ended forty turns in with no answer. Here every edge is checked before
 * anything runs, and a typo is a load error naming the edge that is wrong.
 *
 * Phase prompt text stays in `core/phase-prompts.js` as module constants (R2):
 * making it configurable is F-1's sixth constraint and is out of scope, because
 * it would change the prompt bytes and the bytes are the oracle.
 */

/**
 * One flow: where to start, and what each outcome of each phase leads to.
 * An edge value of `null` is a declared terminal — the run ends there.
 * @typedef {{ entry: string, edges: Record<string, Record<string, string|null>> }} Flow
 */

/**
 * The phases to validate against. Either the `PHASES` table from `phases.js`
 * — whose values declare `static OUTCOMES = [...]`, the set of outcome names
 * that phase can return — or a bare list of phase names, which checks
 * everything except the outcomes (nothing has told us what they are).
 * @typedef {readonly string[] | Set<string> | Record<string, { OUTCOMES?: readonly string[] }>} PhaseNames
 */

/** A flow that cannot be walked. Raised at load, never mid-run. */
export class FlowError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "FlowError";
  }
}

// A runaway phase graph must end; no legitimate run takes this many transitions.
export const MAX_TRANSITIONS = 64;

/** @type {Record<string, Flow>} */
export const FLOWS = {
  react: { entry: "react", edges: { react: { done: null } } },
  full: {
    entry: "understand",
    edges: {
      understand: { simple: "react", complex: "select_skills" },
      select_skills: { done: "plan" },
      plan: { done: "work" },
      work: { done: "verify" },
      verify: { pass: "critique", retry: "plan", exhausted: "respond" },
      critique: { done: "respond", retry: "plan", exhausted: "respond" },
      respond: { done: null },
      react: { done: null },
    },
  },
};

/**
 * The flow named by an agent.md `flow:` line. A third flow is an entry here,
 * not an edit to the agent.
 * @param {string} name
 * @returns {Flow}
 */
export function getFlow(name) {
  const flow = FLOWS[name];
  if (!flow) {
    throw new FlowError(`Unknown flow '${name}'. Known: ${Object.keys(FLOWS).sort().join(", ")}`);
  }
  return flow;
}

/**
 * What each phase can return, or `null` for a phase that did not say.
 * @param {PhaseNames} phases
 * @returns {Map<string, readonly string[] | null>}
 */
function outcomeTable(phases) {
  /** @type {Map<string, readonly string[] | null>} */
  const table = new Map();
  if (Array.isArray(phases) || phases instanceof Set) {
    for (const name of phases) table.set(name, null);
    return table;
  }
  const declared = /** @type {Record<string, { OUTCOMES?: readonly string[] }>} */ (phases);
  for (const [name, phase] of Object.entries(declared)) {
    const outcomes = phase && phase.OUTCOMES;
    table.set(name, Array.isArray(outcomes) ? outcomes : null);
  }
  return table;
}

/**
 * Every edge of every phase: the target exists and is part of this flow, the
 * outcome is one the phase can actually return, and every outcome it can return
 * has somewhere to go — a phase name or a declared terminal.
 * @param {Flow} flow
 * @param {Map<string, readonly string[] | null>} outcomes
 * @param {string} label
 */
function checkEdges(flow, outcomes, label) {
  const known = [...outcomes.keys()].join(", ");
  for (const [from, table] of Object.entries(flow.edges)) {
    if (!outcomes.has(from)) {
      throw new FlowError(`${label}: edges declared for phase '${from}', which does not exist. Known phases: ${known}`);
    }
    const declared = outcomes.get(from);
    for (const [outcome, to] of Object.entries(table)) {
      const edge = `${from} --${outcome}-->`;
      if (to !== null && typeof to !== "string") {
        throw new FlowError(`${label}: edge ${edge} is neither a phase name nor null. A terminal must be declared as null.`);
      }
      if (to !== null && !outcomes.has(to)) {
        throw new FlowError(`${label}: edge ${edge} '${to}' names a phase that does not exist. Known phases: ${known}`);
      }
      if (to !== null && !Object.hasOwn(flow.edges, to)) {
        throw new FlowError(`${label}: edge ${edge} '${to}' names a phase this flow declares no edges for.`);
      }
      if (declared && !declared.includes(outcome)) {
        throw new FlowError(`${label}: edge ${edge} is declared for an outcome '${from}' never returns. It returns: ${declared.join(", ")}`);
      }
    }
    for (const outcome of declared ?? []) {
      if (!Object.hasOwn(table, outcome)) {
        throw new FlowError(`${label}: phase '${from}' can return '${outcome}' and this flow declares no edge for it.`);
      }
    }
  }
}

/**
 * Every phase in the flow is walkable from the entry. An unreachable phase is
 * dead weight in the prompt path and, far more often, an edge that was meant to
 * point at it and points somewhere else.
 * @param {Flow} flow
 * @param {string} label
 */
function checkReachable(flow, label) {
  const seen = new Set([flow.entry]);
  const queue = [flow.entry];
  for (let i = 0; i < queue.length; i++) {
    for (const to of Object.values(flow.edges[queue[i]] ?? {})) {
      if (typeof to === "string" && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  const orphans = Object.keys(flow.edges).filter((phase) => !seen.has(phase));
  if (orphans.length) {
    const names = orphans.map((phase) => `'${phase}'`).join(", ");
    throw new FlowError(`${label}: phase${orphans.length > 1 ? "s" : ""} ${names} unreachable from entry '${flow.entry}'.`);
  }
}

/**
 * Check a flow against the phases that exist. Called once at load, before any
 * turn runs — that is the whole point: a typo is a load error naming the
 * offending edge, not a stop forty turns in.
 * @param {Flow} flow
 * @param {PhaseNames} phaseNames
 * @param {string} [label] how to name this flow in an error; the loader passes the flow's key
 * @returns {Flow} the same flow, so a caller can validate and assign in one line
 */
export function validateFlow(flow, phaseNames, label = "flow") {
  const outcomes = outcomeTable(phaseNames);
  if (!outcomes.has(flow.entry)) {
    throw new FlowError(`${label}: entry phase '${flow.entry}' does not exist. Known phases: ${[...outcomes.keys()].join(", ")}`);
  }
  if (!Object.hasOwn(flow.edges, flow.entry)) {
    throw new FlowError(`${label}: entry phase '${flow.entry}' has no edges declared.`);
  }
  checkEdges(flow, outcomes, label);
  checkReachable(flow, label);
  return flow;
}
