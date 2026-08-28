import { describe, expect, test } from 'bun:test'
import { stubPorts } from '@/core/ports'

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
