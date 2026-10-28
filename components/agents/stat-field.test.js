import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { Field, fieldClasses } from "./stat-field.jsx"

describe("agents-narrow-numbers: a header number never breaks mid-number", () => {
  test("fieldClasses: the value wraps at spaces with tabular digits, never break-all", () => {
    const dd = fieldClasses().dd.split(" ")
    expect(dd).toContain("break-words")
    expect(dd).toContain("tabular-nums")
    expect(dd).toContain("min-w-0")
    expect(dd).not.toContain("break-all")
  })

  test("Field renders its label and value with the dd classes", () => {
    const html = renderToString(createElement(Field, { label: "model calls" }, "prompt 53,302 chars"))
    expect(html).toContain("<dt>model calls</dt>")
    expect(html).toContain("prompt 53,302 chars")
    expect(html).toContain("tabular-nums")
    expect(html).not.toContain("break-all")
  })
})
