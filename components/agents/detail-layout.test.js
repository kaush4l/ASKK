import { describe, expect, test } from "bun:test"

import { detailLayout } from "./detail-layout"

describe("detailLayout (ask-point)", () => {
  test("below md the agent page scrolls whole and the Artifacts pane keeps its content's height", () => {
    const c = detailLayout()
    expect(c.root).toContain("max-md:overflow-y-auto")
    expect(c.artifacts).toContain("max-md:flex-none")
  })

  test("from md up the pane still fills the space under the header", () => {
    const c = detailLayout()
    expect(c.root).toContain("min-h-0")
    expect(c.artifacts).toContain("flex-1")
  })
})
