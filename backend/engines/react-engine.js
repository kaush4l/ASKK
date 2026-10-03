// ReActEngine — the ReAct strategy: step → (answer | tool calls → results →
// step …), until it answers (or `max_steps`, when agent.md sets one). One response may hold many tool calls,
// sequential and parallel (tool-plan.js); runTools() runs them as written.
// A step that hands quests to other agents ends the turn: the reports come
// back as a new letter in the inbox (BaseEngine) and continue the work.
// Port of LocalAgents core/engine.py `ReActAgent`.

import { BaseEngine } from "@/backend/core/base-engine"

export class ReActEngine extends BaseEngine {
  static strategy = "react"

  async run(text, request, signal) {
    for (let step = 1; step <= this.maxSteps; step++) {
      await this.autoSummarize(text, request, signal)
      const history = this.state.messages.filter((m) => m !== request)
      const reply = await this.step(text, history, step, signal)

      if (reply.action !== "tool") {
        this.replaceLast({ ...reply, final: true })
        return reply.content
      }

      const plan = BaseEngine.parseToolPlan(reply.structured.response)
      if (!plan.length) {
        this.push(
          this.message("tool", {
            name: null,
            ok: false,
            output: "No valid tool call found in response",
            content: "Result: Error: No valid tool call found in response",
          })
        )
        continue
      }

      await this.runTools(plan, signal)

      // Quests handed out: stop here; their reports wake this engine.
      const waiting = this.waitingForReports()
      if (waiting) {
        this.push(this.message("assistant", { content: waiting, final: true, waiting: true }))
        return waiting
      }
    }

    // Only with a step limit (agent.md max_steps); unlimited by default.
    const content = `I couldn't complete the task within the allowed ${this.maxSteps} steps.`
    this.push(this.message("assistant", { content, final: true }))
    return content
  }
}
