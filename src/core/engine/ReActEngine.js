import { Failure, Outcome, Reason } from '../Outcome.js'
import { ReActResponse } from '../response/ReActResponse.js'
import { Budget } from './Budget.js'
import { Engine } from './Engine.js'

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
 * argument in full, and this loop is the three consequences of it, in order of
 * how much they matter:
 *
 *   1. The budget block, present from the first step. This is the mechanism,
 *      and it is a fact in the prompt rather than a number in the loop.
 *   2. A LAST WORD. When the next step would exhaust the budget, the block says
 *      so in plain words BEFORE that step is sent, and the agent gets one turn
 *      to answer with what it has. A run should end with an answer, not with a
 *      severed rope.
 *   3. A hard stop behind that, for the agent that was told this was its last
 *      turn and called a tool anyway. It is a safety net and not the mechanism,
 *      and it never truncates silently: the run fails, naming which budget ran
 *      out and saying that the final turn did not answer.
 *
 * And the loop can be stopped from outside. `signal` is the user's, and it goes
 * all the way to the transport rather than being polled between iterations,
 * because a flag checked on the way round still leaves a model call open on the
 * network. A stopped run is not a failure — it is a run the user ended — so it
 * comes back ok, carrying whatever it had produced, with a note.
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
    const budget = declared instanceof Budget ? declared : new Budget(declared ?? {})
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
      // avoid — but the parsed turn travels with the failure so nothing the
      // model produced is thrown away.
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
            `stopped after ${budget.steps} steps: ${budget.closing} is spent and the last turn did not answer`,
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

      // Checked again after the call and not only before it: this is the branch
      // a mid-flight stop takes, and the transport's own failure — an aborted
      // fetch — must not be reported to the user as a broken endpoint.
      if (signal?.aborted) return this.stopped(last, budget, notes)

      // A transport failure ends the run and keeps its message and hint: it is
      // the most useful thing anyone can be shown, and retrying it here would
      // only make the user wait longer for the same answer.
      if (!taken.ok) return taken.withNote(`failed on step ${at}`)

      last = taken.value
      onStep?.({ step: budget.steps, parsed: last })

      // A plain-text run has no `act` to read, so the first reply is the answer.
      if (typeof last === 'string' || last.isAnswer !== false) {
        const done = budget.steps > 1 ? `answered after ${budget.steps} steps` : ''
        return Outcome.ok(last, done ? [...notes, done] : notes)
      }

      const action = String(last.answer).trim()
      const times = (seen.get(action) ?? 0) + 1
      seen.set(action, times)

      scratchpad.push({ action, observation: await this.observe(last, times) })
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
  async observe(parsed, times = 1) {
    if (times > 1) {
      return `this exact call was already made ${times - 1} time(s), so it was not run again — the result would be identical. Do something different: another tool, different arguments, or answer with what you have.`
    }
    if (!this.toolbox || this.toolbox.isEmpty) {
      return 'no tools are available. Answer with what you already know — set act to answer.'
    }
    const { observation } = await this.toolbox.run(String(parsed.answer))
    return observation
  }
}
