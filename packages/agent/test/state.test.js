import { expect, test, describe } from 'bun:test'
import { StoreError } from '@harness/kernel'
import {
  newAgentState, serializeAgentState, restoreAgentState,
  EFFECT_TYPES, callModel, invokeTool, emit, delegate,
  NO_TOOLS, ALL_TOOLS, onlyTools, grant, WORK,
} from '@harness/agent'

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

  test('the four counters the Rust carried and never read are gone', () => {
    const fresh = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (newAgentState()))
    for (const dead of ['plan', 'cursor', 'retries', 'replans', 'phase']) {
      expect(dead in fresh).toBe(false)
    }
  })
})

describe('effects', () => {
  /** @type {import('@harness/agent').Effect[]} */
  const every = [
    callModel({
      document: { sections: [] },
      format: { target: 'openai', vision: false, audio: false },
      endpoint: 'model',
      model: 'local-small',
      temperature: 0.2,
      speaker: 'summarizer',
    }),
    invokeTool('exec', '{"command":"ls"}'),
    emit({ type: 'custom', kind: 'stop_requested', payload: null }),
    delegate('scout', 'find the failing test', 1),
  ]

  test('every variant survives being written down and read back', () => {
    for (const effect of every) {
      expect(JSON.parse(JSON.stringify(effect))).toEqual(effect)
    }
  })

  test('the union is closed: the constructors produce exactly the declared types', () => {
    expect(every.map((e) => e.type).sort()).toEqual([...EFFECT_TYPES].sort())
  })

  test('a model call that names no model or temperature says so as data, not as absence', () => {
    const call = callModel({
      document: { sections: [] },
      format: { target: 'openai', vision: false, audio: false },
      endpoint: 'model',
    })
    expect(call).toEqual({
      type: 'CallModel',
      document: { sections: [] },
      format: { target: 'openai', vision: false, audio: false },
      endpoint: 'model',
      model: '',
      temperature: null,
      speaker: '',
    })
  })
})

describe('a phase grants tools', () => {
  const toolbox = [{ name: 'exec' }, { name: 'read_file' }, { name: 'write_file' }]

  test('none yields an empty toolbox, so a phase that may not act cannot name a tool', () => {
    expect(grant(NO_TOOLS, toolbox)).toEqual([])
  })

  test('all yields whatever this agent was given, and does not alias it', () => {
    const granted = grant(ALL_TOOLS, toolbox)
    expect(granted).toEqual(toolbox)
    expect(granted).not.toBe(toolbox)
  })

  test('only yields exactly the named tools, in the TOOLBOX order the agent file set', () => {
    expect(grant(onlyTools(['write_file', 'exec']), toolbox)).toEqual([{ name: 'exec' }, { name: 'write_file' }])
  })

  test('naming a tool this agent does not hold grants nothing rather than inventing it', () => {
    expect(grant(onlyTools(['launch_missiles']), toolbox)).toEqual([])
  })

  test('the one working phase asks for an envelope, this agent’s whole toolbox, and 8192 tokens', () => {
    expect(WORK.contract).toBe('tool_envelope')
    expect(grant(WORK.tools, toolbox)).toEqual(toolbox)
    expect(WORK.budget.maxTokens).toBe(8192)
  })
})
