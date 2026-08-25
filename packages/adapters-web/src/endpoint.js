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
    /**
     * SAVE INTO AN ENTRY, AND MAKE THAT ENTRY THE ONE IN FORCE. The name says
     * both halves because the second half is not a detail: the pick outranks
     * every agent file's `model:` key, so saving a credential into `openrouter`
     * repoints every agent's every call at openrouter (I16).
     * @param {string} entry @param {Patch} patch
     */
    selectAndSave: (entry, patch) => {
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
 * THE VERDICT THIS SAVE REACHES ON EACH FIELD IT ACTUALLY CARRIES. Three
 * answers and not two: absent means untouched, a value equal to what the file
 * says (or a blanked box) means CLEAR, and anything else is an override. The
 * clear answer is the one that has to exist — the boxes are pre-filled from the
 * entry, so typing the shipped URL back in IS the person's undo, and a verdict
 * that only listed survivors left them no way to reach it (I10).
 * @param {Entry|null} shipped @param {Patch} patch @returns {Verdict}
 */
function kept(shipped, patch) {
  /** @type {Record<string, string>} */
  const set = {}
  /** @type {string[]} */
  const clear = []
  const decide = (/** @type {string} */ key, /** @type {string|undefined} */ typed, /** @type {string} */ own) => {
    if (typed === undefined) return
    const value = typed.trim().replace(/\/+$/, '')
    if (value === '' || value === own.replace(/\/+$/, '')) clear.push(key)
    else set[key] = value
  }
  decide('base_url', patch.baseUrl, shipped?.baseUrl ?? '')
  decide('model', patch.model, shipped?.model ?? '')
  return { set, clear }
}

/** What one Save does to one entry's override slot: what it pins, what it undoes. */
/** @typedef {{set: Record<string, string>, clear: string[]}} Verdict */

/**
 * Apply that verdict to one entry's override slot, leaving every other entry's
 * alone — and leaving THIS entry's untouched fields alone too, because
 * `saveEndpoint` freezes all three fields as optional and a key-only save must
 * not erase a URL nobody typed at. The slot goes away only once nothing is left
 * in it, which is what makes a later `models.json` edit reach a browser that
 * once pressed Save.
 * @param {Record<string, Record<string, string>>} overrides
 * @param {string} name @param {Verdict} verdict
 */
function pinned(overrides, name, verdict) {
  const slot = { ...(overrides[name] ?? {}), ...verdict.set }
  for (const key of verdict.clear) delete slot[key]
  const next = { ...overrides }
  if (Object.keys(slot).length === 0) delete next[name]
  else next[name] = slot
  return next
}
