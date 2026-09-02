import { Outcome, Reason } from '../core/Outcome.js'
import { TaskState } from '../core/tools/TasksPort.js'

/**
 * How many handed-over tasks a tab remembers.
 *
 * Each record holds the whole instruction and the whole answer, so this is a
 * memory bound as well as a prompt bound. Fifty is far more than a conversation
 * will produce and small enough that a runaway agent cannot grow the worker's
 * heap without limit; read tasks are dropped first, oldest first.
 */
const TASK_CEILING = 50

/**
 * The threads sub-agents run on — one per agent, created on first use.
 *
 * Kept alive between calls: a worker costs a few megabytes and a few
 * milliseconds to start, and an agent asked twice should not pay twice. Two
 * different agents asked at once really do run at once, on threads named after
 * them, which is the point of doing this with workers rather than awaits.
 */
export class AgentWorkerPool {
  /**
   * `basePath` is where the app is served from, e.g. `/ASKK`, and it is passed
   * IN rather than read here. The sub-agent thread needs it to fetch its own
   * agent file, and it used to read `process.env.NEXT_PUBLIC_BASE_PATH` for
   * itself — a second module deriving a value `composition.js` already derives,
   * which is the duplication that put `imageUrl: ""` into every build ever made
   * (`docs/GATE.md`). One realm decides where the app lives and tells the
   * others; a thread that is handed the wrong prefix fetches nothing, which is
   * a visible failure rather than a silent default.
   */
  /**
   * `timeout` is a BACKSTOP, not a policy, and it has to sit above the budget a
   * sub-agent can legitimately spend or it becomes the policy. `Budget` gives a
   * run 600 seconds and a single model call may take 300, so a child doing two
   * long calls was inside its own declared terms and killed at 300,000 ms with
   * "did not answer within 300000ms" — the pool silently overruling the file,
   * which is the opposite of what `agentWorker` says it does. Eleven minutes is
   * the 600-second budget plus a minute for the thread to notice.
   */
  constructor({ timeout = 660_000, basePath = '' } = {}) {
    this.timeout = timeout
    this.basePath = basePath
    this._workers = new Map()
    this._pending = new Map()
    /**
     * Worker name -> the ids that worker owes an answer to.
     *
     * `_pending` is keyed by task id and is pool-wide, so the `error` handler
     * below used to settle EVERY in-flight call when ONE worker died — a
     * `summarizer` that failed to load reported `researcher`'s live run as
     * failed, and when the researcher's real answer arrived there was nothing
     * left to deliver it to. One dead thread may only fail its own callers.
     */
    this._owed = new Map()
    /** @type {Map<string, (progress: object) => void>} task id -> who is watching it. */
    this._watching = new Map()
    this._threads = new Map()
    /**
     * Work that outlives the turn that asked for it.
     *
     * `ask` is a promise, and a promise dies with the turn awaiting it. A
     * question a parent hands over and gets on with — the whole point of a
     * sub-agent that reads six pages — needs somewhere for the answer to sit
     * until somebody comes back for it. This is that somewhere: task id ->
     * `{id, agent, task, state, startedAt, endedAt, progress, result}`.
     *
     * In memory, and deliberately not in IndexedDB: the run itself is a thread
     * in this worker, so a record that survived a reload would describe work
     * that does not. What a reload loses is the answer to a question nobody
     * waited for, and saying so is honest where a stored record that can never
     * be finished is not.
     */
    this._tasks = new Map()
    this._seq = 0
  }

  /**
   * Every background task this pool has been given, newest first.
   *
   * The whole record, because both readers want different halves: the model
   * wants the answer, and the page wants to know something is running.
   */
  tasks() {
    return [...this._tasks.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  /** One, by id, or undefined. */
  task(id) {
    return this._tasks.get(id)
  }

  /**
   * Say a finished task has been read, so it stops being announced.
   *
   * Without this a finished task was in every prompt of every turn for the life
   * of the tab, each turn inviting the agent to read it again — a line of
   * prompt and a whole extra step, per task, forever. Acknowledgement is what
   * turns a notification into something that can be over.
   */
  acknowledge(id) {
    const found = this._tasks.get(id)
    if (found) found.read = true
    return Boolean(found)
  }

  /**
   * Keep the newest `TASK_CEILING` and drop read ones first.
   *
   * A task record holds its whole instruction and its whole answer, and nothing
   * ever removed one. A long session with a chatty agent is unbounded memory in
   * the backend worker and an unbounded context block in front of the model.
   */
  _forget() {
    if (this._tasks.size <= TASK_CEILING) return
    const droppable = [...this._tasks.values()]
      .filter((task) => task.state !== TaskState.RUNNING)
      .sort((a, b) => Number(b.read) - Number(a.read) || a.endedAt - b.endedAt)
    for (const task of droppable) {
      if (this._tasks.size <= TASK_CEILING) return
      this._tasks.delete(task.id)
    }
  }

  /**
   * Hand a question over and come straight back with a receipt.
   *
   * The difference from `ask` is only who waits: the same thread, the same
   * message, the same worker. `ask` awaits the promise; this one lets it settle
   * into a record that anyone can read later, which is what makes a delegated
   * run outlive the turn that started it.
   *
   * There is no signal. A background task is not attached to the turn that
   * started it, so the parent's stop cannot mean "stop that too" — the run it
   * would be stopping may belong to a question asked four turns ago. What
   * bounds it is the pool's own timeout, the same one `ask` uses.
   *
   * @returns {{id: string, agent: string}} the receipt, immediately
   */
  start(name, task, settings, { owner = '' } = {}) {
    const id = `t${++this._seq}`
    const record = {
      id,
      agent: name,
      task,
      // WHOSE task this is. The pool is one per tab and holds every task in it,
      // so without an owner a question handed over in one conversation was
      // announced in every other conversation's prompt — and could be read
      // there, which is one person's research answering someone else's
      // question. The owner is a conversation id and it is the caller's, not
      // the pool's, because the pool has no idea what a conversation is.
      owner,
      state: TaskState.RUNNING,
      startedAt: Date.now(),
      endedAt: 0,
      progress: null,
      result: null,
      // Whether anyone has read it back. A finished task that nobody has read
      // is news; one that has been read is history, and history does not belong
      // in every prompt.
      read: false,
    }
    this._tasks.set(id, record)

    // Not awaited on purpose: this method's whole contract is that it returns
    // before the work does. The promise cannot reject — `ask` answers with an
    // Outcome on every path — so there is nothing here to catch.
    // The catch is not decoration. This comment said "the promise cannot
    // reject" and `ask` does answer with an Outcome on every path it REACHES —
    // but it calls `_worker` first, and `new Worker` throws synchronously on a
    // URL a realm will not load, which an async function turns into a
    // rejection. Left uncaught that was an unhandled rejection in the backend
    // worker and a record that read "still working" in every prompt until the
    // page was reloaded.
    this.ask(name, task, settings, null, (progress) => {
      record.progress = progress
    })
      .then((answered) => {
        record.state = answered.ok ? TaskState.DONE : TaskState.FAILED
        record.endedAt = Date.now()
        record.result = answered.toJSON()
      })
      .catch((err) => {
        record.state = TaskState.FAILED
        record.endedAt = Date.now()
        record.result = Outcome.failed(
          Reason.INTERNAL,
          `${name} could not be started: ${err?.message ?? err}`,
        ).toJSON()
      })
    this._forget()

    return { id, agent: name }
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
      // A pass that finished, on a run that has not. It does NOT settle the
      // call — the same call goes on to answer normally — so it is handled and
      // returned from before the pending map is touched, exactly as an `Event`
      // is on the page's own wire.
      if (event.data?.progress) {
        const { id: at, progress } = event.data
        const thread = this._threads.get(name)
        // Kept on the thread as well as forwarded, because the two answer
        // different questions: the forward is for whoever is watching this
        // call, and the record is what `agents.threads` can tell a page that
        // asked later in the same session — the panel polls it after each turn.
        // NOT across a reload or a second tab, which this comment claimed for
        // one wave: the pool lives in the tab's own backend worker, so a reload
        // is a new pool with nothing in it.
        if (thread) thread.status = { ...progress, at: Date.now() }
        this._watching.get(at)?.(progress)
        return
      }
      const { id } = event.data ?? {}
      const settle = this._pending.get(id)
      if (!settle) return
      this._pending.delete(id)
      settle(event.data)
    })
    worker.addEventListener('error', (event) => {
      // One dead thread must not leave ITS OWN callers waiting, and must not
      // leave anyone else's answer undeliverable: only the ids this worker owes
      // are failed. It is not reused either — the next call gets a fresh one.
      this._workers.delete(name)
      const thread = this._threads.get(name)
      if (thread) thread.status = null
      for (const id of this._owed.get(name) ?? []) {
        const settle = this._pending.get(id)
        this._pending.delete(id)
        this._watching.delete(id)
        settle?.({
          ok: false,
          failure: { code: Reason.INTERNAL, message: `${name}: ${event.message}`, hint: '' },
        })
      }
      this._owed.delete(name)
    })
    this._workers.set(name, worker)
    this._threads.set(name, { name, confirmedName: null, startedAt: Date.now(), calls: 0 })
    return worker
  }

  /**
   * Ask a sub-agent, and be able to take it back.
   *
   * `signal` is the caller's stop. It cannot be postMessaged — the same fact
   * that shapes the whole protocol — so it is sent as a SECOND MESSAGE naming
   * the first, exactly as `CANCEL` names a request in `Envelope`. The worker
   * answers its own message with whatever it had, which settles the promise
   * below on the ordinary path rather than through a special case here.
   *
   * Without this a stop ended the parent run and left the child generating: a
   * delegated call ran a full 24-step budget to completion on a thread nobody
   * was waiting for any more.
   *
   * `onProgress` is how the caller hears anything before the end. A delegated
   * run used to be one message down and one message back, so a thread reading
   * its fourth page and a thread that was wedged looked identical from the only
   * realm anyone is watching. It is optional and advisory: a caller that passes
   * nothing gets exactly the same answer.
   *
   * @returns {Promise<Outcome>} value is the sub-agent's answer
   */
  async ask(name, task, settings, signal = null, onProgress = null) {
    const id = `s${++this._seq}`
    const worker = this._worker(name)
    const thread = this._threads.get(name)
    if (thread) thread.calls++

    const answer = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pending.delete(id)
        this._watching.delete(id)
        this._owed.get(name)?.delete(id)
        // The thread is not doing what it last said it was doing. Left
        // standing, `agents.threads` reports a fetch that was abandoned
        // minutes ago as live, for as long as the page is open.
        if (thread) thread.status = null
        // The thread is told, not merely abandoned. Giving up on the promise
        // used to leave the run going on its own budget for a caller that had
        // stopped waiting — the same defect the signal below exists to fix,
        // reached by the other door.
        worker.postMessage({ id, cancel: true })
        resolve({
          ok: false,
          failure: {
            code: Reason.UNAVAILABLE,
            message: `${name} did not answer within ${this.timeout}ms`,
            hint: '',
          },
        })
      }, this.timeout)

      if (onProgress) this._watching.set(id, onProgress)
      if (!this._owed.has(name)) this._owed.set(name, new Set())
      this._owed.get(name).add(id)

      // Named rather than inline, so the abort listener can be REMOVED when the
      // call settles. A parent that delegates twenty times in one run held
      // twenty closures until the turn ended, each waiting to post a cancel for
      // an id the worker had long forgotten.
      const cancel = () => worker.postMessage({ id, cancel: true })

      this._pending.set(id, (data) => {
        clearTimeout(timer)
        this._watching.delete(id)
        this._owed.get(name)?.delete(id)
        signal?.removeEventListener('abort', cancel)
        resolve(data)
      })
      worker.postMessage({ id, name, task, settings, basePath: this.basePath })
      if (signal) {
        if (signal.aborted) cancel()
        else signal.addEventListener('abort', cancel, { once: true })
      }
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
