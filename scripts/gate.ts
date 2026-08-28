// REALM: host
/**
 * The gate. Green or it is not done, and never weaken a check to pass it.
 *
 *     bun run gate
 *
 * Three properties, each of which exists because its absence has cost this
 * project something:
 *
 * 1. **It names every check it runs, one per line, in source.** A gate that
 *    globbed `scripts/checks/*.ts` would make `checks/gate-coverage.ts`
 *    vacuous — it would pass by construction and could never notice a check
 *    going missing. The literal paths below are what that check reads.
 * 2. **It says what it does NOT run.** The checks in `SCHEDULED` are named in
 *    ARCHITECTURE.md §8 and do not exist yet, because each needs the thing it
 *    inspects to exist first. A gate that stayed quiet about them would read as
 *    coverage it does not have, and this file would become the document that
 *    lies. `deploy.sh` set that precedent by announcing this file's own absence
 *    for two increments.
 * 3. **It prints the count of checks it ran**, which goes into `PROGRESS.md`.
 *    A number that should only go up, in a document a human reads, is the
 *    second line of defence when someone deletes the first (§8.6).
 *
 * What is deliberately NOT here: the browser checks. `verify-export.ts` and
 * `verify-worker.ts` need a build and a real engine, take a URL rather than a
 * directory, and run in `deploy.sh` (§8.4). `bun run gate` must stay something
 * you can run without a server.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One check: the sentence a reader sees, and the thing that decides it — either
 * a command to spawn, or a function, for the one assertion §8 places in this
 * file rather than in `checks/`.
 */
interface Check {
  name: string
  why: string
  run: string[] | (() => Promise<boolean>)
}

/**
 * Every check that exists today. The paths are literal on purpose — see
 * property 1 above.
 */
const CHECKS: readonly Check[] = [
  { name: 'types', why: 'the tree type-checks under strict', run: ['bun', 'run', 'types'] },
  { name: 'tests', why: 'the host suite passes', run: ['bun', 'test'] },
  { name: 'purity', why: 'the core references no ambient global (§2.1)', run: ['bun', 'scripts/checks/purity.ts'] },
  { name: 'realm', why: 'the realm map holds: per-directory globals, banners, the typeof ban (§3.5)', run: ['bun', 'scripts/checks/realm.ts'] },
  { name: 'size', why: 'no function over 40 lines; max and total reported (§8.3)', run: ['bun', 'scripts/checks/size.ts'] },
  { name: 'design', why: "DESIGN.md's static rules, one named sub-check each (§10.2 ruling 3)", run: ['bun', 'scripts/checks/design.ts'] },
  { name: 'gate-coverage', why: 'every check that exists is a check this gate runs (§8.6)', run: ['bun', 'scripts/checks/gate-coverage.ts'] },
  { name: 'export', why: 'the static export builds and contains no server code', run: exportIsStatic },
]

/** Named in ARCHITECTURE.md §8 and not yet written. Printed, never counted. */
const SCHEDULED: readonly { name: string; when: string }[] = [
  { name: 'checks/layers.ts', when: 'there are layers to check — wave 2 onward' },
  { name: 'checks/protocol.ts', when: 'increment 3.2 writes the protocol' },
  { name: 'checks/orphans.ts', when: 'there are exports worth orphaning — wave 2 onward' },
  { name: 'checks/bundle.ts', when: 'core reaches the worker chunk, which is 3.3 — WORKER_MARK landed at 3.1, CORE_MARK at 2.6' },
  { name: 'scripts/smoke.ts', when: 'a turn can stream — increment 3.3 (deploy path, not the gate)' },
]

const bold = (text: string): string => `[1m${text}[0m`

/**
 * Names webpack only writes when something has to run on a server. `out/`
 * holding any of them means `output: 'export'` stopped being honoured, which on
 * a static host is a deploy that half-works and a page that half-loads.
 */
const SERVER_ARTIFACTS = [
  'required-server-files.json', 'middleware-manifest.json', 'functions-manifest.json',
  'app-paths-manifest.json', 'next-server', '.nft.json',
]

/** Every file under a directory, relative to it. */
function tree(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...tree(join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out
}

/**
 * `bun run build` opens with `rm -rf .next out`, and nothing else in the tree
 * owns those directories. Two overlapping runs — a gate beside `next dev`, or
 * beside a background `deploy.sh` — are reproducible as one of them dying on
 * `ENOENT: .next/server/pages-manifest.json` and reporting `gate RED — export`.
 * A gate that goes red for a reason that is not the code is a gate that gets
 * ignored, so the build is serialised behind a directory nobody else creates.
 */
// Under `.tmp/`, which .gitignore already covers: a lock left behind by a
// killed run must not make the working tree dirty and stop the next deploy.
const BUILD_LOCK = '.tmp/build.lock'
/** Long enough for a cold Next build on this machine, short enough that a killed run is not a wall. */
const LOCK_STALE_MS = 15 * 60_000

/** Takes the build lock, waiting for whoever holds it, and reports what it is waiting on. */
async function takeBuildLock(): Promise<() => void> {
  let announced = false
  mkdirSync('.tmp', { recursive: true })
  for (;;) {
    try {
      mkdirSync(BUILD_LOCK)
      return () => rmSync(BUILD_LOCK, { recursive: true, force: true })
    } catch {
      const age = Date.now() - statSync(BUILD_LOCK).mtimeMs
      if (age > LOCK_STALE_MS) {
        console.log(`   the build lock is ${Math.round(age / 60_000)}m old — its holder is gone, taking it over`)
        rmSync(BUILD_LOCK, { recursive: true, force: true })
        continue
      }
      if (!announced) {
        console.log(`   another build holds ${BUILD_LOCK} — waiting, rather than racing it into a red that is not the code`)
        announced = true
      }
      await Bun.sleep(1000)
    }
  }
}

/**
 * §8's one assertion that lives in the gate rather than in `checks/`: the
 * export builds, and what it built is a folder of files with nothing in it that
 * expects a server to be running.
 */
async function exportIsStatic(): Promise<boolean> {
  const release = await takeBuildLock()
  try {
    const build = Bun.spawn(['bun', 'run', 'build'], { stdout: 'inherit', stderr: 'inherit' })
    if ((await build.exited) !== 0) {
      console.error('   the export did not build')
      return false
    }
  } finally {
    release()
  }
  if (!existsSync('out/index.html')) {
    console.error('   out/index.html does not exist — the build produced no static export at all')
    return false
  }
  const files = tree('out')
  const server = files.filter((f) => f.startsWith('server/') || SERVER_ARTIFACTS.some((a) => f.includes(a)))
  console.log(`   out/ holds ${files.length} file(s)`)
  for (const f of server) console.error(`   server artifact in a static export: out/${f}`)
  if (server.length > 0) return false
  if (!readFileSync('out/index.html', 'utf8').includes('_next/static')) {
    console.error('   out/index.html references no build output — it is not the page this build made')
    return false
  }
  return true
}

async function runCheck(check: Check): Promise<boolean> {
  console.log(bold(`\n== ${check.name} — ${check.why}`))
  const started = Date.now()
  let code = 0
  if (Array.isArray(check.run)) {
    code = await Bun.spawn(check.run, { stdout: 'inherit', stderr: 'inherit' }).exited
  } else {
    code = (await check.run()) ? 0 : 1
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(code === 0 ? `   ok  (${seconds}s)` : `   FAILED  exit ${code}  (${seconds}s)`)
  return code === 0
}

const failed: string[] = []
for (const check of CHECKS) {
  if (!(await runCheck(check))) failed.push(check.name)
}

console.log(bold('\n== gate'))
for (const { name, when } of SCHEDULED) {
  console.log(`   not written yet: ${name} — arrives when ${when}`)
}
console.log(`   ${CHECKS.length} checks ran, ${failed.length} failed`)

if (failed.length > 0) {
  console.log(`\ngate RED — ${failed.join(', ')}`)
  console.log('   Never weaken a check to pass it. The failing check names what broke, above.')
  process.exit(1)
}
console.log('\ngate GREEN')
