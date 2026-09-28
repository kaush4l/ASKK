/**
 * The published listing: every file under public/ with a content hash.
 *
 * HTTP cannot list a directory, so the page learns which agents exist from this one file,
 * `agents/index.json`. The dev server builds it on every request, so editing an agent folder
 * and reloading is enough; the build writes it once into dist/.
 *
 *     {"build": "3f9a1c20b7", "files": {"agents/main/agent.md": "a1b2c3d4e5", ...}}
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const hash = (data) => createHash('sha1').update(data).digest('hex').slice(0, 10)

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

export async function listing(publicDir) {
  const files = {}
  for await (const path of walk(publicDir)) {
    const name = relative(publicDir, path).split(sep).join('/')
    if (name === 'agents/index.json') continue
    files[name] = hash(await readFile(path))
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
  return { build: hash(JSON.stringify(sorted)), files: sorted }
}
