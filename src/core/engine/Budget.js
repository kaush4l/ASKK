/**
 * What a run has spent, and what it is allowed to spend — written down where
 * the agent can read it.
 *
 * This exists because of an argument that was already won and was only half
 * right. `ReActEngine`'s doc comment says a step counter is "a guess overruling
 * the only party that knows", and about a HIDDEN counter that is exactly true:
 * a number the agent cannot see is not a bound it can work within, it is an
 * accident that happens to it partway through a plan. The half that was missing
 * is that there is a second party who knows something the agent does not — the
 * person whose battery, context window and bill are being spent. A budget is
 * how that party states their terms, and rendering it into the prompt is what
 * keeps the agent the one deciding: told "step 22 of 24", a model wraps up. Told
 * nothing and then stopped at 24, it is simply cut off mid-sentence.
 *
 * So this object is a FACT, not a gate. It counts, it renders, and it says when
 * it is finished; the loop decides what to do about that. The only place it
 * approaches a gate is `exhausted`, which the loop uses to decide that the next
 * turn is the agent's last — and even that is announced in the prompt before it
 * is acted on.
 *
 * Three currencies, because a runaway loop can burn any of them independently:
 * a fast local model burns steps without tokens, a long-context call burns
 * tokens in three steps, and a slow endpoint burns wall-clock while doing
 * neither.
 *
 * Tokens are counted from the provider's own number where there is one —
 * `Inference._usage` reports it and the engine hands it here — and from the
 * local estimator where there is not. Which of the two produced the figure is
 * printed beside it, because a budget quoting an estimate as though it were a
 * measurement is the failure mode this whole repository keeps rebuilding to
 * escape.
 */

/**
 * The default terms, applied when an agent file declares nothing.
 *
 * Each is derived from something measured in this tree rather than picked for
 * roundness:
 *
 *   steps    24 — the cheap bound, and the ONLY one that still binds when a
 *                 transport reports no usage at all (`ScriptedInference` and
 *                 `TransformersInference` both report none, so a token-only
 *                 budget would be no budget for either).
 *   tokens   250,000 — `bun scripts/dryrun.js` measures this tree's first
 *                 prompt at 987 tokens and its second at 1,041; a real agent
 *                 carrying a conversation and a served MCP roster runs several
 *                 times that, so 250k is on the order of a hundred steps of the
 *                 small case and a couple of dozen of the large one. Either way
 *                 it is a run that has stopped converging.
 *   seconds  600 — twice `Inference`'s own 300,000 ms per-call timeout, so the
 *                 clock can only run out on a run that has made more than one
 *                 call and is therefore looping rather than merely waiting.
 */
export const BUDGET_DEFAULTS = Object.freeze({ steps: 24, tokens: 250_000, seconds: 600 })

const count = (n) => n.toLocaleString('en-US')

/** A declared limit, or the default when what was declared is not a limit. */
function limit(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

export class Budget {
  /**
   * @param {{steps?: number, tokens?: number, seconds?: number,
   *   now?: () => number}} [declared] `now` is injected so a test can move the
   *   clock without waiting for it. Everything else comes from an agent file.
   */
  constructor({ steps, tokens, seconds, now = Date.now } = {}) {
    this.limits = Object.freeze({
      steps: limit(steps, BUDGET_DEFAULTS.steps),
      tokens: limit(tokens, BUDGET_DEFAULTS.tokens),
      seconds: limit(seconds, BUDGET_DEFAULTS.seconds),
    })
    this._now = now
    this._startedAt = now()
    // One entry per model call: what the local estimator thought the prompt
    // cost, and what the provider later said it actually cost. Kept apart
    // rather than summed as they arrive, because a measurement REPLACES an
    // estimate for the same call and adding both would double-charge it.
    this._passes = []
    this._closing = ''
  }

  /** Model calls made so far, including the one in flight. */
  get steps() {
    return this._passes.length
  }

  /** Seconds since the run began. */
  get seconds() {
    return Math.max(0, Math.round((this._now() - this._startedAt) / 1000))
  }

  /** The provider's number where it gave one, this tree's estimate where it did not. */
  get tokens() {
    return this._passes.reduce((sum, pass) => sum + (pass.measured ?? pass.estimated), 0)
  }

  /** How many passes carry a real count. The difference between fact and guess. */
  get counted() {
    return this._passes.filter((pass) => pass.measured !== null).length
  }

  /**
   * Open a pass and record what the local estimator made of the prompt it is
   * about to send.
   *
   * One method and not two, because there is exactly one moment that can call
   * either: `Engine.step`, where the prompt has just been assembled and its
   * cost is known for the first time. Splitting it left an ordering that had to
   * be got right by hand, and it was got wrong — the pass was never opened, so
   * the estimate landed on nothing and the budget counted zero for ever.
   */
  open(tokens) {
    this._passes.push({ estimated: Number(tokens) || 0, measured: null })
    return this
  }

  /**
   * What the provider says the pass cost. Prompt AND completion: the prompt is
   * re-sent in full every step and is the part that grows, so a budget counting
   * only the completion would be blind to the thing it exists to catch.
   */
  measure(usage) {
    // `open` always runs first on the loop's own path, so the missing-pass half
    // of this guard is unreachable from there. It stays because this is a
    // public method and nothing in this tree may throw on a state a caller can
    // reach: usage reported against no pass is a no-op, not a crash.
    const pass = this._passes.at(-1)
    if (!pass || !usage) return this
    const spent = (Number(usage.prompt) || 0) + (Number(usage.completion) || 0)
    if (spent > 0) pass.measured = spent
    return this
  }

  /**
   * What will have run out by the end of the NEXT step — empty while there is
   * room for another.
   *
   * Asked about the next step rather than this one on purpose: the last word is
   * spent FROM the budget rather than added to it, so a run declaring 24 steps
   * makes at most 24 model calls and the twenty-fourth is the one told that it
   * is the last. A budget that granted an extra turn on top of its own number
   * would not be the number anybody wrote.
   */
  get exhausted() {
    if (this.steps + 1 >= this.limits.steps) return `the ${this.limits.steps}-step budget`
    if (this.tokens >= this.limits.tokens) {
      return `the ${count(this.limits.tokens)}-token budget`
    }
    if (this.seconds >= this.limits.seconds) return `the ${this.limits.seconds}-second budget`
    return ''
  }

  /**
   * Look at what is left and remember it, so `render` can say so.
   *
   * Called once per iteration, unconditionally: it is `exhausted` turned from a
   * question into a state, and the state is what the prompt is rendered from.
   * It takes no argument — the only reason to close is that something ran out,
   * and a caller allowed to name its own reason could print one that never did.
   */
  close() {
    this._closing = this.exhausted
    return this
  }

  /**
   * What was spent when the coming turn was opened, or '' while there is room.
   *
   * A string rather than a flag because both readers need the reason, not just
   * the fact: the prompt tells the agent which budget is gone, and the loop's
   * hard stop puts the same words in its note.
   */
  get closing() {
    return this._closing
  }

  /**
   * The `# BUDGET` block's body.
   *
   * Three lines and, at the end, one paragraph that only ever appears once. The
   * paragraph is the whole point of the block existing: everything before it is
   * a number the agent may or may not act on, and this is the sentence that
   * turns a stop into a hand-over.
   */
  render() {
    const source =
      this.counted === 0
        ? 'estimated'
        : this.counted === this.steps
          ? 'counted by the provider'
          : `${this.counted} of ${this.steps} counted by the provider`
    const lines = [
      `steps: ${this.steps} of ${this.limits.steps} used`,
      `tokens: ${count(this.tokens)} of ${count(this.limits.tokens)} used (${source})`,
      `time: ${this.seconds}s of ${this.limits.seconds}s used`,
    ]
    if (this._closing) {
      lines.push(
        '',
        `THIS IS YOUR LAST TURN. ${this._closing} is spent, so no tool call you write now will be run — writing one ends the run with no answer at all. Set act to answer and reply with what you have: say what you found, and say plainly what you did not get to.`,
      )
    }
    return lines.join('\n')
  }
}
