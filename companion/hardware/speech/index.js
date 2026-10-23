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
import { join } from "node:path"
import { HttpError } from "../../shared/http.js"
import { HOST_LIMITS } from "../../shared/config.js"
import { ensureServer, sharedModels } from "../../models/index.js"
import { buildArgv, effective } from "../../models/registry.js"

const SOURCE = join(import.meta.dir, "asr.swift")
const BIN_DIR = join(homedir(), ".askk", "bin")
const SAMPLE_RATE = 16000
const MAX_SECONDS = HOST_LIMITS.speech.maxUtteranceSeconds // per utterance
const MAX_SAY_CHARS = HOST_LIMITS.speech.sayChars
const TIMEOUT = HOST_LIMITS.speech.timeoutMs

const SpeechError = HttpError

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
    const started = performance.now()
    await Bun.write(file, wav(pcm))
    try {
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
      return { text: String(text ?? "").trim(), seconds: pcm.length / (SAMPLE_RATE * 2), ms: Math.round(performance.now() - started), model: m.name }
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
    const m = modelFor("tts", model)
    const opts = effective(m)
    text = text.slice(0, MAX_SAY_CHARS)
    const out = await tempFile(`s${++seq}.wav`)
    try {
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
        const proc = Bun.spawn(args, { stdin: new Blob([text]), stdout: "ignore", stderr: "pipe", timeout: TIMEOUT })
        if ((await proc.exited) !== 0) throw await fail(proc, "say")
        return { audio: (await Bun.file(out).bytes()).toBase64(), type: "audio/wav", model: m.name }
      }
      const speed = rate ? Math.round((Number(rate) / 190) * 100) / 100 : opts.speed
      const name = voice && (m.options.voice?.choices ?? []).map(String).includes(voice) ? voice : opts.voice
      if (m.engine === "openai") {
        const url = await ensureServer(m, { log })
        const r = await fetch(`${url.replace(/\/$/, "")}/audio/speech`, {
          method: "POST",
          headers: { "content-type": "application/json", ...keyHeader(m) },
          body: JSON.stringify({ model: m.meta.model, input: text, ...(name ? { voice: name } : {}), ...(speed ? { speed } : {}), response_format: "wav" }),
          signal: AbortSignal.timeout(callMs(m)),
        })
        if (!r.ok) throw new SpeechError(502, `${m.title}: ${r.status} ${(await r.text()).slice(0, 200)}`)
        return { audio: new Uint8Array(await r.arrayBuffer()).toBase64(), type: r.headers.get("content-type")?.split(";")[0] || "audio/wav", model: m.name }
      }
      const proc = Bun.spawn(buildArgv(m, Object.keys(m.modes)[0], { text, out, voice: name, speed }), { stdout: "ignore", stderr: "pipe", timeout: callMs(m), env: { ...process.env, PYTHONWARNINGS: "ignore" } })
      if ((await proc.exited) !== 0) throw await fail(proc, m.title)
      return { audio: (await Bun.file(out).bytes()).toBase64(), type: "audio/wav", model: m.name }
    } finally {
      Bun.file(out).delete().catch(() => {})
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

  return { recognizes, voices, status, transcribe, speak, dispose }
}
