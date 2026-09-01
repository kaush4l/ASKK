/**
 * Structured responses — a class doubles as its own prompt contract.
 *
 *     BaseResponse
 *     ├─ instructions()  the field table -> instructions for the model
 *     └─ parse(raw)      model reply     -> object
 *
 * A subclass declares nothing but its fields:
 *
 *     class SimpleResponse extends BaseResponse {
 *       static FIELDS = { thinking: { description: '...' }, response: { description: '...' } }
 *     }
 *
 * TOON is the one form the contract is written in, because it is line-oriented
 * and small local models follow it far more reliably than they produce valid
 * JSON. There was a `Format` enum here with a second, JSON arm; no run ever
 * chose it, so it went — see `parse`, which still reads a JSON reply, as a
 * repair rather than as a permitted form.
 */

export class BaseResponse {
  /** `{ name: { description, list?, default? } }` — declaration order is prompt order. */
  static FIELDS = {}

  constructor(values = {}) {
    for (const [name, spec] of Object.entries(this.constructor.FIELDS)) {
      const fallback = spec.list ? [] : (spec.default ?? '')
      const given = values[name]
      this[name] = given === undefined || given === null ? fallback : given
    }
    this.normalize(values)
  }

  /**
   * Repair a well-meant but malformed reply. Overridden where a field is an enum.
   *
   * Takes the values the parse supplied, because by the time the loop above has
   * run, a field the model wrote and a field this constructor filled in are the
   * same thing — and the difference between them decides whether a run ends. A
   * reply that stopped before it reached a field is not a reply that reached the
   * field and wrote its default. `ReActResponse` is where that costs something.
   */
  normalize(_given = {}) {}

  static fieldNames() {
    return Object.keys(this.FIELDS)
  }

  /** The field shown to the user: the last one declared. */
  static answerField() {
    return this.fieldNames().at(-1)
  }

  /** The one field meant for the user. */
  get answer() {
    return String(this[this.constructor.answerField()] ?? '')
  }

  // ── the field table -> instructions ────────────────────────────────────

  static _fieldDocs() {
    return Object.entries(this.FIELDS)
      .map(([name, spec]) => `- ${name}${spec.list ? ' (list)' : ''}: ${spec.description ?? ''}`)
      .join('\n')
  }

  /**
   * A field's example value: a real one where the field is an enum, a
   * placeholder otherwise.
   */
  static _exampleValue(name) {
    const spec = this.FIELDS[name]
    if (spec.example) return spec.example
    if (!spec.list) return `<your ${name} here>`
    return `[<your first ${name}>, <your second ${name}>]`
  }

  /**
   * The contract, and what it is allowed to cost.
   *
   * This block used to be 463 of 1,092 prompt tokens — 42% of everything we
   * send, more than the system text and the whole tool table combined. It is now
   * a field table and one example: 243 tokens in the assembled prompt, 220
   * fewer per call.
   *
   * What that bought, measured on the artifact that shipped rather than on a
   * proposal: 192 calls to Qwen3.8-27B, three independent runs at different
   * seeds, 96 per arm, the two arms differing in nothing but this block.
   * Pooled strict-clean is 83/96 = 86% for the old contract and 83/96 = 86% for
   * this one — a dead heat, Fisher exact two-sided p = 1.00. The three runs
   * disagree on the sign (cut +3, −7, +3 points), which is what a difference of
   * zero looks like sampled 32 at a time.
   *
   * So the claim that survives is the NEGATIVE one: at this sample size there is
   * no detectable difference in either direction across a 1.9x range of contract
   * length. Nobody may cite this as "the shorter contract complies better" — one
   * run saying so is noise, and an earlier report of this slice that said it was
   * reading a single run. What justifies the cut is that 220 tokens per call
   * bought no measurable compliance, plus the five per-rule zeros below.
   *
   * The one asymmetry worth writing down, because it is the shape a real
   * regression would take: usable-after-parse is 96/96 for the old contract and
   * 94/96 for this one (p = 0.50). Both failures are the same task in different
   * runs — the model wrote an unbounded reasoning preamble, hit the 1,500-token
   * cap and never emitted a field at all. Two in ninety-six is not evidence, and
   * a third run put it at 0. If it recurs, this is where the tokens go back.
   *
   * (`docs/PROMPT-AUDIT.md` ran an earlier 48-call experiment whose 131-token
   * `minimal` arm scored 94% against the full contract's 88%. Neither arm is
   * what shipped — this block is 243 tokens, between the two — so those numbers
   * are the history of the decision, not evidence about the code you are
   * reading. The numbers above are.)
   *
   * What went, and why — each one a rule `_parseToon` below already repairs,
   * whose violation rate was 0 across every arm ever run *including the arms
   * that never stated it*:
   *
   *   - lowercase field names        the key is lowercased before it is matched
   *   - blank line between fields    blank lines are never read at all
   *   - no markdown on field names   the key is stripped of `-*#0-9.`
   *   - no fields but these          an unknown key is skipped
   *   - do not repeat a field name   repeated names now concatenate
   *
   * Each of those five is now held up by the repair alone, so the repair is the
   * rule. `test/core/response/BaseResponse.test.js` pins all five against a
   * mutation of the exact line that does the repairing, because two of them
   * were found to survive deletion with the whole suite still green — a rule
   * that had quietly stopped existing in both places at once.
   *
   * One rule did NOT go, and the difference is the whole finding. Bracket
   * notation for list fields is load-bearing: the arm that deleted it produced
   * four bulleted `think:` blocks in sixteen replies. It is not deleted, it is
   * *folded into the list field descriptions* at about six tokens, which is
   * where the arm that scored best states it.
   *
   * ── The tension this trades against, stated because it is real ────────────
   *
   * Cutting here shortens the reusable prefix, and Anthropic's prompt cache has
   * a model-dependent minimum below which a prefix silently does not cache:
   * 512 tokens on the Opus 5 family, 1,024 on Sonnet 5 / Opus 4.8 / Sonnet 4.6,
   * 2,048 on Opus 4.7, 4,096 on Opus 4.6 / Haiku 4.5. Our prefix was 922 tokens
   * before the audit and is 649 today — `bun scripts/dryrun.js`, the `reusable
   * prefix` line — so on the 1,024-minimum models it did not cache before this
   * change either — the cut moves it further from a line it was already the
   * wrong side of, and takes it nowhere near the 512 line it clears.
   *
   * The command, not just the figure, because pinning the figure is how it went
   * wrong twice — it read 922, then 702, while the prefix was 685 and then 649,
   * and nothing in the suite could notice.
   *
   * We cut anyway, on this reasoning: padding a prompt with tokens that buy no
   * compliance, in order to reach a cache minimum, means paying full price on
   * every call to every non-Anthropic endpoint for a discount on some Anthropic
   * ones. On the only endpoint anyone here has measured, `cached_tokens` was 0
   * on every call — short, long, streamed, on identical prefixes sent back to
   * back, and on all 192 calls of the re-measurement above — and that endpoint
   * does not return `cache_creation_input_tokens` at all. There is nothing to
   * lose there.
   *
   * That reasoning is an argument, not a measurement, and the measurement is one
   * field away. `Inference._usage` already collects
   * `cache_creation_input_tokens` and nothing reads it — the field the Anthropic
   * docs name as the signal for "your prefix was too short" is collected and
   * discarded. Before anyone lengthens this block to chase a cache: read that
   * field on two identical requests to a real Anthropic endpoint, thirty seconds
   * apart, and find out. If the prefix must grow, grow it with the context block
   * (`Environment.js`), which the audit measured as empty and which would carry
   * facts that change answers — not with rules the model already follows.
   */
  static instructions() {
    const names = this.fieldNames()
    const example = names.map((n) => `${n}: ${this._exampleValue(n)}`).join('\n\n')

    return [
      '# RESPONSE FORMAT',
      '',
      'Reply with exactly these fields, in this order, one per line as `name: value`, blank line between:',
      '',
      this._fieldDocs(),
      '',
      `Example:\n${example}`,
    ].join('\n')
  }

  /**
   * The contract in one line, for the end of the prompt.
   *
   * Why anything is repeated at the end at all is `PromptTemplate`'s decision,
   * argued where `tail` is defined and audited in `docs/PROMPT-AUDIT.md`. This
   * file only decides what that last line says.
   *
   * It names the fields and says nothing else. Restating the rules here would
   * be a second copy of them, and two copies of a rule is how they drift.
   */
  static reminder() {
    const names = this.fieldNames()
    if (!names.length) return ''
    return `Reply with these fields, in this order, one per line: ${names.join(', ')}.`
  }

  // ── object -> string ───────────────────────────────────────────────────

  /**
   * The form a response crosses a realm in, and the only one.
   *
   * A `toString()` rendering the object back into TOON stood here with no
   * producer anywhere, read only by a round-trip test that fed it to `parse` —
   * which reads JSON too, so the test could not have told TOON from anything.
   * If the debug view wants it, it gets written with its caller.
   */
  toJSON() {
    return Object.fromEntries(this.constructor.fieldNames().map((n) => [n, this[n]]))
  }

  // ── string -> object ───────────────────────────────────────────────────

  /**
   * Parse a model reply. Tries TOON, then JSON, then keeps the whole reply as
   * the answer — a badly formatted turn still yields a usable object rather
   * than losing what the model said.
   *
   * Three repairs here have no matching rule in the prompt, deliberately, and
   * all three were found by auditing the parser against the contract rather than
   * the other way round:
   *
   * The JSON retry is a REPAIR, not a permitted format. The contract
   * asks for TOON and says nothing about JSON, and it stays that way. The
   * reasoning — and this is REASONING, not a measurement, labelled so nobody
   * quotes it as evidence — is that telling the model both work would invite the
   * fenced ```json reply, which is the most common single violation left
   * (6/64 and 8/64 in the two arms of the re-measurement). Every arm ever run
   * withheld the permission, so no arm tests the counterfactual; a fourth arm
   * that grants it is what would settle whether withholding is why the rate is
   * that low. Until then the stricter rule is stated and the looser one is
   * honoured in silence.
   *
   * The list coercion in `_parseJson` is the second: a model writing a list
   * field as one string gets it split rather than dropped. It is silent for the
   * same reason — a rule spent on it would cost tokens on every call to describe
   * something already handled.
   *
   * The last-resort branch — the whole reply becomes the answer field — has no
   * rule either, and should not get one. It exists so `parse` cannot fail, and a
   * rule saying "if you emit no fields your prose is shown to the user verbatim"
   * would spend tokens describing a fallback rather than preventing it.
   *
   * It also still ANSWERS, and that is now a decision rather than the absence of
   * one. A reply carrying none of the contract's fields is not a contract that
   * stopped half-written; it is a model that ignored the contract and spoke, and
   * its words are the whole of what it said. A reply that carried some fields
   * and stopped is the opposite event, and used to be indistinguishable from
   * this one. `ReActResponse.normalize` tells them apart from the values this
   * method hands it — which is the only reason `normalize` takes them.
   */
  static parse(raw) {
    const text = typeof raw === 'string' ? raw : String(raw)

    // Written out, rather than looped over `['_parseToon', '_parseJson']` as it
    // was while a `Format` enum picked one. With the order fixed, the strings
    // bought nothing and cost the only static checking a tree with no transpile
    // step has — and a name that resolved to nothing threw INSIDE the try and
    // was read as "that parser found nothing". Measured: with `_parseToon`
    // renamed at its definition only, a TOON reply came back with `think` and
    // `plan` empty and the whole reply in `result`, nothing raised anywhere.
    // So the try now wraps the one expression that is allowed to throw.
    const toon = this._parseToon(text)
    if (Object.keys(toon).length > 0) return new this(toon)

    try {
      const json = this._parseJson(text)
      if (Object.keys(json).length > 0) return new this(json)
    } catch {
      // A brace run that is not valid JSON. The last resort below keeps the
      // reply; nothing else in this method may be read as "found nothing".
    }

    return new this({ [this.answerField()]: text.trim() })
  }

  static _parseJson(text) {
    let depth = 0
    let start = -1
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) start = i
        depth++
      } else if (text[i] === '}') {
        depth--
        if (depth === 0 && start >= 0) {
          const data = JSON.parse(text.slice(start, i + 1))
          const known = this.fieldNames()
          if (!known.some((n) => n in data)) return {}
          for (const name of known) {
            // A model often writes a list field as one string — coerce it.
            if (this.FIELDS[name].list && typeof data[name] === 'string') {
              data[name] = this._asList(data[name])
            }
          }
          return data
        }
      }
    }
    return {}
  }

  /** A field line's key, stripped of the decoration models put on it. */
  static _fieldKey(rawKey) {
    return rawKey
      .replace(/^[\s\-*#\d.]+/, '')
      .replace(/[*`\s]+$/, '')
      .trim()
      .toLowerCase()
  }

  /**
   * Break `think: [...], act: tool, result: shell(...)` back into lines.
   *
   * Found by measurement, not by reading: re-running the contract experiment
   * after this slice's cut, one reply in 32 wrote the whole turn on a single
   * line. The two-pass read below is line-oriented, so every field after the
   * first vanished into the first one's value — the reply parsed, produced no
   * `act` and no `result`, and was the only unusable reply of the 64.
   *
   * It is not a rule that went missing. The contract still says "one per line as
   * `name: value`, blank line between", and this arm's predecessor said it too;
   * the model simply did not do it. So it is repaired here, where a repair costs
   * nothing per call, rather than restated in the prompt where it would cost
   * tokens on every call to prevent one reply in thirty-two.
   *
   * Three guards keep it from eating a legitimate value, because a parser that
   * splits too eagerly loses more than the one it rescues:
   *
   *   - the separator must be a comma or semicolon, so `the plan: is unclear`
   *     inside prose is left alone;
   *   - it must sit at bracket depth zero, so a list item or a JSON argument
   *     containing a field name is not cut in half;
   *   - the name must come LATER in declaration order than the field being read,
   *     so the split can only ever run forwards. The last field can never be
   *     split at all, which is the one most likely to be free prose.
   */
  static _splitInlineFields(text) {
    const rank = new Map(this.fieldNames().map((name, index) => [name, index]))
    const out = []

    for (const line of text.split('\n')) {
      const at = line.indexOf(':')
      const head = at < 0 ? '' : this._fieldKey(line.slice(0, at))
      if (!rank.has(head)) {
        out.push(line)
        continue
      }
      let depth = 0
      let seen = rank.get(head)
      let start = 0
      for (let i = at + 1; i < line.length; i++) {
        const char = line[i]
        if ('([{'.includes(char)) depth++
        else if (')]}'.includes(char)) depth--
        else if (depth === 0 && (char === ',' || char === ';')) {
          const name = /^[,;]\s*([a-zA-Z_]+)\s*:/.exec(line.slice(i))?.[1].toLowerCase()
          if (name && rank.get(name) > seen) {
            out.push(line.slice(start, i))
            start = i + 1
            seen = rank.get(name)
          }
        }
      }
      out.push(line.slice(start))
    }
    return out.join('\n')
  }

  /** Two passes: find the field lines, then take everything up to the next one. */
  static _parseToon(text) {
    const known = new Set(this.fieldNames())
    const lines = this._splitInlineFields(text).split('\n')
    const starts = []

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim()
      const at = line.indexOf(':')
      if (at < 0) continue
      const rawKey = line.slice(0, at)
      const cleaned = this._fieldKey(rawKey)
      if (!known.has(cleaned)) continue
      let value = line.slice(at + 1).trim()
      // `**thinking:** text` leaves the closing marker on the value — drop it,
      // but only when the key itself was decorated, so a real `*` survives.
      if (/[*`]/.test(rawKey)) value = value.replace(/^[*`\s]+/, '')
      starts.push({ index, name: cleaned, first: value })
    }

    const data = {}
    for (let i = 0; i < starts.length; i++) {
      const { index, name, first } = starts[i]
      const end = i + 1 < starts.length ? starts[i + 1].index : lines.length
      const block = (first ? [first] : []).concat(lines.slice(index + 1, end))
      const value = block.join('\n').trim()
      const parsed = this.FIELDS[name].list ? this._asList(value) : value
      if (!(name in data)) {
        data[name] = parsed
        continue
      }
      // A repeated field name used to overwrite, so the earlier value vanished
      // with nothing raised anywhere — the one contract rule the parser did not
      // repair, and the only one whose failure mode was silent data loss. It
      // concatenates now, which costs nothing and cannot lose what the model
      // said; that is what let the rule come out of the prompt.
      data[name] = this.FIELDS[name].list
        ? data[name].concat(parsed)
        : [data[name], parsed].filter(Boolean).join('\n')
    }
    return data
  }

  /** Split `a, b(c, d), e` on top-level commas only. */
  static _splitItems(inner) {
    const items = []
    let current = ''
    let depth = 0
    for (const char of inner) {
      if ('([{'.includes(char)) depth++
      else if (')]}'.includes(char)) depth--
      if (char === ',' && depth === 0) {
        items.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim()) items.push(current.trim())
    return items.filter(Boolean)
  }

  /** Coerce a value to a list: `[a, b]`, or one item per line. */
  static _asList(value) {
    const text = String(value ?? '').trim()
    if (text.startsWith('[') && text.endsWith(']'))
      return this._splitItems(text.slice(1, -1).trim())
    if (!text) return []
    return text
      .split('\n')
      .map((line) => line.replace(/^\s*(\d+[.)]|[-*])\s*/, '').trim())
      .filter(Boolean)
  }
}
