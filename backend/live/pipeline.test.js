import { expect, test } from "bun:test"
import { pipelineView, sourceChips, took } from "./pipeline.js"

test("view: progress, live elapsed for a running stage, chips newest first, the result and what waits", () => {
  const now = Date.parse("2026-10-21T12:20:00Z")
  const v = pipelineView(
    {
      status: "running",
      run: { id: "r1", by: "desk: schedule 08:15", started: "2026-10-21T12:15:00Z" },
      stages: [
        { id: "evidence", n: 1, status: "done", ms: 95000, tools: 3, sources: [{ name: "WebSearch", query: "ABC news" }, { name: "WebFetch", url: "https://news.example.org/x" }] },
        { id: "pattern", n: 2, status: "running", started: "2026-10-21T12:19:30Z", sources: [] },
      ],
      card: { decision: "GO", text: "DECISION: GO", problems: [], levels: [] },
      learnings: { pending: [{ id: "L1", text: "t" }], accepted: 2 },
      watch: { hits: [{ symbol: "ABC", kind: "entry", price: 772.5, side: "above", px: 772.6, hm: "10:02" }] },
    },
    { now },
  )
  expect(v.run.elapsed).toBe("5m00s")
  expect(v.stages[0]).toMatchObject({ elapsed: "1m35s", tools: 3 })
  expect(v.stages[0].chips.map((c) => c.label)).toEqual(["news.example.org", "ABC news"])
  expect(v.stages[1].elapsed).toBe("30s")
  expect(v.result.decision).toBe("GO")
  expect(v.pending).toHaveLength(1)
  expect(v.events[0]).toContain("ABC entry 772.5 crossed (above) at 772.6")
})

test("chips: capped with a count; a page link only for http(s)", () => {
  const { chips, more } = sourceChips([...Array(9)].map((_, i) => ({ url: i ? `https://s${i}.com` : "javascript:x" })), 6)
  expect(chips).toHaveLength(6)
  expect(more).toBe(3)
  expect(sourceChips([{ url: "javascript:x" }]).chips[0].href).toBeNull()
  expect(took(61000)).toBe("1m01s")
  expect(pipelineView(null).status).toBe("idle")
})

test("runtime view: the workflow folder as config rows, each stage's flow in and out", async () => {
  const { configView, flowOf, size } = await import("./pipeline.js")
  const c = configView({
    folder: "workflow/",
    settings: { deadline_minutes: 55, retries: 1, note_stage: "ledger", mirror: null, critical: ["evidence"], past_deadline: [], slots: [{ at: "08:15", from: null, full_day: false }, { at: "16:15", from: "ledger", full_day: true }] },
    steps: [
      { file: "01-state.md", id: "state", kind: "code", code: "state", after: [], inputs: [] },
      { file: "04-regime.md", id: "regime", kind: "research", after: ["pattern"], inputs: ["note", "pattern"], schema: "regime", derive: "regime", model: "default", max_turns: 10, seconds: 480 },
    ],
  })
  expect(c.settings).toEqual(["deadline 55 min", "retries 1", "note ledger", "no mirror", "critical evidence", "never skipped none", "08:15 ET full run", "16:15 ET from ledger (not half days)"])
  expect(c.steps[0]).toMatchObject({ runs: "code: state", waits: null, contract: null })
  expect(c.steps[1]).toMatchObject({ runs: "10 turns · 480s", waits: "pattern", reads: "note, pattern", contract: "schema regime · derive" })
  expect(configView({ folder: "workflow/", settings: null, steps: [], error: "04-regime.md: schema nope" }).error).toContain("schema nope")
  const f = flowOf({ in: [{ kind: "rules", from: "rules.md", chars: 900 }, { kind: "state", from: "state", chars: 300 }, { kind: "data", from: "evidence", chars: 1200 }, { kind: "data", from: "pattern", chars: 800 }, { kind: "document", from: "pattern", chars: 5000 }], prompt_chars: 12345, out: { text_chars: 4200, data: ["regime"], code: ["bias"] } })
  expect(f.in.map((g) => `${g.kind}:${g.from.join("+")}`)).toEqual(["state:state", "data:evidence+pattern", "document:pattern", "rules:rules.md"])
  expect(f.in[1].chars).toBe(2000)
  expect(f).toMatchObject({ prompt: "12k", out: { text: "4.2k", data: ["regime"], code: ["bias"] } })
  expect(flowOf(null)).toBeNull()
  expect(size(840)).toBe("840")
})

test("theses: each in a line — claim, target, the levels that break it, code's last verdict; the track", async () => {
  const { thesesView, flowOf } = await import("./pipeline.js")
  const v = thesesView({
    open: [{ id: "t1", symbol: "QQQ", side: "DOWN", target: { op: "BELOW", level: 716 }, falsify: [{ symbol: "SMH", op: "ABOVE", level: 556.7 }], horizon_days: 3, opened: "2026-10-21", claim: "c", status: "open", last: { date: "2026-10-22", result: "pending", px: { QQQ: 719 } } }],
    closed: [{ id: "t0", symbol: "SPY", side: "UP", target: { op: "ABOVE", level: 780 }, falsify: [], horizon_days: 1, opened: "2026-10-20", claim: "d", status: "falsified", last: null }],
    track: { confirmed: 2, falsified: 1 },
  })
  expect(v.open[0]).toMatchObject({ head: "QQQ DOWN · target < 716 · 3 sessions from 2026-10-21", falsify: "SMH > 556.7", last: "2026-10-22 pending (QQQ 719)" })
  expect(v.closed[0]).toMatchObject({ status: "falsified", last: "not scored yet", head: "SPY UP · target > 780 · 1 session from 2026-10-20" })
  expect(v.track).toBe("2 confirmed · 1 falsified · 0 expired · 0 closed")
  expect(thesesView(null)).toBeNull()
  expect(flowOf({ in: [{ kind: "state", from: "state" }, { kind: "carry", from: "carry", chars: 900 }] }).in.map((g) => g.kind)).toEqual(["carry", "state"])
})

test("calibration: per book the overall line and the groups, rates as percentages; empty books say so; theses line", async () => {
  const { calibrationView } = await import("./pipeline.js")
  const c = (n, hits, rate, mean_p, gap) => ({ n, hits, rate, mean_p, gap, tp1: 1, invalidated: 0 })
  const v = calibrationView({
    at: "x",
    predictions: { paper: { all: c(3, 2, 0.667, 0.617, 0.05), by_regime: { RANGE_CHOP: c(2, 1, 0.5, 0.6, -0.1) }, by_playbook: {}, by_mode: {}, by_p: { "0.6–0.7": c(3, 2, 0.667, 0.617, 0.05) } }, real: { all: c(0, 0, null, null, null) } },
    theses: { all: { n: 3, confirmed: 1, falsified: 1, expired: 1, rate: 0.333 }, by_side: { DOWN: { n: 2, rate: 0.5 }, UP: { n: 1, rate: 0 } } },
  })
  expect(v.books[0].all).toMatchObject({ n: 3, rate: "67%", mean_p: "62%", gap: "+5" })
  expect(v.books[0].groups.map((g) => g.title)).toEqual(["regime", "stated p"])
  expect(v.books[0].groups[0].rows[0]).toMatchObject({ label: "RANGE_CHOP", gap: "-10" })
  expect(v.books[1]).toMatchObject({ name: "real", empty: true })
  expect(v.theses).toBe("3 resolved · 33% confirmed (1 confirmed · 1 falsified · 1 expired) · UP 0% of 1 · DOWN 50% of 2")
  expect(calibrationView(null)).toBeNull()
})

test("the calibration gate in one phrase, and the card's gate line", async () => {
  const { gateLine, pipelineView } = await import("./pipeline.js")
  expect(gateLine({ enabled: true, by: ["regime", "playbook"], min_n: 10, book: "auto", min_rate: 0.5, max_gap: 0.15, cap: "WATCH" })).toBe("calibration gate: regime + playbook with ≥ 10 auto calls, hit < 50% or said p 15 over → WATCH")
  expect(gateLine({ enabled: false })).toBe("calibration gate off")
  const v = pipelineView({ stages: [], card: { decision: "WATCH", text: "", problems: [], levels: [], calibration: { state: "cap", reason: "calibration (paper): regime X hit 30% of 12 < 50% — at most WATCH" } } })
  expect(v.result.gate).toContain("at most WATCH")
})

test("live log: today's lines with ET time and kind, oldest first; none → empty", async () => {
  const { logView, pipelineView } = await import("./pipeline.js")
  expect(logView({ date: "2026-10-22", lines: [{ at: "2026-10-22T13:45:07Z", text: "stage 1 evidence started", kind: "stage" }] })).toEqual([{ time: "09:45:07", text: "stage 1 evidence started", kind: "stage" }])
  expect(pipelineView({ stages: [] }).log).toEqual([])
})

test("the report: its text, file and run when the workflow wrote one; none otherwise", async () => {
  const { pipelineView } = await import("./pipeline.js")
  expect(pipelineView({ stages: [], report: { text: "# Trade card", file: "f.md", run: "r1", at: "2026-10-22T12:45:00Z" } }).report).toEqual({ text: "# Trade card", file: "f.md", run: "r1", at: "08:45" })
  expect(pipelineView({ stages: [] }).report).toBeNull()
})

import { configView } from "./pipeline.js"

test("a step agent stage: its config line and its stage's agent link", () => {
  const c = configView({ folder: "workflow/", steps: [{ id: "pattern", kind: "agent", own: true, tools: ["web.search", "market.look"], max_steps: 14, after: [], inputs: [], schema: "pattern" }] })
  expect(c.steps[0].runs).toBe("step agent · tools web.search, market.look · ≤ 14 steps")
  const v = pipelineView({ status: "running", stages: [{ id: "pattern", n: 2, status: "running", agent: "workflow-pattern", refused: 1, started: new Date().toISOString() }] })
  expect(v.stages[0]).toMatchObject({ agent: "workflow-pattern", refused: 1 })
})

test("viewer: which phase it follows, when it re-reads one, the variables as rows", async () => {
  const { followStage, stageKey, varsView, pipelineView } = await import("./pipeline.js")
  const t = (id, status, started = null) => ({ id, status, startedAt: started })
  expect(followStage([t("a", "done"), t("b", "running", "2026-10-22T13:00:00Z"), t("c", "running", "2026-10-22T13:01:00Z"), t("d", "waiting")], true)).toBe("c")
  expect(followStage([t("a", "done"), t("b", "waiting")], true)).toBe("b")
  expect(followStage([t("a", "done"), t("b", "failed"), t("c", "skipped")], false)).toBe("b")
  expect(followStage([t("a", "waiting")], false)).toBe("a")
  expect(followStage([], false)).toBeNull()
  const row = { id: "read", status: "running", tools: 1 }
  expect(stageKey(row)).not.toBe(stageKey({ ...row, tools: 2 }))
  expect(stageKey(row)).not.toBe(stageKey({ ...row, status: "done", file: "/r/01-read.md", ms: 9000 }))
  const rows = varsView([
    { name: "{{date}}", kind: "var", from: "the run", value: "2026-10-22", chars: 10 },
    { name: "{{who}}", kind: "var", from: "the run", value: null, missing: true },
    { name: "market", kind: "market", from: "robinhood", value: { SPY: { last: 760.1 } }, chars: 24 },
    { name: "evidence document", kind: "document", from: "evidence", value: "# Evidence\n\nok", clipped: true, chars: 30000 },
  ])
  expect(rows.map((r) => [r.label, r.size])).toEqual([["template", "10"], ["template", "0"], ["live market", "24"], ["whole document", "30k"]])
  expect(rows[1]).toMatchObject({ missing: true, preview: "not filled by this run" })
  expect(rows[2].text).toContain('"last": 760.1')
  expect(rows[3]).toMatchObject({ markdown: true, clipped: true })
  const v = pipelineView({ status: "running", run: { id: "r2", started: "2026-10-22T13:00:00Z" }, stages: [{ id: "read", n: 1, status: "running", started: "2026-10-22T13:00:05Z", run: null, last: { run: "r1", file: "/r1/01-read.md", status: "done", ms: 65000, at: "2026-10-22T12:00:00Z", head: "old" } }] }, { now: Date.parse("2026-10-22T13:00:35Z") })
  expect(v.stages[0].last).toMatchObject({ run: "r1", took: "1m05s", head: "old" })
  expect(v.stages[0].key).toContain("running")
})

test("a result's price levels: kept by the view, each in a line", async () => {
  const { pipelineView, levelLine } = await import("./pipeline.js")
  const level = { symbol: "SPY", kind: "tp1", side: "above", price: 512.4, path: "the open's drive", active_from: "10:00" }
  const v = pipelineView({ stages: [], card: { decision: "TRADE", text: "DECISION: TRADE", problems: [], levels: [level] } })
  expect(v.result.levels).toEqual([level])
  expect(levelLine(level)).toBe("SPY tp1 512.4 above — the open's drive · from 10:00")
  expect(levelLine({ symbol: "QQQ", kind: "stop", price: 400 })).toBe("QQQ stop 400")
  expect(pipelineView({ stages: [], card: { decision: "PASS", text: "x", problems: [] } }).result.levels).toEqual([])
})
