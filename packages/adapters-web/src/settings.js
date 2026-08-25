/**
 * THE SETTINGS PANE'S DOOR TO THE CREDENTIAL BROKER — the one thing in this
 * tree that does NOT go through the seam, and `docs/SEAM.md` says why: `handle`
 * records a fact for every request and the request's body rides into the
 * projection the interface then renders. An event log is exactly where a
 * credential must never appear (I6).
 *
 * PROVISIONAL, and stated where keys are entered: the record is plain in
 * IndexedDB. Wrapping it with WebCrypto at rest is one file away and is a human
 * gate, not a decision this lane may take.
 * @module
 */

import { SEARCH_ENDPOINT, HarnessError } from '@harness/kernel'

/** @typedef {import('./endpoint.js').Endpoint} Endpoint */
/** @typedef {import('./endpoint.js').Patch} Patch */
/** @typedef {import('./catalogue.js').Entry} Entry */

/**
 * @typedef {{
 *   endpoint: Endpoint, kv: import('@harness/kernel').KvStore, key: string,
 *   net: {allow: (endpoint: string, baseUrl: string) => void},
 * }} Broker
 */

/**
 * The broker this page booted. Module state, deliberately: the seam froze
 * `saveEndpoint` as a free function precisely so the Settings pane never holds
 * the App — one page is one browser is one broker, and a second one would be a
 * second answer to "which key is saved".
 * @type {Broker|null}
 */
let broker = null

/** Called by `bootBrowser`, and by nothing else. @param {Broker} built */
export function useBroker(built) {
  broker = built
}

/**
 * Point the catalogue entry somewhere and persist it.
 *
 * SAVING INTO AN ENTRY ALSO MAKES IT THE ENTRY IN FORCE, and the pick outranks
 * every agent file's `model:` key — so a key saved into `openrouter` sends
 * every agent's every call, and that credential, to openrouter until somebody
 * picks something else. The name stays `saveEndpoint` because `docs/SEAM.md`
 * froze it; the second half is stated here and executed by a test rather than
 * left for a reader to find in `selectAndSave` (I16).
 *
 * An absent `apiKey` KEEPS the stored one — the field is write-only, so a blank
 * save must not wipe a secret the form never held — and `''` clears it. A
 * `baseUrl` or `model` equal to what `models.json` says UNDOES that entry's
 * override rather than pinning today's file forever (I10); a patch that carries
 * neither leaves both alone.
 * @param {string} entry which catalogue entry — never a URL
 * @param {Patch} patch
 * @returns {Promise<void>}
 */
export async function saveEndpoint(entry, patch) {
  const held = required()
  held.endpoint.selectAndSave(entry, patch)
  await held.kv.put(held.key, held.endpoint.profileJson())
}

/**
 * Where a web search may go, and the ONLY way this build gets an entry on the
 * network allowlist. The broker is repointed in the same breath as the save,
 * because a setting that needs a reload to take effect is a setting the page
 * lies about. A blank URL clears it, which takes `search` OFF the list —
 * turning a capability off has to be as available as turning it on (I10).
 * @param {string} baseUrl @returns {Promise<void>}
 */
export async function saveSearchEndpoint(baseUrl) {
  const held = required()
  held.endpoint.setSearch(baseUrl)
  held.net.allow(SEARCH_ENDPOINT, held.endpoint.search())
  await held.kv.put(held.key, held.endpoint.profileJson())
}

/**
 * What Settings renders: every entry, which one is picked, and WHETHER each has
 * a key. Never a key — there is no function here that returns one, which is the
 * I6 property rather than a rule somebody has to remember.
 * @returns {{selected: string, entries: Entry[], hasKey: Record<string, boolean>, search: string}}
 */
export function readEndpoints() {
  const held = required()
  /** @type {Entry[]} */
  const entries = []
  for (const name of held.endpoint.names()) {
    const entry = held.endpoint.entry(name)
    if (entry) entries.push(entry)
  }
  return {
    selected: held.endpoint.current(),
    entries,
    hasKey: held.endpoint.keyed(),
    search: held.endpoint.search(),
  }
}

/** Back to the shipped catalogue: the pick, the overrides and every saved key, forgotten. */
export async function resetEndpoints() {
  const held = required()
  held.endpoint.reset()
  held.net.allow(SEARCH_ENDPOINT, '')
  await held.kv.put(held.key, held.endpoint.profileJson())
}

/** @returns {Broker} */
function required() {
  if (!broker) {
    throw new HarnessError('no_broker', 'This page has not booted, so there is no endpoint to read or save.', {
      detail: 'bootBrowser installs the credential broker; nothing may reach it before that has run',
    })
  }
  return broker
}
