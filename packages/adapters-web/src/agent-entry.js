/**
 * THE SUB-AGENT'S OWN MAIN. This module is the whole of what runs inside a
 * Worker: read the goal, boot the same application the page boots, run one
 * turn, post the ending home.
 *
 * IT BOOTS THE SAME BUILD. Not a lesser one, not a loop assembled here — the
 * same `bootBrowser`, the same ports, the same catalogue and the same agent
 * files, keyed to a different name. A sub-agent that could not read a file or
 * call a tool the page can would be a second product with one name.
 *
 * ITS CONVERSATION IS REAL STORAGE. `bootBrowser` opens this origin's
 * IndexedDB and the log is a SEGMENT STREAM keyed by the agent's name, so a
 * sub-agent's transcript survives a reload, a second errand continues it, and
 * the page can open the same history at `?agent=<name>`. A Map here would lose
 * the whole conversation the moment the Worker was terminated — which is at
 * the end of every errand.
 *
 * ONE WORKER, ONE ERRAND. The caller opens a channel per errand and closes it
 * when the errand settles, so a second `begin` arriving here is a caller
 * confused about what it is running, and it is answered in words rather than
 * queued behind a turn nobody is waiting on.
 * @module
 */

import { endedMessage, readMessage } from '@harness/agent'
import { errandTurn } from '@harness/core'

import { bootBrowser } from './boot.js'
import { browserTimer } from './ports.js'

/**
 * The worker global, as the two things this file uses of it. `self` is typed as
 * a Window by the DOM library and this is not one: `postMessage` here takes no
 * target origin, and `name` carries what the page set at `new Worker`.
 */
const scope = /** @type {{name: string, postMessage: (message: unknown) => void, addEventListener: (type: string, handler: (event: MessageEvent) => void) => void}} */ (
  /** @type {unknown} */ (globalThis)
)

/** Who this Worker is and where its files are, set by `startWorker` before this module ran. @returns {{agent: string, basePath: string}} */
function desk() {
  try {
    const said = /** @type {{agent?: unknown, basePath?: unknown}} */ (JSON.parse(scope.name || '{}'))
    return { agent: typeof said.agent === 'string' ? said.agent : '', basePath: typeof said.basePath === 'string' ? said.basePath : './' }
  } catch {
    return { agent: '', basePath: './' }
  }
}

let taken = false

scope.addEventListener('message', (event) => {
  const said = readMessage(event.data)
  if ('unreadable' in said || said.type !== 'begin') return
  if (taken) {
    scope.postMessage(endedMessage(said.errandId, { ok: false, text: '', why: 'this worker is already running an errand' }))
    return
  }
  taken = true
  void ran(said)
})

/**
 * ONE ERRAND, END TO END. A failure to boot is an ENDING and not a silence:
 * the caller is holding a promise on this message, and a Worker that came up
 * broken must say so in the words the caller can put in a transcript (I16).
 * @param {import('@harness/agent').Begin} begin
 */
async function ran(begin) {
  const { agent, basePath } = desk()
  try {
    const app = await bootBrowser({ basePath, agent })
    scope.postMessage(await errandTurn(app, begin, { timer: browserTimer() }))
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    scope.postMessage(endedMessage(begin.errandId, { ok: false, text: '', why: `${agent || 'that agent'} could not start: ${why}` }))
  }
}
