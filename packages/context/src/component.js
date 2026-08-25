/**
 * The component contract: everything the model is ever told is one of these.
 *
 * A component RENDERS ITS BODY and nothing else. The `## id` / `(intent)`
 * frame around it is inherited — the provider adapter writes it — which is
 * what makes the next sentence true: a component with nothing to say returns
 * no parts, and the whole block disappears rather than arriving as an empty
 * heading. An agent with no memory has no memory heading; it does not have a
 * memory heading with nothing under it, which reads to a model as an empty
 * memory rather than as a faculty it does not have.
 *
 * In Rust this was a trait with eleven methods, most of them defaults, because
 * a trait was the only way to get dynamic dispatch over a heterogeneous list
 * and inherited behaviour in one construct. In JavaScript a component is a
 * plain object with a `render` function, and the defaults live in `sectionOf`
 * — one place that reads them, rather than eleven that could override them.
 * `forms`/`render_in`/`notation` do not come across: three notations were
 * declared, one was ever produced, and `render_in` had no overriding
 * implementation in the tree.
 * @module
 */

import { fnv1a } from './hash.js'

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./types.js').Section} Section */
/** @typedef {import('./types.js').Fidelity} Fidelity */
/** @typedef {import('./types.js').Stability} Stability */
/** @typedef {import('./types.js').Trust} Trust */
/** @typedef {import('@harness/kernel').SectionId} SectionId */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */

/**
 * One part of the prompt, able to write itself down.
 *
 * Four fields are required and the rest have defaults, because those four are
 * the ones nobody can answer on a component's behalf: where it goes, what it
 * is called, the one sentence saying why it is in the prompt at all, and the
 * body itself. `intent` is not decoration — it is the mechanism that stops a
 * prompt from accreting, since a block nobody can write one sentence for is a
 * block nobody can justify, and `assemble` rejects an empty one.
 *
 * `render` returns parts rather than a string because the paper is multimodal
 * and collapsing it to text is the known failure mode.
 * @typedef {{
 *   id: SectionId,
 *   slot: number,
 *   intent: string,
 *   render: () => Part[],
 *   stability?: Stability,
 *   floor?: Fidelity,
 *   priority?: number,
 *   trust?: Trust,
 *   cacheable?: boolean,
 *   version?: string,
 * }} Component
 */

/**
 * The body as one text part, or NO parts when there is nothing to say. This
 * is where the elision starts: a component that returns `text('')` is a
 * component the assembled paper will not carry a heading for.
 * @param {string} body
 * @returns {Part[]}
 */
export function text(body) {
  return body.length === 0 ? [] : [{ type: 'text', text: body }]
}

/**
 * Content hash of what this component renders, prefixed with its own id so
 * two components carrying identical text can never collide — a soul and a
 * system block that happen to say the same thing are different components.
 * @param {Component} c
 */
export function keyOf(c) {
  return `${c.id}:${fnv1a(c.render().map(identity).join(''))}`
}

/** The bytes that IDENTIFY a part — not its rendering. */
function identity(/** @type {Part} */ p) {
  switch (p.type) {
    case 'text': return `t${p.text}`
    case 'image': return `i${p.mediaType}${p.dataBase64}`
    case 'audio': return `a${p.mediaType}${p.dataBase64}`
    case 'file': return `f${p.name}${p.mediaType}${p.dataBase64}`
  }
}

/**
 * The component as an assembled section, with the defaults applied once.
 *
 * A cacheable component reports time ZERO rather than `at`, so its bytes stay
 * identical across turns and boots — that byte-stability IS the prefix-cache
 * property, and a section dated with the current clock would break it for
 * everything after it. Anything uncacheable is dated honestly.
 * @param {Component} c
 * @param {Timestamp} at
 * @returns {Section}
 */
export function sectionOf(c, at) {
  const cacheable = c.cacheable ?? true
  return {
    id: c.id,
    intent: c.intent,
    slot: c.slot,
    stability: c.stability ?? 'dynamic',
    priority: c.priority ?? 5,
    fidelity: 'full',
    floor: c.floor ?? 'summarized',
    trust: c.trust ?? 'authored',
    budgetHint: 0, // assemble recomputes it from the parts it actually kept
    provenance: {
      module: `builtin.${c.id}`,
      version: c.version ?? '1',
      inputHash: keyOf(c),
      producedAt: cacheable ? 0 : at,
    },
    parts: c.render(),
  }
}
