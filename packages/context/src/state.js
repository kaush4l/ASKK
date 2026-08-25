/**
 * Everything assembly reads. All content arrives as DATA — the providers ran
 * earlier, the clocks were injected — which is what keeps assembly pure (I7,
 * I14). Nothing here is fetched, and nothing here is computed on the way in.
 * @module
 */

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./types.js').Section} Section */

/**
 * One provider's output, gathered before assembly.
 *
 * The summary is precomputed and handed in beside the full section because
 * pure assembly cannot author one: writing a curated summary is the owning
 * provider's job, and doing it during assembly would mean a model call inside
 * the function that must be byte-identical across runs.
 *
 * `null` — never absent — means there is no curated summary and the summarized
 * level renders a mechanical truncation instead. It is a real answer and it
 * has to survive `JSON.stringify`, which an absent property does not.
 * @typedef {{section: Section, summary: Part[]|null}} SectionSource
 */

/**
 * The input to one assembly: just the gathered sources. WHICH providers
 * contribute is the caller's decision, made from the phase's configuration, so
 * this package never learns what a phase is or what the registry holds.
 *
 * The order is the canonical declaration order, and assembly's sort is stable,
 * so two sources sharing a slot come out in the order they were supplied in.
 * @typedef {{sources: SectionSource[]}} State
 */

export {}
