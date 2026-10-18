// Fixture snapshots of a kernel desk (the team stream's shape: registry, states, kernel) for the live
// status tests: a lead and six teams of a lead + 2–3 members, and the desk's own artifacts beside the
// boards, memories and checklists the status leaves out. Names are made up.

export const T0 = Date.parse("2026-03-02T14:00:00Z") // 09:00 ET
const at = (sec) => new Date(T0 + sec * 1000).toISOString()

const TEAMS = [
  ["news", "News", ["wire", "calendar", "macro"]],
  ["trend", "Trend", ["daily", "intraday", "breadth"]],
  ["search", "Search", ["movers", "scanner"]],
  ["price", "Price", ["levels", "quotes"]],
  ["case", "Case", ["thesis", "risk"]],
  ["review", "Review", ["grader", "critic"]],
]

// The desk's tree as Desk.tree() gives it: a node with agents leads a team; the root is the desk's lead.
const node = (name, { team = null, title = null, goal = null, agents = [], tools = [] } = {}) => ({ name, team, title, goal, model: null, description: `${name} role`, tools, agents })
export const tree = node("head", {
  team: "desk",
  title: "Desk board",
  goal: "One best-odds plan for today, or why none.",
  agents: TEAMS.map(([team, title, members]) => node(`${team}-lead`, { team, title, goal: `${title} goal`, agents: members.map((name) => node(name, { tools: [{ name: "market.quote", type: "function" }] })) })),
})

export const registry = {
  requiredId: "head",
  agents: [
    { name: "head", agents: TEAMS.map(([team]) => team) },
    ...TEAMS.flatMap(([team, , members]) => [{ name: `${team}-lead`, agents: members }, ...members.map((name) => ({ name, agents: [] }))]),
  ],
}

let seq = 0
const id = () => `k${++seq}`
export const quest = (sec, content, from = "head") => ({ id: id(), role: "user", content, from, kind: "quest", at: at(sec) })
export const report = (sec, verdict, confidence) => ({
  id: id(),
  role: "assistant",
  action: "answer",
  at: at(sec),
  content: `VERDICT: ${verdict}\nEVIDENCE: a long list of evidence lines that the status never shows (source, time)\nCONFIDENCE: ${confidence}\nFALSIFIER: what proves it wrong\nGAPS: unknowns`,
})
export const failure = (sec, error) => ({ id: id(), role: "assistant", action: "answer", at: at(sec), content: `Error: ${error}`, error })
const step = (sec, text) => ({ id: id(), role: "assistant", action: "tool", at: at(sec), content: `${text}\nmarket.quote({"symbol":"X"})` })

const idle = (messages = []) => ({ status: "idle", activity: { phase: "idle" }, messages, error: null, working: null })
const running = (activity, messages, sec = 0) => ({ status: "running", activity, messages, error: null, working: { request: messages.find((m) => m.role === "user")?.id ?? null, at: at(sec) } })

const GOAL = "Read the market and plan today's one best-odds play — or say why none. Hand each team ONE goal, in waves."
const yesterday = -86400

function base() {
  const states = {}
  for (const a of registry.agents) states[a.name] = idle()
  // A previous run's leftovers: an old report and an old error must not count for this run.
  states["price-lead"] = idle([quest(yesterday, "price yesterday"), report(yesterday + 60, "old price verdict", 0.4)])
  states.grader = { ...idle([quest(yesterday, "grade"), failure(yesterday + 30, "old failure")]), status: "error", error: "old failure" }
  return states
}

// An artifact as the stream carries it: {id, kind, view, owner, title, holders, brief, state}.
export const artifact = (id, kind, owner, title, brief, state = {}) => ({ id, kind, view: kind, owner, title, holders: ["head"], brief, state })
const checklist = (done) => {
  const items = ["wave1", "price", "case", "review", "board", "plan", "next"].map((name, i) => ({ id: name, text: name, status: i < done ? "done" : "open", note: null }))
  return artifact("head.checklist", "checklist", "desk", "Run checklist", `${done}/7 done`, { items })
}
// briefs: the desk-level artifacts' lines this snapshot shows ({top5, book}).
const artifacts = (done, briefs) => ({
  "head.checklist": checklist(done),
  "head.memory": artifact("head.memory", "memory", "head", "Memory", "12 lessons"),
  "desk.board": artifact("desk.board", "board", "desk", "Desk board", "3 entries", { goal: tree.goal, entries: {} }),
  "desk.quality": artifact("desk.quality", "quality", "desk", "Quality", "4/5 axes"),
  "news.notes": artifact("news.notes", "notes", "news", "News notes", "a team's own: not desk-level"),
  "desk.top5": artifact("desk.top5", "list", "desk", "Top 5", briefs.top5),
  "desk.book": artifact("desk.book", "book", "desk", "Book", briefs.book),
  "desk.calibration": artifact("desk.calibration", "calibration", "desk", "Calibration", ""), // nothing yet: no line
  "desk.next": artifact("desk.next", "schedule", "desk", "Next run", "next 12:45 ET: the midday check"),
})
const earlier = { top5: "Yesterday: no side & no names <pre-open>.", book: "equity $10,000 · flat" }

// Wave 1, 4m10s in: the head waits for news, trend and search; trend has reported.
export function wave1() {
  const s = base()
  s.head = running({ phase: "waiting", names: ["news", "trend", "search"] }, [quest(0, GOAL, null), step(5, "Wave 1: news, trend, search together")], 0)
  s.head.messages[0].from = null
  s["news-lead"] = running({ phase: "waiting", names: ["wire", "macro"] }, [quest(6, "Why today is different")], 6)
  s.wire = running({ phase: "tool", name: "market.news" }, [quest(8, "overnight headlines")], 8)
  s.calendar = idle([quest(8, "today's events"), report(70, "CPI 08:30 ET printed hot, +0.4% m/m vs +0.3%", 0.8)])
  s.macro = running({ phase: "llm", stage: "thinking" }, [quest(8, "cross-asset read")], 8)
  s["trend-lead"] = idle([quest(6, "Which side pays today"), report(200, "RANGE / CALM, side NONE until the opening range breaks", 0.3)])
  for (const m of ["daily", "intraday", "breadth"]) s[m] = idle([quest(9, "read"), report(120, `${m} read`, 0.5)])
  s["search-lead"] = running({ phase: "llm", stage: "responding" }, [quest(6, "The 3 fastest names")], 6)
  s.movers = idle([quest(9, "rank movers"), report(150, "THETA +1.2 ATR, DELTA -0.9 ATR, EPSI +0.7 ATR", 0.6)])
  return { lead: "head", states: s, registry, kernel: { tree, artifacts: artifacts(1, earlier) }, now: T0 + 250_000 }
}

// The same run, wave 2, with errors: macro failed (text with HTML characters), price works.
export function withError() {
  const w = wave1()
  const s = w.states
  s.macro = { ...idle([quest(8, "cross-asset read"), failure(260, "model timeout <500> & retry failed")]), status: "error", error: "model timeout <500> & retry failed" }
  s["news-lead"] = running({ phase: "tool", name: "news.board.write" }, s["news-lead"].messages, 6)
  s.wire = idle([...s.wire.messages, report(270, "No market-moving headline overnight", 0.7)])
  s["search-lead"] = idle([...s["search-lead"].messages, report(280, "THETA, DELTA, EPSI are the 3 fastest", 0.6)])
  s.scanner = idle([quest(20, "scan"), report(240, "scan ok", 0.6)])
  s.head = running({ phase: "waiting", names: ["news", "price"] }, s.head.messages, 0)
  s["price-lead"] = running({ phase: "waiting", names: ["levels", "quotes"] }, [...s["price-lead"].messages, quest(300, "price THETA, DELTA, EPSI")], 300)
  s.levels = running({ phase: "tools", names: ["market.levels", "market.quote", "market.chain"] }, [quest(305, "levels")], 305)
  s.quotes = running({ phase: "llm", stage: "waiting" }, [quest(305, "quotes")], 305)
  return { ...w, kernel: { ...w.kernel, artifacts: artifacts(2, earlier) }, now: T0 + 330_000 }
}

// Finished at 7m40s: every team reported but review; the top 5 and the book written this run.
export function finished() {
  const s = base()
  const verdicts = {
    news: ["Hot CPI is priced: futures -0.6%, yields +8 bp", 0.6],
    trend: ["Trend DOWN after the print, puts pay", 0.55],
    search: ["THETA, DELTA, EPSI are the 3 fastest", 0.6],
    price: ["DELTA 0DTE 118P reaches 2× in 61% of paths", 0.5],
    case: ["DELTA put below 118.40, stop 119.60, target 116.80", 0.55],
  }
  for (const [team, , members] of TEAMS) {
    if (!verdicts[team]) continue
    s[`${team}-lead`] = idle([quest(10, `${team} goal`), report(300, ...verdicts[team])])
    for (const m of members) s[m] = idle([quest(12, "go"), report(200, `${m} done`, 0.5)])
  }
  s.head = idle([quest(0, GOAL, "schedule (booked by head)"), report(460, "TRADE: DELTA 0DTE 118P on a break of 118.40 — hot CPI, trend down, 61% reach", 0.55)])
  const briefs = { top5: "DELTA ↑ 0.92 · AMD ↑ 0.81", book: "equity $10,000 · flat" }
  return { lead: "head", states: s, registry, kernel: { tree, artifacts: artifacts(7, briefs) }, now: T0 + 470_000, endedAt: T0 + 460_000, touched: ["desk.top5", "desk.book", "head.checklist"] }
}
