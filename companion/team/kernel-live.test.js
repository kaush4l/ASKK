import { afterEach, expect, test } from "bun:test"
import { mirrorTeam, startLiveStatus } from "./kernel-live.js"
import { artifact, finished, registry, tree } from "./kernel-status.fixtures.js"

// The live status message against a scripted team stream (the kernel team's event shapes) and a fake
// transport (send → id, edit). Real timers, short intervals.

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out")
    await Bun.sleep(5)
  }
}
const pause = (ms) => Bun.sleep(ms)

// A team stream: the snapshot of a desk whose last run is over, then the patches we emit, in the
// kernel team's form ({type: "state", id, patch: {status, activity, working, messages: {from, items}}}).
function scriptedTeam(base = finished()) {
  const states = structuredClone(base.states)
  const clients = new Set()
  let seq = 1000
  const send = (event) => clients.forEach((c) => c(event))
  return {
    stream({ signal }) {
      const encoder = new TextEncoder()
      const body = new ReadableStream({
        start(controller) {
          const push = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
          push({ type: "snapshot", registry, states, kernel: { tree, artifacts: base.kernel.artifacts } })
          clients.add(push)
          signal?.addEventListener("abort", () => (clients.delete(push), controller.close()))
        },
      })
      return new Response(body)
    },
    update(id, patch, items = []) {
      const s = states[id]
      const from = s.messages.length
      const messages = items.map((m) => ({ id: `k${++seq}`, at: new Date().toISOString(), ...m }))
      s.messages.push(...messages)
      Object.assign(s, patch)
      send({ type: "state", id, patch: { ...patch, ...(messages.length ? { messages: { from, items: messages } } : {}) } })
    },
    start(id, text, from = null) {
      this.update(id, { status: "running", activity: { phase: "llm", stage: "waiting" }, working: { request: `k${seq + 1}`, at: new Date().toISOString() } }, [{ role: "user", content: text, from }])
    },
    answer(id, verdict) {
      this.update(id, { status: "idle", activity: { phase: "idle" }, working: null }, [{ role: "assistant", action: "answer", content: `VERDICT: ${verdict}\nCONFIDENCE: 0.6` }])
    },
    fail(id, error) {
      this.update(id, { status: "error", activity: { phase: "idle" }, working: null, error }, [{ role: "assistant", action: "answer", content: `Error: ${error}`, error }])
    },
    kernel(artifact) {
      send({ type: "kernel", artifact })
    },
  }
}

function fakeTransport() {
  let n = 0
  const calls = []
  const failures = [] // errors thrown by the next calls, in order
  return {
    calls,
    failures,
    async send(text) {
      calls.push({ op: "send", text, at: Date.now() })
      if (failures.length) throw failures.shift()
      return ++n
    },
    async edit(id, text) {
      calls.push({ op: "edit", id, text, at: Date.now() })
      if (failures.length) throw failures.shift()
    },
  }
}

const running = []
const start = async (team, transport, opts = {}) => {
  const logs = []
  const live = startLiveStatus({ team, desk: "demo-desk", transport, log: (l) => logs.push(l), minIntervalMs: 40, graceMs: 0, heartbeatMs: 60_000, ...opts })
  running.push(live)
  await live.ready
  return Object.assign(live, { logs })
}
afterEach(() => running.splice(0).forEach((l) => l.stop()))

test("a run: one message at the start, edits in place while it works, a final edit, then quiet", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  await start(team, t)
  await pause(30)
  expect(t.calls).toEqual([]) // the desk is idle: nothing to say

  team.start("head", "Plan today", "telegram:Owner")
  await until(() => t.calls.length === 1)
  expect(t.calls[0]).toMatchObject({ op: "send" })
  expect(t.calls[0].text).toStartWith("<b>demo-desk</b> · LIVE &lt;1m · via telegram\n<i>Plan today</i>\n💭 <b>head</b> — thinking")

  // A burst of changes: edits are spaced, the last one shows the latest state.
  team.update("head", { activity: { phase: "waiting", names: ["news", "trend"] } })
  team.start("news-lead", "Why today is different", "head")
  team.update("news-lead", { activity: { phase: "waiting", names: ["wire"] } })
  team.start("wire", "headlines", "news-lead")
  team.update("wire", { activity: { phase: "tool", name: "market.news" } })
  await until(() => t.calls.at(-1).text.includes("🔧 wire — market.news"))
  for (let i = 1; i < t.calls.length; i++) expect(t.calls[i].at - t.calls[i - 1].at).toBeGreaterThanOrEqual(38)
  expect(t.calls.slice(1).every((c) => c.op === "edit" && c.id === 1)).toBe(true)
  expect(t.calls.length).toBeLessThanOrEqual(4) // 5 changes, coalesced

  // A change that renders the same text: no edit.
  const before = t.calls.length
  team.update("wire", { activity: { phase: "tool", name: "market.news" } })
  await pause(120)
  expect(t.calls.length).toBe(before)

  // The run ends: the final edit marks it done, with the outcome; later changes edit nothing.
  team.answer("wire", "No headline")
  team.answer("news-lead", "Nothing priced in")
  team.answer("head", "NO TRADE today")
  await until(() => t.calls.at(-1).text.includes("DONE"))
  const last = t.calls.at(-1)
  expect(last).toMatchObject({ op: "edit", id: 1 })
  expect(last.text).toMatch(/^<b>demo-desk<\/b> · DONE in \d+s · via telegram/)
  expect(last.text).toContain("✅ <b>head</b> — NO TRADE today")
  expect(last.text).toContain("✅ <b>News</b> — Nothing priced in · conf 0.60")
  const count = t.calls.length
  team.start("news-lead", "late", "head")
  await pause(150)
  expect(t.calls.length).toBe(count)
})

test("Telegram's 429: the next call waits retry_after", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  const live = await start(team, t)
  team.start("head", "go")
  await until(() => t.calls.length === 1)
  t.failures.push(Object.assign(new Error("Telegram editMessageText: Too Many Requests: retry after 1"), { code: 429, retryAfter: 0.3 }))
  team.update("head", { activity: { phase: "tool", name: "market.calendar" } })
  await until(() => t.calls.length === 2) // refused
  team.update("head", { activity: { phase: "tool", name: "market.quote" } })
  await until(() => t.calls.length === 3, 2000)
  expect(t.calls[2].at - t.calls[1].at).toBeGreaterThanOrEqual(300)
  expect(t.calls[2].text).toContain("market.quote")
  expect(live.logs.join("\n")).toContain("retry after 0.3s")
})

test("'not modified' is fine; a deleted message is sent again", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  await start(team, t)
  team.start("head", "go")
  await until(() => t.calls.length === 1)
  t.failures.push(new Error("Telegram editMessageText: Bad Request: message to edit not found"))
  team.update("head", { activity: { phase: "tool", name: "a.tool" } })
  await until(() => t.calls.length === 3)
  expect(t.calls.map((c) => c.op)).toEqual(["send", "edit", "send"])
  expect(t.calls[2].text).toContain("a.tool")
})

test("/status: a fresh message, the old one points to it, the final edit goes to the new one", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  const live = await start(team, t)
  // Idle: a one-off snapshot of the last run, never edited again.
  expect(await live.refresh()).toBe("idle")
  await until(() => t.calls.length === 1)
  expect(t.calls[0].text).toMatch(/^<b>demo-desk<\/b> · IDLE · last run .+ ago/)
  team.start("head", "go")
  await until(() => t.calls.length === 2)
  expect(t.calls[1]).toMatchObject({ op: "send" })
  expect(await live.refresh()).toBe("live")
  await until(() => t.calls.length === 4)
  expect(t.calls[2]).toMatchObject({ op: "send" })
  expect(t.calls[2].text).toContain("LIVE")
  expect(t.calls[3]).toMatchObject({ op: "edit", id: 2, text: "<i>Live status moved to a newer message ↓</i>" })
  team.answer("head", "done")
  await until(() => t.calls.at(-1).text.includes("DONE"))
  expect(t.calls.at(-1)).toMatchObject({ op: "edit", id: 3 })
})

test("a quick answer with no team at work gets no status message; a quest does", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  await start(team, t, { graceMs: 10_000 })
  team.start("head", "what is the plan?")
  await pause(60)
  team.answer("head", "Nothing today")
  await pause(100)
  expect(t.calls).toEqual([])
  team.start("head", "full run")
  await pause(60)
  expect(t.calls).toEqual([])
  team.start("news-lead", "go", "head")
  await until(() => t.calls.length === 1)
  expect(t.calls[0].text).toContain("<b>News</b>")
})

test("never more than perMinute calls", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  await start(team, t, { minIntervalMs: 0, perMinute: 3 })
  team.start("head", "go")
  for (let i = 0; i < 12; i++) {
    team.update("head", { activity: { phase: "tool", name: `tool.n${i}` } })
    await pause(15)
  }
  await pause(100)
  expect(t.calls.length).toBe(3)
})

test("an artifact changed in this run is not 'earlier'; a stopped run says STOPPED", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  await start(team, t)
  team.start("head", "go")
  await until(() => t.calls.length === 1)
  expect(t.calls[0].text).toContain("Top 5: DELTA ↑ 0.92 · AMD ↑ 0.81 (earlier)")
  team.kernel(artifact("desk.top5", "list", "desk", "Top 5", "THETA ↑ 0.70 & <rising>"))
  await until(() => t.calls.at(-1).text.includes("Top 5: THETA ↑ 0.70 &amp; &lt;rising&gt;"))
  expect(t.calls.at(-1).text).not.toContain("Top 5: THETA ↑ 0.70 &amp; &lt;rising&gt; (earlier)")
  expect(t.calls.at(-1).text).toContain("Book: equity $10,000 · flat (earlier)") // not touched this run
  team.fail("head", "stopped")
  await until(() => t.calls.at(-1).text.includes("STOPPED"))
  expect(t.calls.at(-1).text).toContain("⏹ <b>head</b> — stopped by the owner")
})

// 2026-10-17 critic: slim() dropped `kind`, so lastRun, due and agentNow took an owner chat's question (kind "chat")
// for a run's request — /status showed the chat as the last run's goal with "no answer".
test("an owner chat is no run: /status after a chat shows the real last run; a member's chat does not start it in a live run", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  const { view } = mirrorTeam(team, new AbortController().signal, () => {})
  const live = await start(team, t)
  team.update("head", {}, [{ role: "user", kind: "chat", from: "owner", content: "what is built so far?" }, { role: "assistant", kind: "chat", content: "The plan: DELTA.", guided: false, proposed: null }])
  await until(() => view.states.head.messages.some((m) => m.kind === "chat"))
  expect(view.states.head.messages.filter((m) => m.kind === "chat").map((m) => [m.role, m.kind])).toEqual([["user", "chat"], ["assistant", "chat"]]) // the mirror keeps kind
  expect(await live.refresh()).toBe("idle")
  await until(() => t.calls.length === 1)
  expect(t.calls[0].text).toContain("<i>Read the market and plan today")
  expect(t.calls[0].text).toContain("✅ <b>head</b> — TRADE: DELTA 0DTE 118P")
  expect(t.calls[0].text).not.toContain("what is built")
  // A live run: a member's chat does not mark it (or its team) started, and no message is due for it.
  const team2 = scriptedTeam()
  const t2 = fakeTransport()
  await start(team2, t2, { graceMs: 60_000, heartbeatMs: 20 })
  team2.start("head", "Plan today", "telegram:Owner")
  team2.update("wire", {}, [{ role: "user", kind: "chat", from: "owner", content: "are you busy?" }, { role: "assistant", kind: "chat", content: "No." }])
  await pause(120)
  expect(t2.calls).toEqual([]) // within the grace, no team at work: not due
  team2.start("news-lead", "go", "head") // a real quest: due
  await until(() => t2.calls.length === 1)
  expect(t2.calls[0].text).toContain("News")
  expect(t2.calls[0].text).not.toContain("wire —")
})

test("watch runs get no message and no edits; /status skips them; the next real run is as before", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  const live = await start(team, t)
  team.start("head", "rescan the movers", "watch")
  team.start("news-lead", "go", "head") // even a watch run that hands a quest
  team.kernel(artifact("desk.top5", "list", "desk", "Top 5", "THETA ↑ 0.70"))
  await pause(120)
  team.answer("news-lead", "quiet")
  team.answer("head", "watch: nothing new")
  await pause(120)
  expect(t.calls).toEqual([])
  expect(live.current).toBe(null)
  // /status: the last run that is not a watch, with its own outcome.
  expect(await live.refresh()).toBe("idle")
  await until(() => t.calls.length === 1)
  expect(t.calls[0].text).toContain("IDLE · last run")
  expect(t.calls[0].text).toContain("<i>Read the market and plan today")
  expect(t.calls[0].text).toContain("✅ <b>head</b> — TRADE: DELTA 0DTE 118P")
  expect(t.calls[0].text).not.toContain("nothing new")
  // A watch "from" with more after it is a watch too; any other run opens its message.
  team.start("head", "again", "watch (minute)")
  await pause(80)
  team.answer("head", "still nothing")
  await pause(80)
  expect(t.calls.length).toBe(1)
  team.start("head", "Plan today", "telegram:Owner")
  await until(() => t.calls.length === 2)
  expect(t.calls[1]).toMatchObject({ op: "send" })
  expect(t.calls[1].text).toContain("<i>Plan today</i>")
  expect(t.calls[1].text).toContain("Top 5: THETA ↑ 0.70 (earlier)") // changed during the watch, not this run
  team.answer("head", "done")
  await until(() => t.calls.at(-1).text.includes("DONE"))
  expect(t.calls.at(-1)).toMatchObject({ op: "edit", id: 2 })
})

test("the mirror keeps every artifact but boards and memories, from the snapshot and from patches", async () => {
  const team = scriptedTeam()
  const controller = new AbortController()
  const seen = []
  const { view } = mirrorTeam(team, controller.signal, (e) => seen.push(e.type))
  await until(() => seen.includes("snapshot"))
  expect(Object.keys(view.kernel.artifacts).sort()).toEqual(["desk.book", "desk.calibration", "desk.next", "desk.quality", "desk.top5", "head.checklist", "news.notes"])
  expect(Object.keys(view.kernel).sort()).toEqual(["artifacts", "tree"])
  expect(view.kernel.tree.name).toBe("head")
  team.kernel(artifact("desk.board", "board", "desk", "Desk board", "4 entries"))
  team.kernel(artifact("head.memory", "memory", "head", "Memory", "13 lessons"))
  team.kernel(artifact("desk.odds", "odds", "desk", "Odds", "62% reach"))
  await until(() => seen.filter((e) => e === "kernel").length === 3)
  expect(view.kernel.artifacts["desk.board"]).toBeUndefined()
  expect(view.kernel.artifacts["head.memory"]).toBeUndefined()
  expect(view.kernel.artifacts["desk.odds"]).toMatchObject({ kind: "odds", brief: "62% reach" })
  controller.abort()
})

test("a run that ends while its first message is on the way still gets its final edit", async () => {
  const team = scriptedTeam()
  const t = fakeTransport()
  let open
  const gate = new Promise((r) => (open = r))
  const send = t.send
  t.send = async (text) => (await gate, send(text))
  await start(team, t)
  team.start("head", "go")
  await pause(30)
  team.answer("head", "quick")
  await pause(30)
  open()
  await until(() => t.calls.length === 2)
  expect(t.calls[0].text).toContain("LIVE")
  expect(t.calls[1]).toMatchObject({ op: "edit", id: 1 })
  expect(t.calls[1].text).toContain("✅ <b>head</b> — quick")
  await pause(100)
  expect(t.calls.length).toBe(2)
})
