import { Artifact } from "../artifact/artifact.js"
import { clip, oneLine } from "../util/text.js"

// Audio (2026-10-24 owner: "I want an audio generation pipeline such that, even the lead is able to use TTS model to
// create audio files. So the audio transcription can be a tool as well … It can be a story, talk, class, explanation or
// a narrative. Based on the TTS models capabilities, the model input format should be hinted as well. That way, the desk
// should be capable of downloading the model, and making a transcribe. The telegram personal chat will be the default
// channel"): the desk's audio files, made on this Mac's speech models through the host (audio/* —
// companion/capabilities/audiogen.js; the models in models/tts and models/stt, each run as a command per call). Id
// `audio`, view and kind `audio`, keep `always`, poll 3 s (a job's progress while a tab is on the stream).
//
// Commands (the table below has their inputs): models, prepare, make (a script or a workspace file → a queued audio id),
// wait, transcribe (for an id, how much of its script was heard), send (the file or one chapter to the owner's Telegram),
// styles, style (set from the owner's feedback), samples (one passage in each style, sent to compare).
//
// Long pieces (2026-10-24 owner: "something that can be long as well … the background story, the prelude story and the
// narrative story. With expressiveness"): a script holds [chapter: title] and [style: name] lines, each alone on its line;
// each chapter is its own file, ready (and sent, with send: true) as soon as it is made — the piece streams out.
//
// The owner (team/call {target: "artifact", method, args: [{id, …}]}): make [{id, text, title?, model?, voice?}], send
// [{id, audio}], transcribe [{id, audio}], stop [{id, audio}], delete [{id, audio}].
// State {jobs: [host job twins: … parts {done, total}, chapters [{n, title, chars, styles, status, seconds, url, heard,
// sent}]] ≤ 30, tts, stt, models: {tts: [{name, title, ready, missing, about, voices, options, script}], stt: [...]},
// catalog: {tts, stt}, styles: [{name, title, about, use, model, voice, speed, options, writing, changes}],
// transcripts: [{of, chapter, text, model, seconds, match, by, at}] ≤ 12, revision}.

const JOBS = 30
const TRANSCRIPTS = 12
const LIVE = new Set(["queued", "running"])
// a number however it is written — "eighteen fifty-seven" in a script, "1857" in a transcript — is one token "#"
const NUMBER = /^(\d[\d,.]*(st|nd|rd|th|s)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|point|and)$/
// A word: letters and digits of any script — built at run time, since an engine without Unicode property escapes
// (StarlingMonkey in a WebAssembly component, docs/portability.md §5) rejects the literal while parsing the module;
// there it falls back to Latin letters, digits and every non-ASCII letter range.
const WORD = (() => {
  try {
    return new RegExp("[\\p{L}\\p{N}']+", "gu")
  } catch {
    return /[A-Za-z0-9À-ɏͰ-῿Ⰰ-￯']+/g
  }
})()
const words = (s) => {
  const raw = String(s ?? "")
    .toLowerCase()
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .match(WORD) ?? []
  const out = []
  for (const w of raw) {
    // "and" counts as part of a number only between number words ("one hundred and five")
    const num = NUMBER.test(w) && (w !== "and" || out.at(-1) === "#")
    if (num && out.at(-1) === "#") continue
    out.push(num ? "#" : w)
  }
  return out
}

// How much of a script a transcript heard: the share of the script's words found in order (a longest common
// subsequence over words) — 1 when every word was heard; low when the audio skipped, garbled or misread the script.
export function heardShare(script, heard) {
  const a = words(script)
  const b = words(heard)
  if (!a.length) return null
  const n = b.length
  let prev = new Array(n + 1).fill(0)
  for (const w of a) {
    const row = new Array(n + 1).fill(0)
    for (let j = 1; j <= n; j++) row[j] = w === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    prev = row
  }
  return Math.round((prev[n] / a.length) * 100) / 100
}

// options for one file: {name: value} or "name: value" lines
function optionsOf(raw) {
  if (raw == null || raw === "") return {}
  if (typeof raw === "object" && !Array.isArray(raw)) return raw
  const out = {}
  for (const line of String(raw).split(/[\n,;]/)) {
    const m = line.match(/^\s*([a-z][a-z0-9_]*)\s*[:=]\s*(.+?)\s*$/)
    if (m) out[m[1]] = /^-?\d+(\.\d+)?$/.test(m[2]) ? Number(m[2]) : m[2]
  }
  return out
}

export class Audio extends Artifact {
  static about = "scripts voiced on this Mac's speech models, files transcribed back, sent to the owner's Telegram"
  static commands = {
    models: { description: "the speech models: in use, installed, voices, options, and how to write a script for each (its SCRIPT FORMAT)", input: {} },
    prepare: { description: "get a catalogue speech model onto this Mac: added and installed (its weights download on first use)", input: { model: "its name (audio.models lists the catalogue)", kind: "tts or stt (default: found from the name)" } },
    make: { description: "make an audio file from a script — [chapter: title] and [style: name] lines make a long, multi-voice piece that streams out chapter by chapter; unstyled text uses the model given, in its SCRIPT FORMAT", input: { text: "the script, as it should be spoken", file: "or a workspace path holding the script (a long one)", title: "what it is (names the file and the Telegram posts)", model: "a tts model for unstyled text (default: the one in use)", voice: "one of its voices", speed: "0.5–2", options: "that model's options for unstyled text, e.g. exaggeration: 0.8", style: "the style for text before any [style:] line", send: "true: each chapter to the owner's Telegram chat as soon as it is made" } },
    wait: { description: "wait until audio files are made", input: { ids: "audio ids, comma-separated (default: yours still running)", seconds: "at most (default 900)" } },
    transcribe: { description: "an audio file to text on the speech-to-text model; for a file made here, how much of its script was heard", input: { id: "an audio id made here", chapter: "one chapter of it (a number)", path: "or a workspace audio file (wav, m4a, mp3 …)", model: "an stt model (default: the one in use)" } },
    send: { description: "send a finished audio file, or one chapter of it, to the owner's personal Telegram chat", input: { id: "the audio id", chapter: "one chapter (a number; default the whole)", caption: "a line about it (default: its title and length)" } },
    styles: { description: "the voice styles: how each is voiced and its WRITING guide — read it before writing a styled script", input: {} },
    style: { description: "set a voice style from the owner's feedback (their words in why)", input: { name: "the style", model: "a tts model", voice: "one of its voices", speed: "0.5–2", options: "its options, e.g. exaggeration: 0.9", about: "what it is", use: "when to use it", writing: "its writing guide, whole (replaces it)", why: "the owner's feedback, in their words" } },
    samples: { description: "the same short passage voiced in each style (a chapter each), sent to the owner to compare — then audio.style from their feedback", input: { text: "two to four sentences", styles: "style names, comma-separated (default: all)", title: "what they are samples of", send: "default true" } },
  }
  static owner = {
    async make(a, from) { return { result: await this.make({ ...a, title: a.title || clip(oneLine(a.text), 60) }, { by: from }) } },
    async send(a) { return { result: await this.send({ id: a.audio, chapter: a.chapter }, {}) } },
    async transcribe(a) { return { result: await this.transcribe({ id: a.audio, path: a.path }, {}) } },
    async stop(a) { const j = this.#job(a.audio); const r = await this.#hostOf({}).post("audio/stop", { id: j.id }); await this.refresh(null); return { audio: j.id, status: r.job?.status } },
    async delete(a) { const j = this.#job(a.audio); const r = await this.#hostOf({}).post("audio/delete", { id: j.id }); this.bump({ jobs: this.state.jobs.filter((x) => x.id !== j.id) }); await this.refresh(null); return { deleted: r.deleted } },
  }
  static ownerCan = "make, send, transcribe, stop or delete"
  constructor({ id = "audio", title, clock = () => new Date(), waitMs = 2000 } = {}) {
    super({ name: id, title: title ?? (id === "audio" ? "audio — scripts made into audio files, files transcribed" : `${id} — audio`) })
    Object.assign(this, { kind: "audio", view: "audio", keep: "always" })
    this.poll = 3000
    Object.assign(this, { clock, waitMs })
    this.host = null // a holder's host (the owner's calls have no agent)
    this.state = { jobs: [], tts: null, stt: null, models: { tts: [], stt: [] }, catalog: { tts: [], stt: [] }, styles: [], transcripts: [], revision: 0 }
  }

  #hostOf(ctx) {
    const host = ctx?.host ?? ctx?.agent?.context?.host ?? this.host
    if (!host?.post) throw new Error("no audio host here: start the desk server on a Mac (capability audio)")
    return host
  }
  #job(id) {
    const j = this.state.jobs.find((x) => x.id === oneLine(id))
    if (!j) throw new Error(`no audio ${id}${this.state.jobs.length ? ` (latest: ${this.state.jobs.slice(0, 3).map((x) => x.id).join(", ")})` : ""}`)
    return j
  }
  #model(name) {
    return this.state.models.tts.find((m) => m.name === name) ?? null
  }

  attach(agent) {
    this.host ??= agent?.context?.host ?? null
  }

  snapshot() {
    return { ...this.state }
  }
  restore(data) {
    if (!data || !Array.isArray(data.jobs)) return
    this.state = { tts: null, stt: null, models: { tts: [], stt: [] }, catalog: { tts: [], stt: [] }, styles: [], transcripts: [], ...data, jobs: data.jobs.slice(0, JOBS), revision: 0 }
  }

  // The host's jobs and models, read before each step and while a tab watches.
  async refresh(agent) {
    this.host ??= agent?.context?.host ?? null
    const host = agent?.context?.host ?? this.host
    if (!host?.get) return
    let read
    try {
      read = (await host.get("audio/jobs")) ?? {}
    } catch {
      return
    }
    const slim = (m) => ({ name: m.name, title: m.title, ready: !!m.ready, missing: m.missing ?? [], about: m.about ?? "", voices: m.voices ?? [], options: m.options ?? {}, script: m.script ?? null })
    const next = {
      jobs: (read.jobs ?? []).slice(0, JOBS).map((j) => ({ id: j.id, title: j.title, chars: j.chars, head: j.head, model: j.model, voice: j.voice, speed: j.speed, options: j.options, style: j.style ?? null, styles: j.styles ?? [], send: !!j.send, by: j.by, status: j.status, parts: j.parts ?? null, chapters: (j.chapters ?? []).map((c) => ({ n: c.n, title: c.title, chars: c.chars, styles: c.styles ?? [], status: c.status, seconds: c.seconds, url: c.url, error: c.error, heard: c.heard ? { model: c.heard.model, at: c.heard.at } : null, sent: c.sent ?? [] })), at: j.at, ms: j.ms, seconds: j.seconds, bytes: j.bytes, error: j.error, url: j.url, heard: j.heard ? { model: j.heard.model, at: j.heard.at, head: clip(j.heard.text, 300) } : null, sent: j.sent ?? [] })),
      tts: read.tts ?? null,
      stt: read.stt ?? null,
      models: { tts: (read.models?.tts ?? []).map(slim), stt: (read.models?.stt ?? []).map(slim) },
      catalog: read.catalog ?? { tts: [], stt: [] },
      styles: (read.styles ?? []).map((st) => ({ name: st.name, title: st.title, about: st.about ?? "", use: st.use ?? "", model: st.model ?? null, voice: st.voice ?? null, speed: st.speed ?? null, options: st.options ?? {}, writing: st.writing ?? "", changes: st.changes ?? [], ok: st.ok !== false, problem: st.problem ?? null })),
    }
    if (JSON.stringify(next) !== JSON.stringify({ jobs: this.state.jobs, tts: this.state.tts, stt: this.state.stt, models: this.state.models, catalog: this.state.catalog, styles: this.state.styles })) this.bump(next)
  }

  // ---- the agents ----

  models() {
    const s = this.state
    if (!s.models.tts.length && !s.models.stt.length) return "no speech models read yet (the audio host answers on the next step)"
    const out = [`TEXT TO SPEECH (in use: ${s.tts ?? "none"})`]
    for (const m of s.models.tts) {
      out.push(`- ${m.name} — ${m.title}: ${m.ready ? "ready" : `not installed (missing ${m.missing.join(", ")}) — ${this.name}.prepare {model: "${m.name}"}`}. ${m.about}`)
      if (m.voices.length) out.push(`  voices (${m.voices.length}): ${m.voices.join(", ")}`)
      const opts = Object.entries(m.options).map(([k, o]) => `${k} (${o.type}${o.min != null ? ` ${o.min}–${o.max}` : ""}, default ${JSON.stringify(o.default)}${o.choices ? `: ${o.choices.slice(0, 8).join("|")}${o.choices.length > 8 ? "…" : ""}` : ""}) — ${o.about}`)
      if (opts.length) out.push(`  options: ${opts.join("; ")}`)
      if (m.script) out.push(`  SCRIPT FORMAT: ${oneLine(m.script)}`)
    }
    out.push(`SPEECH TO TEXT (in use: ${s.stt ?? "none"}): ${s.models.stt.map((m) => `${m.name}${m.ready ? "" : " (not installed)"}`).join(", ")}`)
    const more = [...s.catalog.tts.map((c) => `tts ${c.name}`), ...s.catalog.stt.map((c) => `stt ${c.name}`)]
    if (more.length) out.push(`IN THE CATALOGUE, NOT ON THIS MAC YET (${this.name}.prepare {model, kind}): ${more.join(", ")}`)
    return out.join("\n")
  }

  async prepare(input = {}, ctx = {}) {
    const name = oneLine(input.model ?? input.name)
    if (!name) throw new Error("model: a catalogue model's name (audio.models lists them)")
    const kind = oneLine(input.kind) || (this.state.models.stt.some((m) => m.name === name) || this.state.catalog.stt.some((c) => c.name === name) ? "stt" : "tts")
    const r = await this.#hostOf(ctx).post("audio/prepare", { kind, name })
    await this.refresh(ctx.agent ?? null)
    return `${kind}/${r.model}: ${r.ready ? "ready" : `installing (missing ${r.missing.join(", ")})`}${r.added ? " — added from the catalogue" : ""}. ${r.note}`
  }

  async make(input = {}, ctx = {}) {
    const host = this.#hostOf(ctx)
    let text = String(input.text ?? input.script ?? "").trim()
    if (!text && input.file) {
      const read = await host.get(`fs/read?path=${encodeURIComponent(oneLine(input.file))}`)
      if (read?.truncated) throw new Error(`${input.file} is too long to read whole — split the script into parts`)
      text = String(read?.text ?? "").trim()
    }
    if (!text) throw new Error("text: the script (or file: a workspace path holding it)")
    const title = clip(oneLine(input.title), 120)
    if (!title) throw new Error("title: what the audio is (it names the file and the Telegram post)")
    const model = oneLine(input.model) || null
    const m = this.#model(model ?? this.state.tts)
    if (m && !m.ready) throw new Error(`${m.name} is not installed: ${this.name}.prepare {model: "${m.name}"} first`)
    const send = input.send === true || /^(true|yes|1)$/i.test(String(input.send ?? ""))
    const { job } = await host.post("audio/make", { text, title, model, voice: oneLine(input.voice) || null, speed: input.speed ?? null, options: optionsOf(input.options), style: oneLine(input.style) || null, send, by: ctx.agent?.name ?? ctx.by ?? "owner" })
    await this.refresh(ctx.agent ?? null)
    const many = job.chapters?.length > 1
    return `queued ${job.id}: "${job.title}"${many ? ` — ${job.chapters.length} chapters, ${job.parts.total} parts${job.styles?.length ? ` in ${job.styles.join(", ")}` : ""}` : ` on ${job.model}${job.voice ? `, voice ${job.voice}` : ""}`} (${job.chars} chars)${send ? ` — ${many ? "each chapter goes" : "it goes"} to the owner's Telegram chat as soon as it is made` : ""} — ${this.name}.wait, then ${this.name}.transcribe {id: "${job.id}"${many ? ", chapter: n" : ""}} to check it says the script${send ? "" : `, then ${this.name}.send`}`
  }

  async wait(input = {}, ctx = {}) {
    const by = ctx.agent?.name
    const ids = input.ids ? String(input.ids).split(/[\s,]+/).filter(Boolean) : this.state.jobs.filter((j) => LIVE.has(j.status) && j.by === by).map((j) => j.id)
    if (!ids.length) return "nothing of yours is running"
    ids.forEach((id) => this.#job(id))
    const until = Date.now() + Math.max(5, Math.min(1800, Number(input.seconds ?? 900))) * 1000
    while (Date.now() < until && !ctx.signal?.aborted) {
      await this.refresh(ctx.agent ?? null)
      if (ids.every((id) => !LIVE.has(this.#job(id).status))) break
      await new Promise((r) => setTimeout(r, this.waitMs))
    }
    return ids
      .map((id) => {
        const j = this.#job(id)
        const chapters = (j.chapters?.length ?? 0) > 1 ? ` · chapters ${j.chapters.map((c) => `${c.n} ${c.status}${c.seconds ? ` ${Math.round(c.seconds)} s` : ""}`).join(", ")}` : ""
        return `${id}: ${j.status}${j.parts && j.status === "running" ? ` (${j.parts.done}/${j.parts.total} parts)` : ""}${j.seconds ? ` — ${Math.round(j.seconds)} s of audio` : ""}${j.ms ? ` in ${Math.round(j.ms / 1000)} s` : ""}${chapters}${j.error ? ` — ${clip(j.error, 300)}` : ""}`
      })
      .join("\n")
  }

  async transcribe(input = {}, ctx = {}) {
    const host = this.#hostOf(ctx)
    const id = oneLine(input.id ?? input.audio) || null
    const path = oneLine(input.path ?? input.file) || null
    if (!id && !path) throw new Error("id (an audio file made here) or path (a workspace audio file)")
    const chapter = input.chapter != null && input.chapter !== "" ? Number(input.chapter) : null
    const heard = await host.post("audio/transcribe", { ...(id ? { id, ...(chapter ? { chapter } : {}) } : { path }), model: oneLine(input.model) || null, by: ctx.agent?.name ?? "owner" })
    let match = null
    if (id) {
      const { text } = await host.get(`audio/script?id=${encodeURIComponent(id)}${chapter ? `&chapter=${chapter}` : ""}`)
      match = heardShare(text, heard.text)
    }
    const t = { of: id ?? path, chapter, text: clip(heard.text, 4000), model: heard.model, seconds: heard.seconds ?? null, match, by: ctx.agent?.name ?? "owner", at: this.clock().toISOString() }
    this.bump({ transcripts: [t, ...this.state.transcripts].slice(0, TRANSCRIPTS) })
    await this.refresh(ctx.agent ?? null)
    const verdict = match == null ? "" : `\nHEARD ${Math.round(match * 100)}% of the script's words, in order${match < 0.9 ? " — below 90%: find what it skipped or misread (numbers, names, symbols), write those as spoken, and make it again" : ""}`
    return `${heard.model}, ${Math.round(heard.seconds ?? 0)} s:\n${clip(heard.text, 6000)}${verdict}`
  }

  async send(input = {}, ctx = {}) {
    const j = this.#job(input.id ?? input.audio)
    const chapter = input.chapter != null && input.chapter !== "" ? Number(input.chapter) : null
    const c = chapter ? j.chapters?.find((x) => x.n === chapter) : null
    if (chapter && !c) throw new Error(`${j.id} has no chapter ${chapter}`)
    if ((c ?? j).status !== "done") throw new Error(`${j.id}${c ? ` chapter ${chapter}` : ""} is ${(c ?? j).status}: send finished audio`)
    await this.#hostOf(ctx).post("audio/send", { id: j.id, ...(chapter ? { chapter } : {}), caption: clip(oneLine(input.caption), 1000) || null })
    await this.refresh(ctx.agent ?? null)
    return `${j.id}${c ? ` chapter ${chapter}` : ""} sent to the owner's Telegram chat`
  }

  styles() {
    const s = this.state
    if (!s.styles.length) return "no voice styles read yet (the audio host answers on the next step)"
    return [
      "VOICE STYLES — mark a part of a script with [style: name] on its own line; write that part by the style's WRITING guide:",
      ...s.styles.map((st) => `## ${st.name} — ${st.title}${st.ok ? "" : ` (BROKEN: ${st.problem})`}\nfor: ${st.use || st.about}\nvoice: ${st.model}${st.voice ? ` · ${st.voice}` : ""}${st.speed ? ` · speed ${st.speed}` : ""}${Object.keys(st.options).length ? ` · ${Object.entries(st.options).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}\nWRITING: ${oneLine(st.writing)}${st.changes.length ? `\nchanged: ${st.changes.slice(-2).join(" | ")}` : ""}`),
    ].join("\n\n")
  }

  async style(input = {}, ctx = {}) {
    const name = oneLine(input.name)
    if (!name) throw new Error("name: the style (audio.styles lists them)")
    const why = clip(oneLine(input.why), 300)
    if (!why) throw new Error("why: the owner's feedback this change carries out, in their words")
    const body = { name, why }
    for (const k of ["model", "voice", "about", "use", "writing"]) if (input[k] != null && input[k] !== "") body[k] = String(input[k])
    if (input.speed != null && input.speed !== "") body.speed = Number(input.speed)
    if (input.options != null && input.options !== "") body.options = optionsOf(input.options)
    const { style } = await this.#hostOf(ctx).post("audio/style", body)
    await this.refresh(ctx.agent ?? null)
    return `style ${style.name} set: ${style.model}${style.voice ? ` · ${style.voice}` : ""}${style.speed ? ` · speed ${style.speed}` : ""}${Object.keys(style.options ?? {}).length ? ` · ${Object.entries(style.options).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""} — every script part marked [style: ${style.name}] uses it from now on`
  }

  // The same passage in each style, a chapter per style, sent one by one: the owner listens and says which works.
  async samples(input = {}, ctx = {}) {
    const text = String(input.text ?? "").trim()
    if (!text) throw new Error("text: a short passage (two to four sentences) to hear in each style")
    if (text.length > 1200) throw new Error("text: keep a sample under 1200 chars — the owner compares voices, not stories")
    const names = (Array.isArray(input.styles) ? input.styles : String(input.styles ?? "").split(/[\s,]+/)).map(oneLine).filter(Boolean)
    const pick = names.length ? names : this.state.styles.filter((st) => st.ok).map((st) => st.name)
    if (!pick.length) throw new Error("no styles to sample (audio.styles)")
    const script = pick.map((n) => `[chapter: ${n}]\n[style: ${n}]\n${text}`).join("\n\n")
    return this.make({ text: script, title: clip(oneLine(input.title), 80) || "Style samples", send: input.send ?? true }, ctx)
  }

  // Holding an answer while its audio is made: a soft reason (gateRetries let it through).
  gate(agent) {
    const mine = this.state.jobs.filter((j) => LIVE.has(j.status) && j.by === agent?.name)
    return mine.length ? `${mine.length} of your audio files are still being made (${mine.map((j) => j.id).join(", ")}): ${this.name}.wait, transcribe, send` : null
  }

  brief() {
    const s = this.state
    const live = s.jobs.filter((j) => LIVE.has(j.status))
    const done = s.jobs.filter((j) => j.status === "done")
    return [`tts ${s.tts ?? "?"}`, `${done.length} file${done.length === 1 ? "" : "s"}`, live.length ? `${live.length} being made` : null, done[0] ? `latest ${clip(done[0].title, 40)}` : null].filter(Boolean).join(" · ")
  }

  render() {
    const s = this.state
    const out = [`audio files on this Mac's speech models (${this.name}.models / prepare / make / wait / transcribe / send): write the script in the model's SCRIPT FORMAT, make it, transcribe it back to check it says the script, send it to the owner's Telegram chat`]
    const tts = this.#model(s.tts)
    if (tts) {
      out.push(`TEXT TO SPEECH IN USE: ${tts.name} — ${tts.title}${tts.voices.length ? `; voices ${tts.voices.slice(0, 12).join(", ")}${tts.voices.length > 12 ? ` (+${tts.voices.length - 12})` : ""}` : ""}${Object.keys(tts.options).length ? `; options ${Object.keys(tts.options).join(", ")}` : ""}`)
      if (tts.script) out.push(`SCRIPT FORMAT (${tts.name}): ${oneLine(tts.script)}`)
    } else out.push(`TEXT TO SPEECH: ${s.tts ?? "none read yet"}`)
    const others = s.models.tts.filter((m) => m.name !== s.tts)
    if (others.length) out.push(`OTHER TTS: ${others.map((m) => `${m.name}${m.ready ? "" : " (not installed)"}`).join(", ")} — ${this.name}.models for each one's format and voices`)
    out.push(`SPEECH TO TEXT: ${s.stt ?? "none"}`)
    if (s.styles.length) {
      out.push(`LONG / MULTI-VOICE SCRIPTS: a line [chapter: title] starts a chapter (its own file, streamed out as soon as it is made); a line [style: name] voices what follows in that style until the next — each style has its own WRITING guide (${this.name}.styles); text in a styled part follows its style's model's SCRIPT FORMAT too`)
      out.push(`STYLES: ${s.styles.map((st) => `${st.name}${st.ok ? "" : " (broken)"} (${clip(st.use || st.about, 70)})`).join("; ")}`)
    }
    for (const j of s.jobs.slice(0, 8)) {
      const many = (j.chapters?.length ?? 0) > 1
      out.push(`  ${j.id} "${clip(j.title, 60)}" ${many ? `${j.chapters.length} chapters` : `${j.model}${j.voice ? `/${j.voice}` : ""}`} ${j.status}${j.status === "running" && j.parts ? ` ${j.parts.done}/${j.parts.total} parts` : ""}${j.seconds ? ` ${Math.round(j.seconds)} s` : ""}${j.heard ? " · transcribed" : ""}${j.sent?.length || j.chapters?.some((c) => c.sent?.length) ? " · sent" : ""}${j.error ? ` — ${clip(j.error, 160)}` : ""}`)
      if (many && j.status === "running") out.push(`    chapters: ${j.chapters.map((c) => `${c.n} ${c.status}`).join(", ")}`)
    }
    for (const t of s.transcripts.slice(0, 2)) out.push(`  heard ${t.of}${t.match != null ? ` (${Math.round(t.match * 100)}% of its script)` : ""}: ${clip(oneLine(t.text), 200)}`)
    return out.join("\n")
  }
}
