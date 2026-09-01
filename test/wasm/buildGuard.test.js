import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The refusal at the end of `scripts/wasm/build.sh`, run as shell.
 *
 * A build takes 2m46s at best and needs Docker, a local registry and Go, so the
 * gate cannot run the script. What it CAN do is take the guard's own lines off
 * disk and execute them, which is the difference between asserting that a
 * threshold is spelled somewhere in a file and asserting that it refuses. The
 * extraction is deliberately brittle: if the block is renamed or deleted the
 * test fails to find it and says so, rather than passing over a script that no
 * longer refuses anything.
 *
 * What this does NOT prove is that `GZ` holds the artifact's size when the
 * guard runs — that is the script's wiring, and only a real build shows it.
 * `scripts/wasm/toolchain-check.js` asserts the same threshold on the file in
 * `public/sandbox/`, which is the copy a visitor actually gets.
 */
const SCRIPT = join(import.meta.dir, '..', '..', 'scripts', 'wasm', 'build.sh')

function guard() {
  const lines = readFileSync(SCRIPT, 'utf8').split('\n')
  const from = lines.findIndex((line) => line.startsWith('if [ "$GZ" -gt '))
  expect(from).toBeGreaterThan(-1)
  const to = lines.indexOf('fi', from)
  expect(to).toBeGreaterThan(from)
  return lines.slice(from, to + 1).join('\n')
}

const run = async (gz) => {
  const shell = await Bun.$`bash -c ${`OUT_NAME=sandbox.wasm; say() { :; }; GZ=${gz}\n${guard()}`}`
    .nothrow()
    .quiet()
  return { code: shell.exitCode, said: shell.stdout.toString() }
}

describe('build.sh refuses an artifact GitHub could not serve', () => {
  test('one byte over the block is a failure, and it says what to do', async () => {
    const { code, said } = await run(104857601)

    expect(code).toBe(1)
    expect(said).toContain('104857601 bytes')
    expect(said).toContain('scripts/wasm/image/Dockerfile')
  })

  // Exactly AT the limit, because GitHub blocks a file OVER 100 MiB and an
  // off-by-one here would refuse an artifact that deploys perfectly well — a
  // guard nobody can satisfy gets deleted rather than obeyed.
  test('exactly the block is allowed through', async () => {
    const { code } = await run(104857600)

    expect(code).toBe(0)
  })
})
