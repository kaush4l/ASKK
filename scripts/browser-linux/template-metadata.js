import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

export async function templateMetadata(root) {
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const lockSha256 = sha(await readFile(path.join(root, 'guest/template/package-lock.json')))
  return {
    id: `next-default-${lockSha256.slice(0, 16)}`,
    dependencies: JSON.parse(await readFile(path.join(root, 'guest/template/package.json'), 'utf8')).dependencies,
    lockSha256,
    prepareSha256: sha(await readFile(path.join(root, 'guest/prepare-template.js'))),
    npmGuardSha256: sha(await readFile(path.join(root, 'guest/npm-guard.cjs'))),
    prepareCommand: ['node', '/opt/harness/prepare-template.js'],
    detachCommand: ['node', '/opt/harness/prepare-template.js', '--detach'],
    npmTarballCacheIncluded: false,
  }
}
