/**
 * The seven response contracts, and the component that puts one in a prompt.
 *
 * Six are here; `ReActResponse` is in `core/response-react.js`.
 *
 * A subclass only declares fields with descriptions — the field set IS the
 * contract (PORT-MAP R1), so the table below is the whole of each class and
 * every `description` is the Python's bytes, unedited. They are what the model
 * reads, and `tests/golden/render-bare.prompt` is the proof.
 *
 * The machinery lives in `core/response-base.js`.
 */

import { Component, Slot } from "./component-base.js";
import { BaseResponse, DEFAULT_FORMAT } from "./response-base.js";
import { bareWord } from "./response-parse.js";
import { ReActResponse } from "./response-react.js";

export { BaseResponse, DEFAULT_FORMAT, JSON_FORMAT, TOON } from "./response-base.js";
export { ANSWER, ReActResponse, TOOL } from "./response-react.js";

/** @typedef {import("./response-base.js").Values} Values */

/** Think, then answer. Only `response` is shown to the user. */
export class SimpleResponse extends BaseResponse {
  static FIELDS = [
    { name: "thinking", description: "Your private reasoning. The user never sees this — think here, not in the answer." },
    { name: "response", description: "The reply shown to the user. Self-contained, no meta-commentary about your reasoning." },
  ];
}

/** First look at the query: how hard is it, and can it be said better? */
export class UnderstandResponse extends BaseResponse {
  static FIELDS = [
    { name: "think", list: true, description: "Your private reasoning, one thought per item. Take as many items as the problem deserves; use [] when nothing needs working out." },
    { name: "complexity", default: "complex", description: "Exactly 'simple' or 'complex'. 'simple' means one direct pass answers it; 'complex' means it needs planning. When unsure, say 'complex'." },
    { name: "enhanced_query", description: "A rewritten, sharper version of the user's query — same intent, no ambiguity. Leave empty when the original is already as clear as it gets." },
  ];

  /** Force `complexity` to 'simple' or 'complex'; anything else takes the careful branch.
   * @param {Values} values @returns {void} */
  static normalize(values) {
    const verdict = bareWord(String(values.complexity));
    values.complexity = verdict === "simple" || verdict === "complex" ? verdict : "complex";
  }
}

/** Pick from the skill catalog: names only, nothing loads that is not named. */
export class SkillSelectResponse extends BaseResponse {
  static FIELDS = [
    { name: "think", list: true, description: "Your private reasoning, one thought per item. Take as many items as the problem deserves; use [] when nothing needs working out." },
    { name: "skills", list: true, description: "The names of the relevant skills, exactly as listed in the catalog, one per item. Use [] when none apply — loading nothing is a fine answer." },
  ];
}

/** Turn the query into concrete ordered steps. */
export class PlanResponse extends BaseResponse {
  static FIELDS = [
    { name: "think", list: true, description: "Your private reasoning, one thought per item. Take as many items as the problem deserves; use [] when nothing needs working out." },
    { name: "steps", list: true, description: "The concrete steps, one per item, in the order they must run. Each step is self-contained enough to execute without re-reading the others." },
  ];
}

/** Check the work against the plan and say plainly whether it holds. */
export class VerifyResponse extends BaseResponse {
  // The verdict routes the phase graph; the evidence is what a reader wants to see.
  static ANSWER_FIELD = "evidence";

  static FIELDS = [
    { name: "checks", list: true, description: "The checks you actually ran, one per item, each with its outcome. A check you did not run does not belong here." },
    { name: "evidence", description: "What you observed that supports the verdict — concrete output, not opinion." },
    { name: "verdict", default: "fail", description: "Exactly 'pass' or 'fail'. 'pass' only when every check held; anything short of that is 'fail'." },
  ];

  /** Force `verdict` to 'pass' or 'fail'; anything else fails safe.
   * @param {Values} values @returns {void} */
  static normalize(values) {
    const verdict = bareWord(String(values.verdict));
    values.verdict = verdict === "pass" || verdict === "fail" ? verdict : "fail";
  }
}

/** Adversarial review: findings with severity, then a call to approve or revise. */
export class CritiqueResponse extends BaseResponse {
  // The verdict routes the phase graph; the findings are the substance.
  static ANSWER_FIELD = "findings";

  static FIELDS = [
    { name: "findings", list: true, description: "Each item is 'blocking: <finding>' or 'minor: <finding>'. Blocking means the work cannot ship as is. Use [] when there is genuinely nothing to raise." },
    { name: "verdict", default: "revise", description: "Exactly 'approve' or 'revise'. 'approve' only with no blocking findings; when in doubt, 'revise'." },
  ];

  /** Force `verdict` to 'approve' or 'revise'; anything else means another round.
   * @param {Values} values @returns {void} */
  static normalize(values) {
    const verdict = bareWord(String(values.verdict));
    values.verdict = verdict === "approve" || verdict === "revise" ? verdict : "revise";
  }
}

/** Frontmatter name -> class, for agents/<name>/agent.md
 * @type {Record<string, typeof BaseResponse>} */
export const RESPONSE_MODELS = {
  simple: SimpleResponse,
  react: ReActResponse,
  understand: UnderstandResponse,
  skill_select: SkillSelectResponse,
  plan: PlanResponse,
  verify: VerifyResponse,
  critique: CritiqueResponse,
};

/** @param {string} name @returns {typeof BaseResponse} */
export function getResponseModel(name) {
  const found = RESPONSE_MODELS[name];
  if (!found) {
    throw new Error(`Unknown response model '${name}'. Known: ${Object.keys(RESPONSE_MODELS).join(", ")}`);
  }
  return found;
}

// ── the response component ───────────────────────────────────────────────

/** @type {Map<typeof BaseResponse, Map<string, string>>} */
const RENDERED = new Map();

/**
 * A model's rendered instructions, computed once per (class, format).
 *
 * `instructions` walks the field table and formats an example every call; the
 * result never changes for a given class, so a turn-by-turn rebuild is pure
 * waste. Cached here rather than on the class so a subclass declared in a test
 * can still bust it by being a new class.
 *
 * @param {typeof BaseResponse | null} model @param {string} fmt @returns {string}
 */
function instructionsText(model, fmt) {
  if (!model) return "";
  let byFormat = RENDERED.get(model);
  if (!byFormat) {
    byFormat = new Map();
    RENDERED.set(model, byFormat);
  }
  let text = byFormat.get(fmt);
  if (text === undefined) {
    text = model.instructions(fmt).trim();
    byFormat.set(fmt, text);
  }
  return text;
}

/** RESPONSE-slot component: the structured-response instructions plus the completion cue. */
export class ResponseContract extends Component {
  static SLOT = Slot.RESPONSE;
  static TEMPLATE = "{% if instructions %}{{ instructions }}\n\n{% endif %}{{ cue }}";
  static FIELDS = ["priority", "instructions", "cue"];
  static NAME = "ResponseContract";

  /** @param {{ priority?: number, instructions?: string, cue?: string }} [data] */
  constructor(data = {}) {
    super({ priority: data.priority });
    /** @type {string} */
    this.instructions = data.instructions ?? "";
    /** @type {string} */
    this.cue = data.cue ?? "[ASSISTANT]:";
    Object.freeze(this);
  }

  /** Build from a response model — or from none, leaving just the cue.
   * @param {typeof BaseResponse | null} model @param {string} [fmt] @param {string} [cue]
   * @returns {ResponseContract} */
  static of(model, fmt = DEFAULT_FORMAT, cue = "[ASSISTANT]:") {
    return new ResponseContract({ instructions: instructionsText(model, fmt), cue });
  }

  /** @returns {boolean} */
  applies() {
    // Always renders: even with no structured contract, the cue must close the prompt.
    return true;
  }
}
