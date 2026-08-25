/**
 * The agent: a pure step function and the data it walks. No I/O of any kind
 * lives in this package — the loop DESCRIBES effects and `core`'s driver runs
 * them (I3, I7).
 *
 * Increment 3 of eight: tool descriptors with a real schema, the toolbox and
 * the sentences it refuses a call with, native provider calls correlated by id
 * end to end, and the declared fallback for a model with no call API. The spec
 * reader and the paper follow.
 *
 * `step` is the only writer of an AgentState, so the sibling functions that
 * RETURN one — `land`, `openBatch`, `idle`, `endTurn`, `boundary` — are not
 * named here. They stay exported from their own modules for the loop and its
 * tests; advertising them to the rest of the build would hand a caller exactly
 * the out-of-band write the reducer exists to make impossible, which is how the
 * Rust cleared `agent.task` from two files that were not the loop.
 * @module
 */

export {
  newAgentState, serializeAgentState, restoreAgentState,
  DEFAULT_MAX_ROUNDS, DEFAULT_COMPACT_AT, DEFAULT_KEEP_RECENT, DEFAULT_PASSES,
} from './state.js'
export { EFFECT_TYPES, callModel, invokeTool, emit, delegate } from './effect.js'
export { NO_TOOLS, ALL_TOOLS, onlyTools, grant, RESPONSE_CONTRACTS, WORK, WORK_BUDGET } from './stages.js'
export { step } from './step.js'
export { arg, tool, readArgs, usage } from './tools.js'
export { NOTHING_RAN, check, named, usages } from './toolbox.js'
export { NATIVE, SCANNED, scanCalls, swallowedClose } from './calls.js'
export { CALL_REFUSED } from './round.js'
export { FINISH_REASONS, DROPPED, dropped } from './turn.js'
export {
  ENDED, ANSWERED, MALFORMED, ROUND_CEILING, TRUNCATED, REFUSED, FAILED, NO_CALLS, RESPOND,
  endingFor, endedWhy, endedRounds,
} from './ending.js'
export { STOP_REQUESTED, STOPPED, isStopRequest } from './stop.js'
export { STEERED, carried } from './steer.js'

/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./state.js').Goal} Goal */
/** @typedef {import('./state.js').Standing} Standing */
/** @typedef {import('./state.js').Space} Space */
/** @typedef {import('./state.js').Paper} Paper */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./effect.js').Document} Document */
/** @typedef {import('./effect.js').ProviderFormat} ProviderFormat */
/** @typedef {import('./tools.js').Tool} Tool */
/** @typedef {import('./tools.js').ToolArg} ToolArg */
/** @typedef {import('./calls.js').CallStyle} CallStyle */
/** @typedef {import('./round.js').Asked} Asked */
/** @typedef {import('./stages.js').ToolScope} ToolScope */
/** @typedef {import('./stages.js').ResponseContract} ResponseContract */
/** @typedef {import('./stages.js').Budget} Budget */
/** @typedef {import('./step.js').Stepped} Stepped */
/** @typedef {import('./turn.js').Incoming} Incoming */
/** @typedef {import('./turn.js').Reply} Reply */
/** @typedef {import('./turn.js').ToolCall} ToolCall */
/** @typedef {import('./turn.js').FinishReason} FinishReason */
/** @typedef {import('./turn.js').Awaiting} Awaiting */
