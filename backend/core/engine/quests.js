// Quests: work handed to other agents, reports, status checks, steer, recall, cancel.
// A part of BaseEngine (core/base-engine.js): its methods are mixed into
// BaseEngine.prototype, so `this` is the engine.

import { Tool } from "@/backend/core/tool"
import { LIMITS } from "@/lib/config"

export class QuestsPart {
  // ── quests: work handed to other agents ──────────────────────────────────

  // Hand `text` to agent `to` as a quest (AgentTool). Resolves once it is in
  // that agent's inbox; the report arrives later, as a letter.
  async dispatchQuest(to, text) {
    if (!this._work) throw new Error("Quests are handed out only while working on a letter.")
    if (!this.directory) throw new Error("No other agents are reachable.")
    const { letter, origin } = this._work
    const rounds = origin.rounds ?? 0
    if (rounds >= this.maxRounds) {
      throw new Error(
        `This request has had ${rounds} rounds of quests, the limit. Answer now with what you have, and say what is still open.`
      )
    }
    const id = `${this.id}-q${++this._questCount}`
    const quest = { id, to, toId: null, text, origin, batch: letter.id, at: new Date().toISOString(), report: null }
    this._quests.set(id, quest)
    try {
      quest.toId = await this.directory.send({ name: to }, { kind: "quest", id, text, from: this.name, replyTo: this.id })
    } catch (error) {
      this._quests.delete(id)
      throw error
    }
    this._dispatched += 1
    this._armDeadline(quest)
    this._publishQuests()
    return `Quest ${id} is in ${to}'s inbox. You stop after this response; its report wakes you.`
  }

  // agent.md `quest_minutes`: a hard deadline per quest handed out. A quest with no report by then is called back in
  // code (it reports back as failed, so its batch still joins) — a team lead never waits past its window on a member
  // stuck in one long inference or a slow outside call, which the supervisor cannot see (no new steps, no status).
  _armDeadline(quest) {
    const minutes = Number(this.agent?.quest_minutes)
    if (!(minutes > 0)) return
    quest.timer = setTimeout(() => {
      if (this._quests.get(quest.id) !== quest || quest.report) return
      this._recallOne(quest.id, `deadline: no report within quest_minutes ${minutes}`)
    }, minutes * 60000)
    quest.timer?.unref?.()
  }

  // How the turn ends once the current letter has handed out quests (the
  // strategy checks after running tools); null when it has not.
  waitingForReports() {
    if (!this._dispatched) return null
    const open = [...this._quests.values()].filter((q) => q.batch === this._work?.letter.id && !q.report)
    return `Waiting for reports: ${open.map((q) => `${q.to} (quest ${q.id})`).join(", ")}.`
  }

  // A report on one of this engine's quests. When every quest handed out by
  // the same letter has reported, they come back together as one letter.
  _receiveReport(report) {
    const quest = this._quests.get(report.quest)
    if (!quest || quest.report) return // called back, or already in
    clearTimeout(quest.timer)
    quest.report = report
    const batch = [...this._quests.values()].filter((q) => q.batch === quest.batch)
    if (batch.some((q) => !q.report)) return this._publishQuests()
    for (const q of batch) this._quests.delete(q.id)
    this._publishQuests()
    this._enqueue({
      kind: "reports",
      id: this._nextLetterId(),
      origin: quest.origin,
      reports: batch.map((q) => ({ quest: q, report: q.report })),
      at: new Date().toISOString(),
    })
  }

  _openQuest(id) {
    const quest = this._quests.get(id)
    return quest && !quest.report ? quest : null
  }

  // ── supervision: status checks on long-running quests ────────────────────
  //
  // The supervisor (runtime/supervisor.js) watches every engine working on
  // a quest and, every few minutes or steps, deposits a status letter with
  // the digest of its latest work in the quest owner's inbox. The owner
  // checks it against the quest in a side turn: on track (one line, no
  // tools), steer (quest.steer: guidance the agent sees on its next step),
  // or recall (quest.recall: the quest reports back as called back).

  // A status letter: one per quest waits in the inbox (the newest).
  _receiveStatus(letter) {
    if (!this._openQuest(letter.quest)) return
    this._inbox = this._inbox.filter(({ letter: l }) => !(l.kind === "status" && l.quest === letter.quest))
    this._enqueue({ ...letter, id: this._nextLetterId(), at: new Date().toISOString() })
  }

  _statusText(letter) {
    const quest = this._quests.get(letter.quest)
    const minutes = Math.round((Date.now() - Date.parse(quest.at)) / 60000)
    if (letter.stalled) {
      return (
        `Stalled quest ${quest.id}, handed to ${quest.to} ${minutes} min ago for: "${quest.origin.text}"\n\n` +
        `The quest:\n${quest.text}\n\n${letter.text}\n\n` +
        `Act now: quest.recall({"quest": "${quest.id}", "reason": "stalled"}) and send the same full quest again, ` +
        "or do the work another way. Waiting does not bring this report back."
      )
    }
    return (
      `Status check on quest ${quest.id}, handed to ${quest.to} ${minutes} min ago for: "${quest.origin.text}"\n\n` +
      `The quest:\n${quest.text}\n\n` +
      `${quest.to} is still working: ${letter.steps} steps so far. Its latest work:\n\n${letter.text}\n\n` +
      "Check it against the quest. On track: answer in one line, no tools. Drifting, looping or stuck: " +
      `steer it with quest.steer({"quest": "${quest.id}", "guidance": …}), or stop it with ` +
      `quest.recall({"quest": "${quest.id}", "reason": …}) and hand out a better quest.`
    )
  }

  // Guidance from the quest's sender: seen on the next step of the work on
  // that quest; noted for later when the quest waits (queued, or for its own
  // quests' reports).
  _receiveGuidance({ quest: id, from, text }) {
    if (this._work?.origin.id === id && this.status === "running") {
      this._guidance.push(this.message("user", { content: text, from, guidance: true }))
      return
    }
    const queued = this._inbox.find(({ letter }) => letter.id === id)?.letter
    const origin = queued ?? [...this._quests.values()].find((q) => q.origin.id === id)?.origin
    if (origin) origin.guidance = [...(origin.guidance ?? []), text]
  }

  // Tools for agents that hand out quests.
  _questTools() {
    const quest = { type: "string", minLength: 1, maxLength: LIMITS.quests.idMaxChars }
    return [
      new Tool({
        name: "quest.steer",
        view: "quest",
        description:
          "Send guidance to an agent working on one of your quests; it sees it on its next step. Use it when a " +
          "status check shows it drifting.",
        inputs: {
          type: "object",
          properties: { quest, guidance: { type: "string", minLength: 1, maxLength: LIMITS.quests.guidanceMaxChars } },
          required: ["quest", "guidance"],
          additionalProperties: false,
        },
        run: ({ quest: id, guidance }) => this._steer(id, guidance),
      }),
      new Tool({
        name: "quest.recall",
        view: "quest",
        description:
          "Stop one of your quests: the agent drops it, and it comes back to you as a failed report with your reason.",
        inputs: {
          type: "object",
          properties: { quest, reason: { type: "string", maxLength: LIMITS.quests.recallReasonMaxChars } },
          required: ["quest"],
          additionalProperties: false,
        },
        run: ({ quest: id, reason = "" }) => this._recallOne(id, reason),
      }),
    ]
  }

  async _steer(id, guidance) {
    const quest = this._openQuest(id)
    if (!quest) throw new Error(`No open quest ${id}.`)
    await this.directory.send({ id: quest.toId }, { kind: "guidance", quest: id, from: this.name, text: guidance })
    return `Guidance sent to ${quest.to}; it sees it on its next step.`
  }

  _recallOne(id, reason) {
    const quest = this._openQuest(id)
    if (!quest) throw new Error(`No open quest ${id}.`)
    this.directory?.send({ id: quest.toId }, { kind: "cancel", quest: id }).catch(() => {})
    // Its batch still joins: the quest reports back as called back.
    this._receiveReport({ quest: id, from: quest.to, ok: false, text: `Called back by you${reason ? `: ${reason}` : "."}` })
    return `Quest ${id} called back; ${quest.to} stops working on it.`
  }

  // Call back every open quest to agent `name` (before it is ended: agent.kill);
  // each reports back as called back, so its batch still joins. Returns how many.
  recallQuestsTo(name, reason = "") {
    const open = [...this._quests.values()].filter((q) => q.to === name && !q.report)
    for (const quest of open) this._recallOne(quest.id, reason)
    return open.length
  }

  // Call quests back: each agent drops the quest from its inbox or stops
  // working on it. Returns the quests called back.
  _recallQuests(match) {
    const recalled = [...this._quests.values()].filter(match)
    for (const quest of recalled) {
      clearTimeout(quest.timer)
      this._quests.delete(quest.id)
      if (!quest.report && quest.toId) this.directory?.send({ id: quest.toId }, { kind: "cancel", quest: quest.id }).catch(() => {})
    }
    if (recalled.length) this._publishQuests()
    return recalled
  }

  // The sender called quest `id` back: drop it if waiting, stop it if being
  // worked on, and call back the quests it handed out in turn.
  _cancel(id) {
    this._inbox = this._inbox.filter(({ letter }) => letter.id !== id && letter.origin?.id !== id)
    this._publishInbox()
    if (this._work?.origin.id === id) this._work.controller.abort()
    this._recallQuests((quest) => quest.origin.id === id)
    this._origins.delete(id)
  }
}
