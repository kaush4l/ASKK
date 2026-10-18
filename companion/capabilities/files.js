// The workspace files (capabilities `fs.read`, `fs.write`), served by the
// host API (companion/server/host-api.js):
//
//   GET fs/list?path=  GET fs/tree?path=  GET fs/read?path=
//   POST fs/write { path, text, revision? }   POST fs/delete { path, recursive?, revision? }
//   GET fs/watch?path=   Server-Sent Events: ready { path }, then change { paths } (debounced, workspace paths)
//
// Every path is resolved through realpath and must stay inside the root (no
// symlink escapes, also for new files); .env* (but .env.example) and
// .mcp.json are never written or deleted; writes are revision-checked,
// atomic (temp file + rename) and serialized per path.
//
// Mounts (2026-10-17, a desk's main.js `mounts: { desks: { root, allow(name) } }`): the workspace path
// desks/<name>/… is <root>/<name>/… when allow(name) — a desk's projects, worked on like its own files.
// Any other desks/<name> is refused; a mounted folder is its own real folder (a link is refused) and its paths stay
// inside it, like the workspace's. The terminal (terminal.js) resolves cwd and lanes the same way (deskMounts).

import { realpathSync, statSync, readdirSync, watch as watchFs } from "node:fs"
import { lstat, mkdir, readdir, realpath, rename, rm } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { HttpError } from "../shared/http.js"
import { within } from "../shared/paths.js"
import { HOST_LIMITS, SSE_PING_MS } from "../shared/config.js"

const MAX_READ = HOST_LIMITS.files.readBytes // bytes returned by fs/read
const MAX_TREE = HOST_LIMITS.files.treeEntries // entries returned by fs/tree
// ASKK's own configuration: never written or deleted through the API.
export const PROTECTED = (name) => name === ".mcp.json" || (/^\.env(\..+)?$/.test(name) && name !== ".env.example")
// Folders listed but never expanded in a tree.
const TREE_SKIP = new Set([".git", "node_modules", ".next", "out", "dist", "build", ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv", ".DS_Store"])
// Changes inside these are never reported by fs/watch (a build or an install would flood every tab).
const WATCH_SKIP = new Set([".git", "node_modules", ".venv", "__pycache__", ".cache"])
export const MOUNT = "desks" // the workspace folder mounted desks appear under
const DESK_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

// Short SHA-256 of a file's bytes (same as the app's revisionOf).
const revisionOf = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16)

const readBytes = (path) => Bun.file(path).bytes()
const stat = (path) => Bun.file(path).stat()

// A desk's mounts (main.js `mounts.desks`), or null: folder(name) → the real folder of desks/<name> (null when not
// allowed, missing, not a folder, or a link); list() → [{ name, real }] every mounted desk now.
export function deskMounts(mounts) {
  const spec = mounts?.desks
  if (!spec?.root) return null
  let base
  try {
    base = realpathSync(resolve(spec.root))
  } catch {
    return null
  }
  const allow = (name) => {
    try {
      return typeof spec.allow === "function" ? !!spec.allow(name) : false
    } catch {
      return false
    }
  }
  const folder = (name) => {
    if (typeof name !== "string" || !DESK_NAME.test(name) || !allow(name)) return null
    const path = join(base, name)
    try {
      return realpathSync(path) === path && statSync(path).isDirectory() ? path : null
    } catch {
      return null
    }
  }
  const list = () => {
    let names = []
    try {
      names = readdirSync(base).sort()
    } catch {}
    return names.flatMap((name) => {
      const real = folder(name)
      return real ? [{ name, real }] : []
    })
  }
  return { base, folder, list }
}

// root: the workspace, already realpath-resolved; mounts: the desk's main.js `mounts` (above).
export function createFiles({ root, readOnly = false, mounts = null }) {
  const mount = deskMounts(mounts)
  // ── paths ─────────────────────────────────────────────────────────────

  // A real path as the workspace names it: root-relative, or desks/<name>/… inside a mounted desk.
  const relPath = (abs) => {
    if (within(root, abs)) return relative(root, abs).split(sep).join("/")
    if (mount && within(mount.base, abs)) {
      const [name, ...rest] = relative(mount.base, abs).split(sep)
      if (mount.folder(name)) return [MOUNT, name, ...rest].filter(Boolean).join("/")
    }
    return abs
  }
  const refused = () => new HttpError(403, "Path is outside the workspace.")
  const pathParts = (rel) => {
    const parts = String(rel ?? "").split(/[\\/]/).filter((p) => p && p !== ".")
    if (parts.includes("..")) throw refused()
    return parts
  }
  const mounted = (parts) => !!mount && parts[0] === MOUNT
  // Where a workspace path lives: { base, target } — base: the workspace, or a mounted desk's real folder;
  // { virtual: true } for desks/ itself (the mounted desks, listed).
  function locate(rel) {
    const raw = String(rel ?? "")
    const named = raw.split(/[\\/]/).filter((p) => p && p !== ".")
    if (!mounted(named)) return { base: root, target: resolve(root, `.${sep}${raw}`) }
    const parts = pathParts(raw)
    if (parts.length === 1) return { virtual: true }
    const real = mount.folder(parts[1])
    if (!real) throw new HttpError(403, `${MOUNT}/${parts[1]} is not a mounted desk (mounted: ${mount.list().map((d) => d.name).join(", ") || "none"}).`)
    return { base: real, target: join(real, ...parts.slice(2)) }
  }

  // Resolve an existing workspace path, refusing anything outside its root (the workspace or a mounted desk).
  async function inRoot(rel = "") {
    const { virtual, base, target } = locate(rel)
    if (virtual) return { virtual: true }
    let real
    try {
      real = await realpath(target)
    } catch {
      throw new HttpError(404, `Not found: ${rel || "."}`)
    }
    if (!within(base, real)) throw refused()
    return { real, base }
  }
  const existing = async (rel) => {
    const at = await inRoot(rel)
    if (at.virtual) throw new HttpError(400, `${MOUNT}/ holds the mounted desks; name one: ${MOUNT}/<name>/…`)
    return at.real
  }

  // Where a (possibly new) file may go: its nearest existing ancestor must
  // resolve inside the root, and an existing file must too.
  async function writeTarget(rel) {
    const parts = pathParts(rel)
    if (!parts.length) throw new HttpError(400, "A file path is required.")
    const { virtual, base, target } = locate(parts.join("/"))
    if (virtual || (mounted(parts) && parts.length < 3)) throw new HttpError(400, `A file path inside a mounted desk is required: ${MOUNT}/<name>/<file>.`)
    let ancestor = dirname(target)
    while (true) {
      try {
        if (!within(base, await realpath(ancestor))) throw refused()
        break
      } catch (error) {
        if (error instanceof HttpError) throw error
        ancestor = dirname(ancestor) // not there yet; check its parent
      }
    }
    try {
      const real = await realpath(target)
      if (!within(base, real)) throw refused()
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

  const order = { dir: 0, link: 1, file: 2, other: 3 }
  // desks/ as a folder: the mounted desks, never a real folder of the workspace.
  const mountEntries = () => mount.list().map(({ name, real }) => ({ name, type: "dir", size: 0, mtime: statSync(real).mtimeMs, mount: true }))

  async function list(rel) {
    const at = await inRoot(rel)
    if (at.virtual) return { path: MOUNT, entries: mountEntries() }
    const dir = at.real
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
    let found = entries.filter(Boolean)
    // The workspace root lists desks/ when desks are mounted (what it holds is theirs, not the workspace's).
    if (mount && dir === root) found = [...found.filter((e) => e.name !== MOUNT), { name: MOUNT, type: "dir", size: 0, mtime: 0, mount: true }]
    return { path: relPath(dir), entries: found.sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name)) }
  }

  async function tree(rel) {
    const at = await inRoot(rel)
    if (!at.virtual && !(await stat(at.real)).isDirectory()) throw new HttpError(400, "Not a folder.")
    let budget = MAX_TREE
    async function walk(dir) {
      const names = (await readdir(dir).catch(() => [])).sort()
      const entries = []
      for (const [i, entry] of names.entries()) {
        if (budget <= 0) {
          entries.push({ name: null, type: "omitted", omitted: names.length - i })
          break
        }
        if (mount && dir === root && entry === MOUNT) continue // the mounted desks stand in for it (below)
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
      if (mount && dir === root) entries.push({ name: MOUNT, type: "dir", mount: true, children: await desks() })
      return entries.sort((a, b) => (order[a.type] ?? 4) - (order[b.type] ?? 4) || (a.name ?? "").localeCompare(b.name ?? ""))
    }
    async function desks() {
      const out = []
      for (const { name, real } of mount.list()) {
        budget--
        out.push({ name, type: "dir", mount: true, children: await walk(real) })
      }
      return out
    }
    if (at.virtual) return { path: MOUNT, entries: await desks() }
    return { path: relPath(at.real), entries: await walk(at.real) }
  }

  async function read(rel) {
    const path = await existing(rel)
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
        await Bun.write(temp, bytes)
        await rename(temp, path)
      } catch (error) {
        await Bun.file(temp).delete().catch(() => {})
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
    if (mounted(parts) && parts.length < 3) throw new HttpError(403, "A mounted desk (or desks/ itself) is not deleted through the workspace.")
    const parent = await existing(parts.slice(0, -1).join("/"))
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

  // ── fs/watch ──────────────────────────────────────────────────────────

  // 2026-10-17: the Live workbench's Files tree refreshes on these, not on a poll. One recursive fs.watch per folder
  // (the workspace root also watches every mounted desk); changes are gathered for WATCH_DEBOUNCE_MS, then sent as
  // one event of workspace paths. At most HOST_LIMITS.files.watchers streams per desk; close() ends them all.
  const streams = new Set() // { end }
  async function watch(rel, request) {
    if (streams.size >= HOST_LIMITS.files.watchers) throw new HttpError(429, `${HOST_LIMITS.files.watchers} file watches are open on this desk already.`)
    const at = await inRoot(rel)
    if (!at.virtual && !(await stat(at.real)).isDirectory()) throw new HttpError(400, "Not a folder.")
    const folders = at.virtual ? mount.list().map((d) => d.real) : [at.real, ...(mount && at.real === root ? mount.list().map((d) => d.real) : [])]
    const shown = at.virtual ? MOUNT : relPath(at.real)
    const encoder = new TextEncoder()
    let controller = null
    let timer = null
    let ping = null
    const pending = new Set()
    const watchers = []
    const send = (event) => {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      } catch {
        end()
      }
    }
    const flush = () => {
      timer = null
      if (!pending.size) return
      const paths = [...pending].sort()
      pending.clear()
      const max = HOST_LIMITS.files.watchPaths
      send({ type: "change", paths: paths.slice(0, max), ...(paths.length > max ? { more: paths.length - max } : {}) })
    }
    const entry = { end }
    function end() {
      if (!streams.delete(entry)) return
      clearTimeout(timer)
      clearInterval(ping)
      for (const w of watchers) w.close()
      try {
        controller?.close()
      } catch {}
    }
    for (const folder of folders) {
      try {
        const w = watchFs(folder, { recursive: true }, (_event, name) => {
          if (!name) return
          const parts = String(name).split(sep)
          if (parts.some((p) => WATCH_SKIP.has(p))) return
          pending.add(relPath(join(folder, String(name))))
          timer ??= setTimeout(flush, HOST_LIMITS.files.watchDebounceMs)
        })
        w.on?.("error", () => {})
        watchers.push(w)
      } catch {} // a folder that vanished: the others are still watched
    }
    streams.add(entry)
    const body = new ReadableStream({
      start(c) {
        controller = c
        send({ type: "ready", path: shown })
        ping = setInterval(() => {
          try {
            c.enqueue(encoder.encode(": ping\n\n"))
          } catch {
            end()
          }
        }, SSE_PING_MS)
        request?.signal?.addEventListener("abort", end, { once: true })
      },
      cancel: end,
    })
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } })
  }
  const close = () => {
    for (const s of [...streams]) s.end()
  }

  return {
    GET: {
      "fs/list": (params) => list(params.get("path") ?? ""),
      "fs/read": (params) => read(params.get("path") ?? ""),
      "fs/tree": (params) => tree(params.get("path") ?? ""),
    },
    POST: readOnly ? {} : { "fs/write": write, "fs/delete": remove },
    watch: (params, request) => watch(params.get("path") ?? "", request),
    close,
  }
}
