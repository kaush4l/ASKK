/**
 * The MODEL CARD: what the paper has to know about the model it is being
 * assembled for, read from one catalogue entry.
 *
 * The Rust build had no such thing. `crates/agent/src/phase.rs:111` was
 * `const WORK_BUDGET: Budget = Budget { max_tokens: 8192 }` — one number for
 * every model on earth — and nothing in 67,476 lines read a context length.
 * On the turn that exposed it the paper wanted 4174 tokens against a 4096
 * ceiling and elided `## observations` on EVERY work turn while the agent's
 * own prose told it to read that block.
 *
 * So the window is REQUIRED and an entry without one is refused BY NAME at
 * install. A default here is the same defect as `durable()` answering `true`
 * on behalf of an adapter nobody wrote: it is a claim the system cannot check
 * and the person cannot see.
 * @module
 */

import { HarnessError } from '@harness/kernel'

/**
 * One entry of `apps/web/public/models.json`, as it is on disk. Read as
 * `unknown` fields rather than a typed shape because it is a FILE a person
 * edits and an IndexedDB overlay layered on it — data that arrives, not data
 * we constructed.
 * @typedef {Record<string, unknown>} CatalogueEntry
 */

/**
 * What the paper and the wire need to be correct about one model.
 *
 * `maxOutputTokens` is `number|null` and never a number we invented: the
 * catalogue does not carry it today, and `budgetFor` says out loud what it
 * does when it is absent instead of pretending the model declared it.
 *
 * `acceptsImages` and `reasons` fail SAFE to false. An undeclared modality is
 * one we do not send, because the cost of not sending an image is a weaker
 * answer and the cost of sending one to a text model is a 400 in the middle of
 * a turn.
 * @typedef {{
 *   name: string,
 *   model: string,
 *   contextTokens: number,
 *   maxOutputTokens: number|null,
 *   acceptsImages: boolean,
 *   reasons: boolean,
 * }} ModelCard
 */

/** @param {CatalogueEntry} entry @param {string} key */
function number(entry, key) {
  const raw = entry[key]
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw)
  return null
}

/** @param {CatalogueEntry} entry @param {string} key */
function flag(entry, key) {
  return entry[key] === true
}

/**
 * Read one catalogue entry into a card, or refuse it by name.
 *
 * Both spellings of the window are read. The file on disk is snake_case, from
 * the Python catalogue it was ported from; `docs/RULINGS.md` names the field
 * `contextTokens`. Refusing one of the two spellings would turn a naming
 * disagreement into an install that fails for a reason the person cannot see.
 *
 * @param {string} name the catalogue KEY, so the refusal can say which entry
 * @param {CatalogueEntry} entry
 * @returns {ModelCard}
 * @throws {HarnessError} `missing_context_window` when the entry has no window
 */
export function modelCard(name, entry) {
  const contextTokens = number(entry, 'context_tokens') ?? number(entry, 'contextTokens')
  if (contextTokens === null) {
    throw new HarnessError(
      'missing_context_window',
      `the model catalogue entry "${name}" does not say how big its context window is`,
      {
        detail:
          'add `"context_tokens": <the model\'s window>` to this entry in models.json. ' +
          'The budget a prompt is assembled against is derived from it; there is no ' +
          'default, because the one the Rust build had (8192) silently deleted the ' +
          'block the agent had just been told to read.',
      },
    )
  }
  const model = typeof entry['model'] === 'string' ? entry['model'].trim() : ''
  return {
    name,
    model: model || name,
    contextTokens,
    maxOutputTokens: number(entry, 'max_output_tokens') ?? number(entry, 'maxOutputTokens'),
    acceptsImages: flag(entry, 'accepts_images') || flag(entry, 'acceptsImages'),
    reasons: flag(entry, 'reasons'),
  }
}

/**
 * Read a whole catalogue document's `models` map, refusing the FIRST entry
 * that has no window. Install-time: this is what turns a missing field into a
 * message at the moment a person can still fix it, rather than into a prompt
 * that quietly loses a section eight turns later.
 *
 * The keys are sorted, so the FIRST refusal is the same entry whatever order
 * `JSON.parse` hands the map back in. A caller building a picker from this map
 * is looking at alphabetical order, not at the order models.json authored.
 *
 * @param {unknown} doc the parsed contents of models.json
 * @returns {Record<string, ModelCard>}
 */
export function modelCards(doc) {
  const models = /** @type {Record<string, unknown>} */ (
    (doc && typeof doc === 'object' && /** @type {Record<string, unknown>} */ (doc)['models']) || {}
  )
  /** @type {Record<string, ModelCard>} */
  const cards = {}
  for (const name of Object.keys(models).sort()) {
    const entry = models[name]
    if (!entry || typeof entry !== 'object') {
      throw new HarnessError('malformed_catalogue_entry', `the model catalogue entry "${name}" is not an object`, {
        detail: `it is ${entry === null ? 'null' : typeof entry}; every entry is a table of settings`,
      })
    }
    cards[name] = modelCard(name, /** @type {CatalogueEntry} */ (entry))
  }
  return cards
}
