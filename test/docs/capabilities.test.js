import { describe, expect, test } from 'bun:test'

/**
 * The ledger's own rules, executed.
 *
 * `CAPABILITIES.md` opens by declaring five statuses and *only* five, and by
 * declaring that a `barred` row must name a root constraint. Both were prose
 * that nothing could check, and on 2026-09-02 eight rows added in one session
 * were written with a sixth status — `yes` — while every human reader, the
 * author included, read straight past it.
 *
 * A rule a document states about itself and cannot execute is the exact defect
 * this tree keeps finding in its own source. The ledger is where that rule was
 * written down, so it is the last place it should go unchecked.
 */

const LEDGER = await Bun.file(new URL('../../CAPABILITIES.md', import.meta.url)).text()

/** The five, quoted from the file's own legend rather than from memory. */
const STATUSES = ['have', 'degraded', 'absent', 'barred', 'unverified']

/** The sixth marker, which is not a status: the question does not apply here. */
const NOT_APPLICABLE = '—'

const HEADER = '| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |'

/**
 * Every capability row, as cells.
 *
 * A row is any table line under a header of the shape above — the ledger has
 * eleven such tables and no other eight-column one. The split is on an
 * UNESCAPED pipe: evidence cells quote shell pipelines, and
 * `git log --oneline gh-pages \\| wc -l` is one cell that a naive split reads
 * as two, shifting every column in the row it happens to appear in. The count
 * assertion below is what turned that from a guess into a check.
 */
function rows() {
  const lines = LEDGER.split('\n')
  const found = []
  let inTable = false
  for (const [index, line] of lines.entries()) {
    if (line.trim() === HEADER) {
      inTable = true
      continue
    }
    if (!line.startsWith('|')) {
      inTable = false
      continue
    }
    if (!inTable || /^\|\s*-+/.test(line)) continue
    const cells = line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((cell) => cell.trim())
    found.push({ line: index + 1, cells })
  }
  return found
}

describe('the legend', () => {
  test('still says five, so this file is testing the rule the ledger states', () => {
    expect(LEDGER).toContain('Five statuses, and only five')
    for (const status of STATUSES) expect(LEDGER).toContain(`| \`${status}\` |`)
    // And the marker that is not a status has to be written down too, or a
    // reader meets it in a table with nothing telling them what it means.
    expect(LEDGER).toContain(`| ${NOT_APPLICABLE} | the question does not apply`)
  })
})

describe('every capability row', () => {
  const all = rows()

  test('there are rows to check at all', () => {
    // A parser that silently matches nothing would make every assertion below
    // vacuously pass — the failure mode this file exists to prevent, one level
    // up.
    expect(all.length).toBeGreaterThan(80)
  })

  test('has eight cells, which is what makes the column indexes below true', () => {
    for (const { line, cells } of all) {
      expect({ line, count: cells.length }).toEqual({ line, count: 8 })
    }
  })

  test('answers for Chrome with one of the five, always', () => {
    // Chrome is the browser every measurement in this file was taken in, so a
    // row with no Chrome answer is `unverified` rather than inapplicable.
    for (const { line, cells } of all) {
      const status = cells[3]
      expect({ line, status }).toEqual({
        line,
        status: STATUSES.includes(status) ? status : `one of ${STATUSES.join(', ')}`,
      })
    }
  })

  test('answers for Safari and iOS with one of the five, or says the question does not apply', () => {
    // `—` is the eleventh table's marker: a benchmark that runs under `bun` on
    // a host has no Safari column, and inventing one would be a measurement
    // nobody took.
    for (const { line, cells } of all) {
      for (const [offset, column] of ['Saf', 'iOS'].entries()) {
        const status = cells[4 + offset]
        const legal = STATUSES.includes(status) || status === NOT_APPLICABLE
        expect({ line, column, status }).toEqual({
          line,
          column,
          status: legal ? status : `one of ${STATUSES.join(', ')}, or ${NOT_APPLICABLE}`,
        })
      }
    }
  })

  test('names a root constraint wherever it says barred', () => {
    for (const { line, cells } of all) {
      const barred = cells.slice(3, 6).includes('barred')
      if (!barred) continue
      const root = cells[6]
      // The file's own words: "`barred` must name a root constraint". A dash is
      // what an unconstrained row carries, so a dash beside a barred status is
      // the claim that something is impossible with no reason given.
      expect({ line, root }).toEqual({ line, root: /^C\d/.test(root) ? root : 'a C-numbered root' })
    }
  })

  test('says unverified wherever the evidence cell is empty', () => {
    for (const { line, cells } of all) {
      const evidence = cells[7]
      if (evidence !== '') continue
      for (const status of cells.slice(3, 6)) {
        if (status === NOT_APPLICABLE) continue
        expect({ line, status }).toEqual({ line, status: 'unverified' })
      }
    }
  })
})
