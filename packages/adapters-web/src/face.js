/**
 * WHAT `GET /settings` PROJECTS, AND WHAT `POST /settings` CHANGES — the
 * catalogue side of the broker, with no door onto the key.
 *
 * There is no function here that returns a credential, and that absence is the
 * I6 property rather than a rule somebody has to remember: `hasKey` is a
 * boolean, `apiKeyFor` is not reachable from this object, and `saveEndpoint`
 * remains the one door a secret goes through (docs/SEAM.md).
 *
 * `apply` IS SYNCHRONOUS IN EFFECT AND ASYNCHRONOUS ON DISK. The seam is
 * synchronous by construction and a setting that needs a reload to take is a
 * setting the page lies about, so the in-memory layer changes before `handle`
 * returns and the write to storage follows behind it.
 *
 * A WRITE THAT FAILS IS SAID. The store arrives as a pair — the write and what
 * to do when it rejects — because `void promise` does not merely lose the
 * failure, it raises an unhandled rejection in the page and records nothing.
 * The setting still takes effect for this page load either way; what the
 * failure hand-back buys is the person learning it will not survive a refresh.
 * @module
 */

import { SEARCH_ENDPOINT } from '@harness/kernel'

/** @typedef {import('./endpoint.js').Endpoint} Endpoint */
/** @typedef {import('@harness/core').SettingsFace} SettingsFace */

/**
 * @param {Endpoint} endpoint
 * @param {{allow: (name: string, baseUrl: string) => void}} net
 * @param {{persist: (json: string) => Promise<void>, onFailure: (message: string) => void}} [store] where the profile is written, and who is told when it will not go; absent in a test that only reads
 * @returns {NonNullable<SettingsFace>}
 */
export function settingsFace(endpoint, net, store) {
  return {
    read: () => ({
      selected: endpoint.current(),
      search: endpoint.search(),
      entries: endpoint.names().map((name) => card(endpoint, name)),
    }),
    apply(patch) {
      if (patch.entry !== undefined || patch.baseUrl !== undefined || patch.model !== undefined) {
        endpoint.selectAndSave(patch.entry ?? endpoint.current(), {
          ...(patch.baseUrl === undefined ? {} : { baseUrl: patch.baseUrl }),
          ...(patch.model === undefined ? {} : { model: patch.model }),
        })
      }
      if (patch.search !== undefined) {
        endpoint.setSearch(patch.search)
        // The allowlist is repointed in the same breath, because a destination
        // that needs a reload to take is a destination the page lies about —
        // and a blank URL takes `search` OFF the list, since turning a
        // capability off has to be as available as turning it on (I10).
        net.allow(SEARCH_ENDPOINT, endpoint.search())
      }
      // The KEY is the caller's, not this object's: it holds no log and knows
      // no storage layout, and naming one here would be a second authority on
      // where the profile lives.
      store?.persist(endpoint.profileJson()).catch((e) => store.onFailure(String(e?.message ?? e)))
    },
  }
}

/** One catalogue entry as the pane reads it: what it points at, and WHETHER it holds a key. */
function card(/** @type {Endpoint} */ endpoint, /** @type {string} */ name) {
  const entry = endpoint.entry(name)
  return {
    id: name,
    name,
    model: entry?.model ?? '',
    baseUrl: entry?.baseUrl ?? '',
    hasKey: endpoint.hasKey(name),
    keyLabel: endpoint.hasKey(name) ? 'A key is saved for this entry.' : 'No key saved.',
    selected: endpoint.current() === name,
  }
}
