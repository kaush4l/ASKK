/**
 * The recipe — which components exist for a given agent and session.
 *
 * This is what fills `RenderPrompt`, the seam `core/agent/agent.ts` declared at
 * 2.4 and refused to fake. Everything here answers "what goes into the call";
 * nothing here decides what to do with what comes back.
 *
 * **The context facts arrive as a function, not as a clock.** `ClockPort` gives
 * a `Date` and an IANA zone, and turning those into `2026-08-16 12:00:00 PDT`
 * and `Saturday` needs `Intl` — which §2.1 bans from `src/core/**`, because
 * `Intl` reads the host's calendar and zone data and that is the ambient
 * environment the port seam exists to remove. So the derivation belongs to the
 * adapter that owns a real clock (`adapters/browser/clock.ts`, 3.1), and this
 * module takes the answer.
 *
 * It is also the seam the oracle needs. `tests/golden/*.prompt` pin
 * `2026-08-16 12:00:00 PDT` beside `day: Saturday`, and **2026-08-16 is a
 * Sunday** — no clock can produce that pair, so the golden context block is
 * supplied rather than derived. The Python's test replaced `Agent.context`
 * wholesale for the same reason.
 */

import type { Session } from '@/core/agent/session'
import type { Transcript } from '@/core/agent/transcript'
import { PromptAssembler } from '@/core/prompt/assembler'
import type { Component } from '@/core/prompt/component'
import {
  ContextBlock,
  History,
  ResponseContract,
  Soul,
  SystemInstructions,
  ToolboxComponent,
} from '@/core/prompt/components'
import { DEFAULT_FORMAT } from '@/core/response/base'
import type { BaseResponse, Format } from '@/core/response/base'

/** What the prompt is made of this turn. Every field is optional but `context`. */
export interface Recipe {
  soul?: string
  system?: string
  /** Facts about right now, asked for on every render because they change on every render. */
  context: () => Record<string, string>
  /** One rendered usage line per tool. The lines are 4.2's to write; the block is this one's. */
  usages?: readonly string[]
  /** The structured response class, or `null` for a plain-text agent — a real configuration. */
  model?: typeof BaseResponse | null
  format?: Format
  cue?: string
}

/**
 * A transcript as prompt lines. `[USER]: hi`, uppercased role, bare content.
 *
 * Here rather than on `Transcript` because this is text the model reads, and
 * there may be only one place that writes it.
 */
export function historyLines(transcript: Transcript): string[] {
  return transcript.messages.map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
}

/**
 * The standing furniture of every prompt, in declaration order — which is not
 * the prompt order. The assembler sorts; this only says what exists.
 */
export function baseComponents(recipe: Recipe, transcript: Transcript): Component[] {
  return [
    new Soul({ text: recipe.soul ?? '' }),
    new SystemInstructions({ text: recipe.system ?? '' }),
    new ContextBlock({ facts: recipe.context() }),
    new History({ lines: historyLines(transcript) }),
    new ToolboxComponent({ usages: recipe.usages ?? [] }),
    ResponseContract.of(recipe.model ?? null, recipe.format ?? DEFAULT_FORMAT, recipe.cue ?? '[ASSISTANT]:'),
  ]
}

/**
 * The recipe as the Agent's `prompt` seam.
 *
 * The assembler is a parameter and outlives the call on purpose: the memo is
 * the whole reason the head of the prompt stays byte-stable turn after turn,
 * and one built per render would hit it never.
 */
export function promptFor(recipe: Recipe, assembler: PromptAssembler = new PromptAssembler()): (session: Session) => string {
  return (session) => assembler.assemble(baseComponents(recipe, session.transcript))
}
