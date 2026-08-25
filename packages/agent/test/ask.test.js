import { expect, test, describe } from 'bun:test'
import { SLOT } from '@harness/context'
import {
  ENDED, NO_TOOLS, SKILL_TOOLS, arg, askFor, askModel, endedWhy, granted, newAgentState,
  paperFor, resolveStage, step, tool,
} from '@harness/agent'
import { CARD } from './card.js'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Stage} Stage */

const AT = 1_700_000_000_000

const BOX = [
  tool({ name: 'read_file', description: 'Read a file.', args: [arg('path', 'string', 'the path')] }),
  tool({ name: 'list_skills', description: 'List the skills.' }),
  tool({ name: 'read_skill', description: 'Read one skill.', args: [arg('name', 'string', 'its name')] }),
]

/** @param {string} name @returns {Stage} */
function stage(name) {
  const resolved = resolveStage(/** @type {'work' | 'plan' | 'critique'} */ (name), { briefs: { plan: 'Write the plan.', critique: 'Judge it.', strategy: 's', verify: 'v', durable: 'd' } })
  if ('refusal' in resolved) throw new Error(resolved.refusal.message)
  return resolved.stage
}

/** @returns {AgentState} */
const working = () => ({ ...newAgentState(), toolbox: BOX, card: CARD, turnId: 't-1', task: 'read a.md', prompt: 'You are one.' })

/** @param {AgentState} state @param {Stage} of @returns {Array<{id: string, slot: number, parts: Array<{type: string, text?: string}>}>} */
function sections(state, of) {
  const effect = askModel(state, { stage: of, card: CARD, at: AT })
  if (effect.type !== 'CallModel') throw new Error('no model call')
  return /** @type {{sections: Array<{id: string, slot: number, parts: Array<{type: string, text?: string}>}>}} */ (effect.document).sections
}

/** @param {ReturnType<typeof sections>} list @param {string} id @returns {string} */
function body(list, id) {
  const found = list.find((s) => s.id === id)
  if (!found) throw new Error(`no ${id} section`)
  return found.parts.map((p) => p.text ?? '').join('\n')
}

describe('what the model may call and what it is TOLD it may call are one set', () => {
  test('the plan stage is granted two tools, and the affordances block names those two and no others', () => {
    const state = working()
    const tools = granted(state, stage('plan'))
    expect(tools.map((t) => t.name)).toEqual(SKILL_TOOLS)
    const shown = body(sections(state, stage('plan')), 'affordances')
    expect(shown).toContain('list_skills({}): List the skills.')
    expect(shown).toContain('read_skill({"name": "<string>"})')
    expect(shown).not.toContain('read_file')
  })

  test('a stage that may not act cannot NAME a tool, and the contract stops offering the envelope', () => {
    const state = working()
    const stopped = { ...stage('critique'), toolAllowlist: NO_TOOLS }
    expect(granted(state, stopped)).toEqual([])
    const list = sections(state, stopped)
    expect(body(list, 'affordances')).toBe('No tools are installed; answer from what you know.')
    expect(body(list, 'response_contract')).toContain('Reply in plain prose')
    expect(body(list, 'response_contract')).not.toContain('call tools')
  })

  test('the stage brief enters as its own block and is never a forged turn of the conversation', () => {
    const list = sections(working(), stage('plan'))
    const directive = list.find((s) => s.id === 'directive')
    expect(directive?.slot).toBe(SLOT.DIRECTIVE)
    expect(body(list, 'directive')).toBe('Write the plan.')
  })
})

describe('the paper is derived per call, so turn N+1 carries nothing of turn N', () => {
  test('assembling does not write to the state it read', () => {
    const state = working()
    const before = JSON.stringify(state)
    askModel(state, { stage: stage('work'), card: CARD, at: AT })
    expect(JSON.stringify(state)).toBe(before)
    expect(state.paper.sources).toEqual([])
  })

  test('a block written for one turn is gone from the next: the observations do not follow the task', () => {
    const first = { ...working(), observations: ['Result read_file: ok'] }
    expect(body(sections(first, stage('work')), 'observations')).toBe('Result read_file: ok')
    const second = { ...first, observations: [], task: 'something else' }
    const list = sections(second, stage('work'))
    expect(list.find((s) => s.id === 'observations')?.parts).toEqual([])
    expect(body(list, 'task')).toBe('something else')
  })

  test('paperFor upserts onto what the paper already holds and appends what it never held', () => {
    const held = { section: { ...sections(working(), stage('work'))[0], id: 'history', slot: SLOT.HISTORY, parts: [{ type: 'text', text: 'person: hello' }] }, summary: null }
    const sources = paperFor({ ...working(), paper: { sources: [held] } }, { stage: stage('work'), card: CARD, at: AT })
    expect(sources.map((s) => s.section.id)).toEqual(['history', 'soul', 'affordances', 'task', 'observations', 'directive', 'response_contract'])
  })
})

describe("the paper is fitted under the CARD's provider arithmetic, not OpenAI's", () => {
  /** @param {string} kind @returns {string} */
  function ruleUnder(kind) {
    const effect = askModel({ ...working(), card: { ...CARD, kind } }, { stage: stage('work'), card: { ...CARD, kind }, at: AT })
    if (effect.type !== 'CallModel') throw new Error('no model call')
    return /** @type {{report: {imageRule: string}}} */ (/** @type {unknown} */ (effect.document)).report.imageRule
  }

  test('the same paper under an anthropic card and an openai card names two different rules', () => {
    expect(ruleUnder('anthropic')).not.toBe(ruleUnder('openai'))
    expect(ruleUnder('anthropic')).toBe('anthropic')
    expect(ruleUnder('openai')).toBe('openai')
  })

  test("a card naming a provider nobody implements ends the turn rather than billing it OpenAI's tiles", () => {
    const asked = askFor({ ...working(), card: { ...CARD, kind: 'cohere' } }, AT)
    expect('problem' in asked && asked.problem).toContain('cohere')
  })
})

describe('a call that cannot be assembled ENDS the turn, and says which refusal it was', () => {
  test('an agent whose model is not in the catalogue is not asked against a window nobody chose', () => {
    const state = { ...working(), card: null, model: 'gpt-9' }
    const asked = askFor(state, AT)
    expect(asked).toEqual({ problem: 'no catalogue entry named "gpt-9", so there is no window to assemble against' })
    const { effects } = step({ ...newAgentState(), model: 'gpt-9' }, { at: AT, turnId: 't-9', fact: { type: 'user_message', text: 'hi', agent: 'main', from: 'person' } })
    expect(endedWhy(payload(effects))).toContain('no catalogue entry named "gpt-9"')
  })

  test('a window too small for its own reply is an ending with the law\'s own sentence, not a throw', () => {
    const tiny = { ...CARD, contextTokens: 64 }
    const asked = askFor({ ...working(), card: tiny }, AT)
    expect('problem' in asked && asked.problem).toContain('64-token window')
  })
})

/** @param {import('@harness/agent').Effect[]} effects @returns {unknown} */
function payload(effects) {
  const found = effects.find((e) => e.type === 'Emit' && e.fact.type === 'custom' && e.fact.kind === ENDED)
  if (found?.type !== 'Emit' || found.fact.type !== 'custom') throw new Error('nothing ended')
  return found.fact.payload
}
