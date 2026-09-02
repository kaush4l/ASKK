import { describe, expect, test } from 'bun:test'
import { AgentWorkerPool } from '../../src/backend/AgentWorkerPool.js'

/**
 * The pool, driven through a fake thread.
 *
 * Everything worth asserting here is a failure path a real Worker makes
 * unreachable from a test: one thread dying while another's call is in flight,
 * a thread that never answers, a thread that cannot be started at all. Every
 * one of those was a defect found by reading rather than by running, and a fake
 * worker is what turns reading into a check.
 *
 * It is a fake WORKER and not a fake pool: the class under test is the whole of
 * this file's subject, and only the one line that says `new Worker` is replaced.
 */
class FakeWorker {
  constructor(name) {
    this.name = name
    this.sent = []
    this._listeners = new Map()
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type).push(handler)
  }

  postMessage(message) {
    this.sent.push(message)
  }

  terminate() {
    this.terminated = true
  }

  /** What a real worker does when its handler answers. */
  answer(data) {
    for (const handler of this._listeners.get('message') ?? []) handler({ data })
  }

  /** What a real worker does when its script fails to load. */
  die(message) {
    for (const handler of this._listeners.get('error') ?? []) handler({ message })
  }
}

/** A pool whose threads are fakes, and the fakes it made. */
function pooled(options = {}) {
  const made = new Map()
  const pool = new AgentWorkerPool({
    ...options,
    spawn: (name) => {
      const worker = new FakeWorker(name)
      made.set(name, worker)
      // A real thread announces itself, and the pool records the name the
      // WORKER reported rather than the one it was asked for.
      queueMicrotask(() => worker.answer({ type: 'ready', name }))
      return worker
    },
  })
  return { pool, made }
}

/** The id the pool put on its message to that worker, so a fake can answer it. */
const askedId = (worker) => worker.sent.find((message) => message.task)?.id

describe('one thread dying', () => {
  test('fails only the calls that thread owed, and leaves another agent’s answer deliverable', async () => {
    const { pool, made } = pooled()

    const researching = pool.ask('researcher', 'read it', {})
    const summarising = pool.ask('summarizer', 'shorten it', {})
    await Promise.resolve()

    // The summarizer's script fails to load. Before the pool tracked which ids
    // each worker owed, this settled EVERY in-flight call — the researcher's
    // run was reported as failed while its thread was still working, and its
    // real answer arrived with nothing left to deliver it to.
    made.get('summarizer').die('SyntaxError: unexpected token')
    const dead = await summarising
    expect(dead.ok).toBe(false)
    expect(dead.failure.message).toContain('summarizer')

    const worker = made.get('researcher')
    worker.answer({ id: askedId(worker), ok: true, value: 'a paragraph', notes: [] })
    const alive = await researching
    expect(alive.ok).toBe(true)
    expect(alive.value).toBe('a paragraph')
  })

  test('and the dead thread stops claiming to be doing something', async () => {
    const { pool, made } = pooled()
    const asking = pool.ask('researcher', 'read it', {})
    await Promise.resolve()

    const worker = made.get('researcher')
    worker.answer({ id: askedId(worker), progress: { agent: 'researcher', doing: ['fetch'] } })
    expect(pool.threads()[0].status.doing).toEqual(['fetch'])

    worker.die('gone')
    await asking

    // A thread that died mid-fetch reported that fetch as live for as long as
    // the page stayed open.
    expect(pool.threads()[0].status).toBe(null)
  })
})

describe('a thread that never answers', () => {
  test('is told to stop, rather than left running for a caller that has gone', async () => {
    const { pool, made } = pooled({ timeout: 10 })

    const answered = await pool.ask('researcher', 'read it', {})

    expect(answered.ok).toBe(false)
    expect(answered.failure.message).toContain('did not answer')
    // Abandoning the promise used to leave the run going on its own budget for
    // nobody — the same defect the caller's signal exists to prevent, reached
    // through the other door.
    expect(made.get('researcher').sent.some((message) => message.cancel)).toBe(true)
  })
})

describe('work handed over', () => {
  test('comes back as a receipt at once, and the record settles later', async () => {
    const { pool, made } = pooled()

    const receipt = pool.start('researcher', 'read it', {}, { owner: 'c1' })

    expect(receipt.agent).toBe('researcher')
    const record = pool.task(receipt.id)
    expect(record.state).toBe('running')
    expect(record.owner).toBe('c1')
    expect(record.read).toBe(false)

    await Promise.resolve()
    const worker = made.get('researcher')
    worker.answer({ id: askedId(worker), ok: true, value: 'the answer', notes: [] })
    // Two microtasks: one for the pool's own promise, one for the `.then` that
    // writes the record.
    await Promise.resolve()
    await Promise.resolve()

    expect(pool.task(receipt.id).state).toBe('done')
    expect(pool.task(receipt.id).result.value).toBe('the answer')
  })

  test('a thread that cannot even be started leaves a failed record, not a running one', async () => {
    const pool = new AgentWorkerPool({
      spawn: () => {
        throw new Error('the realm refused the worker script')
      },
    })

    const receipt = pool.start('researcher', 'read it', {})
    await Promise.resolve()
    await Promise.resolve()

    // `ask` calls `_worker` before its own promise, so a `new Worker` that
    // throws became a REJECTION — unhandled, with a record that read "still
    // working" in every prompt until the page was reloaded.
    const record = pool.task(receipt.id)
    expect(record.state).toBe('failed')
    expect(record.result.failure.message).toContain('could not be started')
  })

  test('reading one ends its notification, and the newest is reported first', async () => {
    const { pool } = pooled()

    const receipt = pool.start('researcher', 'read it', {}, { owner: 'c1' })

    // Polling a RUNNING task does not end its notification. Marking a poll as
    // read would mean the agent asks "is it done yet", the task finishes, and
    // nothing ever tells it — polled once, then silence.
    expect(pool.acknowledge(receipt.id)).toBe(false)
    expect(pool.task(receipt.id).read).toBe(false)

    pool.task(receipt.id).state = 'done'
    expect(pool.acknowledge(receipt.id)).toBe(true)
    expect(pool.task(receipt.id).read).toBe(true)
    expect(pool.acknowledge('no-such')).toBe(false)

    // Newest first, which is what a context block wants: the thing that just
    // finished is the thing worth mentioning.
    pool.start('researcher', 'and another', {}, { owner: 'c1' })
    expect(pool.tasks().map((task) => task.task)).toEqual(['and another', 'read it'])
  })
})
