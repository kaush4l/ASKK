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
 * @param {ProviderUsage|null} usage
 */
export function cacheSentence(usage) {
  const ratio = cacheHitRatio(usage)
  if (ratio === null) return 'This provider reported no cache accounting for the turn.'
  const cached = usage?.cachedInputTokens ?? 0
  const read = usage?.inputTokens ?? 0
  return `${Math.round(ratio * 100)}% of the input was served from the provider's cache: ${cached} cached, ${read} read afresh.`
}
