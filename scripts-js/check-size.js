#!/usr/bin/env bun
/**
 * I12, executable. Files <= 200 lines, functions <= 40 lines, over every
 * package source file. Prints every violation and exits non-zero — a standard
 * a gate cannot execute is not a standard (I17).
 */
import { Glob } from 'bun'

const FILE_LIMIT = 200
const FN_LIMIT = 40
const ROOT = new URL('..', import.meta.url).pathname

/** Lines that OPEN a function, by the shapes this codebase actually writes. */
const OPENERS = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)?\s*\(/,
  /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/,
  /^\s*(?:static\s+|async\s+|get\s+|set\s+|\*)*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{\s*$/,
]

/** Count of `{` minus `}` on a line, ignoring the ones inside strings. */
function delta(/** @type {string} */ line) {
  const bare = line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, '')
  return (bare.match(/\{/g)?.length ?? 0) - (bare.match(/\}/g)?.length ?? 0)
}

/** Every function in a file that runs past the limit. */
function longFunctions(/** @type {string[]} */ lines) {
  const over = []
  for (let i = 0; i < lines.length; i++) {
    const opener = OPENERS.map((re) => (lines[i] ?? "").match(re)).find(Boolean)
    if (!opener || delta(lines[i] ?? "") <= 0) continue
    let depth = delta(lines[i] ?? "")
    let end = i
    while (end + 1 < lines.length && depth > 0) {
      end++
      depth += delta(lines[end] ?? "")
    }
    const length = end - i + 1
    if (length > FN_LIMIT) over.push({ name: opener[1] ?? '(anonymous)', line: i + 1, length })
    i = end
  }
  return over
}

const violations = []
for await (const file of new Glob('{packages,apps}/**/*.{js,jsx}').scan({ cwd: ROOT })) {
  if (file.includes('node_modules') || file.includes('/.next/') || file.includes('/out/')) continue
  const lines = (await Bun.file(ROOT + file).text()).split('\n')
  if (lines.length > FILE_LIMIT) violations.push(`${file}: ${lines.length} lines (limit ${FILE_LIMIT})`)
  for (const fn of longFunctions(lines)) {
    violations.push(`${file}:${fn.line}: ${fn.name} is ${fn.length} lines (limit ${FN_LIMIT})`)
  }
}

if (violations.length) {
  console.error(`I12 FAIL — ${violations.length} violation(s):`)
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('I12 ok — every file <= 200 lines, every function <= 40')
