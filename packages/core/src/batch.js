/**
 * THE EFFECTS THAT DO NOT RUN AGAINST THE MODEL: one tool, and one delegation.
 *
 * A REFUSAL AND A DEADLINE ARE BOTH RESULTS. The loop is waiting on this call
 * and files the answer against the id it minted, so anything that is not a
 * result — a typed error thrown past the loop, a hole where an answer should
 * be — is a round that never closes. Every arm here comes back as a
 * `tool_invoked` fact carrying its `callId`, whatever happened.
 * @module
 */

import { LATE, lateAfter, said, within } from './deadline.js'

/** @typedef {import('@harness/agent').Effect} Effect */
/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').Incoming} Incoming */
/** @typedef {import('./deadline.js').Driving} Driving */

/**
 * RUN ONE TOOL. A deadline is a FAILED RESULT and never a hole: the turn is
 * waiting on this call, and a result the turn can read is what lets it end.
 * @param {App} app @param {Effect & {type: 'InvokeTool'}} effect @param {Driving} opts
 * @returns {Promise<Incoming[]>}
 */
export async function callTool(app, effect, opts) {
  const at = app.ports.clock.now()
  const runner = app.tools[effect.tool]
  const answered = (/** @type {boolean} */ ok, /** @type {string} */ output) =>
    result({ at, turnId: effect.turnId, callId: effect.callId, tool: effect.tool, args: effect.args, ok, output })
  if (!runner) return [answered(false, `there is no tool called "${effect.tool}" in this build`)]
  try {
    const ran = await within(opts, (signal) => runner(effect.args, { signal }))
    if (ran === LATE) return [answered(false, `it did not answer within ${lateAfter(opts)} seconds, so this call was abandoned`)]
    return [answered(ran.ok, ran.output)]
  } catch (cause) {
    return [answered(false, said(cause))]
  }
}

/**
 * ONE RESULT, CARRYING THE ID OF THE CALL IT ANSWERS. The correlation is the
 * loop's (`round.js`) and the id is the provider's; this layer only refuses to
 * lose it between the effect going out and the fact coming back (I21).
 * @param {{at: number, turnId: string, callId: string, tool: string, args: string, ok: boolean, output: string}} what
 * @returns {Incoming}
 */
function result(what) {
  return {
    at: what.at,
    turnId: what.turnId,
    callId: what.callId,
    fact: { type: 'tool_invoked', agent: '', tool: what.tool, args: what.args, ok: what.ok, output: what.output, onBehalfOf: '' },
  }
}

/**
 * Hand a goal to another agent. Its answer is an OBSERVATION to the caller, so
 * it comes back as a tool result under that agent's name — the caller never
 * holds the callee's loop.
 * @param {App} app @param {Effect & {type: 'Delegate'}} effect @param {Driving} opts
 * @returns {Promise<Incoming[]>}
 */
export async function runDelegate(app, effect, opts) {
  const at = app.ports.clock.now()
  // A delegation carries the LINE it was written on and not a call id: the id
  // is the provider's, and no provider minted this one. `round.js` files a
  // result by id, so a delegation the loop asked for arrives through the
  // `delegate` TOOL, which has one; this arm answers the page's own errand.
  const call = { at, turnId: effect.turnId, callId: '', tool: effect.agent, args: effect.goal }
  try {
    const answer = await within(opts, (signal) => app.ports.agents.delegate(effect.agent, effect.goal, { signal }))
    if (answer === LATE) return [result({ ...call, ok: false, output: `${effect.agent} did not answer within ${lateAfter(opts)} seconds` })]
    return [
      { at, turnId: null, fact: { type: 'model_replied', agent: effect.agent, text: answer, reasoning: '', finish: 'stop' } },
      result({ ...call, ok: true, output: answer }),
    ]
  } catch (cause) {
    return [result({ ...call, ok: false, output: said(cause) })]
  }
}

