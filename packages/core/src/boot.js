/**
 * BOOT: the App, assembled. Replay the log through its registered projections,
 * install the modules through the one install path, and hand back something a
 * seam request can be served from.
 *
 * IT TAKES THE PORTS AND DOES NOT BUILD THEM. A composition root decides what
 * this build can actually do — which store, which model endpoint, whether there
 * is a workspace at all — and boot's job is to refuse to invent any of it. The
 * capability list is the second half of that (I6): a build states what it
 * offers or it does not start.
 *
 * THE BUILT-INS GO IN THROUGH `install`, the same door an authored module takes
 * (I9), and each install is a fact. That is two facts per boot and not one per
 * fact of history: the registry cannot ride in the log because a handler is a
 * function, so the fold is memory-only and boot re-registers.
 * @module
 */

import { ENTRY_AGENT } from '@harness/kernel'

import { createApp, install } from './app.js'
import { chat, chatManifest } from './chat.js'
import { files, filesManifest } from './files.js'
import { bootLog, freshLog } from './log/index.js'
import { projections } from './reducers.js'

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('@harness/kernel').Ports} Ports */
/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').ToolRun} ToolRun */
/** @typedef {import('./log/index.js').SegmentStore} SegmentStore */

/** Every module this build serves, with the logic each route reaches. */
const MODULES = [
  { manifest: chatManifest, handler: chat },
  { manifest: filesManifest, handler: files },
]

/**
 * @typedef {{
 *   ports: Ports,
 *   available: CapabilityId[],
 *   segments: SegmentStore,
 *   me?: string,
 *   tools?: Record<string, ToolRun>,
 *   agent?: import('@harness/agent').AgentState,
 * }} Assembly
 */

/**
 * Read the history back and put the modules on it. Two range reads however long
 * the history is (I20) — `bootLog` owns that, and this owns what is registered
 * before the first fact is folded.
 * @param {Assembly} parts @returns {Promise<App>}
 */
export async function boot(parts) {
  const me = parts.me ?? ENTRY_AGENT
  const log = await bootLog(parts.segments, { clock: parts.ports.clock, reducers: projections(me), stream: me })
  return installed(createApp(parts.ports, parts.available, { log, me, tools: parts.tools, agent: parts.agent }))
}

/**
 * The same App with nothing behind it — a first run, or a test that does not
 * care what happened yesterday. Separate from `boot` rather than a flag on it,
 * because "there is no history" and "the history is empty" are the same App and
 * two different claims about the store.
 * @param {Assembly} parts @returns {App}
 */
export function bootFresh(parts) {
  const me = parts.me ?? ENTRY_AGENT
  const log = freshLog(parts.segments, { clock: parts.ports.clock, reducers: projections(me), stream: me })
  return installed(createApp(parts.ports, parts.available, { log, me, tools: parts.tools, agent: parts.agent }))
}

/** @param {App} app @returns {App} */
function installed(app) {
  for (const module of MODULES) install(app, module.manifest, module.handler)
  return app
}
