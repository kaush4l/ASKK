import { expect, test } from "bun:test"
import { Audio, heardShare } from "../builtin/audio.js"

// a fake audio host: jobs queue, then finish when the test says
function audioHost() {
  const jobs = []
  const scripts = {}
  const posts = []
  let n = 0
  const models = {
    tts: [
      { name: "kokoro", title: "Kokoro 82M", ready: true, missing: [], about: "fast", voices: ["af_heart", "bf_emma"], options: { speed: { type: "number", default: 1, min: 0.5, max: 2 } }, script: "Plain prose. Punctuation is the only control." },
      { name: "chatterbox", title: "Chatterbox", ready: false, missing: ["mlx_audio.tts.generate"], about: "expressive", voices: [], options: { exaggeration: { type: "number", default: 0.5 } }, script: "Write the feeling into the sentences." },
    ],
    stt: [{ name: "apple", title: "Apple", ready: true, missing: [], voices: [], options: {} }],
  }
  return {
    jobs,
    posts,
    finish: () => jobs.forEach((j) => j.status === "queued" && Object.assign(j, { status: "done", seconds: 12.5, ms: 3000, url: `/__askk/audio/file?id=${j.id}` })),
    async post(path, body) {
      posts.push([path, body])
      if (path === "audio/make") {
        const job = { id: `aud-t-${++n}`, title: body.title, chars: body.text.length, model: body.model ?? "kokoro", voice: body.voice, options: body.options, by: body.by, status: "queued", sent: [] }
        scripts[job.id] = body.text
        jobs.unshift(job)
        return { job }
      }
      if (path === "audio/transcribe") return { text: body.id ? "Once upon a time a fox found a lantern" : "a recording", seconds: 12.5, model: "apple" }
      if (path === "audio/send") {
        jobs.find((j) => j.id === body.id).sent.push({ to: "owner", at: "now" })
        return { sent: { to: "owner" } }
      }
      if (path === "audio/prepare") return { model: body.name, added: true, ready: false, installing: true, missing: ["mlx_audio.tts.generate"], note: "installing now" }
      if (path === "audio/delete") {
        jobs.splice(jobs.findIndex((j) => j.id === body.id), 1)
        return { deleted: [body.id] }
      }
      throw new Error(`unexpected ${path}`)
    },
    async get(path) {
      if (path === "audio/jobs") return { jobs: jobs.map((j) => ({ ...j })), tts: "kokoro", stt: "apple", models, catalog: { tts: [{ name: "qwen3-tts", title: "Qwen3", about: "" }], stt: [] } }
      if (path.startsWith("audio/script?")) return { text: scripts[new URLSearchParams(path.split("?")[1]).get("id")] }
      if (path.startsWith("fs/read?")) return { text: "Once upon a time, a fox found a lantern.", truncated: false }
      throw new Error(`unexpected ${path}`)
    },
  }
}
const agentOf = (name, host) => ({ name, context: { host, log() {} } })

test("models with their script format → make (from a file too) → wait → transcribe checks the script was heard → send", async () => {
  const host = audioHost()
  const audio = new Audio({ waitMs: 1 })
  const lead = agentOf("lead", host)
  audio.attach(lead)
  await audio.refresh(lead)
  expect(audio.render()).toContain("SCRIPT FORMAT (kokoro): Plain prose. Punctuation is the only control.")
  const models = audio.models()
  expect(models).toContain("chatterbox — Chatterbox: not installed")
  expect(models).toContain("SCRIPT FORMAT: Write the feeling into the sentences.")
  expect(models).toContain("tts qwen3-tts")
  const ctx = { agent: lead }
  await expect(audio.make({ text: "hi" }, ctx)).rejects.toThrow("title")
  await expect(audio.make({ text: "hi", title: "x", model: "chatterbox" }, ctx)).rejects.toThrow("prepare")
  expect(await audio.make({ text: "Once upon a time, a fox found a lantern.", title: "The fox", voice: "bf_emma", options: "speed: 0.9" }, ctx)).toContain("queued aud-t-1")
  expect(host.posts.at(-1)[1]).toMatchObject({ voice: "bf_emma", options: { speed: 0.9 }, by: "lead" })
  await audio.make({ file: "work/story.txt", title: "From a file" }, ctx)
  expect(host.posts.at(-1)[1].text).toBe("Once upon a time, a fox found a lantern.")
  expect(audio.gate(lead)).toContain("2 of your audio files")
  setTimeout(() => host.finish(), 5)
  expect(await audio.wait({}, ctx)).toContain("aud-t-1: done — 13 s of audio")
  expect(audio.gate(lead)).toBeNull()
  const heard = await audio.transcribe({ id: "aud-t-1" }, ctx)
  expect(heard).toContain("HEARD 100% of the script's words")
  expect(audio.state.transcripts[0]).toMatchObject({ of: "aud-t-1", match: 1 })
  expect(await audio.transcribe({ path: "notes/call.m4a" }, ctx)).toContain("a recording")
  expect(await audio.send({ id: "aud-t-1" }, ctx)).toContain("Telegram")
  expect(audio.render()).toContain("· sent")
  expect(await audio.prepare({ model: "qwen3-tts" }, ctx)).toContain("tts/qwen3-tts: installing")
  expect(audio.brief()).toContain("2 files")
})

test("heardShare: words heard in order; skipped or misread words lower it; say's embedded commands are not words", () => {
  expect(heardShare("The fox found a lantern.", "the fox found a lantern")).toBe(1)
  expect(heardShare("In 2026 the fox found 3 lanterns.", "in the fox found lanterns")).toBe(0.71)
  // numbers as words in the script, as digits in the transcript (2026-10-24 live run: 1857 vs "eighteen fifty-seven")
  expect(heardShare("The year is eighteen fifty-seven. Less than four months later.", "the year is 1857 less than 4 months later")).toBe(1)
  expect(heardShare("Bread and butter.", "bread butter")).toBe(0.67)
  expect(heardShare("[[slnc 400]] Hello there.", "hello there")).toBe(1)
  expect(heardShare("", "x")).toBeNull()
})

test("the owner: make without an agent, send, delete; an unknown method refused", async () => {
  const host = audioHost()
  const audio = new Audio({ waitMs: 1 })
  audio.attach(agentOf("lead", host))
  await audio.ownerCall("make", [{ id: "audio", text: "A short talk about the sea." }])
  expect(host.posts.at(-1)[1]).toMatchObject({ title: "A short talk about the sea.", by: "owner" })
  host.finish()
  await audio.refresh(null)
  expect((await audio.ownerCall("send", [{ id: "audio", audio: "aud-t-1" }])).result).toContain("sent")
  expect(await audio.ownerCall("delete", [{ id: "audio", audio: "aud-t-1" }])).toEqual({ deleted: ["aud-t-1"] })
  expect(audio.state.jobs).toEqual([])
  expect(() => audio.ownerCall("dance", [{}])).toThrow("not dance")
})

test("styles: listed with their writing guides; samples make one chapter per style, sent; a style set carries the owner's why", async () => {
  const posts = []
  const styles = [
    { name: "documentary", title: "Documentary", use: "the backstory", model: "kokoro", voice: "bm_george", speed: 0.95, options: {}, writing: "Write like a calm documentary narrator.", changes: [], ok: true },
    { name: "spirit", title: "Spirit", use: "the vetala's lines", model: "chatterbox", voice: null, speed: 0.9, options: { exaggeration: 1 }, writing: "Write the spirit speaking for itself.", changes: [], ok: true },
  ]
  const host = {
    async get(path) {
      if (path === "audio/jobs") return { jobs: [], tts: "kokoro", stt: "apple", models: { tts: [{ name: "kokoro", title: "Kokoro", ready: true, voices: [], options: {} }], stt: [] }, catalog: { tts: [], stt: [] }, styles }
      throw new Error(path)
    },
    async post(path, body) {
      posts.push([path, body])
      if (path === "audio/make") return { job: { id: "aud-t-1", title: body.title, chars: 10, model: "kokoro", styles: ["documentary", "spirit"], parts: { done: 0, total: 2 }, chapters: [{ n: 1 }, { n: 2 }], status: "queued" } }
      if (path === "audio/style") return { style: { ...styles[1], options: { ...styles[1].options, ...body.options } } }
      throw new Error(path)
    },
  }
  const audio = new Audio({ waitMs: 1 })
  const lead = { name: "lead", context: { host, log() {} } }
  audio.attach(lead)
  await audio.refresh(lead)
  expect(audio.render()).toContain("[chapter: title] starts a chapter")
  expect(audio.render()).toContain("spirit (the vetala's lines)")
  expect(audio.styles()).toContain("## spirit — Spirit")
  expect(audio.styles()).toContain("WRITING: Write the spirit speaking for itself.")
  const out = await audio.samples({ text: "The king walked through the cremation ground." }, { agent: lead })
  expect(out).toContain("2 chapters")
  expect(out).toContain("each chapter goes to the owner's Telegram chat")
  expect(posts[0][1].text).toBe("[chapter: documentary]\n[style: documentary]\nThe king walked through the cremation ground.\n\n[chapter: spirit]\n[style: spirit]\nThe king walked through the cremation ground.")
  expect(posts[0][1].send).toBe(true)
  await expect(audio.style({ name: "spirit", options: "exaggeration: 1.2" }, { agent: lead })).rejects.toThrow("why")
  expect(await audio.style({ name: "spirit", options: "exaggeration: 1.2", why: "owner: wilder" }, { agent: lead })).toContain("exaggeration 1.2")
  expect(posts.at(-1)[1]).toEqual({ name: "spirit", why: "owner: wilder", options: { exaggeration: 1.2 } })
})
