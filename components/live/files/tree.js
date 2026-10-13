import { isFileEvent } from "@/backend/features/live/follow"

export const OPS = { "fs.write": "W", "fs.edit": "E", "fs.append": "A", "fs.delete": "D" }
export const OP_COLOR = { "fs.write": "text-emerald-500", "fs.edit": "text-sky-500", "fs.append": "text-sky-500", "fs.delete": "text-destructive" }

// The latest change per path, from the feed.
export function touchedFiles(events) {
  const latest = new Map()
  for (const event of events) if (isFileEvent(event) && event.inputs?.path) latest.set(event.inputs.path, event)
  return latest
}

// Paths → nested { dirs, files } for a small tree.
export function pathTree(paths) {
  const root = { dirs: new Map(), files: [] }
  for (const path of [...paths].sort()) {
    const parts = path.split("/").filter(Boolean)
    let node = root
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] })
      node = node.dirs.get(dir)
    }
    node.files.push({ name: parts.at(-1), path })
  }
  return root
}

// Every folder above a path: "a/b/c.py" -> ["a", "a/b"].
export const ancestors = (path) => path.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))
