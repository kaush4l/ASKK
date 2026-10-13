// Prompt: element formatting, rendering, preview, CONTEXT lines from tools and quests.
// A part of BaseEngine (core/base-engine.js): its methods are mixed into
// BaseEngine.prototype, so `this` is the engine.

import { formatContext, formatRequest, formatRole, formatSoul, renderTemplate } from "@/backend/core/template"
import { formatLog } from "@/backend/core/log"
import { toolUsage } from "@/backend/core/engine/helpers"
import { clip } from "@/backend/core/util/text"
import { loadMcpTools } from "@/backend/features"
import { LIMITS } from "@/lib/config"

export class PromptPart {
  // ── element formatting ─────────────────────────────────────────────────

  // Numbered log lines of messages (no heading).
  formatLog(messages) {
    return formatLog(messages)
  }

  // Earlier requests and their answers (finished turns).
  formatHistory(messages = this._state.messages) {
    const log = this.formatLog(messages)
    return log ? `## CONVERSATION HISTORY (earlier requests, already answered)\n\n${log}` : ""
  }

  // `history` without the current request, split at it: finished turns
  // before, this request's steps and tool results after.
  splitHistory(history) {
    const at = this._request ? this._state.messages.indexOf(this._request) : -1
    return at < 0 ? { earlier: history, progress: [] } : { earlier: history.slice(0, at), progress: history.slice(at) }
  }

  formatToolsInstructions(tools = this.tools) {
    if (!tools.length) return ""
    // One line per tool: its call signature, then what it does.
    const lines = tools.map((tool) =>
      tool.kind === "agent"
        ? `- ${tool.name}({"quest": <string>}) - Agent: ${tool.description}`
        : `- ${toolUsage(tool)} - ${tool.description}`
    )
    const agents = tools.some((tool) => tool.kind === "agent")
      ? "\n\nCalling an agent hands it a quest and ends your turn after this response; its report wakes " +
        "you (all reports together, when you hand out several at once). The agent sees only the quest, so " +
        "write it complete: the goal, the context it needs, constraints, what done looks like, and what to " +
        "report back."
      : ""
    return (
      "## AVAILABLE TOOLS\n\n" +
      lines.join("\n") +
      "\n\nCalls: one per line runs in order; parallel[call_a(...), call_b(...)] runs independent calls " +
      "together. After a failed call the rest are skipped. Results arrive in the next step." +
      agents +
      "\n"
    )
  }


  // ── prompt rendering ───────────────────────────────────────────────────

  // Every element, keyed by its template slot.
  elements(userInput, history) {
    const { earlier, progress } = this.splitHistory(history)
    return {
      soul: formatSoul(this.soul),
      instructions: formatRole(this.instructions),
      context: formatContext([...(this._toolContext ?? []), ...this._openQuestLines()]),
      history: this.formatHistory(earlier),
      artifacts: this.formatArtifacts(),
      tools: this.toolsInstructions,
      response: this.responseInstructions,
      request: formatRequest(userInput, this.formatLog(progress)),
    }
  }

  // Quests still out (e.g. while the owner writes in between), one line each.
  _openQuestLines() {
    const open = [...this._quests.values()].filter((q) => !q.report)
    if (!open.length) return []
    return [
      "Quests you handed out, report not back yet (it wakes you when it is):",
      ...open.map((q) => `- ${q.to} (quest ${q.id}): ${clip(q.text, LIMITS.prompt.openQuestPreviewChars)}`),
    ]
  }

  // CONTEXT lines the tools contribute (e.g. which workspace fs.* work on);
  // tools of one feature share one context() function, asked once. The
  // agent's MCP servers (`mcp:`) are listed here too, asynchronously, and
  // their tools join the engine's (once per definition).
  async _describeTools() {
    if (this._toolContext) return
    const agent = this.agent
    const mcp = await loadMcpTools(agent.mcp ?? [])
    if (this.agent !== agent) return // reconfigured meanwhile; the next letter loads again
    const added = mcp.tools.filter((tool) => !this.toolsMap.has(tool.name))
    if (added.length) {
      this.tools = [...this.tools, ...added]
      this.toolsMap = new Map(this.tools.map((tool) => [tool.name, tool]))
      this.toolsInstructions = this.formatToolsInstructions()
    }
    const sources = [...new Set(this.tools.map((tool) => tool.context).filter(Boolean))]
    const lines = await Promise.all(sources.map((context) => Promise.resolve().then(context).catch(() => null)))
    this._toolContext = [...lines.filter(Boolean), ...mcp.lines]
  }

  // Fill the template. The complete prompt is sent on every request.
  render(userInput, history) {
    return renderTemplate(this.elements(userInput, history))
  }

  // The prompt the next request would send now (debug view on the chat page).
  async preview(userInput = "") {
    await this.refreshArtifacts()
    return this.render(userInput, this._state.messages)
  }
}
