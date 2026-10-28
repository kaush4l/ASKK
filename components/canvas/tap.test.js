import { describe, expect, test } from "bun:test"

import { agentBoxClasses, cardTapClasses, followLabel, followPillClasses, insetFor, midBriefClasses, nearStatusClasses, slopFor, toolbarClasses } from "./tap"

describe("canvas-card-tap-375", () => {
  test("a finger gets a larger slop than a mouse", () => {
    expect(slopFor("touch")).toBeGreaterThan(slopFor("mouse"))
    expect(slopFor("pen")).toBe(slopFor("touch"))
    expect(slopFor("mouse")).toBe(5)
  })

  test("a card is a 40px tap target", () => {
    const classes = cardTapClasses().split(" ")
    expect(classes).toContain("min-h-10")
    expect(classes).toContain("min-w-10")
    expect(classes).toContain("cursor-pointer")
  })
})

describe("canvas-near-card-clip-375", () => {
  test("the near card's status line is one truncated line", () => {
    const classes = nearStatusClasses().split(" ")
    expect(classes).toContain("truncate")
    expect(classes).toContain("min-w-0")
  })

  test("the mid card's brief clamps to two lines", () => {
    const classes = midBriefClasses().split(" ")
    expect(classes).toContain("line-clamp-2")
    expect(classes).not.toContain("line-clamp-3")
    expect(classes).toContain("min-w-0")
  })

  test("below sm the zoom toolbar sits on the bottom edge", () => {
    const classes = toolbarClasses().split(" ")
    expect(classes).toContain("max-sm:bottom-3")
    expect(classes).toContain("max-sm:top-auto")
    expect(classes.some((c) => c.includes("safe-area-inset-bottom"))).toBe(true)
  })

  test("Fit keeps the bottom controls clear below sm", () => {
    expect(insetFor(375).bottom).toBeGreaterThan(insetFor(1280).bottom)
    expect(insetFor(1280)).toEqual({ top: 56, bottom: 40 })
    expect(insetFor(0)).toEqual(insetFor(1280))
  })
})

describe("canvas-tap-ease", () => {
  test("following a target names it", () => {
    expect(followLabel({ follow: true, target: "coder", focused: null, opened: null })).toBe("Following coder")
  })

  test("following with no work waits", () => {
    expect(followLabel({ follow: true, target: null, focused: null, opened: null })).toBe("Follow: waiting for work")
  })

  test("a focused agent is named", () => {
    expect(followLabel({ follow: false, target: "coder", focused: "planner", opened: null })).toBe("Focused on planner")
  })

  test("an opened artifact shows the way back", () => {
    expect(followLabel({ follow: false, target: "coder", focused: null, opened: "goal" })).toBe("Showing goal · Fit to go back")
  })

  test("otherwise Follow is off", () => {
    expect(followLabel({ follow: false, target: "coder", focused: null, opened: null })).toBe("Follow off")
  })
})

describe("canvas-open-actionable", () => {
  test("the agent box lets taps through to the artifacts lifted under it", () => {
    const { box, card } = agentBoxClasses()
    expect(box.split(" ")).toContain("pointer-events-none")
    expect(box.split(" ")).toContain("absolute")
    expect(card.split(" ")).toContain("pointer-events-auto")
    expect(card.split(" ")).not.toContain("pointer-events-none")
  })
})

describe("canvas-controls-375", () => {
  test("below sm the follow pill is opaque", () => {
    const classes = followPillClasses().split(" ")
    expect(classes).toContain("max-sm:bg-background/90")
    expect(classes.some((c) => c.includes("4rem"))).toBe(false)
  })

  test("Fit keeps one bottom row clear below sm", () => {
    expect(insetFor(375).bottom).toBe(64)
  })

  test("from sm up the inset is unchanged", () => {
    expect(insetFor(1280)).toEqual({ top: 56, bottom: 40 })
  })
})

describe("canvas-pill-label-375", () => {
  test("below sm the follow pill is a full-width top row", () => {
    const classes = followPillClasses().split(" ")
    expect(classes).toContain("max-sm:top-3")
    expect(classes).toContain("max-sm:bottom-auto")
    expect(classes).toContain("max-sm:left-3")
    expect(classes).toContain("max-sm:max-w-[calc(100%-1.5rem)]")
    expect(classes).toContain("max-sm:bg-background/90")
    expect(classes.some((c) => c.includes("15.5rem"))).toBe(false)
  })

  test("Fit keeps the top pill row and the bottom toolbar row clear below sm", () => {
    expect(insetFor(375)).toEqual({ top: 48, bottom: 64 })
  })
})
