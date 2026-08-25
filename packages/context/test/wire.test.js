import { expect, test, describe } from 'bun:test'
import { assemble, messagesOf, UNLIMITED_BUDGET, SLOT, sectionOf, text } from '@harness/context'
import { comp, source, state, soul, contract } from './paper.js'

/** @typedef {import('@harness/context').ModelCard} ModelCard */
/** @typedef {import('@harness/context').Message} Message */

/** @param {Partial<ModelCard>} [over] @returns {ModelCard} */
function card(over = {}) {
  return {
    name: 'local', model: 'gemma-4-12B', kind: 'openai', contextTokens: 128000,
    maxOutputTokens: null, acceptsImages: false, reasons: false, ...over,
  }
}

/** All the text of one message, joined. @param {Message|undefined} m */
function said(m) {
  return (m?.content ?? []).map((p) => (p.type === 'text' ? p.text : `<${p.type}>`)).join('')
}

/** Everything the model is handed, both messages. @param {Message[]} messages */
function whole(messages) {
  return messages.map(said).join('')
}

describe('the paper becomes two messages, and the split is the trust boundary', () => {
  const messages = messagesOf(assemble(state(), UNLIMITED_BUDGET), card())

  test('the standing instructions are the system message', () => {
    expect(messages[0]?.role).toBe('system')
    expect(said(messages[0])).toContain('## soul')
    expect(said(messages[0])).toContain('## operating_rules')
  })

  test('the transcript is NOT — a fetched page and another agent’s words never reach the system role', () => {
    expect(said(messages[0])).not.toContain('## history')
    expect(said(messages[0])).not.toContain('## observations')
    expect(messages[1]?.role).toBe('user')
    expect(said(messages[1])).toContain('## history')
  })

  test('the response contract is still the last thing read', () => {
    const user = said(messages[1])
    expect(user.indexOf('## response_contract')).toBeGreaterThan(user.indexOf('## history'))
    expect(messages).toHaveLength(2)
  })
})

describe('what the model cannot hear, it is TOLD about', () => {
  const shot = comp({
    id: 'observations', slot: SLOT.OBSERVATIONS, stability: 'dynamic', priority: 8,
    render: () => [{ type: 'image', mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=' }],
  })
  const doc = assemble({ stage: 'work', sources: [soul, shot, contract].map((c) => source(c)) }, UNLIMITED_BUDGET)

  test('a text-only model reads a named placeholder where the image was', () => {
    expect(whole(messagesOf(doc, card()))).toContain('[image (image/png) withheld: this model does not accept it]')
  })

  test('a vision model gets the part itself, in the position it sat in', () => {
    const content = messagesOf(doc, card({ acceptsImages: true }))[1]?.content ?? []
    expect(content.map((p) => p.type)).toContain('image')
  })

  test('audio is withheld from every card in this catalogue, and says so', () => {
    const sound = comp({
      id: 'observations', slot: SLOT.OBSERVATIONS, stability: 'dynamic', priority: 8,
      render: () => [{ type: 'audio', mediaType: 'audio/webm', dataBase64: 'AAAA' }],
    })
    const heard = assemble({ stage: 'work', sources: [soul, sound, contract].map((c) => source(c)) }, UNLIMITED_BUDGET)
    expect(whole(messagesOf(heard, card({ acceptsImages: true })))).toContain('audio (audio/webm) withheld')
  })
})

describe('the compaction notice sits before the tail and never after it', () => {
  const doc = assemble(state(), { maxTokens: 80 })

  test('it names every step the budget took', () => {
    expect(doc.report.steps.length).toBeGreaterThan(0)
    const user = whole(messagesOf(doc, card()))
    expect(user).toContain('## compaction_notice')
    for (const step of doc.report.steps) expect(user).toContain(`- ${step.section}: ${step.from} -> ${step.to}`)
  })

  test('and the response contract still reads last, which is the law it used to lose to', () => {
    const user = said(messagesOf(doc, card())[1])
    expect(user.indexOf('## compaction_notice')).toBeLessThan(user.indexOf('## response_contract'))
  })

  test('a document the budget did not bite carries no notice at all', () => {
    expect(whole(messagesOf(assemble(state(), UNLIMITED_BUDGET), card()))).not.toContain('compaction_notice')
  })
})

test('an elided section is absent from the wire, not present and empty', () => {
  const quiet = comp({ id: 'memory', slot: SLOT.MEMORY, stability: 'static', priority: 5, render: () => [] })
  const doc = assemble({ stage: 'work', sources: [soul, quiet, contract].map((c) => source(c)) }, UNLIMITED_BUDGET)
  expect(doc.sections.find((s) => s.id === 'memory')?.fidelity).toBe('elided')
  expect(whole(messagesOf(doc, card()))).not.toContain('## memory')
})

test('rendering is deterministic — the same document renders the same messages', () => {
  const doc = assemble(state(), { maxTokens: 500 })
  expect(JSON.stringify(messagesOf(doc, card()))).toBe(JSON.stringify(messagesOf(doc, card())))
})

test('a section is framed by its own id and intent, which is how a model finds it', () => {
  const s = sectionOf(comp({ id: 'goal', slot: SLOT.GOAL, stability: 'static', priority: 1, render: () => text('ship it') }), 7)
  const doc = assemble({ stage: 'work', sources: [source(soul), { section: s, summary: null }, source(contract)] }, UNLIMITED_BUDGET)
  expect(whole(messagesOf(doc, card()))).toContain('## goal\n(what goal answers)\nship it\n')
})
