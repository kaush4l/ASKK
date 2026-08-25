/**
 * The agent: a pure step function and the data it walks. No I/O of any kind
 * lives in this package — the loop DESCRIBES effects and `core`'s driver runs
 * them (I3, I7).
 *
 * Increment 1 of eight: the state, the effect vocabulary and the phase's tool
 * grant. The spec reader, the tools, the parser and `step` itself follow.
 * @module
 */

export {
  newAgentState, serializeAgentState, restoreAgentState,
  DEFAULT_MAX_ROUNDS, DEFAULT_COMPACT_AT, DEFAULT_KEEP_RECENT, DEFAULT_PASSES,
} from './state.js'
export { EFFECT_TYPES, callModel, invokeTool, emit, delegate } from './effect.js'
export { NO_TOOLS, ALL_TOOLS, onlyTools, grant, RESPONSE_CONTRACTS, WORK, WORK_BUDGET } from './phase.js'

/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./state.js').Goal} Goal */
/** @typedef {import('./state.js').Standing} Standing */
/** @typedef {import('./state.js').Space} Space */
/** @typedef {import('./state.js').Paper} Paper */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./effect.js').Document} Document */
/** @typedef {import('./effect.js').ProviderFormat} ProviderFormat */
/** @typedef {import('./phase.js').ToolScope} ToolScope */
/** @typedef {import('./phase.js').ResponseContract} ResponseContract */
/** @typedef {import('./phase.js').PhaseConfig} PhaseConfig */
/** @typedef {import('./phase.js').Budget} Budget */
