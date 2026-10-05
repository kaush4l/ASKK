// Browser globals the app code expects, for running engines in Bun (headless
// `askk ask`, and the team worker of a local server): a page location,
// same-origin fetch answered in-process (host API + public files), and
// localStorage — per run, or kept on disk when `storageDir` is given (one
// file per key), so memory and settings survive a restart. With a
// `storageDir`, engine files (memory.md, history, artifacts.json) are real
// files in <storageDir>/files/ (backend/platform/storage.js uses
// globalThis.askkRuntimeFiles): the runtime's data, never the browser's.

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"

export const SHIM_PORT = 7717
export const SHIM_ORIGIN = `http://localhost:${SHIM_PORT}` // virtual: never listened on

// The app's public files: embedded in the compiled binary, else public/.
export async function publicFile(embedded, pathname) {
  if (embedded) return embedded[pathname] ? Bun.file(embedded[pathname]) : null
  const base = resolve(import.meta.dir, "../public")
  const file = resolve(base, `.${pathname}`)
  if (!file.startsWith(base + sep)) return null
  const blob = Bun.file(file)
  return (await blob.exists()) ? blob : null
}

function memoryStorage() {
  const store = new Map()
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
}

// localStorage kept in a folder: one file per key (the key, URI-encoded).
function diskStorage(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const store = new Map()
  for (const name of readdirSync(dir)) {
    try {
      store.set(decodeURIComponent(name), readFileSync(join(dir, name), "utf8"))
    } catch {
      // unreadable entry: skipped
    }
  }
  const file = (key) => join(dir, encodeURIComponent(key))
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      const text = String(value)
      store.set(key, text)
      writeFileSync(file(key), text, { mode: 0o600 })
    },
    removeItem: (key) => {
      store.delete(key)
      rmSync(file(key), { force: true })
    },
  }
}

// Engine files kept as real files under `dir`.
function diskFiles(dir) {
  const base = resolve(dir)
  const full = (path) => {
    const file = resolve(base, path)
    if (!file.startsWith(base + sep)) throw new Error(`Outside the runtime folder: ${path}`)
    return file
  }
  return {
    read(path) {
      try {
        return readFileSync(full(path), "utf8")
      } catch (error) {
        if (error.code === "ENOENT") return null
        throw error
      }
    },
    write(path, text) {
      const file = full(path)
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      const temp = `${file}.${process.pid}.tmp`
      writeFileSync(temp, text, { mode: 0o600 })
      renameSync(temp, file) // atomic: a reader never sees half a file
    },
  }
}

const OLD_FILE_PREFIX = "powerhouse.fs:" // engine files once kept as localStorage keys

export function installBrowserShims({ api, embedded = null, storageDir = null }) {
  globalThis.location = new URL(`${SHIM_ORIGIN}/`)
  globalThis.window ??= globalThis // app code reads window.location
  globalThis.localStorage = storageDir ? diskStorage(storageDir) : memoryStorage()
  if (storageDir) {
    const files = diskFiles(join(storageDir, "files"))
    // Engine files from before: localStorage keys become real files.
    for (const name of readdirSync(storageDir)) {
      const key = decodeURIComponent(name)
      if (!key.startsWith(OLD_FILE_PREFIX)) continue
      const path = key.slice(OLD_FILE_PREFIX.length)
      if (files.read(path) == null) files.write(path, localStorage.getItem(key) ?? "")
      localStorage.removeItem(key)
    }
    globalThis.askkRuntimeFiles = files
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), globalThis.location)
    if (url.origin !== SHIM_ORIGIN) return realFetch(input instanceof Request ? input : url, init)
    if (url.pathname.startsWith("/__askk/")) {
      const headers = new Headers(init.headers)
      headers.set("host", url.host)
      headers.set("origin", SHIM_ORIGIN) // same origin, as the page would send
      return api.handle(new Request(url, { ...init, headers }))
    }
    const file = await publicFile(embedded, url.pathname)
    return file ? new Response(file) : new Response("Not found", { status: 404 })
  }
}
