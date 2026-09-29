/** Source extraction is cheap; --build explicitly runs the untouched pinned fixture. */
import { readFile, writeFile, mkdir, lstat, readdir, symlink } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFixture, sha256, SOURCE_RECEIPT } from './fixture.js'
import { verifySource } from './source.js'

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
export async function prepare({ directory = resolve(root, '.cache/evals/repair-diagnostic'), build = false } = {}) {
  const fixture = extractFixture(await readFile(join(root, SOURCE_RECEIPT)))
  if (!build) {
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 })
    await mkdir(directory, { mode: 0o700 }) // Exclusive destination; never replace an earlier trial.
    await mkdir(join(directory, 'source/app'), { recursive: true })
    for (const file of fixture.files) await writeFile(join(directory, 'source', file.path), file.content, { flag: 'wx', mode: 0o600 })
    await writeFile(join(directory, 'fixture.json'), JSON.stringify(fixture, null, 2), { flag: 'wx', mode: 0o600 })
    return { prepared: true, built: false, directory, sourceFingerprint: fixture.sourceFingerprint }
  }
  const saved = JSON.parse(await readFile(join(directory, 'fixture.json')))
  if (saved.sourceFingerprint !== fixture.sourceFingerprint || saved.originalFailureSha256 !== fixture.originalFailureSha256) throw new Error('Prepared fixture does not match the historical anchor')
  await verifySource(join(directory, 'source'), fixture.files)
  try { await lstat(join(directory, 'build.json')); throw new Error('This fixture already has a build receipt; prepare a new directory') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const dependencies = JSON.parse(await readFile(join(root, 'package.json'))).dependencies
  for (const [name, version] of Object.entries(JSON.parse(fixture.files.find(file => file.path === 'package.json').content).dependencies)) if (dependencies[name] !== version || JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'))).version !== version) throw new Error(`Installed dependency differs: ${name}`)
  await symlink(join(root, 'node_modules'), join(directory, 'source/node_modules'))
  const startedAt = new Date().toISOString(), started = performance.now()
  const child = Bun.spawn([process.execPath, '--bun', 'run', 'build'], { cwd: join(directory, 'source'), env: { ...Bun.env, NEXT_TELEMETRY_DISABLED: '1' }, stdout: 'pipe', stderr: 'pipe', timeout: 180000 })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  const outputs = []
  async function collect(directory, prefix = '') { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('Export symlinks are unsupported'); const path = `${prefix}${entry.name}`; if (entry.isDirectory()) await collect(join(directory, entry.name), `${path}/`); else { const bytes = await readFile(join(directory, entry.name)); outputs.push({ path, sha256: sha256(bytes), bytes: bytes.length }) } } }
  if (code === 0) await collect(join(directory, 'source/out'))
  await verifySource(join(directory, 'source'), fixture.files)
  const receipt = { startedAt, elapsedMs: performance.now() - started, code, signal: child.signalCode, command: 'bun --bun run build', runtime: `Bun ${Bun.version}`, stdout, stderr, sourceFingerprint: fixture.sourceFingerprint, outputs: outputs.sort((a,b) => a.path.localeCompare(b.path)) }
  await writeFile(join(directory, 'build.json'), JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 })
  if (code !== 0 || !outputs.some(file => file.path === 'index.html')) throw new Error('Fixture build failed; exact private build receipt saved')
  return { prepared: true, built: true, directory, outputFiles: outputs.length }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  if (args.includes('--help')) console.log('bun scripts/evals/repair-diagnostic/prepare.js [--directory ABSOLUTE_PATH] [--build]\nDefault: extract immutable recorded source only. --build: explicit 180-second native build; requires an already prepared directory and existing pinned node_modules. No installation or model request.')
  else {
    if (args.some((arg, index) => !['--build', '--directory'].includes(arg) && args[index - 1] !== '--directory')) throw new Error('Unknown argument')
    const index = args.indexOf('--directory'); if (index >= 0 && !args[index + 1]) throw new Error('--directory requires a path')
    console.log(JSON.stringify(await prepare({ ...(index >= 0 ? { directory: resolve(args[index + 1]) } : {}), build: args.includes('--build') })))
  }
}
