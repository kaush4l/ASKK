import { describe, expect, test } from 'bun:test'
import { BackendClient } from '../../src/client/BackendClient.js'
import { CANCEL } from '../../src/protocol/Envelope.js'

/**
 * The page's half of the stop, which nothing measured before this file.
 *
 * `BackendClient.stop` could be replaced with an empty function and the whole
 * suite stayed green — 208 pass, 0 fail — because every other test of
 * cancellation starts on the far side of the boundary, with a signal the Kernel
 * already made. Between the button and that signal there is one line of code,
 * and it was the only line in the chain nobody had ever exercised.
 *
 * What it has to get right is small and entirely about the id: a stop with no
 * id must send nothing (there is a window on every turn where `running` is null
 * and a CANCEL naming nothing would be answered `false` by a Kernel that had
 * nothing to look up), and a stop with one must name that exact call rather
 * than the request it is itself sending.
 */

/** A worker that records what it was posted and never answers. */
class DeafWorker {
  constructor() {
    this.posted = []
    this._listeners = new Map()
  }

  addEventListener(name, fn) {
    this._listeners.set(name, fn)
  }

  postMessage(data) {
    this.posted.push(data)
  }

  terminate() {}
}

describe('BackendClient.stop', () => {
  test('names the running call in a second request of its own', () => {
    const worker = new DeafWorker()
    const client = new BackendClient(worker)

    const turn = client.begin('chat.send', { id: 'c1', text: 'hello' })
    client.stop(turn.id)

    expect(worker.posted).toHaveLength(2)
    const [sent, cancel] = worker.posted
    expect(sent.method).toBe('chat.send')
    expect(cancel.method).toBe(CANCEL)
    // The id of the call being stopped, not the id of this request. Getting
    // these the wrong way round would cancel nothing and report nothing, which
    // is indistinguishable from a stop that worked.
    expect(cancel.params.id).toBe(turn.id)
    expect(cancel.id).not.toBe(turn.id)
  })

  test('a stop with no id sends nothing at all', () => {
    const worker = new DeafWorker()
    const client = new BackendClient(worker)

    client.stop(null)

    expect(worker.posted).toEqual([])
  })

  test('every call gets its own id, so a stop can only reach the one it names', () => {
    const worker = new DeafWorker()
    const client = new BackendClient(worker)

    const first = client.begin('chat.send', { id: 'c1', text: 'one' })
    const second = client.begin('chat.send', { id: 'c1', text: 'two' })
    client.stop(second.id)

    expect(first.id).not.toBe(second.id)
    expect(worker.posted.at(-1).params.id).toBe(second.id)
  })
})
