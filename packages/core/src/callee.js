/**
 * THE SUB-AGENT'S HALF, AT THE APPLICATION LEVEL: one errand becomes one
 * ORDINARY turn of this build's own loop, and that turn's own ending is what
 * goes home.
 *
 * Nothing here is special-cased for being an errand. The `begin` message
 * becomes the same `user_message` fact a person's message makes and the same
 * driver runs it against the same reducer — which is the whole point of one
 * Worker per agent: a sub-agent is not a lesser mode of the loop, it is the
 * loop, somewhere else.
 *
 * `from` IS THE ASKING AGENT'S NAME AND IT IS CARRIED, NEVER INVENTED. The
 * seam's own `POST /chat` writes `from: ''`, which the conversation fold reads
 * as "You" — so an errand pushed through that door would put a lead's
 * delegation into a transcript under the person's name. `errandBegun` is what
 * stamps it, and this is the only door an errand enters by.
 *
 * THE ENDING IS READ OFF THE `ENDED` FACT AND NOT INFERRED, by the same fold
 * (`turns.js`) the board and the header read. The predecessor's CALLER wrote an
 * `agent_status: idle` record after its own await returned and every surface
 * read that as the outcome, so a callee that answered, one that exhausted its
 * rounds and one its provider refused were one event upstream.
 * @module
 */

import { errandBegun, endedMessage } from '@harness/agent'

import { CONVERSATION } from './reducers.js'
import { NO_TURNS, TURNS } from './turns.js'
import { mintId } from './app.js'
import { drive } from './drive.js'

/** @typedef {import('@harness/agent').Begin} Begin */
/** @typedef {import('@harness/agent').Ended} Ended */
/** @typedef {import('./app.js').App} App */
/** @typedef {import('./deadline.js').Driving} Driving */
/** @typedef {import('./reducers.js').Conversation} Conversation */
/** @typedef {import('./turns.js').Turns} Turns */

/** What an errand reports when its turn drained without recording an ending — an anomaly, said rather than dressed as an answer (I16). */
export const NO_ENDING = 'no ending was recorded'

/**
 * RUN ONE ERRAND TO ITS END. The turn id is MINTED HERE, from the injected rng
 * (I7), because the turn belongs to this agent and not to the one that asked.
 * @param {App} app @param {Begin} begin @param {Driving} opts
 * @returns {Promise<Ended>}
 */
export async function errandTurn(app, begin, opts) {
  const at = app.ports.clock.now()
  const turnId = mintId(app)
  const { incoming } = errandBegun(begin, turnId, at)
  app.log.append(incoming.fact, at, turnId)
  app.pending.push(incoming)
  await drive(app, opts)
  return answer(app, begin.errandId, turnId)
}

/**
 * WHAT THIS TURN ENDED AS, AND THE LAST THING IT SAID.
 *
 * The ending is matched on the TURN it names (I21) rather than taken as the
 * newest one: a Worker outlives nothing here — one channel carries one errand —
 * but an ending from some other turn reported as this errand's answer is
 * precisely the class of defect `turnId` exists to make impossible.
 * @param {App} app @param {string} errandId @param {string} turnId
 * @returns {Ended}
 */
function answer(app, errandId, turnId) {
  const turns = /** @type {Record<string, Turns>} */ (app.log.read(TURNS))[app.me] ?? NO_TURNS
  const ending = turns.last
  const said = lastSaid(app)
  if (!ending || ending.turnId !== turnId) return endedMessage(errandId, { ok: false, text: said, why: NO_ENDING })
  // `tone` IS THE FOLD'S OWN VERDICT and `ok` is nothing more than that word.
  // Reading `why === ANSWERED` here would be a second reader of the ending
  // vocabulary, and the two would disagree the first time a name was added.
  return endedMessage(errandId, { ok: ending.tone === 'ok', text: said, why: ending.why })
}

/**
 * THE LAST THING THE MODEL ACTUALLY SAID, off the transcript this turn wrote.
 * An ending fact carries the REASON a turn stopped and never the words, and a
 * reply with nothing in it is not a row (`reducers.js`) — so the newest
 * assistant row is the answer, and a turn that ended after a silent tool round
 * still reports the sentence the caller is waiting for.
 * @param {App} app @returns {string}
 */
function lastSaid(app) {
  const held = /** @type {Record<string, Conversation>} */ (app.log.read(CONVERSATION))[app.me]
  const rows = held?.rows ?? []
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]
    if (row && row.kind === 'assistant') return row.said
  }
  return ''
}
