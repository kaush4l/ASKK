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

import { Registry } from './registry.js'

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Ports} Ports */
/** @typedef {import('./registry.js').Handler} Handler */
/** @typedef {import('./log/index.js').Log} Log */

/** @typedef {{registry: Registry, log: Log, ports: Ports, available: CapabilityId[]}} App */

/**
 * The log is PASSED IN and never defaulted, for the same reason `available` is:
 * a log built here would be one this process invented, with no store behind it
 * and no history in front of it, and every fact it recorded would evaporate on
 * refresh while the interface showed them landing. `freshLog` and `bootLog` in
 * `./log/` are the two honest ways to obtain one.
 * @param {Ports} ports
 * @param {CapabilityId[]} available what THIS build can actually offer a module
 * @param {{log: Log}} opts
 * @returns {App}
 */
export function createApp(ports, available, opts) {
  return {
    registry: new Registry(),
    log: opts.log,
    ports,
    available,
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
