// Inbox: letters deposited, held, drained one at a time, worked and settled.
// A part of BaseEngine (core/base-engine.js): its methods are mixed into
// BaseEngine.prototype, so `this` is the engine.

import { IDLE } from "@/backend/core/activity"
import { clipText } from "@/backend/core/engine/helpers"
import { LIMITS } from "@/lib/config"

const DEFER_MAX_MS = LIMITS.inbox.deferMaxMs // a new run held for an open run-memory run waits at most this long

export class InboxPart {
  // Guidance from the owner on the work in progress (Live follow's guide
  // box): added to that work at its next step, without stopping it. Returns
  // whether it reached running work; when idle, send a letter instead.
  guide(text, from = "owner") {
    const content = String(text ?? "").trim()
    if (!content) throw new Error("Empty guidance.")
    if (!this._work || this.status !== "running") return { delivered: false }
    this._guidance.push(this.message("user", { content, from, guidance: true }))
    return { delivered: true }
  }

  // ── inbox: letters ─────────────────────────────────────────────────────
  //
  // Every piece of work arrives as a letter in this engine's inbox, deposited
  // from any thread: the owner's message, another agent's quest, the reports
  // on quests this engine handed out. Letters are worked one at a time, in
  // order; a deposit while idle starts the work.
  //
  //   { kind: "request", text, from: null }          the owner
  //   { kind: "quest", id, text, from, replyTo }     another agent; the answer goes back
  //                                                  to engine `replyTo` as a report
  //   { kind: "report", quest, from, ok, text }      the answer to a quest this engine sent
  //   { kind: "cancel", quest }                      the sender called its quest back
  //
  // Work on a letter ends with an answer, or by handing out quests: then the
  // engine stops, and the reports (every quest of that letter, joined) come
  // back as a new letter continuing the same origin — the owner's request or
  // the quest that started it. Only a final answer settles the origin.

  // Deposit a letter. Resolves with the final answer of the work it starts
  // (requests and quests); reports and cancels resolve at once.
  deposit(letter) {
    if (this.status === "disposed") return Promise.reject(new Error(`${this.name} is closed.`))
    if (letter.kind === "report") return Promise.resolve(this._receiveReport(letter))
    if (letter.kind === "cancel") return Promise.resolve(this._cancel(letter.quest))
    if (letter.kind === "guidance") return Promise.resolve(this._receiveGuidance(letter))
    if (letter.kind === "status") return Promise.resolve(this._receiveStatus(letter))
    const entry = { ...letter, id: letter.id ?? this._nextLetterId(), at: new Date().toISOString() }
    const done = new Promise((resolve, reject) => this._origins.set(entry.id, { resolve, reject }))
    this._keepLetter(entry)
    // Handled here: a caller that awaits still sees the failure, but a letter
    // nobody waits on (a routed quest) can never become an unhandled rejection,
    // which would end the whole team's thread.
    done.catch(() => {})
    this._enqueue(entry)
    return done
  }

  // A request from the owner (or a test). Resolves with the final answer.
  ask(text, { from = null } = {}) {
    return this.deposit({ kind: "request", text, from })
  }

  // UI entry point: errors are already recorded in state.
  send(text) {
    return this.ask(text).catch(() => {})
  }



  // agent.md `memory: run` — every run (a request or a quest; not the reports
  // or status checks that continue one) starts from an empty log; the old one
  // moves to a history file. For agents whose work lives in shared files, so
  // past runs are not re-sent on every step.
  async _freshForRun() {
    if (this.agent?.memory !== "run") return
    for (const artifact of this.artifacts ?? []) artifact.startRun?.()
    const log = this._state.messages.filter((m) => m.content || m.output)
    if (!log.length) return
    await this.memory.archive(log)
    this.update({ messages: [], stats: null })
    await this.persist()
  }
  // A `memory: run` engine waiting on its own quests holds a new run (request or quest) in the inbox until the
  // reports are back: starting it would move the waiting run's log to history and the reports would continue
  // a run with no context (a scheduled wake arriving mid-run would cut the waiting investigation in half).
  // Reports, status checks and cancels go through; a held run waits at most DEFER_MAX_MS.
  _deferRun(letter) {
    if (this.agent?.memory !== "run" || (letter.kind !== "request" && letter.kind !== "quest")) return false
    if (![...this._quests.values()].some((q) => !q.report)) return false
    if (letter.heldSince == null) console.error(`${this.name}: holding ${letter.kind} ${letter.id} while ${[...this._quests.values()].filter((q) => !q.report).length} quest(s) are out`)
    letter.heldSince ??= Date.now()
    return Date.now() - letter.heldSince < DEFER_MAX_MS
  }
  // agent.md `inbox: keep`: every request and quest is saved until it settles
  // (waiting, or being worked when the thread ends) and delivered again by
  // restore(). Off by default: a run cut mid-way runs again from its start,
  // so agents whose tools act outside (sending messages) must not opt in blindly.
  _keepLetter(letter) {
    if (this.agent?.inbox !== "keep" || (letter.kind !== "request" && letter.kind !== "quest")) return
    const { id, kind, text, from = null, replyTo = null, at } = letter
    this._kept.set(id, { id, kind, text, from, replyTo, at })
    this._saveKept()
  }
  _dropKept(id) {
    if (this._kept.delete(id)) this._saveKept()
  }
  _saveKept() {
    this.memory.saveInbox([...this._kept.values()]).catch((error) => this.update({ memoryError: `Inbox not saved: ${error.message}` }))
  }
  // Deliver the letters a previous thread left unsettled (restore()).
  async _redeliverKept() {
    if (this.agent?.inbox !== "keep") return 0
    const rows = await this.memory.loadInbox()
    for (const row of rows) this.deposit({ ...row, redelivered: true }).catch(() => {})
    return rows.length
  }
  _nextLetterId() {
    return `${this.id}-${this._letterPrefix}-l${++this._letterCount}`
  }
  _enqueue(letter) {
    clearTimeout(this._sleepTimer)
    this._inbox.push({ letter })
    this._publishInbox()
    this._drain()
  }

  // ── sleep (ASKK_HIBERNATE_MINUTES, off by default) ──────────────────────
  //
  // An engine idle that long, with nothing in its inbox and no quest out,
  // keeps only its newest messages in memory (and in every tab's snapshot);
  // the full log stays in memory.md. Its next letter loads the log back
  // before any work, so a sleeping engine loses nothing.
  _scheduleSleep() {
    const minutes = Number(globalThis.askkHibernateMinutes) || 0
    clearTimeout(this._sleepTimer)
    if (!minutes || this._dormant) return
    this._sleepTimer = setTimeout(() => this._sleep(), minutes * 60000)
    this._sleepTimer?.unref?.()
  }
  async _sleep() {
    if (this._dormant || this.status !== "idle" || this._inbox.length || [...this._quests.values()].some((q) => !q.report)) return
    await this.persist() // the full log on disk first
    this._dormant = true
    const keep = LIMITS.inbox.dormantKeep
    this.update({ messages: this._state.messages.slice(-keep), dormant: true })
  }
  async _wake() {
    if (!this._dormant) return
    try {
      const saved = await this.memory.load()
      this.update({ messages: saved.map((m) => this.message(m.role, { ...m, restored: true })), dormant: false })
    } finally {
      this._dormant = false
    }
  }

  _publishInbox() {
    const preview = (text = "") => (text.length > LIMITS.inbox.previewChars ? `${text.slice(0, LIMITS.inbox.previewChars)}…` : text)
    this.update({
      inbox: this._inbox.map(({ letter }) => ({
        id: letter.id,
        kind: letter.kind,
        from: letter.from ?? null,
        preview: preview(letter.text ?? letter.reports?.map((r) => r.quest.to).join(", ")),
      })),
    })
  }

  // Open quests to state; while not running, the activity says who it waits for.
  _publishQuests() {
    const quests = [...this._quests.values()]
      .filter((q) => !q.report)
      .map(({ id, to, text, at }) => ({ id, to, text, at }))
    const idle = this.status !== "running" && this.status !== "disposed"
    const waiting = quests.length ? { phase: "waiting", names: [...new Set(quests.map((q) => q.to))] } : IDLE
    this.update({ quests, ...(idle ? { activity: waiting } : {}) })
  }

  // Work the inbox, one letter at a time.
  async _drain() {
    if (this._draining) return
    this._draining = true
    try {
      if (this._inbox.length) await this._wake()
      while (this._inbox.length && this.status !== "disposed" && this.status !== "running") {
        // Letters that continue a run (reports, status checks) go before a new run: a held run released by the
        // last report must not start ahead of that report (it would move the waiting run's log away first).
        const cont = this._inbox.findIndex(({ letter }) => letter.kind !== "request" && letter.kind !== "quest")
        const at = cont !== -1 ? cont : this._inbox.findIndex(({ letter }) => !this._deferRun(letter))
        if (at === -1) {
          // Every waiting letter is a new run held for an open one: look again in a minute.
          clearTimeout(this._deferTimer)
          this._deferTimer = setTimeout(() => this._drain(), LIMITS.inbox.deferRecheckMs)
          break
        }
        const [{ letter }] = this._inbox.splice(at, 1)
        this._publishInbox()
        // A status on a quest that has reported or was called back meanwhile.
        if (letter.kind === "status" && !this._openQuest(letter.quest)) continue
        await this._workOn(letter)
      }
    } finally {
      this._draining = false
      if (!this._inbox.length) this._scheduleSleep()
    }
  }

  // Settle an origin: report to the quest's sender, resolve ask().
  _settle(origin, answer, error = null) {
    if (origin.kind === "quest" && origin.replyTo) {
      const report = {
        kind: "report",
        quest: origin.id,
        from: this.name,
        ok: !error,
        text: error ? `Failed: ${error.name === "AbortError" ? "stopped before it finished" : error.message}` : answer,
      }
      this.directory?.send({ id: origin.replyTo }, report).catch(() => {}) // a sender that is gone needs no report
    }
    this._dropKept(origin.id)
    const waiter = this._origins.get(origin.id)
    this._origins.delete(origin.id)
    if (error) waiter?.reject(error)
    else waiter?.resolve(answer)
  }

  // What the model sees as the current request for a letter.
  _requestText(letter) {
    if (letter.kind === "status") return this._statusText(letter)
    if (letter.kind === "quest" && letter.guidance?.length) {
      return `${letter.text}\n\nGuidance from ${letter.from} since:\n${letter.guidance.map((g) => `- ${g}`).join("\n")}`
    }
    if (letter.kind !== "reports") return letter.text
    const { origin } = letter
    const parts = letter.reports.map(({ quest, report }) =>
      // The quest's full text is already in this engine's history (its own call): a reminder is enough.
      [`### ${quest.to} · quest ${quest.id} · ${report.ok ? "done" : "failed"}`, `Quest: ${clipText(quest.text, LIMITS.inbox.reportQuestChars)}`, "", "Report:", report.text].join(
        "\n"
      )
    )
    const rounds = origin.rounds ?? 0
    const left = Math.max(0, this.maxRounds - rounds)
    const guidance = origin.guidance?.length
      ? `Guidance from ${origin.from} meanwhile:\n${origin.guidance.map((g) => `- ${g}`).join("\n")}\n\n`
      : ""
    return (
      `Reports are back on the quests you handed out for this ${origin.kind === "quest" ? `quest from ${origin.from}` : "request"}:\n\n` +
      `"${clipText(origin.text, LIMITS.inbox.reportOriginChars)}"\n\n${parts.join("\n\n")}\n\n${guidance}` +
      (Number.isFinite(this.maxRounds) ? `Round ${rounds} of ${this.maxRounds}. ` : "") +
      (left
        ? "Continue that work with these reports: hand out more quests only if something the goal needs is still missing, otherwise answer it."
        : "No rounds left: answer it now with what you have, and say what is still open.")
    )
  }

  // Work one letter through the strategy (run()).
  async _workOn(letter) {
    if (this.status === "created") this.init()
    // A status check is a side turn: it may steer, recall or hand out quests
    // for the quest's origin, but never answers (settles) that origin.
    const side = letter.kind === "status"
    const origin =
      letter.kind === "reports" ? letter.origin : side ? this._quests.get(letter.quest).origin : letter
    this._declined.clear()
    this._dispatched = 0
    await this._describeTools()
    if (letter.kind === "quest" || letter.kind === "request") await this._freshForRun(letter)
    const text = this._requestText(letter)
    // The request is rendered in its own slot; history is every other message.
    const request = this.message("user", {
      content: text,
      from: letter.kind === "reports" ? letter.reports.map((r) => r.quest.to).join(", ") : (letter.from ?? null),
      ...(letter.kind === "quest" ? { quest: letter.id } : {}),
      ...(letter.kind === "reports" ? { reports: letter.reports.map((r) => r.quest.id) } : {}),
      ...(side ? { status: letter.quest } : {}),
    })
    const controller = new AbortController()
    this._request = request
    this._controller = controller
    this._work = { letter, origin, controller }
    this.update({
      status: "running",
      activity: { phase: "llm", stage: "waiting" },
      error: null,
      messages: [...this._state.messages, request],
      working: {
        id: letter.id,
        kind: letter.kind,
        origin: origin.id, // the run this letter belongs to (request or quest, and its reports)
        quest: origin.kind === "quest" ? origin.id : null,
        replyTo: origin.replyTo ?? null,
        from: origin.from ?? null,
        request: request.id,
        at: new Date().toISOString(),
      },
    })

    try {
      const answer = await this.run(text, request, controller.signal)
      this.update({ status: "idle" }) // activity: _publishQuests (idle, or waiting)
      // Quests handed out: their reports continue this origin later.
      if (this._dispatched) origin.rounds = (origin.rounds ?? 0) + 1
      else if (!side) this._settle(origin, answer)
    } catch (error) {
      if (this.status === "disposed") return
      const last = this._state.messages.at(-1)
      if (error.name === "AbortError") {
        if (last?.role === "assistant") this.replaceLast({ ...last, stopped: true })
        this.update({ status: "idle", activity: IDLE })
      } else {
        if (last?.role === "assistant") this.replaceLast({ ...last, error: error.message })
        this.update({ status: "error", activity: IDLE, error: error.message })
      }
      if (!side) {
        this._recallQuests((quest) => quest.origin === origin)
        this._settle(origin, null, error)
      }
    } finally {
      if (this._controller === controller) this._controller = null
      this._work = null
      this._guidance = []
      if (this.status !== "disposed") this.update({ working: null })
      this._request = null
      this._publishQuests()
      // Save the turn's final answer (or error) too.
      if (this.status !== "disposed") await this.persist()
    }
  }
}
