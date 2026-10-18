import { expect, test } from "bun:test"
import { TermActivity, TermView, termEvent } from "./term-stream.js"
import { mergeSessions, sessionTabs } from "./workbench.js"

// An EventSource stand-in: the test emits what the host would send.
class FakeSource {
  static last = null
  readyState = 0
  listeners = {}
  constructor(url) {
    this.url = url
    FakeSource.last = this
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn
  }
  close() {
    this.readyState = 2
    this.closed = true
  }
  message(body) {
    this.onmessage?.({ data: JSON.stringify(body) })
  }
  named(type, body) {
    this.listeners[type]?.({ data: JSON.stringify(body) })
  }
}

test("termEvent reads the type from the body or the SSE event name", () => {
  expect(termEvent("message", '{"type":"out","id":"s1","data":"x"}')).toEqual({ type: "out", id: "s1", data: "x" })
  expect(termEvent("exit", '{"id":"s1","exit":0}')).toEqual({ type: "exit", id: "s1", exit: 0 })
  expect(termEvent("message", "not json")).toBeNull()
  expect(termEvent("message", '{"id":"s1"}')).toBeNull()
})

test("a session's stream: snapshot, raw chunks folded into lines, exit closes it", () => {
  const view = new TermView("s1", { EventSource: FakeSource, notifyMs: 0 })
  let calls = 0
  view.subscribe(() => calls++)
  view.start()
  const source = FakeSource.last
  expect(source.url).toBe("/__askk/term/stream?id=s1")
  source.onopen()
  source.message({ type: "snapshot", session: { id: "s1", status: "running", command: "python train.py" }, lines: ["start", ""] })
  source.named("out", { id: "s1", data: "\x1b[32mstep 1\x1b[0m 10%\r" })
  source.message({ type: "out", id: "s1", data: "step 1 90%\n" })
  source.message({ type: "out", id: "other", data: "not mine\n" })
  expect(view.getSnapshot()).toMatchObject({ lines: ["start", "step 1 90%"], status: "running", live: true, error: null })
  source.named("exit", { id: "s1", exit: 1, status: "failed" })
  expect(view.getSnapshot()).toMatchObject({ status: "failed", exit: 1, live: false })
  expect(source.closed).toBe(true)
  expect(calls).toBeGreaterThan(3)
})

test("a session event (its urls changed) updates the session's urls; another session's is ignored", () => {
  expect(termEvent("message", '{"type":"session","session":{"id":"s6","urls":["http://127.0.0.1:3000/"]}}')).toMatchObject({ type: "session", session: { id: "s6" } })
  const view = new TermView("s6", { EventSource: FakeSource, notifyMs: 0 })
  let calls = 0
  view.subscribe(() => calls++)
  view.start()
  const source = FakeSource.last
  source.message({ type: "snapshot", session: { id: "s6", status: "running", command: "bun dev", urls: [] }, lines: [] })
  source.message({ type: "out", id: "s6", data: "ready on http://127.0.0.1:3000/\n" })
  const before = calls
  source.message({ type: "session", session: { id: "s6", status: "running", command: "bun dev", urls: ["http://127.0.0.1:3000/"] } })
  expect(view.getSnapshot().session).toMatchObject({ id: "s6", command: "bun dev", urls: ["http://127.0.0.1:3000/"] })
  expect(calls).toBe(before + 1)
  source.named("session", { session: { id: "s6", urls: ["http://127.0.0.1:3000/", "http://localhost:5173/"] } })
  expect(view.getSnapshot().session.urls).toEqual(["http://127.0.0.1:3000/", "http://localhost:5173/"])
  expect(view.getSnapshot().session.command).toBe("bun dev") // the rest of the snapshot stays
  source.message({ type: "session", session: { id: "other", urls: ["http://127.0.0.1:9/"] } })
  expect(view.getSnapshot().session.urls).toHaveLength(2)
  expect(view.getSnapshot()).toMatchObject({ status: "running", live: true, lines: ["ready on http://127.0.0.1:3000/"] })
  view.close()
})

test("a finished session's snapshot closes the stream (no refetch loop); a refused stream says so", () => {
  const view = new TermView("s2", { EventSource: FakeSource, notifyMs: 0 })
  view.start()
  FakeSource.last.message({ type: "snapshot", session: { id: "s2", status: "exited", exit: 0 }, lines: ["ok"] })
  expect(FakeSource.last.closed).toBe(true)
  expect(view.getSnapshot()).toMatchObject({ lines: ["ok"], status: "exited", exit: 0, live: false })

  const refused = new TermView("s3", { EventSource: FakeSource, notifyMs: 0 })
  refused.start()
  FakeSource.last.readyState = 2
  FakeSource.last.onerror()
  expect(refused.getSnapshot().error).toMatch(/not available/)
})

// 2026-10-17 owner: an agent's commands run in its main session one after another, under one id.
test("a slot session's stream stays open past an exit: run brings its next command, its output goes on in the same lines", () => {
  const view = new TermView("m1", { EventSource: FakeSource, notifyMs: 0 })
  view.start()
  const source = FakeSource.last
  source.onopen()
  source.message({ type: "snapshot", session: { id: "m1", slot: "main", runs: 1, status: "exited", exit: 0, command: "bun install" }, lines: ["$ bun install", "done"] })
  expect(source.closed).toBeUndefined() // a finished slot session may run again: still listening
  expect(view.getSnapshot()).toMatchObject({ status: "exited", exit: 0, live: true, lines: ["$ bun install", "done"] })
  expect(termEvent("message", '{"type":"run","session":{"id":"m1"}}')).toMatchObject({ type: "run" })
  source.message({ type: "run", session: { id: "other", slot: "main", runs: 9, status: "running" } })
  expect(view.getSnapshot().status).toBe("exited")
  source.message({ type: "run", session: { id: "m1", slot: "main", runs: 2, status: "running", command: "bun test" } })
  source.message({ type: "out", id: "m1", data: "$ bun test\r\n1 pass\r\n" })
  expect(view.getSnapshot()).toMatchObject({ status: "running", exit: null, live: true, session: { command: "bun test", runs: 2 }, lines: ["$ bun install", "done", "$ bun test", "1 pass"] })
  source.named("exit", { id: "m1", exit: 1, status: "exited" })
  expect(view.getSnapshot()).toMatchObject({ status: "exited", exit: 1 })
  expect(source.closed).toBeUndefined()
  view.close()
  expect(source.closed).toBe(true)
})

test("chunks in a burst repaint once", async () => {
  const view = new TermView("s4", { EventSource: FakeSource, notifyMs: 5 })
  let calls = 0
  view.subscribe(() => calls++)
  view.start()
  for (let i = 0; i < 20; i++) FakeSource.last.message({ type: "out", id: "s4", data: `line ${i}\n` })
  expect(calls).toBe(0)
  await Bun.sleep(15)
  expect(calls).toBe(1)
  expect(view.getSnapshot().lines.length).toBe(20)
  view.close()
})

test("streams let their connection go while the tab is hidden, and reopen with a snapshot", async () => {
  const { LiveTree } = await import("./fs-watch.js")
  const doc = {
    visibilityState: "visible",
    fns: new Set(),
    addEventListener(_, fn) { this.fns.add(fn) },
    removeEventListener(_, fn) { this.fns.delete(fn) },
    flip(state) { this.visibilityState = state; for (const fn of this.fns) fn() },
  }
  const view = new TermView("s5", { EventSource: FakeSource, notifyMs: 0, document: doc })
  view.start()
  const first = FakeSource.last
  first.message({ type: "snapshot", session: { id: "s5", status: "running" }, lines: ["a"] })
  doc.flip("hidden")
  expect(first.closed).toBe(true)
  expect(view.getSnapshot().live).toBe(false)
  doc.flip("visible")
  expect(FakeSource.last).not.toBe(first)
  FakeSource.last.message({ type: "snapshot", session: { id: "s5", status: "running" }, lines: ["a", "b"] })
  expect(view.getSnapshot().lines).toEqual(["a", "b"])
  view.close()
  expect(doc.fns.size).toBe(0)

  let opened = 0
  let closed = 0
  const tree = new LiveTree("p", { read: async () => null, watch: () => (opened++, () => closed++), document: doc })
  tree.start()
  doc.flip("hidden")
  doc.flip("visible")
  tree.close()
  expect([opened, closed]).toEqual([2, 2])
})

// 2026-10-17: the terminal twin stood still while the coder waited, so follow reads term/list itself.
test("term activity: polls term/list's last lines while visible; a new snapshot only on a change; 404 stops it", async () => {
  const answers = []
  const urls = []
  const fetch = async (url) => {
    urls.push(url)
    const next = answers.shift() ?? { status: 200, body: { sessions: [] } }
    return { status: next.status, ok: next.status === 200, json: async () => next.body }
  }
  const run = (tail) => ({ id: "r07", name: "r07", status: "running", exit: null, startedAt: "2026-10-17T20:54:50Z", tail, pid: 1, urls: [] })
  const act = new TermActivity({ fetch, pollMs: 60000, document: null })
  let calls = 0
  act.subscribe(() => calls++)
  expect(act.getSnapshot()).toEqual({ sessions: null, error: null })
  answers.push({ status: 200, body: { sessions: [run(["step 100"])] } })
  await act.poll()
  expect(urls[0]).toBe("/__askk/term/list?tail=2")
  expect(act.getSnapshot().sessions).toEqual([{ id: "r07", name: "r07", command: undefined, cwd: undefined, agent: undefined, slot: null, lease: null, runs: 1, status: "running", exit: null, startedAt: "2026-10-17T20:54:50Z", endedAt: undefined, urls: [], tail: ["step 100"] }])
  const first = act.getSnapshot()
  answers.push({ status: 200, body: { sessions: [run(["step 100"])] } })
  await act.poll()
  expect(act.getSnapshot()).toBe(first) // nothing printed: the same snapshot, no repaint
  answers.push({ status: 500, body: null })
  await act.poll()
  expect(act.getSnapshot()).toMatchObject({ sessions: first.sessions, error: expect.any(String) }) // kept through a failed read
  answers.push({ status: 200, body: { sessions: [run(["step 100", "step 200"])] } })
  await act.poll()
  expect(act.getSnapshot()).toMatchObject({ sessions: [{ tail: ["step 100", "step 200"] }], error: null })
  expect(calls).toBe(3)
  answers.push({ status: 404, body: { error: "no term" } })
  await act.poll()
  expect(act.getSnapshot()).toMatchObject({ sessions: null, error: expect.any(String) }) // the twin alone from here
})

// 2026-10-17 (critic): the poll dropped `lease`, so a session the twin had not listed drew no gpu badge, and a slot
// session's next command (merged from the poll) kept the earlier command's badge.
test("term activity: a polled session keeps its lease through mergeSessions and sessionTabs; a lease change repaints", async () => {
  const answers = []
  const fetch = async () => ({ status: 200, ok: true, json: async () => answers.shift() })
  const act = new TermActivity({ fetch, pollMs: 60000, document: null })
  const at = (m) => `2026-10-17T21:${String(m).padStart(2, "0")}:00Z`
  const twin = [{ id: "s1", agent: "coder", slot: "main", lease: null, runs: 1, command: "ls", status: "exited", exit: 0, startedAt: at(10), tail: [] }]
  // a session the twin has not listed yet: its lease comes from the poll
  answers.push({ sessions: [{ id: "s2", agent: "trainer", slot: "long", lease: "gpu", runs: 1, command: "uv run train.py", status: "running", startedAt: at(12), tail: ["step 1"] }, twin[0]] })
  await act.poll()
  const polled = act.getSnapshot().sessions
  expect(polled[0].lease).toBe("gpu")
  expect(polled[1].lease).toBeNull()
  const tabs = sessionTabs(mergeSessions(twin, polled))
  expect(tabs.find((s) => s.id === "s2")).toMatchObject({ lease: "gpu", command: "uv run train.py" })
  // a slot session's next command without a lease drops the earlier command's badge
  const leased = [{ id: "s3", agent: "trainer", slot: "main", lease: "gpu", runs: 1, command: "uv run eval.py", status: "exited", exit: 0, startedAt: at(14), tail: [] }]
  answers.push({ sessions: [{ id: "s3", agent: "trainer", slot: "main", runs: 2, command: "ls", status: "running", startedAt: at(15), tail: [] }] })
  await act.poll()
  expect(mergeSessions(leased, act.getSnapshot().sessions)[0]).toMatchObject({ id: "s3", runs: 2, command: "ls", lease: null })
  // the same output with a lease taken (or let go) is a new snapshot, so the tab's badge repaints
  const before = act.getSnapshot()
  answers.push({ sessions: [{ id: "s3", agent: "trainer", slot: "main", lease: "gpu", runs: 2, command: "ls", status: "running", startedAt: at(15), tail: [] }] })
  await act.poll()
  expect(act.getSnapshot()).not.toBe(before)
  expect(act.getSnapshot().sessions[0].lease).toBe("gpu")
})

test("term activity: one poll loop while visible, none while hidden; a late answer after close is dropped", async () => {
  const doc = {
    visibilityState: "visible",
    fns: new Set(),
    addEventListener(_, fn) { this.fns.add(fn) },
    removeEventListener(_, fn) { this.fns.delete(fn) },
    flip(state) { this.visibilityState = state; for (const fn of this.fns) fn() },
  }
  let fetched = 0
  let release = null
  const fetch = () => {
    fetched++
    return new Promise((resolve) => (release = () => resolve({ status: 200, ok: true, json: async () => ({ sessions: [{ id: "s1", status: "running", tail: ["x"] }] }) })))
  }
  const act = new TermActivity({ fetch, pollMs: 5, idleMs: 5, document: doc })
  act.start()
  await Bun.sleep(1)
  expect(fetched).toBe(1)
  doc.flip("hidden")
  release()
  await Bun.sleep(20)
  expect(fetched).toBe(1) // hidden: no next poll
  expect(act.getSnapshot().sessions).toBeNull() // the answer came after the loop closed
  doc.flip("visible")
  await Bun.sleep(1)
  expect(fetched).toBe(2)
  release()
  await Bun.sleep(1)
  expect(act.getSnapshot().sessions).toMatchObject([{ id: "s1", status: "running", exit: null, urls: [], tail: ["x"] }])
  act.close()
  expect(doc.fns.size).toBe(0)
  const before = fetched
  await Bun.sleep(20)
  expect(fetched).toBe(before)
})

test("term activity: reads every pollMs while a session runs, every idleMs while none does", async () => {
  let running = true
  const times = []
  const fetch = async () => {
    times.push(performance.now())
    return { status: 200, ok: true, json: async () => ({ sessions: [{ id: "s1", status: running ? "running" : "exited", tail: [String(times.length)] }] }) }
  }
  const act = new TermActivity({ fetch, pollMs: 5, idleMs: 60, document: null })
  act.start()
  await Bun.sleep(40)
  const busy = times.length
  expect(busy).toBeGreaterThanOrEqual(3)
  running = false
  await Bun.sleep(100)
  expect(times.length - busy).toBeLessThanOrEqual(3) // one read sees it end, then idle reads
  act.close()
})
