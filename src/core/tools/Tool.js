import { Outcome, Reason } from '../Outcome.js'

/**
 * Abstract tool. One subclass per capability.
 *
 * A tool is three things the model needs and one thing it does: a `name` it can
 * write, a `description` telling it when this is the right choice, a
 * `parameters` table telling it what to pass, and `call`. All four are instance
 * state rather than statics, because a sub-agent tool's name and description
 * come from an agent file read at runtime and cannot be known when the class is
 * written.
 *
 * `call` returns an Outcome and never throws: a tool that fails is an
 * observation the agent can reason about — often by trying something else —
 * not an end to the run.
 */
export class Tool {
  /**
   * @param {{name: string, description: string, parameters?: object}} options
   *   `parameters` is `{ name: { type, description, required } }`.
   */
  constructor({ name, description = '', parameters = {} } = {}) {
    this.name = name
    this.description = description
    this.parameters = parameters
  }

  /**
   * `_signal` is the user's stop, threaded from the loop through the toolbox.
   * A second parameter and not a wrapper, for the reason `Kernel.handle` gives
   * about `emit`: a tool with nothing to abort simply does not declare it and
   * reads exactly as it did before stopping existed. `SubAgentTool` is the one
   * that has something — a whole second worker running a whole second budget.
   *
   * @param {object} _args
   * @param {AbortSignal|null} [_signal]
   * @returns {Promise<Outcome>} value is a string the agent will read
   */
  async call(_args, _signal) {
    return Outcome.failed(Reason.NOT_IMPLEMENTED, `${this.name} does not do anything yet`)
  }

  /** The signature the model is shown: `name({"a": string, "b?": number})`. */
  get signature() {
    const args = Object.entries(this.parameters)
      .map(
        ([key, spec]) => `"${key}${spec.required === false ? '?' : ''}": ${spec.type ?? 'string'}`,
      )
      .join(', ')
    return `${this.name}({${args}})`
  }

  /**
   * How this tool appears in the prompt. Name, arguments and description
   * together — a name alone tells a model what to type but not when to type it,
   * which is how tools get called in the wrong places.
   */
  render() {
    const lines = [`- ${this.signature}`]
    if (this.description) lines.push(`    ${this.description}`)
    for (const [key, spec] of Object.entries(this.parameters)) {
      if (spec.description) lines.push(`    ${key}: ${spec.description}`)
    }
    return lines.join('\n')
  }
}
