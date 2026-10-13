// The wake runner for a team with NO server running: starts every run it
// booked with schedule.wake. A running server (bun run dev, askk) reads its
// own wake book (companion/team/wakes.js), so then this does nothing; outside
// inputs go to the server with scripts/send.js.
//
//   bun scripts/wake.js --agents custom/<team> [--root <dir>] [--dry-run]
//
// Meant for cron, every few minutes:
//   */5 * * * 1-5  cd <repo> && bun scripts/wake.js --agents custom/<team> >> wake.log 2>&1
//
// Reads <root>/state/wakes.jsonl (rows from schedule.wake). A wake is due when
// its `at` has passed and no {"id", "done"} row follows it. Each due wake is
// claimed first (a done row is appended), then run once through headless ASKK
// (companion/team/ask.js) with the wake's message, so a crash never runs it twice.
// Wakes more than --stale minutes late are marked missed, not run. One runner
// at a time per root (state/wake.lock).

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"

import { TEAM_OPTIONS, agentDirsFrom, rootFrom } from "../companion/shared/args.js"
import { logLine as log } from "../companion/shared/time.js"
import { findTeamServer } from "../companion/team/team.js"
import { claimDueWakes, dueWakes, wakeText, wakesPath as wakeBook } from "../companion/team/wakes.js"
import { WAKE_STALE_MINUTES } from "../companion/shared/config.js"

export { dueWakes }

async function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      ...TEAM_OPTIONS,
      stale: { type: "string", default: String(WAKE_STALE_MINUTES) },
      timeout: { type: "string", default: "1800" },
      "dry-run": { type: "boolean", default: false },
    },
  })
  const agentDirs = agentDirsFrom(args.agents)
  const root = await rootFrom(args.root, agentDirs)
  const server = findTeamServer(root)
  if (server) return log(`team server running (port ${server.port}): it runs its own wakes; nothing to do`)
  const wakesPath = wakeBook(root)
  const lockPath = join(root, "state", "wake.lock")

  if (!existsSync(wakesPath)) return log(`no wakes booked (${wakesPath})`)
  mkdirSync(dirname(lockPath), { recursive: true })
  if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs < Number(args.timeout) * 1000 + 60000) {
    return log("another wake run is in progress; skipped")
  }
  writeFileSync(lockPath, String(process.pid))
  try {
    claimDueWakes(wakesPath, {
      staleMinutes: Number(args.stale),
      dryRun: args["dry-run"],
      onMissed: (wake, late) => log(`${wake.id} missed (${Math.round(late)} min late): ${wake.reason}`),
      onDue: (wake) => {
        log(`${wake.id} due: ${wake.reason}`)
        if (args["dry-run"]) return
        const ask = [
          resolve(import.meta.dirname, "../companion/team/ask.js"),
          ...agentDirs.flatMap((d) => ["--agents", d]),
          ...(wake.agent ? ["--agent", wake.agent] : []),
          "--root", root, "--yes", "--timeout", args.timeout,
          wakeText(wake),
        ]
        const run = spawnSync(process.execPath, ask, { stdio: "inherit", timeout: (Number(args.timeout) + 60) * 1000 })
        log(`${wake.id} finished: exit ${run.status ?? run.signal}`)
      },
    })
  } finally {
    rmSync(lockPath, { force: true })
  }
}

if (import.meta.main) await main()
