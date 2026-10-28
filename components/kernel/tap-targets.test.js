import { describe, expect, test } from "bun:test"
import { PHONE_TAP } from "../../lib/tap-target.js"
import { CHIP_BTN, DECIDE_BTN, TILE_HEAD } from "./tap-classes.js"

describe("tap-helper-home: the desk cards' controls at 375", () => {
  test("the tile head, the chip and Accept/Drop are 40px targets below sm", () => {
    for (const cls of [TILE_HEAD, CHIP_BTN, DECIDE_BTN]) {
      for (const c of PHONE_TAP.split(" ")) expect(cls.split(" ")).toContain(c)
    }
  })

  test("they stay dense from sm up", () => {
    expect(TILE_HEAD.split(" ")).toContain("min-h-8")
    expect(CHIP_BTN.split(" ")).toContain("leading-5")
    expect(DECIDE_BTN.split(" ")).toContain("h-6")
  })
})
