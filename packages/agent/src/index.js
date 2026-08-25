/**
 * The agent: a pure step function and the data it walks. No I/O of any kind
 * lives in this package — the loop DESCRIBES effects and `core`'s driver runs
 * them (I3, I7).
 *
 * Increment 2 of eight: the state, the effect vocabulary, the stage's tool
 * grant, and the reducer — one fact in, a new state and the effects it wants
 * out. The spec reader, the tools and the paper follow.
 * @module
 */

export {
  newAgentState, serializeAgentState, restoreAgentState,
  DEFAULT_MAX_ROUNDS, DEFAULT_COMPACT_AT, DEFAULT_KEEP_RECENT, DEFAULT_PASSES,
} from './state.js'
export { EFFECT_TYPES, callModel, invokeTool, emit, delegate } from './effect.js'
export { NO_TOOLS, ALL_TOOLS, onlyTools, grant, RESPONSE_CONTRACTS, WORK, WORK_BUDGET } from './stages.js'
export { step } from './step.js'
export { FINISH_REASONS, DROPPED, expects, refusal, dropped, idle } from './turn.js'
export {
  ENDED, ANSWERED, ROUND_CEILING, TRUNCATED, REFUSED, FAILED, NO_CALLS, RESPOND,
  endingFor, endTurn, endedWhy, endedRounds,
} from './ending.js'
export { STOP_REQUESTED, STOPPED, isStopRequest, boundary } from './stop.js'
export { STEERED, carried } from './steer.js'

/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./state.js').Goal} Goal */
/** @typedef {import('./state.js').Standing} Standing */
/** @typedef {import('./state.js').Space} Space */
/** @typedef {import('./state.js').Paper} Paper */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./effect.js').Document} Document */
/** @typedef {import('./effect.js').ProviderFormat} ProviderFormat */
/** @typedef {import('./stages.js').ToolScope} ToolScope */
/** @typedef {import('./stages.js').ResponseContract} ResponseContract */
/** @typedef {import('./stages.js').Budget} Budget */
/** @typedef {import('./step.js').Stepped} Stepped */
/** @typedef {import('./turn.js').Incoming} Incoming */
/** @typedef {import('./turn.js').Reply} Reply */
/** @typedef {import('./turn.js').ToolCall} ToolCall */
/** @typedef {import('./turn.js').FinishReason} FinishReason */
/** @typedef {import('./turn.js').Awaiting} Awaiting */
