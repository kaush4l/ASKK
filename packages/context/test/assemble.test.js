import { expect, test, describe } from 'bun:test'
import { assemble, SLOT, UNLIMITED_BUDGET, text, sectionOf } from '@harness/context'
import { HarnessError } from '@harness/kernel'
import { comp, source, state, soul, contract } from './paper.js'

/** @param {import('@harness/context').Document} doc @param {string} id */
function at(doc, id) {
  const s = doc.sections.find((x) => x.id === id)
  if (!s) throw new Error(`no section "${id}"`)
  return s
}

/** @param {() => unknown} fn */
function kindOf(fn) {
  try {
    fn()
  } catch (e) {
    return e instanceof HarnessError ? e.kind : `not a HarnessError: ${String(e)}`
  }
  return 'no error thrown'
}

describe('assembly is deterministic (I14)', () => {
  test('the same state and budget assemble byte-identically, twice', () => {
    const budget = { maxTokens: 500 }
    const first = JSON.stringify(assemble(state(), budget))
    const second = JSON.stringify(assemble(state(), budget))
    expect(second).toBe(first)
  })

  test('the golden holds — a change to ordering, framing or the envelope shows up here', async () => {
    const doc = assemble(state(), { maxTokens: 500 })
    const path = new URL('./fixtures/paper.golden.json', import.meta.url).pathname
    expect(JSON.stringify(doc, null, 2) + '\n').toBe(await Bun.file(path).text())
  })

  test('a different budget is a different document, so the golden is not vacuous', () => {
    expect(JSON.stringify(assemble(state(), { maxTokens: 500 })))
      .not.toBe(JSON.stringify(assemble(state(), UNLIMITED_BUDGET)))
  })
})

describe('order is the slot and nothing else', () => {
  test('sections come out in slot order however they were supplied', () => {
    const shuffled = { stage: /** @type {const} */ ('work'), sources: [...state().sources].reverse() }
    const slots = assemble(shuffled, UNLIMITED_BUDGET).sections.map((s) => s.slot)
    expect(slots).toStrictEqual([...slots].sort((a, b) => a - b))
  })

  test('the priority that decides degradation never decides position', () => {
    const doc = assemble(state(), UNLIMITED_BUDGET)
    expect(doc.sections.map((s) => s.id)).toStrictEqual([
      'soul', 'operating_rules', 'history', 'observations', 'response_contract',
    ])
  })
})

describe('a component with nothing to say has no block', () => {
  const quiet = comp({ id: 'memory', slot: SLOT.MEMORY, stability: 'static', render: () => text('') })

  test('an empty body elides the whole section rather than rendering a heading', () => {
    const doc = assemble({ stage: 'work', sources: [source(soul), source(quiet), source(contract)] }, UNLIMITED_BUDGET)
    expect(at(doc, 'memory').fidelity).toBe('elided')
    expect(at(doc, 'memory').parts).toStrictEqual([])
  })

  test('an empty block ANOTHER section names says so instead of vanishing', () => {
    const points = comp({
      id: 'operating_rules', slot: SLOT.OPERATING_RULES, stability: 'static',
      render: () => text('Consult `memory` first.'),
    })
    const doc = assemble({ stage: 'work', sources: [soul, points, quiet, contract].map((c) => source(c)) }, UNLIMITED_BUDGET)
    expect(at(doc, 'memory').fidelity).toBe('pointer')
    expect(at(doc, 'memory').parts).toStrictEqual([{ type: 'text', text: "[section 'memory': nothing this turn]" }])
  })
})

describe('the defect the rule is named after: ## observations', () => {
  test('nothing the surviving prose names is ever elided, at any budget', () => {
    for (const maxTokens of [80, 200, 500, 4096]) {
      const doc = assemble(state(), { maxTokens })
      const gone = doc.sections.filter((s) => s.fidelity === 'elided').map((s) => s.id)
      const prose = doc.sections
        .filter((s) => s.fidelity !== 'elided')
        .flatMap((s) => s.parts.map((p) => (p.type === 'text' ? p.text : '')))
        .join('\n')
      for (const id of gone) expect(prose).not.toInclude(`\`${id}\``)
    }
  })

  test('a budget that cannot hold observations points at it rather than dropping it', () => {
    const doc = assemble(state(), { maxTokens: 80 })
    expect(at(doc, 'observations').fidelity).toBe('pointer')
    expect(at(doc, 'observations').parts[0]).toMatchObject({ text: expect.stringContaining('ask for them') })
    expect(doc.report.steps.map((s) => s.section)).toContain('observations')
  })
})

describe('an invalid document is unconstructible', () => {
  test('validate is not reachable from the package at all', async () => {
    const barrel = /** @type {Record<string, unknown>} */ (await import('@harness/context'))
    expect(barrel['validate']).toBeUndefined()
  })

  test('a paper with no soul and no identity is refused by name', () => {
    expect(kindOf(() => assemble({ stage: 'work', sources: [source(contract)] }, UNLIMITED_BUDGET))).toBe('no_head')
  })

  test('two response contracts are refused by name', () => {
    const second = comp({ id: 'other_contract', slot: SLOT.RESPONSE, stability: 'static', render: () => text('or this') })
    expect(kindOf(() => assemble(state([source(second)]), UNLIMITED_BUDGET))).toBe('tail_count')
  })

  test('a section that cannot state its intent is refused by name', () => {
    const mute = { ...sectionOf(soul, 7), intent: '  ' }
    expect(kindOf(() => assemble({ stage: 'work', sources: [{ section: mute, summary: null }, source(contract)] }, UNLIMITED_BUDGET)))
      .toBe('empty_intent')
  })

  test('two sections with one id are refused by name', () => {
    expect(kindOf(() => assemble(state([source(soul)]), UNLIMITED_BUDGET))).toBe('duplicate_section')
  })

  test('a dynamic section ahead of a static one breaks the cacheable prefix by name', () => {
    const churn = comp({ id: 'identity', slot: SLOT.IDENTITY, stability: 'volatile', render: () => text('You are Ada.') })
    expect(kindOf(() => assemble({ stage: 'work', sources: [soul, churn, comp({ id: 'user', slot: SLOT.USER, stability: 'static', render: () => text('lives in Berlin') }), contract].map((c) => source(c)) }, UNLIMITED_BUDGET)))
      .toBe('interleaved_stability')
  })
})
