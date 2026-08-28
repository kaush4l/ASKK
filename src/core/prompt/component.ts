/**
 * What a prompt part is, before any particular part exists.
 *
 *     Component (abstract)
 *     ├─ render()    the object as instructions for the model
 *     ├─ key()       content hash — identical key means identical bytes
 *     ├─ applies()   cheap emptiness check; empty components vanish entirely
 *     └─ SLOT        where in the prompt this component belongs
 *
 * Components are immutable value objects. They are rebuilt each turn from the
 * session and hold no live state — the session is the only mutable thing, the
 * recipe decides which components exist, and a component only knows how to
 * write itself down. **That immutability is what makes `key()` honest:** the
 * fields are frozen, so a hash of the fields is a hash of the rendered text.
 *
 * Rendering goes through a template compiled once per class, so a component's
 * markdown shape is data rather than string code.
 *
 * Pydantic gave the Python its field order by reflection. TypeScript has none
 * at runtime, and object key order is not to be trusted across a rebuild, so
 * every class writes `FIELDS` out in declaration order and both `templateData`
 * and `key` walk that array.
 */

import { Slot } from '@/core/prompt/slots'
import { compile } from '@/core/prompt/template'
import type { Scope } from '@/core/prompt/template'

/** Anything the assembler is willing to sort. */
export type ComponentClass = typeof Component

const COMPILED = new Map<unknown, (data: Scope) => string>()

/** One prompt part. A value, not a place. */
export abstract class Component {
  /** Annotated, not inferred: a subclass overrides it, and a literal type on the
   * base static would make that override a type error rather than a slot. */
  static SLOT: number = Slot.SOUL
  static TEMPLATE = ''
  /** CONTEXT-slot components set this false: a cached clock is a wrong clock. */
  static CACHEABLE = true
  /** The declared fields, in order. `priority` is declared on the base. */
  static FIELDS: readonly string[] = ['priority']
  /**
   * The class identity `key()` prefixes and the invariant messages print.
   * Written out rather than read off `constructor.name`, **because the build
   * minifies** and a renamed class would collide with its sibling.
   */
  static NAME = 'Component'

  readonly priority: number

  constructor(data: { priority?: number } = {}) {
    this.priority = data.priority ?? 0
    // Not frozen here: a subclass still has fields to assign, so each concrete
    // class freezes itself at the end of its own constructor.
  }

  static template(): (data: Scope) => string {
    let compiled = COMPILED.get(this)
    if (!compiled) COMPILED.set(this, (compiled = compile(this.TEMPLATE)))
    return compiled
  }

  /** What the template sees — every declared field, by name. */
  templateData(): Scope {
    return fieldsOf(this)
  }

  /** The component as text for the model. Empty string means nothing to say. */
  render(): string {
    return classOf(this).template()(this.templateData())
  }

  /** Content hash. Same fields -> same key -> same rendered bytes. */
  key(): string {
    const self = fieldsOf(this)
    const cls = classOf(this)
    return `${cls.NAME}:${hash(JSON.stringify(cls.FIELDS.map((n) => [n, self[n]])))}`
  }

  /** Cheap pre-check; the assembler also drops anything that renders empty. */
  applies(): boolean {
    return true
  }

  toString(): string {
    return this.render()
  }
}

/** The statics are on the class; an instance can only reach them this way. */
export function classOf(instance: Component): ComponentClass {
  return instance.constructor as ComponentClass
}

function fieldsOf(instance: Component): Scope {
  const self = instance as unknown as Record<string, unknown>
  const out: Scope = {}
  for (const name of classOf(instance).FIELDS) out[name] = self[name]
  return out
}

/**
 * Two independent 32-bit FNV-1a passes, concatenated.
 *
 * The Python hashed with sha1. A prompt memo wants collision resistance, not
 * cryptography — and WebCrypto's digest is async, which would make `key()` a
 * promise while the assembler's memo lookup is synchronous.
 *
 * Exported because a component that overrides `key()` still has to hash with
 * the same function the base does.
 */
export function hash(text: string): string {
  let a = 0x811c9dc5
  let b = 0x1b873593
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}
