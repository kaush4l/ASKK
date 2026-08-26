/** The throwaway agents — the summarizer and the reviewer.
 *
 * Neither is part of a turn. One is what a transcript compacts through, the
 * other is the fresh context `verify` and `critique` put a question to, and both
 * fall back to the same thing when nothing was configured: a bare agent on this
 * agent's own model. That shared fallback is the seam this file is; `agent.js`
 * keeps the turn and the flow, and the 200-line rule is what asked.
 *
 * The class is reached through `agent.constructor` rather than imported.
 * Importing `Agent` here would close a cycle with the file that imports this
 * one, and an agent's helper being the same kind of agent is the honest answer
 * anyway.
 */

import { BaseResponse } from "./responses.js"

/** A throwaway agent on this one's model: no history, no contract, and
 * `compactAt: 0`, because the summarizer must never try to summarise itself.
 * @param {any} agent @param {string} suffix @param {string} system @returns {any} */
export function bare(agent, suffix, system) {
  return new agent.constructor({
    name: `${agent.name}-${suffix}`, inference: agent.inference, ports: agent.ports, log: agent.log,
    system, responseModel: null, stateless: true, compactAt: 0,
  })
}

/** @param {any} agent @returns {any} */
export function summarizerFor(agent) {
  return agent.summarizer ?? bare(agent, "summarizer", "You summarise transcripts faithfully.")
}

/** One question to a fresh-context reviewer; the reply as parseable text.
 *
 * A structured reply comes back serialized (TOON), so the phase can parse it
 * into its own response model — the reviewer's verdict survives the trip. No
 * reviewer configured falls back to this agent's own model, bare: worse than a
 * real fresh context, far better than skipping review.
 * @param {any} agent @param {any} reviewer @param {string} prompt @returns {Promise<string>} */
export async function consult(agent, reviewer, prompt) {
  const target =
    reviewer ??
    bare(agent, "reviewer", "You are a careful, independent reviewer. Answer in exactly the format asked for.")
  const result = await target.invoke(prompt)
  return result instanceof BaseResponse ? result.toString(agent.responseFormat) : String(result)
}
