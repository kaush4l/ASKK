/**
 * THE PAGE'S BOOT, and the only place in this build that can start a Worker.
 *
 * `boot.js` composes every port a browser context has and takes its delegation
 * as an argument. This file is what supplies one — and it exists as a separate
 * module for a reason that is a bundler's before it is a designer's.
 * `workers.js` names `./agent-entry.js` inside a `new URL`, and that module
 * boots an application of its own. If the composition root imported the spawner
 * directly, the Worker's module graph would contain the module that names it,
 * and `next build` does not fail on that cycle — it HANGS. Measured: ten
 * seconds became over six minutes with no output.
 *
 * So the graph forks here. The page reaches `page.js` -> `workers.js` ->
 * (a URL) -> `agent-entry.js` -> `boot.js`, and `boot.js` reaches no further.
 * A sub-agent cannot delegate again, which was already the intent and is now
 * the shape.
 * @module
 */

import { agentsOver } from '@harness/agent'

import { bootBrowser } from './boot.js'
import { browserWorkers, canDelegate, startWorker } from './workers.js'

/** @typedef {import('@harness/core').App} App */

/**
 * Build the running application for the PAGE — every port `bootBrowser` gives
 * any context, plus one Worker per agent where this browser can start one.
 *
 * Where it cannot, the honest refusal stays: an empty roster and a delegation
 * that NAMES what is missing beats a port that hangs on a message nobody will
 * read, and `available` then omits `agents` so no module is told it may.
 * @param {{basePath?: string, agent?: string}} [opts]
 * @returns {Promise<App>}
 */
export function bootPage(opts = {}) {
  return bootBrowser({
    ...opts,
    async delegation({ me, basePath, roster }) {
      if (!canDelegate()) return null
      return agentsOver(browserWorkers({ me, roster, spawn: (agent) => startWorker(agent, basePath) }))
    },
  })
}
