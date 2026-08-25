/**
 * THE PURE STEP FUNCTION — the wall between thinking and doing, and the ONLY
 * writer of an `AgentState`.
 *
 * It takes the state and one arriving fact and returns a NEW state plus the
 * effects it wants run; it cannot do I/O, so every claim about the loop is a
 * claim about a returned array and tests on the host (I3, I7). The predecessor
 * had this shape too and then broke it from outside — two sites cleared
 * `agent.task` without going through a transition, which is how a result could
 * arrive against a turn the reducer still believed was running. One door.
 *
 * THE ORDER OF THE THREE THINGS THIS DOES. Refuse what does not belong to the
 * live turn (I21) — then act — then honour a pressed Stop at the single
 * boundary every arm returns through.
 * @module
 */

import { nextCall } from './ask.js'
import { callsIn } from './calls.js'
import { ANSWERED, FAILED, MALFORMED, ROUND_CEILING, RESPOND, STALLED, endTurn, endingFor } from './ending.js'
import { complete, land, lines, openBatch } from './round.js'
import { MAX_ATTEMPTS, emptySignature, failureIn, isEmptyCompletion } from './retry.js'
import { boundary, isStopRequest } from './stop.js'
import { carried } from './steer.js'
import { dropped, refusal } from './turn.js'

/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./retry.js').Failure} Failure */
/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./turn.js').Incoming} Incoming */

/** A state and the effects it wants run — what every transition returns. @typedef {{state: AgentState, effects: Effect[]}} Stepped */

/**
 * The frozen signature. Owns ALL transitions.
 * @param {AgentState} state a snapshot; it is never written to
 * @param {Incoming} incoming one fact, and the turn it was produced under
 * @returns {Stepped}
 */
export function step(state, incoming) {
  const why = refusal(state, incoming)
  if (why) return { state, effects: [dropped(state, incoming, why)] }
  const taken = advance(state, incoming)
  return boundary(taken.state, taken.effects)
}

/**
 * THE EXIT TABLE — one line per fact the agent can be handed, so this reads as
 * the list of things that can happen to a turn. Everything with a reason to
 * give is a function below.
 * @param {AgentState} state @param {Incoming} incoming @returns {Stepped}
 */
function advance(state, incoming) {
  const fact = incoming.fact
  // Stop pressed: recorded, NOTHING emitted. An idle agent is already stopped.
  if (isStopRequest(fact)) return { state: { ...state, stopping: state.task !== null }, effects: [] }
  if (fact.type === 'user_message' && state.turnId !== '') return onSteer(state)
  if (fact.type === 'user_message') return onTask(state, fact.text, incoming)
  if (fact.type === 'model_replied') return onReply(state, incoming)
  if (fact.type === 'tool_invoked') return onToolResult(state, incoming, fact)
  const failed = failureIn(fact)
  if (failed) return onEffectFailed(state, incoming, failed)
  // Facts observed but not acted on: quiescence, not effects.
  return { state, effects: [] }
}

/**
 * A user utterance DURING a turn is steering. The sentence is appended to the
 * log by the driver and NO work is emitted: the round already running finishes,
 * and the next model call assembles a paper with the interjection in it. The
 * naive reading — reset the counters and call the model — asks the model twice
 * at once and then counts the batch in flight down through a fresh counter.
 * @param {AgentState} state @returns {Stepped}
 */
function onSteer(state) {
  return { state: { ...state, steered: true }, effects: [carried()] }
}

/**
 * A user utterance starts the turn. Everything a turn counts is reset,
 * `stopping` included — a stop ends one turn, not the next.
 *
 * A MESSAGE WITH NO TURN ID IS AN ANOMALY, not an occasion to mint one: ids are
 * injected (I7), the spine mints one per accepted message, and a turn that
 * named itself would be a turn no effect could be matched against.
 * @param {AgentState} state @param {string} text @param {Incoming} incoming @returns {Stepped}
 */
function onTask(state, text, incoming) {
  if (!incoming.turnId) {
    return { state, effects: [dropped(state, incoming, 'it arrived with no turn to run it under')] }
  }
  /** @type {AgentState} */
  const turn = {
    ...state,
    task: text, turnId: incoming.turnId, awaiting: 'model',
    batch: [], toolRounds: 0, observations: [], steered: false, stopping: false,
  }
  return nextCall(turn, incoming.at)
}

/**
 * ONE REPLY, READ AS A SIGNAL. Calls are work; no calls is an ending, and WHICH
 * ending is the provider's `finish` — never the shape of the prose.
 *
 * A REPLY WITH NO SIGNAL AT ALL IS MALFORMED, AND MALFORMED IS AN ENDING. It
 * was a dropped fact, which left the turn awaiting a model that had already
 * answered; the ruling is that waiting on a deadline for something already
 * known to be broken spends the person's time to learn nothing.
 *
 * CALLS BEAT THE SIGNAL where a provider sends both `stop` and a call — the
 * model asked for work. A reply carrying either CLEARS `lastEmpty`, so `onEmpty`
 * counts consecutive silences and not every silence this turn has ever seen.
 * @param {AgentState} state @param {Incoming} incoming @returns {Stepped}
 */
function onReply(state, incoming) {
  const reply = incoming.reply
  if (!reply) return endTurn(state, MALFORMED)
  const calls = callsIn(state, incoming, reply)
  const said = incoming.fact.type === 'model_replied' ? incoming.fact.text : ''
  if (isEmptyCompletion(said, calls.length)) return onEmpty(state, incoming, reply.finish)
  if (calls.length === 0) return endTurn(state, endingFor(reply.finish))
  if (calls.some((call) => call.tool === RESPOND)) return endTurn(state, ANSWERED)
  const opened = openBatch({ ...state, lastEmpty: '' }, calls)
  // Every call refused is a round already over: nothing was invoked, so no
  // result will arrive to close it, and the model is asked again NOW with the
  // refusals in front of it. That is the one extra round a malformed call costs.
  return complete(opened.state) ? settle(opened.state, opened.effects, incoming.at) : opened
}

/**
 * ONE TOOL RESULT, FILED AGAINST THE CALL IT ANSWERS. The round is not done
 * until every call has one, and only then does the model see them — that is
 * what makes one round of calls one observation.
 * @param {AgentState} state @param {Incoming} incoming @param {{tool: string, ok: boolean, output: string}} result @returns {Stepped}
 */
function onToolResult(state, incoming, result) {
  const seen = land(state, incoming.callId ?? '', result.ok, result.output)
  return complete(seen) ? settle(seen, [], incoming.at) : { state: seen, effects: [] }
}

/**
 * THE ROUND IS OVER: the results become the observations the next call carries,
 * in the order the model WROTE the calls, and the counter that terminates a
 * looping model ticks once.
 *
 * `before` is whatever the round already produced — the records of the calls
 * this build refused — and it is carried rather than replaced, because a
 * refusal nobody can read in the log is a round nobody can account for.
 * @param {AgentState} state @param {Effect[]} before @param {Timestamp} at @returns {Stepped}
 */
function settle(state, before, at) {
  const round = { ...state, observations: lines(state), toolRounds: state.toolRounds + 1 }
  if (round.toolRounds >= round.maxRounds) {
    const ended = endTurn(round, ROUND_CEILING)
    return { state: ended.state, effects: [...before, ...ended.effects] }
  }
  /** @type {AgentState} */
  const asking = { ...round, awaiting: 'model', steered: false }
  const next = nextCall(asking, at)
  return { state: next.state, effects: [...before, ...next.effects] }
}

/**
 * A ZERO-OUTPUT COMPLETION, ONCE: ask again. TWICE from the same model and the
 * same signal: end the turn — the model is answering deterministically and the
 * answer is nothing (`retry.js`). THE RETRY CEILING BINDS HERE TOO: a provider
 * returning nothing under a ROTATING finish signal never repeats a signature,
 * so that guard alone would let one turn ask forever, doubling `backoffMs`.
 * @param {AgentState} state @param {Incoming} incoming @param {string} finish @returns {Stepped}
 */
function onEmpty(state, incoming, finish) {
  const signature = emptySignature(state.model, finish)
  const attempts = state.attempts + 1
  if (state.lastEmpty === signature || attempts >= MAX_ATTEMPTS) return endTurn(state, STALLED)
  return nextCall({ ...state, lastEmpty: signature }, incoming.at, attempts)
}

/**
 * AN EFFECT THIS TURN QUEUED COULD NOT BE RUN, and the two halves fail
 * differently on purpose.
 *
 * A TOOL FAILURE IS A TOOL RESULT: it lands against the call it answers, so the
 * round drains and the model reads what went wrong. The alternative is a batch
 * that never completes and a turn waiting for a result nobody will send.
 *
 * A MODEL FAILURE IS RETRIED, WITH A WAIT, UNTIL IT IS NOT. Past the ceiling
 * the turn ends QUOTING what the driver read: a failure that ends with no words
 * is the hole `retry.js` exists to close.
 * @param {AgentState} state @param {Incoming} incoming @param {Failure} failure @returns {Stepped}
 */
function onEffectFailed(state, incoming, failure) {
  if (failure.effect === 'InvokeTool') {
    return onToolResult(state, incoming, { tool: '', ok: false, output: failure.reason })
  }
  const attempts = state.attempts + 1
  if (attempts >= MAX_ATTEMPTS) return endTurn(state, `${FAILED}: ${failure.reason}`)
  return nextCall(state, incoming.at, attempts)
}
