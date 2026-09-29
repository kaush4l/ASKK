import { open, readFile, realpath, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCompanion } from '../../host/companion.js'
import { childEnvironment, help, parseLaunchOptions } from './options.js'
import { verifyPackage } from './package.js'

const contains = (root, path) => { const value = relative(root, path); return value === '' || value !== '..' && !value.startsWith(`..${sep}`) && !value.startsWith(sep) }
export async function prepareLaunch(options, packageRoot, env = process.env) {
  const root = await realpath(options.root)
  if (!(await stat(root)).isDirectory()) throw new Error('--root must be a directory')
  const bundle = await realpath(packageRoot), cert = await realpath(options.cert), key = await realpath(options.key)
  for (const [label, path] of [['TLS certificate', cert], ['TLS key', key]]) {
    if (!(await stat(path)).isFile() || contains(bundle, path)) throw new Error(`${label} must be an external regular file, outside the package`)
  }
  if (contains(root, key)) throw new Error('Keep the private TLS key outside the granted workspace')
  if (['.', '..', ''].includes(basename(options.pairingFile)) || options.pairingFile.endsWith(sep)) throw new Error('The pairing-file path must name a file')
  const parent = await realpath(dirname(options.pairingFile)), parentInfo = await stat(parent)
  if (!parentInfo.isDirectory() || (parentInfo.mode & 0o077) !== 0 || typeof process.getuid === 'function' && parentInfo.uid !== process.getuid()) throw new Error('The pairing-file directory must already exist, belong to you and have mode0700')
  const pairingFile = join(parent, basename(options.pairingFile))
  if (contains(root, pairingFile) || contains(bundle, pairingFile)) throw new Error('Keep the pairing file outside the granted workspace and package')
  return { root, cert, key, pairingFile, port: options.port, origins: options.origins, capabilities: options.capabilities, shell: '/bin/sh', shellArgs: [], childEnv: childEnvironment(bundle, env) }
}

export async function launch(options, { packageRoot = fileURLToPath(new URL('../../', import.meta.url)), env = process.env, create = createCompanion } = {}) {
  await verifyPackage(packageRoot)
  const prepared = await prepareLaunch(options, packageRoot, env)
  if (options.check) return { checked: true, root: prepared.root, capabilities: prepared.capabilities, origins: prepared.origins, pairingFile: prepared.pairingFile }
  // Reserve exclusively before opening a server. Never replace another session's token.
  const handle = await open(prepared.pairingFile, 'wx', 0o600)
  let companion, closing, pairingText
  const close = () => closing ??= (async () => {
    try { await companion?.close() } finally {
      // Preserve a replacement detected before cleanup. This is not an atomic
      // compare-and-unlink against an uncoordinated writer in the owner's directory.
      try { if (await readFile(prepared.pairingFile, 'utf8') === pairingText) await unlink(prepared.pairingFile) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  })()
  try {
    companion = await create(prepared)
    pairingText = `${JSON.stringify({ url: companion.url, token: companion.token, root: companion.root, capabilities: prepared.capabilities })}\n`
    await handle.writeFile(pairingText); await handle.sync(); await handle.close()
    return { ...companion, pairingFile: prepared.pairingFile, close }
  } catch (error) {
    await handle.close().catch(() => {})
    await companion?.close().catch(() => {})
    // Before publication this process exclusively owns the newly created file.
    if (await readFile(prepared.pairingFile, 'utf8').catch(() => null) === (pairingText ?? '')) await unlink(prepared.pairingFile).catch(() => {})
    throw error
  }
}

if (import.meta.main) {
  try {
    const options = parseLaunchOptions(process.argv.slice(2))
    if (options.help) console.log(help)
    else {
      if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This package targets Apple Silicon macOS only')
      const result = await launch(options)
      if (result.checked) console.log(JSON.stringify(result, null, 2))
      else {
        console.log(`ASKK companion: ${result.url}\nProject: ${result.root}\nPairing file (private; do not publish): ${result.pairingFile}`)
        for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { result.close().then(() => process.exit(0), error => { console.error(`Shutdown could not be confirmed: ${error.message}`); process.exitCode = 1 }) })
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
