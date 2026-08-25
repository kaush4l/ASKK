import { expect, test } from 'bun:test'

import { CAPABILITIES, get, post } from '@harness/kernel'
import { fakeClock, testPorts } from '@harness/adapters-test'
import { bootFresh } from '@harness/core'
import { attach } from '@harness/adapters-web'

import { memorySegments } from './doubles.js'

function built() {
  const segments = memorySegments()
  const app = bootFresh({
    ports: testPorts({ clock: fakeClock(), script: [{ text: 'hello back' }] }),
    available: [...CAPABILITIES],
    segments,
  })
  return { app, segments, ...attach(app) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('the seam is the only door, and it answers a projection', () => {
  const { seam } = built()
  expect(seam(get('/chat')).view).toBe('chat')
  expect(seam(get('/nowhere')).status).toBe(404)
})

test('subscribe fires when the log has GROWN, and not when it has not', async () => {
  const { seam, subscribe } = built()
  let woken = 0
  subscribe(() => (woken += 1))
  seam(get('/chat'))
  await settle()
  expect(woken).toBe(0)
  seam(post('/chat', { message: 'hi' }))
  await settle()
  expect(woken).toBe(1)
})

test('unsubscribing stops the signal', async () => {
  const { seam, subscribe } = built()
  let woken = 0
  const stop = subscribe(() => (woken += 1))
  stop()
  seam(post('/chat', { message: 'hi' }))
  await settle()
  expect(woken).toBe(0)
})

test('run drains what the request queued, and the facts reach the store', async () => {
  const { app, seam, run, segments } = built()
  seam(post('/chat', { message: 'hi' }))
  expect(app.pending.length).toBeGreaterThan(0)
  await run()
  expect(app.pending.length).toBe(0)
  expect(app.log.unpersisted).toBe(0)
  expect(segments.all()).toContain('hello back')
})

test('a second run while one is in flight joins it instead of starting a second driver', async () => {
  const { seam, run } = built()
  seam(post('/chat', { message: 'hi' }))
  const first = run()
  expect(run()).toBe(first)
  await first
})
