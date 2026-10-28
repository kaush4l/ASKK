import { describe, expect, test } from "bun:test"
import { rowClasses, tabClasses } from "./tab-row.jsx"

describe("agents-narrow-tabs: tab triggers are 40px targets below sm", () => {
  test("tabClasses: both states hold min-h-10 below sm and dense from sm up", () => {
    for (const selected of [true, false]) {
      const cls = tabClasses(selected).split(" ")
      expect(cls).toContain("min-h-10")
      expect(cls).toContain("py-2.5")
      expect(cls).toContain("sm:min-h-0")
      expect(cls).toContain("sm:py-1")
    }
  })

  test("tabClasses: the selected tab keeps its border, the others stay muted", () => {
    expect(tabClasses(true)).toContain("border-primary")
    expect(tabClasses(false)).not.toContain("border-primary")
    expect(tabClasses(false)).toContain("text-muted-foreground")
  })
})
describe("artifacts-tabs-fit: the tabs stay on one row", () => {
  test("rowClasses: no wrap, the row scrolls inside itself", () => {
    const cls = rowClasses().split(" ")
    expect(cls).toContain("flex-nowrap")
    expect(cls).toContain("overflow-x-auto")
    expect(cls).not.toContain("flex-wrap")
  })

  test("tabClasses: every tab keeps its label and count whole", () => {
    for (const selected of [true, false]) {
      const cls = tabClasses(selected).split(" ")
      expect(cls).toContain("shrink-0")
      expect(cls).toContain("whitespace-nowrap")
    }
  })
})
