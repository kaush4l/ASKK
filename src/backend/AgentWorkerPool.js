import { Outcome, Reason } from '../core/Outcome.js'

/**
 * The threads sub-agents run on — one per agent, created on first use.
 *
 * Kept alive between calls: a worker costs a few megabytes and a few
 * milliseconds to start, and an agent asked twice should not pay twice. Two
 * different agents asked at once really do run at once, on threads named after
 * them, which is the point of doing this with workers rather than awaits.
 */
export class AgentWorkerPool {
  constructor({ timeout = 300_000 } = {}) {
    this.timeout = timeout
    this._workers = new Map()
    this._pending = new Map()
    this._threads = new Map()
    this._seq = 0
  }

  /**
   * The threads this pool has actually started.
   *
   * `confirmedName` is what the worker reported `self.name` to be once it was
   * running — not what we asked for. The two differing, or the name never
   * arriving, is the difference between a thread we intended and a thread that
   * exists.
   */
  threads() {
    return [...this._threads.values()]
  }

  _worker(name) {
    const existing = this._workers.get(name)
    if (existing) return existing

    // The URL must be a literal for the bundler to find the chunk; the name is
    // what makes this thread identifiable as this agent.
    const worker = new Worker(new URL('./agentWorker.js', import.meta.url), {
      type: 'module',
      name,
    })
    worker.addEventListener('message', (event) => {
      if (event.data?.type === 'ready') {
        const thread = this._threads.get(name)
        if (thread) thread.confirmedName = event.data.name
        return
      }
      const { id } = event.data ?? {}
      const settle = this._pending.get(id)
      if (!settle) return
      this._pending.delete(id)
      settle(event.data)
    })
    worker.addEventListener('error', (event) => {
      // One dead thread must not leave its callers waiting, and must not be
      // reused: the next call gets a fresh worker.
      this._workers.delete(name)
      for (const [id, settle] of this._pending) {
        this._pending.delete(id)
        settle({
          ok: false,
          failure: { code: Reason.INTERNAL, message: `${name}: ${event.message}`, hint: '' },
        })
      }
    })
    this._workers.set(name, worker)
    this._threads.set(name, { name, confirmedName: null, startedAt: Date.now(), calls: 0 })
    return worker
  }

  /** @returns {Promise<Outcome>} value is the sub-agent's answer */
  async ask(name, task, settings) {
    const id = `s${++this._seq}`
    const worker = this._worker(name)
    const thread = this._threads.get(name)
    if (thread) thread.calls++

    const answer = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pending.delete(id)
        resolve({
          ok: false,
          failure: {
            code: Reason.UNAVAILABLE,
            message: `${name} did not answer within ${this.timeout}ms`,
            hint: '',
          },
        })
      }, this.timeout)

      this._pending.set(id, (data) => {
        clearTimeout(timer)
        resolve(data)
      })
      worker.postMessage({ id, name, task, settings })
    })

    return answer.ok
      ? Outcome.ok(answer.value, answer.notes ?? [])
      : Outcome.failed(answer.failure.code, answer.failure.message, { hint: answer.failure.hint })
  }

  terminate() {
    for (const worker of this._workers.values()) worker.terminate()
    this._workers.clear()
  }
}
