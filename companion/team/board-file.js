// A team board as a file a person can read (2026-10-21 owner: "For a shared history board for agents, a
// memory/<desk>/<sub desk>. Even the memory will be local."): memory/<desk>/<team>/board.md (companion/shared/paths.js
// boardFile) — the board's goal and every entry (key, author, time, text) as markdown, then its state in a fenced json
// block (one line) that restore reads. Written by kernel-team.js on every change, read back at every start (not only
// the same day). The entries are blockquotes, so the only line that is exactly ```json is the state's.
//
//   boardMarkdown(board, at)   the file's text
//   readBoardFile(file)        {id, team, goal, entries} saved there, or null

import { existsSync, readFileSync } from "node:fs"

const FENCE = "```json"
const quote = (text) => String(text ?? "").split("\n").map((l) => `> ${l}`.trimEnd())

export function boardMarkdown(board, at = new Date().toISOString()) {
  const { goal = "", entries = {} } = board.state ?? {}
  const lines = [`# ${board.title ?? board.name}`, "", `_${board.path?.().join(" / ") ?? board.team} · ${board.name} · saved ${at}_`, ""]
  if (goal) lines.push(`**Goal:** ${String(goal).replace(/\s+/g, " ").trim()}`, "")
  const keys = Object.keys(entries)
  if (!keys.length) lines.push("(no entries)", "")
  for (const key of keys) {
    const e = entries[key] ?? {}
    lines.push(`## ${key} — ${e.author ?? "?"} · ${e.at ?? ""}`, "", ...quote(e.text), "")
  }
  lines.push(FENCE, JSON.stringify({ id: board.name, team: board.team, at, goal, entries }), "```", "")
  return lines.join("\n")
}

export function readBoardFile(file) {
  if (!existsSync(file)) return null
  const lines = readFileSync(file, "utf8").split("\n")
  for (let i = lines.length - 2; i >= 0; i--) {
    if (lines[i].trimEnd() !== FENCE) continue // \r\n too
    const saved = JSON.parse(lines[i + 1].trim())
    return saved && typeof saved === "object" ? saved : null
  }
  return null
}
