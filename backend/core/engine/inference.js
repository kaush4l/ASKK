// Inference: one LLM step, streamed, retried, metered and parsed.
// A part of BaseEngine (core/base-engine.js): its methods are mixed into
// BaseEngine.prototype, so `this` is the engine.

import { renderPrompt } from "@/backend/core/template"
import { responseText } from "@/backend/core/engine/helpers"
import { missingModelMessage } from "@/backend/models/catalog"
import { complete } from "@/backend/models/llm"
import { TokenMeter } from "@/backend/models/metrics"
import { writeFile } from "@/backend/platform/storage"
import { LIMITS } from "@/lib/config"

// A failed model call is tried again this many times (after 15 s, then 30 s).
const MODEL_RETRIES = LIMITS.llm.retries
const RETRY_WAIT_MS = LIMITS.llm.retryWaitMs

export class InferencePart {
  // ── inference ──────────────────────────────────────────────────────────

  // One LLM step: render with `history`, stream the reply into a new
  // assistant message (live activity: waiting → thinking → responding,
  // live token metrics), then parse it into the structured response.
  async step(text, history, step, signal) {
    // Guidance that arrived during the last step joins the work now.
    if (this._guidance.length) {
      const guidance = this._guidance.splice(0)
      this.update({ messages: [...this._state.messages, ...guidance] })
      history = [...history, ...guidance]
    }
    // Memory is brought up to date before every render.
    await this.persist()
    const model = this.model
    if (!model) throw new Error(missingModelMessage(this.agent.model))
    await this.refreshArtifacts()
    const { text: prompt, breaks: cacheAt } = renderPrompt(this.elements(text, history))
    // The exact prompt of the latest step, beside memory.md, so a reviewer can judge what the model saw.
    writeFile(`${this.memory.dir}/last-prompt.md`, prompt).catch(() => {})
    let reply = this.message("assistant", { prompt, raw: "", reasoning: "", structured: null, step })
    const meter = new TokenMeter({ prompt, contextWindow: this._state.contextWindow })
    this.update({
      messages: [...this._state.messages, reply],
      activity: { phase: "llm", stage: "waiting" },
      stats: meter.snapshot(),
    })

    let usage = null
    let fellBack = null
    try {
      // A model server can fail mid-answer for reasons that pass (a local GPU
      // hang, a dropped connection, a 5xx): try again, at most MODEL_RETRIES
      // times, from an empty reply. Stops and aborts are never retried.
      for (let attempt = 0; ; attempt++) {
        try {
          ;({ usage, fellBack } = await this._complete(model, prompt, cacheAt, signal, meter, () => reply, (next) => (reply = next)))
          break
        } catch (error) {
          if (error.name === "AbortError" || signal?.aborted || attempt >= MODEL_RETRIES) throw error
          reply = { ...reply, raw: "", reasoning: "", retries: attempt + 1, lastError: error.message }
          this.update({ messages: [...this._state.messages.slice(0, -1), reply], activity: { phase: "llm", stage: "waiting", retry: attempt + 1 } })
          await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS * (attempt + 1)))
          if (signal?.aborted) throw Object.assign(new Error("Stopped."), { name: "AbortError" })
        }
      }
      // The model failed before answering and its fallback answered: say so on the reply.
      if (fellBack) reply = { ...reply, model: model.backup.key ?? model.backup.id, fellBack }
    } finally {
      this.update({ stats: meter.finish(usage) })
      if (usage?.inputTokens > 0) this._charsPerToken = prompt.length / usage.inputTokens
      // Keep whatever streamed, even when aborted or failed.
      if (reply.raw) {
        this.update({ activity: { phase: "parsing" } })
        const parsed = this.responseModel.fromRaw(reply.raw)
        reply = { ...reply, structured: parsed.toJSON(), action: parsed.action, content: responseText(parsed) }
        this.replaceLast(reply)
      }
    }
    return reply
  }

  // One model call for step(): streams into the reply (getReply/setReply keep
  // step's variable current) with live activity and token metrics.
  _complete(model, prompt, cacheAt, signal, meter, getReply, setReply) {
    return complete({
      model,
      prompt,
      cacheAt,
      signal,
      onDelta: ({ content, reasoning }) => {
        const reply = getReply()
        const next = { ...reply, raw: reply.raw + content, reasoning: reply.reasoning + reasoning }
        setReply(next)
        meter.add(content + reasoning)
        const stage = content ? "responding" : "thinking"
        this.update({
          messages: [...this._state.messages.slice(0, -1), next],
          stats: meter.snapshot(),
          ...(this._state.activity.stage !== stage ? { activity: { phase: "llm", stage } } : {}),
        })
      },
    })
  }
}
