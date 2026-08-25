/**
 * THE STAGE WALK — the cursor over a turn's `stages:` list, and the one reply
 * that rewrites the list it is walking.
 *
 * A STAGE IS NOT A NEW MACHINE. It is one instruction pushed into the paper and
 * one more call, taken by the same `step` against the same window: a stage's
 * prose reply, instead of ending the turn, moves the cursor on and opens the
 * next one. So a stage cannot invent a transition the loop did not already
 * have, and there is no second state machine to keep in agreement with the
 * first — which is what the retired phase machine was.
 *
 * THE VOTE IS THE ONLY REPLY THAT REWRITES THE LIST, and it is read here rather
 * than in `step.js` because this is where a stage's reply is already in hand;
 * splitting "read the reply" from "act on it" is how the two drift. What the
 * routes COST is `strategy.js`; how to choose between them is
 * `public/stages/strategy.md`, so a person tunes routing without a rebuild.
 *
 * THE VOTE IS NOT A TURN. It is the machine asking the model a question ABOUT
 * the message, so nothing here writes it into the conversation: a person
 * reading `assistant: ROUTE: project` would be reading a reply they were never
 * given, and the model would read its own routing decision back as context on
 * every turn after it.
 * @module
 */

import { askFor } from './ask.js'
import { CRITIC_FAULTED } from './critic.js'
import { emit } from './effect.js'
import { ANSWERED, UNCHECKED, endTurn } from './ending.js'
import { PASS_CEILING, again, exhausted } from './passes.js'
import { stageIn } from './stages.js'
import { STAGES_OF, STRATEGY, routeChosen, routeOf } from './strategy.js'

/** @typedef {import('@harness/kernel').StageId} StageId */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./step.js').Stepped} Stepped */
/** @typedef {import('./turn.js').Incoming} Incoming */

/**
 * A TURN OPENS ON THE LIST ITS FILE DECLARES, never on the list the last turn
 * finished holding — the strategy stage rewrites `stages` mid-turn, so without
 * the copy the second message of a conversation would inherit the first's
 * route. Everything a lap counts is turn-scoped and resets with it: evidence
 * about a turn that is over says nothing about the one starting.
 * @param {AgentState} state @param {string} text @param {Incoming} incoming @returns {Stepped}
 */
export function openTurn(state, text, incoming) {
  /** @type {AgentState} */
  const turn = {
    ...state,
    task: text, turnId: incoming.turnId ?? '', awaiting: 'model',
    batch: [], toolRounds: 0, observations: [], steered: false, stopping: false,
    stages: [...state.declared], stage: 0, pass: 0, acted: false,
    mutated: false, green: false, reviewed: null,
  }
  return enter(turn, incoming.at)
}

/**
 * A STAGE PRODUCED PROSE — the next stage's call, or `null` when the list is
 * done and the turn has not earned another lap. `null` and not an ending,
 * because which ending a finished walk earned is `ending.js`'s to name.
 * @param {AgentState} state @param {string} said  the stage's reply, read only by the vote
 * @param {Timestamp} at @returns {Stepped | null}
 */
export function walkOn(state, said, at) {
  if (state.stages.length === 0) return null
  if (stageIn(state) === STRATEGY) return route(state, said, at)
  if (state.stage + 1 < state.stages.length) return enter({ ...state, stage: state.stage + 1 }, at)
  const lap = again(state)
  if (!lap) return null
  const walked = enter(lap.state, at)
  return { state: walked.state, effects: [lap.effect, ...walked.effects] }
}

/**
 * WHICH ENDING A FINISHED WALK EARNED. Only `answered` is ever downgraded: every
 * other signal says something about the REPLY, and a truncated reply is
 * truncated whatever the folds below observed about the turn around it.
 *
 * RUNNING OUT OF LAPS COMES FIRST. It is the more specific thing to say about a
 * turn that did both, and it names a different act — raise `passes:`, rather
 * than read what the critic found.
 *
 * A TURN THE CRITIC DID NOT CLEAR IS NOT A TURN THAT ANSWERED. `reviewed` is
 * `round.js`'s fold over a SEPARATE agent's reply, never a reading of this
 * model's prose, so the caller cannot summarise its way past it: whatever its
 * own answer says about the review, the ending says `critic faulted`. Last is
 * the weakest of the three, and it is what a turn faulted and then EDITED ends
 * on — the verdict went stale with the write, and `unchecked` is what is left
 * that is true.
 * @param {AgentState} state @param {string} why  the ending the reply's own signal earned
 * @returns {string}
 */
export function endingNow(state, why) {
  if (why !== ANSWERED) return why
  if (exhausted(state)) return PASS_CEILING
  if (state.reviewed === false) return CRITIC_FAULTED
  if (state.mutated && !state.green) return UNCHECKED
  return ANSWERED
}

/**
 * Install the route the vote named and open its first stage. `stage: 0` because
 * the chosen list REPLACES the declared one entire; advancing the cursor into
 * it would skip whatever the route put first.
 * @param {AgentState} state @param {string} said @param {Timestamp} at @returns {Stepped}
 */
function route(state, said, at) {
  /** @type {AgentState} */
  const chosen = { ...state, stages: [...STAGES_OF[routeOf(said)]], stage: 0 }
  const walked = enter(chosen, at)
  return { state: walked.state, effects: [emit(routeChosen(said)), ...walked.effects] }
}

/**
 * ENTER THE STAGE THE CURSOR IS ON: the fact into the log, then the call. Every
 * cursor move comes through here, so no path can enter one without recording
 * that it did (I8) and none can forget the refusal below.
 *
 * A STAGE WHOSE BRIEF NEVER LOADED ENDS THE TURN IN WORDS rather than working
 * on unbriefed — `askFor` is where that refusal is worded, and the fact is not
 * emitted, because a stage that was refused was not entered.
 *
 * `attempts` resets: a stage's first call has not failed yet, whatever the
 * previous stage's calls cost.
 * @param {AgentState} state @param {Timestamp} at @returns {Stepped}
 */
function enter(state, at) {
  /** @type {AgentState} */
  const asking = { ...state, awaiting: 'model', attempts: 0 }
  const asked = askFor(asking, at)
  if ('problem' in asked) return endTurn(asking, asked.problem)
  const opening = state.stages.length === 0 ? [] : [entered(asking)]
  return { state: asking, effects: [...opening, asked.effect] }
}

/**
 * The stage was entered, as a fact. The NAME goes in unmapped, `answer`
 * included: the kernel's `StageId` does not spell it — the vote is the only
 * thing that knows a turn needs no tool, so no agent file may declare it — and
 * recording it as `work` would make the one route that took no tool
 * indistinguishable in the log from the one that could have. Filed as a
 * cross-lane request; the cast is here rather than in the shared vocabulary,
 * because widening that is not this lane's to do.
 * @param {AgentState} state @returns {Effect}
 */
function entered(state) {
  return emit({
    type: 'stage_entered',
    agent: state.name,
    stage: /** @type {StageId} */ (stageIn(state)),
    turnId: state.turnId,
  })
}
