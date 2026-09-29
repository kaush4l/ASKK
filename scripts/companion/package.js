import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const payload = Object.freeze([
  ['host/companion.js', 'host/companion.js', 0o644],
  ['host/process-group.js', 'host/process-group.js', 0o644],
  ['src/core/companion-manifest.js', 'src/core/companion-manifest.js', 0o644],
  ['scripts/companion/launch.js', 'scripts/companion/launch.js', 0o644],
  ['scripts/companion/options.js', 'scripts/companion/options.js', 0o644],
  ['scripts/companion/package.js', 'scripts/companion/package.js', 0o644],
  ['scripts/companion/runtime-pin.json', 'scripts/companion/runtime-pin.json', 0o644],
  ['scripts/companion/BUN-LICENSE.md', 'licenses/BUN-LICENSE.md', 0o644],
  ['scripts/companion/README.md', 'README.md', 0o644],
  ['scripts/companion/askk-companion.sh', 'askk-companion', 0o755],
  ['scripts/companion/bun.sh', 'bin/bun', 0o755],
  ['scripts/companion/bunfig.toml', 'bunfig.toml', 0o644],
])
export async function sha256(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }
export async function verifyRuntime(path, pin) {
  const info = await lstat(path)
  if (!info.isFile() || !(info.mode & 0o111)) throw new Error('Bun runtime must be a regular executable file (not a symlink)')
  const fd = await open(path, 'r'); const header = Buffer.alloc(12)
  try { await fd.read(header, 0, header.length, 0) } finally { await fd.close() }
  if (header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== 0x0100000c) throw new Error('The package requires a native Darwin ARM64 Mach-O Bun executable')
  if (pin.target !== 'darwin-arm64' || !/^[a-f0-9]{64}$/.test(pin.sha256) || await sha256(path) !== pin.sha256) throw new Error('Bun runtime SHA-256 does not match the reviewed pin; no package was produced')
  return info
}

export async function planPackage({ repository, bun, output, sourceRevision = null }) {
  const pin = JSON.parse(await readFile(join(repository, 'scripts/companion/runtime-pin.json'), 'utf8'))
  const binary = await verifyRuntime(bun, pin)
  const files = []
  for (const [source, path, mode] of payload) {
    const file = join(repository, source), info = await lstat(file)
    if (!info.isFile()) throw new Error(`Package source must be a regular file: ${source}`)
    files.push({ source, path, mode, size: info.size, sha256: await sha256(file) })
  }
  files.push({ source: null, path: 'runtime/bun', mode: 0o755, size: binary.size, sha256: pin.sha256 })
  return { output: resolve(output), manifest: { schema: 1, name: 'askk-local-companion', target: 'darwin-arm64', runtime: pin, sourceRevision, files: files.map(({ source, ...record }) => record), policy: { capabilities: 'explicit-at-launch', tls: 'external-owner-trusted-certificate', runtimeSelection: 'explicit-in-workbench', packageFormat: 'directory', signed: false } }, sources: files }
}

/** Copy only the fixed payload. Existing destinations are never overwritten. */
export async function buildPackage({ repository, bun, output, sourceRevision = null }) {
  const plan = await planPackage({ repository, bun, output, sourceRevision })
  await mkdir(dirname(plan.output), { recursive: true })
  await mkdir(plan.output) // Exclusive ownership, including against a concurrent build.
  try {
    for (const file of plan.sources) {
      const target = join(plan.output, file.path)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(file.source ? join(repository, file.source) : bun, target)
      await chmod(target, file.mode)
      if (await sha256(target) !== file.sha256) throw new Error(`Source changed while copying ${file.path}`)
    }
    const manifest = `${JSON.stringify(plan.manifest, null, 2)}\n`
    await writeFile(join(plan.output, 'manifest.json'), manifest, { flag: 'wx', mode: 0o644 })
    await writeFile(join(plan.output, 'SHA256SUMS'), [...plan.manifest.files.map(file => `${file.sha256}  ${file.path}`), `${createHash('sha256').update(manifest).digest('hex')}  manifest.json`, ''].join('\n'), { flag: 'wx', mode: 0o644 })
    return plan
  } catch (error) { await rm(plan.output, { recursive: true, force: true }); throw error }
}

export async function verifyPackage(root) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  const expected = new Map([...payload.map(([, path, mode]) => [path, mode]), ['runtime/bun', 0o755]])
  if (manifest.schema !== 1 || manifest.target !== 'darwin-arm64' || !Array.isArray(manifest.files) || manifest.files.length !== expected.size) throw new Error('Unsupported or incomplete companion package manifest')
  for (const file of manifest.files) {
    if (!expected.has(file.path) || file.mode !== expected.get(file.path) || !Number.isSafeInteger(file.size) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid companion package file record')
    expected.delete(file.path)
    const path = join(root, file.path), info = await lstat(path)
    if (!info.isFile() || info.size !== file.size || (info.mode & 0o777) !== file.mode || await sha256(path) !== file.sha256) throw new Error(`Companion package integrity check failed: ${file.path}`)
  }
  const pin = JSON.parse(await readFile(join(root, 'scripts/companion/runtime-pin.json'), 'utf8'))
  if (JSON.stringify(manifest.runtime) !== JSON.stringify(pin)) throw new Error('Manifest runtime does not match the packaged pin')
  await verifyRuntime(join(root, 'runtime/bun'), pin)
  return manifest
}
