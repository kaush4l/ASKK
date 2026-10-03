// The ASKK host API: the capabilities a browser lacks, served same-origin
// under /__askk/. Used by the dev server (scripts/dev.js, the default way to
// run ASKK) and by the compiled companion (companion/server.js).
//
//   const api = await createHostApi({ root, readOnly, port, name })
//   api.handle(request)   Fetch Request -> Response (for /__askk/* only)
//
// Endpoints:
//   GET whoami                 { name, version, root, capabilities, platform }
//   GET fs/list?path=<rel>     { path, entries: [{ name, type, size, mtime }] }
//   GET fs/read?path=<rel>     { path, size, binary, truncated, text, revision }
//   GET fs/tree?path=<rel>     { path, entries: [{ name, type, children?, skipped?, omitted? }] }
//        Names only, every level. Heavy folders (TREE_SKIP) are listed but
//        not expanded (skipped: true); past MAX_TREE entries the rest of a
//        folder is counted (omitted: n) instead of listed.
//   POST fs/write { path, text, revision? }   { path, size, revision, created }
//        revision: the one read (409 if the file changed since); null = must
//        be a new file; omitted = write regardless. Parents are created; the
//        file is replaced atomically (temp file + rename).
//   POST fs/delete { path, recursive?, revision? }   { path, type }
//        A file, link, or empty folder; a folder with contents needs
//        recursive: true. A link is removed, never what it points to.
//        revision (files): 409 if the file changed since it was read.
//
// Capabilities: fs.read and fs.write (write + delete) on `root`; readOnly
// drops fs.write. The app asks the owner before an agent changes anything.
//
// Security: the Host header must name this machine's loopback address and
// port (blocks DNS rebinding and other machines on the network); a
// cross-origin Origin is refused and no CORS headers are sent; POST needs a
// same-origin Origin and a JSON body; every path is resolved through realpath
// and must stay inside the root (symlinks out of it are refused).

import { createHash } from "node:crypto"
import { lstat, mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

export const VERSION = "0.1.0"
export const API_PREFIX = "/__askk/"
const MAX_READ = 1024 * 1024 // bytes returned by fs/read
const MAX_WRITE = 8 * 1024 * 1024 // bytes accepted by fs/write
const MAX_TREE = 3000 // entries returned by fs/tree
// Folders listed but never expanded in a tree (same list as backend/features/filesystem/workspace.js).
const TREE_SKIP = new Set([".git", "node_modules", ".next", "out", "dist", "build", ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv", ".DS_Store"])

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

// Short SHA-256 of a file's bytes (same as the app's revisionOf).
const revisionOf = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16)

const readBytes = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer())

export async function createHostApi({ root: rootArg, readOnly = false, port, name = "askk-companion" }) {
  const root = await realpath(resolve(rootArg))
  const capabilities = readOnly ? ["fs.read"] : ["fs.read", "fs.write"]
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])

  // ── paths ─────────────────────────────────────────────────────────────

  const relPath = (abs) => relative(root, abs).split(sep).join("/")
  const inside = (abs) => abs === root || abs.startsWith(root + sep)

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
    const binary = bytes.subarray(0, 8000).includes(0)
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

  const GET = {
    whoami: () => ({ name, version: VERSION, root, capabilities, platform: process.platform }),
    "fs/list": (params) => list(params.get("path") ?? ""),
    "fs/read": (params) => read(params.get("path") ?? ""),
    "fs/tree": (params) => tree(params.get("path") ?? ""),
  }
  const POST = readOnly ? {} : { "fs/write": write, "fs/delete": remove }

  // ── requests ──────────────────────────────────────────────────────────

  async function handle(request) {
    const url = new URL(request.url)
    // DNS-rebinding guard: only requests addressed to this machine's loopback.
    if (!allowedHosts.has(request.headers.get("host"))) return json(421, { error: "Host capabilities answer on localhost only." })

    // Same origin only: browsers send Origin on cross-origin requests (and
    // on every POST, which must carry it).
    const origin = request.headers.get("origin")
    const sameOrigin = !!origin && allowedHosts.has(origin.replace(/^http:\/\//, ""))
    if (origin && !sameOrigin) return json(403, { error: "Cross-origin request refused." })

    const endpoint = url.pathname.slice(API_PREFIX.length)
    try {
      if (request.method === "GET") {
        const handler = GET[endpoint]
        if (!handler) return json(404, { error: "Unknown endpoint." })
        return json(200, await handler(url.searchParams))
      }
      if (request.method === "POST") {
        const handler = POST[endpoint]
        if (!handler) return json(404, { error: GET[endpoint] ? "Method not allowed." : "Unknown or disabled endpoint." })
        if (!sameOrigin) return json(403, { error: "Writes need a same-origin request." })
        if (!request.headers.get("content-type")?.startsWith("application/json")) return json(415, { error: "Send JSON." })
        if (Number(request.headers.get("content-length") ?? 0) > MAX_WRITE * 2) return json(413, { error: "Too large." })
        const body = await request.json().catch(() => null)
        if (!body) return json(400, { error: "Invalid JSON body." })
        if (typeof body.text === "string" && body.text.length > MAX_WRITE) return json(413, { error: "File too large (8 MB max)." })
        return json(200, await handler(body))
      }
      return json(405, { error: "Method not allowed." })
    } catch (error) {
      return json(error.status ?? 500, { error: error.message })
    }
  }

  return { root, capabilities, handle }
}
