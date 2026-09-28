import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { prepareTemplate } from '../guest/prepare-template.js'
import guard from '../guest/npm-guard.cjs'

const dependencies = { next: '16.3.6', react: '19.3.0', 'react-dom': '19.3.0' }
async function fixture(run) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'askk-template-')))
  const workspace = path.join(root, 'project'), templateRoot = path.join(root, 'template')
  await fs.mkdir(workspace); await fs.mkdir(path.join(templateRoot, 'node_modules'), { recursive: true })
  await fs.writeFile(path.join(templateRoot, 'package.json'), JSON.stringify({ dependencies }))
  await fs.writeFile(path.join(templateRoot, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n')
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ private: true, scripts: { build: 'next build --webpack' }, dependencies }))
  try { await run({ workspace, templateRoot }) } finally { await fs.rm(root, { recursive: true, force: true }) }
}
async function intercept(method, hook, run) {
  const original = fs[method]
  fs[method] = (...args) => hook(original, ...args)
  try { return await run() } finally { fs[method] = original }
}
const absent = async (target) => (await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error })) === null

async function interceptLockWrite(hook, run) {
  return intercept('open', async (original, target, flags, ...args) => {
    const file = await original(target, flags, ...args)
    if (path.basename(target) === 'package-lock.json' && flags === 'wx') {
      const write = file.writeFile.bind(file)
      file.writeFile = (bytes, ...writeArgs) => hook(() => write(bytes, ...writeArgs), target)
    }
    return file
  }, run)
}

test('the exact template creates only a lock and dependency link, and detaches before custom installation', async () => fixture(async (options) => {
  const packageBefore = await fs.readFile(path.join(options.workspace, 'package.json'), 'utf8')
  const result = await prepareTemplate(options)
  expect(result.prepared).toBe(true)
  expect(await fs.readlink(path.join(options.workspace, 'node_modules'))).toBe(path.join(options.templateRoot, 'node_modules'))
  expect(await fs.readFile(path.join(options.workspace, 'package.json'), 'utf8')).toBe(packageBefore)
  expect(await fs.readFile(path.join(options.workspace, 'package-lock.json'), 'utf8')).toBe(await fs.readFile(path.join(options.templateRoot, 'package-lock.json'), 'utf8'))
  expect(() => guard.assertNpmTemplateSafety({ cwd: options.workspace, args: ['install', 'left-pad'], templateRoot: options.templateRoot })).toThrow('detach')
  expect(() => guard.assertNpmTemplateSafety({ cwd: options.workspace, args: ['run', 'build'], templateRoot: options.templateRoot })).not.toThrow()
  expect((await prepareTemplate({ ...options, detach: true })).detached).toBe(true)
  expect(() => guard.assertNpmTemplateSafety({ cwd: options.workspace, args: ['install', 'left-pad'], templateRoot: options.templateRoot })).not.toThrow()
}))

test('custom dependencies and lockfiles are preserved without a generated link', async () => fixture(async (options) => {
  const pkg = path.join(options.workspace, 'package.json'), lock = path.join(options.workspace, 'package-lock.json')
  await fs.writeFile(pkg, JSON.stringify({ dependencies: { ...dependencies, extra: '1.0.0' } }))
  await expect(prepareTemplate(options)).rejects.toMatchObject({ code: 'CUSTOM_DEPENDENCIES' })
  await fs.writeFile(pkg, JSON.stringify({ dependencies }))
  await fs.writeFile(lock, '{"custom":true}')
  await expect(prepareTemplate(options)).rejects.toMatchObject({ code: 'CUSTOM_LOCKFILE' })
  expect(await fs.readFile(lock, 'utf8')).toBe('{"custom":true}')
  expect(await fs.stat(path.join(options.workspace, 'node_modules')).catch(() => null)).toBe(null)
}))

test('template activation and detach do not require hard links from the workspace mount', async () => fixture(async (options) => {
  await intercept('link', () => { throw Object.assign(new Error('The browser mount has no hard links'), { code: 'ENOSYS' }) }, async () => {
    expect((await prepareTemplate(options)).prepared).toBe(true)
    expect((await prepareTemplate({ ...options, detach: true })).detached).toBe(true)
  })
}))

test('existing modules and symlinked package inputs are never replaced', async () => fixture(async (options) => {
  const modules = path.join(options.workspace, 'node_modules')
  await fs.mkdir(modules)
  await expect(prepareTemplate(options)).rejects.toMatchObject({ code: 'DEPENDENCIES_EXIST' })
  await expect(prepareTemplate({ ...options, detach: true })).rejects.toMatchObject({ code: 'CUSTOM_DEPENDENCIES' })
  await fs.rmdir(modules)
  const pkg = path.join(options.workspace, 'package.json')
  await fs.unlink(pkg); await fs.symlink(path.join(options.templateRoot, 'package.json'), pkg)
  await expect(prepareTemplate(options)).rejects.toMatchObject({ code: 'INVALID_TEMPLATE_INPUT' })
}))

test('other package-manager lockfiles retain ownership of installation', async () => fixture(async (options) => {
  const lock = path.join(options.workspace, 'bun.lock')
  await fs.writeFile(lock, 'user-owned lock')
  await expect(prepareTemplate(options)).rejects.toMatchObject({ code: 'CUSTOM_LOCKFILE' })
  expect(await fs.readFile(lock, 'utf8')).toBe('user-owned lock')
  expect(await fs.stat(path.join(options.workspace, 'node_modules')).catch(() => null)).toBe(null)
}))

test('concurrent template activation has one owner and a consistent installed lock', async () => fixture(async (options) => {
  const results = await Promise.allSettled([prepareTemplate(options), prepareTemplate(options)])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(await fs.readFile(path.join(options.workspace, 'package-lock.json'), 'utf8')).toBe(await fs.readFile(path.join(options.templateRoot, 'package-lock.json'), 'utf8'))
  expect(await fs.readlink(path.join(options.workspace, 'node_modules'))).toBe(path.join(options.templateRoot, 'node_modules'))
}))

test('npm options and option terminators cannot disguise a dependency mutation as an allowed command', async () => fixture(async (options) => {
  await prepareTemplate(options)
  const check = args => guard.assertNpmTemplateSafety({ cwd: options.workspace, args, templateRoot: options.templateRoot, env: {} })
  for (const args of [
    ['--loglevel', 'info', 'install', 'left-pad'], ['--loglevel', 'info', 'ci'], ['--loglevel=info', 'ci'],
    ['--', 'install', 'left-pad'], ['--', 'ci'], ['ci', '--loglevel', 'info'],
    ['--prefix', options.workspace, '--loglevel', 'info', 'ci'], ['--no-audit', '--no-fund', 'ci'],
  ]) expect(() => check(args)).toThrow('detach')
  for (const args of [['--unknown', 'info', 'ci'], ['--unknown=info', 'run'], ['--prefix'], ['--loglevel', '--', 'ci']]) {
    try { check(args); throw new Error('Guard accepted ambiguous arguments') } catch (error) { expect(error.code).toBe('UNSUPPORTED_NPM_ARGUMENTS') }
  }
  expect(() => check(['--loglevel', 'info', 'run', 'build', '--', '--webpack'])).not.toThrow()
  expect(() => check(['--', 'run', 'build'])).not.toThrow()
  expect(() => check(['--version'])).not.toThrow()
}))

test('the npm guard respects explicit targets and protects the physical shared template', async () => fixture(async (options) => {
  await prepareTemplate(options)
  const child = path.join(options.workspace, 'src'); await fs.mkdir(child)
  const other = path.join(path.dirname(options.workspace), 'other'); await fs.mkdir(other)
  const check = (cwd, args, env = {}) => guard.assertNpmTemplateSafety({ cwd, args, templateRoot: options.templateRoot, env })
  expect(() => check(child, ['ci'])).toThrow('detach')
  expect(() => check(other, ['--prefix', options.workspace, 'ci'])).toThrow('detach')
  expect(() => check(other, ['ci'], { npm_config_prefix: options.workspace })).toThrow('detach')
  expect(() => check(options.workspace, ['ci'], { npm_config_prefix: other })).toThrow('detach')
  expect(() => check(path.join(options.templateRoot, 'node_modules'), ['ci'])).toThrow('detach')
  expect(() => check(options.workspace, ['--prefix', other, 'install', '--ignore-scripts'])).not.toThrow()
  await prepareTemplate({ ...options, detach: true })
  expect(() => check(options.workspace, ['ci', '--prefer-offline', '--no-audit', '--no-fund'])).not.toThrow()
}))

test('a separate helper process cannot detach an activation that owns the atomic operation lock', async () => fixture(async (options) => {
  let observed = false
  await interceptLockWrite(async (original, destination) => {
    if (destination === path.join(options.workspace, 'package-lock.json')) {
      const script = `import {prepareTemplate} from ${JSON.stringify(new URL('../guest/prepare-template.js', import.meta.url).pathname)}; try { await prepareTemplate(${JSON.stringify({ ...options, detach: true })}); process.exitCode=9 } catch(error) { process.stdout.write(error.code) }`
      const child = Bun.spawn([process.execPath, '--eval', script], { stdout: 'pipe', stderr: 'pipe' })
      expect(await new Response(child.stdout).text()).toBe('TEMPLATE_BUSY')
      expect(await child.exited).toBe(0)
      observed = true
    }
    return original()
  }, () => prepareTemplate(options))
  expect(observed).toBe(true)
  expect(await fs.readlink(path.join(options.workspace, 'node_modules'))).toBe(path.join(options.templateRoot, 'node_modules'))
  expect(await absent(path.join(options.workspace, '.harness-template-operation'))).toBe(true)
  expect((await prepareTemplate({ ...options, detach: true })).detached).toBe(true)
}))

test('activation rejects an observed external link removal and rolls back only its generated lock', async () => fixture(async (options) => {
  await interceptLockWrite(async (original, destination) => {
    const result = await original()
    if (destination === path.join(options.workspace, 'package-lock.json')) await fs.unlink(path.join(options.workspace, 'node_modules'))
    return result
  }, () => expect(prepareTemplate(options)).rejects.toMatchObject({ code: 'PROJECT_CHANGED' }))
  expect(await absent(path.join(options.workspace, 'package-lock.json'))).toBe(true)
  expect(await absent(path.join(options.workspace, '.harness-template-operation'))).toBe(true)
}))

test('a custom lock added during activation is retained and prevents template publication', async () => fixture(async (options) => {
  const lock = path.join(options.workspace, 'pnpm-lock.yaml')
  await interceptLockWrite(async (original, destination) => {
    const result = await original()
    if (destination === path.join(options.workspace, 'package-lock.json')) await fs.writeFile(lock, 'user-owned lock')
    return result
  }, () => expect(prepareTemplate(options)).rejects.toMatchObject({ code: 'CUSTOM_LOCKFILE' }))
  expect(await fs.readFile(lock, 'utf8')).toBe('user-owned lock')
  expect(await absent(path.join(options.workspace, 'node_modules'))).toBe(true)
  expect(await absent(path.join(options.workspace, 'package-lock.json'))).toBe(true)
}))

test('detach restores an unexpected replacement captured by the atomic rename', async () => fixture(async (options) => {
  await prepareTemplate(options)
  const modules = path.join(options.workspace, 'node_modules'), custom = path.join(path.dirname(options.workspace), 'custom')
  await fs.mkdir(custom); await fs.writeFile(path.join(custom, 'owned.txt'), 'preserve me')
  let replaced = false
  await intercept('rename', async (original, source, destination) => {
    if (source === modules && !replaced) { replaced = true; await fs.unlink(modules); await fs.symlink(custom, modules) }
    return original(source, destination)
  }, () => expect(prepareTemplate({ ...options, detach: true })).rejects.toMatchObject({ code: 'PROJECT_CHANGED' }))
  expect(replaced).toBe(true)
  expect(await fs.readlink(modules)).toBe(custom)
  expect(await fs.readFile(path.join(modules, 'owned.txt'), 'utf8')).toBe('preserve me')
  expect((await fs.readdir(options.workspace)).filter(name => name.startsWith('.harness-template-'))).toEqual([])
}))

test('detach never overwrites a newer destination when restoring an unexpected link', async () => fixture(async (options) => {
  await prepareTemplate(options)
  const modules = path.join(options.workspace, 'node_modules'), first = path.join(options.workspace, 'custom-first'), second = path.join(options.workspace, 'custom-second')
  await fs.mkdir(first); await fs.mkdir(second)
  let failure
  await intercept('rename', async (original, source, destination) => {
    if (source !== modules) return original(source, destination)
    await fs.unlink(modules); await fs.symlink(first, modules)
    await original(source, destination)
    await fs.symlink(second, modules)
  }, async () => { try { await prepareTemplate({ ...options, detach: true }) } catch (error) { failure = error } })
  expect(failure?.code).toBe('PROJECT_CHANGED')
  expect(await fs.readlink(modules)).toBe(second)
  expect(await fs.readlink(failure.recoveryPath)).toBe(first)
  expect(failure.recoveryPath.startsWith(path.join(options.workspace, '.harness-template-recovery-'))).toBe(true)
  expect(await absent(path.join(options.workspace, '.harness-template-operation'))).toBe(true)
}))

test('detach preserves an unexpected regular file without requiring a hard-link restore', async () => fixture(async (options) => {
  await prepareTemplate(options)
  const modules = path.join(options.workspace, 'node_modules')
  let failure
  await intercept('rename', async (original, source, destination) => {
    if (source === modules) { await fs.unlink(modules); await fs.writeFile(modules, 'user-owned replacement') }
    return original(source, destination)
  }, async () => { try { await prepareTemplate({ ...options, detach: true }) } catch (error) { failure = error } })
  expect(failure?.code).toBe('PROJECT_CHANGED')
  expect(await fs.readFile(failure.recoveryPath, 'utf8')).toBe('user-owned replacement')
  expect(await absent(modules)).toBe(true)
  expect(await absent(path.join(options.workspace, '.harness-template-operation'))).toBe(true)
}))

test('rollback retains a replacement link and changed manifest after a failed activation', async () => fixture(async (options) => {
  const custom = path.join(options.workspace, 'custom'); await fs.mkdir(custom)
  const modules = path.join(options.workspace, 'node_modules'), pkg = path.join(options.workspace, 'package.json')
  const changed = JSON.stringify({ dependencies: { ...dependencies, extra: '2.0.0' } })
  await interceptLockWrite(async (original, destination) => {
    const result = await original()
    if (destination === path.join(options.workspace, 'package-lock.json')) {
      await fs.writeFile(pkg, changed); await fs.unlink(modules); await fs.symlink(custom, modules)
    }
    return result
  }, () => expect(prepareTemplate(options)).rejects.toMatchObject({ code: 'PROJECT_CHANGED' }))
  expect(await fs.readFile(pkg, 'utf8')).toBe(changed)
  expect(await fs.readlink(modules)).toBe(custom)
  expect(await absent(path.join(options.workspace, 'package-lock.json'))).toBe(true)
}))
