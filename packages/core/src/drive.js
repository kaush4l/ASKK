/**
 * THE DRIVER: a fact in, a step, the effects run, the facts back, until nothing
 * is pending. Event sourcing's other half — `step` DESCRIBES work and this is
 * the only thing that does any.
 *
 * INDEPENDENT EFFECTS IN ONE BATCH RUN AT THE SAME TIME. The Rust parallelised
 * delegations only and awaited everything else one at a time, while the loop's
 * own rule said calls written on one line are independent — the rule was right
 * and its scope was wrong. Two tools the model asked for together are started
 * together; their results are recorded in the order the MODEL WROTE them and
 * never the order they finished, because a transcript has to be reproducible.
 *
 * EVERY EFFECT LEAVES STAMPED WITH ITS TURN AND EVERY FACT COMES BACK CARRYING
 * IT (I21). The turn is minted here, once per accepted message, because ids are
 * injected (I7) and a turn that named itself would be a turn no effect could be
 * matched against.
 * @module
 */

import { factAgent } from '@harness/kernel'
import { step } from '@harness/agent'

import { CONVERSATION } from './reducers.js'
import { runEffect } from './effects.js'

/** @typedef {import('@harness/agent').Effect} Effect */
/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').Incoming} Incoming */
/** @typedef {import('./deadline.js').Driving} Driving */

/**
 * Drain the queue. Everything a handler recorded, everything the effects
 * produce, and everything those produce in turn, until the agent is quiet.
 * @param {App} app @param {Driving} opts @returns {Promise<void>}
 */
export async function drive(app, opts) {
  while (app.pending.length > 0) {
    const next = app.pending.shift()
    if (!next) break
    if (await ranElsewhere(app, next)) continue
    const taken = step(app.agent, stamp(app, next))
    app.agent = taken.state
    await runEffects(app, taken.effects, opts)
    told(app)
  }
}

/**
 * WHOSE MESSAGE IS THIS. A message addressed to another agent never enters this
 * loop: its turn runs on that agent's own Worker and is recorded under its own
 * name, so two conversations on one page cannot cross. Pumping it here would
 * put someone else's words into this agent's paper.
 * @param {App} app @param {Incoming} incoming @returns {Promise<boolean>}
 */
async function ranElsewhere(app, incoming) {
  const fact = incoming.fact
  if (fact.type !== 'user_message' || fact.agent === '' || fact.agent === app.me) return false
  const answered = await runEffect(app, { type: 'Delegate', turnId: '', agent: fact.agent, goal: fact.text, batch: 0 }, { timer: NEVER })
  // APPENDED AND NOT QUEUED. The answer belongs to that agent's conversation,
  // and pumping it here would hand this agent's reducer a reply to a call it
  // never made — which `turn.refusal` correctly drops, leaving an anomaly
  // record in the wrong transcript blaming the wrong turn.
  for (const back of answered) if (back.fact.type === 'model_replied') app.log.append(back.fact, back.at)
  return true
}

/** A timer for a call this loop is not waiting on — the callee's own deadline is. */
const NEVER = { wait: () => new Promise(() => {}) }

/**
 * The turn this fact belongs to. A person's utterance MINTS one; everything
 * else answers the turn already running, and `turn.refusal` drops it if that is
 * no longer the live one.
 * @param {App} app @param {Incoming} incoming @returns {Incoming}
 */
function stamp(app, incoming) {
  if (incoming.turnId !== null) return incoming
  if (incoming.fact.type !== 'user_message') return { ...incoming, turnId: app.agent.turnId }
  return { ...incoming, turnId: mint(app) }
}

/** A turn id from injected bytes (I7), so a replay of a test is byte-identical. */
function mint(/** @type {App} */ app) {
  return [...app.ports.rng.bytes(8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Run one step's effects, batch by batch, recording every fact they produce.
 * @param {App} app @param {Effect[]} effects @param {Driving} opts
 */
async function runEffects(app, effects, opts) {
  for (const batch of lines(effects)) {
    const produced = await Promise.all(batch.map((effect) => runEffect(app, effect, opts)))
    for (const facts of produced) for (const fact of facts) record(app, fact)
  }
}

/**
 * THE LAYOUT RULE, IN ONE FUNCTION. Effects the model wrote on one line are one
 * batch; a new line waits for the one above it. Tool calls arrive as the run
 * `step` built from a single reply, and delegations carry the line they were
 * written on, which is what `Effect.batch` is for.
 * @param {Effect[]} effects @returns {Effect[][]}
 */
function lines(effects) {
  /** @type {Effect[][]} */
  const batches = []
  for (const effect of effects) {
    const open = batches[batches.length - 1]
    if (open && sameLine(open[0], effect)) open.push(effect)
    else batches.push([effect])
  }
  return batches
}

/** @param {Effect|undefined} first @param {Effect} next */
function sameLine(first, next) {
  if (!first) return false
  if (first.type === 'InvokeTool' && next.type === 'InvokeTool') return true
  return first.type === 'Delegate' && next.type === 'Delegate' && first.batch === next.batch
}

/**
 * Append one fact and queue it for the loop. The two happen together on
 * purpose: a fact the log holds that the loop never sees is a fact a projection
 * shows and the agent does not know about.
 * @param {App} app @param {Incoming} incoming
 */
function record(app, incoming) {
  app.log.append(incoming.fact, incoming.at)
  app.pending.push(incoming)
}

/**
 * SAY WHAT THE AGENT IS DOING, when it changes. The board and the conversation
 * are folds of these facts (I8) — a status written straight into a table is the
 * second authority the log exists to remove — and emitting one per transition
 * rather than per pass is what keeps a poll from filling the log with news that
 * nothing happened.
 * @param {App} app
 */
function told(app) {
  const want = app.agent.awaiting === 'model' ? 'thinking' : app.agent.awaiting === 'tools' ? 'calling' : 'idle'
  const held = /** @type {Record<string, {status: string}>} */ (app.log.read(CONVERSATION))[app.me]
  if ((held?.status ?? 'idle') === want) return
  const detail = want === 'idle' ? 'The turn is over.' : `${app.agent.toolRounds} tool rounds so far.`
  const at = app.ports.clock.now()
  record(app, { at, turnId: app.agent.turnId, fact: { type: 'agent_status', agent: app.me, status: want, detail } })
}

/**
 * WHETHER SOMETHING IS REALLY DRIVING THIS AGENT'S TURN. The log's shape — the
 * last thing said was a person's — is not the answer: a reload replays that
 * shape with no fetch behind it, and the pane then sat disabled on "thinking…"
 * with a clock that could not tick. This is state THIS PROCESS holds and a
 * reload does not, which is the whole point. Another agent's turn runs on its
 * own Worker, so this process is never the one driving it.
 */
export function driving(/** @type {App} */ app, /** @type {string} */ who) {
  if (who !== app.me) return app.pending.some((p) => factAgent(p.fact) === who)
  return app.agent.turnId !== '' || app.pending.length > 0
}
