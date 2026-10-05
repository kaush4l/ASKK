// schedule.wake: book the next run of this team, with how long to wait, why,
// and the exact message the next run starts with.
//
// A wake is one JSON line in state/wakes.jsonl in the workspace:
//   {"id", "at", "wait_minutes", "reason", "message", "agent", "booked_at"}
// `at` is UTC ISO 8601. A runner outside the app (scripts/wake.js, on cron)
// starts each due wake once and appends {"id", "done": "<time>"} after it.
// The file is in the workspace, so every agent sees the book in FILESYSTEM.

import { workspace } from "@/backend/features/filesystem/workspace"

export const WAKES_PATH = "state/wakes.jsonl"
const MAX_WAIT = 7 * 24 * 60 // a week, in minutes

function wakeTime({ in_minutes, at }, now = Date.now()) {
  if (in_minutes != null && at != null) throw new Error("Give in_minutes or at, not both.")
  if (in_minutes != null) {
    const minutes = Number(in_minutes)
    if (!(minutes >= 1 && minutes <= MAX_WAIT)) throw new Error(`in_minutes must be 1–${MAX_WAIT}.`)
    return new Date(now + Math.round(minutes) * 60000)
  }
  if (typeof at !== "string" || !/([zZ]|[+-]\d\d:?\d\d)$/.test(at)) {
    throw new Error('Give in_minutes, or at as ISO 8601 with an offset ("2026-10-05T09:45:00-04:00").')
  }
  const time = new Date(at)
  if (Number.isNaN(time.getTime())) throw new Error(`Cannot read the time "${at}".`)
  if (time.getTime() <= now) throw new Error(`${at} is not in the future.`)
  if (time.getTime() > now + MAX_WAIT * 60000) throw new Error("A wake is at most a week ahead.")
  return time
}

async function scheduleWake(inputs, { engine }) {
  const reason = String(inputs.reason ?? "").trim()
  const message = String(inputs.message ?? "").trim()
  if (!reason) throw new Error("reason: why this wake, in one line.")
  if (!message) throw new Error("message: the exact request the next run starts with.")
  const now = Date.now()
  const time = wakeTime(inputs, now)
  const row = {
    id: `w${now.toString(36)}`,
    at: time.toISOString(),
    wait_minutes: Math.round((time.getTime() - now) / 60000),
    reason,
    message,
    agent: engine?.name ?? null,
    booked_at: new Date(now).toISOString(),
  }
  const ws = await workspace()
  for (let attempt = 0; attempt < 5; attempt++) {
    let current = null
    try {
      current = await ws.read(WAKES_PATH)
    } catch (error) {
      if (!/not found/i.test(error.message)) throw error
    }
    const before = current?.text ?? ""
    const text = `${before}${before && !before.endsWith("\n") ? "\n" : ""}${JSON.stringify(row)}\n`
    try {
      await ws.write(WAKES_PATH, text, { revision: current?.revision ?? null })
      return `Booked ${row.id}: wake at ${row.at} (in ${row.wait_minutes} min) — ${reason}`
    } catch (error) {
      if (error.name !== "ConflictError") throw error
    }
  }
  throw new Error(`${WAKES_PATH} kept changing; try again.`)
}

export const SCHEDULE_TOOLS = {
  "schedule.wake": {
    description:
      "Book the next run of this team: wait in_minutes (or until `at`, ISO 8601 with offset), the reason, " +
      "and the exact message the next run starts with. Use it when nothing more can be done now and the " +
      "market needs time. Needs the owner's approval.",
    inputs: {
      type: "object",
      properties: {
        in_minutes: { type: "number", minimum: 1, maximum: MAX_WAIT },
        at: { type: "string", maxLength: 40 },
        reason: { type: "string", minLength: 1, maxLength: 300 },
        message: { type: "string", minLength: 1, maxLength: 1000 },
      },
      required: ["reason", "message"],
      additionalProperties: false,
    },
    effect: "write",
    approval: true,
    describe: ({ in_minutes, at, reason = "" }) =>
      `Book a run ${in_minutes != null ? `in ${in_minutes} min` : `at ${at}`}: ${reason}`,
    run: scheduleWake,
  },
}
