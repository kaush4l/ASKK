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
 */
function quote(last) {
  const text = last === null ? '' : typeof last === 'string' ? last : String(last.answer ?? '')
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'nothing at all'
  return `"${trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed}"`
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
 *      turn and called a tool anyway. It is a safety net and not the mechanism,
 *      and it never truncates silently: the run fails, naming which budget ran
 *      out and quoting what the final turn wrote instead of an answer.
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

    // Four exits: the agent answered, the user stopped it, a call to the model
    // failed, or the budget ran out and the last word was not taken. Every one
    // of them is a decision with a reason behind it, and every one says so.
    while (true) {
      if (signal?.aborted) return this.stopped(last, budget, notes)

      // The safety net, and reached only one way: the previous turn was told in
      // its own prompt that it was the last and wrote a tool call regardless.
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
            'The final turn was told it was the last and called a tool anyway. Raise the budget in the agent file, or ask for something narrower.',
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
