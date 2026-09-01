import { BaseResponse } from './BaseResponse.js'

export const ACT_ANSWER = 'answer'
export const ACT_TOOL = 'tool'

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
 * The `act` description is the one place a prohibition earns its keep, and it
 * has been rewritten as the consequence rather than the ban. "Any other word is
 * read as 'answer' and ends the turn" is literally what `normalize` does below,
 * and saying so costs less than "never write a tool name here" while also
 * writing down a rule this contract never had: today `act: shell` silently ends
 * the run and shows whatever is in `result` to the user as the final reply.
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
      default: ACT_ANSWER,
      example: ACT_ANSWER,
      description:
        "Exactly 'tool' or exactly 'answer'. Any other word is read as 'answer' and ends the turn.",
    },
    result: {
      description:
        'When act is \'answer\': the reply shown to the user, self-contained. When act is \'tool\': the tool calls and nothing else — tool_name({"param": "value"}) — no explanation, no prose around them.',
    },
  }

  /**
   * Models routinely write the call itself into `act` and leave `result` empty.
   * Rescue that rather than losing the turn: the call moves to `result` and the
   * act becomes 'tool'.
   *
   * The last branch is a repair the prompt never described, and it is the one
   * with teeth: a word that is neither of the two verbs and carries no bracket
   * becomes 'answer', which ends the run. `act: shell` — a model naming a tool
   * where a verb belongs — therefore terminates the turn and shows `result` to
   * the user as the final reply, and today that accident is the loop's most
   * reliable terminator. The fix has two halves and only one of them lives here:
   * the `act` description above now says out loud that any other word ends the
   * turn, so it is a rule and not a trap. The other half is the engine noticing
   * that a run ended this way and saying so, which this file cannot do.
   *
   * The strip on the first line is a repair with no rule behind it, and stays
   * one: `**Tool**`, `"answer"` and `` `ANSWER` `` all read as the bare verb.
   * The deleted "no markdown decoration" rule only ever covered field NAMES —
   * decoration on the act VALUE was never in the contract at all, and putting it
   * there would spend tokens on every call to describe a strip that costs
   * nothing.
   */
  normalize() {
    const action = String(this.act ?? '')
      .trim()
      .replace(/^['"`*\s]+|['"`*\s]+$/g, '')
      .toLowerCase()

    if (action === ACT_TOOL || action === ACT_ANSWER) {
      this.act = action
      return
    }
    if (this.act.includes('(') || this.act.includes('{')) {
      if (!String(this.result ?? '').trim()) this.result = this.act.trim()
      this.act = ACT_TOOL
    } else {
      this.act = ACT_ANSWER
    }
  }

  get isToolCall() {
    return this.act === ACT_TOOL
  }

  get isAnswer() {
    return !this.isToolCall
  }
}
