// Browser file storage: folders and text files in the Origin Private File
// System (OPFS) — a real per-site file system that persists across reloads.
// Works on the main thread and in workers (engines run in workers):
//   createWritable       main thread or worker (Chrome, Safari 26+)
//   createSyncAccessHandle  workers only (older Safari)
//   localStorage         main-thread fallback when OPFS writing is unavailable
//
//   await writeFile("agents/lead/memory.md", text)
//   await readFile("agents/lead/memory.md")   // null when missing

const FALLBACK_PREFIX = "powerhouse.fs:"

// Writes to one path run one after another, so a slow write can never land
// after a newer one.
const queues = new Map()

function serialize(path, task) {
  const next = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(task)
  queues.set(path, next)
  return next
}

const inWorker = typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope

let opfsRoot // undefined = not checked, null = unavailable
let writeMode // "writable" | "sync"
async function opfs() {
  if (opfsRoot !== undefined) return opfsRoot
  try {
    const root = await navigator.storage.getDirectory()
    const proto = FileSystemFileHandle.prototype
    writeMode = "createWritable" in proto ? "writable" : inWorker && "createSyncAccessHandle" in proto ? "sync" : null
    opfsRoot = writeMode ? root : null
  } catch {
    opfsRoot = null
  }
  return opfsRoot
}

function noStorage() {
  if (inWorker) throw new Error("This browser has no file storage for workers (OPFS).")
}

async function fileHandle(root, path, create) {
  const parts = path.split("/").filter(Boolean)
  const name = parts.pop()
  let dir = root
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
  return dir.getFileHandle(name, { create })
}

export async function readFile(path) {
  const root = await opfs()
  if (!root) return noStorage() ?? localStorage.getItem(FALLBACK_PREFIX + path)
  try {
    const handle = await fileHandle(root, path, false)
    return await (await handle.getFile()).text()
  } catch (error) {
    if (error.name === "NotFoundError") return null
    throw error
  }
}

export function writeFile(path, text) {
  return serialize(path, async () => {
    const root = await opfs()
    if (!root) {
      noStorage()
      localStorage.setItem(FALLBACK_PREFIX + path, text)
      return
    }
    const handle = await fileHandle(root, path, true)
    if (writeMode === "sync") {
      const access = await handle.createSyncAccessHandle()
      try {
        const bytes = new TextEncoder().encode(text)
        access.truncate(0)
        access.write(bytes, { at: 0 })
        access.flush()
      } finally {
        access.close()
      }
      return
    }
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
  })
}

// ── folders (OPFS only; no localStorage fallback) ────────────────────────

async function dirHandle(root, path, create) {
  let dir = root
  for (const part of path.split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

async function requireOpfs() {
  const root = await opfs()
  if (!root) throw new Error("This browser has no writable file storage (OPFS).")
  return root
}

// Entries of a folder: [{ name, type: "dir" | "file", size, mtime }];
// null when the folder does not exist.
export async function listDir(path) {
  const root = await requireOpfs()
  let dir
  try {
    dir = await dirHandle(root, path, false)
  } catch (error) {
    if (error.name === "NotFoundError" || error.name === "TypeMismatchError") return null
    throw error
  }
  const entries = []
  for await (const handle of dir.values()) {
    if (handle.kind === "directory") entries.push({ name: handle.name, type: "dir", size: 0, mtime: null })
    else {
      const file = await handle.getFile()
      entries.push({ name: handle.name, type: "file", size: file.size, mtime: file.lastModified })
    }
  }
  return entries
}

// The File at a path (bytes, size, lastModified); null when missing.
export async function readBlob(path) {
  const root = await requireOpfs()
  try {
    return await (await fileHandle(root, path, false)).getFile()
  } catch (error) {
    if (error.name === "NotFoundError" || error.name === "TypeMismatchError") return null
    throw error
  }
}

// Delete a file or folder; a folder with contents needs `recursive`.
// Returns false when it does not exist.
export async function removeEntry(path, { recursive = false } = {}) {
  const parts = path.split("/").filter(Boolean)
  const name = parts.pop()
  try {
    const parent = await dirHandle(await requireOpfs(), parts.join("/"), false)
    await parent.removeEntry(name, { recursive })
    return true
  } catch (error) {
    if (error.name === "NotFoundError" || error.name === "TypeMismatchError") return false
    if (error.name === "InvalidModificationError") throw new Error(`${path} is not empty; pass recursive: true to delete it with its contents.`)
    throw error
  }
}

// Make sure a folder exists (parents included).
export async function makeDir(path) {
  await dirHandle(await requireOpfs(), path, true)
}
