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

import { StoreError } from '@harness/kernel'

import { globalFetch } from './wire.js'

/** One asset, or the reason there isn't one. Never null: a null says nothing (I16). */
/** @typedef {{text: string}|StoreError} Fetched */

/**
 * One asset as text, or THE REASON IT IS MISSING — the address and what the
 * server said, so "this deploy shipped no catalogue" and "you asked for an
 * entry that is not in it" are different sentences to the person reading them.
 *
 * `no-cache` means REVALIDATE, never serve blind from the HTTP cache: Pages
 * stamps assets with a ten-minute max-age, so without it an agent file edited
 * and redeployed keeps answering with yesterday's prompt for ten minutes —
 * which is the whole point of it being data.
 * @param {string} basePath @param {string} path @returns {Promise<Fetched>}
 */
export async function fetchText(basePath, path) {
  const url = `${basePath}${path}`
  try {
    const response = await globalFetch()(url, { cache: 'no-cache' })
    if (!response.ok) {
      return new StoreError('unavailable', `${path} could not be read: the server answered ${response.status}.`, {
        key: url, detail: `${url} answered ${response.status} ${response.statusText}`,
      })
    }
    return { text: await response.text() }
  } catch (cause) {
    return new StoreError('unavailable', `${path} could not be read: the request never completed.`, {
      key: url, cause, detail: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
    })
  }
}
