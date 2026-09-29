import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256 } from './fixture.js'

/** Reject extra build inputs, not just mutations of already known files. */
export async function verifySource(directory, files) {
  const expected = new Map(files.map(file => [file.path, file.rev])), found = new Set()
  async function walk(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`
      if (!prefix && ['.next', 'out', 'node_modules'].includes(entry.name)) continue
      if (entry.isDirectory() && [...expected.keys()].some(file => file.startsWith(`${path}/`))) await walk(join(folder, entry.name), `${path}/`)
      else if (entry.isFile() && expected.has(path)) {
        if (sha256(await readFile(join(folder, entry.name))) !== expected.get(path)) throw new Error(`Source changed: ${path}`)
        found.add(path)
      } else throw new Error(`Unexpected source input or symlink: ${path}`)
    }
  }
  await walk(directory)
  if (found.size !== expected.size) throw new Error('A recorded source file is missing')
}
