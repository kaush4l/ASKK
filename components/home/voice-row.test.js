import { describe, expect, test } from "bun:test"
import { voiceRowClasses } from "./voice-row.js"

describe("voice-bar-375: the voice bar's controls at 375", () => {
  test("the radios and the pause buttons are 40px targets below sm", () => {
    const { choice, pause } = voiceRowClasses()
    for (const cls of [choice, pause]) {
      expect(cls.split(" ")).toContain("max-sm:min-h-10")
      expect(cls.split(" ")).toContain("max-sm:min-w-10")
    }
  })

  test("the control row wraps and may shrink, so the page never scrolls sideways", () => {
    const row = voiceRowClasses().row.split(" ")
    expect(row).toContain("flex")
    expect(row).toContain("flex-wrap")
    expect(row).toContain("min-w-0")
  })
})
