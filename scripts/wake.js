// The wake runner: starts every run a team booked with schedule.wake.
//
//   bun scripts/wake.js --agents custom/<team> [--root <dir>] [--dry-run]
//
// Meant for cron, every few minutes:
//   */5 * * * 1-5  cd <repo> && bun scripts/wake.js --agents custom/<team> >> wake.log 2>&1
//
// Reads <root>/state/wakes.jsonl (rows from schedule.wake). A wake is due when
// its `at` has passed and no {"id", "done"} row follows it. Each due wake is
// claimed first (a done row is appended), then run once through headless ASKK
// (companion/ask.js) with the wake's message, so a crash never runs it twice.
// Wakes more than --stale minutes late are marked missed, not run. One runner
// at a time per root (state/wake.lock).

import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"

import { agentDirsFrom, rootFrom } from "../companion/host-api.js"

const stamp = () => new Date().toISOString()
const log = (line) => console.log(`${stamp()} ${line}`)

export function dueWakes(text, now = Date.now()) {
  const rows = text.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
  const closed = new Set(rows.filter((r) => r.done || r.missed).map((r) => r.id))
  return rows.filter((r) => r.id && r.at && r.message && !r.done && !r.missed && !closed.has(r.id) && Date.parse(r.at) <= now)
}

async function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      agents: { type: "string", multiple: true, default: [] },
      root: { type: "string" },
      stale: { type: "string", default: "60" },
      timeout: { type: "string", default: "1800" },
      "dry-run": { type: "boolean", default: false },
    },
  })
  const agentDirs = agentDirsFrom(args.agents)
  const root = await rootFrom(args.root, agentDirs)
  const wakesPath = join(root, "state", "wakes.jsonl")
  const lockPath = join(root, "state", "wake.lock")

  if (!existsSync(wakesPath)) return log(`no wakes booked (${wakesPath})`)
  mkdirSync(dirname(lockPath), { recursive: true })
  if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs < Number(args.timeout) * 1000 + 60000) {
    return log("another wake run is in progress; skipped")
  }
  writeFileSync(lockPath, String(process.pid))
  try {
    const now = Date.now()
    for (const wake of dueWakes(readFileSync(wakesPath, "utf8"), now)) {
      const late = (now - Date.parse(wake.at)) / 60000
      if (late > Number(args.stale)) {
        if (!args["dry-run"]) appendFileSync(wakesPath, `${JSON.stringify({ id: wake.id, missed: stamp() })}\n`)
        log(`${wake.id} missed (${Math.round(late)} min late): ${wake.reason}`)
        continue
      }
      log(`${wake.id} due: ${wake.reason}`)
      if (args["dry-run"]) continue
      appendFileSync(wakesPath, `${JSON.stringify({ id: wake.id, done: stamp() })}\n`) // claim before running
      const ask = [
        resolve(import.meta.dirname, "../companion/ask.js"),
        ...agentDirs.flatMap((d) => ["--agents", d]),
        ...(wake.agent ? ["--agent", wake.agent] : []),
        "--root", root, "--yes", "--timeout", args.timeout,
        `Wake ${wake.id} (booked ${wake.booked_at}, reason: ${wake.reason}). ${wake.message}`,
      ]
      const run = spawnSync(process.execPath, ask, { stdio: "inherit", timeout: (Number(args.timeout) + 60) * 1000 })
      log(`${wake.id} finished: exit ${run.status ?? run.signal}`)
    }
  } finally {
    rmSync(lockPath, { force: true })
  }
}

if (import.meta.main) await main()
