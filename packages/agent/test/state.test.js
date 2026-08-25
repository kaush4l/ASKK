import { expect, test, describe } from 'bun:test'
import { StoreError } from '@harness/kernel'
import { newAgentState, serializeAgentState, restoreAgentState } from '@harness/agent'

/** A stored record with one field edited, so a test says what it changed and nothing else. */
function stored(/** @type {Record<string, unknown>} */ edits) {
  return JSON.stringify({ ...newAgentState(), ...edits })
}

describe('agent state', () => {
  test('a fresh state survives the round trip byte for byte', () => {
    const fresh = newAgentState()
    const restored = restoreAgentState(serializeAgentState(fresh))
    expect(restored).toEqual(fresh)
    expect(serializeAgentState(restored)).toBe(serializeAgentState(fresh))
  })

  test('a record written before a field existed loads with that field defaulted', () => {
    const older = /** @type {Record<string, unknown>} */ (JSON.parse(stored({})))
    delete older.nudges
    delete older.faculties
    const restored = restoreAgentState(JSON.stringify(older))
    expect(restored.nudges).toBe(0)
    expect(restored.faculties).toEqual([])
  })

  test('a key this build has no field for is refused BY NAME, never dropped', () => {
    const newer = stored({ enthusiasm: 11 })
    expect(() => restoreAgentState(newer)).toThrow(/"enthusiasm"/)
    try {
      restoreAgentState(newer)
    } catch (err) {
      expect(err).toBeInstanceOf(StoreError)
      expect(/** @type {StoreError} */ (err).kind).toBe('corrupt')
      expect(/** @type {StoreError} */ (err).key).toBe('enthusiasm')
    }
  })

  test('a key of the wrong shape is refused, saying what it holds and what was expected', () => {
    expect(() => restoreAgentState(stored({ toolRounds: 'three' })))
      .toThrow('This agent state holds "toolRounds" as string, and this build reads it as number.')
  })

  test('an array where an object belongs is caught — one typeof would let it through', () => {
    expect(() => restoreAgentState(stored({ senses: [] }))).toThrow(/"senses" as array/)
  })

  test('a nullable field loads at either half of its union', () => {
    expect(restoreAgentState(stored({ task: null })).task).toBeNull()
    expect(restoreAgentState(stored({ task: 'summarise the folder' })).task).toBe('summarise the folder')
    expect(restoreAgentState(stored({ reviewed: false })).reviewed).toBe(false)
    expect(() => restoreAgentState(stored({ task: 7 }))).toThrow(/"task" as number/)
  })

  test('two agents that sensed the same things write the same bytes, whatever order the host wrote them in', () => {
    const one = newAgentState()
    const other = newAgentState()
    one.senses = { space: [{ text: 'a' }], memory: [{ text: 'b' }] }
    other.senses = { memory: [{ text: 'b' }], space: [{ text: 'a' }] }
    one.briefs = { work: 'act', plan: 'think' }
    other.briefs = { plan: 'think', work: 'act' }
    expect(serializeAgentState(one)).toBe(serializeAgentState(other))
  })

  test('a record that is not JSON says so instead of returning an empty agent', () => {
    expect(() => restoreAgentState('{ not json')).toThrow('is not JSON')
    expect(() => restoreAgentState('[]')).toThrow('is array where a record was expected')
  })

  test('a key that only Object.prototype has is refused BY NAME, not silently dropped (I18)', () => {
    // Spelled as text: `__proto__` written as a literal key sets a prototype instead of a field,
    // and it is exactly the key `in` would have answered "this build has that" for.
    const record = `{"__proto__":{"pwned":1},${stored({}).slice(1)}`
    expect(() => restoreAgentState(record)).toThrow(/"__proto__"/)
    try {
      restoreAgentState(record)
    } catch (err) {
      expect(/** @type {StoreError} */ (err).key).toBe('__proto__')
    }
  })

  test('a key inherited from Object.prototype is refused without quoting a native function at the reader', () => {
    const record = `{"toString":"x",${stored({}).slice(1)}`
    expect(() => restoreAgentState(record)).toThrow(/"toString"/)
    try {
      restoreAgentState(record)
    } catch (err) {
      expect(/** @type {Error} */ (err).message).not.toContain('[native code]')
    }
  })

  test('a compound field missing a member is refused at that MEMBER, not waved past as an object', () => {
    expect(() => restoreAgentState(stored({ standing: {} })))
      .toThrow('This agent state holds "standing.goal" as undefined, and this build reads it as object.')
    expect(() => restoreAgentState(stored({ standing: { goal: { outcome: 'a', check: 'b' }, checking: false, met: null } })))
      .toThrow(/"standing\.goal\.doneWhen" as undefined/)
    expect(() => restoreAgentState(stored({ space: {} }))).toThrow(/"space\.name" as undefined/)
  })

  test('a list is checked through its elements — the loop reads a tool by name and would find none', () => {
    expect(() => restoreAgentState(stored({ toolbox: [1, 2, 3] }))).toThrow(/"toolbox\[0\]" as number/)
    expect(() => restoreAgentState(stored({ toolbox: [{ name: 'exec' }, { rank: 2 }] })))
      .toThrow(/"toolbox\[1\]\.name" as undefined/)
    expect(() => restoreAgentState(stored({ stages: ['plan', 3] }))).toThrow(/"stages\[1\]" as number/)
    expect(() => restoreAgentState(stored({ senses: { space: 'not-an-array' } })))
      .toThrow(/"senses\.space" as string/)
  })

  test('a filled compound still loads, so the depth check refuses shapes and not content', () => {
    const live = restoreAgentState(stored({
      standing: { goal: { outcome: 'ship', check: 'bun run gate', doneWhen: 'green' }, checking: true, met: null },
      space: { name: 'work', facts: [['a', 'b']], notes: ['n'] },
      toolbox: [{ name: 'exec' }],
      senses: { space: [{ text: 'a' }] },
    }))
    expect(live.standing.goal.doneWhen).toBe('green')
    expect(live.space?.name).toBe('work')
  })

  test('the four counters the Rust carried and never read are gone', () => {
    const fresh = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (newAgentState()))
    for (const dead of ['plan', 'cursor', 'retries', 'replans', 'phase']) {
      expect(dead in fresh).toBe(false)
    }
  })
})
