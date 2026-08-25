/**
 * A FAILED EFFECT IS A FACT THE REDUCER SEES, and the retry that follows is a
 * decision the reducer makes.
 *
 * THE DEFECT. `step.rs:80-82` ended in a catch-all `_ => (state, Vec::new())`,
 * so `core.error` arrived, matched nothing, and the turn sat awaiting a model
 * that had already failed. The loop could not decide ANYTHING about a failure:
 * not to retry it, not to end on it, not to say it happened. A typed fact the
 * reducer must handle is the whole repair.
 *
 * THE BACKOFF IS A NUMBER ON THE EFFECT, NOT A SLEEP. `step` is pure and holds
 * no clock (I7), so it says how long to wait and the driver waits. A retry that
 * blocked here would put time inside the one function whose whole claim is that
 * it has none.
 *
 * THE DETERMINISM GUARD. Retrying a model that is answering deterministically
 * spends money to receive the same nothing again, so two consecutive zero-output
 * completions from the same `(model, finish)` stop the retry immediately. It is
 * the same pair twice that decides — a different finish signal is a different
 * failure, and a different model is a different question.
 * @module
 */

/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('./turn.js').Awaiting} Awaiting */

/** An effect could not be run. Payload: `{effect, reason}` — the driver says WHICH of its own attempts failed and what it read, because "something failed" is a sentence nobody can act on. The failing call is named by the envelope, as a tool result names it. */
export const EFFECT_FAILED = 'core.effect_failed'

/**
 * @typedef {{effect: 'CallModel' | 'InvokeTool', reason: string}} Failure
 *
 * WHICH CALL FAILED IS THE envelope's `callId` and is not repeated here. A tool
 * failure and a tool result answer the same outstanding call, and the reducer
 * checks that call the same way for both; a second spelling in the payload
 * would be a second thing to keep in step, and the two would differ once.
 */

/**
 * The failure this fact reports, or `null` where it is not one.
 *
 * A payload naming an effect variant this loop never queues reads as NOT a
 * failure rather than as a failure of an unknown kind: the reducer would have
 * nothing to drain and nothing to retry, and acting on it would end a live turn
 * on a record about something else.
 * @param {Fact} fact @returns {Failure | null}
 */
export function failureIn(fact) {
  if (fact.type !== 'custom' || fact.kind !== EFFECT_FAILED) return null
  const payload = /** @type {Record<string, unknown>} */ (fact.payload ?? {})
  const effect = payload['effect']
  if (effect !== 'CallModel' && effect !== 'InvokeTool') return null
  const reason = payload['reason']
  return {
    effect,
    reason: typeof reason === 'string' && reason.trim() !== '' ? reason : 'the driver did not say why',
  }
}

/** What must be outstanding for this failure to be an answer — so a failure from an abandoned turn is dropped like any other late fact (I21). @param {Failure} failure @returns {Awaiting} */
export function awaitedBy(failure) {
  return failure.effect === 'CallModel' ? 'model' : 'tools'
}

/**
 * HOW MANY MODEL CALLS ONE TURN IS WORTH, counting the first: the call, then
 * two more after it fails. A transient 502 and a rate limit both clear inside
 * two, and a fourth attempt against something structurally broken only delays
 * the sentence the person needs to read.
 *
 * IT IS THE COUNT AND NOT THE RETRIES, and the code read it the other way —
 * `attempts > MAX_ATTEMPTS` made the fourth call this sentence exists to
 * refuse. The comment was right and the comparison moved; `step.js` now stops
 * at `attempts >= MAX_ATTEMPTS`, which is three calls for a dead endpoint
 * rather than four. Both empty-completion and failed-effect arms count on the
 * same field, so one turn is three calls whichever way it is failing.
 */
export const MAX_ATTEMPTS = 3

/** Doubling from half a second: the second call waits 500ms and the third a full second, so a rate limit has a gap to clear in rather than being asked again from behind. @param {number} attempt  how many have already failed @returns {number} */
export function backoffMs(attempt) {
  return 500 * 2 ** Math.max(0, attempt - 1)
}

/**
 * WHAT MAKES TWO EMPTY COMPLETIONS THE SAME EMPTY COMPLETION. The pair the
 * guard compares, as one string so the state holds one field rather than two
 * that can be updated apart.
 * @param {string} model @param {string} finish @returns {string}
 */
export function emptySignature(model, finish) {
  return `${model}|${finish}`
}

/**
 * A ZERO-OUTPUT COMPLETION: the model called nothing and said nothing. Not an
 * answer — an answer of no words is what a provider returns when a request was
 * malformed, a filter fired without saying so, or the sampler produced the stop
 * token first. Ending on it as though the model had replied is how a turn
 * reports success having produced nothing at all.
 * @param {string} text @param {number} calls @returns {boolean}
 */
export function isEmptyCompletion(text, calls) {
  return calls === 0 && text.trim() === ''
}
