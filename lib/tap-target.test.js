import { describe, expect, test } from "bun:test"
import { PHONE_TAP, TAP_MIN } from "./tap-target.js"

describe("tap-helper-home: the phone tap target", () => {
  test("below sm a target is at least 40px tall and wide", () => {
    expect(PHONE_TAP.split(" ")).toContain("max-sm:min-h-10")
    expect(PHONE_TAP.split(" ")).toContain("max-sm:min-w-10")
  })
})

describe("tap-helper-adopt: one 40px standard", () => {
  test("TAP_MIN is a 40px target at every width", () => {
    expect(TAP_MIN.split(" ")).toEqual(["min-h-10", "min-w-10"])
  })

  test("PHONE_TAP is TAP_MIN with max-sm: on each class", () => {
    expect(PHONE_TAP).toBe(TAP_MIN.split(" ").map((c) => `max-sm:${c}`).join(" "))
  })
})
