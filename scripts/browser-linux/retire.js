#!/usr/bin/env bun
/** Retire one obsolete, completely verified generated image; preserve unique assets. */
import { readFile, writeFile, mkdir, readdir, lstat, unlink, rmdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const published = path.join(root, 'public/browser-linux/generated')
const id = process.argv[2]
if (!/^c2w-node24-[a-f0-9]{16}$/.test(id ?? '')) throw new Error('Supply one exact obsolete image id')
const current = JSON.parse(await readFile(path.join(published, 'manifest.json'), 'utf8'))
if (current.id === id) throw new Error('Refusing to retire the current published image')
const directory = path.join(published, id)
const metadata = await readFile(path.join(directory, 'manifest.json'))
const manifest = JSON.parse(metadata)
if (manifest.id !== id) throw new Error('Image directory does not match its manifest')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const files = manifest.files.flatMap((file) => file.parts ?? [file])
files.push({ name: 'manifest.json', bytes: metadata.length, sha256: sha(metadata) })
if (files.some((file) => !/^[a-zA-Z0-9_.-]+$/.test(file.name))) throw new Error('Unsafe asset name')
const names = files.map((file) => file.name).sort()
if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(names)) throw new Error('Unexpected files in obsolete image; nothing retired')
const activeFiles = new Map(current.files.flatMap((file) => file.parts ?? [file]).map((file) => [file.name, file]))
const archive = path.join(root, '.cache/browser-linux/retired', id)
await mkdir(archive, { recursive: true })
for (const file of files) {
  const source = path.join(directory, file.name)
  if (!(await lstat(source)).isFile()) throw new Error(`Unexpected non-file asset: ${file.name}`)
  const bytes = await readFile(source)
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error(`Obsolete asset failed integrity: ${file.name}`)
  const active = activeFiles.get(file.name)
  if (active?.sha256 === file.sha256 && active.bytes === file.bytes) {
    const retained = await readFile(path.join(published, current.id, file.name))
    if (retained.length !== file.bytes || sha(retained) !== file.sha256) throw new Error(`Replacement asset failed integrity: ${file.name}`)
  } else await copyFile(source, path.join(archive, file.name))
}
await writeFile(path.join(archive, 'retired.json'), JSON.stringify({ id, replacement: current.id, at: new Date().toISOString(), sharedFilesRemainIn: current.id }, null, 2))
// Only after validating every old and retained byte may this generated copy go away.
for (const file of files) await unlink(path.join(directory, file.name))
await rmdir(directory)
console.log(`Retired verified image ${id}; unique bytes and manifest preserved in ${archive}`)
