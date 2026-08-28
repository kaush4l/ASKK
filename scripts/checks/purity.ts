/**
 * purity — the core references no ambient global. ARCHITECTURE.md §2.1.
 *
 * This works on the **token stream, never on source substrings**. The previous
 * tree expressed the rule as a denylist of spellings and it was unsatisfiable:
 * banning the token `self` matches `"self-contained"`, which occurs inside
 * prompt bytes that may never be edited (`tests/golden/render-bare.prompt:15`),
 * and banning `fetch(` matches the sanctioned `ports.fetch(url)` call site.
 * So the file is parsed, string literals and comments are never looked at, and
 * what is collected is **free identifiers** — identifiers in a value position
 * that resolve to neither a binding in the file nor an import. The rule is then
 * an allowlist of permitted globals per directory, because the open set is the
 * violations and not the ways of writing them.
 *
 * The one approximation, stated plainly: a name bound anywhere in a file is
 * treated as bound everywhere in it, rather than resolved through a real scope
 * chain. It cannot produce a false failure. What it misses is a file that
 * declares a local named exactly like the ambient global it reaches for
 * elsewhere — a stranger thing to write than the violation itself.
 *
 * **This file owns THE tokeniser.** `checks/realm.ts` imports the pieces below
 * rather than writing a second one — that was the condition on which 2.1's
 * +87-line overrun was accepted, and re-implementing here would mean the trade
 * was never made. Everything the second check needs is exported; everything
 * that is purity's own rule stays private. The script half runs under
 * `import.meta.main`, so importing this module runs no check.
 */

import ts from 'typescript'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** ECMAScript built-ins that carry no environment with them. */
export const ES_GLOBALS = new Set([
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Math', 'JSON', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'Proxy', 'Reflect', 'Error', 'TypeError', 'RangeError',
  'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError',
  'undefined', 'NaN', 'Infinity', 'arguments',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
])

/**
 * The per-directory allowlist. `src/core/**` gets nothing beyond the built-ins
 * above — `Intl` is absent on purpose, because `resolvedOptions().timeZone`
 * reads the host's zone, which is the ambient environment the seam removes.
 */
const PURITY_ROOTS: readonly { dir: string; allow: readonly string[] }[] = [
  { dir: 'src/core', allow: [] },
]

export interface Violation { file: string; line: number; message: string }

export function tsFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsFiles(path))
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path)
  }
  return out.sort()
}

function addBindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) { into.add(name.text); return }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) addBindingNames(element.name, into)
  }
}

/** Every name the file binds: imports, declarations, parameters, destructurings. */
export function declaredNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const walk = (node: ts.Node): void => {
    if (ts.isImportClause(node) && node.name) names.add(node.name.text)
    else if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) names.add(node.name.text)
    else if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      addBindingNames(node.name, names)
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) || ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) &&
      node.name && ts.isIdentifier(node.name)
    ) names.add(node.name.text)
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return names
}

/** True for the slot that *declares* or *names* something rather than referring to it. */
function isNameSlot(parent: ts.Node, child: ts.Node): boolean {
  const slot = parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node }
  if (child === slot.propertyName) return true
  if (child !== slot.name) return false
  if (ts.isShorthandPropertyAssignment(parent)) return false
  return !ts.isComputedPropertyName(child)
}

/** Nodes that hold no value-position identifier at all. Types are the big one. */
function isSkipped(node: ts.Node): boolean {
  return ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) || ts.isTypeParameterDeclaration(node) ||
    ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
}

export function freeIdentifiers(sf: ts.SourceFile, bound: Set<string>, allow: Set<string>): Violation[] {
  const found: Violation[] = []
  const visit = (node: ts.Node): void => {
    if (isSkipped(node)) return
    // A JSX tag is not a value reference unless it is capitalised: `<main>` is
    // an intrinsic element and `main` is a string in the emitted call, while
    // `<Shell/>` really is the binding `Shell`. Reading every tag as an
    // identifier would report every HTML element in the tree as a free global.
    if (ts.isJsxClosingElement(node) || ts.isJsxOpeningFragment(node) || ts.isJsxClosingFragment(node)) return
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (!(ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text))) visit(node.tagName)
      visit(node.attributes)
      return
    }
    if (ts.isPropertyAccessExpression(node)) { visit(node.expression); return }
    if (ts.isQualifiedName(node)) { visit(node.left); return }
    if (ts.isIdentifier(node)) {
      const name = node.text
      if (!bound.has(name) && !allow.has(name)) found.push(at(sf, node, `free global \`${name}\``))
      return
    }
    ts.forEachChild(node, (child) => { if (!isNameSlot(node, child)) visit(child) })
  }
  ts.forEachChild(sf, visit)
  return found
}

export function at(sf: ts.SourceFile, node: ts.Node, message: string): Violation {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return { file: sf.fileName, line: line + 1, message }
}

/** Path of a member expression, e.g. `Date.now`, or null if it is not a plain one. */
function memberPath(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text
  if (!ts.isPropertyAccessExpression(node)) return null
  const left = memberPath(node.expression)
  return left === null ? null : `${left}.${node.name.text}`
}

/**
 * Ambient behaviour reached through an *allowed* identifier. Matched as AST
 * shapes, not as patterns — stating them as source patterns would reintroduce
 * the string-literal false positive one size smaller. `new Date(value)` takes
 * an argument, converts rather than reads a clock, and is permitted.
 */
function ambientConstructs(sf: ts.SourceFile, bound: Set<string>): Violation[] {
  const found: Violation[] = []
  const walk = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && memberPath(node.expression) === 'Date' &&
      !bound.has('Date') && (node.arguments?.length ?? 0) === 0) {
      found.push(at(sf, node, 'ambient clock `new Date()` — take it from ports.clock.now()'))
    }
    if (ts.isCallExpression(node)) {
      const path = memberPath(node.expression)
      const root = path?.split('.')[0] ?? ''
      if ((path === 'Date.now' || path === 'Math.random') && !bound.has(root)) {
        found.push(at(sf, node, `ambient \`${path}()\``))
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}

/** The core may import the core. Anything else — `node:fs`, a package, another layer — is not ambient-free. */
function imports(sf: ts.SourceFile): Violation[] {
  const found: Violation[] = []
  const walk = (node: ts.Node): void => {
    const spec = specifierOf(node)
    if (spec !== null && !spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('@/core/')) {
      found.push(at(sf, node, `imports \`${spec}\` — the core may import only the core`))
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}

function specifierOf(node: ts.Node): string | null {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier.text
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const first = node.arguments[0]
    if (first && ts.isStringLiteral(first)) return first.text
  }
  return null
}

/** One file, parsed. The single place a `SourceFile` is made, so both checks read the same tree. */
export function parseFile(path: string): ts.SourceFile {
  const text = readFileSync(path, 'utf8')
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, kind)
}

function checkFile(path: string, allow: Set<string>): Violation[] {
  const sf = parseFile(path)
  const bound = declaredNames(sf)
  return [...imports(sf), ...freeIdentifiers(sf, bound, allow), ...ambientConstructs(sf, bound)]
}

function runPurity(root: string): Violation[] {
  const violations: Violation[] = []
  for (const { dir, allow } of PURITY_ROOTS) {
    const files = tsFiles(join(root, dir))
    // A check aimed at an empty directory passes forever. A path change is a check change.
    if (files.length === 0) {
      violations.push({ file: dir, line: 0, message: 'scanned 0 files — the check is aimed at nothing' })
      continue
    }
    const permitted = new Set([...ES_GLOBALS, ...allow])
    for (const file of files) violations.push(...checkFile(file, permitted))
    console.log(`purity: ${dir} — ${files.length} file(s) scanned`)
  }
  return violations.map((v) => ({ ...v, file: relative(root, v.file) || v.file }))
}

if (import.meta.main) {
  const root = process.cwd()
  const violations = runPurity(root)
  for (const v of violations) console.error(`purity FAIL ${v.file}:${v.line}  ${v.message}`)
  if (violations.length > 0) {
    console.error(`purity: ${violations.length} violation(s)`)
    process.exit(1)
  }
  console.log('purity: ok')
}
