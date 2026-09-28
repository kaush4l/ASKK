import { expect, test } from 'bun:test'
import { createTerminalSnapshotWriter } from '../src/workbench/terminal-writer.js'

function sink() {
  const callbacks = []; const writes = []; let text = ''; let resets = 0
  return {
    terminal: { write(part, done) { writes.push(part); callbacks.push(() => { text += part; done() }) }, reset() { text = ''; resets++ } },
    writes, callbacks,
    acknowledge() { callbacks.shift()?.() },
    drain() { let limit = 10000; while (callbacks.length && limit--) callbacks.shift()(); if (!limit) throw new Error('Writer failed to drain') },
    get text() { return text }, get resets() { return resets },
  }
}

test('large restoration uses one acknowledged chunk at a time and preserves exact Unicode and ANSI input', () => {
  const io = sink(); const writer = createTerminalSnapshotWriter(io.terminal, { chunkSize: 4, maxPendingCharacters: 1000 })
  const source = 'abc😀\u001b[31mcolored\u001b[0m\n'.repeat(10)
  writer.update(source, source.length)
  expect(io.writes).toEqual(['abc'])
  expect(io.callbacks).toHaveLength(1)
  while (io.callbacks.length) {
    expect(io.callbacks).toHaveLength(1)
    expect(writer.getState().inFlightCharacters).toBeLessThanOrEqual(4)
    io.acknowledge()
  }
  expect(io.writes.join('')).toBe(source)
  expect(io.writes.every(part => !/[\uD800-\uDBFF]$/.test(part))).toBe(true)
  expect(io.text).toBe(source)
  expect(writer.getState()).toMatchObject({ pendingCharacters: 0, inFlightCharacters: 0 })
})

test('appends received during restoration retain original stream ordering', () => {
  const io = sink(); const writer = createTerminalSnapshotWriter(io.terminal, { chunkSize: 4, maxPendingCharacters: 100 })
  writer.update('12345678', 8)
  writer.update('345678abcd', 12)
  writer.update('78abcdef', 14)
  io.drain()
  expect(io.text).toBe('12345678abcdef')
  expect(io.resets).toBe(0)
})

test('identical retained text still delivers new repeated chunks using total count', () => {
  const io = sink(); const writer = createTerminalSnapshotWriter(io.terminal, { chunkSize: 4, maxPendingCharacters: 100 })
  writer.update('abababab', 8); writer.update('abababab', 12); writer.update('abababab', 16)
  io.drain()
  expect(io.text).toBe('abababababababab')
})

test('replacement waits for the single in-flight chunk and discards all stale pending text', () => {
  const io = sink(); const writer = createTerminalSnapshotWriter(io.terminal, { chunkSize: 4, maxPendingCharacters: 100 })
  writer.update('old-output-has-not-drained', 26)
  writer.update('replacement', 11)
  expect(io.resets).toBe(0)
  expect(io.writes).toEqual(['old-'])
  io.acknowledge()
  expect(io.resets).toBe(1)
  expect(io.writes).toEqual(['old-', 'repl'])
  writer.update('replacement plus', 16)
  io.drain()
  expect(io.text).toBe('replacement plus')
})

test('clear and counter reset cannot be followed by old queued output', () => {
  const io = sink(); const writer = createTerminalSnapshotWriter(io.terminal, { chunkSize: 4, maxPendingCharacters: 100 })
  writer.update('abcdefgh', 8); writer.update('', 0); io.drain()
  expect(io.text).toBe(''); expect(io.writes).toEqual(['abcd'])
  writer.update('aaaa', 4); io.drain()
  writer.update('aaaa', 2); io.drain()
  expect(io.text).toBe('aaaa')
  expect(io.resets).toBe(2)
})

test('overloaded delivery rebases to the exact retained snapshot with bounded pending data', () => {
  const io = sink(); const writer = createTerminalSnapshotWriter(io.terminal, { chunkSize: 4, maxPendingCharacters: 12 })
  writer.update('abcdefghijkl', 12)
  writer.update('ghijklmnopqr', 18)
  expect(writer.getState()).toMatchObject({ pendingCharacters: 12, inFlightCharacters: 4, needsReset: true })
  writer.update('opqrstuvwxyz', 26)
  expect(writer.getState().pendingCharacters).toBeLessThanOrEqual(12)
  io.drain()
  expect(io.text).toBe('opqrstuvwxyz')
  expect(io.resets).toBe(1)
})

test('dispose stops pumping, and a fresh session has no counters or queued data from the previous one', () => {
  const io = sink(); const writer = createTerminalSnapshotWriter(io.terminal, { chunkSize: 4, maxPendingCharacters: 100 })
  writer.update('old old old', 11); writer.dispose(); writer.update('ignored', 7); io.drain()
  expect(io.writes).toEqual(['old '])
  expect(writer.getState()).toMatchObject({ disposed: true, pendingCharacters: 0, inFlightCharacters: 0 })
  const next = sink(); const fresh = createTerminalSnapshotWriter(next.terminal, { chunkSize: 4, maxPendingCharacters: 100 })
  fresh.update('restored', 8); next.drain()
  expect(next.text).toBe('restored')
})

test('oversized snapshot fails before changing the accepted queue', () => {
  const io = sink(); const writer = createTerminalSnapshotWriter(io.terminal, { chunkSize: 4, maxPendingCharacters: 8 })
  writer.update('original', 8)
  expect(() => writer.update('too much output', 15)).toThrow('delivery limit')
  io.drain(); expect(io.text).toBe('original')
})
