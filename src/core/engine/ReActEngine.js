import { Outcome } from '../Outcome.js'
import { ReActResponse } from '../response/ReActResponse.js'
import { Engine } from './Engine.js'

/**
 * Think → act → observe, until the agent says it is done.
 *
 * The loop reads one field of the parsed response: `act`. While it says `tool`
 * the turn is an action and the loop goes round; when it says `answer` the run
 * is over. Nothing else about the reply steers control flow, which is why a
 * malformed act is repaired in `ReActResponse.normalize` rather than here — a
 * loop that has to second-guess its own contract has two contracts.
 *
 * THE AGENT DECIDES WHEN THE WORK IS DONE. There is no step ceiling and no
 * repeat ceiling. A counter cannot tell the difference between an agent that is
 * stuck and an agent that is three steps into something that needs nine, so a
 * counter ending the run is a guess overruling the only party that knows.
 *
 * What replaces a ceiling is telling the agent what it is doing. A repeated
 * call is not executed again — the result would be identical — and the
 * observation says so. That is a fact it can act on, where a forced stop is
 * merely something that happens to it.
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
   */
  async run(history, { multimodal = [], onPrompt, onDelta, onStep, onUsage } = {}) {
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
    let last = null
    let step = 0

    // The only exits: the agent answered, or a call to the model failed. Both
    // are decisions with a reason behind them.
    while (true) {
      const at = step + 1
      const taken = await this.step(history, multimodal, {
        scratchpad,
        onPrompt: onPrompt ? (plan) => onPrompt({ step: at, ...plan }) : undefined,
        onDelta: onDelta ? (chunk, kind) => onDelta({ step: at, chunk, kind }) : undefined,
        onUsage: onUsage ? (usage) => onUsage({ step: at, ...usage }) : undefined,
      })
      notes.push(...taken.notes)
      // A transport failure ends the run and keeps its message and hint: it is
      // the most useful thing anyone can be shown, and retrying it here would
      // only make the user wait longer for the same answer.
      if (!taken.ok) return taken.withNote(`failed on step ${at}`)

      last = taken.value
      step++
      onStep?.({ step, parsed: last })

      // A plain-text run has no `act` to read, so the first reply is the answer.
      if (typeof last === 'string' || last.isAnswer !== false) {
        return Outcome.ok(last, step > 1 ? [...notes, `answered after ${step} steps`] : notes)
      }

      const action = String(last.answer).trim()
      const times = (seen.get(action) ?? 0) + 1
      seen.set(action, times)

      scratchpad.push({ action, observation: await this.observe(last, times) })
    }
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
