// The desk's workspace (its data/ folder) as the Files page sees it, through the host API (companion/capabilities/
// files.js); in browser mode (the hosted version's agent in this tab) the same calls over this browser's store
// (backend/browser/host.js). null when neither answers here.
//
//   const ws = await workspace()       // { label, where: computer | browser, writable, list, read, tree, write, remove } | null
//   await ws.list(path)                 { path, entries: [{ name, type, size, mtime }] }
//   await ws.read(path)                 { path, size, binary, truncated, text, revision }
//   await ws.tree(path)                 { path, entries: [{ name, type, children?, skipped?, omitted? }] }
//   await ws.write(path, text, { revision })   { path, size, revision, created }
//   await ws.remove(path, { recursive, revision })   { path, type }
//
// Paths are workspace-relative ("days/2026-10-15", "" = root); ".." is refused. `revision` is the content hash
// read: a write passing it is refused (ConflictError) if the file changed since; null requires a new file.

import { browserHost } from "@/backend/browser/host"
import { browserStore } from "@/backend/browser/storage"
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

// The tab's own agent's workspace: its files in this browser (what its files artifact writes).
function browserWorkspace() {
  const host = browserHost({ store: browserStore() })
  const call = (run) => run().catch((error) => {
    if (error?.status === 409) throw new ConflictError(error.message)
    throw error
  })
  return {
    label: "this browser",
    where: "browser",
    writable: true,
    list: (path = "") => call(() => host.get(`fs/list?${new URLSearchParams({ path: normalizePath(path) })}`)),
    read: (path) => call(async () => ({ binary: false, truncated: false, ...(await host.get(`fs/read?${new URLSearchParams({ path: normalizePath(path) })}`)) })),
    tree: (path = "") => call(() => host.get(`fs/tree?${new URLSearchParams({ path: normalizePath(path) })}`)),
    write: (path, text, { revision } = {}) => call(() => host.post("fs/write", { path: normalizePath(path), text, ...(revision !== undefined ? { revision } : {}) })),
    remove: (path, { recursive = false, revision } = {}) => call(() => host.post("fs/delete", { path: normalizePath(path), recursive, ...(revision !== undefined ? { revision } : {}) })),
  }
}

// Built for the host detectHost answers now (it is cached until resetHost: the header's switch to this browser's agent
// and back changes which workspace the Files page shows).
let current = null
let forHost = null

export function workspace() {
  return detectHost().then((host) => {
    if (current && forHost === host) return current
    forHost = host
    current =
      host?.mode === "browser"
        ? browserWorkspace()
        : hasCapability(host, "fs.read")
          ? {
              label: host.root,
              where: "computer",
              writable: hasCapability(host, "fs.write"),
              list: (path = "") => api("fs/list", { params: { path: normalizePath(path) } }),
              read: (path) => api("fs/read", { params: { path: normalizePath(path) } }),
              tree: (path = "") => api("fs/tree", { params: { path: normalizePath(path) } }),
              write: (path, text, { revision } = {}) => api("fs/write", { body: { path: normalizePath(path), text, ...(revision !== undefined ? { revision } : {}) } }),
              remove: (path, { recursive = false, revision } = {}) => api("fs/delete", { body: { path: normalizePath(path), recursive, ...(revision !== undefined ? { revision } : {}) } }),
            }
          : null
    return current
  })
}
