// speakLook (components/agents/speak-look.js, voice-out 2026-10-27): the speaker on an answer, per state.

import { describe, expect, test } from "bun:test"

import { failLine, speakLook, speakText } from "./speak-look.js"

describe("speakLook (voice-out)", () => {
  test("a host without speech: off, disabled, says macOS only", () => {
    const l = speakLook({ speech: false, state: "idle" })
    expect(l).toMatchObject({ icon: "off", disabled: true })
    expect(l.title).toContain("macOS only")
  })

  test("not known yet: the speaker waits, disabled", () => {
    expect(speakLook({ speech: null })).toMatchObject({ icon: "speak", disabled: true })
  })

  test("a host that speaks: idle → loading → playing, each one click to stop", () => {
    expect(speakLook({ speech: true })).toMatchObject({ icon: "speak", disabled: false, label: "Speak the answer" })
    expect(speakLook({ speech: true, state: "loading" })).toMatchObject({ icon: "busy", disabled: false })
    expect(speakLook({ speech: true, state: "playing" })).toMatchObject({ icon: "stop", disabled: false, label: "Stop speaking" })
  })

  test("failed: again, with the reason", () => {
    const l = speakLook({ speech: true, state: "failed", error: "speech.say: 501 no speech on this host" })
    expect(l).toMatchObject({ icon: "speak", disabled: false, label: "Speak the answer again" })
    expect(l.title).toBe("Not spoken: speech.say: 501 no speech on this host")
  })
})
describe("speak-polish (2026-10-27)", () => {
  test("speakText speaks only the VERDICT of a report", () => {
    const report = "VERDICT: the build passes\nEVIDENCE: 12 tests (bun test, 01:50)\nCONFIDENCE: 0.9\nFALSIFIER: a red test\nGAPS: none"
    expect(speakText(report)).toBe("the build passes")
  })

  test("speakText falls back to the whole text when there is no VERDICT", () => {
    expect(speakText("  Hello there.\nSecond line.  ")).toBe("Hello there.\nSecond line.")
    expect(speakText(null)).toBe("")
  })

  test("a failure is one short line; the full error stays in the title", () => {
    const error = "speech.say: POST speech/say: HTTP 403 This is an agent's view: it never writes"
    const l = speakLook({ speech: true, state: "failed", error })
    expect(l.line).toBe("Not spoken (HTTP 403)")
    expect(l.title).toBe(`Not spoken: ${error}`)
    expect(failLine("speech.say: 501 no speech on this host")).toBe("Not spoken: 501 no speech on this host")
    expect(failLine("x: " + "a".repeat(80)).length).toBeLessThanOrEqual(52)
  })

  test("no line unless failed", () => {
    expect(speakLook({ speech: true }).line).toBeNull()
    expect(speakLook({ speech: true, state: "loading" }).line).toBeNull()
  })
})
