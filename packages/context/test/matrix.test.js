import { expect, test, describe } from 'bun:test'
import { Glob } from 'bun'
import { PROVIDERS, KINDS, WINDOWS, cell, cardFor, blocksFor, AT } from './matrix.js'
import { assemble, adapterFor, paperOf, UNLIMITED_BUDGET } from '@harness/context'

/**
 * THE GOLDEN MATRIX. 36 request bodies — three adapters × three budgets × four
 * kinds — and 12 compaction reports beside them.
 *
 * A report file holds all THREE providers' reports for its budget and kind,
 * because the three image rules disagree by up to 3x on the same photograph: a
 * report golden that showed one provider's arithmetic would hide exactly the
 * fact the `imageRule` field exists to state.
 *
 * Regenerate with `UPDATE_GOLDENS=1 bun test packages/context/test/matrix.test.js`
 * and READ THE DIFF — a golden updated without being read is a golden that
 * proves the code agrees with itself.
 */
const DIR = new URL('./fixtures/matrix/', import.meta.url).pathname
const BUDGET_NAMES = Object.keys(WINDOWS)

/** @param {string} name @param {unknown} value */
async function golden(name, value) {
  const path = `${DIR}${name}.json`
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (process.env['UPDATE_GOLDENS'] === '1') await Bun.write(path, text)
  expect(await Bun.file(path).text()).toBe(text)
}

describe('the final request body, snapshotted per adapter, budget and kind', () => {
  for (const provider of PROVIDERS) {
    for (const budget of BUDGET_NAMES) {
      for (const kind of KINDS) {
        test(`${provider} · ${budget} · ${kind}`, async () => {
          await golden(`${provider}-${budget}-${kind}`, cell(provider, budget, kind).body)
        })
      }
    }
  }
})

describe('what the budget did, snapshotted beside it', () => {
  for (const budget of BUDGET_NAMES) {
    for (const kind of KINDS) {
      test(`${budget} · ${kind} · all three image rules`, async () => {
        const reports = Object.fromEntries(PROVIDERS.map((p) => [p, cell(p, budget, kind).doc.report]))
        await golden(`${budget}-${kind}.report`, reports)
      })
    }
  }
})

describe('the matrix is not vacuous', () => {
  test('all 48 goldens are on disk, and no more than 48', async () => {
    const found = []
    for await (const f of new Glob('*.json').scan({ cwd: DIR })) found.push(f)
    expect(found.length).toBe(PROVIDERS.length * BUDGET_NAMES.length * KINDS.length + BUDGET_NAMES.length * KINDS.length)
  })

  test('a tighter budget is a different body, or the budget did nothing', () => {
    for (const provider of PROVIDERS) {
      const whole = JSON.stringify(cell(provider, 'unbudgeted', 'text').body)
      expect(JSON.stringify(cell(provider, 'tight', 'text').body)).not.toBe(whole)
    }
  })

  test('the three adapters write three different bodies from one paper', () => {
    const bodies = PROVIDERS.map((p) => JSON.stringify(cell(p, 'unbudgeted', 'tools').body))
    expect(new Set(bodies).size).toBe(3)
  })

  test('the same paper costs three different amounts once it holds an image', () => {
    const spends = PROVIDERS.map((p) => cell(p, 'unbudgeted', 'image').doc.report.spent)
    expect(new Set(spends).size).toBe(3)
  })

  test('every report names the rule its spend was counted under', () => {
    for (const provider of PROVIDERS) {
      const { doc } = cell(provider, 'tight', 'image')
      expect(doc.report.imageRule).toBe(provider)
    }
  })
})

describe('the body is what a provider sees, and the document is not', () => {
  test('an image reaching a text-only card is a named placeholder on the wire', () => {
    const blind = { ...cardFor('openai', 'image'), acceptsImages: false }
    const adapter = adapterFor('openai')
    const doc = assemble(paperOf('work', blocksFor('image'), AT), UNLIMITED_BUDGET, adapter.images)
    const body = JSON.stringify(adapter.buildRequest(doc, blind, [], {}))
    expect(doc.sections.some((s) => s.parts.some((p) => p.type === 'image'))).toBe(true)
    expect(body).not.toContain('base64')
    expect(body).toContain('withheld')
  })
})
