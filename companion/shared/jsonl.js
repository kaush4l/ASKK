// JSON-lines files (wakes.jsonl, orders.jsonl, terminal.jsonl): one JSON
// object per line, appended; a line that does not parse is skipped.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

export function parseJsonl(text) {
  return String(text ?? "").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}

// Every row of a file; [] when it does not exist.
export const readJsonl = (path) => (existsSync(path) ? parseJsonl(readFileSync(path, "utf8")) : [])

// Append one row, creating the folder when `mkdir` (default) is set.
export function appendJsonl(path, row, { mkdir = true } = {}) {
  if (mkdir) mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(row)}\n`)
}
