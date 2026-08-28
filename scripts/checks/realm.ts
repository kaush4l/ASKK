/**
 * realm — ARCHITECTURE.md §3.5, all three rules.
 *
 * A module knows which realm it is in **because of where it lives in the tree**,
 * and there is no expressible way to ask at runtime. That is the whole design,
 * and it exists because MEASURED M3 found `typeof window` folded to a constant
 * by the bundler before the code ran: the guard that was supposed to keep the
 * main realm out of the worker compiles to nothing in the worker chunk, which
 * is the one place it was needed. So this check bans the question rather than
 * trusting the answer.
 *
 * Three rules, and each names what it protects when it fails:
 *
 * 1. **A per-directory allowlist of free globals.** Closed lists, from §3.5's
 *    table. `src/client/**` may not name `indexedDB`; `src/engine/**` may not
 *    name `window`. `indexedDB` exists in *both* realms — nothing about the
 *    platform stops MAIN opening the database — so §3.4 calls this what it is:
 *    a convention with a check, not a law of nature. This is the check.
 * 2. **A realm banner on the first line** of every file in a realm-bound
 *    directory. Positional and total, so a *missing* banner on a new file is
 *    detectable — the previous formulation applied it only to files with module
 *    state, which no check can see the absence of.
 * 3. **The `typeof` ban**, in every directory without exception, over a closed
 *    set of realm-discriminating globals; and `globalThis` may not appear at
 *    all. The defect respells itself — `typeof document === 'undefined'`,
 *    `'window' in globalThis` — so the subject is banned, not the spelling.
 *
 * And a fourth thing that is not a rule but a property: **every file under
 * `src/` must be matched by one of the rules below.** A new directory with no
 * entry fails rather than being scanned by nothing, because a check aimed at a
 * directory that no longer exists is how a token linter once passed with every
 * literal in the tree.
 *
 * The tokeniser is `checks/purity.ts`'s, imported rather than rewritten (§4).
 */

import ts from 'typescript'
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { at, declaredNames, ES_GLOBALS, freeIdentifiers, parseFile, tsFiles } from './purity'
import type { Violation } from './purity'

/**
 * §3.5's table, as a closed list per directory. Longest matching prefix wins,
 * so `src/adapters/browser` would sit in front of `src/adapters` when it
 * arrives. A banner of `null` means the directory needs none: core and protocol
 * are realm-free by construction, and ui/app are unambiguously main.
 */
const RULES: readonly { dir: string; allow: readonly string[]; banner: string | null }[] = [
  { dir: 'src/core', allow: [], banner: null },
  // §3.5's row reads *(nothing)* — protocol is imported by BOTH realms, so
  // anything ambient in it is ambient in both. This entry landed at 3.2 with
  // the directory's first file: until then `src/protocol` had no rule, and the
  // rule below about a file no rule covers is what said so, by name.
  { dir: 'src/protocol', allow: [], banner: null },
  { dir: 'src/engine', allow: ['self', 'fetch', 'crypto', 'indexedDB', 'navigator', 'URL', 'postMessage', 'AbortController'], banner: 'worker' },
  { dir: 'src/client', allow: ['window', 'document', 'localStorage', 'Worker', 'URL', 'navigator'], banner: 'main' },
  { dir: 'src/ui', allow: ['window', 'document', 'localStorage', 'URL', 'navigator', 'requestAnimationFrame'], banner: null },
  { dir: 'src/app', allow: ['window', 'document', 'localStorage', 'URL', 'navigator', 'requestAnimationFrame'], banner: null },
]

/** Applying `typeof` to any of these is asking which realm you are in. Banned everywhere. */
const UNASKABLE = new Set([
  'window', 'document', 'self', 'globalThis', 'localStorage', 'indexedDB',
  'importScripts', 'navigator', 'Worker', 'process',
])

/** The banner every realm-bound file opens with, and the three it may be. */
const BANNERS = ['worker', 'main', 'host'] as const

function ruleFor(path: string): (typeof RULES)[number] | null {
  const matches = RULES.filter((rule) => path === rule.dir || path.startsWith(`${rule.dir}/`))
  return matches.sort((a, b) => b.dir.length - a.dir.length)[0] ?? null
}

/** Rule 3, on the token stream: the question itself, however it is spelled. */
function unaskable(sf: ts.SourceFile): Violation[] {
  const found: Violation[] = []
  const walk = (node: ts.Node): void => {
    if (ts.isTypeOfExpression(node) && ts.isIdentifier(node.expression) && UNASKABLE.has(node.expression.text)) {
      found.push(at(sf, node, `\`typeof ${node.expression.text}\` — realm is decided by the directory, never asked for at runtime, and the bundler folds this one before it runs (§3.5 rule 3)`))
    }
    if (ts.isIdentifier(node) && node.text === 'globalThis') {
      found.push(at(sf, node, '`globalThis` — banned outright, because it is the escape hatch every spelling of the realm question goes through (§3.5 rule 3)'))
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}

/** Rule 2, read off the first line so that its absence is as visible as its being wrong. */
function banner(path: string, expected: string | null): Violation[] {
  if (expected === null) return []
  const first = readFileSync(path, 'utf8').split('\n', 1)[0] ?? ''
  const match = /^\/\/ REALM: (\w+)$/.exec(first)
  if (!match) {
    return [{ file: path, line: 1, message: `no realm banner — every file here opens with \`// REALM: ${expected}\` (§3.5 rule 2)` }]
  }
  if (match[1] !== expected) {
    return [{ file: path, line: 1, message: `banner says \`${match[1]}\`, but this directory is ${expected} (§3.5 rule 2)` }]
  }
  if (!BANNERS.includes(match[1] as (typeof BANNERS)[number])) {
    return [{ file: path, line: 1, message: `banner \`${match[1]}\` is not one of ${BANNERS.join(', ')} (§3.5 rule 2)` }]
  }
  return []
}

function checkFile(path: string, rule: (typeof RULES)[number]): Violation[] {
  const sf = parseFile(path)
  const permitted = new Set([...ES_GLOBALS, ...rule.allow])
  const globals = freeIdentifiers(sf, declaredNames(sf), permitted).map((v) => ({
    ...v,
    message: `${v.message} — ${rule.dir} permits only ${rule.allow.length > 0 ? rule.allow.join(' ') : 'the ES built-ins'} (§3.5 rule 1)`,
  }))
  return [...banner(path, rule.banner), ...globals, ...unaskable(sf)]
}

function runRealm(): Violation[] {
  const violations: Violation[] = []
  const files = tsFiles('src')
  if (files.length === 0) {
    return [{ file: 'src', line: 0, message: 'scanned 0 files — the check is aimed at nothing' }]
  }
  for (const file of files) {
    const rule = ruleFor(file)
    if (!rule) {
      violations.push({ file, line: 0, message: 'no realm rule covers this file — add its directory to RULES in scripts/checks/realm.ts, with its allowlist from ARCHITECTURE.md §3.5, rather than leaving it scanned by nothing' })
      continue
    }
    violations.push(...checkFile(file, rule))
  }
  for (const { dir } of RULES) {
    if (!existsSync(dir)) continue
    console.log(`realm: ${dir} — ${files.filter((f) => ruleFor(f)?.dir === dir).length} file(s) scanned`)
  }
  return violations
}

if (import.meta.main) {
  const violations = runRealm().map((v) => ({ ...v, file: relative(process.cwd(), v.file) || v.file }))
  for (const v of violations) console.error(`realm FAIL ${v.file}:${v.line}  ${v.message}`)
  if (violations.length > 0) {
    console.error(`realm: ${violations.length} violation(s)`)
    process.exit(1)
  }
  console.log('realm: ok')
}
