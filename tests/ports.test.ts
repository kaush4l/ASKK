import { describe, expect, test } from 'bun:test'
import { isConfigured, stubPorts } from '@/core/ports'

/**
 * A stub that quietly does nothing is the worst artifact this project can
 * produce, so the four assertions below are on the **literal sentence** each
 * unwired port says about itself, not on the fact that something threw.
 */
describe('stubPorts', () => {
  test('the clock says which port is missing', () => {
    expect(() => stubPorts().clock.now()).toThrow('no clock.now port configured')
  })

  test('fetch says which port is missing', () => {
    expect(() => stubPorts().fetch('https://example.invalid')).toThrow('no fetch port configured')
  })

  test('the store says which port is missing', () => {
    expect(() => stubPorts().store.appendMessage('s1', { role: 'user', content: 'hi', turnId: 't1', at: 0 }))
      .toThrow('no store.appendMessage port configured')
  })

  test('newId says which port is missing', () => {
    expect(() => stubPorts().newId()).toThrow('no newId port configured')
  })

  test('every member of every port names itself', () => {
    const ports = stubPorts()
    const calls: [string, () => unknown][] = [
      ['clock.zone', () => ports.clock.zone()],
      ['store.putSession', () => ports.store.putSession({} as never)],
      ['store.readSession', () => ports.store.readSession('s1')],
      ['store.readMessages', () => ports.store.readMessages('s1')],
      ['store.appendEvent', () => ports.store.appendEvent('s1', 0, { kind: 'x', data: null, at: 0 })],
    ]
    for (const [name, call] of calls) expect(call).toThrow(`no ${name} port configured`)
  })
})

describe('isConfigured', () => {
  test('is false for a stub, which truthiness cannot tell you', () => {
    const ports = stubPorts()
    expect(Boolean(ports.store)).toBe(true)
    expect(isConfigured(ports.store)).toBe(false)
    expect(isConfigured(ports.fetch)).toBe(false)
    expect(isConfigured(ports.clock)).toBe(false)
    expect(isConfigured(ports.newId)).toBe(false)
  })

  test('is true for a wired port and false for an absent one', () => {
    expect(isConfigured(() => 'id-1')).toBe(true)
    expect(isConfigured(undefined)).toBe(false)
    expect(isConfigured(null)).toBe(false)
  })
})
