import { estimateTokens } from './tokens.js'

/**
 * How a prompt is put together, as data rather than as a hardcoded string.
 *
 * A block declares what it is and how often it changes; the template declares
 * the order. Reordering the prompt is then editing a list — in code, or in an
 * agent file — rather than rewriting a render method, and every agent can have
 * a different shape without a second render method existing.
 */

/**
 * How often a block's bytes change. This is the whole basis of the ordering.
 *
 * Prompt caching is PREFIX matching: a provider reuses its work on the longest
 * run of leading tokens two requests share, and the first byte that differs ends
 * the reuse for everything after it. So what matters about a block is not what
 * it says but how stable it is.
 */
export const Volatility = Object.freeze({
  /** Identical on every call for this agent — the cacheable material. */
  STATIC: 'static',
  /** Only ever grows, at its end. Shares a prefix with its previous self. */
  APPEND: 'append',
  /** Differs every call. Anything after it is never reused. */
  VOLATILE: 'volatile',
})

const RANK = { [Volatility.STATIC]: 0, [Volatility.APPEND]: 1, [Volatility.VOLATILE]: 2 }

/** One labelled section of a prompt. */
export class PromptBlock {
  constructor({ id, heading = '', body = '', volatility = Volatility.STATIC, tail = false }) {
    this.id = id
    this.heading = heading
    this.body = body
    this.volatility = volatility
    // Declared to belong at the end. A static block placed after volatile
    // material is normally a mistake — it gives up cacheable tokens for
    // nothing — but the reminder and the cue are there deliberately, because
    // the end of a prompt is the position a model reads most reliably. This
    // flag is what lets the audit tell the two apart.
    this.tail = tail
  }

  get isEmpty() {
    return !String(this.body).trim()
  }

  render() {
    const body = String(this.body).trim()
    if (!body) return ''
    // One `#`. The prompt is a markdown document and these are its sections —
    // there is no level above them to be a heading of, and an agent file's own
    // headings are written at this level too, so a deeper level here would put
    // the frame below the thing it frames.
    return this.heading ? `# ${this.heading}\n\n${body}` : body
  }
}

/**
 * The default order, and why each block sits where it does.
 *
 * Two findings decide this, and they pull in opposite directions:
 *
 *   1. Caching is prefix-based, so stable material must come first, in a fixed
 *      order, with nothing volatile in front of it.
 *   2. Models attend most reliably to the START and the END of a prompt and
 *      least reliably to the middle — the "lost in the middle" effect. Rules
 *      buried mid-prompt lose compliance badly.
 *
 * Naively obeying (1) puts every instruction at the top and the model's actual
 * task at the bottom of a wall of text. Naively obeying (2) puts the response
 * rules last, where they are re-read from scratch on every single call.
 *
 * The resolution is that (2) does not require the WHOLE rule at the end — only a
 * reminder of it. So the full contract goes in the cached prefix where it is
 * free, and a single line restating it sits after the conversation where it is
 * read. The expensive part is cached; the salient part is last.
 *
 *   identity      static    who this is
 *   instructions  static    what it does
 *   tools         static    what it can do — part of what it is, so it is here
 *   contract      static    the full response spec, in full, once
 *   ── cache breakpoint: everything above is identical next call ──
 *   conversation  append    grows only at its end, so it extends the prefix
 *   scratchpad    append    this turn's actions and what they returned
 *   context       volatile  carries a clock; nothing after it can be reused
 *   budget        volatile  what the run has spent and what it may still spend
 *   reminder      static    one line restating the contract, for recency
 *   cue           static    hands the turn over
 *
 * `context` sits after `conversation` and not before it because it is the one
 * block that differs every call: ahead of the transcript it would push the whole
 * transcript out of the shared prefix, and that loss grows as the conversation
 * grows. Behind it, it costs its own length and nothing else.
 *
 * `budget` is last of the volatile blocks, next to the tail, because the one
 * sentence in it that changes a run's course — the last-turn hand-over — is
 * only useful if it is read. It is free to sit there: `context` has already
 * ended the reusable prefix, so nothing is given up by putting it after.
 *
 * This list is also the vocabulary an agent file's `prompt:` is checked
 * against, so a block missing from it is not merely mis-ordered — it is dropped
 * from every prompt, silently, and refused if a file asks for it by name. That
 * is what happened to `budget` for the length of one review: the block existed,
 * rendered correctly, and reached the model as zero bytes.
 */
export const DEFAULT_ORDER = Object.freeze([
  'identity',
  'instructions',
  'tools',
  'contract',
  'conversation',
  'scratchpad',
  'context',
  'budget',
  'reminder',
  'cue',
])

export class PromptTemplate {
  /**
   * @param {string[]} order block ids, in the order they are rendered
   */
  constructor(order = DEFAULT_ORDER) {
    this.order = [...order]
  }

  /**
   * Build a template from an agent file's `prompt:` list.
   *
   * An unknown id is dropped with a note rather than refused — a typo in one
   * agent file should cost that line, not the agent. A known id the list leaves
   * out is genuinely left out: an override that could not remove a block would
   * not be an override.
   */
  static of(order, { known = DEFAULT_ORDER, source = '<agent>' } = {}) {
    if (!Array.isArray(order) || !order.length) {
      return { template: new PromptTemplate(), notes: [] }
    }
    const notes = []
    const allowed = new Set(known)
    const kept = []
    for (const raw of order) {
      const id = String(raw).trim()
      if (!id) continue
      if (!allowed.has(id)) {
        notes.push(`${source}: prompt block ${JSON.stringify(id)} is not a block; ignored`)
        continue
      }
      if (kept.includes(id)) {
        notes.push(`${source}: prompt block ${JSON.stringify(id)} was listed twice; kept once`)
        continue
      }
      kept.push(id)
    }
    const missing = known.filter((id) => !kept.includes(id))
    if (missing.length) {
      notes.push(`${source}: prompt omits ${missing.join(', ')}`)
    }
    return { template: new PromptTemplate(kept.length ? kept : DEFAULT_ORDER), notes }
  }

  /**
   * Put the blocks in order and account for them.
   *
   * Returns the text AND the structure that produced it. The structure is what
   * makes this arrangement inspectable instead of merely asserted — where the
   * cacheable prefix ends, what each block costs, which block is responsible
   * for the boundary being where it is.
   *
   * @param {PromptBlock[]} blocks
   * @returns {{text: string, parts: object[], cacheable: number, total: number,
   *   boundary: number, brokenBy: string}}
   */
  assemble(blocks) {
    const byId = new Map(blocks.map((block) => [block.id, block]))
    const rendered = []
    for (const id of this.order) {
      const block = byId.get(id)
      if (!block || block.isEmpty) continue
      const text = block.render()
      if (text) rendered.push({ block, text })
    }

    const parts = []
    // The cacheable prefix ends at the first block that is not identical next
    // call. An APPEND block ends it too: a provider reuses the shared leading
    // run, but an explicit breakpoint may only be set where the bytes are known
    // to repeat exactly, and a growing transcript is not that.
    let boundary = -1
    let broken = false
    let brokenBy = ''
    let offset = 0
    let cacheable = 0

    for (const [index, { block, text }] of rendered.entries()) {
      const chunk = index === 0 ? text : `\n\n${text}`
      const tokens = estimateTokens(chunk)
      const stable = block.volatility === Volatility.STATIC
      if (!broken && stable) {
        boundary = index
        cacheable += tokens
      } else if (!broken) {
        broken = true
        brokenBy = block.id
      }
      parts.push({
        id: block.id,
        heading: block.heading,
        volatility: block.volatility,
        tail: block.tail,
        tokens,
        start: offset,
        end: offset + chunk.length,
        cached: !broken && stable,
      })
      offset += chunk.length
    }

    const text = rendered.map(({ text: t }) => t).join('\n\n')
    return {
      text,
      parts,
      // The arrangement checking itself. A template is data, so a bad one is a
      // possible state rather than an impossible one, and it should say so
      // rather than quietly costing tokens.
      problems: PromptTemplate.audit(parts),
      // Where a provider that takes an explicit breakpoint should be told to put
      // one: the character offset at the end of the last stable block.
      boundary: boundary >= 0 ? parts[boundary].end : 0,
      cacheable,
      total: parts.reduce((sum, part) => sum + part.tokens, 0),
      brokenBy,
    }
  }

  /**
   * Blocks that are out of stability order — the reason a prefix is short.
   *
   * A block that declares itself part of the tail is not reported: it is there
   * on purpose, and an audit that flags the design is an audit nobody reads.
   * What this catches is the accident — a stable block that drifted below
   * something volatile and is now paid for on every call for no reason.
   */
  static audit(parts) {
    const problems = []
    let worst = -1
    for (const part of parts) {
      const rank = RANK[part.volatility] ?? 0
      if (rank < worst && !part.tail) {
        problems.push(
          `${part.id} is ${part.volatility} but sits after less stable blocks, so its ${part.tokens} tokens are re-read on every call`,
        )
      }
      worst = Math.max(worst, rank)
    }
    return problems
  }
}
