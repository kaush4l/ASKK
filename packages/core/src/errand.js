/**
 * A MESSAGE ADDRESSED TO ANOTHER AGENT, and what this process does about it.
 * The predicate and the work are separate on purpose: a predicate is read for
 * its answer and not for what it appended, and while the two were one function
 * called `ranElsewhere` a review read past both a dropped failure and a turn
 * that was never closed.
 * @module
 */

import { runEffect } from './effects.js'

/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').Incoming} Incoming */
/** @typedef {import('./deadline.js').Driving} Driving */

/**
 * WHOSE MESSAGE IS THIS. A message addressed to another agent never enters this
 * loop: its turn runs on that agent's own Worker and is recorded under its own
 * name, so two conversations on one page cannot cross. Pumping it here would
 * put someone else's words into this agent's paper.
 * @param {App} app @param {Fact} fact @returns {boolean}
 */
export function addressedElsewhere(app, fact) {
  return fact.type === 'user_message' && fact.agent !== '' && fact.agent !== app.me
}

/**
 * RUN THE ERRAND AND RECORD WHAT CAME BACK. The deadline is this loop's own
 * (I21): the queue is drained sequentially, so a delegation with no deadline
 * wedges every turn behind it as well as itself, and the callee's Worker is not
 * yet a thing anything can check.
 *
 * APPENDED AND NOT QUEUED. The answer belongs to that agent's conversation, and
 * pumping it here would hand this agent's reducer a reply to a call it never
 * made — which `turn.refusal` correctly drops, leaving an anomaly record in the
 * wrong transcript blaming the wrong turn.
 * @param {App} app @param {Incoming} incoming @param {Driving} opts
 * @returns {Promise<Incoming[]>} the facts it recorded
 */
export async function runErrand(app, incoming, opts) {
  // The predicate above is the narrowing, and tsc cannot carry one across a call.
  const fact = /** @type {Fact & {type: 'user_message'}} */ (incoming.fact)
  const who = fact.agent
  // WHAT THIS PROCESS KNOWS AND THE LOG DOES NOT: the errand is in flight. The
  // pending queue cannot answer it — this item was shifted off before the await
  // — so `driving` read it as false for the whole call it exists to cover, and
  // the pane told the person their page had been reloaded.
  app.errands.add(who)
  try {
    const errand = { type: /** @type {const} */ ('Delegate'), turnId: '', agent: who, goal: fact.text, batch: 0 }
    const kept = recorded(await runEffect(app, errand, opts), who)
    for (const back of kept) app.log.append(back.fact, back.at)
    return kept
  } finally {
    app.errands.delete(who)
    closed(app, who)
  }
}

/**
 * WHICH OF THE ERRAND'S FACTS BELONG IN THAT AGENT'S TRANSCRIPT — everything
 * except the receipt of a delegation that WORKED, because the answer above it
 * IS the receipt. Filtering on the fact TYPE instead dropped every failure
 * whole: an unknown agent, a thrown port error and a late answer each come back
 * as one `tool_invoked` and nothing else, so the port's own sentence was the
 * only thing that could tell the person, and it was the thing being dropped.
 *
 * A result is stamped with the agent it was an errand to, because `result` in
 * `batch.js` words it for the CALLER's transcript and the person is watching
 * the callee's.
 * @param {Incoming[]} answered @param {string} who @returns {Incoming[]}
 */
function recorded(answered, who) {
  /** @type {Incoming[]} */
  const kept = []
  for (const back of answered) {
    const fact = back.fact
    if (fact.type !== 'tool_invoked') kept.push(back)
    else if (!fact.ok) kept.push({ ...back, fact: { ...fact, agent: who } })
  }
  return kept
}

/**
 * CLOSE THE TURN IN THE CALLEE'S OWN BUCKET. Nothing else can: an ending fact
 * is a `custom` one, `custom` carries no agent name, and the fold therefore
 * files it under this process's agent — so the callee's conversation stayed
 * `open` for ever and rendered the reload sentence beside an answer that had
 * already arrived.
 * @param {App} app @param {string} who
 */
function closed(app, who) {
  const fact = /** @type {Fact} */ ({ type: 'agent_status', agent: who, status: 'idle', detail: 'That errand is over.' })
  app.log.append(fact, app.ports.clock.now())
}
