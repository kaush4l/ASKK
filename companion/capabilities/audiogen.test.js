import { afterEach, beforeEach, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAudiogen, parseScript, wavSeconds } from "./audiogen.js"
import { loadModels } from "../models/registry.js"

let state
let models
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "askk-audio-"))
  models = loadModels({ root: join(state, "models"), which: (b) => (b.startsWith("mlx_audio") || b === "say" ? `/bin/${b}` : null) })
})
afterEach(() => rmSync(state, { recursive: true, force: true }))

// a WAV of `seconds` of silence at 24 kHz mono 16-bit
const wavOf = (seconds) => {
  const data = 24000 * 2 * seconds
  const b = Buffer.alloc(44 + data)
  b.write("RIFF", 0)
  b.writeUInt32LE(36 + data, 4)
  b.write("WAVEfmt ", 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(24000, 24)
  b.writeUInt32LE(48000, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write("data", 36)
  b.writeUInt32LE(data, 40)
  return b
}
const until = async (f) => {
  for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 5))
}

test("make: queued, rendered to a wav and an m4a, its length read; transcribe reads it back; send goes to the owner's chat", async () => {
  const rendered = []
  const speech = {
    render: async (call) => (rendered.push(call), await Bun.write(call.out, wavOf(2)), { model: call.model ?? "say", voice: call.voice ?? null }),
    transcribeFile: async ({ path }) => ({ text: `heard ${path.split("/").pop()}`, seconds: 2, ms: 5, model: "apple" }),
  }
  const sent = []
  const integrations = { get: (n) => (n === "telegram" ? { audio: { send: async (a) => sent.push(a) } } : null) }
  const files = { realPath: async (p) => (p === "notes/call.wav" ? join(state, "call.wav") : Promise.reject(new Error("Not found"))) }
  await Bun.write(join(state, "call.wav"), wavOf(1))
  const lines = []
  const audio = await createAudiogen({ state, speech, files, integrations, models, convert: async (a, b) => copyFileSync(a, b), log: (l) => lines.push(l) })
  expect(() => audio.make({ text: "" })).toThrow("text")
  expect(() => audio.make({ text: "hi", voice: "nobody", model: "kokoro" })).toThrow("voice: one of")
  expect(() => audio.make({ text: "hi", model: "kokoro", options: { nope: 1 } })).toThrow("options.nope")
  const { job } = audio.make({ text: "Once upon a time.\n\nThe end.", title: "The fox", model: "kokoro", voice: "bf_emma", speed: 0.9, options: { speed: 1 }, by: "lead" })
  expect(job).toMatchObject({ status: "queued", chars: 27, model: "kokoro", voice: "bf_emma", by: "lead" })
  await until(() => audio.job(job.id).job.status === "done")
  expect(audio.job(job.id).job).toMatchObject({ status: "done", seconds: 2, url: `/__askk/audio/file?id=${job.id}` })
  expect(rendered[0]).toMatchObject({ text: "Once upon a time.\n\nThe end.", model: "kokoro", voice: "bf_emma", options: { speed: 0.9 } })
  expect(audio.script(job.id).text).toBe("Once upon a time.\n\nThe end.")
  expect((await audio.file(job.id).arrayBuffer()).byteLength).toBe(44 + 96000)
  expect(await audio.transcribe({ id: job.id })).toMatchObject({ text: `heard ${job.id}.m4a` })
  expect(audio.job(job.id).job.heard.text).toBe(`heard ${job.id}.m4a`)
  expect((await audio.transcribe({ path: "notes/call.wav" })).text).toBe("heard call.wav")
  await expect(audio.transcribe({})).rejects.toThrow("id (an audio job)")
  expect(await audio.send({ id: job.id })).toMatchObject({ sent: { to: "owner" } })
  expect(sent[0]).toMatchObject({ title: "The fox", caption: "The fox · 2 s", to: "owner", path: join(state, "audio", `${job.id}.m4a`) })
  expect(audio.jobs()).toMatchObject({ tts: "say", stt: "apple", models: { tts: expect.arrayContaining([expect.objectContaining({ name: "kokoro", script: expect.stringContaining("Punctuation is the only control") })]) } })
  expect(audio.remove({ id: job.id })).toEqual({ deleted: [job.id] })
  await until(() => !existsSync(join(state, "audio", `${job.id}.wav`)))
  expect(existsSync(join(state, "audio", `${job.id}.wav`))).toBe(false)
  expect(lines.some((l) => l.includes("sent to Telegram"))).toBe(true)
})

test("a stopped job ends; a failed render keeps its reason; a restart marks unfinished jobs interrupted; no bot → 501", async () => {
  let release
  const speech = {
    render: async (call) => {
      if (call.text === "fail") throw new Error("Kokoro failed: out of memory")
      await new Promise((r) => {
        release = r
        call.signal?.addEventListener("abort", r)
      })
      await Bun.write(call.out, wavOf(1))
      return { model: "say" }
    },
    transcribeFile: async () => ({ text: "" }),
  }
  const audio = await createAudiogen({ state, speech, models, convert: async (a, b) => copyFileSync(a, b) })
  const a = audio.make({ text: "long one" }).job
  const b = audio.make({ text: "fail" }).job
  await until(() => audio.job(a.id).job.status === "running")
  expect(audio.stop({ id: a.id }).job.status).toBe("stopped")
  await until(() => audio.job(b.id).job.status === "failed")
  expect(audio.job(b.id).job.error).toContain("out of memory")
  const c = audio.make({ text: "left running" }).job
  await until(() => audio.job(c.id).job.status === "running")
  const again = await createAudiogen({ state, speech, models, convert: async () => {} })
  expect(again.job(c.id).job.status).toBe("interrupted")
  release()
  await expect(again.send({ id: b.id })).rejects.toThrow("not audio yet")
  expect(wavSeconds(wavOf(3))).toBe(3)
  expect(await createAudiogen({ state, speech: null })).toBeNull()
})

test("prepare: a catalogue model added and installed for the desk; anything else refused", async () => {
  const installs = []
  const audio = await createAudiogen({ state, speech: { render: async () => ({}) }, models, install: async (m) => (installs.push(m.name), { started: true }) })
  expect(await audio.prepare({ kind: "stt", name: "whisper-turbo" })).toMatchObject({ model: "whisper-turbo", added: true, ready: true })
  await expect(audio.prepare({ kind: "tts", name: "my-own" })).rejects.toThrow("not in the catalogue")
  await expect(audio.prepare({ kind: "image", name: "x" })).rejects.toThrow("kind: tts or stt")
  const bare = loadModels({ root: join(state, "bare"), which: () => null })
  const none = await createAudiogen({ state: join(state, "s2"), speech: { render: async () => ({}) }, models: bare, install: async (m) => (installs.push(m.name), { started: true }) })
  expect(await none.prepare({ kind: "tts", name: "qwen3-tts" })).toMatchObject({ installing: true, missing: ["mlx_audio.tts.generate"] })
  expect(installs).toEqual(["qwen3-tts"])
})

test("parseScript: chapters and styles from their lines, never spoken; a plain script is one chapter", () => {
  expect(parseScript("Hello there.\n\nGoodbye.")).toEqual([expect.objectContaining({ n: 1, title: null, text: "Hello there.\n\nGoodbye.", styles: [] })])
  const chapters = parseScript("[chapter: Origins]\n[style: documentary]\nThe tales are old.\n[chapter: The tale]\n[style: storyteller]\nA king walked.\n[style: spirit]\n\"Speak, king.\"\n[style: storyteller]\nHe was silent.")
  expect(chapters.map((c) => [c.n, c.title, c.styles, c.segments.length])).toEqual([[1, "Origins", ["documentary"], 1], [2, "The tale", ["storyteller", "spirit"], 3]])
  expect(chapters[1].text).not.toContain("[style")
  expect(parseScript("[chapter: Empty]\n[chapter: Full]\nWords.").map((c) => c.title)).toEqual(["Full"])
})

test("a long script streams out: each chapter rendered in its styles, made playable and sent as soon as it is ready", async () => {
  const rendered = []
  const speech = {
    render: async (call) => (rendered.push({ text: call.text, model: call.model, voice: call.voice, options: call.options }), await Bun.write(call.out, wavOf(1)), { model: call.model }),
    transcribeFile: async () => ({ text: "x", seconds: 1, model: "apple" }),
  }
  const sent = []
  const integrations = { get: () => ({ audio: { send: async (a) => sent.push(a) } }) }
  const audio = await createAudiogen({ state, speech, integrations, models, convert: async (a, b) => copyFileSync(a, b) })
  expect(() => audio.make({ text: "[style: nobody]\nHi." })).toThrow("style: none named nobody")
  const script = "[chapter: Origins]\n[style: documentary]\nThe tales are old.\n[chapter: The tale]\n[style: storyteller]\nA king walked.\n[style: spirit]\nSpeak, king."
  const { job } = audio.make({ text: script, title: "Vikram and the Vetala", send: true })
  expect(job).toMatchObject({ parts: { done: 0, total: 3 }, styles: ["documentary", "storyteller", "spirit"], chapters: [{ n: 1, title: "Origins" }, { n: 2, title: "The tale" }] })
  await until(() => audio.job(job.id).job.status === "done")
  const done = audio.job(job.id).job
  expect(done.parts).toEqual({ done: 3, total: 3 })
  expect(done.chapters.map((c) => [c.status, c.seconds, c.url])).toEqual([["done", 1, `/__askk/audio/file?id=${job.id}&chapter=1`], ["done", 2.6, `/__askk/audio/file?id=${job.id}&chapter=2`]])
  expect(done.seconds).toBe(5) // 1 + 1.4 gap + (1 + 0.6 + 1)
  expect(rendered.map((r) => [r.model, r.voice ?? null, r.options.exaggeration ?? null])).toEqual([["kokoro", "bm_george", null], ["chatterbox", null, 0.65], ["chatterbox", null, 1]])
  expect(sent.map((s) => s.title)).toEqual(["Vikram and the Vetala · 1. Origins", "Vikram and the Vetala · 2. The tale"])
  expect(audio.script(job.id, 2).text).toBe("A king walked.\n\nSpeak, king.")
  expect((await audio.file(job.id, "m4a", 2).arrayBuffer()).byteLength).toBeGreaterThan(44)
  expect((await audio.transcribe({ id: job.id, chapter: 2 })).text).toBe("x")
  expect(audio.job(job.id).job.chapters[1].heard.text).toBe("x")
  expect(audio.jobs().styles.map((s) => s.name)).toContain("storyteller")
})

test("a style set from the owner's feedback: checked against its model, written back with why", async () => {
  const audio = await createAudiogen({ state, speech: { render: async () => ({}) }, models })
  expect(() => audio.setStyle({ name: "spirit", options: { exaggeration: 1.2 } })).toThrow("why")
  expect(() => audio.setStyle({ name: "spirit", voice: "nobody", why: "x" })).toThrow("no voices to choose")
  expect(() => audio.setStyle({ name: "regal", voice: "nobody", why: "x" })).toThrow("voice: kokoro has")
  const { style } = audio.setStyle({ name: "spirit", options: { exaggeration: 1.2 }, why: "owner: the vetala should sound wilder" })
  expect(style.options).toMatchObject({ exaggeration: 1.2, cfg_scale: 0.3 })
  expect(style.changes.at(-1)).toContain("owner: the vetala should sound wilder")
  expect(style.writing).toContain("first person")
  expect(audio.setStyle({ name: "regal", voice: "bm_lewis", why: "deeper" }).style.voice).toBe("bm_lewis")
})
