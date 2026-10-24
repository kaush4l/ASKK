// Audio files on this Mac (2026-10-24 owner: "I want an audio generation pipeline such that, even the lead is able to use
// TTS model to create audio files. So the audio transcription can be a tool as well … The telegram personal chat will be
// the default channel"): a script → an audio file on the text-to-speech models of the models folder (companion/models,
// rendered by hardware/speech: a command per call, no server), an audio file → its text on a speech-to-text model, and a
// finished file sent to the owner's Telegram chat. One job at a time per desk; a job is fixed programs with argument
// lists (the models'), never a shell.
//
// Long scripts (the owner, later: "I wanted something that can be long as well … a story of Vikram vetal … a change in
// narrative style where the background story, the prelude story and the narrative story. With expressiveness"): a
// script may hold chapter and style lines, each alone on its line —
//   [chapter: The king and the corpse]   a new chapter: its own file, playable (and sent, with send) as soon as it is made
//   [style: storyteller]                 the voice style (models/tts/styles/<name>.md) of what follows, until the next
// — so a long piece streams out chapter by chapter while the rest is made, and its parts change voice and expressiveness.
// A script without them is one chapter on the job's model and voice.
//
//   POST audio/make {text, title?, model?, voice?, speed?, options?, style?, send?, by?, note?}
//        → { job } queued; the script kept as <id>.txt. options: the model's options for this file (Chatterbox's
//        exaggeration …); style: the style of a script with no [style:] line; send: each chapter to the owner's
//        Telegram chat as it is made (the whole file when it has one chapter)
//   POST audio/transcribe {id, chapter? | path, model?, locale?}   → { text, seconds, ms, model }
//   POST audio/send {id, chapter?, caption?, to?: owner}           → { sent: {to, at, chapter} }
//   POST audio/prepare {kind: tts | stt, name}   a catalogue speech model added and installed for the desk
//   POST audio/style {name, model?, voice?, speed?, options?, about?, use?, writing?, why}   a voice style set (the
//        owner's feedback, carried out by the lead) → { style }
//   POST audio/stop {id}  ·  POST audio/delete {id}
//   GET  audio/jobs  { jobs, running, queued, tts, stt, models, catalog, styles }  ·  GET audio/job?id=  { job }
//   GET  audio/file?id=&chapter=&format=m4a|wav   the audio  ·  GET audio/script?id=&chapter=  { text } spoken words only
//   GET  audio/styles  { styles: [{name, title, about, use, model, voice, speed, options, writing, changes}] }
//   job: { id, title, chars, head, model, voice, speed, options, style, send, by, note, status: queued | running | done |
//          failed | stopped | interrupted, parts: {done, total}, chapters: [{n, title, chars, styles, status, seconds,
//          url, error, sent}], at, started_at, ended_at, ms, seconds, bytes, error, url, heard, sent: [{to, at, chapter}] }
//
// Files: <state>/audio/<id>.wav and .m4a (the whole), <id>-c<n>.wav and .m4a (a chapter, when there are several),
// <id>.txt (the script), index.json (≤ KEEP jobs; a job running or queued when the server stopped comes back interrupted).

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { joinWavs } from "../hardware/speech/index.js"
import { API_PREFIX } from "../shared/config.js"
import { httpError } from "../shared/http.js"

const KEEP = 100
const ID = /^aud-[a-z0-9]+-\d+$/
const MAX_CHARS = 400_000 // a long piece: about seven hours of speech
const RATE = 24000 // every part joined at one format (Kokoro and Chatterbox write 24 kHz; say 22.05 kHz is converted)
const GAP = { segment: 0.6, chapter: 1.4 }

// A WAV's format and length, from its header (fmt: rate, channels, bits, block; data: size).
export function wavInfo(bytes) {
  const b = Buffer.from(bytes)
  if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF") return null
  let at = 12
  let fmt = null
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4)
    const size = b.readUInt32LE(at + 4)
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), block: b.readUInt16LE(at + 20), bits: b.readUInt16LE(at + 22) }
    else if (id === "data" && fmt) return { ...fmt, seconds: Math.round((Math.min(size, b.length - at - 8) / (fmt.rate * fmt.block)) * 10) / 10 }
    at += 8 + size + (size % 2)
  }
  return null
}
export const wavSeconds = (bytes) => wavInfo(bytes)?.seconds ?? null

// A script → its chapters, each a list of segments in one style. [chapter: …] and [style: …] lines, alone on their line,
// are directions, never spoken.
export function parseScript(text, { style = null } = {}) {
  const chapters = []
  let current = null
  let st = style
  const chapter = (title) => {
    current = { n: chapters.length + 1, title, segments: [] }
    chapters.push(current)
  }
  for (const line of String(text ?? "").split("\n")) {
    const dir = line.match(/^\s*\[(chapter|style)\s*:\s*([^\]]*)\]\s*$/i)
    if (dir) {
      const value = dir[2].trim()
      if (dir[1].toLowerCase() === "chapter") chapter(value || `Part ${chapters.length + 1}`)
      else st = value || style
      continue
    }
    if (!current) chapter(null)
    const last = current.segments.at(-1)
    if (last && last.style === st) last.text += `\n${line}`
    else current.segments.push({ style: st, text: line })
  }
  for (const c of chapters) {
    c.segments = c.segments.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text)
    c.text = c.segments.map((s) => s.text).join("\n\n")
    c.chars = c.text.length
    c.styles = [...new Set(c.segments.map((s) => s.style).filter(Boolean))]
  }
  return chapters.filter((c) => c.segments.length)
}

// speech: hardware/speech (render, transcribeFile); files: the workspace (realPath); integrations: the desk's (telegram);
// models: the registry (models, styles); install: a model's install line; convert: wav → m4a; resample: a wav → RATE mono
// 16-bit (tests: their own)
export async function createAudiogen({ state, speech, files = null, integrations = null, onSent = () => {}, models = null, install = null, log = () => {}, convert = defaultConvert, resample = defaultResample }) {
  if (!speech?.render) return null
  const dir = join(state, "audio")
  mkdirSync(dir, { recursive: true })
  const index = join(dir, "index.json")
  let jobs = []
  try {
    jobs = existsSync(index) ? JSON.parse(readFileSync(index, "utf8")) : []
    if (!Array.isArray(jobs)) throw new Error("not a list")
  } catch (error) {
    const aside = `${index}.unreadable-${Date.now()}`
    renameSync(index, aside)
    log(`audio: ${index} unreadable (${error.message}) — moved to ${aside}`)
    jobs = []
  }
  let woke = 0
  jobs = jobs.map((j) => (["running", "queued"].includes(j.status) ? (woke++, { ...j, status: "interrupted", error: "the desk server stopped while it waited or ran" }) : j))
  if (woke) log(`audio: ${woke} job${woke === 1 ? "" : "s"} interrupted by the last stop`)
  let seq = jobs.length
  const boot = Date.now().toString(36)
  let current = null
  let abort = null
  let closed = false

  const path = (id, ext, chapter = null) => join(dir, `${id}${chapter ? `-c${chapter}` : ""}.${ext}`)
  const save = () => {
    try {
      writeFileSync(`${index}.tmp`, JSON.stringify(jobs.slice(0, KEEP)))
      renameSync(`${index}.tmp`, index)
    } catch (error) {
      log(`audio: index not saved: ${error.message}`)
    }
  }
  const drop = (id) => {
    for (const f of readdirSync(dir)) if (f.startsWith(`${id}.`) || f.startsWith(`${id}-`)) Bun.file(join(dir, f)).delete().catch(() => {})
  }
  const trim = (list) => {
    for (const j of list.slice(KEEP)) drop(j.id)
    return list.slice(0, KEEP)
  }
  const fileUrl = (id, chapter = null) => `${API_PREFIX}audio/file?id=${id}${chapter ? `&chapter=${chapter}` : ""}`
  const view = (j) => ({ ...j, url: j.status === "done" ? fileUrl(j.id) : null })
  const find = (id) => {
    const j = jobs.find((x) => x.id === String(id ?? ""))
    if (!j) throw httpError(404, `no audio job ${id}`)
    return j
  }
  const patch = (id, p) => {
    jobs = jobs.map((j) => (j.id === id ? { ...j, ...(typeof p === "function" ? p(j) : p) } : j))
    save()
  }
  const alive = (id) => jobs.find((j) => j.id === id)?.status === "running"
  const patchChapter = (id, n, p) => patch(id, (j) => ({ chapters: j.chapters.map((c) => (c.n === n ? { ...c, ...p } : c)) }))
  const styleOf = (name) => (name && models?.style ? models.style(name) : null)
  const bot = () => integrations?.get?.("telegram")?.audio ?? null

  // a part rendered at one format: RATE, mono, 16-bit (converted when the model wrote another)
  async function part(file) {
    const info = wavInfo(await Bun.file(file).arrayBuffer())
    if (info && info.rate === RATE && info.channels === 1 && info.bits === 16) return Bun.file(file).arrayBuffer()
    const fixed = file.replace(/\.wav$/, "-r.wav")
    await resample(file, fixed)
    const bytes = await Bun.file(fixed).arrayBuffer()
    Bun.file(fixed).delete().catch(() => {})
    return bytes
  }

  async function renderChapter(job, chapter, signal) {
    const pieces = []
    const temp = []
    try {
      for (const [i, seg] of chapter.segments.entries()) {
        if (signal.aborted || !alive(job.id)) throw new Error("stopped")
        const st = styleOf(seg.style)
        // a styled part takes its style's voice and options; an unstyled one the job's
        const options = st ? { ...(st.options ?? {}) } : { ...(job.options ?? {}) }
        const speed = job.speed ?? st?.speed ?? null
        const model = st?.model ?? job.model ?? undefined
        if (speed != null && models?.get("tts", model ?? models.selected("tts")?.name)?.options?.speed) options.speed = speed
        const out = path(job.id, "wav", `${chapter.n}-s${i + 1}`)
        temp.push(out)
        await speech.render({ text: seg.text, model, voice: st?.voice ?? job.voice ?? undefined, options, out, signal })
        pieces.push(await part(out))
        patch(job.id, (j) => ({ parts: { ...j.parts, done: j.parts.done + 1 } }))
      }
    } finally {
      for (const f of temp) Bun.file(f).delete().catch(() => {})
    }
    return joinWavs(pieces, GAP.segment)
  }

  async function runNext() {
    if (current || closed) return
    const next = [...jobs].reverse().find((j) => j.status === "queued")
    if (!next) return
    current = next.id
    abort = new AbortController()
    const signal = abort.signal
    const started = Date.now()
    try {
      patch(next.id, { status: "running", started_at: new Date(started).toISOString() })
      const chapters = parseScript(readFileSync(path(next.id, "txt"), "utf8"), { style: next.style })
      log(`audio: ${next.by ?? "owner"} → ${next.id} (${chapters.length} chapter${chapters.length === 1 ? "" : "s"}, ${next.parts.total} part${next.parts.total === 1 ? "" : "s"}, ${next.chars} chars): ${next.title}`)
      const many = chapters.length > 1
      const made = []
      for (const ch of chapters) {
        patchChapter(next.id, ch.n, { status: "running" })
        try {
          const wav = await renderChapter(next, ch, signal)
          made.push(wav)
          if (many) {
            await Bun.write(path(next.id, "wav", ch.n), wav)
            await convert(path(next.id, "wav", ch.n), path(next.id, "m4a", ch.n))
          }
          patchChapter(next.id, ch.n, { status: "done", seconds: wavSeconds(wav), url: many ? fileUrl(next.id, ch.n) : null })
          log(`audio: ${next.id} chapter ${ch.n}/${chapters.length} ready (${wavSeconds(wav)} s)${ch.title ? `: ${ch.title}` : ""}`)
          // streamed out: a chapter goes to the owner as soon as it is made
          if (next.send && many) await send({ id: next.id, chapter: ch.n }).catch((e) => log(`audio: ${next.id} chapter ${ch.n} not sent: ${e.message}`))
        } catch (error) {
          if (!alive(next.id)) return
          patchChapter(next.id, ch.n, { status: "failed", error: String(error.message).slice(-300) })
          throw error
        }
      }
      if (!alive(next.id)) return
      await Bun.write(path(next.id, "wav"), many ? joinWavs(made, GAP.chapter) : made[0])
      await convert(path(next.id, "wav"), path(next.id, "m4a"))
      const seconds = wavSeconds(await Bun.file(path(next.id, "wav")).arrayBuffer())
      patch(next.id, { status: "done", ended_at: new Date().toISOString(), ms: Date.now() - started, seconds, bytes: Bun.file(path(next.id, "m4a")).size })
      log(`audio: ${next.id} done in ${((Date.now() - started) / 1000).toFixed(0)} s (${seconds ?? "?"} s of audio)`)
      if (next.send && !many) await send({ id: next.id }).catch((e) => log(`audio: ${next.id} not sent: ${e.message}`))
    } catch (error) {
      if (!alive(next.id)) return
      patch(next.id, { status: "failed", ended_at: new Date().toISOString(), ms: Date.now() - started, error: String(error.message).slice(-600) })
      log(`audio: ${next.id} failed: ${String(error.message).slice(0, 200)}`)
    } finally {
      current = null
      abort = null
      runNext()
    }
  }

  function make(body = {}) {
    const text = String(body.text ?? "").trim()
    if (!text) throw httpError(400, "text: the script to speak")
    if (text.length > MAX_CHARS) throw httpError(413, `text: at most ${MAX_CHARS} chars per file (split it into parts)`)
    // the model, voice, options and styles checked now: a typo is refused here, not an hour later
    const model = body.model ? models?.get("tts", String(body.model)) : models?.selected("tts")
    if (models && !model?.ok) throw httpError(400, `model: ${model?.problem ?? "no text-to-speech model chosen"}`)
    const voice = body.voice ? String(body.voice) : null
    const voices = model?.options?.voice?.choices
    if (voice && voices && !voices.map(String).includes(voice)) throw httpError(400, `voice: one of ${voices.join(", ")}`)
    const options = body.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options : {}
    for (const k of Object.keys(options)) if (model && !model.options[k]) throw httpError(400, `options.${k}: ${model.name} has ${Object.keys(model.options).join(", ") || "none"}`)
    const speed = body.speed == null || body.speed === "" ? null : Number(body.speed)
    if (speed != null && !(speed >= 0.5 && speed <= 2)) throw httpError(400, "speed: 0.5 to 2")
    const style = body.style ? String(body.style) : null
    const chapters = parseScript(text, { style })
    if (!chapters.length) throw httpError(400, "text: nothing to speak (only [chapter:] / [style:] lines)")
    const used = [...new Set(chapters.flatMap((c) => c.segments.map((s) => s.style)).filter(Boolean))]
    for (const name of used) {
      if (!models?.style) throw httpError(400, `style ${name}: no styles here`)
      const st = models.style(name)
      if (!models.ready(models.get("tts", String(st.model))).ready) throw httpError(501, `style ${name}: ${st.model} is not installed — audio.prepare it`)
    }
    if (models && chapters.some((c) => c.segments.some((s) => !s.style)) && !models.ready(model).ready) throw httpError(501, `model: ${model.name} is not installed — audio.prepare it (missing ${models.ready(model).missing.join(", ")})`)
    const id = `aud-${boot}-${++seq}`
    writeFileSync(path(id, "txt"), text)
    const spoken = chapters.map((c) => c.text).join("\n\n")
    const job = {
      id,
      title: String(body.title ?? "").trim().slice(0, 120) || spoken.split("\n")[0].slice(0, 80),
      chars: spoken.length,
      head: spoken.slice(0, 300),
      model: model?.name ?? (body.model ? String(body.model) : null),
      voice,
      speed,
      options,
      style,
      styles: used,
      send: !!body.send,
      by: String(body.by ?? "owner").slice(0, 60),
      note: body.note ? String(body.note).slice(0, 300) : null,
      status: "queued",
      parts: { done: 0, total: chapters.reduce((n, c) => n + c.segments.length, 0) },
      chapters: chapters.map((c) => ({ n: c.n, title: c.title, chars: c.chars, styles: c.styles, status: "queued", seconds: null, url: null, error: null, sent: [] })),
      at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
      ms: null,
      seconds: null,
      bytes: null,
      error: null,
      heard: null,
      sent: [],
    }
    jobs = trim([job, ...jobs])
    save()
    runNext()
    return { job: view(job) }
  }

  const chapterOf = (j, n) => {
    if (n == null || n === "") return null
    const c = j.chapters?.find((x) => x.n === Number(n))
    if (!c) throw httpError(404, `${j.id} has no chapter ${n} (${(j.chapters ?? []).map((x) => x.n).join(", ")})`)
    return c
  }
  // a chapter's own file when the job has several, else the whole
  const audioPath = (j, c, ext) => (c && (j.chapters?.length ?? 0) > 1 ? path(j.id, ext, c.n) : path(j.id, ext))

  async function transcribe(body = {}) {
    let file
    let job = null
    let ch = null
    if (body.id) {
      job = find(body.id)
      ch = chapterOf(job, body.chapter)
      const ready = ch ? ch.status === "done" : job.status === "done"
      if (!ready) throw httpError(400, `${job.id}${ch ? ` chapter ${ch.n}` : ""} is ${ch?.status ?? job.status}, not audio yet`)
      file = existsSync(audioPath(job, ch, "m4a")) ? audioPath(job, ch, "m4a") : audioPath(job, ch, "wav")
    } else if (body.path) {
      if (!files?.realPath) throw httpError(501, "no workspace here")
      file = await files.realPath(String(body.path))
    } else throw httpError(400, "id (an audio job) or path (a workspace audio file)")
    const heard = await speech.transcribeFile({ path: file, model: body.model ? String(body.model) : undefined, locale: body.locale ? String(body.locale) : undefined })
    if (job && !ch) patch(job.id, { heard: { text: heard.text.slice(0, 20_000), model: heard.model, at: new Date().toISOString() } })
    if (job && ch) patchChapter(job.id, ch.n, { heard: { text: heard.text.slice(0, 8000), model: heard.model, at: new Date().toISOString() } })
    log(`audio: ${body.by ?? "owner"} transcribed ${job?.id ?? body.path}${ch ? ` chapter ${ch.n}` : ""} (${Math.round(heard.seconds ?? 0)} s, ${heard.model})`)
    return heard
  }

  // To the owner's personal Telegram chat (the default channel): the bot's host-only audio.send, in this process — never a
  // tool an agent names a path to.
  async function send(body = {}) {
    const j = find(body.id)
    const ch = chapterOf(j, body.chapter)
    const ready = ch ? ch.status === "done" : j.status === "done"
    if (!ready) throw httpError(400, `${j.id}${ch ? ` chapter ${ch.n}` : ""} is ${ch?.status ?? j.status}, not audio yet`)
    const b = bot()
    if (!b?.send) throw httpError(501, "no Telegram bot that sends audio here (integrations/telegram, TELEGRAM_BOT_TOKEN)")
    const to = body.to === "group" ? "group" : "owner"
    const many = (j.chapters?.length ?? 0) > 1
    const title = ch && many ? `${j.title} · ${ch.n}${ch.title ? `. ${ch.title}` : ""}` : j.title
    const seconds = ch ? ch.seconds : j.seconds
    const caption = String(body.caption ?? "").trim().slice(0, 1000) || `${title}${seconds ? ` · ${Math.round(seconds)} s` : ""}${ch && many ? ` · part ${ch.n} of ${j.chapters.length}` : ""}`
    try {
      const result = await b.send({ path: audioPath(j, ch, "m4a"), title, caption, to })
      // its message id: the owner's reply to this file comes back to this desk (kernel-telegram.js recordSent)
      if (to === "owner") onSent({ message: result?.message, kind: "audio", text: caption, ref: { audio: j.id, chapter: ch?.n ?? null } })
    } catch (error) {
      throw httpError(502, error.message)
    }
    const sent = { to, at: new Date().toISOString(), chapter: ch?.n ?? null }
    if (ch) patchChapter(j.id, ch.n, { sent: [...(ch.sent ?? []), sent] })
    else patch(j.id, (x) => ({ sent: [...(x.sent ?? []), sent] }))
    log(`audio: ${j.id}${ch ? ` chapter ${ch.n}` : ""} sent to Telegram (${to})`)
    return { sent }
  }

  function stop({ id } = {}) {
    const j = find(id)
    if (!["queued", "running"].includes(j.status)) return { job: view(j) }
    patch(j.id, { status: "stopped", ended_at: new Date().toISOString(), error: "stopped" })
    if (current === j.id) abort?.abort()
    log(`audio: ${j.id} stopped`)
    return { job: view(find(j.id)) }
  }

  function remove({ id } = {}) {
    const j = find(id)
    if (["queued", "running"].includes(j.status)) stop({ id: j.id })
    jobs = jobs.filter((x) => x.id !== j.id)
    save()
    drop(j.id)
    log(`audio: ${j.id} deleted`)
    return { deleted: [j.id] }
  }

  // A catalogue speech model for the desk: added when missing, installed when its programs are missing.
  async function prepare(body = {}) {
    const kind = String(body.kind ?? "tts")
    if (!["tts", "stt"].includes(kind)) throw httpError(400, "kind: tts or stt")
    if (!models) throw httpError(501, "no models folder here")
    const name = String(body.name ?? "")
    const exists = models.list(kind).some((m) => m.name === name)
    if (!exists) {
      if (!models.catalog(kind).some((c) => c.name === name)) throw httpError(404, `${kind}/${name}: not in the catalogue (${models.catalog(kind).map((c) => c.name).join(", ")}) — the owner adds other models (the add-model skill)`)
      models.add(kind, name)
    }
    const m = models.get(kind, name)
    const r = models.ready(m)
    if (r.ready) return { model: name, added: !exists, ready: true, installing: false, missing: [], note: "ready — its weights download on the first audio (a minute or two), then it is fast" }
    if (!install) throw httpError(501, `${name} is not installed and nothing here installs it: ${m.install ?? "see its model.md"}`)
    const started = await install(m)
    return { model: name, added: !exists, ready: false, installing: true, missing: r.missing, note: started.running ? "already installing — audio.models shows when it is ready" : "installing now (uv) — audio.models shows when it is ready; the desk log says when it is done" }
  }

  // A voice style set from the owner's feedback: the registry checks it against its model and logs why in the file.
  function setStyle(body = {}) {
    if (!models?.setStyle) throw httpError(501, "no styles here")
    const why = String(body.why ?? "").trim()
    if (!why) throw httpError(400, "why: the owner's feedback this change carries out")
    const patchIn = {}
    for (const k of ["title", "about", "use", "model", "voice", "speed", "options", "writing"]) if (body[k] !== undefined) patchIn[k] = body[k]
    if (!Object.keys(patchIn).length) throw httpError(400, "nothing to change: model, voice, speed, options, about, use or writing")
    const st = models.setStyle(String(body.name ?? ""), patchIn, why)
    log(`audio: style ${st.name} set (${Object.keys(patchIn).join(", ")}) — ${why.slice(0, 120)}`)
    return { style: st }
  }

  const fileOf = (id, format, chapter) => {
    if (!ID.test(String(id ?? ""))) throw httpError(400, "id: an audio job id")
    if (chapter != null && chapter !== "" && !/^\d{1,4}$/.test(String(chapter))) throw httpError(400, "chapter: a number")
    const ext = format === "wav" ? "wav" : "m4a"
    const p = path(id, ext, chapter || null)
    if (!existsSync(p)) throw httpError(404, `no audio ${id}${chapter ? ` chapter ${chapter}` : ""}`)
    return new Response(Bun.file(p), { headers: { "content-type": ext === "wav" ? "audio/wav" : "audio/mp4", "cache-control": "max-age=31536000, immutable" } })
  }

  // the words spoken (directions removed): the whole, or one chapter
  const script = (id, chapter) => {
    const j = find(id)
    const chapters = parseScript(readFileSync(path(j.id, "txt"), "utf8"), { style: j.style })
    if (chapter == null || chapter === "") return { text: chapters.map((c) => c.text).join("\n\n") }
    const c = chapters.find((x) => x.n === Number(chapter))
    if (!c) throw httpError(404, `${j.id} has no chapter ${chapter}`)
    return { text: c.text, title: c.title }
  }

  // The models and styles an agent may write for: each tts model's script hint (how to format the text), voices and
  // options; each style's voice and writing guide; the catalogue entries not added yet (audio.prepare adds one).
  const modelsBrief = () => {
    if (!models) return {}
    const brief = (m) => ({
      name: m.name,
      title: m.title,
      engine: m.engine,
      ready: models.ready(m).ready,
      missing: models.ready(m).missing,
      about: m.about ?? "",
      script: m.meta?.script ? String(m.meta.script).trim() : null,
      voices: (m.options?.voice?.choices ?? []).map(String),
      options: Object.fromEntries(Object.entries(m.options ?? {}).filter(([k]) => k !== "voice").map(([k, o]) => [k, { type: o.type, default: o.default ?? null, min: o.min ?? null, max: o.max ?? null, choices: o.choices ?? null, about: o.about ?? "" }])),
    })
    const addable = (kind) => models.catalog(kind).filter((c) => !c.added).map((c) => ({ name: c.name, title: c.title, about: c.about }))
    return {
      tts: models.selected("tts")?.name ?? null,
      stt: models.selected("stt")?.name ?? null,
      models: { tts: models.list("tts").filter((m) => m.ok).map(brief), stt: models.list("stt").filter((m) => m.ok).map(brief) },
      catalog: { tts: addable("tts"), stt: addable("stt") },
      styles: styles(),
    }
  }
  const styles = () => (models?.styles ? models.styles().map(({ file: _file, ...s }) => s) : [])

  return {
    make,
    prepare,
    setStyle,
    transcribe,
    send,
    stop,
    remove,
    file: fileOf,
    script,
    styles: () => ({ styles: styles() }),
    jobs: () => ({ jobs: jobs.map(view), running: current, queued: jobs.filter((j) => j.status === "queued").length, ...modelsBrief() }),
    job: (id) => ({ job: view(find(id)) }),
    close: () => {
      closed = true
      abort?.abort()
    },
  }
}

// WAV → AAC in an .m4a (afconvert ships with macOS): small enough for Telegram, and it plays in every browser. Variable
// bitrate at top quality (-s 3 -q 127): a fixed 96 kb/s is refused for 24 kHz mono (Chatterbox, Kokoro).
async function defaultConvert(wav, m4a) {
  const proc = Bun.spawn(["/usr/bin/afconvert", "-f", "m4af", "-d", "aac", "-s", "3", "-q", "127", wav, m4a], { stdout: "ignore", stderr: "pipe", timeout: 600_000 })
  if ((await proc.exited) !== 0) throw new Error(`afconvert: ${(await new Response(proc.stderr).text()).trim().slice(-200)}`)
}
// a part at another rate or width (say writes 22.05 kHz) → RATE mono 16-bit, so every part joins
async function defaultResample(input, output) {
  const proc = Bun.spawn(["/usr/bin/afconvert", "-f", "WAVE", "-d", `LEI16@${RATE}`, "-c", "1", input, output], { stdout: "ignore", stderr: "pipe", timeout: 300_000 })
  if ((await proc.exited) !== 0) throw new Error(`afconvert (resample): ${(await new Response(proc.stderr).text()).trim().slice(-200)}`)
}

export const audioRoutes = (audio) => ({
  GET: {
    "audio/jobs": () => audio.jobs(),
    "audio/job": (params) => audio.job(params.get("id")),
    "audio/file": (params) => audio.file(params.get("id"), params.get("format"), params.get("chapter")),
    "audio/script": (params) => audio.script(params.get("id"), params.get("chapter")),
    "audio/styles": () => audio.styles(),
  },
  POST: {
    "audio/make": (body) => audio.make(body),
    "audio/prepare": (body) => audio.prepare(body),
    "audio/style": (body) => audio.setStyle(body),
    "audio/transcribe": (body) => audio.transcribe(body),
    "audio/send": (body) => audio.send(body),
    "audio/stop": (body) => audio.stop(body),
    "audio/delete": (body) => audio.remove(body),
  },
})
