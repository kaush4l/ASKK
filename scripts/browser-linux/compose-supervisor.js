#!/usr/bin/env bun
/** Update the verified JS control plane while preserving the already built Linux image. */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifact = path.join(root, '.cache/browser-linux/artifact')
const manifest = JSON.parse(await readFile(path.join(artifact, 'manifest.json'), 'utf8'))
const published = JSON.parse(await readFile(path.join(root, 'public/browser-linux/generated/manifest.json'), 'utf8'))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
if (!manifest.source.errnoTranslation) throw new Error('The compiled QEMU artifact lacks the 9p errno correction')
for (const file of manifest.files) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(file.name)) throw new Error('Unsafe artifact name')
  const local = Bun.file(path.join(artifact, file.name))
  if (await local.exists()) {
    const bytes = await local.bytes()
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error(`Compiled asset changed: ${file.name}`)
  } else {
    const prior = published.files.find((entry) => entry.name === file.name && entry.bytes === file.bytes && entry.sha256 === file.sha256)
    if (!file.name.endsWith('.data') || !prior) throw new Error(`Missing compiled asset: ${file.name}`)
    // publish.js verifies every reused chunk and the complete logical file before linking it.
  }
}
const supervisor = await readFile(path.join(root, 'guest/supervisor.js'))
if (manifest.files.some((file) => file.name === 'supervisor.js' && file.bytes === supervisor.length && file.sha256 === sha(supervisor))) {
  console.log(`Supervisor already matches the immutable image: ${manifest.id}`)
  process.exit(0)
}
await writeFile(path.join(artifact, 'supervisor.js'), supervisor)
const priorImage = manifest.id
const priorComposition = manifest.source.composition
manifest.files = manifest.files.filter((file) => file.name !== 'supervisor.js')
manifest.files.push({ name: 'supervisor.js', bytes: supervisor.length, sha256: sha(supervisor) })
manifest.files.sort((a, b) => a.name.localeCompare(b.name))
manifest.id = `c2w-node24-${sha(JSON.stringify(manifest.files)).slice(0, 16)}`
manifest.source.composition = {
  qemuImage: priorComposition?.qemuImage ?? priorImage,
  rootfsImage: priorComposition?.rootfsImage ?? published.id,
  rootfsSupervisorSha256: priorComposition?.rootfsSupervisorSha256 ?? published.source.guestSupervisorSha256,
  scriptSha256: sha(await readFile(fileURLToPath(import.meta.url))),
}
manifest.source.guestSupervisorSha256 = sha(supervisor)
manifest.source.guestEntrypoint = '/harness-control/supervisor.js (verified 9p asset)'
manifest.verification.browser = false
await writeFile(path.join(artifact, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`Composed verified supervisor with existing Linux image: ${manifest.id}`)
