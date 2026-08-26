/** What a worker reports that nobody asked for.
 *
 *     serve(scope, { loadAgent, log })      // wires this in
 *     engine.observer = assemblyObserver(scope)
 *
 * `worker-host.js` already posts two unsolicited messages — `peer`, when the
 * engine calls one, and `state`, for a transition only that side can see. This
 * is the third, and it is here rather than beside them for one reason: that file
 * is one protocol and its own header refuses to be split along its two halves,
 * and it is at the 200-line ceiling. So the wire constant and the observers that
 * write to it live in their own module, which both halves and the page import.
 *
 * The rule the whole channel rests on: everything crosses as **structured
 * clone**. Plain data only — no class instances, no functions, no transferables
 * (Bun's support is unverified). A breakdown is already plain objects and
 * numbers, which is why it can cross unchanged; that is not an accident of the
 * shape, it is why the assembler returns data rather than components.
 *
 * `AgentWorker` correlates replies by `id` and drops a message it does not
 * recognise, so a third type on the same port disturbs nothing.
 */

/** @typedef {import("./assembler.js").Breakdown} Breakdown */
/** @typedef {{ postMessage(m: unknown): void }} Poster */

/** The envelope: `{ type: TELEMETRY, event, payload }`. */
export const TELEMETRY = "harness:telemetry";

/** The event the prompt inspector renders. */
export const PROMPT_ASSEMBLED = "prompt:assembled";

/**
 * The `Agent` observer that puts one assembled prompt on the wire.
 *
 * It is handed the worker's own global rather than reading `self`, the same way
 * `serve` is — a core that reached for a channel out would stop being testable
 * on the host, and this module is imported by both sides.
 *
 * @param {Poster} scope
 * @returns {{ assembled(payload: Breakdown & { phase: string }): void }}
 */
export function assemblyObserver(scope) {
  return {
    assembled(payload) {
      scope.postMessage({ type: TELEMETRY, event: PROMPT_ASSEMBLED, payload });
    },
  };
}
