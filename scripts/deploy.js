#!/usr/bin/env bun
/**
 * Build, from a CLEAN CHECKOUT, the directory a static host serves.
 *
 * There was no deploy step in this repository at all. What is on `gh-pages` was
 * made on somebody's machine, by hand, and it shows: 56 files, no guest image,
 * and every `shell` call on the live page reaching `boot-failed`. A deploy that
 * exists only as a habit cannot be checked, cannot be argued with, and cannot
 * be run by anyone else — which is the same reason `docs/ROLES.md` gives for
 * writing the seats down.
 *
 * CLEAN CHECKOUT, and that is the whole design. `git archive <ref> | tar -x`
 * extracts exactly the tracked tree of a commit — no untracked file, no
 * uncommitted edit, no build output left over from yesterday. Two faults this
 * closes, and both are live in this tree today:
 *
 *   `next build` copies `public/` WHOLE, so a developer's `out/` carries
 *   `sandbox/sandbox.wasm` — the raw module, gitignored because it is over
 *   GitHub's per-file block. Deploying that directory pushes a file the host
 *   refuses. From an archive of the ref, the raw module is simply not there,
 *   because it is not in the ref. `docs/GATE.md` holds the two sizes; a
 *   measurement copied into a comment is a confident lie the next time
 *   `scripts/wasm/build.sh` runs.
 *
 *   And it answers the question a deploy is actually for: can a STRANGER, who
 *   has this repository and nothing else, produce the page? `bun install
 *   --frozen-lockfile` in a directory with no `node_modules` is that question
 *   asked properly.
 *
 * It does not push. Publishing is the owner's, and a script that both builds
 * and publishes turns one review into none.
 *
 * Usage:  bun scripts/deploy.js [--ref <commit-ish>] [--out <dir>] [--keep]
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'

const REPO = join(import.meta.dir, '..')

/**
 * GitHub's per-file block, and the reason the guest ships compressed at all.
 *
 * Checked against the OUTPUT rather than assumed from the input: a build that
 * copies a file this size into the export produces a directory that cannot be
 * pushed to the branch it is for, and the failure would otherwise arrive as a
 * rejected push with no explanation of which file did it.
 */
const FILE_LIMIT = 100 * 1024 * 1024

/**
 * What a static host has to be handed, or the page it serves is not this app.
 *
 * The guest is NOT here. Whether the export must carry it depends on where the
 * build was told to look for it, which is not known until the archived config is
 * read — see `REQUIRED` below.
 */
const ALWAYS_REQUIRED = ['index.html', '404.html', 'sandbox/vm-worker.js', 'agents/index.json']

/**
 * Written into the export, and the reason `deploy-check.js` needs no source tree.
 *
 * The check used to read `next.config.js` from the DEVELOPER'S working tree to
 * learn the prefix to serve at. Measured: changing only `basePath` there and
 * re-running the check against an unmodified, correct `dist/` condemned it —
 * `the deployed page never reached ready`, blaming the page for the reader. A
 * directory is now self-describing, so a `dist/` built from any ref can be
 * checked at the prefix it was actually built for.
 */
const MANIFEST = 'deploy.json'

// `parseArgs` rather than seven lines of `indexOf`. It is not only shorter: it
// REFUSES a flag with no value, where the hand-rolled version handed `undefined`
// to `mkdirSync` as a stack — and `--out` with no value used to reach the
// `rmSync` below.
// Caught and SAID. `parseArgs` throws on a flag with no value, and a stack trace
// out of `node:util` names the parser rather than the mistake — which is the
// same fault as answering a missing guest image with an `ENOENT` trace.
let values
try {
  ;({ values } = parseArgs({
    options: {
      ref: { type: 'string', default: 'HEAD' },
      out: { type: 'string' },
      keep: { type: 'boolean', default: false },
    },
  }))
} catch (cause) {
  console.error(`\ndeploy: ${cause.message}`)
  console.error('  Usage: bun scripts/deploy.js [--ref <commit-ish>] [--out <dir>] [--keep]')
  process.exit(1)
}
const ref = values.ref
const destination = values.out ?? join(REPO, 'dist')
const keep = values.keep

const run = (command, cwd = REPO, env = {}) => {
  const done = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (done.exitCode !== 0) {
    console.error(`\ndeploy: ${command.join(' ')} failed in ${cwd}`)
    console.error(done.stderr.toString().trimEnd() || done.stdout.toString().trimEnd())
    process.exit(1)
  }
  return done.stdout.toString().trim()
}

/**
 * Every file under a root, relative, dotfiles included.
 *
 * `dot: true` is load-bearing rather than decoration: `.nojekyll` is written by
 * this script and has to be inside both the count and the oversize scan, and
 * plain `**\/*` drops it. Measured against a real `dist/`: 58 files with the
 * flag, 57 without, and the one missing is `.nojekyll` — the file whose absence
 * makes GitHub Pages serve the page with no chunks at all.
 */
const walk = (root) => [...new Bun.Glob('**/*').scanSync({ cwd: root, dot: true })]

const mib = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`

// --- what may be destroyed --------------------------------------------------

// CHECKED FIRST, before a build is spent, and checked at all because the publish
// step below is `rmSync(destination, { recursive: true, force: true })` on a
// path a human typed. `--out .` deleted the working tree and `--out ~` deleted
// the home directory, and nothing asked. The marker is the pair this script
// itself writes into every directory it produces, so a `dist/` may be replaced
// and a directory that was never a deploy may not.
if (existsSync(destination)) {
  // The top level only. A recursive scan of a mistyped `--out` is a recursive
  // scan of whatever the mistake pointed at, and the markers are at the root.
  const already = readdirSync(destination)
  const ours = already.includes('index.html') && already.includes('.nojekyll')
  if (already.length && !ours) {
    console.error(`\ndeploy: ${destination} is not empty and was not written by this script`)
    console.error('  It would be DELETED WHOLE and replaced. index.html and .nojekyll together')
    console.error('  are how a directory says it is a deploy; this one has neither.')
    console.error('  Empty it yourself, or pass --out somewhere that does not exist.')
    process.exit(1)
  }
}

// --- what is being deployed -------------------------------------------------

const commit = run(['git', 'rev-parse', '--short', ref])
const subject = run(['git', 'log', '-1', '--format=%s', ref])
const dirty = run(['git', 'status', '--porcelain'])

console.log(`deploy: ${commit} ${subject}`)
// SAID, every time, and not a warning that can be switched off. The archive
// below carries the COMMIT, so an uncommitted fix a developer is looking at on
// their own screen is not in what they are about to publish — and that is the
// single most likely way for this script to ship the wrong thing while looking
// like it worked.
if (dirty) {
  console.log(
    `deploy: the working tree has ${dirty.split('\n').length} uncommitted path(s); they are NOT in this build.`,
  )
}

// --- the clean checkout -----------------------------------------------------

const work = mkdtempSync(join(tmpdir(), 'askk-deploy-'))
const source = join(work, 'src')
mkdirSync(source)

// Piped through tar rather than `git worktree add`: a worktree writes into
// `.git/worktrees` and has to be removed again, so an interrupted run leaves
// administrative state in the repository it was only supposed to read.
const archive = Bun.spawnSync(['git', 'archive', '--format=tar', ref], {
  cwd: REPO,
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: 1 << 30,
})
if (archive.exitCode !== 0) {
  console.error(`deploy: git archive ${ref} failed\n${archive.stderr.toString()}`)
  process.exit(1)
}
const extract = Bun.spawnSync(['tar', '-x', '-C', source], { stdin: archive.stdout })
if (extract.exitCode !== 0) {
  console.error('deploy: could not extract the archive')
  process.exit(1)
}
console.log(`deploy: extracted ${walk(source).length} tracked files into a clean checkout`)

// --- install and build ------------------------------------------------------

console.log('deploy: bun install --frozen-lockfile')
const installed = Date.now()
run(['bun', 'install', '--frozen-lockfile'], source)
console.log(`deploy: installed in ${((Date.now() - installed) / 1000).toFixed(1)}s`)

console.log('deploy: bun run build')
const built = Date.now()
// `SANDBOX_IMAGE` is passed through rather than read here, because which host
// serves the guest is a property of the deploy and `next.config.js` is the one
// place that turns it into a compiled constant.
run(['bun', 'run', 'build'], source, { SANDBOX_IMAGE: process.env.SANDBOX_IMAGE ?? '' })
console.log(`deploy: built in ${((Date.now() - built) / 1000).toFixed(1)}s`)

const out = join(source, 'out')

// The ARCHIVED config, not the one on this developer's screen. The build came
// from the ref; a guard that describes that build by reading the working tree is
// the exact leak `git archive` is here to close, and `--ref <old>` made it real
// — the chunk scan would have searched for a constant that ref never had.
const { default: archived, SANDBOX_IMAGE_PATH: archivedPath } = await import(
  join(source, 'next.config.js')
)

// FALLING BACK, because `--ref` is the flag this whole import exists to serve
// and a ref older than that export is exactly what it is pointed at. Measured:
// `--ref 25c8750` — the commit this script was written against — has no such
// export, and reading it without a fallback turned a working guard into
// `undefined is not an object`. The literal is the only copy of this path left
// outside `next.config.js`, and it is here so that an old ref still deploys.
const SANDBOX_IMAGE_PATH = archivedPath ?? '/sandbox/sandbox.wasm.gz'

/**
 * Where THIS build was told the guest is.
 *
 * Empty means "the copy in the export"; anything else is a foreign URL compiled
 * into the chunk by `SANDBOX_IMAGE=<url>`, and then the export must not carry a
 * 38 MiB file nothing will ask for.
 */
const configured = archived.env.NEXT_PUBLIC_SANDBOX_IMAGE || SANDBOX_IMAGE_PATH
const carriesGuest = configured === SANDBOX_IMAGE_PATH
const guestName = SANDBOX_IMAGE_PATH.slice(1)

// --- what a static host needs that a bundler does not know about ------------

// GitHub Pages runs Jekyll over a branch unless this file is there, and Jekyll
// excludes every path beginning with an underscore — which is `_next/`, i.e.
// every chunk, every stylesheet and every font. The page would answer 200 and
// render nothing. It is written by the deploy rather than kept in `public/`
// because it is a fact about ONE host, not about this application.
writeFileSync(join(out, '.nojekyll'), '')

// --- refuse to ship a directory that cannot work ----------------------------

// The override in `next.config.js` exists "for a host that will not take
// 38 MiB" — and until now a deploy aimed at such a host still REQUIRED the
// 38 MiB file and still shipped it, so the one case the lever is kept for was
// the one case it could not serve. Measured with
// `SANDBOX_IMAGE=https://example.invalid/guest/sandbox.wasm.gz`: 62.2 MiB out,
// the guest among it, for a host that was never going to be asked for it.
if (!carriesGuest && existsSync(join(out, guestName))) {
  rmSync(join(out, guestName))
  console.log(`deploy: the guest is served from ${configured}, so it is not in this export`)
}

const files = walk(out)
const missing = [...ALWAYS_REQUIRED, ...(carriesGuest ? [guestName] : [])].filter(
  (name) => !files.includes(name),
)
if (missing.length) {
  console.error(`\ndeploy: the export is missing ${missing.join(', ')}`)
  console.error('  A page without its guest is the state this deploy exists to end.')
  console.error('  The compressed guest is tracked at public/sandbox/sandbox.wasm.gz —')
  console.error('  build it with scripts/wasm/build.sh and commit it if it is gone.')
  process.exit(1)
}

const oversized = files
  .map((name) => [name, statSync(join(out, name)).size])
  .filter(([, size]) => size > FILE_LIMIT)
if (oversized.length) {
  console.error('\ndeploy: the export holds a file the host will not take:')
  for (const [name, size] of oversized) console.error(`  ${name}  ${size} bytes (${mib(size)})`)
  console.error(`  GitHub blocks any file over ${FILE_LIMIT} bytes, and the block is on the file`)
  console.error('  at rest, so no edge compression reaches it. The guest ships as .gz for exactly')
  console.error('  this reason; a raw sandbox.wasm here means public/ was copied from a tree that')
  console.error('  had one, which a clean checkout cannot do.')
  process.exit(1)
}

// The one source fault that survives a green build: `composition.js` derives the
// image URL from a constant the bundler inlines, and when that inlining silently
// produced `imageUrl:""` every build ever made shipped a page whose every shell
// call failed without fetching a byte. The source was readable and wrong; only
// the artifact says whether the URL arrived. `bun run smoke` asserts the same
// thing, and it is asserted again here because a deploy must not depend on
// somebody having run the gate.
// The SUFFIX, not the whole URL, and that is not a shortcut. The base path
// reaches the bundle as an inlined constant that the chunk still concatenates at
// runtime — the literal in the artifact is `${u}/sandbox/sandbox.wasm.gz`, so a
// search for the assembled address finds nothing however correct the build is.
// Written against the same expression `scripts/smoke.js` uses, for the same
// reason. What address the page actually asks for is settled one layer up, by
// watching a browser fetch it: `scripts/deploy-check.js`.
// RECURSIVE, where `readdirSync` was not: today's export happens to put all 19
// chunks at the top level, so a nested one would have been invisible to a guard
// whose whole job is to prove the string is somewhere.
const chunks = join(out, '_next', 'static', 'chunks')
const carriers = [...new Bun.Glob('**/*.js').scanSync({ cwd: chunks })].filter((name) =>
  readFileSync(join(chunks, name), 'utf8').includes(configured),
)
if (!carriers.length) {
  console.error(`\ndeploy: no built chunk names the guest image (${configured})`)
  console.error('  Every shell call in this artifact would answer UNAVAILABLE without')
  console.error('  fetching a byte. See the sandbox wiring in src/backend/composition.js.')
  process.exit(1)
}

// --- say what this directory is, inside the directory ------------------------

// Beside `.nojekyll`, and for the same kind of reason: a fact a SERVER needs
// that a bundler does not know. `deploy-check.js` reads it instead of importing
// `next.config.js`, so what the check serves is what the build produced rather
// than what the developer has open. It is also the marker the destination guard
// above looks for, and the only record of which ref a `dist/` came from.
writeFileSync(
  join(out, MANIFEST),
  `${JSON.stringify({ ref: commit, subject, basePath: archived.basePath, sandboxImage: configured }, null, 2)}\n`,
)

// --- publish into the destination -------------------------------------------

// Replaced whole, not merged. A deploy directory that keeps yesterday's chunks
// is a directory where a stale file can still be served, and the hashed names
// mean nothing ever overwrites anything.
if (existsSync(destination)) rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
run(['cp', '-R', `${out}/.`, destination])

if (!keep) rmSync(work, { recursive: true, force: true })
else console.log(`deploy: kept the checkout at ${source}`)

// --- what it costs ----------------------------------------------------------

const shipped = walk(destination).map((name) => [name, statSync(join(destination, name)).size])
const total = shipped.reduce((sum, [, size]) => sum + size, 0)
const guest = shipped.find(([name]) => name === guestName)?.[1]

// The short name when the destination is inside the repository, the real path
// when it is not: `relative()` on a `--out` somewhere else answers with a stack
// of `../..` that names nothing a reader can act on.
const named = relative(REPO, destination)
console.log(`\ndeploy: ${named && !named.startsWith('..') ? named : destination}`)
console.log(`  ${shipped.length} files, ${total} bytes (${mib(total)})`)
console.log(
  guest
    ? `  the guest is ${guest} bytes (${mib(guest)}) of that, fetched on demand and not on load`
    : `  the guest is not in this export at all; the page will ask ${configured} for it`,
)
console.log(`  ${carriers.length} chunk(s) name ${configured}`)
for (const [name, size] of shipped.sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log(`  ${String(size).padStart(10)}  ${name}`)
}
console.log('\ndeploy: nothing was pushed. Prove it with `bun scripts/deploy-check.js`.')
