// The composer mic (backend/live/listen.js, voice-in 2026-10-27): the recognizer pick, and HostDictation through a fake mic
// and a mock host.

import { describe, expect, test } from "bun:test"

import { HostDictation, pickRecognizer } from "./listen.js"

const chrome = { supported: false, browser: "chrome", secure: true, microphone: true, permission: "prompt", reason: "Dictation is available in Safari only for now (Apple's dictation)." }
const safari = { ...chrome, supported: true, browser: "safari", reason: null }

describe("pickRecognizer", () => {
  test("a host with speech: the page mic in any browser", () => {
    expect(pickRecognizer({ hostSpeech: true, browser: chrome })).toEqual({ kind: "host", supported: true, reason: null })
  })

  test("no host speech: Safari's dictation, else off with the reason", () => {
    expect(pickRecognizer({ hostSpeech: false, browser: safari })).toMatchObject({ kind: "browser", supported: true })
    const off = pickRecognizer({ hostSpeech: false, browser: chrome })
    expect(off).toMatchObject({ kind: "off", supported: false })
    expect(off.reason).toContain("capability speech")
  })

  test("a host with speech but no mic here: off with the mic's reason", () => {
    expect(pickRecognizer({ hostSpeech: true, browser: { ...chrome, microphone: false } }).reason).toBe("This browser gives no microphone access.")
    expect(pickRecognizer({ hostSpeech: true, browser: { ...chrome, permission: "denied" } }).reason).toContain("blocked")
  })

  test("not known yet: null", () => {
    expect(pickRecognizer({ hostSpeech: null, browser: chrome })).toBe(null)
    expect(pickRecognizer({ hostSpeech: true, browser: null })).toBe(null)
  })
})

// A push-to-talk mic: hold(false) hands its take to onUtterance, as backend/hardware/speech/microphone.js does.
class FakeMic {
  mode = "auto"
  on = false
  recording = false
  constructor(callbacks) {
    Object.assign(this, callbacks)
  }
  async start() {
    this.on = true
  }
  hold(down) {
    this.recording = down
    if (!down) this.onUtterance(new Int16Array([1, 2, 3]))
  }
  stop() {
    this.on = this.recording = false
  }
}

class DeniedMic extends FakeMic {
  async start() {
    throw Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })
  }
}

const ear = (status = 200, seen = []) => ({
  post: async (path, body) => {
    seen.push({ path, body })
    if (status !== 200) throw Object.assign(new Error(`POST ${path}: HTTP ${status} nope`), { status })
    return { text: "hello desk" }
  },
})

const take = (options) => {
  const changes = []
  let d
  const ended = new Promise((resolve) => (d = new HostDictation({ ...options, onChange: (t) => changes.push(t), onEnd: resolve })))
  return { d, changes, ended }
}

describe("HostDictation", () => {
  test("tap, speak, tap: the take goes to speech/transcribe and its text lands", async () => {
    const seen = []
    const { d, changes, ended } = take({ Mic: FakeMic, host: ear(200, seen) })
    d.start()
    expect(d.listening).toBe(true)
    await Promise.resolve()
    d.stop()
    expect(d.listening).toBe(false)
    expect(await ended).toEqual({ text: "hello desk", error: null })
    expect(changes).toEqual(["hello desk"])
    expect(seen[0].path).toBe("speech/transcribe")
    expect(typeof seen[0].body.audio).toBe("string")
  })

  test("off macOS: the 501 is the take's error", async () => {
    const { d, ended } = take({ Mic: FakeMic, host: ear(501) })
    d.start()
    await Promise.resolve()
    d.stop()
    expect((await ended).error).toContain("speech.transcribe: 501 no speech on this host")
  })

  test("a denied mic ends with a readable error", async () => {
    const { d, ended } = take({ Mic: DeniedMic, host: ear() })
    d.start()
    expect(await ended).toEqual({ text: "", error: "Microphone access was denied." })
  })
})
