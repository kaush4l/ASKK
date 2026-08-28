// REALM: host
/**
 * bundle — ARCHITECTURE.md §8.1. Does the built artifact agree with the source
 * about which realm the core is in?
 *
 * **This check is a corroborator and it says so out loud, because a check whose
 * declared job exceeds its reach is the false-green class this tree is written
 * against.** §8.1 rules it plainly: `checks/layers.ts` proves the `ui ↮ core`
 * and `client ↮ core` rules from the **import graph of the source**, where
 * every edge is visible whatever the bundler later does. This file catches only
 * what that graph cannot see — a transitive path through a dependency, or a
 * bundler that quietly disagrees with the source. Folding, inlining, renaming
 * and tree-shaking all defeat a grep, and all four are measured here. So a
 * green line below is evidence, never proof, and every line prints which it is.
 *
 * **It is tagged `[3.3]` and not `[3.1]`, and that re-tag is the point.**
 * Before this increment nothing under `src/core` was imported by the worker, so
 * assertion 2 would have been asserting a symbol's absence from every file in
 * the build — passing, greenly, for entirely the wrong reason. The resident is
 * what makes the worker import the core, so this is the first commit in which
 * the check has a subject. (`RESIDENT.md` §6, `PLAN.md`'s addendum.)
 *
 * Three assertions, and a fourth property that is not an assertion:
 *
 * 1. **Exactly one file in the export contains `WORKER_MARK`.** The worker
 *    chunk has no name — webpack emits it as `chunks/<number>.<hash>.js`
 *    beside everything else — so it is identified by content. Zero or two
 *    candidates **fails**; it never falls back to passing.
 * 2. **`CORE_MARK` is in that file.** The core reached the worker.
 * 3. **`CORE_MARK` is in no file reachable from the main entry.** Reachability,
 *    not identity: `splitChunks` applies to worker compilations too, so "the
 *    singleton set" would fail on a correct build, and a check that fails on a
 *    correct build gets weakened.
 * 4. **It prints every file it scanned.** A build that silently relocates its
 *    chunks produces a visibly different scan rather than a silent pass — the
 *    non-recursive glob that missed `chunks/app/**` entirely is the measured
 *    version of that mistake.
 *
 * Both marks are **imported as values** from the source that owns them, so a
 * rename moves the check with the code rather than leaving it hunting a string
 * nothing writes any more.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WORKER_MARK } from '../../src/engine/host'
import { CORE_MARK } from '../../src/core/prompt/slots'

const OUT = 'out'
/** Written by the build, and the only statement anyone but webpack has about entry → chunk. */
const MANIFEST = '.next/app-build-manifest.json'

/** Every file under a directory, recursively — §8.1's first correction. */
function walk(dir: string, prefix = ''): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...walk(join(dir, entry.name), rel))
    else found.push(rel)
  }
  return found
}

/**
 * The chunks the page pulls in: every script the exported HTML names, plus
 * every chunk the build manifest lists for a route. Both, because the HTML is
 * what a browser actually loads and the manifest is what webpack meant — a
 * chunk in the manifest and not the HTML is still reachable by a later import.
 */
function mainReachable(files: string[]): Set<string> {
  const reachable = new Set<string>()
  for (const file of files.filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(OUT, file), 'utf8')
    for (const match of html.matchAll(/src="[^"]*?(_next\/[^"]+\.js)"/g)) reachable.add(match[1] ?? '')
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { pages: Record<string, string[]> }
  for (const chunks of Object.values(manifest.pages)) for (const chunk of chunks) reachable.add(`_next/${chunk}`)
  return reachable
}

function run(): string[] {
  if (!existsSync(OUT)) return [`${OUT}/ does not exist — run the build before this check, or it is aimed at nothing`]
  if (!existsSync(MANIFEST)) return [`${MANIFEST} does not exist — main-reachability cannot be computed, and guessing it is how this check would pass on a build it never read`]
  const scripts = walk(OUT).filter((file) => file.endsWith('.js'))
  console.log(`bundle: scanned ${scripts.length} script(s) under ${OUT}/`)
  for (const file of scripts) console.log(`   ${file}`)
  const holds = (mark: string): string[] => scripts.filter((file) => readFileSync(join(OUT, file), 'utf8').includes(mark))

  const workers = holds(WORKER_MARK)
  if (workers.length !== 1) {
    return [`${workers.length} file(s) contain WORKER_MARK (${JSON.stringify(WORKER_MARK)}) and exactly one is the worker chunk: ${workers.join(', ') || '(none)'} — §8.1 identifies it by content because it has no name, and this check never falls back to passing`]
  }
  const worker = workers[0] ?? ''
  const cores = holds(CORE_MARK)
  const reachable = mainReachable(scripts)
  console.log(`bundle: worker chunk is ${worker}; ${reachable.size} chunk(s) reachable from the main entry; CORE_MARK in ${cores.length} file(s)`)

  const failures: string[] = []
  if (!cores.includes(worker)) {
    failures.push(`CORE_MARK (${JSON.stringify(CORE_MARK)}) is not in the worker chunk ${worker} — the engine imports src/core, so either the bundler dropped it or the resident stopped assembling a prompt (§8.1)`)
  }
  for (const leak of cores.filter((file) => reachable.has(file))) {
    failures.push(`CORE_MARK is in ${leak}, which the main entry loads — src/core is in the page bundle. checks/layers.ts names the offending import; this only says the build agrees (§2, §8.1)`)
  }
  return failures
}

const failures = run()
for (const failure of failures) console.error(`bundle FAIL ${failure}`)
if (failures.length > 0) {
  console.error(`bundle: ${failures.length} failure(s)`)
  process.exit(1)
}
console.log('bundle: ok — CORROBORATION, not proof. It asserts two string literals, in an artifact whose compiler folds, inlines, renames and shakes. checks/layers.ts is what proves the rule from the source graph.')
