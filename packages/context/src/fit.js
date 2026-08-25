/**
 * The budget, applied — and the file where head-of-string truncation is
 * BANNED (`docs/RULINGS.md` Attack 4).
 *
 * The Rust kept the FRONT 200 characters of a history that renders oldest
 * first. On any constrained turn the model therefore kept the greeting and
 * lost the message the person had actually sent, and nothing said so. There
 * are exactly THREE primitives here and there will not be a fourth without a
 * ruling:
 *
 *   dropOldest             whole turns leave from the oldest end
 *   headAndTail            both ends of a body survive; the middle is named
 *   usePrecomputedSummary  a curated summary the owning provider already wrote
 *
 * None of them keeps a prefix and discards the rest, which is the property
 * that made the defect possible. `usePrecomputedSummary` never AUTHORS one:
 * writing a summary is a model call, and assembly has to be byte-identical
 * across runs (I14).
 * @module
 */

import { estimateParts, CHARS_PER_TOKEN } from './estimate.js'

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./image.js').ImageRule} ImageRule */
/** @typedef {import('./types.js').Fidelity} Fidelity */
/** @typedef {import('./state.js').SectionSource} SectionSource */

/**
 * The transcript's role tags, as they are written into the history section.
 * Exported so the component that BUILDS a transcript and the code that fits
 * one read the same spelling — the Rust wrote `format!("{role}: {text}")` in
 * one file and grouped nothing anywhere, so the two could not disagree only
 * because the second half did not exist.
 */
export const TURN_ROLES = /** @type {const} */ (['user', 'assistant', 'result'])

/**
 * The role a part announces, or `null` for a part that continues the one
 * before it — a raw image, a second paragraph, a tool's output block.
 * @param {Part} part
 * @returns {'user'|'assistant'|'result'|null}
 */
export function turnRoleOf(part) {
  if (part.type !== 'text') return null
  const head = part.text.slice(0, part.text.indexOf(':')).trim().toLowerCase()
  return TURN_ROLES.find((r) => r === head) ?? null
}

/**
 * A turn STARTS at a user part and swallows everything after it. That is what
 * makes both budget promises structural rather than checked: an assistant's
 * tool call and the result it produced are inside one group by construction,
 * so no drop can separate them, and the newest group is the newest user
 * message with its replies.
 * @param {Part[]} parts
 * @returns {Part[][]}
 */
function turnsOf(parts) {
  /** @type {Part[][]} */
  const turns = []
  for (const part of parts) {
    const last = turns[turns.length - 1]
    if (last === undefined || turnRoleOf(part) === 'user') turns.push([part])
    else last.push(part)
  }
  return turns
}

/**
 * Whole turns leave from the OLDEST end until the rest fits, and the newest
 * turn never leaves however far over it is: a budget that removed the message
 * being answered would be answering nothing.
 * @param {Part[]} parts
 * @param {number} allowance
 * @param {ImageRule} [images]
 * @returns {Part[]}
 */
export function dropOldest(parts, allowance, images) {
  const turns = turnsOf(parts)
  let spent = estimateParts(parts, images).tokens
  let start = 0
  while (start < turns.length - 1 && spent > allowance) {
    spent -= estimateParts(turns[start] ?? [], images).tokens
    start += 1
  }
  const kept = turns.slice(start).flat()
  if (start === 0) return kept
  const notice = `[${start} earlier turn(s) dropped to fit the window; ask to have them restored]`
  return [{ type: 'text', text: notice }, ...kept]
}

/**
 * Both ends of every text part survive and the middle says how much left. The
 * end of a body is where its conclusion is; the start is where its preamble
 * is. Keeping only one of them is the banned operation, and keeping the wrong
 * one is the bug this replaces.
 * @param {Part[]} parts
 * @param {number} allowance
 * @returns {Part[]}
 */
export function headAndTail(parts, allowance) {
  const texts = parts.filter((p) => p.type === 'text').length
  if (texts === 0) return parts
  const share = Math.max(2, Math.floor((allowance * CHARS_PER_TOKEN) / texts))
  return parts.map((p) => (p.type === 'text' ? { type: 'text', text: cut(p.text, share) } : p))
}

/**
 * Cut by CODE POINT and not by index: slicing a UTF-16 string mid-surrogate
 * produces a lone half that no tokenizer and no person can read.
 * @param {string} body @param {number} allowanceChars
 */
function cut(body, allowanceChars) {
  const chars = Array.from(body)
  if (chars.length <= allowanceChars) return body
  const half = Math.floor(allowanceChars / 2)
  const gone = chars.length - half * 2
  return `${chars.slice(0, half).join('')}\n…[${gone} characters elided from the middle]…\n${chars.slice(-half).join('')}`
}

/**
 * The summary the owning provider wrote, or `null` when there is none. The
 * distinction is the whole point: assembly reads a curated summary, it never
 * writes one.
 * @param {SectionSource} source
 * @returns {Part[]|null}
 */
export function usePrecomputedSummary(source) {
  return source.summary
}

/**
 * What a section contributes at one fidelity, derived from its FULL parts
 * every time — never from the previous level, so a section walking the ladder
 * cannot compound its own losses.
 * @param {SectionSource} source
 * @param {Fidelity} fidelity
 * @param {number} allowance
 * @param {ImageRule} [images]
 * @returns {Part[]}
 */
export function effectiveParts(source, fidelity, allowance, images) {
  const parts = source.section.parts
  switch (fidelity) {
    case 'full':
      return parts
    case 'summarized':
      return usePrecomputedSummary(source) ??
        (parts.some((p) => turnRoleOf(p) !== null) ? dropOldest(parts, allowance, images) : headAndTail(parts, allowance))
    case 'pointer':
      return [{ type: 'text', text: pointerText(source) }]
    case 'elided':
      return []
  }
}

/**
 * What stands in for a section the budget could not carry. It names the
 * section and says the content still exists, because a model that is told a
 * block is absent asks for it, and a model shown nothing assumes there was
 * nothing.
 * @param {SectionSource} source
 */
export function pointerText(source) {
  const n = source.section.parts.length
  return n === 0
    ? `[section '${source.section.id}': nothing this turn]`
    : `[section '${source.section.id}': ${n} part(s) held back to fit the window; ask for them]`
}
