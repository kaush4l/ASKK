/**
 * The decomposition: what doing the goal is made of, as an ordered list of
 * steps with states.
 *
 * A goal says where we are going and a transcript says what was said. Neither
 * says WHERE WE ARE, and that is the whole of what this holds: on turn forty,
 * the difference between an agent that is working and an agent that is
 * wandering is whether it can read back the part of the job it is on.
 *
 * Owned by the conversation, beside the goal, for the same reason the goal is:
 * the same agent is asked for different things in different conversations, and
 * a plan stored on the agent would leak one conversation's work into another.
 *
 * Steps are addressed by ORDINAL — the number the model reads in the rendered
 * list — and not by id. An id would be the safer address if anything else
 * referred to a step, and nothing does: the only writer is the agent that has
 * just read the list, and asking it to copy back an opaque token it has no
 * other use for buys a class of transcription error for nothing. Renumbering on
 * revision is the cost, and `compose` is where it is paid.
 */

/**
 * What a step can be.
 *
 * Four, and `DROPPED` is the one worth arguing for: a plan that can only grow
 * and finish cannot record the most useful thing a working agent learns, which
 * is that a step it wrote earlier turned out not to be needed. Deleting it
 * instead would renumber the list and lose the fact that it was ever
 * considered — so the next turn, reading a shorter list, may well write it
 * again.
 */
export const StepState = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  DONE: 'done',
  DROPPED: 'dropped',
})

const STATES = new Set(Object.values(StepState))

/** How a state is shown to the model. */
const MARK = {
  [StepState.PENDING]: '[ ]',
  [StepState.ACTIVE]: '[>]',
  [StepState.DONE]: '[x]',
  [StepState.DROPPED]: '[-]',
}

/**
 * How many steps one plan may hold.
 *
 * A cap because the plan is rendered into EVERY prompt of the conversation, so
 * an agent that answers "decompose this" with sixty items has made every later
 * turn more expensive for the life of the chat. Twenty is above any honest
 * decomposition of a single goal — Open SWE's plans run to a handful — and far
 * enough above it that hitting this is evidence of a runaway rather than of an
 * ambitious plan. The overflow SAYS it was cut, on the rule the file listing
 * follows: a truncation nobody is told about leaves the reader certain it has
 * seen everything.
 */
export const MAX_STEPS = 20

/** One item of work. Frozen: a step that can be edited in place is not a record. */
class Step {
  constructor({ text, state = StepState.PENDING } = {}) {
    this.text = String(text ?? '').trim()
    this.state = STATES.has(state) ? state : StepState.PENDING
    Object.freeze(this)
  }

  toJSON() {
    return { text: this.text, state: this.state }
  }
}

export class Plan {
  constructor({ steps = [], revisedAt = 0 } = {}) {
    const rows = Array.isArray(steps) ? steps : []
    this._steps = rows
      .map((row) => (typeof row === 'string' ? new Step({ text: row }) : new Step(row ?? {})))
      .filter((step) => step.text)
      .slice(0, MAX_STEPS)
    this.revisedAt = Number.isFinite(revisedAt) ? revisedAt : 0
  }

  /** A copy, so callers cannot revise the plan by holding the array. */
  get steps() {
    return [...this._steps]
  }

  get isEmpty() {
    return this._steps.length === 0
  }

  /** Steps that are neither finished nor abandoned — what is actually left. */
  get outstanding() {
    return this._steps.filter(
      (step) => step.state === StepState.PENDING || step.state === StepState.ACTIVE,
    )
  }

  /**
   * Write or rewrite the list.
   *
   * State is carried across by TEXT, not by position: a revision that keeps a
   * step's wording keeps what is known about it, wherever it moved to, and a
   * step whose wording changed is a different step and starts again. Position
   * would be the cheaper rule and the wrong one — inserting a first step would
   * hand every later step the state of its predecessor, so a plan revised
   * mid-run would report finished work that never happened.
   *
   * @param {Array<string|{text: string, state?: string}>} texts
   * @param {number} [at] when the revision happened
   * @returns {string[]} notes about anything the revision could not honour
   */
  compose(texts, at = Date.now()) {
    const rows = Array.isArray(texts) ? texts : []
    const notes = []
    const known = new Map(this._steps.map((step) => [step.text, step.state]))
    const composed = []
    const seen = new Set()

    for (const row of rows) {
      const text = String(typeof row === 'string' ? row : (row?.text ?? '')).trim()
      if (!text) continue
      // A list that says the same thing twice is a list the agent will tick off
      // twice. Kept once, at its first position, and the note says so.
      if (seen.has(text)) {
        notes.push(`a step repeating ${JSON.stringify(text)} was listed twice; kept once`)
        continue
      }
      seen.add(text)
      if (composed.length >= MAX_STEPS) {
        notes.push(`a plan may hold ${MAX_STEPS} steps; the rest were dropped`)
        break
      }
      const carried = typeof row === 'string' ? undefined : row?.state
      composed.push(new Step({ text, state: carried ?? known.get(text) ?? StepState.PENDING }))
    }

    this._steps = composed
    this.revisedAt = at
    return notes
  }

  /**
   * Move one step to a state, addressed by its 1-based ordinal.
   *
   * Returns the step or null. Null rather than throwing, because the caller is
   * a tool answering a model: an ordinal that does not exist is something to
   * say back, not an end to the turn.
   */
  mark(ordinal, state, at = Date.now()) {
    const index = Number(ordinal) - 1
    if (!Number.isInteger(index) || index < 0 || index >= this._steps.length) return null
    if (!STATES.has(state)) return null
    const current = this._steps[index]
    this._steps[index] = new Step({ text: current.text, state })
    this.revisedAt = at
    return this._steps[index]
  }

  /**
   * The block the model reads, and the same text the panel shows.
   *
   * One line per step: ordinal, state mark, words. The ordinal is what `mark`
   * takes, so the thing the agent reads is the thing it writes back — a list
   * that showed one address and accepted another is how a run ticks off the
   * wrong step.
   *
   * Empty when there are no steps, so a conversation nobody has planned gets no
   * heading promising a plan.
   */
  render() {
    if (this.isEmpty) return ''
    return this._steps
      .map((step, index) => `${index + 1}. ${MARK[step.state]} ${step.text}`)
      .join('\n')
  }

  static fromJSON(raw) {
    const record = raw ?? {}
    return new Plan({ steps: record.steps ?? [], revisedAt: record.revisedAt ?? 0 })
  }

  /** The persisted record, and the only shape that leaves this module. */
  toJSON() {
    return {
      steps: this._steps.map((step) => step.toJSON()),
      revisedAt: this.revisedAt,
    }
  }
}
