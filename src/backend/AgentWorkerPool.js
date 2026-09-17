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
  /**
   * `store` is where task records are kept so that they outlive the tab, and
   * `now` is the clock, injected so that staleness can be tested without
   * waiting an hour.
   */
  constructor({
    timeout = 660_000,
    basePath = '',
    spawn = null,
    store = null,
    now = Date.now,
  } = {}) {
    this.timeout = timeout
    this.basePath = basePath
    /**
     * The records, written down.
     *
     * A `Repository`, or nothing — a pool with no store is exactly what this
     * class was before, and it still works that way, because every write goes
     * through `_remember` and a missing store makes that a no-op. That is not a
     * convenience: `ask`-only callers and every unit test construct a pool with
     * no persistence at all, and a constructor that demanded a database would
     * make the cheap path pay for the expensive one.
     */
    this._store = store
    this._now = now
    /**
     * How a thread is made, so that the rest of this class can be measured.
     *
     * The default is the real `new Worker`, and nothing in the app passes
     * anything else. It exists because the parts of this file most worth
     * testing are the ones a real thread makes unreachable: what happens when
     * ONE worker dies while another's call is in flight, what a task record
     * holds when the worker never answers, and whether a cancel that arrives
     * before the run starts is honoured. Every one of those was a defect found
     * by reading rather than by running, which is the argument for the seam.
     */
    this._spawn = spawn
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
     * Written down as well as held, which is a reversal of what this comment
     * used to argue. It said a stored record would "describe work that does
     * not exist", and that was right about a record left saying RUNNING and
     * wrong about the conclusion. A sub-agent keeps no transcript and is built
     * fresh for every call, so the instruction IS the whole of its state:
     * running it again is not an approximation of resuming it, it is the same
     * thing. What the record needed was an honest state for "the tab closed" —
     * `TaskState.INTERRUPTED` — and a `resume` that either restarts the work or
     * says plainly that it did not.
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
    // By the SEQUENCE they were started in, not by the clock. Two tasks handed
    // over in the same millisecond — one line of the model's reply can start
    // both — tie on `startedAt`, and a tie makes the order arbitrary in a list
    // whose whole claim is "newest first".
    return [...this._tasks.values()].sort((a, b) => b.seq - a.seq)
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
    if (!found) return false
    // A RUNNING task cannot be read, only polled — and marking a poll as read
    // is the bug this line exists to prevent: the agent asks "is it done yet",
    // the record is marked read, the task finishes, and the context block never
    // mentions it again. The agent would have polled once and then never been
    // told. Only a finished task can be over.
    if (found.state === TaskState.RUNNING) return false
    found.read = true
    // Written down, so a task read in one tab is not announced again as news in
    // the next one. Acknowledgement is the thing that turns a notification into
    // something that can be over, and a notification that came back from the
    // dead on every reload would be worse than never having been dismissible.
    this._remember(found)
    return true
  }

  /**
   * Write one record down, if there is anywhere to write it.
   *
   * Not awaited by its callers and deliberately so: a task's LIFE is the
   * in-memory record, and the store is a copy kept so the next tab can see it.
   * Awaiting a disk write inside the settle path would put storage latency on
   * the answer a caller is holding, and a store that is refusing writes would
   * turn a finished sub-agent into a failed turn. A write that fails costs the
   * record its persistence and nothing else, and `resume` is where that shows
   * up — as a task the next tab never hears about, rather than as a lie.
   */
  _remember(record) {
    if (!this._store) return
    // A plain object, not the live record: the repository structured-clones
    // whatever it is given, and a later mutation of the same object must not be
    // able to change what was written.
    this._store.put({ ...record }).catch(() => {})
  }

  /**
   * Move a task to its final state, write it down, and say what it was.
   *
   * One method because there were five places that did this by hand — `start`'s
   * two branches, `stop` twice and the collateral loop — and the store made a
   * sixth thing each of them had to remember to do. A settle that forgot to
   * persist is a task that reappears as `interrupted` on the next load and is
   * restarted although it had already answered, which is the worst failure this
   * whole feature can have.
   */
  _settle(record, state, result) {
    if (record.state !== TaskState.RUNNING) return false
    record.state = state
    record.endedAt = this._now()
    record.result = result
    this._remember(record)
    return true
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
      // Out of the store as well. A ceiling that bounded memory and left the
      // database growing without limit would move the leak rather than close
      // it, and the next load would rebuild the very records this dropped.
      this._store?.remove(task.id).catch(() => {})
    }
  }

  /**
   * How long after a tab closes a handed-over question is still wanted.
   *
   * An hour. The judgement it encodes: somebody who reopens the app within the
   * hour is continuing the session they left, and somebody who reopens it the
   * next morning is starting a new one — and silently spending their tokens on
   * a question they asked yesterday and have forgotten is the thing this bound
   * exists to refuse. Past it the record is kept and shown, in the state that
   * says what actually happened, with the instruction in it so it can be handed
   * over again in one sentence. Nothing is deleted and nothing is decided for
   * them.
   */
  static STALE_AFTER = 3_600_000

  /**
   * How many times a closed tab may restart the same question.
   *
   * A task that is restarted, runs long enough to be interrupted again, and
   * restarts once more is a task that will do that for ever — every reload
   * paying for a full run of something that has never once finished. Three
   * attempts is enough for an ordinary crash-and-reopen and few enough that a
   * question nothing can answer stops costing.
   */
  static MAX_RESUMES = 3

  /**
   * Take up the work a closed tab left behind.
   *
   * Called once, at boot, by whoever built this pool. It does three things and
   * the order matters:
   *
   *   1. Every stored record is loaded back, so the tasks a previous tab knew
   *      about are the tasks this one knows about — including the finished ones,
   *      which are the answers nobody had come back for yet.
   *   2. Anything still marked RUNNING is marked `INTERRUPTED`, because it is:
   *      the thread it was on stopped existing when the page did. That is true
   *      whether or not the work is then restarted, and it is written down
   *      before anything else happens, so a boot that crashes here leaves an
   *      honest record rather than a record still claiming to be running.
   *   3. The ones that are recent enough and have not been restarted too often
   *      are handed to a thread again.
   *
   * Restarting is not an approximation of resuming. A sub-agent keeps no
   * transcript and `agentWorker` builds a fresh agent for every message, so the
   * instruction is the whole of the run's state — the same question to the same
   * agent is the same run. What is genuinely lost is the tokens the first
   * attempt spent, and that is why the bounds above exist.
   *
   * `settings` is read at resume time rather than stored on the record, which
   * is deliberate: settings carry the API key, and a second copy of a secret in
   * a second store is a second place for it to leak from. It also means a task
   * resumes against whatever model is configured NOW, which is the one the user
   * would expect a question asked today to use.
   *
   * @returns {{loaded: number, interrupted: number, resumed: number, notes: string[]}}
   */
  async resume(settings) {
    if (!this._store) return { loaded: 0, interrupted: 0, resumed: 0, notes: [] }

    const stored = await this._store.list()
    if (!stored.ok) {
      // A note and not a failure. The app opens either way; what is lost is the
      // memory of work handed over before the reload, and saying so is the only
      // thing that can be done about it here.
      return {
        loaded: 0,
        interrupted: 0,
        resumed: 0,
        notes: [
          `work handed over before this page was opened could not be read back: ${stored.failure.message}`,
        ],
      }
    }

    const notes = []
    const restartable = []
    for (const raw of stored.value ?? []) {
      // A record this pool did not write is still evidence — the doctrine
      // `Message` and `Conversation` follow. What must not happen is one
      // damaged row taking every other task down with it, which is exactly what
      // a throw in this loop would do.
      const record = { ...raw }
      if (!record.id || typeof record.agent !== 'string') continue
      // The sequence has to continue past everything already written, or the
      // next `start` mints an id a stored record already holds and one silently
      // replaces the other.
      const seq = Number(record.seq) || 0
      if (seq > this._seq) this._seq = seq
      record.seq = seq

      if (record.state === TaskState.RUNNING) {
        record.state = TaskState.INTERRUPTED
        record.endedAt = record.endedAt || this._now()
        record.result = Outcome.failed(
          Reason.UNAVAILABLE,
          `${record.agent} was still working when the tab closed`,
        ).toJSON()
        restartable.push(record)
      }
      this._tasks.set(record.id, record)
    }

    let resumed = 0
    for (const record of restartable) {
      // Written in its interrupted state FIRST, so that the honest answer is on
      // disk before the optimistic one is attempted.
      this._remember(record)

      const age = this._now() - (record.startedAt || 0)
      if (age > AgentWorkerPool.STALE_AFTER) {
        notes.push(
          `${record.agent} was still working on a question from before this session when the tab closed; it was not restarted, and ${record.id} says what it was`,
        )
        continue
      }
      if ((record.resumes || 0) >= AgentWorkerPool.MAX_RESUMES) {
        notes.push(
          `${record.agent} has been restarted ${record.resumes} times without finishing, so ${record.id} was left alone`,
        )
        continue
      }

      record.state = TaskState.RUNNING
      record.resumes = (record.resumes || 0) + 1
      record.resumedAt = this._now()
      record.endedAt = 0
      record.result = null
      record.progress = null
      this._remember(record)
      this._run(record, settings)
      resumed++
    }

    return { loaded: this._tasks.size, interrupted: restartable.length, resumed, notes }
  }

  /**
   * Put one record's question on a thread and let it settle back into the
   * record.
   *
   * Shared by `start` and `resume` because they differ in exactly one thing —
   * whether the record is new — and a second copy of this is how the two would
   * drift into settling differently. Not awaited: its whole contract is that it
   * returns before the work does.
   */
  _run(record, settings) {
    this.ask(record.agent, record.task, settings, null, (progress) => {
      record.progress = progress
    })
      .then((answered) => {
        this._settle(record, answered.ok ? TaskState.DONE : TaskState.FAILED, answered.toJSON())
      })
      .catch((err) => {
        this._settle(
          record,
          TaskState.FAILED,
          Outcome.failed(
            Reason.INTERNAL,
            `${record.agent} could not be started: ${err?.message ?? err}`,
          ).toJSON(),
        )
      })
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
    const seq = ++this._seq
    const id = `t${seq}`
    const record = {
      id,
      seq,
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
      // How many times a closed tab has sent this back to a thread, and when
      // the current attempt began. Both are for the sentence `describeTask`
      // writes: "still working (2h so far)" about a thread that started ninety
      // seconds ago would have an agent concluding it was stuck.
      resumes: 0,
      resumedAt: 0,
      // Whether anyone has read it back. A finished task that nobody has read
      // is news; one that has been read is history, and history does not belong
      // in every prompt.
      read: false,
    }
    this._tasks.set(id, record)
    // Before the work starts, not after. A tab closed one second into a
    // ten-minute question is exactly the case this feature is for, and a record
    // written on completion would have nothing to say about it.
    this._remember(record)

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
    // A stopped task has already been settled, by `stop`, with the one
    // description that is true. The run's promise resolves anyway — stopping
    // works by settling it — and the guard inside `_settle` is what keeps the
    // stop from being overwritten by the failure it caused, which would make
    // the record say "failed" for a thread the user ended on purpose.
    this._run(record, settings)
    this._forget()

    return { id, agent: name }
  }

  /**
   * End one running task by killing the thread it is on.
   *
   * There is no gentler way. A sub-agent runs its whole loop inside its worker,
   * and a worker busy in a model call or a wasm guest does not read its own
   * messages — a polite "please stop" sits in a queue the thread will reach
   * when it is already finished. `terminate` is the only thing that acts on a
   * thread that is not listening, which is precisely the thread worth stopping.
   *
   * The cost is named rather than hidden: one worker serves one agent, and
   * every call in flight on it dies too. Those callers are told the truth —
   * that the thread was stopped, and which task it was stopped for — rather
   * than a generic crash, because a collateral casualty of a deliberate act is
   * still a deliberate act.
   *
   * Returns whether anything was actually stopped. Missing the moment is
   * ordinary: pressing stop as the answer arrives is the usual way to miss, and
   * reporting that as an error would put a red mark against a run that finished
   * correctly.
   */
  stop(id) {
    const record = this._tasks.get(String(id ?? ''))
    if (!record || record.state !== TaskState.RUNNING) return false

    const name = record.agent
    this._settle(
      record,
      TaskState.STOPPED,
      Outcome.failed(Reason.UNAVAILABLE, `${name} was stopped before it answered`).toJSON(),
    )

    const worker = this._workers.get(name)
    if (worker) {
      worker.terminate()
      this._workers.delete(name)
      const thread = this._threads.get(name)
      if (thread) thread.status = null
    }

    // The same settling the death path does, for the same reason: a pending
    // call whose thread is gone must be answered or its caller waits forever.
    for (const owed of this._owed.get(name) ?? []) {
      const settle = this._pending.get(owed)
      this._pending.delete(owed)
      this._watching.delete(owed)
      settle?.({
        ok: false,
        failure: {
          code: Reason.UNAVAILABLE,
          message: `${name} was stopped (task ${record.id})`,
          hint: '',
        },
      })
    }
    this._owed.delete(name)

    // Every OTHER task this thread was carrying ended with it, and says so.
    for (const other of this._tasks.values()) {
      if (other.agent !== name) continue
      this._settle(
        other,
        TaskState.STOPPED,
        Outcome.failed(
          Reason.UNAVAILABLE,
          `${name} was stopped for task ${record.id}, and this call was on the same thread`,
        ).toJSON(),
      )
    }
    return true
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
    const worker = this._spawn
      ? this._spawn(name)
      : new Worker(new URL('./agentWorker.js', import.meta.url), {
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
        // NOT across a reload or a second tab: the pool lives in the tab's own
        // backend worker, so a reload is a new pool. What the new pool DOES get
        // back is the task records — see `resume` — but not this, because a
        // half-finished pass of a run that no longer exists describes nothing.
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
