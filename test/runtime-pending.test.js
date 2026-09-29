import { test, expect } from 'bun:test'
import { Hub } from '../src/runtime/hub.js'

const contract = { checks: [{ capability: 'workspace.commands', options: { commands: ['test a', 'test b'] } }] }

test('pending inspection uses current run adapters without publishing or persisting verification', async () => {
  const run = { id: 'own', completion: contract, completionReceipts: [], context: { workflow: { completion: contract } } }
  const calls = []
  const hub = { completionAdapters: { 'workspace.commands': (options, received) => {
    expect(received).toBe(run)
    calls.push(options.commands)
    return { ok: options.commands[0] === 'test a', reason: 'current source needs test b' }
  } }, persist: () => { throw new Error('must not persist') }, publish: () => { throw new Error('must not publish') } }
  expect(await Hub.prototype.pendingCommands.call(hub, run)).toEqual([{ requiredCheck: 1, reason: 'current source needs test b' }])
  expect(calls).toEqual([['test a'], ['test b']])
  expect(run.completionReceipts).toEqual([])
  run.completion = { checks: [] }
  expect(await Hub.prototype.pendingCommands.call(hub, run)).toEqual([])
  expect(calls).toHaveLength(2)
  for (const flag of ['ended', 'cancelRequested']) {
    run[flag] = true
    await expect(Hub.prototype.pendingCommands.call(hub, run)).rejects.toThrow('cancelled')
    run[flag] = false
  }
  hub.disposed = true
  await expect(Hub.prototype.pendingCommands.call(hub, run)).rejects.toThrow('cancelled')
})
