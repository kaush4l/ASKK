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

import { problem } from '@harness/kernel'

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
    ? hit.handler(request, contextFor(app, hit.manifest))
    : problem(404, `Nothing here answers ${request.method} ${request.path}.`, {
        kind: 'no_route',
        detail: 'No installed module declares that method and path.',
        repair: 'Check the address, or install a module that serves it.',
      })

  // A request that CHANGED something, or failed, is a fact. A successful GET is
  // not: it is somebody looking at a projection, and recording that records
  // that someone looked. Measured in the predecessor — four panes polling
  // between 400ms and 2s appended thousands of these an hour, each one
  // persisted, so the log grew without anything happening.
  if (request.method !== 'GET' || response.status >= 400) {
    app.log.append(
      { type: 'request_handled', path: request.path, status: response.status },
      app.ports.clock.now(),
    )
  }
  return response
}
