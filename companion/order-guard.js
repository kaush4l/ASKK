// The hard limits on real-money option orders an agent places through MCP
// (robinhood.place_option_order). Checked in the host before the call reaches
// the broker, from .env (which agents can never write), so no prompt, skill or
// rail an agent can edit can loosen them. Closed by default.
//
//   ASKK_ORDERS=live                  real orders; "paper": the same checks, the paper
//                                     broker fills them (companion/paper-broker.js);
//                                     anything else: every place_option_order is refused
//   ASKK_ORDER_ACCOUNT=<number>       the only account orders may use
//   ASKK_ORDER_MAX_QTY=1              contracts (or spreads) per order
//   ASKK_ORDER_MAX_DEBIT=350          USD per opening order: price × quantity × 100
//   ASKK_ORDER_MAX_DAY_DEBIT=700      USD of opening orders per day (America/New_York)
//   ASKK_ORDER_MAX_PER_DAY=3          opening orders per day
//   ASKK_ORDER_OPEN_WINDOW=09:45-14:30   ET; opening orders only inside it
//   ASKK_ORDER_DAY_STOP_PCT=25        no opening orders once the account is down this
//                                     much from its start-of-day equity (companion/book.js)
//
// Opening (any leg position_effect "open"): a limit order paying a debit —
// one bought leg, or a spread whose sold legs are matched by bought legs (no
// naked short). Closing (every leg "close"): always allowed, so an exit is
// never blocked. Mixed open/close (rolls) are refused. Every attempt, allowed
// or refused, is a row in <runtime>/orders.jsonl, which also holds the day's
// count (outside the workspace, so agents cannot edit it).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

const ZONE = "America/New_York"
const GUARDED = new Set(["robinhood.place_option_order"])

const day = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
const clock = (now) => new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(now)

export function orderLimits(env = process.env) {
  const number = (name, fallback) => {
    const value = Number(env[name])
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  const [from, to] = (env.ASKK_ORDER_OPEN_WINDOW ?? "09:45-14:30").split("-").map((s) => s.trim())
  return {
    live: env.ASKK_ORDERS === "live" || env.ASKK_ORDERS === "paper",
    mode: env.ASKK_ORDERS === "paper" ? "paper" : env.ASKK_ORDERS === "live" ? "live" : "off",
    account: env.ASKK_ORDER_ACCOUNT?.trim() || null,
    maxQty: number("ASKK_ORDER_MAX_QTY", 1),
    maxDebit: number("ASKK_ORDER_MAX_DEBIT", 350),
    maxDayDebit: number("ASKK_ORDER_MAX_DAY_DEBIT", 700),
    maxPerDay: number("ASKK_ORDER_MAX_PER_DAY", 3),
    window: { from, to },
  }
}

// Throws (status 403) with the reason, or returns { opening, debit } for an allowed order.
export function checkOrder(args = {}, { limits = orderLimits(), log = [], now = new Date() } = {}) {
  const refuse = (reason) => {
    throw Object.assign(new Error(`Order refused by the ASKK order guard: ${reason}`), { status: 403 })
  }
  if (!limits.live) refuse("live orders are off (ASKK_ORDERS is not \"live\" or \"paper\" in .env).")
  if (!limits.account || String(args.account_number ?? "").trim() !== limits.account) {
    refuse(`only account ${limits.account ?? "(none set: ASKK_ORDER_ACCOUNT)"} may be used.`)
  }
  const legs = Array.isArray(args.legs) ? args.legs : []
  if (!legs.length) refuse("no legs.")
  const effects = new Set(legs.map((l) => l.position_effect))
  if (effects.size !== 1 || !["open", "close"].includes([...effects][0])) refuse("every leg must be open, or every leg close (no rolls).")
  const quantity = Number(args.quantity)
  if (!Number.isInteger(quantity) || quantity < 1) refuse("quantity must be a positive whole number.")
  if (quantity > limits.maxQty) refuse(`quantity ${quantity} is over ${limits.maxQty}.`)
  if ([...effects][0] === "close") return { opening: false, debit: 0 }

  // Opening: a limit debit, long premium only.
  if ((args.type ?? "limit") !== "limit") refuse("opening orders must be limit orders.")
  const price = Number(args.price)
  if (!(price > 0)) refuse("opening orders need a limit price.")
  const ratio = (l) => Number(l.ratio_quantity ?? 1)
  const bought = legs.filter((l) => l.side === "buy").reduce((n, l) => n + ratio(l), 0)
  const sold = legs.filter((l) => l.side === "sell").reduce((n, l) => n + ratio(l), 0)
  if (!bought) refuse("an opening order must buy.")
  if (sold > bought) refuse("more contracts sold than bought (naked short).")
  if (legs.length > 1 && args.direction !== "debit") refuse("a spread must be a debit.")
  if (legs.length === 1 && legs[0].side !== "buy") refuse("a single-leg opening order must be a buy.")

  const time = clock(now)
  if (time < limits.window.from || time > limits.window.to) refuse(`opening orders only ${limits.window.from}-${limits.window.to} ET (now ${time}).`)
  const debit = Math.round(price * quantity * 100 * 100) / 100
  if (debit > limits.maxDebit) refuse(`debit $${debit} is over $${limits.maxDebit} per order.`)
  const today = day(now)
  const opened = log.filter((r) => r.allowed && r.opening && r.day === today)
  if (opened.length >= limits.maxPerDay) refuse(`${opened.length} opening orders today; the limit is ${limits.maxPerDay}.`)
  const spent = opened.reduce((n, r) => n + (r.debit ?? 0), 0)
  if (spent + debit > limits.maxDayDebit) refuse(`$${spent} already opened today; $${debit} more is over $${limits.maxDayDebit}.`)
  return { opening: true, debit }
}

export function readOrderLog(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}

// Wraps an MCP call function: guarded tools are checked and logged first.
// beforeOpen(): async, throws to refuse an opening order (the book's day stop).
export function guardOrders(call, { logPath, env = process.env, beforeOpen = null } = {}) {
  return async (server, tool, args) => {
    if (!GUARDED.has(`${server}.${tool}`)) return call(server, tool, args)
    const now = new Date()
    const row = { at: now.toISOString(), day: day(now), tool: `${server}.${tool}`, args }
    const write = (extra) => {
      if (!logPath) return
      mkdirSync(dirname(logPath), { recursive: true })
      appendFileSync(logPath, `${JSON.stringify({ ...row, ...extra })}\n`)
    }
    let verdict
    try {
      const limits = orderLimits(env)
      verdict = checkOrder(args, { limits, log: logPath ? readOrderLog(logPath) : [], now })
      if (verdict.opening && beforeOpen) await beforeOpen()
      if (limits.mode === "paper") row.paper = true
    } catch (error) {
      write({ allowed: false, reason: error.message })
      throw error
    }
    write({ allowed: true, ...verdict })
    try {
      const result = await call(server, tool, args)
      write({ result: "sent", isError: Boolean(result?.isError) })
      return result
    } catch (error) {
      write({ result: "failed", error: error.message })
      throw error
    }
  }
}
