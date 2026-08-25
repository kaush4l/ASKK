import { expect, test, describe } from 'bun:test'
import {
  assemble, due, chunksOf, replaceWindow, mapSheet, foldSheet, estimateParts,
  SUMMARY_HEADING, COMPACT_PROMPT, UNLIMITED_BUDGET,
} from '@harness/context'

/** A transcript far larger than any budget it will be summarised under. */
function longWindow(/** @type {number} */ turns) {
  return Array.from({ length: turns }, (_, i) => `user: turn ${i} — ${'a decision worth keeping. '.repeat(8)}`)
}

/** @param {string[]} entries */
function cost(entries) {
  return estimateParts(entries.map((text) => ({ type: 'text', text }))).tokens
}

describe('when the window is compacted at all', () => {
  test('a compactAt of zero never compacts, and the check is >=', () => {
    expect(due(longWindow(50), 0)).toBe(false)
    expect(due(longWindow(10), 10)).toBe(true)
    expect(due(longWindow(9), 10)).toBe(false)
  })

  test('nothing older than the kept tail is a compaction with nothing to do', () => {
    expect(chunksOf(longWindow(4), 4, 500)).toBeNull()
    expect(chunksOf(longWindow(3), 4, 500)).toBeNull()
  })
})

describe('a transcript larger than the budget is chunked, never cut', () => {
  const entries = longWindow(40)
  const split = chunksOf(entries, 4, 300)

  test('every entry survives, whole and in order', () => {
    const seen = [...(split?.chunks ?? []).flat(), ...(split?.kept ?? [])]
    expect(seen).toStrictEqual(entries)
  })

  test('it is more than one chunk, or the fixture proves nothing', () => {
    expect((split?.chunks ?? []).length).toBeGreaterThan(1)
  })

  test('no chunk of more than one entry exceeds the allowance', () => {
    for (const chunk of split?.chunks ?? []) {
      if (chunk.length > 1) expect(cost(chunk)).toBeLessThanOrEqual(300)
    }
  })

  test('an entry too large for any chunk is sent whole rather than truncated', () => {
    const huge = `user: ${'x'.repeat(4000)}`
    const only = chunksOf([huge, 'user: recent'], 1, 50)
    expect(only?.chunks).toStrictEqual([[huge]])
    expect(only?.chunks[0]?.[0]?.length).toBe(huge.length)
  })
})

describe('the sheet cannot summarise the thing it is summarising for', () => {
  const chunk = longWindow(30)

  test('the transcript block stays FULL under a budget that cannot hold it', () => {
    const doc = assemble(mapSheet(chunk, 7), { maxTokens: 24 })
    const transcript = doc.sections.find((s) => s.id === 'transcript')
    expect(transcript?.fidelity).toBe('full')
    expect(doc.report.steps.some((s) => s.section === 'transcript')).toBe(false)
  })

  test('and it still holds every entry it was handed, plus the instructions', () => {
    const doc = assemble(mapSheet(chunk, 7), { maxTokens: 24 })
    const body = (doc.sections.find((s) => s.id === 'transcript')?.parts ?? [])
      .map((p) => (p.type === 'text' ? p.text : '')).join('')
    expect(body).toContain(COMPACT_PROMPT.trim().split('\n')[0] ?? '')
    for (const entry of chunk) expect(body).toContain(entry)
  })

  test('the overshoot is recorded rather than cut away', () => {
    const doc = assemble(mapSheet(chunk, 7), { maxTokens: 24 })
    expect(doc.report.spent).toBeGreaterThan(24)
  })

  test('the reduce step folds notes, and says they are notes and not a transcript', () => {
    const doc = assemble(foldSheet(['first stretch: A', 'second stretch: B'], 7), UNLIMITED_BUDGET)
    const body = (doc.sections.find((s) => s.id === 'transcript')?.parts ?? [])
      .map((p) => (p.type === 'text' ? p.text : '')).join('')
    expect(body).toContain('NOTES:')
    expect(body).toContain('first stretch: A')
    expect(body).not.toContain('TRANSCRIPT:')
  })
})

describe('the window is never replaced by a summary that gains nothing', () => {
  const entries = longWindow(10)

  test('an empty summary leaves the conversation exactly as it was, and says why', () => {
    const out = replaceWindow(entries, '   ', 2)
    expect(out.replaced).toBe(false)
    expect(out.entries).toStrictEqual(entries)
    expect(out.why).toContain('returned nothing')
  })

  test('a summary no smaller than what it replaces is refused, and says why', () => {
    const bloated = entries.slice(0, 8).join(' ') + ' and more besides'
    const out = replaceWindow(entries, bloated, 2)
    expect(out.replaced).toBe(false)
    expect(out.entries).toStrictEqual(entries)
    expect(out.why).toContain('compacts nothing')
  })

  test('a real summary replaces the older stretch and keeps the newest turns', () => {
    const out = replaceWindow(entries, 'The user asked about the plan; two steps remain.', 2)
    expect(out.replaced).toBe(true)
    expect(out.entries.length).toBe(3)
    expect(out.entries[0]).toContain(SUMMARY_HEADING)
    expect(out.entries.slice(1)).toStrictEqual(entries.slice(-2))
    expect(out.entries.join('').length).toBeLessThan(entries.join('').length)
  })

  test('the summary carries a role tag, so the window it rejoins is still a transcript', () => {
    const out = replaceWindow(entries, 'notes', 2)
    expect(out.entries[0]?.startsWith('system: ')).toBe(true)
  })
})
