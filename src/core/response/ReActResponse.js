import { BaseResponse } from './BaseResponse.js'

export const ACT_ANSWER = 'answer'
export const ACT_TOOL = 'tool'
/**
 * The third thing a reply can be: the model never said what it wanted to do.
 *
 * Not a word the model may write — nothing in the prompt mentions it — and not a
 * default. It is what `normalize` puts here when the reply reached the contract
 * and stopped before the decision, or wrote something in `act` that is not one.
 * `ReActEngine` is its only reader, and sending the turn back rather than ending
 * on it is the whole reason the value exists.
 */
export const ACT_UNSAID = 'unsaid'

/**
 * Think → plan → act → result. The loop ends when `act` is `answer`.
 *
 * The four descriptions below ARE the contract — there is no prose block behind
 * them any more. A per-subclass hook (`formatNotes`, since deleted along with
 * its last caller) used to add three things and each was measured out
 * (`docs/PROMPT-AUDIT.md`, 48 calls, three contracts differing in nothing else):
 *
 *   - a second statement of the `act` rule, at full length. The rule is stated
 *     once, here, in the field it governs.
 *   - a `CORRECT (final reply):` block. Its whole job was showing a real `act`
 *     value, which the generated `Example:` now does for free via `example`.
 *   - a `WRONG (never do this):` block, `act: echo({"text": "hello"})`. Nothing
 *     supports it: the arm carrying it and the arm without it both scored 0/16
 *     on the mistake it exists to prevent, and the arm with the *least* warning
 *     was one of the two zeros. It cost 33 tokens on every call for a failure
 *     that never happened, in front of a `normalize` that repairs it anyway.
 *
 * The `act` description is the one place a prohibition earns its keep, and it is
 * written as the consequence rather than as the ban — saying what `normalize`
 * does costs less than "never write a tool name here" and states a rule this
 * contract never had. What it says changed when the behaviour did: `act: shell`
 * used to end the run and show whatever sat in `result` to the user as the final
 * reply, and it now sends the turn back. Same field, same length, opposite
 * consequence; `normalize` is where the argument is.
 */
export class ReActResponse extends BaseResponse {
  static FIELDS = {
    think: {
      list: true,
      description:
        'Your private reasoning, one thought per item — `[a, b]`, or `[]` when nothing needs working out.',
    },
    plan: {
      list: true,
      description:
        'The concrete next steps, one per item, in order — `[a, b]`, or `[]` when the answer is already clear.',
    },
    act: {
      // No `default`. A default here is what made a reply that never reached
      // this field indistinguishable from one that chose to answer, and that
      // was the fail-open — see `normalize`. `example` is unchanged and
      // `default` never rendered, so the only prompt bytes this slice moved are
      // the description below: 89 characters to 88, stating the opposite
      // consequence at the same price.
      example: ACT_ANSWER,
      description:
        "Exactly 'tool' or exactly 'answer'. Any other word, or none, sends the turn back to you.",
    },
    result: {
      description:
        'When act is \'answer\': the reply shown to the user, self-contained. When act is \'tool\': the tool calls and nothing else — tool_name({"param": "value"}) — no explanation, no prose around them.',
    },
  }

  /**
   * Which of the three things this reply is, and the third one is why this
   * method takes what the parse supplied.
   *
   * Models routinely write the call itself into `act` and leave `result` empty.
   * Rescue that rather than losing the turn: the call moves to `result` and the
   * act becomes 'tool'.
   *
   * EVERYTHING ELSE USED TO BECOME AN ANSWER, and that was the loop's fail-open.
   * `act` carried `default: ACT_ANSWER`, so a reply that ran out of tokens before
   * it reached the field arrived here looking exactly like a reply that had
   * decided to answer — and the run ENDED, handing a half-written scratchpad to
   * the user as the reply. The comment that stood here called that accident "the
   * loop's most reliable terminator" and nobody had priced it. A blind panel
   * then did, from outside: three of five tasks, and the reference scaffold hit
   * the identical ceiling twice and recovered both times, because its parser
   * refused the fragment instead of accepting it.
   *
   * So there are three states, and the two bad ones are told apart by the SHAPE
   * of the reply rather than by a guess about its English:
   *
   *   - `act` was written and is neither verb and carries no call. `act: shell`
   *     is a tool name where a verb belongs: nothing to run, nothing decided.
   *   - `act` was never written, but a field DECLARED BEFORE IT was. The model
   *     was writing the contract and stopped part-way down it. This is what a
   *     truncated reply looks like — `test/support/fixtures/truncated-mid-
   *     contract.json` is one, captured off the endpoint: `think:` and half a
   *     `plan:`, no `act` line, `finish_reason: length`.
   *
   * Both are ACT_UNSAID and neither ends a run, and WHICH of the two it was is
   * kept on `unsaidBecause`, because the two need opposite words from the loop:
   * one ran out of room and a ceiling is worth naming, the other is a complete
   * reply with a wrong word in it and no ceiling anywhere is the reason for it.
   * `act` cannot carry that — it is a closed enum the loop switches on — and the
   * word the model wrote is overwritten two lines later, so it is kept here or
   * nowhere.
   *
   * A third shape is deliberately NOT unsaid: a reply that supplied nothing
   * before `act` at all — the last-resort branch of `BaseResponse.parse`, where
   * a model ignored the contract and simply spoke. Its words are the whole of
   * what it said, so it answers. Demanding a field it never used would spend a
   * turn correcting a reply that is already the answer.
   *
   * That branch is also the one exception to the `act` description's "or none",
   * and it is stated nowhere in the prompt on purpose, because the model cannot
   * reach it from inside the contract: replaying the 34 replies
   * `bench/transcripts/<task>/ours/` recorded off a real run, 10 took this
   * branch and all 10 were `Reply.THINKING` — refused by the transport before
   * `parse` ever sees them. Zero reached it in a form the app would parse. A
   * sentence spent describing an unreachable exception would cost tokens on
   * every call to prevent nothing.
   *
   * The strip on the first line is a repair with no rule behind it, and stays
   * one: `**Tool**`, `"answer"` and `` `ANSWER` `` all read as the bare verb.
   * The deleted "no markdown decoration" rule only ever covered field NAMES —
   * decoration on the act VALUE was never in the contract at all, and putting it
   * there would spend tokens on every call to describe a strip that costs
   * nothing.
   */
  normalize(given = {}) {
    // Read through `String` rather than off the field: a JSON reply can put a
    // number or an object in `act`, and `this.act.includes` on one of those is
    // the only line in this file that could throw.
    const written = String(this.act ?? '').trim()
    const action = written.replace(/^['"`*\s]+|['"`*\s]+$/g, '').toLowerCase()

    if (action === ACT_TOOL || action === ACT_ANSWER) {
      this.act = action
      return
    }
    if (written.includes('(') || written.includes('{')) {
      if (!String(this.result ?? '').trim()) this.result = written
      this.act = ACT_TOOL
      return
    }
    // Declaration order IS the contract's order, so "a field before `act`" is
    // "the model got this far and no further". Derived from `FIELDS` rather than
    // spelled `think`/`plan`, because a reorder must not quietly unmake the rule.
    const names = this.constructor.fieldNames()
    const stopped = names.slice(0, names.indexOf('act')).some((name) => name in given)
    if (!action && !stopped) {
      this.act = ACT_ANSWER
      return
    }
    // The word itself, not a class of word, because the loop quotes this back to
    // the model and to the user. Bounded: `act` can hold a whole sentence, and
    // an unbounded fragment here is rendered into every later prompt.
    this.unsaidBecause = action
      ? `the model wrote act: ${written.length > 60 ? `${written.slice(0, 57)}...` : written}, which is neither 'tool' nor 'answer'`
      : 'the reply stopped before it reached the act line'
    this.act = ACT_UNSAID
  }

  get isToolCall() {
    return this.act === ACT_TOOL
  }

  /**
   * Whether the run may end on this reply.
   *
   * `!this.isToolCall` was the fail-open written a second time: it said yes to a
   * reply that had decided nothing, and `ChatService` and `page.jsx` both read
   * this getter to decide whether a turn is a reply worth writing down.
   */
  get isAnswer() {
    return this.act === ACT_ANSWER
  }

  /** Neither. `unsaidBecause` says which of the two ways, in words. */
  get isUnsaid() {
    return this.act === ACT_UNSAID
  }
}
