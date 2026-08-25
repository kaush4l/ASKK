import { expect, test, describe } from 'bun:test'
import {
  ARTIFACTS, FACULTIES, MEMORY, SPACE, adoptSpec, askModel, facultyBlocks, facultyOf,
  facultyTools, newAgentState, parseAgentFile, resolveStage, usages,
} from '@harness/agent'
import { CARD } from './card.js'

/** @typedef {import('@harness/agent').AgentState} AgentState */

const AT = 1_700_000_000_000

/** @param {string} body @returns {import('@harness/agent').AgentSpec} */
function spec(body) {
  const read = parseAgentFile('agents/one/agent.md', body)
  if ('refusal' in read) throw new Error(read.refusal.message)
  return read.spec
}

/** @param {string} body @returns {AgentState} */
function agent(body) {
  const { state } = adoptSpec(newAgentState(), spec(body), { catalogue: [], offered: ['kv', 'space'], card: CARD })
  return state
}

/** The ids of the sections one call actually assembled. @param {AgentState} state @returns {string[]} */
function sectionIds(state) {
  const resolved = resolveStage('work', { briefs: {} })
  if ('refusal' in resolved) throw new Error(resolved.refusal.message)
  const effect = askModel({ ...state, turnId: 't-1', task: 'do it' }, { stage: resolved.stage, card: CARD, at: AT })
  if (effect.type !== 'CallModel') throw new Error('no model call')
  const document = /** @type {{sections: Array<{id: string}>}} */ (effect.document)
  return document.sections.map((s) => s.id)
}

const NAMES_MEMORY = '---\nname: one\nfaculties: [memory]\n---\nYou are one.\n'
const NAMES_NOTHING = '---\nname: one\n---\nYou are one.\n'

describe('a faculty arrives in one piece, and naming it is the whole grant', () => {
  test('an agent naming memory gets EXACTLY keep and discard, and the one ## memory block', () => {
    const state = agent(NAMES_MEMORY)
    expect(state.faculties).toEqual([MEMORY])
    expect(state.toolbox.map((t) => t.name)).toEqual(['keep', 'discard'])
    expect(sectionIds(state)).toContain(MEMORY)
  })

  test('an agent naming nothing gets NEITHER half — no tools and no block', () => {
    const state = agent(NAMES_NOTHING)
    expect(state.faculties).toEqual([])
    expect(state.toolbox).toEqual([])
    expect(sectionIds(state)).not.toContain(MEMORY)
  })

  test('naming a space declares the space faculty, so the old key is one way of naming one', () => {
    const state = agent('---\nname: one\nspace: research\n---\nYou are one.\n')
    expect(state.faculties).toEqual([SPACE])
    expect(state.toolbox.map((t) => t.name)).toEqual(['remember', 'forget', 'post_note'])
    expect(sectionIds(state)).toContain(SPACE)
  })

  test('a tools: list still picks: the faculty widens what may be NAMED and grants nothing', () => {
    const state = agent('---\nname: one\nfaculties: [memory]\ntools: [keep]\n---\nYou are one.\n')
    expect(state.toolbox.map((t) => t.name)).toEqual(['keep'])
    expect(usages(state.toolbox)[0]).toContain('keep({"note": "<string>"})')
  })

  test('a build without the capability withholds the tools and SAYS which capability is missing', () => {
    const { state, notice } = adoptSpec(newAgentState(), spec(NAMES_MEMORY), { catalogue: [], offered: [], card: CARD })
    expect(state.toolbox).toEqual([])
    expect(notice).toBe('This build cannot read and write its own key/value storage, so keep, discard are not available to you here.')
  })

  test('every faculty in the table offers tools and one block, and an unknown name is neither an error nor a grant', () => {
    for (const name of FACULTIES) {
      const held = facultyOf(name)
      expect(held?.tools.length ?? 0).toBeGreaterThan(0)
      expect(held?.block.id).toBe(name)
      expect(held?.block.intent.trim()).not.toBe('')
    }
    expect(FACULTIES).toEqual([SPACE, MEMORY, ARTIFACTS])
    expect(facultyOf('telepathy')).toBeNull()
    expect(facultyTools(['telepathy'])).toEqual([])
    expect(facultyBlocks(['telepathy'])).toEqual([])
  })
})
