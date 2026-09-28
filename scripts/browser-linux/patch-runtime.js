import { createHash } from 'node:crypto'

const hash = (value) => createHash('sha256').update(value).digest('hex')
/** Emscripten's synthetic proc-fd nodes must identify themselves as symlinks. */
export function patchProcFd(source) {
  const original = 'mountpoint: "fake"\n              },\n              node_ops: {\n                readlink: () => stream.path'
  if (source.split(original).length !== 2) throw new Error('Pinned Emscripten proc-fd node changed')
  return source.replace(original, 'mountpoint: "fake"\n              },\n              mode: 0o120777,\n              node_ops: {\n                readlink: () => stream.path')
}
/** libffi's pinned wasm32 DEREF macros predate heaps larger than 2 GiB. */
export function patchRuntime(source) {
  const start = source.indexOf('function unbox_small_structs(type_ptr) {')
  const end = source.indexOf('// Imports from the Wasm binary.', start)
  if (start < 0 || end < start) throw new Error('Pinned libffi region is missing')
  const region = source.slice(start, end)
  const matches = [...region.matchAll(/(?<!>) >> (?!>)/g)]
  if (matches.length < 70 || matches.length > 110) throw new Error(`Unexpected libffi pointer-shift count: ${matches.length}`)
  // Every shift in this bounded region belongs to a HEAP* pointer index.
  for (const line of region.split('\n').filter((line) => /(?<!>) >> (?!>)/.test(line))) {
    if (!line.includes('HEAP')) throw new Error('Unexpected arithmetic shift in libffi region')
  }
  let code = source.slice(0, start) + region.replace(/(?<!>) >> (?!>)/g, ' >>> ') + source.slice(end)
  const atomic = 'PTY_atomicIndex = _malloc(4) >> 2;'
  if (code.split(atomic).length !== 2) throw new Error('Pinned xterm-pty atomic allocation changed')
  code = code.replace(atomic, 'PTY_atomicIndex = _malloc(4) >>> 2;')
  // ErrorEvent stringification loses the original pthread exception at the parent boundary.
  const workerError = 'throw e;\n    };\n    if (ENVIRONMENT_IS_NODE)'
  if (!code.includes(workerError)) throw new Error('Pinned pthread error handler changed')
  code = code.replace(workerError, 'throw new Error(`${message} ${e.filename}:${e.lineno}: ${e.message}`, { cause: e.error });\n    };\n    if (ENVIRONMENT_IS_NODE)')
  code = patchProcFd(code)
  return { code, provenance: { id: 'wasm32-custom-runtime-fixes-v2', libffi: 'adbcf2b247696dde2667ab552cb93e0c79455c84', libffiPointerShifts: matches.length, atomicPointerShifts: 1, procFdSymlink: true, originalSha256: hash(source), patchedSha256: hash(code) } }
}
