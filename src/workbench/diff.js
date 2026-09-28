/** Exact line diff with fixed work/render limits. Tokens retain their original line endings. */
export const DIFF_LIMITS = Object.freeze({ maxChars: 1_000_000, maxLines: 12_000, maxCells: 600_000, maxRows: 2400, excerptChars: 16_000, excerptLines: 120, contextLines: 3 })

const linesOf = text => {
  const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []
  if (lines.at(-1) === '') lines.pop()
  return lines
}
const endingOf = raw => raw.endsWith('\r\n') ? 'CRLF' : raw.endsWith('\n') ? 'LF' : raw.endsWith('\r') ? 'CR' : null
const textOf = raw => raw.replace(/(?:\r\n|\r|\n)$/, '')
const limit = (value, maximum) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : maximum

function excerpt(text) {
  const tokens = linesOf(text.slice(0, DIFF_LIMITS.excerptChars)).slice(0, DIFF_LIMITS.excerptLines)
  const shown = tokens.join('')
  return { lines: tokens.map((raw, index) => ({ number: index + 1, text: textOf(raw) })), omittedChars: text.length - shown.length, partialLastLine: shown.length < text.length && tokens.length > 0 && !endingOf(tokens.at(-1)) }
}

/** Collapse only unchanged rows. Exact full rows remain available for reconstruction. */
function contextRows(rows, context) {
  const ranges = []
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].kind === 'context') continue
    const start = Math.max(0, index - context); const end = Math.min(rows.length, index + context + 1)
    if (ranges.length && start <= ranges.at(-1).end) ranges.at(-1).end = end
    else ranges.push({ start, end })
  }
  const visible = []; let next = 0
  const omit = end => { if (end > next) visible.push({ kind: 'omitted', count: end - next, beforeLine: rows[next].beforeLine, afterLine: rows[next].afterLine }) }
  for (const range of ranges) { omit(range.start); visible.push(...rows.slice(range.start, range.end)); next = range.end }
  if (ranges.length) omit(rows.length)
  return visible
}

/**
 * Exact rows: {kind: context|added|removed, raw, text, ending, beforeLine, afterLine}.
 * Joining raw on rows other than added reconstructs base; excluding removed reconstructs draft.
 * Large identical strings use mode=equal without allocating rows. Fallback excerpts are
 * unclassified and never claim exact addition/deletion counts. Options may lower, not raise, limits.
 */
export function diffLines(base, draft, options = {}) {
  if (typeof base !== 'string' || typeof draft !== 'string') throw new TypeError('Diff inputs must be text')
  const limits = Object.fromEntries(['maxChars', 'maxLines', 'maxCells', 'maxRows'].map(key => [key, limit(options[key], DIFF_LIMITS[key])]))
  const fallback = reason => ({ mode: 'fallback', changed: true, reason, base: excerpt(base), draft: excerpt(draft) })
  if (base.length + draft.length > limits.maxChars) return base === draft ? { mode: 'equal', changed: false, added: 0, removed: 0, rows: [], visible: [] } : fallback('character-limit')
  const before = linesOf(base); const after = linesOf(draft)
  if (before.length + after.length > limits.maxLines) return base === draft ? { mode: 'equal', changed: false, added: 0, removed: 0, rows: [], visible: [] } : fallback('line-limit')
  let prefix = 0; let suffix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  const a = before.slice(prefix, before.length - suffix); const b = after.slice(prefix, after.length - suffix)
  const width = b.length + 1
  if ((a.length + 1) * width > limits.maxCells) return fallback('comparison-limit')
  // Long common prefixes/suffixes are excluded before allocating the LCS table.
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
  const rows = []; let beforeLine = 1; let afterLine = 1; let added = 0; let removed = 0
  const emit = (kind, raw) => {
    rows.push({ kind, raw, text: textOf(raw), ending: endingOf(raw), beforeLine: kind === 'added' ? null : beforeLine++, afterLine: kind === 'removed' ? null : afterLine++ })
    if (kind === 'added') added++
    if (kind === 'removed') removed++
  }
  for (let i = 0; i < prefix; i++) emit('context', before[i])
  let i = 0; let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { emit('context', a[i]); i++; j++ }
    else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) emit('removed', a[i++])
    else emit('added', b[j++])
  }
  for (let k = before.length - suffix; k < before.length; k++) emit('context', before[k])
  const visible = contextRows(rows, DIFF_LIMITS.contextLines)
  if (visible.length > limits.maxRows) return fallback('display-limit')
  return { mode: 'exact', changed: added + removed > 0, added, removed, rows, visible }
}
