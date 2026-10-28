import { describe, expect, test } from "bun:test"

import { engineTone } from "@/lib/engine-tone"
import { footerClasses, hostParts, leftClasses, modelClasses, rightClasses, stripNameClasses } from "./strip-name"

describe("agents-strip-names: the strip's agent entry at 375", () => {
  test("the name reads with a readable cut, never hidden or swapped for initials", () => {
    const name = stripNameClasses().name.split(" ")
    for (const c of ["truncate", "min-w-0", "max-w-[9ch]", "sm:max-w-24"]) expect(name).toContain(c)
    expect(name).not.toContain("sm:hidden")
    expect(name).not.toContain("max-sm:hidden")
  })
  test("the entry is a 40px target below sm and dense from sm up", () => {
    const item = stripNameClasses().item.split(" ")
    expect(item).toContain("min-h-10")
    expect(item).toContain("sm:min-h-0")
  })
})
describe("strip-fit: the status footer holds the 40px entries at 375", () => {
  test("the footer is 40px below sm on any pointer and 28px from sm up", () => {
    const footer = footerClasses().split(" ")
    expect(footer).toContain("h-10")
    expect(footer).toContain("sm:h-7")
    expect(footerClasses()).not.toContain("pointer-coarse")
  })
})
describe("phone-footer-clear: the footer clears the Next dev badge at 375", () => {
  test("the footer pads its left side below sm only and keeps its heights", () => {
    const footer = footerClasses().split(" ")
    for (const c of ["max-sm:pl-16", "h-10", "sm:h-7"]) expect(footer).toContain(c)
    expect(footer).not.toContain("pl-16")
  })
})
describe("strip-name-ellipsis: the running text gives way before the names at 375", () => {
  test("the running text shrinks first and truncates; the name truncates with an ellipsis", () => {
    const running = stripNameClasses().running.split(" ")
    for (const c of ["shrink-[999]", "min-w-0", "truncate"]) expect(running).toContain(c)
    const name = stripNameClasses().name.split(" ")
    for (const c of ["truncate", "min-w-0"]) expect(name).toContain(c)
  })
})
describe("running-cue-375: the running agent shows a visible cue at 375", () => {
  test("below sm the running text is for screen readers only, and its item leaves no gap", () => {
    const text = stripNameClasses().runningText.split(" ")
    for (const c of ["max-sm:sr-only", "truncate"]) expect(text).toContain(c)
    for (const c of ["hidden", "max-sm:hidden"]) expect(text).not.toContain(c)
    expect(stripNameClasses().activity.split(" ")).toContain("max-sm:px-0")
  })
  test("a running agent's strip dot pulses", () => {
    expect(engineTone({ status: "running" }).dot.split(" ")).toContain("animate-pulse")
  })
})
describe("strip-dev-dup: the host entry differs from the dev agent", () => {
  test("a local desk reads \"desk <name>\" and its title names the root", () => {
    const p = hostParts({ mode: "local", root: "/x/powerhouse", desk: { name: "dev" } })
    expect(p.label).toBe("desk dev")
    expect(p.title).toContain("/x/powerhouse")
    expect(p.aria).toContain("/x/powerhouse")
    expect(p.icon).toContain("text-emerald-500")
  })
  test("a local desk with no name falls back to the root's folder", () => {
    expect(hostParts({ mode: "local", root: "/x/powerhouse/" }).label).toBe("desk powerhouse")
  })
  test("browser and none give their words and tones; no host gives null", () => {
    const browser = hostParts({ mode: "browser" })
    expect(browser.label).toBe("This browser")
    expect(browser.icon).toContain("emerald")
    const none = hostParts({ mode: "none" })
    expect(none.label).toBe("No desk")
    expect(none.icon).toContain("amber")
    expect(hostParts(null)).toBeNull()
  })
})
describe("strip-default-clip: the right group keeps \"default\" whole at 375", () => {
  test("below sm the right group keeps its width; from sm up it yields first", () => {
    const right = rightClasses().split(" ")
    for (const c of ["max-sm:shrink-0", "max-sm:min-w-fit", "shrink-[999]", "justify-end"]) expect(right).toContain(c)
    expect(right).not.toContain("shrink-0")
  })
})
describe("strip-names-fit: the last agent name reads whole or fades at 375", () => {
  test("below sm the model is an icon and its name is for screen readers only", () => {
    const { label, icon } = modelClasses()
    for (const c of ["max-sm:sr-only", "truncate"]) expect(label.split(" ")).toContain(c)
    expect(icon.split(" ")).toContain("sm:hidden")
  })
  test("the left group scrolls and fades its right edge below sm; names still truncate", () => {
    const left = leftClasses()
    for (const c of ["min-w-0", "overflow-x-auto"]) expect(left.split(" ")).toContain(c)
    expect(left).toContain("max-sm:[mask-image")
    const name = stripNameClasses().name.split(" ")
    for (const c of ["truncate", "min-w-0"]) expect(name).toContain(c)
  })
})
describe("strip-critic-clip-375: the last agent name ends in an ellipsis at 375", () => {
  test("below sm the last entry shrinks and pads clear of the fade; from sm up it is untouched", () => {
    const item = stripNameClasses().item.split(" ")
    for (const c of ["max-sm:last:shrink", "max-sm:last:pr-6"]) expect(item).toContain(c)
    expect(item).not.toContain("shrink")
    expect(item).not.toContain("last:shrink")
    const name = stripNameClasses().name.split(" ")
    for (const c of ["truncate", "min-w-0"]) expect(name).toContain(c)
  })
})

describe("strip-name-js-spacing: every host outcome has words for screen readers", () => {
  test("local, browser and none each give a non-empty aria", () => {
    for (const host of [{ mode: "local", root: "/x/powerhouse/" }, { mode: "browser" }, { mode: "none" }]) {
      const { aria } = hostParts(host)
      expect(typeof aria).toBe("string")
      expect(aria.length).toBeGreaterThan(0)
    }
  })
})
