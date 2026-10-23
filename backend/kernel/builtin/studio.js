import { Artifact } from "../artifact/artifact.js"
import { Tool } from "../tool/tool.js"

// Studio (2026-10-23 owner: "a live artifact where the input will be taken and the model will be used to generate the
// image … a workflow where the image is not just created but it can be critiqued and improved based on either users'
// requirement, feedback, or even another LLM"): the desk's image canvas. Images come from an open model on this Mac
// (host image/* — companion/capabilities/imagegen.js, mflux), one job at a time. The agents and the owner work on the
// same state: the goal and what "done" means, the prompt's versions (each with why it changed: the prompt optimised step
// by step), every image with its parent (an image refined from another), its live progress, critiques with scores and a
// verdict, the pick, and the owner's feedback. A holder SEES each new image of its own on its next step (images()), so it
// generates, looks, critiques and refines while the owner watches. Id `studio`, view and kind `studio`, keep `always`,
// poll 2 s (a job's progress while a tab is on the stream).
//
//   studio.goal     {goal, criteria?}      what the image is for and what "done" means (criteria: lines)
//   studio.prompt   {text, negative?, why} a new prompt version (v1, v2 …): why it changed — the goal, a critique, feedback
//   studio.generate {v? | prompt?, negative?, seeds?, seed?, width?, height?, steps?, from?, strength?}
//                   queue images (seeds: 1–4 variants) from a prompt version (default the newest); from: an image to
//                   refine (strength 0..1: how far to move from it) → their ids; studio.wait them
//   studio.wait     {ids?, seconds?}       until they are done (default: yours still running) — then you see them
//   studio.critique {image, scores, notes, verdict, next?} judge one image against the goal and criteria: scores 0–10
//                   per criterion; verdict done | revise | discard; next: what to change
//   studio.pick     {image, why}           the best so far
//   studio.look     {image}                see that image again on your next step (to compare)
//   studio.presets  {}                     the presets (models/image/presets/*.md) and what the image model accepts
//   studio.preset   {name, why}            the preset every generate uses from now on (none: no preset)
//
// 2026-10-23 owner ("The model should be configurable … we note the artifacts present for the images models: some take
// references, some accept live edits, markers … presets … behind a workflow: my query is taken, first expanded, then
// which preset is already asked and if not which would look better; then these are applied and called the generation
// endpoint"): the model is the one chosen in the models folder (companion/models), its modes and what each accepts in
// the state (`model`), so the agents and the view offer only what it can do: generate {preset?, references?: [ids],
// mask?: id, auto_mask?} — references / a mask / an object to repaint use its edit mode. The owner marks an image in
// the view (boxes with a note each), sends the marked image and a mask with the feedback; the agent sees the marked
// image on its next step. A goal with a workflow the keeper holds whose vars name `preset` runs that workflow (expand →
// preset → generate → critique → refine), the preset asked passed as its variable (auto: the agent compares and picks).
//
// The owner (team/call {target: "artifact", method, args: [{id, …}]}): goal [{id, goal, criteria?}] (the goal set, and
// a run for the keeper), generate [{id, prompt, …}] (an image now, no agent), feedback [{id, image?, text}] (to the
// agent that made the image, else the keeper: guidance while it runs, else a run), pick [{id, image}], stop [{id,
// image}]. The keeper: the first agent the studio is attached to.
// State {goal: {text, by, at} | null, criteria, prompts: [{v, text, negative, why, by, at}] ≤ 30, images: [{id, v,
// prompt, negative, seed, width, height, steps, model, from, strength, by, status: queued | running | done | failed |
// stopped | interrupted, step, ms, error, url, at, critiques: [{by, scores, score, notes, verdict, next, at}]}] ≤ 60,
// newest first (each also mode, preset, references, mask, auto_mask, sent: the prompt the preset made), picked: {image,
// why, by, at} | null, feedback: [{id, image, text, marks: [{n, x, y, w, h, note}], marked, mask, from, at}] ≤ 30,
// model: {name, title, accepts, modes, options} | null, presets: [{name, title, when, size?}], preset: {name, why, by,
// at} | null, revision}.

const IMAGES = 60
const PROMPTS = 30
const FEEDBACK = 30
const LIVE = new Set(["queued", "running"])
const clip = (s, n) => (String(s ?? "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ""))
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim()
const linesOf = (raw) => (Array.isArray(raw) ? raw : String(raw ?? "").split("\n")).map((l) => oneLine(String(l).replace(/^[-*•\d.)\s]+/, ""))).filter(Boolean)

// scores: {criterion: 0..10} or "criterion: 7" lines → {name: n}; at least one, each 0–10
// (2026-10-23 live run: the critic sent [{light: 9}, {cat_asleep: 9}] — a list of one-key maps, refused six times, and
// it concluded it had seen no image: every list form is read — maps, {name, score}, "light: 9" lines)
function scoresOf(raw) {
  let pairs = []
  if (Array.isArray(raw))
    pairs = raw.flatMap((x) =>
      x && typeof x === "object" ? ("score" in x && (x.name ?? x.criterion) != null ? [[x.name ?? x.criterion, x.score]] : Object.entries(x)) : String(x ?? "").split(/[:=]/).length === 2 ? [String(x).split(/[:=]/)] : [],
    )
  else if (raw && typeof raw === "object") pairs = Object.entries(raw)
  else
    pairs = String(raw ?? "")
      .split(/[\n,;]/)
      .map((l) => l.split(/[:=]/))
      .filter((p) => p.length === 2)
  const out = {}
  for (const [k, v] of pairs) {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 10) throw new Error(`scores: ${oneLine(k)} must be 0 to 10`)
    out[clip(oneLine(k), 40)] = Math.round(n * 10) / 10
  }
  if (!Object.keys(out).length) throw new Error("scores: one per criterion, 0–10 (e.g. {goal: 7, composition: 6, detail: 8})")
  return out
}

export class Studio extends Artifact {
  constructor({ id = "studio", title, clock = () => new Date(), waitMs = 2000 } = {}) {
    super({ name: id, title: title ?? (id === "studio" ? "studio — images made, critiqued and refined" : `${id} — studio`) })
    this.kind = "studio"
    this.view = "studio"
    this.keep = "always"
    this.poll = 2000
    this.clock = clock
    this.waitMs = waitMs
    this.host = null // a holder's host (the owner's calls have no agent)
    this.keeperName = null // the first holder: the owner's goal goes to it
    this.seen = new Map() // agent → Set of image ids it saw
    this.again = new Map() // agent → image ids to show once more (studio.look)
    this.nf = 0
    this.marked = new Map() // upload id → what it is (the owner's marked image)
    this.state = { goal: null, criteria: [], prompts: [], images: [], picked: null, feedback: [], model: null, presets: [], preset: null, revision: 0 }
    this.keeper = null
  }

  // ---- state ----

  #set(patch) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.changed()
  }
  #image(id) {
    const key = oneLine(id)
    const img = this.state.images.find((i) => i.id === key)
    if (!img) throw new Error(`no image ${id}${this.state.images.length ? ` (latest: ${this.state.images.slice(0, 3).map((i) => i.id).join(", ")})` : ""}`)
    return img
  }
  #patchImage(id, patch) {
    this.#set({ images: this.state.images.map((i) => (i.id === id ? { ...i, ...patch } : i)) })
  }
  #hostOf(ctx) {
    const host = ctx?.host ?? ctx?.agent?.context?.host ?? this.host
    if (!host?.post) throw new Error("no image host here: start the desk server on a Mac with an image model (uv tool install mflux)")
    return host
  }

  // The keeper (the owner's goal and feedback go to it): the holder with every command (a critic holding look and critique
  // only never is), the shallowest of those — the desk's lead before its members, whatever order they were built in.
  attach(agent, options = {}) {
    this.host ??= agent?.context?.host ?? null
    if (!agent?.name) return
    const full = !options?.commands
    const rank = (a, f) => (f ? 0 : 1000) + (a?.depth ?? 0)
    if (!this.keeper || rank(agent, full) < rank(this.keeper, this.keeperFull)) {
      this.keeper = agent
      this.keeperFull = full
      this.keeperName = agent.name
    }
  }

  // The keeper's workflow that takes a preset (its `vars:` name one): the owner's goal runs it.
  #flow() {
    // its vars from the file as loaded (state.config, there before its first run), else the run's settings
    const vars = (a) => a.state?.config?.vars ?? a.cfg?.vars ?? null
    return (this.keeper?.artifacts ?? []).find((a) => a.kind === "workflow" && vars(a) && "preset" in vars(a)) ?? null
  }

  snapshot() {
    return { ...this.state, nf: this.nf }
  }
  restore(data) {
    if (!data || !Array.isArray(data.images)) return
    const { nf = 0, ...rest } = data
    this.nf = Number(nf) || 0
    this.state = { goal: null, criteria: [], prompts: [], picked: null, feedback: [], model: null, presets: [], preset: null, ...rest, images: data.images.slice(0, IMAGES), revision: 0 }
  }

  // ---- the images, live ----

  // Every image still queued or running, read from the host (its progress, done, failed); a host that does not answer
  // is said on each of them.
  async refresh(agent) {
    this.host ??= agent?.context?.host ?? null
    const live = this.state.images.filter((i) => LIVE.has(i.status))
    const host = agent?.context?.host ?? this.host
    if (!host?.get) return
    let jobs
    try {
      const read = (await host.get("image/jobs")) ?? {}
      jobs = read.jobs ?? []
      // the model chosen in the models folder and the presets: what the agents and the view may ask for
      const model = read.model ?? null
      const presets = (read.presets ?? []).map((p) => ({ name: p.name, title: p.title, when: p.when ?? "", ...(p.width ? { size: `${p.width}×${p.height}` } : {}) }))
      if (JSON.stringify(model) !== JSON.stringify(this.state.model) || JSON.stringify(presets) !== JSON.stringify(this.state.presets)) this.#set({ model, presets })
      if (!live.length) return
    } catch (error) {
      if (!live.length) return
      const msg = `image host not read: ${error.message}`
      if (live.some((i) => i.error !== msg)) this.#set({ images: this.state.images.map((i) => (LIVE.has(i.status) ? { ...i, error: msg } : i)) })
      return
    }
    let moved = false
    const images = this.state.images.map((i) => {
      if (!LIVE.has(i.status)) return i
      const j = jobs.find((x) => x.id === i.id)
      const next = j ? { status: j.status, step: j.step ?? 0, ms: j.ms ?? null, error: j.error ?? null, url: j.url ?? null } : { status: "interrupted", error: "the image host no longer knows this job" }
      if (Object.entries(next).some(([k, v]) => i[k] !== v)) moved = true
      return { ...i, ...next }
    })
    if (moved) this.#set({ images })
  }

  // The newest images this holder made (or asked to look at) that it has not seen: on its next model call.
  async images(agent) {
    const name = agent?.name
    const host = agent?.context?.host ?? this.host
    if (!name || !host?.get) return []
    const seen = this.seen.get(name) ?? new Set()
    const again = this.again.get(name) ?? []
    const fresh = this.state.images.filter((i) => i.status === "done" && i.by === name && !seen.has(i.id)).map((i) => i.id)
    const ids = [...new Set([...again, ...fresh])].slice(0, 3)
    if (!ids.length) return []
    this.again.set(name, [])
    const out = []
    for (const id of ids) {
      seen.add(id)
      try {
        const img = await host.get(`image/model?id=${encodeURIComponent(id)}&max=1024`)
        const i = this.state.images.find((x) => x.id === id)
        const caption = i ? `${id} (prompt v${i.v ?? "-"}, seed ${i.seed}${i.from ? `, refined from ${i.from}` : ""}${i.preset ? `, preset ${i.preset}` : ""})` : `${id} (${this.marked.get(id) ?? "an image the owner added"})`
        out.push({ media_type: img.media_type, data: img.data, caption, ref: { studio: this.name, image: id } })
      } catch (error) {
        agent.context?.log?.(`studio: ${id} not shown to ${name}: ${error.message}`)
      }
    }
    this.seen.set(name, seen)
    return out
  }

  // ---- the agents ----

  goal(input = {}, ctx = {}) {
    const goal = clip(oneLine(input.goal ?? input.text), 1500)
    if (!goal) throw new Error("goal: what the image is for — the imagination, the end goal")
    const criteria = linesOf(input.criteria).slice(0, 8).map((c) => clip(c, 200))
    this.#set({ goal: { text: goal, by: ctx.agent?.name ?? "owner", at: this.clock().toISOString() }, criteria })
    return `goal set${criteria.length ? ` with ${criteria.length} criteria` : " — add criteria (what done means) so critiques can score against them"}`
  }

  prompt(input = {}, ctx = {}) {
    const text = String(input.text ?? input.prompt ?? "").trim()
    if (!text) throw new Error("text: the prompt")
    if (text.length > 4000) throw new Error("text: at most 4000 chars")
    const why = clip(oneLine(input.why), 600)
    if (!why) throw new Error("why: what this version changes and why (the goal, a critique, the owner's feedback)")
    const negative = oneLine(input.negative) || null
    const last = this.state.prompts.at(-1)
    if (last && last.text === text && last.negative === negative) throw new Error(`v${last.v} is this prompt already`)
    const v = (last?.v ?? 0) + 1
    this.#set({ prompts: [...this.state.prompts, { v, text, negative, why, by: ctx.agent?.name ?? "owner", at: this.clock().toISOString() }].slice(-PROMPTS) })
    return `prompt v${v} saved — ${this.name}.generate {v: ${v}} to draw it`
  }

  async generate(input = {}, ctx = {}) {
    const host = this.#hostOf(ctx)
    const by = ctx.agent?.name ?? ctx.by ?? "owner"
    let v = null
    let text = String(input.prompt ?? "").trim()
    let negative = oneLine(input.negative) || null
    if (!text) {
      const p = input.v != null && input.v !== "" ? this.state.prompts.find((x) => x.v === Number(String(input.v).replace(/^v/, ""))) : this.state.prompts.at(-1)
      if (!p) throw new Error(this.state.prompts.length ? `no prompt v${input.v}` : `no prompt yet: ${this.name}.prompt {text, why} first (or give prompt)`)
      ;({ v, text } = p)
      negative ??= p.negative
    }
    const from = input.from ? this.#image(input.from) : null
    if (from && from.status !== "done") throw new Error(`${from.id} is ${from.status}: refine a finished image`)
    const list = (raw) => (Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,]+/)).map((x) => oneLine(x)).filter(Boolean)
    const references = list(input.references)
    const accepts = this.state.model?.accepts
    for (const k of ["references", "mask", "auto_mask"])
      if ((k === "references" ? references.length : input[k]) && accepts && !accepts.includes(k)) throw new Error(`${k}: ${this.state.model.title} does not take it (it takes ${accepts.join(", ")})`)
    const preset = input.preset === "none" ? null : oneLine(input.preset) || this.state.preset?.name || null
    if (preset && this.state.presets.length && !this.state.presets.some((p) => p.name === preset)) throw new Error(`preset: one of ${this.state.presets.map((p) => p.name).join(", ")} (or none)`)
    const count = Math.max(1, Math.min(4, Math.round(Number(input.seeds ?? 1)) || 1))
    const seeds = input.seed != null && input.seed !== "" ? [Math.round(Number(input.seed))] : Array.from({ length: count }, () => null)
    const made = []
    for (const seed of seeds) {
      const { job } = await host.post("image/generate", { prompt: text, negative, seed, width: input.width, height: input.height, steps: input.steps, guidance: input.guidance, from: from?.id, strength: input.strength, preset, references, mask: oneLine(input.mask) || null, auto_mask: oneLine(input.auto_mask) || null, by, note: v ? `v${v}` : null })
      made.push({ id: job.id, v, prompt: text, sent: job.prompt, negative: job.negative ?? negative, seed: job.seed, width: job.width, height: job.height, steps: job.steps, model: job.model, mode: job.mode ?? "generate", preset: job.preset ?? null, from: job.from, strength: job.strength, references: job.references ?? [], mask: job.mask ?? null, auto_mask: job.auto_mask ?? null, by, status: job.status, step: 0, ms: null, error: null, url: null, at: job.at, critiques: [] })
    }
    this.#set({ images: [...[...made].reverse(), ...this.state.images].slice(0, IMAGES) })
    const m0 = made[0]
    return `queued ${made.map((m) => m.id).join(", ")} (${m0.model} ${m0.mode}${m0.preset ? `, preset ${m0.preset}` : ""}, ${m0.width}×${m0.height}, ${m0.steps} steps${from ? `, from ${from.id} at strength ${m0.strength}` : ""}${m0.mask ? `, mask ${m0.mask}` : ""}${m0.auto_mask ? `, repaint "${m0.auto_mask}"` : ""}) — ${this.name}.wait, then look at them`
  }

  async wait(input = {}, ctx = {}) {
    const by = ctx.agent?.name
    const ids = input.ids ? linesOf(String(input.ids).replace(/,/g, "\n")) : this.state.images.filter((i) => LIVE.has(i.status) && i.by === by).map((i) => i.id)
    if (!ids.length) return "nothing of yours is running"
    ids.forEach((id) => this.#image(id))
    const until = Date.now() + Math.max(5, Math.min(1800, Number(input.seconds ?? 900))) * 1000
    while (Date.now() < until && !ctx.signal?.aborted) {
      await this.refresh(ctx.agent ?? null)
      if (ids.every((id) => !LIVE.has(this.#image(id).status))) break
      await new Promise((r) => setTimeout(r, this.waitMs))
    }
    const lines = ids.map((id) => {
      const i = this.#image(id)
      return `${id}: ${i.status}${i.status === "running" ? ` step ${i.step}/${i.steps}` : ""}${i.ms ? ` in ${Math.round(i.ms / 1000)} s` : ""}${i.error ? ` — ${clip(i.error, 300)}` : ""}`
    })
    const done = ids.filter((id) => this.#image(id).status === "done").length
    return `${lines.join("\n")}${done ? `\nyou see ${done === 1 ? "it" : "them"} on your next step: ${this.name}.critique each against the goal` : ""}`
  }

  critique(input = {}, ctx = {}) {
    const img = this.#image(input.image ?? input.id)
    if (img.status !== "done") throw new Error(`${img.id} is ${img.status}: critique a finished image`)
    const scores = scoresOf(input.scores)
    const verdict = oneLine(input.verdict).toLowerCase()
    if (!["done", "revise", "discard"].includes(verdict)) throw new Error("verdict: done (meets the goal) | revise (close: say what to change in next) | discard")
    const notes = clip(oneLine(input.notes), 1500)
    if (!notes) throw new Error("notes: what you see — what works, what misses the goal")
    const next = clip(oneLine(input.next), 800) || null
    if (verdict === "revise" && !next) throw new Error("next: what to change for the next version")
    const values = Object.values(scores)
    const score = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    const c = { by: ctx.agent?.name ?? "owner", scores, score, notes, verdict, next, at: this.clock().toISOString() }
    this.#patchImage(img.id, { critiques: [...img.critiques, c].slice(-6) })
    return `critique saved on ${img.id}: ${score}/10, ${verdict}${verdict === "revise" ? ` — write the next prompt version (${this.name}.prompt with why) or refine from it (${this.name}.generate {from})` : ""}`
  }

  pick(input = {}, ctx = {}) {
    const img = this.#image(input.image ?? input.id)
    if (img.status !== "done") throw new Error(`${img.id} is ${img.status}`)
    this.#set({ picked: { image: img.id, why: clip(oneLine(input.why), 600) || null, by: ctx.agent?.name ?? "owner", at: this.clock().toISOString() } })
    return `${img.id} is the pick`
  }

  look(input = {}, ctx = {}) {
    const img = this.#image(input.image ?? input.id)
    if (img.status !== "done") throw new Error(`${img.id} is ${img.status}`)
    const name = ctx.agent?.name
    this.again.set(name, [...(this.again.get(name) ?? []), img.id])
    return `you see ${img.id} on your next step`
  }

  presets() {
    const m = this.state.model
    const lines = [m ? `model: ${m.title} — modes ${m.modes.join(", ")}; accepts ${m.accepts.join(", ")}` : "model: (not read yet — the image host answers on the next step)"]
    lines.push(this.state.preset ? `in use: ${this.state.preset.name} (${this.state.preset.why ?? ""})` : "in use: none")
    for (const p of this.state.presets) lines.push(`- ${p.name}: ${p.title}${p.size ? ` (${p.size})` : ""} — ${p.when}`)
    return lines.join("\n")
  }

  preset(input = {}, ctx = {}) {
    const name = oneLine(input.name ?? input.preset)
    if (!name) throw new Error(`name: one of ${this.state.presets.map((p) => p.name).join(", ") || "the presets"}, or none`)
    if (name === "none") {
      this.#set({ preset: null })
      return "no preset: generate uses the model's own defaults"
    }
    if (this.state.presets.length && !this.state.presets.some((p) => p.name === name)) throw new Error(`preset: one of ${this.state.presets.map((p) => p.name).join(", ")} (or none)`)
    const why = clip(oneLine(input.why), 400)
    if (!why) throw new Error("why: the owner asked for it, or what made it look better")
    this.#set({ preset: { name, why, by: ctx.agent?.name ?? "owner", at: this.clock().toISOString() } })
    return `preset ${name} in use: every ${this.name}.generate applies it (size, steps, style around the prompt) unless it names another`
  }

  // Holding an answer while its images run: a soft reason (gateRetries let it through).
  gate(agent) {
    const mine = this.state.images.filter((i) => LIVE.has(i.status) && i.by === agent?.name)
    return mine.length ? `${mine.length} of your images still run (${mine.map((i) => i.id).join(", ")}): ${this.name}.wait, look, critique` : null
  }

  // ---- the owner ----

  async ownerCall(method, args = [], from = "owner") {
    const a = args[0] ?? {}
    if (method === "goal") {
      this.goal(a, {})
      const asked = oneLine(a.preset) || "auto"
      if (asked !== "auto" && this.state.presets.length && ![...this.state.presets.map((p) => p.name), "none"].includes(asked)) throw new Error(`preset: one of ${this.state.presets.map((p) => p.name).join(", ")}, none or auto`)
      this.#set({ goal: { ...this.state.goal, preset: asked } })
      // the workflow (expand → preset → generate → critique → refine) when the keeper holds one that takes a preset
      const flow = this.#flow()
      if (flow) {
        const request = `${this.state.goal.text}${this.state.criteria.length ? `\nDone means: ${this.state.criteria.join("; ")}` : ""}`
        const started = await flow.ownerCall("run", [{ id: flow.name, request, vars: { preset: asked } }])
        return { goal: this.state.goal, workflow: flow.name, ...started }
      }
      const deliver = `The owner set the studio goal: "${this.state.goal.text}"${this.state.criteria.length ? `\nDone means: ${this.state.criteria.join("; ")}` : ""}\nOptimize the prompt (${this.name}.prompt with why), generate (${this.name}.generate, a few seeds), look, critique each against the criteria, and refine — a new prompt version or ${this.name}.generate {from} — until one is done; ${this.name}.pick it and tell the owner what changed between versions.`
      return { goal: this.state.goal, deliver: `${deliver}\nPreset: ${asked === "auto" ? `none asked — ${this.name}.presets, compare the two that fit on quick drafts, ${this.name}.preset the better` : `${this.name}.preset {name: "${asked}", why: "the owner asked"}`}.`, keeper: this.keeperName }
    }
    if (method === "generate") return { result: await this.generate(a, { by: from }) }
    if (method === "preset") return { result: this.preset({ name: a.name, why: a.why || "the owner chose it" }, {}) }
    if (method === "pick") return { result: this.pick(a, {}) }
    if (method === "stop") {
      const img = this.#image(a.image)
      const { job } = await this.#hostOf({}).post("image/stop", { id: img.id })
      this.#patchImage(img.id, { status: job.status, error: job.error ?? null })
      return { image: img.id, status: job.status }
    }
    if (method === "feedback") {
      const text = clip(oneLine(a.text), 1500)
      if (!text) throw new Error("text: your feedback")
      const img = a.image ? this.#image(a.image) : null
      // marks: boxes on the image (x, y, w, h as 0..1 of its size) with a note each; marked: the image with them drawn
      // (an upload); mask: white where they are (an upload) — for a model that edits under a mask
      const marks = (Array.isArray(a.marks) ? a.marks : []).slice(0, 12).map((m, i) => {
        const n = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 1000) / 1000
        return { n: i + 1, x: n(m.x), y: n(m.y), w: n(m.w), h: n(m.h), note: clip(oneLine(m.note), 300) }
      })
      const marked = oneLine(a.marked) || null
      const mask = oneLine(a.mask) || null
      this.nf += 1
      const f = { id: `f${this.nf}`, image: img?.id ?? null, text, marks, marked, mask, from, at: this.clock().toISOString() }
      this.#set({ feedback: [...this.state.feedback, f].slice(-FEEDBACK) })
      // the image's maker while it is still on the desk (audit 20: a dismissed helper or step agent never saw the marks)
      const live = (name) => !!this.keeper?.home?.agents?.().some?.((a) => a.name === name)
      const keeper = img?.by && img.by !== "owner" && (!this.keeper?.home || live(img.by)) ? img.by : this.keeperName
      if (marked) {
        this.marked.set(marked, `the owner's marks on ${img?.id ?? "the image"}: numbered boxes`)
        this.again.set(keeper, [...(this.again.get(keeper) ?? []), marked])
      }
      const where = (m) => `${m.y < 0.33 ? "top" : m.y + m.h > 0.67 ? "bottom" : "middle"}-${m.x < 0.33 ? "left" : m.x + m.w > 0.67 ? "right" : "center"}`
      const on = img ? ` on ${img.id} (prompt v${img.v ?? "-"}, seed ${img.seed})` : ""
      const markLines = marks.map((m) => `  mark ${m.n} (${where(m)}, x ${m.x} y ${m.y} w ${m.w} h ${m.h}): ${m.note || "(no note)"}`)
      const edits = this.state.model?.accepts ?? []
      const how = mask && edits.includes("mask") && img ? `edit just the marked areas: ${this.name}.generate {from: "${img.id}", mask: "${mask}", prompt: what those areas should become}` : img ? `refine from ${img.id} (${this.name}.generate {from: "${img.id}"}${edits.includes("auto_mask") ? `, or auto_mask: the object to repaint` : ""})` : "a new prompt version"
      const deliver = [`The owner's feedback${on}: "${text}"`, ...(marks.length ? [`Marked on the image (you see it with the boxes numbered on your next step${marked ? `, ${marked}` : ""}):`, ...markLines] : []), `Act on it: ${how}, or a new prompt version (${this.name}.prompt, why: this feedback); generate, look, critique, and tell the owner what you changed.`].join("\n")
      return { feedback: f, deliver, keeper }
    }
    throw new Error(`${this.name}: the owner can set the goal, generate, choose a preset, give feedback, pick or stop (not ${method})`)
  }

  // ---- the kernel ----

  commands() {
    const tool = (name, description, input, run) => new Tool({ name: `${this.name}.${name}`, type: "dev", view: "studio", description, input, run })
    return [
      tool("goal", "set what the image is for and what done means", { goal: "the imagination, the end goal", criteria: "what done means, one per line (scored by critiques)" }, (i, c) => this.goal(i, c)),
      tool("prompt", "save a new prompt version: the optimised prompt and why it changed", { text: "the full prompt for the image model (subject, setting, composition, light, style, lens, detail)", negative: "what to keep out (optional)", why: "what this version changes and why" }, (i, c) => this.prompt(i, c)),
      tool("generate", "queue images on this Mac's image model from a prompt version — refine an image (from + strength), or edit it (references, mask, auto_mask: when the model accepts them)", { v: "prompt version (default the newest)", prompt: "or a prompt given here", seeds: "how many variants, 1–4 (default 1)", seed: "a fixed seed (to compare prompts on the same noise)", preset: "a preset name (default the one in use; none: no preset)", width: "px (default: the preset's, else the model's)", height: "px", steps: "denoising steps (default: the preset's, else the model's)", from: "an image id to refine from", strength: "0..1: how far to move from it (default 0.6)", references: "image ids the edit starts from (the first is edited)", mask: "an image id: white = repaint, black = keep (the owner's mask)", auto_mask: "the object to repaint, named (e.g. the red scarf)" }, (i, c) => this.generate(i, c)),
      tool("wait", "wait until images finish; then you see them on your next step", { ids: "image ids, comma-separated (default: yours still running)", seconds: "at most (default 900)" }, (i, c) => this.wait(i, c)),
      tool("critique", "judge an image against the goal and criteria", { image: "its id", scores: "0–10 per criterion, e.g. {goal: 7, composition: 6, light: 8}", notes: "what you see: what works, what misses", verdict: "done | revise | discard", next: "for revise: what to change" }, (i, c) => this.critique(i, c)),
      tool("pick", "mark the best image so far", { image: "its id", why: "why it is the best" }, (i, c) => this.pick(i, c)),
      tool("look", "see an image again on your next step (to compare)", { image: "its id" }, (i, c) => this.look(i, c)),
      tool("presets", "the presets and what the image model accepts", {}, () => this.presets()),
      tool("preset", "choose the preset every generate uses (or none)", { name: "a preset name, or none", why: "the owner asked, or what made it look better" }, (i, c) => this.preset(i, c)),
    ]
  }

  brief() {
    const s = this.state
    const live = s.images.filter((i) => LIVE.has(i.status))
    const best = s.images.filter((i) => i.critiques.length).sort((a, b) => b.critiques.at(-1).score - a.critiques.at(-1).score)[0]
    return [s.goal ? clip(s.goal.text, 50) : "no goal", `${s.images.length} image${s.images.length === 1 ? "" : "s"}`, live.length ? `${live.length} running` : null, best ? `best ${best.id} ${best.critiques.at(-1).score}/10` : null, s.picked ? `pick ${s.picked.image}` : null].filter(Boolean).join(" · ")
  }

  render() {
    const s = this.state
    const out = [`the studio: images on this Mac's image model (${this.name}.goal / prompt / generate / wait / critique / pick / look) — generate a few seeds, look, critique each against the criteria, refine; you see your new images on your next step`]
    out.push(s.goal ? `GOAL: ${s.goal.text}` : `GOAL: (none yet — ${this.name}.goal)`)
    if (s.criteria.length) out.push(`DONE MEANS: ${s.criteria.map((c, i) => `${i + 1}. ${c}`).join("  ")}`)
    if (s.model) out.push(`MODEL: ${s.model.title} — ${s.model.modes.join(" / ")}; accepts ${s.model.accepts.join(", ")}`)
    out.push(`PRESET: ${s.preset ? `${s.preset.name} (${clip(s.preset.why, 120)})` : "none"}${s.goal?.preset && s.goal.preset !== "auto" ? ` · the owner asked ${s.goal.preset}` : ""} — ${this.name}.presets lists them (${s.presets.map((p) => p.name).join(", ")})`)
    for (const p of s.prompts.slice(-3)) out.push(`prompt v${p.v} (${p.by}: ${clip(p.why, 160)}): ${clip(oneLine(p.text), 500)}${p.negative ? ` | negative: ${clip(p.negative, 160)}` : ""}`)
    for (const i of s.images.slice(0, 8)) {
      const c = i.critiques.at(-1)
      out.push(`  ${i.id} v${i.v ?? "-"} seed ${i.seed}${i.preset ? ` ${i.preset}` : ""}${i.mode === "edit" ? " edit" : ""}${i.from ? ` ← ${i.from}@${i.strength}` : ""} ${i.status}${i.status === "running" ? ` ${i.step}/${i.steps}` : ""}${c ? ` · ${c.by}: ${c.score}/10 ${c.verdict}${c.next ? ` → ${clip(c.next, 160)}` : ""}` : ""}${i.error ? ` — ${clip(i.error, 160)}` : ""}`)
    }
    if (s.picked) out.push(`PICK: ${s.picked.image}${s.picked.why ? ` (${clip(s.picked.why, 160)})` : ""}`)
    const fb = s.feedback.slice(-3)
    if (fb.length) out.push(`OWNER FEEDBACK: ${fb.map((f) => `${f.id}${f.image ? ` on ${f.image}` : ""}: ${clip(f.text, 300)}${f.marks?.length ? ` [${f.marks.length} mark${f.marks.length === 1 ? "" : "s"}: ${f.marks.map((m) => `${m.n} ${clip(m.note, 60)}`).join("; ")}${f.mask ? `; mask ${f.mask}` : ""}]` : ""}`).join(" | ")}`)
    return out.join("\n")
  }
}
