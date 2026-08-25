/**
 * Module manifests (I9: built-in and forged modules are indistinguishable to
 * the system). No field records origin — that absence is the invariant, and it
 * is why a forged module cannot be second-class by accident.
 * @module
 */

/** @typedef {import('./capability.js').CapabilityId} CapabilityId */

/** @typedef {{method: string, path: string}} Route */

/**
 * @typedef {{
 *   id: string,
 *   version: string,
 *   title: string,
 *   summary: string,
 *   routes: Route[],
 *   capabilities: CapabilityId[],
 *   view: string,
 * }} Manifest
 */

/** Whether a manifest names this exact route. Exact match: routes are code. */
export function matchesRoute(/** @type {Manifest} */ manifest, /** @type {string} */ method, /** @type {string} */ path) {
  return manifest.routes.some((r) => r.method === method && r.path === path)
}

/**
 * Read a manifest from untyped data, refusing anything malformed. Returns the
 * manifest or a SENTENCE saying what is wrong — never a half-built object,
 * because a module registered from a bad manifest fails later and elsewhere.
 * @param {unknown} value
 * @returns {{manifest: Manifest}|{problem: string}}
 */
export function readManifest(value) {
  if (typeof value !== 'object' || value === null) return { problem: 'manifest is not an object' }
  const v = /** @type {Record<string, unknown>} */ (value)
  for (const key of ['id', 'version', 'title', 'view']) {
    if (typeof v[key] !== 'string' || v[key] === '') return { problem: `manifest.${key} must be a non-empty string` }
  }
  if (!Array.isArray(v.routes)) return { problem: 'manifest.routes must be an array' }
  const routes = /** @type {unknown[]} */ (v.routes)
  for (const route of routes) {
    const r = /** @type {Record<string, unknown>} */ (route)
    if (typeof r?.method !== 'string' || typeof r?.path !== 'string') {
      return { problem: 'every route needs a method and a path' }
    }
  }
  return {
    manifest: {
      id: /** @type {string} */ (v.id),
      version: /** @type {string} */ (v.version),
      title: /** @type {string} */ (v.title),
      summary: typeof v.summary === 'string' ? v.summary : '',
      routes: /** @type {Route[]} */ (routes),
      capabilities: Array.isArray(v.capabilities) ? /** @type {CapabilityId[]} */ (v.capabilities) : [],
      view: /** @type {string} */ (v.view),
    },
  }
}
