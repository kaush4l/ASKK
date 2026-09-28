/** Explicitly activate the image's exact dependency template, or detach its generated link.
 * An atomic workspace lock serializes cooperating helper processes. Arbitrary shell
 * mutations do not obey that lock; final checks detect observed changes, while
 * quarantined removal preserves unexpected replacements instead of deleting them.
 * Files may still change after validation; this is not a filesystem sandbox.
 */
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const sha = (data) => createHash('sha256').update(data).digest('hex')
const fail = (code, message) => Object.assign(new Error(message), { code })
const stat = (target) => fs.lstat(target).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
const sameFile = (first, second) => first && second && first.dev === second.dev && first.ino === second.ino
const customLocks = ['npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']
const readRegular = async (target) => {
  let file
  try {
    file = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await file.stat()
    if (!info.isFile() || info.size > 1024 * 1024) throw fail('INVALID_TEMPLATE_INPUT', `Expected a regular JSON file: ${path.basename(target)}`)
    return await file.readFile()
  } catch (error) {
    if (['ENOENT', 'ELOOP'].includes(error.code)) throw fail('INVALID_TEMPLATE_INPUT', `Expected a regular JSON file: ${path.basename(target)}`)
    throw error
  } finally { await file?.close() }
}
const normalized = (value = {}) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
async function rejectCustomLocks(root) {
  for (const name of customLocks) if (await stat(path.join(root, name))) throw fail('CUSTOM_LOCKFILE', `The project already uses ${name}; retain its own dependency installation`)
}

async function removeExpected(location, expected, matches) {
  const current = await stat(location)
  if (!current) return false
  if (!sameFile(expected, current)) throw fail('PROJECT_CHANGED', `${path.basename(location)} was replaced; leaving the replacement untouched`)
  const recovery = await fs.mkdtemp(path.join(path.dirname(location), '.harness-template-recovery-'))
  const captured = path.join(recovery, path.basename(location))
  try { await fs.rename(location, captured) }
  catch (error) { await fs.rmdir(recovery); if (error.code === 'ENOENT') return false; throw error }
  const capturedInfo = await stat(captured)
  if (sameFile(expected, capturedInfo) && await matches(captured, capturedInfo)) {
    await fs.unlink(captured); await fs.rmdir(recovery)
    return true
  }
  // A symlink can be restored create-only. Regular files remain in recovery:
  // browser-backed 9p has no hard links, and rename() could overwrite a newer
  // workspace entry. No recursive deletion or copy-and-delete occurs.
  let restored = false
  if (capturedInfo?.isSymbolicLink()) {
    try {
      await fs.symlink(await fs.readlink(captured), location)
      restored = true
    }
    catch (error) { if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw Object.assign(error, { recoveryPath: captured }) }
  }
  if (restored) { await fs.unlink(captured); await fs.rmdir(recovery) }
  throw Object.assign(fail('PROJECT_CHANGED', `${path.basename(location)} changed during removal; ${restored ? 'the replacement was restored without overwriting another entry' : `the replacement is preserved at ${captured}; recover it after inspecting the workspace`}`), restored ? {} : { recoveryPath: captured })
}

export async function prepareTemplate({ workspace = process.cwd(), templateRoot = '/opt/harness/template', detach = false } = {}) {
  const root = await fs.realpath(workspace)
  const template = await fs.realpath(templateRoot)
  const target = path.join(template, 'node_modules')
  const modules = path.join(root, 'node_modules')
  const operation = path.join(root, '.harness-template-operation')
  try { await fs.mkdir(operation, { mode: 0o700 }) }
  catch (error) {
    if (error.code === 'EEXIST') throw fail('TEMPLATE_BUSY', `Another template operation owns ${operation}. If a helper was interrupted, inspect and remove that directory only after confirming no template helper is running`)
    throw error
  }
  const ownership = await fs.lstat(operation)
  try { return await prepareOwned({ root, template, target, modules, operation, detach }) }
  finally {
    // Remove only our known private staging names, never recursively remove a
    // lock directory that an unrelated command may have populated or replaced.
    if (sameFile(ownership, await stat(operation))) {
      await fs.rmdir(operation)
    }
  }
}

async function prepareOwned({ root, template, target, modules, operation, detach }) {
  const existing = await stat(modules)
  const exactLink = async (location, info) => !!info?.isSymbolicLink() && path.resolve(root, await fs.readlink(location)) === target
  if (detach) {
    if (!existing) return { detached: false, reason: 'No generated dependency link is present' }
    if (!await exactLink(modules, existing)) throw fail('CUSTOM_DEPENDENCIES', 'Refusing to detach user-managed node_modules')
    return { detached: await removeExpected(modules, existing, exactLink) }
  }
  if (existing) throw fail('DEPENDENCIES_EXIST', 'node_modules already exists; the template cannot replace it')
  await rejectCustomLocks(root)
  if (!(await stat(target))?.isDirectory()) throw fail('TEMPLATE_MISSING', 'The image does not contain installed template dependencies')
  const [packageBytes, templatePackageBytes, lockBytes] = await Promise.all([
    readRegular(path.join(root, 'package.json')), readRegular(path.join(template, 'package.json')), readRegular(path.join(template, 'package-lock.json')),
  ])
  const pkg = JSON.parse(packageBytes), seed = JSON.parse(templatePackageBytes)
  if (normalized(pkg.dependencies) !== normalized(seed.dependencies) || ['devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'resolutions', 'workspaces', 'bundledDependencies', 'bundleDependencies'].some((key) => pkg[key] && Object.keys(pkg[key]).length)) {
    throw fail('CUSTOM_DEPENDENCIES', 'The project dependency contract differs from the pinned template; install its own dependencies')
  }
  const lockPath = path.join(root, 'package-lock.json')
  const oldLock = await stat(lockPath)
  if (oldLock && sha(await readRegular(lockPath)) !== sha(lockBytes)) throw fail('CUSTOM_LOCKFILE', 'The existing package lock differs from the pinned template')
  if (sha(await readRegular(path.join(root, 'package.json'))) !== sha(packageBytes)) throw fail('PROJECT_CHANGED', 'package.json changed during template preparation')
  let createdLock, createdLink
  try {
    // Both publications are create-only. Capture identities for final validation
    // and rollback; cooperating helper processes cannot intervene under the lock.
    await fs.symlink(target, modules, 'dir'); createdLink = await fs.lstat(modules)
    if (!oldLock) {
      // O_EXCL publishes only into an absent destination and does not require
      // hard links, which Emscripten's browser-backed filesystem cannot provide.
      const file = await fs.open(lockPath, 'wx')
      try { createdLock = await file.stat(); await file.writeFile(lockBytes) }
      finally { await file.close() }
    }
    if (sha(await readRegular(path.join(root, 'package.json'))) !== sha(packageBytes) || sha(await readRegular(lockPath)) !== sha(lockBytes)) throw fail('PROJECT_CHANGED', 'The project changed during template preparation')
    await rejectCustomLocks(root)
    const finalLink = await stat(modules)
    if (!sameFile(createdLink, finalLink) || !await exactLink(modules, finalLink)) throw fail('PROJECT_CHANGED', 'The generated dependency link changed during template preparation')
    return { prepared: true, dependencies: seed.dependencies, lockSha256: sha(lockBytes), modules: target, customInstall: 'Detach this generated link before running a custom package installation' }
  } catch (error) {
    const cleanupErrors = []
    if (createdLink) await removeExpected(modules, createdLink, exactLink).catch(error => cleanupErrors.push(error.message))
    if (createdLock) await removeExpected(lockPath, createdLock, async (location, info) => info?.isFile() && sha(await readRegular(location)) === sha(lockBytes)).catch(error => cleanupErrors.push(error.message))
    if (cleanupErrors.length) error.message += `; cleanup preserved changed entries: ${cleanupErrors.join('; ')}`
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--detach')) { console.error('Usage: node /opt/harness/prepare-template.js [--detach]'); process.exitCode = 2 }
  else try { console.log(JSON.stringify(await prepareTemplate({ detach: args.includes('--detach') }))) }
  catch (error) { console.error(JSON.stringify({ error: error.code ?? 'TEMPLATE_PREPARE_FAILED', message: error.message })); process.exitCode = 1 }
}
