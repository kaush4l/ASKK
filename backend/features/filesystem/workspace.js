// The workspace: the files agents (fs.* tools) and the Files page work on.
// One contract, two backends, chosen by where the app runs (platform/host.js):
//
//   browser  the OPFS folder `workspace/` — static build, any browser
//   host     the folder the ASKK companion runs in (local mode), on disk
//
//   const ws = await workspace()
//   ws.kind, ws.label, ws.writable
//   await ws.list(path)                 { path, entries: [{ name, type, size, mtime }] }
//   await ws.read(path)                 { path, size, binary, truncated, text, revision }
//   await ws.tree(path)                 { path, entries: [{ name, type, children?, skipped?, omitted? }] }
//   await ws.write(path, text, { revision })   { path, size, revision, created }
//   await ws.remove(path, { recursive, revision })   { path, type }
//
// Paths are workspace-relative ("src/app.js", "" = root); ".." is refused.
// `revision` is a content hash: a write that passes the revision it read is
// refused if the file changed since; pass null to require a new file.
// Works on the main thread and in engine workers.

import { withBase } from "@/backend/platform/base-path"
import { detectHost, hasCapability } from "@/backend/platform/host"
import { listDir, makeDir, readBlob, removeEntry, writeFile } from "@/backend/platform/storage"

export const MAX_READ = 1024 * 1024
export const MAX_TREE = 3000 // entries in a tree
// Folders listed but never expanded in a tree (same list as host-api.js).
export const TREE_SKIP = new Set([".git", "node_modules", ".next", "out", "dist", "build", ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv", ".DS_Store"])

// "a//b/./c" -> "a/b/c"; throws on "..".
export function normalizePath(path = "") {
  const parts = String(path).replace(/\\/g, "/").split("/").filter((p) => p && p !== ".")
  if (parts.includes("..")) throw new Error(`Path "${path}" leaves the workspace.`)
  return parts.join("/")
}

// Short SHA-256 of the bytes (same as the companion's).
export async function revisionOf(bytes) {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export class ConflictError extends Error {
  name = "ConflictError"
}

// ── browser backend (OPFS) ────────────────────────────────────────────────

const BASE = "workspace"
const sortEntries = (entries) => {
  const order = { dir: 0, link: 1, file: 2, other: 3 }
  return entries.sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name))
}

const browserWorkspace = {
  kind: "browser",
  label: "Browser workspace",
  writable: true,

  async list(path = "") {
    path = normalizePath(path)
    const entries = await listDir(`${BASE}/${path}`)
    if (!entries) {
      if (path) throw new Error(`Not found: ${path}`)
      await makeDir(BASE)
      return { path, entries: [] }
    }
    return { path, entries: sortEntries(entries) }
  },

  async tree(path = "") {
    path = normalizePath(path)
    let budget = MAX_TREE
    async function walk(dir) {
      const listed = sortEntries((await listDir(`${BASE}/${dir}`)) ?? [])
      const entries = []
      for (const [i, entry] of listed.entries()) {
        if (budget-- <= 0) {
          entries.push({ name: null, type: "omitted", omitted: listed.length - i })
          break
        }
        if (entry.type !== "dir") entries.push({ name: entry.name, type: entry.type })
        else if (TREE_SKIP.has(entry.name)) entries.push({ name: entry.name, type: "dir", skipped: true })
        else entries.push({ name: entry.name, type: "dir", children: await walk(dir ? `${dir}/${entry.name}` : entry.name) })
      }
      return entries
    }
    if (!(await listDir(`${BASE}/${path}`))) {
      if (path) throw new Error(`Not found: ${path}`)
      await makeDir(BASE)
    }
    return { path, entries: await walk(path) }
  },

  async read(path) {
    path = normalizePath(path)
    const file = path && (await readBlob(`${BASE}/${path}`))
    if (!file) throw new Error(`Not found: ${path || "."}`)
    const bytes = new Uint8Array(await file.slice(0, MAX_READ).arrayBuffer())
    const binary = bytes.subarray(0, 8000).includes(0)
    return {
      path,
      size: file.size,
      binary,
      truncated: file.size > MAX_READ,
      text: binary ? null : new TextDecoder().decode(bytes),
      revision: await revisionOf(new Uint8Array(await file.arrayBuffer())),
    }
  },

  async write(path, text, { revision } = {}) {
    path = normalizePath(path)
    if (!path) throw new Error("A file path is required.")
    const existing = await readBlob(`${BASE}/${path}`)
    const current = existing ? await revisionOf(new Uint8Array(await existing.arrayBuffer())) : null
    if (revision !== undefined && revision !== current) {
      throw new ConflictError(current ? `${path} changed since it was read.` : `${path} no longer exists.`)
    }
    await writeFile(`${BASE}/${path}`, text)
    const bytes = new TextEncoder().encode(text)
    return { path, size: bytes.length, revision: await revisionOf(bytes), created: !existing }
  },

  async remove(path, { recursive = false, revision } = {}) {
    path = normalizePath(path)
    if (!path) throw new Error("The workspace root cannot be deleted.")
    const file = await readBlob(`${BASE}/${path}`)
    if (file && revision !== undefined && revision !== (await revisionOf(new Uint8Array(await file.arrayBuffer())))) {
      throw new ConflictError(`${path} changed since it was read.`)
    }
    if (!(await removeEntry(`${BASE}/${path}`, { recursive }))) throw new Error(`Not found: ${path}`)
    return { path, type: file ? "file" : "dir" }
  },
}

// ── host backend (companion) ──────────────────────────────────────────────

async function api(endpoint, { params, body } = {}) {
  const query = params ? `?${new URLSearchParams(params)}` : ""
  let response
  try {
    response = await fetch(withBase(`/__askk/${endpoint}${query}`), {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    })
  } catch {
    throw new Error("The ASKK companion is not reachable.")
  }
  const data = await response.json().catch(() => null)
  if (response.status === 409) throw new ConflictError(data?.error ?? "The file changed since it was read.")
  if (!response.ok || !data) throw new Error(data?.error ?? `Companion request failed (${response.status}).`)
  return data
}

function hostWorkspace(host) {
  return {
    kind: "host",
    label: host.root,
    writable: hasCapability(host, "fs.write"),
    list: (path = "") => api("fs/list", { params: { path: normalizePath(path) } }),
    read: (path) => api("fs/read", { params: { path: normalizePath(path) } }),
    tree: (path = "") => api("fs/tree", { params: { path: normalizePath(path) } }),
    write: (path, text, { revision } = {}) =>
      api("fs/write", { body: { path: normalizePath(path), text, ...(revision !== undefined ? { revision } : {}) } }),
    remove: (path, { recursive = false, revision } = {}) =>
      api("fs/delete", { body: { path: normalizePath(path), recursive, ...(revision !== undefined ? { revision } : {}) } }),
  }
}

let current = null

export function workspace() {
  current ??= detectHost().then((host) => (hasCapability(host, "fs.read") ? hostWorkspace(host) : browserWorkspace))
  return current
}
