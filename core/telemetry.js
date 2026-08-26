/** What a worker reports that nobody asked for.
 *
 *     serve(scope, { loadAgent, log })      // wires this in
 *     engine.observer = agentObserver(scope)
 *
 * `worker-host.js` already posts two unsolicited messages — `peer`, when the
 * engine calls one, and `state`, for a transition only that side can see. These
 * are the third, and they are here rather than beside them for one reason: that
 * file is one protocol and its own header refuses to be split along its two
 * halves, and it is at the 200-line ceiling. So the wire constants and the
 * observer that writes to them live in their own module, which both halves and
 * the page import.
 *
 * The rule the whole channel rests on: everything crosses as **structured
 * clone**. Plain data only — no class instances, no functions, no transferables
 * (Bun's support is unverified). A breakdown is already plain objects and
 * numbers, which is why it can cross unchanged; that is not an accident of the
 * shape, it is why the assembler returns data rather than components. A session
 * and a `ToolResult` are not: they are class instances, one of them holding
 * loaded `Skill` objects, so this file flattens them on the way out. That
 * flattening is the whole reason the observer contract hands over live objects
 * rather than data — the core says what happened, the wire decides what of it
 * can cross, and neither has to know the other's constraint.
 *
 * `AgentWorker` correlates replies by `id` and drops a message it does not
 * recognise, so three more types on the same port disturb nothing.
 */

/** @typedef {import("./assembler.js").Breakdown} Breakdown */
/** @typedef {import("./session.js").Session} Session */
/** @typedef {import("./tool-call.js").ToolResult} ToolResult */
/** @typedef {{ postMessage(m: unknown): void }} Poster */

/** The envelope: `{ type: TELEMETRY, event, payload }`. */
export const TELEMETRY = "harness:telemetry";

/** The event the prompt inspector renders. */
export const PROMPT_ASSEMBLED = "prompt:assembled";

/** The event the Flow view's live phase, and Converse's activity line, ride on. */
export const PHASE_ENTER = "phase:enter";

/** One batch of tool results, the moment that batch lands. */
export const TOOL_RESULTS = "tool:results";

/** Something that wants to watch a turn from outside and cannot see inside one.
 *
 * Every method takes what the core already has and returns nothing: an observer
 * that could answer would be a collaborator, and the turn would start waiting on
 * it. Every method is optional, so an observer that only wants one of the three
 * is written as one method and nothing in the core changes.
 *
 * `entered` is handed the *live* session, deliberately: the phase that runs next
 * is about to write to it, and an observer that retained it would be reading a
 * later run's blackboard. Read it, flatten it, forget it — which is what
 * `agentObserver` below does.
 *
 * The contract lives here rather than in `agent.js`, which is the only class
 * that calls it, because it grew from one method to three and it belongs beside
 * the observers that implement it. A contract kept next to its single caller
 * drifts the moment there are two.
 *
 * @typedef {{
 *   assembled?(a: Breakdown & { phase: string }): void,
 *   entered?(e: { phase: string, flow: string, maxRounds: number, session: Session }): void,
 *   results?(r: { call: string, results: readonly ToolResult[] }): void,
 * }} Observer
 */

/** The blackboard as plain data — exactly the fields the Flow view reads back,
 * and no more. `messages` is not among them: the transcript already rides home
 * on the `invoke` reply, and putting it here would copy the whole conversation
 * onto the wire once per phase.
 * @param {Session} s @returns {Record<string, any>} */
function sessionFacts(s) {
  return {
    query: s.query,
    enhanced: s.enhanced,
    complexity: s.complexity,
    round: s.round,
    // A loaded Skill is a class instance with methods; the view renders its name.
    skills: s.skills.map((k) => String(/** @type {any} */ (k)?.name ?? k)),
    plan: s.plan.map((p) => ({ description: p.description, status: p.status, notes: p.notes })),
    stepResults: s.stepResults.map((r) => ({ step: r.step, outcome: r.outcome, ok: r.ok })),
    critiques: s.critiques.map((c) => ({ finding: c.finding, severity: c.severity, resolved: c.resolved })),
    verifyReport: s.verifyReport,
  };
}

/**
 * The `Agent` observer that puts a turn on the wire.
 *
 * It is handed the worker's own global rather than reading `self`, the same way
 * `serve` is — a core that reached for a channel out would stop being testable
 * on the host, and this module is imported by both sides.
 *
 * @param {Poster} scope
 * @returns {Required<Observer>}
 */
export function agentObserver(scope) {
  /** @param {string} event @param {unknown} payload */
  const send = (event, payload) => scope.postMessage({ type: TELEMETRY, event, payload });
  return {
    assembled(payload) {
      // Reported before the model is called, never after: the bands appear,
      // then the answer arrives against them.
      send(PROMPT_ASSEMBLED, payload);
    },
    entered({ phase, flow, maxRounds, session }) {
      // The flow name rides along because the page draws the graph from
      // `FLOWS` and cannot otherwise know which of them this agent declared.
      send(PHASE_ENTER, { phase, flow, maxRounds, session: sessionFacts(session) });
    },
    results({ call, results }) {
      // One event per batch, in the order the batches landed. Coalescing them
      // into one at the end of the call would be exactly the fact this reports
      // — that a batch is back — thrown away.
      send(TOOL_RESULTS, {
        call,
        results: results.map((r) => ({ tool: r.tool, ok: r.ok, output: r.output, error: r.error })),
      });
    },
  };
}
