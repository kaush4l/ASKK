import { Artifact } from "../artifact/artifact.js"
import { Tool } from "../tool/tool.js"
import { cleanPath, hostError, hostFiles, inLane } from "./files.js"
import { checkVisual, visualBrief } from "./visual.js"

// Stage: what the owner watches while the desk works (2026-10-17 owner: "a live communication artifact — the lead
// shows me a rendering or a canvas to help me follow … interact with the agent and understand observations in
// visuals … as a story to follow"). The page is one the desk built and serves on this computer (a model dashboard, an
// app); the stage puts it before the owner with a story over it — scenes in order, each a view of the page and what
// the agent says it shows — and takes the owner's questions asked on it back to the agent that keeps it. One instance
// per desk (id "stage"); {type: stage, id} makes another.
//
//   stage.show  {url, title?}                          the page on stage: only one open in the desk's preview with no
//                                                      console error (checked there first) — the owner's frame loads it
//   stage.scene {id, title, view?, says, params?, visual?}   a scene (the same id replaces it): view = what the page
//                                                      shows for it (its #<view>), says = what the owner should see, with
//                                                      numbers; visual = one the agent builds itself (builtin/visual.js:
//                                                      flow, steps, matrix, line, bars, tokens, scatter), inline or
//                                                      {file: "<workspace>.json"} — read again as the file changes
//   stage.go    {id}                                   the owner is taken to that scene (a follower's frame moves)
//   stage.reply {ask, text, scene?}                    answers a question the owner asked on the stage; scene: show it
//   stage.cut   {id}                                   drops a scene
//
// The owner (the UI, team/call {target: "artifact", method: "ask", args: [{id, text, scene?, context?}]}): ownerCall
// ("ask") records an open question and returns {deliver, keeper}: the host hands that text to the keeper (the first
// holder of stage.reply) — guidance while it runs, else a new run.
// gate(agent): a holder of stage.reply answers only when no owner question is open.
// The page and the stage talk over postMessage (backend/live/stage.js): the UI sends {askk: "scene", scene}, the page
// sends {askk: "at" | "ask", …}; the kernel only keeps the story and the questions.
// keep "always": the story outlives runs and restarts (the page's server may not; the UI says when it is gone). A file
// visual is saved as its path and read again (refresh(agent): at most every VISUAL_MS, coalesced; changed() only when a
// visual differs); a file that is gone or wrong keeps its last visual with an error line.
// Twin state: {page: {url, title, by, at} | null, scenes: [{id, title, view, says, params, visual, by, at}] ≤ 16
//   (visual: the normalized spec + file?, error?, read_at?),
//   current: scene id | null, asks: [{id, text, scene, context, from, at, answer: {text, scene, by, at} | null}] ≤ 40,
//   revision} — revision moves on every change, so a follower sees each stage.go.

const SCENES_MAX = 16
const ASKS_MAX = 40
const TITLE_MAX = 80
const SAYS_MAX = 900
const ASK_MAX = 1500
const ANSWER_MAX = 1500
const PARAMS_MAX = 1000 // chars of JSON
const PROMPT_SAYS = 220
const PROMPT_ANSWERED = 3
const SCENE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const VIEW = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])
const INLINE_MAX = 24000 // chars of an inline visual's JSON (written in a tool call)
const FILE_MAX = 300000 // chars of a visual file
const FILES_MAX = 1200000 // chars of every visual file together (each change streams the stage to every tab)
const VISUAL_MS = 3000

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s))
const ctxOf = (agent) => ({ ...(agent?.context ?? {}), agent })
// ASKK's configuration, never read (files.js keeps the same rule).
const secret = (path) => {
  const name = String(path).split("/").at(-1) ?? ""
  return name === ".mcp.json" || (/^\.env(\..+)?$/.test(name) && name !== ".env.example")
}

// A page the owner's tab may frame: http(s) on this computer with a port (the host's preview rules, browser.js, keep
// the desk server's own ports out — a page shown here was opened through them first).
export function stageUrl(raw) {
  let u
  try {
    u = new URL(String(raw ?? "").trim())
  } catch {
    throw new Error(`url: "${clip(raw ?? "", 120)}" is not a URL — the page's address, e.g. http://127.0.0.1:8077/`)
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error(`url: ${u.protocol} — only http(s) pages`)
  if (!LOOPBACK.has(u.hostname)) throw new Error(`url: ${u.hostname} — only pages on this computer (localhost, 127.0.0.1, [::1])`)
  if (!u.port) throw new Error("url: name the page's port (http://127.0.0.1:<port>/)")
  u.hash = ""
  return u.toString()
}

// The same page in two URLs: origin and path (a query or #view differs between scenes, not pages).
const samePage = (a, b) => {
  try {
    const x = new URL(a)
    const y = new URL(b)
    const host = (u) => (u.hostname === "localhost" || u.hostname === "[::1]" ? "127.0.0.1" : u.hostname)
    return x.protocol === y.protocol && host(x) === host(y) && x.port === y.port && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "")
  } catch {
    return false
  }
}

// Scene params from what a model sends: an object or its JSON text; only plain data, ≤ PARAMS_MAX chars.
function paramsOf(raw) {
  if (raw == null || raw === "") return null
  let p = raw
  if (typeof raw === "string") {
    try {
      p = JSON.parse(raw)
    } catch {
      throw new Error(`params: not JSON (${clip(raw, 80)}) — an object such as {"layer": 2, "head": 1, "step": 800}`)
    }
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error('params: an object such as {"layer": 2, "head": 1}')
  const text = JSON.stringify(p)
  if (text.length > PARAMS_MAX) throw new Error(`params: ${text.length} chars — at most ${PARAMS_MAX}`)
  return JSON.parse(text)
}

// What the owner's question carries from the page (the element they asked about): plain data, clipped.
function contextOf(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const text = JSON.stringify(raw)
  return text.length > PARAMS_MAX ? { note: clip(text, PARAMS_MAX) } : JSON.parse(text)
}

// A visual back from a save: a file's path (read again), else the spec checked again (one that fails is dropped).
function restoredVisual(v) {
  if (!v || typeof v !== "object") return null
  if (v.file) return { file: String(v.file), error: "not read yet" }
  try {
    return checkVisual(v, { maxChars: INLINE_MAX })
  } catch {
    return null
  }
}

// A scene's visual in the prompt: what it is, where it comes from, what is wrong with it.
const visualLine = (v) => (v ? ` [visual ${v.kind ? visualBrief(v) : "file"}${v.file ? ` from ${v.file}` : ""}${v.error ? ` — ERROR ${clip(v.error, 160)}` : ""}]` : "")

const inline = (o) =>
  o && Object.keys(o).length
    ? Object.entries(o)
        .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : v}`)
        .join(", ")
    : ""

// A visual as a scene asks for it: {file} (a workspace JSON file, read by the stage) or a spec (checked now).
function visualRequest(raw) {
  if (raw == null || raw === "") return null
  let v = raw
  if (typeof raw === "string" && /^\s*\{/.test(raw)) {
    try {
      v = JSON.parse(raw)
    } catch {
      throw new Error(`visual: not JSON — a spec such as {"kind": "flow", …} or {"file": "projects/<slug>/out/story/visuals/loss.json"}`)
    }
  } else if (typeof raw === "string") v = { file: raw }
  if (v && typeof v === "object" && !Array.isArray(v) && v.file != null && v.kind == null) {
    const file = cleanPath(v.file)
    if (!/\.json$/i.test(file)) throw new Error(`visual.file: ${file} — a .json file holding a visual spec`)
    if (secret(file)) throw new Error(`visual.file: ${file} is ASKK's configuration — never read`)
    return { file }
  }
  return { spec: checkVisual(v, { maxChars: INLINE_MAX }) }
}

export class Stage extends Artifact {
  constructor({ id = "stage", title, adapter = hostFiles, clock = () => new Date() } = {}) {
    super({ name: id, title: title ?? (id === "stage" ? "stage — what the owner watches" : `${id} — stage`) })
    this.kind = "stage"
    this.view = "stage"
    this.keep = "always"
    this.clock = clock
    this.adapter = adapter // the workspace, for visual files (default the host: fs/read)
    this.holders = [] // agent names in the order they were attached (keeper: the first that can reply)
    this.replies = new Set() // holders that hold <id>.reply
    this.texts = new Map() // visual file -> the text last read (a change is a new visual)
    this.pulled = 0
    this.pulling = null
    this.state = { page: null, scenes: [], current: null, asks: [], revision: 0 }
  }

  attach(agent, { commands = null } = {}) {
    if (!this.holders.includes(agent.name)) this.holders.push(agent.name)
    if (!commands || commands.includes("reply")) this.replies.add(agent.name)
  }

  detach(agent) {
    this.holders = this.holders.filter((n) => n !== agent.name)
    this.replies.delete(agent.name)
  }

  // The agent the owner's questions go to: the first holder that can answer them.
  keeper() {
    return this.holders.find((n) => this.replies.has(n)) ?? null
  }

  restore(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.scenes)) return
    const page = data.page?.url ? { url: String(data.page.url), title: String(data.page.title ?? ""), by: data.page.by ?? null, at: data.page.at ?? null } : null
    const scenes = data.scenes
      .filter((s) => s?.id && SCENE_ID.test(s.id))
      .slice(0, SCENES_MAX)
      .map((s) => ({ id: String(s.id), title: String(s.title ?? s.id), view: String(s.view ?? s.id), says: String(s.says ?? ""), params: s.params && typeof s.params === "object" ? s.params : null, visual: restoredVisual(s.visual), by: s.by ?? null, at: s.at ?? null }))
    const asks = (Array.isArray(data.asks) ? data.asks : [])
      .filter((a) => a?.id && a.text)
      .slice(-ASKS_MAX)
      .map((a) => ({ id: String(a.id), text: String(a.text), scene: a.scene ?? null, context: a.context ?? null, from: a.from ?? "owner", at: a.at ?? null, answer: a.answer?.text ? { text: String(a.answer.text), scene: a.answer.scene ?? null, by: a.answer.by ?? null, at: a.answer.at ?? null } : null }))
    const current = scenes.some((s) => s.id === data.current) ? data.current : null
    this.state = { page, scenes, current, asks, revision: Number.isFinite(data.revision) ? data.revision : 0 }
  }

  // Saved without a file visual's data: its path only, read again at start.
  snapshot() {
    const s = structuredClone(this.state)
    s.scenes = s.scenes.map((sc) => (sc.visual?.file ? { ...sc, visual: { file: sc.visual.file } } : sc))
    return s
  }

  #set(patch) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.changed()
  }

  // ---- visual files ----

  // A file visual read now: its normalized spec with file and read_at, or an Error saying what is wrong. The same text
  // as last time keeps the visual it made (no change to stream).
  async #fileVisual(file, ctx) {
    let r
    try {
      r = await this.adapter.read(file, ctx)
    } catch (e) {
      throw new Error(`${file}: ${hostError(e)}`)
    }
    if (!r) throw new Error(`${file}: not found`)
    if (r.binary) throw new Error(`${file}: not a text file`)
    const text = String(r.text ?? "")
    if (r.truncated || text.length > FILE_MAX) throw new Error(`${file}: over ${FILE_MAX} chars — fewer frames or a smaller slice`)
    const others = [...this.texts].filter(([f]) => f !== file).reduce((n, [, t]) => n + t.length, 0)
    if (others + text.length > FILES_MAX) throw new Error(`${file}: the stage's visual files together pass ${FILES_MAX} chars — make it smaller`)
    const current = this.state.scenes.find((s) => s.visual?.file === file && s.visual.kind && !s.visual.error)?.visual
    if (current && this.texts.get(file) === text) return current
    let spec
    try {
      spec = checkVisual(text, { maxChars: FILE_MAX })
    } catch (e) {
      throw new Error(`${file}: ${e.message}`)
    }
    this.texts.set(file, text)
    return { ...spec, file, read_at: this.clock().toISOString() }
  }

  // Every file visual read again (at most every VISUAL_MS, coalesced across holders); a failed read keeps the last
  // visual with its error.
  async refresh(agent) {
    if (!this.state.scenes.some((s) => s.visual?.file)) return
    if (this.pulling) return this.pulling
    if (Date.now() - this.pulled < VISUAL_MS) return
    this.pulling = this.#pull(ctxOf(agent)).finally(() => (this.pulling = null))
    return this.pulling
  }

  async #pull(ctx) {
    const files = [...new Set(this.state.scenes.filter((s) => s.visual?.file).map((s) => s.visual.file))]
    for (const f of [...this.texts.keys()]) if (!files.includes(f)) this.texts.delete(f)
    const read = new Map()
    for (const f of files) read.set(f, await this.#fileVisual(f, ctx).catch((e) => ({ error: e.message })))
    this.pulled = Date.now()
    let changed = false
    const scenes = this.state.scenes.map((s) => {
      if (!s.visual?.file) return s
      const r = read.get(s.visual.file)
      const next = r.error ? { ...s.visual, error: r.error } : r
      if (JSON.stringify(next) === JSON.stringify(s.visual)) return s
      changed = true
      return { ...s, visual: next }
    })
    if (changed) this.#set({ scenes })
  }

  #scene(id) {
    const key = String(id ?? "").trim()
    const scene = this.state.scenes.find((s) => s.id === key)
    if (!scene) throw new Error(this.state.scenes.length ? `no scene ${key || '""'}; scenes: ${this.state.scenes.map((s) => s.id).join(", ")}` : `no scenes yet: ${this.name}.scene {id, title, view, says} writes one`)
    return scene
  }

  open() {
    return this.state.asks.filter((a) => !a.answer)
  }

  // ---- commands ----

  async show({ url, title } = {}, ctx = {}) {
    const page = stageUrl(url)
    if (!ctx.host?.get) throw new Error("no host here (ctx.host): the desk server checks the page in its preview")
    let pages
    try {
      pages = (await ctx.host.get("browser/list", { signal: ctx.signal }))?.pages ?? []
    } catch (e) {
      throw new Error(`browser/list: ${hostError(e)}`)
    }
    const seen = pages.filter((p) => p.status !== "closed" && samePage(p.url, page))
    if (!seen.length) throw new Error(`${page} is not open in the preview: preview.open {url: "${page}"}, read it (preview.text, preview.console), fix what is wrong, then ${this.name}.show — the owner sees only a page checked first`)
    const clean = seen.find((p) => !(Number(p.errors) > 0))
    if (!clean) throw new Error(`${page} has ${seen[0].errors} console error${seen[0].errors === 1 ? "" : "s"} in the preview (preview.console): fix them, reload it (preview.goto), then ${this.name}.show`)
    this.#set({ page: { url: page, title: clip(String(title ?? clean.title ?? "").trim(), TITLE_MAX), by: ctx.agent?.name ?? null, at: this.clock().toISOString() } })
    return `on stage: ${page}${this.state.page.title ? ` "${this.state.page.title}"` : ""}; ${this.state.scenes.length ? `${this.state.scenes.length} scenes` : `no scenes yet — ${this.name}.scene {id, title, view, says} writes the story`}`
  }

  async scene({ id, title, view, says, params, visual } = {}, ctx = {}) {
    const key = String(id ?? "").trim()
    if (!SCENE_ID.test(key)) throw new Error(`id: "${key}" — a short word (letters, digits, - or _), e.g. training`)
    const v = String(view ?? key).trim()
    if (!VIEW.test(v)) throw new Error(`view: "${v}" — the page's view for this scene (its #<view>), one word`)
    const text = String(says ?? "").trim()
    if (!text) throw new Error("says: what the owner should see in this scene, with its numbers")
    const exists = this.state.scenes.some((s) => s.id === key)
    if (!exists && this.state.scenes.length >= SCENES_MAX) throw new Error(`the story has ${SCENES_MAX} scenes: ${this.name}.cut one first`)
    const want = visualRequest(visual)
    let shown = want?.spec ?? null
    if (want?.file) {
      const reads = ctx.agent?.config?.reads
      if (reads != null && !inLane(reads, want.file)) throw new Error(`visual.file: ${want.file} is outside ${ctx.agent.name}'s reads: lane`)
      shown = await this.#fileVisual(want.file, ctx) // its errors go back to the agent now
    }
    const next = { id: key, title: clip(String(title ?? key).trim() || key, TITLE_MAX), view: v, says: clip(text, SAYS_MAX), params: paramsOf(params), visual: shown, by: ctx.agent?.name ?? null, at: this.clock().toISOString() }
    const scenes = exists ? this.state.scenes.map((s) => (s.id === key ? next : s)) : [...this.state.scenes, next]
    this.#set({ scenes, current: this.state.current ?? key })
    return `scene ${key} ${exists ? "replaced" : `added (${scenes.length} of ${SCENES_MAX})`}${this.state.current === key ? " — the owner is on it" : ""}`
  }

  go({ id } = {}) {
    const scene = this.#scene(id)
    this.#set({ current: scene.id })
    return `the owner is taken to scene ${scene.id} "${scene.title}" (#${scene.view})`
  }

  cut({ id } = {}) {
    const scene = this.#scene(id)
    const scenes = this.state.scenes.filter((s) => s !== scene)
    this.#set({ scenes, current: this.state.current === scene.id ? (scenes[0]?.id ?? null) : this.state.current })
    return `scene ${scene.id} cut; ${scenes.length} left`
  }

  reply({ ask, text, scene } = {}, ctx = {}) {
    const key = String(ask ?? "").trim()
    const q = this.state.asks.find((a) => a.id === key)
    if (!q) throw new Error(this.state.asks.length ? `no question ${key || '""'}; open: ${this.open().map((a) => a.id).join(", ") || "none"}` : "the owner has asked nothing on the stage")
    const answer = String(text ?? "").trim()
    if (!answer) throw new Error("text: the answer, with the numbers that show it")
    const shown = scene == null || scene === "" ? null : this.#scene(scene).id
    const at = this.clock().toISOString()
    this.#set({ asks: this.state.asks.map((a) => (a === q ? { ...a, answer: { text: clip(answer, ANSWER_MAX), scene: shown, by: ctx.agent?.name ?? null, at } } : a)), current: shown ?? this.state.current })
    const left = this.open().length
    return `${q.id} answered${shown ? `; the owner is taken to scene ${shown}` : ""}${left ? `; ${left} still open` : ""}`
  }

  // ---- the owner (the host's team/call target artifact) ----

  ownerCall(method, args = [], from = "owner") {
    if (method !== "ask") throw new Error(`${this.name}: the owner can ask (not ${method})`)
    const { text, scene = null, context = null } = args[0] ?? {}
    const question = String(text ?? "").trim()
    if (!question) throw new Error("text: the question")
    if (question.length > ASK_MAX) throw new Error(`text: ${question.length} chars — at most ${ASK_MAX}`)
    const on = scene == null || scene === "" ? null : (this.state.scenes.find((s) => s.id === String(scene)) ?? null)
    const n = this.state.asks.reduce((m, a) => Math.max(m, Number(String(a.id).slice(1)) || 0), 0) + 1
    const q = { id: `q${n}`, text: question, scene: on?.id ?? null, context: contextOf(context), from: String(from || "owner"), at: this.clock().toISOString(), answer: null }
    let asks = [...this.state.asks, q]
    // Past the cap, answered questions go first; an open one stays until it is answered.
    while (asks.length > ASKS_MAX) {
      const i = asks.findIndex((a) => a.answer)
      asks = i >= 0 ? asks.filter((_, k) => k !== i) : asks.slice(1)
    }
    this.#set({ asks })
    const where = [on && `scene ${on.id} "${on.title}" (#${on.view}${on.params ? `, ${inline(on.params)}` : ""})`, q.context && `pointing at ${inline(q.context)}`].filter(Boolean).join(", ")
    const deliver = `On the stage the owner asks (${q.id}${where ? `, ${where}` : ""}): "${question}"\nAnswer it on the stage: ${this.name}.reply {ask: "${q.id}", text, scene?} — a scene that shows the answer (${this.name}.scene, then reply with its id) says more than words.`
    return { ask: q, deliver, keeper: this.keeper() }
  }

  // ---- views ----

  gate(agent) {
    if (!agent || !this.replies.has(agent.name)) return null
    const open = this.open()
    return open.length ? `the owner asked on the stage: ${open.map((a) => `${a.id} "${clip(a.text, 80)}"`).join("; ")} — ${this.name}.reply {ask, text, scene?} each first` : null
  }

  render(agent) {
    const s = this.state
    const has = (c) => !agent || agent.tools?.has(`${this.name}.${c}`)
    const can = [
      has("show") && `${this.name}.show {url, title?} puts a page on it (open and check it in the preview first)`,
      has("scene") && `${this.name}.scene {id, title, view, says, params?} adds or replaces a scene`,
      has("go") && `${this.name}.go {id} takes the owner there`,
      has("reply") && `${this.name}.reply {ask, text, scene?} answers a question asked on it`,
      has("cut") && `${this.name}.cut {id}`,
    ].filter(Boolean)
    const lines = [`the owner's stage — the page they watch and the story over it${can.length ? `: ${can.join("; ")}` : ""}`]
    lines.push(s.page ? `PAGE: ${s.page.url}${s.page.title ? ` "${s.page.title}"` : ""}${s.page.by ? ` (shown by ${s.page.by}${s.page.at ? ` at ${s.page.at}` : ""})` : ""}` : "PAGE: none yet — a page the desk built (skill stage), opened and checked in the preview, then shown")
    if (s.scenes.length) {
      lines.push("STORY (▶ = where the owner is taken):")
      for (const sc of s.scenes) lines.push(`${sc.id === s.current ? "▶" : " "} ${sc.id} "${sc.title}" #${sc.view}${sc.params ? ` {${inline(sc.params)}}` : ""}${visualLine(sc.visual)} — ${clip(sc.says, PROMPT_SAYS)}`)
    } else lines.push("STORY: no scenes yet")
    const open = this.open()
    if (open.length) {
      lines.push(`OWNER ASKED (open${has("reply") ? ` — ${this.name}.reply each` : ""}):`)
      for (const a of open) lines.push(`  ${a.id}${a.scene ? ` at ${a.scene}` : ""}${a.context ? ` {${inline(a.context)}}` : ""}: "${clip(a.text, 400)}"`)
    }
    const answered = s.asks.filter((a) => a.answer).slice(-PROMPT_ANSWERED)
    if (answered.length) {
      lines.push("ANSWERED (latest):")
      for (const a of answered) lines.push(`  ${a.id} "${clip(a.text, 120)}" → ${clip(a.answer.text, 160)}${a.answer.scene ? ` [${a.answer.scene}]` : ""}`)
    }
    return lines.join("\n")
  }

  brief() {
    const s = this.state
    if (!s.page && !s.scenes.length) return "nothing on stage yet"
    const open = this.open().length
    return [s.page ? s.page.title || s.page.url : "no page", `${s.scenes.length} scene${s.scenes.length === 1 ? "" : "s"}`, s.current && `▶ ${s.current}`, open && `${open} question${open === 1 ? "" : "s"} open`].filter(Boolean).join(" · ")
  }

  commands() {
    return [
      new Tool({
        name: `${this.name}.show`,
        type: "dev",
        description: "put a page the desk built before the owner (their stage frame loads it); it must be open in the preview with no console error",
        input: { url: "the page's address on this computer, e.g. http://127.0.0.1:8077/", title: "optional: what it is" },
        run: (input, ctx = {}) => this.show(input ?? {}, ctx),
      }),
      new Tool({
        name: `${this.name}.scene`,
        description: "add or replace a scene of the story the owner follows: a view of the page, or a visual you build (a flow, steps, a matrix, a line, bars, tokens, a scatter — animated for the owner), and what it shows",
        input: {
          id: "short id (training, weights, attention, …)",
          title: "the scene's title",
          view: "optional: the page's view for it (its #<view>)",
          says: "what the owner should see here, with the numbers",
          params: 'optional object the page gets with the view, e.g. {"layer": 2, "head": 1}',
          visual: 'optional: a visual spec {kind: flow | steps | matrix | line | bars | tokens | scatter, …} (skill stage), or {file: "projects/<slug>/out/…json"} holding one — read again as the file changes',
        },
        run: (input, ctx = {}) => this.scene(input ?? {}, ctx),
      }),
      new Tool({ name: `${this.name}.go`, description: "take the owner to a scene (their frame shows its view)", input: { id: "scene id" }, run: (input) => this.go(input ?? {}) }),
      new Tool({
        name: `${this.name}.reply`,
        description: "answer a question the owner asked on the stage; scene: the scene that shows the answer (they are taken there)",
        input: { ask: "question id (q1 …)", text: "the answer, with numbers", scene: "optional scene id to show" },
        run: (input, ctx = {}) => this.reply(input ?? {}, ctx),
      }),
      new Tool({ name: `${this.name}.cut`, description: "drop a scene from the story", input: { id: "scene id" }, run: (input) => this.cut(input ?? {}) }),
    ]
  }
}
