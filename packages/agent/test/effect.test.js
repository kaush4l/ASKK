import { expect, test, describe } from 'bun:test'
import { EFFECT_TYPES, callModel, invokeTool, emit, delegate } from '@harness/agent'

describe('effects', () => {
  /** @type {import('@harness/agent').Effect[]} */
  const every = [
    callModel({
      turnId: 't-1',
      document: { sections: [] },
      format: { target: 'openai', vision: false, audio: false },
      endpoint: 'model',
      model: 'local-small',
      temperature: 0.2,
      speaker: 'summarizer',
    }),
    invokeTool('t-1', 'exec', '{"command":"ls"}'),
    emit({ type: 'custom', kind: 'stop_requested', payload: null }),
    delegate('t-1', 'scout', 'find the failing test', 1),
  ]

  test('every variant survives being written down and read back', () => {
    for (const effect of every) {
      expect(JSON.parse(JSON.stringify(effect))).toEqual(effect)
    }
  })

  test('the union is closed: the constructors produce exactly the declared types', () => {
    expect(every.map((e) => e.type).sort()).toEqual([...EFFECT_TYPES].sort())
  })

  test('an effect queued under one turn still names that turn after being written down (I21)', () => {
    const queued = [
      callModel({
        turnId: 'turn-A',
        document: { sections: [] },
        format: { target: 'openai', vision: false, audio: false },
        endpoint: 'model',
      }),
      invokeTool('turn-A', 'exec', '{"command":"ls"}'),
      delegate('turn-A', 'scout', 'find the failing test', 0),
    ]
    for (const effect of queued) {
      const reloaded = /** @type {import('@harness/agent').Effect} */ (JSON.parse(JSON.stringify(effect)))
      expect(reloaded.type === 'Emit' ? '' : reloaded.turnId).toBe('turn-A')
    }
  })

  test('a model call that names no model or temperature says so as data, not as absence', () => {
    const call = callModel({
      turnId: 't-1',
      document: { sections: [] },
      format: { target: 'openai', vision: false, audio: false },
      endpoint: 'model',
    })
    expect(call).toEqual({
      type: 'CallModel',
      turnId: 't-1',
      document: { sections: [] },
      format: { target: 'openai', vision: false, audio: false },
      endpoint: 'model',
      model: '',
      temperature: null,
      speaker: '',
    })
  })
})
