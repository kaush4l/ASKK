/**
 * WHAT THE LOG SAYS ABOUT ITSELF: the running totals every tile is made of, and
 * a BOUNDED tail of recent facts for the debug view.
 *
 * Both are folds, and the second one is bounded for the same reason the log is
 * (I20): the debug pane in the predecessor rendered `log.iter()`, so opening it
 * against a browser holding 39,237 events cloned all of them into a handler and
 * then into React. A tail of 200 is what a person can actually read, and it
 * costs the same whether the history is a hundred facts or a hundred thousand.
 * @module
 */

import { factAgent } from '@harness/kernel'

/** @typedef {import('@harness/kernel').Event} Event */
/** @typedef {import('@harness/kernel').Fact} Fact */

export const ACTIVITY = 'activity'
export const TRACE = 'trace'

/** How many facts the debug view can reach. Bounded, always (I20). */
export const TRACE_KEPT = 200

/**
 * @typedef {{
 *   messages: number, modelCalls: number, spentTokens: number,
 *   toolCalls: number, toolFailures: number,
 *   storeFailures: number, lastStoreFailure: string,
 * }} Activity
 */

/** @type {import('./log/reducers.js').Reducer} */
export const activityReducer = {
  name: ACTIVITY,
  version: 1,
  init: () => /** @type {Activity} */ ({
    messages: 0, modelCalls: 0, spentTokens: 0, toolCalls: 0, toolFailures: 0,
    storeFailures: 0, lastStoreFailure: '',
  }),
  fold: (/** @type {Activity} */ state, /** @type {Event} */ event) => {
    const fact = event.fact
    if (fact.type === 'user_message') state.messages += 1
    if (fact.type === 'model_called') {
      state.modelCalls += 1
      state.spentTokens += fact.spentTokens
    }
    if (fact.type === 'tool_invoked') {
      state.toolCalls += 1
      if (!fact.ok) state.toolFailures += 1
    }
    if (fact.type === 'store_failed') {
      state.storeFailures += 1
      state.lastStoreFailure = `${fact.key}: ${fact.message}`
    }
    return state
  },
}

/** One fact as the debug view reads it: already worded, never re-parsed (I5). */
/** @typedef {{id: string, seq: number, at: number, turnId: string, agent: string, kind: string, summary: string}} Traced */

/** @type {import('./log/reducers.js').Reducer} */
export const traceReducer = {
  name: TRACE,
  version: 1,
  init: () => /** @type {Traced[]} */ ([]),
  fold: (/** @type {Traced[]} */ state, /** @type {Event} */ event) => {
    state.push({
      id: `e${event.seq}`,
      seq: event.seq,
      at: event.at,
      turnId: event.turnId,
      agent: factAgent(event.fact),
      kind: kindOf(event.fact),
      summary: summaryOf(event.fact),
    })
    if (state.length > TRACE_KEPT) state.splice(0, state.length - TRACE_KEPT)
    return state
  },
}

/** The fact's own name, with a `custom` fact answering with the kind it carries. */
function kindOf(/** @type {Fact} */ fact) {
  return fact.type === 'custom' ? fact.kind : fact.type
}

/**
 * ONE SENTENCE PER FACT. It is the core's job and not the pane's (I5): the
 * debug view lists eleven different shapes, and a component switching over them
 * would be the component computing what the log means.
 * @param {Fact} fact @returns {string}
 */
function summaryOf(fact) {
  if (fact.type === 'request_handled') return `${fact.path} answered ${fact.status}`
  if (fact.type === 'user_message') return clipped(fact.text)
  if (fact.type === 'model_called') return `${fact.spentTokens} tokens`
  if (fact.type === 'model_replied') return `${fact.finish} · ${clipped(fact.text)}`
  if (fact.type === 'tool_invoked') return `${fact.tool} ${fact.ok ? 'ok' : 'failed'} · ${clipped(fact.output)}`
  if (fact.type === 'agent_status') return `${fact.status} · ${fact.detail}`
  if (fact.type === 'stage_entered') return fact.stage
  if (fact.type === 'store_failed') return `${fact.key}: ${fact.message}`
  if (fact.type === 'module_installed' || fact.type === 'module_removed') return `${fact.module} ${fact.version}`
  return clipped(JSON.stringify(fact.payload ?? null))
}

/** As much of a fact as a debug row can hold. The rest is in the artifact or the transcript. */
function clipped(/** @type {string} */ text) {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= 120 ? one : `${one.slice(0, 117)}…`
}
