// Definition: the elements built from agent.md, the model, the context window.
// A part of BaseEngine (core/base-engine.js): its methods are mixed into
// BaseEngine.prototype, so `this` is the engine.

import { limit, contextCap } from "@/backend/core/engine/helpers"
import { AgentTool } from "@/backend/core/tool"
import { createArtifacts, createTools } from "@/backend/features"
import { contextWindow } from "@/backend/models/llm"
import { LIMITS } from "@/lib/config"

export class DefinitionPart {
  // ── definition ─────────────────────────────────────────────────────────

  // Build every element from an agent definition.
  configure(agent) {
    this.agent = agent
    this.description = agent.description
    this.maxSteps = limit(agent.max_steps)
    this.maxRounds = limit(agent.max_rounds)

    // Elements
    this.soul = agent.soul ?? ""
    this.instructions = this._composeInstructions()
    // Artifacts keep their state across a reconfigure.
    const saved = Object.fromEntries((this.artifacts ?? []).map((a) => [a.type, a.state]))
    this.artifacts = createArtifacts(agent.artifacts ?? [], { engine: this, saved, onChange: () => this._artifactsChanged() })
    // The FILESYSTEM artifact lists every file and shows opened ones (fs.open):
    // fs.read / fs.list would only put the same text in the prompt twice.
    const viaArtifact = agent.artifacts?.includes("filesystem") ? ["fs.read", "fs.list"] : []
    this.tools = [
      ...createTools((agent.tools ?? []).filter((name) => !viaArtifact.includes(name))),
      ...this.artifacts.flatMap((artifact) => artifact.commands()),
      ...(agent.agents ?? []).map(
        (name) =>
          new AgentTool({
            name,
            description: this.directory?.describe(name) ?? `Hand the ${name} agent a quest.`,
          })
      ),
      // quest.steer / quest.recall: for agents that hand out quests (to named
      // agents, or to sub-agents they create with the team artifact).
      ...(agent.agents?.length || agent.artifacts?.includes("team") ? this._questTools() : []),
    ]
    this.toolsMap = new Map(this.tools.map((tool) => [tool.name, tool]))
    this._toolContext = null // MCP tools are added with it (_describeTools)
    this.responseFormat = agent.response_format ?? "toon"

    // Static sections, rendered once per definition
    this.toolsInstructions = this.formatToolsInstructions()
    this.responseInstructions = this.responseModel.getInstructions(this.responseFormat)
  }

  // Apply an edited definition (or model) to this live engine. Message
  // history is kept; the next request renders with the new elements.
  reconfigure(agent = this.agent) {
    if (this.status === "disposed") return
    this.configure(agent)
    this.update({ revision: this._state.revision + 1 })
    this._loadContextWindow()
  }

  // The connection this engine calls: the catalogue entry named by the
  // agent's `model` key, else the default. null when the key is unknown.
  get model() {
    return this.getModel(this.agent.model)
  }

  async _loadContextWindow() {
    const model = this.model
    // `this.model` is resolved anew on every read: compare the connection.
    const current = () => {
      const now = this.model
      return this.status !== "disposed" && now?.key === model?.key && now?.id === model?.id
    }
    const cap = contextCap(this.agent)
    // The cap holds at once; a smaller window from the model's list lowers
    // it. A lookup that never answers (some local servers) leaves the cap.
    if (current()) this.update({ contextWindow: cap })
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), LIMITS.models.contextLookupTimeoutMs))
    const known = model ? await Promise.race([contextWindow(model).catch(() => null), timeout]) : null
    const window = Math.min(known ?? cap, cap)
    // Ignore a lookup that a newer model change has overtaken.
    if (current()) this.update({ contextWindow: window })
  }

  // agent.md body, then each declared skill.
  _composeInstructions() {
    const skills = Object.entries(this.agent.skills ?? {})
    if (!skills.length) return this.agent.instructions
    const skillsText = skills.map(([name, text]) => `### ${name}\n${text}`).join("\n\n")
    return `${this.agent.instructions}\n\n## SKILLS\n\n${skillsText}`
  }
}
