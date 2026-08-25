import { expect, test, describe } from 'bun:test'
import { StoreError } from '@harness/kernel'
import {
  CHECKPOINT_VERSION, ENDED, INTERRUPTED, arg, checkpoint, endedWhy, newAgentState,
  resume, step, tool,
} from '@harness/agent'
import { CARD } from './card.js'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Effect} Effect */

const AT = 1_700_000_000_000
const READ = tool({ name: 'read_file', description: 'Read a file.', args: [arg('path', 'string', 'the path')] })
const WRITE = tool({ name: 'write_file', description: 'Write a file.', args: [arg('path', 'string', 'the path')], mutates: true })

/** An agent one model call into `t-1`, with that call recorded as in flight. */
function asking() {
  return step({ ...newAgentState(), toolbox: [READ, WRITE], card: CARD }, {
    at: AT, turnId: 't-1', fact: { type: 'user_message', text: 'read a.md', agent: 'main', from: 'person' },
  })
}

/** @param {string} name @param {string} id */
function invoking(name, id) {
  const asked = asking()
  return step(asked.state, {
    at: AT, turnId: 't-1',
    fact: { type: 'model_replied', agent: 'main', text: '', reasoning: '', finish: 'tool_calls' },
    reply: { calls: [{ id, tool: name, args: '{"path":"a.md"}' }], finish: 'tool_calls' },
  })
}

/** @param {Effect[]} effects @returns {string} */
function ending(effects) {
  const found = effects.find((e) => e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === ENDED)
  if (found?.type !== 'Emit' || found.fact.type !== 'custom') throw new Error('nothing ended')
  return endedWhy(found.fact.payload)
}

describe('a turn a reload landed in the middle of is resumed or ended, and never left in limbo', () => {
  test('a model call in flight is asked again, verbatim, under the same turn', () => {
    const { state, effects } = asking()
    const back = resume(checkpoint(state, effects))
    expect(back.state.turnId).toBe('t-1')
    expect(back.state.awaiting).toBe('model')
    expect(back.effects).toEqual(effects.filter((e) => e.type !== 'Emit'))
  })

  test('a READING tool in flight is re-issued: asking twice changes nothing under it', () => {
    const { state, effects } = invoking('read_file', 'c1')
    const back = resume(checkpoint(state, effects))
    expect(back.effects.map((e) => e.type)).toEqual(['InvokeTool'])
    expect(back.state.awaiting).toBe('tools')
  })

  test('a MUTATING tool in flight ends the turn NAMING the call, so a person knows what to go and check', () => {
    const { state, effects } = invoking('write_file', 'c1')
    const back = resume(checkpoint(state, effects))
    expect(back.state.turnId).toBe('')
    expect(back.state.awaiting).toBeNull()
    expect(ending(back.effects)).toBe(`${INTERRUPTED}: a write_file call was in flight and may already have run`)
  })

  test('a turn that was running with NOTHING recorded in flight ends saying the record lost its effects', () => {
    const { state } = asking()
    const back = resume(checkpoint(state, []))
    expect(ending(back.effects)).toBe(`${INTERRUPTED}: nothing was recorded in flight, so no effect will answer this turn`)
  })

  test('the two interruptions do not read the same: one sends a person to their files, the other to the log', () => {
    const mutating = invoking('write_file', 'c1')
    const wrote = resume(checkpoint(mutating.state, mutating.effects))
    const lost = resume(checkpoint(asking().state, []))
    expect(ending(wrote.effects)).not.toBe(ending(lost.effects))
  })

  test('an idle agent resumes as itself, with nothing outstanding and no ending', () => {
    const back = resume(checkpoint({ ...newAgentState(), card: CARD }, []))
    expect(back.effects).toEqual([])
    expect(back.state.turnId).toBe('')
  })

  test('the record it wrote holds the effects, and nothing it already recorded as a fact', () => {
    const { state, effects } = invoking('write_file', 'c1')
    const written = /** @type {{v: number, inFlight: Effect[]}} */ (JSON.parse(checkpoint(state, effects)))
    expect(written.v).toBe(CHECKPOINT_VERSION)
    expect(written.inFlight.every((e) => e.type !== 'Emit')).toBe(true)
  })

  test('an unreadable checkpoint SAYS so; it is never read as an empty one', () => {
    expect(() => resume('not json')).toThrow(StoreError)
    expect(() => resume(JSON.stringify({ v: 99, state: '{}', inFlight: [] })))
      .toThrow('This checkpoint says version 99, and this build writes 1.')
    expect(() => resume(JSON.stringify({ v: CHECKPOINT_VERSION, state: '{}' })))
      .toThrow('carries no state or no list of effects in flight')
  })
})
