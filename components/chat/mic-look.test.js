// micLook / micTapNote (components/chat/mic-look.js, speak-polish 2026-10-27): the composer mic, and the reason an off mic's tap shows.

import { describe, expect, test } from "bun:test"

import { micLook, micTapNote } from "./mic-look.js"

describe("micLook (speak-polish)", () => {
  test("an off mic stays tappable and says why", () => {
    const l = micLook({ support: { supported: false, reason: "This browser gives no microphone access." } })
    expect(l).toEqual({ icon: "off", off: true, disabled: false, label: "This browser gives no microphone access." })
  })

  test("on: dictate, then stop while listening", () => {
    expect(micLook({ support: { supported: true } }).label).toBe("Dictate (live transcription)")
    expect(micLook({ support: { supported: true }, listening: true }).label).toBe("Stop dictation")
  })

  test("only the composer's own disabled disables it", () => {
    expect(micLook({ support: { supported: false, reason: "x" }, disabled: true }).disabled).toBe(true)
  })

  test("a tap on an off mic gives its reason; on or unknown gives none", () => {
    expect(micTapNote({ supported: false, reason: "No host speech" })).toBe("No host speech")
    expect(micTapNote({ supported: false })).toBe("Dictation is not available here")
    expect(micTapNote({ supported: true })).toBeNull()
    expect(micTapNote(null)).toBeNull()
  })
})
