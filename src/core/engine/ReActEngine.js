import { Failure, Outcome, Reason } from '../Outcome.js'
import { ReActResponse } from '../response/ReActResponse.js'
import { Budget } from './Budget.js'
import { Engine } from './Engine.js'

/**
 * What the model wrote, short enough to sit in a note.
 *
 * The hard stop used to carry the final turn on the Outcome's value and say in
 * a comment that "nothing the model produced is thrown away". It was: the one
 * reader of that value, `ChatService`, drops it. A note is a channel the page
 * already renders, so the words go there instead of into a field nobody
 * destructures.
 *
 * `limit` is the caller's, because the two callers want different lengths and
 * one implementation with a number in it is better than two implementations. A
 * note is read by a person scanning a failed run, so 120 characters is a
 * sentence of it. The correction below is read by the MODEL, as the evidence it
 * needs to write a better reply, and 120 characters of a truncated scratchpad is
 * not evidence — measured on the two real captures in `test/support/fixtures/`,
 * the whole of what the model had written is 168 and 132 characters, so a
 * hundred-and-twenty-character cap would cut both mid-`plan`.
 */
function quote(last, limit = 120) {
  const text = last === null ? '' : typeof last === 'string' ? last : String(last.answer ?? '')
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'nothing at all'
  return `"${trimmed.length > limit ? `${trimmed.slice(0, limit - 3)}...` : trimmed}"`
}

/**
 * A promise that settles when the stop is pressed, and never otherwise.
 *
 * For racing against something that cannot be cancelled. `once` matters: the
 * loop calls this on every iteration against one long-lived signal, and a
 * listener per step that outlived its step would accumulate for the length of
 * the run.
 */
function until(signal) {
  if (!signal) return new Promise(() => {})
  return new Promise((resolve) => {
    if (signal.aborted) resolve('')
    else signal.addEventListener('abort', () => resolve(''), { once: true })
  })
}

/**
 * How many replies in a row may end without saying what to do before the run
 * does.
 *
 * Two, so exactly one correction is spent. The retry is worth taking because it
 * CHANGES THE PROMPT — the scratchpad gains the reply that failed and a line
 * saying why — and one correction is what the blind panel's reference scaffold
 * needed every time it hit this state. Measured over its recorded runs rather
 * than remembered: `bench/transcripts/<task>/agent-zero/` holds four runs with a
 * `malformed` action in them — median-bug 1 and 2, slugify-module 1 and 3 —
 * every one recovered on the very next turn and all four passed, three of the
 * four after a `finish_reason: length`. Its own limit is FIVE
 * (`bench/scaffolds/agent-zero.js`, `UNUSABLE_LIMIT`), so two is the tighter
 * number and nothing in the record needed the other three. A second failure
 * straight after the correction says the correction did not take, and a third
 * call would be the third near-identical request to an endpoint measured at
 * `cached_tokens: 0`.
 *
 * Taking that number meant taking its mechanism too, and the first version of
 * this slice took only the number: agent-zero pushes THE RAW REPLY into history
 * ahead of its warning (`observe`, same file), and a ReAct scratchpad holds
 * action/observation pairs, so the previous reply appears nowhere in the retry
 * prompt unless it is put there. A correction whose whole justification is that
 * it changes the prompt must change it with something about the failure. So the
 * push below carries the reply back.
 *
 * Counted CONSECUTIVELY rather than over the run. An agent that was corrected,
 * did real work for five steps and then ran out of room again is not the agent
 * this ceiling exists to stop, and it gets its one correction back. The cost is
 * named rather than left to be discovered: an agent alternating unsaid and tool
 * never reaches this ceiling at all and spends two model calls per productive
 * step, bounded only by `Budget` — which is the right bound, because that agent
 * IS making progress and the person paying is the one who set the limit.
 */
const UNSAID_CEILING = 2

/**
 * Think → act → observe, until the agent says it is done or the run runs out.
 *
 * The loop reads one field of the parsed response: `act`. While it says `tool`
 * the turn is an action and the loop goes round; when it says `answer` the run
 * is over. Nothing else about the reply steers control flow, which is why a
 * malformed act is repaired in `ReActResponse.normalize` rather than here — a
 * loop that has to second-guess its own contract has two contracts.
 *
 * THE AGENT STILL DECIDES WHEN THE WORK IS DONE, and the argument this file
 * used to make for that is not withdrawn. It said: a counter cannot tell the
 * difference between an agent that is stuck and an agent that is three steps
 * into something that needs nine, so a counter ending the run is a guess
 * overruling the only party that knows. Every word of that survives, and
 * `observe` below — inform, do not stop — is still the loop's main mechanism.
 *
 * What it got wrong was "the only party that knows": the person paying for the
 * run knows something no amount of reasoning can derive. `Budget` is that
 * argument in full, and this loop is the two consequences of it:
 *
 *   1. A LAST WORD. When the next step would exhaust the budget, the block says
 *      so in plain words BEFORE that step is sent, and the agent gets one turn
 *      to answer with what it has. A run should end with an answer, not with a
 *      severed rope. This is the mechanism, and it is a SENTENCE in the prompt
 *      rather than a number in the loop — the running counters that used to sit
 *      beside it were measured against an arm without them, changed nothing,
 *      and were cut. `Budget`'s own comment carries that measurement.
 *   2. A hard stop behind that, for the agent that was told this was its last
 *      turn and did not answer anyway. It is a safety net and not the mechanism,
 *      and it never truncates silently: the run fails, naming which budget ran
 *      out and quoting what the final turn wrote instead of an answer.
 *
 * A THIRD ENDING WAS MISSING ENTIRELY and is the reason this file changed. A
 * reply that never said whether it wanted a tool or wanted to answer used to end
 * the run as an answer, because `act` defaulted to one — so a reply cut off at
 * the token limit before it reached the field handed the user a half-written
 * scratchpad as the reply. `ReActResponse.normalize` now names that state and
 * the loop sends the turn back once, through the scratchpad, and fails if the
 * next reply does the same. `UNSAID_CEILING` above is the argument for the one.
 *
 * And the loop can be stopped from outside. `signal` is the user's, and where
 * it reaches is uneven, which is worth knowing before trusting it: it goes all
 * the way to the transport for the MODEL CALL — see `Engine.step` — so a stop
 * ends a request that is open on the network rather than the iteration after
 * it. A tool call gets the same signal but only some tools can act on one, so
 * the loop additionally RACES its wait against the stop: the run returns at
 * once and a tool that cannot be cancelled finishes into nothing. A stopped run
 * is not a failure — it is a run the user ended — so it comes back ok, carrying
 * whatever it had produced, with a note.
 */
export class ReActEngine extends Engine {
  static LABEL = 'react'
  static DEFAULT_RESPONSE = ReActResponse

  /**
   * `onStep`, `onPrompt`, `onDelta` and `onUsage` report each pass as it
   * happens, which is the only way a caller in another realm can see anything
   * before the loop finishes. They are the whole of the live view: the prompt
   * as it was sent, the reply as it arrives, the parsed result of each pass,
   * and what the pass cost.
   *
   * `budget` is a plain declaration — `{steps, tokens, seconds}` off an agent
   * file — and is turned into a fresh `Budget` here, per run. Passing the
   * limits rather than a counter is what stops one run's spending leaking into
   * the next.
   */
  async run(
    history,
    { multimodal = [], budget: declared, signal, onPrompt, onDelta, onStep, onUsage } = {},
  ) {
    // The agent's own working, kept apart from the conversation.
    //
    // This used to be pushed onto the history as alternating assistant and USER
    // turns, which told the model the user had said `Result: ...` — the user
    // said no such thing. A ReAct trace is the agent's scratchpad, not a
    // dialogue, and a model that reads its own tool output as something the
    // user typed will answer the wrong participant.
    const scratchpad = []
    const seen = new Map()
    const notes = []
    const budget = new Budget(declared)
    let last = null
    // Replies in a row that said nothing the loop could act on. Reset by any
    // reply that decides, and named for the streak rather than for the count so
    // it cannot be read as a total three lines from `last.isUnsaid`.
    let unsaidStreak = 0

    // Five exits: the agent answered, the user stopped it, a call to the model
    // failed, the budget ran out and the last word was not taken, or the model
    // twice in a row never said what it wanted to do. Every one of them is a
    // decision with a reason behind it, and every one says so.
    while (true) {
      if (signal?.aborted) return this.stopped(last, budget, notes)

      // The safety net, and reached one way: the previous turn was told in its
      // own prompt that it was the last and did not answer — it wrote a tool
      // call, or a reply the loop could read no decision from.
      // The tool is not run and the run does not pretend to have an answer —
      // returning the tool call as one is the silent truncation this exists to
      // avoid — but what the model wrote is QUOTED IN THE NOTE rather than only
      // carried on the Outcome's value. The value travelled here before and
      // `ChatService` dropped it, which made a comment promising that nothing
      // was thrown away into a comment describing a throw-away.
      if (budget.closing) {
        return new Outcome(
          false,
          last,
          new Failure(
            // Not INTERNAL: no part of this app is broken. The answer is simply
            // not available within the terms the run was given, which is the
            // same class of thing as an endpoint that never replied.
            Reason.UNAVAILABLE,
            `${this.constructor.LABEL}: ${budget.closing} ran out before the agent answered`,
            'The final turn was told it was the last and still did not answer. Raise the budget in the agent file, or ask for something narrower.',
          ),
          [
            ...notes,
            `stopped after ${budget.steps} steps: ${budget.closing} is spent and the last turn wrote ${quote(last)} instead of an answer`,
          ],
        )
      }

      // Decided BEFORE the prompt is assembled, because the whole point is for
      // the agent to read it in that prompt rather than discover it afterwards.
      budget.close()
      const at = budget.steps + 1
      const taken = await this.step(history, multimodal, {
        scratchpad,
        budget,
        signal,
        onPrompt: onPrompt ? (plan) => onPrompt({ step: at, ...plan }) : undefined,
        onDelta: onDelta ? (chunk, kind) => onDelta({ step: at, chunk, kind }) : undefined,
        onUsage: (usage) => {
          budget.measure(usage)
          onUsage?.({ step: at, ...usage })
        },
      })
      notes.push(...taken.notes)

      // BEFORE the abort check below, and this order is the whole of a defect
      // that shipped. A stream aborted mid-flight still comes back ok when text
      // had already arrived — `OpenAICompatible` returns the part that landed —
      // so a user pressing stop in the last second of a run had a COMPLETE,
      // PARSED reply in hand at this line. Assigning after the check discarded
      // it and the run then said "before the model had said anything", which
      // was a lie about a turn it was holding.
      if (taken.ok) {
        last = taken.value
        onStep?.({ step: budget.steps, parsed: last })
      }

      // Checked again after the call and not only before it: this is the branch
      // a mid-flight stop takes, and the transport's own failure — an aborted
      // fetch — must not be reported to the user as a broken endpoint.
      if (signal?.aborted) return this.stopped(last, budget, notes)

      // A transport failure ends the run and keeps its message and hint: it is
      // the most useful thing anyone can be shown, and retrying it here would
      // only make the user wait longer for the same answer.
      if (!taken.ok) return taken.withNote(`failed on step ${at}`)

      // A reply that never said what it wanted to do is not a turn, it is a turn
      // that did not finish, and ending on it was this loop's fail-open. It is
      // sent back rather than answered on — and the correction goes into the
      // SCRATCHPAD rather than into a block of its own, because the scratchpad is
      // the channel this loop already uses to inform instead of stopping, it is
      // already rendered into the next prompt, and a second place for a
      // correction to live is a second place for one to go missing.
      if (typeof last !== 'string' && last.isUnsaid) {
        unsaidStreak += 1
        if (unsaidStreak >= UNSAID_CEILING) return this.unreadable(last, budget, notes)
        // `act` is left out of the echo on purpose: it now reads `unsaid`, a
        // word the contract does not contain, and quoting it back would teach a
        // fourth verb. Read off the response's own class rather than a name
        // spelled here, so a contract with different fields still echoes them.
        const written = last.constructor
          .fieldNames()
          .filter((name) => name !== 'act' && String(last[name] ?? '').trim())
          .map((name) => `${name}: ${[last[name]].flat().join(', ')}`)
          .join(' | ')
        scratchpad.push({
          action: written
            ? `${last.unsaidBecause} — it had written ${quote(written, 400)}`
            : last.unsaidBecause,
          observation:
            "nothing was run and nothing was shown to the user. Reply again, and set act to exactly 'tool' or exactly 'answer'. If you were running out of room, keep think and plan short so the reply reaches act.",
        })
        continue
      }
      unsaidStreak = 0

      // A plain-text run has no `act` to read, so the first reply is the answer.
      if (typeof last === 'string' || last.isAnswer !== false) {
        return Outcome.ok(
          last,
          budget.steps > 1 ? [...notes, `answered after ${budget.steps} steps`] : notes,
        )
      }

      const action = String(last.answer).trim()
      const times = (seen.get(action) ?? 0) + 1
      seen.set(action, times)

      // Raced, not merely awaited. The signal goes into the tool as well, but a
      // tool that cannot act on one — the wasm guest, an MCP server mid-call —
      // would otherwise hold the whole run open for as long as it likes while
      // the user watches a button they already pressed. Measured before this
      // line existed: abort at 300 ms into a 1,500 ms tool, run returned at
      // 1,504 ms. The tool is not killed, because it cannot be; it finishes
      // into a scratchpad nobody will read.
      const observed = await Promise.race([this.observe(last, times, signal), until(signal)])
      if (signal?.aborted) return this.stopped(last, budget, notes)

      scratchpad.push({ action, observation: observed })
    }
  }

  /**
   * A run the user ended.
   *
   * Ok, not failed: nothing went wrong, somebody pressed stop. It carries
   * whatever the run had produced when it was stopped — which may be nothing at
   * all on a first step, and may be a half-finished tool call on a later one, so
   * a caller must read `isAnswer` before writing this down as a reply.
   */
  stopped(last, budget, notes) {
    return Outcome.ok(last, [
      ...notes,
      `you stopped this run after ${budget.steps} step(s)${last ? '' : ', before the model had said anything'}`,
    ])
  }

  /**
   * A run that ended because the model twice never said what it wanted to do.
   *
   * A failure and not an answer, and that distinction is the whole fix: what the
   * loop is holding is a half-written scratchpad, and every layer below this one
   * would render it as speech. UNAVAILABLE for the reason the budget's hard stop
   * uses it — nothing in this app is broken, the answer is simply not available
   * on the terms this run was given.
   *
   * WHY the model ran out of room is not this file's to say and it does not
   * guess. The transport classified the reply when it arrived and its note
   * travelled here with it — "the reply was cut off at the N-token limit after M
   * characters" — so `notes` already carries the cause beside the consequence,
   * on the channel the page renders. Nothing is carried on the value: the budget
   * stop's own comment records that `ChatService` drops it.
   *
   * WHICH way the last reply was unreadable IS this file's to say, and it says
   * it in the message rather than in a guess in the hint. There are two routes
   * into this ending and they have opposite remedies: a reply cut off before the
   * decision, where a ceiling is the lever, and `act: shell` — a complete reply
   * with a wrong word in it, where no ceiling anywhere is the cause and sending
   * the same request again produces the same word. `ReActResponse.normalize`
   * knows which happened and puts it on `unsaidBecause`.
   *
   * The hint names NO lever, and that is the correction rather than an omission.
   * An earlier version of it said "raise max tokens for this model" on both
   * routes. `OpenAICompatible` had already found and closed exactly that defect
   * one file over — its `RAISABLE` constant exists because the app's own default
   * is 131,072, so the one number a reader was sent to change was the one number
   * that could not be the cause — and this file holds neither `maxTokens` nor
   * that judgement. A second copy of it here is the second spelling of a rule
   * that then drifts. What this file knows is whether the reply was cut, and the
   * notes already say so.
   */
  unreadable(last, budget, notes) {
    return Outcome.failed(
      Reason.UNAVAILABLE,
      `${this.constructor.LABEL}: ${UNSAID_CEILING} replies in a row ended without saying whether to use a tool or to answer — ${last.unsaidBecause}`,
      {
        hint: "The notes say whether the endpoint cut each reply off, and at what ceiling; if it did, that ceiling is the lever. If it did not, the model wrote something in act that is neither 'tool' nor 'answer', and sending the same request again will not change that — ask for something narrower, or use a different model.",
        notes: [
          ...notes,
          `stopped after ${budget.steps} steps: ${UNSAID_CEILING} replies in a row ended before saying what to do, so nothing was run and nothing was shown`,
        ],
      },
    )
  }

  /**
   * What came back from acting.
   *
   * A repeat is answered without running anything: the outcome will not change,
   * and saying so is more useful to the agent than the same result again. This
   * is the loop's whole defence against going nowhere, and it works by
   * informing rather than by stopping — the agent still chooses what to do with
   * the information, including choosing to answer.
   */
  async observe(parsed, times = 1, signal = null) {
    if (times > 1) {
      return `this exact call was already made ${times - 1} time(s), so it was not run again — the result would be identical. Do something different: another tool, different arguments, or answer with what you have.`
    }
    if (!this.toolbox || this.toolbox.isEmpty) {
      return 'no tools are available. Answer with what you already know — set act to answer.'
    }
    const { observation } = await this.toolbox.run(String(parsed.answer), signal)
    return observation
  }
}
