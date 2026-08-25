/**
 * HOW A TURN ENDED, AS A FACT (R17-P0-2) — and, since this rewrite, ON A
 * SIGNAL.
 *
 * A turn used to end by clearing `task`, and every surface then read that hole
 * as success: a run that abandoned a six-part task reported `main finished` with
 * a `Read the reply` button pointing at the model's own malformed tool call. So
 * an ending is a RECORD with a reason, and the card, the row and the
 * conversation are folds of it.
 *
 * WHAT CHANGED IN THE PORT. The Rust decided the reason by ABSENCE — no call
 * could be read out of the text, therefore the model answered — which made a
 * truncated reply, a refusal and a real answer one outcome, and left
 * `reply::malformed_call` guessing at the difference from the shape of the
 * prose. The provider says which of them it was, in one field, and
 * [`endingFor`] is that field read. `malformed_call` is not ported: it patched
 * a missing protocol, and the protocol is here now.
 *
 * EVERY NAME BELOW IS REACHED BY A FOLD IN THIS PACKAGE. `answered`,
 * `truncated`, `refused` and `no calls` are the provider's finish signal read;
 * `round ceiling` is the tool-round guard in `step.js`; `failed` is a driver's
 * effect failure past the retry ceiling; `malformed reply` is a reply the
 * contract could not read; `empty completions` is the zero-output guard in
 * `retry.js`; `interrupted` is the boot that reads a checkpoint.
 *
 * WHAT IS STILL OWED. `pass ceiling`, `goal unmet`, `critic faulted` and
 * `unchecked` each rest on a fold this loop does not compute — passes, the
 * standing goal, the critic's verdict, the verify gate. They arrive with the
 * fold that earns them; naming an ending nothing can reach would be a
 * vocabulary describing a machine that is not here.
 * @module
 */

import { emit } from './effect.js'
import { FINISH_REASONS, idle } from './turn.js'

/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./turn.js').FinishReason} FinishReason */

/** The one ending fact. Payload: `{why, rounds, turnId}`. */
export const ENDED = 'core.ended'

/** The model answered. The turn's cheap exit, and the only ending after which there is a reply to read. */
export const ANSWERED = 'answered'

/** The turn used every round of tool calls its agent file allows. */
export const ROUND_CEILING = 'round ceiling'

/** The reply hit the output ceiling mid-sentence. Its own name because the act is to raise the ceiling or narrow the question, not to read the answer. */
export const TRUNCATED = 'truncated'

/** The model declined to answer. Not a failure of this build, and a person is owed the distinction. */
export const REFUSED = 'refused'

/** The provider failed the completion. The one ending that says nothing about the work. */
export const FAILED = 'failed'

/**
 * The provider said it was calling tools and named none. A contradiction rather
 * than an answer: acting on it as prose is how the predecessor turned every
 * malformed call into `main finished`.
 */
export const NO_CALLS = 'no calls'

/**
 * THE REPLY CARRIED NO ENDING SIGNAL — no calls to run and no `finish` to read
 * — and a reply that says neither is BROKEN rather than pending.
 *
 * It used to be recorded as a dropped fact, which left `awaiting: 'model'` set
 * and the turn waiting for a second reply that answers a call already made. A
 * deadline would have ended it eventually; waiting on a deadline for something
 * already known to be broken spends the person's time to learn nothing, so
 * malformed is an ENDING. The record says which turn and how many rounds it had
 * behind it, like every other ending.
 */
export const MALFORMED = 'malformed reply'

/**
 * TWO CONSECUTIVE ZERO-OUTPUT COMPLETIONS from the same model and the same
 * finish signal. The model is answering deterministically and the answer is
 * nothing, so asking a third time spends the person's money to receive the same
 * silence. Its own name, because the repair is to change the request or the
 * model and never to wait.
 */
export const STALLED = 'empty completions'

/**
 * A RELOAD LANDED IN THE MIDDLE OF THIS TURN and the work outstanding could
 * have changed something, so it was not re-issued. The one ending nothing in
 * the loop decided: it is what a boot says instead of leaving a turn in limbo
 * (`checkpoint.js`).
 */
export const INTERRUPTED = 'interrupted'

/**
 * THE ENDING SPELLED AS A TOOL, for a model with no native call API. Everything
 * such a model "says" is a call, so the answer is one too, and the turn ends
 * because the model SAID to end it rather than because no call could be read
 * out of its prose (Agent Zero's `response` tool, whose handler sets
 * `break_loop`). A model with native calls never needs it and never sees it.
 */
export const RESPOND = 'respond'

/** @type {Record<FinishReason, string>} */
const BY_FINISH = {
  stop: ANSWERED,
  tool_calls: NO_CALLS,
  length: TRUNCATED,
  content_filter: REFUSED,
  refusal: REFUSED,
  error: FAILED,
  // A PROVIDER THAT DID NOT SAY. Not a synonym for `stop`: the reply may be
  // complete, truncated or refused and nothing on the wire distinguishes them,
  // so the turn ends saying it does not know rather than claiming an answer.
  unknown: 'the provider did not say why it stopped',
}

/**
 * Which ending a call-less reply earned, from the signal the provider sent.
 *
 * THE SIGNAL IS A STRING FROM ANOTHER PACKAGE, and `FinishReason` is erased
 * before it gets here: OpenAI sends `content_filter`, Anthropic's whole set
 * (`end_turn`, `max_tokens`, `stop_sequence`, `tool_use`) matches no name
 * below. Indexing blind returned `undefined`, `JSON.stringify` then dropped the
 * `why` key from the ending record, and the turn ended with the log unable to
 * say why — the exact hole this file exists to close (I16). So the signal is
 * checked against the closed set and an unknown one is QUOTED BACK: a person
 * reading the ending sees the word the provider actually sent, which is the
 * only thing that tells them what to add.
 * @param {string} finish @returns {string}
 */
export function endingFor(finish) {
  const known = FINISH_REASONS.find((name) => name === finish)
  if (!known) return `unknown finish signal "${finish}"`
  return BY_FINISH[known]
}

/**
 * END THE TURN, AND SAY WHY. Every arm that ends one comes through here, so
 * what an ending CLEARS is written once and the reason is never optional.
 *
 * `stopping` clears with the rest: a stop ends one turn, not the next.
 * @param {AgentState} state @param {string} why @returns {{state: AgentState, effects: Effect[]}}
 */
export function endTurn(state, why) {
  const effect = emit({
    type: 'custom',
    kind: ENDED,
    payload: { why, rounds: state.toolRounds, turnId: state.turnId },
  })
  return { state: idle(state), effects: [effect] }
}

/**
 * Why the turn ended, out of the payload. An unreadable record says nothing
 * rather than guessing a reason — which is what every log written before this
 * fact existed reads as.
 * @param {unknown} payload @returns {string}
 */
export function endedWhy(payload) {
  const why = read(payload, 'why')
  return typeof why === 'string' ? why : ''
}

/** How many rounds of tool calls it had completed when it ended. @param {unknown} payload @returns {number} */
export function endedRounds(payload) {
  const rounds = read(payload, 'rounds')
  return typeof rounds === 'number' ? rounds : 0
}

/** @param {unknown} payload @param {string} key @returns {unknown} */
function read(payload, key) {
  if (typeof payload !== 'object' || payload === null) return undefined
  return /** @type {Record<string, unknown>} */ (payload)[key]
}
