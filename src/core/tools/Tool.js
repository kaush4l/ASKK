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
  constructor({ name, description = '', parameters = {}, repeatable = false } = {}) {
    this.name = name
    this.description = description
    this.parameters = parameters
    /**
     * Whether asking this the same way twice can give a different answer.
     *
     * False for almost everything, and the loop's repeat guard depends on it:
     * reading the same file or running the same command twice in a run returns
     * the same bytes, so the second call is a sign of going nowhere and is
     * answered with a sentence instead of a round trip.
     *
     * True for a tool whose answer is a MOMENT rather than a computation.
     * `check_task` is the one: it exists to be asked again, because what it
     * reports is whether another agent has finished yet. Refusing that repeat
     * told the agent "the result would be identical" — which is not merely
     * unhelpful there, it is false.
     */
    this.repeatable = repeatable
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
