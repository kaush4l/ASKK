import { expect, test } from "bun:test"
import { STATUS_LIMIT, deskBriefs, elapsed, parseReport, renderStatus, runOutcome, teamBlocks } from "./kernel-status.js"
import { T0, artifact, failure, finished, quest, report, tree, wave1, withError } from "./kernel-status.fixtures.js"
import { agentVisual } from "../../backend/live/visual.js"
import { agentVisual as uiVisual } from "../../backend/live/desk.js"

// The live status text from fixture snapshots (kernel-status.fixtures.js): a run in wave 1, a run with
// an error, a finished run. Phone-sized, curated, escaped.

const show = (f, phase = "live") => renderStatus({ desk: "demo-desk", ...f, run: { phase, endedAt: f.endedAt, touched: f.touched } })
const plain = (html) => html.replace(/<[^>]+>/g, "")

test("wave 1: who works on what, reported teams in one line, the rest collapsed", () => {
  const text = show(wave1())
  const lines = text.split("\n")
  expect(lines[0]).toBe("<b>demo-desk</b> · LIVE 4m")
  expect(lines[1]).toStartWith("<i>Read the market and plan today's one best-odds play")
  expect(lines[2]).toBe("⏳ <b>head</b> — waiting for news, trend, search · ☑ 1/7")
  expect(text).toContain("⏳ <b>News</b> · 1/3 in\n├ 🔧 wire — market.news\n├ ✅ calendar — CPI 08:30 ET printed hot, +0.4% m/m vs +0.3%\n└ 💭 macro — thinking")
  expect(text).toContain("✅ <b>Trend</b> — RANGE / CALM, side NONE until the opening range breaks · conf 0.30")
  expect(text).not.toContain("daily") // a reported team hides its members
  expect(text).toContain("💭 <b>Search</b> · lead writing · 1/2 in\n├ ✅ movers — THETA +1.2 ATR, DELTA -0.9 ATR, EPSI +0.7 ATR\n└ 1 waiting to start")
  // Not started this run: an old report (price-lead) and an old error (grader) do not count.
  expect(text).toContain("▫️ Not started: Price, Case, Review")
  expect(text).not.toContain("old price verdict")
  expect(text).not.toContain("old failure")
  // Footer: the desk-level artifacts by id, escaped, none changed yet this run: all "earlier".
  expect(text.split("\n\n").at(-1)).toBe(
    ["Book: equity $10,000 · flat (earlier)", "Next run: next 12:45 ET: the midday check (earlier)", "Top 5: Yesterday: no side &amp; no names &lt;pre-open&gt;. (earlier)"].join("\n"),
  )
  expect(text.length).toBeLessThan(STATUS_LIMIT)
  expect(text).not.toMatch(/[{}]|EVIDENCE|FALSIFIER|market\.quote\(/) // no JSON, no tool payloads, no report body
})

test("a run with an error: the failed agent is shown, its text escaped", () => {
  const text = show(withError())
  expect(text).toContain("<b>demo-desk</b> · LIVE 5m")
  expect(text).toContain("⏳ <b>head</b> — waiting for news, price · ☑ 2/7")
  expect(text).toContain("🔧 <b>News</b> · lead news.board.write · 2/3 in")
  expect(text).toContain("└ ❌ macro — error: model timeout &lt;500&gt; &amp; retry failed")
  expect(text).toContain("✅ <b>Search</b> — THETA, DELTA, EPSI are the 3 fastest · conf 0.60")
  expect(text).toContain("⏳ <b>Price</b> · 0/2 in\n├ 🔧 levels — 3 calls: market.levels, market.quote, market.chain\n└ 💭 quotes — thinking")
  expect(text).toContain("▫️ Not started: Case, Review")
  expect(text).not.toContain("old price verdict") // price-lead works again: only this run's messages count
  // Every tag is one of ours and closed: the HTML is safe to send.
  expect(text.replace(/<\/?(b|i)>/g, "")).not.toMatch(/[<>]/)
})

test("a finished run: outcome, every team's verdict, the desk's artifacts", () => {
  const f = finished()
  const text = show(f, "done")
  const lines = text.split("\n")
  expect(lines[0]).toBe("<b>demo-desk</b> · DONE in 7m 40s · via schedule")
  expect(lines[2]).toBe("✅ <b>head</b> — TRADE: DELTA 0DTE 118P on a break of 118.40 — hot CPI, trend down, 61% reach · ☑ 7/7")
  for (const team of ["News", "Trend", "Search", "Price", "Case"]) expect(text).toMatch(new RegExp(`^✅ <b>${team}</b> — .+ · conf 0\\.\\d\\d$`, "m"))
  expect(text).toContain("▫️ Not run: Review")
  expect(text).toContain("\n\nBook: equity $10,000 · flat\nNext run: next 12:45 ET: the midday check\nTop 5: DELTA ↑ 0.92 · AMD ↑ 0.81")
  expect(text).not.toContain("(earlier)") // only a live run marks them
  // Not desk-level: boards, memories, checklists, quality, another team's; nor an empty brief.
  expect(text).not.toMatch(/Desk board|Memory|Run checklist|Quality|News notes|Calibration/)
  expect(text).not.toMatch(/├|└/) // nothing works: no member lines
})

test("stopped and failed runs say so in the header and the lead's line", () => {
  const f = wave1()
  f.states.head = { ...f.states.head, status: "error", activity: { phase: "idle" }, messages: [...f.states.head.messages, failure(300, "stopped")] }
  const stopped = show({ ...f, endedAt: T0 + 300_000 }, "done")
  expect(stopped.split("\n")[0]).toBe("<b>demo-desk</b> · STOPPED in 5m 00s")
  expect(stopped).toContain("⏹ <b>head</b> — stopped by the owner")
  f.states.head.messages.push(failure(310, "model down"))
  expect(runOutcome(f, T0)).toEqual({ kind: "error", text: "model down" })
  expect(show({ ...f, endedAt: T0 + 310_000 }, "done")).toContain("❌ <b>head</b> — error: model down")
})

test("idle: the last run, its age", () => {
  const f = finished()
  const text = renderStatus({ desk: "demo-desk", ...f, now: T0 + 3 * 3600_000, run: { phase: "idle" } })
  expect(text.split("\n")[0]).toBe("<b>demo-desk</b> · IDLE · last run 3h 00m ago")
  expect(text).toContain("✅ <b>head</b> — TRADE: DELTA 0DTE 118P")
})

test("over the limit it collapses, then cuts whole lines; never past the limit", () => {
  const f = withError()
  const long = "x".repeat(400)
  // Every agent at work with long tool names, every lead with a long verdict on the way.
  for (const [name, s] of Object.entries(f.states)) {
    if (name === "head" || name.endsWith("-lead")) continue
    f.states[name] = { ...s, status: "running", activity: { phase: "tools", names: [`${long}.a`, `${long}.b`] }, messages: [quest(20, "go")], working: { request: null, at: new Date(T0).toISOString() } }
  }
  for (const name of Object.keys(f.states)) if (name.endsWith("-lead")) f.states[name] = { ...f.states[name], status: "running", activity: { phase: "waiting", names: ["a"] }, messages: [quest(10, "go")] }
  const full = show(f) // 13 agents at work: every member line still fits
  expect(full.length).toBeLessThanOrEqual(STATUS_LIMIT)
  expect(full).toContain("├ 🔧 wire — 2 calls: xxx")
  const text = renderStatus({ desk: "demo-desk", ...f, limit: 900, run: { phase: "live" } })
  expect(text.length).toBeLessThanOrEqual(900)
  expect(text.split("\n")[0]).toBe("<b>demo-desk</b> · LIVE 5m")
  expect(text).toContain("<b>head</b>")
  expect(text).toContain("⏳ <b>News</b> · 0/3 in\n└ 3 working") // member lines collapsed into counts
  expect(text).toContain("Top 5: Yesterday: no side")
  const tiny = renderStatus({ desk: "demo-desk", ...f, limit: 300, run: { phase: "live" } })
  expect(tiny.length).toBeLessThanOrEqual(300)
  expect(tiny).toEndWith("\n…")
  expect(plain(tiny)).not.toMatch(/[<>]/) // whole lines only: no half tag
})

test("desk-level artifacts: the desk team's own, not boards/memories/checklists/quality, by id, briefs only", () => {
  const all = wave1().kernel.artifacts
  expect(deskBriefs(all, "desk").map((a) => a.id)).toEqual(["desk.book", "desk.next", "desk.top5"])
  expect(deskBriefs(all, "desk")[0]).toEqual({ id: "desk.book", title: "Book", brief: "equity $10,000 · flat" })
  expect(deskBriefs(Object.values(all), "news").map((a) => a.id)).toEqual(["news.notes"]) // a list works too
  expect(deskBriefs(all, null).map((a) => a.id)).toEqual(["desk.book", "desk.next", "desk.top5", "news.notes"]) // no team: every owner's
  expect(deskBriefs(null, "desk")).toEqual([])
  // Any kind the desk keeps shows; a multi-line brief is one line; no title: the id.
  const odd = { "desk.zz": artifact("desk.zz", "anything", "desk", "", "line one\n  line two") }
  expect(deskBriefs(odd, "desk")).toEqual([{ id: "desk.zz", title: "desk.zz", brief: "line one line two" }])
  // A desk with another team name: its own artifacts, by tree.team.
  const f = finished()
  const renamed = { ...f.kernel, tree: { ...tree, team: "news" } }
  const text = renderStatus({ desk: "demo-desk", ...f, kernel: renamed, run: { phase: "done", endedAt: f.endedAt } })
  expect(text).toContain("News notes: a team's own: not desk-level")
  expect(text).not.toContain("Top 5:")
})

test("teams from the tree: a node with agents leads a team; nested teams fold into their parent", () => {
  expect(teamBlocks(tree, "head").map((b) => [b.title, b.lead, b.members.length])).toEqual([
    ["News", "news-lead", 3],
    ["Trend", "trend-lead", 3],
    ["Search", "search-lead", 2],
    ["Price", "price-lead", 2],
    ["Case", "case-lead", 2],
    ["Review", "review-lead", 2],
  ])
  const leaf = (name) => ({ name, team: null, title: null, agents: [] })
  const nested = { name: "boss", team: "top", agents: [leaf("solo"), { name: "a-lead", team: "a", title: "", agents: [leaf("a1"), { name: "b-lead", team: "b", title: "B", agents: [leaf("b1")] }] }] }
  expect(teamBlocks(nested, "boss")).toEqual([
    { title: "Desk", lead: null, members: ["solo"] },
    { title: "a", lead: "a-lead", members: ["a1", "b-lead", "b1"] },
  ])
  expect(teamBlocks(null, "boss", { boss: {}, x: {} })).toEqual([{ title: "Team", lead: null, members: ["x"] }])
})

test("reports: VERDICT and CONFIDENCE, or the first line", () => {
  expect(parseReport(report(0, "RANGE / CALM", 0.3).content)).toEqual({ verdict: "RANGE / CALM", confidence: 0.3 })
  expect(parseReport("**VERDICT:** up\n- **CONFIDENCE:** 0.7 (thin)")).toEqual({ verdict: "up", confidence: 0.7 })
  expect(parseReport("\nJust an answer.\nMore.")).toEqual({ verdict: "Just an answer.", confidence: null })
  const f = wave1()
  f.states.wire = { ...f.states.wire, activity: { phase: "tools", names: ["market.quote", "market.quote", "market.news"] } }
  expect(show(f)).toContain("├ 🔧 wire — 3 calls: market.quote ×2, market.news")
  f.states.wire = { ...f.states.wire, activity: { phase: "tools", names: ["market.quote", "market.quote"] } }
  expect(show(f)).toContain("├ 🔧 wire — market.quote ×2")
  expect(elapsed(0, 59_000)).toBe("<1m")
  expect(elapsed(0, 125_000, { seconds: true })).toBe("2m 05s")
  expect(elapsed(0, 3_725_000)).toBe("1h 02m")
})

test("the server and the web UI read one agentVisual (desk.js re-exports visual.js)", () => {
  expect(uiVisual).toBe(agentVisual)
  const states = [
    null,
    { status: "running", activity: { phase: "llm", stage: "thinking" }, messages: [] },
    { status: "running", activity: { phase: "llm", stage: "responding" }, messages: [] },
    { status: "running", activity: { phase: "llm", stage: "waiting" }, messages: [] },
    { status: "running", activity: { phase: "tool", name: "market.quote" }, messages: [] },
    { status: "running", activity: { phase: "tools", names: ["a", "b"] }, messages: [] },
    { status: "running", activity: { phase: "tools", names: ["news", "trend"] }, messages: [] },
    { status: "running", activity: { phase: "waiting", names: ["news"] }, messages: [] },
    { status: "running", activity: { phase: "agent", name: "news" }, messages: [] },
    { status: "running", activity: { phase: "approval", name: "x" }, messages: [] },
    { status: "running", activity: { phase: "idle" }, messages: [] },
    { status: "error", error: "boom", activity: {} },
    { status: "idle", activity: { phase: "idle" }, messages: [{ action: "answer", content: "NO TRADE ".repeat(30) }] },
    { status: "idle", activity: { phase: "idle" }, messages: [] },
  ]
  for (const s of states) expect(agentVisual(s, ["news", "trend"])).toEqual(uiVisual(s, ["news", "trend"]))
})

test("the first minute's '<1m' is escaped (Telegram refused it as a tag, 10-15)", () => {
  const f = wave1()
  const text = renderStatus({ desk: "demo-desk", ...f, now: T0 + 20_000, run: { phase: "live" } })
  expect(text.split("\n")[0]).toBe("<b>demo-desk</b> · LIVE &lt;1m")
  expect(text).not.toMatch(/<(?!\/?(b|i)>)/)
})
