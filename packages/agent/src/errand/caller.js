/**
 * THE LEAD'S HALF: an `AgentPort` built over channels to Workers it never looks
 * inside.
 *
 * `delegate` is the whole surface — a name and a goal out, one string back —
 * and everything it can do with the sub-agent is on the other side of `post`.
 * There is no shared state to reach for, so the sentence `batch.js` already
 * writes ("the caller never holds the callee's loop") is now enforced by the
 * shape of this file rather than by everyone remembering it.
 *
 * ONE CHANNEL PER ERRAND, and it closes when the errand settles. Two errands to
 * one agent at the same time are two Workers: sharing one would make the second
 * goal arrive in the middle of the first one's turn, and the first agent's
 * paper would then carry a task nobody gave it. The Worker itself is opened by
 * whoever composed this port — nothing here can construct one (I3), which is
 * also why this is testable on the host against two arrays.
 *
 * IDS ARE MINTED FROM A COUNTER, not from randomness (I7). They only have to be
 * unique within one page's lifetime, because they never leave it: an errand id
 * names a promise this object is holding, and nothing persists one.
 * @module
 */

import { DelegateError } from '@harness/kernel'
import { beginMessage, readMessage } from './protocol.js'

/** @typedef {import('@harness/kernel').AgentPort} AgentPort */
/** @typedef {import('./protocol.js').ErrandMessage} ErrandMessage */

/** One sub-agent, reachable only by message. `close` ends the Worker: an errand that settled has nothing left to say, and one that was abandoned must stop spending the person's tokens. @typedef {{post: (message: ErrandMessage) => void, onMessage: (handler: (message: unknown) => void) => void, close: () => void}} Channel */

/** Where a sub-agent comes from: the names this build can run, and the door that starts one. @typedef {{names: readonly string[], open: (agent: string) => Channel}} Workers */

/**
 * @param {Workers} workers
 * @returns {AgentPort}
 */
export function agentsOver(workers) {
  let minted = 0
  return {
    roster: () => [...workers.names],
    delegate: (agent, goal, opts) => {
      if (!workers.names.includes(agent)) {
        // NAMED, NOT SILENT (I15). A model that asked for an agent this build
        // does not have gets the refusal as its observation and can pick
        // another; an empty string would read as an agent that answered nothing.
        return Promise.reject(new DelegateError('unknown', `There is no agent called "${agent}" in this build, so nothing ran that errand.`, { detail: workers.names.join(', ') }))
      }
      minted += 1
      return awaited(workers.open(agent), `e-${minted}`, agent, goal, opts?.signal)
    },
  }
}

/**
 * POST THE GOAL AND WAIT FOR THE ENDING THE CALLEE RECORDED.
 *
 * Three ways out and every one of them closes the channel: the errand ended,
 * the errand ended badly, or the person stopped it. A fourth — waiting forever
 * — is the driver's deadline to impose (`batch.js` already does), because a
 * timeout here would be a second clock in a second place.
 * @param {Channel} channel @param {string} errandId @param {string} agent
 * @param {string} goal @param {AbortSignal} [signal]
 * @returns {Promise<string>}
 */
function awaited(channel, errandId, agent, goal, signal) {
  return new Promise((resolve, reject) => {
    const settle = (/** @type {() => void} */ then) => { channel.close(); then() }
    signal?.addEventListener('abort', () => settle(() => reject(new DelegateError('abandoned', `${agent} was stopped before it finished that errand.`))), { once: true })
    channel.onMessage((message) => {
      const said = readMessage(message)
      if ('unreadable' in said) return settle(() => reject(new DelegateError('unreadable', `${agent} sent something this build cannot read: ${said.unreadable}`)))
      if (said.type !== 'ended' || said.errandId !== errandId) return
      if (!said.ok) return settle(() => reject(new DelegateError('failed', `${agent} did not answer: its turn ended "${said.why}".`, { detail: said.text })))
      return settle(() => resolve(said.text))
    })
    channel.post(beginMessage(errandId, goal))
  })
}
