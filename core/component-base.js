/**
 * The component abstraction — what every part of a prompt is, before any
 * particular part exists.
 *
 *     Component (abstract)
 *     ├─ render()    the object as instructions for the model (its "toString")
 *     ├─ key()       content hash — identical key means identical bytes ("hashCode")
 *     ├─ applies()   cheap emptiness check; empty components vanish from the prompt
 *     └─ SLOT        where in the prompt this component belongs
 *
 * Ordering is structural, not conventional: the assembler sorts on
 * `(SLOT, priority)`, and the `Slot` values are what guarantee the prompt starts
 * with the soul and system instructions and ends with the response contract.
 *
 * Components are immutable value objects. They are rebuilt each phase from the
 * session and hold no live state — the session is the only mutable thing, the
 * phase decides which components exist, and a component only knows how to write
 * itself down. That immutability is what makes `key()` honest: the fields are
 * frozen, so the hash of the fields is the hash of the rendered text.
 *
 * Rendering goes through a template compiled once per class — the template is
 * the component's markdown shape, declared as data rather than string code.
 * Every template is written so its output is byte-identical to what the old
 * engine's f-strings produced, because render parity with the previous core is
 * the test that this rewrite changed nothing it did not mean to.
 *
 * PORT-MAP R1: pydantic's `model_fields` gave the Python its field order for
 * free. JavaScript has no such reflection, so every class writes `FIELDS` out in
 * declaration order, and `templateData()` and `key()` walk that list.
 */

import { compile } from "./template.js";

/** Where a component sits in the prompt. The order of these values IS the prompt order. */
export const Slot = Object.freeze({
  SOUL: 0, // who the agent is — always first
  SYSTEM: 10, // system instructions
  CONTEXT: 20, // clock, space facts/notes — rebuilt every render, never cached
  SKILLS: 30, // loaded SKILL.md bodies
  PHASE: 40, // the current phase's own instructions
  HISTORY: 50, // transcript, including any rolling summary
  TOOLS: 60, // toolbox usage lines
  RESPONSE: 99, // response contract + completion cue — always last
});

/**
 * Every component constructor takes this one shape, so `COMPONENTS` can hold
 * them all under a single type.
 * @typedef {{
 *   priority?: number, text?: string, facts?: Record<string, string>,
 *   lines?: readonly string[], title?: string, body?: string,
 *   findings?: readonly string[], bodies?: readonly string[],
 *   entries?: readonly (readonly [string, string])[],
 * }} ComponentInit
 */

/** @type {Map<unknown, (data: Record<string, unknown>) => string>} */
const COMPILED = new Map();

/** One prompt part. Frozen: a component is a value, not a place. */
export class Component {
  /** @type {number} */ static SLOT = Slot.SOUL;
  /** @type {string} */ static TEMPLATE = "";
  /** CONTEXT-slot components set this false: a cached clock is a wrong clock. */
  static CACHEABLE = true;
  /** The declared fields, in order; `priority` is declared on the base. */
  static FIELDS = ["priority"];
  /**
   * The class identity `key()` prefixes. Written out rather than read off
   * `constructor.name`, which a minifier is free to rewrite — and this build
   * ships minified, so a renamed class would collide with its sibling.
   * @type {string}
   */
  static NAME = "Component";

  /** @param {ComponentInit} [data] */
  constructor(data = {}) {
    /** @type {number} */
    this.priority = data.priority ?? 0;
    // Not frozen here: a subclass still has fields to assign, so each concrete
    // class freezes itself at the end of its own constructor.
  }

  /** @returns {(data: Record<string, unknown>) => string} */
  static template() {
    let compiled = COMPILED.get(this);
    if (!compiled) COMPILED.set(this, (compiled = compile(this.TEMPLATE)));
    return compiled;
  }

  /** @returns {(data: Record<string, unknown>) => string} */
  template() {
    return ctor(this).template();
  }

  /** What the template sees — every declared field, by name. @returns {Record<string, unknown>} */
  templateData() {
    return fields(this);
  }

  /** The component as text for the model. Empty string = nothing to say. @returns {string} */
  render() {
    return this.template()(this.templateData());
  }

  /** Content hash. Same fields -> same key -> same rendered bytes. @returns {string} */
  key() {
    const self = fields(this);
    return `${ctor(this).NAME}:${hash(JSON.stringify(ctor(this).FIELDS.map((n) => [n, self[n]])))}`;
  }

  /** Cheap pre-check; the assembler also drops anything that renders empty. @returns {boolean} */
  applies() {
    return true;
  }

  /** @returns {string} */
  toString() {
    return this.render();
  }
}

// ── internals ────────────────────────────────────────────────────────────

/**
 * @param {Component} instance
 * @returns {typeof Component}
 */
function ctor(instance) {
  return /** @type {typeof Component} */ (/** @type {unknown} */ (instance.constructor));
}

/**
 * @param {Component} instance
 * @returns {Record<string, unknown>}
 */
function fields(instance) {
  const self = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (instance));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const name of ctor(instance).FIELDS) out[name] = self[name];
  return out;
}

/**
 * Two independent 32-bit FNV-1a passes, concatenated. The Python hashed the
 * model's JSON with sha1; a prompt memo wants collision resistance, not
 * cryptography, and WebCrypto's digest is async — it would make `key()` a
 * promise, while the assembler's memo lookup is synchronous.
 *
 * Exported, unlike its two neighbours, because a component that overrides
 * `key()` still has to hash with the same function the base does.
 * @param {string} text
 * @returns {string}
 */
export function hash(text) {
  let a = 0x811c9dc5;
  let b = 0x1b873593;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
