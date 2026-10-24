// The workspace files (capabilities `fs.read`, `fs.write`), served by the
// host API (companion/server/host-api.js):
//
//   GET fs/list?path=  GET fs/tree?path=  GET fs/read?path=[&tail=1]  (tail: a file past the read cap from its end)
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
// Loaded projects (2026-10-17 owner: "the project can be outside of our project"; host `mounts.projects`, the desk's
// registry: projects.js): projects/<name>/… is that project's real folder when <name> is loaded — beside the desk's own
// projects/ folders, which stay where they are (projects/ lists both; a loaded name wins). workspaceMounts() is every
// mount point: desks/ (only the mounted desks) and projects/ (an overlay).

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
export const PROJECTS = "projects" // the workspace folder loaded projects appear in, beside the desk's own
const DESK_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

// Short SHA-256 of a file's bytes (same as the app's revisionOf).
const revisionOf = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16)

const readBytes = (path) => Bun.file(path).bytes()
const isDir = (path) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
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

// Every mount point of a workspace, or null: desks/ (virtual: it holds only the mounted desks) and projects/ (an
// overlay: the loaded projects beside the desk's own folders). Each point: {prefix, overlay, what, folder(name) → real |
// null, list() → [{name, real}]}; nameOf(abs) → the workspace path of a real path inside a mounted folder, else null;
// all() → every mounted folder [{prefix, name, real}]; mounted(parts) → the point a workspace path is inside a mounted
// folder of (desks/ alone counts: it is virtual), else null.
export function workspaceMounts(mounts) {
  const points = []
  const desks = deskMounts(mounts)
  if (desks) points.push({ prefix: MOUNT, overlay: false, what: "mounted desk", base: desks.base, folder: desks.folder, list: desks.list })
  const loaded = mounts?.projects
  if (loaded && typeof loaded.folder === "function" && typeof loaded.list === "function") {
    const folder = (name) => {
      try {
        return loaded.folder(name) ?? null
      } catch {
        return null
      }
    }
    const list = () => {
      try {
        return loaded.list().flatMap(({ name }) => {
          const real = folder(name)
          return real ? [{ name, real }] : []
        })
      } catch {
        return []
      }
    }
    points.push({ prefix: PROJECTS, overlay: true, what: "loaded project", folder, list })
  }
  if (!points.length) return null
  const at = (prefix) => points.find((p) => p.prefix === prefix) ?? null
  const all = () => points.flatMap((p) => p.list().map((d) => ({ ...d, prefix: p.prefix })))
  const nameOf = (abs) => {
    for (const d of all()) if (within(d.real, abs)) return [d.prefix, d.name, ...relative(d.real, abs).split(sep)].filter(Boolean).join("/")
    return null
  }
  const mounted = (parts) => {
    const p = at(parts[0])
    if (!p) return null
    if (!p.overlay) return p
    return parts.length > 1 && p.folder(parts[1]) ? p : null
  }
  const names = (p) => p.list().map((d) => d.name).join(", ") || "none"
  return { points, at, all, nameOf, mounted, names }
}

// root: the workspace, already realpath-resolved; mounts: the desk's main.js `mounts` (above) and the host's
// `projects` (the desk's registry of loaded projects).
export function createFiles({ root, readOnly = false, mounts = null }) {
  const mount = workspaceMounts(mounts)
  // ── paths ─────────────────────────────────────────────────────────────

  // A real path as the workspace names it: root-relative, or desks/<name>/… (projects/<name>/…) inside a mounted folder.
  const relPath = (abs) => {
    if (within(root, abs)) return relative(root, abs).split(sep).join("/")
    return mount?.nameOf(abs) ?? abs
  }
  const refused = () => new HttpError(403, "Path is outside the workspace.")
  const pathParts = (rel) => {
    const parts = String(rel ?? "").split(/[\\/]/).filter((p) => p && p !== ".")
    if (parts.includes("..")) throw refused()
    return parts
  }
  const mounted = (parts) => mount?.mounted(parts) ?? null
  // Where a workspace path lives: { base, target, point? } — base: the workspace, or a mounted folder's real folder
  // (point: its mount point); { virtual: true, point } for desks/ itself (the mounted desks, listed), and for projects/
  // when the desk has no folder of its own there (the loaded projects alone).
  function locate(rel) {
    const raw = String(rel ?? "")
    const named = raw.split(/[\\/]/).filter((p) => p && p !== ".")
    const point = mounted(named)
    if (!point) {
      const overlay = mount?.at(named[0])
      const target = resolve(root, `.${sep}${raw}`)
      if (overlay?.overlay && named.length === 1 && !isDir(target)) return { virtual: true, point: overlay }
      return { base: root, target }
    }
    const parts = pathParts(raw)
    if (parts.length === 1) return { virtual: true, point }
    const real = point.folder(parts[1])
    if (!real) throw new HttpError(403, `${point.prefix}/${parts[1]} is not a ${point.what} (${point.prefix}: ${mount.names(point)}).`)
    return { base: real, target: join(real, ...parts.slice(2)), point }
  }

  // Resolve an existing workspace path, refusing anything outside its root (the workspace or a mounted folder).
  async function inRoot(rel = "") {
    const { virtual, base, target, point } = locate(rel)
    if (virtual) return { virtual: true, point }
    let real
    try {
      real = await realpath(target)
    } catch {
      throw new HttpError(404, `Not found: ${rel || "."}`)
    }
    if (!within(base, real)) throw refused()
    return { real, base, point }
  }
  const existing = async (rel) => {
    const at = await inRoot(rel)
    if (at.virtual) throw new HttpError(400, `${at.point.prefix}/ holds the ${at.point.what}s; name one: ${at.point.prefix}/<name>/…`)
    return at.real
  }

  // Where a (possibly new) file may go: its nearest existing ancestor must
  // resolve inside the root, and an existing file must too.
  async function writeTarget(rel) {
    const parts = pathParts(rel)
    if (!parts.length) throw new HttpError(400, "A file path is required.")
    const { virtual, base, target, point } = locate(parts.join("/"))
    if (virtual || (point && parts.length < 3)) {
      const p = point ?? mount.at(parts[0])
      throw new HttpError(400, `A file path inside a ${p.what} is required: ${p.prefix}/<name>/<file>.`)
    }
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
  // A mount point's folders as entries: desks/ (never a real folder of the workspace), the loaded projects in projects/.
  const mountEntries = (point) => point.list().map(({ name, real }) => ({ name, type: "dir", size: 0, mtime: statSync(real).mtimeMs, mount: true }))
  // The overlay point whose folder `dir` is (the workspace's projects/), else null.
  const overlayAt = (dir) => mount?.points.find((p) => p.overlay && dir === join(root, p.prefix)) ?? null

  async function list(rel) {
    const at = await inRoot(rel)
    if (at.virtual) return { path: at.point.prefix, entries: mountEntries(at.point) }
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
    // The workspace root lists desks/ when desks are mounted (what it holds is theirs, not the workspace's), and
    // projects/ when projects are loaded and the desk has none of its own; projects/ lists the loaded ones too.
    if (mount && dir === root) {
      for (const p of mount.points) {
        if (!p.overlay) found = [...found.filter((e) => e.name !== p.prefix), { name: p.prefix, type: "dir", size: 0, mtime: 0, mount: true }]
        else if (!found.some((e) => e.name === p.prefix) && p.list().length) found.push({ name: p.prefix, type: "dir", size: 0, mtime: 0, mount: true })
      }
    }
    const overlay = overlayAt(dir)
    if (overlay) {
      const loaded = mountEntries(overlay)
      found = [...found.filter((e) => !loaded.some((l) => l.name === e.name)), ...loaded]
    }
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
        if (mount && dir === root && mount.points.some((p) => !p.overlay && p.prefix === entry)) continue // the mounted desks stand in for it (below)
        if (overlayAt(dir)?.folder(entry)) continue // a loaded project stands in for it (below)
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
      if (mount && dir === root) {
        for (const p of mount.points) {
          if (!p.overlay) entries.push({ name: p.prefix, type: "dir", mount: true, children: await folders(p) })
          else if (!isDir(join(root, p.prefix)) && p.list().length) entries.push({ name: p.prefix, type: "dir", mount: true, children: await folders(p) })
        }
      }
      const overlay = overlayAt(dir)
      if (overlay) entries.push(...(await folders(overlay)))
      return entries.sort((a, b) => (order[a.type] ?? 4) - (order[b.type] ?? 4) || (a.name ?? "").localeCompare(b.name ?? ""))
    }
    async function folders(point) {
      const out = []
      for (const { name, real } of point.list()) {
        budget--
        out.push({ name, type: "dir", mount: true, children: await walk(real) })
      }
      return out
    }
    if (at.virtual) return { path: at.point.prefix, entries: await folders(at.point) }
    return { path: relPath(at.real), entries: await walk(at.real) }
  }

  // tail (2026-10-17, a live metrics.jsonl past the read cap froze its chart): a file larger than MAX_READ is read from
  // its end — its last MAX_READ bytes, the partial first line dropped — with `head` (the file's first line: a TSV/CSV
  // header), `from` (the byte the text starts at) and `tail: true`; revision null (the whole file is not hashed).
  async function read(rel, { tail = false } = {}) {
    const path = await existing(rel)
    const info = await stat(path)
    if (!info.isFile()) throw new HttpError(400, "Not a file.")
    if (tail && info.size > MAX_READ) {
      const file = Bun.file(path)
      const sniff = new Uint8Array(await file.slice(0, HOST_LIMITS.files.binarySniffBytes).arrayBuffer())
      if (sniff.includes(0)) return { path: relPath(path), size: info.size, binary: true, truncated: true, tail: true, text: null, revision: null }
      // one byte before the cut too: when it is "\n" the cut falls on a line's start and that first line is whole
      const start = info.size - MAX_READ
      const bytes = new Uint8Array(await file.slice(start - 1, info.size).arrayBuffer())
      const nl = bytes.indexOf(10)
      const from = nl < 0 ? start : start + nl
      const first = new Uint8Array(await file.slice(0, Math.min(info.size, 64 * 1024)).arrayBuffer())
      const end = first.indexOf(10)
      const decode = (b) => new TextDecoder().decode(b)
      return {
        path: relPath(path),
        size: info.size,
        binary: false,
        truncated: true,
        tail: true,
        from,
        head: decode(first.subarray(0, end < 0 ? first.length : end)).replace(/\r$/, ""),
        text: decode(nl < 0 ? bytes.subarray(1) : bytes.subarray(nl + 1)),
        revision: null,
      }
    }
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
    const point = mounted(parts)
    if (point && parts.length < 3) throw new HttpError(403, `A ${point.what} (or ${point.prefix}/ itself) is not deleted through the workspace.`)
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
    const folders = at.virtual
      ? at.point.list().map((d) => d.real)
      : [at.real, ...(mount && at.real === root ? mount.all().map((d) => d.real) : []), ...(overlayAt(at.real)?.list().map((d) => d.real) ?? [])]
    const shown = at.virtual ? at.point.prefix : relPath(at.real)
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
      "fs/read": (params) => read(params.get("path") ?? "", { tail: params.get("tail") === "1" }),
      "fs/tree": (params) => tree(params.get("path") ?? ""),
    },
    POST: readOnly ? {} : { "fs/write": write, "fs/delete": remove },
    watch: (params, request) => watch(params.get("path") ?? "", request),
    // an existing workspace file's real path, contained (audio/transcribe reads a recording the desk has)
    realPath: existing,
    close,
  }
}
