/**
 * The application aggregate: the registry fold, the log, the injected ports,
 * and what this build can actually offer a module. The composition root builds
 * one and the seam threads it explicitly — never a global, so a test and an
 * agent's own Worker each hold their own.
 *
 * `available` is the second half of I6. A grant is the intersection of what a
 * manifest asks for with what THIS build offers, so a build assembled without
 * a workspace substrate passes a shorter list and every module that asked for
 * `workspace` is simply not granted it (I15) — no branch anywhere else.
 * @module
 */

import { CAPABILITIES, EventLog } from '@harness/kernel'

import { Registry } from './registry.js'

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Ports} Ports */
/** @typedef {import('./registry.js').Handler} Handler */

/** @typedef {{registry: Registry, log: EventLog, ports: Ports, available: CapabilityId[]}} App */

/**
 * @param {Ports} ports
 * @param {{log?: EventLog, available?: CapabilityId[]}} [opts] `log` is a replayed history; `available` is what this build offers
 * @returns {App}
 */
export function createApp(ports, opts = {}) {
  return {
    registry: new Registry(),
    log: opts.log ?? new EventLog(),
    ports,
    available: opts.available ?? [...CAPABILITIES],
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
