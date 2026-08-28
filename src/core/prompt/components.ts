/**
 * The concrete prompt parts this tree can feed today: the soul, the system
 * block, the context facts, the transcript, the tool usage lines and the
 * response contract.
 *
 * What a component *is* lives in `component.ts`; this file is only instances of
 * that abstraction. Every `TEMPLATE` here is written so its output is
 * byte-identical to what the Python's f-strings produced — `tests/golden/*.prompt`
 * is what holds them to it, and a byte that differs is this file being wrong.
 *
 * **Four more components are declared in ARCHITECTURE.md §4 and are not here:**
 * `PhaseInstructions`, `CritiqueFindings`, `SkillCatalog` and `LoadedSkills`.
 * Nothing in this tree can supply any of them — phases are 4.5 and skills have
 * no increment — and a component with no producer is a prompt block that can
 * only ever render empty.
 */

import { Component, hash } from '@/core/prompt/component'
import { Slot } from '@/core/prompt/slots'
import type { Scope } from '@/core/prompt/template'
import { DEFAULT_FORMAT } from '@/core/response/base'
import type { BaseResponse, Format } from '@/core/response/base'

/** Who the agent is. Distinct from the system block so a phase can never displace it. */
export class Soul extends Component {
  static override SLOT: number = Slot.SOUL
  static override TEMPLATE = '{{ text }}\n\n'
  static override FIELDS: readonly string[] = ['priority', 'text']
  static override NAME = 'Soul'

  readonly text: string

  constructor(data: { priority?: number; text?: string } = {}) {
    super(data)
    this.text = (data.text ?? '').trim()
    Object.freeze(this)
  }

  override applies(): boolean {
    return Boolean(this.text)
  }
}

/** The system block — the same shape as Soul, one slot later. */
export class SystemInstructions extends Soul {
  static override SLOT = Slot.SYSTEM
  static override NAME = 'SystemInstructions'
}

/**
 * Facts about right now: the clock, and whatever else is true this turn.
 *
 * **Never cached** — the whole point of this block is that it differs every
 * render, and it is the one component that opts out of the memo. A value that
 * starts on its own line is already indented under its key; anything else sits
 * after `key: ` (the Python's exact rule).
 */
export class ContextBlock extends Component {
  static override SLOT = Slot.CONTEXT
  static override CACHEABLE = false
  static override TEMPLATE = "{% if lines %}## CONTEXT\n\n{{ lines | join('\\n') }}\n\n{% endif %}"
  static override FIELDS: readonly string[] = ['priority', 'facts']
  static override NAME = 'ContextBlock'

  readonly facts: Readonly<Record<string, string>>

  constructor(data: { priority?: number; facts?: Record<string, string> } = {}) {
    super(data)
    // A plain object like the Python dict: fact keys are words, and JS fixes
    // insertion order for every key that is not an array index.
    this.facts = Object.freeze({ ...(data.facts ?? {}) })
    Object.freeze(this)
  }

  override templateData(): Scope {
    const lines = Object.entries(this.facts)
      .filter(([, v]) => v)
      .map(([k, v]) => (v.startsWith('\n') ? `${k}:${v}` : `${k}: ${v}`))
    return { lines }
  }

  override applies(): boolean {
    return Object.values(this.facts).some((v) => Boolean(v))
  }
}

/** The transcript — already-formatted `[ROLE]: content` lines. */
export class History extends Component {
  static override SLOT = Slot.HISTORY
  static override TEMPLATE = "{% if lines %}{{ lines | join('\\n\\n') }}\n\n{% endif %}"
  static override FIELDS: readonly string[] = ['priority', 'lines']
  static override NAME = 'History'

  readonly lines: readonly string[]

  constructor(data: { priority?: number; lines?: readonly string[] } = {}) {
    super(data)
    this.lines = Object.freeze([...(data.lines ?? [])])
    Object.freeze(this)
  }

  /**
   * The generic key serialises every field, and this component carries the
   * whole transcript — hashing the lines behind their count keeps a long
   * conversation's render cost flat instead of growing with the JSON. The
   * separator is a NUL because a space would let two different splits of the
   * same words hash alike, and a cache key that collides serves wrong bytes.
   */
  override key(): string {
    return `History:${this.lines.length}:${hash(this.lines.join('\u0000'))}`
  }

  override applies(): boolean {
    return this.lines.length > 0
  }
}

/**
 * The TOOLS slot: one usage line per tool, plus the batching rules.
 *
 * It takes rendered usage strings rather than tools, because this is the only
 * part of the tool path the *model* reads and the rest of that path is 4.2.
 * Whoever writes a usage line writes prompt bytes, and there may be only one
 * place that does it.
 */
export class ToolboxComponent extends Component {
  static override SLOT = Slot.TOOLS
  static override TEMPLATE =
    "{% if usages %}## AVAILABLE TOOLS\n\n{{ usages | join('\\n') }}\n\n" +
    'Call them exactly as written above. Calls that do not depend on each other go on ' +
    'one line, separated by commas, and run at the same time. A call that needs an earlier ' +
    "call's result goes on its own line — lines run in order, top to bottom. Results come " +
    'back labelled with the tool name, in the order you wrote the calls.\n\n{% endif %}'
  static override FIELDS: readonly string[] = ['priority', 'usages']
  static override NAME = 'ToolboxComponent'

  readonly usages: readonly string[]

  constructor(data: { priority?: number; usages?: readonly string[] } = {}) {
    super(data)
    this.usages = Object.freeze([...(data.usages ?? [])])
    Object.freeze(this)
  }

  override applies(): boolean {
    return this.usages.length > 0
  }
}

/**
 * A response class's rendered instructions, computed once per (class, format).
 *
 * `instructions` walks the field table and formats an example on every call and
 * the result never changes, so a turn-by-turn rebuild is pure waste. Cached
 * here rather than on the class, so a subclass declared in a test busts it by
 * being a new class.
 */
const RENDERED = new Map<typeof BaseResponse, Map<string, string>>()

function instructionsText(model: typeof BaseResponse | null, fmt: Format): string {
  if (!model) return ''
  let byFormat = RENDERED.get(model)
  if (!byFormat) {
    byFormat = new Map()
    RENDERED.set(model, byFormat)
  }
  let text = byFormat.get(fmt)
  if (text === undefined) {
    text = model.instructions(fmt).trim()
    byFormat.set(fmt, text)
  }
  return text
}

/** The RESPONSE slot: the structured-response instructions plus the completion cue. */
export class ResponseContract extends Component {
  static override SLOT = Slot.RESPONSE
  static override TEMPLATE = '{% if instructions %}{{ instructions }}\n\n{% endif %}{{ cue }}'
  static override FIELDS: readonly string[] = ['priority', 'instructions', 'cue']
  static override NAME = 'ResponseContract'

  readonly instructions: string
  readonly cue: string

  constructor(data: { priority?: number; instructions?: string; cue?: string } = {}) {
    super(data)
    this.instructions = data.instructions ?? ''
    this.cue = data.cue ?? '[ASSISTANT]:'
    Object.freeze(this)
  }

  /** Build from a response class — or from none, leaving just the cue. */
  static of(model: typeof BaseResponse | null, fmt: Format = DEFAULT_FORMAT, cue = '[ASSISTANT]:'): ResponseContract {
    return new ResponseContract({ instructions: instructionsText(model, fmt), cue })
  }

  /** Always renders: even with no structured contract, the cue must close the prompt. */
  override applies(): boolean {
    return true
  }
}
