import { describe, expect, test } from "bun:test"
import { bubbleClasses, capClasses, capEdge, stepLoadLabel } from "./thread-bubble.js"

describe("thread-bubble-375: a Turns bubble wraps whole at 375", () => {
  test("the row may shrink below its content, and the user's row is reversed", () => {
    const row = bubbleClasses({}).row.split(" ")
    expect(row).toContain("flex")
    expect(row).toContain("min-w-0")
    expect(row).toContain("gap-3")
    expect(row).not.toContain("flex-row-reverse")
    expect(bubbleClasses({ isUser: true }).row.split(" ")).toContain("flex-row-reverse")
  })

  test("the avatar never gives way", () => {
    expect(bubbleClasses({}).avatar.split(" ")).toEqual(["size-8", "shrink-0"])
  })

  test("plain text wraps at words and breaks a long one anywhere", () => {
    const text = bubbleClasses({ isUser: true }).text.split(" ")
    expect(text).toContain("whitespace-pre-wrap")
    expect(text).toContain("break-words")
    expect(text).toContain("[overflow-wrap:anywhere]")
    expect(text).not.toContain("break-all")
  })

  test("a step keeps its mono break-all", () => {
    const text = bubbleClasses({ step: true }).text.split(" ")
    expect(text).toContain("whitespace-pre-wrap")
    expect(text).toContain("font-mono")
    expect(text).toContain("text-xs")
    expect(text).toContain("break-all")
  })
})

describe("bubble-scroll-fade: a capped bubble cues the text below", () => {
  test("the cap always scrolls inside half the viewport", () => {
    for (const edge of [{}, { overflowing: true, atEnd: false }]) {
      const cap = capClasses(edge).split(" ")
      expect(cap).toContain("max-h-[50svh]")
      expect(cap).toContain("overflow-y-auto")
      expect(cap).toContain("overscroll-contain")
    }
  })

  test("the bottom fades only while it overflows and is not at its end", () => {
    expect(capClasses({ overflowing: true, atEnd: false })).toContain("[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]")
    expect(capClasses({ overflowing: true, atEnd: true })).not.toContain("mask-image")
    expect(capClasses({ overflowing: false, atEnd: true })).not.toContain("mask-image")
    expect(capClasses()).not.toContain("mask-image")
  })

  test("the edge: overflowing at the top, at its end after the last scroll, short text never overflows", () => {
    expect(capEdge({ scrollHeight: 1200, clientHeight: 406, scrollTop: 0 })).toEqual({ overflowing: true, atEnd: false })
    expect(capEdge({ scrollHeight: 1200, clientHeight: 406, scrollTop: 793.5 })).toEqual({ overflowing: true, atEnd: true })
    expect(capEdge({ scrollHeight: 80, clientHeight: 80, scrollTop: 0 })).toEqual({ overflowing: false, atEnd: true })
  })
})

describe("stepLoadLabel (full-step-failed-note)", () => {
  test("loading reads Loading… with no destructive tone", () => {
    const label = stepLoadLabel({ loading: true })
    expect(label.text).toBe("Loading…")
    expect(label.className).not.toContain("text-destructive")
  })

  test("failed says the thread moved, in the destructive tone", () => {
    const label = stepLoadLabel({ failed: true })
    expect(label.text).toBe("Not loaded: the thread moved — reload")
    expect(label.className).toContain("text-destructive")
  })

  test("idle offers Show full step with no destructive tone", () => {
    const label = stepLoadLabel()
    expect(label.text).toBe("Show full step")
    expect(label.className).not.toContain("text-destructive")
  })
})
