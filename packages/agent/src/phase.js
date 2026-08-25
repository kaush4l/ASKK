/**
 * The phase vocabulary, and the tool grant a phase makes.
 *
 * IN RUST THIS WAS A MACHINE. `v1_phases()` returned a table looked up by
 * `AgentState.phase`, and each row carried an `exits` table saying where a
 * reply could lead. The table had ONE row; `phase` had no assignment anywhere
 * outside the constructor; `exits` had a write and no reader. So the lookup
 * could only ever return Work and the exits could only ever be ignored. The
 * table, the id field, the exit conditions and the exit targets are all gone,
 * and the single row survives as a constant: a machine that never had a second
 * state is not a machine, and porting one would be porting the intention.
 *
 * What survives is the part that is READ every call — the contract a reply is
 * parsed against, and the scope that decides whether this phase may act at all.
 * @module
 */

/** @typedef {import('@harness/kernel').ToolId} ToolId */
/** @typedef {import('@harness/kernel').PhaseId} PhaseId */

/**
 * Which of an agent's tools a phase exposes. `none` is structural, not a
 * refusal at call time: the granted set is what the affordances section is
 * built from, so a phase that may not act cannot even NAME a tool to the model.
 * @typedef {{kind: 'none'} | {kind: 'all'} | {kind: 'only', tools: ToolId[]}} ToolScope
 */

/** @type {ToolScope} */
export const NO_TOOLS = Object.freeze({ kind: 'none' })

/**
 * Everything THIS agent's `agent.md` gave it. The per-agent decision belongs to
 * the frontmatter's `tools:` key; a phase says only whether it may act.
 * @type {ToolScope}
 */
export const ALL_TOOLS = Object.freeze({ kind: 'all' })

/** @param {readonly ToolId[]} tools @returns {ToolScope} */
export function onlyTools(tools) {
  return { kind: 'only', tools: [...tools] }
}

/**
 * The scope applied to one agent's toolbox — the ONLY narrowing there is.
 *
 * Generic over the element rather than over a `Toolbox` type because the whole
 * of the operation is a filter by name, and pinning it to the descriptor shape
 * would make the phase know what a tool is when all it knows is which names it
 * allows. Order is the TOOLBOX's, never the scope's: the model reads these as
 * lines, and the agent file decided their order.
 * @template {{name: string}} T
 * @param {ToolScope} scope
 * @param {readonly T[]} tools
 * @returns {T[]}
 */
export function grant(scope, tools) {
  if (scope.kind === 'none') return []
  if (scope.kind === 'all') return [...tools]
  return tools.filter((tool) => scope.tools.includes(tool.name))
}

/**
 * The exact reply shape a phase demands back — parsed, never trusted.
 *
 * TWO, DOWN FROM FOUR. `PlanSteps` and `Verdict` were deleted from the Rust in
 * 2026-08-23 with zero construction sites between them; the stage machine does
 * the planning and the judging now, as prose in files a person can edit.
 * @typedef {'tool_envelope' | 'answer'} ResponseContract
 */

/** @type {readonly ResponseContract[]} */
export const RESPONSE_CONTRACTS = /** @type {const} */ (['tool_envelope', 'answer'])

/** @typedef {{maxTokens: number}} Budget */

/**
 * WHAT ONE WORKING TURN'S PAPER MAY COST. **PROVISIONAL** — 4096 was too small
 * for the agent that actually ships, and it failed silently.
 *
 * Measured 2026-08-23 on the Rust build, `main` with its peer `critic` loaded,
 * asked "what is in this folder?": the paper wanted 4174 tokens before a
 * conversation existed, so the ladder pointered `## history`, pointered
 * `## space` and ELIDED `## observations` — on every turn. The agent's own
 * prose tells it to read `## observations`; the budget was deleting the block.
 *
 * 8192 and not more: the standing paper is ~4.2k, `compactAt` means the window
 * must hold turns beside it, and doubling leaves ~4k for them while keeping the
 * whole prompt inside a 16k context — the floor for the local models this page
 * is pointed at. A number chosen against a MEASURED model context would be
 * better than one chosen against this arithmetic; that measurement is the
 * owner's, which is why this is provisional and not settled.
 * @type {Budget}
 */
export const WORK_BUDGET = Object.freeze({ maxTokens: 8192 })

/**
 * @typedef {{phase: PhaseId, contract: ResponseContract, tools: ToolScope, budget: Budget}} PhaseConfig
 */

/**
 * ONE WORKING TURN, and the only configuration there is.
 *
 * The contract is `tool_envelope`, which does not mean prose is illegal: prose
 * is the cheap exit every graph must have, and it ends the turn. `all` means
 * "this agent's own toolbox", because a hardcoded list here was the bug the
 * Agents card exposed — the file said `tools:` and nothing read it.
 * @type {PhaseConfig}
 */
export const WORK = Object.freeze({
  phase: /** @type {PhaseId} */ ('work'),
  contract: /** @type {ResponseContract} */ ('tool_envelope'),
  tools: ALL_TOOLS,
  budget: WORK_BUDGET,
})
