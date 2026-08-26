/** What a worker reports, and how much of it is kept.
 *
 * The vocabulary of the worker telemetry port, on the reading side. It is
 * separate from `app/runtime.js` because it is a contract rather than
 * behaviour: the names below are agreed with `core/telemetry.js`, and the
 * runtime is only the thing that happens to forward them.
 */

import { TELEMETRY } from "../core/telemetry.js";

/** The message type a worker uses to report what only it can see, declared in
 * `core/telemetry.js` beside the observers that write it so both ends name it once.
 * `AgentWorker` correlates replies by `id` and drops a message it does not
 * recognise, so an extra type on the same port disturbs nothing. The worker
 * entry posts `{ type: TELEMETRY, event, payload }`, and only the three events
 * below are forwarded: a worker may report what it saw, never announce a turn
 * that this side is the one to know about. */
export { TELEMETRY };

/** @type {readonly string[]} */ export const WORKER_EVENTS = Object.freeze(["phase:enter", "prompt:assembled", "tool:results"]);

/** `prompt:assembled` — one entry per component that survived `applies()`, in
 * the order the assembler joined them. `memo` is whether this render came back
 * from the cache; `cacheable` is `false` for CONTEXT, which opts out because a
 * cached clock is a wrong clock. `hits` and `misses` are the assembler's own
 * running totals, carried whole rather than recounted.
 * @typedef {{ slot: number, name: string, key: string, bytes: number, memo: boolean, cacheable: boolean }} Band
 * @typedef {{ agent: string, phase: string, bytes: number, bands: Band[], hits: number, misses: number }} Assembled */

/** How much of a run is kept for a view that mounts after it, and why a replay
 * is asked for rather than given.
 *
 * A run is bounded by `turn:start`, and each one drops what the last one left.
 * Retaining since boot is a leak; the transcript already holds the conversation,
 * so what is kept is only what the *worker* reported — the part this thread
 * cannot recompute. Past the cap the oldest goes, which costs a late mount the
 * opening phases of a loop no bounded run reaches. And the replay is opt-in
 * because `converse.js` subscribes to these same events to narrate a run *as it
 * happens*: replaying into it would leave a finished turn showing a mid-run
 * activity line in place of its answer. */
export const RETAINED = 200;
