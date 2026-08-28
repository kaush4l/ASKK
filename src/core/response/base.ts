/**
 * Structured responses — a model doubles as its own prompt contract.
 *
 *     BaseResponse
 *     ├─ instructions(fmt)   the field table -> instructions for the model
 *     ├─ toString(fmt)       the object      -> TOON or JSON text
 *     └─ parse(raw, fmt)     the model reply -> the object
 *
 * **The field table IS the contract.** One declaration produces the prompt
 * instructions, the parse target and the routing input, and they cannot drift
 * because all three read the same array. `FIELDS` order is prompt order.
 *
 * Two formats: TOON (default — line oriented, what small local models follow
 * most reliably) and JSON. `parse` **never throws**: the requested format, then
 * the other, then the whole reply lands in the answer field, so a badly
 * formatted reply still yields a usable object. `normalize` fails toward the
 * *careful* branch — an unknown enum resolves to `complex`, `fail`, `revise`,
 * never the permissive one.
 *
 * Pydantic handed the Python its field order, descriptions, list-ness and
 * validators by reflection. TypeScript has none of that at runtime, so a
 * subclass writes the table out and everything here walks it.
 *
 * Every `description` and every line of the instructions below is the Python's
 * bytes, unedited. They are what the model reads.
 */

import { parseJson, parseToon } from '@/core/response/parse'

export const TOON = 'toon'
/** `JSON` is the global here, so the format constant cannot carry its Python name. */
export const JSON_FORMAT = 'json'
export const DEFAULT_FORMAT = TOON

export type Format = typeof TOON | typeof JSON_FORMAT

export interface FieldSpec {
  name: string
  description: string
  list?: boolean
  default?: string
}

export type FieldValue = string | string[]
export type Values = Record<string, FieldValue>

/**
 * A response class, seen as something that can be constructed and walked.
 *
 * The statics are named rather than taken as `typeof BaseResponse`, which is
 * abstract and so cannot be constructed: a concrete subclass is what a caller
 * ever holds, and this says so.
 */
export type ResponseClass<T extends BaseResponse> = (new (data?: Record<string, unknown>) => T) & {
  FIELDS: readonly FieldSpec[]
  ANSWER_FIELD: string
  answerField(): string
}

/**
 * Pydantic does not coerce a string into `list[str]`, and that refusal is
 * load-bearing: it is why an unparseable reply to a list-answer response ends
 * up empty rather than holding one long item.
 */
function accept(field: FieldSpec, value: unknown): FieldValue {
  if (field.list === true) {
    const ok = Array.isArray(value) && value.every((item) => typeof item === 'string')
    if (!ok) throw new TypeError(`${field.name} is a list of strings`)
    return (value as string[]).slice()
  }
  if (typeof value !== 'string') throw new TypeError(`${field.name} is a string`)
  return value
}

/** Escapes Python's `repr` writes as two characters. */
const ESCAPES: Record<string, string> = { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' }

/**
 * Python's `repr()` of a string: single quotes, **unless** the string holds a
 * single quote and no double quote — then double quotes, so a critique finding
 * with an apostrophe in it comes out as `"it's broken"` and not the malformed
 * `'it's broken'` a fixed quote character would produce.
 *
 * Here rather than in a `py-str` module because this is the only thing left
 * that needs it: a list answer field is rendered with Python's `str()`, and the
 * result is text a planner reads back.
 */
function repr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'"
  let out = quote
  for (const ch of text) {
    const escape = ESCAPES[ch]
    if (ch === quote) out += `\\${ch}`
    else if (escape !== undefined) out += escape
    else if (ch < ' ' || ch === '\x7f') out += `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`
    else out += ch
  }
  return out + quote
}

/** Python's `str()` for the two shapes a field value can have. */
function pyStr(value: FieldValue): string {
  return typeof value === 'string' ? value : `[${value.map(repr).join(', ')}]`
}

/** Base structured response. Subclasses declare fields; everything else is inherited. */
export abstract class BaseResponse {
  static FIELDS: readonly FieldSpec[] = []

  /** The one field the user sees. Empty = the last declared field. */
  static ANSWER_FIELD = ''

  readonly #values: Values

  constructor(data: Record<string, unknown> = {}) {
    const cls = this.constructor as typeof BaseResponse
    const values: Values = {}
    for (const field of cls.FIELDS) {
      const given = data[field.name]
      values[field.name] =
        given === undefined ? (field.default ?? (field.list === true ? [] : '')) : accept(field, given)
    }
    cls.normalize(values)
    this.#values = values
    Object.freeze(values)
    Object.freeze(this)
  }

  /**
   * The `model_validator(mode="after")` by another name: it may rewrite the
   * values, and it runs before they freeze.
   */
  static normalize(_values: Values): void {}

  static answerField(): string {
    return this.ANSWER_FIELD || (this.FIELDS[this.FIELDS.length - 1]?.name ?? '')
  }

  value(name: string): FieldValue {
    return this.#values[name] ?? ''
  }

  /** The one field meant for the user. */
  get answer(): string {
    const cls = this.constructor as typeof BaseResponse
    return pyStr(this.value(cls.answerField()))
  }

  /**
   * Python's `getattr(parsed, "is_answer", True)`, as a property rather than a
   * free function: a reply with no opinion about it is an answer by definition,
   * and only a class that says otherwise keeps a loop going.
   */
  get isAnswer(): boolean {
    return true
  }

  // ── the table -> instructions ──────────────────────────────────────────

  static fieldDocs(): string {
    return this.FIELDS.map((f) => `- ${f.name}${f.list === true ? ' (list)' : ''}: ${f.description || ''}`).join('\n')
  }

  /** Extra format guidance appended to the instructions. Override per response type. */
  static formatNotes(): string {
    return ''
  }

  /** Render the field set as response-format instructions for the model. */
  static instructions(fmt: Format = DEFAULT_FORMAT): string {
    const trimmed = this.formatNotes().trim()
    const notes = trimmed ? `\n${trimmed}\n` : ''
    return (fmt === JSON_FORMAT ? this.jsonInstructions() : this.toonInstructions()) + notes
  }

  static jsonInstructions(): string {
    const example: Record<string, string> = {}
    for (const field of this.FIELDS) example[field.name] = `<${field.name}>`
    return (
      '## RESPONSE FORMAT\n\n' +
      'Reply with a single JSON object containing exactly these keys:\n\n' +
      `${this.fieldDocs()}\n\n` +
      'Output only the JSON object — no markdown fences, no text around it.\n' +
      `Example:\n${JSON.stringify(example, null, 2)}\n`
    )
  }

  static toonInstructions(): string {
    const example = this.FIELDS.map((f) =>
      f.list === true
        ? `${f.name}: [<your first ${f.name}>, <your second ${f.name}>]`
        : `${f.name}: <your ${f.name} here>`,
    ).join('\n\n')
    return (
      '## RESPONSE FORMAT\n\n' +
      `Reply with exactly these fields, in this order: ${this.FIELDS.map((f) => f.name).join(', ')}.\n\n` +
      `${this.fieldDocs()}\n\n` +
      'Rules:\n' +
      '1. Start each field on its own line as `field_name: value`, lowercase name.\n' +
      '2. Separate fields with a blank line.\n' +
      '3. A multi-line value just continues on the next lines — do not repeat the field name.\n' +
      '4. List fields use bracket notation: `field: [item one, item two]`. ' +
      'Add as many items as the work needs, and use `[]` when there are none.\n' +
      '5. No markdown decoration on field names: no `**`, no `-`, no numbering.\n' +
      '6. Use no field names other than the ones listed above.\n\n' +
      `Example:\n${example}\n`
    )
  }

  // ── the object -> a string ─────────────────────────────────────────────

  toString(fmt: Format = DEFAULT_FORMAT): string {
    const cls = this.constructor as typeof BaseResponse
    if (fmt === JSON_FORMAT) {
      const plain: Values = {}
      for (const field of cls.FIELDS) plain[field.name] = this.value(field.name)
      return JSON.stringify(plain, null, 2)
    }
    return cls.FIELDS.map((field) => {
      const value = this.value(field.name)
      return `${field.name}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value}`
    }).join('\n\n')
  }

  // ── a string -> the object ─────────────────────────────────────────────

  /**
   * Parse a model reply. Tries `fmt`, then the other format, then falls back.
   * It cannot throw: every exit builds an instance.
   */
  static parse<T extends BaseResponse>(this: ResponseClass<T>, raw: string, fmt: Format = DEFAULT_FORMAT): T {
    const text = typeof raw === 'string' ? raw : String(raw)
    const order = fmt === JSON_FORMAT ? [parseJson, parseToon] : [parseToon, parseJson]
    for (const parser of order) {
      try {
        const data = parser(this.FIELDS, text)
        if (Object.keys(data).length > 0) return new this(data)
      } catch {
        continue
      }
    }
    // Unparseable — treat the whole reply as the answer rather than losing it.
    try {
      return new this({ [this.answerField()]: text.trim() })
    } catch {
      return new this()
    }
  }

  /**
   * A reply of this class carrying nothing but an answer.
   *
   * The repeat guard's give-up is built from it, so an agent gives up in the
   * same response class it was answering in and the transcript stays one shape.
   *
   * A list answer field takes the text as its single item, because `accept`
   * refuses a bare string for a list — and a give-up that raised on
   * `CritiqueResponse` would defeat the whole point of synthesising one.
   */
  static answerOf<T extends BaseResponse>(this: ResponseClass<T>, text: string): T {
    const name = this.answerField()
    const field = this.FIELDS.find((f) => f.name === name)
    return new this({ [name]: field?.list === true ? [text] : text })
  }
}
