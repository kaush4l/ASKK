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
 * A PORT FAILURE IS ONE TYPED FACT THE REDUCER SEES. The Rust's catch-all arm
 * turned every one of them into a card nothing folded, so the loop could not
 * decide anything about a failure — a refusal, a rate limit and a dead endpoint
 * were one shrug. Here a failed model call is `core.effect_failed` and nothing
 * else: `step`'s own ceiling asks again and then ends the turn QUOTING the
 * driver, which is what `ending.js` names FAILED.
 * @module
 */

import { HarnessError } from '@harness/kernel'
import { EFFECT_FAILED } from '@harness/agent'

import { callTool, runDelegate } from './batch.js'
import { LATE, lateAfter, within } from './deadline.js'

/** @typedef {import('@harness/agent').Effect} Effect */
/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').Incoming} Incoming */
/** @typedef {import('./deadline.js').Driving} Driving */

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
 * ASK THE MODEL, ONCE, AFTER THE WAIT THE LOOP ASKED FOR.
 *
 * THERE IS ONE RETRY POLICY AND IT IS THE LOOP'S. `step` counts the attempts,
 * decides whether another is worth making, and says how long to wait first
 * (`afterMs`) — it is pure and holds no clock, so this is the only place that
 * waits. The driver used to run a second retry loop with a ceiling of its own:
 * one dead endpoint then cost twelve calls rather than the three
 * `MAX_ATTEMPTS` declares, and neither number was written where anybody
 * counting them would look.
 * @param {App} app @param {Effect & {type: 'CallModel'}} effect @param {Driving} opts
 * @returns {Promise<Incoming[]>}
 */
async function callModel(app, effect, opts) {
  if (effect.afterMs > 0) await opts.timer.wait(effect.afterMs)
  // `context.buildRequest` (lane A) is this body's author and this is its one
  // call site; until it lands the paper crosses whole, which the scripted port
  // reads and the real adapter will not.
  const body = { model: effect.model, temperature: effect.temperature, document: effect.document }
  const outcome = await attemptCall(app, effect, body, opts)
  if (!(outcome instanceof Error)) return outcome
  return failed(app, effect.turnId, `The model did not answer: ${outcome.message}`, outcome)
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
    fact: { type: 'model_replied', agent: speaker, text: reply.text, reasoning: reply.reasoning, finish: reply.finish },
    // REPORTED, NOT INFERRED. This line used to read
    // `reply.calls.length > 0 ? 'tool_calls' : 'stop'`, which made a
    // truncation, a refusal and a content filter into one outcome — a
    // completed answer — and that is precisely what `ending.js` was written to
    // end. `ModelReply.finish` now carries the provider's own reason, because
    // the port is the one layer that reads the wire.
    reply: { calls: reply.calls, finish: reply.finish },
  })
  return facts
}

/**
 * THE FAILURE, ONCE. It used to be recorded twice — the typed fact, and an
 * empty `model_replied` meant to carry the provider's `error` signal into
 * `endingFor`. It never got there: an empty completion is intercepted by the
 * stall guard before the finish signal is read, so one dead endpoint counted as
 * two retries, cost twice the calls, and ended the turn saying "empty
 * completions" about a key the endpoint had refused. `step` already retries a
 * model failure and already ends the turn quoting it; the second fact only
 * disagreed with the first.
 * @param {App} app @param {string} turnId @param {string} message @param {Error} cause
 * @returns {Incoming[]}
 */
function failed(app, turnId, message, cause) {
  const kind = cause instanceof HarnessError ? cause.kind : 'unknown'
  // `{effect, reason}` IS THE CONTRACT `retry.js` READS. This payload used to
  // be `{message, kind}`, which `failureIn` answers `null` to — so every model
  // failure this driver recorded was invisible to the loop that exists to
  // decide about one, and only the second fact below it moved the turn at all.
  const payload = { effect: 'CallModel', reason: message, kind, turnId }
  return [{ at: app.ports.clock.now(), turnId, fact: { type: 'custom', kind: EFFECT_FAILED, payload } }]
}

