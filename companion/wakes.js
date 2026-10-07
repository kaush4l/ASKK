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

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const TICK_MS = 30 * 1000
const MAX_BYTES = 32 * 1024 // the book is pruned past this: open wakes + the newest closed rows
const KEEP_CLOSED = 40
const stamp = () => new Date().toISOString()

export function wakeRows(text) {
  return text.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}

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

export function startWakes({ root, deliver, staleMinutes = 60, log = () => {} }) {
  const path = wakesPath(root)
  const tick = () => {
    if (!existsSync(path)) return
    if (statSync(path).size > MAX_BYTES) writeFileSync(path, pruneWakes(readFileSync(path, "utf8")))
    const now = Date.now()
    for (const wake of dueWakes(readFileSync(path, "utf8"), now)) {
      const late = (now - Date.parse(wake.at)) / 60000
      if (late > staleMinutes) {
        appendFileSync(path, `${JSON.stringify({ id: wake.id, missed: stamp() })}\n`)
        log(`wake ${wake.id} missed (${Math.round(late)} min late): ${wake.reason}`)
        continue
      }
      appendFileSync(path, `${JSON.stringify({ id: wake.id, done: stamp() })}\n`) // claim before delivering
      log(`wake ${wake.id} due: ${wake.reason}`)
      try {
        deliver({ agent: wake.agent ?? null, text: wakeText(wake), from: `wake ${wake.id}` })
      } catch (error) {
        log(`wake ${wake.id} not delivered: ${error.message}`)
      }
    }
  }
  const timer = setInterval(() => {
    try {
      tick()
    } catch (error) {
      log(`wakes: ${error.message}`)
    }
  }, TICK_MS)
  return () => clearInterval(timer)
}
