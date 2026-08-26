/**
 * The static half of the design gate — DESIGN.md §10.
 *
 *   bun run scripts/check-design.js
 *
 * Three greps over `app/`: no colour literal outside `app/tokens.css`; no
 * `font-size` and no `font` shorthand off the six declared ramp steps; every
 * declared duration zeroed under reduced motion.
 *
 * The scan is over parsed declarations, not raw lines, because the naive grep
 * for a colour name matches `white-space: pre-wrap` in six files and a rule
 * that cries wolf six times is a rule people delete. A property name is never
 * looked at for a colour; only the value it was given.
 *
 * The oracle for "is this word a colour" is `Bun.color`, which knows all 148
 * CSS named colours. That is a Bun API in a Bun script — the core may not touch
 * one, this may.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const TOKENS = "app/tokens.css"

/** DESIGN §5. Six sizes, no others: name → [weight, size, leading]. */
const RAMP = {
  "--type-display": ["600", "2rem", "1.1"],
  "--type-heading": ["600", "1.25rem", "1.25"],
  "--type-body": ["400", "0.9375rem", "1.5"],
  "--type-mono": ["400", "0.8125rem", "1.55"],
  "--type-small": ["500", "0.75rem", "1.4"],
  "--type-micro": ["600", "0.6875rem", "1.3"],
}

/** Neither names a value: absence of colour, and an alias for a token's. */
const NOT_A_LITERAL = new Set(["transparent", "currentcolor"])

const COLOUR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/i
const HEX = /#[0-9a-f]{3,8}\b/i
const DURATION = /(^|[\s,(])\d*\.?\d+m?s\b/i

/** @type {string[]} */
const problems = []

/** @param {string} where @param {string} message */
function fail(where, message) {
  problems.push(`${where} ${message}`)
}

/** @param {string} dir @param {RegExp} keep @returns {string[]} */
function walk(dir, keep) {
  /** @type {string[]} */
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(path, keep))
    else if (keep.test(entry.name)) found.push(path)
  }
  return found
}

/**
 * Blanks comments while preserving every newline, so an index still maps to
 * the line the reader will open.
 * @param {string} text @returns {string}
 */
function blankComments(text) {
  const blank = (/** @type {string} */ m) => m.replace(/[^\n]/g, " ")
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)))
}

/**
 * @param {string} text
 * @returns {{ prop: string, value: string, line: number, at: string }[]}
 */
function declarations(text) {
  /** @type {{ prop: string, value: string, line: number, at: string }[]} */
  const out = []
  /** @type {string[]} */
  const context = []
  const pattern = /@media([^{]*)\{|([-a-z]+)\s*:\s*([^;{}]+)[;}]|\{|\}/gi
  for (const m of text.matchAll(pattern)) {
    const line = text.slice(0, m.index).split("\n").length
    if (m[1] !== undefined) context.push(m[1].trim())
    else if (m[0] === "{") context.push("")
    else if (m[0] === "}") context.pop()
    else if (m[2] && m[3]) out.push({ prop: m[2].toLowerCase(), value: m[3].trim(), line, at: context.join(" ") })
  }
  return out
}

/**
 * Whether a bare word in this property's value could be a colour at all.
 *
 * Measured: `Bun.color` answers yes to `background`, `menu` and `mark` — they
 * are deprecated *system* colours — so scanning every word of every value
 * reported `transition: background var(--motion-control)` in three files. A
 * word is a colour only where a colour can go; a hex and a colour function are
 * still scanned everywhere.
 * @param {string} prop
 */
function takesColour(prop) {
  return prop.startsWith("--") || prop.includes("color") || /^(background|border(-(top|right|bottom|left))?|outline|box-shadow|text-shadow|text-decoration|fill|stroke)$/.test(prop)
}

/**
 * §10 tokens — no colour literal outside tokens.css.
 * @param {string} name @param {ReturnType<typeof declarations>} decls
 */
function checkColour(name, decls) {
  for (const { prop, value, line } of decls) {
    // Quoted strings are content, not colour.
    const text = value.replace(/"[^"]*"|'[^']*'/g, " ")
    const where = `${name}:${line}`
    if (HEX.test(text) || COLOUR_FN.test(text)) fail(where, `declares a colour literal: ${prop}: ${value}`)
    else if (takesColour(prop))
      for (const word of text.match(/[a-z][a-z0-9-]*/gi) ?? []) {
        if (NOT_A_LITERAL.has(word.toLowerCase()) || !Bun.color(word, "[rgb]")) continue
        fail(where, `names the colour "${word}" instead of a token: ${prop}: ${value}`)
      }
  }
}

/**
 * §10 the ramp — six steps, declared once, named everywhere else.
 * @param {string} name @param {ReturnType<typeof declarations>} decls
 */
function checkRamp(name, decls) {
  const allowed = new RegExp(`^(inherit|var\\((${Object.keys(RAMP).join("|")})\\))$`)
  for (const { prop, value, line } of decls) {
    if (prop === "font-size") fail(`${name}:${line}`, `sets font-size (${value}); take a step from the ramp with \`font:\``)
    else if (prop === "font" && !allowed.test(value)) fail(`${name}:${line}`, `font: ${value} is not one of the six ramp steps`)
  }
}

/**
 * The ramp itself, in tokens.css, still carrying the weight, size and leading
 * DESIGN §5 declares. A gate that only checked that everyone *named* a step
 * would let the steps themselves drift.
 * @param {ReturnType<typeof declarations>} decls
 */
function checkRampSteps(decls) {
  const declared = new Map(decls.filter((d) => d.prop.startsWith("--type-")).map((d) => [d.prop, d]))
  for (const [token, [weight, size, leading]] of Object.entries(RAMP)) {
    const found = declared.get(token)
    if (!found) {
      fail(TOKENS, `does not declare ${token}`)
      continue
    }
    const shape = new RegExp(`(^|\\s)${weight}\\s+${size.replace(".", "\\.")}\\s*/\\s*${leading}(\\s|$)`)
    if (!shape.test(found.value)) fail(`${TOKENS}:${found.line}`, `${token} is ${found.value}, not ${weight} ${size}/${leading}`)
    declared.delete(token)
  }
  for (const [token, d] of declared)
    if (!token.endsWith("-tracking")) fail(`${TOKENS}:${d.line}`, `${token} is a seventh ramp step; DESIGN §5 declares six`)
}

/**
 * §10 reduced motion. A duration literal outside tokens.css fails because
 * nothing can reach it to zero it; a duration token inside tokens.css fails
 * unless the reduced-motion block zeroes it. A token declared as zero is its
 * own counterpart.
 * @param {string} name @param {ReturnType<typeof declarations>} decls
 */
function checkMotion(name, decls) {
  const reduced = new Set(
    decls.filter((d) => /prefers-reduced-motion\s*:\s*reduce/.test(d.at) && /(^|\s)(0m?s|var\(--motion-none\))/.test(d.value)).map((d) => d.prop),
  )
  for (const { prop, value, line, at } of decls) {
    if (!DURATION.test(value)) continue
    if (name !== TOKENS) {
      fail(`${name}:${line}`, `declares a duration — ${prop}: ${value}; only ${TOKENS} may, so reduced motion can zero it`)
    } else if (prop.startsWith("--") && !/^0m?s$/.test(value) && !reduced.has(prop) && !/prefers-reduced-motion/.test(at)) {
      fail(`${name}:${line}`, `${prop}: ${value} has no zeroed counterpart under prefers-reduced-motion: reduce`)
    }
  }
}

console.log("design\n")
for (const file of walk(join(ROOT, "app"), /\.(css|js|html)$/)) {
  const name = relative(ROOT, file)
  const text = blankComments(readFileSync(file, "utf8"))
  if (!name.endsWith(".css")) {
    // A hex in a script is a colour wherever it sits; a bare word is prose.
    for (const [i, line] of text.split("\n").entries()) if (HEX.test(line)) fail(`${name}:${i + 1}`, `declares a colour literal: ${line.trim()}`)
    continue
  }
  const decls = declarations(text)
  if (name !== TOKENS) {
    checkColour(name, decls)
    checkRamp(name, decls)
  } else {
    checkRampSteps(decls)
  }
  checkMotion(name, decls)
}

for (const problem of problems) console.log(` FAIL  ${problem}`)
console.log(problems.length ? `\n${problems.length} design violation(s)` : "  ok   colour · ramp · reduced motion")
if (problems.length) process.exit(1)
