import { expect, test, describe } from 'bun:test'
import {
  ANSWERED, ENDED, MALFORMED, NO_CALLS, REFUSED, ROUND_CEILING, RESPOND, STEERED, TRUNCATED,
  arg, endedRounds, endedWhy, newAgentState, step, tool,
} from '@harness/agent'
import { CARD } from './card.js'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Incoming} Incoming */
/** @typedef {import('@harness/agent').Effect} Effect */
/** @typedef {import('@harness/agent').FinishReason} FinishReason */

const AT = 1_700_000_000_000

/** @param {string} text @param {string|null} turnId @returns {Incoming} */
const said = (text, turnId) => ({ at: AT, turnId, fact: { type: 'user_message', text, agent: 'main', from: 'person' } })

/** @param {string} turnId @param {FinishReason} finish @param {Array<{id: string, tool: string, args: string}>} calls @returns {Incoming} */
const replied = (turnId, finish, calls = []) => ({
  at: AT, turnId,
  fact: { type: 'model_replied', agent: 'main', text: 'whatever the model said', reasoning: '', finish: 'stop' },
  reply: { calls, finish },
})

/** @param {string} turnId @param {string} callId @param {string} tool @param {boolean} ok @param {string} output @returns {Incoming} */
const ran = (turnId, callId, tool, ok, output) => ({
  at: AT, turnId, callId,
  fact: { type: 'tool_invoked', agent: 'main', tool, args: '{}', onBehalfOf: '', ok, output },
})

const BOX = [
  tool({ name: 'read_file', description: 'Read a file.', args: [arg('path', 'string', 'the path')] }),
  tool({ name: 'exec', description: 'Run a command.', args: [arg('command', 'string', 'the command')], evidence: true }),
]

/** The state of an agent mid-turn, one model call outstanding under `turn-1`. */
function asked() {
  const { state } = step({ ...newAgentState(), toolbox: BOX, card: CARD }, said('what is in this folder?', 'turn-1'))
  return state
}

/** @param {Effect[]} effects @param {string} kind @returns {unknown} */
function payloadOf(effects, kind) {
  const found = effects.find((e) => e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === kind)
  if (!found || found.type !== 'Emit' || found.fact.type !== 'custom') throw new Error(`no ${kind} was emitted`)
  return found.fact.payload
}

/** @param {Effect[]} effects @param {string} kind @returns {Record<string, unknown>} */
function recordOf(effects, kind) {
  return /** @type {Record<string, unknown>} */ (payloadOf(effects, kind))
}

describe('a turn starting', () => {
  test('a message starts the turn it was minted for, and asks the model under that turn', () => {
    const { state, effects } = step({ ...newAgentState(), card: CARD }, said('what is in this folder?', 'turn-1'))
    expect(state.turnId).toBe('turn-1')
    expect(state.task).toBe('what is in this folder?')
    expect(state.awaiting).toBe('model')
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({ type: 'CallModel', turnId: 'turn-1' })
  })

  test('a message with no turn minted for it is dropped, not answered with an invented id (I7)', () => {
    const { state, effects } = step({ ...newAgentState(), card: CARD }, said('go', null))
    expect(state.turnId).toBe('')
    expect(effects.every((e) => e.type === 'Emit')).toBe(true)
    expect(recordOf(effects, 'agent.dropped').why).toBe('it arrived with no turn to run it under')
  })

  test('a second message during a turn steers it: it is recorded and starts nothing', () => {
    const { state, effects } = step(asked(), said('actually, only the .md files', 'turn-2'))
    expect(state.turnId).toBe('turn-1')
    expect(state.steered).toBe(true)
    expect(effects).toHaveLength(1)
    expect(payloadOf(effects, STEERED)).toBe(null)
  })
})

describe('a turn ending on a signal, never on silence', () => {
  test('a prose-only reply ends the turn, and the ending is NAMED', () => {
    const { state, effects } = step(asked(), replied('turn-1', 'stop'))
    expect(state.turnId).toBe('')
    expect(state.task).toBe(null)
    expect(state.awaiting).toBe(null)
    const ended = payloadOf(effects, ENDED)
    expect(endedWhy(ended)).toBe(ANSWERED)
    expect(endedRounds(ended)).toBe(0)
  })

  test('four call-less replies, four different endings — the shape of the prose decides none of them', () => {
    /** @type {Array<[FinishReason, string]>} */
    const cases = [['stop', ANSWERED], ['length', TRUNCATED], ['refusal', REFUSED], ['tool_calls', NO_CALLS]]
    for (const [finish, why] of cases) {
      const { effects } = step(asked(), replied('turn-1', finish))
      expect(endedWhy(payloadOf(effects, ENDED))).toBe(why)
    }
  })

  test('a signal no build here names is quoted back, so the ending can still say why', () => {
    // The cast IS the test: `content_filter` is a live OpenAI finish_reason that
    // `FinishReason` cannot describe, and it crosses the package boundary anyway.
    // `end_turn` is Anthropic's, and the kernel's vocabulary is OpenAI-shaped:
    // a real signal, from a real provider, that no name in this build matches.
    // `content_filter` used to stand here and no longer can — it was added to
    // the vocabulary the day the port started reporting the provider's own
    // reason, which is the outcome this test wanted and not the one it asserts.
    const foreign = replied('turn-1', /** @type {FinishReason} */ (/** @type {unknown} */ ('end_turn')))
    const { state, effects } = step(asked(), foreign)
    expect(state.turnId).toBe('')
    expect(endedWhy(payloadOf(effects, ENDED))).toBe('unknown finish signal "end_turn"')
  })

  test('a model with no native call API ends its turn by CALLING respond', () => {
    const call = { id: 'c1', tool: RESPOND, args: '{"text":"there are four files"}' }
    const { state, effects } = step(asked(), replied('turn-1', 'tool_calls', [call]))
    expect(state.turnId).toBe('')
    expect(effects.some((e) => e.type === 'InvokeTool')).toBe(false)
    expect(endedWhy(payloadOf(effects, ENDED))).toBe(ANSWERED)
  })

  test('a reply carrying no signal at all ENDS the turn as malformed — a broken reply is not a wait', () => {
    const blind = { at: AT, turnId: 'turn-1', fact: /** @type {const} */ ({ type: 'model_replied', agent: 'main', text: 'hello', reasoning: '', finish: 'stop' }) }
    const { state, effects } = step(asked(), blind)
    // It used to be dropped, which left `awaiting: 'model'` set on a turn whose
    // model had already answered: nothing else was coming, and only a deadline
    // could have ended it.
    expect(state.turnId).toBe('')
    expect(state.awaiting).toBe(null)
    expect(endedWhy(payloadOf(effects, ENDED))).toBe(MALFORMED)
    expect(effects.some((e) => e.type === 'CallModel')).toBe(false)
  })
})

describe('a round of tool calls', () => {
  const readA = { id: 'c1', tool: 'read_file', args: '{"path":"a.md"}' }
  const readB = { id: 'c2', tool: 'read_file', args: '{"path":"b.md"}' }
  const listing = { id: 'c3', tool: 'exec', args: '{"command":"ls"}' }
  const three = [readA, readB, listing]

  test('three calls on one line produce three invocations and three observation lines', () => {
    const written = step(asked(), replied('turn-1', 'tool_calls', three))
    expect(written.effects.map((e) => e.type)).toEqual(['InvokeTool', 'InvokeTool', 'InvokeTool'])
    expect(written.state.batch.map((call) => call.id)).toEqual(['c1', 'c2', 'c3'])

    const first = step(written.state, ran('turn-1', 'c1', 'read_file', true, '# A'))
    expect(first.effects).toEqual([])
    const second = step(first.state, ran('turn-1', 'c2', 'read_file', true, '# B'))
    const third = step(second.state, ran('turn-1', 'c3', 'exec', false, 'ls: not found'))

    expect(third.state.observations).toEqual(['read_file: # A', 'read_file: # B', 'exec failed: ls: not found'])
    expect(third.state.toolRounds).toBe(1)
    expect(third.effects).toHaveLength(1)
    expect(third.effects[0]).toMatchObject({ type: 'CallModel', turnId: 'turn-1' })
  })

  test('the next round replaces the observations rather than growing them', () => {
    const first = step(asked(), replied('turn-1', 'tool_calls', [readA]))
    const done = step(first.state, ran('turn-1', 'c1', 'read_file', true, '# A'))
    expect(done.state.observations).toEqual(['read_file: # A'])
    const again = step(done.state, replied('turn-1', 'tool_calls', [readB]))
    expect(again.state.observations).toEqual([])
  })

  test('the ceiling ends the turn as a named ending, not as an answer', () => {
    const ceiling = { ...asked(), maxRounds: 1 }
    const written = step(ceiling, replied('turn-1', 'tool_calls', [listing]))
    const { state, effects } = step(written.state, ran('turn-1', 'c3', 'exec', true, 'a.md b.md'))
    expect(state.turnId).toBe('')
    expect(endedWhy(payloadOf(effects, ENDED))).toBe(ROUND_CEILING)
    expect(endedRounds(payloadOf(effects, ENDED))).toBe(1)
    expect(effects.some((e) => e.type === 'CallModel')).toBe(false)
  })
})
