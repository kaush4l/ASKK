import { test, expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { patchRuntime, patchProcFd } from '../scripts/browser-linux/patch-runtime.js'
import { errnoTranslation } from '../scripts/browser-linux/patch-errno.js'
import emscriptenErrno from '../scripts/browser-linux/emscripten-errno.json'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const artifact = new URL('../.cache/browser-linux/artifact/out.js', import.meta.url)

test.skipIf(!existsSync(artifact))('built libffi marshals an actual i64 argument and return above the signed pointer boundary', () => {
  const original = readFileSync(artifact, 'utf8')
  const code = original.includes('PTY_atomicIndex = _malloc(4) >> 2;') ? patchRuntime(original).code : original
  const functions = code.slice(code.indexOf('function unbox_small_structs(type_ptr)'), code.indexOf('function ffi_closure_alloc_js'))
  // Sparse heaps model real addresses without allocating 2.3 GiB in a unit test.
  for (const base of [0x1000, 0x80001000, 0x8e001000]) {
    const HEAPU16 = Object.create(null), HEAPU32 = Object.create(null), HEAPU64 = Object.create(null)
    const cif = base, type = base + 32, types = base + 64, avalue = base + 72, arg = base + 80, result = base + 88
    Object.assign(HEAPU32, { [cif / 4]: 1, [cif / 4 + 1]: 1, [cif / 4 + 2]: types, [cif / 4 + 3]: type, [cif / 4 + 6]: 1, [types / 4]: type, [avalue / 4]: arg })
    HEAPU16[(type + 6) / 2] = 12
    HEAPU64[arg / 8] = 987654321012345678n
    let received
    const ffi = new Function('HEAPU16', 'HEAPU32', 'HEAPU64', 'stackSave', 'stackRestore', 'stackAlloc', 'getWasmTableEntry', `${functions}; return ffi_call_js`)(HEAPU16, HEAPU32, HEAPU64, () => 4096, () => {}, () => {}, () => (value) => { received = value; return value + 1n })
    ffi(cif, 1, result, avalue)
    expect(received).toBe(987654321012345678n)
    expect(HEAPU64[result / 8]).toBe(987654321012345679n)
  }
  const atomicExpression = code.match(/PTY_atomicIndex = (_malloc\(4\) >>> 2);/)?.[1]
  expect(atomicExpression).toBeDefined()
  expect(new Function('_malloc', `return ${atomicExpression}`)(() => 0x88001000)).toBe(0x22000400)
})

test('the post-link patch refuses unknown generated source', () => {
  expect(() => patchRuntime('function unrelated() {}')).toThrow('Pinned libffi region')
  expect(() => patchProcFd('function unrelated() {}')).toThrow('Pinned Emscripten proc-fd node')
})

test.skipIf(!existsSync(artifact))('the generated proc-fd node identifies a symlink so chmod can follow the live descriptor target', () => {
  const source = readFileSync(artifact, 'utf8')
  const original = source.replace('              mode: 0o120777,\n', '')
  const makeNode = (code) => {
    const start = code.indexOf('createSpecialDirectories() {')
    const end = code.indexOf('  createStandardStreams(', start)
    const body = code.slice(start, end)
    let procRoot
    const stream = { path: '/harness-control/example.tmp' }
    const FS = { mkdir: () => ({}), createNode: () => ({}), getStreamChecked: () => stream, mount: (driver) => { procRoot = driver.mount() } }
    new Function('FS', 'MEMFS', `return ({${body}}).createSpecialDirectories()`)(FS, { stream_ops: { llseek() {} } })
    const node = procRoot.node_ops.lookup(procRoot, '17')
    const target = { name: 'example.tmp', mode: 0o100644 }
    const fileDirectory = { children: { 'example.tmp': target } }
    FS.root = { children: { proc: { children: { self: { children: { fd: { children: { 17: node } } } } } }, 'harness-control': fileDirectory } }
    Object.assign(FS, { cwd: () => '/', lookupNode: (parent, name) => parent.children[name], isMountpoint: () => false, isRoot: (value) => value === FS.root, isLink: (mode) => (mode & 0o170000) === 0o120000 })
    const lookupStart = code.indexOf('lookupPath(path, opts = {}) {')
    const lookupEnd = code.indexOf('  getPath(node) {', lookupStart)
    const lookup = new Function('FS', 'PATH', `return ({${code.slice(lookupStart, lookupEnd)}}).lookupPath`)(FS, { isAbs: path.posix.isAbsolute, dirname: path.posix.dirname, join2: path.posix.join })
    return { node, stream, target, followed: lookup('/proc/self/fd/17', { follow: true }).node }
  }
  const broken = makeNode(original)
  expect(broken.node.mode).toBeUndefined()
  expect(broken.followed).toBe(broken.node)
  const { node, stream, target, followed } = makeNode(patchProcFd(original))
  expect(followed).toBe(target)
  expect(node.mode & 0o170000).toBe(0o120000)
  expect(node.node_ops.readlink()).toBe('/harness-control/example.tmp')
  stream.path = '/workspaces/proof/renamed.txt'
  expect(node.node_ops.readlink()).toBe('/workspaces/proof/renamed.txt')
})

test.skipIf(!Bun.which('cc'))('compiled 9p errno boundary preserves Linux create, conflict, permission, and missing-directory semantics', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'askk-9p-errno-'))
  try {
    const definitions = Object.entries(emscriptenErrno).map(([name, value]) => `#define ${name} ${value}`).join('\n')
    const body = `#define EMSCRIPTEN 1\n${definitions}\nstatic int errno_to_dotl(int err) {\n${errnoTranslation}\n#endif\nreturn err;\n}\nint main(void) {\n` +
      [[44, 2], [20, 17], [55, 39], [2, 13], [28, 22], [29, 5], [75, 18], [54, 20], [31, 21], [138, 95], [0, 0], [999, 5]].map(([host, linux]) => `if(errno_to_dotl(${host}) != ${linux}) return ${host || 250};`).join('\n') + '\nreturn 0;\n}'
    const binary = path.join(directory, 'errno-proof')
    const compiled = Bun.spawnSync(['cc', '-x', 'c', '-', '-o', binary], { stdin: Buffer.from(body), stdout: 'pipe', stderr: 'pipe' })
    expect(compiled.stderr.toString()).toBe('')
    expect(compiled.exitCode).toBe(0)
    expect(Bun.spawnSync([binary]).exitCode).toBe(0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
