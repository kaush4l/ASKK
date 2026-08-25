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
 * ITS CONVERSATION IS REAL STORAGE, AND `ran` IS WHAT WRITES IT. `bootBrowser`
 * opens this origin's IndexedDB and the log is a SEGMENT STREAM keyed by the
 * agent's name, so a sub-agent's transcript survives a reload, a second errand
 * continues it, and the page can open the same history at `?agent=<name>`. The
 * page has a drive loop that flushes after every turn; a Worker does not, so
 * the flush is here, before the ending goes home — the caller terminates this
 * Worker the moment it arrives.
 *
 * ONE WORKER, ONE ERRAND. The caller opens a channel per errand and closes it
 * when the errand settles, so a second `begin` arriving here is a caller
 * confused about what it is running, and it is answered in words rather than
 * queued behind a turn nobody is waiting on.
 * @module
 */

import { DelegateError } from '@harness/kernel'
import { endedMessage, readMessage } from '@harness/agent'
import { errandTurn } from '@harness/core'

import { bootBrowser } from './boot.js'
import { browserTimer } from './ports.js'

/** @typedef {import('@harness/core').App} App */

/**
 * The worker global, as the two things this file uses of it. `self` is typed as
 * a Window by the DOM library and this is not one: `postMessage` here takes no
 * target origin, and `name` carries what the page set at `new Worker`.
 */
const scope = /** @type {{name: string, postMessage: (message: unknown) => void, addEventListener: (type: string, handler: (event: MessageEvent) => void) => void}} */ (
  /** @type {unknown} */ (globalThis)
)

/**
 * Who this Worker is and where its files are, written by `deskName` before this
 * module ran. A name that will not parse THROWS: answering `{agent: ''}` boots
 * a nameless agent with a blank prompt against the wrong segment stream and
 * answers the errand as though nothing were wrong, which is the one failure the
 * caller has no way to see (I16). `ran` turns this into an ending it can read.
 * @returns {{agent: string, basePath: string}}
 */
function desk() {
  const unreadable = (/** @type {unknown} */ cause) =>
    new DelegateError('crashed', `this worker cannot read its own desk, so it does not know which agent it is: its name was ${scope.name ? JSON.stringify(scope.name) : 'empty'}`, { cause })
  /** @type {{agent?: unknown, basePath?: unknown}} */
  let said
  try {
    said = JSON.parse(scope.name)
  } catch (cause) {
    throw unreadable(cause)
  }
  if (typeof said?.agent !== 'string' || said.agent === '') throw unreadable(null)
  return { agent: said.agent, basePath: typeof said.basePath === 'string' ? said.basePath : './' }
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
  void ran(said).then((ended) => scope.postMessage(ended))
})

/**
 * ONE ERRAND, END TO END. A failure to boot — or to read the desk — is an
 * ENDING and not a silence: the caller is holding a promise on the message this
 * resolves to, and a Worker that came up broken must say so in the words the
 * caller can put in a transcript (I16).
 *
 * THE TURN IS WRITTEN DOWN BEFORE THE ANSWER GOES HOME. Posting the ending is
 * what makes the caller close the channel, and closing it terminates this
 * Worker — so a `persist` after that line runs in a context that no longer
 * exists, and the whole conversation this errand recorded would evaporate. It
 * is safe to await: `persist` records its own failure as a fact and returns.
 *
 * `boot` IS INJECTED FOR THE SAME REASON `spawn` IS IN `workers.js` — this is
 * where the browser enters, so a host test drives the desk, the turn, the store
 * and the ending against a real application, and the only line it cannot
 * execute is the `new Worker` that started this file.
 * @param {import('@harness/agent').Begin} begin
 * @param {(opts: {basePath: string, agent: string}) => Promise<App>} [boot]
 * @returns {Promise<import('@harness/agent').Ended>}
 */
export async function ran(begin, boot = bootBrowser) {
  let agent = ''
  try {
    const at = desk()
    agent = at.agent
    const app = await boot({ basePath: at.basePath, agent })
    const ended = await errandTurn(app, begin, { timer: browserTimer() })
    await app.log.persist()
    return ended
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return endedMessage(begin.errandId, { ok: false, text: '', why: `${agent || 'that agent'} could not start: ${why}` })
  }
}
