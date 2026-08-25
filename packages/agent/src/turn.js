/**
 * TURN IDENTITY (I21) — which turn an arriving fact belongs to, and whether
 * that turn is still the one running.
 *
 * THE DEFECT THIS FILE EXISTS TO MAKE UNREPRESENTABLE. `on_tool_result`
 * decremented `pending_tools` with `saturating_sub` and emitted a fresh
 * `call_model` with NO check that a turn was running — while two sites outside
 * the reducer cleared `agent.task` (`core/src/runtime/requests.rs:83`,
 * `core/src/failure/card.rs:129`). A result landing after its turn was
 * abandoned therefore drove the counter to zero and BILLED A MODEL CALL for a
 * conversation nobody was having. The clamp is what hid it: it turned an
 * impossible count into a plausible one.
 *
 * So a fact answering an effect must name a LIVE turn and must be the kind of
 * answer this turn is waiting for. `awaiting` is explicit — `'model'`,
 * `'tools'`, or `null` for idle — because "nothing is outstanding" and "one
 * tool is outstanding" were both `pending_tools == 0` before, and a result
 * arriving against nothing awaited is an ANOMALY the log records, never a new
 * request.
 * @module
 */

import { emit } from './effect.js'

/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('@harness/kernel').ToolId} ToolId */
/** @typedef {import('@harness/kernel').TurnId} TurnId */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./state.js').AgentState} AgentState */

/** What the turn has outstanding. `null` is idle, and it is a value, not a zero. @typedef {'model' | 'tools' | null} Awaiting */

/**
 * WHY THE MODEL STOPPED, as the provider said it — the signal a turn ends on.
 * The predecessor ended by ABSENCE: `parse_reply` returned an empty call list
 * for any prose, so "no call in this text" read as "the model answered", and a
 * truncated reply, a refusal and a real answer were one outcome. That is why a
 * hand-rolled `malformed_call` heuristic existed, and it is not ported.
 * @typedef {'stop' | 'tool_calls' | 'length' | 'refusal' | 'error'} FinishReason
 */

/** @type {readonly FinishReason[]} */
export const FINISH_REASONS = /** @type {const} */ (['stop', 'tool_calls', 'length', 'refusal', 'error'])

/** One native tool call, already parsed by the model port — `id` is the provider's, and it is what a result correlates by. @typedef {{id: string, tool: ToolId, args: string}} ToolCall */

/**
 * The parts of a reply the kernel's `model_replied` fact cannot hold: the
 * native calls, and the reason it stopped. A `ModelReply` from `ports.js` is
 * this shape plus its text and usage.
 * @typedef {{calls: ToolCall[], finish: FinishReason}} Reply
 */

/**
 * WHAT THE DRIVER HANDS THE REDUCER: one fact, the turn it was produced under,
 * and — for a model reply — the signal it ended on.
 *
 * The turn rides the ENVELOPE rather than the fact because `Fact` is the
 * kernel's closed vocabulary and this lane does not own it. **Filed as a
 * cross-lane request:** `model_replied` and `tool_invoked` need a `turnId`, and
 * `model_replied` needs its `finish`, or a REPLAY cannot reproduce the drops
 * this file makes live — a fact whose turn is unknown on the way back through
 * the log is a fact the reducer must guess about, which is exactly what I18
 * forbids.
 * `callId` is the other half of the same argument, one level down: a tool
 * result answers ONE call and the kernel's `tool_invoked` has no id field, so
 * the driver names the call it ran. Without it, three results from one round
 * could only be matched by tool name or by arrival order, and both are wrong
 * exactly when the round is interesting.
 * @typedef {{at: Timestamp, turnId: TurnId | null, callId?: string, fact: Fact, reply?: Reply}} Incoming
 */

/** The record of a fact the reducer refused to act on. Its payload says which turn, what was awaited, and why. */
export const DROPPED = 'agent.dropped'

/**
 * WHAT MUST BE OUTSTANDING for this fact to be an answer, or `null` where the
 * fact is nobody's answer — a person's message and a person's Stop arrive
 * unbidden, and demanding a live turn for those would refuse the one fact that
 * STARTS one.
 * @param {Fact} fact @returns {Awaiting}
 */
export function expects(fact) {
  if (fact.type === 'model_replied') return 'model'
  if (fact.type === 'tool_invoked') return 'tools'
  return null
}

/**
 * Why this fact cannot be acted on, in one sentence, or `''` where it can.
 * The last two are the clamp's replacement, and they are a LOOKUP: a result
 * naming no live call would have driven `pending_tools` negative, and a second
 * result for a call already answered would have driven the count down twice for
 * one question. `saturating_sub` turned both into a plausible zero.
 * @param {AgentState} state @param {Incoming} incoming @returns {string}
 */
export function refusal(state, incoming) {
  const want = expects(incoming.fact)
  if (!want) return ''
  if (state.turnId === '') return 'no turn is running'
  if (incoming.turnId !== state.turnId) return `it belongs to turn ${incoming.turnId ?? '(none)'}, and ${state.turnId} is the one running`
  if (state.awaiting !== want) return `this turn awaits ${state.awaiting ?? 'nothing'}, not ${want}`
  if (want !== 'tools') return ''
  const asked = state.batch.find((call) => call.id === incoming.callId)
  if (!asked) return `no call with id ${incoming.callId ?? '(none)'} is outstanding`
  return asked.done ? `the call ${asked.id} already has its result` : ''
}

/**
 * WHAT AN ENDING CLEARS, written once — because it is cleared from two places
 * that must not disagree: the turn ending on its own, and the turn a person
 * stopped. A turn's counters, its observations and the two flags a person can
 * set are all TURN-SCOPED; evidence about a turn that is over says nothing
 * about the one starting.
 * @param {AgentState} state @returns {AgentState}
 */
export function idle(state) {
  return {
    ...state,
    task: null, turnId: '', awaiting: null,
    batch: [], toolRounds: 0, observations: [],
    steered: false, stopping: false,
  }
}

/**
 * The anomaly, as a fact (I8, I16). It carries the whole of what was refused so
 * a person reading the log can tell a late result from a duplicate one, and it
 * is the ONLY thing a refused fact produces — never a model call.
 * @param {AgentState} state @param {Incoming} incoming @param {string} why @returns {Effect}
 */
export function dropped(state, incoming, why) {
  return emit({
    type: 'custom',
    kind: DROPPED,
    payload: {
      fact: incoming.fact.type,
      turnId: incoming.turnId,
      callId: incoming.callId ?? '',
      running: state.turnId,
      awaiting: state.awaiting,
      why,
    },
  })
}
