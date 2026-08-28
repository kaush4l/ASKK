/**
 * The seven response contracts.
 *
 * A subclass only declares fields with descriptions — the field table IS the
 * contract — so the table below is the whole of each class, and every
 * `description`, along with `FORMAT_NOTES`, is the Python's bytes, unedited.
 * They are what the model reads. `tests/golden/` is the proof, and a byte that
 * differs is the port being wrong.
 *
 * The machinery is in `base.ts`; the scanners are in `parse.ts`.
 *
 * `ResponseContract`, the RESPONSE-slot component that puts one of these in a
 * prompt, is 2.6's and lives in `core/prompt/components.ts`.
 */

import { BaseResponse } from '@/core/response/base'
import type { Values } from '@/core/response/base'
import { bareWord } from '@/core/response/parse'

export const ANSWER = 'answer'
export const TOOL = 'tool'

/** Think, then answer. Only `response` is shown to the user. */
export class SimpleResponse extends BaseResponse {
  static override FIELDS = [
    { name: 'thinking', description: 'Your private reasoning. The user never sees this — think here, not in the answer.' },
    { name: 'response', description: 'The reply shown to the user. Self-contained, no meta-commentary about your reasoning.' },
  ]
}

/** First look at the query: how hard is it, and can it be said better? */
export class UnderstandResponse extends BaseResponse {
  static override FIELDS = [
    { name: 'think', list: true, description: 'Your private reasoning, one thought per item. Take as many items as the problem deserves; use [] when nothing needs working out.' },
    { name: 'complexity', default: 'complex', description: "Exactly 'simple' or 'complex'. 'simple' means one direct pass answers it; 'complex' means it needs planning. When unsure, say 'complex'." },
    { name: 'enhanced_query', description: "A rewritten, sharper version of the user's query — same intent, no ambiguity. Leave empty when the original is already as clear as it gets." },
  ]

  /** Force `complexity` to 'simple' or 'complex'; anything else takes the careful branch. */
  static override normalize(values: Values): void {
    const verdict = bareWord(String(values.complexity))
    values.complexity = verdict === 'simple' || verdict === 'complex' ? verdict : 'complex'
  }
}

/** Pick from the skill catalog: names only, nothing loads that is not named. */
export class SkillSelectResponse extends BaseResponse {
  static override FIELDS = [
    { name: 'think', list: true, description: 'Your private reasoning, one thought per item. Take as many items as the problem deserves; use [] when nothing needs working out.' },
    { name: 'skills', list: true, description: 'The names of the relevant skills, exactly as listed in the catalog, one per item. Use [] when none apply — loading nothing is a fine answer.' },
  ]
}

/** Turn the query into concrete ordered steps. */
export class PlanResponse extends BaseResponse {
  static override FIELDS = [
    { name: 'think', list: true, description: 'Your private reasoning, one thought per item. Take as many items as the problem deserves; use [] when nothing needs working out.' },
    { name: 'steps', list: true, description: 'The concrete steps, one per item, in the order they must run. Each step is self-contained enough to execute without re-reading the others.' },
  ]
}

/** Check the work against the plan and say plainly whether it holds. */
export class VerifyResponse extends BaseResponse {
  // The verdict routes the phase graph; the evidence is what a reader wants to see.
  static override ANSWER_FIELD = 'evidence'

  static override FIELDS = [
    { name: 'checks', list: true, description: 'The checks you actually ran, one per item, each with its outcome. A check you did not run does not belong here.' },
    { name: 'evidence', description: 'What you observed that supports the verdict — concrete output, not opinion.' },
    { name: 'verdict', default: 'fail', description: "Exactly 'pass' or 'fail'. 'pass' only when every check held; anything short of that is 'fail'." },
  ]

  /** Force `verdict` to 'pass' or 'fail'; anything else fails safe. */
  static override normalize(values: Values): void {
    const verdict = bareWord(String(values.verdict))
    values.verdict = verdict === 'pass' || verdict === 'fail' ? verdict : 'fail'
  }
}

/** Adversarial review: findings with severity, then a call to approve or revise. */
export class CritiqueResponse extends BaseResponse {
  // The verdict routes the phase graph; the findings are the substance.
  static override ANSWER_FIELD = 'findings'

  static override FIELDS = [
    { name: 'findings', list: true, description: "Each item is 'blocking: <finding>' or 'minor: <finding>'. Blocking means the work cannot ship as is. Use [] when there is genuinely nothing to raise." },
    { name: 'verdict', default: 'revise', description: "Exactly 'approve' or 'revise'. 'approve' only with no blocking findings; when in doubt, 'revise'." },
  ]

  /** Force `verdict` to 'approve' or 'revise'; anything else means another round. */
  static override normalize(values: Values): void {
    const verdict = bareWord(String(values.verdict))
    values.verdict = verdict === 'approve' || verdict === 'revise' ? verdict : 'revise'
  }
}

/**
 * The examples the model reads verbatim; a module constant so the method that
 * returns them stays a line long.
 */
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
\`\`\``

/** Think → plan → act → result. The loop ends when `act` is `answer`. */
export class ReActResponse extends BaseResponse {
  static override FIELDS = [
    { name: 'think', list: true, description: 'Your private reasoning, one thought per item. Take as many items as the problem deserves; use [] when nothing needs working out.' },
    { name: 'plan', list: true, description: 'The concrete next steps, one per item, in order. Use [] when the answer is already clear.' },
    { name: 'act', default: ANSWER, description: "Exactly 'tool' to call a tool, or exactly 'answer' to give the final reply. Never write a tool name here — 'act: echo' is always wrong." },
    { name: 'result', description: 'When act is \'answer\': the reply shown to the user, self-contained. When act is \'tool\': the tool calls and nothing else — tool_name({"param": "value"}) — no explanation, no prose around them. Calls that do not need each other\'s results go on one line separated by commas and run at the same time; a call that needs an earlier call\'s result goes on its own line, and lines run top to bottom.' },
  ]

  /**
   * Force `act` to 'tool' or 'answer'.
   *
   * Models routinely write the call itself into `act` (`act: echo({...})`) and
   * leave `result` empty. Rescue that instead of losing the turn: the call
   * moves to `result` and the act becomes 'tool'.
   */
  static override normalize(values: Values): void {
    const written = String(values.act)
    const action = bareWord(written)
    if (action === TOOL || action === ANSWER) {
      values.act = action
      return
    }
    if (written.includes('(') || written.includes('{')) {
      if (!String(values.result).trim()) values.result = written.trim()
      values.act = TOOL
    } else {
      values.act = ANSWER
    }
  }

  static override formatNotes(): string {
    return FORMAT_NOTES
  }

  get action(): string {
    return String(this.value('act')).trim().toLowerCase()
  }

  get isToolCall(): boolean {
    return this.action === TOOL
  }

  override get isAnswer(): boolean {
    return !this.isToolCall
  }
}

/** Frontmatter name -> class, for `agents/<name>/agent.md`. */
export const RESPONSE_MODELS = {
  simple: SimpleResponse,
  react: ReActResponse,
  understand: UnderstandResponse,
  skill_select: SkillSelectResponse,
  plan: PlanResponse,
  verify: VerifyResponse,
  critique: CritiqueResponse,
} as const

export type ResponseModelName = keyof typeof RESPONSE_MODELS

export function getResponseModel(name: string): (typeof RESPONSE_MODELS)[ResponseModelName] {
  const found = RESPONSE_MODELS[name as ResponseModelName]
  if (!found) {
    throw new Error(`Unknown response model '${name}'. Known: ${Object.keys(RESPONSE_MODELS).join(', ')}`)
  }
  return found
}
