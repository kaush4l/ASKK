// Image generation on this Mac (2026-10-23 owner: "build something like the comfy UI or the canvas applications where
// we use any LLM underlying in order to generate image or video output"; then "The model should be configurable … we
// note the artifacts present for the images models — some models take in references, some accept live edits, markers"):
// the model is a folder in the models registry (companion/models: models/image/<name>/model.md — its modes, what each
// accepts, its options), run one job at a time (the GPU is one), each a fixed program with an argument list, never a
// shell. Presets (models/image/presets/<name>.md) shape a call: size, steps, style around the prompt, negative.
// Capability `images` when an image model's programs are installed.
//
//   POST image/generate {prompt, negative?, width?, height?, steps?, seed?, guidance?, model?, preset?, from?, strength?,
//        references?: [id], mask?: id, auto_mask?, by?, note?}
//        → { job } queued. The mode follows what the call carries: references / mask / auto_mask → the model's `edit`
//        mode; `from` (an earlier image) → `init` in generate when the model refines that way, else edit with it as the
//        first reference; else generate. An input the model does not accept is refused, naming what it does accept.
//   POST image/upload {data (base64 PNG or JPEG), kind: mask | reference | marked, from?, note?, by?}
//        → { job } an image the owner made (a mask drawn over `from`, a reference, the image with marks drawn on it),
//        kept like a done job so a later call names it
//   POST image/send {id, caption?}            a finished image to the owner's Telegram chat (2026-10-24 owner: "We should
//                                              able to send images"): the bot's host-only photo.send, never a path → {sent}
//   POST image/stop {id}                       a queued job dropped, a running one killed → { job }
//   POST image/delete {id}                     the image gone (2026-10-24 owner: "the ability to delete images"): stopped
//        first when it runs, its PNG and index entry removed, with the masks and marked copies the owner drew over it;
//        refused while a queued or running job starts from it → { deleted: [ids] }
//   GET  image/jobs                            { jobs } newest first, { running, queued, models, model, presets }
//   GET  image/job?id=                         { job }
//   GET  image/file?id=                        the PNG
//   GET  image/model?id=&max=                  { id, media_type, width, height, data } — a JPEG ≤ max px for a model's eyes
//   job: { id, prompt, negative, width, height, steps, seed, guidance, model, mode, preset, from, strength, references,
//          mask, auto_mask, by, note, kind (generated | mask | reference | marked), status: queued | running | done |
//          failed | stopped | interrupted, step, at, started_at, ended_at, ms, error, url }
//
// Files: <state>/images/<id>.png, the index <state>/images/index.json (≤ KEEP jobs; a job running or queued when the
// server stopped comes back interrupted; an unreadable index is moved aside and logged). A failed run keeps the end of
// what the program printed as its error.
//
//   const images = await createImagegen({ state, log })   null when no image model is installed

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { API_PREFIX } from "../shared/config.js"
import { httpError } from "../shared/http.js"
import { sharedModels } from "../models/index.js"
import { applyPreset, buildArgv, dirOf, effective, findProgram } from "../models/registry.js"

const KEEP = 200
const ID = /^img-[a-z0-9]+-\d+$/
const MAX_UPLOAD = 12 * 1024 * 1024
// One GPU for the whole process (audit 20: each desk's host API had its own queue, so two desks ran two 25 GB jobs at
// once): a desk's next job starts only when no desk's job runs; a desk that finishes wakes the others.
const gpu = { holder: null, waiting: new Set() }
const releaseGpu = (who) => {
  if (gpu.holder !== who) return
  gpu.holder = null
  for (const wake of [...gpu.waiting]) {
    gpu.waiting.delete(wake)
    wake()
    if (gpu.holder) break
  }
}
const MAX_PIXELS = 4096 * 4096 // an upload's size, read from its header before it is decoded

const side = (n) => {
  const v = Math.round(Number(n) / 16) * 16
  if (!(v >= 256 && v <= 2048)) throw httpError(400, "width/height: 256 to 2048 px")
  return v
}

// models: the registry (tests: their own); which: how programs are found (tests); spawn: Bun.spawn's shape (tests)
// integrations: the desk's (telegram, for image/send); onSent({message, kind, text}): a sent image's message id (the
// owner's reply to it comes back to this desk: kernel-telegram.js recordSent)
export async function createImagegen({ state, log = () => {}, models = sharedModels({ log }), which = Bun.which, spawn = Bun.spawn, always = false, integrations = null, onSent = () => {} } = {}) {
  const usable = () => models.list("image").filter((m) => m.ok && Object.values(m.modes).some((s) => findProgram(s.bin, which, dirOf(m))))
  if (!usable().length && !always) return null
  const dir = join(state, "images")
  mkdirSync(dir, { recursive: true })
  const index = join(dir, "index.json")
  let jobs = []
  try {
    jobs = existsSync(index) ? JSON.parse(readFileSync(index, "utf8")) : []
    if (!Array.isArray(jobs)) throw new Error("not a list")
  } catch (error) {
    const aside = `${index}.unreadable-${Date.now()}`
    renameSync(index, aside)
    log(`images: ${index} unreadable (${error.message}) — moved to ${aside}`)
    jobs = []
  }
  // a job the server stopped under: interrupted, never "running" forever
  let woke = 0
  jobs = jobs.map((j) => (["running", "queued"].includes(j.status) ? (woke++, { ...j, status: "interrupted", error: "the desk server stopped while it waited or ran" }) : j))
  if (woke) log(`images: ${woke} job${woke === 1 ? "" : "s"} interrupted by the last stop`)
  let seq = jobs.length
  const boot = Date.now().toString(36)
  let proc = null
  let current = null
  let closed = false
  const me = Symbol(state)

  // the index keeps KEEP jobs: an image that falls out of it goes with it (audit 20: the PNGs piled up)
  const trim = (list) => {
    for (const j of list.slice(KEEP)) Bun.file(join(dir, `${j.id}.png`)).delete().catch(() => {})
    return list.slice(0, KEEP)
  }
  const save = () => {
    try {
      writeFileSync(`${index}.tmp`, JSON.stringify(jobs.slice(0, KEEP)))
      renameSync(`${index}.tmp`, index)
    } catch (error) {
      log(`images: index not saved: ${error.message}`)
    }
  }
  const view = (j) => ({ ...j, url: j.status === "done" ? `${API_PREFIX}image/file?id=${j.id}` : null })
  const find = (id) => {
    const j = jobs.find((x) => x.id === id)
    if (!j) throw httpError(404, `no image job ${id}`)
    return j
  }
  const patch = (id, p, { persist = true } = {}) => {
    jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j))
    if (persist) save()
  }

  async function runNext() {
    if (current || closed) return
    const next = [...jobs].reverse().find((j) => j.status === "queued")
    if (!next) return
    if (gpu.holder && gpu.holder !== me) return void gpu.waiting.add(runNext) // another desk's job holds the GPU
    gpu.holder = me
    current = next.id
    const file = join(dir, `${next.id}.png`)
    const started = Date.now()
    let tail = ""
    try {
      const model = models.get("image", next.model)
      const png = (id) => join(dir, `${id}.png`)
      const argv = buildArgv(
        model,
        next.mode,
        {
          prompt: next.prompt,
          negative: next.negative,
          width: next.width,
          height: next.height,
          steps: next.steps,
          seed: next.seed,
          guidance: next.guidance,
          init: next.init ? png(next.init) : null,
          strength: next.strength,
          references: next.references?.map(png),
          mask: next.mask ? png(next.mask) : null,
          auto_mask: next.auto_mask,
          out: file,
        },
        { which },
      )
      const bar = new RegExp(model.meta.progress ?? "(\\d+)/(\\d+)", "g")
      patch(next.id, { status: "running", started_at: new Date(started).toISOString(), step: 0 })
      log(`images: ${next.by ?? "owner"} → ${next.id} (${next.model} ${next.mode}${next.preset ? ` · ${next.preset}` : ""}, ${next.width}×${next.height}, ${next.steps} steps${next.from ? `, from ${next.from}` : ""}): ${next.prompt.slice(0, 100)}`)
      proc = spawn(argv, { stdout: "pipe", stderr: "pipe", env: { ...process.env, PYTHONWARNINGS: "ignore" } })
      // progress: mflux prints a bar "… 7/20 …" as it steps
      const read = async (stream) => {
        const decoder = new TextDecoder()
        for await (const chunk of stream) {
          const text = decoder.decode(chunk)
          tail = (tail + text).slice(-2000)
          const m = [...text.matchAll(bar)].filter((x) => Number(x[2]) === next.steps).at(-1)
          if (m) patch(next.id, { step: Number(m[1]) }, { persist: false })
        }
      }
      await Promise.all([read(proc.stdout), read(proc.stderr), proc.exited])
      // stopped, or deleted while it ran
      if (jobs.find((j) => j.id === next.id)?.status !== "running") return
      const code = await proc.exited
      if (code === 0 && existsSync(file)) {
        patch(next.id, { status: "done", step: next.steps, ended_at: new Date().toISOString(), ms: Date.now() - started })
        log(`images: ${next.id} done in ${((Date.now() - started) / 1000).toFixed(0)} s`)
      } else {
        const error = tail.replace(/\s+/g, " ").trim().slice(-600) || `exited ${code}`
        patch(next.id, { status: "failed", ended_at: new Date().toISOString(), ms: Date.now() - started, error })
        log(`images: ${next.id} failed: ${error.slice(0, 200)}`)
      }
    } catch (error) {
      patch(next.id, { status: "failed", ended_at: new Date().toISOString(), ms: Date.now() - started, error: error.message })
      log(`images: ${next.id} failed to start: ${error.message}`)
    } finally {
      proc = null
      current = null
      releaseGpu(me)
      runNext()
    }
  }

  const done = (id, what) => {
    const j = find(String(id ?? ""))
    if (j.status !== "done") throw httpError(400, `${what}: ${j.id} is ${j.status}, not an image yet`)
    return j.id
  }

  function generate(body = {}) {
    const model = body.model ? models.get("image", String(body.model)) : models.selected("image")
    if (!model?.ok) throw httpError(400, `model: ${model?.problem ?? `none chosen — one of ${usable().map((m) => m.name).join(", ")}`}`)
    if (!usable().some((m) => m.name === model.name)) throw httpError(501, `model: ${model.name} is not installed — ${model.install ?? "see its model.md"}`)
    const preset = models.preset(body.preset ? String(body.preset) : null)
    const raw = String(body.prompt ?? "").trim()
    if (!raw) throw httpError(400, "prompt: what to draw")
    if (raw.length > 4000) throw httpError(400, "prompt: at most 4000 chars")
    const call = applyPreset(preset, { ...body, prompt: raw })
    const opts = effective(model)
    const accepts = (mode, k) => k in (model.modes[mode]?.inputs ?? {})
    const from = call.from ? done(call.from, "from") : null
    let references = Array.isArray(call.references) ? call.references.map((r) => done(r, "references")) : []
    if (references.length > 4) throw httpError(400, "references: at most 4")
    const mask = call.mask ? done(call.mask, "mask") : null
    const auto_mask = call.auto_mask ? String(call.auto_mask).slice(0, 200) : null
    let mode = references.length || mask || auto_mask ? "edit" : "generate"
    let init = null
    if (from && mode === "generate" && accepts("generate", "init")) init = from
    else if (from) {
      mode = "edit"
      references = [from, ...references.filter((r) => r !== from)]
    }
    if (!model.modes[mode]) throw httpError(400, `${model.title} cannot ${mode === "edit" ? "edit (references, a mask, an object to repaint)" : "generate"} — it accepts ${model.accepts.join(", ")}`)
    for (const [k, v] of Object.entries({ references: references.length, mask, auto_mask, negative: call.negative, guidance: call.guidance }))
      if (v && !accepts(mode, k)) throw httpError(400, `${k}: ${model.title}'s ${mode} mode does not take it (it takes ${Object.keys(model.modes[mode].inputs ?? {}).filter((x) => x !== "out").join(", ")})`)
    const steps = Math.round(Number(call.steps ?? opts.steps ?? 20))
    if (!(steps >= 1 && steps <= 80)) throw httpError(400, "steps: 1 to 80")
    const strength = init || mode === "edit" ? (call.strength == null ? (init ? 0.6 : null) : Number(call.strength)) : null
    if (strength != null && !(strength > 0 && strength <= 1)) throw httpError(400, "strength: between 0 and 1 (how far to move from the start image)")
    const seed = call.seed == null || call.seed === "" ? Math.floor(Math.random() * 2 ** 31) : Math.round(Number(call.seed))
    if (!Number.isFinite(seed)) throw httpError(400, "seed: a whole number")
    const guidance = call.guidance == null ? null : Number(call.guidance)
    const job = {
      id: `img-${boot}-${++seq}`,
      kind: "generated",
      prompt: call.prompt,
      asked: call.prompt === raw ? null : raw,
      negative: String(call.negative ?? "").trim() || null,
      width: side(call.width ?? opts.width ?? 1024),
      height: side(call.height ?? opts.height ?? 1024),
      steps,
      seed,
      guidance: Number.isFinite(guidance) ? guidance : null,
      model: model.name,
      mode,
      preset: preset?.name ?? null,
      from,
      init,
      strength,
      references,
      mask,
      auto_mask,
      by: String(call.by ?? "owner").slice(0, 60),
      note: call.note ? String(call.note).slice(0, 300) : null,
      status: "queued",
      step: 0,
      at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
      ms: null,
      error: null,
    }
    jobs = trim([job, ...jobs])
    save()
    runNext()
    return { job: view(find(job.id)) }
  }

  // An image the owner made in the page: a mask, a reference, the image with marks drawn on it.
  async function upload(body = {}) {
    const kind = String(body.kind ?? "")
    if (!["mask", "reference", "marked"].includes(kind)) throw httpError(400, "kind: mask, reference or marked")
    const bytes = Buffer.from(String(body.data ?? "").replace(/^data:image\/\w+;base64,/, ""), "base64")
    if (!bytes.length) throw httpError(400, "data: the image, base64")
    if (bytes.length > MAX_UPLOAD) throw httpError(413, "data: at most 12 MB")
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8
    if (!png && !jpeg) throw httpError(400, "data: a PNG or JPEG")
    const from = body.from ? done(body.from, "from") : null
    const id = `img-${boot}-${++seq}`
    const image = new Bun.Image(new Uint8Array(bytes))
    const meta = await image.metadata()
    if (!(meta.width * meta.height <= MAX_PIXELS)) throw httpError(413, `data: at most ${MAX_PIXELS} pixels (this one is ${meta.width}×${meta.height})`)
    await Bun.write(join(dir, `${id}.png`), png ? bytes : await image.png().bytes())
    const job = {
      id,
      kind,
      prompt: String(body.note ?? "").slice(0, 300) || `${kind} by ${body.by ?? "owner"}`,
      width: meta.width,
      height: meta.height,
      from,
      by: String(body.by ?? "owner").slice(0, 60),
      note: body.note ? String(body.note).slice(0, 300) : null,
      status: "done",
      step: 0,
      steps: 0,
      at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    }
    jobs = trim([job, ...jobs])
    save()
    log(`images: ${job.by} added a ${kind} ${id}${from ? ` over ${from}` : ""}`)
    return { job: view(job) }
  }

  function stop({ id } = {}) {
    const j = find(String(id ?? ""))
    if (!["queued", "running"].includes(j.status)) return { job: view(j) }
    patch(j.id, { status: "stopped", ended_at: new Date().toISOString(), error: "stopped" })
    if (current === j.id) proc?.kill()
    log(`images: ${j.id} stopped`)
    return { job: view(find(j.id)) }
  }

  function remove({ id } = {}) {
    const j = find(String(id ?? ""))
    // the owner's drawings over it (a mask, the marked copy) go with it
    const ids = [j.id, ...jobs.filter((x) => ["mask", "marked"].includes(x.kind) && x.from === j.id).map((x) => x.id)]
    const uses = (x, i) => x.from === i || x.init === i || x.mask === i || x.references?.includes(i)
    const user = jobs.find((x) => !ids.includes(x.id) && ["queued", "running"].includes(x.status) && ids.some((i) => uses(x, i)))
    if (user) throw httpError(409, `${user.id} (${user.status}) starts from ${j.id}: stop it first`)
    if (["queued", "running"].includes(j.status)) stop({ id: j.id })
    jobs = jobs.filter((x) => !ids.includes(x.id))
    save()
    for (const i of ids) Bun.file(join(dir, `${i}.png`)).delete().catch(() => {})
    log(`images: ${ids.join(", ")} deleted`)
    return { deleted: ids }
  }

  // To the owner's Telegram chat: a finished image, with its prompt as the caption unless one is given.
  async function send({ id, caption, by = "owner" } = {}) {
    const j = find(String(id ?? ""))
    if (j.status !== "done") throw httpError(400, `${j.id} is ${j.status}, not an image yet`)
    const bot = integrations?.get?.("telegram")?.photo
    if (!bot?.send) throw httpError(501, "no Telegram bot that sends images here (integrations/telegram, TELEGRAM_BOT_TOKEN)")
    const text = String(caption ?? "").trim().slice(0, 1000) || `${j.id} · ${String(j.prompt ?? "").slice(0, 300)}`
    let result
    try {
      result = await bot.send({ path: pathOf(j.id), title: j.id, caption: text })
    } catch (error) {
      throw httpError(502, error.message)
    }
    const sent = { to: "owner", at: new Date().toISOString(), by: String(by).slice(0, 60) }
    patch(j.id, { sent: [...(j.sent ?? []), sent] })
    try {
      onSent({ message: result?.message, kind: "image", text: `${j.id}: ${text}`, ref: { image: j.id } })
    } catch {}
    log(`images: ${j.id} sent to Telegram by ${sent.by}`)
    return { sent }
  }

  const pathOf = (id) => {
    if (!ID.test(String(id ?? ""))) throw httpError(400, "id: an image job id")
    const path = join(dir, `${id}.png`)
    if (!existsSync(path)) throw httpError(404, `no image ${id}`)
    return path
  }

  async function modelImage(id, max) {
    const path = pathOf(id)
    const width = Math.max(320, Math.min(1568, Math.floor(Number(max)) || 1024))
    const source = new Bun.Image(new Uint8Array(await Bun.file(path).arrayBuffer()))
    const meta = await source.metadata()
    const jpeg = await (meta.width > width ? source.resize(width) : source).jpeg({ quality: 85 }).bytes()
    const out = await new Bun.Image(jpeg).metadata()
    return { id, media_type: "image/jpeg", width: out.width, height: out.height, data: Buffer.from(jpeg).toString("base64") }
  }

  const modelTwin = () => {
    const m = models.selected("image")
    return m ? { name: m.name, title: m.title, accepts: m.accepts, modes: Object.keys(m.modes), options: effective(m) } : null
  }
  return {
    get usable() {
      return usable().length > 0
    },
    get models() {
      return usable().map((m) => m.name)
    },
    model: modelTwin,
    presets: () => models.presets().filter((p) => p.ok),
    generate,
    upload,
    send,
    stop,
    remove,
    file: (id) => new Response(Bun.file(pathOf(id)), { headers: { "content-type": "image/png", "cache-control": "max-age=31536000, immutable" } }),
    modelImage,
    jobs: () => ({ jobs: jobs.map(view), running: current, queued: jobs.filter((j) => j.status === "queued").length, models: usable().map((m) => m.name), model: modelTwin(), presets: models.presets().filter((p) => p.ok) }),
    job: (id) => ({ job: view(find(String(id ?? ""))) }),
    // a desk reload: its running job killed, its queue left for the next instance (marked interrupted there)
    close: () => {
      closed = true
      gpu.waiting.delete(runNext)
      proc?.kill()
      releaseGpu(me)
    },
  }
}

export const imageRoutes = (images) => ({
  GET: {
    "image/jobs": () => images.jobs(),
    "image/job": (params) => images.job(params.get("id")),
    "image/file": (params) => images.file(params.get("id")),
    "image/model": (params) => images.modelImage(params.get("id"), params.get("max")),
  },
  POST: {
    "image/generate": (body) => images.generate(body),
    "image/upload": (body) => images.upload(body),
    "image/send": (body) => images.send(body),
    "image/stop": (body) => images.stop(body),
    "image/delete": (body) => images.remove(body),
  },
})
