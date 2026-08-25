/**
 * THE INTERFACE'S HOLD ON THE APPLICATION, AND IT HOLDS NOTHING ELSE.
 *
 * `attach` hands back three things (docs/SEAM.md, frozen): a synchronous
 * `seam`, a `run` that drives whatever a request queued, and a `subscribe` that
 * fires when the log has grown. This module adds ONE fact to them — a change
 * counter — and adds it for a mechanical reason: `useSyncExternalStore` needs a
 * snapshot that is `===` to the last one when nothing has changed, and a
 * projection is a fresh object on every call, so the counter is what the hook
 * compares and the projection is read after it moves.
 *
 * THERE IS NO STORE HERE. No projection is kept, no request is remembered, no
 * reducer runs. A component re-reads through `read` and renders what comes
 * back; anything cached here would be a second copy of the log, disagreeing
 * with it exactly as fast as the log changes.
 *
 * A BOOT THAT DID NOT COME UP IS A SESSION TOO, and it carries the one failure
 * shape rather than a null the shell has to interpret. The predecessor painted
 * a full frame over a core that had not started and the person found out by
 * typing into a box that did nothing.
 */

import { HarnessError, post } from '@harness/kernel'

/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('@/components/views/problem').ProblemData} ProblemData */
/** @typedef {(request: Request) => Response} Seam */

/**
 * @typedef {object} Session
 * @property {'ready'|'failed'} state
 * @property {(request: Request) => Response} read
 * @property {(agent: string, text: string) => Promise<void>} send
 * @property {(fn: () => void) => () => void} subscribe
 * @property {() => number} version
 * @property {ProblemData|null} problem what went wrong, when nothing came up
 */

/**
 * THE COMPOSITION ROOT, AS docs/SEAM.md FROZE IT. `@harness/adapters-web`
 * exports exactly this pair; the type is written out here rather than imported
 * so a test can hand over a boot that fails, which is the branch a person meets
 * in a private window.
 * @typedef {{bootBrowser: (opts?: {basePath?: string}) => Promise<unknown>, attach: (app: never) => {seam: Seam, run: () => Promise<void>, subscribe: (fn: () => void) => () => void}}} Wiring
 */

/**
 * Boot, attach, and NEVER REJECT: every way this can fail is a sentence on the
 * screen, because a rejected promise here would leave the shell painting a
 * frame with no way to say why it is empty.
 * @param {string} basePath where this build is served from, WITH ITS TRAILING
 *   SLASH: every asset the core fetches is `basePath + name`, and `/ASKK` would
 *   ask for `/ASKKmodels.json`
 * @param {Wiring} [wiring] injected by the tests; the browser loads the real one
 * @returns {Promise<Session>}
 */
export async function openSession(basePath, wiring) {
  try {
    // BROWSER-ONLY, SO IT IS LOADED IN THE BROWSER. A static export evaluates
    // every static import at build time, where there is no IndexedDB and no
    // origin to be served from; this runs from an effect and nowhere else.
    const pair = wiring ?? (await import('@harness/adapters-web'))
    const app = /** @type {never} */ (await pair.bootBrowser({ basePath }))
    return ready(pair.attach(app))
  } catch (failure) {
    return { state: 'failed', read: unreachable, send: unreachable, subscribe: noSubscribe, version: zero, problem: problemFor(failure) }
  }
}

/** @param {ReturnType<Wiring['attach']>} attached @returns {Session} */
function ready({ seam, run, subscribe }) {
  let version = 0
  /** @type {Set<() => void>} */
  const watchers = new Set()
  subscribe(() => {
    version += 1
    for (const watcher of watchers) watcher()
  })
  return {
    state: 'ready',
    read: (request) => seam(request),
    // The message crosses as a fact and the ANSWER to this request is the
    // transcript with it already in it. Nothing is kept from that answer: the
    // append moved the counter, so every reader re-reads for itself.
    send: async (agent, text) => {
      seam(post('/chat', { message: text }, { 'x-agent': agent }))
      await run()
    },
    subscribe: (fn) => {
      watchers.add(fn)
      return () => watchers.delete(fn)
    },
    version: () => version,
    problem: null,
  }
}

/**
 * WHAT WENT WRONG AND WHAT TO DO, in the one failure shape the whole interface
 * already renders. The repairs are the FACE's own copy and not the core's: the
 * core is what did not start, so there is nothing on the other side of the seam
 * to have worded this.
 * @param {unknown} failure
 * @returns {ProblemData}
 */
function problemFor(failure) {
  if (failure instanceof HarnessError) {
    return {
      id: 'boot', kind: failure.kind, message: failure.message, detail: failure.detail,
      repair: 'Reload the page. If it says the same thing again, this build cannot open its storage in this browser — a private window is the usual reason.',
    }
  }
  return {
    id: 'boot', kind: 'boot_failed',
    message: 'This page could not start its core, so nothing on it has been read from a log.',
    detail: String(failure),
    repair: 'Reload the page. If it says the same thing again, open the debug view for the exact failure.',
  }
}

/** @returns {never} */
function unreachable() {
  throw new HarnessError('no_session', 'This page asked a core that never started for a projection.', {
    detail: 'A failed session has no seam. Read `state` before reading a projection.',
  })
}

function noSubscribe() {
  return () => {}
}

function zero() {
  return 0
}
