#!/usr/bin/env bun
/**
 * I3 and I7, executable. The pure packages must run on the host: no DOM, no
 * browser global, no direct network, no ambient clock or randomness.
 *
 * This is a GREP and it is honest about being one. It catches the mistake
 * people actually make — reaching for `window` because it is there — and it
 * cannot catch a global reached through a computed name. The second line of
 * defence is that `bun test packages` runs with no DOM at all, so what this
 * misses fails there instead.
 */
import { Glob } from 'bun'

const ROOT = new URL('..', import.meta.url).pathname

/** Packages that must run on the host. */
const PURE = ['kernel', 'context', 'agent', 'core', 'adapters-test']

/** @type {Array<{name: string, re: RegExp, why: string}>} */
const FORBIDDEN = [
  { name: 'window', re: /(?<![.\w])window\s*[.[]/, why: 'there is no DOM on the host' },
  { name: 'document', re: /(?<![.\w])document\s*[.[]/, why: 'there is no DOM on the host' },
  { name: 'navigator', re: /(?<![.\w])navigator\s*[.[]/, why: 'there is no browser on the host' },
  { name: 'localStorage', re: /(?<![.\w])localStorage\b/, why: 'storage arrives through StorePort' },
  { name: 'indexedDB', re: /(?<![.\w])indexedDB\b/, why: 'storage arrives through StorePort' },
  { name: 'fetch()', re: /(?<![.\w])(?<!async\s)(?<!function\s)fetch\s*\(/, why: 'network arrives through NetPort or ModelPort' },
  { name: 'new Worker', re: /new\s+Worker\b/, why: 'delegation arrives through AgentPort' },
  { name: 'Date.now()', re: /Date\.now\s*\(/, why: 'time is injected through ClockPort (I7)' },
  { name: 'new Date()', re: /new\s+Date\s*\(\s*\)/, why: 'time is injected through ClockPort (I7)' },
  { name: 'Math.random()', re: /Math\.random\s*\(/, why: 'randomness is injected through RngPort (I7)' },
]

/**
 * Blank out comments and string bodies while KEEPING the line count, so a
 * reported line number points at the line the reader will open.
 */
function code(/** @type {string} */ text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** @type {string[]} */
const violations = []
for (const pkg of PURE) {
  for await (const file of new Glob(`packages/${pkg}/src/**/*.js`).scan({ cwd: ROOT })) {
    const lines = code(await Bun.file(ROOT + file).text()).split('\n')
    lines.forEach((line, i) => {
      for (const rule of FORBIDDEN) {
        if (rule.re.test(line)) violations.push(`${file}:${i + 1}: reaches for ${rule.name} — ${rule.why}`)
      }
    })
  }
}

if (violations.length) {
  console.error(`I3 FAIL — ${violations.length} violation(s):`)
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log(`I3 ok — ${PURE.length} pure packages reach for nothing the host does not have`)
