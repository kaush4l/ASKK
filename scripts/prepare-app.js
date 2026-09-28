import { cp, mkdir, access, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { listing } from './listing.js'

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
await writeFile(join(publicDir, 'agents/index.json'), `${JSON.stringify(index, null, 2)}\n`)
await writeFile(join(publicDir, '.nojekyll'), '')
console.log(`Prepared native worker graph and ${Object.keys(index.files).length} published modules/assets.`)
