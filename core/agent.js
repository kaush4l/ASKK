/** The Agent — a component pipeline with phases.
 *
 *     await new Agent({ inference, ports }).invoke("hello")
 *
 * One agent, one session, one transcript. A turn is: build the component
 * recipe, assemble the prompt, infer, parse, and — when the model is calling
 * out — run the tools and go round again. The phase picks the components, the
 * assembler guarantees the order (soul and system first, response contract
 * last), and each component renders itself.
 *
 * Two flows. `flow: react` is the classic think/act loop; `flow: full` enters
 * the phase graph, which may itself short-circuit back to react when the query
 * is simple. What changed from the Python is where the graph lives: an edge is
 * data in `flows.js` now (PORT-MAP R2), so the driver in `invoke` reads a table
 * rather than trusting eight method bodies to return each other's names.
 *
 * Three neighbours hold what will not fit in 200 lines: the field table and
 * construction, the recipe, and the loop with its repeat guard.
 */

import { AgentConfig } from "./agent-config.js"
import { reactLoop } from "./agent-react.js"
import { baseComponents, collectModalities, contextFacts } from "./agent-recipe.js"
import { FLOWS, MAX_TRANSITIONS, getFlow, validateFlow } from "./flows.js"
import { PHASES } from "./phases.js"
import { BaseResponse, ResponseContract } from "./responses.js"
import { Toolbox } from "./tools.js"

/** @typedef {import("./component-base.js").Component} Component */

// Both shipped flows, checked against the phases that exist, once, at load —
// this is the only module holding both tables, and a check nothing runs is
// worth nothing. It is the phase *classes* that go in: `OUTCOMES` is static, and
// off an instance it reads `undefined`, which silently weakens the check to
// "the phase names exist".
const DECLARED = Object.fromEntries(
  Object.entries(PHASES).map(([phase, run]) => [phase, /** @type {any} */ (run.constructor)]),
)
for (const [name, flow] of Object.entries(FLOWS)) validateFlow(flow, DECLARED, name)

/** One agent: session, transcript, toolbox, and the phases that drive them. */
export class Agent extends AgentConfig {
  /** Attach more tools — functions, sub-agents, or Tool objects. @param {...unknown} items */
  addTools(...items) {
    for (const item of items) if (item !== null && item !== undefined) this.tools.push(item)
    this.toolbox = Toolbox.of(...this.tools)
  }

  /** Modality providers — run before every inference, never by the model. @param {...unknown} items */
  addModalities(...items) {
    this.modalities.push(...Toolbox.of(...items).tools)
  }

  /** @returns {Promise<import("./inference.js").Multimodality[]>} */
  async collectModalities() {
    return await collectModalities(this)
  }

  /** Register an async callable to run at `close`, e.g. an MCP client. @param {() => unknown} closer */
  onClose(closer) {
    this.closers.push(closer)
  }

  /** Facts about right now — never cached, and the one place a wrong answer
   * breaks every golden prompt. @returns {Record<string, string>} */
  context() {
    return contextFacts(this)
  }

  /** The standing furniture of every prompt. @param {boolean} [tools] @returns {Component[]} */
  baseComponents(tools = true) {
    return baseComponents(this, tools)
  }

  /** Assemble, infer, parse. The whole of one exchange with the model.
   *
   * `record: false` is for meta phases: the reply lands on the session via the
   * caller and never in the transcript — a planner's musings are not
   * conversation. `record: true` also makes this parse the one `invoke` returns.
   * @param {Component[] | null} [phaseComponents] @param {any} [responseModel]
   * @param {boolean} [tools] @param {boolean} [record] @returns {Promise<any>} */
  async turn(phaseComponents = null, responseModel = null, tools = true, record = true) {
    await this.transcript.maybeCompact(this.#summarizer())

    const model = responseModel ?? this.responseModel
    const prompt = this.assembler.assemble([
      ...this.baseComponents(tools),
      ...(phaseComponents ?? []),
      ResponseContract.of(model, this.responseFormat, this.responseLayer),
    ])
    const raw = await this.inference.infer(prompt, await this.collectModalities())

    if (model === null) {
      if (record) {
        this.transcript.add("assistant", raw)
        this.last = raw
      }
      return raw
    }
    const parsed = model.parse(raw, this.responseFormat)
    if (record) {
      // The answer field holds the reply — or the tool calls. Bare, line breaks
      // intact: prefixing it would teach the model to copy the prefix.
      this.transcript.add("assistant", String(parsed.answer).trim())
      this.last = parsed
    }
    return parsed
  }

  /** @param {Component[] | null} [phaseComponents] @returns {Promise<any>} */
  async reactLoop(phaseComponents = null) {
    return await reactLoop(this, phaseComponents)
  }

  /** One question to a fresh-context reviewer; the reply as parseable text.
   *
   * A structured reply comes back serialized (TOON), so the phase can parse it
   * into its own response model — the reviewer's verdict survives the trip. No
   * reviewer configured falls back to this agent's own model, bare: worse than a
   * real fresh context, far better than skipping review.
   * @param {any} reviewer @param {string} prompt @returns {Promise<string>} */
  async consult(reviewer, prompt) {
    const target =
      reviewer ??
      this.#bare("reviewer", "You are a careful, independent reviewer. Answer in exactly the format asked for.")
    const result = await target.invoke(prompt)
    return result instanceof BaseResponse ? result.toString(this.responseFormat) : String(result)
  }

  /** @returns {any} */
  #summarizer() {
    return this.summarizer ?? this.#bare("summarizer", "You summarise transcripts faithfully.")
  }

  /** A throwaway agent on this one's model: no history, no contract, and
   * `compactAt: 0`, because the summarizer must never try to summarise itself.
   * @param {string} suffix @param {string} system @returns {Agent} */
  #bare(suffix, system) {
    return new Agent({
      name: `${this.name}-${suffix}`, inference: this.inference, ports: this.ports, log: this.log,
      system, responseModel: null, stateless: true, compactAt: 0,
    })
  }

  /** Store the user turn and run the configured flow to an answer.
   *
   * The flow is a declared table: its entry says where to start and
   * `(phase, outcome)` says what comes next. The react flow's table is one phase
   * and one terminal edge, so it still reaches `ReActPhase` in a single lookup —
   * the graph costs it nothing.
   * @param {string} userInput @returns {Promise<any>} */
  async invoke(userInput) {
    if (this.stateless) this.transcript.clear()
    this.session.resetFor(userInput)
    this.transcript.add("user", userInput)
    this.last = null

    const flow = getFlow(this.flow)
    let current = flow.entry
    for (let step = 0; step < MAX_TRANSITIONS; step++) {
      const phase = PHASES[current]
      if (!phase) return this.#stop(`no phase called '${current}'`)
      this.log.info(`${this.name}: phase ${current}`)
      const outcome = await phase.run(this, this.session)
      const next = flow.edges[current]?.[outcome]
      if (next === undefined) return this.#stop(`phase '${current}' returned '${outcome}', no edge for it`)
      if (next === null) return this.last
      current = next
    }
    return this.#stop(`phase graph exceeded ${MAX_TRANSITIONS} transitions`)
  }

  /** The run ended on a broken graph, not an answer. Whatever was recorded still
   * goes back — a partial reply beats none. @param {string} why @returns {any} */
  #stop(why) {
    this.log.error(`${this.name}: ${why} — stopping`)
    return this.last
  }

  /** Release the inference client and anything registered via `onClose`. */
  async close() {
    await this.transcript.drain()
    for (const closer of this.closers) {
      try {
        await closer()
      } catch (error) {
        this.log.warning(`${this.name}: error closing resource: ${String(error)}`) // shutdown must not raise
      }
    }
    await this.inference.close()
  }

  /** The react-flow prompt as it would go out right now. @returns {string} */
  render() {
    return this.assembler.assemble([
      ...this.baseComponents(),
      ResponseContract.of(this.responseModel, this.responseFormat, this.responseLayer),
    ])
  }
}
