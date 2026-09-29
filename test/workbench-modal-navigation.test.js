import { expect, test } from 'bun:test'
import { createModalNavigation } from '../src/workbench/modal-navigation.js'
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('out-of-order inspector reads cannot replace the newer selected instance', async () => {
  const values = [], navigation = createModalNavigation(value => values.push(value))
  const first = deferred(), second = deferred()
  const a = navigation.read(() => first.promise), b = navigation.read(() => second.promise)
  second.resolve({ type: 'run', id: 'B' }); expect(await b).toBe(true)
  first.resolve({ type: 'run', id: 'A' }); expect(await a).toBe(false)
  expect(values).toEqual([{ type: 'run', id: 'B' }])
})

test('closing or switching modals while an inspection refresh waits keeps the owner selection', async () => {
  for (const next of [null, { type: 'settings' }, { type: 'agent', id: 'different' }]) {
    const values = [], navigation = createModalNavigation(value => values.push(value)), waiting = deferred()
    navigation.show({ type: 'run', id: 'A' })
    const refresh = navigation.read(() => waiting.promise)
    navigation.show(next); waiting.resolve({ type: 'run', id: 'A', updated: true })
    expect(await refresh).toBe(false); expect(values.at(-1)).toEqual(next); expect(values).toHaveLength(2)
  }
})

test('late errors after navigation are ignored while current errors remain visible to the caller', async () => {
  const values = [], navigation = createModalNavigation(value => values.push(value)), stale = deferred()
  const pending = navigation.read(() => stale.promise); navigation.invalidate()
  stale.reject(new Error('Stale missing run')); expect(await pending).toBe(false)
  await expect(navigation.read(() => Promise.reject(new Error('Current missing run')))).rejects.toThrow('Current missing run')
  expect(values).toEqual([])
})
