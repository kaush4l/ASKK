import { describe, expect, test } from "bun:test"

import { headerParts, nameClasses, rootLabel, rowClasses } from "./files-pane.jsx"

describe("narrow-walk: 40px targets at 375", () => {
  test("a tree row is 40px tall below sm and dense from sm up", () => {
    expect(rowClasses()).toContain("min-h-10")
    expect(rowClasses()).toContain("sm:min-h-7")
  })

  test("the header state dot has a 40px hit area on narrow screens only", () => {
    const h = headerParts("", 30, { live: true })
    expect(h.stateHit).toContain("size-10")
    expect(h.stateHit).toContain("sm:size-auto")
  })
})

describe("headerParts (files-header-room)", () => {
  test("the root whole and the count compact: workspace, 30, titled 30 modified", () => {
    const h = headerParts("", 30)
    expect(h.label).toBe("workspace")
    expect(h.count).toBe("30")
    expect(h.countTitle).toBe("30 modified")
    expect(h.rootClass).toContain("shrink-0")
    expect(h.rootClass).toContain("max-w-[12ch]")
    expect(h.rootClass).not.toContain("min-w-0")
  })

  test("nothing modified: no count", () => {
    const h = headerParts("work/dev", 0)
    expect(h.label).toBe("dev")
    expect(h.title).toBe("work/dev")
    expect(h.count).toBeNull()
    expect(h.countTitle).toBeNull()
  })
})

describe("headerParts state (header-live-fit)", () => {
  test("live: an emerald dot titled live — watching the disk", () => {
    const s = headerParts("", 30, { live: true }).state
    expect(s.dot).toBe("bg-emerald-500")
    expect(s.title).toBe("live — watching the disk (fs/watch)")
    expect(Object.keys(s).sort()).toEqual(["dot", "title"])
  })

  test("twin: a muted dot titled twin", () => {
    const s = headerParts("", 30, { live: false }).state
    expect(s.dot).toBe("bg-muted-foreground/50")
    expect(s.title).toStartWith("twin — from the files artifact")
  })

  test("an error: a muted dot titled with the error", () => {
    const s = headerParts("", 30, { live: false, error: "x" }).state
    expect(s.dot).toBe("bg-muted-foreground/50")
    expect(s.title).toBe("x")
  })

  test("no live object reads as twin", () => {
    expect(headerParts("", 0).state.dot).toBe("bg-muted-foreground/50")
  })
})

describe("rootLabel (files-root-label)", () => {
  test("the last folder as label, the full path as title", () => {
    expect(rootLabel("work/dev")).toEqual({ label: "dev", title: "work/dev" })
    expect(rootLabel("work/dev/")).toEqual({ label: "dev", title: "work/dev" })
  })

  test("an empty root reads workspace", () => {
    expect(rootLabel("")).toEqual({ label: "workspace", title: "workspace" })
    expect(rootLabel(undefined)).toEqual({ label: "workspace", title: "workspace" })
  })
})

describe("nameClasses (tree-heads)", () => {
  test("a row with a tail: a fixed-width head, a min-w-0 truncate tail", () => {
    const c = nameClasses({ name: "2026-10-22-bun-notes.md", head: "2026-10-22-bun", tail: "…-notes.md" })
    expect(c.head).toContain("w-[7ch]")
    expect(c.head).toContain("truncate")
    expect(c.tail).toBe("min-w-0 truncate")
  })

  test("tail-first: a row with a tail cuts its head first in a narrow pane", () => {
    const c = nameClasses({ name: "2026-10-22-bun-notes.md", head: "2026-10-22-bun", tail: "…-notes.md" })
    expect(c.head).toContain("shrink-[999]")
    expect(c.head).toContain("min-w-[1ch]")
    expect(c.head).not.toContain("shrink-0")
    expect(c.tail).toContain("min-w-0")
    expect(c.tail).toContain("truncate")
  })

  test("a row without a tail: a min-w-0 truncate head, no fixed width", () => {
    const c = nameClasses({ name: "waiting.js", head: "waiting.js" })
    expect(c.head).toBe("min-w-0 truncate")
    expect(c.head).not.toContain("w-[7ch]")
    expect(c.tail).toBe("")
  })

  test("no row gives the plain head", () => {
    expect(nameClasses(undefined)).toEqual({ head: "min-w-0 truncate", tail: "" })
  })
})
