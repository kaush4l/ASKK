/**
 * ONE ENDING, THREE SURFACES, ONE SENTENCE.
 *
 * The predecessor's defect was not that any single pane was wrong — it was that
 * the board, the transcript and the header each decided for themselves what a
 * finished turn was, and the person reading two of them at once learned the
 * system did not know what it thought. So the test that matters compares the
 * surfaces to EACH OTHER, and would fail the moment one of them starts
 * composing its own.
 */
import { describe, expect, test } from 'bun:test'
import { CAPABILITIES, get, post } from '@harness/kernel'
import { ANSWERED, ENDED, MALFORMED, STOPPED, newAgentState } from '@harness/agent'
import { fakeClock, testPorts } from '@harness/adapters-test'
import { CLEARED, bootFresh, handle } from '@harness/core'

import { memorySegments } from './doubles.js'

function build() {
  const clock = fakeClock({ start: 1_000, step: 1 })
  const ports = testPorts({ clock, script: [] })
  return bootFresh({ ports, available: [...CAPABILITIES], segments: memorySegments(), agent: newAgentState() })
}

/** @param {import('@harness/core').App} app @param {string} kind @param {string} why @param {number} rounds */
function ends(app, kind, why, rounds) {
  handle(app, post('/chat', { message: 'do the thing' }))
  app.log.append({ type: 'custom', kind, payload: { why, rounds, turnId: 't1' } }, app.ports.clock.now(), 't1')
}

/** @param {import('@harness/core').App} app */
function surfaces(app) {
  const chat = handle(app, get('/chat')).data
  const rows = /** @type {Array<Record<string, unknown>>} */ (handle(app, get('/board')).data.rows)
  const notes = /** @type {Array<{kind: string, said: string, speaker: string}>} */ (chat.messages).filter((r) => r.speaker === 'Note')
  return { chat, card: rows[0], notes }
}

describe('a turn that ended without an answer', () => {
  test('says the same sentence on the board, in the header and in the transcript', () => {
    const app = build()
    ends(app, ENDED, MALFORMED, 2)
    const { chat, card, notes } = surfaces(app)

    expect(chat.endingLabel).toBe(`That turn ended without an answer: ${MALFORMED}, after 2 tool rounds.`)
    expect(card?.lastEndingLabel).toBe(chat.endingLabel)
    expect(notes[0]?.said).toBe(String(chat.endingLabel))
    expect(chat.endingTone).toBe('error')
    expect(card?.lastEndingTone).toBe('error')
  })

  test('an answered turn writes no note, and the board still knows it ended well', () => {
    const app = build()
    ends(app, ENDED, ANSWERED, 1)
    const { chat, card, notes } = surfaces(app)

    // NO ROW: the reply above it is the answer, and a line saying so under
    // every healthy turn is a line people stop reading.
    expect(notes).toEqual([])
    expect(chat.endingTone).toBe('ok')
    expect(card?.lastEndingLabel).toBe('Answered after 1 tool round.')
    expect(card?.turnsLabel).toBe('1 turn, all answered.')
  })

  test('a stop is its own tone, and neither surface calls it a failure', () => {
    const app = build()
    ends(app, STOPPED, '', 3)
    const { chat, card, notes } = surfaces(app)

    expect(chat.endingTone).toBe('stopped')
    expect(card?.lastEndingTone).toBe('stopped')
    expect(notes[0]?.kind).toBe('pending')
    expect(String(card?.lastEndingLabel)).toContain('after 3 tool rounds')
  })

  test('the dashboard counts what ended badly, and says so in words as well as a number', () => {
    const app = build()
    ends(app, ENDED, MALFORMED, 1)
    ends(app, ENDED, ANSWERED, 1)
    const tiles = /** @type {Array<Record<string, unknown>>} */ (handle(app, get('/tiles')).data.tiles)
    const unanswered = tiles.find((t) => t.id === 'unanswered')
    expect(unanswered?.value).toBe(1)
    expect(unanswered?.note).toBe('1 turn ended without an answer.')
  })

  test('emptying the transcript does not rewrite what the log says happened', () => {
    const app = build()
    ends(app, ENDED, MALFORMED, 1)
    app.log.append({ type: 'custom', kind: CLEARED, payload: { agent: '' } }, app.ports.clock.now())

    const { chat, card } = surfaces(app)
    expect(/** @type {unknown[]} */ (chat.messages)).toHaveLength(0)
    // THE ENDING SURVIVES A CLEAR, because it is a fact about a turn and not a
    // row in a conversation — and the board would be lying if it forgot.
    expect(card?.lastEndingTone).toBe('error')
  })
})
