import { describe, expect, test } from "bun:test"
import * as React from "react"
import { renderToString } from "react-dom/server"

import { headClasses, headParts } from "./artifact-head"
import { ArtifactBlock } from "./artifact"
import { getSnapshot, pointAt } from "@/lib/ask-point"

const dev = { id: "dev", view: "none-drawn", title: "dev — the project the desk changes", brief: "branch, goal, checks" }

describe("dev-card-header", () => {
  test("headParts drops the repeated id and keeps the whole title", () => {
    const p = headParts(dev)
    expect(p.id).toBe("dev")
    expect(p.title).toBe("the project the desk changes")
    expect(p.full).toBe("dev — the project the desk changes")
    expect(headParts({ id: "stage", title: "the scenes" }).title).toBe("the scenes")
    expect(headParts({ id: "dev", title: "dev" }).title).toBe("dev")
  })

  test("the title truncates and the brief yields first", () => {
    const c = headClasses()
    expect(c.title).toContain("min-w-0")
    expect(c.title).toContain("truncate")
    expect(c.brief).toContain("shrink-[999]")
    expect(c.id).toContain("shrink-0")
  })

  test("ArtifactBlock shows the dev title once, with the whole title on hover", () => {
    const html = renderToString(React.createElement(ArtifactBlock, { artifact: dev, expanded: false }))
    const visible = html.replace(/<[^>]*>/g, " ")
    expect(visible).not.toContain("dev — the project")
    expect(visible).toContain("the project the desk changes")
    expect(html).toContain('title="dev — the project the desk changes"')
    expect(html).toContain("shrink-[999]")
  })
})
describe("artifact-head-yield", () => {
  test("below sm the brief hides, from sm up it yields first, and its text stays in title=", () => {
    const c = headClasses()
    expect(c.brief).toContain("max-sm:hidden")
    expect(c.brief).toContain("shrink-[999]")
    expect(c.title).toContain("min-w-0")
    expect(c.title).toContain("truncate")
    const html = renderToString(React.createElement(ArtifactBlock, { artifact: dev, expanded: false }))
    expect(html).toContain("max-sm:hidden")
    expect(html).toContain('title="branch, goal, checks"')
  })
})
describe("ask-point", () => {
  const ask = { id: "ask", view: "ask", title: "ask" }
  test("pointAt fills the store, and pointing again moves at", () => {
    pointAt("talk")
    const first = getSnapshot()
    expect(first.element).toBe("talk")
    expect(first.at).toBeGreaterThan(0)
    pointAt("talk")
    expect(getSnapshot().at).toBeGreaterThan(first.at)
  })

  test("a card head shows Ask about this with the phone tap target; the ask card has none", () => {
    const html = renderToString(React.createElement(ArtifactBlock, { artifact: dev, expanded: false }))
    expect(html).toContain("Ask about this")
    expect(html).toContain("max-sm:min-h-10")
    const own = renderToString(React.createElement(ArtifactBlock, { artifact: ask, expanded: false }))
    expect(own).not.toContain("Ask about this")
  })

  test("the open Ask panel's artifact field starts from the pointed card", () => {
    pointAt("talk")
    const html = renderToString(React.createElement(ArtifactBlock, { artifact: ask, expanded: true }))
    expect(html).toContain('value="talk"')
  })

  test("the closed Ask tile shows what it is pointed at", () => {
    pointAt("talk")
    const html = renderToString(React.createElement(ArtifactBlock, { artifact: ask, expanded: false }))
    expect(html).toContain("about talk")
  })
})
