import { expect, test, describe } from 'bun:test'
import {
  SLOT, isHead, isTail, FIDELITIES, STABILITIES, nextFidelity, UNLIMITED_BUDGET,
} from '@harness/context'
import { HarnessError } from '@harness/kernel'

/** @typedef {import('@harness/context').Section} Section */
/** @typedef {import('@harness/context').Document} Document */
/** @typedef {import('@harness/context').SectionSource} SectionSource */

/**
 * @param {string} id
 * @param {number} slot
 * @param {Partial<Section>} [over]
 * @returns {Section}
 */
function section(id, slot, over = {}) {
  return {
    id,
    intent: `what ${id} answers`,
    slot,
    stability: 'static',
    priority: 0,
    fidelity: 'full',
    floor: 'elided',
    trust: 'authored',
    budgetHint: 10,
    provenance: { module: id, version: '1', inputHash: 'abc', producedAt: 1 },
    parts: [{ type: 'text', text: id }],
    ...over,
  }
}

describe('the document is JSON', () => {
  test('a document with every part kind survives stringify/parse unchanged', () => {
    /** @type {Document} */
    const doc = {
      stage: 'work',
      sections: [
        section('soul', SLOT.SOUL),
        section('space', SLOT.SPACE, {
          stability: 'dynamic',
          parts: [
            { type: 'image', mediaType: 'image/png', dataBase64: 'iVBOR' },
            { type: 'audio', mediaType: 'audio/wav', dataBase64: 'UklGR' },
            { type: 'file', name: 'notes.md', mediaType: 'text/markdown', dataBase64: 'IyBo' },
          ],
        }),
        section('response_contract', SLOT.RESPONSE, { fidelity: 'summarized' }),
      ],
      report: {
        budget: { maxTokens: 4096 },
        spent: 300,
        steps: [{ section: 'response_contract', from: 'full', to: 'summarized' }],
        withheld: ['space'],
        imageRule: 'anthropic',
      },
    }
    expect(JSON.parse(JSON.stringify(doc))).toStrictEqual(doc)
  })

  test('toStrictEqual is the matcher this file needs — toEqual cannot see the drift', () => {
    /** @type {Document} */
    const doc = { stage: 'work', sections: [section('soul', SLOT.SOUL)], report: {
      budget: { maxTokens: 4096 }, spent: 300, steps: [], withheld: [], imageRule: 'openai (default)',
    } }
    // The cast is the point: `spent: undefined` is exactly what the types forbid,
    // and a test cannot show the guard biting without building the forbidden value.
    const drifted = /** @type {Document} */ (/** @type {unknown} */ (
      { ...doc, report: { ...doc.report, spent: undefined } }
    ))
    expect(() => expect(JSON.parse(JSON.stringify(drifted))).toStrictEqual(drifted)).toThrow()
    expect(JSON.parse(JSON.stringify(drifted))).toEqual(drifted)
  })

  test('an unlimited budget survives the round trip — Infinity would not', () => {
    expect(JSON.parse(JSON.stringify(UNLIMITED_BUDGET))).toEqual({ maxTokens: UNLIMITED_BUDGET.maxTokens })
    expect(JSON.parse(JSON.stringify({ maxTokens: Infinity }))).toEqual({ maxTokens: null })
  })

  test('a source with no curated summary says null, because absent does not survive', () => {
    /** @type {SectionSource} */
    const source = { section: section('history', SLOT.HISTORY), summary: null }
    expect(JSON.parse(JSON.stringify(source))).toStrictEqual(source)
    expect(Object.keys(JSON.parse(JSON.stringify({ summary: undefined })))).toEqual([])
  })
})

describe('the slot is the prompt order', () => {
  test('sorting components by slot ascending puts soul first and the contract last', () => {
    const components = [
      { id: 'observations', slot: SLOT.OBSERVATIONS },
      { id: 'response_contract', slot: SLOT.RESPONSE },
      { id: 'history', slot: SLOT.HISTORY },
      { id: 'soul', slot: SLOT.SOUL },
      { id: 'affordances', slot: SLOT.AFFORDANCES },
    ]
    const order = [...components].sort((a, b) => a.slot - b.slot).map((c) => c.id)
    expect(order).toEqual(['soul', 'affordances', 'history', 'observations', 'response_contract'])
  })

  test('ordering by stability instead is the bug this type ended', () => {
    const components = /** @type {{id: string, slot: number, stability: import('@harness/context').Stability}[]} */ ([
      { id: 'soul', slot: SLOT.SOUL, stability: 'static' },
      { id: 'history', slot: SLOT.HISTORY, stability: 'volatile' },
      { id: 'response_contract', slot: SLOT.RESPONSE, stability: 'static' },
    ])
    const byStability = [...components]
      .sort((a, b) => STABILITIES.indexOf(a.stability) - STABILITIES.indexOf(b.stability))
      .map((c) => c.id)
    expect(byStability.at(-1)).not.toBe('response_contract')
    expect([...components].sort((a, b) => a.slot - b.slot).at(-1)?.id).toBe('response_contract')
  })

  test('the gaps of ten let a component outside this package land between two slots', () => {
    const outsider = { id: 'artifacts', slot: 92 }
    const placed = [
      { id: 'observations', slot: SLOT.OBSERVATIONS },
      { id: 'directive', slot: SLOT.DIRECTIVE },
      outsider,
    ].sort((a, b) => a.slot - b.slot).map((c) => c.id)
    expect(placed).toEqual(['observations', 'artifacts', 'directive'])
  })

  test('the pinned ends are the two the law checks', () => {
    expect(isHead(SLOT.SOUL)).toBe(true)
    expect(isHead(SLOT.IDENTITY)).toBe(true)
    expect(isHead(SLOT.GOAL)).toBe(false)
    expect(isTail(SLOT.RESPONSE)).toBe(true)
    expect(isTail(SLOT.DIRECTIVE)).toBe(false)
  })
})

describe('the fidelity ladder', () => {
  test('steps down one level at a time and ends, rather than wrapping', () => {
    const walk = []
    /** @type {import('@harness/context').Fidelity|null} */
    let at = 'full'
    while (at !== null) {
      walk.push(at)
      at = nextFidelity(at)
    }
    expect(walk).toEqual([...FIDELITIES])
    expect(nextFidelity('elided')).toBeNull()
  })

  test('a name that is not on the ladder throws instead of answering "full"', () => {
    // The cast reaches the runtime guard: a persisted document from another
    // build arrives as unchecked data, which is the only way this is called.
    expect(() => nextFidelity(/** @type {any} */ ('bogus'))).toThrow(HarnessError)
    expect(() => nextFidelity(/** @type {any} */ (undefined))).toThrow(HarnessError)
  })
})
