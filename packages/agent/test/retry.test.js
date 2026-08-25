import { expect, test, describe } from 'bun:test'
import {
  DROPPED, EFFECT_FAILED, ENDED, MAX_ATTEMPTS, STALLED, arg, backoffMs, endedWhy,
  failureIn, newAgentState, step, tool,
} from '@harness/agent'
import { CARD } from './card.js'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Effect} Effect */
/** @typedef {import('@harness/agent').Incoming} Incoming */

const AT = 1_700_000_000_000
const EXEC = tool({ name: 'exec', description: 'Run a command.', args: [arg('command', 'string', 'the command')], evidence: true })

/** @param {string} text @param {string} turnId @returns {Incoming} */
const said = (text, turnId) => ({ at: AT, turnId, fact: { type: 'user_message', text, agent: 'main', from: 'person' } })

/** @param {{effect: string, reason?: string}} of @param {string} turnId @param {string} [callId] @returns {Incoming} */
const failed = (of, turnId, callId) => ({
  at: AT, turnId, callId,
  fact: { type: 'custom', kind: EFFECT_FAILED, payload: of },
})

/** @param {string} text @param {string} finish @param {Array<{id: string, tool: string, args: string}>} calls @returns {Incoming} */
const replied = (text, finish, calls = []) => ({
  at: AT, turnId: 't-1',
  fact: { type: 'model_replied', agent: 'main', text, reasoning: '', finish },
  reply: { calls, finish: /** @type {import('@harness/agent').FinishReason} */ (finish) },
})

/** An agent one model call into `t-1`. @returns {AgentState} */
function asking() {
  return step({ ...newAgentState(), toolbox: [EXEC], card: CARD, model: 'local' }, said('run it', 't-1')).state
}

/** @param {Effect[]} effects @returns {{afterMs: number}} */
function call(effects) {
  const found = effects.find((e) => e.type === 'CallModel')
  if (found?.type !== 'CallModel') throw new Error('no model call was asked for')
  return found
}

/** @param {Effect[]} effects @returns {string} */
function ending(effects) {
  const found = effects.find((e) => e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === ENDED)
  if (found?.type !== 'Emit' || found.fact.type !== 'custom') throw new Error('nothing ended')
  return endedWhy(found.fact.payload)
}

describe('a failed effect is a fact the reducer folds, and the retry is its decision', () => {
  test('a failed model call is asked AGAIN, after a wait, and the wait grows', () => {
    const one = step(asking(), failed({ effect: 'CallModel', reason: '502 from the proxy' }, 't-1'))
    expect(one.state.awaiting).toBe('model')
    expect(one.state.attempts).toBe(1)
    expect(call(one.effects).afterMs).toBe(backoffMs(1))

    const two = step(one.state, failed({ effect: 'CallModel', reason: '502 from the proxy' }, 't-1'))
    expect(call(two.effects).afterMs).toBe(backoffMs(2))
    expect(backoffMs(2)).toBeGreaterThan(backoffMs(1))
  })

  test('past the ceiling the turn ends QUOTING what the driver read, and asks for nothing more', () => {
    let state = asking()
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      state = step(state, failed({ effect: 'CallModel', reason: 'connection refused' }, 't-1')).state
    }
    const last = step(state, failed({ effect: 'CallModel', reason: 'connection refused' }, 't-1'))
    expect(last.effects.some((e) => e.type === 'CallModel')).toBe(false)
    expect(ending(last.effects)).toBe('failed: connection refused')
    expect(last.state.turnId).toBe('')
  })

  test('a failed TOOL drains the round it belongs to, and the model reads why on its next line', () => {
    const round = step(asking(), replied('', 'tool_calls', [{ id: 'c1', tool: 'exec', args: '{"command":"ls"}' }]))
    expect(round.state.awaiting).toBe('tools')
    const drained = step(round.state, failed({ effect: 'InvokeTool', reason: 'the runner timed out' }, 't-1', 'c1'))
    expect(drained.state.awaiting).toBe('model')
    expect(drained.state.observations.join('\n')).toContain('the runner timed out')
    expect(call(drained.effects).afterMs).toBe(0)
  })

  test('a failure from an ABANDONED turn is dropped, and never bills a retry (I21)', () => {
    const dead = step(asking(), failed({ effect: 'CallModel', reason: 'gone' }, 't-0'))
    expect(dead.effects.some((e) => e.type === 'CallModel')).toBe(false)
    expect(dead.effects.some((e) => e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === DROPPED)).toBe(true)
  })

  test('a payload naming an effect this loop never queues is not a failure at all', () => {
    expect(failureIn({ type: 'custom', kind: EFFECT_FAILED, payload: { effect: 'Teleport' } })).toBeNull()
    expect(failureIn({ type: 'custom', kind: EFFECT_FAILED, payload: { effect: 'CallModel' } }))
      .toEqual({ effect: 'CallModel', reason: 'the driver did not say why' })
  })
})

describe('two zero-output completions from the same model and signal stop the retry', () => {
  test('the first empty completion is asked again; the second, identical one ends the turn', () => {
    const once = step(asking(), replied('', 'stop'))
    expect(once.state.lastEmpty).toBe('local|stop')
    expect(call(once.effects).afterMs).toBe(backoffMs(1))

    const twice = step(once.state, replied('', 'stop'))
    expect(twice.effects.some((e) => e.type === 'CallModel')).toBe(false)
    expect(ending(twice.effects)).toBe(STALLED)
  })

  test('a DIFFERENT signal is a different failure, and is asked again rather than stopped', () => {
    const once = step(asking(), replied('', 'stop'))
    const other = step(once.state, replied('', 'length'))
    expect(other.state.lastEmpty).toBe('local|length')
    expect(other.effects.some((e) => e.type === 'CallModel')).toBe(true)
  })

  test('a ROTATING signal never repeats the signature, and the retry ceiling ends the turn anyway', () => {
    const one = step(asking(), replied('', 'stop'))
    const two = step(one.state, replied('', 'length'))
    const three = step(two.state, replied('', 'content_filter'))
    expect(three.effects.some((e) => e.type === 'CallModel')).toBe(true)
    expect(three.state.attempts).toBe(3)

    const four = step(three.state, replied('', 'refusal'))
    expect(four.effects.some((e) => e.type === 'CallModel')).toBe(false)
    expect(ending(four.effects)).toBe(STALLED)
    expect(MAX_ATTEMPTS).toBe(3)
  })

  test('a reply that SAID something is an answer and never a stall, however it finished', () => {
    const answered = step(asking(), replied('here you go', 'stop'))
    expect(ending(answered.effects)).toBe('answered')
  })
})
