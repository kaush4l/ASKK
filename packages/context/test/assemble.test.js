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

describe('a summary is prose too, and it protects what it names', () => {
  /** A block small enough to elide, and cheap enough that nothing else needs to. */
  const memory = comp({
    id: 'memory', slot: SLOT.MEMORY, stability: 'static', priority: 9, floor: 'elided',
    render: () => text('the plan lives in plan.md. '.repeat(4)),
  })
  const chat = comp({
    id: 'history', slot: SLOT.HISTORY, stability: 'dynamic', priority: 8, floor: 'summarized',
    cacheable: false,
    render: () => [
      { type: /** @type {const} */ ('text'), text: `user: ${'what is the plan? '.repeat(40)}` },
      { type: /** @type {const} */ ('text'), text: 'assistant: I will read plan.md' },
    ],
  })
  /** @type {import('@harness/context').State} */
  const curated = {
    stage: 'work',
    sources: [
      source(soul), source(memory),
      source(chat, [{ type: 'text', text: 'earlier we agreed; see `memory`' }]),
      source(contract),
    ],
  }

  test('the summary is what the model reads at `summarized`, and it names memory', () => {
    const doc = assemble(curated, { maxTokens: 60 })
    expect(at(doc, 'history').fidelity).toBe('summarized')
    expect(at(doc, 'history').parts).toContainEqual({ type: 'text', text: 'earlier we agreed; see `memory`' })
  })

  test('a block only the SUMMARY backticks stops at pointer — it is never elided, and never a crash', () => {
    for (const maxTokens of [15, 30, 60, 200]) {
      const doc = assemble(curated, { maxTokens })
      expect(at(doc, 'memory').floor).toBe('pointer')
      expect(at(doc, 'memory').fidelity).not.toBe('elided')
    }
  })
})

describe('a step that does not shrink the paper is not a compaction (I8)', () => {
  const wall = comp({
    id: 'operating_rules', slot: SLOT.OPERATING_RULES, stability: 'static', priority: 0, floor: 'full',
    render: () => text('never guess at a tool result. '.repeat(200)),
  })
  /** Two characters: every rung below `full` costs MORE than the body itself. */
  const tiny = comp({
    id: 'memory', slot: SLOT.MEMORY, stability: 'static', priority: 9, render: () => text('ok'),
  })
  /** @type {import('@harness/context').State} */
  const stubborn = {
    stage: 'work',
    sources: [source(soul), source(wall), source(tiny), source(contract)],
  }

  test('every section a receipt names really is smaller than it was unbudgeted', () => {
    const squeezed = assemble(stubborn, { maxTokens: 10 })
    const whole = assemble(stubborn, UNLIMITED_BUDGET)
    for (const step of squeezed.report.steps) {
      expect(at(squeezed, step.section).budgetHint).toBeLessThan(at(whole, step.section).budgetHint)
    }
  })

  test('no receipt is written for a section the ladder could not shrink', () => {
    const doc = assemble(stubborn, { maxTokens: 10 })
    expect(doc.report.steps.map((s) => s.section)).not.toContain('memory')
    expect(at(doc, 'memory').parts).toStrictEqual([{ type: 'text', text: 'ok' }])
  })
})
