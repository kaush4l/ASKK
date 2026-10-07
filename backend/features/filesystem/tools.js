// The fs.* tools: list, read, write, edit, append and delete files in the workspace
// (workspace.js). Write tools need the owner's approval, and a write over an
// existing file must be based on a revision this engine has seen (read, or
// open in the filesystem artifact: markSeen).

import { ConflictError, workspace } from "@/backend/features/filesystem/workspace"
import { checkDelete, checkLane, checkPreserve } from "@/backend/features/filesystem/guard"

const MAX_OUTPUT = 60000 // characters of a file shown to the model

// The revision each engine last read or wrote, per path: a write over an
// existing file must be based on what this engine has seen.
const seen = new WeakMap()
const seenBy = (engine) => {
  if (!seen.has(engine)) seen.set(engine, new Map())
  return seen.get(engine)
}

// Record that `engine` has seen `path` at `revision` (e.g. an open file in
// the filesystem artifact), so its writes are based on what it saw.
export const markSeen = (engine, path, revision) => seenBy(engine).set(path, revision)

const formatSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

const requirePath = (path) => {
  if (typeof path !== "string" || !path.trim()) throw new Error('Expected {"path": "folder/file.ext"}.')
  return path.trim()
}

async function fsList({ path = "" }) {
  const ws = await workspace()
  const { path: dir, entries } = await ws.list(path)
  const lines = entries.map((e) => (e.type === "dir" ? `${e.name}/` : e.type === "file" ? `${e.name}  (${formatSize(e.size)})` : `${e.name}  [${e.type}]`))
  return `Folder: /${dir}\n${lines.join("\n") || "(empty)"}`
}

async function fsRead({ path }, { engine }) {
  const ws = await workspace()
  // A shared/ file is in the SHARED artifact already: only a status line.
  for (const artifact of engine?.artifacts ?? []) {
    const status = await artifact.show?.(requirePath(path)).catch(() => null)
    if (status) return status
  }
  const file = await ws.read(requirePath(path))
  if (file.binary) throw new Error(`${file.path} is a binary file (${formatSize(file.size)}); it cannot be shown as text.`)
  seenBy(engine).set(file.path, file.revision)
  let text = file.text
  const notes = []
  if (file.truncated) notes.push(`only the first ${formatSize(text.length)} of ${formatSize(file.size)} was read`)
  if (text.length > MAX_OUTPUT) {
    text = text.slice(0, MAX_OUTPUT)
    notes.push(`shown up to ${MAX_OUTPUT} characters`)
  }
  return `File: ${file.path} (${formatSize(file.size)})${notes.length ? ` — ${notes.join("; ")}` : ""}\n\n${text}`
}

async function fsWrite({ path, text }, { engine }) {
  if (typeof text !== "string") throw new Error('Expected {"path": "...", "text": "full file content"}.')
  const ws = await workspace()
  const revisions = seenBy(engine)
  const key = requirePath(path).replace(/^\/+/, "")
  checkLane(engine?.agent, key, "write")
  if (engine?.agent?.preserve && revisions.has(key)) {
    const before = await ws.read(key).catch(() => null)
    if (before && !before.binary) checkPreserve(engine.agent, key, before.text, text)
  }
  try {
    // Never read: it must be a new file.
    const result = await ws.write(key, text, { revision: revisions.get(key) ?? null })
    revisions.set(result.path, result.revision)
    return `${result.created ? "Created" : "Updated"} ${result.path} (${formatSize(result.size)}).`
  } catch (error) {
    if (error instanceof ConflictError || error.name === "ConflictError") {
      throw new Error(
        revisions.has(key)
          ? `${key} changed since you read it. Open or read it again, then write.`
          : `${key} already exists. Open or read it first (or use fs.edit), then write.`
      )
    }
    throw error
  }
}

async function fsEdit({ path, old, new: replacement }, { engine }) {
  if (typeof old !== "string" || !old || typeof replacement !== "string") {
    throw new Error('Expected {"path": "...", "old": "exact text to replace", "new": "replacement"}.')
  }
  const ws = await workspace()
  checkLane(engine?.agent, requirePath(path).replace(/^\/+/, ""), "edit")
  const file = await ws.read(requirePath(path))
  if (file.binary || file.truncated) throw new Error(`${file.path} cannot be edited as text.`)
  const count = file.text.split(old).length - 1
  if (count !== 1) {
    throw new Error(
      count === 0
        ? `The "old" text was not found in ${file.path}. Read the file and copy the text exactly.`
        : `The "old" text appears ${count} times in ${file.path}; include more surrounding text so it matches once.`
    )
  }
  const edited = file.text.replace(old, () => replacement)
  checkPreserve(engine?.agent, file.path, file.text, edited)
  const result = await ws.write(file.path, edited, { revision: file.revision })
  seenBy(engine).set(result.path, result.revision)
  return `Edited ${result.path} (${formatSize(result.size)}).`
}

// Append text to a file (created if missing): logs, ledgers, notes shared by
// several agents. Each line keeps its own; a concurrent change by another
// agent is retried on the fresh content, never overwritten.
async function fsAppend({ path, text }, { engine }) {
  if (typeof text !== "string" || !text) throw new Error('Expected {"path": "...", "text": "lines to add"}.')
  const ws = await workspace()
  const key = requirePath(path).replace(/^\/+/, "")
  checkLane(engine?.agent, key, "append to")
  for (let attempt = 0; attempt < 5; attempt++) {
    let current = null
    try {
      current = await ws.read(key)
    } catch (error) {
      if (!/not found/i.test(error.message)) throw error
    }
    if (current && (current.binary || current.truncated)) throw new Error(`${key} cannot be appended to as text.`)
    const before = current?.text ?? ""
    const joined = before && !before.endsWith("\n") ? `${before}\n${text}` : `${before}${text}`
    try {
      const result = await ws.write(key, joined.endsWith("\n") ? joined : `${joined}\n`, { revision: current?.revision ?? null })
      seenBy(engine).set(result.path, result.revision)
      return `Appended ${text.length} characters to ${result.path} (${formatSize(result.size)}).`
    } catch (error) {
      if (error.name !== "ConflictError") throw error // changed meanwhile: try again on the new content
    }
  }
  throw new Error(`${key} kept changing while appending; try again.`)
}

async function fsDelete({ path, recursive = false }, { engine }) {
  const ws = await workspace()
  const revisions = seenBy(engine)
  const key = requirePath(path).replace(/^\/+/, "")
  checkLane(engine?.agent, key, "delete")
  checkDelete(engine?.agent, key)
  if (engine?.agent?.preserve && recursive === true) {
    throw new Error(`Refused: recursive delete of ${key} under preserve — existing work is never deleted in bulk; report it as blocked for the owner.`)
  }
  try {
    // A file this engine read must not have changed since.
    const result = await ws.remove(key, { recursive: recursive === true, revision: revisions.get(key) })
    revisions.delete(result.path)
    return `Deleted ${result.type === "dir" ? "folder" : result.type} ${result.path}.`
  } catch (error) {
    if (error.name === "ConflictError") throw new Error(`${key} changed since you read it. Read it again before deleting.`)
    throw error
  }
}

// The CONTEXT line for the fs.* tools: where they work.
async function describeWorkspace() {
  const ws = await workspace()
  return ws.kind === "host"
    ? `Workspace: ${ws.label} — a folder on the owner's computer (ASKK companion), ${ws.writable ? "read + write" : "read-only"}. fs.* paths are relative to it.`
    : "Workspace: a folder stored in this browser (no companion running), read + write. fs.* paths are relative to it."
}

const pathSchema = { type: "string", minLength: 1, maxLength: 1024 }

const SPECS = {
  "fs.list": {
    view: "file",
    description: 'List a folder of the workspace. Paths are relative to the workspace root; omit path (or "") for the root.',
    inputs: { type: "object", properties: { path: { type: "string", maxLength: 1024 } }, additionalProperties: false },
    run: fsList,
  },
  "fs.read": {
    view: "file",
    description:
      "Read a text file from the workspace. Read a file before changing it. A shared/ file shown in " +
      "SHARED returns only a status line (read it there).",
    inputs: { type: "object", properties: { path: pathSchema }, required: ["path"], additionalProperties: false },
    run: fsRead,
  },
  "fs.write": {
    view: "file",
    description:
      "Write a whole text file in the workspace (parent folders are created). To replace an existing file, " +
      "open or read it first. For small changes prefer fs.edit. Needs the owner's approval.",
    inputs: {
      type: "object",
      properties: { path: pathSchema, text: { type: "string" } },
      required: ["path", "text"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    run: fsWrite,
  },
  "fs.edit": {
    view: "file",
    description:
      'Replace one exact piece of text in a workspace file: "old" must appear exactly once. Needs the owner\'s approval.',
    inputs: {
      type: "object",
      properties: { path: pathSchema, old: { type: "string" }, new: { type: "string" } },
      required: ["path", "old", "new"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    run: fsEdit,
  },
  "fs.append": {
    view: "file",
    description:
      "Append text to the end of a workspace file, creating it if missing (logs, ledgers, shared notes). " +
      "Other agents' additions are kept. Needs the owner's approval.",
    inputs: {
      type: "object",
      properties: { path: pathSchema, text: { type: "string" } },
      required: ["path", "text"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    describe: ({ path, text = "" }) => `Append ${text.length} characters to ${path}.`,
    run: fsAppend,
  },
  "fs.delete": {
    view: "file",
    description:
      "Delete a file or folder in the workspace. A folder with contents needs recursive: true. " +
      "Needs the owner's approval.",
    inputs: {
      type: "object",
      properties: { path: pathSchema, recursive: { type: "boolean" } },
      required: ["path"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    run: fsDelete,
  },
}

// Tool specs by name (registered in features/index.js).
export const FS_TOOLS = Object.fromEntries(
  Object.entries(SPECS).map(([name, spec]) => [name, { ...spec, context: describeWorkspace }])
)
