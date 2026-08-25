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

import { mintId } from './app.js'
import { LATE, lateAfter, said, within } from './deadline.js'
import { ARTIFACT_KEPT, SPILL_CHARS, receipt, shelve, summarise } from './shelf.js'

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
    [result({ at, turnId: effect.turnId, callId: effect.callId, tool: effect.tool, args: effect.args, ok, output })]
  if (!runner) return answered(false, `there is no tool called "${effect.tool}" in this build`)
  try {
    const ran = await within(opts, (signal) => runner(effect.args, { signal }))
    if (ran === LATE) return answered(false, `it did not answer within ${lateAfter(opts)} seconds, so this call was abandoned`)
    if (ran.output.length <= SPILL_CHARS) return answered(ran.ok, ran.output)
    return await spilled(app, effect, ran, at, answered)
  } catch (cause) {
    return answered(false, said(cause))
  }
}

/**
 * A RESULT TOO BIG TO SAY. The bytes go to the shelf and the FACT carries the
 * receipt — so the log holds one copy of a 200KB listing, the assembled
 * document holds none, and the model reads back only the part it asks for.
 *
 * The `ARTIFACT_KEPT` fact comes FIRST, because the receipt names a handle and
 * a reader folding the log must meet the thing before the reference to it.
 * @param {App} app @param {Effect & {type: 'InvokeTool'}} effect
 * @param {{ok: boolean, output: string}} ran @param {number} at
 * @param {(ok: boolean, output: string) => Incoming[]} answered
 * @returns {Promise<Incoming[]>}
 */
async function spilled(app, effect, ran, at, answered) {
  const handle = mintId(app, 6)
  const summary = summarise(effect.tool, ran.output)
  try {
    const kept = await shelve(app.ports, handle, effect.tool, ran.output)
    return [
      { at, turnId: effect.turnId, fact: { type: 'custom', kind: ARTIFACT_KEPT, payload: { handle, tool: effect.tool, bytes: ran.output.length, summary } } },
      ...answered(ran.ok, kept),
    ]
  } catch (cause) {
    // THE SHELF FAILED, AND NOTHING PRETENDS OTHERWISE. Handing back the
    // receipt anyway would name a handle `read_artifact` cannot answer, and the
    // model would spend a round discovering that. The excerpt is the same one;
    // only the promise of the rest is withdrawn.
    const excerpt = receipt(handle, effect.tool, ran.output).split('\n').slice(3).join('\n')
    return [
      { at, turnId: effect.turnId, fact: { type: 'store_failed', key: handle, message: said(cause) } },
      ...answered(ran.ok, `This result could not be kept whole (${said(cause)}), so only its ends survive.\n${excerpt}`),
    ]
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

