import { describe, expect, test } from "bun:test"

import { askTarget } from "./artifacts-view"

describe("ask-point", () => {
  test("askTarget finds the desk's Ask artifact, or null when it has none", () => {
    expect(askTarget({ talk: { id: "talk", view: "talk" }, ask: { id: "ask", view: "ask" } })).toBe("ask")
    expect(askTarget({ talk: { id: "talk", view: "talk" } })).toBe(null)
    expect(askTarget(null)).toBe(null)
  })
})
