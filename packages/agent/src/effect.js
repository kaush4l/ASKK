/**
 * EFFECTS — the whole of what a pure step is allowed to WANT.
 *
 * `step` cannot do I/O; it can only describe it, and this closed set is the
 * description (I7). Coarse on purpose: one CallModel, one InvokeTool, never
 * micro-effects, so one turn round is one step in, one effect out, one fact
 * back. Plain serializable data because pending effects must survive a refresh
 * — replay reloads the state and its outstanding effects from the log (I11).
 *
 * FOUR VARIANTS, AND THE FIFTH THAT IS NOT HERE. `docs/PORT-MAP.md` sketches a
 * `Store` effect; the Rust has none and never did — persistence is the driver's
 * business on the way out of `handle`, not something a turn asks for. An effect
 * nothing constructs is a door in the wall of a room nobody enters.
 * @module
 */

/** @typedef {import('@harness/kernel').EndpointName} EndpointName */
/** @typedef {import('@harness/kernel').ToolId} ToolId */
/** @typedef {import('@harness/kernel').Fact} Fact */

/**
 * The assembled paper, opaque here. `packages/context` owns its shape and
 * nothing in this package reads inside one: a Document is built by `assemble`
 * and consumed by the model port, and the loop only carries it between them.
 * @typedef {{sections: unknown[]}} Document
 */

/**
 * How this provider hears the paper — the argument `context.render` takes.
 * It rides the effect because the endpoint and the paper meet in exactly one
 * place, and that place is the only one that can choose a notation (I13).
 * @typedef {{target: 'openai' | 'prose' | 'fragments', vision: boolean, audio: boolean}} ProviderFormat
 */

/**
 * @typedef {(
 *   | {type: 'CallModel', document: Document, format: ProviderFormat, endpoint: EndpointName,
 *      model: string, temperature: number | null, speaker: string}
 *   | {type: 'InvokeTool', tool: ToolId, args: string}
 *   | {type: 'Emit', fact: Fact}
 *   | {type: 'Delegate', agent: string, goal: string, batch: number}
 * )} Effect
 */

/** Every effect type, so a driver can refuse an unknown one by name. */
export const EFFECT_TYPES = /** @type {const} */ (['CallModel', 'InvokeTool', 'Emit', 'Delegate'])

/**
 * Ask the model, with a paper (I13: nothing reaches a model except as a
 * Document — carrying one here is what makes an ad-hoc string unrepresentable).
 *
 * `model` is a CATALOGUE KEY and never a URL: the adapter resolves it and
 * attaches the credential downstream of every grant, so no concrete endpoint
 * exists upstream of the broker (I6). `speaker` says WHICH agent this reply
 * will belong to — empty is the process's own agent — because compaction is a
 * turn taken by the summarizer, and its words must never land as this agent's
 * answer.
 * @param {{document: Document, format: ProviderFormat, endpoint: EndpointName,
 *          model?: string, temperature?: number | null, speaker?: string}} call
 * @returns {Effect}
 */
export function callModel(call) {
  return {
    type: 'CallModel',
    document: call.document,
    format: call.format,
    endpoint: call.endpoint,
    model: call.model ?? '',
    temperature: call.temperature ?? null,
    speaker: call.speaker ?? '',
  }
}

/**
 * Run one tool through its granted capability. `args` is the JSON TEXT the
 * model wrote, not a parsed object: a refusal quotes it back verbatim so the
 * model can see what it actually sent, and parsing here would lose that.
 * @param {ToolId} tool @param {string} args @returns {Effect}
 */
export function invokeTool(tool, args) {
  return { type: 'InvokeTool', tool, args }
}

/** Record a fact (I8) beyond what the driver already logs. @param {Fact} fact @returns {Effect} */
export function emit(fact) {
  return { type: 'Emit', fact }
}

/**
 * Hand a goal to another agent and take its answer back as an observation.
 * The caller never touches the sub-agent's loop; it sends a message and waits.
 *
 * `batch` is the LINE the call was written on. Calls sharing a batch were
 * written on one line, which means "independent, run together": the driver
 * awaits a batch whole and starts the next only afterwards. The index rides out
 * here because the ORDER half of that rule is pure and the CONCURRENCY half —
 * one Worker per agent — belongs to the driver, which needs to be told which
 * calls it may overlap.
 * @param {string} agent @param {string} goal @param {number} batch @returns {Effect}
 */
export function delegate(agent, goal, batch) {
  return { type: 'Delegate', agent, goal, batch }
}
