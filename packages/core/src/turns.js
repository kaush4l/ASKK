/**
 * ONE ENDING FOR A TURN, WORDED IN ONE PLACE.
 *
 * The predecessor had THREE sites deciding what a failed turn was — the board
 * read `task == null`, the transcript read the shape of the last row, and the
 * header read a status word nothing cleared — and they disagreed. A person
 * watched a card say `main finished` above a transcript whose last line was a
 * malformed tool call. So the ending is a FACT (`ENDED`/`STOPPED`, from
 * `ending.js`), the fold below is the only reader of it, and the board, the
 * transcript and the header all render the same two strings it produces.
 *
 * `tone` is the machine field and `label` is the same fact in words (I5). They
 * are produced together so no surface can pick one and compose the other.
 * @module
 */

import { ANSWERED, ENDED, STOPPED, endedRounds, endedWhy } from '@harness/agent'

/** @typedef {import('@harness/kernel').Event} Event */

export const TURNS = 'turns'

/** @typedef {{turnId: string, why: string, rounds: number, at: number, tone: string, label: string}} Ending */

/**
 * What the log says about one agent's turns: how many ended, how many ended
 * WITHOUT an answer, and the newest ending in full. Counts and not a list,
 * because the list is the transcript and a second copy of it would be a second
 * authority on the same history.
 *
 * `openedAt` is when the LIVE turn started, or 0 when none is. It is here and
 * not on the conversation because a duration is a fact about a TURN, and the
 * processes pane needs the same one the board and the header use — the
 * predecessor had a clock per pane and they drifted apart within a minute.
 * @typedef {{last: Ending|null, ended: number, unanswered: number, openedAt: number, openTurnId: string}} Turns
 */

/**
 * ONE BUCKET PER AGENT, keyed by `me`. An ending is a `custom` fact and a
 * `custom` fact carries no agent name, so every ending this process records
 * belongs to the agent this process runs — which is true, and stated here
 * rather than guessed at by each reader.
 * @param {string} me
 * @returns {import('./log/reducers.js').Reducer}
 */
export function turnsReducer(me) {
  return {
    name: TURNS,
    version: 1,
    init: () => /** @type {Record<string, Turns>} */ ({}),
    fold: (/** @type {Record<string, Turns>} */ state, /** @type {Event} */ event) => {
      const fact = event.fact
      if (fact.type === 'user_message') {
        const who = fact.agent || me
        const started = state[who] ?? (state[who] = blank())
        started.openedAt = event.at
        started.openTurnId = event.turnId
        return state
      }
      if (fact.type !== 'custom' || (fact.kind !== ENDED && fact.kind !== STOPPED)) return state
      const held = state[me] ?? (state[me] = blank())
      const ending = endingOf(fact.kind, fact.payload, event.at)
      held.last = ending
      held.ended += 1
      held.openedAt = 0
      held.openTurnId = ''
      if (ending.tone !== 'ok') held.unanswered += 1
      return state
    },
  }
}

/** @returns {Turns} */
function blank() {
  return { last: null, ended: 0, unanswered: 0, openedAt: 0, openTurnId: '' }
}

/**
 * THE SENTENCE AND THE WORD, TOGETHER. Every caller takes both or neither —
 * `tone` without `label` is a surface about to write its own prose, and that is
 * the defect this file exists to remove.
 * @param {string} kind `ENDED` or `STOPPED`
 * @param {unknown} payload the ending fact's payload: `{why, rounds, turnId}`
 * @param {number} at
 * @returns {Ending}
 */
export function endingOf(kind, payload, at = 0) {
  const rounds = endedRounds(payload)
  const turnId = text(payload, 'turnId')
  if (kind === STOPPED) {
    return {
      turnId, why: 'stopped', rounds, at, tone: 'stopped',
      label: `You stopped the turn after ${laps(rounds)}. Nothing already running was cancelled — a command in flight runs to its end, and what it says lands in the log.`,
    }
  }
  const why = endedWhy(payload)
  if (why === ANSWERED || why === '') {
    return { turnId, why: why || ANSWERED, rounds, at, tone: 'ok', label: `Answered after ${laps(rounds)}.` }
  }
  return {
    turnId, why, rounds, at, tone: 'error',
    label: `That turn ended without an answer: ${why}, after ${laps(rounds)}.`,
  }
}

/** A count of tool rounds as a person reads it. Spelling, not opinion. */
export function laps(/** @type {number} */ n) {
  return n === 1 ? '1 tool round' : `${n} tool rounds`
}

/** One string out of a custom fact's payload, or '' where the record predates the field. */
export function text(/** @type {unknown} */ payload, /** @type {string} */ key) {
  if (typeof payload !== 'object' || payload === null) return ''
  const value = /** @type {Record<string, unknown>} */ (payload)[key]
  return typeof value === 'string' ? value : ''
}

/** The empty answer, so a pane that has never seen an ending renders the same shape. */
export const NO_TURNS = /** @type {Turns} */ (Object.freeze(blank()))
