/**
 * The model catalogue — `public/models.json`, read as data, keyed by NAME.
 *
 * There is no provider table, and that is the decision carried over whole from
 * the Python this was first written as: nearly every server speaks the OpenAI
 * protocol and differs only in its `base_url`, so a provider name bought
 * nothing but a place to hardcode a URL.
 *
 * Pure: no browser here. `endpoint.js` layers the user's own edits on top and
 * `model.js` puts bytes on the wire, so every rule in this file is host-tested.
 * @module
 */

import { ModelError } from '@harness/kernel'

/** @typedef {Record<string, unknown>} Doc */
/** @typedef {{defaultName: string, models: Record<string, Doc>}} Catalogue */

/**
 * One entry, resolved. `name` is the CATALOGUE KEY and `model` is the id that
 * goes on the wire — they are different strings and conflating them is how a
 * key saved for one entry rides to another's origin.
 * @typedef {{name: string, model: string, baseUrl: string, api: string, kind: string, apiKeyEnv: string, note: string}} Entry
 */

/** A build that has read no catalogue. It resolves NOTHING, on purpose (I15). */
export const NO_CATALOGUE = /** @type {Catalogue} */ ({ defaultName: '', models: {} })

/** @param {string} raw @returns {Catalogue} */
export function readCatalogue(raw) {
  return layer(NO_CATALOGUE, raw)
}

/**
 * Layer a document of the same shape on top, FIELD BY FIELD — this is how the
 * browser's own edits ride on the shipped file. A blank string means
 * "unchanged", so an emptied Settings box falls back to what the file said
 * rather than pinning an empty base URL every path would be appended to.
 * @param {Catalogue} cat @param {string} raw @returns {Catalogue}
 */
export function layer(cat, raw) {
  const doc = parse(raw)
  if (!doc) return cat
  const models = { ...cat.models }
  for (const [name, patch] of Object.entries(fields(doc['models']))) {
    const into = { ...(models[name] ?? {}) }
    for (const [key, value] of Object.entries(fields(patch))) {
      if (typeof value === 'string' && value.trim() === '') continue
      into[key] = value
    }
    models[name] = into
  }
  const named = doc['default']
  const defaultName = typeof named === 'string' && named.trim() !== '' ? named.trim() : cat.defaultName
  return { defaultName, models }
}

/**
 * Every entry name, in THE FILE'S OWN ORDER. Not sorted: `models.json` is
 * curated — `local` is first because a person who has a local server should see
 * it first — and sorting silently overrides a decision somebody made.
 */
export function names(/** @type {Catalogue} */ cat) {
  return Object.keys(cat.models)
}

/**
 * WHICH ENTRY ANSWERS `asked`, and null when nothing honestly does:
 *
 * - an empty name is the catalogue's `default` entry;
 * - a name that IS a key is that entry;
 * - a name that is NOT a key is a model id served by the DEFAULT entry's
 *   endpoint, so `model: local` in an agent file is a catalogue key and an
 *   arbitrary model id still works.
 *
 * A catalogue with no entries resolves to `null` and never to a hopeful
 * default: the card then states the agent file's own words instead of
 * inventing a model id nobody configured.
 * @param {Catalogue} cat @param {string} asked @returns {Entry|null}
 */
export function resolve(cat, asked) {
  const key = asked.trim() === '' ? cat.defaultName.trim() : asked.trim()
  if (key === '') return null
  const own = cat.models[key]
  if (own) {
    const entry = read(key, own)
    return entry.model === '' ? { ...entry, model: key } : entry
  }
  const fallback = cat.models[cat.defaultName.trim()]
  if (!fallback) return null
  return { ...read(cat.defaultName.trim(), fallback), model: key }
}

/**
 * The URL one chat turn POSTs to, or the typed reason this entry cannot serve
 * one. This build speaks the OpenAI chat-completions protocol; an entry that
 * speaks something else is REFUSED BY NAME rather than sent the wrong bytes.
 * @param {Entry} entry @returns {string}
 */
export function chatUrl(entry) {
  if (entry.baseUrl === '') {
    throw new ModelError('malformed', `The catalogue entry "${entry.name}" has no address.`, {
      detail: 'it carries no base_url, so there is nowhere to send a turn',
    })
  }
  const kind = entry.kind === '' ? 'openai' : entry.kind
  const api = entry.api === '' ? 'completions' : entry.api
  if (kind !== 'openai' || api !== 'completions') {
    throw new ModelError('malformed', `The catalogue entry "${entry.name}" speaks a protocol this build does not.`, {
      detail: `it declares kind "${kind}" / api "${api}"; this build speaks the OpenAI chat-completions protocol only`,
    })
  }
  return `${entry.baseUrl}/chat/completions`
}

/** @param {string} name @param {Doc} doc @returns {Entry} */
function read(name, doc) {
  const s = (/** @type {string} */ key) => {
    const value = doc[key]
    return typeof value === 'string' ? value.trim() : ''
  }
  return {
    name,
    model: s('model'),
    baseUrl: s('base_url').replace(/\/+$/, ''),
    api: s('api'),
    kind: s('kind'),
    apiKeyEnv: s('api_key_env'),
    note: s('note'),
  }
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function fields(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {}
}

/**
 * Junk yields NO catalogue rather than a throw: an unreadable file costs the
 * catalogue, never the boot — and what it costs is then visible, because
 * nothing resolves.
 * @param {string} raw @returns {Record<string, unknown>|null}
 */
function parse(raw) {
  try {
    const value = /** @type {unknown} */ (JSON.parse(raw))
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null
  } catch {
    return null
  }
}
