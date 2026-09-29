import { cp, mkdir, access, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listing } from './listing.js'
import { loadDeskPackages } from '../src/runtime/desk-packages.js'

const root = resolve(import.meta.dirname, '..')
const publicDir = join(root, 'public')
const modules = join(publicDir, 'runtime/modules')
await mkdir(modules, { recursive: true })
for (const name of ['core', 'runtime', 'builtin', 'workspace', 'execution']) {
  const source = join(root, 'src', name)
  try { await access(source) } catch { continue }
  await cp(source, join(modules, name), { recursive: true })
}
const index = await listing(publicDir)
// Validate shipped folders through the production importer/compiler. An authored
// lock is checked against exact bytes; the generated in-memory lock is never
// written over a mismatched supplied lock or back into the source tree.
const catalogue = JSON.parse(await readFile(join(publicDir, 'models.json'), 'utf8'))
const desk = await loadDeskPackages({
  base: `${pathToFileURL(publicDir).href}/`, index, catalogue,
  fetch: async url => {
    try { return new Response(await readFile(fileURLToPath(url))) }
    catch (error) { if (error.code === 'ENOENT') return new Response('', { status: 404 }); throw error }
  },
})
await writeFile(join(publicDir, 'agents/index.json'), `${JSON.stringify(index, null, 2)}\n`)
await writeFile(join(publicDir, '.nojekyll'), '')
console.log(`Validated ${desk.packages.length} agent package(s), ${desk.specs.length} definitions; prepared native worker graph and ${Object.keys(index.files).length} published modules/assets.`)
