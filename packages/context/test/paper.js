/**
 * The fixture paper the assembly tests judge: a soul, rules that SEND THE
 * MODEL to another block, a transcript with a tool call in it, observations,
 * and a response contract on the pinned tail. Shared because three test files
 * need the same document to make different claims about it, and a fixture
 * spelled three times is three fixtures.
 * @module
 */

import { sectionOf, text, SLOT } from '@harness/context'

/** @typedef {import('@harness/context').Component} Component */
/** @typedef {import('@harness/context').SectionSource} SectionSource */
/** @typedef {import('@harness/context').Part} Part */

/** @param {Partial<Component> & {id: string, slot: number, render: () => Part[]}} over @returns {Component} */
export function comp(over) {
  return { intent: `what ${over.id} answers`, ...over }
}

/** @param {Component} c @param {Part[]|null} [summary] @returns {SectionSource} */
export function source(c, summary = null) {
  return { section: sectionOf(c, 7), summary }
}

/** One transcript entry, in the spelling `TURN_ROLES` defines. */
export const turn = /** @type {(role: string, body: string) => Part} */ (
  (role, body) => ({ type: 'text', text: `${role}: ${body}` })
)

export const soul = comp({
  id: 'soul', slot: SLOT.SOUL, stability: 'static', priority: 0,
  render: () => text('You are HARNESS. Honesty over comfort.'),
})

/** The rules NAME another block, which is what makes eliding that block a lie. */
export const rules = comp({
  id: 'operating_rules', slot: SLOT.OPERATING_RULES, stability: 'static', priority: 1,
  render: () => text('Read `observations` before you answer. Never guess at a tool result.'),
})

export const history = comp({
  id: 'history', slot: SLOT.HISTORY, stability: 'dynamic', priority: 9, floor: 'pointer',
  cacheable: false,
  render: () => [
    turn('user', 'what files are in the space? '.repeat(20)),
    turn('assistant', 'calling list_files '.repeat(20)),
    turn('result', 'list_files: notes.md, plan.md '.repeat(20)),
    turn('user', 'summarise plan.md'),
  ],
})

export const observations = comp({
  id: 'observations', slot: SLOT.OBSERVATIONS, stability: 'dynamic', priority: 8, floor: 'elided',
  render: () => text('read_file: plan.md is 4 lines long. '.repeat(30)),
})

export const contract = comp({
  id: 'response_contract', slot: SLOT.RESPONSE, stability: 'static', priority: 0,
  render: () => text('Reply with one paragraph, then a single tool call or nothing.'),
})

/** @param {SectionSource[]} [extra] @returns {import('@harness/context').State} */
export function state(extra = []) {
  return {
    stage: 'work',
    sources: [soul, rules, history, observations, contract].map((c) => source(c)).concat(extra),
  }
}
