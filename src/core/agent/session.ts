/**
 * The session — the blackboard for one run.
 *
 * One user query, one identity, one ledger. Everything that lives for exactly
 * as long as the run lives is here, and everything that outlives it (the
 * conversation) is the transcript this points at rather than owns.
 *
 * Nothing here talks to a model or renders a prompt. The session is data. The
 * phase graph's fields — the plan, the steps, the verdicts — arrive at 4.5 with
 * the phases that write them; a blackboard with columns nothing writes is a
 * prompt budget spent on nothing.
 */

import type { Transcript } from '@/core/agent/transcript'

export class Session {
  /** This run's identity, allocated through `NewIdPort` so a test can pin it. */
  readonly id: string
  readonly query: string
  /** The conversation, which is older than this run and will outlive it. */
  readonly transcript: Transcript

  /** Where the run is now. One name until 4.5 gives it a graph to move around. */
  phase = ''
  /** How many times the loop has come round, counting from zero. */
  round = 0

  /**
   * The repeat guard's ledger: call text → times asked for.
   *
   * Keyed on the whole batch text, which SALVAGE records as a known defect —
   * `a(), b()` and `b(), a()` are two keys for one intention. Ported as it
   * stands and named here rather than silently fixed: the fix belongs with the
   * batch parser that can canonicalise a batch, which is 4.2.
   */
  readonly seen = new Map<string, number>()

  constructor(data: { id: string; query: string; transcript: Transcript }) {
    this.id = data.id
    this.query = data.query
    this.transcript = data.transcript
  }
}
