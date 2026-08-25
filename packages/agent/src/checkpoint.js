/**
 * PERSIST THE TURN, so a refresh finds it (I11). The predecessor mirrored only
 * the history window: a reload mid-turn produced an agent that had a
 * conversation, no task, no outstanding work and no record that anything had
 * been abandoned — the run simply stopped, and nothing on any surface said so.
 *
 * The reducer's state is plain JSON, so a checkpoint is that state plus THE
 * EFFECTS IN FLIGHT. Without the second half a resume knows a turn was running
 * and not what it was waiting for, which is the same limbo one level up.
 *
 * WHAT MAY BE RE-ISSUED, AND WHY THE RULE IS ABOUT THE WORLD AND NOT ABOUT
 * COST. A model call reads: asking again bills a second call and changes
 * nothing else, and the person gets their answer. A tool call that MUTATES may
 * already have written the file, and re-running it would write it twice with no
 * way to know whether once had happened. So a turn whose outstanding work could
 * have changed something ENDS, saying it was interrupted, rather than guessing.
 * Never a third option: a turn is resumed or it is ended.
 * @module
 */

import { StoreError } from '@harness/kernel'
import { INTERRUPTED, endTurn } from './ending.js'
import { restoreAgentState, serializeAgentState } from './state.js'
import { named } from './toolbox.js'

/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./state.js').AgentState} AgentState */

/** The checkpoint envelope's version, read on the way back (I18). A record from a build that wrote a shape this one cannot read says which record and why; it never guesses. */
export const CHECKPOINT_VERSION = 1

/**
 * The turn, written down. `Emit` effects are excluded because they are not in
 * flight — a fact is recorded inside the same step that asked for it, so one
 * held here would be re-recorded on every resume.
 * @param {AgentState} state @param {readonly Effect[]} effects @returns {string}
 */
export function checkpoint(state, effects) {
  const inFlight = effects.filter((effect) => effect.type !== 'Emit' && effect.turnId === state.turnId)
  return JSON.stringify({ v: CHECKPOINT_VERSION, state: serializeAgentState(state), inFlight })
}

/**
 * BOOT: resume the turn, or end it saying it was interrupted.
 *
 * An idle checkpoint resumes as itself with nothing outstanding — that is not
 * limbo, it is an agent between turns. A turn that WAS running and has nothing
 * recorded in flight is limbo, and it ends: the effect that would have answered
 * it was never written down, so nothing will ever arrive against it.
 * @param {string} text @returns {{state: AgentState, effects: Effect[]}}
 * @throws {StoreError} `corrupt` — an unreadable checkpoint is not an empty one
 */
export function resume(text) {
  const record = readRecord(text)
  const state = restoreAgentState(record.state)
  if (state.turnId === '') return { state, effects: [] }
  const unsafe = record.inFlight.find((effect) => !reissuable(state, effect))
  if (unsafe || record.inFlight.length === 0) {
    return endTurn(state, INTERRUPTED)
  }
  return { state, effects: [...record.inFlight] }
}

/**
 * Whether this effect can be asked for again without the world having moved
 * under it. A tool this agent no longer holds a descriptor for is NOT
 * re-issuable: an unknown tool's two declared properties are unknown too, and
 * the honest reading of "we do not know whether it changed anything" is that it
 * might have.
 * @param {AgentState} state @param {Effect} effect @returns {boolean}
 */
function reissuable(state, effect) {
  if (effect.type === 'CallModel') return true
  if (effect.type !== 'InvokeTool') return false
  const tool = named(state.toolbox, effect.tool)
  return tool !== null && !tool.mutates
}

/** @param {string} text @returns {{state: string, inFlight: Effect[]}} */
function readRecord(text) {
  /** @type {unknown} */
  let value
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new StoreError('corrupt', 'This checkpoint is not JSON, so the turn it holds cannot be read.', { cause })
  }
  const record = /** @type {Record<string, unknown>} */ (value ?? {})
  if (record['v'] !== CHECKPOINT_VERSION) {
    throw new StoreError('corrupt', `This checkpoint says version ${String(record['v'])}, and this build writes ${CHECKPOINT_VERSION}.`, { key: 'v' })
  }
  if (typeof record['state'] !== 'string' || !Array.isArray(record['inFlight'])) {
    throw new StoreError('corrupt', 'This checkpoint carries no state or no list of effects in flight, and a turn needs both to be resumed.')
  }
  return { state: record['state'], inFlight: /** @type {Effect[]} */ (record['inFlight']) }
}
