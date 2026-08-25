/**
 * WHERE THE CACHEABLE PREFIX ENDS, and what the provider said it was worth.
 *
 * `Stability` has claimed since the Rust that ordering the paper by how often
 * a section changes buys a prefix cache hit. `grep -rn cache_control
 * crates/context` was EMPTY: nothing was ever stamped, no provider was ever
 * asked to keep anything, and no number came back that anybody could read
 * (`docs/RULINGS.md` Attack 4, item 7 — stamp it and measure it, or delete the
 * claim). This file is the stamp and the measurement.
 *
 * THE BREAKPOINT IS NOT A NEW DECLARATION. It is read off the one that already
 * exists: `sectionOf` dates a cacheable component ZERO and an uncacheable one
 * with the real clock, so the byte-stable prefix is exactly the leading run of
 * sections with `producedAt === 0`. A section that is dated is a section whose
 * bytes differ next turn, and everything after it is a cache miss whatever we
 * stamp — a prefix cache only ever caches a PREFIX.
 * @module
 */

/** @typedef {import('./types.js').Section} Section */
/** @typedef {import('./provider.js').ProviderUsage} ProviderUsage */

/**
 * How many leading sections are byte-stable across turns. Zero means the
 * paper opens with something dated and there is nothing to keep.
 * @param {Section[]} sections in the order they will be rendered
 */
export function stablePrefix(sections) {
  const dated = sections.findIndex((s) => s.provenance.producedAt !== 0)
  return dated === -1 ? sections.length : dated
}

/**
 * What share of this turn's input the provider says it did not re-read, or
 * `null` when it reported no cache accounting at all.
 *
 * `null` and not zero, and the distinction is the whole point: a provider that
 * does not report caching and a provider that reported a total miss are
 * different facts, and a meter that shows 0% for both teaches a person that
 * the breakpoints do not work.
 * @param {ProviderUsage|null} usage
 * @returns {number|null}
 */
export function cacheHitRatio(usage) {
  if (!usage || usage.cachedInputTokens === null || usage.cachedInputTokens === undefined) return null
  const total = usage.inputTokens + usage.cachedInputTokens
  return total === 0 ? 0 : usage.cachedInputTokens / total
}

/**
 * The same fact in words, for the debug view (I5): the core owes the interface
 * the worded string beside the number, because two panes wording a ratio for
 * themselves round it differently and the person reading both learns that the
 * system does not know what it thinks.
 * THREE FACTS AND NOT TWO. A head too short to be kept, a provider that
 * reported nothing, and a genuine miss all read as 0% if they share a
 * sentence, and a person who sees 0% twice learns that the breakpoints do not
 * work. The first of the three is the one this build is actually in: a paper
 * of a few hundred tokens is below every published minimum, so nothing is
 * offered and there is nothing for the provider to have kept.
 * @param {ProviderUsage|null} usage
 * @param {CacheOffer|null} [offer] what was stamped, where the caller knows
 */
export function cacheSentence(usage, offer = null) {
  if (offer && !offer.offered) {
    return `The stable head was ${offer.tokens} tokens, below this provider's ${offer.minimum}-token minimum; nothing was offered for caching.`
  }
  const ratio = cacheHitRatio(usage)
  if (ratio === null) return 'This provider reported no cache accounting for the turn.'
  const cached = usage?.cachedInputTokens ?? 0
  const read = usage?.inputTokens ?? 0
  return `${Math.round(ratio * 100)}% of the input was served from the provider's cache: ${cached} cached, ${read} read afresh.`
}

/**
 * THE FLOOR BELOW WHICH A BREAKPOINT IS A NO-OP, per provider that takes one.
 *
 * Anthropic silently declines to cache a prefix shorter than a published
 * minimum: no error, no field, `cache_read_input_tokens: 0` forever. The
 * minimum is PER MODEL and it is not monotonic across generations — 512 tokens
 * on Opus 5, 1024 on Opus 4.8 and the Sonnets, 2048 on Opus 4.7 and Haiku 3.5,
 * 4096 on Opus 4.6, Opus 4.5 and Haiku 4.5 (Anthropic's prompt-caching
 * documentation, read 2026-08-25).
 *
 * A catalogue entry carries a free-form `model` string this package cannot
 * enumerate, so the number here is the LARGEST of those and not the smallest.
 * It is the only floor true for whichever model the entry names, and the
 * asymmetry is the reason: below the real minimum a stamp buys nothing, so
 * withholding one costs at worst a hit we might have had, while stamping one
 * buys a CLAIM WE CANNOT BACK — and an unbacked caching claim is the exact
 * thing this file exists to end.
 *
 * A provider absent from this table caches prefixes implicitly and is never
 * asked to keep anything, so it has no floor to be under.
 * @type {Record<string, number>}
 */
export const MIN_CACHEABLE_TOKENS = { anthropic: 4096 }

/** What was decided about one stable head, and the number it was decided against. */
/** @typedef {{provider: string, tokens: number, minimum: number|null, offered: boolean}} CacheOffer */

/**
 * Whether a stable head this size is worth offering to this provider.
 * @param {string} provider @param {number} tokens estimated size of the stable head
 * @returns {CacheOffer}
 */
export function cacheOffer(provider, tokens) {
  const minimum = MIN_CACHEABLE_TOKENS[provider] ?? null
  return { provider, tokens, minimum, offered: minimum === null || tokens >= minimum }
}
