/**
 * THE REAL PROJECTIONS: named pure folds, registered once, folded INCREMENTALLY
 * at append (I8, I20).
 *
 * The Rust rebuilt every view from `app.log.iter()` on every request and cloned
 * the whole history into each handler's context, so a request cost O(history)
 * and a session cost O(history²) with four panes polling. Nothing here walks an
 * array: one fact arrives, each fold does O(1) work, and a view READS the
 * result. `log/reducers.js` is the machinery; this file is what it holds.
 *
 * ONE BUCKET PER AGENT, keyed by the fact's own name — `factAgent`, in the
 * kernel, so no surface guesses this — with the empty name meaning THIS
 * process's own agent, which is what every fact the loop itself writes carries.
 * A message to `scout` therefore cannot reach `main`'s transcript: the fold
 * never puts it there.
 * @module
 */

import { factAgent } from '@harness/kernel'
import { ANSWERED, DROPPED, ENDED, STOPPED, endedRounds, endedWhy } from '@harness/agent'

import { EFFECT_FAILED } from './effects.js'
import { folderReducer } from './folder.js'

/** @typedef {import('@harness/kernel').Event} Event */
/** @typedef {import('@harness/kernel').Fact} Fact */

export const CONVERSATION = 'conversation'

/** @typedef {{id: string, kind: string, speaker: string, said: string}} Row */

/**
 * One agent's conversation and what the log says about it. `open` is whether a
 * turn is still waiting for an answer — set by a person speaking and cleared
 * only by an ENDING FACT, never by the shape of the last row, because a reply
 * that called tools has answered nothing.
 * @typedef {{rows: Row[], open: boolean, tools: number, status: string, detail: string, stage: string}} Conversation
 */

/**
 * Every projection this build folds, in one list, so a boot cannot register
 * half of them and a snapshot cannot restore a set nobody else has.
 * @param {string} me the agent whose loop this process runs
 * @returns {import('./log/reducers.js').Reducer[]}
 */
export function projections(me) {
  return [
    {
      name: CONVERSATION,
      version: 1,
      init: () => /** @type {Record<string, Conversation>} */ ({}),
      fold: (/** @type {Record<string, Conversation>} */ state, /** @type {Event} */ event) => fold(state, event, me),
    },
    folderReducer,
  ]
}

/** @param {Record<string, Conversation>} state @param {Event} event @param {string} me */
function fold(state, event, me) {
  const who = factAgent(event.fact) || me
  const held = state[who] ?? (state[who] = blank())
  const row = rowFor(event, who)
  if (row) held.rows.push(row)
  moved(held, event.fact)
  return state
}

/** @returns {Conversation} */
function blank() {
  return { rows: [], open: false, tools: 0, status: 'idle', detail: '', stage: '' }
}

/** What one fact does to the conversation ITSELF, as opposed to what it says. */
function moved(/** @type {Conversation} */ held, /** @type {Fact} */ fact) {
  if (fact.type === 'user_message') held.open = true
  if (fact.type === 'tool_invoked') held.tools += 1
  if (fact.type === 'stage_entered') held.stage = fact.stage
  if (fact.type === 'agent_status') {
    held.status = fact.status
    held.detail = fact.detail
    // AN IDLE STATUS IS AN ENDING. The ENDED and STOPPED facts below are
    // `custom` ones, and a `custom` fact carries no agent name — so no ending a
    // delegated agent produces can ever land in that agent's bucket, and its
    // conversation stayed open beside a delivered answer.
    if (fact.status === 'idle') held.open = false
  }
  if (fact.type === 'custom' && (fact.kind === ENDED || fact.kind === STOPPED)) held.open = false
}

/**
 * ONE FACT AS ONE ROW, already worded (I5). The interface chooses layout and
 * composes no prose — the moment two panes word one fact for themselves they
 * word it differently.
 * @param {Event} event @param {string} who @returns {Row|null}
 */
function rowFor(event, who) {
  const fact = event.fact
  const id = `e${event.seq}`
  if (fact.type === 'user_message') {
    const speaker = fact.from === '' ? 'You' : `${fact.from} asked ${who}`
    return { id, kind: 'user', speaker, said: fact.text }
  }
  // A REPLY WITH NOTHING IN IT IS NOT A ROW. A model that called tools and said
  // nothing beside them is normal; rendering it as an empty bubble under the
  // agent's name is a turn that appears to have answered with silence.
  if (fact.type === 'model_replied') {
    return fact.text.trim() === '' ? null : { id, kind: 'assistant', speaker: who, said: fact.text }
  }
  if (fact.type === 'tool_invoked') {
    const said = fact.ok ? fact.output : `failed: ${fact.output}`
    return { id, kind: 'tool', speaker: `${who} ran ${fact.tool}`, said }
  }
  return fact.type === 'custom' ? noted(id, fact.kind, fact.payload) : null
}

/**
 * WHAT THE MACHINE WROTE ABOUT THE TURN. Every one of these is a row a person
 * can act on, which is why an ANSWERED ending is not one: the reply above it is
 * the answer, and a line saying so under every healthy turn is a line people
 * stop reading.
 * @param {string} id @param {string} kind @param {unknown} payload @returns {Row|null}
 */
function noted(id, kind, payload) {
  if (kind === ENDED) {
    const why = endedWhy(payload)
    if (why === ANSWERED || why === '') return null
    return note(id, 'error', `That turn ended without an answer: ${why}, after ${rounds(endedRounds(payload))}.`)
  }
  if (kind === STOPPED) {
    return note(id, 'pending', `You stopped the turn after ${rounds(endedRounds(payload))}. Nothing already running was cancelled — a command in flight runs to its end, and what it says lands in the log.`)
  }
  if (kind === DROPPED) {
    return note(id, 'error', `A ${text(payload, 'fact')} arrived that this turn could not use: ${text(payload, 'why')}.`)
  }
  if (kind === EFFECT_FAILED) return note(id, 'error', text(payload, 'message'))
  // `core.steered` needs no row: the sentence IS the message above it, already
  // in the log in full, and a second line repeating it reads as a second one.
  return null
}

/** @param {string} id @param {string} kind @param {string} said @returns {Row} */
function note(id, kind, said) {
  // `Note` and not the agent's name: this is the page talking about the turn,
  // and every other row in the column says who is speaking.
  return { id, kind, speaker: 'Note', said }
}

/** @param {number} n */
function rounds(n) {
  return n === 1 ? '1 tool round' : `${n} tool rounds`
}

/** One string out of a custom fact's payload, or '' where the record is older than the field. */
function text(/** @type {unknown} */ payload, /** @type {string} */ key) {
  if (typeof payload !== 'object' || payload === null) return ''
  const value = /** @type {Record<string, unknown>} */ (payload)[key]
  return typeof value === 'string' ? value : ''
}
