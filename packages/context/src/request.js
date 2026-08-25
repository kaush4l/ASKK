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
import { replayable } from './provider.js'

/** @typedef {import('./state.js').State} State */
/** @typedef {import('./card.js').ModelCard} ModelCard */
/** @typedef {import('./provider.js').ToolSpec} ToolSpec */
/** @typedef {import('./provider.js').Exchange} Exchange */
/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./budget.js').Turn} Turn */

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

/** What one call is: the bytes, the paper they were written from, and whose protocol they are in. */
/** @typedef {{provider: string, body: Record<string, unknown>, document: Document}} ModelRequest */

/**
 * @param {Asking} asking
 * @returns {ModelRequest}
 * @throws {HarnessError} by law name — `unknown_provider`, `window_too_small`,
 *   `elided_but_named`, `untrusted_in_system`, `no_head`
 */
export function requestFor(asking) {
  const adapter = adapterFor(asking.card.kind)
  const document = assemble(asking.state, budgetFor(asking.card, asking.turn ?? {}), adapter.images)
  const body = adapter.buildRequest(document, asking.card, asking.tools ?? [], {
    replay: replayable(asking.replay ?? [], adapter.provider),
    temperature: asking.temperature ?? null,
    stream: asking.stream === true,
  })
  return { provider: adapter.provider, body, document }
}
