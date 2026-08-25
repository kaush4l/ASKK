/**
 * THE STORED RECORD: this browser's layer written down and read back.
 *
 * Its own file because it is the ONE shape a sub-agent's Worker will be handed
 * at boot, which makes it the place a new setting belongs if every agent is to
 * see it — and because the alternative, opening the keyring to the whole
 * package to save a line of plumbing, is how a secret leaks.
 * @module
 */

/** @typedef {import('./endpoint.js').State} State */

/**
 * What is written down: the search destination, the reset, and the record
 * itself.
 * @param {State} state
 */
export function record(state) {
  return {
    search: () => state.search,
    setSearch: (/** @type {string} */ base) => {
      state.search = base.trim().replace(/\/+$/, '')
    },
    /** Back to the shipped catalogue: the pick, the overrides and every saved key, forgotten (I10). */
    reset: () => {
      Object.assign(state, { overrides: {}, keys: {}, selected: '', search: '' })
    },
    /** The stored record — the ONE place the keys are serialized. */
    profileJson: () => JSON.stringify({ selected: state.selected, keys: state.keys, overrides: state.overrides, search: state.search }),
    loadProfile: (/** @type {string} */ raw) => {
      const read = readProfile(raw)
      if (read) Object.assign(state, read)
    },
  }
}


/**
 * The record, read back. An unreadable one leaves this browser on the shipped
 * catalogue rather than failing boot (I15).
 * @param {string} raw @returns {Omit<State, 'file'>|null}
 */
export function readProfile(raw) {
  /** @type {Record<string, unknown>} */
  let doc = {}
  try {
    const value = /** @type {unknown} */ (JSON.parse(raw))
    if (!value || typeof value !== 'object') return null
    doc = /** @type {Record<string, unknown>} */ (value)
  } catch {
    return null
  }
  /** @type {Record<string, Record<string, string>>} */
  const overrides = {}
  for (const [name, patch] of Object.entries(fields(doc['overrides']))) overrides[name] = strings(patch)
  const text = (/** @type {string} */ key) => (typeof doc[key] === 'string' ? /** @type {string} */ (doc[key]).trim() : '')
  return { selected: text('selected'), keys: strings(doc['keys']), overrides, search: text('search') }
}

/** @param {unknown} value @returns {Record<string, string>} */
function strings(value) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, held] of Object.entries(fields(value))) if (typeof held === 'string') out[key] = held
  return out
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function fields(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {}
}
