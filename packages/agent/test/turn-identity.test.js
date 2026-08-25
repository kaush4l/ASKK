import { expect, test, describe } from 'bun:test'
import { DROPPED, ENDED, STOPPED, STOP_REQUESTED, newAgentState, step } from '@harness/agent'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Incoming} Incoming */
/** @typedef {import('@harness/agent').Effect} Effect */

const AT = 1_700_000_000_000

/** @param {string} text @param {string} turnId @returns {Incoming} */
const said = (text, turnId) => ({ at: AT, turnId, fact: { type: 'user_message', text, agent: 'main', from: 'person' } })

/** @param {string} turnId @param {Array<{id: string, tool: string, args: string}>} calls @returns {Incoming} */
const replied = (turnId, calls) => ({
  at: AT, turnId,
  fact: { type: 'model_replied', agent: 'main', text: '', reasoning: '' },
  reply: { calls, finish: /** @type {const} */ ('tool_calls') },
})

/** @param {string} turnId @returns {Incoming} */
const ran = (turnId) => ({
  at: AT, turnId,
  fact: { type: 'tool_invoked', agent: 'main', tool: 'exec', args: '{}', ok: true, output: 'done' },
})

const CALL = { id: 'c1', tool: 'exec', args: '{"command":"ls"}' }

/** @type {Incoming} */
const stopPressed = { at: AT, turnId: null, fact: { type: 'custom', kind: STOP_REQUESTED, payload: null } }

/** An agent inside `turn-1`, with one tool result outstanding. */
function working() {
  const asked = step(newAgentState(), said('do the thing', 'turn-1'))
  return step(asked.state, replied('turn-1', [CALL])).state
}

/**
 * `turn-1`, worked and answered. The state a LATE copy of its tool result lands
 * against — a Worker that posted twice, a driver that retried a delivery, or
 * simply a result that outlived the turn. The Rust reached the same place from
 * OUTSIDE the reducer, where two sites cleared `agent.task` (`requests.rs:83`,
 * `failure/card.rs:129`) while `on_tool_result` went on counting.
 */
function answered() {
  const round = step(working(), ran('turn-1'))
  return step(round.state, replied('turn-1', [])).state
}

/** @param {Effect[]} effects @param {string} kind */
function emitted(effects, kind) {
  return effects.some((e) => e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === kind)
}

/** The sentence the reducer recorded about what it refused. @param {Effect[]} effects @returns {string} */
function whyDropped(effects) {
  const record = effects.find((e) => e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === DROPPED)
  if (record?.type !== 'Emit' || record.fact.type !== 'custom') throw new Error('nothing was dropped')
  return String(/** @type {Record<string, unknown>} */ (record.fact.payload).why)
}

describe('I21 — a fact answers the turn it was queued under, or it answers nothing', () => {
  test('a result from an ABANDONED turn is dropped and logged, and never bills a model call', () => {
    const over = answered()
    expect(over.turnId).toBe('')

    const straggler = step(over, ran('turn-1'))
    expect(straggler.effects.some((e) => e.type === 'CallModel')).toBe(false)
    expect(straggler.effects.some((e) => e.type === 'InvokeTool')).toBe(false)
    expect(emitted(straggler.effects, DROPPED)).toBe(true)
    expect(whyDropped(straggler.effects)).toBe('no turn is running')
    expect(straggler.state).toEqual(over)
  })

  test('a straggler cannot answer the turn that REPLACED its own: it names turn-1, and turn-2 is running', () => {
    const next = step(answered(), said('do this instead', 'turn-2'))
    expect(next.state.turnId).toBe('turn-2')
    expect(next.state.awaiting).toBe('model')

    const straggler = step(next.state, ran('turn-1'))
    expect(straggler.effects.some((e) => e.type === 'CallModel')).toBe(false)
    expect(straggler.state).toEqual(next.state)
    expect(whyDropped(straggler.effects)).toContain('turn-2 is the one running')
  })

  test('a result arriving with nothing outstanding is an anomaly, not a fresh request', () => {
    const idle = step(newAgentState(), ran('turn-1'))
    expect(idle.effects).toHaveLength(1)
    expect(emitted(idle.effects, DROPPED)).toBe(true)
    expect(idle.state.pendingTools).toBe(0)
  })

  test('a duplicate result cannot drive the counter below zero — it is refused by name', () => {
    const first = step(working(), ran('turn-1'))
    expect(first.state.pendingTools).toBe(0)
    const duplicate = step(first.state, ran('turn-1'))
    expect(emitted(duplicate.effects, DROPPED)).toBe(true)
    expect(duplicate.state.pendingTools).toBe(0)
  })

  test('a model reply arriving while TOOLS are outstanding is refused: the turn awaits results, not prose', () => {
    const confused = step(working(), replied('turn-1', []))
    expect(emitted(confused.effects, ENDED)).toBe(false)
    expect(emitted(confused.effects, DROPPED)).toBe(true)
  })

  test('every effect a live turn produces is stamped with that turn', () => {
    const asked = step(newAgentState(), said('do the thing', 'turn-1'))
    const acting = step(asked.state, replied('turn-1', [CALL, { ...CALL, id: 'c2' }]))
    for (const effect of [...asked.effects, ...acting.effects]) {
      if (effect.type === 'Emit') continue
      expect(effect.turnId).toBe('turn-1')
    }
  })
})

describe('the stop', () => {
  test('Stop takes only on a running turn, and halts it at the next thing it tried to start', () => {
    const stopping = step(working(), stopPressed)
    expect(stopping.state.stopping).toBe(true)
    expect(stopping.effects).toEqual([])

    const halted = step(stopping.state, ran('turn-1'))
    expect(halted.state.turnId).toBe('')
    expect(halted.state.task).toBe(null)
    expect(emitted(halted.effects, STOPPED)).toBe(true)
    expect(halted.effects.some((e) => e.type === 'CallModel')).toBe(false)
  })

  test('Stop pressed on an idle agent takes nothing: there is no next turn to cut off', () => {
    const { state } = step(newAgentState(), stopPressed)
    expect(state.stopping).toBe(false)
  })
})

describe('the reducer is the only writer, and it does no I/O', () => {
  test('a frozen snapshot goes in and a new state comes out — an out-of-band write is impossible', () => {
    const before = deepFreeze(working())
    const after = step(before, ran('turn-1'))
    expect(after.state).not.toBe(before)
    expect(after.state.pendingTools).toBe(0)
    expect(before.pendingTools).toBe(1)
    expect(after.state.observations).not.toBe(before.observations)
  })

  test('step performs no I/O: the clock, the dice and the network throw for the length of the call (I3, I7)', () => {
    const real = { now: Date.now, random: Math.random, fetch: globalThis.fetch }
    const forbid = /** @param {string} what */ (what) => () => { throw new Error(`step reached for ${what}`) }
    Date.now = forbid('the clock')
    Math.random = forbid('the dice')
    globalThis.fetch = /** @type {typeof fetch} */ (/** @type {unknown} */ (forbid('the network')))
    try {
      const asked = step(newAgentState(), said('do the thing', 'turn-1'))
      const acting = step(asked.state, replied('turn-1', [CALL]))
      expect(step(acting.state, ran('turn-1')).effects).toHaveLength(1)
    } finally {
      Date.now = real.now
      Math.random = real.random
      globalThis.fetch = real.fetch
    }
  })
})

/** @template {object} T @param {T} value @returns {T} */
function deepFreeze(value) {
  for (const held of Object.values(value)) {
    if (held !== null && typeof held === 'object') deepFreeze(held)
  }
  return Object.freeze(value)
}
