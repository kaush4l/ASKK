// A model's usage limit (2026-10-26 owner: "I see trade desk is stopped for some errors"): the Claude CLI's "You've hit
// your session limit · resets 10:10am (America/New_York)", a provider's 429 or "rate limit", an overloaded 529. Such an
// error is the model's, not the run's: it says nothing about the work, so a standing goal never counts it toward its
// pause, a workflow stage does not burn its retries on it, and a wake's retry waits until the limit resets.
//
//   usageLimit(message, now?) → null | { until: Date | null, text }
//     until: when the limit resets (the "resets <time> (<zone>)" the CLI names, the next such wall time), else null
//   limitWait(limit, now?, {fallbackMinutes = 15, marginMinutes = 2}) → minutes to wait before the next try (≥ 1)

const LIMIT = /session limit|usage limit|rate[ _-]?limit|too many requests|\b429\b|\b529\b|overloaded|quota exceeded|exceeded your (?:current )?quota/i
const RESETS = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i

// minutes past midnight of `now` on the wall clock of `zone` (the host's own when none or unknown)
function wallMinutes(now, zone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone || undefined, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now)
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    return get("hour") * 60 + get("minute")
  } catch {
    return now.getHours() * 60 + now.getMinutes()
  }
}

export function usageLimit(message, now = new Date()) {
  const text = String(message ?? "")
  if (!LIMIT.test(text)) return null
  const m = text.match(RESETS)
  if (!m) return { until: null, text: text.slice(0, 200) }
  let hour = Number(m[1]) % 24
  if (m[3]) hour = (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)
  const target = hour * 60 + Number(m[2] ?? 0)
  const diff = (((target - wallMinutes(now, m[4]?.trim())) % 1440) + 1440) % 1440
  const until = new Date(now.getTime() + diff * 60000 - now.getSeconds() * 1000 - now.getMilliseconds())
  return { until, text: text.slice(0, 200) }
}

export function limitWait(limit, now = new Date(), { fallbackMinutes = 15, marginMinutes = 2 } = {}) {
  if (!limit?.until) return fallbackMinutes
  return Math.max(1, Math.ceil((limit.until.getTime() - now.getTime()) / 60000) + marginMinutes)
}
