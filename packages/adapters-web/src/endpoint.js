/**
 * THE USER'S LAYER OVER THE CATALOGUE: which entry is selected, what this
 * browser changed about it, and ONE API KEY PER ENTRY.
 *
 * One key per entry and never one key for the catalogue: `openrouter`'s key
 * must not travel to `api.openai.com`, and `apiKeyFor(name)` is the only way to
 * read one out, so a caller physically cannot attach entry A's key to entry B's
 * request. Pure — this is where a secret gets lost or sent to the wrong origin,
 * and both are what the host tests refuse.
 *
 * The three faces below are one object to every caller and three functions to a
 * reader: what is CHOSEN, what is SECRET, and — in `profile.js` — what is
 * WRITTEN DOWN.
 * @module
 */

import { NO_CATALOGUE, layer, names, readCatalogue, resolve } from './catalogue.js'
import { record } from './profile.js'

/** @typedef {import('./catalogue.js').Catalogue} Catalogue */
/** @typedef {import('./catalogue.js').Entry} Entry */

/** What one Save changes. `apiKey` absent KEEPS the stored key; `''` clears it. */
/** @typedef {{baseUrl?: string, model?: string, apiKey?: string}} Patch */

/**
 * @typedef {{
 *   file: Catalogue, overrides: Record<string, Record<string, string>>,
 *   keys: Record<string, string>, selected: string, search: string,
 * }} State
 */

/** @typedef {ReturnType<typeof makeEndpoint>} Endpoint */

/**
 * The catalogue as shipped, plus this browser's persisted layer on it. A URL
 * typed in Settings is an OVERRIDE OF AN ENTRY, stored under that entry's name,
 * so switching entries and back does not lose it.
 */
export function makeEndpoint() {
  /** @type {State} */
  const state = { file: NO_CATALOGUE, overrides: {}, keys: {}, selected: '', search: '' }
  return { ...chosen(state), ...secrets(state), ...record(state) }
}

/** The catalogue in force: recomputed, so clearing an override reverts to the shipped value. */
function catalogueOf(/** @type {State} */ state) {
  const pinned = state.overrides
  return Object.keys(pinned).length === 0 ? state.file : layer(state.file, JSON.stringify({ models: pinned }))
}

/** The entry Settings is editing: the explicit pick, else the catalogue's default. */
function currentOf(/** @type {State} */ state) {
  return state.selected.trim() === '' ? catalogueOf(state).defaultName : state.selected.trim()
}

/** @param {State} state */
function chosen(state) {
  return {
    /** Install `public/models.json`. The user's layer applies over whatever the file says this deploy. */
    setCatalogue: (/** @type {string} */ raw) => {
      state.file = readCatalogue(raw)
    },
    catalogue: () => catalogueOf(state),
    current: () => currentOf(state),
    names: () => names(catalogueOf(state)),
    select: (/** @type {string} */ name) => {
      state.selected = name.trim()
    },
    /**
     * WHICH ENTRY ANSWERS A CALL. An explicit Settings pick outranks the agent
     * file's `model:` key; with no pick the catalogue resolves what was asked.
     * @param {string} asked @returns {Entry|null}
     */
    resolve: (asked) => resolve(catalogueOf(state), state.selected.trim() === '' ? asked : state.selected.trim()),
    /**
     * ONE NAMED ENTRY, with the pick ignored. Settings lists every entry while
     * one of them is selected, and resolving through `resolve` there would
     * answer with the selection for all of them.
     * @param {string} name @returns {Entry|null}
     */
    entry: (name) => resolve(catalogueOf(state), name),
  }
}

/** @param {State} state */
function secrets(state) {
  return {
    /** The key for ONE named entry. The only door a key comes out of. */
    apiKeyFor: (/** @type {string} */ entry) => state.keys[entry] ?? '',
    hasKey: (/** @type {string} */ entry) => (state.keys[entry] ?? '') !== '',
    /** Which entries hold a key — the fact Settings may render. Never the key. */
    keyed: () => Object.fromEntries(names(catalogueOf(state)).map((name) => [name, (state.keys[name] ?? '') !== ''])),
    /** @param {string} entry @param {Patch} patch */
    set: (entry, patch) => {
      if (entry.trim() !== '') state.selected = entry.trim()
      const name = currentOf(state)
      state.keys = withKey(state.keys, name, patch.apiKey)
      state.overrides = pinned(state.overrides, name, kept(resolve(state.file, name), patch))
    },
  }
}

/**
 * A blank key field must not wipe a saved secret — the field is write-only, so
 * "absent" means keep and only an explicit empty string clears.
 * @param {Record<string, string>} keys @param {string} name @param {string|undefined} apiKey
 */
function withKey(keys, name, apiKey) {
  if (apiKey === undefined) return keys
  const next = { ...keys }
  if (apiKey.trim() === '') delete next[name]
  else next[name] = apiKey.trim()
  return next
}

/**
 * What of this Save is actually an OVERRIDE. A field equal to what the file
 * says is agreement, not an override, and storing it pins this browser to
 * today's `models.json` forever — the fields are pre-filled from the entry, so
 * without this every Save pinned every field.
 * @param {Entry|null} shipped @param {Patch} patch @returns {Record<string, string>}
 */
function kept(shipped, patch) {
  /** @type {Record<string, string>} */
  const fields = {}
  const differs = (/** @type {string|undefined} */ typed, /** @type {string} */ own) => {
    const value = (typed ?? '').trim().replace(/\/+$/, '')
    return value !== '' && value !== own.replace(/\/+$/, '') ? value : null
  }
  const url = differs(patch.baseUrl, shipped?.baseUrl ?? '')
  if (url) fields['base_url'] = url
  const model = differs(patch.model, shipped?.model ?? '')
  if (model) fields['model'] = model
  return fields
}

/**
 * Write — or CLEAR — one entry's override slot, leaving every other entry's
 * alone. Clearing on an empty patch is what makes a later `models.json` edit
 * reach a browser that once pressed Save.
 * @param {Record<string, Record<string, string>>} overrides
 * @param {string} name @param {Record<string, string>} fields
 */
function pinned(overrides, name, fields) {
  const next = { ...overrides }
  if (Object.keys(fields).length === 0) delete next[name]
  else next[name] = { ...(next[name] ?? {}), ...fields }
  return next
}

