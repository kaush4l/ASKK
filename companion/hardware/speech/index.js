// Speech on this Mac (hardware feature `speech`, host capability `speech`).
//
//   recognize: Apple's on-device SpeechAnalyzer (macOS 26+) through the
//              askk-speech helper (asr.swift), compiled with swiftc on first
//              use into ~/.askk/bin (keyed by the source's hash) and kept
//              running: one JSON line per utterance. Works from every
//              browser, since the audio comes as PCM and never leaves the Mac.
//   voice:     `say` renders text to WAV with any installed voice (Siri and
//              premium voices included); the page plays it.
//
// Off with ASKK_SPEECH=off. Text for `say` goes on stdin, never as an
// argument; the helper gets a temp WAV path written by this module.

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, "asr.swift")
const BIN_DIR = join(homedir(), ".askk", "bin")
const SAMPLE_RATE = 16000
const MAX_SECONDS = 60 // per utterance
const MAX_SAY_CHARS = 4000
const TIMEOUT = 30_000

class SpeechError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

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

export async function createSpeech({ env = process.env, log = () => {} } = {}) {
  if (process.platform !== "darwin" || env.ASKK_SPEECH === "off") return null
  const say = Bun.which("say")
  const swiftc = Bun.which("swiftc")
  const recognizes = !!swiftc && macMajor() >= 26 && existsSync(SOURCE)
  if (!say && !recognizes) return null

  let helper = null // { proc, pending: Map }
  let building = null
  let seq = 0
  let temp = null

  async function binary() {
    const hash = createHash("sha256").update(await readFile(SOURCE)).digest("hex").slice(0, 12)
    const path = join(BIN_DIR, `askk-speech-${hash}`)
    if (existsSync(path)) return path
    building ??= (async () => {
      await mkdir(BIN_DIR, { recursive: true })
      log("speech: compiling the on-device recognizer (once)…")
      const out = `${path}.tmp-${process.pid}`
      const proc = Bun.spawn([swiftc, "-parse-as-library", "-O", SOURCE, "-o", out], { stdout: "pipe", stderr: "pipe" })
      if ((await proc.exited) !== 0) {
        throw new SpeechError(500, `Building the recognizer failed: ${(await new Response(proc.stderr).text()).slice(0, 400)}`)
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

  async function transcribe({ audio, locale = "en-US" }) {
    if (!recognizes) throw new SpeechError(501, "On-device recognition needs macOS 26 and the Xcode command line tools (swiftc).")
    if (typeof audio !== "string" || !audio) throw new SpeechError(400, "Expected {audio: base64 16 kHz mono 16-bit PCM}.")
    if (typeof locale !== "string" || !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,4})*$/.test(locale)) throw new SpeechError(400, "Bad locale.")
    const pcm = Buffer.from(audio, "base64")
    if (pcm.length > SAMPLE_RATE * 2 * MAX_SECONDS) throw new SpeechError(413, `At most ${MAX_SECONDS} s per utterance.`)
    if (pcm.length < SAMPLE_RATE * 2 * 0.1) return { text: "", seconds: 0, ms: 0 }
    temp ??= await mkdtemp(join(tmpdir(), "askk-speech-"))
    const file = join(temp, `u${++seq}.wav`)
    const started = performance.now()
    await writeFile(file, wav(pcm))
    try {
      const { text } = await ask({ path: file, locale })
      return { text, seconds: pcm.length / (SAMPLE_RATE * 2), ms: Math.round(performance.now() - started) }
    } finally {
      rm(file, { force: true }).catch(() => {})
    }
  }

  let voiceList = null
  function voices() {
    if (!say) return { voices: [] }
    voiceList ??= Bun.spawnSync([say, "-v", "?"])
      .stdout.toString()
      .split("\n")
      .map((line) => line.match(/^(.+?)\s{2,}([a-z]{2,3}_[A-Za-z0-9]+)\s+#/))
      .filter(Boolean)
      .map(([, name, lang]) => ({ name: name.trim(), lang: lang.replace("_", "-") }))
    return { voices: voiceList }
  }

  async function speak({ text, voice, rate }) {
    if (!say) throw new SpeechError(501, "say is not available.")
    if (typeof text !== "string" || !text.trim()) throw new SpeechError(400, "Expected {text}.")
    const args = [say, "--data-format=LEI16@22050"]
    if (voice) {
      if (!voices().voices.some((v) => v.name === voice)) throw new SpeechError(400, `Unknown voice "${voice}".`)
      args.push("-v", voice)
    }
    const words = Number(rate)
    if (words) args.push("-r", String(Math.min(400, Math.max(90, Math.round(words)))))
    temp ??= await mkdtemp(join(tmpdir(), "askk-speech-"))
    const file = join(temp, `s${++seq}.wav`)
    args.push("-o", file)
    const proc = Bun.spawn(args, { stdin: new Blob([text.slice(0, MAX_SAY_CHARS)]), stdout: "ignore", stderr: "pipe" })
    const timer = setTimeout(() => proc.kill(), TIMEOUT)
    const code = await proc.exited
    clearTimeout(timer)
    try {
      if (code !== 0) throw new SpeechError(500, `say failed: ${(await new Response(proc.stderr).text()).slice(0, 200)}`)
      return { audio: (await readFile(file)).toString("base64"), type: "audio/wav" }
    } finally {
      rm(file, { force: true }).catch(() => {})
    }
  }

  // What this Mac offers; also builds and starts the recognizer so the first
  // utterance is fast.
  async function status() {
    let ready = false
    let error = null
    if (recognizes) {
      try {
        ready = !!(await ask({ probe: true })).ok
      } catch (e) {
        error = e.message
      }
    }
    return { recognize: recognizes, ready, error, voice: !!say, sampleRate: SAMPLE_RATE }
  }

  function dispose() {
    helper?.proc.kill()
    if (temp) rm(temp, { recursive: true, force: true }).catch(() => {})
  }

  return { recognizes, voices, status, transcribe, speak, dispose }
}
