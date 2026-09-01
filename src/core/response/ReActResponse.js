import { BaseResponse } from './BaseResponse.js'

export const ACT_ANSWER = 'answer'
export const ACT_TOOL = 'tool'

/** Think → plan → act → result. The loop ends when `act` is `answer`. */
export class ReActResponse extends BaseResponse {
  static FIELDS = {
    think: {
      list: true,
      description:
        'Your private reasoning, one thought per item. Take as many items as the problem deserves; use [] when nothing needs working out.',
    },
    plan: {
      list: true,
      description:
        'The concrete next steps, one per item, in order. Use [] when the answer is already clear.',
    },
    act: {
      default: ACT_ANSWER,
      description:
        "Exactly 'tool' to call a tool, or exactly 'answer' to give the final reply. Never write a tool name here — 'act: echo' is always wrong.",
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

  static formatNotes() {
    return [
      "The 'act' field is a single word — 'tool' or 'answer' — never a tool name and never a call.",
      '',
      'CORRECT (final reply):',
      '```',
      'act: answer',
      '',
      "result: The heading says 'Example Domain'.",
      '```',
      '',
      'WRONG (never do this):',
      '```',
      'act: echo({"text": "hello"})',
      '',
      'result:',
      '```',
    ].join('\n')
  }

  get isToolCall() {
    return this.act === ACT_TOOL
  }

  get isAnswer() {
    return !this.isToolCall
  }
}
