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
import { detectHost, hasCapability } from "@/backend/live/host"
import { hostApi } from "@/backend/live/host-api"

class ConflictError extends Error {
  name = "ConflictError"
}

// "a//b/./c" -> "a/b/c"; throws on "..".
function normalizePath(path = "") {
  const parts = String(path).replace(/\\/g, "/").split("/").filter((p) => p && p !== ".")
  if (parts.includes("..")) throw new Error(`Path "${path}" leaves the workspace.`)
  return parts.join("/")
}

// A write against a file that changed since it was read (409), from either side, is a ConflictError.
const conflict = (error) => {
  throw error?.status === 409 ? new ConflictError(error.message) : error
}

// The same five calls over either transport: get(endpoint, params), post(endpoint, body).
const fsCalls = ({ get, post }) => ({
  list: (path = "") => get("fs/list", { path: normalizePath(path) }),
  read: (path) => get("fs/read", { path: normalizePath(path) }),
  tree: (path = "") => get("fs/tree", { path: normalizePath(path) }),
  write: (path, text, { revision } = {}) => post("fs/write", { path: normalizePath(path), text, ...(revision !== undefined ? { revision } : {}) }),
  remove: (path, { recursive = false, revision } = {}) => post("fs/delete", { path: normalizePath(path), recursive, ...(revision !== undefined ? { revision } : {}) }),
})

// The tab's own agent's workspace: its files in this browser (what its files artifact writes).
function browserWorkspace() {
  const host = browserHost({ store: browserStore() })
  const calls = fsCalls({
    get: (endpoint, params) => host.get(`${endpoint}?${new URLSearchParams(params)}`).catch(conflict),
    post: (endpoint, body) => host.post(endpoint, body).catch(conflict),
  })
  return { label: "this browser", where: "browser", writable: true, ...calls, read: async (path) => ({ binary: false, truncated: false, ...(await calls.read(path)) }) }
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
              ...fsCalls({ get: (endpoint, params) => hostApi(endpoint, { params }), post: (endpoint, body) => hostApi(endpoint, { body }).catch(conflict) }),
            }
          : null
    return current
  })
}
