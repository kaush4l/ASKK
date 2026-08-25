/**
 * ASKING — the one call site, and the three decisions it makes on the way
 * there: the budget this model's card derives, the image arithmetic its
 * provider bills by, and the ending a paper that could not be assembled
 * produces.
 *
 * It is apart from `step.js`, which owns the TRANSITIONS, because none of those
 * three is one. WHICH BLOCKS the call carries — and the rule that what the
 * model may call and what it is TOLD it may call are one granted toolbox (I13)
 * — is `fill.js`, which states it in its own header.
 *
 * THE PAPER IS DERIVED, NEVER MUTATED IN PLACE. `paperFor` is called on every
 * ask and the state's own paper is read, never written — the soul included, so
 * a prompt a person edits mid-run reaches the next call. The predecessor
 * upserted into a long-lived `State`, so a block written for turn N was still
 * in the prompt for turn N+1, which is how `## space` named three tools the
 * running stage had not been granted.
 * @module
 */

import { MODEL_ENDPOINT } from '@harness/kernel'
import { adapterFor, assemble, budgetFor } from '@harness/context'
import { callModel } from './effect.js'
import { endTurn } from './ending.js'
import { paperFor } from './fill.js'
import { backoffMs } from './retry.js'
import { resolveStage, stageIn } from './stages.js'

/** @typedef {import('@harness/context').ModelCard} ModelCard */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./stages.js').Stage} Stage */
/** @typedef {import('./state.js').AgentState} AgentState */

/** What one call is assembled against: the stage it is taken in, the card that derives its budget, and the backoff a retry carries. @typedef {{stage: Stage, card: ModelCard, at: Timestamp, afterMs?: number}} Asking */

/**
 * ASSEMBLE THE PAPER AND ASK THE MODEL.
 *
 * The budget is DERIVED from the card and never declared: the window belongs to
 * the model and what the paper may spend is what is left after the reply and
 * the estimator's slack come out of it. One constant for every model is how
 * 8192 survived a measurement that said 4174 tokens did not fit in 4096.
 *
 * THE IMAGE ARITHMETIC IS THE CARD'S PROVIDER, NOT OPENAI'S. Anthropic bills a
 * photograph at about w*h/750 and the tile rule understates that by ~3x, so a
 * paper fitted under the wrong rule fits a window it will not fit — and the
 * receipt then names a provider that was never asked. `adapterFor(card.kind)`
 * is the same table `assemble` names in its own doc comment.
 * @param {AgentState} state @param {Asking} of @returns {Effect}
 * @throws {HarnessError} by law name — `elided_but_named`, `window_too_small`, `unknown_provider`
 */
export function askModel(state, of) {
  const document = assemble(
    // `answer` is a stage this loop walks (`STAGES_OF.answer`) and the kernel's
    // `StageId` does not name it. Filed as a cross-lane request; the cast is
    // here rather than in the vocabulary because widening a shared dictionary
    // is not this lane's to do.
    { stage: /** @type {import('@harness/kernel').StageId} */ (of.stage.name), sources: paperFor(state, of) },
    budgetFor(of.card),
    adapterFor(of.card.kind).images,
  )
  return callModel({
    turnId: state.turnId,
    document,
    endpoint: MODEL_ENDPOINT,
    model: state.model,
    temperature: state.temperature,
    afterMs: of.afterMs ?? 0,
  })
}

/**
 * WHICH STAGE THIS CALL IS TAKEN IN, resolved to its brief and its grant. The
 * cursor read is `stageIn`'s and not spelled again here: the log stamps the
 * stage from that same function, and a second copy is how the fact and the
 * paper come to name two different stages for one moment.
 *
 * A BRIEFED STAGE WHOSE FILE NEVER LOADED REFUSES. A stage entered with no
 * instruction writes nothing while looking exactly like one that ran.
 * @param {AgentState} state @returns {{stage: Stage} | {problem: string}}
 */
export function stageNow(state) {
  const name = stageIn(state)
  const resolved = resolveStage(/** @type {import('./strategy.js').StageName} */ (name), {
    briefs: state.briefs,
    hasSpace: state.space !== null,
  })
  return 'refusal' in resolved ? { problem: resolved.refusal.message } : resolved
}

/**
 * THE NEXT MODEL CALL, OR THE SENTENCE SAYING WHY THERE ISN'T ONE.
 *
 * ASSEMBLY THROWS BY LAW NAME AND THIS TURNS IT INTO AN ENDING. A section elided
 * while another names it, a window too small for its own reply, a card naming a
 * provider nobody implements — each is a real, nameable state of THIS agent,
 * and a turn that cannot be assembled must end saying which law refused it. Letting it throw past the
 * reducer would take the whole page down over one agent's paper.
 * @param {AgentState} state @param {Timestamp} at @param {number} [afterMs]  the backoff a retry carries
 * @returns {{effect: Effect} | {problem: string}}
 */
export function askFor(state, at, afterMs = 0) {
  if (!state.card) return { problem: `no catalogue entry named "${state.model}", so there is no window to assemble against` }
  const stage = stageNow(state)
  if ('problem' in stage) return stage
  try {
    return { effect: askModel(state, { stage: stage.stage, card: state.card, at, afterMs }) }
  } catch (cause) {
    return { problem: cause instanceof Error ? cause.message : 'the paper could not be assembled' }
  }
}

/**
 * ASK THE MODEL — the ONE call site, and the transition it hands back.
 *
 * A CALL THAT CANNOT BE ASSEMBLED ENDS THE TURN, saying which law refused it.
 * Throwing past the reducer would take the page down over one agent's paper,
 * and swallowing it would leave the turn awaiting a call nobody described.
 * @param {AgentState} state @param {Timestamp} at @param {number} [attempts]  how many of this turn's calls have already failed
 * @returns {{state: AgentState, effects: Effect[]}}
 */
export function nextCall(state, at, attempts = 0) {
  /** @type {AgentState} */
  const asking = { ...state, attempts }
  const asked = askFor(asking, at, attempts === 0 ? 0 : backoffMs(attempts))
  if ('problem' in asked) return endTurn(asking, asked.problem)
  return { state: asking, effects: [asked.effect] }
}
