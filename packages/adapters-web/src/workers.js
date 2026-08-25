/**
 * ONE WORKER PER AGENT — the door `agentsOver` opens, and the only place in
 * this build that starts one.
 *
 * THE WORKER IS A REAL MODULE ENTRY AND NOT A BLOB. `new Worker(new URL(...,
 * import.meta.url))` is the form every bundler in this stack recognises: the
 * build emits `agent-entry.js` as its own chunk beside the page's, so it loads
 * from this origin under the deploy's base path and a strict CSP has nothing to
 * refuse. A blob URL would need `worker-src blob:` and would carry no base path
 * for the sub-agent to fetch its own files from.
 *
 * `spawn` IS INJECTED FOR ONE REASON AND IT IS NOT GENERALITY: this file is the
 * boundary at which the browser enters, so a host test can drive the whole
 * channel — the begin going out, the ending coming home, the terminate on close
 * — against an object, and the only line it cannot execute is the `new Worker`
 * below it.
 *
 * TWO ERRANDS TO ONE AGENT AT ONE TIME ARE REFUSED, not queued and not run.
 * Each Worker boots the same agent name, and an agent's log is a SEGMENT STREAM
 * keyed by that name — two of them appending to it would interleave two
 * conversations into one history, and the second boot would read the first's
 * half-written turn back as its own.
 * @module
 */

import { DelegateError } from '@harness/kernel'
import { endedMessage } from '@harness/agent'

/** @typedef {import('@harness/agent').Channel} Channel */
/** @typedef {import('@harness/agent').Workers} Workers */

/** What this file needs of a Worker, which a real one is. The listener takes the base `Event` because that is the overload a real `Worker` offers for a string type; which event it really is, is narrowed at the one place that reads a field off it. @typedef {{postMessage: (message: unknown) => void, terminate: () => void, addEventListener: (type: string, handler: (event: Event) => void) => void}} WorkerLike */

/**
 * Whether this context can start one at all. A build that cannot is a build
 * that must not GRANT `agents` — a model told it may delegate does not treat
 * the capability as uncertain, it plans with it (I15).
 */
export function canDelegate() {
  return typeof Worker !== 'undefined'
}

/**
 * THE ONE `new Worker` IN THIS BUILD. What the sub-agent needs to know before
 * its first message — which agent it is, and where its files are — rides in the
 * worker's NAME, because the errand protocol is two messages and neither of
 * them is a place to put a deployment detail. `self.name` is standard, it is
 * set before the first line of the entry runs, and it survives the module load
 * that a second `postMessage` would race.
 * @param {string} agent @param {string} basePath @returns {WorkerLike}
 */
export function startWorker(agent, basePath) {
  return new Worker(new URL('./agent-entry.js', import.meta.url), { type: 'module', name: deskName(agent, basePath) })
}

/**
 * THE HANDSHAKE, WRITTEN ONCE. `agent-entry.js` parses this back before its
 * first message, and the two halves are a producer and a consumer of one format
 * — so the format is a function both a host test and the browser can call,
 * rather than a JSON literal in each file that can drift apart in silence.
 * @param {string} agent @param {string} basePath @returns {string}
 */
export function deskName(agent, basePath) {
  return JSON.stringify({ agent, basePath })
}

/**
 * @param {{me: string, roster: () => readonly string[], spawn: (agent: string) => WorkerLike}} opts
 * @returns {Workers}
 */
export function browserWorkers(opts) {
  /** @type {Set<string>} */
  const running = new Set()
  return {
    me: opts.me,
    // A GETTER BECAUSE THE ROSTER CHANGES DURING A SESSION. An agent authored
    // in this browser is installed the moment its fact is appended, and a
    // snapshot taken when the ports were built would refuse the agent the model
    // wrote two lines ago.
    get names() {
      return opts.roster().filter((name) => name !== opts.me)
    },
    open: (agent) => {
      if (running.has(agent)) {
        throw new DelegateError('refused', `${agent} is already working on an errand from this page, and it keeps one conversation — wait for that answer before sending another goal.`)
      }
      // THE NAME IS CLAIMED ONLY ONCE A WORKER EXISTS. `spawn` is `new Worker`,
      // which throws on a URL this origin refuses — and a name added before it
      // is a name nothing ever removes, so every later delegation is refused
      // with "already working on an errand" while nothing is working (I16).
      const channel = channelTo(opts.spawn(agent))
      running.add(agent)
      return { ...channel, close: () => { running.delete(agent); channel.close() } }
    },
  }
}

/**
 * ONE WORKER AS THE CHANNEL THE CALLER SEES.
 *
 * A WORKER THAT DIES IS AN ENDING AND NOT A SILENCE. A module that will not
 * load, a runtime error before the first turn, a message that will not
 * structured-clone: each of those posts nothing home, and the caller would wait
 * on the driver's deadline to learn only that nothing answered. The errand id
 * is read off the `begin` this channel carried out, which is the one thing that
 * makes an ending the caller will accept constructable here.
 * @param {WorkerLike} worker @returns {Channel}
 */
export function channelTo(worker) {
  let errandId = ''
  /** @type {(message: unknown) => void} */
  let deliver = () => {}
  const died = (/** @type {string} */ why) => deliver(endedMessage(errandId, { ok: false, text: '', why }))
  worker.addEventListener('message', (event) => deliver(/** @type {MessageEvent} */ (event).data))
  worker.addEventListener('error', (event) => died(crashed(/** @type {ErrorEvent} */ (event))))
  worker.addEventListener('messageerror', () => died('it sent something that could not cross the worker boundary'))
  return {
    post: (message) => {
      if (message.type === 'begin') errandId = message.errandId
      worker.postMessage(message)
    },
    onMessage: (handler) => { deliver = handler },
    close: () => worker.terminate(),
  }
}

/** What a worker's own error event says, with the place it happened when it has one. @param {ErrorEvent} event */
function crashed(event) {
  const where = event.filename ? ` (${event.filename}:${event.lineno})` : ''
  return `its worker failed: ${event.message || 'no reason was given'}${where}`
}
