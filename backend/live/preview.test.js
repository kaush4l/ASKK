import { describe, expect, test } from "bun:test"
import {
  askable,
  askThread,
  bridgeMessage,
  contextLine,
  currentRef,
  enlargeOf,
  frameCheck,
  frameSrc,
  frameStep,
  bindLine,
  itemKey,
  linkFor,
  metaText,
  onKey,
  onLine,
  openAsks,
  pageMode,
  pageView,
  paramsText,
  previewActivity,
  previewItems,
  previewOf,
  sessionOf,
  shownItem,
  trailOf,
  viewMessage,
  visualSource,
} from "./preview.js"
import { CALL_KINDS, callLook } from "./visual.js"

const flow = { kind: "flow", title: "The line", nodes: [{ id: "a", label: "data" }, { id: "b", label: "model" }], edges: [{ from: "a", to: "b" }] }
const state = {
  pages: [
    { id: "p1", url: "http://127.0.0.1:8077/", title: "Dashboard", status: "open", at: "2026-10-17T10:00:00Z", shot: { n: 2, at: "2026-10-17T10:05:00Z", url: "/__askk/browser/shot?id=p1&n=2" } },
    { id: "p2", url: "http://127.0.0.1:8078/", title: "", status: "closed", at: "2026-10-17T09:00:00Z", shot: null },
  ],
  visuals: [
    { id: "pipeline", title: "The pipeline", says: "data → model", visual: flow, by: "lead", at: "2026-10-17T10:06:00Z" },
    { id: "loss", title: "Loss", says: "falls to 1.9", visual: { kind: "line", series: [], file: "out/loss.json" }, by: "lead", at: "2026-10-17T10:07:00Z", read_at: "2026-10-17T10:09:00Z" },
    { id: "curve", title: "", says: "", visual: { chart: "val" }, by: "lead", at: "2026-10-17T10:01:00Z" },
    { id: "build", title: "Build", says: "", visual: { terminal: "coder · long" }, by: "coder", at: "2026-10-17T10:02:00Z" },
  ],
  current: { kind: "visual", id: "pipeline" },
  asks: [
    { id: "q1", text: "why?", on: { kind: "visual", id: "pipeline" }, context: null, from: "owner", at: "2026-10-17T10:08:00Z", answer: { text: "because", on: { kind: "visual", id: "loss" }, by: "lead", at: "2026-10-17T10:10:00Z" } },
    { id: "q2", text: "loss?", on: null, context: { series: "train" }, from: "owner", at: "2026-10-17T10:11:00Z", answer: null },
  ],
  revision: 7,
}
// before the restart: the preview's pages only (2026-10-17: a live run on the old code)
const old = { pages: state.pages }

describe("preview twin", () => {
  test("previewOf: the preview artifact (id preview first), or null; an old stage artifact is not one", () => {
    const artifacts = { plan: { id: "plan", view: "checklist" }, "demo.preview": { id: "demo.preview", view: "preview" }, preview: { id: "preview", view: "preview" }, stage: { id: "stage", view: "stage" } }
    expect(previewOf(artifacts).id).toBe("preview")
    expect(previewOf(artifacts, "demo.preview").id).toBe("demo.preview")
    expect(previewOf({ plan: artifacts.plan, stage: artifacts.stage })).toBeNull()
    expect(previewOf(null)).toBeNull()
  })

  test("previewItems: pages, then visuals, each with its key, title, time and source", () => {
    const items = previewItems(state)
    expect(items.map((i) => [i.key, i.source])).toEqual([
      ["page:p1", "page"],
      ["page:p2", "page"],
      ["visual:pipeline", "spec"],
      ["visual:loss", "spec"],
      ["visual:curve", "none"], // an old {chart} visual (before 2026-10-18: no charts) draws nothing
      ["visual:build", "terminal"],
    ])
    expect(items[1].title).toBe("127.0.0.1:8078") // no title: its host
    expect(items[4].title).toBe("curve") // no title: its id
    expect(items[3].at).toBe(Date.parse("2026-10-17T10:09:00Z")) // a file visual read again counts
    expect(previewItems(old).map((i) => i.key)).toEqual(["page:p1", "page:p2"])
    expect(previewItems(null)).toEqual([])
  })

  test("visualSource: a spec (a file one read), a file not read yet, a terminal session, nothing (an old chart too)", () => {
    expect(visualSource(flow)).toEqual({ type: "spec", ref: null })
    expect(visualSource({ kind: "line", file: "out/loss.json" })).toEqual({ type: "spec", ref: "out/loss.json" })
    expect(visualSource({ file: "out/loss.json", error: "not read yet" })).toEqual({ type: "file", ref: "out/loss.json" })
    expect(visualSource({ chart: "val" })).toEqual({ type: "none", ref: null }) // 2026-10-18: no charts
    expect(visualSource({ terminal: "r07" })).toEqual({ type: "terminal", ref: "r07" })
    expect(visualSource(null)).toEqual({ type: "none", ref: null })
    expect(visualSource({})).toEqual({ type: "none", ref: null })
  })

  test("currentRef and shownItem: following → the agents' current item; paused → the owner's pick; an old twin → its newest shot page", () => {
    expect(currentRef(state)).toEqual({ kind: "visual", id: "pipeline", view: null })
    expect(currentRef({ ...state, current: { kind: "page", id: "p1", view: "attention" } })).toEqual({ kind: "page", id: "p1", view: "attention" })
    expect(currentRef(old)).toEqual({ kind: "page", id: "p1", view: null })
    expect(currentRef({ pages: [] })).toBeNull()
    expect(shownItem(state, { following: true, picked: "page:p1" }).key).toBe("visual:pipeline")
    expect(shownItem(state, { following: false, picked: "page:p1" }).key).toBe("page:p1")
    expect(shownItem(state, { following: false, picked: "visual:gone" }).key).toBe("visual:pipeline")
    expect(shownItem(state, { following: false, picked: null }).key).toBe("visual:pipeline")
    expect(shownItem({ ...state, current: { kind: "visual", id: "dropped" } }, { following: true }).key).toBe("page:p1")
    expect(shownItem(old, { following: true }).key).toBe("page:p1")
    expect(shownItem({ pages: [], visuals: [] }, { following: true })).toBeNull()
  })

  test("pageView: the #view preview.focus named, only while that page is current", () => {
    const focused = { ...state, current: { kind: "page", id: "p1", view: "attention" } }
    expect(pageView(focused, "p1")).toBe("attention")
    expect(pageView(focused, "p2")).toBeNull()
    expect(pageView(state, "p1")).toBeNull()
    expect(pageView({ ...state, current: { kind: "page", id: "p1", view: "<script>" } }, "p1")).toBeNull()
  })

  test("sessionOf: a session by id, name or label", () => {
    const artifacts = {
      terminal: { id: "terminal", view: "terminal", state: { sessions: [{ id: "s1", name: "story", agent: "coder", slot: null }, { id: "s2", agent: "coder", slot: "long", command: "uv run train.py" }] } },
    }
    expect(sessionOf(artifacts, "s1").id).toBe("s1")
    expect(sessionOf(artifacts, "story").id).toBe("s1")
    expect(sessionOf(artifacts, "coder · long").id).toBe("s2")
    expect(sessionOf(artifacts, "coder.long").id).toBe("s2")
    expect(sessionOf(artifacts, "r99")).toBeNull()
  })

  // 2026-10-18 owner: "preview can enlarge to a web page" — the live page by default, enlarged to the whole viewport.
  test("pageMode: live wherever the page can be framed unless the owner picked the shot; a page that cannot be framed shows its shot", () => {
    expect(pageMode({ frameable: true })).toBe("live")
    expect(pageMode({ mode: "shot", frameable: true })).toBe("shot")
    expect(pageMode({ mode: "live", frameable: true })).toBe("live")
    expect(pageMode({ frameable: false })).toBe("shot")
    expect(pageMode({ mode: "live", frameable: false })).toBe("shot")
    expect(pageMode()).toBe("shot")
  })

  test("enlargeOf: the live page (its #view) on the desk's computer; its shot with the reason elsewhere or closed; always its address", () => {
    const here = "http://localhost:1111/"
    const page = state.pages[0]
    expect(enlargeOf(page, { here, view: "loss" })).toEqual({ title: "Dashboard", href: "http://127.0.0.1:8077/#loss", live: true, src: "http://127.0.0.1:8077/#loss", reason: null })
    expect(enlargeOf(page, { here })).toMatchObject({ live: true, src: "http://127.0.0.1:8077/" })
    const closed = enlargeOf(state.pages[1], { here })
    expect(closed).toMatchObject({ title: "127.0.0.1:8078", href: "http://127.0.0.1:8078/", live: false, src: null, reason: "the page is closed: its last screenshot" })
    const phone = enlargeOf(page, { here: "http://192.168.1.20:1111/" })
    expect(phone).toMatchObject({ live: false, src: null, href: "http://127.0.0.1:8077/" })
    expect(phone.reason).toStartWith("not framed: the page runs on the desk's computer (127.0.0.1:8077)")
    expect(enlargeOf({ ...page, url: "http://localhost:1111/live" }, { here }).reason).toBe("not framed: the page is on the desk server's own port — its last screenshot")
    expect(enlargeOf(page)).toMatchObject({ live: false, reason: null }) // before the tab knows its address (server render)
    expect(enlargeOf({ id: "x", url: "" }, { here })).toBeNull()
    expect(enlargeOf(null)).toBeNull()
  })

  test("asks: the thread with open marks, the open count, onKey to the item an answer shows; an old twin takes none", () => {
    expect(askThread(state).map((a) => [a.id, a.open])).toEqual([
      ["q1", false],
      ["q2", true],
    ])
    expect(openAsks(state)).toBe(1)
    expect(openAsks(old)).toBe(0)
    expect(askable(state)).toBe(true)
    expect(askable(old)).toBe(false)
    expect(onKey(state, { kind: "visual", id: "loss" })).toBe("visual:loss")
    expect(onKey(state, "loss")).toBe("visual:loss")
    expect(onKey(state, "p1")).toBe("page:p1")
    expect(onKey(state, { kind: "visual", id: "gone" })).toBeNull()
    expect(onKey(state, null)).toBeNull()
    expect(onLine({ kind: "visual", id: "loss" })).toBe("visual loss")
    expect(onLine("p1")).toBe("p1")
    expect(onLine(null)).toBe("")
    expect(previewActivity(state)).toBe(Date.parse("2026-10-17T10:11:00Z"))
    expect(previewActivity(old)).toBe(Date.parse("2026-10-17T10:05:00Z"))
    expect(itemKey({ kind: "page", id: "p1" })).toBe("page:p1")
    expect(itemKey(null)).toBeNull()
  })

  test("frameCheck: loopback pages with a port, never this tab's origin; another device is told where it runs", () => {
    expect(frameCheck("http://127.0.0.1:8077/", "http://localhost:1111/live")).toEqual({ ok: true })
    expect(frameCheck("http://localhost:1111/", "http://localhost:1111/live")).toMatchObject({ ok: false, reason: "the page is on the desk server's own port" })
    expect(frameCheck("http://127.0.0.1:1111/x", "http://localhost:1111/live")).toMatchObject({ ok: false })
    expect(frameCheck("https://example.org:8077/", "http://localhost:1111/")).toMatchObject({ ok: false, reason: "only a page on the desk's computer can be framed" })
    expect(frameCheck("http://127.0.0.1:8077/", "http://192.168.1.4:1111/live")).toMatchObject({ ok: false, remote: true })
    expect(frameCheck("nope", "http://localhost:1111/")).toMatchObject({ ok: false })
  })

  test("frameSrc, viewMessage and frameStep: the page with #view; the message a page hears; a view reaches it once per key", () => {
    expect(frameSrc("http://127.0.0.1:8077/#old", "attention")).toBe("http://127.0.0.1:8077/#attention")
    expect(frameSrc("http://127.0.0.1:8077/")).toBe("http://127.0.0.1:8077/")
    expect(frameSrc(null)).toBeNull()
    expect(viewMessage({ view: "attention", title: "Heads", params: { layer: 2 } })).toEqual({ askk: "scene", scene: { id: "attention", view: "attention", title: "Heads", params: { layer: 2 } } })
    expect(frameStep({ key: "a", last: null, heard: false })).toBe("src") // not spoken yet: the #view
    expect(frameStep({ key: "a", last: null, heard: true })).toBe("post")
    expect(frameStep({ key: "a", last: "a", heard: true })).toBeNull() // the same view: nothing (a stream update)
    expect(frameStep({ key: null })).toBeNull()
  })

  test("bridgeMessage: only the frame's window and origin; at and ask, sanitized", () => {
    const frame = {}
    const origin = "http://127.0.0.1:8077"
    const from = (data, extra = {}) => bridgeMessage({ source: frame, origin, data, ...extra }, { frame, origin })
    expect(from({ askk: "at", view: "attention", views: ["training", "attention", "bad view!"] })).toEqual({ type: "at", view: "attention", views: ["training", "attention"] })
    expect(from({ askk: "ask", context: { layer: 2, head: 1, step: 800 } })).toEqual({ type: "ask", context: { layer: 2, head: 1, step: 800 }, text: "" })
    expect(from({ askk: "ask", text: "  why this head?  " })).toEqual({ type: "ask", context: null, text: "why this head?" })
    expect(from({ askk: "ask", context: { big: "x".repeat(2000) } })).toBeNull()
    expect(from({ askk: "at", view: "<script>" })).toBeNull()
    expect(from({ askk: "run", text: "rm" })).toBeNull()
    expect(from("hello")).toBeNull()
    expect(from({ askk: "at", view: "training" }, { source: {} })).toBeNull()
    expect(from({ askk: "at", view: "training" }, { origin: "http://localhost:1111" })).toBeNull()
  })

  test("contextLine: what the owner pointed at, as a chip", () => {
    expect(contextLine({ layer: 2, head: 1, tokens: [3, 4] })).toBe("layer 2 · head 1 · tokens [3,4]")
    expect(contextLine(null)).toBe("")
  })

  test("a preview call draws as the preview wherever calls are drawn (show / focus / answer are type dev); no stage look", () => {
    expect(callLook({ type: "dev", view: "preview", name: "preview.show" })).toEqual({ kind: "preview", tone: "indigo", icon: "app-window" })
    expect(callLook({ type: "dev", view: "preview", name: "preview.answer" }).kind).toBe("preview")
    expect(callLook({ type: "artifact", view: "preview", name: "preview.focus" }).kind).toBe("preview")
    expect(CALL_KINDS).not.toContain("stage")
    expect(callLook({ type: "artifact", view: "stage", name: "stage.scene" }).kind).toBe("artifact") // an old stage call: a plain artifact call
  })
})

describe("drill-down and bound scripts (2026-10-17)", () => {
  test("linkFor: a link with {x} filled from the clicked point; none when it cannot be filled or is not a short word", () => {
    expect(linkFor({ id: "step", params: { run: "r04", step: "{x}" } }, { x: 1700, y: 3.1 })).toEqual({ id: "step", params: { run: "r04", step: "1700" } })
    expect(linkFor({ id: "step", params: { step: "{x}" } }, { x: 0.123456789 })).toEqual({ id: "step", params: { step: "0.123457" } })
    expect(linkFor({ id: "step", params: { step: "{x}" } })).toBeNull()
    expect(linkFor({ id: "tok" })).toEqual({ id: "tok" })
    expect(linkFor({ id: "tok", params: { p: "a/b" } })).toBeNull()
    expect(linkFor(null)).toBeNull()
  })

  test("currentRef carries params; trailOf: the breadcrumb (empty without a trail), labels with params; paramsText, metaText", () => {
    const drilled = { ...state, visuals: [...state.visuals, { id: "tok", title: "Token", visual: { kind: "steps", steps: [{ title: "a" }] }, params: { run: "r1", t: "7" } }], current: { kind: "visual", id: "tok", params: { run: "r1", t: "7" } }, trail: [{ kind: "visual", id: "pipeline" }, { kind: "visual", id: "loss", params: { run: "r1" } }] }
    expect(currentRef(drilled)).toEqual({ kind: "visual", id: "tok", view: null, params: { run: "r1", t: "7" } })
    expect(trailOf(drilled).map((c) => [c.label, c.current])).toEqual([
      ["The pipeline", false],
      ["Loss (run=r1)", false],
      ["Token (run=r1, t=7)", true],
    ])
    expect(trailOf(drilled)[2].key).toBe("visual:tok?run=r1, t=7")
    expect(trailOf(state)).toEqual([])
    expect(paramsText({ run: "r1", t: "7" })).toBe("run=r1 · t=7")
    expect(paramsText(null)).toBe("")
    expect(metaText({ config: "r04-base", n_layer: 6 })).toBe("config r04-base · n_layer 6")
  })

  test("bindLine: running, waiting, ok, failed, not run yet", () => {
    const b = { command: "python -B arch.py --config {cfg}.json", watch: ["llm/**"], running: false, ran_at: null, exit: null, ms: null, error: null, waiting: null }
    expect(bindLine(null)).toBeNull()
    expect(bindLine(b)).toMatchObject({ tone: "idle", text: "not run yet", command: b.command, watch: ["llm/**"] })
    expect(bindLine({ ...b, running: true, ran_at: "2026-10-17T14:00:00Z", ran: "python -B arch.py --config base.json" }, Date.parse("2026-10-17T14:00:05Z"))).toMatchObject({ tone: "running", text: "re-running… 5 s", command: "python -B arch.py --config base.json" })
    expect(bindLine({ ...b, waiting: "HTTP 409: gpu is held by term-2" })).toMatchObject({ tone: "waiting", text: "waiting: HTTP 409: gpu is held by term-2" })
    expect(bindLine({ ...b, ran_at: "2026-10-17T14:00:00Z", exit: 0, ms: 2100 }).text).toMatch(/^ran .+ exit 0 \(2\.1 s\)$/)
    expect(bindLine({ ...b, ran_at: "2026-10-17T14:00:00Z", exit: 1, ms: 1500, error: "python -B exited 1: ValueError" })).toMatchObject({ tone: "failed", error: "python -B exited 1: ValueError" })
  })
})

