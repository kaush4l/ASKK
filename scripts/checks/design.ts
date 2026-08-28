// REALM: host
/**
 * design — DESIGN.md's static rules, one named sub-check each.
 *
 * `docs/DESIGN.md` §9 is the subject: *a rule the build cannot execute is a
 * rule that will quietly stop applying*. This file is what executes the half of
 * that document a directory listing can decide. The other half needs a build
 * and a real browser and lives in `scripts/browser/*` (ARCHITECTURE.md §10.2
 * ruling 3); it is named below under NOT ENFORCED HERE rather than left to be
 * inferred from silence.
 *
 * Three properties, each of which exists because its absence has cost this
 * project something:
 *
 * 1. **A named sub-check per rule, each with its own failure message.** A gate
 *    that fails with `design check failed` is not actionable, and a check
 *    nobody can act on gets disabled. Every failure below names the rule, the
 *    file, the line and what to do instead.
 * 2. **`SCAN_ROOTS` is one exported constant.** DESIGN's own `check-tokens.js`
 *    grepped `app/`; tokens then moved to `src/ui/`, and that check would have
 *    scanned a directory containing no tokens and passed with every colour
 *    literal in the tree (LESSONS defect 7, ARCHITECTURE.md §10.2 ruling 1).
 *    One constant means re-aiming this check is a single visible edit.
 * 3. **A root that matches nothing is a failure, never a clean tree.** That is
 *    the `scan-roots` sub-check, and it is first, because every other sub-check
 *    here is a filter over the same file list and a filter over an empty list
 *    is green by construction. This is the whole defect of point 2 stated as an
 *    assertion instead of as a lesson.
 *
 * A sub-check whose subject does not exist yet reports **PENDING**, names the
 * file it is waiting for and the increment that writes it, and runs for real
 * the moment that file appears. It is not silence, and it is not a pass.
 */

import ts from 'typescript'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The two directories DESIGN §9.0 names, in one place. **Both**, because
 * `src/app/layout.tsx` and any `src/app/globals.css` are interface files too
 * and a scan of `src/ui/` alone reintroduces the same hole one directory over.
 */
export const SCAN_ROOTS = ['src/ui', 'src/app'] as const

/** The sole exemption: the one file DESIGN allows to write a visual value. */
export const TOKENS_FILE = 'src/ui/tokens.css'

/** What this check can read. Anything else under a root is reported, not skipped silently. */
const SCANNED_EXTENSIONS = ['.css', '.ts', '.tsx']

type Status = 'ok' | 'fail' | 'pending'

interface SubCheck {
  /** The name DESIGN §9.1 gives this rule. */
  name: string
  /** The rule, in the words a developer needs to act on it. */
  rule: string
  /** The files or directories this sub-check reads. A check with no stated target cannot be audited when files move. */
  target: string
  status: Status
  /** Lines printed whatever the outcome: counts, measurements, what is pending. */
  notes: string[]
  /** One line per violation, each naming file, line and remedy. */
  failures: string[]
}

interface ScannedFile {
  path: string
  text: string
  /** Comments removed, so a `100ms` in prose is not a violation and a `#fff` in a note is not a colour. */
  code: string
}

// ---------------------------------------------------------------- file intake

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out.sort()
}

/** Block and line comments removed. `://` is spared so a URL in a string is not truncated. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function readScanned(paths: string[]): ScannedFile[] {
  return paths.map((path) => {
    const text = readFileSync(path, 'utf8')
    return { path, text, code: stripComments(text) }
  })
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

// ------------------------------------------------------------- CSS parsing

interface Rule { selector: string; context: string; body: string }

function readBlock(css: string, open: number): { body: string; end: number } {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return { body: css.slice(open + 1, i), end: i + 1 }
  }
  return { body: css.slice(open + 1), end: css.length }
}

/** Every rule in a stylesheet with its at-rule context, so `:root` inside a media query is a different rule. */
function parseRules(css: string, context = ''): Rule[] {
  const out: Rule[] = []
  let prelude = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '{') {
      const { body, end } = readBlock(css, i)
      const selector = prelude.trim()
      if (selector.startsWith('@')) out.push(...parseRules(body, selector))
      else out.push({ selector, context, body })
      i = end
      prelude = ''
    } else {
      if (ch === '}') prelude = ''
      else prelude += ch
      i++
    }
  }
  return out
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of body.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(match[1] ?? '', (match[2] ?? '').trim())
  return out
}

function ruleFor(rules: Rule[], selector: string, context: string): Rule | undefined {
  return rules.find((rule) => rule.selector === selector && rule.context === context)
}

// ------------------------------------------------------------------- contrast

function channel(value: number): number {
  const srgb = value / 255
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG 2.1 relative-luminance ratio, the same arithmetic DESIGN §3 recorded its tables with. */
function ratio(a: string, b: string): number {
  const [first, second] = [luminance(a), luminance(b)]
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

const BACKGROUNDS = ['--bg', '--surface', '--surface-2'] as const

/** DESIGN §3.2/§3.3 measure "worst case across the three backgrounds it may sit on". This is that. */
function worstOnBackgrounds(palette: Map<string, string>, token: string): number {
  const fg = palette.get(token)
  if (!fg) return Number.NaN
  return Math.min(...BACKGROUNDS.map((bg) => ratio(fg, palette.get(bg) ?? '#000000')))
}

// ------------------------------------------------------------------ sub-checks

/**
 * The first sub-check, and the reason the rest mean anything. A root that
 * matches zero files is a broken check reporting a clean tree.
 */
function scanRoots(): SubCheck {
  const check: SubCheck = {
    name: 'scan-roots', rule: 'every scan root exists and matches at least one file',
    target: `SCAN_ROOTS = ${SCAN_ROOTS.join(', ')}`, status: 'ok', notes: [], failures: [],
  }
  for (const root of SCAN_ROOTS) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      check.failures.push(`${root} is not a directory — every rule below would filter an empty list and pass. Re-aim SCAN_ROOTS in scripts/checks/design.ts or restore the directory`)
      continue
    }
    const files = walk(root)
    const scanned = files.filter((f) => SCANNED_EXTENSIONS.some((e) => f.endsWith(e)))
    const skipped = files.filter((f) => !scanned.includes(f))
    if (scanned.length === 0) {
      check.failures.push(`${root} holds no ${SCANNED_EXTENSIONS.join('/')} file — a root that matches nothing is a broken check, never a clean tree (DESIGN §9.0)`)
    }
    check.notes.push(`${root}: ${scanned.length} scanned, ${skipped.length} not readable by this check${skipped.length ? ` (${[...new Set(skipped.map((f) => f.slice(f.lastIndexOf('.'))))].join(' ')})` : ''}`)
  }
  if (check.failures.length > 0) check.status = 'fail'
  return check
}

const LITERALS: { pattern: RegExp; what: string; instead: string }[] = [
  { pattern: /#[0-9A-Fa-f]{3,8}\b/g, what: 'a hex colour', instead: 'a palette token from tokens.css §3.2/§3.3' },
  { pattern: /\b(?:rgba?|hsla?|oklch|lab)\(/g, what: 'a colour function', instead: 'a palette token from tokens.css §3.2/§3.3' },
  { pattern: /\b\d+(?:\.\d+)?px\b/g, what: 'a bare pixel value', instead: 'a --s-*, --r-* or --rail-step token (§3.5)' },
  { pattern: /\b\d+(?:\.\d+)?m?s\b/g, what: 'a bare duration', instead: 'a --m-* token (§3.6)' },
]

/** DESIGN §9.1 rule 1 — tokens are the only literals. */
function tokensOnly(files: ScannedFile[]): SubCheck {
  const check: SubCheck = {
    name: 'tokens', rule: 'no colour, size, radius, shadow or duration literal outside the token file',
    target: `SCAN_ROOTS, exempting ${TOKENS_FILE}`, status: 'ok', notes: [], failures: [],
  }
  const subject = files.filter((f) => f.path !== TOKENS_FILE)
  check.notes.push(`${subject.length} file(s) scanned, ${TOKENS_FILE} exempt`)
  for (const file of subject) {
    for (const { pattern, what, instead } of LITERALS) {
      for (const hit of file.code.matchAll(pattern)) {
        check.failures.push(`${file.path}:${lineOf(file.code, hit.index ?? 0)} writes ${what} — \`${hit[0]}\`. ${TOKENS_FILE} is the only file that may; add it there with its measured contrast and use ${instead}`)
      }
    }
  }
  if (check.failures.length > 0) check.status = 'fail'
  return check
}

const TYPE_PROPERTIES = /(?:^|[;{\s])(font-size|line-height|font-family|font)\s*:\s*([^;}]+)/g
const TYPE_PROPERTIES_JSX = /\b(fontSize|lineHeight|fontFamily)\s*:\s*([^,}\n]+)/g

/** DESIGN §9.1 rule 2 — seven type steps, no others. */
function typeRamp(files: ScannedFile[], tokens: ScannedFile | undefined): SubCheck {
  const check: SubCheck = {
    name: 'ramp', rule: 'every type declaration resolves to a --t-* step or a family token; seven steps exist and none is below 11px',
    target: `SCAN_ROOTS, exempting ${TOKENS_FILE}`, status: 'ok', notes: [], failures: [],
  }
  for (const file of files.filter((f) => f.path !== TOKENS_FILE)) {
    const isCss = file.path.endsWith('.css')
    // An `@font-face` declares the family it is defining; that is not a type
    // step and flagging it would fail this rule on a correct stylesheet, which
    // is how a check gets weakened. `fonts` is what rules on those blocks.
    const code = isCss ? file.code.replace(/@font-face\s*\{[^}]*\}/g, (block) => block.replace(/[^\n]/g, ' ')) : file.code
    for (const pattern of [isCss ? TYPE_PROPERTIES : TYPE_PROPERTIES_JSX]) {
      for (const hit of code.matchAll(pattern)) {
        const value = (hit[2] ?? '').trim()
        if (/var\(--(?:t-|font-)/.test(value)) continue
        check.failures.push(`${file.path}:${lineOf(code, hit.index ?? 0)} sets ${hit[1]} to \`${value}\` — use one of the seven steps, \`font: var(--t-body)\`, or a family token (DESIGN §3.4)`)
      }
    }
  }
  check.failures.push(...rampShape(tokens, check.notes))
  if (check.failures.length > 0) check.status = 'fail'
  return check
}

const TYPE_STEPS = ['--t-display', '--t-title', '--t-head', '--t-body', '--t-bytes', '--t-meta', '--t-micro']

/** The other half of the ramp rule, read out of the token file: seven steps, no eighth, nothing under 11px. */
function rampShape(tokens: ScannedFile | undefined, notes: string[]): string[] {
  if (!tokens) return [`${TOKENS_FILE} does not exist — there is no ramp to check`]
  const root = ruleFor(parseRules(stripComments(tokens.text)), ':root', '')
  // A step is a --t-* whose value is a font shorthand, which is what makes it
  // usable as `font: var(--t-body)`. Naming a new one --t-caption-small must not
  // dodge this rule, so the test is the value's shape, not the token's spelling.
  const values = declarations(root?.body ?? '')
  const declared = [...values.keys()].filter((name) => name.startsWith('--t-') && /var\(--font-/.test(values.get(name) ?? ''))
  const failures: string[] = []
  for (const step of TYPE_STEPS) if (!declared.includes(step)) failures.push(`${TOKENS_FILE} declares no ${step} — DESIGN §3.4 names seven steps and this is one of them`)
  for (const step of declared) if (!TYPE_STEPS.includes(step)) failures.push(`${TOKENS_FILE} declares ${step}, an eighth type step — DESIGN §3.4 says "there are no others"; adding one is a design change`)
  for (const step of declared) {
    const size = /(\d+(?:\.\d+)?)px/.exec(values.get(step) ?? '')
    if (size && Number(size[1]) < 11) failures.push(`${TOKENS_FILE} sets ${step} to ${size[1]}px — DESIGN §7 floors text at 11px`)
  }
  notes.push(`${declared.length} type step(s) declared: ${declared.join(' ')}`)
  return failures
}

/** DESIGN §9.1 rule 3 — two targets, because the rule has two halves that fail differently. */
function motion(files: ScannedFile[], tokens: ScannedFile | undefined): SubCheck {
  const check: SubCheck = {
    name: 'motion', rule: 'every --m-* has a prefers-reduced-motion counterpart at 0.01ms, and no transition or animation writes a literal duration',
    target: `${TOKENS_FILE} for the override block; SCAN_ROOTS for the literals`, status: 'ok', notes: [], failures: [],
  }
  check.failures.push(...reducedMotion(tokens, check.notes))
  for (const file of files.filter((f) => f.path !== TOKENS_FILE)) {
    for (const hit of file.code.matchAll(/\b(transition|animation)(?:-duration|-delay)?\s*:\s*([^;}\n]+)/g)) {
      const value = (hit[2] ?? '').trim()
      if (!/\b\d+(?:\.\d+)?m?s\b/.test(value)) continue
      check.failures.push(`${file.path}:${lineOf(file.code, hit.index ?? 0)} writes a literal duration in ${hit[1]}: \`${value}\` — use var(--m-instant|--m-quick|--m-settle|--m-tick), or reduced motion will not reach it (DESIGN §3.6)`)
    }
  }
  if (check.failures.length > 0) check.status = 'fail'
  return check
}

function reducedMotion(tokens: ScannedFile | undefined, notes: string[]): string[] {
  if (!tokens) return [`${TOKENS_FILE} does not exist — there is no motion scale to check`]
  const rules = parseRules(stripComments(tokens.text))
  const declared = [...declarations(ruleFor(rules, ':root', '')?.body ?? '').keys()].filter((n) => n.startsWith('--m-'))
  const reduce = rules.find((rule) => /prefers-reduced-motion/.test(rule.context))
  if (!reduce) return [`${TOKENS_FILE} has no @media (prefers-reduced-motion: reduce) block — DESIGN §3.6 requires every --m-* to be overridden there`]
  const overrides = declarations(reduce.body)
  const failures: string[] = []
  for (const name of declared) {
    const value = overrides.get(name)
    if (value === undefined) failures.push(`${TOKENS_FILE} declares ${name} but the prefers-reduced-motion block does not override it — a duration reduced motion cannot reach (DESIGN §3.6)`)
    else if (value !== '0.01ms') failures.push(`${TOKENS_FILE} reduces ${name} to \`${value}\`, not 0.01ms — DESIGN §3.6 rules 0.01ms and not 0ms, because a zero-duration transition may never fire transitionend and code that waits on it deadlocks`)
  }
  notes.push(`${declared.length} duration token(s) declared, ${overrides.size} overridden under reduced motion`)
  return failures
}

const TEXT_FLOOR = 4.5
const NON_TEXT_FLOOR = 3
const INKS = ['--ink', '--ink-2', '--ink-3', '--live', '--ok', '--fail', '--attn']

/**
 * Not in DESIGN §9.1's table, and it is here because the law asked for it:
 * §3 records its ratios "at authoring time", and a number authored into prose
 * decays. This recomputes every one of them from `tokens.css` and compares it
 * to the figure DESIGN recorded, so the two declarations of one truth cannot
 * drift (ARCHITECTURE.md §8.7). The rendered measurement is still
 * `scripts/browser/contrast.ts` — this proves the palette, not the page.
 */
function contrast(tokens: ScannedFile | undefined): SubCheck {
  const check: SubCheck = {
    name: 'contrast', rule: 'the declared palette clears 4.5:1 text and 3:1 non-text in both themes, and matches the ratios DESIGN §3 records',
    target: `${TOKENS_FILE}, against the measured tables in docs/DESIGN.md §3.2 and §3.3`, status: 'ok', notes: [], failures: [],
  }
  if (!tokens) {
    check.status = 'fail'
    check.failures.push(`${TOKENS_FILE} does not exist — there is no palette to measure`)
    return check
  }
  const themes = palettes(tokens.text, check.failures)
  for (const [theme, palette] of themes) check.failures.push(...floors(theme, palette, check.notes))
  check.failures.push(...againstDesign(themes, check.notes))
  if (check.failures.length > 0) check.status = 'fail'
  return check
}

/** The four palette blocks, checked in pairs: one theme declared twice must be declared identically. */
function palettes(css: string, failures: string[]): Map<string, Map<string, string>> {
  const rules = parseRules(stripComments(css))
  const out = new Map<string, Map<string, string>>()
  const pairs: [string, string, string][] = [
    ['dark', ':root', '[data-theme="dark"]'],
    ['light', ':root:not([data-theme="dark"])', '[data-theme="light"]'],
  ]
  for (const [theme, primary, mirror] of pairs) {
    const first = declarations(rules.find((r) => r.selector === primary)?.body ?? '')
    const second = declarations(rules.find((r) => r.selector === mirror)?.body ?? '')
    if (second.size === 0) { failures.push(`${TOKENS_FILE} has no ${mirror} block — the ${theme} theme cannot be chosen by the operator, only by the system (DESIGN §3.1)`); continue }
    for (const [name, value] of second) {
      if (first.get(name) !== value) failures.push(`${TOKENS_FILE} declares ${name} as \`${first.get(name) ?? 'nothing'}\` in ${primary} and \`${value}\` in ${mirror} — one theme, two declarations, drifted`)
    }
    out.set(theme, second)
  }
  return out
}

function floors(theme: string, palette: Map<string, string>, notes: string[]): string[] {
  const failures: string[] = []
  let worstText = Infinity
  for (const ink of INKS) {
    const worst = worstOnBackgrounds(palette, ink)
    if (Number.isNaN(worst)) { failures.push(`${TOKENS_FILE} declares no ${ink} in the ${theme} theme — DESIGN §3.2/§3.3 name it`); continue }
    worstText = Math.min(worstText, worst)
    if (worst < TEXT_FLOOR) failures.push(`${theme}: ${ink} measures ${worst.toFixed(2)}:1 at worst, under the ${TEXT_FLOOR}:1 text floor DESIGN §7 calls non-negotiable`)
  }
  const nonText = worstOnBackgrounds(palette, '--line-strong')
  if (nonText < NON_TEXT_FLOOR) failures.push(`${theme}: --line-strong measures ${nonText.toFixed(2)}:1, under the ${NON_TEXT_FLOOR}:1 floor for an interactive boundary (DESIGN §7)`)
  const chip = ratio(palette.get('--ink') ?? '#000000', palette.get('--live-fill') ?? '#000000')
  if (chip < TEXT_FLOOR) failures.push(`${theme}: --ink on --live-fill measures ${chip.toFixed(2)}:1, under the ${TEXT_FLOOR}:1 text floor — a chip is text on a tint, not decoration (DESIGN §3.3)`)
  const focus = ratio(palette.get('--live') ?? '#000000', palette.get('--bg') ?? '#000000')
  if (focus < NON_TEXT_FLOOR) failures.push(`${theme}: the focus ring --live on --bg measures ${focus.toFixed(2)}:1, under ${NON_TEXT_FLOOR}:1 (DESIGN §3.3)`)
  notes.push(`${theme}: worst text ${worstText.toFixed(2)}:1 (floor ${TEXT_FLOOR}), --line-strong ${nonText.toFixed(2)}:1, --ink on --live-fill ${chip.toFixed(2)}:1, focus ring ${focus.toFixed(2)}:1 (floor ${NON_TEXT_FLOOR})`)
  return failures
}

const DESIGN_DOC = 'docs/DESIGN.md'
const MEASURED_ROW = /^\|\s*`(--[a-z0-9-]+)`(?:\s*on\s*`(--[a-z0-9-]+)`)?\s*\|\s*\*\*([\d.]+):1\*\*\s*\|\s*\*\*([\d.]+):1\*\*\s*\|/gm

/** DESIGN's recorded tables, recomputed. A row nobody recomputes is a number that decays. */
function againstDesign(themes: Map<string, Map<string, string>>, notes: string[]): string[] {
  if (!existsSync(DESIGN_DOC)) return [`${DESIGN_DOC} does not exist — the recorded ratios cannot be compared against`]
  const rows = [...readFileSync(DESIGN_DOC, 'utf8').matchAll(MEASURED_ROW)]
  if (rows.length === 0) return [`${DESIGN_DOC} has no measured contrast rows in the shape this check reads — either §3's tables moved or this parser is now aimed at nothing`]
  const failures: string[] = []
  for (const [, token, , darkText, lightText] of rows) {
    for (const [theme, recorded] of [['dark', darkText], ['light', lightText]] as const) {
      const measured = worstOnBackgrounds(themes.get(theme) ?? new Map(), token ?? '')
      if (Number.isNaN(measured)) { failures.push(`${DESIGN_DOC} §3 records ${token} in the ${theme} theme; ${TOKENS_FILE} declares no such token`); continue }
      if (measured.toFixed(2) !== Number(recorded).toFixed(2)) {
        failures.push(`${token} ${theme}: ${TOKENS_FILE} measures ${measured.toFixed(2)}:1, ${DESIGN_DOC} §3 records ${recorded}:1 — the palette and the law disagree about one number. Change the law with a ruling, or change the token back`)
      }
    }
  }
  notes.push(`${rows.length} measured row(s) in ${DESIGN_DOC} §3 recomputed from the token file`)
  return failures
}

/** DESIGN §9.1 rule 5 — a font that leaves the origin fails the airplane test and dies under COEP. */
function fonts(files: ScannedFile[]): SubCheck {
  const check: SubCheck = {
    name: 'fonts', rule: 'no CDN @import and no absolute or cross-origin url(); every @font-face src is a bundler-rewritten import from src/ui/fonts/',
    target: 'every .css file under SCAN_ROOTS, including the token file', status: 'ok', notes: [], failures: [],
  }
  const css = files.filter((f) => f.path.endsWith('.css'))
  let faces = 0
  for (const file of css) {
    faces += [...file.code.matchAll(/@font-face/g)].length
    for (const hit of file.code.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/g)) {
      check.failures.push(`${file.path}:${lineOf(file.code, hit.index ?? 0)} imports \`${hit[1]}\` — DESIGN §3.4 refuses CDN fonts: they fail the airplane test and COEP silently kills a cross-origin subresource. Self-host the woff2 under src/ui/fonts/`)
    }
    for (const hit of file.code.matchAll(/url\(\s*["']?([^"')]+)/g)) {
      const url = (hit[1] ?? '').trim()
      if (!/^(?:https?:)?\/\//.test(url) && !url.startsWith('/')) continue
      check.failures.push(`${file.path}:${lineOf(file.code, hit.index ?? 0)} references \`${url}\` — an absolute or cross-origin url() ignores the basePath and 404s on a subpath (ARCHITECTURE.md §10.2 ruling 2). Import the file from src/ui/fonts/ so the bundler rewrites it`)
    }
  }
  check.notes.push(`${css.length} stylesheet(s) scanned, ${faces} @font-face rule(s)`)
  if (faces === 0) check.notes.push(`no @font-face yet — the woff2 subsets arrive with the shell at 6.2; the absolute-url half of this rule is armed now, ahead of its subject`)
  if (check.failures.length > 0) check.status = 'fail'
  return check
}

const DOOR = 'src/ui/surfaces/Door.tsx'
const DOOR_WORD_CAP = 22

/** DESIGN §9.1 rule 4 — the Door's prose above the fold is capped at 22 words. */
function frontdoorCopy(): SubCheck {
  const check: SubCheck = {
    name: 'frontdoor-copy', rule: `the Door's literal prose is at most ${DOOR_WORD_CAP} words`,
    target: DOOR, status: 'ok', notes: [], failures: [],
  }
  if (!existsSync(DOOR)) {
    check.status = 'pending'
    check.notes.push(`${DOOR} does not exist yet — increment 6.2 writes it, and this sub-check runs against it the moment it appears`)
    return check
  }
  const text = readFileSync(DOOR, 'utf8')
  const source = ts.createSourceFile(DOOR, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const words: string[] = []
  const walkJsx = (node: ts.Node): void => {
    if (ts.isJsxText(node)) words.push(...node.text.split(/\s+/).filter(Boolean))
    node.forEachChild(walkJsx)
  }
  walkJsx(source)
  check.notes.push(`${words.length} word(s) of literal prose, cap ${DOOR_WORD_CAP} — counted over JSX text nodes, which is the fold's upper bound, not the fold itself; scripts/browser/coldopen.ts measures what actually renders above it`)
  if (words.length > DOOR_WORD_CAP) {
    check.status = 'fail'
    check.failures.push(`${DOOR} carries ${words.length} words of prose against DESIGN §4.1's cap of ${DOOR_WORD_CAP}. The Door has four things on it — masthead, endpoint field, Connect, and one line naming the key alternative — and every extra word pushes the fold down past the thing that makes the wall stop being a wall`)
  }
  return check
}

const SURFACES = 'src/ui/shell/surfaces.ts'
const SURFACE_COUNT = 6

/** DESIGN §9.1 rule 6 — every surface is addressable and its address is unique. */
function addresses(): SubCheck {
  const check: SubCheck = {
    name: 'addresses', rule: 'every surface declares a unique ?panel= address matching its id',
    target: SURFACES, status: 'ok', notes: [], failures: [],
  }
  if (!existsSync(SURFACES)) {
    check.status = 'pending'
    check.notes.push(`${SURFACES} does not exist yet — increment 6.2 writes it, and this sub-check runs against it the moment it appears`)
    return check
  }
  const code = stripComments(readFileSync(SURFACES, 'utf8'))
  const entries = [...code.matchAll(/id:\s*'([^']+)'[\s\S]{0,400}?address:\s*'([^']+)'/g)].map((m) => ({ id: m[1] ?? '', address: m[2] ?? '' }))
  if (entries.length === 0) {
    check.status = 'fail'
    check.failures.push(`${SURFACES} declares no { id, address } entry this check can read — either the registry moved or its shape changed, and DESIGN §4's addresses are now unmeasured`)
    return check
  }
  check.failures.push(...addressShape(entries, check.notes))
  if (check.failures.length > 0) check.status = 'fail'
  return check
}

function addressShape(entries: { id: string; address: string }[], notes: string[]): string[] {
  const failures: string[] = []
  const seen = new Map<string, string>()
  for (const { id, address } of entries) {
    if (address !== `?panel=${id}`) failures.push(`${SURFACES}: surface '${id}' declares address '${address}' — DESIGN §4 rules the address is \`?panel=<id>\`, so the ratchet and the browser checks can key on it`)
    const first = seen.get(address)
    if (first) failures.push(`${SURFACES}: '${id}' and '${first}' both claim ${address} — two surfaces at one address means one of them is never measured (DESIGN §7)`)
    seen.set(address, id)
  }
  notes.push(`${entries.length} surface(s) declared, ${seen.size} distinct address(es)${entries.length === SURFACE_COUNT ? '' : ` — DESIGN §4 rules ${SURFACE_COUNT}; a seventh surface is a design change, and the count itself is enforced by the contrast ratchet, not here`}`)
  return failures
}

/**
 * DESIGN §9.2 and ARCHITECTURE.md §8.5, printed rather than implied. Coverage
 * this check does not have, named where a reader is looking at its output —
 * lying by omission about coverage is the failure this project has repeatedly
 * paid for.
 */
const NOT_ENFORCED_HERE: readonly string[] = [
  'contrast of the RENDERED page, and the ratchet — scripts/browser/contrast.ts, deploy path. This file proves the palette, not the pixels',
  'working surfaces use --r-0/--r-1 and --e-0 only — scripts/browser/geometry.ts, computed style',
  'at most one chromatic element at rest — scripts/browser/geometry.ts',
  'model-facing bytes are set in mono — scripts/browser/geometry.ts, computed font-family of [data-bytes]',
  'the cold-open click budget, 2 local / 3 BYOK — scripts/browser/coldopen.ts',
  "the front door's expressive layer actually renders — scripts/browser/frontdoor.ts",
  'zero 404s and zero cross-origin requests — scripts/browser/frontdoor.ts',
  'UNENFORCED, and not by any browser check either (DESIGN §9.2): that every surface renders all five named states; that a model-facing render remembered data-bytes; the identity test, which is a human beside three dashboards; information hierarchy and empty-state copy quality',
]

// ------------------------------------------------------------------- the check

function collect(): ScannedFile[] {
  const paths = SCAN_ROOTS.filter((root) => existsSync(root)).flatMap(walk)
  return readScanned(paths.filter((path) => SCANNED_EXTENSIONS.some((ext) => path.endsWith(ext))))
}

function report(check: SubCheck): boolean {
  const label = check.status === 'ok' ? 'ok' : check.status === 'pending' ? 'PENDING' : 'FAIL'
  console.log(`design · ${check.name}: ${label} — ${check.rule}`)
  console.log(`   target: ${check.target}`)
  for (const note of check.notes) console.log(`   ${note}`)
  for (const failure of check.failures) console.error(`   design FAIL [${check.name}] ${failure}`)
  return check.status !== 'fail'
}

const files = collect()
const tokens = files.find((file) => file.path === TOKENS_FILE)
const subChecks = [
  scanRoots(),
  tokensOnly(files),
  typeRamp(files, tokens),
  motion(files, tokens),
  contrast(tokens),
  fonts(files),
  frontdoorCopy(),
  addresses(),
]

let green = true
for (const check of subChecks) green = report(check) && green

console.log('design · not enforced here:')
for (const item of NOT_ENFORCED_HERE) console.log(`   ${item}`)

const failed = subChecks.filter((check) => check.status === 'fail').map((check) => check.name)
const pending = subChecks.filter((check) => check.status === 'pending').map((check) => check.name)
console.log(`design: ${subChecks.length} sub-check(s), ${failed.length} failed, ${pending.length} pending (${pending.join(', ') || 'none'})`)
if (!green) {
  console.error(`design FAIL — ${failed.join(', ')}`)
  process.exit(1)
}
console.log('design: ok')
