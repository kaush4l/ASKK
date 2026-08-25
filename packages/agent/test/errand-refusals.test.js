import { expect, test, describe } from 'bun:test'
import { ERRAND_PROTOCOL } from '@harness/agent'
import { DelegateError } from '@harness/kernel'
import { portOver, workerFor } from './worker.js'

describe('what the lead refuses, and the Worker it does not leave running', () => {
  test('a signal already aborted refuses BEFORE a Worker is opened', async () => {
    const scout = workerFor('scout')
    const { port } = portOver({ scout })
    // An already-aborted signal fires no `abort` event, so a channel opened
    // first would be a Worker nothing is left to close.
    const cause = await port.delegate('scout', 'go', { signal: AbortSignal.abort() }).catch((thrown) => thrown)
    if (!(cause instanceof DelegateError)) throw cause
    expect(cause.kind).toBe('abandoned')
    expect(cause.message).toContain('before that errand was sent')
    expect(scout.state().turnId).toBe('')
    expect(scout.closed()).toBe(0)
  })

  test('a Worker speaking another protocol is refused in words, and its channel closes', async () => {
    const scout = workerFor('scout')
    const { port } = portOver({ scout })
    const finding = port.delegate('scout', 'find it')
    scout.says({ v: 99, type: 'ended', errandId: 'e-1', ok: true, text: 'hi', why: 'answered' })
    const cause = await finding.catch((thrown) => thrown)
    if (!(cause instanceof DelegateError)) throw cause
    expect(cause.kind).toBe('unreadable')
    expect(cause.message).toContain(`this errand speaks protocol ${ERRAND_PROTOCOL} and the message says 99`)
    expect(scout.closed()).toBe(1)
  })

  test('an ending naming ANOTHER errand is a confused Worker, not a message to ignore', async () => {
    const scout = workerFor('scout')
    const { port } = portOver({ scout })
    const finding = port.delegate('scout', 'find it')
    // This channel carries exactly one errand. Returning silently here is a
    // caller that waits forever with nothing written down anywhere (I16).
    scout.says({ v: ERRAND_PROTOCOL, type: 'ended', errandId: 'e-9', ok: true, text: 'found it', why: 'answered' })
    const cause = await finding.catch((thrown) => thrown)
    if (!(cause instanceof DelegateError)) throw cause
    expect(cause.kind).toBe('unreadable')
    expect(cause.message).toBe('scout answered errand e-9 on the channel carrying e-1.')
    expect(scout.closed()).toBe(1)
  })
})
