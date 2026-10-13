// The workspace files (capabilities `fs.read`, `fs.write`), served by the
// host API (companion/server/host-api.js):
//
//   GET fs/list?path=  GET fs/tree?path=  GET fs/read?path=
//   POST fs/write { path, text, revision? }   POST fs/delete { path, recursive?, revision? }
//
// Every path is resolved through realpath and must stay inside the root (no
// symlink escapes, also for new files); .env* (but .env.example) and
// .mcp.json are never written or deleted; writes are revision-checked,
// atomic (temp file + rename) and serialized per path.

import { createHash } from "node:crypto"
import { lstat, mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { HttpError } from "../shared/http.js"
import { within } from "../shared/paths.js"
import { HOST_LIMITS } from "../shared/config.js"

const MAX_READ = HOST_LIMITS.files.readBytes // bytes returned by fs/read
const MAX_TREE = HOST_LIMITS.files.treeEntries // entries returned by fs/tree
// ASKK's own configuration: never written or deleted through the API.
export const PROTECTED = (name) => name === ".mcp.json" || (/^\.env(\..+)?$/.test(name) && name !== ".env.example")
// Folders listed but never expanded in a tree (same list as backend/features/filesystem/workspace.js).
const TREE_SKIP = new Set([".git", "node_modules", ".next", "out", "dist", "build", ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv", ".DS_Store"])

// Short SHA-256 of a file's bytes (same as the app's revisionOf).
const revisionOf = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16)

const readBytes = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer())

// root: the workspace, already realpath-resolved.
export function createFiles({ root, readOnly = false }) {
  // ── paths ─────────────────────────────────────────────────────────────

  const relPath = (abs) => relative(root, abs).split(sep).join("/")
  const inside = (abs) => within(root, abs)

  // Resolve an existing root-relative path, refusing anything outside the root.
  async function inRoot(rel = "") {
    const target = resolve(root, `.${sep}${rel}`)
    let real
    try {
      real = await realpath(target)
    } catch {
      throw new HttpError(404, `Not found: ${rel || "."}`)
    }
    if (!inside(real)) throw new HttpError(403, "Path is outside the workspace.")
    return real
  }

  const pathParts = (rel) => {
    const parts = String(rel ?? "").split(/[\\/]/).filter((p) => p && p !== ".")
    if (parts.includes("..")) throw new HttpError(403, "Path is outside the workspace.")
    return parts
  }

  // Where a (possibly new) file may go: its nearest existing ancestor must
  // resolve inside the root, and an existing file must too.
  async function writeTarget(rel) {
    const parts = pathParts(rel)
    if (!parts.length) throw new HttpError(400, "A file path is required.")
    const target = join(root, ...parts)
    let ancestor = dirname(target)
    while (true) {
      try {
        if (!inside(await realpath(ancestor))) throw new HttpError(403, "Path is outside the workspace.")
        break
      } catch (error) {
        if (error instanceof HttpError) throw error
        ancestor = dirname(ancestor) // not there yet; check its parent
      }
    }
    try {
      const real = await realpath(target)
      if (!inside(real)) throw new HttpError(403, "Path is outside the workspace.")
      if (!(await stat(real)).isFile()) throw new HttpError(400, "Not a file.")
      return real
    } catch (error) {
      if (error instanceof HttpError) throw error
      return target
    }
  }

  // Changes to one path run one after another.
  const queues = new Map()
  async function serialize(path, task) {
    const run = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(task)
    queues.set(path, run)
    try {
      return await run
    } finally {
      if (queues.get(path) === run) queues.delete(path)
    }
  }

  // ── fs ────────────────────────────────────────────────────────────────

  async function list(rel) {
    const dir = await inRoot(rel)
    if (!(await stat(dir)).isDirectory()) throw new HttpError(400, "Not a folder.")
    const names = await readdir(dir)
    const entries = await Promise.all(
      names.map(async (entry) => {
        try {
          const info = await lstat(join(dir, entry))
          const type = info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : info.isFile() ? "file" : "other"
          return { name: entry, type, size: info.size, mtime: info.mtimeMs }
        } catch {
          return null // vanished or unreadable
        }
      })
    )
    const order = { dir: 0, link: 1, file: 2, other: 3 }
    return {
      path: relPath(dir),
      entries: entries.filter(Boolean).sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name)),
    }
  }

  async function tree(rel) {
    const top = await inRoot(rel)
    if (!(await stat(top)).isDirectory()) throw new HttpError(400, "Not a folder.")
    let budget = MAX_TREE
    const order = { dir: 0, link: 1, file: 2, other: 3 }
    async function walk(dir) {
      const names = (await readdir(dir).catch(() => [])).sort()
      const entries = []
      for (const [i, entry] of names.entries()) {
        if (budget <= 0) {
          entries.push({ name: null, type: "omitted", omitted: names.length - i })
          break
        }
        budget--
        let info
        try {
          info = await lstat(join(dir, entry))
        } catch {
          continue
        }
        const type = info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : info.isFile() ? "file" : "other"
        if (type !== "dir") entries.push({ name: entry, type })
        else if (TREE_SKIP.has(entry)) entries.push({ name: entry, type, skipped: true })
        else entries.push({ name: entry, type, children: await walk(join(dir, entry)) })
      }
      return entries.sort((a, b) => (order[a.type] ?? 4) - (order[b.type] ?? 4) || (a.name ?? "").localeCompare(b.name ?? ""))
    }
    return { path: relPath(top), entries: await walk(top) }
  }

  async function read(rel) {
    const path = await inRoot(rel)
    const info = await stat(path)
    if (!info.isFile()) throw new HttpError(400, "Not a file.")
    const all = await readBytes(path)
    const bytes = all.subarray(0, MAX_READ)
    const binary = bytes.subarray(0, HOST_LIMITS.files.binarySniffBytes).includes(0)
    return {
      path: relPath(path),
      size: info.size,
      binary,
      truncated: info.size > MAX_READ,
      text: binary ? null : new TextDecoder().decode(bytes),
      revision: revisionOf(all),
    }
  }

  async function write({ path: rel, text, revision }) {
    if (typeof text !== "string") throw new HttpError(400, "text must be a string.")
    const path = await writeTarget(rel)
    if (PROTECTED(basename(path))) throw new HttpError(403, `${basename(path)} is ASKK's configuration; only the owner edits it.`)
    return serialize(path, async () => {
      const existing = await Bun.file(path).exists()
      const current = existing ? revisionOf(await readBytes(path)) : null
      if (revision !== undefined && revision !== current) {
        throw new HttpError(409, current ? `${relPath(path)} changed since it was read.` : `${relPath(path)} no longer exists.`)
      }
      await mkdir(dirname(path), { recursive: true })
      const temp = join(dirname(path), `.${basename(path)}.askk-${process.pid}-${Date.now()}`)
      const bytes = new TextEncoder().encode(text)
      try {
        await writeFile(temp, bytes)
        await rename(temp, path)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
      return { path: relPath(path), size: bytes.length, revision: revisionOf(bytes), created: !existing }
    })
  }

  // The parent must resolve inside the root; the entry itself is not
  // followed, so a link is unlinked, not its target.
  async function remove({ path: rel, recursive = false, revision }) {
    const parts = pathParts(rel)
    if (!parts.length) throw new HttpError(400, "The workspace root cannot be deleted.")
    const parent = await inRoot(parts.slice(0, -1).join("/"))
    const target = join(parent, parts.at(-1))
    if (PROTECTED(parts.at(-1))) throw new HttpError(403, `${parts.at(-1)} is ASKK's configuration; only the owner edits it.`)
    let info
    try {
      info = await lstat(target)
    } catch {
      throw new HttpError(404, `Not found: ${parts.join("/")}`)
    }
    const type = info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : info.isFile() ? "file" : "other"
    if (type === "dir" && !recursive && (await readdir(target)).length) {
      throw new HttpError(400, `${relPath(target)} is not empty; pass recursive: true to delete it with its contents.`)
    }
    return serialize(target, async () => {
      if (type === "file" && revision !== undefined && revision !== revisionOf(await readBytes(target))) {
        throw new HttpError(409, `${relPath(target)} changed since it was read.`)
      }
      await rm(target, { recursive: type === "dir" })
      return { path: relPath(target), type }
    })
  }

  return {
    GET: {
      "fs/list": (params) => list(params.get("path") ?? ""),
      "fs/read": (params) => read(params.get("path") ?? ""),
      "fs/tree": (params) => tree(params.get("path") ?? ""),
    },
    POST: readOnly ? {} : { "fs/write": write, "fs/delete": remove },
  }
}
