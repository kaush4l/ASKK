/**
 * ASKING — everything that decides what ONE model call contains: the toolbox
 * this stage grants, the components rebuilt against that grant, the paper
 * assembled under the budget this model's card derives, and the contract
 * demanded back.
 *
 * It is apart from `step.js`, which owns the TRANSITIONS, because these
 * functions have one obligation to each other that no transition shares: WHAT
 * THE MODEL MAY CALL AND WHAT IT IS TOLD IT MAY CALL MUST BE THE SAME SET
 * (I13). One granted toolbox feeds both the affordances block and the response
 * contract, so the two cannot drift — and that is checkable by reading these
 * forty lines together.
 *
 * THE PAPER IS DERIVED, NEVER MUTATED IN PLACE. `paperFor` returns a new source
 * list every call; the state's own paper is read and not written. The
 * predecessor upserted into a long-lived `State`, so a block written for turn N
 * was still in the prompt for turn N+1 — which is how `## space` named three
 * tools the running stage had not been granted.
 *
 * WHERE THE IDENTITY COMES FROM. The soul is written HERE, from `state.prompt`,
 * on every call — it is not seeded once and left standing, because the prompt a
 * person edits mid-run must reach the next call and not the one after it. What
 * this file does not write is the conversation: the exchanges are the paper's
 * own, carried across turns, and `paperFor` reads them without touching them.
 * @module
 */

import { MODEL_ENDPOINT } from '@harness/kernel'
import { adapterFor, assemble, budgetFor, sectionOf } from '@harness/context'
import { callModel } from './effect.js'
import { endTurn } from './ending.js'
import { facultyBlocks } from './faculty/index.js'
import { affordances, contract, directive, observations, sensed, soul, taskBlock } from './paper.js'
import { backoffMs } from './retry.js'
import { grant, resolveStage } from './stages.js'
import { usages } from './toolbox.js'

/** @typedef {import('@harness/context').ModelCard} ModelCard */
/** @typedef {import('@harness/context').SectionSource} SectionSource */
/** @typedef {import('@harness/context').Component} Component */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./stages.js').Stage} Stage */
/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./tools.js').Tool} Tool */

/** What one call is assembled against: the stage it is taken in, the card that derives its budget, and the backoff a retry carries. @typedef {{stage: Stage, card: ModelCard, at: Timestamp, afterMs?: number}} Asking */

/**
 * THE TOOLBOX THIS CALL ACTUALLY HAS — this agent's own, narrowed by the
 * stage's allowlist, and the only source of what the model is told it can call.
 * A stage scoped to `none` yields an empty array, which is why a stage that may
 * not act cannot even NAME a tool: the affordances block is built from this.
 * @param {AgentState} state @param {Stage} stage @returns {Tool[]}
 */
export function granted(state, stage) {
  return grant(stage.toolAllowlist, state.toolbox)
}

/**
 * THE PAPER FOR THIS TURN, derived. Whatever the paper already carries, with
 * the components this call owns written over it by id.
 *
 * Upsert and not append: a block the paper has never held is added, which is
 * what opens the prompt to a faculty that was declared in a file rather than
 * compiled in. Ordering is structural — `assemble` sorts by slot and nothing
 * else — so a source's position here never reaches the model.
 * @param {AgentState} state @param {Asking} of @returns {SectionSource[]}
 */
export function paperFor(state, of) {
  const held = /** @type {SectionSource[]} */ ([...state.paper.sources])
  const rebuilt = components(state, of)
  for (const component of rebuilt) {
    const source = { section: sectionOf(component, of.at), summary: null }
    const at = held.findIndex((s) => s.section.id === source.section.id)
    if (at === -1) held.push(source)
    else held[at] = source
  }
  return held
}

/**
 * THE BLOCKS THIS CALL OWNS, in prompt order. Order here is documentation and
 * not mechanism, because assembly sorts by slot; they are listed in the order
 * the model reads them anyway, so nobody has to consult the slot table to
 * picture the result.
 *
 * A block belonging to a CAPABILITY is not listed here and adding one does not
 * mean editing this function: the agent file names a faculty, the faculty
 * declares its block, and a host's most recent parts render into it.
 * @param {AgentState} state @param {Asking} of @returns {Component[]}
 */
function components(state, of) {
  const tools = granted(state, of.stage)
  return [
    soul(state.prompt),
    affordances(usages(tools)),
    ...facultyBlocks(state.faculties).map((block) => sensed(block, state.senses[block.id] ?? [])),
    taskBlock(state.task),
    observations(state.observations),
    directive(of.stage.brief),
    contract({ hasTools: tools.length > 0, schema: of.stage.responseSchema }),
  ]
}

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
 * WHICH STAGE THIS CALL IS TAKEN IN. A turn walking no stage list is the bare
 * react loop — every agent written before the key existed — and it takes
 * `work`, which is briefed by the person's own message and carries no brief of
 * its own. The cursor past the end of the list is the same case.
 *
 * A BRIEFED STAGE WHOSE FILE NEVER LOADED REFUSES. A stage entered with no
 * instruction writes nothing while looking exactly like one that ran.
 * @param {AgentState} state @returns {{stage: Stage} | {problem: string}}
 */
export function stageNow(state) {
  const name = state.stages[state.stage] ?? 'work'
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
