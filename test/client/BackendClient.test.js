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

/** A worker that records what it was posted and answers only when told to. */
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

  /** Deliver a message the way a real worker does, as `event.data`. */
  send(data) {
    this._listeners.get('message')?.({ data })
  }

  /** The other way a worker ends a conversation: it stops. */
  crash(message) {
    this._listeners.get('error')?.({ message })
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

/**
 * `ready()` settles from wherever the answer comes from, with nothing primed.
 *
 * The promise used to be built lazily, on the first `ready()` call, which made
 * every path that settles it responsible for calling `ready()` first — a bare
 * `this.ready()` statement, no result used, that reads as a no-op and is the
 * initialiser. Both settle paths carried one, and both then guarded the
 * resolver with `?.`, so dropping the bare call would not have failed: the
 * optional call would have swallowed it and `ready()` would have hung for ever.
 *
 * A third settle path is a plausible next change — a `notReady` from a worker
 * that booted and refused, say — and it is the one that would forget. So the
 * promise is made in the constructor and there is nothing left to forget.
 *
 * Each of these delivers the settle BEFORE anything asks for the promise, which
 * is the order the old code depended on its bare call to survive.
 */
describe('BackendClient.ready', () => {
  test('a ready that arrives before anyone asked still settles the promise', async () => {
    const worker = new DeafWorker()
    const client = new BackendClient(worker)

    worker.send({ type: 'ready', methods: ['chat.send'], notes: ['a note'], persistent: false })

    const boot = await client.ready()
    expect(boot.ok).toBe(true)
    expect(boot.methods).toEqual(['chat.send'])
    expect(boot.notes).toEqual(['a note'])
    expect(boot.persistent).toBe(false)
  })

  test('a worker that dies before anyone asked settles it too, with the cause', async () => {
    const worker = new DeafWorker()
    const client = new BackendClient(worker)

    worker.crash('the backend worker stopped')

    const boot = await client.ready()
    expect(boot.ok).toBe(false)
    expect(boot.notes).toEqual(['the backend worker stopped'])
    expect(boot.persistent).toBe(false)
  })

  test('every caller holds the same promise, so any settle path reaches all of them', async () => {
    const worker = new DeafWorker()
    const client = new BackendClient(worker)

    // Taken before and after the settle, and by two callers. This is the
    // invariant a third settle path would rely on: settle the one promise and
    // everyone waiting on it is answered, whenever they asked.
    const early = client.ready()
    expect(client.ready()).toBe(early)

    worker.send({ type: 'ready', methods: [] })

    expect(client.ready()).toBe(early)
    expect((await early).ok).toBe(true)
    expect((await client.ready()).ok).toBe(true)
    // A ready that says nothing about storage means storage is there. Only the
    // backend knows it is not, and it says so; `=== true` here would read a
    // silent boot as "this conversation ends with the tab" and print that
    // warning on a build that persists perfectly well.
    expect((await early).persistent).toBe(true)
  })

  test('the first answer wins — a later death does not rewrite a boot that happened', async () => {
    const worker = new DeafWorker()
    const client = new BackendClient(worker)

    worker.send({ type: 'ready', methods: ['chat.send'] })
    client.terminate()

    // Both paths now call the resolver unguarded, so this asserts the thing
    // that makes that safe: resolving a settled promise a second time changes
    // nothing, and the page is not told the backend never started.
    const boot = await client.ready()
    expect(boot.ok).toBe(true)
    expect(boot.methods).toEqual(['chat.send'])
  })
})

/**
 * The class's headline promise: `call` never rejects.
 *
 * Every result — a reply, a failure, a worker that died — is the same shape, so
 * a component reads one thing instead of holding a try/catch around every
 * interaction. Nothing measured that promise on the one path where the send
 * itself fails, and that path used to sit inside a `new Promise` executor,
 * where a throw is not a failed call: it rejects the promise the caller is
 * awaiting, as an unhandled rejection in the page.
 */
describe('BackendClient.call', () => {
  test('a request that cannot be posted answers rather than rejecting', async () => {
    const worker = new DeafWorker()
    worker.postMessage = () => {
      // What a real worker does with params holding a function or a DOM node.
      throw new DOMException('could not be cloned', 'DataCloneError')
    }
    const client = new BackendClient(worker)

    const answer = await client.call('chat.send', { id: 'c1', text: 'hello' })

    expect(answer.ok).toBe(false)
    expect(answer.error.message).toContain('could not send chat.send')
  })
})
