import { describe, expect, test } from 'bun:test'
import { AgentWorkerPool } from '../../src/backend/AgentWorkerPool.js'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { TaskState } from '../../src/core/tools/TasksPort.js'

/**
 * Work handed over in one tab, found again in the next.
 *
 * A reload is modelled the only honest way it can be: TWO pools over ONE store.
 * The first is the tab that was closed — its threads are gone with it, and
 * nothing in the second pool can reach them — and the second is the tab that
 * opened afterwards. Anything that crossed between them crossed through the
 * repository, which is the whole claim.
 *
 * The fake worker is the same idea as `AgentWorkerPool.test.js`: the class
 * under test is the subject and only the line that says `new Worker` is
 * replaced. A real thread would make every case here unreachable, because a
 * real thread does not survive the test either.
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

  answer(data) {
    for (const handler of this._listeners.get('message') ?? []) handler({ data })
  }
}

function pooled(options = {}) {
  const made = new Map()
  const pool = new AgentWorkerPool({
    ...options,
    spawn: (name) => {
      const worker = new FakeWorker(name)
      made.set(name, worker)
      queueMicrotask(() => worker.answer({ type: 'ready', name }))
      return worker
    },
  })
  return { pool, made }
}

const askedId = (worker) => worker.sent.find((message) => message.task)?.id
const rowsOf = (store) => [...store.rows.values()]

/** One tab: hand a question over, let the thread start, then walk away. */
async function handedOver(store, { now = Date.now } = {}) {
  const { pool, made } = pooled({ store, now })
  const receipt = pool.start(
    'researcher',
    'read the paper and say what it claims',
    {},
    {
      owner: 'c1',
    },
  )
  // Let `ask` reach the worker, which is where the record's first write lands.
  await Promise.resolve()
  await Promise.resolve()
  return { pool, made, receipt }
}

describe('a task written down as it starts', () => {
  test('the record is in the store before the work finishes', async () => {
    const store = new MemoryRepository('Task')
    const { receipt } = await handedOver(store)

    const [row] = rowsOf(store)
    expect(row.id).toBe(receipt.id)
    expect(row.agent).toBe('researcher')
    expect(row.state).toBe(TaskState.RUNNING)
    // The instruction, because it is the whole of a sub-agent's state: there is
    // no transcript to lose, so this is what a restart needs and all it needs.
    expect(row.task).toBe('read the paper and say what it claims')
    expect(row.owner).toBe('c1')
  })

  test('the answer is written down too, so the next tab has it to read', async () => {
    const store = new MemoryRepository('Task')
    const { made, receipt } = await handedOver(store)

    const worker = made.get('researcher')
    worker.answer({ id: askedId(worker), ok: true, value: 'it claims three things', notes: [] })
    await Promise.resolve()
    await Promise.resolve()

    const row = rowsOf(store).find((one) => one.id === receipt.id)
    expect(row.state).toBe(TaskState.DONE)
    expect(row.result.value).toBe('it claims three things')
  })
})

describe('the tab that opens next', () => {
  test('a task still running when the tab closed is interrupted, and says so', async () => {
    const store = new MemoryRepository('Task')
    const { receipt } = await handedOver(store)

    // The second tab. Stale, so that this case is about the STATE and not about
    // the restart — the restart has its own test below.
    const { pool: reopened } = pooled({ store, now: () => Date.now() + 7_200_000 })
    const taken = await reopened.resume({})

    expect(taken.interrupted).toBe(1)
    expect(taken.resumed).toBe(0)
    const found = reopened.task(receipt.id)
    expect(found.state).toBe(TaskState.INTERRUPTED)
    // Not FAILED and not STOPPED. Nobody decided anything; the machine stopped.
    expect(found.state).not.toBe(TaskState.FAILED)
    expect(found.state).not.toBe(TaskState.STOPPED)
  })

  test('a recent one is handed to a thread again, and counted', async () => {
    const store = new MemoryRepository('Task')
    const { receipt } = await handedOver(store)

    const { pool: reopened, made } = pooled({ store })
    const taken = await reopened.resume({})
    await Promise.resolve()

    expect(taken.resumed).toBe(1)
    const found = reopened.task(receipt.id)
    expect(found.state).toBe(TaskState.RUNNING)
    expect(found.resumes).toBe(1)
    // The same question, to the same agent. That equivalence is the whole
    // argument for calling this a resume rather than a retry.
    const worker = made.get('researcher')
    expect(worker.sent.find((message) => message.task)?.task).toBe(
      'read the paper and say what it claims',
    )
  })

  test('the restart keeps the id, so the answer lands where it was promised', async () => {
    const store = new MemoryRepository('Task')
    const { receipt } = await handedOver(store)

    const { pool: reopened, made } = pooled({ store })
    await reopened.resume({})
    await Promise.resolve()

    const worker = made.get('researcher')
    worker.answer({ id: askedId(worker), ok: true, value: 'answered on the second run', notes: [] })
    await Promise.resolve()
    await Promise.resolve()

    const found = reopened.task(receipt.id)
    expect(found.state).toBe(TaskState.DONE)
    expect(found.result.value).toBe('answered on the second run')
  })

  test('a finished task nobody read is still there, unread', async () => {
    const store = new MemoryRepository('Task')
    const { made, receipt } = await handedOver(store)
    const worker = made.get('researcher')
    worker.answer({ id: askedId(worker), ok: true, value: 'the answer', notes: [] })
    await Promise.resolve()
    await Promise.resolve()

    const { pool: reopened } = pooled({ store })
    await reopened.resume({})

    const found = reopened.task(receipt.id)
    expect(found.state).toBe(TaskState.DONE)
    // Unread, so the context block announces it. The whole point of persisting
    // a finished task is that its answer outlived the tab that asked for it.
    expect(found.read).toBeFalsy()
  })

  test('a task read in one tab is not announced as news in the next', async () => {
    const store = new MemoryRepository('Task')
    const { pool, made, receipt } = await handedOver(store)
    const worker = made.get('researcher')
    worker.answer({ id: askedId(worker), ok: true, value: 'the answer', notes: [] })
    await Promise.resolve()
    await Promise.resolve()
    expect(pool.acknowledge(receipt.id)).toBe(true)

    const { pool: reopened } = pooled({ store })
    await reopened.resume({})

    expect(reopened.task(receipt.id).read).toBe(true)
  })
})

describe('the bounds on restarting', () => {
  test('a question from before this session is not restarted, and says why', async () => {
    const store = new MemoryRepository('Task')
    await handedOver(store)

    const later = Date.now() + AgentWorkerPool.STALE_AFTER + 1000
    const { pool: reopened, made } = pooled({ store, now: () => later })
    const taken = await reopened.resume({})

    expect(taken.resumed).toBe(0)
    expect(made.size).toBe(0)
    // Said, not swallowed. The record is kept and carries the instruction, so
    // handing it over again is one sentence.
    expect(taken.notes.join(' ')).toContain('researcher')
  })

  test('a task that has been restarted too often is left alone', async () => {
    const store = new MemoryRepository('Task')
    await store.put({
      id: 't1',
      seq: 1,
      agent: 'researcher',
      task: 'something nothing can answer',
      owner: 'c1',
      state: TaskState.RUNNING,
      startedAt: Date.now(),
      endedAt: 0,
      progress: null,
      result: null,
      read: false,
      resumes: AgentWorkerPool.MAX_RESUMES,
      resumedAt: Date.now(),
    })

    const { pool: reopened, made } = pooled({ store })
    const taken = await reopened.resume({})

    expect(taken.resumed).toBe(0)
    expect(made.size).toBe(0)
    expect(reopened.task('t1').state).toBe(TaskState.INTERRUPTED)
    expect(taken.notes.join(' ')).toContain('restarted')
  })

  test('the next new task cannot take an id a stored one already holds', async () => {
    // Without carrying the sequence across, a fresh pool starts at t1 and
    // silently replaces whatever the previous tab called t1.
    const store = new MemoryRepository('Task')
    await handedOver(store)

    const { pool: reopened } = pooled({ store, now: () => Date.now() + 7_200_000 })
    await reopened.resume({})
    const next = reopened.start('researcher', 'a new question', {}, { owner: 'c1' })

    expect(next.id).not.toBe('t1')
    expect(reopened.task('t1')).toBeTruthy()
    expect(reopened.tasks()).toHaveLength(2)
  })

  test('a damaged row costs itself and nothing else', async () => {
    // The doctrine `Message` and `Conversation` follow, at this layer: one bad
    // record must not hide every other task from the tab that opened.
    const store = new MemoryRepository('Task')
    await handedOver(store)
    await store.put({ id: 'broken', agent: 42, state: 'running' })

    const { pool: reopened } = pooled({ store, now: () => Date.now() + 7_200_000 })
    const taken = await reopened.resume({})

    expect(taken.interrupted).toBe(1)
    expect(reopened.task('broken')).toBeUndefined()
    expect(reopened.tasks()).toHaveLength(1)
  })
})

describe('a pool with nowhere to write', () => {
  test('works exactly as it did, and resuming is a no-op', async () => {
    // Every unit test and every `ask`-only caller builds one of these. A
    // constructor that demanded a database would make the cheap path pay for
    // the expensive one.
    const { pool } = pooled()
    const receipt = pool.start('researcher', 'read it', {}, { owner: 'c1' })
    await Promise.resolve()

    expect(pool.task(receipt.id).state).toBe(TaskState.RUNNING)
    expect(await pool.resume({})).toEqual({ loaded: 0, interrupted: 0, resumed: 0, notes: [] })
  })

  test('a store that refuses to be read is a note, not a failure', async () => {
    const store = new MemoryRepository('Task')
    store.list = async () =>
      (await import('../../src/core/Outcome.js')).Outcome.failed(
        'unavailable',
        'the database is closed',
      )

    const { pool } = pooled({ store })
    const taken = await pool.resume({})

    expect(taken.resumed).toBe(0)
    expect(taken.notes.join(' ')).toContain('the database is closed')
  })
})
