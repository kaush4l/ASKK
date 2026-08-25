/**
 * THE PURE STEP FUNCTION — the wall between thinking and doing, and the ONLY
 * writer of an `AgentState`.
 *
 * It takes the state and one arriving fact and returns a NEW state plus the
 * effects it wants run; it cannot do I/O, so every claim about the loop is a
 * claim about a returned array and tests on the host (I3, I7). The predecessor
 * had this shape too and then broke it from outside — two sites cleared
 * `agent.task` without going through a transition, which is exactly how a
 * result could arrive against a turn the reducer still believed was running.
 * There is one door. An out-of-band mutation of the snapshot handed in throws.
 *
 * THE ORDER OF THE THREE THINGS THIS DOES. Refuse what does not belong to the
 * live turn (I21) — then act — then, on the way out, honour a pressed Stop at
 * the single boundary every arm returns through.
 * @module
 */

import { MODEL_ENDPOINT } from '@harness/kernel'
import { callModel, invokeTool } from './effect.js'
import { ANSWERED, ROUND_CEILING, RESPOND, endTurn, endingFor } from './ending.js'
import { boundary, isStopRequest } from './stop.js'
import { carried } from './steer.js'
import { dropped, refusal } from './turn.js'

/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./turn.js').Incoming} Incoming */
/** @typedef {import('./turn.js').Reply} Reply */

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
  if (fact.type === 'tool_invoked') return onToolResult(state, fact)
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
    pendingTools: 0, toolRounds: 0, observations: [], steered: false, stopping: false,
  }
  return { state: turn, effects: [nextCall(turn)] }
}

/**
 * ONE REPLY, READ AS A SIGNAL. Calls are work; no calls is an ending, and WHICH
 * ending is the provider's `finish` — never the shape of the prose.
 *
 * A reply with no signal at all is refused rather than guessed at: "no call in
 * this text" meaning "the model answered" is the defect this whole rewrite of
 * the arm exists to remove.
 *
 * CALLS BEAT THE SIGNAL where a provider sends both `stop` and a call — the
 * model asked for work, and the signal only decides how a call-less reply
 * ended.
 * @param {AgentState} state @param {Incoming} incoming @returns {Stepped}
 */
function onReply(state, incoming) {
  const reply = incoming.reply
  if (!reply) {
    return { state, effects: [dropped(state, incoming, 'the reply carried no ending signal, and a turn ends on a signal and never on silence')] }
  }
  if (reply.calls.length === 0) return endTurn(state, endingFor(reply.finish))
  if (reply.calls.some((call) => call.tool === RESPOND)) return endTurn(state, ANSWERED)
  /** @type {AgentState} */
  const acting = { ...state, awaiting: 'tools', pendingTools: reply.calls.length, observations: [] }
  return { state: acting, effects: reply.calls.map((call) => invokeTool(state.turnId, call.tool, call.args)) }
}

/**
 * ONE TOOL RESULT, APPENDED. The batch is not done until the last one lands,
 * and only then does the model see them — that is what makes one LINE of calls
 * one observation.
 *
 * `observations` IS AN ARRAY. The Rust built a one-line `Observations`
 * component per result and upserted it by id, so three calls on one line
 * produced three overwrites and the model saw the last one. Each result is
 * appended in arrival order, and the round that follows starts a new list.
 * @param {AgentState} state @param {{tool: string, ok: boolean, output: string}} result @returns {Stepped}
 */
function onToolResult(state, result) {
  /** @type {AgentState} */
  const seen = {
    ...state,
    observations: [...state.observations, resultLine(result)],
    pendingTools: state.pendingTools - 1,
  }
  if (seen.pendingTools > 0) return { state: seen, effects: [] }
  const round = { ...seen, toolRounds: seen.toolRounds + 1 } // a round is COMPLETE when its last result lands
  if (round.toolRounds >= round.maxRounds) return endTurn(round, ROUND_CEILING)
  /** @type {AgentState} */
  const asking = { ...round, awaiting: 'model', steered: false }
  return { state: asking, effects: [nextCall(asking)] }
}

/**
 * One result as the model reads it. FAILURE IS IN THE LINE: the Rust rendered
 * `tool: output` for both outcomes and carried `ok` no further, so a model
 * could tell a failed call from a successful one only by reading the prose the
 * failure happened to contain (I16).
 * @param {{tool: string, ok: boolean, output: string}} result @returns {string}
 */
function resultLine(result) {
  return result.ok ? `${result.tool}: ${result.output}` : `${result.tool} failed: ${result.output}`
}

/**
 * ASK THE MODEL. The Document rides the effect, because nothing reaches a model
 * except as an assembled Document (I13).
 *
 * THE ASSEMBLY IS NOT HERE YET and this says so rather than pretending: the
 * paper's sources cross as the document's sections verbatim. `assemble` (lane
 * A) puts the budget, the degrade ladder and the affordances between them, and
 * `ask.js` (B11) is the seam that will hold both — this is the one call site it
 * replaces, not a second door beside it.
 * @param {AgentState} state @returns {Effect}
 */
function nextCall(state) {
  return callModel({
    turnId: state.turnId,
    document: { sections: state.paper.sources },
    format: { target: 'openai', vision: false, audio: false },
    endpoint: MODEL_ENDPOINT,
    model: state.model,
    temperature: state.temperature,
  })
}
