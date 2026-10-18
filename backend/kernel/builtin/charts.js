import { Artifact } from "../artifact/artifact.js"
import { Tool } from "../tool/tool.js"
import { cleanPath, globRegex, hostError, hostFiles, inLane, mayContain, walkTree } from "./files.js"

// Charts: the observation desk's graphs (2026-10-17 owner: "observation desk, graphs and observations" — the line
// watches its runs as curves, not as numbers in a log). A chart is a spec over workspace files — a results table, one
// metrics.jsonl per run — read again as they grow; its points go to the UI's chart view, its numbers into the holders'
// prompts. One instance per desk (id "charts"); {type: charts, id} makes another.
//
//   charts.plot   {id, title?, file, x?, y, kind?, max_series?}   a chart (the same id replaces it): its summary
//   charts.remove {id}
//   charts.show   {id?}                                            the summary of one chart, or of all
//
// file: a workspace path or a glob (projects/sample-app/runs/*/metrics.jsonl) of .tsv / .csv (a header row), .jsonl (one
// object per line) or .json (an array of objects). y: a column, or a list of them. x: a column (default: the row
// index); an x that is not a number in every row (a run_id) becomes the row index, its value kept as the point's
// label. kind: line (default) | scatter | bar. A glob gives one series per file, named by the file's folder — the
// newest max_series files by mtime (default 8, ≤ 12) — times each y. A path must be in the holder's reads: lane when it
// has one (a glob: the files it matches); .env* and .mcp.json never.
// The files only through an adapter, as Files reads them (default the host: fs/list, fs/read).
// refresh(agent): every chart's files read again at most every REFRESH_MS (coalesced across holders); changed() only
// when the twin differs. A missing file is the chart's error line, never a throw; a host failure keeps the last points.
// Points per series ≤ 400 (downsampled: the first, the last, and each bucket's min and max — the global min and max
// stay). Values that are not numbers are skipped.
// keep "always": the chart specs (and their last points) are saved; the points are read again.
// Twin state: {charts: [{id, title, kind, x, y: [...], file, by, series: [{name, points: [[x, y, label?]…]}], updatedAt,
//   error}] ≤ 16}; updatedAt = when its points last changed.
// Prompt: per chart "## <id> — <title> (<y> vs <x>)", then per series n, last, min, max and the trend over the last
// 10% of x; ≤ 30 lines in all.

const CHARTS_MAX = 16
const SERIES_DEFAULT = 8
const SERIES_MAX = 12
const POINTS_MAX = 400
const PROMPT_LINES = 30
const SHOW_LINES = 200
const REFRESH_MS = 5000
const GLOB_FILES = 2000 // entries a ** glob walks
const PARALLEL = 8
const KINDS = ["line", "scatter", "bar"]
const CHART_ID = /^[a-z0-9][a-z0-9_.-]{0,39}$/i
const GLOB = /[*?]/
const FORMATS = /\.(tsv|csv|jsonl|ndjson|json)$/i

const list = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean)
const ctxOf = (agent) => ({ ...(agent?.context ?? {}), agent })
const join = (dir, name) => (dir ? `${dir}/${name}` : name)
// ASKK's configuration, never read (files.js keeps the same rule for files.read).
const secret = (path) => {
  const name = String(path).split("/").at(-1) ?? ""
  return name === ".mcp.json" || (/^\.env(\..+)?$/.test(name) && name !== ".env.example")
}
// A glob's last part that can only mean the configuration (".env*", ".mcp.json").
const secretGlob = (path) => {
  const name = String(path).split("/").at(-1) ?? ""
  return name !== ".env.example" && (name.startsWith(".env") || name === ".mcp.json")
}

// ---- numbers -------------------------------------------------------------------------------------

const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v !== "string" || !v.trim()) return null
  const n = Number(v.trim())
  return Number.isFinite(n) ? n : null
}
// 2.3141 → "2.314", 0.0123456 → "0.0123", 1200 → "1200"
export const fmt = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v)
  if (Number.isInteger(v)) return String(v)
  const a = Math.abs(v)
  return a >= 1000 ? v.toFixed(0) : a >= 1 ? String(+v.toFixed(3)) : String(+v.toPrecision(3))
}

// ---- files → rows --------------------------------------------------------------------------------

// One CSV line's cells: "a,b" quoted, "" a quote inside.
function csvCells(line) {
  const out = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ",") out.push(cur), (cur = "")
    else cur += c
  }
  out.push(cur)
  return out
}

// A file's text as rows ({column: value}) by its extension. cut: the host read only its head (the last line may be
// half a row: dropped).
export function parseRows(path, text, { cut = false } = {}) {
  const ext = FORMATS.exec(path)?.[1]?.toLowerCase()
  let lines = String(text ?? "").replace(/\r/g, "").split("\n")
  if (cut) lines = lines.slice(0, -1)
  if (ext === "tsv" || ext === "csv") {
    const rows = lines.filter((l) => l.trim())
    if (!rows.length) return []
    const cells = (l) => (ext === "tsv" ? l.split("\t") : csvCells(l)).map((c) => c.trim())
    const head = cells(rows[0])
    return rows.slice(1).map((l) => {
      const c = cells(l)
      return Object.fromEntries(head.map((h, i) => [h, c[i] ?? ""]))
    })
  }
  if (ext === "jsonl" || ext === "ndjson") {
    const out = []
    for (const l of lines) {
      if (!l.trim()) continue
      try {
        const o = JSON.parse(l)
        if (o && typeof o === "object" && !Array.isArray(o)) out.push(o)
      } catch {} // a line being written, or not JSON: skipped
    }
    return out
  }
  if (ext === "json") {
    const v = JSON.parse(String(text ?? ""))
    const rows = Array.isArray(v) ? v : Array.isArray(v?.rows) ? v.rows : null
    if (!rows) throw new Error(`${path}: a .json chart file is an array of objects`)
    return rows.filter((o) => o && typeof o === "object" && !Array.isArray(o))
  }
  throw new Error(`${path}: charts read .tsv, .csv, .jsonl or .json`)
}

// At most `max` points: the first, the last, and the min and max of each bucket between (so the global min and max
// stay), in their order.
export function downsample(points, max = POINTS_MAX) {
  if (points.length <= max) return points
  const last = points.length - 1
  const buckets = Math.max(1, Math.floor((max - 2) / 2))
  const inner = last - 1 // points 1 … last - 1
  const keep = new Set([0, last])
  for (let b = 0; b < buckets; b++) {
    const lo = 1 + Math.floor((b * inner) / buckets)
    const hi = 1 + Math.floor(((b + 1) * inner) / buckets)
    if (lo >= hi) continue
    let min = lo
    let most = lo
    for (let i = lo; i < hi; i++) {
      if (points[i][1] < points[min][1]) min = i
      if (points[i][1] > points[most][1]) most = i
    }
    keep.add(min).add(most)
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i])
}

// One series from rows: y against x (a numeric column), or against the row index (no x, or an x that is not a number
// in every row: its value is the point's label). Rows whose y (or numeric x) is not a number are skipped.
// → {name, points, n} (n: the points before downsampling)
export function seriesOf(rows, { x = null, y, name }) {
  const xs = x ? rows.map((r) => r?.[x]) : []
  const numeric = !!x && xs.some((v) => num(v) != null) && xs.every((v) => v == null || v === "" || num(v) != null)
  const points = []
  rows.forEach((r, i) => {
    const yv = num(r?.[y])
    if (yv == null) return
    if (!x) points.push([i, yv])
    else if (numeric) {
      const xv = num(r[x])
      if (xv != null) points.push([xv, yv])
    } else points.push([i, yv, r?.[x] == null ? "" : String(r[x])])
  })
  return { name, points: downsample(points), n: points.length }
}

// A series in one line: n, the last point, min and max (with their x), the trend over the last 10% of x (a
// least-squares fit's change across that window).
export function seriesLine(s, n = s.points.length) {
  const p = s.points
  if (!p.length) return `${s.name}: no points`
  const at = (q) => (q[2] != null && q[2] !== "" ? q[2] : fmt(q[0]))
  let min = p[0]
  let most = p[0]
  for (const q of p) {
    if (q[1] < min[1]) min = q
    if (q[1] > most[1]) most = q
  }
  const last = p.at(-1)
  const from = p[0][0] + 0.9 * (last[0] - p[0][0])
  let w = p.filter((q) => q[0] >= from)
  if (w.length < 2) w = p.slice(-2)
  let trend = ""
  if (w.length >= 2) {
    const mx = w.reduce((a, q) => a + q[0], 0) / w.length
    const my = w.reduce((a, q) => a + q[1], 0) / w.length
    const sxx = w.reduce((a, q) => a + (q[0] - mx) ** 2, 0)
    const slope = sxx ? w.reduce((a, q) => a + (q[0] - mx) * (q[1] - my), 0) / sxx : 0
    const d = slope * (w.at(-1)[0] - w[0][0])
    const r = Number(fmt(d))
    trend = `, trend over the last 10%: ${r < 0 ? "↓" : r > 0 ? "↑" : "→"} ${r > 0 ? "+" : ""}${fmt(r)}`
  }
  return `${s.name}: n=${n}, last ${at(last)}→${fmt(last[1])}, min ${fmt(min[1])} at ${at(min)}, max ${fmt(most[1])} at ${at(most)}${trend}`
}

// Each item through fn, at most `n` at once, in order.
async function mapLimit(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

// The files a glob matches: [{path, mtime}]. A ** glob walks the tree under its fixed head; any other is listed part by
// part (a folder that is missing matches nothing).
async function expand(adapter, pattern, ctx) {
  const parts = pattern.split("/")
  const first = parts.findIndex((p) => GLOB.test(p))
  const base = parts.slice(0, first).join("/")
  if (parts.slice(first).some((p) => p.includes("**"))) {
    let walked
    try {
      walked = await walkTree(adapter, base, ctx, { max: GLOB_FILES, depth: 12 })
    } catch (e) {
      if (e?.status === 404 || e?.status === 400) return []
      throw e
    }
    const re = globRegex(pattern)
    return walked.tree.filter((e) => !e.dir && re.test(e.path)).map((e) => ({ path: e.path, mtime: e.mtime }))
  }
  let level = [base]
  const found = []
  for (let i = first; i < parts.length && level.length; i++) {
    const last = i === parts.length - 1
    if (!GLOB.test(parts[i]) && !last) {
      level = level.map((d) => join(d, parts[i]))
      continue
    }
    const re = globRegex(parts[i])
    const lists = await mapLimit(level, PARALLEL, async (dir) => {
      try {
        return [dir, await adapter.list(dir, ctx)]
      } catch (e) {
        if (i === first && e?.status !== 404 && e?.status !== 400) throw e // the host itself failed
        return [dir, []]
      }
    })
    const next = []
    for (const [dir, entries] of lists)
      for (const e of entries ?? []) {
        if (!e?.name || !re.test(e.name)) continue
        if (last) e.type !== "dir" && found.push({ path: join(dir, e.name), mtime: Number(e.mtime) || 0 })
        else if (e.type === "dir") next.push(join(dir, e.name))
      }
    level = next
  }
  return found
}

// ---- the artifact --------------------------------------------------------------------------------

// The fields a chart's spec keeps (saved, restored); reads: the plotting holder's lane, applied to every read.
const SPEC = ["id", "title", "kind", "x", "y", "file", "by", "max_series", "reads"]
const specOf = (c) => Object.fromEntries(SPEC.map((k) => [k, c[k] ?? null]))

export class Charts extends Artifact {
  constructor({ id = "charts", title, adapter = hostFiles, clock = () => new Date() } = {}) {
    super({ name: id, title: title ?? (id === "charts" ? "charts — the desk's graphs" : `${id} — charts`) })
    this.kind = "charts"
    this.view = "chart"
    this.keep = "always" // the specs survive a restart; the points are read again
    this.adapter = adapter
    this.clock = clock
    this.state = { charts: [] } // each chart: its twin's fields and its spec's (max_series, reads)
    this.counts = new Map() // "<chart>\0<series>" -> its points before downsampling (the prompt's n)
    this.pulled = 0
    this.pulling = null
    this.stale = true
  }

  // ---- state ----

  #set(charts) {
    const next = { charts: charts.slice(0, CHARTS_MAX) }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return false
    this.state = next
    this.changed()
    return true
  }

  // The twin: every chart without its spec's own fields.
  twinState() {
    return { charts: this.state.charts.map(({ id, title, kind, x, y, file, by, series, updatedAt, error }) => ({ id, title, kind, x, y, file, by, series, updatedAt, error })) }
  }

  // The specs (points are read again).
  snapshot() {
    return { charts: this.state.charts.map(specOf) }
  }

  // A snapshot, or a saved state (the host saves `state`): the specs, and the last points while they are read again.
  restore(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.charts)) return
    const points = (s) => (Array.isArray(s?.points) ? s.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, POINTS_MAX) : [])
    this.state = {
      charts: data.charts
        .filter((c) => c && CHART_ID.test(String(c.id ?? "")) && typeof c.file === "string" && list(c.y).length)
        .slice(0, CHARTS_MAX)
        .map((c) => ({
          id: String(c.id),
          title: String(c.title ?? c.id),
          kind: KINDS.includes(c.kind) ? c.kind : "line",
          x: c.x ? String(c.x) : null,
          y: list(c.y),
          file: c.file,
          by: c.by ?? null,
          series: (Array.isArray(c.series) ? c.series : []).filter((s) => s?.name != null).map((s) => ({ name: String(s.name), points: points(s) })),
          updatedAt: c.updatedAt ?? null,
          error: c.error ?? null,
          max_series: Math.min(SERIES_MAX, Math.max(1, Math.round(Number(c.max_series) || SERIES_DEFAULT))),
          reads: c.reads == null ? null : list(c.reads),
        })),
    }
    this.stale = true
  }

  async refresh(agent) {
    if (!this.state.charts.length) return
    if (this.pulling) return this.pulling
    if (!this.stale && Date.now() - this.pulled < REFRESH_MS) return
    this.pulling = this.#pull(ctxOf(agent)).finally(() => (this.pulling = null))
    return this.pulling
  }

  // Every chart read again; one plotted or removed meanwhile keeps its newer state.
  async #pull(ctx) {
    const charts = this.state.charts
    const read = new Map(await Promise.all(charts.map(async (c) => [c, await this.#read(c, ctx)])))
    this.pulled = Date.now()
    this.stale = false
    this.#set(this.state.charts.map((c) => read.get(c) ?? c))
  }

  // The files a chart's spec names, newest max_series by mtime for a glob (shown in path order), within its lane.
  async #files(c, ctx) {
    if (!GLOB.test(c.file)) return [{ path: c.file }]
    const all = (await expand(this.adapter, c.file, ctx)).filter((f) => !secret(f.path) && (c.reads == null || inLane(c.reads, f.path)))
    return all
      .sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))
      .slice(0, c.max_series)
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  // A chart with its points read again: series per file × y; error says what is missing; updatedAt moves only when
  // the points do. A file that is missing (or matches nothing) empties it; a host failure keeps its last points.
  async #read(c, ctx) {
    let series = c.series
    const errors = []
    try {
      const files = await this.#files(c, ctx)
      if (!files.length) {
        series = []
        errors.push(`no file${c.reads ? " in the lane" : ""} matches ${c.file}`)
      } else {
        const glob = GLOB.test(c.file)
        const names = new Set()
        const nameOf = (path) => {
          const parts = path.split("/")
          let name = parts.at(-2) ?? path
          if (names.has(name)) name = parts.slice(-3, -1).join("/")
          names.add(name)
          return name
        }
        const got = await mapLimit(files, PARALLEL, async (f) => [f, await this.adapter.read(f.path, ctx)])
        series = []
        for (const [f, file] of got) {
          if (!file) {
            errors.push(`${f.path}: no such file`)
            continue
          }
          if (file.binary) {
            errors.push(`${f.path}: a binary file`)
            continue
          }
          let rows
          try {
            rows = parseRows(f.path, file.text, { cut: !!file.truncated })
          } catch (e) {
            errors.push(String(e.message).split("\n")[0])
            continue
          }
          if (file.truncated) errors.push(`${f.path}: only its first part was read (the file is larger than the host reads) — its newest rows are missing`)
          const base = glob ? nameOf(f.path) : null
          for (const y of c.y) {
            const s = seriesOf(rows, { x: c.x, y, name: base == null ? y : c.y.length > 1 ? `${base} ${y}` : base })
            if (!s.points.length) {
              const columns = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))]
              errors.push(`no numeric ${y} in ${f.path}${rows.length ? ` (columns: ${columns.slice(0, 12).join(", ")})` : " (no rows yet)"}`)
              continue
            }
            this.counts.set(`${c.id}\u0000${s.name}`, s.n)
            series.push({ name: s.name, points: s.points })
          }
        }
      }
    } catch (e) {
      errors.push(hostError(e)) // the host failed: the last points stay
    }
    const moved = JSON.stringify(series) !== JSON.stringify(c.series)
    return { ...c, series, updatedAt: moved ? this.clock().toISOString() : c.updatedAt, error: errors.length ? errors.join("; ").slice(0, 600) : null }
  }

  // ---- lanes ----

  // A path (or glob) this holder may chart: in its reads: lane when it has one (a glob: one that may match files in
  // it — each match is checked as it is read), never the configuration.
  #readable(agent, file) {
    const p = cleanPath(file)
    if (!p) throw new Error("file: a workspace path or a glob (projects/x/runs/*/metrics.jsonl)")
    const glob = GLOB.test(p)
    if (glob ? secretGlob(p) : secret(p)) throw new Error(`${p}: ASKK's configuration (.env*, .mcp.json) — agents never read it`)
    if (!FORMATS.test(p)) throw new Error(`${p}: charts read .tsv, .csv, .jsonl or .json`)
    const reads = agent?.config?.reads
    if (reads == null) return p
    const parts = p.split("/")
    const head = parts.slice(0, parts.findIndex((x) => GLOB.test(x))).join("/")
    const ok = glob ? mayContain(reads, head) || inLane(reads, head) : inLane(reads, p)
    if (!ok) throw new Error(`${agent.name} reads only ${list(reads).join(", ")} (its reads:) — ${p} is outside its lane`)
    return p
  }

  // ---- commands ----

  async #plot(input = {}, ctx = {}) {
    const agent = ctx.agent
    const id = String(input.id ?? "").trim()
    if (!CHART_ID.test(id)) throw new Error(`id: a short name for the chart (letters, digits, . _ -), e.g. loss`)
    const file = this.#readable(agent, input.file ?? input.path)
    const y = list(input.y)
    if (!y.length) throw new Error("y: a column to plot, or a list of them (e.g. val_bpb, or [loss, val_loss])")
    const kind = input.kind == null || input.kind === "" ? "line" : String(input.kind).trim()
    if (!KINDS.includes(kind)) throw new Error(`kind "${kind}": ${KINDS.join(" | ")}`)
    const was = this.state.charts.find((c) => c.id === id)
    if (!was && this.state.charts.length >= CHARTS_MAX) throw new Error(`${CHARTS_MAX} charts already (${this.state.charts.map((c) => c.id).join(", ")}): ${this.name}.remove one, or plot with its id to replace it`)
    const reads = agent?.config?.reads == null ? null : list(agent.config.reads)
    const spec = {
      id,
      title: String(input.title ?? "").trim() || id,
      kind,
      x: input.x == null || String(input.x).trim() === "" ? null : String(input.x).trim(),
      y,
      file,
      by: agent?.name ?? null,
      series: [],
      updatedAt: null,
      error: null,
      max_series: Math.min(SERIES_MAX, Math.max(1, Math.round(Number(input.max_series) || SERIES_DEFAULT))),
      reads,
    }
    for (const k of [...this.counts.keys()]) if (k.startsWith(`${id}\u0000`)) this.counts.delete(k)
    const chart = await this.#read(spec, ctx)
    const charts = this.state.charts
    this.#set(was ? charts.map((c) => (c.id === id ? chart : c)) : [...charts, chart])
    return this.#summary(chart, SHOW_LINES).join("\n")
  }

  #remove(input = {}) {
    const id = String(input.id ?? "").trim()
    if (!this.state.charts.some((c) => c.id === id)) throw new Error(`id: no chart ${id || "given"} (${this.state.charts.map((c) => c.id).join(", ") || "none yet"})`)
    for (const k of [...this.counts.keys()]) if (k.startsWith(`${id}\u0000`)) this.counts.delete(k)
    this.#set(this.state.charts.filter((c) => c.id !== id))
    return `removed chart ${id}`
  }

  #show(input = {}) {
    const id = String(input.id ?? "").trim()
    if (!this.state.charts.length) return `no charts yet (${this.name}.plot draws one)`
    if (!id) return this.state.charts.flatMap((c) => this.#summary(c)).slice(0, SHOW_LINES).join("\n")
    const chart = this.state.charts.find((c) => c.id === id)
    if (!chart) throw new Error(`id: no chart ${id} (${this.state.charts.map((c) => c.id).join(", ")})`)
    return this.#summary(chart, SHOW_LINES).join("\n")
  }

  commands() {
    const tool = (name, description, input, run) => new Tool({ name: `${this.name}.${name}`, type: "dev", view: "chart", description, input, run })
    return [
      tool("plot", "chart a workspace metrics file, or one series per file of a glob (re-read as it grows; the owner sees it drawn): its numbers per series", {
        id: "a short name (the same id replaces that chart)",
        title: "what it shows (optional)",
        file: "a .tsv/.csv (header row), .jsonl or .json (array) file, or a glob like projects/x/runs/*/metrics.jsonl (one series per run)",
        x: "the x column (default: the row index; a text column such as run_id labels the points)",
        y: "the column to plot, or a list of them",
        kind: "line (default) | scatter | bar",
        max_series: `a glob's newest files by time (default ${SERIES_DEFAULT}, at most ${SERIES_MAX})`,
      }, (i, c) => this.#plot(i, c)),
      tool("remove", "remove a chart", { id: "the chart" }, (i) => this.#remove(i)),
      tool("show", "the numbers of one chart, or of all", { id: "the chart (default: all)" }, (i) => this.#show(i)),
    ]
  }

  // ---- views ----

  // One chart as lines: its head, then a line per series (or its error).
  #summary(c, max = Infinity) {
    const ys = c.y.join(", ")
    const out = [`## ${c.id} — ${c.title} (${ys} vs ${c.x ?? "row"})${c.kind !== "line" ? ` · ${c.kind}` : ""}`]
    for (const s of c.series) out.push(`  ${seriesLine(s, this.counts.get(`${c.id}\u0000${s.name}`) ?? s.points.length)}`)
    if (!c.series.length && !c.error) out.push("  (not read yet)")
    if (c.error) out.push(`  (error: ${c.error})`)
    return out.slice(0, max)
  }

  brief() {
    const n = this.state.charts.length
    return n ? `${n} chart${n === 1 ? "" : "s"}` : "no charts yet"
  }

  // Every chart's numbers, ≤ PROMPT_LINES lines in all (the rest: charts.show).
  render(agent) {
    const own = (c) => !agent || agent.tools?.has(`${this.name}.${c}`)
    const can = ["plot", "remove", "show"].filter(own).map((c) => `${this.name}.${c}`)
    const head = `the desk's charts — workspace metrics files drawn for the owner, re-read as they grow${can.length ? `: ${can.join(", ")}` : ""}`
    if (!this.state.charts.length) return `${head}\n(no charts yet)`
    const lines = this.state.charts.flatMap((c) => this.#summary(c))
    if (lines.length + 1 <= PROMPT_LINES) return [head, ...lines].join("\n")
    const shown = lines.slice(0, PROMPT_LINES - 2)
    return [head, ...shown, `… ${lines.length - shown.length} more lines: ${this.name}.show {id}`].join("\n")
  }
}
