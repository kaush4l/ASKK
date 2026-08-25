/**
 * THE ONE PLACE A MODEL CALL IS WRITTEN DOWN. Everything the model receives
 * comes out of this function: the budget derived from the card, the paper
 * assembled under that card's image arithmetic, and the body serialised by the
 * adapter that just decided the arithmetic.
 *
 * WHY IT IS ONE FUNCTION AND NOT THREE CALLS AT EVERY CALL SITE. The Rust
 * rendered with whichever notation the paper chose and then serialised with
 * `openai_request_body` unconditionally (`docs/RULINGS.md` Attack 4). Three
 * separate calls can always be made in a combination nobody intended — assemble
 * under Anthropic's image rule, serialise for OpenAI, bill the turn on a third
 * provider's arithmetic. Here `adapterFor` is read ONCE and both halves are
 * handed the same object, so the rendered shape and the serialised shape cannot
 * disagree. That is the whole reason this file exists; it forwards nothing that
 * a caller could have forwarded correctly on its own.
 *
 * IT RETURNS THE DOCUMENT TOO, because the receipt belongs to whoever logs the
 * call — `report.spent`, the withheld list, the section fidelities — and
 * re-assembling to obtain it would be a second, possibly different, paper.
 * @module
 */

import { adapterFor } from './adapters.js'
import { assemble } from './assemble.js'
import { budgetFor } from './budget.js'
import { offerFor } from './cache.js'
import { replayable } from './provider.js'
import { receiptOf } from './receipt.js'
import { messagesOf } from './wire.js'

/** @typedef {import('./state.js').State} State */
/** @typedef {import('./card.js').ModelCard} ModelCard */
/** @typedef {import('./provider.js').ToolSpec} ToolSpec */
/** @typedef {import('./provider.js').Exchange} Exchange */
/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./budget.js').Turn} Turn */
/** @typedef {import('./receipt.js').Receipt} Receipt */

/**
 * One model call, before it exists.
 *
 * `replay` is sieved here rather than by the caller: `ownReplay` throws by name
 * when it meets another vendor's signed material, and a history that changed
 * provider mid-session is an ordinary thing rather than a build assembled
 * wrong. The caller passes what it has; this passes on what this provider can
 * legally echo.
 * @typedef {{
 *   state: State,
 *   card: ModelCard,
 *   tools?: ToolSpec[],
 *   replay?: Exchange[],
 *   temperature?: number|null,
 *   stream?: boolean,
 *   turn?: Turn,
 * }} Asking
 */

/**
 * What one call is: the bytes, the paper they were written from, whose protocol
 * they are in — and the RECEIPT for the decisions that produced them.
 *
 * The receipt is on the request and not left to be recomputed by a logger,
 * because it is a record of what THIS call decided: which sections the budget
 * shortened, and whether the stable head was worth offering to this provider's
 * cache. Recomputed later it is a second opinion about a call that has already
 * gone out.
 * @typedef {{provider: string, body: Record<string, unknown>, document: Document, receipt: Receipt}} ModelRequest
 */

/**
 * @param {Asking} asking
 * @returns {ModelRequest}
 * @throws {HarnessError} by law name — `unknown_provider`, `window_too_small`,
 *   `elided_but_named`, `untrusted_in_system`, `no_head`
 */
export function requestFor(asking) {
  const adapter = adapterFor(asking.card.kind)
  const budget = budgetFor(asking.card, asking.turn ?? {})
  const document = assemble(asking.state, budget, adapter.images)
  const body = adapter.buildRequest(document, asking.card, asking.tools ?? [], {
    replay: replayable(asking.replay ?? [], adapter.provider),
    temperature: asking.temperature ?? null,
    stream: asking.stream === true,
  })
  // The paper is rendered a SECOND time to price the cacheable head, and that
  // is deliberate: `messagesOf` is pure and deterministic, so the head this
  // measures is byte-for-byte the head the adapter just stamped or declined to
  // stamp. Asking the adapter to hand its decision back would put a receipt
  // field in the middle of three wire formats to save one pass over sections.
  const cache = offerFor(messagesOf(document, asking.card), adapter.provider, adapter.images)
  return { provider: adapter.provider, body, document, receipt: receiptOf(document, budget, cache) }
}
