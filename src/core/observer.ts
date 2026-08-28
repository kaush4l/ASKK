/**
 * The observer contract — what a turn reports that nobody asked for.
 *
 * Every method takes what the core already has and returns nothing. An
 * observer that could answer would be a collaborator, and the turn would start
 * waiting on it. Every method is optional, so something that wants one event is
 * written as one method and nothing in the core changes.
 *
 * The one ordering rule, and it is the reason this exists at all: `assembled`
 * fires **before** the model is called, never after. The bands appear, then the
 * answer arrives against them. A turn that batched the two would show a prompt
 * only once it no longer mattered. `tests/agent-react.test.ts` asserts it
 * against the transport's own call log rather than against a comment.
 *
 * Nothing renders these yet. Wave 3 wires them to the worker protocol (§6.3);
 * they are emitted now because an event declared and never emitted is this
 * project's recurring defect, and the only place to prevent it is where the
 * event is born.
 */

import type { Breakdown } from '@/core/prompt/assembler'

/** The prompt that is about to go out, reported before it does. */
export interface AssembledEvent {
  turnId: string
  phase: string
  /** The whole prompt as one string — the bytes the transport is about to be handed. */
  prompt: string
  /**
   * The same fact with its bands still separate: where each component sorted,
   * what it hashed to, its byte share, and whether it came back from the memo.
   * The assembler computed all of it every turn and the event discarded it
   * (`AGENT.md` §3.5); it is carried from 2.8 on, and 3.2 maps it onto the wire.
   */
  breakdown: Breakdown
}

/** Arrival at a phase — every pass of the loop, not only the first. */
export interface EnteredEvent {
  turnId: string
  phase: string
  /** How many times the loop has come round, counting from zero. */
  round: number
}

/** One partial as it lands. The concatenation of every `text` is the reply. */
export interface DeltaEvent {
  turnId: string
  text: string
}

/**
 * What came back from the tools, the moment it lands.
 *
 * `observation` is the text the model reads next, not a structured result: the
 * tool contract and its `ToolResult` arrive at 4.2, and per-batch granularity
 * is the toolbox's to report because batches do not exist before it.
 */
export interface ResultsEvent {
  turnId: string
  call: string
  observation: string
}

/** The repeat guard fired. `gaveUp` is the tier that ends the loop. */
export interface RetryEvent {
  turnId: string
  call: string
  /** How many times this exact call has now been asked for, counting from one. */
  seen: number
  gaveUp: boolean
}

/** The loop reached its declared terminal. */
export interface DoneEvent {
  turnId: string
  answer: string
  rounds: number
}

export interface Observer {
  assembled?(event: AssembledEvent): void
  entered?(event: EnteredEvent): void
  delta?(event: DeltaEvent): void
  results?(event: ResultsEvent): void
  retry?(event: RetryEvent): void
  done?(event: DoneEvent): void
}

/** An observer that hears everything and does nothing. The default, so no call site guards. */
export const SILENT: Observer = {}
