import { expect, test, describe } from 'bun:test'
import { StoreError, DelegateError, NetError } from '@harness/kernel'
import { testPorts, memoryKv, scriptedModel, fakeAgents, fakeNet, fakeWorkspace, fakeClock } from '@harness/adapters-test'

describe('memory kv', () => {
  test('replacePrefix swaps the whole namespace, leaving neighbours alone', async () => {
    const kv = memoryKv()
    await kv.put('events/0', 'a')
    await kv.put('events/1', 'b')
    await kv.put('settings/model', 'local')
    await kv.replacePrefix('events/', [['events/0', 'c']])
    expect(await kv.listPrefix('events/')).toEqual(['events/0'])
    expect(await kv.get('events/0')).toBe('c')
    expect(await kv.get('settings/model')).toBe('local')
  })

  test('a quota failure can be scripted, so the surfacing of it has a test', async () => {
    const kv = memoryKv({ fail: (k) => (k === 'big' ? new StoreError('quota', 'out of room', { key: k }) : null) })
    await kv.put('small', 'x')
    expect(kv.put('big', 'y')).rejects.toThrow('out of room')
  })
})

describe('scripted model', () => {
  test('answers in order, records every body, and streams when asked', async () => {
    const model = scriptedModel([
      { calls: [{ tool: 'now', args: '{}' }] },
      { text: 'it is noon', usage: { inputTokens: 10, outputTokens: 3, cachedInputTokens: null } },
    ])
    /** @type {string[]} */
    const deltas = []
    const first = await model.call('model', { messages: [] })
    expect(first.calls[0]?.tool).toBe('now')
    const second = await model.call('model', { messages: [] }, { onDelta: (d) => d.text && deltas.push(d.text) })
    expect(second.text).toBe('it is noon')
    expect(deltas).toEqual(['it is noon'])
    expect(model.calls).toHaveLength(2)
    expect(model.remaining()).toBe(0)
  })

  test('running out of script is a failure, not a silent empty answer', () => {
    expect(scriptedModel([]).call('model', {})).rejects.toThrow('the script ran out')
  })
})

describe('the rest of the world', () => {
  test('an unlisted route is refused rather than answered empty', () => {
    expect(fakeNet().fetch('search', { method: 'GET', path: '/q' })).rejects.toBeInstanceOf(NetError)
  })

  test('delegating to a name nobody defined is unknown_agent', () => {
    expect(fakeAgents({ scout: 'found it' }).delegate('ghost', 'go')).rejects.toBeInstanceOf(DelegateError)
  })

  test('the workspace reads a window and says when it truncated', async () => {
    const ws = fakeWorkspace({ files: { '/a.txt': 'one\ntwo\nthree\nfour' } })
    const read = await ws.read('/a.txt', { offset: 1, limit: 2 })
    expect(read.text).toBe('two\nthree')
    expect(read.truncated).toBe(true)
    expect(read.lines).toBe(4)
    expect(ws.durable()).toBe(false)
  })
})

describe('injected time', () => {
  test('advances on every read, so ordered facts get ordered timestamps', () => {
    const clock = fakeClock({ start: 100, step: 5 })
    expect([clock.now(), clock.now()]).toEqual([100, 105])
    clock.advance(1000)
    expect(clock.now()).toBe(1110)
  })
})

describe('testPorts', () => {
  test('gives every port at once and lets one be swapped', () => {
    const ports = testPorts({ script: [{ text: 'hi' }] })
    expect(Object.keys(ports).sort()).toEqual(
      ['agents', 'clock', 'model', 'net', 'rng', 'spaces', 'store', 'workspace'],
    )
    expect(ports.rng.bytes(3)).toHaveLength(3)
  })
})
