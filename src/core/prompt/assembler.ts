/**
 * The prompt assembler — components in, one prompt string out.
 *
 *     new PromptAssembler().assemble(components)  ->  string
 *
 * **It is deliberately dumb.** It does not know what a soul or a toolbox is; it
 * drops the components with nothing to say, sorts the rest on `(SLOT,
 * priority)`, checks three invariants and joins the rendered parts. Which
 * components exist is the recipe's decision and what each one says is the
 * component's own — the assembler only guarantees the shape of the whole.
 *
 * The invariants are checked on every assemble and **raised as errors rather
 * than silently repaired.** A malformed component set is a programming mistake,
 * not a runtime condition to paper over:
 *
 *   - exactly one RESPONSE component (the completion cue must exist, once)
 *   - at least one SOUL or SYSTEM component (an agent must be someone)
 *   - RESPONSE sorts last (guaranteed by the Slot values; verified anyway)
 *
 * Rendered text is memoised per `component.key()`, so a component whose fields
 * did not change renders once and is reused every turn after — which keeps the
 * expensive head of the prompt byte-stable, exactly what an inference server's
 * prefix cache wants to see. CONTEXT opts out via `CACHEABLE = false`: a cached
 * clock is a wrong clock.
 *
 * **Parts are joined with no separator.** Each component carries its own
 * trailing spacing, and that is what makes the output byte-identical to the
 * recorded prompts rather than merely similar to them.
 */

import { classOf } from '@/core/prompt/component'
import type { Component } from '@/core/prompt/component'
import { CORE_MARK, Slot } from '@/core/prompt/slots'

/**
 * The memo must not grow without bound across a long conversation — the History
 * component gets a new key every turn. Past this size it is simply dropped;
 * correctness never depended on it.
 */
export const MEMO_LIMIT = 512

/**
 * One component's share of the prompt, and the facts that make the memo
 * legible: where it sorted, what it is, which content it hashed to, and how
 * much of the prompt it is.
 *
 * `memo` is whether *this* render came back from the cache; `cacheable` is
 * false only for CONTEXT, which opted out. A band that opted out did not miss
 * the memo, and the two flags together are what let a reader tell those apart.
 *
 * `key` is the whole `Name:digest`, not a prefix: the digest is the half that
 * moves, and truncating here would leave the reader with neither.
 */
export interface Band {
  slot: number
  name: string
  key: string
  bytes: number
  memo: boolean
  cacheable: boolean
}

export interface Breakdown {
  bytes: number
  bands: Band[]
  hits: number
  misses: number
  /** The §8.1 sentinel, carried out as a value so it cannot be tree-shaken away. */
  build: string
}

/**
 * UTF-8 length, computed rather than measured: `TextEncoder` is an ambient
 * global and §2.1 gives `src/core/**` none. Bytes and not UTF-16 code units,
 * because the prompt is measured as the wire carries it.
 */
export function utf8Bytes(text: string): number {
  let total = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    total += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return total
}

/** The component set cannot form a valid prompt. */
export class AssemblyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssemblyError'
  }
}

/** Python's `repr` of a list of names, which is what the message was written for. */
function nameList(names: readonly string[]): string {
  return names.length ? `[${names.map((n) => `'${n}'`).join(', ')}]` : 'none'
}

function band(component: Component, text: string, memo: boolean): Band {
  const info = classOf(component)
  return {
    slot: info.SLOT,
    name: info.NAME,
    key: component.key(),
    bytes: utf8Bytes(text),
    memo,
    cacheable: info.CACHEABLE,
  }
}

/** Sorts, validates, memoises and joins. Holds no opinion about content. */
export class PromptAssembler {
  readonly #memo = new Map<string, string>()
  /** Memo hits since construction, which is what makes the cache observable. */
  hits = 0
  misses = 0

  /** One prompt from these components. Throws `AssemblyError` on a bad set. */
  assemble(components: readonly Component[]): string {
    return this.detail(components).prompt
  }

  /**
   * The same prompt, plus the breakdown of how it was built.
   *
   * This is the only place that knows the sort order, the keys and whether each
   * render came back from the memo, so it is the only place that can say — and
   * every number here is one it already had. `hits` and `misses` are the
   * assembler's running totals since construction, carried whole rather than
   * recounted; a reader wanting one turn's ratio counts the bands.
   */
  detail(components: readonly Component[]): { prompt: string; breakdown: Breakdown } {
    const active = components
      .filter((c) => c.applies())
      .sort((a, b) => classOf(a).SLOT - classOf(b).SLOT || a.priority - b.priority)
    check(active)
    let prompt = ''
    const bands: Band[] = []
    for (const component of active) {
      const before = this.hits
      const text = this.#render(component)
      prompt += text
      bands.push(band(component, text, this.hits > before))
    }
    const breakdown: Breakdown = {
      bytes: utf8Bytes(prompt),
      bands,
      hits: this.hits,
      misses: this.misses,
      build: CORE_MARK,
    }
    return { prompt, breakdown }
  }

  #render(component: Component): string {
    if (!classOf(component).CACHEABLE) return component.render()

    const key = component.key()
    const cached = this.#memo.get(key)
    if (cached !== undefined) {
      this.hits += 1
      return cached
    }

    this.misses += 1
    if (this.#memo.size >= MEMO_LIMIT) this.#memo.clear()
    const text = component.render()
    this.#memo.set(key, text)
    return text
  }
}

/** The three invariants, in the order a reader of a broken set wants them. */
function check(ordered: readonly Component[]): void {
  const responses = ordered.filter((c) => classOf(c).SLOT === Slot.RESPONSE)
  if (responses.length !== 1) {
    throw new AssemblyError(
      `A prompt needs exactly one RESPONSE component, got ${responses.length}: ` +
        nameList(responses.map((c) => classOf(c).NAME)),
    )
  }
  if (!ordered.some((c) => classOf(c).SLOT === Slot.SOUL || classOf(c).SLOT === Slot.SYSTEM)) {
    throw new AssemblyError('A prompt needs a SOUL or SYSTEM component — an agent must be someone.')
  }
  const last = ordered[ordered.length - 1]
  if (last === undefined || classOf(last).SLOT !== Slot.RESPONSE) {
    throw new AssemblyError(`${last === undefined ? 'nothing' : classOf(last).NAME} sorts after the RESPONSE component.`)
  }
}
