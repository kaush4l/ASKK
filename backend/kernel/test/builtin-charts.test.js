// The charts artifact (backend/kernel/builtin/charts.js, 2026-10-17) over a fake host: tables and metrics files as
// series (a text x as labels, a glob as one series per run, a y list), ≤ 400 points keeping first, last, min and max,
// lanes, refresh coalesced at most every 5 s, the specs kept, the prompt's numbers.

import { describe, expect, test } from "bun:test"
import { Agent, Charts, downsample, parseRows, seriesLine } from "../index.js"
import { fakeHost } from "./fake-host.js"

const clock = () => new Date("2026-10-17T14:00:00Z")
function holder(name, charts, config = {}, host) {
  const agent = new Agent({ name, report: false, ...config }, { infer: async () => "", context: { host } }).addArtifact(charts)
  const run = (cmd, input = {}) => agent.tools.get(`${charts.id}.${cmd}`).run(input, { ...agent.context, agent })
  return { agent, run }
}
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`
const RESULTS = "run_id\tval_bpb\tnote\nr1\t1.30\tbase\nr2\t1.25\trope\nr3\tnan\tcrashed\nr4\t1.21\tqk-norm\n"
const reads = (host) => host.calls.filter((c) => c.path.startsWith("fs/read")).length

describe("charts", () => {
  test("a TSV with a text x (run_id): points on the row index, labelled; non-numeric y skipped; the summary", async () => {
    const host = fakeHost({ files: { "projects/x/results.tsv": RESULTS } })
    const charts = new Charts({ clock })
    const observer = holder("grapher", charts, {}, host)
    const out = await observer.run("plot", { id: "bpb", title: "val bpb per run", file: "projects/x/results.tsv", x: "run_id", y: "val_bpb" })
    expect(out).toBe("## bpb — val bpb per run (val_bpb vs run_id)\n  val_bpb: n=3, last r4→1.21, min 1.21 at r4, max 1.3 at r1, trend over the last 10%: ↓ -0.04")
    const chart = charts.twin().state.charts[0]
    expect(chart).toEqual({ id: "bpb", title: "val bpb per run", kind: "line", x: "run_id", y: ["val_bpb"], file: "projects/x/results.tsv", by: "grapher", series: [{ name: "val_bpb", points: [[0, 1.3, "r1"], [1, 1.25, "r2"], [3, 1.21, "r4"]] }], updatedAt: "2026-10-17T14:00:00.000Z", error: null })
    expect(charts.twin()).toMatchObject({ kind: "charts", view: "chart", keep: "always", brief: "1 chart" })
    expect(observer.agent.tools.get("charts.plot")).toMatchObject({ type: "dev", view: "chart" })
  })

  test("a JSONL glob: one series per file named by its folder, the newest max_series by mtime; y as a list: a series per column", async () => {
    // inserted r10 first … r01 last: r01 is the newest (the fake host's mtimes follow insertion)
    const files = {}
    for (let i = 10; i >= 1; i--) {
      const run = `r${String(i).padStart(2, "0")}`
      files[`projects/tiny/runs/${run}/metrics.jsonl`] = jsonl([0, 100, 200].map((step) => ({ step, loss: 4 - step / 100 - i / 100, lr: 0.01 })))
    }
    files["projects/tiny/runs/r01/notes.jsonl"] = jsonl([{ step: 0, loss: 9 }])
    files["projects/tiny/runs/README.md"] = "# runs\n"
    const host = fakeHost({ files })
    const charts = new Charts({ clock })
    const g = holder("grapher", charts, {}, host)
    const out = await g.run("plot", { id: "loss", file: "projects/tiny/runs/*/metrics.jsonl", x: "step", y: "loss" })
    const series = charts.twin().state.charts[0].series
    expect(series.map((s) => s.name)).toEqual(["r01", "r02", "r03", "r04", "r05", "r06", "r07", "r08"])
    expect(series[0].points).toEqual([[0, 3.99], [100, 2.99], [200, 1.99]])
    expect(out.split("\n")[0]).toBe("## loss — loss (loss vs step)")
    expect(out.split("\n")[1]).toBe("  r01: n=3, last 200→1.99, min 1.99 at 200, max 3.99 at 0, trend over the last 10%: ↓ -1")
    await g.run("plot", { id: "loss", file: "projects/tiny/runs/*/metrics.jsonl", x: "step", y: ["loss", "lr"], max_series: 2 })
    expect(charts.twin().state.charts).toHaveLength(1) // the same id replaced it
    expect(charts.twin().state.charts[0].series.map((s) => s.name)).toEqual(["r01 loss", "r01 lr", "r02 loss", "r02 lr"])
    // y as a list on one file: a series per column, named by the column
    host.fs.set("projects/tiny/results.csv", 'run_id,loss,val_bpb,note\nr1,3.2,1.3,"a, b"\nr2,3.1,1.25,c\n')
    await g.run("plot", { id: "both", file: "projects/tiny/results.csv", y: "loss, val_bpb", kind: "bar" })
    const both = charts.twin().state.charts[1]
    expect(both).toMatchObject({ kind: "bar", x: null, y: ["loss", "val_bpb"] })
    expect(both.series).toEqual([{ name: "loss", points: [[0, 3.2], [1, 3.1]] }, { name: "val_bpb", points: [[0, 1.3], [1, 1.25]] }])
    // a ** glob walks the tree
    await g.run("plot", { id: "deep", file: "projects/**/metrics.jsonl", y: "loss", max_series: 3 })
    expect(charts.twin().state.charts[2].series.map((s) => s.name)).toEqual(["r01", "r02", "r03"])
  })

  test("> 400 rows: ≤ 400 points keeping the first, the last, the global min and max; n counts every row", async () => {
    const rows = Array.from({ length: 1000 }, (_, step) => ({ step, loss: step === 437 ? -5 : step === 702 ? 50 : Math.sin(step / 7) + 3 }))
    rows[500].loss = "nan"
    rows[501].loss = null
    delete rows[502].loss
    const host = fakeHost({ files: { "runs/a/metrics.jsonl": jsonl(rows) } })
    const charts = new Charts({ clock })
    const out = await holder("grapher", charts, {}, host).run("plot", { id: "loss", file: "runs/a/metrics.jsonl", x: "step", y: "loss" })
    const points = charts.twin().state.charts[0].series[0].points
    expect(points.length).toBeLessThanOrEqual(400)
    expect(points[0]).toEqual([0, 3])
    expect(points.at(-1)[0]).toBe(999)
    expect(points).toContainEqual([437, -5])
    expect(points).toContainEqual([702, 50])
    expect(points.map((p) => p[0])).toEqual([...points.map((p) => p[0])].sort((a, b) => a - b))
    expect(out).toContain("loss: n=997, last 999→")
    expect(out).toContain("min -5 at 437, max 50 at 702")
    // the helper alone
    const many = Array.from({ length: 401 }, (_, i) => [i, i % 2])
    expect(downsample(many)).toHaveLength(400)
    expect(downsample(many.slice(0, 400))).toHaveLength(400)
  })

  test("a missing file is the chart's error line, not a throw; a host failure keeps the last points", async () => {
    const host = fakeHost({ files: { "projects/x/results.tsv": RESULTS } })
    const charts = new Charts({ clock })
    const g = holder("grapher", charts, {}, host)
    expect(await g.run("plot", { id: "gone", file: "projects/x/missing.tsv", y: "val_bpb" })).toBe("## gone — gone (val_bpb vs row)\n  (error: projects/x/missing.tsv: no such file)")
    expect(charts.twin().state.charts[0]).toMatchObject({ series: [], error: "projects/x/missing.tsv: no such file" })
    expect(await g.run("plot", { id: "none", file: "projects/y/runs/*/metrics.jsonl", y: "loss" })).toContain("(error: no file matches projects/y/runs/*/metrics.jsonl)")
    expect(await g.run("plot", { id: "col", file: "projects/x/results.tsv", y: "val_loss" })).toContain("(error: no numeric val_loss in projects/x/results.tsv (columns: run_id, val_bpb, note))")
    await g.run("plot", { id: "bpb", file: "projects/x/results.tsv", x: "run_id", y: "val_bpb" })
    const before = charts.twin().state.charts.find((c) => c.id === "bpb").series
    const get = host.get
    host.get = async (path, o) => (path.startsWith("fs/read") ? Promise.reject(Object.assign(new Error(`GET ${path}: HTTP 500 {"error":"disk asleep"}`), { status: 500 })) : get(path, o))
    charts.pulled = 0
    await charts.refresh(g.agent)
    const bpb = charts.twin().state.charts.find((c) => c.id === "bpb")
    expect(bpb.series).toEqual(before)
    expect(bpb.error).toBe("HTTP 500: disk asleep")
  })

  test("lanes: a path outside the holder's reads: lane, .env* and .mcp.json are refused; a glob's matches stay in the lane", async () => {
    const host = fakeHost({ files: { "projects/x/train.tsv": "a\tb\n1\t2\n", "projects/x/out/curve.csv": "step,loss\n1,3.1\n2,2.9\n", ".env": "KEY=1\n" } })
    const charts = new Charts({ clock })
    const critic = holder("critic", charts, { reads: ["projects/*/out/**"] }, host)
    await expect(critic.run("plot", { id: "t", file: "projects/x/train.tsv", y: "b" })).rejects.toThrow("critic reads only projects/*/out/** (its reads:) — projects/x/train.tsv is outside its lane")
    await expect(critic.run("plot", { id: "t", file: "shared/*/metrics.jsonl", y: "b" })).rejects.toThrow("shared/*/metrics.jsonl is outside its lane")
    expect(await critic.run("plot", { id: "curve", file: "projects/x/out/curve.csv", x: "step", y: "loss" })).toContain("loss: n=2")
    // a glob whose head may hold lane files: each match is checked as it is read (train.tsv is not one)
    expect(await critic.run("plot", { id: "any", file: "projects/x/*.tsv", y: "b" })).toContain("(error: no file in the lane matches projects/x/*.tsv)")
    const anyone = holder("grapher", charts, {}, host)
    for (const file of [".env", "projects/x/.env.local", ".mcp.json", "projects/.env*"]) await expect(anyone.run("plot", { id: "s", file, y: "KEY" })).rejects.toThrow("ASKK's configuration (.env*, .mcp.json) — agents never read it")
    await expect(anyone.run("plot", { id: "s", file: "../outside.tsv", y: "a" })).rejects.toThrow('".." is not a workspace path')
    await expect(anyone.run("plot", { id: "s", file: "projects/x/train.py", y: "a" })).rejects.toThrow("charts read .tsv, .csv, .jsonl or .json")
    // the plotting holder's lane holds on a refresh by another holder
    host.fs.set("projects/x/a.tsv", "b\n1\n")
    charts.pulled = 0
    await charts.refresh(anyone.agent)
    expect(charts.twin().state.charts.find((c) => c.id === "any").series).toEqual([])
  })

  test("refresh: at most every 5 s, coalesced across holders; changed() only when the twin differs", async () => {
    const host = fakeHost({ files: { "projects/x/results.tsv": RESULTS } })
    let t = Date.parse("2026-10-17T14:00:00Z")
    const charts = new Charts({ clock: () => new Date(t) })
    const a = holder("grapher", charts, {}, host)
    const b = holder("analyst", charts, {}, host)
    await a.run("plot", { id: "bpb", file: "projects/x/results.tsv", x: "run_id", y: "val_bpb" })
    let changes = 0
    charts.onChange(() => changes++)
    const n = reads(host)
    charts.pulled = 0
    await Promise.all([charts.refresh(a.agent), charts.refresh(b.agent)])
    expect(reads(host)).toBe(n + 1) // one read for both holders
    await charts.refresh(b.agent)
    expect(reads(host)).toBe(n + 1) // read less than 5 s ago
    expect(changes).toBe(0) // nothing changed
    host.fs.set("projects/x/results.tsv", `${RESULTS}r5\t1.19\tswiglu\n`)
    t += 60_000
    charts.pulled = Date.now() - 5001
    await charts.refresh(a.agent)
    expect(reads(host)).toBe(n + 2)
    expect(changes).toBe(1)
    const chart = charts.twin().state.charts[0]
    expect(chart.series[0].points.at(-1)).toEqual([4, 1.19, "r5"])
    expect(chart.updatedAt).toBe("2026-10-17T14:01:00.000Z")
    t += 60_000
    charts.pulled = 0
    await charts.refresh(a.agent)
    expect(changes).toBe(1)
    expect(charts.twin().state.charts[0].updatedAt).toBe("2026-10-17T14:01:00.000Z") // when its points last changed
  })

  test("keep always: snapshot()/restore() round-trip the specs; the points are read again (the host's saved state keeps them meanwhile)", async () => {
    const host = fakeHost({ files: { "projects/x/results.tsv": RESULTS, "projects/x/out/curve.csv": "step,loss\n1,3.1\n2,2.9\n" } })
    const charts = new Charts({ clock })
    await holder("grapher", charts, {}, host).run("plot", { id: "bpb", title: "bpb", file: "projects/x/results.tsv", x: "run_id", y: "val_bpb", kind: "scatter", max_series: 3 })
    await holder("critic", charts, { reads: ["projects/*/out/**"] }, host).run("plot", { id: "curve", file: "projects/x/out/curve.csv", x: "step", y: ["loss"] })
    const snap = charts.snapshot()
    expect(snap).toEqual({
      charts: [
        { id: "bpb", title: "bpb", kind: "scatter", x: "run_id", y: ["val_bpb"], file: "projects/x/results.tsv", by: "grapher", max_series: 3, reads: null },
        { id: "curve", title: "curve", kind: "line", x: "step", y: ["loss"], file: "projects/x/out/curve.csv", by: "critic", max_series: 8, reads: ["projects/*/out/**"] },
      ],
    })
    const again = new Charts({ clock })
    again.restore(JSON.parse(JSON.stringify(snap)))
    expect(again.snapshot()).toEqual(snap)
    expect(again.twin().state.charts.map((c) => c.series)).toEqual([[], []])
    await again.refresh(holder("lead", again, {}, host).agent)
    expect(again.twin().state).toEqual(charts.twin().state)
    // the host saves `state`: restored with its last points, read again at the next refresh
    const saved = new Charts({ clock })
    saved.restore(JSON.parse(JSON.stringify(charts.state)))
    expect(saved.twin().state).toEqual(charts.twin().state)
    expect(saved.stale).toBe(true)
  })

  test("the prompt: per chart its head and a line per series, ≤ 30 lines; remove and show", async () => {
    const host = fakeHost({ files: { "projects/x/results.tsv": RESULTS } })
    const charts = new Charts({ clock })
    const g = holder("grapher", charts, {}, host)
    const block = () => g.agent.render({ text: "x", from: "owner" }, []).split("# charts — charts — the desk's graphs\n")[1].split("\n\n# REQUEST")[0].split("\n")
    expect(block()).toEqual(["the desk's charts — workspace metrics files drawn for the owner, re-read as they grow: charts.plot, charts.remove, charts.show", "(no charts yet)"])
    await g.run("plot", { id: "bpb", title: "val bpb", file: "projects/x/results.tsv", x: "run_id", y: "val_bpb" })
    expect(block().slice(1)).toEqual(["## bpb — val bpb (val_bpb vs run_id)", "  val_bpb: n=3, last r4→1.21, min 1.21 at r4, max 1.3 at r1, trend over the last 10%: ↓ -0.04"])
    for (let i = 0; i < 15; i++) await g.run("plot", { id: `c${i}`, file: "projects/x/results.tsv", x: "run_id", y: ["val_bpb", "note"] })
    expect(charts.twin().state.charts).toHaveLength(16)
    await expect(g.run("plot", { id: "c99", file: "projects/x/results.tsv", y: "val_bpb" })).rejects.toThrow("16 charts already")
    const lines = block()
    expect(lines.length).toBeLessThanOrEqual(30)
    expect(lines.at(-1)).toMatch(/^… \d+ more lines: charts\.show \{id\}$/)
    expect(await g.run("show", { id: "c3" })).toBe("## c3 — c3 (val_bpb, note vs run_id)\n  val_bpb: n=3, last r4→1.21, min 1.21 at r4, max 1.3 at r1, trend over the last 10%: ↓ -0.04\n  (error: no numeric note in projects/x/results.tsv (columns: run_id, val_bpb, note))")
    expect((await g.run("show")).split("\n").filter((l) => l.startsWith("## "))).toHaveLength(16)
    expect(await g.run("remove", { id: "c3" })).toBe("removed chart c3")
    expect(charts.twin().state.charts.map((c) => c.id)).not.toContain("c3")
    await expect(g.run("remove", { id: "c3" })).rejects.toThrow("id: no chart c3")
    await expect(g.run("show", { id: "c3" })).rejects.toThrow("id: no chart c3")
    expect(charts.brief()).toBe("15 charts")
  })

  test("parseRows and seriesLine", () => {
    expect(parseRows("a.csv", 'x,y\n1,"2"\n')).toEqual([{ x: "1", y: "2" }])
    expect(parseRows("a.jsonl", '{"x":1}\nnot json\n{"x":2', { cut: true })).toEqual([{ x: 1 }])
    expect(parseRows("a.json", '[{"x":1},2,{"x":3}]')).toEqual([{ x: 1 }, { x: 3 }])
    expect(() => parseRows("a.json", '{"x":1}')).toThrow("a .json chart file is an array of objects")
    expect(seriesLine({ name: "flat", points: [[0, 1], [1, 1]] })).toBe("flat: n=2, last 1→1, min 1 at 0, max 1 at 0, trend over the last 10%: → 0")
    expect(seriesLine({ name: "none", points: [] })).toBe("none: no points")
  })
})
