/**
 * The registry: which modules are live, and which one answers a route.
 *
 * **The Rust registry was a fold of its OWN event enum** (`Installed` /
 * `Deactivated` / `Reactivated`) and kept a second list of every version ever
 * installed. Both are gone. The kernel log is the history now — installing
 * appends `module_installed` and removing appends `module_removed` — so a
 * private vector shadowing it was a second authority no reader consulted.
 * `Reactivated` was a `todo!()` with no construction site and does not survive.
 *
 * **What CANNOT ride in the log is the handler**, because a handler is a
 * function and the log is JSON. So the fold is memory-only and boot
 * re-registers the built-ins through this same path (I9: it is the path an
 * authored module takes too, and nothing here records which one a module is).
 * @module
 */

import { ModuleError } from './errors.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */

/** A module's logic: a request and its capability context in, a projection out. */
/** @typedef {(request: Request, ctx: Ctx) => Response} Handler */

/** @typedef {{manifest: Manifest, handler: Handler}} Registered */

/**
 * The live fold. The entries are a PRIVATE field and the queries below are the
 * only way out — there is no query that filters by origin, and that absence is
 * the structural half of I9: erosion is impossible to write.
 */
export class Registry {
  /** @type {Registered[]} */
  #live = []

  /**
   * Admit one module. The ONE install path — a built-in at boot and a module a
   * person authored in the browser both arrive here, which is what keeps the
   * path honest.
   * @param {Manifest} manifest
   * @param {Handler} handler
   * @returns {Registered}
   */
  install(manifest, handler) {
    if (manifest.id === '') {
      throw new ModuleError('invalid_manifest', 'a module needs an id, and this manifest has none')
    }
    const live = this.get(manifest.id)
    if (live) {
      throw new ModuleError(
        'already_installed',
        `${manifest.id} is already live at version ${live.manifest.version}`,
      )
    }
    for (const route of manifest.routes) {
      const holder = this.resolve(route.method, route.path)
      if (holder) {
        throw new ModuleError(
          'route_conflict',
          `${route.method} ${route.path} is already answered by ${holder.manifest.id}, so ${manifest.id} cannot also claim it`,
        )
      }
    }
    const entry = { manifest, handler }
    this.#live.push(entry)
    return entry
  }

  /** Route → module: the lookup dispatch consults, and the conflict judge above. */
  resolve(/** @type {string} */ method, /** @type {string} */ path) {
    return this.#live.find((r) => r.manifest.routes.some((x) => x.method === method && x.path === path)) ?? null
  }

  /** The live version of one module, if any. */
  get(/** @type {string} */ id) {
    return this.#live.find((r) => r.manifest.id === id) ?? null
  }
}
