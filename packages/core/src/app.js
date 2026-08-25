/**
 * The application aggregate: the registry fold, the log, the injected ports,
 * and what this build can actually offer a module. The composition root builds
 * one and the seam threads it explicitly — never a global, so a test and an
 * agent's own Worker each hold their own.
 *
 * `available` is the second half of I6, and it is STATED, never defaulted. A
 * grant is the intersection of what a manifest asks for with what THIS build
 * offers, so a build assembled without a workspace substrate passes a shorter
 * list and every module that asked for `workspace` is simply not granted it
 * (I15) — no branch anywhere else. Defaulting it to every capability would
 * have answered "what does this build offer?" on behalf of adapters nobody has
 * written yet, which is how `durable()` came to return `true` while the only
 * shipping implementation returned `false`. A capability descriptor is filled
 * in honestly by the composition root or the build does not start.
 * @module
 */

import { ENTRY_AGENT } from '@harness/kernel'
import { newAgentState } from '@harness/agent'

import { Registry } from './registry.js'

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Ports} Ports */
/** @typedef {import('./registry.js').Handler} Handler */
/** @typedef {import('./log/index.js').Log} Log */
/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Reply} Reply */
/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('@harness/kernel').TurnId} TurnId */

/**
 * ONE FACT ON ITS WAY TO THE LOOP: what happened, when, and WHICH TURN it
 * belongs to (I21). A model reply carries the parts the kernel's fact cannot
 * hold — the native calls and the signal it stopped on.
 * @typedef {{at: Timestamp, turnId: TurnId|null, callId?: string, fact: Fact, reply?: Reply}} Incoming
 */

/**
 * ONE TOOL, RUN. The gate, the capability check and the built-in table are
 * `tools.js`'s and arrive with it; this is the shape they fill. A build with an
 * empty table offers no tools and says so by name when one is called — the
 * honest answer, rather than a call that quietly does nothing.
 * @typedef {(args: string, opts: {signal: AbortSignal}) => Promise<{ok: boolean, output: string}>} ToolRun
 */

/**
 * @typedef {{
 *   registry: Registry, log: Log, ports: Ports, available: CapabilityId[],
 *   agent: AgentState, me: string, tools: Record<string, ToolRun>,
 *   pending: Incoming[], bootedAt: number, quiet: Record<string, number>,
 * }} App
 */

/**
 * The log is PASSED IN and never defaulted, for the same reason `available` is:
 * a log built here would be one this process invented, with no store behind it
 * and no history in front of it, and every fact it recorded would evaporate on
 * refresh while the interface showed them landing. `freshLog` and `bootLog` in
 * `./log/` are the two honest ways to obtain one.
 * @param {Ports} ports
 * @param {CapabilityId[]} available what THIS build can actually offer a module
 * @param {{log: Log, me?: string, tools?: Record<string, ToolRun>, agent?: AgentState}} opts
 * @returns {App}
 */
export function createApp(ports, available, opts) {
  return {
    registry: new Registry(),
    log: opts.log,
    ports,
    available,
    agent: opts.agent ?? newAgentState(),
    me: opts.me ?? ENTRY_AGENT,
    tools: opts.tools ?? {},
    pending: [],
    // WHERE THIS PAGE LOAD STARTS. The one thing that separates a file written
    // in this session from one a reload took, and the only reason `folder.js`
    // can make that claim at all.
    bootedAt: opts.log.length,
    // Consecutive silent completions, per model. A model that answers with
    // nothing twice running is not worth a third attempt, and the driver stops
    // retrying it rather than paying to learn the same thing again.
    quiet: {},
  }
}

/**
 * Install a module and RECORD that it happened. The registry decides whether
 * the module may exist; the fact is what makes the install undoable (I10) and
 * visible to every projection of the log (I8).
 * @param {App} app
 * @param {Manifest} manifest
 * @param {Handler} handler
 * @returns {import('./registry.js').Registered}
 */
export function install(app, manifest, handler) {
  const entry = app.registry.install(manifest, handler)
  app.log.append(
    { type: 'module_installed', module: manifest.id, version: manifest.version },
    app.ports.clock.now(),
  )
  return entry
}
