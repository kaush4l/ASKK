/**
 * The closed vocabulary of FACTS, and the append-only log that holds them
 * (I8: every transition emits an event; every view is a projection of the log).
 *
 * **A FACT'S SHAPE IS A MIGRATION.** Facts persist as JSON and are replayed at
 * boot; a reader that cannot understand a record must say so rather than drop
 * it. Two things make that survivable and both are structural, not prose:
 *   1. `Event.v` — the envelope version, stamped at append, read at replay.
 *   2. `fact` is a NESTED object, so envelope metadata can never collide with
 *      a payload key, and a new payload key is additive by construction.
 *
 * ELEVEN TYPES, NOT TWELVE. The Rust vocabulary had `ModuleDeactivated` and
 * `ModuleReactivated`, and a measurement of the tree found ZERO construction
 * sites and ZERO readers for either — a closed vocabulary carrying two words
 * nothing could say and nothing could hear. One survives as `module_removed`,
 * because I10 requires an installation be undoable and something must record
 * that it was; the pair that modelled a deactivate/reactivate cycle nobody
 * built does not.
 * @module
 */

/** @typedef {import('./ids.js').EventId} EventId */
/** @typedef {import('./ids.js').Timestamp} Timestamp */
/** @typedef {import('./ids.js').PhaseId} PhaseId */
/** @typedef {import('./status.js').Status} Status */

/** Current envelope version. Bump ONLY with a migration in `core/log`. */
export const EVENT_VERSION = 1

/**
 * @typedef {(
 *   | {type: 'request_handled', path: string, status: number}
 *   | {type: 'user_message', text: string, agent: string, from: string}
 *   | {type: 'module_installed', module: string, version: string}
 *   | {type: 'module_removed', module: string, version: string}
 *   | {type: 'phase_entered', agent: string, phase: PhaseId}
 *   | {type: 'model_called', agent: string, documentHash: string, spentTokens: number, evicted: string[]}
 *   | {type: 'model_replied', agent: string, text: string, reasoning: string}
 *   | {type: 'tool_invoked', agent: string, tool: string, args: string, ok: boolean, output: string}
 *   | {type: 'agent_status', agent: string, status: Status, detail: string}
 *   | {type: 'store_failed', key: string, message: string}
 *   | {type: 'custom', kind: string, payload: unknown}
 * )} Fact
 */

/** @typedef {{id: EventId, seq: number, at: Timestamp, v: number, fact: Fact}} Event */

/** Every fact type, so a reader can refuse an unknown one by name. */
export const FACT_TYPES = /** @type {const} */ ([
  'request_handled', 'user_message', 'module_installed', 'module_removed',
  'phase_entered', 'model_called', 'model_replied', 'tool_invoked',
  'agent_status', 'store_failed', 'custom',
])

/** Whether a value is a fact this build can read. The one gate at replay. */
export function isKnownFact(/** @type {unknown} */ value) {
  if (typeof value !== 'object' || value === null) return false
  const type = /** @type {{type?: unknown}} */ (value).type
  return typeof type === 'string' && /** @type {readonly string[]} */ (FACT_TYPES).includes(type)
}

/**
 * WHICH AGENT a fact belongs to, or '' when it belongs to the system. One
 * definition, because a transcript that guesses this shows one agent's words
 * under another's name.
 */
export function factAgent(/** @type {Fact} */ fact) {
  return 'agent' in fact && typeof fact.agent === 'string' ? fact.agent : ''
}

/**
 * The in-memory append-only log. Appends and iterates; it does NO I/O, so it
 * tests on the host (I3). Persistence rides `StorePort` in `core/log`.
 */
export class EventLog {
  /** @param {Event[]} [events] pre-replayed history, in order */
  constructor(events = []) {
    /** @type {Event[]} */
    this.events = events
  }

  /** Next sequence number, which is also the count of facts. */
  get length() {
    return this.events.length
  }

  /**
   * Append one fact; the log assigns `seq`, `id` and the envelope version.
   * The only mutation permitted — no edit, no delete — which is what makes a
   * view a trustworthy projection.
   * @param {Fact} fact
   * @param {Timestamp} at injected (I7)
   * @returns {Event}
   */
  append(fact, at) {
    const seq = this.events.length
    /** @type {Event} */
    const event = { id: seq, seq, at, v: EVENT_VERSION, fact }
    this.events.push(event)
    return event
  }

  /** The whole history in order. Replay and every projection are this + a fold. */
  *[Symbol.iterator]() {
    yield* this.events
  }

  /** History from `seq` onward, for a projection that already caught up. */
  since(/** @type {number} */ seq) {
    return this.events.slice(seq)
  }

  /** Facts of one type, in order. The projection primitive used everywhere. */
  ofType(/** @type {Fact['type']} */ type) {
    return this.events.filter((e) => e.fact.type === type)
  }
}
