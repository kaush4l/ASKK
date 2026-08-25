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

  test('a dead endpoint costs THREE model calls in one turn, counting the first, and then ends', () => {
    let state = asking()
    // `asking()` already made call one. Every failure after it either asks
    // again or ends, so the calls this loop counts are the ones counted here.
    let calls = 1
    let ended = ''
    for (let i = 0; i < 10 && ended === ''; i += 1) {
      const stepped = step(state, failed({ effect: 'CallModel', reason: 'connection refused' }, 't-1'))
      state = stepped.state
      if (stepped.effects.some((e) => e.type === 'CallModel')) calls += 1
      else ended = ending(stepped.effects)
    }
    expect(calls).toBe(MAX_ATTEMPTS)
    expect(calls).toBe(3)
    expect(ended).toBe('failed: connection refused')
    expect(state.turnId).toBe('')
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

  test('a ROTATING signal never repeats the signature, and the SAME ceiling of three ends the turn', () => {
    // Empty completions and failed effects count on one field, so a provider
    // that returns nothing under a different signal every time is worth the
    // same three calls as one that refuses the connection outright.
    const one = step(asking(), replied('', 'stop'))
    expect(one.effects.some((e) => e.type === 'CallModel')).toBe(true)
    expect(one.state.attempts).toBe(1)

    const two = step(one.state, replied('', 'length'))
    expect(two.effects.some((e) => e.type === 'CallModel')).toBe(true)
    expect(two.state.attempts).toBe(2)

    const three = step(two.state, replied('', 'content_filter'))
    expect(three.effects.some((e) => e.type === 'CallModel')).toBe(false)
    expect(ending(three.effects)).toBe(STALLED)
    expect(MAX_ATTEMPTS).toBe(3)
  })

  test('a reply that SAID something is an answer and never a stall, however it finished', () => {
    const answered = step(asking(), replied('here you go', 'stop'))
    expect(ending(answered.effects)).toBe('answered')
  })

  test('CONSECUTIVE means consecutive: a reply that carried something clears the signature', () => {
    // One blank earlier in the turn used to make the next blank terminal, with
    // no retry at all, however much real work had happened in between.
    const blank = step(asking(), replied('', 'stop'))
    expect(blank.state.lastEmpty).toBe('local|stop')

    const working = step(blank.state, replied('on it', 'tool_calls', [{ id: 'c1', tool: 'exec', args: '{"command":"ls"}' }]))
    expect(working.state.lastEmpty).toBe('')

    const landed = step(working.state, {
      at: AT, turnId: 't-1', callId: 'c1',
      fact: { type: 'tool_invoked', agent: 'main', tool: 'exec', args: '{"command":"ls"}', onBehalfOf: '', ok: true, output: 'a\nb' },
    })
    expect(landed.state.attempts).toBe(0)

    const again = step(landed.state, replied('', 'stop'))
    expect(again.effects.some((e) => e.type === 'CallModel')).toBe(true)
    expect(() => ending(again.effects)).toThrow('nothing ended')
  })
})
