/**
 * WHAT THE LOOP FILLS INTO THE VOCABULARY: the blocks THIS call carries, and
 * what goes in each of them.
 *
 * EVERY ONE OF THEM IS `@harness/context`'S. This package used to carry a
 * second copy of the words — its own `soul`, `affordances`, `task`,
 * `observations`, `directive` and response contract — and the two wordings had
 * already drifted apart: soul floored at `full` here and `summarized` there, an
 * idle agent rendered `''` here and a sentence there, and the affordances block
 * still taught the retired text-call protocol whose hand-rolled scraper
 * corrupted a file reading it back. A block is a VALUE. The loop decides which
 * ones this call carries and what is in them; it does not word one.
 *
 * `sensed` is the single component this package still constructs, and it words
 * nothing either: a faculty declares its own block beside its own tools, and
 * what renders is whatever the host last wrote into `senses`.
 * @module
 */

import {
  affordances, directive, goal, history, identity, observations, operatingRules,
  prose, sectionOf, shaped, soul, task, toolEnvelope,
} from '@harness/context'
import { facultyBlocks, sensed } from './faculty/index.js'
import { grant } from './stages.js'
import { usages } from './toolbox.js'

/** @typedef {import('@harness/context').Component} Component */
/** @typedef {import('@harness/context').SectionSource} SectionSource */
/** @typedef {import('./ask.js').Asking} Asking */
/** @typedef {import('./stages.js').Stage} Stage */
/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./tools.js').Tool} Tool */

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
    identity(state.name, state.description),
    operatingRules(),
    goal(state.standing.goal.outcome, state.standing.goal.doneWhen),
    affordances(usages(tools)),
    ...facultyBlocks(state.faculties).map((block) => sensed(block, state.senses[block.id] ?? [])),
    task(state.task ?? ''),
    history(state.conversation.length === 0 ? undefined : [...state.conversation]),
    observations([...state.observations]),
    directive(of.stage.brief),
    contractFor(of.stage, tools.length > 0),
  ]
}

/**
 * THE SHAPE THIS STAGE DEMANDS BACK. A stage whose reply the MACHINE parses
 * states its fields, and that outranks both other arms — it is the one case
 * where the shape is not a property of the toolbox. Otherwise the envelope is
 * offered only when there is something to call: telling a model it may call
 * tools and then showing it none is an invitation to invent one.
 * @param {Stage} stage @param {boolean} hasTools @returns {Component}
 */
function contractFor(stage, hasTools) {
  if (stage.responseSchema) return shaped(stage.responseSchema)
  return hasTools ? toolEnvelope() : prose()
}
