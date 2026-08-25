/**
 * THE CORE'S TRANSCRIPT, IN THE SHAPE THIS PANE DRAWS — and this file exists
 * because the two halves of one projection landed in different rounds.
 *
 * `packages/core/src/chat.js` projects `messages`, and each row's `said` is a
 * plain string. This pane draws `rows` of TYPED BLOCKS, because a reply a model
 * wrote is parsed into a block tree and rendered as elements, which is what
 * makes markup injection structurally impossible rather than sanitized
 * (docs/RULINGS.md, ruling 6). The core has not started parsing yet.
 *
 * SO THIS LIFTS, AND IT DOES NOT PARSE. A string becomes ONE paragraph holding
 * ONE text span — the same characters, in the shape that renders them — and no
 * heading, list, or code fence is ever recovered from it. That is the whole
 * difference between a lift and the parse this file refuses to do: a parse
 * would be the interface deciding what a model's reply MEANS, which is a fact
 * and therefore the core's (I5).
 *
 * DELETE THIS the day `GET /chat` projects blocks. It is the only thing in the
 * FACE with an expiry date, and `test/transcript.test.js` executes both halves
 * so that the day it can go, a test says so.
 */

import { ok, problem } from '@harness/kernel'

/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('@/components/views/chat').ChatData} ChatData */
/** @typedef {{id: string, kind: string, speaker: string, said: string}} Message */

/**
 * The composer's own words. They are HERE and not in the projection because
 * they name nothing the log knows: no agent, no count, no state. The moment one
 * of them has to say WHO is being spoken to, or WHY sending is refused, it is a
 * fact and it comes across the seam — `refusedLabel` already does.
 * @type {import('@/components/ui/composer').ComposerData}
 */
export const COMPOSER = {
  promptLabel: 'Your message',
  placeholder: 'Say the next thing…',
  sendLabel: 'Send',
  refusedLabel: '',
  // EMPTY, AND EMPTY IS NOT A GUESS. What this turn is sent with and what it
  // will cost are facts the core does not project yet, and a strip of em dashes
  // is the same claim made quietly.
  sentWith: [],
  cost: null,
}

/**
 * @param {Response} response as `GET /chat` answered
 * @returns {Response} the same response where it already draws, the lifted one
 *   where the core answered in its own shape, and a stated failure otherwise
 */
export function drawable(response) {
  if (response.view !== 'chat') return response
  const data = response.data
  if (Array.isArray(data.rows) && isRecord(data.composer)) return response
  if (!Array.isArray(data.messages)) return mismatch()
  // ONE CAST, ONE REASON: the seam types every `data` as an open record, so the
  // rows arrive as `unknown[]`. `lifted` reads four strings off each and would
  // produce `undefined` in the markup if one were missing, so the shape is
  // CHECKED rather than trusted, and an unchecked row is the stated failure.
  const messages = /** @type {unknown[]} */ (data.messages)
  if (!messages.every(isMessage)) return mismatch()
  return ok('chat', { ...data, rows: messages.map(lifted), composer: COMPOSER })
}

/**
 * One core row as one drawn row. `kind` crosses VERBATIM — the pane stamps it
 * as a data attribute and `views.module.css` styles the four it knows about, so
 * a kind it has no rule for is a plain row and never a missing one.
 * @param {unknown} row @returns {import('@/components/views/chat').Said}
 */
function lifted(row) {
  const said = /** @type {Message} */ (row)
  return {
    id: said.id,
    row: 'said',
    kind: said.kind,
    speaker: said.speaker,
    blocks: [{ kind: 'paragraph', spans: [{ kind: 'text', text: said.said }] }],
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null
}

/** @param {unknown} row @returns {boolean} */
function isMessage(row) {
  if (!isRecord(row)) return false
  return ['id', 'kind', 'speaker', 'said'].every((field) => typeof row[field] === 'string')
}

/** @returns {Response} */
function mismatch() {
  return problem(500, 'The core projected this agent’s transcript in a shape this interface cannot draw.', {
    id: 'chat', kind: 'projection_mismatch',
    detail: 'GET /chat answered with neither `rows` of typed blocks nor `messages` of worded rows, so no transcript could be drawn from it without inventing its structure.',
    repair: 'Nothing you can do from this page — the log is intact and nothing has been lost.',
  })
}
