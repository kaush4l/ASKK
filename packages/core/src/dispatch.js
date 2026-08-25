/**
 * THE ONE DISPATCH POINT (I4). Route → registry lookup → effective-grant
 * context → handler → projection. `handle` is the only door the interface has,
 * and this is the only file that calls a module's logic: everywhere else reads
 * a manifest, never `entry.handler`. That sentence is EXECUTED by
 * `test/dispatch.test.js`, which greps this package for a second caller — a
 * rule a gate cannot run is not a rule (I17).
 *
 * Built-in and authored modules are dispatched by the identical three lines,
 * and no manifest field says which is which, so I9 erosion is unrepresentable
 * rather than forbidden. The Rust here matched on `Tier` first and answered
 * tier-1 with a 501; `Tier::T1` had zero construction sites in the tree it was
 * written for, so the match does not survive the port.
 * @module
 */

import { HarnessError, problem } from '@harness/kernel'

import { contextFor } from './ctx.js'

/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./app.js').App} App */

/**
 * The seam. Synchronous by construction: a request either projects what the
 * log already holds or records a fact and projects the result — work that
 * takes time leaves as an effect, so the interface can never hang on it.
 * @param {App} app
 * @param {Request} request
 * @returns {Response}
 */
export function handle(app, request) {
  const hit = app.registry.resolve(request.method, request.path)
  const response = hit
    ? invoke(app, hit, request)
    : problem(404, `Nothing here answers ${request.method} ${request.path}.`, {
        kind: 'no_route',
        detail: 'No installed module declares that method and path.',
        repair: 'Check the address, or install a module that serves it.',
      })

  // ONLY A REQUEST THAT CHANGED SOMETHING IS A FACT. A GET is somebody looking
  // at a projection, and recording that records that someone looked. Measured
  // in the predecessor — four panes polling between 400ms and 2s appended
  // thousands of these an hour, each one persisted, so the log grew without
  // anything happening.
  //
  // A GET THAT FAILED IS THE SAME GET. It changed nothing, and appending for it
  // was worse than appending for the success: growth is what wakes every pane
  // subscribed to the log, each pane re-reads, and a 404 a pane polls spins the
  // page for as long as the address is wrong. The failure is not lost — `note`
  // below puts it where a person looks for it, which is the debug view.
  if (response.status >= 400) note(app, request, response)
  if (request.method !== 'GET') {
    app.log.append(
      { type: 'request_handled', path: request.path, status: response.status },
      app.ports.clock.now(),
    )
  }
  return response
}

/**
 * A FAILED REQUEST, KEPT WHERE IT CAN BE READ AND NOWHERE THE PANES WATCH.
 * Bounded for the same reason the trace is (I20) and newest last, so the debug
 * view can render the tail of it without a fold and without a store.
 * @param {App} app @param {Request} request @param {Response} response
 */
function note(app, request, response) {
  app.refusalSeq += 1
  app.refusals.push({
    seq: app.refusalSeq,
    at: app.ports.clock.now(),
    method: request.method,
    path: request.path,
    status: response.status,
    kind: String(response.data.kind ?? ''),
    message: String(response.data.message ?? ''),
  })
  if (app.refusals.length > REFUSALS_KEPT) app.refusals.splice(0, app.refusals.length - REFUSALS_KEPT)
}

/** How many failed requests the debug view can reach back through. A person debugging reads the last few; the rest is noise a browser would still be holding. */
export const REFUSALS_KEPT = 50

/**
 * Run one handler and GUARANTEE a projection. The Rust handler returned a
 * `Response` and could not fail, so there was nothing here to port — but in
 * JavaScript every handler can throw, and a throw that escapes `handle` leaves
 * the interface with no projection and the log with no record that anything
 * was asked. The language introduced a failure channel the design did not have,
 * so the seam closes it: one door, one error shape (I4).
 * @param {App} app
 * @param {import('./registry.js').Registered} hit
 * @param {Request} request
 * @returns {Response}
 */
function invoke(app, hit, request) {
  const where = `${hit.manifest.id} module failed while answering ${request.method} ${request.path}`
  try {
    return hit.handler(request, contextFor(app, hit.manifest))
  } catch (err) {
    if (err instanceof HarnessError) {
      return problem(500, `The ${where}.`, {
        kind: err.kind,
        detail: err.detail === '' ? err.message : `${err.message} — ${err.detail}`,
        repair: `The request changed nothing. Check the debug view for the ${hit.manifest.id} module's history.`,
      })
    }
    return problem(500, `The ${where}.`, {
      kind: 'handler_crashed',
      detail: err instanceof Error ? err.message : String(err),
      repair: 'This is a bug in the module, not in what you asked. The debug view holds the request that reached it.',
    })
  }
}
