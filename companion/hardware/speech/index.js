// Speech on this Mac (hardware feature `speech`, host capability `speech`), through the model chosen in the models
// folder (companion/models: models/stt/<name>/model.md, models/tts/<name>/model.md — 2026-10-23 owner: "Every model can
// have the same pipeline for transcriptions, special model options like voice, or other metadata … whisper, qwen ASR,
// parakeet, granite … This also applies for the TTS"). One pipeline, an engine per model:
//
//   stt apple:   Apple's on-device SpeechAnalyzer (macOS 26+) through the askk-speech helper (asr.swift), compiled with
//                swiftc on first use into ~/.askk/bin (keyed by the source's hash) and kept running: one JSON line per
//                utterance. The default.
//   stt openai:  an OpenAI-compatible server (mlx-audio: Parakeet, Whisper, Qwen3-ASR, Granite …), started by the
//                helper and kept running: POST /audio/transcriptions with the utterance as a WAV.
//   stt command: a program per utterance (its args with {audio} {dir} {stem} {language} …), text from its stdout, a
//                JSON field or a file it writes.
//   tts say:     `say` renders text to WAV with any installed voice (Siri and premium voices included). The default.
//   tts openai:  POST /audio/speech {model, input, voice, speed} → WAV (mlx-audio: Kokoro, Qwen3-TTS, Chatterbox …).
//   tts command: a program with {text} {out} {voice} {speed} … that writes a WAV.
// The audio comes as PCM from any browser and never leaves the Mac (an openai url elsewhere is the owner's choice).
//
// Off with ASKK_SPEECH=off. Text for `say` goes on stdin, never as an argument; the helper gets a temp WAV path written
// by this module.

import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { HttpError } from "../../shared/http.js"
import { HOST_LIMITS } from "../../shared/config.js"
import { ensureServer, sharedModels } from "../../models/index.js"
import { buildArgv, checkValue, effective } from "../../models/registry.js"

const SOURCE = join(import.meta.dir, "asr.swift")
const BIN_DIR = join(homedir(), ".askk", "bin")
const SAMPLE_RATE = 16000
const MAX_SECONDS = HOST_LIMITS.speech.maxUtteranceSeconds // per utterance
const MAX_SAY_CHARS = HOST_LIMITS.speech.sayChars
const RENDER_CHARS = 60_000 // one audio file's script (a 40-minute talk)
const TIMEOUT = HOST_LIMITS.speech.timeoutMs

const SpeechError = HttpError

// A script cut for a model that loses its way on long input (model.md `split: paragraphs`; 2026-10-24 live run: Chatterbox
// given a whole story skipped a sentence, repeated one, invented a line and dropped the ending — the transcript check
// caught it): its paragraphs, each longer than `max` cut at sentence ends.
export function splitScript(text, max = 300) {
  const parts = []
  for (const para of String(text).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (para.length <= max) {
      parts.push(para)
      continue
    }
    let cur = ""
    for (const sentence of para.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) ?? [para]) {
      if (cur && (cur + sentence).length > max) {
        parts.push(cur.trim())
        cur = ""
      }
      cur += sentence
    }
    if (cur.trim()) parts.push(cur.trim())
  }
  return parts
}

// WAVs of one format → one WAV, `gap` seconds of silence between them (the pause of a paragraph break).
export function joinWavs(buffers, gap = 0.35) {
  const chunks = (b) => {
    const out = {}
    for (let at = 12; at + 8 <= b.length; ) {
      const id = b.toString("ascii", at, at + 4)
      const size = b.readUInt32LE(at + 4)
      out[id] = b.subarray(at + 8, Math.min(b.length, at + 8 + size))
      at += 8 + size + (size % 2)
    }
    return out
  }
  const parts = buffers.map((x) => chunks(Buffer.from(x)))
  const fmt = parts[0]?.["fmt "]
  if (!fmt) throw new SpeechError(500, "joining audio: no fmt chunk")
  const rate = fmt.readUInt32LE(4)
  const block = fmt.readUInt16LE(12)
  const silence = Buffer.alloc(Math.round(rate * gap) * block)
  const data = Buffer.concat(parts.flatMap((p, i) => (i ? [silence, p.data ?? Buffer.alloc(0)] : [p.data ?? Buffer.alloc(0)])))
  const head = Buffer.alloc(12)
  head.write("RIFF", 0)
  head.writeUInt32LE(4 + 8 + fmt.length + 8 + data.length, 4)
  head.write("WAVE", 8)
  const fmtHead = Buffer.alloc(8)
  fmtHead.write("fmt ", 0)
  fmtHead.writeUInt32LE(fmt.length, 4)
  const dataHead = Buffer.alloc(8)
  dataHead.write("data", 0)
  dataHead.writeUInt32LE(data.length, 4)
  return Buffer.concat([head, fmtHead, fmt, dataHead, data])
}

// engine openai: `lang_from_voice: true` sends the voice's first letter as lang_code (Kokoro: af_heart → a, bf_emma → b,
// ef_dora → e — its pronunciation follows it); the options that name a request `field`, with their values now (registry.js)
const fieldsOf = (m, opts) =>
  Object.fromEntries(Object.entries(m.options ?? {}).flatMap(([k, o]) => (o.field && opts[k] != null && opts[k] !== "" ? [[o.field, opts[k]]] : [])))

const macMajor = () => {
  try {
    return Number(Bun.spawnSync(["sw_vers", "-productVersion"]).stdout.toString().trim().split(".")[0]) || 0
  } catch {
    return 0
  }
}

// A 16 kHz mono 16-bit WAV around raw PCM.
function wav(pcm) {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export async function createSpeech({ env = process.env, log = () => {}, models = sharedModels({ log }) } = {}) {
  if (process.platform !== "darwin" || env.ASKK_SPEECH === "off") return null
  const say = Bun.which("say")
  const swiftc = Bun.which("swiftc")
  const recognizes = !!swiftc && macMajor() >= 26 && (await Bun.file(SOURCE).exists())

  let helper = null // { proc, pending: Map }
  let building = null
  let seq = 0
  let temp = null

  async function binary() {
    const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(SOURCE).bytes()).digest("hex").slice(0, 12)
    const path = join(BIN_DIR, `askk-speech-${hash}`)
    if (await Bun.file(path).exists()) return path
    building ??= (async () => {
      await mkdir(BIN_DIR, { recursive: true })
      log("speech: compiling the on-device recognizer (once)…")
      const out = `${path}.tmp-${process.pid}`
      const proc = Bun.spawn([swiftc, "-parse-as-library", "-O", SOURCE, "-o", out], { stdout: "pipe", stderr: "pipe" })
      if ((await proc.exited) !== 0) {
        throw new SpeechError(500, `Building the recognizer failed: ${(await new Response(proc.stderr).text()).slice(0, HOST_LIMITS.speech.buildErrorChars)}`)
      }
      Bun.spawnSync(["mv", "-f", out, path])
      return path
    })().finally(() => (building = null))
    return building
  }

  async function start() {
    if (helper && helper.proc.exitCode === null) return helper
    const proc = Bun.spawn([await binary()], { stdin: "pipe", stdout: "pipe", stderr: "ignore" })
    const current = { proc, pending: new Map() }
    helper = current
    ;(async () => {
      const decoder = new TextDecoder()
      let buffer = ""
      for await (const chunk of proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true })
        let at
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at)
          buffer = buffer.slice(at + 1)
          let answer
          try {
            answer = JSON.parse(line)
          } catch {
            continue
          }
          const waiter = current.pending.get(answer.id)
          if (waiter) {
            current.pending.delete(answer.id)
            waiter(answer)
          }
        }
      }
      for (const waiter of current.pending.values()) waiter({ error: "The recognizer stopped." })
      current.pending.clear()
      if (helper === current) helper = null
    })()
    return current
  }

  async function ask(request) {
    const { proc, pending } = await start()
    const id = `r${++seq}`
    const answer = new Promise((resolve) => {
      pending.set(id, resolve)
      setTimeout(() => pending.delete(id) && resolve({ error: "The recognizer took too long." }), TIMEOUT)
    })
    proc.stdin.write(`${JSON.stringify({ id, ...request })}\n`)
    proc.stdin.flush()
    const result = await answer
    if (result.error) throw new SpeechError(500, result.error)
    return result
  }

  // The model for a call: the one named, else the one chosen for its kind.
  function modelFor(kind, name) {
    const m = name ? models.get(kind, String(name)) : models.selected(kind)
    if (!m) throw new SpeechError(501, `No ${kind} model: add one in ${models.root}/${kind}/ (the voice settings' model panel).`)
    if (!m.ok) throw new SpeechError(500, `${kind}/${m.name}: ${m.problem}`)
    return m
  }
  const tempFile = async (name) => {
    temp ??= await mkdtemp(join(tmpdir(), "askk-speech-"))
    return join(temp, name)
  }
  const fail = async (proc, what) => new SpeechError(500, `${what} failed: ${(await new Response(proc.stderr).text()).replace(/\s+/g, " ").trim().slice(-300)}`)

  async function transcribe({ audio, locale, model }) {
    if (typeof audio !== "string" || !audio) throw new SpeechError(400, "Expected {audio: base64 16 kHz mono 16-bit PCM}.")
    const m = modelFor("stt", model)
    const opts = effective(m)
    locale ??= opts.locale ?? "en-US"
    if (typeof locale !== "string" || !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,4})*$/.test(locale)) throw new SpeechError(400, "Bad locale.")
    const pcm = Buffer.from(audio, "base64")
    if (pcm.length > SAMPLE_RATE * 2 * MAX_SECONDS) throw new SpeechError(413, `At most ${MAX_SECONDS} s per utterance.`)
    if (pcm.length < SAMPLE_RATE * 2 * HOST_LIMITS.speech.minUtteranceSeconds) return { text: "", seconds: 0, ms: 0, model: m.name }
    const stem = `u${++seq}`
    const file = await tempFile(`${stem}.wav`)
    await Bun.write(file, wav(pcm))
    try {
      return { ...(await recognize(file, m, locale, stem)), seconds: pcm.length / (SAMPLE_RATE * 2) }
    } finally {
      Bun.file(file).delete().catch(() => {})
    }
  }

  // A 16 kHz mono WAV → its text, on the model given (the voice bar's utterance, or an audio file: transcribeFile).
  async function recognize(file, m, locale, stem) {
    const opts = effective(m)
    const started = performance.now()
    {
      let text
      if (m.engine === "apple") {
        if (!recognizes) throw new SpeechError(501, "On-device recognition needs macOS 26 and the Xcode command line tools (swiftc).")
        text = (await ask({ path: file, locale })).text
      } else if (m.engine === "openai") {
        const url = await ensureServer(m, { log })
        const form = new FormData()
        form.append("file", new Blob([await Bun.file(file).bytes()], { type: "audio/wav" }), `${stem}.wav`)
        if (m.meta.model) form.append("model", m.meta.model)
        const language = opts.language ?? locale.split(/[-_]/)[0]
        if (language) form.append("language", language)
        for (const [k, v] of Object.entries(fieldsOf(m, opts))) form.set(k, String(v))
        const r = await fetch(`${url.replace(/\/$/, "")}/audio/transcriptions`, { method: "POST", body: form, headers: keyHeader(m), signal: AbortSignal.timeout(callMs(m)) })
        const body = await r.text()
        if (!r.ok) throw new SpeechError(502, `${m.title}: ${r.status} ${body.slice(0, 200)}`)
        try {
          text = JSON.parse(body).text ?? ""
        } catch {
          text = body
        }
      } else {
        const dir = await tempFile("")
        const argv = buildArgv(m, Object.keys(m.modes)[0], { audio: file, dir, stem, language: opts.language ?? locale.split(/[-_]/)[0], locale })
        const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", timeout: callMs(m), env: { ...process.env, PYTHONWARNINGS: "ignore" } })
        const out = await new Response(proc.stdout).text()
        if ((await proc.exited) !== 0) throw await fail(proc, m.title)
        const output = String(m.meta.output ?? "stdout")
        if (output.startsWith("json:")) text = JSON.parse(out)[output.slice(5)] ?? ""
        else if (output.startsWith("file:")) {
          const path = output.slice(5).replace(/\{(dir|stem)\}/g, (_, k) => (k === "dir" ? dir : stem))
          text = await Bun.file(path).text()
          Bun.file(path).delete().catch(() => {})
        } else text = out
      }
      return { text: String(text ?? "").trim(), ms: Math.round(performance.now() - started), model: m.name }
    }
  }

  // An audio file of any format macOS reads (wav, m4a, mp3, aiff, caf …) → its text (2026-10-24 owner: "the audio
  // transcription can be a tool as well"): converted to 16 kHz mono with afconvert, then the stt model.
  async function transcribeFile({ path, model, locale }) {
    if (typeof path !== "string" || !path) throw new SpeechError(400, "Expected {path: an audio file}.")
    if (!(await Bun.file(path).exists())) throw new SpeechError(404, `No audio file at ${path}.`)
    const m = modelFor("stt", model)
    locale ??= effective(m).locale ?? "en-US"
    const stem = `f${++seq}`
    const file = await tempFile(`${stem}.wav`)
    try {
      const conv = Bun.spawn(["/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", path, file], { stdout: "ignore", stderr: "pipe", timeout: 120_000 })
      if ((await conv.exited) !== 0) throw await fail(conv, "afconvert (reading the audio)")
      const seconds = Math.max(0, (Bun.file(file).size - 44) / (SAMPLE_RATE * 2))
      return { ...(await recognize(file, m, locale, stem)), seconds }
    } finally {
      Bun.file(file).delete().catch(() => {})
    }
  }
  // a model server's first call loads (or downloads) its weights: minutes, not seconds (model.md timeout_seconds)
  const callMs = (m) => (Number(m.meta.timeout_seconds) || (m.engine === "apple" || m.engine === "say" ? TIMEOUT / 1000 : 600)) * 1000
  // key_env: an API key's name (…_API_KEY) sent only over https or to this machine (audit 20: any .env secret to any url)
  const keyHeader = (m) => {
    const name = m.meta.key_env
    if (!name || !env[name]) return {}
    if (!/^[A-Z][A-Z0-9_]*_API_KEY$/.test(name)) throw new SpeechError(400, `${m.name}: key_env names an API key (…_API_KEY), not ${name}`)
    if (!/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/])/.test(m.meta.url)) throw new SpeechError(400, `${m.name}: a key goes only over https or to this machine`)
    return { authorization: `Bearer ${env[name]}` }
  }

  let voiceList = null
  const sayVoices = () => {
    voiceList ??= Bun.spawnSync([say, "-v", "?"])
      .stdout.toString()
      .split("\n")
      .map((line) => line.match(/^(.+?)\s{2,}([a-z]{2,3}_[A-Za-z0-9]+)\s+#/))
      .filter(Boolean)
      .map(([, name, lang]) => ({ name: name.trim(), lang: lang.replace("_", "-") }))
    return voiceList
  }
  // The voices of the chosen tts model: `say`'s, or its voice option's choices.
  function voices({ model } = {}) {
    let m
    try {
      m = modelFor("tts", model)
    } catch {
      return { voices: [], model: null }
    }
    if (m.engine === "say") return { voices: say ? sayVoices() : [], model: m.name }
    return { voices: (m.options.voice?.choices ?? []).map((name) => ({ name: String(name), lang: null })), model: m.name }
  }

  // {text, voice?, rate?, model?} → a WAV. voice and rate given by the call win over the model's values (rate: words
  // per minute for say, else speed = rate / 190).
  async function speak({ text, voice, rate, model }) {
    if (typeof text !== "string" || !text.trim()) throw new SpeechError(400, "Expected {text}.")
    const out = await tempFile(`s${++seq}.wav`)
    try {
      const r = await render({ text: text.slice(0, MAX_SAY_CHARS), voice, rate, model, out })
      return { audio: (await Bun.file(out).bytes()).toBase64(), type: "audio/wav", model: r.model }
    } finally {
      Bun.file(out).delete().catch(() => {})
    }
  }

  // Text → a WAV written at `out` (2026-10-24 owner: "even the lead is able to use TTS model to create audio files"):
  // the voice bar's line, or a whole script (≤ RENDER_CHARS) for an audio file. options: the model's option values for
  // this call only (Chatterbox's exaggeration …), checked as the panel's are.
  async function render({ text, voice, rate, model, options = {}, out, signal, whole = false }) {
    if (typeof text !== "string" || !text.trim()) throw new SpeechError(400, "Expected {text}.")
    if (text.length > RENDER_CHARS) throw new SpeechError(413, `At most ${RENDER_CHARS} chars per audio (split it).`)
    let m = modelFor("tts", model)
    const extra = {}
    for (const [k, v] of Object.entries(options ?? {})) {
      if (!m.options[k]) throw new SpeechError(400, `${m.name} has no option ${k} (it has ${Object.keys(m.options).join(", ") || "none"})`)
      if (v != null && v !== "") extra[k] = checkValue(m.options[k], v, k)
    }
    m = { ...m, values: { ...m.values, ...extra } }
    // a model that loses its way on long input: each paragraph its own call, joined with a pause
    if (m.meta.split === "paragraphs" && !whole) {
      const parts = splitScript(text, Number(m.meta.split_chars) || 300)
      if (parts.length > 1) {
        const files = []
        try {
          let made
          for (const [i, part] of parts.entries()) {
            if (signal?.aborted) throw new SpeechError(499, "stopped")
            const piece = out.replace(/\.wav$/, `-p${i + 1}.wav`)
            files.push(piece)
            made = await render({ text: part, voice, rate, model: m.name, options, out: piece, signal, whole: true })
          }
          await Bun.write(out, joinWavs(await Promise.all(files.map((f) => Bun.file(f).arrayBuffer()))))
          return { ...made, parts: parts.length }
        } finally {
          for (const f of files) Bun.file(f).delete().catch(() => {})
        }
      }
    }
    const opts = effective(m)
    {
      if (m.engine === "say") {
        if (!say) throw new SpeechError(501, "say is not available.")
        const args = [say, "--data-format=LEI16@22050"]
        const name = voice || opts.voice
        if (name) {
          if (!sayVoices().some((v) => v.name === name)) throw new SpeechError(400, `Unknown voice "${name}".`)
          args.push("-v", name)
        }
        const words = Number(rate) || Number(opts.rate)
        if (words) args.push("-r", String(Math.min(HOST_LIMITS.speech.sayRateMaxWpm, Math.max(HOST_LIMITS.speech.sayRateMinWpm, Math.round(words)))))
        args.push("-o", out)
        const proc = Bun.spawn(args, { stdin: new Blob([text]), stdout: "ignore", stderr: "pipe", timeout: callMs(m) * Math.max(1, Math.ceil(text.length / 2000)), signal })
        if ((await proc.exited) !== 0) throw await fail(proc, "say")
        return { model: m.name, voice: name || null }
      }
      const speed = rate ? Math.round((Number(rate) / 190) * 100) / 100 : opts.speed
      const name = voice && (m.options.voice?.choices ?? []).map(String).includes(voice) ? voice : opts.voice
      if (m.engine === "openai") {
        const url = await ensureServer(m, { log })
        const r = await fetch(`${url.replace(/\/$/, "")}/audio/speech`, {
          method: "POST",
          headers: { "content-type": "application/json", ...keyHeader(m) },
          body: JSON.stringify({ model: m.meta.model, input: text, ...(name ? { voice: name } : {}), ...(speed ? { speed } : {}), response_format: "wav", ...(m.meta.lang_from_voice && name ? { lang_code: String(name)[0] } : {}), ...fieldsOf(m, opts) }),
          signal: AbortSignal.timeout(callMs(m)),
        })
        if (!r.ok) throw new SpeechError(502, `${m.title}: ${r.status} ${(await r.text()).slice(0, 200)}`)
        await Bun.write(out, new Uint8Array(await r.arrayBuffer()))
        return { model: m.name, voice: name ?? null }
      }
      // a command per call (2026-10-24 owner: "Do not need to start audio as a separate live server"): the text on stdin
      // when the model.md says `stdin: text` (any length, never an argument), {dir}/{stem} for a program that names its
      // own output (mlx-audio: --output_path {dir} --file_prefix {stem} → {dir}/{stem}.wav), {lang} the voice's language
      const dir = dirname(out)
      const stem = basename(out).replace(/\.wav$/, "")
      const viaStdin = m.meta.stdin === "text"
      const lang = m.meta.lang_from_voice && name ? String(name)[0] : null
      const argv = buildArgv(m, Object.keys(m.modes)[0], { ...(viaStdin ? {} : { text }), out, dir, stem, voice: name, speed, lang })
      const proc = Bun.spawn(argv, { ...(viaStdin ? { stdin: new Blob([text]) } : {}), stdout: "ignore", stderr: "pipe", timeout: callMs(m) * Math.max(1, Math.ceil(text.length / 4000)), signal, env: { ...process.env, PYTHONWARNINGS: "ignore" } })
      if ((await proc.exited) !== 0) throw await fail(proc, m.title)
      if (!(await Bun.file(out).exists())) throw new SpeechError(500, `${m.title} wrote no audio at ${out}`)
      return { model: m.name, voice: name ?? null }
    }
  }

  // What this Mac offers; also builds and starts the recognizer so the first
  // utterance is fast.
  async function status() {
    const brief = (kind) => {
      const m = models.selected(kind)
      return m ? { name: m.name, title: m.title, engine: m.engine, ...models.ready(m) } : null
    }
    const stt = brief("stt")
    const tts = brief("tts")
    let ready = !!stt && stt.engine !== "apple" && stt.ready
    let error = stt ? null : `no stt model in ${models.root}/stt/`
    if (stt?.engine === "apple") {
      if (!recognizes) error = "On-device recognition needs macOS 26 and the Xcode command line tools (swiftc)."
      else
        try {
          ready = !!(await ask({ probe: true })).ok
        } catch (e) {
          error = e.message
        }
    }
    return { recognize: !!stt && (stt.engine !== "apple" || recognizes), ready, error, voice: !!tts && (tts.engine !== "say" || !!say), sampleRate: SAMPLE_RATE, stt, tts }
  }

  function dispose() {
    helper?.proc.kill()
    if (temp) rm(temp, { recursive: true, force: true }).catch(() => {})
  }

  // What this Mac offers for a model option's `choices_from` (models/registry.js): the locales Apple's recognizer
  // supports (its probe, read once) and the installed `say` voices — the panel's lists are these, never typed by hand.
  let locales = null
  async function optionChoices() {
    if (recognizes && !locales?.length)
      try {
        locales = ((await ask({ probe: true })).locales ?? []).filter((l) => typeof l === "string").sort()
      } catch (error) {
        log(`speech: locales not read: ${error.message}`)
      }
    return { "apple-locales": locales ?? [], "say-voices": say ? sayVoices().map((v) => v.name) : [] }
  }

  return { recognizes, voices, status, transcribe, transcribeFile, speak, render, optionChoices, dispose }
}
