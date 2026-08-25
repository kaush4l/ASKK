#!/usr/bin/env bun
/**
 * I5, executable. The interface renders `data`; it may not compute it.
 *
 * The rule this enforces is the VIEW-MODEL clause: a projection carries the
 * already-worded string beside the machine field, because the moment two panes
 * word one fact for themselves they word it differently and the person reading
 * both learns that the system does not know what it thinks. So the interface
 * chooses LAYOUT and never composes PROSE.
 *
 * Also banned outright: `dangerouslySetInnerHTML`. JSX escapes text children by
 * construction, which is the whole reason markdown is parsed in the core into
 * typed nodes — the safety is structural, and one call site would end it.
 */
import { Glob } from 'bun'

const ROOT = new URL('..', import.meta.url).pathname

/** @type {Array<{name: string, re: RegExp, why: string}>} */
const FORBIDDEN = [
  { name: 'dangerouslySetInnerHTML', re: /dangerouslySetInnerHTML/, why: 'JSX escapes text children; markdown is typed nodes from the core' },
  { name: 'toLocaleDateString/TimeString', re: /toLocale(Date|Time)String\s*\(/, why: 'the core sends the worded date beside the machine one' },
  { name: 'Intl.DateTimeFormat', re: /Intl\.(DateTimeFormat|RelativeTimeFormat)\b/, why: 'the core sends the worded date beside the machine one' },
  { name: 'Intl.NumberFormat', re: /Intl\.NumberFormat\b/, why: 'the core sends the worded number beside the machine one' },
  { name: 'Intl.PluralRules', re: /Intl\.PluralRules\b/, why: 'a plural is prose, and prose is the core’s' },
  { name: '.sort(', re: /(?<![.\w])\.?sort\s*\(/, why: 'order is a fact the log is the authority on' },
  { name: 'new Date(', re: /new\s+Date\s*\(/, why: 'time is injected and arrives already worded' },
  { name: 'Date.now(', re: /Date\.now\s*\(/, why: 'time is injected and arrives already worded' },
]

/** Blank comments and strings, keeping line numbers intact. */
function code(/** @type {string} */ text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** @type {string[]} */
const violations = []
for await (const file of new Glob('apps/web/**/*.{js,jsx}').scan({ cwd: ROOT })) {
  if (file.includes('node_modules') || file.includes('/.next/') || file.includes('/out/')) continue
  const lines = code(await Bun.file(ROOT + file).text()).split('\n')
  lines.forEach((line, i) => {
    if (/allowed by I5:/.test(line)) return
    for (const rule of FORBIDDEN) {
      if (rule.re.test(line)) violations.push(`${file}:${i + 1}: ${rule.name} — ${rule.why} (I5)`)
    }
  })
}

if (violations.length) {
  console.error(`I5 FAIL — ${violations.length} violation(s):`)
  for (const v of violations) console.error('  ' + v)
  console.error('\n  If the core genuinely does not send what a view needs, that is a CORE bug.')
  console.error('  File it in STATUS.md under Cross-lane requests; do not compute it here.')
  process.exit(1)
}
console.log('I5 ok — the interface renders what it was sent and words nothing itself')
