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

import { HarnessError, isProblem, post } from '@harness/kernel'

/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('@/components/views/problem').ProblemData} ProblemData */

/**
 * @typedef {object} Session
 * @property {(request: Request) => Response} read
 * @property {(agent: string, text: string) => Promise<ProblemData|null>} send
 *   what the seam REFUSED, or null when the turn was accepted
 * @property {(fn: () => void) => () => void} subscribe
 * @property {() => number} version
 * @property {ProblemData|null} problem what went wrong, when nothing came up
 */

/**
 * THE COMPOSITION ROOT, AS docs/SEAM.md FROZE IT — and the pair is taken FROM
 * the module that exports it rather than spelled out again here, so a fourth
 * member or a `seam` that turned async fails this file instead of the browser
 * (I19). It is a type-position import: `tsc` erases it and no bundler ever sees
 * it, so the browser-only package is still loaded in the browser and nowhere
 * else. A test hands over its own object; the structure is what is checked.
 * @typedef {Pick<typeof import('@harness/adapters-web'), 'bootBrowser'|'attach'>} Wiring
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
    const app = await pair.bootBrowser({ basePath })
    return ready(pair.attach(app))
  } catch (failure) {
    return {
      read: unreachable, send: unreachable, problem: problemFor(failure),
      subscribe: () => () => {}, version: () => 0,
    }
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
    read: (request) => seam(request),
    send: sender(seam, run),
    subscribe: (fn) => {
      watchers.add(fn)
      return () => watchers.delete(fn)
    },
    version: () => version,
    problem: null,
  }
}

/**
 * ONE MESSAGE ACROSS THE SEAM, AND WHAT CAME BACK.
 *
 * The message crosses as a fact and the ANSWER is the transcript with it
 * already in it, so nothing is kept from an acceptance: the append moved the
 * counter and every reader re-reads for itself.
 *
 * A REFUSAL IS THE ONE THING THAT COMES BACK. `POST /chat` answers with the
 * failure projection for an empty message and for a build never granted the
 * right to record facts, and `run` rejects when the turn cannot be run at all.
 * Dropping either is a dead switch with a proof of life attached: the draft is
 * cleared, `handle` appends `request_handled` so every reader re-renders, and
 * the screen comes back identical with nothing said about what it refused.
 * @param {(request: Request) => Response} seam
 * @param {() => Promise<void>} run
 * @returns {Session['send']}
 */
function sender(seam, run) {
  return async (agent, text) => {
    const answered = seam(post('/chat', { message: text }, { 'x-agent': agent }))
    // The failure projection's `data` IS this shape — `problem()` builds those
    // five strings and nothing else (packages/kernel/src/seam.js) — and the seam
    // types every `data` as an open record, so it is narrowed once, here.
    if (isProblem(answered)) return /** @type {ProblemData} */ (answered.data)
    try {
      await run()
    } catch (failure) {
      return turnFailure(failure)
    }
    return null
  }
}

/**
 * A TURN THAT STOPPED, in the same failure shape as everything else. `run`
 * rejects only where no retry repairs anything: a store failure is recorded as
 * a fact and the turn carries on (`packages/core/src/log/persist.js`), so what
 * reaches here is a build assembled wrong, and the repair says so rather than
 * inviting a person to press send until it works.
 * @param {unknown} failure
 * @returns {ProblemData}
 */
function turnFailure(failure) {
  const typed = failure instanceof HarnessError
  return {
    id: 'chat',
    kind: typed ? failure.kind : 'turn_failed',
    message: typed ? failure.message : 'This turn stopped before it could be run, so nothing was said back.',
    detail: typed ? failure.detail : String(failure),
    repair: 'Saying it again will stop the same way. Everything written before this turn is still in the log; the debug view has the failure itself.',
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
    detail: 'A failed session has no seam. Read `problem` before reading a projection.',
  })
}
