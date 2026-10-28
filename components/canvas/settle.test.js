import { describe, expect, test } from "bun:test"

import { fitKey, glideTarget, openDue, refitDue } from "./settle"

describe("canvas-camera-settle", () => {
  const tree = { name: "dev" }
  const viewport = { w: 375, h: 812 }

  test("the same desk and viewport keep the key, whatever the artifacts", () => {
    const before = fitKey({ tree, viewport, artifacts: { goal: { owner: "dev" } }, wrap: 1 })
    const after = fitKey({ tree, viewport, artifacts: { goal: { owner: "dev" }, files: { owner: "coder" } }, wrap: 3 })
    expect(after).toBe(before)
  })

  test("a new desk changes the key", () => {
    expect(fitKey({ tree: { name: "agent" }, viewport })).not.toBe(fitKey({ tree, viewport }))
  })

  test("a new width or height changes the key", () => {
    expect(fitKey({ tree, viewport: { w: 1280, h: 812 } })).not.toBe(fitKey({ tree, viewport }))
    expect(fitKey({ tree, viewport: { w: 375, h: 700 } })).not.toBe(fitKey({ tree, viewport }))
  })

  test("no tree or viewport yet still gives a key", () => {
    expect(fitKey({ tree: null, viewport: { w: 0, h: 0 } })).toBe("undefined|0x0")
  })
})

describe("canvas-open-hold", () => {
  const small = fitKey({ tree: { name: "dev" }, viewport: { w: 375, h: 812 } })
  const shorter = fitKey({ tree: { name: "dev" }, viewport: { w: 375, h: 760 } })
  const other = fitKey({ tree: { name: "agent" }, viewport: { w: 375, h: 812 } })

  test("first sight always refits", () => {
    expect(refitDue({ fitted: null, shown: small, held: false })).toBe(true)
    expect(refitDue({ fitted: null, shown: small, held: true })).toBe(true)
  })

  test("the same key never refits", () => {
    expect(refitDue({ fitted: small, shown: small, held: false })).toBe(false)
  })

  test("a new size refits only before the owner holds the camera", () => {
    expect(refitDue({ fitted: small, shown: shorter, held: false })).toBe(true)
    expect(refitDue({ fitted: small, shown: shorter, held: true })).toBe(false)
  })

  test("a new desk refits even once held", () => {
    expect(refitDue({ fitted: small, shown: other, held: true })).toBe(true)
  })
})

describe("canvas-open-dip", () => {
  const to = { x: -120, y: -340, z: 1.56 }

  test("the same card, the camera already on it, never glides again", () => {
    expect(openDue({ opened: "goal", id: "goal", cam: { ...to }, to })).toBe(false)
    expect(openDue({ opened: "goal", id: "goal", cam: { x: -119.5, y: -340.5, z: 1.565 }, to })).toBe(false)
  })

  test("a new card glides", () => {
    expect(openDue({ opened: "goal", id: "files", cam: { ...to }, to })).toBe(true)
    expect(openDue({ opened: null, id: "goal", cam: { x: 10, y: 10, z: 0.43 }, to })).toBe(true)
  })

  test("the same card after a hand moved the camera (opened cleared) glides", () => {
    expect(openDue({ opened: null, id: "goal", cam: { ...to }, to })).toBe(true)
    expect(openDue({ opened: "goal", id: "goal", cam: { x: 40, y: -340, z: 1.56 }, to })).toBe(true)
  })
})

describe("canvas-open-dip glideTarget", () => {
  const on = { x: -120, y: -340, z: 1.56 }
  const fitTo = { x: 12, y: 40, z: 0.43 }

  test("work to follow glides to it", () => {
    expect(glideTarget({ opened: "goal", rect: on, fitTo })).toBe(on)
    expect(glideTarget({ opened: null, rect: on, fitTo })).toBe(on)
  })

  test("an opened card with no work to follow holds the camera", () => {
    expect(glideTarget({ opened: "goal", rect: null, fitTo })).toBe(null)
  })

  test("nothing opened and no work to follow fits the desk", () => {
    expect(glideTarget({ opened: null, rect: null, fitTo })).toBe(fitTo)
  })
})
