/** The eight phase prompts, and the one helper that fills them in.
 *
 * These strings are the product. Every one is copied character for character
 * out of `core/phases.py` — the line breaks, the em dashes, the quoting of
 * 'simple' and 'blocking: ', all of it. They are what the model actually reads,
 * so paraphrasing one is not a style change, it is a behaviour change, and the
 * golden fixtures under `tests/golden/` are what says so.
 *
 * They live beside `core/phases.js` rather than inside it for the reason the
 * responses split three ways: the 200-line rule does not bend for a file that
 * happens to be a faithful port. The division is real — this file is the bytes,
 * that one is the control flow.
 */

export const UNDERSTAND_PROMPT =
  "Before doing anything, understand the request below. Decide whether it is " +
  "'simple' — answerable directly, or with at most a quick tool call or two — or " +
  "'complex', needing a worked plan. Then rewrite it as an enhanced query: precise, " +
  "self-contained, with the implicit requirements made explicit. Do not answer it here.\n\n" +
  "REQUEST: {query}";

export const SELECT_PROMPT =
  "The task is: {goal}\n\n" +
  "From the available skills listed above, name the ones that would genuinely improve " +
  "this work. Loading a skill costs prompt space, so choose only what applies — " +
  "an empty list is the right answer when nothing fits.";

export const PLAN_PROMPT =
  "The task is: {goal}\n\n" +
  "Lay out the sequence of steps that completes it. Each step is one concrete, " +
  "checkable piece of work, in the order it should happen.";

export const WORK_PROMPT =
  "The overall task: {goal}\n\n" +
  "The plan:\n{plan}\n\n" +
  "You are working step {number}: {step}\n\n" +
  "Complete this step now, using tools as needed. Your final 'answer' for this " +
  "step is what it produced — a later step, and a reviewer, will read it.";

export const RESPOND_PROMPT =
  "The task was: {goal}\n\n" +
  "The work is done. Step outcomes:\n{outcomes}\n{caveats}\n" +
  "Write the reply the user should see: what was done and what came of it, " +
  "self-contained, no meta-commentary about phases or reviewers.";

export const RESPOND_CAVEATS =
  "\nUnresolved reviewer findings — state these plainly in the reply rather than " +
  "hiding them:\n{findings}\n";

export const VERIFY_PROMPT =
  "You are a verifier. You did not do this work and owe it nothing.\n\n" +
  "The task: {goal}\n\nThe plan:\n{plan}\n\nWhat the worker reports per step:\n{outcomes}\n\n" +
  "Check whether the work actually meets the task. Use your tools to look at the " +
  "real state where you can, rather than trusting the report. Verdict 'pass' only " +
  "when everything holds; otherwise 'fail' with the evidence.";

export const CRITIQUE_PROMPT =
  "You are the bar-raiser. Your job is to find what is wrong, not to be agreeable.\n\n" +
  "The task: {goal}\n\nThe plan:\n{plan}\n\nStep outcomes:\n{outcomes}\n\n" +
  "Verifier's report: {verify}\n\n" +
  "Name the critical flaws — things that make the result wrong, unsafe, or beside " +
  "the point of the task. Prefix each finding with 'blocking: ' or 'minor: '. " +
  "Verdict 'approve' only if nothing blocking remains.";

/** `str.format` over the subset above — `{name}` and nothing else.
 *
 * The replacer is a function on purpose: what a function replacer returns is
 * inserted literally, so a `$` inside a reviewer's finding cannot turn into a
 * substitution pattern. And, as in Python, a value that was just substituted is
 * never rescanned — which is what lets RESPOND_CAVEATS carry model-written text
 * into RESPOND_PROMPT without a second round of formatting.
 *
 * @param {string} template @param {Record<string, string | number>} values @returns {string}
 */
export function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
}

/** @typedef {import("./session.js").Session} Session */

/** The plan as the prompts show it: numbered, with each step's status.
 * @param {Session} s @returns {string} */
export const planText = (s) =>
  s.plan.map((step, i) => `${i + 1}. [${step.status}] ${step.description}`).join("\n");

/** What the worker reports, as the reviewers and the reply see it. The empty
 * case says so out loud rather than rendering nothing, because a blank section
 * reads to a model as "there was nothing to do" instead of "nothing was done".
 * @param {Session} s @returns {string} */
export const outcomesText = (s) =>
  s.stepResults.length === 0
    ? "(nothing recorded)"
    : s.stepResults.map((r) => `- ${r.step}: ${r.outcome}${r.ok ? "" : " (FAILED)"}`).join("\n");
