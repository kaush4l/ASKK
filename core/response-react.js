/**
 * The react contract — think → plan → act → result.
 *
 * Its own file because its `formatNotes` block is fifty lines of examples the
 * model reads verbatim, and `core/responses.js` cannot hold both that and the
 * other six classes inside 200 lines.
 */

import { BaseResponse } from "./response-base.js";
import { bareWord } from "./response-parse.js";

/** @typedef {import("./response-base.js").Values} Values */

export const ANSWER = "answer";
export const TOOL = "tool";

/** The examples the model reads verbatim; a module constant so the method that
 * returns them stays a line long. */
const FORMAT_NOTES = `The 'act' field is a single word — 'tool' or 'answer' — never a tool name and never a call.

CORRECT (calling a tool):
\`\`\`
act: tool

result: echo({"text": "hello"})
\`\`\`

WRONG (never do this):
\`\`\`
act: echo({"text": "hello"})

result:
\`\`\`

CORRECT (two calls that do not need each other — one line, run together):
\`\`\`
act: tool

result: get_weather({"city": "Paris"}), get_weather({"city": "Tokyo"})
\`\`\`

CORRECT (the second needs the first to have happened — own line, runs after):
\`\`\`
act: tool

result: navigate_page({"url": "https://example.com"})
take_snapshot()
\`\`\`

Never write a call whose arguments you do not know yet — do that one in a later turn, once you have read the result you need.

CORRECT (final reply):
\`\`\`
act: answer

result: The heading says 'Example Domain'.
\`\`\``;

/** Think → plan → act → result. The loop ends when `act` is `answer`. */
export class ReActResponse extends BaseResponse {
  static FIELDS = [
    { name: "think", list: true, description: "Your private reasoning, one thought per item. Take as many items as the problem deserves; use [] when nothing needs working out." },
    { name: "plan", list: true, description: "The concrete next steps, one per item, in order. Use [] when the answer is already clear." },
    { name: "act", default: ANSWER, description: "Exactly 'tool' to call a tool, or exactly 'answer' to give the final reply. Never write a tool name here — 'act: echo' is always wrong." },
    { name: "result", description: "When act is 'answer': the reply shown to the user, self-contained. When act is 'tool': the tool calls and nothing else — tool_name({\"param\": \"value\"}) — no explanation, no prose around them. Calls that do not need each other's results go on one line separated by commas and run at the same time; a call that needs an earlier call's result goes on its own line, and lines run top to bottom." },
  ];

  /**
   * Force `act` to 'tool' or 'answer'.
   *
   * Models routinely write the call itself into `act` (`act: echo({...})`)
   * and leave `result` empty. Rescue that instead of losing the turn: the
   * call moves to `result` and the act becomes 'tool'.
   *
   * @param {Values} values @returns {void}
   */
  static normalize(values) {
    const written = String(values.act);
    const action = bareWord(written);
    if (action === TOOL || action === ANSWER) {
      values.act = action;
      return;
    }
    if (written.includes("(") || written.includes("{")) {
      if (!String(values.result).trim()) values.result = written.trim();
      values.act = TOOL;
    } else {
      values.act = ANSWER;
    }
  }

  /** @returns {string} */
  static formatNotes() { return FORMAT_NOTES; }

  /** @returns {string} */
  get action() {
    return String(this.value("act")).trim().toLowerCase();
  }

  /** @returns {boolean} */
  get isToolCall() {
    return this.action === TOOL;
  }

  /** @returns {boolean} */
  get isAnswer() {
    return !this.isToolCall;
  }
}
