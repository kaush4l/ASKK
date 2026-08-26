/**
 * Structured responses — a model doubles as its own prompt contract.
 *
 *     BaseResponse
 *     ├─ instructions(fmt)   model fields  -> instructions for the agent
 *     ├─ toString(fmt)       object        -> TOON or JSON text
 *     └─ parse(raw, fmt)     agent reply   -> object
 *
 * Two formats: TOON (default — line-oriented, what small local models follow
 * most reliably) and JSON (fallback). `parse` tries the requested format first,
 * then the other, then drops the whole reply into the answer field, so a badly
 * formatted reply still yields a usable object.
 *
 * Pydantic handed the Python its field order, its descriptions, its list-ness
 * and its validators by reflection. JavaScript has none of that, so a subclass
 * writes the table out (PORT-MAP R1) and everything here walks it:
 *
 *     static FIELDS = [{ name, description, list, default }]   // ORDER MATTERS
 *
 * The seven concrete responses live in `core/responses.js` and the scanners in
 * `core/response-parse.js`; the split is the 200-line rule, which does not bend
 * for a file that happens to be a faithful port.
 */

import { pyStr } from "./py-str.js";
import { parseJson, parseToon } from "./response-parse.js";

export const TOON = "toon";
/** `JSON` is the global here, so the format constant cannot carry its Python name. */
export const JSON_FORMAT = "json";
export const DEFAULT_FORMAT = TOON;

/**
 * @typedef {string | string[]} FieldValue
 * @typedef {{ name: string, description: string, list?: boolean, default?: string }} FieldSpec
 * @typedef {Record<string, FieldValue>} Values
 */

/** @param {unknown} self @returns {Values} */
const values = (self) => /** @type {Values} */ (self);

/** Pydantic does not coerce a string into `list[str]`, and that refusal is
 * load-bearing: it is why an unparseable reply to a list-answer response ends
 * up empty rather than holding one long item.
 * @param {FieldSpec} field @param {unknown} value @returns {FieldValue} */
function accept(field, value) {
  if (field.list) {
    const ok = Array.isArray(value) && value.every((item) => typeof item === "string");
    if (!ok) throw new TypeError(`${field.name} is a list of strings`);
    return /** @type {string[]} */ (value.slice());
  }
  if (typeof value !== "string") throw new TypeError(`${field.name} is a string`);
  return value;
}

/** Base structured response. Subclasses declare fields; everything else is inherited. */
export class BaseResponse {
  /** @type {ReadonlyArray<FieldSpec>} */
  static FIELDS = [];

  /** Field shown to the user. Empty = the last declared field. */
  static ANSWER_FIELD = "";

  /** @param {Record<string, unknown>} [data] */
  constructor(data = {}) {
    const cls = /** @type {typeof BaseResponse} */ (this.constructor);
    const own = values(this);
    for (const field of cls.FIELDS) {
      const given = data[field.name];
      own[field.name] = given === undefined ? field.default ?? (field.list ? [] : "") : accept(field, given);
    }
    cls.normalize(own);
    Object.freeze(this);
  }

  /** The `model_validator(mode="after")` by another name: it may rewrite the
   * values, and it runs before they freeze. @param {Values} _values @returns {void} */
  static normalize(_values) {}

  /** @returns {string} */
  static answerField() { return this.ANSWER_FIELD || this.FIELDS[this.FIELDS.length - 1].name; }

  /** @param {string} name @returns {FieldValue} */
  value(name) { return values(this)[name] ?? ""; }

  /** The one field meant for the user. @returns {string} */
  get answer() {
    const cls = /** @type {typeof BaseResponse} */ (this.constructor);
    return pyStr(this.value(cls.answerField()));
  }

  // ── model -> instructions ──────────────────────────────────────────────

  /** @returns {string} */
  static fieldDocs() {
    return this.FIELDS.map(
      (f) => `- ${f.name}${f.list ? " (list)" : ""}: ${f.description || ""}`,
    ).join("\n");
  }

  /** Extra format guidance appended to the instructions. Override per response type.
   * @returns {string} */
  static formatNotes() { return ""; }

  /** Render the field set as response-format instructions for the agent.
   * @param {string} [fmt] @returns {string} */
  static instructions(fmt = DEFAULT_FORMAT) {
    const trimmed = this.formatNotes().trim();
    const notes = trimmed ? `\n${trimmed}\n` : "";
    return (fmt === JSON_FORMAT ? this.jsonInstructions() : this.toonInstructions()) + notes;
  }

  /** @returns {string} */
  static jsonInstructions() {
    /** @type {Record<string, string>} */
    const example = {};
    for (const field of this.FIELDS) example[field.name] = `<${field.name}>`;
    return (
      "## RESPONSE FORMAT\n\n" +
      "Reply with a single JSON object containing exactly these keys:\n\n" +
      `${this.fieldDocs()}\n\n` +
      "Output only the JSON object — no markdown fences, no text around it.\n" +
      `Example:\n${JSON.stringify(example, null, 2)}\n`
    );
  }

  /** @returns {string} */
  static toonInstructions() {
    const example = this.FIELDS.map((f) =>
      f.list
        ? `${f.name}: [<your first ${f.name}>, <your second ${f.name}>]`
        : `${f.name}: <your ${f.name} here>`,
    ).join("\n\n");
    return (
      "## RESPONSE FORMAT\n\n" +
      `Reply with exactly these fields, in this order: ${this.FIELDS.map((f) => f.name).join(", ")}.\n\n` +
      `${this.fieldDocs()}\n\n` +
      "Rules:\n" +
      "1. Start each field on its own line as `field_name: value`, lowercase name.\n" +
      "2. Separate fields with a blank line.\n" +
      "3. A multi-line value just continues on the next lines — do not repeat the field name.\n" +
      "4. List fields use bracket notation: `field: [item one, item two]`. " +
      "Add as many items as the work needs, and use `[]` when there are none.\n" +
      "5. No markdown decoration on field names: no `**`, no `-`, no numbering.\n" +
      "6. Use no field names other than the ones listed above.\n\n" +
      `Example:\n${example}\n`
    );
  }

  // ── object -> string ───────────────────────────────────────────────────

  /** Serialize this object in the given format. @param {string} [fmt] @returns {string} */
  toString(fmt = DEFAULT_FORMAT) {
    const cls = /** @type {typeof BaseResponse} */ (this.constructor);
    if (fmt === JSON_FORMAT) {
      /** @type {Values} */
      const plain = {};
      for (const field of cls.FIELDS) plain[field.name] = this.value(field.name);
      return JSON.stringify(plain, null, 2);
    }
    return cls.FIELDS.map((field) => {
      const value = this.value(field.name);
      return `${field.name}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`;
    }).join("\n\n");
  }

  // ── string -> object ───────────────────────────────────────────────────

  /**
   * Parse an agent reply. Tries `fmt`, then the other format, then falls back.
   * @template {BaseResponse} T
   * @this {(new (data?: Record<string, unknown>) => T) & typeof BaseResponse}
   * @param {string} raw @param {string} [fmt] @returns {T}
   */
  static parse(raw, fmt = DEFAULT_FORMAT) {
    const text = typeof raw === "string" ? raw : String(raw);
    const order = fmt === JSON_FORMAT ? [parseJson, parseToon] : [parseToon, parseJson];
    for (const parser of order) {
      try {
        const data = parser(this.FIELDS, text);
        if (Object.keys(data).length) return new this(data);
      } catch {
        continue;
      }
    }
    // Unparseable — treat the whole reply as the answer rather than losing it.
    try {
      return new this({ [this.answerField()]: text.trim() });
    } catch {
      return new this();
    }
  }
}
