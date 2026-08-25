/**
 * `WorkspacePort` OVER OPFS — and the first time in this product's life that
 * `durable()` answers `true`.
 *
 * The predecessor shipped 47 MB of emulated Linux to serve four file
 * operations, mounted its root on tmpfs, and lost every file on refresh while
 * telling nobody: `durable()` returned `false` and the pane said nothing about
 * it. The Origin Private File System is the browser's own answer to the same
 * four operations, it is real storage, and a file written here is still here
 * after a reload.
 *
 * THERE IS NO SHELL, AND THIS PORT SAYS SO. `exec` refuses by name rather than
 * returning an empty execution, because a model plans from silence: a command
 * that appears to run and prints nothing is read as a command that succeeded.
 * @module
 */

import { WorkspaceError } from '@harness/kernel'

/** @typedef {import('@harness/kernel').WorkspacePort} WorkspacePort */

/** Where this agent's files live, under the origin's private root. */
const ROOT = 'workspace'

/**
 * The workspace this browser can actually offer, or null where the browser has
 * no OPFS. Null and not a port that fails on first use: the composition root
 * decides what to grant from what came back, and a capability nobody can serve
 * must not be advertised (I6, I15).
 * @returns {Promise<WorkspacePort|null>}
 */
export async function openWorkspace() {
  const nav = /** @type {{navigator?: {storage?: {getDirectory?: () => Promise<FileSystemDirectoryHandle>}}}} */ (globalThis).navigator
  const storage = nav?.storage
  if (typeof storage?.getDirectory !== 'function') return null
  const origin = await storage.getDirectory()
  const root = await origin.getDirectoryHandle(ROOT, { create: true })
  return opfsWorkspace(root)
}

/** @param {FileSystemDirectoryHandle} root @returns {WorkspacePort} */
export function opfsWorkspace(root) {
  return {
    // The one fact this port exists to change, and the one the empty-folder
    // note is decided by: a file written here survives the reload.
    durable: () => true,
    interrupt: () => 'There is nothing running to interrupt: this workspace stores files and runs no commands.',
    async exec(command) {
      throw new WorkspaceError('unavailable', 'This build has nowhere to run a command.', {
        detail: `it stores files in the browser and has no shell, so \`${command.split('\n')[0]}\` was not run`,
      })
    },
    read: (path, opts = {}) => readFile(root, path, opts),
    write: (path, text) => writeFile(root, path, text),
    list: (path) => listDir(root, path),
  }
}

/** @param {FileSystemDirectoryHandle} root @param {string} path @param {{offset?: number, limit?: number}} opts */
async function readFile(root, path, opts) {
  const file = await (await handleFor(root, path)).getFile()
  const lines = (await file.text()).split('\n')
  const from = opts.offset ?? 0
  const slice = lines.slice(from, from + (opts.limit ?? lines.length))
  return { text: slice.join('\n'), truncated: from + slice.length < lines.length, lines: lines.length }
}

/** @param {FileSystemDirectoryHandle} root @param {string} path @param {string} text */
async function writeFile(root, path, text) {
  const parts = split(path)
  const name = parts.pop()
  if (name === undefined) throw notAFile(path)
  const dir = await walk(root, parts, true)
  const handle = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await handle.write(text)
  await handle.close()
}

/** @param {FileSystemDirectoryHandle} root @param {string} path */
async function listDir(root, path) {
  const dir = await walk(root, split(path), false)
  /** @type {Array<{name: string, dir: boolean, size: number}>} */
  const entries = []
  for await (const [name, handle] of iterate(dir)) {
    const isDir = handle.kind === 'directory'
    const size = isDir ? 0 : (await (/** @type {FileSystemFileHandle} */ (handle)).getFile()).size
    entries.push({ name, dir: isDir, size })
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

/** `.` and `./x` and `/x` all mean the same place; empty segments are noise, not folders. */
function split(/** @type {string} */ path) {
  return path.split('/').filter((part) => part !== '' && part !== '.')
}

/**
 * @param {FileSystemDirectoryHandle} dir @param {string[]} parts @param {boolean} create
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function walk(dir, parts, create) {
  let at = dir
  for (const part of parts) {
    try {
      at = await at.getDirectoryHandle(part, { create })
    } catch (cause) {
      throw new WorkspaceError('not_found', `There is no folder called ${part} here.`, { cause, detail: parts.join('/') })
    }
  }
  return at
}

/** @param {FileSystemDirectoryHandle} root @param {string} path @returns {Promise<FileSystemFileHandle>} */
async function handleFor(root, path) {
  const parts = split(path)
  const name = parts.pop()
  if (name === undefined) throw notAFile(path)
  const dir = await walk(root, parts, false)
  try {
    return await dir.getFileHandle(name, { create: false })
  } catch (cause) {
    throw new WorkspaceError('not_found', `There is no file at ${path}.`, { cause })
  }
}

function notAFile(/** @type {string} */ path) {
  return new WorkspaceError('not_found', `${path || '.'} names a folder, not a file.`, {
    detail: 'a path with no last segment cannot be read or written',
  })
}

/**
 * The directory's entries. `entries()` is the standard iterator and Safari
 * shipped only the async-iterable protocol on the handle itself, so both are
 * accepted — a listing that works in one browser and not the other is not a
 * listing.
 * @param {FileSystemDirectoryHandle} dir
 * @returns {AsyncIterable<[string, FileSystemHandle]>}
 */
function iterate(dir) {
  const held = /** @type {{entries?: () => AsyncIterable<[string, FileSystemHandle]>}} */ (/** @type {unknown} */ (dir))
  if (typeof held.entries === 'function') return held.entries()
  return /** @type {AsyncIterable<[string, FileSystemHandle]>} */ (/** @type {unknown} */ (dir))
}
