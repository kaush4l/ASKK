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
 * What the loop tells the model about a reply that never left the scratchpad.
 *
 * The transport refuses two of the four states a reply can be in — the
 * scratchpad dumped onto the answer channel, and the tokens spent before an
 * answer began — and hands the loop nothing but the refusal. Both are the same
 * fact from this seat: the whole reply went on reasoning, nothing was decided.
 * So they get one sentence, and it is written HERE rather than taken off the
 * refusal, because the refusal's message is for the person reading the notes
 * (it names a character count and a channel) and this is for the model.
 *
 * The streak is shared with the unsaid reply and so is the ceiling, and that
 * is a decision rather than a shortcut. A reply cut off inside `plan:` and a
 * reply cut off inside its reasoning are the same failure one token apart —
 * the model ran out of room before the decision — and a loop that counted them
 * on two streaks would spend two corrections on it, where `UNSAID_CEILING`'s
 * whole argument is that the record needed one. The ending's hint already
 * points at the ceiling for the cut route; the overrun route puts the
 * transport's own remedy in the notes beside it. A third ending would have to
 * say something neither of those two says, and it does not.
 *
 * The sentence names the limit because it is the one number the model can
 * plan against, and it asks for less reasoning rather than for a shorter
 * answer, because an answer was never started. Whether the model obeys was
 * measured, not assumed — the counts sit beside the observation in `run`,
 * where the words are.
 */
const OVERRAN =
  'the reply ran out of tokens inside its private reasoning, before it wrote act or result'

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
 * The same ending has a second door, and for one wave it was walled up. A reply
 * that ran out of tokens INSIDE its reasoning never reaches the parser — the
 * transport refuses it, rightly — and the refusal arrived here as a transport
 * failure, so the run ended on it as if the endpoint had gone away. It had not:
 * the endpoint reported, correctly, that the model spent its whole reply
 * thinking. `Reason.OVERRUN` is how the transport now says which of the two it
 * was, and the loop treats it as one more unsaid reply: same sentence back
 * through the scratchpad, same streak, same ceiling. `OVERRAN` above is the
 * argument for sharing them.
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
   * and what the pass cost. EVERY pass gets its `onStep`, including the one
   * whose reply the transport refused — its `parsed` is `null`, because that is
   * what the loop is holding — so a view counting steps agrees with `Budget`.
   *
   * `budget` is a plain declaration — `{steps, tokens, seconds}` off an agent
   * file — and is turned into a fresh `Budget` here, per run. Passing the
   * limits rather than a counter is what stops one run's spending leaking into
   * the next.
   */
  async run(
    history,
    {
      multimodal = [],
      budget: declared,
      signal,
      onPrompt,
      onDelta,
      onStep,
      onObservation,
      onUsage,
    } = {},
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
    // Replies in a row that said nothing the loop could act on — cut before the
    // decision, wrong word in `act`, or never out of the scratchpad at all.
    // Reset by any reply that decides, and named for the streak rather than for
    // the count so it cannot be read as a total three lines from `last.isUnsaid`.
    let unsaidStreak = 0
    // Whether this agent's declared check has been run for this run. One per
    // run, not one per answer: see the answer branch below.
    let checked = false

    // Five exits: the agent answered, the user stopped it, a call to the model
    // failed, the budget ran out and the last word was not taken, or the model
    // twice in a row never said what it wanted to do — by any of the three
    // routes into that. Every one of them is a decision with a reason behind
    // it, and every one says so.
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

      // A reply that never got out of the model's scratchpad. The transport
      // withheld the text and said so; what it said goes to the notes, in its
      // own words and with its own remedy, because it is the only thing that
      // knows the character count, the channel and the ceiling. What the MODEL
      // is told is `OVERRAN`, and it is told through the same door as the reply
      // below that reached the contract and stopped short of the decision.
      if (!taken.ok && taken.failure.code === Reason.OVERRUN) {
        // Nothing readable came back, so nothing is held: left standing, the
        // previous turn's reply would be quoted by the hard stop as if this
        // turn had written it. Below the abort check, not above it, so a stop
        // that lands on this turn reports the run the way a stop landing on a
        // dead fetch does — carrying the last reply it had — rather than
        // "before the model had said anything" after a run that made tool
        // calls. Nothing awaits between here and the top of the loop, so no
        // stop can find the null before the next call has been made; a stop
        // landing on THAT call finds it, and says the model had said nothing
        // when it had, one overrun ago. Named rather than fixed: the fix is a
        // second piece of state beside `last`, kept for one sentence of one
        // note the refusal beside it already explains.
        last = null
        // The pass happened — `Budget` counted it, `onUsage` billed it,
        // `onPrompt` announced it — so the live view is told it ended, holding
        // nothing. A view that clears the streamed reasoning on STEP would
        // otherwise leave this turn's scratchpad on screen under the next
        // turn's, and count one step fewer than the budget did.
        onStep?.({ step: budget.steps, parsed: null })
        notes.push(`${taken.failure.message} — ${taken.failure.hint}`)
        unsaidStreak += 1
        if (unsaidStreak >= UNSAID_CEILING) return this.unreadable(OVERRAN, budget, notes)
        // The observation is MEASURED and every word of it is load-bearing.
        // Against the real endpoint on the task that overruns — median-bug,
        // 1,200 tokens, thinking on — this sentence recovered the next turn
        // 10 of 10 times across four seats; the same prompt sent again with no
        // sentence overran 6 of 6, a neutral "reply again" note of the same
        // length overran 2 of 2, and four shorter versions of this sentence —
        // the number cut, the last sentence cut, both cut, a bare "nothing was
        // run, reply again" — overran 12 of 12. Change a word and re-measure;
        // the test pins the bytes. The limit is read off the inference rather
        // than handed in, because every `Inference` has one and `step` fails
        // without one before a reply can exist. It is named to the MODEL as a
        // quantity to plan against — not to the user as a lever, which is the
        // judgement `unreadable` refuses to make and `OpenAICompatible`'s
        // `_remedies` makes with the measurement behind it.
        scratchpad.push({
          action: OVERRAN,
          observation: `nothing was run and nothing was shown to the user: the whole ${this.inference.maxTokens.toLocaleString('en-US')}-token reply limit went on reasoning. Reply again and reason briefly — decide in a sentence or two, then write act and result. If the task is large, do one small part of it this turn and leave the rest for later turns.`,
        })
        continue
      }

      // A transport failure ends the run and keeps its message and hint: it is
      // the most useful thing anyone can be shown, and retrying it here would
      // only make the user wait longer for the same answer. That sentence was
      // once written over the overrun too, and it is only true of this branch:
      // a dead endpoint gets the same request again, an overrun does not.
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
        if (unsaidStreak >= UNSAID_CEILING)
          return this.unreadable(last.unsaidBecause, budget, notes)
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
        // The agent's own check, run ONCE, before this answer is allowed to be
        // the end of the run.
        //
        // Who judges it is the whole design question, and the answer here is:
        // not this loop. A check's output is a test runner's summary, a
        // linter's silence, an exit status — reading pass or fail out of that
        // text would be this file guessing at a vocabulary it does not own, and
        // guessing wrong means either an answer thrown away or a broken one
        // waved through. So the result goes back to the agent, which has the
        // task, the code and the output in front of it, and the next reply is
        // an answer that has seen its own test rather than one that never ran.
        //
        // Once, and only once, because a check the agent keeps failing would
        // otherwise spend the whole budget on it — and because the second
        // answer is already an answer written in the knowledge of the result.
        // Skipped when the budget is closing: the last turn was told it is the
        // last, and spending its final step on a check would end the run with
        // no answer at all, which is worse than an unchecked one.
        // Said out loud when the terms of the run swallowed it. An author who
        // declared a check and a one-step budget has claimed a test that never
        // runs, and silence there is the same defect as a `max_steps` that
        // stopped a run without telling anyone.
        if (this.check && !checked && budget.closing) {
          checked = true
          notes.push(
            `this agent's check did not run: the ${budget.closing} budget was spent, and the last turn is for answering`,
          )
        }
        if (this.check && !checked && this.toolbox && !this.toolbox.isEmpty && !budget.closing) {
          checked = true
          const ran = await Promise.race([this.toolbox.run(this.check, signal), until(signal)])
          if (signal?.aborted) return this.stopped(last, budget, notes)
          notes.push(`ran this agent's check: ${this.check}`)
          scratchpad.push({
            action: this.check,
            observation: `${ran?.observation ?? ''}\n\nThat is this agent's own check, run because you were about to finish. Read it: if it shows your work is done and correct, answer now. If it shows a problem, fix that first.`,
          })
          continue
        }
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
      // The other half of a tool call, and until this line it went nowhere but
      // into the next prompt. `onStep` reports what the model WROTE; this
      // reports what the machine ANSWERED, against the same step number, so a
      // reader outside the engine can see both halves of the pass. Emitted
      // after the abort check above: a run the user stopped has an observation
      // nobody is waiting for, and announcing it would draw a result under a
      // step on a turn that is already over.
      onObservation?.({ step: budget.steps, action, observation: observed })
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
   * it in the message rather than in a guess in the hint. There are three routes
   * into this ending and two kinds of cause between them: a reply cut off
   * before the decision or one that never left its reasoning, where the model
   * ran out of room, and `act: shell` — a complete reply with a wrong word in
   * it, where no ceiling anywhere is the cause and sending the same request
   * again produces the same word. `ReActResponse.normalize` knows the first
   * from the third and puts it on `unsaidBecause`; the second never reaches it,
   * and the loop names that one itself, with `OVERRAN`.
   *
   * The hint names NO lever, and that is the correction rather than an omission.
   * An earlier version of it said "raise max tokens for this model" on both
   * routes, and the version after that said "that ceiling is the lever" while
   * the note beside it — the transport's, pushed by the overrun branch — could
   * be saying "raising it is not the answer". `OpenAICompatible` had already
   * found and closed exactly that defect one file over — its `RAISABLE`
   * constant exists because the app's own default is 131,072, so the one number
   * a reader was sent to change was the one number that could not be the cause
   * — and this file holds neither `maxTokens` nor that judgement. A second copy
   * of it here is the second spelling of a rule that then drifts, and one
   * Outcome arguing with itself is what it drifted into. What this file knows
   * is that the notes say what happened to each reply, so the hint sends the
   * reader there and asserts nothing about the remedy.
   */
  unreadable(because, budget, notes) {
    return Outcome.failed(
      Reason.UNAVAILABLE,
      `${this.constructor.LABEL}: ${UNSAID_CEILING} replies in a row ended without saying whether to use a tool or to answer — ${because}`,
      {
        hint: "The notes say what happened to each reply: cut off at a ceiling the note names, or spent inside the model's reasoning with the transport's own remedy beside it. If they say neither, the model wrote something in act that is neither 'tool' nor 'answer', and sending the same request again will not change that — ask for something narrower, or use a different model.",
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
    // A tool may declare that asking it twice is the point. `check_task` does:
    // it reports whether another agent has finished YET, so the second poll is
    // a different question wearing the same words, and the sentence below —
    // "the result would be identical" — is false about it rather than merely
    // unhelpful. Everything else is guarded exactly as before.
    if (times > 1 && this.toolbox?.isRepeatable?.(String(parsed.answer))) {
      return (await this.toolbox.run(String(parsed.answer), signal)).observation
    }
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
