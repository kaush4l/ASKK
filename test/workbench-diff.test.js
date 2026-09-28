import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFragment } from 'parse5'
import { DIFF_LIMITS, diffLines } from '../src/workbench/diff.js'
import DiffView from '../src/workbench/DiffView.jsx'

function reconstruct(result, side) {
  return result.rows.filter(row => row.kind !== (side === 'base' ? 'added' : 'removed')).map(row => row.raw).join('')
}

// Independent small-input oracle: enumerate subsequences, not the production DP algorithm.
function longestSharedSubsequence(a, b) {
  const candidates = new Set()
  for (let mask = 0; mask < 2 ** a.length; mask++) candidates.add(JSON.stringify(a.filter((_, index) => mask & (1 << index))))
  let longest = 0
  for (let mask = 0; mask < 2 ** b.length; mask++) {
    const candidate = b.filter((_, index) => mask & (1 << index))
    if (candidates.has(JSON.stringify(candidate))) longest = Math.max(longest, candidate.length)
  }
  return longest
}

function nodes(tree, predicate) {
  return [...(predicate(tree) ? [tree] : []), ...(tree.childNodes ?? []).flatMap(child => nodes(child, predicate))]
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value
const nodeText = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(nodeText).join('')
const markup = props => renderToStaticMarkup(createElement(DiffView, props))

test('line replacements retain both contents and independent line numbers', () => {
  const base = 'title\nold\nkeep\ntail\n'; const draft = 'title\nnew\nextra\nkeep\ntail\n'
  const result = diffLines(base, draft)
  expect(result).toMatchObject({ mode: 'exact', changed: true, added: 2, removed: 1 })
  expect(reconstruct(result, 'base')).toBe(base)
  expect(reconstruct(result, 'draft')).toBe(draft)
  expect(result.rows.map(({ kind, beforeLine, afterLine }) => [kind, beforeLine, afterLine])).toEqual([
    ['context', 1, 1], ['removed', 2, null], ['added', null, 2], ['added', null, 3], ['context', 3, 4], ['context', 4, 5],
  ])
})

test('empty files, blank lines, CRLF, CR and final-newline changes reconstruct exactly', () => {
  for (const [base, draft] of [['', '\n'], ['\n', ''], ['same\n', 'same'], ['same\r\n', 'same\n'], ['\r\n\r\n', '\r\n'], ['one\rtwo\r', 'one\rtwo'], ['', ''], ['\n\n', '\n\n']]) {
    const result = diffLines(base, draft)
    expect(result.mode).toBe('exact')
    expect(reconstruct(result, 'base')).toBe(base)
    expect(reconstruct(result, 'draft')).toBe(draft)
    expect(result.changed).toBe(base !== draft)
  }
  expect(diffLines('same\n', 'same').rows.map(row => row.ending)).toEqual(['LF', null])
  expect(diffLines('same\r\n', 'same\n')).toMatchObject({ added: 1, removed: 1 })
})

test('repeated and moved lines use a minimal edit script across deterministic samples', () => {
  let seed = 271828
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max }
  for (let iteration = 0; iteration < 80; iteration++) {
    const a = Array.from({ length: random(8) }, () => ['a\n', 'b\n', 'c\n'][random(3)])
    const b = Array.from({ length: random(8) }, () => ['a\n', 'b\n', 'c\n'][random(3)])
    const result = diffLines(a.join(''), b.join(''))
    expect(reconstruct(result, 'base')).toBe(a.join(''))
    expect(reconstruct(result, 'draft')).toBe(b.join(''))
    expect(result.added + result.removed).toBe(a.length + b.length - 2 * longestSharedSubsequence(a, b))
    expect(result.rows.filter(row => row.beforeLine !== null).map(row => row.beforeLine)).toEqual(a.map((_, i) => i + 1))
    expect(result.rows.filter(row => row.afterLine !== null).map(row => row.afterLine)).toEqual(b.map((_, i) => i + 1))
  }
})

test('distant changes retain their context and collapse only unchanged lines', () => {
  const base = Array.from({ length: 100 }, (_, index) => `line ${index}\n`)
  const draft = [...base]; draft[20] = 'first change\n'; draft[75] = 'second change\n'
  const result = diffLines(base.join(''), draft.join(''))
  expect(result.visible.filter(row => row.kind === 'removed').map(row => row.raw)).toEqual([base[20], base[75]])
  expect(result.visible.filter(row => row.kind === 'added').map(row => row.raw)).toEqual([draft[20], draft[75]])
  expect(result.visible.filter(row => row.kind === 'omitted').length).toBe(3)
  expect(result.visible.reduce((count, row) => count + (row.kind === 'omitted' ? row.count : 1), 0)).toBe(result.rows.length)
  expect(result.visible.length).toBeLessThan(25)
})

test('common prefixes and suffixes avoid a large comparison table', () => {
  const base = Array.from({ length: 5000 }, (_, index) => `${index}\n`)
  const draft = [...base]; draft[2500] = 'changed\n'
  const result = diffLines(base.join(''), draft.join(''), { maxCells: 4 })
  expect(result).toMatchObject({ mode: 'exact', added: 1, removed: 1 })
  expect(reconstruct(result, 'draft')).toBe(draft.join(''))
  expect(result.visible.length).toBeLessThan(12)
})

test('comparison and displayed-output limits return unclassified excerpts without invented counts', () => {
  const cases = [
    ['a\nb\nc\n', 'x\ny\nz\n', { maxCells: 10 }, 'comparison-limit'],
    ['', 'a\nb\nc\n', { maxRows: 2 }, 'display-limit'],
    ['a\nb\n', 'c\nd\n', { maxLines: 3 }, 'line-limit'],
    ['12345', '67890', { maxChars: 8 }, 'character-limit'],
  ]
  for (const [base, draft, limits, reason] of cases) {
    const result = diffLines(base, draft, limits)
    expect(result).toMatchObject({ mode: 'fallback', changed: true, reason })
    expect(Object.hasOwn(result, 'added')).toBe(false)
    expect(Object.hasOwn(result, 'removed')).toBe(false)
  }
})

test('large fallback excerpts bound text and line count while reporting omitted content', () => {
  const longLine = 'a'.repeat(DIFF_LIMITS.maxChars + 1)
  const result = diffLines(longLine, 'other', { maxChars: Number.MAX_SAFE_INTEGER })
  expect(result.mode).toBe('fallback')
  expect(result.reason).toBe('character-limit')
  expect(result.base.lines[0].text.length).toBe(DIFF_LIMITS.excerptChars)
  expect(result.base).toMatchObject({ omittedChars: longLine.length - DIFF_LIMITS.excerptChars, partialLastLine: true })
  const manyLines = diffLines('a\n'.repeat(20_000), 'b')
  expect(manyLines.reason).toBe('line-limit')
  expect(manyLines.base.lines.length).toBe(DIFF_LIMITS.excerptLines)
  expect(manyLines.base.omittedChars).toBe(40_000 - 2 * DIFF_LIMITS.excerptLines)
  expect(manyLines.base.partialLastLine).toBe(false)
})

test('identical oversized files are known equal without materializing a diff', () => {
  const value = 'a'.repeat(DIFF_LIMITS.maxChars)
  expect(diffLines(value, value)).toEqual({ mode: 'equal', changed: false, added: 0, removed: 0, rows: [], visible: [] })
  expect(diffLines('a\n'.repeat(20_000), 'a\n'.repeat(20_000)).changed).toBe(false)
  expect(() => diffLines(null, '')).toThrow('must be text')
})

test('rendered diff exposes counts, table semantics, keyboard scroll and final-newline changes', () => {
  const tree = parseFragment(markup({ path: 'app/page.js', base: 'old\n', draft: 'new' }))
  const sections = nodes(tree, node => node.tagName === 'section')
  expect(attr(sections[0], 'aria-labelledby')).toBeTruthy()
  expect(nodes(tree, node => attr(node, 'aria-label') === '1 addition, 1 deletion').length).toBe(1)
  expect(nodes(tree, node => attr(node, 'tabindex') === '0' && attr(node, 'aria-label') === 'Scrollable changes in app/page.js').length).toBe(1)
  expect(nodes(tree, node => node.tagName === 'th' && attr(node, 'scope') === 'col').map(nodeText)).toEqual(['Base', 'Draft', 'Change', 'Content'])
  expect(nodeText(tree)).toContain('Deleted')
  expect(nodeText(tree)).toContain('Added')
  expect(nodes(tree, node => attr(node, 'aria-label') === 'No final newline').length).toBe(1)
})

test('rendered filenames and source are escaped rather than interpreted as markup', () => {
  const attack = '<img src=x onerror="throw 1">'
  const tree = parseFragment(markup({ path: attack, base: '', draft: `${attack}\n` }))
  expect(nodes(tree, node => node.tagName === 'img' || node.tagName === 'script').length).toBe(0)
  expect(nodes(tree, node => node.tagName === 'code').map(nodeText)).toEqual([attack])
  expect(nodes(tree, node => node.tagName === 'h2').map(nodeText)).toEqual([attack])
})

test('fallback rendering truthfully separates excerpts and has no classified rows or counts', () => {
  const html = markup({ base: 'a'.repeat(DIFF_LIMITS.maxChars + 1), draft: 'new' })
  const tree = parseFragment(html)
  expect(nodeText(tree)).toContain('exact addition and deletion counts are unavailable')
  expect(nodes(tree, node => attr(node, 'aria-label') === 'Saved base excerpt').length).toBe(1)
  expect(nodes(tree, node => attr(node, 'aria-label') === 'Your draft excerpt').length).toBe(1)
  expect(html).not.toContain('class="askk-diff-counts"')
  expect(html).not.toContain('class="askk-diff-added"')
  expect(nodeText(tree)).toContain('The last shown line is incomplete.')
})
