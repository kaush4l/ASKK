/**
 * Stage two: how a provider HEARS the paper — still provider-neutral, because
 * every provider hears the same shape and spells it differently. The spelling
 * is each adapter's; the shape is here, once, so three adapters cannot
 * disagree about what the model was told.
 *
 * TWO MESSAGES, AND THE SPLIT IS THE TRUST BOUNDARY. The Rust put the whole
 * paper in ONE system message, which handed a fetched page and another agent's
 * words to the model in the role it reads as its own standing instructions.
 * `slot.js:isSystemSlot` already named the fix and left it to this layer: the
 * standing instructions are the system message, and everything from HISTORY
 * onward — the transcript, the observations, this turn's directive, and the
 * response contract pinned behind them — is the user message.
 *
 * THE RESPONSE CONTRACT STAYS LAST, which is the law `render.rs` had to fight
 * a compaction notice for. Here it is not a fight: the notice goes immediately
 * before the tail inside the user message, and the tail is still the last
 * thing read.
 *
 * The Rust also appended a fixed "Proceed as the response_contract instructs."
 * because a system-only prompt is illegal on most endpoints. There is always a
 * user message now — the tail is in it — so that line is gone rather than
 * ported. @module
 */

import { isSystemSlot, isTail } from './slot.js'
import { stablePrefix } from './cache.js'
import { ruleNamed } from './image.js'
import { estimatePart } from './estimate.js'

/** @typedef {import('./types.js').Document} Document */
/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./types.js').Section} Section */
/** @typedef {import('./types.js').CompactionReport} CompactionReport */
/** @typedef {import('./card.js').ModelCard} ModelCard */
/** @typedef {import('./image.js').ImageRule} ImageRule */

/**
 * One rendered message. Content is ALWAYS the array form: a provider that
 * wants a bare string is one adapter's collapse, not this layer's decision.
 *
 * `cacheUntil` is the index of the LAST content block that is byte-identical
 * to the same message on the next turn, or -1 when nothing here is. An adapter
 * whose API takes an explicit breakpoint stamps that block; one whose provider
 * caches prefixes implicitly needs no field and gets the same guarantee from
 * the same boundary, which is why the split is here and not in three adapters.
 *
 * IN PRACTICE ONLY THE SYSTEM MESSAGE EVER CARRIES ONE, and that is measured
 * rather than assumed: `history`, `observations` and `directive` are all
 * `cacheable: false`, so the spoken message always OPENS with a dated section
 * and its `cacheUntil` is -1 in all 36 cells of the matrix. The field stays on
 * both because the boundary is one rule and not two, and `wire.test.js` pins
 * the -1 — the day a cacheable block lands at HISTORY the claim breaks loudly
 * instead of a breakpoint being dropped in silence.
 * @typedef {{role: 'system'|'user'|'assistant', content: Part[], cacheUntil: number}} Message
 */

/**
 * The paper as messages. Deterministic like `assemble`, and the same document
 * renders the same messages whatever the adapter does with them afterwards.
 * @param {Document} doc
 * @param {ModelCard} card
 * @returns {Message[]}
 */
export function messagesOf(doc, card) {
  const heard = doc.sections.filter((s) => s.fidelity !== 'elided')
  const system = heard.filter((s) => isSystemSlot(s.slot) && !isTail(s.slot))
  const spoken = heard.filter((s) => !isSystemSlot(s.slot) || isTail(s.slot))
  const images = ruleNamed(doc.report.imageRule)
  return [
    { role: 'system', ...render(system, card, null, images) },
    { role: 'user', ...render(spoken, card, doc.report, images) },
  ]
}

/**
 * Sections as content blocks: prose joins one running text, a part this model
 * can hear becomes its own block AT THAT POSITION, and one it cannot becomes a
 * named placeholder — never a silent drop (I15).
 *
 * The one forced block boundary is the cache breakpoint. Prose would otherwise
 * run from the soul straight through the clock into one string, and a single
 * string is all-or-nothing to a cache: one changed timestamp at the end of it
 * re-reads the agent's whole character. Flushing at the end of the stable
 * prefix is what makes the head reusable, and `cacheUntil` is where it ended.
 * @param {Section[]} sections @param {ModelCard} card @param {CompactionReport|null} report
 * @param {ImageRule} [images] the arithmetic the withheld line quotes its cost in
 * @returns {{content: Part[], cacheUntil: number}}
 */
function render(sections, card, report, images) {
  const stable = stablePrefix(sections)
  /** @type {Part[]} */
  const out = []
  let text = ''
  let cacheUntil = -1
  const flush = () => {
    if (text) out.push({ type: 'text', text })
    text = ''
  }
  sections.forEach((s, i) => {
    if (report && isTail(s.slot)) text += compactionNotice(report)
    text += `## ${s.id}\n(${s.intent})\n`
    for (const p of s.parts) {
      if (p.type === 'text') text += `${p.text}\n`
      else if (audible(p, card)) {
        flush()
        out.push(p)
      } else text += `${withheldLine(p, images)}\n`
    }
    text += '\n'
    if (i === stable - 1) {
      flush()
      cacheUntil = out.length - 1
    }
  })
  flush()
  return { content: out, cacheUntil }
}

/**
 * Whether this model can hear a non-text part.
 *
 * AUDIO AND FILES ARE ALWAYS WITHHELD, and that is a stated absence rather
 * than an oversight: no catalogue entry can say it accepts sound or documents,
 * so nothing may claim one does — `acceptsImages` answers vision and vision is
 * not document intake, so reading it as permission to send a PDF is this layer
 * claiming a capability nothing declared. An `accepts_audio` or `accepts_files`
 * field in `models.json` is what would change this answer, and until an entry
 * carries one the model is told in words that a sound or a document was held
 * back.
 * @param {Part} part @param {ModelCard} card
 */
function audible(part, card) {
  return part.type === 'image' && card.acceptsImages
}

/**
 * What the model reads in place of a part it cannot hear: typed, named, priced,
 * present.
 *
 * THE COST IS ON THE LINE because the model is being asked to answer without
 * something that was here, and "an image was withheld" and "a 1600x1200 image
 * worth 2560 tokens of this window was withheld" are different facts to reason
 * from. It is also the number a person needs in order to judge the catalogue
 * entry, and it is quoted with the rule it was counted under because the three
 * rules disagree by up to 3x about one photograph.
 * @param {Part} part @param {ImageRule} [images]
 */
function withheldLine(part, images) {
  if (part.type === 'text') return ''
  const what = part.type === 'file' ? `file '${part.name}' (${part.mediaType})` : `${part.type} (${part.mediaType})`
  const { tokens, basis } = estimatePart(part, images)
  const cost = `~${tokens} token${tokens === 1 ? '' : 's'} — ${basis}`
  return `[${what} withheld: this model does not accept it; it would have cost ${cost}]`
}

/**
 * What the budget took out of this document, emitted immediately BEFORE the
 * tail and never after it. It is not a section: a ladder-derived string
 * rendered as a section would be a part of the document the ladder is deciding
 * about, which is a loop rather than a component. It also names the image rule
 * the spend was counted under, because a compaction the model is asked to
 * accept should say by whose arithmetic it was necessary.
 * @param {CompactionReport} report
 */
function compactionNotice(report) {
  if (report.steps.length === 0 && report.withheld.length === 0) return ''
  const lines = [
    '## compaction_notice',
    '(what was compacted out of this document; ask to restore)',
    `- counted under the ${report.imageRule} image rule`,
    ...report.steps.map((d) => `- ${d.section}: ${d.from} -> ${d.to}`),
    ...report.withheld.map((id) => `- ${id}: a binary part was withheld`),
  ]
  return `${lines.join('\n')}\n\n`
}
