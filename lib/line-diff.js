// A line diff for showing an edit: rows of { op: " " | "-" | "+", text, a?, b? }
// (a / b: line numbers before / after), unchanged runs folded to
// { op: "…", count } beyond `context` lines around each change.
// Common prefix and suffix are trimmed first; the middle is an LCS (falls
// back to "all removed, all added" when it is too big to compare).

const MAX_CELLS = 4_000_000

export function diffLines(before, after, { context = 3 } = {}) {
  const a = (before ?? "").split("\n")
  const b = (after ?? "").split("\n")
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const rows = []
  for (let i = 0; i < start; i++) rows.push({ op: " ", text: a[i], a: i + 1, b: i + 1 })
  for (const row of middle(a.slice(start, endA), b.slice(start, endB))) {
    rows.push({ op: row.op, text: row.text, ...(row.op !== "+" ? { a: start + row.i + 1 } : {}), ...(row.op !== "-" ? { b: start + row.j + 1 } : {}) })
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) rows.push({ op: " ", text: a[i], a: i + 1, b: j + 1 })
  return fold(rows, context)
}

function middle(a, b) {
  const n = a.length
  const m = b.length
  if (!n || !m || n * m > MAX_CELLS) {
    return [...a.map((text, i) => ({ op: "-", text, i })), ...b.map((text, j) => ({ op: "+", text, j }))]
  }
  // lcs[i][j]: longest common subsequence of a[i..] and b[j..]
  const width = m + 1
  const lcs = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ op: " ", text: a[i], i: i++, j: j++ })
    else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) out.push({ op: "-", text: a[i], i: i++ })
    else out.push({ op: "+", text: b[j], j: j++ })
  }
  while (i < n) out.push({ op: "-", text: a[i], i: i++ })
  while (j < m) out.push({ op: "+", text: b[j], j: j++ })
  return out
}

function fold(rows, context) {
  const near = new Uint8Array(rows.length)
  rows.forEach((row, i) => {
    if (row.op === " ") return
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) near[k] = 1
  })
  const out = []
  let hidden = 0
  rows.forEach((row, i) => {
    if (near[i]) {
      if (hidden) out.push({ op: "…", count: hidden })
      hidden = 0
      out.push(row)
    } else hidden++
  })
  if (hidden) out.push({ op: "…", count: hidden })
  return out
}

export const diffStats = (rows) => ({
  added: rows.filter((r) => r.op === "+").length,
  removed: rows.filter((r) => r.op === "-").length,
})
