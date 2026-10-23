import { describe, expect, test } from "bun:test"
import { optionRows, statusOf } from "./models.js"
import { bigEnough, boxFrom, marksText, nextZoom, placeOf, presetOptions } from "./studio.js"

describe("models panel helpers", () => {
  test("option rows: the owner's value, else the default; changed marked", () => {
    const rows = optionRows({ options: { steps: { type: "number", default: 20, min: 4, max: 80 }, low_ram: { type: "bool", default: false, flag: "--low-ram" } }, values: { steps: 28 } })
    expect(rows).toEqual([
      expect.objectContaining({ name: "steps", value: 28, def: 20, changed: true, min: 4 }),
      expect.objectContaining({ name: "low_ram", value: false, changed: false, flag: "--low-ram" }),
    ])
  })
  test("status: ready, missing programs, a broken file", () => {
    expect(statusOf({ ok: true, missing: [] })).toBe("ready")
    expect(statusOf({ ok: true, missing: ["mlx_audio.server"] })).toBe("not installed: mlx_audio.server")
    expect(statusOf({ ok: false, problem: "engine: one of say" })).toBe("engine: one of say")
  })
})

describe("studio marks", () => {
  test("a box from two points in any direction, clamped; too small refused", () => {
    expect(boxFrom({ x: 0.8, y: 0.9 }, { x: 0.6, y: 1.2 })).toEqual({ x: 0.6, y: 0.9, w: expect.closeTo(0.2), h: expect.closeTo(0.1) })
    expect(bigEnough(boxFrom({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.6 }))).toBe(false)
  })
  test("where a mark is, in words; the feedback line", () => {
    expect(placeOf({ x: 0.7, y: 0.05, w: 0.25, h: 0.2 })).toBe("top-right")
    expect(placeOf({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).toBe("middle-center")
    expect(marksText([{ x: 0, y: 0.8, w: 0.2, h: 0.2, note: "a dog here" }, { x: 0.4, y: 0, w: 0.2, h: 0.1 }])).toBe("1 (bottom-left): a dog here; 2 (top-center): change this")
  })
  test("zoom steps and preset choices", () => {
    expect(nextZoom(1, 1)).toBe(1.5)
    expect(nextZoom(4, 1)).toBe(4)
    expect(nextZoom(1.4, -1)).toBe(1)
    expect(presetOptions({ presets: [{ name: "photo", title: "Photograph" }] }, { auto: true }).map((o) => o.value)).toEqual(["auto", "none", "photo"])
  })
})
