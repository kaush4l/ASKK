import { expect, test, describe } from 'bun:test'
import { dropOldest, headAndTail, usePrecomputedSummary, turnRoleOf, assemble, UNLIMITED_BUDGET } from '@harness/context'
import { comp, source, soul, contract, turn, state } from './paper.js'
import { SLOT, text } from '@harness/context'

/** Three complete turns, each one a question, a tool call, and its result. */
const transcript = [
  turn('user', 'first question '.repeat(10)),
  turn('assistant', 'call read_file(a) '.repeat(10)),
  turn('result', 'read_file: contents of a '.repeat(10)),
  turn('user', 'second question '.repeat(10)),
  turn('assistant', 'call read_file(b) '.repeat(10)),
  turn('result', 'read_file: contents of b '.repeat(10)),
  turn('user', 'third question, the one that matters'),
]

/** @param {import('@harness/context').Part[]} parts */
const roles = (parts) => parts.map(turnRoleOf)

describe('history drops whole turns from the oldest end', () => {
  test('the oldest turn leaves entire — question, call and result together', () => {
    const kept = dropOldest(transcript, 200)
    expect(kept.map((p) => (p.type === 'text' ? p.text : ''))).not.toContain(transcript[0]?.type === 'text' ? transcript[0].text : '')
    expect(roles(kept)).toStrictEqual([null, 'user', 'assistant', 'result', 'user'])
  })

  test('the newest user message survives a budget of zero', () => {
    const kept = dropOldest(transcript, 0)
    const last = kept[kept.length - 1]
    expect(last).toStrictEqual(transcript[transcript.length - 1] ?? { type: 'text', text: '' })
  })

  test('a tool call is never separated from its result, at any allowance', () => {
    for (const allowance of [0, 25, 60, 120, 400, 10_000]) {
      const kept = dropOldest(transcript, allowance)
      const seen = roles(kept)
      seen.forEach((role, i) => {
        if (role === 'result') expect(seen[i - 1]).toBe('assistant')
      })
      expect(seen.filter((r) => r === 'result').length).toBe(seen.filter((r) => r === 'assistant').length)
    }
  })

  test('what was dropped is stated, because an agent that does not know it is missing history acts as though it has it', () => {
    const first = dropOldest(transcript, 200)[0]
    expect(first?.type === 'text' ? first.text : '').toInclude('earlier turn(s) dropped')
  })
})

describe('head-of-string truncation is banned', () => {
  const body = 'GREETING. ' + 'filler sentence. '.repeat(200) + 'THE THING ACTUALLY ASKED FOR.'

  test('a body that will not fit keeps BOTH ends — the Rust kept only the greeting', () => {
    const [only] = headAndTail([{ type: 'text', text: body }], 50)
    const got = only?.type === 'text' ? only.text : ''
    expect(got).toInclude('GREETING.')
    expect(got).toInclude('THE THING ACTUALLY ASKED FOR.')
    expect(got.length).toBeLessThan(body.length)
  })

  test('what was cut is counted in the middle rather than left silent', () => {
    const [only] = headAndTail([{ type: 'text', text: body }], 50)
    expect(only?.type === 'text' ? only.text : '').toMatch(/…\[\d+ characters elided from the middle\]…/)
  })

  test('the cut lands on code points, so an emoji is never halved', () => {
    const [only] = headAndTail([{ type: 'text', text: '🙂'.repeat(100) }], 4)
    const got = only?.type === 'text' ? only.text : ''
    expect(got).not.toInclude('�')
    expect([...got].every((c) => c === '🙂' || !/[\ud800-\udfff]/.test(c))).toBe(true)
  })

  test('a section summarised under pressure still ends where it ended', () => {
    const long = comp({ id: 'space', slot: SLOT.SPACE, stability: 'static', floor: 'summarized', priority: 9, render: () => text(body) })
    const doc = assemble({ stage: 'work', sources: [soul, long, contract].map((c) => source(c)) }, { maxTokens: 60 })
    const s = doc.sections.find((x) => x.id === 'space')
    expect(s?.fidelity).toBe('summarized')
    expect(s?.parts[0]?.type === 'text' ? s.parts[0].text : '').toInclude('THE THING ACTUALLY ASKED FOR.')
  })
})

describe('a summary is read, never written', () => {
  const curated = [{ type: /** @type {const} */ ('text'), text: 'The person wants plan.md summarised.' }]

  test('the curated summary is what summarizing means when one exists', () => {
    const src = source(comp({ id: 'history', slot: SLOT.HISTORY, priority: 9, floor: 'pointer', render: () => transcript }), curated)
    const doc = assemble({ stage: 'work', sources: [source(soul), src, source(contract)] }, { maxTokens: 40 })
    expect(doc.sections.find((s) => s.id === 'history')?.parts).toStrictEqual(curated)
  })

  test('absent means absent — assembly never invents one', () => {
    expect(usePrecomputedSummary(source(soul))).toBeNull()
  })
})

describe('an oversized binary part is swapped, not dropped', () => {
  const big = { type: /** @type {const} */ ('image'), mediaType: 'image/png', dataBase64: 'A'.repeat(400_000) }

  test('the placeholder names the type and the cost, and the section says so in the report', () => {
    const shot = comp({ id: 'space', slot: SLOT.SPACE, stability: 'static', render: () => [big] })
    const doc = assemble({ stage: 'work', sources: [soul, shot, contract].map((c) => source(c)) }, { maxTokens: 1024 })
    const s = doc.sections.find((x) => x.id === 'space')
    expect(s?.parts[0]?.type === 'text' ? s.parts[0].text : '').toMatch(/image \(image\/png\) withheld: ~\d+ tokens over the \d+-token part ceiling/)
    expect(doc.report.withheld).toStrictEqual(['space'])
  })

  test('an unlimited budget withholds nothing, because "too big" is a claim about a budget', () => {
    const shot = comp({ id: 'space', slot: SLOT.SPACE, stability: 'static', render: () => [big] })
    const doc = assemble({ stage: 'work', sources: [soul, shot, contract].map((c) => source(c)) }, UNLIMITED_BUDGET)
    expect(doc.report.withheld).toStrictEqual([])
    expect(doc.sections.find((x) => x.id === 'space')?.parts[0]).toStrictEqual(big)
  })
})

describe('the transcript spelling is single-sourced', () => {
  test('a part with no role tag continues the turn before it rather than starting one', () => {
    expect(turnRoleOf({ type: 'text', text: 'no tag here' })).toBeNull()
    expect(turnRoleOf({ type: 'image', mediaType: 'image/png', dataBase64: 'A' })).toBeNull()
    expect(turnRoleOf({ type: 'text', text: 'User: shouted' })).toBe('user')
  })

  test('an untagged transcript still fits, because state() proves the whole paper assembles', () => {
    expect(assemble(state(), { maxTokens: 500 }).report.spent).toBeLessThanOrEqual(500)
  })
})
