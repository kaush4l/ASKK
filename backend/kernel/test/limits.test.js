// A model's usage limit (model/limits.js): told apart from a run's own error, with when it resets.

import { expect, test } from "bun:test"
import { limitWait, usageLimit } from "../index.js"

const cli = "claude exited 1: You've hit your session limit · resets 10:10am (America/New_York)"

test("the Claude CLI's session limit: the next 10:10 in New York", () => {
  const now = new Date("2026-10-26T13:40:30Z") // 09:40:30 EDT
  const limit = usageLimit(`HTTP 502 {"error":"${cli}"}`, now)
  expect(limit.until.toISOString()).toBe("2026-10-26T14:10:00.000Z")
  expect(limitWait(limit, now)).toBe(32)
  // past the reset time today: tomorrow's
  expect(usageLimit(cli, new Date("2026-10-26T14:30:00Z")).until.toISOString()).toBe("2026-10-27T14:10:00.000Z")
  expect(usageLimit("resets 3pm (America/New_York) — usage limit", new Date("2026-10-26T13:00:00Z")).until.toISOString()).toBe("2026-10-26T19:00:00.000Z")
})

test("a 429 or overloaded with no reset time: the fallback wait; anything else is no limit", () => {
  expect(usageLimit("HTTP 429 Too Many Requests")).toMatchObject({ until: null })
  expect(usageLimit("anthropic: overloaded_error")).toMatchObject({ until: null })
  expect(limitWait(usageLimit("rate_limit_error"))).toBe(15)
  expect(usageLimit("the card check failed")).toBeNull()
  expect(usageLimit("ENOTFOUND agent.robinhood.com")).toBeNull()
  expect(usageLimit(undefined)).toBeNull()
})
