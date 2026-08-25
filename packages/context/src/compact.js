/**
 * COMPACTION, AS MAP-REDUCE OVER CHUNKS (`docs/RULINGS.md` Attack 4, item 3).
 *
 * The Rust assembled its summarising sheet against the same 8192-token
 * constant as everything else, and put the transcript in a block whose floor
 * was `Summarized`. So a transcript larger than the budget was cut to 200
 * characters, summarised, and the result REPLACED THE ENTIRE WINDOW —
 * silently, irreversibly, and in exactly the case compaction exists to serve.
 * The summariser summarised the thing it was summarising for.
 *
 * Three rules, and each is executable:
 *
 * 1. **The transcript block declares `floor: 'full'`.** It is unsummarisable
 *    BY CONSTRUCTION — the ladder cannot choose it, whatever the budget says.
 *    An oversized chunk therefore overshoots honestly and is recorded in the
 *    report, rather than being quietly shredded.
 * 2. **Chunk, then fold.** A window too large for one call is split into
 *    chunks that each fit whole entries inside the allowance, each summarised
 *    on its own (the map), and the summaries summarised together (the reduce).
 *    Nothing is ever cut mid-entry, which is the same ban `fit.js` enforces.
 * 3. **The window is replaced only by a summary that is non-empty AND smaller
 *    than what it replaces.** A summariser that returned nothing, or returned
 *    more than it read, has not compacted anything, and swapping the
 *    conversation for it loses the conversation for no gain.
 *
 * This file is the ARITHMETIC — when to compact, where the chunk boundaries
 * fall, and whether an answer is allowed to replace the window. The paper each
 * call is made against is `sheet.js`. They are apart because assembly cannot
 * author a summary — that is a model call, and assembly must be byte-identical
 * across runs (I14) — so the caller runs the map and the reduce between them.
 * @module
 */

import { estimateParts } from './estimate.js'

/** The line a compacted window opens with. */
export const SUMMARY_HEADING = 'Summary of the conversation so far:'

/**
 * Is the window long enough to compact? A `compactAt` of zero never compacts,
 * and the check is `>=`, made BEFORE assembling — a prompt too long to send is
 * no use.
 * @param {string[]} entries @param {number} compactAt
 */
export function due(entries, compactAt) {
  return compactAt !== 0 && entries.length >= compactAt
}

/**
 * The oldest entries, split into stretches that each fit `allowance` tokens.
 *
 * Whole entries only. An entry larger than the allowance on its own becomes a
 * chunk of one and is sent oversized, because the alternative is cutting it —
 * which is the banned operation, and the reason the block it lands in declares
 * `floor: 'full'`.
 *
 * `null` when nothing is old enough: the newest `keep` entries never leave.
 * @param {string[]} entries @param {number} keep @param {number} allowance
 * @returns {{chunks: string[][], kept: string[]}|null}
 */
export function chunksOf(entries, keep, allowance) {
  if (entries.length <= keep) return null
  const older = entries.slice(0, entries.length - keep)
  /** @type {string[][]} */
  const chunks = []
  let spent = 0
  for (const entry of older) {
    const cost = estimateParts([{ type: 'text', text: entry }]).tokens
    const open = chunks[chunks.length - 1]
    if (open === undefined || (spent + cost > allowance && open.length > 0)) {
      chunks.push([entry])
      spent = cost
    } else {
      open.push(entry)
      spent += cost
    }
  }
  return { chunks, kept: entries.slice(entries.length - keep) }
}

/**
 * The window after compaction, or the window unchanged and the reason why.
 *
 * `replaced` is never true on a summary that is empty or no smaller than the
 * stretch it stands in for. Both refusals leave the conversation exactly as it
 * was, and both SAY so: a compaction that silently did nothing is how a window
 * grows past its budget with a green log behind it.
 * @param {string[]} entries @param {string} summary @param {number} keep
 * @returns {{entries: string[], replaced: boolean, why: string}}
 */
export function replaceWindow(entries, summary, keep) {
  const notes = summary.trim()
  if (entries.length <= keep) {
    return { entries, replaced: false, why: `nothing is older than the ${keep} entries kept` }
  }
  const replaced = entries.slice(0, entries.length - keep)
  const was = replaced.join('\n\n').length
  if (notes.length === 0) {
    return { entries, replaced: false, why: 'the summariser returned nothing, so the history stands' }
  }
  const line = `system: ${SUMMARY_HEADING}\n${notes}`
  if (line.length >= was) {
    return {
      entries,
      replaced: false,
      why: `the summary is ${line.length} characters and replaces ${was}, so it compacts nothing`,
    }
  }
  return {
    entries: [line, ...entries.slice(entries.length - keep)],
    replaced: true,
    why: `${replaced.length} entries and ${was} characters became ${line.length}`,
  }
}
