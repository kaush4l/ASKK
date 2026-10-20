// The one preview pane and its card rendered on the server (react-dom/server): every item kind, the card closed and
// open, an old twin (pages only, before the restart) and an artifact of a view this UI no longer draws — none throws.
// The pane's logic is backend/live/preview.js (preview.test.js); this only proves the views draw what it returns.
import { expect, test } from "bun:test"
import * as React from "react"
import { renderToString } from "react-dom/server"
import { PreviewPane } from "@/components/live/workbench/preview-pane"
import { PreviewCard } from "@/components/preview/card"
import { ArtifactBody, ArtifactBlock } from "@/components/views/artifact"

const flow = { kind: "flow", title: "The line", nodes: [{ id: "a", label: "data" }, { id: "b", label: "model" }], edges: [{ from: "a", to: "b" }] }
const state = {
  pages: [{ id: "p1", url: "http://127.0.0.1:8077/", title: "Dashboard", status: "open", at: "2026-10-17T10:00:00Z", shot: { n: 2, at: "2026-10-17T10:05:00Z", url: "/__askk/browser/shot?id=p1&n=2" }, console: [{ level: "error", text: "boom" }], errors: 1 }],
  visuals: [
    { id: "pipeline", title: "The pipeline", says: "data → model", visual: flow, by: "lead", at: "2026-10-17T10:06:00Z" },
    { id: "curve", title: "Val", says: "", visual: { chart: "val" }, by: "lead", at: "2026-10-17T10:01:00Z" }, // an old {chart} (before 2026-10-18): draws nothing
    { id: "build", title: "Build", says: "", visual: { terminal: "s2" }, by: "coder", at: "2026-10-17T10:02:00Z" },
    { id: "loss", title: "Loss", says: "", visual: { file: "out/loss.json", error: "not read yet" }, by: "lead", at: "2026-10-17T10:02:00Z" },
  ],
  current: { kind: "visual", id: "pipeline" },
  asks: [
    { id: "q1", text: "why?", on: { kind: "visual", id: "pipeline" }, context: { node: "a" }, from: "owner", at: "2026-10-17T10:08:00Z", answer: { text: "because", on: { kind: "visual", id: "curve" }, by: "lead", at: "2026-10-17T10:10:00Z" } },
    { id: "q2", text: "loss?", on: null, context: null, from: "owner", at: "2026-10-17T10:11:00Z", answer: null },
  ],
  revision: 7,
}
const artifacts = {
  terminal: { id: "terminal", view: "terminal", state: { sessions: [{ id: "s2", agent: "coder", slot: "long", command: "uv run train.py", status: "running", tail: ["step 1", "step 2"] }] } },
}
const preview = { id: "preview", view: "preview", holders: ["lead"], title: "preview", brief: "1 page", state }

test("the pane, its card, an old twin and a retired view render without throwing", () => {
  for (const key of ["visual:pipeline", "visual:curve", "visual:build", "visual:loss", "page:p1"]) {
    const html = renderToString(<PreviewPane artifact={preview} artifacts={artifacts} follow={{ following: false, key, pick() {} }} />)
    expect(html.length).toBeGreaterThan(100)
  }
  expect(renderToString(<PreviewPane artifact={preview} artifacts={artifacts} />)).toContain("The pipeline")
  expect(renderToString(<PreviewPane artifact={{ id: "preview", state: { pages: state.pages } }} artifacts={{}} />)).toContain("Dashboard")
  expect(renderToString(<PreviewPane artifact={{ id: "preview", state: { pages: [] } }} artifacts={{}} />)).toContain("Nothing in the preview yet")
  const closed = renderToString(<PreviewCard artifact={preview} state={state} expanded={false} />).replaceAll("<!-- -->", "")
  expect(closed).toContain("1 question open")
  expect(closed).toContain("2/5")
  expect(renderToString(<PreviewCard artifact={preview} state={state} expanded />)).toContain("Ask")
  expect(renderToString(<ArtifactBlock artifact={{ id: "stage", view: "stage", state: { scenes: [{ id: "x" }] } }} expanded />)).toContain("scenes")
  expect(renderToString(<ArtifactBody artifact={{ id: "stage", view: "stage", state: {} }} expanded={false} />)).toBe("")
  for (const key of ["visual:curve", "visual:build", "page:p1"]) {
    const s2 = { ...state, current: { kind: key.split(":")[0], id: key.split(":")[1] } }
    expect(renderToString(<PreviewCard artifact={preview} state={s2} expanded={false} />).length).toBeGreaterThan(50)
  }
})

test("2026-10-17: a drilled pane (trail, Back, params), a bound visual (its script, Re-run), token heat, matrix cells, links, meta; a smoothed log chart", () => {
  const tokens = { kind: "tokens", color: "surprisal", meta: { run: "r04", step: 1700 }, tokens: [{ text: "rā", p: 0.5, surprisal: 1, target: "rā", top: [["rā", 0.5]], open: { id: "tok", params: { t: "0" } } }, { text: "ma", p: 0.01, surprisal: 6.6 }] }
  const lens = { kind: "matrix", rows: ["L0", "L1"], cols: ["#1", "#2"], frames: [{ values: [[0.6, 0.2], [0.7, 0.1]] }], cells: [["rā", "ma"], ["rā", "a"]], open_rows: [{ id: "layer", params: { l: "0" } }, null] }
  const line = { kind: "line", series: [{ name: "loss", points: [[0, 3], [10, 2]], open: { id: "step", params: { step: "{x}" } } }] }
  const flowLinked = { ...flow, nodes: [{ id: "a", label: "data", open: { id: "tok" } }, { id: "b", label: "model" }] }
  const drilled = {
    ...state,
    visuals: [
      ...state.visuals,
      { id: "trace", title: "Tokens", says: "", visual: { file: "out/trace/r04.json", ...tokens }, template: "out/trace/{run}.json", params: { run: "r04" }, by: "lead", at: "2026-10-17T10:03:00Z" },
      { id: "tok", title: "Token", says: "", visual: { kind: "compare", sides: [{ title: "lens", visual: lens }, { title: "loss", visual: line }] }, params: { run: "r04", t: "0" }, by: "lead", at: "2026-10-17T10:04:00Z", bind: { command: "python -B trace.py --run {run} --t {t}", watch: ["runs/{run}/ckpt/*.safetensors"], running: false, ran_at: "2026-10-17T10:04:00Z", ran: "python -B trace.py --run r04 --t 0", exit: 1, ms: 2100, error: "python -B exited 1: boom", waiting: null } },
      { id: "arch", title: "Arch", says: "", visual: flowLinked, by: "lead", at: "2026-10-17T10:05:00Z", bind: { command: "python -B arch.py", watch: ["llm/**"], running: true, ran_at: "2026-10-17T10:05:00Z" } },
    ],
    current: { kind: "visual", id: "tok", params: { run: "r04", t: "0" } },
    trail: [{ kind: "visual", id: "trace", params: { run: "r04" } }],
  }
  const p2 = { ...preview, state: drilled }
  const html = renderToString(<PreviewPane artifact={p2} artifacts={artifacts} />).replaceAll("<!-- -->", "")
  expect(html).toContain("Drill-down trail")
  expect(html).toContain("Tokens (run=r04)")
  expect(html).toContain("Token (run=r04, t=0)")
  expect(html).toContain("python -B trace.py --run r04 --t 0")
  expect(html).toContain("Re-run")
  expect(html).toContain("python -B exited 1: boom")
  for (const key of ["visual:trace", "visual:arch"]) expect(renderToString(<PreviewPane artifact={p2} artifacts={artifacts} follow={{ following: false, key, pick() {} }} />).length).toBeGreaterThan(100)
  const traceHtml = renderToString(<PreviewPane artifact={p2} artifacts={artifacts} follow={{ following: false, key: "visual:trace", pick() {} }} />).replaceAll("<!-- -->", "")
  expect(traceHtml).toContain("run r04 · step 1700") // meta
  expect(traceHtml).toContain("surprising")
  // 2026-10-18: no chart view — an old charts twin (a desk server not restarted) shows its state, never throws
  const old = renderToString(<ArtifactBlock artifact={{ id: "charts", view: "chart", state: { charts: [{ id: "loss" }] } }} expanded />)
  expect(old).toContain("loss")
})

// 2026-10-18 owner: "preview can enlarge to a web page" — a page item (in the pane and on the closed card) has Enlarge.
test("a page in the pane and on the closed card has Enlarge; a visual has none", () => {
  const page = renderToString(<PreviewPane artifact={preview} artifacts={artifacts} follow={{ following: false, key: "page:p1", pick() {} }} />)
  expect(page).toContain("Enlarge")
  expect(page).toContain('aria-label="Open the page in a new tab"')
  const visual = renderToString(<PreviewPane artifact={preview} artifacts={artifacts} follow={{ following: false, key: "visual:pipeline", pick() {} }} />)
  expect(visual).not.toContain("Enlarge")
  const card = renderToString(<PreviewCard artifact={preview} state={{ ...state, current: { kind: "page", id: "p1" } }} expanded={false} />)
  expect(card).toContain("Enlarge")
})

