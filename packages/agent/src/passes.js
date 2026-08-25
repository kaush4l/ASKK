/**
 * THE LOOP AROUND THE LOOP — one turn walking its `stages:` list more than
 * once, so an agent keeps working toward a goal across laps without a person
 * typing "carry on" between each of them. `passes:` in the agent file is the
 * budget; the default is 1, and 1 is byte-for-byte the turn this build has
 * always taken.
 *
 * THE CONTINUE CONDITION IS MECHANICAL, AND THAT IS THE WHOLE POINT. It is
 * never the model's verdict on its own progress. A local 12B asked "are you
 * done?" answers "not yet" indefinitely — the documented AutoGPT failure
 * (Significant-Gravitas/AutoGPT #1994, #3444) — and this page ships pointed at
 * exactly such a model. So the prose decides WHAT to do next and this fold
 * decides whether there IS a next: a lap that changed nothing and ran nothing
 * has not earned another one. The evidence is `state.acted`, folded from each
 * tool's own declared properties in `round.js` and reset at every lap.
 *
 * IT LOOPS BACK TO `work`, NOT TO THE START. Re-planning from scratch every lap
 * is how a run drifts off the goal it opened with: the plan stage runs once and
 * every later lap is work-and-check against it.
 *
 * THE ROUND BUDGET SPANS THE LAPS. `maxRounds` is per-TURN and only an ending
 * clears `toolRounds` — a lap is not an ending, so the real ceiling stays
 * `maxRounds` rather than quietly becoming `maxRounds × passes`. That product
 * is the person's bill.
 *
 * THE GOAL HALF IS NOT PORTED. The Rust read a declared `goal.check`'s exit
 * code here instead of `acted`; nothing in this build declares or runs one yet,
 * and a fold reading a field no path writes is a machine that is not there.
 * @module
 */

import { emit } from './effect.js'
import { ANSWER } from './strategy.js'

/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./state.js').AgentState} AgentState */

/** A lap was spent. Emitted so the laps are VISIBLE beside `stage_entered` (I8): a loop nobody can see is a token meter running behind a spinner. Payload: `{pass, of}`, both 1-based. */
export const PASS_SPENT = 'core.pass_spent'

/** The turn ended because the LAP BUDGET ran out, not because the work did. Its own word because the act is to raise `passes:`, not to read the answer. */
export const PASS_CEILING = 'pass ceiling'

/** The stage a lap goes back to. `answer` is `work` with its tools taken away, and a route holding neither is a route that cannot loop. @param {AgentState} state @returns {number} */
function workIn(state) {
  return state.stages.findIndex((name) => name === 'work' || name === ANSWER)
}

/**
 * ANOTHER LAP, OR `null`. Asked once the cursor has run off the end of the
 * list, so "wanted another" and "may have another" are two separate questions
 * and this answers the second.
 *
 * Each lap earns its OWN continuation: carrying `acted` forward would let one
 * productive lap buy the whole budget for four silent ones after it.
 * @param {AgentState} state @returns {{state: AgentState, effect: Effect} | null}
 */
export function again(state) {
  const work = workIn(state)
  if (work === -1) return null
  if (state.pass + 1 >= state.passes || !state.acted) return null
  /** @type {AgentState} */
  const lapped = { ...state, pass: state.pass + 1, acted: false, stage: work }
  return { state: lapped, effect: spent(lapped) }
}

/**
 * Whether the turn is ending because the budget ran out rather than because the
 * work did — `acted` is "wanted another lap" and the comparison is "may not
 * have one". It answers `false` for every agent that declared no budget, which
 * is what keeps their ending word exactly what it was.
 * @param {AgentState} state @returns {boolean}
 */
export function exhausted(state) {
  return state.passes > 1 && state.pass + 1 >= state.passes && state.acted
}

/** @param {AgentState} state @returns {Effect} */
function spent(state) {
  return emit({ type: 'custom', kind: PASS_SPENT, payload: { pass: state.pass + 1, of: state.passes } })
}
