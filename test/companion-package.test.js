import { expect, test } from 'bun:test'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage, payload, planPackage, verifyPackage } from '../scripts/companion/package.js'
import { childEnvironment, parseLaunchOptions } from '../scripts/companion/options.js'
import { parseBuildOptions } from '../scripts/companion/build.js'
import { launch, prepareLaunch } from '../scripts/companion/launch.js'
import { nextFixture, parseAcceptanceOptions } from '../scripts/companion/acceptance.js'

const repository = fileURLToPath(new URL('../', import.meta.url))
const args = ['--root', '/project', '--allow-origin', 'https://owner.example', '--capabilities', 'model-relay,network-relay', '--tls-cert', '/private/cert.pem', '--tls-key', '/private/key.pem', '--pairing-file', '/private/session.json']
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'askk-package-test-'))
  const source = join(directory, 'source'), output = join(directory, 'moved package'), bun = join(directory, 'fixture-bun')
  try {
    for (const [path] of payload) { await mkdir(dirname(join(source, path)), { recursive: true }); await copyFile(join(repository, path), join(source, path)) }
    const bytes = Buffer.alloc(32); bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(0x0100000c, 4)
    await writeFile(bun, bytes, { mode: 0o755 })
    const pin = { target: 'darwin-arm64', version: 'fixture-only', sha256: createHash('sha256').update(bytes).digest('hex') }
    await writeFile(join(source, 'scripts/companion/runtime-pin.json'), JSON.stringify(pin))
    await writeFile(join(source, '.env'), 'PRIVATE_FIXTURE_SECRET')
    await writeFile(join(source, 'private-key.pem'), 'PRIVATE_FIXTURE_KEY')
    await run({ directory, source, output, bun, inputs: { repository: source, output, bun, sourceRevision: 'fixture' } })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('launcher requires explicit validated grants, exact origins and external credential paths', () => {
  expect(parseLaunchOptions(args)).toMatchObject({ root: '/project', origins: ['https://owner.example'], capabilities: ['model-relay', 'network-relay'], port: 7717 })
  expect(parseLaunchOptions(['--help'])).toEqual({ help: true })
  for (const change of [a => a.filter((_, i) => i !== 4 && i !== 5), a => a.toSpliced(3, 1, 'https://owner.example/path'), a => a.toSpliced(5, 1, 'model-relay,exec,unknown'), a => [...a, '--capabilities', 'fs'], a => [...a, '--token', 'do-not-accept'], a => [...a, '--port', '0'], a => a.toSpliced(1, 1, 'relative'), a => a.toSpliced(3, 1, 'https://owner:secret@example.com')]) expect(() => parseLaunchOptions(change([...args]))).toThrow()
  expect(parseBuildOptions(['--dry-run'])).toEqual({ dryRun: true })
  expect(() => parseBuildOptions(['--tls-key', '/do-not-package'])).toThrow()
})

test('child environment owns command lookup without inherited secrets or preload/profile hooks', () => {
  const env = childEnvironment('/moved package', { PATH: '/malicious', HOME: '/owner', LANG: 'en_US.UTF-8', OPENAI_API_KEY: 'private', ASKK_PAIRING_TOKEN: 'private', NODE_OPTIONS: '--require /x', BUN_OPTIONS: '--preload /x', ENV: '/profile', BASH_ENV: '/profile' })
  expect(env).toEqual({ PATH: '/moved package/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/owner', LANG: 'en_US.UTF-8' })
  expect(() => childEnvironment('/invalid:package')).toThrow('PATH separators')
})

test('native acceptance requires explicit execution and generates the real pinned Next build profile', () => {
  const options = ['--directory', '/new/proof', '--tls-cert', '/external/cert', '--tls-key', '/external/key', '--tls-ca', '/external/ca']
  expect(() => parseAcceptanceOptions(options)).toThrow('Explicit --execute')
  expect(parseAcceptanceOptions(['--execute', ...options])).toMatchObject({ execute: true, directory: '/new/proof', port: 7797 })
  expect(() => parseAcceptanceOptions(['--execute', ...options, '--disable-tls-validation'])).toThrow()
  const files = nextFixture({ next: '16.3.6', react: '19.3.0', 'react-dom': '19.3.0' })
  const manifest = JSON.parse(files['package.json'])
  expect(manifest.scripts.build).toBe('next build --webpack')
  expect(manifest.dependencies).toEqual({ next: '16.3.6', react: '19.3.0', 'react-dom': '19.3.0' })
  expect(files['next.config.mjs']).toContain("output:'export'")
  expect(files['app/page.jsx']).toContain('Packaged companion proof')
  expect(() => nextFixture({ next: '^16', react: '19.3.0', 'react-dom': '19.3.0' })).toThrow('exact installed next')
})

test('dry-run writes nothing; copied allowlist is exact, reproducible, hash checked and non-overwriting', () => fixture(async ({ directory, source, output, bun, inputs }) => {
  const before = await readdir(directory)
  const planned = await planPackage(inputs)
  expect(await readdir(directory)).toEqual(before)
  const built = await buildPackage(inputs)
  expect(built.manifest).toEqual(planned.manifest)
  expect((await verifyPackage(output)).runtime.version).toBe('fixture-only')
  expect(built.manifest.files.map(file => file.path)).toEqual([...payload.map(([, path]) => path), 'runtime/bun'])
  expect(JSON.stringify(built.manifest)).not.toContain(directory)
  expect(await lstat(join(output, '.env')).catch(() => null)).toBeNull()
  expect(await lstat(join(output, 'private-key.pem')).catch(() => null)).toBeNull()
  await expect(buildPackage(inputs)).rejects.toMatchObject({ code: 'EEXIST' })
  await writeFile(join(output, 'host/companion.js'), 'corrupt')
  await expect(verifyPackage(output)).rejects.toThrow('integrity check failed')
  await writeFile(bun, 'not the pinned runtime')
  await expect(planPackage({ ...inputs, output: join(directory, 'refused') })).rejects.toThrow('Darwin ARM64')
  expect(await lstat(join(directory, 'refused')).catch(() => null)).toBeNull()
}))

test('check-only and mocked lifecycle keep credentials private and preserve explicit relay-only authority', () => fixture(async ({ directory, output, inputs }) => {
  await buildPackage(inputs)
  const root = join(directory, 'workspace'), privateDir = join(directory, 'private')
  await mkdir(root); await mkdir(privateDir, { mode: 0o700 })
  const cert = join(privateDir, 'cert.pem'), key = join(privateDir, 'key.pem'), pairingFile = join(privateDir, 'pairing.json')
  await writeFile(cert, 'fixture certificate'); await writeFile(key, 'fixture key', { mode: 0o600 })
  const options = { ...parseLaunchOptions(args), root, cert, key, pairingFile }
  const canonicalOutput = await realpath(output)
  let calls = 0, closed = 0
  const create = async value => { calls++; expect(value).toMatchObject({ capabilities: ['model-relay', 'network-relay'], shell: '/bin/sh', shellArgs: [] }); expect(value.childEnv.PATH).toBe(`${canonicalOutput}/bin:/usr/bin:/bin:/usr/sbin:/sbin`); return { token: 'PRIVATE_FIXTURE_TOKEN', url: 'https://127.0.0.1:7717', root, close: async () => { closed++ } } }
  expect((await launch({ ...options, check: true }, { packageRoot: output, create })).checked).toBe(true)
  expect(calls).toBe(0)
  expect(await lstat(pairingFile).catch(() => null)).toBeNull()
  const running = await launch(options, { packageRoot: output, create })
  expect(JSON.parse(await readFile(pairingFile, 'utf8')).token).toBe('PRIVATE_FIXTURE_TOKEN')
  expect((await lstat(pairingFile)).mode & 0o777).toBe(0o600)
  await expect(launch(options, { packageRoot: output, create })).rejects.toMatchObject({ code: 'EEXIST' })
  expect(calls).toBe(1)
  await running.close(); await running.close()
  expect(closed).toBe(1)
  expect(await lstat(pairingFile).catch(() => null)).toBeNull()
  await chmod(privateDir, 0o755)
  await expect(prepareLaunch(options, output)).rejects.toThrow('mode0700')
  await chmod(privateDir, 0o700)
  await expect(prepareLaunch({ ...options, pairingFile: `${privateDir}/..` }, output)).rejects.toThrow('must name a file')
  await expect(prepareLaunch({ ...options, key: await writeFile(join(root, 'key.pem'), 'key').then(() => join(root, 'key.pem')) }, output)).rejects.toThrow('private TLS key outside')
}))

test('failed startup removes its reserved pairing file and shutdown preserves an already replaced file', () => fixture(async ({ directory, output, inputs }) => {
  await buildPackage(inputs)
  const root = join(directory, 'workspace'), privateDir = join(directory, 'private')
  await mkdir(root); await mkdir(privateDir, { mode: 0o700 })
  const cert = join(privateDir, 'cert.pem'), key = join(privateDir, 'key.pem'), pairingFile = join(privateDir, 'pairing.json')
  await writeFile(cert, 'cert'); await writeFile(key, 'key')
  const options = { ...parseLaunchOptions(args), root, cert, key, pairingFile }
  await expect(launch(options, { packageRoot: output, create: async () => { throw new Error('controlled invalid TLS') } })).rejects.toThrow('controlled invalid TLS')
  expect(await lstat(pairingFile).catch(() => null)).toBeNull()
  const running = await launch(options, { packageRoot: output, create: async () => ({ token: 'private', url: 'https://127.0.0.1:7717', root, close: async () => {} }) })
  await writeFile(pairingFile, 'owner replacement')
  await running.close()
  expect(await readFile(pairingFile, 'utf8')).toBe('owner replacement')
}))

test('concurrent shutdown callers await the same owned-process cleanup', () => fixture(async ({ directory, output, inputs }) => {
  await buildPackage(inputs)
  const root = join(directory, 'workspace'), privateDir = join(directory, 'private')
  await mkdir(root); await mkdir(privateDir, { mode: 0o700 })
  const cert = join(privateDir, 'cert.pem'), key = join(privateDir, 'key.pem'), pairingFile = join(privateDir, 'pairing.json')
  await writeFile(cert, 'cert'); await writeFile(key, 'key')
  let release, closes = 0, settled = 0
  const barrier = new Promise(resolve => { release = resolve })
  const running = await launch({ ...parseLaunchOptions(args), root, cert, key, pairingFile }, { packageRoot: output, create: async () => ({ token: 'private', url: 'https://127.0.0.1:7717', root, close: async () => { closes++; await barrier } }) })
  const first = running.close(), second = running.close()
  first.then(() => settled++); second.then(() => settled++)
  await Promise.resolve(); await Promise.resolve()
  expect(first).toBe(second)
  expect(closes).toBe(1)
  expect(settled).toBe(0)
  expect(await lstat(pairingFile).catch(() => null)).not.toBeNull()
  release(); await Promise.all([first, second])
  expect(settled).toBe(2)
  expect(await lstat(pairingFile).catch(() => null)).toBeNull()
}))
