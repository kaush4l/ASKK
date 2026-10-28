// withDictation (components/chat/dictation-text.js, voice-in 2026-10-27): the transcript fills the composer.

import { describe, expect, test } from "bun:test"

import { withDictation } from "./dictation-text.js"

describe("withDictation (voice-in)", () => {
  test("an empty box: the transcript is the text", () => {
    expect(withDictation("", "hello desk")).toBe("hello desk")
  })

  test("typed text first: the transcript goes after it", () => {
    expect(withDictation("Please", "add a button")).toBe("Please add a button")
  })

  test("no words yet: the typed text stays as it was", () => {
    expect(withDictation("Please", "")).toBe("Please")
  })
})
