// The team's wake book (state/wakes.jsonl in the workspace), read by the
// running server: the team wakes itself, nothing outside has to start it.
//
//   const stop = startWakes({ root, deliver, log })   // every 30 s
//   deliver({ agent, text, from }) puts the wake's message in that agent's inbox
//
// Rows come from schedule.wake ({"id", "at", "message", "agent", …}); a wake is
// due when its `at` has passed and no {"id", "done"|"missed"|"cancelled"} row
// follows it. A due wake is claimed first (a done row), then delivered, so a
// crash never runs it twice. Over `staleMinutes` late = missed, not run (a
// server that was down does not replay the morning at noon). Past 32 KB the
// book keeps its open wakes and the newest 40 closed rows (pruneWakes).

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { appendJsonl, parseJsonl } from "./jsonl.js"
import { stamp } from "./time.js"
import { WAKE_STALE_MINUTES, WAKE_TICK_MS, HOST_LIMITS } from "./config.js"

const MAX_BYTES = HOST_LIMITS.wakes.bookBytes // the book is pruned past this: open wakes + the newest closed rows
const KEEP_CLOSED = HOST_LIMITS.wakes.keepClosed
export const wakeRows = parseJsonl

// Booked and not closed (done, missed or cancelled).
export function openWakes(text) {
  const rows = wakeRows(text)
  const closed = new Set(rows.filter((r) => r.done || r.missed || r.cancelled).map((r) => r.id))
  return rows.filter((r) => r.id && r.at && r.message && !r.done && !r.missed && !r.cancelled && !closed.has(r.id))
}

export function dueWakes(text, now = Date.now()) {
  return openWakes(text).filter((r) => Date.parse(r.at) <= now)
}

export function wakesPath(root) {
  return join(root, "state", "wakes.jsonl")
}

// The text a wake starts its run with.
export function wakeText(wake) {
  return `Wake ${wake.id} (booked ${wake.booked_at}, reason: ${wake.reason}). ${wake.message}`
}

// Keep the book small: every open wake (its rows) and the newest KEEP_CLOSED
// rows of closed ones. Runs inside the tick, synchronously, in the process
// that appends the claims, so no row is lost to a concurrent write.
export function pruneWakes(text) {
  const rows = wakeRows(text)
  const open = new Set(openWakes(text).map((w) => w.id))
  const keepFrom = Math.max(0, rows.length - KEEP_CLOSED)
  const kept = rows.filter((r, i) => open.has(r.id) || i >= keepFrom)
  return kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : "")
}

// Each due wake in the book at `path`, in order: over `staleMinutes` late it
// gets a missed row and onMissed(wake, lateMinutes); else a done row (the
// claim, so a crash never runs it twice) and then onDue(wake). dryRun: no
// rows are written. Shared by startWakes and scripts/wake.js.
export function claimDueWakes(path, { staleMinutes, now = Date.now(), dryRun = false, onMissed = () => {}, onDue = () => {} }) {
  for (const wake of dueWakes(readFileSync(path, "utf8"), now)) {
    const late = (now - Date.parse(wake.at)) / 60000
    if (late > staleMinutes) {
      if (!dryRun) appendJsonl(path, { id: wake.id, missed: stamp() }, { mkdir: false })
      onMissed(wake, late)
      continue
    }
    if (!dryRun) appendJsonl(path, { id: wake.id, done: stamp() }, { mkdir: false }) // claim before delivering
    onDue(wake)
  }
}

// One retry for a wake whose run ended in an error (a model that timed out after
// the wake was claimed would otherwise leave the team idle until its next booked wake). A retry is never retried.
// Returns the booked row, or null (no such wake, already a retry, or a retry already booked).
export function retryWake(path, { id, error = "", minutes = 5, now = Date.now() }) {
  if (!id || String(id).endsWith("-retry") || !existsSync(path)) return null
  const rows = wakeRows(readFileSync(path, "utf8"))
  if (rows.some((r) => r.id === `${id}-retry`)) return null
  const wake = rows.find((r) => r.id === id && r.message)
  if (!wake) return null
  const row = {
    id: `${id}-retry`,
    at: new Date(now + minutes * 60000).toISOString(),
    booked_at: new Date(now).toISOString(),
    reason: `retry: ${wake.reason ?? id} (${String(error).slice(0, 120)})`,
    message: wake.message,
    ...(wake.agent ? { agent: wake.agent } : {}),
    ...(wake.run ? { run: wake.run } : {}),
  }
  appendJsonl(path, row, { mkdir: false })
  return row
}

export function startWakes({ root, deliver, staleMinutes = WAKE_STALE_MINUTES, log = () => {} }) {
  const path = wakesPath(root)
  const tick = () => {
    if (!existsSync(path)) return
    if (Bun.file(path).size > MAX_BYTES) writeFileSync(path, pruneWakes(readFileSync(path, "utf8")))
    claimDueWakes(path, {
      staleMinutes,
      onMissed: (wake, late) => log(`wake ${wake.id} missed (${Math.round(late)} min late): ${wake.reason}`),
      onDue: (wake) => {
        log(`wake ${wake.id} due: ${wake.reason}`)
        // A wake the team could not take (not ready, no such agent) is not lost: one retry in 2 min, then logged.
        let failed = null
        try {
          const result = deliver({ agent: wake.agent ?? null, text: wakeText(wake), from: `wake ${wake.id}` })
          if (result && result.ok === false) failed = result.error?.message ?? "not delivered"
        } catch (error) {
          failed = error.message
        }
        if (failed) {
          const retry = retryWake(path, { id: wake.id, error: failed, minutes: 2 })
          log(`wake ${wake.id} not delivered: ${failed}${retry ? ` — retry ${retry.id} at ${retry.at}` : " — no retry left"}`)
        }
      },
    })
  }
  const timer = setInterval(() => {
    try {
      tick()
    } catch (error) {
      log(`wakes: ${error.message}`)
    }
  }, WAKE_TICK_MS)
  return () => clearInterval(timer)
}

// GET wakes: the book as the UI shows it — open wakes (soonest first) and the
// newest closed ones (done / missed / cancelled, newest first).
export function listWakes(text, { recent = HOST_LIMITS.wakes.listRecent } = {}) {
  const rows = wakeRows(text)
  const booked = new Map(rows.filter((r) => r.id && r.at).map((r) => [r.id, r]))
  const open = openWakes(text).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const closed = []
  for (const r of rows) {
    const state = r.done ? "done" : r.missed ? "missed" : r.cancelled ? "cancelled" : null
    if (!state || !r.id) continue
    closed.push({ ...(booked.get(r.id) ?? { id: r.id }), state, closedAt: r[state] })
  }
  return { open, recent: closed.reverse().slice(0, recent) }
}

export function wakesRoutes(root) {
  const path = wakesPath(root)
  return {
    GET: {
      wakes: () => ({ path: "state/wakes.jsonl", ...(existsSync(path) ? listWakes(readFileSync(path, "utf8")) : { open: [], recent: [] }) }),
    },
  }
}
