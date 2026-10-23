import { expect, test } from "bun:test"
import { parsePlot, runnerCall, runnerCharts, runnerForm, runnerGate, runnerRows, runnerStatus, specLine, startRunner, windowText } from "./runners.js"

test("the chart: price-scale plots over the price, the others in the lower panel, fire marks placed", () => {
  const chart = { t: ["10:30", "10:35", "10:40", "10:45"], c: [100, 101, 102, 101.5], plots: { ema: [null, 100.5, 101.2, 101.4], rsi: [50, 60, 72, 65] }, marks: [2] }
  const g = runnerCharts(chart, { width: 100, height: 50, pad: 0 })
  expect(g.over.map((s) => s.name)).toEqual(["ema"])
  expect(g.lower.series.map((s) => s.name)).toEqual(["rsi"])
  expect(g.price.d.startsWith("M0.0,50.0")).toBe(true) // the low at the bottom left
  expect(g.over[0].d.startsWith("M33.3")).toBe(true) // its warm-up skipped
  expect(g.marks).toEqual([{ x: (2 / 3) * 100, at: "10:40" }])
  expect([g.first, g.last, g.price.last.v]).toEqual(["10:30", "10:45", 101.5])
  expect(runnerCharts({ c: [] })).toBeNull()
})

test("each runner's state in a word, the holding and near ones first", () => {
  const base = { status: "running", warn: 2 }
  expect(runnerStatus({ ...base, last: { cond: true } })).toMatchObject({ word: "holds", tone: "holds" })
  expect(runnerStatus({ ...base, last: { cond: false, prox: { gap: 0.4, pace: -0.2, eta: 2 } } })).toMatchObject({ word: "near", detail: "0.4 to go · ≈2 bars" })
  expect(runnerStatus({ ...base, last: { cond: false, prox: { gap: 3, pace: 0.1, eta: null } } })).toMatchObject({ tone: "running", detail: "3 to go · moving away" })
  expect(runnerStatus({ ...base, last: { warming: "4/22 bars" } })).toMatchObject({ word: "warming", detail: "4/22 bars" })
  expect(runnerStatus({ status: "fired", fires: [{ kind: "fire", at: "2026-10-20T14:35:00Z" }] })).toMatchObject({ word: "fired", detail: "at 10:35 ET" })
  const rows = runnerRows({ runners: [{ id: "a", status: "paused" }, { id: "b", ...base, last: { cond: true } }, { id: "c", ...base, last: { cond: false } }] })
  expect(rows.map((x) => x.r.id)).toEqual(["b", "c", "a"])
  expect(parsePlot("ema9=ema(close, 9); hi: highest(high, 20)\nbad")).toEqual({ ema9: "ema(close, 9)", hi: "highest(high, 20)" })
})

// The desk's twins (custom/trading-team tests, qqq-nflx-cool): a runner on 10-21 10:15–11:00 gated on NFLX. Before the
// fix every one of these read "holds" in green, because the status keyed on last.cond alone.
test("a windowed, gated runner: sleeps, held, holds only when the gate holds too, window closed past until", () => {
  const r = { status: "running", warn: 2, symbol: "QQQ", when: "cross_below(close, 717.2)", gate: { symbol: "NFLX", when: "close < 62.1" }, on: "2026-10-21", from: "10:15", until: "11:00" }
  const at = (iso) => new Date(iso)
  // 15:30 on 10-20: the cross is true on an observed read, the runner sleeps until its day
  const asleep = { ...r, last: { cond: true, effective: false, observed: true, sleeping: "10-21 10:15" } }
  expect(runnerStatus(asleep, at("2026-10-20T19:30:00Z"))).toEqual({ word: "sleeps", tone: "paused", detail: "until 10-21 10:15" })
  expect(runnerStatus(asleep, at("2026-10-21T14:05:00Z"))).toMatchObject({ word: "sleeps", detail: "until 10:15" }) // its day, before from
  // a twin without on/from (saved by a desk whose clock the tab does not share): last.sleeping says it
  expect(runnerStatus({ status: "running", last: { cond: true, sleeping: "10:15" } })).toMatchObject({ word: "sleeps", detail: "until 10:15" })
  // 10:20 on 10-21: the cross holds, the gate is false — held, never "holds"
  const held = { ...r, last: { cond: true, effective: false, gate: { cond: false, value: 63.4 }, held: "gate false: NFLX close 63.4", sleeping: null } }
  expect(runnerStatus(held, at("2026-10-21T14:20:00Z"))).toEqual({ word: "held", tone: "running", detail: "gate false: NFLX close 63.4" })
  // cond true but effective false without a held line (an older twin): still held, from the gate it read
  expect(runnerStatus({ ...r, last: { cond: true, effective: false, gate: { cond: null, value: null } } }, at("2026-10-21T14:20:00Z"))).toMatchObject({ word: "held", detail: "gate unread: NFLX close —" })
  // both hold on the same bar
  expect(runnerStatus({ ...r, last: { cond: true, effective: true, gate: { cond: true, value: 61.9 } } }, at("2026-10-21T14:30:00Z"))).toMatchObject({ word: "holds", tone: "holds" })
  // a runner saved before gates carries cond alone: it still holds
  expect(runnerStatus({ status: "running", last: { cond: true } })).toMatchObject({ word: "holds" })
  // past until on its day (resumed, or the owner's "now"): it reads, never fires
  const late = { ...r, last: { cond: true, effective: true, gate: { cond: true, value: 61.9 } } }
  expect(runnerStatus(late, at("2026-10-21T15:05:00Z"))).toEqual({ word: "window closed", tone: "paused", detail: "at 11:00 · reads, never fires" })
  expect(runnerStatus(late, at("2026-10-22T14:00:00Z"))).toMatchObject({ word: "window closed", detail: "10-21 has passed · reads, never fires" })
  expect(runnerStatus({ status: "running", until: "11:30", last: { cond: false } }, at("2026-10-21T15:05:00Z"))).toMatchObject({ word: "watching" }) // no on: today's window still open
  expect(runnerStatus({ ...late, status: "expired" })).toMatchObject({ word: "expired", tone: "done", detail: "at 11:00 ET" })
  // the held and sleeping ones never rank with the holding ones
  const rows = runnerRows({ runners: [{ id: "s", ...asleep, on: "2026-10-22" }, { id: "h", ...held }, { id: "x", status: "running", last: { cond: true } }] }, at("2026-10-21T14:20:00Z"))
  expect(rows.map((x) => [x.r.id, x.s.word])).toEqual([["x", "holds"], ["h", "held"], ["s", "sleeps"]])
})

test("the window and the gate as the card draws them", () => {
  expect(windowText({ on: "2026-10-21", from: "10:15", until: "11:00" })).toBe("on 10-21 · from 10:15 · until 11:00")
  expect(windowText({ until: "11:30" })).toBe("until 11:30")
  expect(windowText({})).toBe("")
  expect(runnerGate({ last: { cond: true } })).toBeNull()
  const gate = { symbol: "NFLX", when: "close < 62.1" }
  expect(runnerGate({ gate, last: { gate: { cond: false, value: 63.4 } } })).toEqual({ symbol: "NFLX", when: "close < 62.1", value: 63.4, holds: false, word: "false" })
  expect(runnerGate({ gate, last: { gate: { cond: true, value: 61.9 } } })).toMatchObject({ holds: true, word: "holds" })
  expect(runnerGate({ gate, last: { gate: { cond: null, value: null } } })).toMatchObject({ holds: null, word: "unread" })
  expect(runnerGate({ gate })).toMatchObject({ value: null, holds: null, word: "not read yet" })
})

test("the owner's calls go to the artifact", async () => {
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ ok: true, value: { runner: "x" } }), { headers: { "content-type": "application/json" } })
  }
  try {
    await runnerCall("lab.runners", "pause", "orb-up")
    await startRunner("lab.runners", { id: "x", symbol: "ABC", when: "close > 1" })
    expect(calls.map((c) => c.body)).toEqual([
      { target: "artifact", method: "pause", args: [{ id: "lab.runners", runner: "orb-up" }] },
      { target: "artifact", method: "start", args: [{ id: "lab.runners", spec: { id: "x", symbol: "ABC", when: "close > 1" } }] },
    ])
  } finally {
    globalThis.fetch = realFetch
  }
})

// 2026-10-22: kernel Runners (backend/kernel/builtin/runners.js) — a watcher's own run state on the same card
import { checkLine } from "./runners.js"

test("a kernel runner: the check line, error, paused and waiting words", () => {
  const base = { id: "spy", status: "running", checks: 3, checked_at: "2026-10-22T14:03:00Z", next_at: "2026-10-22T14:04:00Z", errors: 0, last: { value: 771.4, against: 772.5, cond: false } }
  expect(checkLine(base)).toBe("check #3 · 10:03 ET · next 10:04 · now 771.4 vs 772.5")
  expect(checkLine({ id: "x" })).toBe("")
  expect(runnerStatus({ ...base, status: "error", error: "quote failed" })).toMatchObject({ word: "error", tone: "error", detail: "quote failed" })
  expect(runnerStatus({ ...base, status: "paused", paused_why: "CPI" })).toMatchObject({ word: "paused", detail: "CPI" })
  expect(runnerStatus({ ...base, last: { ...base.last, waiting: "after qqq-bounce fires" } })).toMatchObject({ word: "waiting", detail: "after qqq-bounce fires" })
  expect(runnerStatus({ ...base, last: { value: null, cond: null, note: "outside 10:00–14:30 ET" } })).toMatchObject({ word: "resting", detail: "outside 10:00–14:30 ET" })
})

test("the card's spec line has only the parts a runner has; the form only where the artifact takes start or test", () => {
  expect(specLine({ symbol: "SPY", interval: 5, source: "robinhood", every: "bar" })).toBe("SPY · 5m · robinhood · each bar")
  expect(specLine({ every: 1 })).toBe("every 1m") // a kernel runner: no symbol, interval or source
  expect(specLine({})).toBe("")
  expect(runnerForm({ runners: [] })).toBeNull() // the kernel's Runners say nothing: pause … remove only
  expect(runnerForm({ can: { start: true } })).toEqual({ start: true, test: false })
  expect(runnerForm({ can: { start: false, test: false } })).toBeNull()
})

test("a kernel runner (it counts checks) moving away: negative pace; its eta in checks (2026-10-23)", () => {
  const k = { id: "k", status: "running", checks: 4 }
  expect(runnerStatus({ ...k, last: { cond: false, prox: { gap: 3, pace: -0.5, eta: null } } }).detail).toBe("3 to go · moving away")
  expect(runnerStatus({ ...k, last: { cond: false, prox: { gap: 3, pace: 1, eta: 3 } } }).detail).toBe("3 to go · ≈3 checks")
})

import { endsText, fireLine } from "./runners.js"

test("a kernel runner's end and its fires' values; absent parts say nothing (2026-10-23)", () => {
  const now = new Date("2026-10-23T14:00:00Z") // 10:00 ET
  expect(endsText({ ends_at: "2026-10-23T19:55:00Z" }, now)).toBe("until 15:55 ET")
  expect(endsText({ ends_at: "2026-10-24T19:55:00Z" }, now)).toBe("until 15:55 ET on 10-24")
  expect(endsText({ ends_at: "2026-10-23T19:55:00Z", until: "15:55" }, now)).toBe("") // the window line says it
  expect(endsText({}, now)).toBe("")
  expect(fireLine({ at: "2026-10-23T14:41:00Z", kind: "fire", price: 771.4, value: 772.5 })).toBe("fired 10:41 @771.40 · value 772.50")
  expect(fireLine({ at: "2026-10-23T14:41:00Z", kind: "fire", price: null, value: 3 })).toBe("fired 10:41 · value 3.000")
  expect(fireLine({ at: "2026-10-23T14:41:00Z", kind: "warn", price: 12.5 })).toBe("heads-up 10:41 @12.50")
  // a kernel runner has none of a desk's fields: the spec line and the window line are empty
  const k = { id: "k", when: "x > 1", checks: 2, status: "running", last: null, fires: [] }
  expect(specLine(k)).toBe("")
  expect(windowText(k)).toBe("")
  expect(runnerGate(k)).toBeNull()
})
