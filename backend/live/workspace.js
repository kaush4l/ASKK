// The desk's workspace (its data/ folder) as the Files page sees it, through the host API (companion/capabilities/
// files.js). null when no desk server answers here.
//
//   const ws = await workspace()       // { label, writable, list, read, tree, write, remove } | null
//   await ws.list(path)                 { path, entries: [{ name, type, size, mtime }] }
//   await ws.read(path)                 { path, size, binary, truncated, text, revision }
//   await ws.tree(path)                 { path, entries: [{ name, type, children?, skipped?, omitted? }] }
//   await ws.write(path, text, { revision })   { path, size, revision, created }
//   await ws.remove(path, { recursive, revision })   { path, type }
//
// Paths are workspace-relative ("days/2026-10-15", "" = root); ".." is refused. `revision` is the content hash
// read: a write passing it is refused (ConflictError) if the file changed since; null requires a new file.

import { withBase } from "@/backend/live/base-path"
import { detectHost, hasCapability } from "@/backend/live/host"

export class ConflictError extends Error {
  name = "ConflictError"
}

// "a//b/./c" -> "a/b/c"; throws on "..".
export function normalizePath(path = "") {
  const parts = String(path).replace(/\\/g, "/").split("/").filter((p) => p && p !== ".")
  if (parts.includes("..")) throw new Error(`Path "${path}" leaves the workspace.`)
  return parts.join("/")
}

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
    throw new Error("The desk server is not reachable.")
  }
  const data = await response.json().catch(() => null)
  if (response.status === 409) throw new ConflictError(data?.error ?? "The file changed since it was read.")
  if (!response.ok || !data) throw new Error(data?.error ?? `Request failed (${response.status}).`)
  return data
}

let current = null

export function workspace() {
  current ??= detectHost().then((host) =>
    hasCapability(host, "fs.read")
      ? {
          label: host.root,
          writable: hasCapability(host, "fs.write"),
          list: (path = "") => api("fs/list", { params: { path: normalizePath(path) } }),
          read: (path) => api("fs/read", { params: { path: normalizePath(path) } }),
          tree: (path = "") => api("fs/tree", { params: { path: normalizePath(path) } }),
          write: (path, text, { revision } = {}) => api("fs/write", { body: { path: normalizePath(path), text, ...(revision !== undefined ? { revision } : {}) } }),
          remove: (path, { recursive = false, revision } = {}) => api("fs/delete", { body: { path: normalizePath(path), recursive, ...(revision !== undefined ? { revision } : {}) } }),
        }
      : null
  )
  return current
}
