/** Check the exact static export before publication. Does not build or mutate it. */
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
export async function checkDeployment(directory = 'out', { basePath = '/ASKK', requireRuntime = true } = {}) {
  const root = resolve(directory); const files = []
  async function walk(folder) { for (const entry of await readdir(folder, { withFileTypes: true })) { const path = join(folder, entry.name); if (entry.isDirectory()) await walk(path); else if (entry.isFile()) { const size = (await stat(path)).size; if (size >= 100 * 1024 * 1024) throw new Error(`Asset exceeds the GitHub 100 MiB file limit: ${relative(root, path)}`); files.push({ path: relative(root, path), bytes: size, sha256: createHash('sha256').update(await readFile(path)).digest('hex') }) } else throw new Error(`Deployment contains a nonregular asset: ${path}`) } }
  await walk(root)
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0)
  if (bytes > 1_000_000_000) throw new Error('Published site exceeds 1 GB')
  const index = await readFile(join(root, 'index.html'), 'utf8')
  if (!index.includes(`${basePath}/_next/`)) throw new Error(`Export does not reference the configured ${basePath} asset prefix`)
  for (const name of ['.nojekyll', 'coi-serviceworker.js', 'artifact-preview.html', 'agents/index.json', 'workbench.json', 'runtime/modules/runtime/agent.worker.js']) if (!files.some(file => file.path === name)) throw new Error(`Missing required deployment asset: ${name}`)
  let runtime
  if (requireRuntime) {
    runtime = JSON.parse(await readFile(join(root, 'browser-linux/generated/manifest.json'), 'utf8'))
    if (!runtime.id || runtime.verification?.browser === false) console.warn('Runtime manifest does not yet record a browser boot; the deployment must be tested before readiness is claimed.')
    // Publisher and runtime loader verify asset hashes. Validate all declared public pieces here too.
    for (const entry of runtime.files) {
      const names = entry.parts ?? [{ name: entry.name, sha256: entry.sha256, bytes: entry.bytes }]
      for (const piece of names) {
        const path = `browser-linux/generated/${runtime.id}/${piece.name}`
        const file = files.find(row => row.path === path)
        if (!file || file.sha256 !== piece.sha256 || piece.bytes != null && file.bytes !== piece.bytes) throw new Error(`Runtime asset missing or corrupt: ${path}`)
      }
    }
  }
  return { version: 1, basePath, totalBytes: bytes, fileCount: files.length, runtimeId: runtime?.id, artifactHash: createHash('sha256').update(JSON.stringify(files.sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex'), files }
}
if (import.meta.main) { const result = await checkDeployment(process.argv[2] || 'out', { requireRuntime: !process.argv.includes('--without-runtime') }); console.log(JSON.stringify({ ...result, files: undefined }, null, 2)) }
