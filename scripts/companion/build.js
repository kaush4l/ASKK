#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { buildPackage, planPackage } from './package.js'

const usage = `Usage: bun scripts/companion/build.js [--dry-run] [--bun /absolute/bun] [--output /new/package-directory]
Default: the pinned current Bun executable, output .cache/companion/askk-local-darwin-arm64.
Dry-run verifies inputs and prints the exact manifest; it creates no files and starts nothing.
No downloads, compilation, installation, TLS files or pairing credentials enter the package.`

export function parseBuildOptions(argv) {
  const options = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { if (argv.length !== 1) throw new Error('--help must be used alone'); return { help: true } }
    if (arg === '--dry-run') { if (options.dryRun) throw new Error('Duplicate --dry-run'); options.dryRun = true; continue }
    const key = arg === '--bun' ? 'bun' : arg === '--output' ? 'output' : null
    if (!key || options[key] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Unknown, duplicate or incomplete option: ${arg}`)
    options[key] = resolve(argv[++i])
  }
  return options
}

if (import.meta.main) {
  try {
    const options = parseBuildOptions(process.argv.slice(2))
    if (options.help) console.log(usage)
    else {
      const repository = fileURLToPath(new URL('../../', import.meta.url))
      let sourceRevision = null
      try { sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch {}
      const inputs = { repository, bun: options.bun ?? process.execPath, output: options.output ?? resolve(repository, '.cache/companion/askk-local-darwin-arm64'), sourceRevision }
      const result = await (options.dryRun ? planPackage : buildPackage)(inputs)
      console.log(JSON.stringify({ mode: options.dryRun ? 'dry-run' : 'packaged', output: result.output, manifest: result.manifest }, null, 2))
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
