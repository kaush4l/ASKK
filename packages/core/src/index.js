/**
 * L2 wiring: the seam, the registry fold, and the context a module's logic is
 * handed. No domain logic — this package connects the pure packages to each
 * other and to the ports, and no more.
 * @module
 */

export { createApp, install } from './app.js'
export { Registry } from './registry.js'
export { contextFor } from './ctx.js'
export { handle } from './dispatch.js'
export { ModuleError } from './errors.js'

/** @typedef {import('./app.js').App} App */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./registry.js').Handler} Handler */
/** @typedef {import('./registry.js').Registered} Registered */
/** @typedef {import('./errors.js').ModuleErrorKind} ModuleErrorKind */
