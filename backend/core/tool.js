// Tool — the contract every capability an engine can call follows: name,
// description, inputs (JSON schema), effect, approval and, once implemented,
// `run(inputs, { engine, signal })`. Tools with `approval: true` wait for the
// owner (BaseEngine.executeTool). `context()` may return one line for the
// prompt's CONTEXT section (e.g. which workspace the fs.* tools work on).
//
// Implementations live with their feature (features/<name>/tools.js) and are
// registered in features/index.js.

export class Tool {
  constructor({
    name,
    description = "",
    inputs = { type: "object" },
    effect = "read", // "read" | "write"
    approval = false, // write tools will require human approval
    kind = "tool", // "tool" | "agent"
    run = null, // async (inputs, { engine, signal }) -> string | object
    context = null, // async () -> string | null, a CONTEXT line (shared by a feature's tools)
  }) {
    this.name = name
    this.description = description
    this.inputs = inputs
    this.effect = effect
    this.approval = approval
    this.kind = kind
    this.run = run
    this.context = context
  }

  async invoke(inputs = {}, context = {}) {
    if (!this.run) throw new Error(`Tool "${this.name}" is declared but not implemented yet.`)
    return this.run(inputs ?? {}, context)
  }
}

// Another agent, exposed as a tool. Invoking it deposits a quest in that
// agent's inbox (its own thread) and returns at once; the caller stops after
// the step, and the agent's report comes back to the caller's inbox.
export class AgentTool extends Tool {
  constructor({ name, description }) {
    super({
      name,
      description,
      inputs: { type: "object", properties: { quest: { type: "string" } }, required: ["quest"] },
      kind: "agent",
    })
  }

  async invoke(inputs = {}, { engine: caller } = {}) {
    const quest = inputs.quest ?? inputs.query ?? inputs.task
    if (typeof quest !== "string" || !quest.trim()) throw new Error('Expected {"quest": "the complete task"}.')
    if (this.name === caller.agent.name) throw new Error("An agent cannot hand a quest to itself.")
    return caller.dispatchQuest(this.name, quest.trim())
  }
}
