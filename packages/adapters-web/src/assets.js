/**
 * SAME-ORIGIN STATIC ASSETS: this build's own files, served beside
 * `index.html`. Not `NetPort` — that port is the brokered, allowlisted outside
 * world (I2, I6), and these are the files that make an agent editable and
 * redeployable with no rebuild.
 *
 * Paths are RELATIVE to the base path, because the site lives under a repo
 * subpath on GitHub Pages and an origin-absolute path white-pages production.
 * @module
 */

import { globalFetch } from './wire.js'

/**
 * One asset as text, or null. `no-cache` means REVALIDATE, never serve blind
 * from the HTTP cache: Pages stamps assets with a ten-minute max-age, so
 * without it an agent file edited and redeployed keeps answering with
 * yesterday's prompt for ten minutes — which is the whole point of it being
 * data.
 * @param {string} basePath @param {string} path @returns {Promise<string|null>}
 */
export async function fetchText(basePath, path) {
  try {
    const response = await globalFetch()(`${basePath}${path}`, { cache: 'no-cache' })
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

/**
 * The model catalogue. A missing file is not a throw and not an empty
 * catalogue pretending to be one: it comes back null, and the endpoint then
 * resolves NOTHING, which is what makes the missing file visible.
 * @param {string} basePath @returns {Promise<string|null>}
 */
export function fetchModels(basePath) {
  return fetchText(basePath, 'models.json')
}
