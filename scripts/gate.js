/**
 * The gate. Green or it is not done.
 *
 *   bun run gate
 *
 * Six checks, each of which has cost this project something at least once:
 * types, host tests, golden parity, file and function size, core purity, and
 * that the static export still builds. A claim the gate cannot execute is not a
 * verified claim, so every rule stated in CLAUDE.md is executed here or it is
 * not stated.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

const MAX_FILE_LINES = 200
const MAX_FUNCTION_LINES = 40

/**
 * Names the core may not touch. The core runs in a worker, in a page and on the
 * host, and a prompt containing an ambient clock cannot be compared against a
 * recorded file at all — which is why the clock is on this list beside the DOM.
 */
const FORBIDDEN_IN_CORE = [
  [/\bdocument\b/, "the DOM"],
  [/\bwindow\b/, "the DOM"],
  [/\blocalStorage\b/, "browser storage"],
  [/\bDate\.now\(/, "an ambient clock — take it from the ports clock"],
  [/new Date\(\s*\)/, "an ambient clock — take it from the ports clock"],
  [/\bMath\.random\(/, "ambient randomness"],
  [/\bprocess\.env\b/, "an ambient environment — hand it in"],
  [/from\s+["']node:/, "a node builtin"],
  [/\bBun\./, "a Bun runtime API, which does not exist in a browser"],
  [/^\s*import\s+[^"']*["'][^./]/m, "a package import — core has zero runtime dependencies"],
]

/** @type {{name: string, ok: boolean, detail: string}[]} */
const results = []

/** @param {string} name @param {boolean} ok @param {string} detail */
function record(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`)
}

/** @param {string} dir @param {(p: string) => boolean} keep @returns {string[]} */
function walk(dir, keep) {
  /** @type {string[]} */
  const found = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(path, keep))
    else if (keep(path)) found.push(path)
  }
  return found
}

/** @param {string} command @param {string[]} args */
async function run(command, args) {
  const proc = Bun.spawn([command, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, out: `${stdout}${stderr}` }
}

// ── 1. types ─────────────────────────────────────────────────────────────

async function checkTypes() {
  const { code, out } = await run("bunx", ["tsc", "--noEmit", "-p", "jsconfig.json"])
  const errors = out.split("\n").filter((line) => line.includes("error TS"))
  record("types", code === 0, code === 0 ? "" : `${errors.length} error(s)\n${errors.slice(0, 12).join("\n")}`)
}

// ── 2. host tests ────────────────────────────────────────────────────────

async function checkTests() {
  const { code, out } = await run("bun", ["test", "--isolate"])
  const summary = out.split("\n").find((line) => / pass\b/.test(line)) ?? ""
  record("tests", code === 0, summary.trim() || (code === 0 ? "" : out.slice(-1500)))
}

// ── 3. golden parity ─────────────────────────────────────────────────────

function checkGolden() {
  // The oracle is not editable. Anyone who "fixes" a fixture to make a test
  // pass has deleted the only proof the port reproduces the original.
  const expected = {
    "react-loop.json": 266,
    "render-bare.prompt": 2412,
    "render-full.prompt": 2922,
    "render-plain-text.prompt": 83,
  }
  const wrong = Object.entries(expected).filter(([name, size]) => {
    try {
      return statSync(join(ROOT, "tests/golden", name)).size !== size
    } catch {
      return true
    }
  })
  record("golden fixtures untouched", wrong.length === 0, wrong.map(([n]) => n).join(", "))
}

// ── 4. size ──────────────────────────────────────────────────────────────

/**
 * Counts the lines of every function-ish block by brace depth. Crude on
 * purpose: it over-reports rather than under-reports, and an over-report is a
 * conversation while an under-report is a rule that silently stopped applying.
 * @param {string} text
 * @returns {number}
 */
function longestFunction(text) {
  const lines = text.split("\n")
  let longest = 0
  /** @type {{start: number, depth: number}[]} */
  const open = []
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const starts = /(^|\s)(function\b|async function\b)|=>\s*\{|^\s*(static\s+)?(async\s+)?[\w$]+\s*\([^)]*\)\s*\{/.test(line)
    const opens = (line.match(/\{/g) ?? []).length
    const closes = (line.match(/\}/g) ?? []).length
    if (starts && opens > closes) open.push({ start: i, depth })
    depth += opens - closes
    while (open.length && depth <= (open.at(-1)?.depth ?? 0)) {
      const block = open.pop()
      if (block) longest = Math.max(longest, i - block.start + 1)
    }
  }
  return longest
}

function checkSize() {
  const files = [...walk(join(ROOT, "core"), (p) => p.endsWith(".js")), ...walk(join(ROOT, "app"), (p) => p.endsWith(".js"))]
  /** @type {string[]} */
  const tooLong = []
  /** @type {string[]} */
  const fatFunctions = []
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    const lines = text.split("\n").length
    if (lines > MAX_FILE_LINES) tooLong.push(`${relative(ROOT, file)} ${lines}`)
    const longest = longestFunction(text)
    if (longest > MAX_FUNCTION_LINES) fatFunctions.push(`${relative(ROOT, file)} ${longest}`)
  }
  record(`files <= ${MAX_FILE_LINES} lines`, tooLong.length === 0, tooLong.join(", "))
  record(`functions <= ${MAX_FUNCTION_LINES} lines`, fatFunctions.length === 0, fatFunctions.join(", "))
}

// ── 5. purity ────────────────────────────────────────────────────────────

function checkPurity() {
  /** @type {string[]} */
  const violations = []
  for (const file of walk(join(ROOT, "core"), (p) => p.endsWith(".js"))) {
    const name = relative(ROOT, file)
    // The host-only adapters are where the impurity is allowed to live, and
    // naming them here is what keeps that a decision rather than a leak.
    if (name.startsWith("core/ports/") || name.endsWith("-cli.js")) continue
    const text = readFileSync(file, "utf8")
    for (const [pattern, why] of FORBIDDEN_IN_CORE) {
      const match = text.match(pattern)
      if (!match) continue
      const line = text.slice(0, match.index ?? 0).split("\n").length
      violations.push(`${name}:${line} uses ${why}`)
    }
  }
  record("core is pure", violations.length === 0, violations.join("\n"))
}

// ── 6. the export still builds ───────────────────────────────────────────

async function checkBuild() {
  try {
    statSync(join(ROOT, "app/index.html"))
  } catch {
    record("static export builds", true, "skipped — no app/index.html yet")
    return
  }
  const { code, out } = await run("bun", ["build", "./app/index.html", "--outdir", "dist", "--target", "browser"])
  record("static export builds", code === 0, code === 0 ? "" : out.slice(-1200))
}

// ── run ──────────────────────────────────────────────────────────────────

console.log("gate\n")
checkGolden()
checkSize()
checkPurity()
await checkTypes()
await checkTests()
await checkBuild()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log(`failed: ${failed.map((r) => r.name).join(", ")}`)
  process.exit(1)
}
