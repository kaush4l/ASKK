/**
 * Structured responses — a class doubles as its own prompt contract.
 *
 *     BaseResponse
 *     ├─ instructions(fmt)  the field table -> instructions for the model
 *     ├─ toString(fmt)      object          -> TOON or JSON text
 *     └─ parse(raw, fmt)    model reply     -> object
 *
 * A subclass declares nothing but its fields:
 *
 *     class SimpleResponse extends BaseResponse {
 *       static FIELDS = { thinking: { description: '...' }, response: { description: '...' } }
 *     }
 *
 * TOON is the default because it is line-oriented, and small local models
 * follow it far more reliably than they produce valid JSON.
 */
export const Format = Object.freeze({ TOON: 'toon', JSON: 'json' })
export const DEFAULT_FORMAT = Format.TOON

export class BaseResponse {
  /** `{ name: { description, list?, default? } }` — declaration order is prompt order. */
  static FIELDS = {}

  /** The field shown to the user. Empty means the last declared field. */
  static ANSWER_FIELD = ''

  constructor(values = {}) {
    for (const [name, spec] of Object.entries(this.constructor.FIELDS)) {
      const fallback = spec.list ? [] : (spec.default ?? '')
      const given = values[name]
      this[name] = given === undefined || given === null ? fallback : given
    }
    this.normalize()
  }

  /** Repair a well-meant but malformed reply. Overridden where a field is an enum. */
  normalize() {}

  static fieldNames() {
    return Object.keys(this.FIELDS)
  }

  static answerField() {
    return this.ANSWER_FIELD || this.fieldNames().at(-1)
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

  /** Extra guidance appended to the instructions. Override per response type. */
  static formatNotes() {
    return ''
  }

  static instructions(fmt = DEFAULT_FORMAT) {
    const names = this.fieldNames()
    const extra = this.formatNotes().trim()
    const notes = extra ? `\n${extra}\n` : ''

    if (fmt === Format.JSON) {
      const example = JSON.stringify(Object.fromEntries(names.map((n) => [n, `<${n}>`])), null, 2)
      return [
        '# RESPONSE FORMAT',
        '',
        'Reply with a single JSON object containing exactly these keys:',
        '',
        this._fieldDocs(),
        '',
        'Output only the JSON object — no markdown fences, no text around it.',
        `Example:\n${example}`,
        notes,
      ].join('\n')
    }

    const example = names
      .map((n) =>
        this.FIELDS[n].list
          ? `${n}: [<your first ${n}>, <your second ${n}>]`
          : `${n}: <your ${n} here>`,
      )
      .join('\n\n')

    return [
      '# RESPONSE FORMAT',
      '',
      `Reply with exactly these fields, in this order: ${names.join(', ')}.`,
      '',
      this._fieldDocs(),
      '',
      'Rules:',
      '1. Start each field on its own line as `field_name: value`, lowercase name.',
      '2. Separate fields with a blank line.',
      '3. A multi-line value just continues on the next lines — do not repeat the field name.',
      '4. List fields use bracket notation: `field: [item one, item two]`. Use `[]` when there are none.',
      '5. No markdown decoration on field names: no `**`, no `-`, no numbering.',
      '6. Use no field names other than the ones listed above.',
      '',
      `Example:\n${example}`,
      notes,
    ].join('\n')
  }

  /**
   * The contract in one line, for the end of the prompt.
   *
   * Models attend to the start and the end of a prompt and lose the middle, so
   * a contract stated only in the cached header is a contract read across a
   * conversation's worth of text. This is what goes last instead — small enough
   * that re-reading it every call costs nothing, specific enough to be the
   * thing the model actually copies.
   *
   * It names the fields and says nothing else. Restating the rules here would
   * be a second copy of them, and two copies of a rule is how they drift.
   */
  static reminder(fmt = DEFAULT_FORMAT) {
    const names = this.fieldNames()
    if (!names.length) return ''
    return fmt === Format.JSON
      ? `Reply with one JSON object, keys: ${names.join(', ')}. No other text.`
      : `Reply with these fields, in this order, one per line: ${names.join(', ')}.`
  }

  // ── object -> string ───────────────────────────────────────────────────

  toString(fmt = DEFAULT_FORMAT) {
    if (fmt === Format.JSON) return JSON.stringify(this.toJSON(), null, 2)
    return this.constructor
      .fieldNames()
      .map((name) => {
        const value = this[name]
        return `${name}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value}`
      })
      .join('\n\n')
  }

  toJSON() {
    return Object.fromEntries(this.constructor.fieldNames().map((n) => [n, this[n]]))
  }

  // ── string -> object ───────────────────────────────────────────────────

  /**
   * Parse a model reply. Tries the requested format, then the other, then keeps
   * the whole reply as the answer — a badly formatted turn still yields a
   * usable object rather than losing what the model said.
   */
  static parse(raw, fmt = DEFAULT_FORMAT) {
    const text = typeof raw === 'string' ? raw : String(raw)
    const order = fmt === Format.JSON ? ['_parseJson', '_parseToon'] : ['_parseToon', '_parseJson']

    for (const parser of order) {
      try {
        const data = this[parser](text)
        if (data && Object.keys(data).length > 0) return new this(data)
      } catch {
        // Try the other format before giving up on the reply.
      }
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

  /** Two passes: find the field lines, then take everything up to the next one. */
  static _parseToon(text) {
    const known = new Set(this.fieldNames())
    const lines = text.split('\n')
    const starts = []

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim()
      const at = line.indexOf(':')
      if (at < 0) continue
      const rawKey = line.slice(0, at)
      const cleaned = rawKey
        .replace(/^[\s\-*#\d.]+/, '')
        .replace(/[*`\s]+$/, '')
        .trim()
        .toLowerCase()
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
      data[name] = this.FIELDS[name].list ? this._asList(value) : value
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
