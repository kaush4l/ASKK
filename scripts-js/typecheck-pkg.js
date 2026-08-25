#!/usr/bin/env bun
/**
 * Type-check ONE package, so a lane can check itself while a neighbour has a
 * half-saved file on disk.
 *
 * The whole-workspace `bun run typecheck` stays the gate, and it must: three
 * lanes importing a fourth's broken export is exactly the failure a gate exists
 * to catch. But a lane that cannot tell its own error from someone else's stops
 * trusting the signal, and a signal nobody trusts is a signal nobody runs.
 *
 *   bun scripts-js/typecheck-pkg.js agent
 */
import { $ } from 'bun'

const name = process.argv[2]
if (!name) {
  console.error('which package? e.g. bun scripts-js/typecheck-pkg.js agent')
  process.exit(2)
}

const ROOT = new URL('..', import.meta.url).pathname
const base = await Bun.file(ROOT + 'jsconfig.json').json()
const config = { ...base, include: [`packages/${name}/**/*.js`] }

// AT THE ROOT, not in a temp directory: every path in the inherited config —
// the `paths` map most of all — resolves relative to the config file, so a
// config written anywhere else silently checks nothing and exits 0.
const path = `${ROOT}.tsconfig.pkg.json`
await Bun.write(path, JSON.stringify(config, null, 2))
const result = await $`bunx tsc -p ${path}`.nothrow()
process.exit(result.exitCode)
