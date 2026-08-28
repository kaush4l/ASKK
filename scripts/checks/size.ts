/**
 * size — the 40-line function rule, and the two numbers a human reads.
 *
 * The old tree capped files at 200 lines and got **relocation, not
 * simplification**: ten files at exactly 200 lines and one class spread across
 * six of them. ARCHITECTURE.md §8.3 replaced that cap with three things, and
 * only the first of them fails a build:
 *
 * 1. **No function longer than 40 lines.** Kept unchanged, because its failure
 *    mode is extraction, which is the thing we wanted.
 * 2. **`max`, the largest single file, is reported.** It becomes a ratchet that
 *    only goes down, but the ratchet **arms at the end of wave 2** — seeding it
 *    from a tree of scaffold would pin it to whatever the largest gate file
 *    accidentally is, and every later increment would either contort under an
 *    accident or raise it on arrival. Until then this prints the number and
 *    says out loud that nothing is holding it.
 * 3. **`total` is reported, never ratcheted.** Waves 2–6 exist to add source.
 *    A budget is declared per increment in PLAN and exceeding it is a
 *    ringmaster conversation, not a gate failure.
 *
 * `total` counts `src/**` and `scripts/**`. Relocating source out of those two
 * directories to move the number is a violation, not a refactor (§8.3).
 *
 * **What a line is.** §8.3 says non-blank source lines, and this counted
 * `split('\n').length`, which is every blank line plus one phantom line per file
 * for the trailing newline — the same off-by-one `docs/scratch/SALVAGE.md`
 * records the previous tree hitting, rediscovered because the lesson lived in a
 * document instead of in a check. It reported 1401 for a tree of 1231. The
 * command that reproduces the number by hand is printed with it, because a
 * figure nobody can check with `wc` gets argued with rather than acted on, and
 * this one becomes a ratchet at the end of wave 2.
 */

import ts from 'typescript'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** The two directories §8.3 counts, in one place, because a path change is a check change. */
const SIZE_ROOTS = ['src', 'scripts'] as const

const FUNCTION_LIMIT = 40
/** Over this a file prints an advisory with its count. It does not fail. */
const FILE_ADVISORY = 300

interface Violation { file: string; line: number; message: string }

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path)
  }
  return out.sort()
}

function isFunction(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) || ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
}

/** The name a reader would use for this function, or the shape it hangs off. */
function nameOf(node: ts.Node): string {
  const named = node as ts.Node & { name?: ts.Node }
  if (named.name && ts.isIdentifier(named.name)) return named.name.text
  const parent = node.parent as ts.Node & { name?: ts.Node }
  if (parent && parent.name && ts.isIdentifier(parent.name)) return parent.name.text
  return '(anonymous)'
}

function longFunctions(path: string, text: string): Violation[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, kind)
  const found: Violation[] = []
  const walk = (node: ts.Node): void => {
    if (isFunction(node)) {
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
      const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line
      const lines = end - start + 1
      if (lines > FUNCTION_LIMIT) {
        found.push({ file: path, line: start + 1, message: `\`${nameOf(node)}\` is ${lines} lines (limit ${FUNCTION_LIMIT})` })
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}

/** §8.3's unit: a line with something on it. Matches `grep -c '[^[:space:]]'`. */
function nonBlankLines(text: string): number {
  return text.split('\n').filter((line) => line.trim() !== '').length
}

const root = process.cwd()
const violations: Violation[] = []
let total = 0
let max = { file: '', lines: 0 }
const advisories: string[] = []

for (const dir of SIZE_ROOTS) {
  const files = sourceFiles(join(root, dir))
  // A check aimed at an empty directory passes forever. A path change is a check change.
  if (files.length === 0) {
    violations.push({ file: dir, line: 0, message: 'scanned 0 files — the check is aimed at nothing' })
    continue
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const lines = nonBlankLines(text)
    total += lines
    if (lines > max.lines) max = { file: relative(root, file), lines }
    if (lines > FILE_ADVISORY) advisories.push(`${relative(root, file)} is ${lines} lines`)
    violations.push(...longFunctions(file, text))
  }
  console.log(`size: ${dir} — ${files.length} file(s) scanned`)
}

// The reproduction command, not a description of one. §8.3 also promises a
// delta against `scripts/checks/lines.json`; that file does not exist and this
// check writes nothing, so it claims no delta rather than inventing one.
console.log(`size: total ${total} non-blank lines across ${SIZE_ROOTS.join(' + ')}`)
console.log(
  `size: reproduce with  find ${SIZE_ROOTS.join(' ')} \\( -name '*.ts' -o -name '*.tsx' \\) | xargs grep -ch '[^[:space:]]' | paste -sd+ - | bc`,
)
console.log('size: no delta reported — scripts/checks/lines.json does not exist and nothing writes it (§8.3 is being restated)')
console.log(`size: max ${max.lines} lines — ${max.file}  (ratchet NOT armed; it arms at the end of wave 2, §8.3)`)
for (const advisory of advisories) console.log(`size: advisory — ${advisory}`)

for (const v of violations) console.error(`size FAIL ${relative(root, v.file) || v.file}:${v.line}  ${v.message}`)
if (violations.length > 0) {
  console.error(`size: ${violations.length} violation(s)`)
  process.exit(1)
}
console.log('size: ok')
