import { expect, test } from "bun:test"
import { mdBlocks, mdInline, safeHref } from "./markdown.js"

test("blocks: headings, lists, a table, code, a rule, paragraphs", () => {
  const b = mdBlocks("DECISION: GO\n\n## 1) First\n| Step | Item |\n|---|---|\n| S1 | ABC |\n- a\n- b\n1. one\n```data\n[1]\n```\n---\n> quoted")
  expect(b.map((x) => x.type)).toEqual(["p", "h", "table", "ul", "ol", "code", "hr", "quote"])
  expect(b[2].rows[0].map((c) => c[0].v)).toEqual(["S1", "ABC"])
  expect(b[5]).toEqual({ type: "code", lang: "data", text: "[1]" })
})

test("never markup: raw HTML is text; only http(s) links become links", () => {
  const b = mdBlocks('<img src=x onerror="alert(1)"> and [x](javascript:alert(1)) and [ok](https://example.com/a)')
  const inline = b[0].inline
  expect(inline.filter((t) => t.t === "a")).toEqual([{ t: "a", v: "ok", href: "https://example.com/a" }])
  expect(inline.map((t) => t.v).join("")).toContain('<img src=x onerror="alert(1)">')
  expect(safeHref("data:text/html,x")).toBeNull()
})

test("inline: bold, italic, code; snake_case words stay text", () => {
  expect(mdInline("**Evidence:** `CP` is *fresh* — CONFIRMED_BY_TODAY_DATA")).toEqual([
    { t: "b", v: "Evidence:" },
    { t: "text", v: " " },
    { t: "code", v: "CP" },
    { t: "text", v: " is " },
    { t: "i", v: "fresh" },
    { t: "text", v: " — CONFIRMED_BY_TODAY_DATA" },
  ])
})

test("a wrapped list item: its indented continuation stays in the item", () => {
  const b = mdBlocks("- first line of the item\n  continues here\n- second")
  expect(b).toHaveLength(1)
  expect(b[0].items).toHaveLength(2)
  expect(JSON.stringify(b[0].items[0])).toContain("continues here")
})
