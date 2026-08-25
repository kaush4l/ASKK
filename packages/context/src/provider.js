/**
 * THE PROVIDER ADAPTER: one object that both writes a request and reads the
 * reply that comes back.
 *
 * They are one object because the Rust had them apart — `render.rs` chose the
 * notation, `openai.rs` serialised it, unconditionally, whatever the render
 * had decided — and nothing could catch the two disagreeing. An adapter that
 * writes a shape it cannot read is a bug you find on the wire.
 *
 * This file is the SHAPE and the three rules every implementation obeys. The
 * spellings are `openai.js`, `anthropic.js` and `gemini.js`; `adapters.js`
 * picks between them.
 * @module
 */

import { ModelError } from '@harness/kernel'

/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./card.js').ModelCard} ModelCard */
/** @typedef {import('./image.js').ImageRule} ImageRule */
/** @typedef {import('@harness/kernel').Usage} Usage */
/** @typedef {import('@harness/kernel/ports.js').FinishReason} FinishReason */

/**
 * One callable as the wire describes it. NOT `agent`'s `Tool`: this package
 * sits below that one, and what a provider needs is a name, a sentence and a
 * JSON schema.
 * @typedef {{name: string, description: string, parameters: Record<string, unknown>}} ToolSpec
 */

/**
 * One assistant turn as it must be REPLAYED on a later request.
 *
 * `provider` and `model` are stamped at the moment it was received, and
 * `replayState` is that provider's own opaque echo material — reasoning text,
 * a signed content array, a thought signature. It is `unknown` on purpose:
 * nothing outside the adapter that produced it may read into it, and nothing
 * may rebuild it (see `ownReplay`).
 *
 * `results` travel with the turn because a replayed assistant message carrying
 * tool calls whose results are missing is a 400 on every provider here.
 * @typedef {{
 *   provider: string,
 *   model: string,
 *   text: string,
 *   calls: Array<{id: string, tool: string, args: string}>,
 *   results: Array<{id: string, output: string}>,
 *   replayState: unknown,
 * }} Exchange
 */

/**
 * Usage with the one field `kernel.Usage` has no room for.
 *
 * `reasoningTokens` is DETAIL ALREADY INSIDE `outputTokens` and is carried for
 * a person to read, never to add. Adding it again over-reports the turn and
 * trips compaction early, and the budget is the most contested number in this
 * project.
 *
 * The adapters NORMALISE to that rule rather than reporting each vendor's
 * convention: Gemini counts thoughts outside its candidate tokens, so its
 * adapter folds them in. One invariant across three providers is the only
 * version of this a meter can be written against.
 * @typedef {Usage & {reasoningTokens: number|null}} ProviderUsage
 */

/**
 * A reply, read. Assignable to `kernel.ModelReply` — `core` hands this
 * straight to the loop — plus what the NEXT request needs to replay this turn.
 * @typedef {{
 *   text: string,
 *   reasoning: string,
 *   calls: Array<{id: string, tool: string, args: string}>,
 *   finish: FinishReason,
 *   usage: ProviderUsage|null,
 *   raw: unknown,
 *   provider: string,
 *   replayState: unknown,
 * }} ProviderReply
 */

/**
 * @typedef {{
 *   provider: string,
 *   images: ImageRule,
 *   buildRequest: (doc: Document, card: ModelCard, tools: ToolSpec[], opts?: RequestOpts) => Record<string, unknown>,
 *   parseResponse: (body: unknown) => ProviderReply,
 * }} ProviderAdapter
 */

/** @typedef {{replay?: Exchange[], temperature?: number|null, stream?: boolean}} RequestOpts */

/**
 * The replay material for one earlier turn, or a refusal BY NAME.
 *
 * WHY THIS IS A THROW. `replayState` is one vendor's opaque signature — an
 * Anthropic content array is signature-verified, a Gemini thought signature is
 * a token from their runtime — and handing it to a different vendor is the
 * concrete corruption case for being multi-provider on purpose. It cannot be
 * translated and it must not be guessed at, so the only two honest answers are
 * "replay it" and "say whose it is and stop". A caller that expects a mixed
 * history sieves it with `replayable` FIRST; reaching here with a foreign turn
 * means the sieve was not run, which is a build assembled wrong rather than a
 * runtime condition.
 * @param {Exchange} turn @param {string} provider the adapter asking
 * @returns {unknown}
 * @throws {ModelError} `malformed` naming both providers
 */
export function ownReplay(turn, provider) {
  if (turn.provider === provider) return turn.replayState
  throw new ModelError(
    'malformed',
    `the ${provider} adapter was handed an assistant turn recorded by ${turn.provider || 'no provider'}`,
    {
      detail:
        `"${turn.model}" answered through ${turn.provider}, and its replay state is that vendor's own ` +
        'opaque signature — reasoning text, a signed content array, a thought signature. It cannot be ' +
        `translated into ${provider}'s. Filter the history with replayable(turns, '${provider}') before building.`,
    },
  )
}

/**
 * The turns THIS provider may replay, oldest first. A history that changed
 * provider mid-session keeps its words in the paper — the transcript is a
 * section like any other — and loses only the echo material the new provider
 * could never have used.
 * @param {Exchange[]} turns @param {string} provider
 * @returns {Exchange[]}
 */
export function replayable(turns, provider) {
  return turns.filter((t) => t.provider === provider)
}

/**
 * What one turn cost, whole. `reasoningTokens` is NOT a term: it is already
 * inside `outputTokens`, and a meter that adds it reports a turn that never
 * happened.
 * @param {ProviderUsage} usage
 */
export function totalTokens(usage) {
  return usage.inputTokens + (usage.cachedInputTokens ?? 0) + usage.outputTokens
}

/**
 * A provider's own stop word, in the kernel's vocabulary. An unmapped or
 * absent word is `'unknown'` and never `'stop'`: a turn that ends naming the
 * string nobody could read is debuggable, and one that claims it was answered
 * is not.
 * @param {Record<string, FinishReason>} table @param {unknown} raw
 * @returns {FinishReason}
 */
export function finishFrom(table, raw) {
  return (typeof raw === 'string' ? table[raw] : undefined) ?? 'unknown'
}
