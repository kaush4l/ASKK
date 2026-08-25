/**
 * ONE EFFECT, RUN THROUGH THE PORTS. `drive.js` owns WHEN and in what company;
 * this file owns HOW, and holds no policy about either.
 *
 * EVERY OUTSTANDING CALL CARRIES A DEADLINE AND AN `AbortController` (I21). A
 * call that never comes back resolves as a FAILED TOOL RESULT rather than as
 * nothing, so the counter the turn is waiting on always drains and the turn
 * ends instead of hanging. The Rust awaited each port call bare: a workspace
 * that stopped answering left `pending_tools` above zero for the life of the
 * tab, with the composer disabled and a clock that could not tick.
 *
 * A PORT FAILURE IS A TYPED FACT THE REDUCER SEES. The Rust's catch-all arm
 * turned every one of them into a card nothing folded, so the loop could not
 * decide anything about a failure — a refusal, a rate limit and a dead endpoint
 * were one shrug. Here a failed model call is recorded as `core.effect_failed`
 * AND ends the turn with the provider's own `error` signal, which `ending.js`
 * already names FAILED.
 * @module
 */

import { HarnessError } from '@harness/kernel'

import { callTool, runDelegate } from './batch.js'
import { LATE, lateAfter, within } from './deadline.js'
import { backoffMs } from './log/persist.js'

/** @typedef {import('@harness/agent').Effect} Effect */
/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').Incoming} Incoming */
/** @typedef {import('./deadline.js').Driving} Driving */

/** A port call that would not come back, as a fact a reducer can see. */
export const EFFECT_FAILED = 'core.effect_failed'

/** How many times a failed model call is tried again before the turn is told. */
const RETRIES = 2

/** Two silences in a row from one model is not worth a third. */
const QUIET_CEILING = 2

/**
 * Run one effect and return the facts it produced, in written order.
 * @param {App} app @param {Effect} effect @param {Driving} opts
 * @returns {Promise<Incoming[]>}
 */
export async function runEffect(app, effect, opts) {
  if (effect.type === 'Emit') return [{ at: app.ports.clock.now(), turnId: null, fact: effect.fact }]
  if (effect.type === 'InvokeTool') return callTool(app, effect, opts)
  if (effect.type === 'Delegate') return runDelegate(app, effect, opts)
  return callModel(app, effect, opts)
}

/**
 * ASK THE MODEL, RETRYING WHAT IS WORTH RETRYING. The backoff is the log's, so
 * two things that wait on a substrate that has gone away wait the same way.
 * @param {App} app @param {Effect & {type: 'CallModel'}} effect @param {Driving} opts
 * @returns {Promise<Incoming[]>}
 */
async function callModel(app, effect, opts) {
  // `context.buildRequest` (lane A) is this body's author and this is its one
  // call site; until it lands the paper crosses whole, which the scripted port
  // reads and the real adapter will not.
  const body = { model: effect.model, temperature: effect.temperature, document: effect.document }
  for (let attempt = 0; ; attempt++) {
    const outcome = await attemptCall(app, effect, body, opts)
    if (!(outcome instanceof Error)) return outcome
    if (attempt >= RETRIES || (app.quiet[effect.model] ?? 0) >= QUIET_CEILING) {
      return failed(app, effect.turnId, `The model did not answer: ${outcome.message}`, outcome)
    }
    await opts.timer.wait(backoffMs(attempt + 1))
  }
}

/**
 * ONE attempt, as facts or as the error that ended it.
 * @param {App} app @param {Effect & {type: 'CallModel'}} effect
 * @param {Record<string, unknown>} body @param {Driving} opts
 * @returns {Promise<Incoming[]|Error>}
 */
async function attemptCall(app, effect, body, opts) {
  const at = app.ports.clock.now()
  try {
    const reply = await within(opts, (signal) => app.ports.model.call(effect.endpoint, body, { signal }))
    if (reply === LATE) return new Error(`it did not answer within ${lateAfter(opts)} seconds`)
    app.quiet[effect.model] = quiet(reply) ? (app.quiet[effect.model] ?? 0) + 1 : 0
    return spoken(app, effect, reply, at)
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause))
  }
}

/**
 * What a reply becomes: what it COST, then what it SAID. The cost first, so a
 * reader folding the log sees the price of a reply before the reply itself.
 * `documentHash` and `evicted` are the assembly's own receipt and stay empty
 * until `assemble` (lane A) writes one — an empty field that says so beats a
 * hash of a document nobody budgeted.
 * @param {App} app @param {Effect & {type: 'CallModel'}} effect
 * @param {import('@harness/kernel').ModelReply} reply @param {number} at
 * @returns {Incoming[]}
 */
function spoken(app, effect, reply, at) {
  const speaker = effect.speaker === '' ? app.me : effect.speaker
  /** @type {Incoming[]} */
  const facts = []
  if (reply.usage) {
    const spentTokens = reply.usage.inputTokens + reply.usage.outputTokens
    facts.push({ at, turnId: effect.turnId, fact: { type: 'model_called', agent: speaker, documentHash: '', spentTokens, evicted: [] } })
  }
  facts.push({
    at,
    turnId: effect.turnId,
    fact: { type: 'model_replied', agent: speaker, text: reply.text, reasoning: reply.reasoning },
    // INFERRED, NOT REPORTED — and `step` only reads it when there are no
    // calls, so every call-less reply ends ANSWERED whatever really happened.
    // A truncation, a refusal and a content filter are one outcome again, which
    // is what `ending.js` exists to have ended. Filed as a cross-lane request
    // beside `turn.js`'s: `ModelReply` has no `finish`, and the port is the one
    // layer that reads the provider's. Delete this comment and the inference
    // together on the day it lands.
    reply: { calls: reply.calls, finish: reply.calls.length > 0 ? 'tool_calls' : 'stop' },
  })
  return facts
}

/** A completion that said nothing and asked for nothing. */
function quiet(/** @type {import('@harness/kernel').ModelReply} */ reply) {
  return reply.text.trim() === '' && reply.calls.length === 0
}

/**
 * The failure, TWICE: once as the typed record a reducer can see, and once as
 * the ending the loop needs — a provider that failed the completion is
 * `ending.js`'s FAILED, and a turn that is never told stays awaiting a model
 * that is not coming.
 * @param {App} app @param {string} turnId @param {string} message @param {Error} cause
 * @returns {Incoming[]}
 */
function failed(app, turnId, message, cause) {
  const at = app.ports.clock.now()
  const kind = cause instanceof HarnessError ? cause.kind : 'unknown'
  return [
    { at, turnId, fact: { type: 'custom', kind: EFFECT_FAILED, payload: { message, kind, turnId } } },
    {
      at,
      turnId,
      fact: { type: 'model_replied', agent: app.me, text: '', reasoning: '' },
      reply: { calls: [], finish: 'error' },
    },
  ]
}

