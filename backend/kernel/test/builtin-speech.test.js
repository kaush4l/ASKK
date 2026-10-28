// speech.say (backend/kernel/builtin/speech.js, 2026-10-27): through a mock ctx.host — ok → audio, missing route / 501 → a
// clear 501 error, no host or no text refused.

import { describe, expect, test } from "bun:test"
import { sayThrough, speechSayTool, transcribeThrough } from "../index.js"

const say = speechSayTool()

// A mock host whose post answers speech/say with a WAV, or fails with the given status the way hostClient does.
const host = (status = 200, seen = []) => ({
  post: async (path, body) => {
    seen.push({ path, body })
    if (status !== 200) throw Object.assign(new Error(`POST ${path}: HTTP ${status} nope`), { status })
    return { audio: "UklGRg==", type: "audio/wav" }
  },
})

describe("speech.say", () => {
  test("ok: the existing POST speech/say answers audio", async () => {
    const seen = []
    const out = await sayThrough(host(200, seen), { text: "  hello there ", voice: "Samantha" })
    expect(out).toEqual({ audio: "UklGRg==", type: "audio/wav", chars: 11, cut: false })
    expect(seen).toEqual([{ path: "speech/say", body: { text: "hello there", voice: "Samantha" } }])
    expect(await say.run({ text: "hi" }, { host: host() })).toBe("spoke 2 chars (audio/wav, 0 KB)")
  })

  test("off macOS: a missing route or a 501 is one clear 501 error", async () => {
    for (const status of [404, 501]) {
      const e = await sayThrough(host(status), { text: "hi" }).catch((x) => x)
      expect(e.status).toBe(501)
      expect(e.message).toContain("501 no speech on this host (macOS only")
    }
    await expect(say.run({ text: "hi" }, { host: host(501) })).rejects.toThrow("501 no speech on this host")
  })

  test("other failures, no host and no text", async () => {
    await expect(sayThrough(host(500), { text: "hi" })).rejects.toThrow("speech.say: POST speech/say: HTTP 500")
    await expect(say.run({ text: "hi" }, {})).rejects.toThrow("no host here (ctx.host)")
    await expect(say.run({ text: "  " }, { host: host() })).rejects.toThrow("text: what to say")
  })
})
// voice-in (2026-10-27): transcribeThrough through a mock host whose post answers speech/transcribe with text.
const ear = (status = 200, seen = []) => ({
  post: async (path, body) => {
    seen.push({ path, body })
    if (status !== 200) throw Object.assign(new Error(`POST ${path}: HTTP ${status} nope`), { status })
    return { text: " hello desk ", seconds: 1.2, ms: 80 }
  },
})

describe("speech.transcribe (transcribeThrough)", () => {
  test("ok: the existing POST speech/transcribe answers text", async () => {
    const seen = []
    expect(await transcribeThrough(ear(200, seen), { audio: "AAEC", locale: "en-US" })).toEqual({ text: "hello desk", seconds: 1.2, ms: 80 })
    expect(seen).toEqual([{ path: "speech/transcribe", body: { audio: "AAEC", locale: "en-US" } }])
  })

  test("off macOS: a missing route or a 501 is one clear 501 error", async () => {
    for (const status of [404, 501]) {
      const e = await transcribeThrough(ear(status), { audio: "AAEC" }).catch((x) => x)
      expect(e.status).toBe(501)
      expect(e.message).toContain("speech.transcribe: 501 no speech on this host (macOS only: the host's recognizer")
    }
  })

  test("other failures, no host and no audio", async () => {
    await expect(transcribeThrough(ear(500), { audio: "AAEC" })).rejects.toThrow("speech.transcribe: POST speech/transcribe: HTTP 500")
    await expect(transcribeThrough(null, { audio: "AAEC" })).rejects.toThrow("no host here (ctx.host)")
    await expect(transcribeThrough(ear(), {})).rejects.toThrow("audio: base64 16 kHz mono PCM")
  })
})
