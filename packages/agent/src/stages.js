/**
 * A STAGE: what the model is told this pass, what it may call, and the shape
 * the reply must take. An agent file's `stages:` list is the loop it walks.
 *
 * IN RUST THERE WAS A PHASE MACHINE BESIDE THIS, and it is retired. `v1_phases()`
 * returned a table looked up by `AgentState.phase`; the table had one row,
 * `phase` was assigned nowhere outside the constructor, and the `exits` table
 * had a write and no reader. The name survives only in this paragraph, which is
 * the reason a rename would erase: a machine that never had a second state is
 * not a machine, and porting one would be porting the intention.
 *
 * A STAGE IS NOT A NEW MACHINE EITHER. It is one instruction pushed into the
 * paper and one more call, taken by the same `step` against the same window:
 * the stage's prose reply, instead of ending the turn, moves the cursor on. So
 * a stage cannot invent a transition the loop did not already have.
 *
 * WHY MOST STAGES MAY NOT ACT. `strategy`, `critique` and `answer` are refused
 * tools by their ALLOWLIST rather than by their brief's sentence — the
 * `engine: base` lesson: a capability described and not enforced is a setting
 * that looks applied. `plan` is the one narrow exception; see below.
 * @module
 */

import { ANSWER, STRATEGY_SCHEMA } from './strategy.js'

/** @typedef {import('@harness/kernel').ToolId} ToolId */
/** @typedef {import('./strategy.js').StageName} StageName */
/** @typedef {import('./frontmatter.js').Refusal} Refusal */

/**
 * Which of an agent's tools a stage exposes. `none` is structural, not a
 * refusal at call time: the granted set is what the affordances section is
 * built from, so a stage that may not act cannot even NAME a tool to the model.
 * @typedef {{kind: 'none'} | {kind: 'all'} | {kind: 'only', tools: ToolId[]}} ToolScope
 */

/** @type {ToolScope} */
export const NO_TOOLS = Object.freeze({ kind: 'none' })

/** Everything THIS agent's file gave it. The per-agent decision belongs to the frontmatter's `tools:` key; a stage says only whether it may act. @type {ToolScope} */
export const ALL_TOOLS = Object.freeze({ kind: 'all' })

/** @param {readonly ToolId[]} tools @returns {ToolScope} */
export function onlyTools(tools) {
  return { kind: 'only', tools: [...tools] }
}

/**
 * The scope applied to one agent's toolbox — the ONLY narrowing there is.
 * Generic over the element rather than over a toolbox type because the whole of
 * the operation is a filter by name. Order is the TOOLBOX's, never the scope's:
 * the model reads these as lines, and the agent file decided their order.
 * @template {{name: string}} T
 * @param {ToolScope} scope @param {readonly T[]} tools @returns {T[]}
 */
export function grant(scope, tools) {
  if (scope.kind === 'none') return []
  if (scope.kind === 'all') return [...tools]
  return tools.filter((tool) => scope.tools.includes(tool.name))
}

/**
 * The exact reply shape demanded back — parsed, never trusted. TWO, DOWN FROM
 * FOUR: `PlanSteps` and `Verdict` had zero construction sites between them.
 * @typedef {'tool_envelope' | 'answer'} ResponseContract
 */

/** @type {readonly ResponseContract[]} */
export const RESPONSE_CONTRACTS = /** @type {const} */ (['tool_envelope', 'answer'])

/**
 * WHAT ONE WORKING TURN'S PAPER MAY COST. **PROVISIONAL.** Measured 2026-08-23:
 * the shipped `main` wanted 4174 tokens before a conversation existed against a
 * budget of 4096, so the ladder elided `## observations` on every turn — while
 * the agent's own prose told it to read that block. 8192 leaves ~4k for the
 * window beside a ~4.2k standing paper and keeps the whole prompt inside the
 * 16k context of the local models this page is pointed at. A number chosen
 * against a MEASURED model context would be better, and that measurement is the
 * owner's, which is why this is provisional.
 * @type {{maxTokens: number}}
 */
export const WORK_BUDGET = Object.freeze({ maxTokens: 8192 })

/**
 * One stage, resolved: the words it enters with, what it may call, and the
 * shape it must answer in. `responseSchema` is null for every stage whose reply
 * only a PERSON reads — only a reply the MACHINE parses needs to override what
 * the loop would have asked for anyway, and today exactly one does.
 * @typedef {{name: StageName, brief: string, toolAllowlist: ToolScope, responseSchema: typeof STRATEGY_SCHEMA | null}} Stage
 */

/** The two tools the `plan` stage is granted. Its brief tells it to read skills; refusing it every tool would make that instruction a lie, and granting the whole toolbox would let it start the work it is supposed to be planning. @type {ToolId[]} */
export const SKILL_TOOLS = ['list_skills', 'read_skill']

/** @type {Record<StageName, ToolScope>} */
const ALLOWLISTS = {
  work: ALL_TOOLS,
  verify: ALL_TOOLS,
  plan: onlyTools(SKILL_TOOLS),
  strategy: NO_TOOLS,
  critique: NO_TOOLS,
  [ANSWER]: NO_TOOLS,
}

/**
 * Every brief there is. `work` and `answer` are absent BY DESIGN — the person's
 * own request is the instruction there, and a second one would compete with it.
 * `durable` is not a stage: it is the paragraph appended to `plan` for an agent
 * that has a space, a key rather than the tail of `plan.md`, because the
 * alternative is core splitting one file on a separator, which is parsing a
 * brief.
 * @type {readonly string[]}
 */
export const BRIEF_KEYS = /** @type {const} */ (['strategy', 'plan', 'verify', 'critique', 'durable'])

export const DURABLE = 'durable'

/** The file a key is read from, built here so the load refusal and the stage refusal cannot name two different paths. @param {string} key @returns {string} */
export function briefPath(key) {
  return `public/stages/${key}.md`
}

/**
 * EVERY BRIEF, OR A REFUSAL. An unknown key, a missing one, or one blank once
 * trimmed refuses the WHOLE SET rather than the one key: a half-loaded set is
 * an app that runs until the turn that needed the missing one.
 *
 * There is no compiled-in copy to fall back to, deliberately. A default here
 * would be a stage that writes no plan and names no check while looking exactly
 * like a stage that ran.
 * @param {Iterable<{key: string, text: string}>} files
 * @returns {{briefs: Record<string, string>} | {refusal: Refusal}}
 */
export function loadBriefs(files) {
  /** @type {Record<string, string>} */
  const briefs = {}
  for (const { key, text } of files) {
    if (!BRIEF_KEYS.includes(key)) {
      return { refusal: { path: briefPath(key), key, message: `No stage is briefed by the name "${key}" — the briefs are: ${BRIEF_KEYS.join(', ')}.` } }
    }
    if (text.trim() === '') {
      return { refusal: { path: briefPath(key), key, message: `${briefPath(key)} is empty, and a stage entered with no instruction looks exactly like one that ran.` } }
    }
    briefs[key] = text.trim()
  }
  const missing = BRIEF_KEYS.find((key) => !Object.hasOwn(briefs, key))
  return missing === undefined
    ? { briefs }
    : { refusal: { path: briefPath(missing), key: missing, message: `${briefPath(missing)} was not loaded, so the ${missing} stage has nothing to say.` } }
}

/**
 * ONE STAGE, RESOLVED against the briefs this build loaded. A briefed stage
 * whose file never arrived REFUSES rather than entering empty — that is the
 * whole reason this returns a value instead of a Stage.
 *
 * The `\n\n` before the durable paragraph is the APPENDER's business and never
 * the file's.
 * @param {StageName} name
 * @param {{briefs: Record<string, string>, hasSpace?: boolean}} of
 * @returns {{stage: Stage} | {refusal: Refusal}}
 */
export function resolveStage(name, of) {
  const parts = name === 'plan' && of.hasSpace ? ['plan', DURABLE] : [name]
  /** @type {string[]} */
  const said = []
  for (const key of parts) {
    if (!BRIEF_KEYS.includes(key)) continue
    const text = of.briefs[key]
    if (text === undefined || text === '') {
      return { refusal: { path: briefPath(key), key, message: `The ${name} stage cannot be entered: ${briefPath(key)} never loaded, and a stage with no instruction writes nothing while looking like it worked.` } }
    }
    said.push(text)
  }
  return {
    stage: {
      name,
      brief: said.join('\n\n'),
      toolAllowlist: ALLOWLISTS[name],
      responseSchema: name === 'strategy' ? STRATEGY_SCHEMA : null,
    },
  }
}

/** Whether this stage may call the agent's full toolbox — written as what MAY act, so a stage added to the vocabulary takes nothing by omission (I6). @param {StageName} name @returns {boolean} */
export function actsIn(name) {
  return ALLOWLISTS[name].kind === 'all'
}
