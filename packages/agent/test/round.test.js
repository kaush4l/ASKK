import { expect, test, describe } from 'bun:test'
import { CALL_REFUSED, arg, newAgentState, step, tool } from '@harness/agent'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Incoming} Incoming */
/** @typedef {import('@harness/agent').Effect} Effect */

const AT = 1_700_000_000_000

const BOX = [
  tool({ name: 'read_file', description: 'Read a file.', args: [arg('path', 'string', 'the path')] }),
  tool({ name: 'exec', description: 'Run a command.', args: [arg('command', 'string', 'the command')], evidence: true }),
  tool({ name: 'write_file', description: 'Write a file.', args: [arg('path', 'string', 'the path'), arg('text', 'string', 'the contents')], mutates: true }),
]

/** @param {Array<{id: string, tool: string, args: string}>} calls @returns {Incoming} */
const replied = (calls) => ({
  at: AT, turnId: 'turn-1',
  fact: { type: 'model_replied', agent: 'main', text: '', reasoning: '', finish: 'stop' },
  reply: { calls, finish: 'tool_calls' },
})

/** @param {string} callId @param {string} tool @param {string} output @param {boolean} [ok] @returns {Incoming} */
const ran = (callId, tool, output, ok = true) => ({
  at: AT, turnId: 'turn-1', callId,
  fact: { type: 'tool_invoked', agent: 'main', tool, args: '{}', onBehalfOf: '', ok, output },
})

/** An agent with a real toolbox, one model call outstanding under `turn-1`. */
function asked() {
  return step({ ...newAgentState(), toolbox: BOX }, {
    at: AT, turnId: 'turn-1', fact: { type: 'user_message', text: 'read both and list', agent: 'main', from: 'person' },
  }).state
}

/** @param {Effect[]} effects @returns {Array<Record<string, unknown>>} */
function refusals(effects) {
  return effects.flatMap((e) => (e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === CALL_REFUSED
    ? [/** @type {Record<string, unknown>} */ (e.fact.payload)]
    : []))
}

describe('a round of calls correlates by id, and by nothing else', () => {
  // Two calls to ONE tool and a third to another: name-matching cannot tell the
  // first two apart, and the results come back in the reverse of the order they
  // were written, so order-matching gets every one of them wrong.
  const readA = { id: 'c1', tool: 'read_file', args: '{"path":"a.md"}' }
  const readB = { id: 'c2', tool: 'read_file', args: '{"path":"b.md"}' }
  const listing = { id: 'c3', tool: 'exec', args: '{"command":"ls"}' }
  const three = [readA, readB, listing]

  test('three calls in one round produce three results, each filed against its own call', () => {
    const written = step(asked(), replied(three))
    expect(written.effects.map((e) => (e.type === 'InvokeTool' ? e.callId : e.type))).toEqual(['c1', 'c2', 'c3'])

    const third = step(written.state, ran('c3', 'exec', 'a.md  b.md'))
    const second = step(third.state, ran('c2', 'read_file', '# B'))
    const first = step(second.state, ran('c1', 'read_file', '# A'))

    expect(first.state.batch.map((call) => [call.id, call.output]))
      .toEqual([['c1', '# A'], ['c2', '# B'], ['c3', 'a.md  b.md']])
    // …and the model reads them in the order it WROTE the calls, not the order
    // the answers happened to arrive.
    expect(first.state.observations).toEqual(['read_file: # A', 'read_file: # B', 'exec: a.md  b.md'])
    expect(first.state.toolRounds).toBe(1)
    expect(first.effects.map((e) => e.type)).toEqual(['CallModel'])
  })

  test('the round is not over until the last call has its answer, whichever answer that is', () => {
    const written = step(asked(), replied(three))
    const one = step(written.state, ran('c2', 'read_file', '# B'))
    expect(one.effects).toEqual([])
    expect(one.state.observations).toEqual([])
    const two = step(one.state, ran('c1', 'read_file', '# A'))
    expect(two.effects).toEqual([])
    expect(step(two.state, ran('c3', 'exec', 'a.md')).effects.map((e) => e.type)).toEqual(['CallModel'])
  })

  test('two calls sharing one id are not two questions: the second is refused rather than answered by the first', () => {
    const clashing = step(asked(), replied([readA, { ...readB, id: 'c1' }]))
    const [refused] = refusals(clashing.effects)
    expect(String(refused?.why)).toContain('share the id c1')
    expect(clashing.effects.filter((e) => e.type === 'InvokeTool')).toHaveLength(1)
  })
})

describe('a refused call is answered here, and never reaches the driver', () => {
  test('a call the toolbox refuses is not invoked, is recorded, and reaches the model as its own result', () => {
    const written = step(asked(), replied([
      { id: 'c1', tool: 'read_file', args: '{"path":"a.md"}' },
      { id: 'c2', tool: 'rm_rf', args: '{}' },
    ]))
    expect(written.effects.filter((e) => e.type === 'InvokeTool').map((e) => e.type === 'InvokeTool' && e.callId)).toEqual(['c1'])
    expect(refusals(written.effects).map((r) => r.id)).toEqual(['c2'])

    const done = step(written.state, ran('c1', 'read_file', '# A'))
    expect(done.state.observations).toEqual(['read_file: # A', 'rm_rf failed: Tool not found: rm_rf. Available: read_file, exec, write_file'])
  })

  test('a round that is nothing but refusals settles in the same step: one extra round, not a stall', () => {
    const { state, effects } = step(asked(), replied([{ id: 'c1', tool: '', args: '{}' }]))
    expect(effects.map((e) => e.type)).toEqual(['Emit', 'CallModel'])
    expect(state.awaiting).toBe('model')
    expect(state.toolRounds).toBe(1)
    expect(state.observations).toEqual([' failed: That was data, not a call: no tool was named.'])
  })
})

describe('what a result PROVED is folded from the tool own declaration', () => {
  test('a successful mutation marks the turn edited and clears what was green before it', () => {
    const green = step(asked(), replied([{ id: 'c1', tool: 'exec', args: '{"command":"ls"}' }]))
    const after = step(green.state, ran('c1', 'exec', 'a.md'))
    expect([after.state.green, after.state.mutated]).toEqual([true, false])

    const writing = step(after.state, replied([{ id: 'c2', tool: 'write_file', args: '{"path":"a.md","text":"x"}' }]))
    const written = step(writing.state, ran('c2', 'write_file', 'wrote 1 line'))
    // The freshness rule: anything still green at the end of the turn postdates
    // the last edit, so the edit clears it.
    expect([written.state.green, written.state.mutated]).toEqual([false, true])
  })

  test('a command that printed nothing is not evidence, and a failed one is not either', () => {
    const silent = step(asked(), replied([{ id: 'c1', tool: 'exec', args: '{"command":"true"}' }]))
    expect(step(silent.state, ran('c1', 'exec', '(no output)')).state.green).toBe(false)
    expect(step(silent.state, ran('c1', 'exec', 'boom', false)).state.green).toBe(false)
  })

  test('a tool that declares neither proves neither, however much it printed', () => {
    const reading = step(asked(), replied([{ id: 'c1', tool: 'read_file', args: '{"path":"a.md"}' }]))
    const after = step(reading.state, ran('c1', 'read_file', '# A whole file'))
    expect([after.state.green, after.state.mutated, after.state.acted]).toEqual([false, false, false])
  })
})
