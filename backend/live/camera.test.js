import { describe, expect, test } from "bun:test"

import { MAX_Z, MIN_Z, NEAR_FROM, clampZ, fit, focus, glide, nearZoom, panBy, toScreen, toWorld, zoomAt, zoomLevel } from "./camera.js"
import { followTarget, questsOut } from "./follow-target.js"

const viewport = { w: 1000, h: 700 }

describe("camera", () => {
  test("zoomAt keeps the point under the cursor fixed, in and out, clamped", () => {
    const cam = { x: 120, y: -40, z: 0.8 }
    const cursor = { x: 333, y: 512 }
    const world = toWorld(cam, cursor)
    for (const factor of [1.25, 0.5, 1 / 0.9, 40, 0.001]) {
      const next = zoomAt(cam, factor, cursor)
      const back = toScreen(next, world)
      expect(back.x).toBeCloseTo(cursor.x, 6)
      expect(back.y).toBeCloseTo(cursor.y, 6)
      expect(next.z).toBeGreaterThanOrEqual(MIN_Z)
      expect(next.z).toBeLessThanOrEqual(MAX_Z)
    }
    expect(zoomAt(cam, 40, cursor).z).toBe(MAX_Z)
    expect(zoomAt(cam, 0.001, cursor).z).toBe(MIN_Z)
    expect(clampZ(Number.NaN)).toBe(1)
  })

  test("panBy moves the camera, not the zoom", () => {
    expect(panBy({ x: 1, y: 2, z: 1.5 }, 10, -20)).toEqual({ x: 11, y: -18, z: 1.5 })
  })

  test("fit contains the bounds, centred, never past 100%", () => {
    const bounds = { x: -300, y: 50, w: 2400, h: 900 }
    const cam = fit(bounds, viewport, 32)
    const tl = toScreen(cam, { x: bounds.x, y: bounds.y })
    const br = toScreen(cam, { x: bounds.x + bounds.w, y: bounds.y + bounds.h })
    expect(tl.x).toBeGreaterThanOrEqual(32 - 1e-6)
    expect(tl.y).toBeGreaterThanOrEqual(0)
    expect(br.x).toBeLessThanOrEqual(viewport.w - 32 + 1e-6)
    expect(br.y).toBeLessThanOrEqual(viewport.h)
    expect((tl.x + br.x) / 2).toBeCloseTo(viewport.w / 2, 6)
    expect((tl.y + br.y) / 2).toBeCloseTo(viewport.h / 2, 6)
    // Controls floating over the top and bottom edges stay clear.
    const clear = fit(bounds, viewport, 32, { top: 60, bottom: 50 })
    expect(toScreen(clear, { x: 0, y: bounds.y }).y).toBeGreaterThanOrEqual(60 + 32 - 1e-6)
    expect(toScreen(clear, { x: 0, y: bounds.y + bounds.h }).y).toBeLessThanOrEqual(viewport.h - 50 - 32 + 1e-6)
    expect(fit({ x: 0, y: 0, w: 100, h: 100 }, viewport).z).toBe(1)
    expect(fit({ x: 0, y: 0, w: 0, h: 0 }, viewport).z).toBe(1)
  })

  test("focus centres a rect; nearZoom is near and fits the card", () => {
    const rect = { x: 500, y: 900, w: 240, h: 320 }
    const z = nearZoom(rect, viewport)
    expect(zoomLevel(z)).toBe("near")
    const cam = focus(rect, viewport, z)
    const c = toScreen(cam, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 })
    expect(c.x).toBeCloseTo(viewport.w / 2, 6)
    expect(c.y).toBeCloseTo(viewport.h / 2, 6)
    expect(nearZoom(rect, { w: 390, h: 640 })).toBeGreaterThan(NEAR_FROM)
  })

  test("zoomLevel thresholds: far < 0.55 ≤ mid < 1.4 ≤ near", () => {
    expect(zoomLevel(0.2)).toBe("far")
    expect(zoomLevel(0.4)).toBe("far")
    expect(zoomLevel(0.549)).toBe("far")
    expect(zoomLevel(0.55)).toBe("mid")
    expect(zoomLevel(1)).toBe("mid")
    expect(zoomLevel(1.399)).toBe("mid")
    expect(zoomLevel(1.4)).toBe("near")
    expect(zoomLevel(1.8)).toBe("near")
    expect(zoomLevel(3)).toBe("near")
  })

  test("glide starts at from, ends at to, zooms geometrically in between", () => {
    const from = { x: 0, y: 0, z: 0.25 }
    const to = { x: -400, y: -300, z: 1 }
    expect(glide(from, to, 0, viewport)).toEqual(from)
    expect(glide(from, to, 1, viewport)).toEqual(to)
    expect(glide(from, to, 0.5, viewport).z).toBeCloseTo(0.5, 6)
  })
})

describe("followTarget", () => {
  const tree = {
    name: "lead",
    children: [
      { name: "a", children: [{ name: "a1", children: [] }, { name: "a2", children: [] }] },
      { name: "b", children: [{ name: "b1", children: [] }] },
    ],
  }
  const idle = { status: "idle", activity: { phase: "idle" }, messages: [] }
  const run = (phase, since = null, extra = {}) => ({ status: "running", activity: { phase, ...(since ? { since } : {}) }, messages: [], ...extra })

  test("nothing running → null", () => {
    expect(followTarget(tree, { lead: idle, a: idle, a1: idle })).toBeNull()
    expect(followTarget(tree, new Map())).toBeNull()
    expect(followTarget(null, {})).toBeNull()
    // Done, errored or idle-between-steps agents are not work to follow.
    expect(followTarget(tree, { lead: { status: "error", activity: { phase: "llm" } }, a: { status: "idle", activity: { phase: "llm" } } })).toBeNull()
  })

  test("the deepest running agent wins", () => {
    const states = new Map([
      ["lead", { status: "running", activity: { phase: "waiting", names: ["a", "b"] } }],
      ["a", run("tools", "2026-10-16T10:00:00Z")],
      ["a1", run("llm")],
    ])
    expect(followTarget(tree, states)).toBe("a1")
    expect(followTarget(tree, { lead: run("llm"), a: run("tool") })).toBe("a")
    // A lead waiting for reports (idle between steps) is still work.
    expect(followTarget(tree, { lead: { status: "idle", activity: { phase: "waiting", names: ["a"] } } })).toBe("lead")
  })

  test("ties at one depth go to the step that started last", () => {
    const states = { a1: run("tool", "2026-10-16T10:00:00Z"), b1: run("tools", "2026-10-16T10:05:00Z"), a2: run("llm", null, { working: { at: "2026-10-16T09:00:00Z" } }) }
    expect(followTarget(tree, states)).toBe("b1")
  })

  test("questsOut: the agents a lead has a quest out to", () => {
    expect([...questsOut({ activity: { phase: "tools", calls: [{ name: "a", kind: "agent" }, { name: "web.read", kind: "tool" }] } })]).toEqual(["a"])
    expect([...questsOut({ activity: { phase: "waiting", names: ["a", "b"] } })].sort()).toEqual(["a", "b"])
    expect(questsOut(null).size).toBe(0)
  })
})
