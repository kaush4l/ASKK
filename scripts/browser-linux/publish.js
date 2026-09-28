#!/usr/bin/env bun
import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = path.join(root, '.cache/browser-linux/artifact')
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'))
if (!/^[a-zA-Z0-9_.-]+$/.test(manifest.id)) throw new Error('Invalid runtime image id')
const published = path.join(root, 'public/browser-linux/generated')
const candidate = path.join(root, '.cache/browser-linux/candidate/generated')
const output = process.env.ASKK_BROWSER_LINUX_CANDIDATE === '1' ? candidate : published
const priorImages = []
for (const directory of [candidate, published]) {
  const previous = await Bun.file(path.join(directory, 'manifest.json')).json().catch(() => null)
  if (previous) priorImages.push({ directory, manifest: previous })
}
const destination = path.join(output, manifest.id)
await mkdir(destination, { recursive: true })
const partSize = 64 * 1024 * 1024
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function immutable(name, bytes, digest) {
  const existing = Bun.file(path.join(destination, name))
  if (await existing.exists()) {
    if (sha(await existing.bytes()) !== digest) throw new Error(`Refusing to mutate published image: ${manifest.id}/${name}`)
  } else await writeFile(path.join(destination, name), bytes)
}
for (const entry of manifest.files) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(entry.name)) throw new Error('Unsafe artifact name')
  if (!(await Bun.file(path.join(source, entry.name)).exists())) {
    const reusable = priorImages.map((image) => ({ ...image, entry: image.manifest.files?.find((file) => file.name === entry.name && file.bytes === entry.bytes && file.sha256 === entry.sha256) })).find((image) => image.entry)
    const prior = reusable?.entry, previous = reusable?.manifest
    if (!prior || !/^[a-zA-Z0-9_.-]+$/.test(previous.id)) throw new Error(`Missing verified source asset: ${entry.name}`)
    const parts = prior.parts ?? [prior]
    const whole = createHash('sha256')
    let bytes = 0
    for (const part of parts) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(part.name)) throw new Error('Unsafe reusable asset name')
      const original = path.join(reusable.directory, previous.id, part.name)
      const value = await readFile(original)
      if (value.length !== part.bytes || sha(value) !== part.sha256) throw new Error(`Reusable asset integrity mismatch: ${part.name}`)
      whole.update(value); bytes += value.length
    }
    if (bytes !== entry.bytes || whole.digest('hex') !== entry.sha256) throw new Error(`Reusable logical asset integrity mismatch: ${entry.name}`)
    for (const part of parts) {
      const target = path.join(destination, part.name)
      if (await Bun.file(target).exists()) {
        if (sha(await readFile(target)) !== part.sha256) throw new Error(`Refusing to mutate published asset: ${part.name}`)
      } else await link(path.join(reusable.directory, previous.id, part.name), target)
    }
    if (prior.parts) entry.parts = prior.parts
    continue
  }
  const bytes = await readFile(path.join(source, entry.name))
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw new Error(`Artifact integrity mismatch: ${entry.name}`)
  // An explicitly requested private build may consume its derived raw data after
  // full verification. The validated buffer remains live while immutable parts
  // are written, avoiding simultaneous raw and chunk copies on a small disk.
  if (output === candidate && process.env.ASKK_BROWSER_LINUX_CONSUME_DATA === '1' && entry.name.endsWith('.data')) await unlink(path.join(source, entry.name))
  if (bytes.length <= partSize) await immutable(entry.name, bytes, entry.sha256)
  else {
    entry.parts = []
    for (let offset = 0, i = 0; offset < bytes.length; offset += partSize, i++) {
      const part = bytes.subarray(offset, offset + partSize)
      const name = `${entry.name}.part-${String(i).padStart(3, '0')}`
      const digest = sha(part)
      await immutable(name, part, digest)
      entry.parts.push({ name, bytes: part.length, sha256: digest })
    }
  }
}
const metadata = JSON.stringify(manifest, null, 2)
await immutable('manifest.json', metadata, sha(metadata))
await writeFile(path.join(output, 'manifest.json'), metadata)
console.log(`Published verified runtime asset bytes to ${destination}`)
