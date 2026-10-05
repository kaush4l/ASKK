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
    let refused = 0 // final answers refused for open checklist items
    for (let step = 1; step <= this.maxSteps; step++) {
      await this.autoSummarize(text, request, signal)
      const history = this.state.messages.filter((m) => m !== request)
      const reply = await this.step(text, history, step, signal)

      // An answer with open checklist items goes back once or twice; after
      // that it stands, with the open items said in it.
      const open = reply.action !== "tool" ? this.pendingChecks() : []
      if (open.length && refused < 2) {
        refused++
        this.push(
          this.message("tool", {
            name: "checklist",
            ok: false,
            output: `Not finished: open checklist items ${open.map((i) => i.id).join(", ")}.`,
            content:
              `Result: Error: your answer is refused while RUN CHECKLIST items are open: ${open.map((i) => `${i.id} (${i.text})`).join("; ")}. ` +
              "Do each one and checklist.tick it with evidence, or checklist.skip it with the reason, then answer.",
          })
        )
        continue
      }
      if (reply.action !== "tool") {
        if (open.length) reply.content = `${reply.content}\n\nChecklist not finished: ${open.map((i) => i.id).join(", ")}.`
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
