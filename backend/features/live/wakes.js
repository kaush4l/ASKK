// The team's wake book for the live page: GET /__askk/wakes (companion/team/wakes.js),
// the runs the team booked for later (schedule.wake) and the ones lately run,
// missed or cancelled. Local mode with capability `wakes` only.
//
//   readWakes() -> { available, open: [wake], recent: [wake + {state, closedAt}], error? }

import { withBase } from "@/backend/platform/base-path"
import { detectHost, hasCapability } from "@/backend/platform/host"
import { LIMITS } from "@/lib/config"

export const WAKES_POLL_MS = LIMITS.liveWakes.pollMs

export async function readWakes() {
  const host = await detectHost()
  if (!hasCapability(host, "wakes")) return { available: false, open: [], recent: [] }
  try {
    const response = await fetch(withBase("/__askk/wakes"), { cache: "no-store" })
    const body = await response.json()
    if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
    return { available: true, open: body.open ?? [], recent: body.recent ?? [] }
  } catch (error) {
    return { available: true, open: [], recent: [], error: error.message }
  }
}
