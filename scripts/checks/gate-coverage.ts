/**
 * gate-coverage — every check that exists is a check the gate runs.
 *
 * This is the cheapest thing in the tree: a directory listing compared against
 * one file's call sites. It is here because "a check nobody runs" is this
 * project's most-repeated defect wearing a new hat — the `skills` store nobody
 * read, the `cacheable` flag nobody read, `EXEC_REACT_STEP` with no caller, and
 * most recently `scripts/checks/purity.ts`, which shipped at increment 2.1 with
 * `bun run purity` as its only caller because `gate.ts` did not exist yet.
 * ARCHITECTURE.md §8.6 states the rule; this file is what makes it stick.
 *
 * It reads `gate.ts` as **text**, and that is deliberate. A gate that globbed
 * `scripts/checks/*.ts` would satisfy any coverage check by construction and
 * neither file would mean anything. Naming each check in `gate.ts` is what
 * makes a dropped one — by an edit, a merge, or a rename — observable, so the
 * literal path must appear in the source of the gate.
 *
 * It fails in both directions. A check the gate does not name is an orphan; a
 * check the gate names that is not on disk is a gate that will die on its next
 * run for a reason nobody wrote down.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CHECKS_DIR = 'scripts/checks'
const GATE = 'scripts/gate.ts'

const root = process.cwd()
const gatePath = join(root, GATE)
if (!existsSync(gatePath)) {
  console.error(`gate-coverage FAIL ${GATE} does not exist — there is no gate to be covered by`)
  process.exit(1)
}
const gateSource = readFileSync(gatePath, 'utf8')

const onDisk = readdirSync(join(root, CHECKS_DIR))
  .filter((name) => name.endsWith('.ts'))
  .sort()

const invoked = onDisk.filter((name) => gateSource.includes(`${CHECKS_DIR}/${name}`))
const failures = onDisk
  .filter((name) => !invoked.includes(name))
  .map((name) => `${CHECKS_DIR}/${name} exists but ${GATE} never invokes it — a check outside the gate is a check nobody runs (§8.6)`)

// The other direction: the gate naming a file that is not there.
for (const named of gateSource.matchAll(/scripts\/checks\/[A-Za-z0-9._-]+\.ts/g)) {
  const path = named[0]
  if (!existsSync(join(root, path))) failures.push(`${GATE} invokes ${path}, which does not exist`)
}

console.log(`gate-coverage: ${onDisk.length} check(s) on disk in ${CHECKS_DIR}, ${invoked.length} named by ${GATE}`)
for (const failure of failures) console.error(`gate-coverage FAIL ${failure}`)
if (failures.length > 0) process.exit(1)
console.log('gate-coverage: ok')
