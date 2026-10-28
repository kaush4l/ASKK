import { Artifact } from "../artifact/artifact.js"
import { hostError, lineDiff } from "./files.js"
import { checkVisual } from "./visual.js"
import { clip, oneLine } from "../util/text.js"

// Surgeon (2026-10-26 owner: "create an LLM surgeon live artifact … build an LLM and during runtime, be able to pause
// it at steps to understand. This can be any part of it … like the intellij debug, where we stop the java code … at a
// step, be able to look and understand flow … the lead can start the project in debug and the live view will let me a
// visual view of the data … talk to the desk, ask questions, run things, compare observations … when I ask for an
// inner feature view, the lead should be able to write the view that can visually show me"): a model run under a
// debugger, the run itself a program in the holder's terminal (a desk's Python runtime — custom/lab's
// lab/askklab/surgeon.py — that stops on breakpoints). They talk through files in the workspace folder (`folder`,
// default surgeon/): the artifact appends commands to cmd.json ({cmds: [{n, do, …}]}, n rising, each done once); the
// runtime rewrites state.json (status running | paused | ended | error, ack = the last n done, heartbeat, the frame
// where it stopped with its tensors' stats, the flow of debug points, breakpoints, patches, metrics, views, log) and
// writes each view as views/<id>.json — a preview visual (visual.js), checked here and drawn by the UI.
//
//   surgeon.start    {script, args?, why}   the run in debug, in the holder's terminal long session (lease gpu):
//                                           uv run --frozen --no-sync python -B <script> <args> --debug --folder <folder>
//   surgeon.continue {}                     run on to the next breakpoint (waits for it, or says it is running)
//   surgeon.step     {}                     step INTO: stop at the next debug point the forward pass reaches
//   surgeon.next     {}                     step OVER: stop at the next step (training) or token (generation)
//   surgeon.pause    {}                     stop wherever it is now (the next debug point)
//   surgeon.break    {at, step?, every?, nan?, phase?, id?}   a breakpoint: a debug point (a module), "step", or "*"
//                                           with nan: true (stop on the first NaN/Inf — the exception breakpoint)
//   surgeon.clear    {id}                   a breakpoint off ("all": every one)
//   surgeon.inspect  {target?, view?, script?, id?, title?, k?}   a view of the frame: target out | in | attn | a
//                                           parameter | grad:<parameter>; view auto | attn | lens | matrix | hist |
//                                           topk | pca | bars; script: a view the agent wrote (lab/views/<name>.py,
//                                           def view(tensor, ctx) → a visual) — the inner feature the owner asked for
//   surgeon.patch    {at, kind, units, factor?}  from now on: ablate / scale units of a debug point's output
//   surgeon.unpatch  {id}
//   surgeon.compare  {a, b, note?}          two views side by side in the pane (observations compared)
//   surgeon.stop     {}
//   2026-10-26 owner ("the lead should be able to visual code the last run and show me the live replay. Then based on
//   question and relating between procedure and observation … the lead can change the code run the training"): every
//   run is RECORDED by the runtime in <folder>/runs/<id>/ (r1, r2 …: run.json — config, series, flow over the run,
//   weight snapshots, code_map, a copy of the experiment's code — trace.jsonl, snaps/, probe.pt; runs/index.json lists
//   them). On a recorded run:
//   surgeon.runs     {}                     the recorded runs (newest last): args, status, final metrics, snapshots
//   surgeon.timeline {run?}                 a run's whole course in the pane: its metrics and the flow of every debug
//                                           point over the steps (|act| mean, points × steps)
//   surgeon.replay   {run?, view?, at?, target?, head?, script?, id?, title?}   one view drawn across the run's weight
//                                           snapshots — a frame per step, played in the pane (the live replay): the
//                                           runtime's own --replay mode, run here in a terminal (slot replay:<id>: replays side by side never replace each other)
//   surgeon.source   {point, run?}          the PROCEDURE behind a debug point: its class's forward and the line that
//                                           calls it, from that run's copy of the code — shown beside the views
//   surgeon.diff     {a, b}                 two runs: what changed in the code (a diff per file) and in the metrics
//                                           (their curves overlaid) — after the code was changed and the model retrained
// The owner asks about what is in the pane: ownerCall("ask", [{id, text, on?}]) → {deliver, keeper} (the run's starter,
// else the lead: guidance while it runs, else a run).
// The owner drives the same run from the view (Continue, Step into, Step over, Pause, Stop, a breakpoint on a flow
// point, Inspect, Compare): ownerCall(method, [{id, …}]) — the artifact's own calls, never a run of an agent.
//
// State {folder, session: {id, command, script, args, why, by, at, status} | null, runtime: state.json as read (frame,
// flow, points, breakpoints, patches, metrics, log, status, step, phase, ack, heartbeat, error) | null, stale (no
// heartbeat for STALE_MS while it says running or paused), views: [{id, title, point, step, phase, target, view, at,
// visual | null, error?}] ≤ VIEWS (the newest INLINE carry their visual), compare: {a, b, note} | null, sent (the last
// command n), runs: [{id, script, args, phase, status, started, ended, step, total, final, snaps, parent, error}] ≤ RUNS,
// timeline: {run, status, args, step, total, final, series, flow: {points, steps, values}, snaps, parent, files} | null,
// replays: [{id, run, view, at, target, title, steps, visual | null, error?, lines, by, at_time}] ≤ REPLAYS, source:
// {run, point, cls, file, from, to, mark, lines: [{n, text}], call} | null, diff: {a, b, files: [{file, diff, added,
// removed}], final: {a, b}, series} | null, asks: [{id, text, on, at}] ≤ ASKS, revision}.

const VIEWS = 16
const INLINE = 8
const INLINE_CHARS = 320_000
const STALE_MS = 15_000
const CMDS = 80
const WAIT_MS = 25_000
const OWNER_WAIT_MS = 4_000
const POLL_MS = 400
const SCRIPT = /^[A-Za-z0-9_.\-/]+\.py$/
const ARG = /^[A-Za-z0-9_.=@:*,\-/]+$/
export const SURGEON_VIEWS = ["auto", "attn", "lens", "matrix", "hist", "topk", "pca", "bars"]
const RESUMING = ["continue", "step", "next"]
const RUNS = 20
const REPLAYS = 8
const ASKS = 12
const REPLAY_WAIT = 300
const RUN_ID = /^r\d{1,5}$/
const VIEW_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const POINT = /^[A-Za-z0-9_.]{1,80}$/
export const REPLAY_VIEWS = ["auto", "attn", "lens", "hist", "topk", "pca", "matrix"]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const num = (v) => (v == null || v === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined)
const fmt = (v) => (v == null ? "?" : Number.isInteger(v) || Math.abs(v) >= 100 ? String(v) : Number(v).toPrecision(3))
const shape = (s) => (Array.isArray(s) ? `[${s.join(",")}]` : "")
const pathOk = (s) => SCRIPT.test(s) && !s.split("/").includes("..") && !s.startsWith("/")

export class Surgeon extends Artifact {
  static about = "a model run under a debugger: breakpoints, step, inspect tensors, patch, compare"
  static options = { folder: "the runtime's folder in the workspace (default surgeon/)" }
  static commands = {
    start: {
      description: 'start a model run in DEBUG: it stops on breakpoints and waits (training or generation) — e.g. script experiments/tiny-gpt/run.py, args "--mode train --steps 2000 --pause-at-start"',
      input: { script: "the run script, a workspace path ending .py", args: "its arguments, space-separated (letters, digits, = @ : * , . - /; no quotes)", why: "what the owner wants to look at" },
      run(i, c) {
        return this.start(i, c)
      },
    },
    continue: { description: "run on to the next breakpoint (answers where it stopped, or that it is still running)", input: {}, run(i, c) { return this.send({ do: "continue" }, c) } },
    step: { description: "step INTO: stop at the next debug point the forward pass reaches", input: {}, run(i, c) { return this.send({ do: "step" }, c) } },
    next: { description: "step OVER: stop at the next training step or generated token", input: {}, run(i, c) { return this.send({ do: "next" }, c) } },
    pause: { description: "stop the run wherever it is now (the next debug point)", input: {}, run(i, c) { return this.send({ do: "pause" }, c) } },
    break: {
      description: 'set a breakpoint: at a debug point (a module name from FLOW), "step" (a step / token boundary), or "*" with nan (stop on the first NaN/Inf)',
      input: { at: "a debug point, step, or *", step: "only at this step (optional)", every: "every N steps (optional)", nan: "true: stop when a NaN/Inf appears there (optional)", phase: "train | generate (optional)", id: "its id (optional)" },
      run(i, c) {
        return this.send(this.breakCmd(i), c)
      },
    },
    clear: { description: "remove a breakpoint (id, or all)", input: { id: "b<n> or all" }, run(i, c) { return this.send({ do: "clear", id: String(i.id ?? "all") }, c) } },
    inspect: {
      description: "make a view of the frame where the run stopped, shown in the surgeon pane — or a view you wrote (script)",
      input: { target: "out | in | attn | a parameter name | grad:<parameter> (default: attn, else out)", view: `${SURGEON_VIEWS.join(" | ")} (default auto)`, script: "your own view: a workspace .py defining view(tensor, ctx) → a visual (optional)", title: "what it shows (optional)", id: "its id (optional; the same id redraws it)", k: "top-k for topk (optional)" },
      run(i, c) {
        return this.inspect(i, c)
      },
    },
    patch: {
      description: "from now on change a debug point's output: kind ablate (units → 0) or scale (units × factor)",
      input: { at: "a debug point", kind: "ablate | scale", units: "all, or unit numbers comma-separated", factor: "for scale" },
      run(i, c) {
        return this.send(this.patchCmd(i), c)
      },
    },
    unpatch: { description: "remove a patch (id, or all)", input: { id: "p<n> or all" }, run(i, c) { return this.send({ do: "unpatch", id: String(i.id ?? "all") }, c) } },
    compare: { description: "put two views side by side in the pane (observations compared)", input: { a: "a view id", b: "another view id", note: "what to compare (optional)" }, run(i) { return this.setCompare(i) } },
    stop: { description: "end the run", input: {}, run(i, c) { return this.send({ do: "stop" }, c) } },
    runs: { description: "the recorded runs (every debug run is recorded: its trace, weight snapshots and a copy of its code), newest last", input: {}, run() { return this.runsText() } },
    timeline: { description: "show a recorded run's whole course in the pane: its metrics and every debug point's |act| over the steps", input: { run: "a run id r<n> (default: the newest)" }, run(i, c) { return this.timeline(i, c) } },
    replay: {
      description: "THE LIVE REPLAY: draw one view across a recorded run's weight snapshots — a frame per training step, played in the pane (attention forming, the lens sharpening, a feature appearing); prints the numbers per step",
      input: { run: "r<n> (default: the newest with snapshots)", view: `${REPLAY_VIEWS.join(" | ")} (default: lens without at, attn at an attention point)`, at: "a debug point (lens: none — every block)", target: "out | in | attn | a parameter of that point, e.g. qkv.weight (default out)", head: "attn: the head (default 0)", script: "your own view: a workspace .py defining view(tensor, ctx), drawn at every snapshot (matrix, bars or scatter)", id: "its id (optional; the same id redraws it)", title: "what it shows (optional)" },
      run(i, c) {
        return this.replay(i, c)
      },
    },
    source: { description: "the PROCEDURE behind a debug point: the code of its forward and the line that calls it, from that run's own copy of the code — shown in the pane beside the views", input: { point: "a debug point", run: "r<n> (default: the run on the timeline, else the newest)" }, run(i, c) { return this.source(i, c) } },
    diff: { description: "compare two recorded runs: their code change (a diff per file) and their metrics (curves overlaid) — after you changed the code and trained again", input: { a: "the earlier run r<n>", b: "the later run r<n>" }, run(i, c) { return this.diff(i, c) } },
  }
  static owner = {
    continue() { return this.ownerSend({ do: "continue" }) },
    step() { return this.ownerSend({ do: "step" }) },
    next() { return this.ownerSend({ do: "next" }) },
    pause() { return this.ownerSend({ do: "pause" }) },
    stop() { return this.ownerSend({ do: "stop" }) },
    break(a) { return this.ownerSend(this.breakCmd(a)) },
    clear(a) { return this.ownerSend({ do: "clear", id: String(a.breakpoint ?? "all") }) },
    inspect(a) { return this.ownerSend(this.inspectCmd(a)) },
    unpatch(a) { return this.ownerSend({ do: "unpatch", id: String(a.patch ?? "all") }) },
    compare(a) { return { compare: this.setCompare(a) } },
    async timeline(a) { return { text: await this.timeline(a, {}) } },
    async replay(a) { return { text: await this.replay(a, {}) } },
    async source(a) { return { text: await this.source(a, {}) } },
    async diff(a) { return { text: await this.diff(a, {}) } },
    ask(a) { return this.ownerAsk(a) },
  }
  static ownerCan = "continue, step, next, pause, stop, break, clear, inspect, unpatch, compare, timeline, replay, source, diff or ask"

  constructor({ id = "surgeon", folder = "surgeon", clock = () => new Date(), waitMs = WAIT_MS, ownerWaitMs = OWNER_WAIT_MS, pollMs = POLL_MS } = {}) {
    super({ name: id, title: id === "surgeon" ? "surgeon — a model run under the debugger" : `${id} — surgeon` })
    Object.assign(this, { kind: "surgeon", view: "surgeon", keep: "always", clock, waitMs, ownerWaitMs, pollMs })
    this.folder = String(folder).replace(/^\/+|\/+$/g, "")
    this.state = { folder: this.folder, session: null, runtime: null, stale: false, views: [], compare: null, sent: 0, runs: [], whys: {}, timeline: null, replays: [], source: null, diff: null, asks: [], revision: 0 }
    this.poll = 1500
    this.host = null // a holder's host (the owner's calls have no agent)
  }

  restore(data) {
    if (!data || typeof data !== "object") return
    const list = (k) => (Array.isArray(data[k]) ? data[k] : [])
    this.state = { ...this.state, session: data.session ?? null, runtime: data.runtime ?? null, views: list("views"), compare: data.compare ?? null, sent: Number(data.sent) || 0, runs: list("runs"), whys: data.whys && typeof data.whys === "object" ? data.whys : {}, timeline: data.timeline ?? null, replays: list("replays"), source: data.source ?? null, diff: data.diff ?? null, asks: list("asks") }
  }

  attach(agent) {
    this.host ??= agent?.context?.host ?? null
  }

  #host(ctx) {
    const host = ctx?.host ?? ctx?.agent?.context?.host ?? this.host
    if (!host) throw new Error(`${this.name}: no host yet (a holder has not run)`)
    this.host ??= host
    return host
  }

  async #read(path, host) {
    try {
      return (await host.get(`fs/read?path=${encodeURIComponent(path)}`))?.text ?? null
    } catch (e) {
      if (e?.status === 404) return null
      throw e
    }
  }

  // ---- start ----

  async start({ script, args = "", why = "" } = {}, ctx = {}) {
    const s = oneLine(script ?? "")
    if (!pathOk(s)) throw new Error('script: the run script, a workspace path ending .py, e.g. "experiments/tiny-gpt/run.py"')
    const list = String(args ?? "").split(/\s+/).filter(Boolean)
    const bad = list.find((a) => !ARG.test(a) || a === "--folder" || a === "--debug")
    if (bad) throw new Error(`args: "${clip(bad, 40)}" — words of letters, digits and = @ : * , . - / only (no quotes or spaces inside one; --debug and --folder are added here)`)
    const host = this.#host(ctx)
    const command = ["uv", "run", "--frozen", "--no-sync", "python", "-B", s, ...list, "--debug", "--folder", this.folder].join(" ")
    let r
    try {
      r = await host.post("term/start", { command, name: `surgeon:${this.name}`, agent: ctx.agent?.name ?? null, writes: ctx.agent?.config?.writes ?? [], slot: "long", replace: true, lease: "gpu", wait: 0 }, { signal: ctx.signal })
    } catch (e) {
      throw new Error(`term/start: ${hostError(e)}`)
    }
    const at = this.clock().toISOString()
    // the runtime writes its first state once the model is built (an old state.json is another run's: its pid differs)
    const old = this.state.runtime?.run?.pid ?? null
    this.bump({ session: { id: r?.session?.id ?? null, command, script: s, args: list.join(" "), why: clip(oneLine(why), 300), by: ctx.agent?.name ?? null, at, status: r?.session?.status ?? "running" }, runtime: null, stale: false, views: [], compare: null })
    const rt = await this.#await((x) => x?.run?.pid != null && x.run.pid !== old, ctx, this.waitMs)
    return rt ? `${command}\nstarted: ${this.#line(rt)}` : `${command}\nstarted (session ${this.state.session.id}) — no state from the runtime yet: look again in a moment (${this.name}.pause, or terminal.read the session for an error)`
  }

  // ---- commands ----

  async #append(cmd, host) {
    const path = `${this.folder}/cmd.json`
    let cmds = []
    try {
      cmds = JSON.parse((await this.#read(path, host)) ?? "{}").cmds ?? []
    } catch {
      cmds = []
    }
    const n = Math.max(this.state.sent, this.state.runtime?.ack ?? 0, ...cmds.map((c) => Number(c?.n) || 0)) + 1
    cmds = [...cmds, { n, ...cmd }].slice(-CMDS)
    try {
      await host.post("fs/write", { path, text: JSON.stringify({ cmds }) })
    } catch (e) {
      throw new Error(`fs/write ${path}: ${hostError(e)}`)
    }
    this.bump({ sent: n })
    return n
  }

  // Reads state.json until done(runtime) or the wait ends → the runtime when done, else null.
  async #await(done, ctx, ms) {
    const host = this.#host(ctx)
    const until = Date.now() + ms
    for (;;) {
      const rt = await this.#pull(host)
      if (done(rt)) return rt
      if (ctx?.signal?.aborted || Date.now() >= until) return null
      await sleep(this.pollMs)
    }
  }

  async send(cmd, ctx = {}, ms = this.waitMs) {
    if (!this.state.session) throw new Error(`no run: ${this.name}.start {script, args} first`)
    const host = this.#host(ctx)
    const n = await this.#append(cmd, host)
    const resuming = RESUMING.includes(cmd.do)
    const settled = (rt) => !!rt && (["ended", "error"].includes(rt.status) || ((rt.ack ?? 0) >= n && (!resuming || rt.status !== "running")))
    const rt = await this.#await(settled, ctx, ms)
    if (rt) return `${cmd.do} → ${this.#line(rt)}${rt.error ? `\n! ${rt.error}` : ""}`
    const last = this.state.runtime
    if (resuming && last && (last.ack ?? 0) >= n) return `${cmd.do}: running (step ${last.step}) — no breakpoint hit yet; ${this.name}.pause stops it, or look again`
    return `${cmd.do} sent (command ${n}) — the runtime has not taken it yet${this.state.stale ? " (no heartbeat: is the run alive? terminal.read its session)" : ""}`
  }

  async ownerSend(cmd) {
    return { sent: cmd.do, text: await this.send(cmd, {}, this.ownerWaitMs) }
  }

  breakCmd(i = {}) {
    const at = oneLine(i.at ?? "")
    if (!at) throw new Error("at: a debug point (FLOW lists them), step, or *")
    const pts = this.state.runtime?.points
    if (pts?.length && at !== "step" && at !== "*" && !pts.includes(at)) throw new Error(`at: "${clip(at, 60)}" is not a debug point — ${pts.slice(0, 40).join(", ")}, step, *`)
    const cmd = { do: "break", at }
    for (const k of ["step", "every"]) if (num(i[k]) !== undefined) cmd[k] = num(i[k])
    if (i.nan === true || i.nan === "true") cmd.nan = true
    if (i.phase === "train" || i.phase === "generate") cmd.phase = i.phase
    if (i.id) cmd.id = oneLine(i.id).slice(0, 20)
    return cmd
  }

  inspectCmd(i = {}) {
    if (this.state.runtime?.status !== "paused") throw new Error(`the run is ${this.state.runtime?.status ?? "not started"}: inspect works where it stopped (${this.name}.pause or a breakpoint first)`)
    const cmd = { do: "inspect" }
    if (i.target) cmd.target = oneLine(i.target).slice(0, 80)
    if (i.script) {
      const s = oneLine(i.script)
      if (!pathOk(s)) throw new Error("script: a workspace .py path, e.g. lab/views/features.py, defining view(tensor, ctx)")
      cmd.script = s
    } else if (i.view) {
      if (!SURGEON_VIEWS.includes(i.view)) throw new Error(`view: ${SURGEON_VIEWS.join(" | ")} — or script: your own`)
      cmd.view = i.view
    }
    if (i.title) cmd.title = clip(oneLine(i.title), 120)
    if (i.id) {
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(String(i.id))) throw new Error("id: letters, digits, - or _ (≤ 32)")
      cmd.id = String(i.id)
    }
    if (num(i.k) !== undefined) cmd.k = Math.max(1, Math.min(60, num(i.k)))
    return cmd
  }

  async inspect(i, ctx) {
    const text = await this.send(this.inspectCmd(i), ctx)
    const v = this.state.views.at(-1)
    return v ? `${text}\nview ${v.id}: ${v.title}${v.error ? ` — ${v.error}` : ""} (in the surgeon pane)` : text
  }

  patchCmd(i = {}) {
    const kind = i.kind === "scale" ? "scale" : "ablate"
    const units = !i.units || i.units === "all" ? "all" : String(i.units).split(/[,\s]+/).map(Number).filter(Number.isInteger)
    const at = oneLine(i.at ?? "")
    if (!at) throw new Error("at: a debug point")
    return { do: "patch", at, kind, units, ...(kind === "scale" ? { factor: num(i.factor) ?? 0 } : {}) }
  }

  setCompare({ a, b, note = "" } = {}) {
    const ids = [...this.state.views, ...this.state.replays].map((v) => v.id)
    for (const x of [a, b]) if (!ids.includes(String(x))) throw new Error(`"${clip(String(x ?? ""), 30)}" is not a view — ${ids.join(", ") || "none yet"}`)
    this.bump({ compare: { a: String(a), b: String(b), note: clip(oneLine(note), 300) } })
    return `comparing ${a} and ${b} side by side in the surgeon pane`
  }

  // ---- reading the runtime ----

  async #pull(host) {
    const text = await this.#read(`${this.folder}/state.json`, host).catch(() => null)
    if (!text) return this.state.runtime
    let raw
    try {
      raw = JSON.parse(text)
    } catch {
      return this.state.runtime // half a file: the next read
    }
    const runtime = this.#slim(raw)
    const stale = ["running", "paused"].includes(runtime.status) && Date.now() - Number(runtime.heartbeat) * 1000 > STALE_MS
    const views = await this.#views(raw, host)
    if (JSON.stringify(runtime) !== JSON.stringify(this.state.runtime) || stale !== this.state.stale || views !== this.state.views) {
      const s = this.state.session
      let session = s && ["ended", "error"].includes(runtime.status) && s.status !== runtime.status ? { ...s, status: runtime.status } : s
      const rid = runtime.run?.id
      const whys = session && rid && !session.run ? { ...this.state.whys, [rid]: session.why } : this.state.whys
      if (session && rid && !session.run) session = { ...session, run: rid }
      this.bump({ runtime, stale, views, session, whys })
    }
    return runtime
  }

  #slim(rt) {
    const f = rt.frame
    return {
      status: rt.status ?? "unknown",
      step: rt.step ?? null,
      phase: rt.phase ?? null,
      ack: Number(rt.ack) || 0,
      heartbeat: rt.heartbeat ?? null,
      run: rt.run ? { id: rt.run.id ?? null, script: rt.run.script ?? null, started: rt.run.started ?? null, phase: rt.run.phase ?? null, pid: rt.run.pid ?? null } : null,
      frame: f ? { kind: f.kind, point: f.point ?? null, step: f.step, phase: f.phase, call: f.call ?? null, reason: clip(oneLine(f.reason ?? ""), 200), tensors: (f.tensors ?? []).slice(0, 24), tokens: Array.isArray(f.tokens) ? f.tokens.slice(-64).map((t) => String(t).slice(0, 4)) : null } : null,
      flow: (rt.flow ?? []).slice(0, 120).map((x) => ({ point: String(x.point), calls: x.calls ?? 0, absmean: x.absmean ?? null, step: x.step ?? null })),
      points: (rt.points ?? []).slice(0, 200).map(String),
      breakpoints: (rt.breakpoints ?? []).slice(0, 40),
      patches: (rt.patches ?? []).slice(0, 20),
      metrics: Object.fromEntries(Object.entries(rt.metrics ?? {}).slice(0, 8).map(([k, v]) => [k, (Array.isArray(v) ? v : []).slice(-200)])),
      log: (rt.log ?? []).slice(-20).map((l) => clip(String(l), 200)),
      error: rt.error ? clip(String(rt.error), 400) : null,
    }
  }

  // The runtime's views, each file read and checked once per redraw (its "at"); the newest INLINE carry the visual.
  // → the same array when nothing changed (so the twin is bumped only on news).
  async #views(rt, host) {
    const list = (rt.views ?? []).slice(-VIEWS)
    const was = new Map(this.state.views.map((v) => [v.id, v]))
    let changed = list.length !== this.state.views.length
    const out = []
    for (const [k, v] of list.entries()) {
      const id = String(v.id)
      const inline = k >= list.length - INLINE
      const row = { id, title: clip(String(v.title ?? id), 120), point: v.point ?? null, step: v.step ?? null, phase: v.phase ?? null, target: v.target ?? null, view: v.view ?? null, at: v.at ?? null }
      const old = was.get(id)
      if (old && old.at === row.at && this.state.views[k]?.id === id && (!inline || old.visual || old.error)) {
        out.push(!inline && old.visual ? ((changed = true), { ...old, visual: null }) : old)
        continue
      }
      changed = true
      if (!inline) {
        out.push({ ...row, visual: null })
        continue
      }
      try {
        const text = await this.#read(`${this.folder}/views/${id}.json`, host)
        if (text == null) throw new Error("its file is not there")
        if (text.length > INLINE_CHARS) throw new Error(`${Math.round(text.length / 1000)} KB — too big to draw here`)
        out.push({ ...row, visual: checkVisual(JSON.parse(text), { maxChars: INLINE_CHARS }) })
      } catch (e) {
        out.push({ ...row, visual: null, error: clip(e.message, 200) })
      }
    }
    return changed ? out : this.state.views
  }

  async refresh(agent) {
    this.host ??= agent?.context?.host ?? null
    if (!this.host) return
    if (this.state.session) await this.#pull(this.host)
    await this.#runs(this.host)
  }

  // ---- the recorded runs ----

  async #runs(host) {
    const text = await this.#read(`${this.folder}/runs/index.json`, host).catch(() => null)
    if (!text) return this.state.runs
    let runs
    try {
      runs = (JSON.parse(text).runs ?? []).slice(-RUNS).map((r) => ({ id: String(r.id), script: r.script ?? null, args: clip(String(r.args ?? ""), 200), phase: r.phase ?? null, status: r.status ?? null, started: r.started ?? null, ended: r.ended ?? null, step: r.step ?? null, total: r.total ?? null, final: r.final ?? {}, snaps: Number(r.snaps) || 0, parent: r.parent ?? null, error: r.error ? clip(String(r.error), 200) : null, why: this.state.whys?.[String(r.id)] ?? null }))
    } catch {
      return this.state.runs
    }
    if (JSON.stringify(runs) !== JSON.stringify(this.state.runs)) this.bump({ runs })
    return runs
  }

  async #record(run, host) {
    if (!RUN_ID.test(String(run ?? ""))) throw new Error(`run: a recorded run id r<n> — ${this.state.runs.map((r) => r.id).join(", ") || "none yet (every debug run is recorded)"}`)
    const text = await this.#read(`${this.folder}/runs/${run}/run.json`, host)
    if (!text) throw new Error(`run ${run}: not recorded here — ${this.state.runs.map((r) => r.id).join(", ") || "none yet"}`)
    return JSON.parse(text)
  }

  // The run a command is about: the one named, else (snaps: the newest with weight snapshots) the run on the timeline,
  // else the live run, else the newest. → {host, rec}
  async #pick(run, ctx, { snaps = false } = {}) {
    const host = this.#host(ctx)
    const runs = await this.#runs(host)
    const id = run ? String(run) : snaps ? runs.findLast((r) => r.snaps > 0)?.id : (this.state.timeline?.run ?? this.state.runtime?.run?.id ?? runs.at(-1)?.id)
    if (!id) throw new Error(`no recorded run${snaps ? " with weight snapshots" : ""} yet: ${this.name}.start a training run (every debug run is recorded)`)
    return { host, rec: await this.#record(id, host) }
  }

  runsText() {
    const rs = this.state.runs
    if (!rs.length) return "no recorded runs yet — every surgeon.start run is recorded"
    return rs.map((r) => `${r.id} ${r.status} ${r.phase ?? ""} step ${r.step ?? "?"}/${r.total ?? "?"} ${r.args}${Object.keys(r.final).length ? ` · ${Object.entries(r.final).map(([k, v]) => `${k} ${fmt(v)}`).join(" ")}` : ""} · ${r.snaps} snapshots${r.parent ? ` · after ${r.parent}` : ""}${r.why ? ` · for: ${r.why}` : ""}${r.error ? ` · ! ${r.error}` : ""}`).join("\n")
  }

  async timeline({ run } = {}, ctx = {}) {
    const { rec } = await this.#pick(run, ctx)
    const series = Object.fromEntries(Object.entries(rec.series ?? {}).slice(0, 8).map(([k, v]) => [k, (Array.isArray(v) ? v : []).slice(-200)]))
    const f = rec.flow
    const flow = f?.points?.length && f.steps?.length ? { points: f.points.slice(0, 64).map(String), steps: f.steps.slice(0, 64), values: f.values.slice(0, 64).map((row) => row.slice(0, 64).map((v) => (v == null ? 0 : Number(v)))) } : null
    const timeline = { run: rec.id, status: rec.status, args: rec.args ?? {}, step: rec.step, total: rec.total, final: rec.final ?? {}, series, flow, snaps: (rec.snaps ?? []).slice(0, 40), parent: rec.parent ?? null, files: (rec.files ?? []).slice(0, 20), started: rec.started, ended: rec.ended }
    this.bump({ timeline })
    const grew = flow ? flow.points.map((p, i) => [p, flow.values[i][0], flow.values[i].at(-1)]).filter(([, a, b]) => a && b).sort((x, y) => y[2] / y[1] - x[2] / x[1]).slice(0, 4) : []
    return [`timeline ${rec.id} (${rec.status}, step ${rec.step}/${rec.total ?? "?"}) in the surgeon pane`, `final ${Object.entries(timeline.final).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ") || "none"}`, flow ? `flow ${flow.points.length} points × ${flow.steps.length} steps (${flow.steps[0]}…${flow.steps.at(-1)}); grew most: ${grew.map(([p, a, b]) => `${p} ${fmt(a)}→${fmt(b)}`).join(", ")}` : "no flow recorded", `snapshots at ${timeline.snaps.join(", ") || "none"} — ${this.name}.replay draws a view across them`, `code ${timeline.files.join(", ")}${rec.parent ? ` · the run before: ${rec.parent} (${this.name}.diff {a: "${rec.parent}", b: "${rec.id}"})` : ""}`].join("\n")
  }

  replayCmd(i = {}, rec) {
    const words = ["--replay", rec.id]
    const view = i.view ? String(i.view) : null
    if (view && !REPLAY_VIEWS.includes(view)) throw new Error(`view: ${REPLAY_VIEWS.join(" | ")} — or script: your own`)
    if (i.script) {
      const sc = oneLine(i.script)
      if (!pathOk(sc)) throw new Error("script: a workspace .py path, e.g. lab/views/features.py, defining view(tensor, ctx)")
      words.push("--script", sc)
    } else if (view) words.push("--view", view)
    const pts = Object.keys(rec.code_map ?? {})
    if (i.at) {
      const at = oneLine(i.at)
      if (!POINT.test(at) || (pts.length && !pts.includes(at))) throw new Error(`at: "${clip(at, 60)}" is not a debug point of ${rec.id} — ${pts.slice(0, 40).join(", ")}`)
      words.push("--at", at)
    } else if (i.script || (view && view !== "lens" && view !== "auto")) throw new Error(`at: the debug point to replay (${pts.slice(0, 12).join(", ")} …)`)
    if (i.target) {
      const t = oneLine(i.target)
      if (!/^[A-Za-z0-9_.]{1,60}$/.test(t)) throw new Error("target: out | in | attn | a parameter name like qkv.weight")
      words.push("--target", t)
    }
    if (num(i.head) !== undefined) words.push("--head", String(Math.max(0, Math.min(63, Math.trunc(num(i.head))))))
    const id = i.id ? String(i.id) : `rp${Math.max(0, ...this.state.replays.map((r) => Number(/^rp(\d+)$/.exec(r.id)?.[1]) || 0)) + 1}`
    if (!VIEW_ID.test(id)) throw new Error("id: letters, digits, - or _ (≤ 32)")
    words.push("--id", id)
    return { words, id, view: i.script ? `script:${oneLine(i.script).split("/").at(-1).replace(/\.py$/, "")}` : view ?? "auto" }
  }

  async replay(i = {}, ctx = {}) {
    const { host, rec } = await this.#pick(i.run, ctx, { snaps: true })
    if (!(rec.snaps ?? []).length) throw new Error(`run ${rec.id} has no weight snapshots (a generation run, or it ended first) — replay a training run`)
    if (!pathOk(String(rec.script ?? ""))) throw new Error(`run ${rec.id}: its script is unknown`)
    const { words, id, view } = this.replayCmd(i, rec)
    const title = i.title ? clip(oneLine(i.title), 120) : null
    const command = ["uv", "run", "--frozen", "--no-sync", "python", "-B", rec.script, "--folder", this.folder, ...words].join(" ")
    const agent = ctx.agent?.name ?? null
    let r
    try {
      r = await host.post("term/start", { command, name: `surgeon:${this.name}:replay`, agent, writes: agent ? (ctx.agent?.config?.writes ?? []) : [`${this.folder}/**`], slot: `replay:${id}`, replace: true, wait: REPLAY_WAIT }, { signal: ctx.signal })
    } catch (e) {
      throw new Error(`term/start: ${hostError(e)}`)
    }
    const sess = r?.session ?? {}
    const lines = (sess.tail ?? []).map((l) => clip(String(l), 200)).filter((l) => !/^\$ /.test(l)).slice(-30)
    const row = { id, run: rec.id, view, at: i.at ? oneLine(i.at) : null, target: i.target ? oneLine(i.target) : null, title: title ?? `${rec.id} replay — ${view}${i.at ? ` at ${oneLine(i.at)}` : ""}`, steps: (rec.snaps ?? []).length, lines: lines.filter((l) => /^step \d/.test(l)).slice(-30), by: agent, at_time: this.clock().toISOString(), visual: null }
    if (sess.status === "running") return `${command}\nstill running after ${REPLAY_WAIT} s (session ${sess.id}) — terminal.read it; the replay appears when it ends`
    if (sess.exit !== 0) {
      row.error = clip(lines.filter((l) => /replay:|Error|error/.test(l)).at(-1) ?? `exit ${sess.exit}`, 300)
      this.#putReplay(row)
      return `${command}\nreplay failed (exit ${sess.exit}): ${row.error}\n${lines.slice(-8).join("\n")}`
    }
    try {
      const text = await this.#read(`${this.folder}/views/${id}.json`, host)
      if (text == null) throw new Error("it wrote no view")
      if (text.length > INLINE_CHARS) throw new Error(`${Math.round(text.length / 1000)} KB — too big to draw here (fewer positions or a smaller target)`)
      const visual = checkVisual(JSON.parse(text), { maxChars: INLINE_CHARS })
      if (title) visual.title = title
      row.visual = visual
      if (!title && visual.title) row.title = clip(String(visual.title), 120)
    } catch (e) {
      row.error = clip(e.message, 200)
    }
    this.#putReplay(row)
    return [`replay ${id}: ${row.title} — ${row.steps} frames (steps ${rec.snaps[0]}…${rec.snaps.at(-1)}), playing in the surgeon pane${row.error ? ` — ! ${row.error}` : ""}`, ...row.lines].join("\n")
  }

  #putReplay(row) {
    this.bump({ replays: [...this.state.replays.filter((x) => x.id !== row.id), row].slice(-REPLAYS) })
  }

  async source({ point, run } = {}, ctx = {}) {
    const p = oneLine(point ?? this.state.runtime?.frame?.point ?? "")
    if (!POINT.test(p)) throw new Error("point: a debug point (FLOW lists them)")
    const { host, rec } = await this.#pick(run ?? (this.state.runtime?.status === "paused" ? this.state.runtime.run?.id : null), ctx)
    const cm = rec.code_map?.[p]
    if (!cm) throw new Error(`point: "${p}" is not a debug point of ${rec.id} — ${Object.keys(rec.code_map ?? {}).slice(0, 40).join(", ")}`)
    const where = cm.def ?? (cm.call ? { file: cm.call.file, line: cm.call.line, end: cm.call.line } : null)
    if (!where) throw new Error(`${p} (${cm.cls}) has no code in the experiment's files — it is a library module`)
    const text = await this.#read(`${this.folder}/runs/${rec.id}/code/${where.file}`, host)
    if (text == null) throw new Error(`${rec.id}'s copy of ${where.file} is missing`)
    const all = text.split("\n")
    const from = Math.max(1, (cm.def ? where.line : where.line - 6))
    const to = Math.min(all.length, cm.def ? where.end : where.line + 6)
    const lines = all.slice(from - 1, to).map((t, k) => ({ n: from + k, text: t.slice(0, 200) }))
    let call = null
    if (cm.def && cm.call) {
      const ct = await this.#read(`${this.folder}/runs/${rec.id}/code/${cm.call.file}`, host).catch(() => null)
      call = { file: cm.call.file, line: cm.call.line, text: ct ? (ct.split("\n")[cm.call.line - 1] ?? cm.call.text).trim().slice(0, 200) : cm.call.text }
    }
    const mark = cm.def ? null : where.line
    const sourceState = { run: rec.id, point: p, cls: cm.cls, file: where.file, from, to, mark, lines, call }
    this.bump({ source: sourceState })
    return [`SOURCE ${p} (${cm.cls}) — ${rec.id}'s ${where.file}:${from}-${to}${call ? `; called at ${call.file}:${call.line}: ${call.text}` : ""} (in the surgeon pane)`, ...lines.map((l) => `${String(l.n).padStart(4)}${l.n === mark ? " ▶" : "  "} ${l.text}`)].join("\n")
  }

  async diff({ a, b } = {}, ctx = {}) {
    const host = this.#host(ctx)
    await this.#runs(host)
    const [ra, rb] = [await this.#record(a, host), await this.#record(b, host)]
    const names = [...new Set([...(ra.files ?? []), ...(rb.files ?? [])])].slice(0, 20)
    const files = []
    for (const f of names) {
      const [ta, tb] = [await this.#read(`${this.folder}/runs/${ra.id}/code/${f}`, host).catch(() => null), await this.#read(`${this.folder}/runs/${rb.id}/code/${f}`, host).catch(() => null)]
      const d = lineDiff(ta, tb ?? "", 80)
      if (d.diff) files.push({ file: f, diff: d.diff, added: d.added, removed: d.removed })
    }
    const argsOf = (r) => Object.entries(r.args ?? {}).filter(([k]) => ["mode", "steps", "lr", "d", "layers", "heads", "block", "batch", "seed"].includes(k))
    const argDiff = argsOf(rb).filter(([k, v]) => JSON.stringify((ra.args ?? {})[k]) !== JSON.stringify(v)).map(([k, v]) => `--${k} ${(ra.args ?? {})[k]} → ${v}`)
    const series = []
    for (const k of ["loss", "val_loss"]) {
      for (const r of [ra, rb]) {
        const pts = (r.series?.[k] ?? []).filter((x) => x?.[1] != null).slice(-200)
        if (pts.length > 1) series.push({ name: `${k} ${r.id}`, points: pts })
      }
    }
    const diffState = { a: ra.id, b: rb.id, files, args: argDiff, final: { a: ra.final ?? {}, b: rb.final ?? {} }, series: series.length ? { kind: "line", series, x: "step", title: `${ra.id} vs ${rb.id}` } : null }
    this.bump({ diff: diffState })
    const keys = [...new Set([...Object.keys(ra.final ?? {}), ...Object.keys(rb.final ?? {})])].filter((k) => !["lr"].includes(k))
    return [`DIFF ${ra.id} → ${rb.id} (in the surgeon pane)`, `args ${argDiff.join(", ") || "the same"}`, `final ${keys.map((k) => `${k} ${fmt(ra.final?.[k])} → ${fmt(rb.final?.[k])}`).join(" · ")}`, files.length ? files.map((f) => `${f.file} +${f.added} -${f.removed}\n${f.diff}`).join("\n") : "code: the same"].join("\n")
  }

  ownerAsk({ text, on } = {}) {
    const t = clip(oneLine(text ?? ""), 1000)
    if (!t) throw new Error("text: the question")
    const where = on ? clip(oneLine(on), 200) : this.#where()
    const ask = { id: `q${(Number(this.state.asks.at(-1)?.id?.slice(1)) || 0) + 1}`, text: t, on: where, at: this.clock().toISOString() }
    this.bump({ asks: [...this.state.asks, ask].slice(-ASKS) })
    const deliver = `The owner asks in the surgeon pane (looking at: ${where}): ${t}\nAnswer from the run itself — ${this.name}.timeline / replay / source / inspect / diff as the question needs — relate the procedure (the code) to the observation (the numbers, the view), say it with talk.say, and propose the code change and the run that would test it.`
    return { ask, deliver, keeper: this.state.session?.by ?? null }
  }

  #where() {
    const rt = this.state.runtime
    const f = rt?.frame
    const bits = []
    if (rt?.status === "paused" && f) bits.push(`paused at ${f.point ?? "the step boundary"}, ${f.phase} step ${f.step}`)
    else if (rt) bits.push(`${rt.status} at step ${rt.step ?? "?"}`)
    if (this.state.timeline) bits.push(`timeline ${this.state.timeline.run}`)
    const last = this.state.replays.at(-1)
    if (last) bits.push(`replay ${last.id} (${last.title})`)
    if (this.state.source) bits.push(`source of ${this.state.source.point}`)
    return bits.join("; ") || "the surgeon pane"
  }

  // ---- what the holder and the owner see ----

  #line(rt) {
    if (!rt) return "no state yet"
    const f = rt.frame
    const loss = rt.metrics?.loss?.at(-1)
    if (rt.status === "paused" && f) return `PAUSED at ${f.point ?? "the step boundary"} (${f.phase} step ${f.step}) — ${f.reason}${loss ? ` · loss ${fmt(loss[1])}` : ""}`
    if (rt.status === "error") return `ERROR: ${rt.error}`
    return `${rt.status} · ${rt.phase ?? ""} step ${rt.step ?? "?"}${loss ? ` · loss ${fmt(loss[1])}` : ""}`
  }

  brief() {
    const rt = this.state.runtime
    if (!this.state.session) return "no run"
    if (!rt) return `${this.state.session.script} starting`
    const f = rt.frame
    return [rt.status === "paused" && f ? `paused at ${f.point ?? "step"} · step ${f.step}` : `${rt.status} · step ${rt.step ?? "?"}`, rt.breakpoints.length ? `${rt.breakpoints.length} breakpoints` : null, this.state.views.length ? `${this.state.views.length} views` : null, this.state.stale ? "no heartbeat" : null].filter(Boolean).join(" · ")
  }

  render() {
    const s = this.state.session
    const rt = this.state.runtime
    const how = `start a run: ${this.name}.start {script: "experiments/tiny-gpt/run.py", args: "--mode train --steps 2000 --pause-at-start", why}; then break / continue / step / next / inspect / patch / compare. A view the owner asks for that no kind shows: write lab/views/<name>.py with def view(tensor, ctx) → ctx["viz"].matrix(…) | .bars(…) | .scatter(…) | .tokens(…) | .line(…) | .flow(…) (ctx: point, step, phase, tokens, decode, lens, model, module, frame, title), then ${this.name}.inspect {script: "lab/views/<name>.py", target}. A RECORDED run (every one is): ${this.name}.timeline {run} its course, ${this.name}.replay {run, view, at} a view across its snapshots (the live replay; script works too), ${this.name}.source {point} the code behind a point, ${this.name}.diff {a, b} after a code change and a new run`
    if (!s) return [`SURGEON (${this.folder}/): no run — ${how}`, ...this.#recordedLines()].join("\n")
    const lines = [`SURGEON ${s.script} ${s.args} — session ${s.id}, started ${String(s.at).slice(11, 19)} by ${s.by ?? "?"}${s.why ? ` for: ${s.why}` : ""}`]
    if (!rt) return [...lines, "the runtime has not written its state yet (the model is being built) — look again in a moment", `HOW ${how}`].join("\n")
    lines.push(`STATE ${this.#line(rt)}${this.state.stale ? " — NO HEARTBEAT for 15 s: the process may be gone (terminal.read its session)" : ""}`)
    const f = rt.frame
    if (rt.status === "paused" && f) {
      lines.push(`FRAME ${f.kind}${f.point ? ` ${f.point}` : ""} call ${f.call ?? "?"}: ${f.tensors.map((t) => `${t.name} ${shape(t.shape)} mean ${fmt(t.mean)} std ${fmt(t.std)}${t.nan ? ` NaN×${t.nan}` : ""}`).join(" · ")}`)
      if (f.tokens?.length) lines.push(`INPUT (sample 0, last ${f.tokens.length}): ${JSON.stringify(f.tokens.join("")).slice(0, 200)}`)
    }
    if (rt.flow.length) lines.push(`FLOW (forward order, |act| mean): ${rt.flow.map((x) => `${x.point}${x.absmean != null ? ` ${fmt(x.absmean)}` : ""}${f?.point === x.point ? " ◀" : ""}`).join(" › ")}`)
    else if (rt.points.length) lines.push(`DEBUG POINTS: ${rt.points.join(", ")}`)
    lines.push(`BREAKPOINTS ${rt.breakpoints.length ? rt.breakpoints.map((b) => `${b.id} ${b.at}${b.step != null ? ` step ${b.step}` : ""}${b.every ? ` every ${b.every}` : ""}${b.nan ? " on NaN/Inf" : ""}`).join(" · ") : "none"}`)
    if (rt.patches.length) lines.push(`PATCHES ${rt.patches.map((p) => `${p.id} ${p.kind} ${Array.isArray(p.units) ? p.units.join(",") : p.units} at ${p.at}${p.kind === "scale" ? ` ×${p.factor}` : ""}`).join(" · ")}`)
    const m = Object.entries(rt.metrics).map(([k, v]) => (v.length ? `${k} ${fmt(v.at(-1)[1])}` : null)).filter(Boolean)
    if (m.length) lines.push(`METRICS (step ${rt.step}) ${m.join(" · ")}`)
    if (this.state.views.length) lines.push(`VIEWS ${this.state.views.slice(-10).map((v) => `${v.id} ${v.view ?? ""} of ${v.target ?? "?"} at ${v.point ?? "step"} step ${v.step}${v.error ? ` (! ${v.error})` : ""}`).join(" · ")}`)
    if (this.state.compare) lines.push(`COMPARING ${this.state.compare.a} | ${this.state.compare.b}${this.state.compare.note ? ` — ${this.state.compare.note}` : ""}`)
    if (rt.error) lines.push(`LAST ERROR ${rt.error}`)
    if (rt.log.length) lines.push(`LOG ${rt.log.slice(-5).join(" | ")}`)
    lines.push(...this.#recordedLines(), `HOW ${how}`)
    return lines.join("\n")
  }

  #recordedLines() {
    const st = this.state
    const out = []
    if (st.runs.length) out.push(`RUNS (recorded) ${st.runs.slice(-6).map((r) => `${r.id} ${r.status} step ${r.step ?? "?"}${r.final?.loss != null ? ` loss ${fmt(r.final.loss)}` : ""}${r.final?.val_loss != null ? ` val ${fmt(r.final.val_loss)}` : ""} ${r.snaps} snaps`).join(" · ")}`)
    if (st.timeline) out.push(`TIMELINE ${st.timeline.run} in the pane (${st.timeline.snaps.length} snapshots)`)
    if (st.replays.length) out.push(`REPLAYS ${st.replays.map((r) => `${r.id} ${r.view}${r.at ? ` at ${r.at}` : ""} of ${r.run}${r.error ? ` (! ${r.error})` : ""}`).join(" · ")}`)
    if (st.source) out.push(`SOURCE shown: ${st.source.point} — ${st.source.run}'s ${st.source.file}:${st.source.from}-${st.source.to}`)
    if (st.diff) out.push(`DIFF shown: ${st.diff.a} → ${st.diff.b} (${st.diff.files.length} files changed)`)
    const asks = st.asks.slice(-3)
    if (asks.length) out.push(`OWNER ASKED ${asks.map((q) => `${q.id} (${q.on}): ${clip(q.text, 160)}`).join(" | ")}`)
    return out
  }
}
