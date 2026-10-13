// Memory: restore, save, clear, summarize (manual and automatic at 92%).
// A part of BaseEngine (core/base-engine.js): its methods are mixed into
// BaseEngine.prototype, so `this` is the engine.

import { IDLE } from "@/backend/core/activity"
import { serializeMemory } from "@/backend/core/memory"
import { createSummarizer } from "@/backend/core/single-call"
import { fitLog } from "@/backend/core/engine/helpers"
import { missingModelMessage } from "@/backend/models/catalog"
import { LIMITS } from "@/lib/config"

// Summarize automatically once a prompt reaches this share of the context window.
const AUTO_SUMMARIZE_AT = LIMITS.memory.autoSummarizeRatio

export class MemoryPart {
  // ── memory ─────────────────────────────────────────────────────────────

  // Save the message list to the memory file. Never throws; a failure is
  // recorded in state so the UI can show it.
  async persist() {
    if (this._dormant) return // only the newest messages are in memory: memory.md keeps the full log
    try {
      await this.memory.save(this._state.messages)
      if (this._state.memoryError) this.update({ memoryError: null })
    } catch (error) {
      this.update({ memoryError: `Memory not saved: ${error.message}` })
    }
  }

  // Reload messages saved by a previous session (memory.md only).
  async restore() {
    try {
      await this._restoreArtifacts()
      const saved = await this.memory.load()
      if (!saved.length || this._state.messages.length) return
      const messages = saved.map((m) => this.message(m.role, { ...m, restored: true }))
      this.update({ messages })
    } catch (error) {
      this.update({ memoryError: `Memory not loaded: ${error.message}` })
    } finally {
      await this._redeliverKept().catch((error) => this.update({ memoryError: `Inbox not restored: ${error.message}` }))
      if (!this._inbox?.length) this._scheduleSleep?.() // idle from the start: sleeps too
    }
  }

  // Empty the message list and its memory file.
  async clearMemory() {
    if (this.status === "running") throw new Error(`${this.name} is busy.`)
    if (this.status === "disposed") return
    this._dormant = false // cleared for real: the empty log is saved below
    this.update({ messages: [], error: null, status: this.status === "error" ? "idle" : this.status })
    for (const artifact of this.artifacts) artifact.reset()
    await this.persist()
  }

  // Summarize `log` with a single-call summarizer agent, then move the log
  // into a new history file. Returns the summary message to put in its
  // place. Throws on failure; nothing is changed until it succeeds.
  async summarize(log, { summarizer = createSummarizer(), signal } = {}) {
    const model = this.model
    if (!model) throw new Error(missingModelMessage(this.agent.model))
    const input = serializeMemory(this.name, fitLog(log, this._state.contextWindow))
    const { parsed } = await summarizer.call(input, { model, signal })
    const summary = String(parsed.response ?? "").trim()
    if (!summary) throw new Error("The summarizer returned an empty summary.")
    const archive = await this.memory.archive(log)
    return this.message("summary", { content: summary, count: log.length, archive })
  }

  // Replace the whole log with one summary; the log moves to a history file.
  // The log is untouched if summarizing fails or is stopped.
  async summarizeMemory({ summarizer } = {}) {
    await this._wake?.()
    if (this.status === "running") throw new Error(`${this.name} is busy.`)
    if (this.status === "disposed") return
    const log = this._state.messages.filter((m) => m.content || m.output)
    if (!log.length) return

    const controller = new AbortController()
    this._controller = controller
    this.update({ status: "running", error: null, activity: { phase: "summarizing" } })
    try {
      const summary = await this.summarize(log, { summarizer, signal: controller.signal })
      this.update({ messages: [summary], status: "idle", activity: IDLE, stats: null })
      await this.persist()
      return summary.content
    } catch (error) {
      if (this.status === "disposed") throw error
      const aborted = error.name === "AbortError"
      this.update({
        status: aborted ? "idle" : "error",
        activity: IDLE,
        error: aborted ? null : `Summarize failed: ${error.message}`,
      })
      throw error
    } finally {
      if (this._controller === controller) this._controller = null
      this._drain() // letters that arrived meanwhile
    }
  }

  // Before an LLM step: when the prompt would fill AUTO_SUMMARIZE_AT of the
  // context window, summarize everything except the current request, which
  // stays after the summary.
  async autoSummarize(text, request, signal) {
    const window = this._state.contextWindow
    if (!window) return
    const history = this._state.messages.filter((m) => m !== request)
    const log = history.filter((m) => m.content || m.output)
    if (log.length < 2) return
    const tokens = (chars) => Math.ceil(chars / this._charsPerToken)
    const used = tokens(this.render(text, history).length)
    if (used / window < AUTO_SUMMARIZE_AT) return
    // Summarizing cannot help when the fixed elements fill the window.
    if (tokens(this.formatHistory(history).length) < window * 0.1) return

    this.update({ activity: { phase: "summarizing" } })
    let summary
    try {
      summary = await this.summarize(log, { signal })
    } catch (error) {
      if (error.name === "AbortError") throw error
      throw new Error(`Summarize failed (automatic, at ${Math.round((used / window) * 100)}% of context): ${error.message}`)
    }
    this.update({ messages: [summary, request], stats: null, activity: { phase: "llm", stage: "waiting" } })
    await this.persist()
  }
}
