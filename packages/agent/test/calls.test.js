import { expect, test, describe } from 'bun:test'
import { ANSWERED, ENDED, NATIVE, SCANNED, arg, endedWhy, newAgentState, scanCalls, step, swallowedClose, tool } from '@harness/agent'

/** @typedef {import('@harness/agent').Incoming} Incoming */
/** @typedef {import('@harness/agent').Effect} Effect */

const AT = 1_700_000_000_000

const BOX = [
  tool({ name: 'exec', description: 'Run a command.', args: [arg('command', 'string', 'the command')], evidence: true }),
  tool({ name: 'now', description: 'The time here.' }),
]

/** @param {import('@harness/agent').CallStyle} calling */
function asked(calling) {
  return step({ ...newAgentState(), toolbox: BOX, calling }, {
    at: AT, turnId: 'turn-1', fact: { type: 'user_message', text: 'what time is it', agent: 'main', from: 'person' },
  }).state
}

/** A reply whose calls are in the PROSE, which is all a model without a tool API can do. @param {string} text @returns {Incoming} */
const wrote = (text) => ({
  at: AT, turnId: 'turn-1',
  fact: { type: 'model_replied', agent: 'main', text, reasoning: '' },
  reply: { calls: [], finish: 'stop' },
})

describe('the fallback scanner', () => {
  test('every call in the text, in the order written, each with an id derived from the turn', () => {
    expect(scanCalls('exec({"command":"ls"}), exec({"command":"pwd"})', 'turn-1')).toEqual([
      { id: 'turn-1#0', tool: 'exec', args: '{"command":"ls"}' },
      { id: 'turn-1#1', tool: 'exec', args: '{"command":"pwd"}' },
    ])
  })

  test('a call with no arguments is a call', () => {
    expect(scanCalls('I will check: now()', 't')).toEqual([{ id: 't#0', tool: 'now', args: '{}' }])
  })

  test('a nested argument object is one call and not an unreadable one — a real MCP tool sends these', () => {
    const found = scanCalls('send({"body": {"to": "a", "cc": ["b"]}})', 't')
    expect(found).toEqual([{ id: 't#0', tool: 'send', args: '{"body": {"to": "a", "cc": ["b"]}}' }])
  })

  test('a brace inside a string does not end the arguments', () => {
    expect(scanCalls('exec({"command":"echo \\"}\\" "})', 't')[0]?.args).toBe('{"command":"echo \\"}\\" "}')
  })

  test('text that is not a call is not one: a word followed by prose finds nothing', () => {
    expect(scanCalls('I could exec (if you like) but I will not', 't')).toEqual([])
  })

  test('the ids are DERIVED, so the same reply read twice is the same state twice (I7)', () => {
    const text = 'exec({"command":"ls"})'
    expect(scanCalls(text, 'turn-9')).toEqual(scanCalls(text, 'turn-9'))
  })
})

describe('which reading is used is declared by the model, never guessed from the text', () => {
  test('a native model reads its own calls[]: prose that LOOKS like a call is prose, and the signal ends the turn', () => {
    const { state, effects } = step(asked(NATIVE), wrote('exec({"command":"date"})'))
    expect(state.turnId).toBe('')
    expect(endedWhy(payloadOf(effects, ENDED))).toBe(ANSWERED)
    expect(effects.some((e) => e.type === 'InvokeTool')).toBe(false)
  })

  test('a scanned model has the same text read as the call it is, and the round opens', () => {
    const { state, effects } = step(asked(SCANNED), wrote('exec({"command":"date"})'))
    expect(state.awaiting).toBe('tools')
    expect(effects.map((e) => (e.type === 'InvokeTool' ? e.tool : e.type))).toEqual(['exec'])
    expect(state.batch.map((call) => call.id)).toEqual(['turn-1#0'])
  })

  test('a scanned model that wrote no call has answered: the signal still decides how', () => {
    const { state, effects } = step(asked(SCANNED), wrote('It is about four in the afternoon.'))
    expect(state.turnId).toBe('')
    expect(endedWhy(payloadOf(effects, ENDED))).toBe(ANSWERED)
  })
})

describe('the swallowed terminator', () => {
  test('a string value ending in the three characters that end a call is caught', () => {
    expect(swallowedClose('{"path":"b.csv","text":"item,cost\\ncoffee,4.50\\"})"}')).toBe(true)
  })

  test('and nothing wider: a legitimate write is not refused', () => {
    expect(swallowedClose('{"path":"b.csv","text":"item,cost\\ncoffee,4.50"}')).toBe(false)
    expect(swallowedClose('not json at all')).toBe(false)
  })
})

/** @param {Effect[]} effects @param {string} kind @returns {unknown} */
function payloadOf(effects, kind) {
  const found = effects.find((e) => e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === kind)
  if (found?.type !== 'Emit' || found.fact.type !== 'custom') throw new Error(`no ${kind} was emitted`)
  return found.fact.payload
}
