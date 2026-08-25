/**
 * ONE ROUND OF TOOL CALLS: what the model asked for, what came back, and which
 * answer belongs to which question.
 *
 * CORRELATION IS A LOOKUP BY ID. The provider mints an id per call and it
 * rides the effect out and the result back, so three calls in one round produce
 * three results that cannot be crossed — including three calls to ONE tool,
 * which is the case that matching by name gets silently wrong, and results
 * arriving out of order, which is the case that matching by order gets silently
 * wrong. The Rust needed a whole `Asked`/`Retries` correlation layer for this
 * because its calls were scraped out of prose with no ids in them; that layer
 * is not ported, and the scraper that made it necessary is now the declared
 * fallback in `calls.js`.
 *
 * A REFUSED CALL IS ALREADY ANSWERED. It never leaves this package: the batch
 * entry is complete the moment it is written, carrying the sentence the model
 * must read, and a round that is nothing BUT refusals settles inside the same
 * step — which is what makes a malformed call cost exactly one extra round.
 * @module
 */

import { emit, invokeTool } from './effect.js'
import { check, named } from './toolbox.js'

/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./turn.js').ToolCall} ToolCall */

/** One call of the live round: what was asked, and what came back. `done` and not a null output, because a tool that legitimately printed nothing is not a tool that has not answered. @typedef {{id: string, tool: string, args: string, ok: boolean, output: string, done: boolean}} Asked */

/** A call this build refused before running it. In the log because a refusal the model was told about and the person was not is a round nobody can account for (I8). Payload: `{id, tool, args, why}`. */
export const CALL_REFUSED = 'agent.call_refused'

/**
 * OPEN THE ROUND the reply asked for. Every call is either invoked or refused
 * here, and both outcomes are in the batch before this returns.
 * @param {AgentState} state @param {readonly ToolCall[]} calls @returns {{state: AgentState, effects: Effect[]}}
 */
export function openBatch(state, calls) {
  /** @type {Asked[]} */
  const batch = []
  /** @type {Effect[]} */
  const effects = []
  for (const call of calls) {
    const why = refuse(state, batch, call)
    batch.push({ id: call.id, tool: call.tool, args: call.args, ok: false, output: why, done: why !== '' })
    effects.push(why ? refusedFact(call, why) : invokeTool(state.turnId, call.id, call.tool, call.args))
  }
  /** @type {AgentState} */
  const acting = { ...state, awaiting: 'tools', batch, observations: [] }
  return { state: acting, effects }
}

/**
 * Why this call cannot run, or `''`. The toolbox owns every sentence but one:
 * TWO CALLS SHARING AN ID cannot be told apart by the only thing that tells
 * calls apart, so the second is refused rather than answered with the first's
 * result.
 * @param {AgentState} state @param {readonly Asked[]} batch @param {ToolCall} call @returns {string}
 */
function refuse(state, batch, call) {
  if (batch.some((asked) => asked.id === call.id)) {
    return `Two calls in this reply share the id ${call.id}, so their results cannot be told apart. Write each call once, with its own id.`
  }
  const checked = check(state.toolbox, call)
  return 'refusal' in checked ? checked.refusal : ''
}

/**
 * ONE RESULT, FILED AGAINST ITS OWN CALL. Whether that call is outstanding was
 * decided before this ran (`turn.refusal`), so a result that reaches here has a
 * question waiting for it.
 * @param {AgentState} state @param {string} callId @param {boolean} ok @param {string} output @returns {AgentState}
 */
export function land(state, callId, ok, output) {
  const batch = state.batch.map((asked) => (asked.id === callId ? { ...asked, ok, output, done: true } : asked))
  const answered = batch.find((asked) => asked.id === callId)
  return { ...state, batch, ...evidence(state, answered, ok, output) }
}

/**
 * WHAT THE RESULT PROVED, folded from the tool's own declaration rather than
 * from a list of names in `verify.rs`. Ordering is the freshness rule: a
 * successful mutation clears `green`, so anything still green at the end of the
 * turn necessarily came after the last edit.
 * @param {AgentState} state @param {Asked | undefined} asked @param {boolean} ok @param {string} output
 * @returns {{mutated: boolean, green: boolean, acted: boolean}}
 */
function evidence(state, asked, ok, output) {
  const kept = { mutated: state.mutated, green: state.green, acted: state.acted }
  const tool = asked ? named(state.toolbox, asked.tool) : null
  if (!ok || !tool) return kept
  if (tool.mutates) return { mutated: true, green: false, acted: true }
  if (tool.evidence && !saysNothing(output)) return { ...kept, green: true, acted: true }
  return kept
}

/**
 * Whether a result carried anything at all — blank, or one of the two phrases
 * this codebase prints in place of output. `(nothing yet)` ENDS a
 * `read_process` answer, under a line naming the process, so this is a suffix
 * and not an equality.
 * @param {string} output @returns {boolean}
 */
export function saysNothing(output) {
  const said = output.trim()
  return said === '' || said === '(no output)' || said.endsWith('(nothing yet)')
}

/** Whether every call of the round has its answer. The model sees none of them until this is true — that is what makes one round of calls one observation. @param {AgentState} state @returns {boolean} */
export function complete(state) {
  return state.batch.every((asked) => asked.done)
}

/**
 * The round as the model reads it, in the order the calls were WRITTEN and not
 * the order they came back — the model wrote them in that order and reads them
 * against what it wrote.
 *
 * FAILURE IS IN THE LINE. The Rust rendered `tool: output` for both outcomes,
 * so a model could tell a failed call from a successful one only by reading the
 * prose the failure happened to contain (I16).
 * @param {AgentState} state @returns {string[]}
 */
export function lines(state) {
  return state.batch.map((a) => (a.ok ? `${a.tool}: ${a.output}` : `${a.tool} failed: ${a.output}`))
}

/** @param {ToolCall} call @param {string} why @returns {Effect} */
function refusedFact(call, why) {
  return emit({
    type: 'custom',
    kind: CALL_REFUSED,
    payload: { id: call.id, tool: call.tool, args: call.args, why },
  })
}
