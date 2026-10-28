import { describe, expect, test } from "bun:test"
import { CELL_TEXT_PX, cellColor, HIT_PX, hitStroke, cellInk, cellText, extent, flowLayout, frameCount, linePaths, matrixRange, paletteOf, scale, scatterScales, tokenColorOf, tokenHeat, tokenRange } from "./visual-layout.js"

describe("preview visual geometry", () => {
  test("scale and extent: finite numbers only; a flat domain maps to the middle", () => {
    expect(scale([0, 10], [0, 100])(5)).toBe(50)
    expect(scale([3, 3], [0, 100])(3)).toBe(50)
    expect(extent([[1, null, 5], [-2, NaN]])).toEqual([-2, 5])
    expect(extent([])).toEqual([0, 1])
  })

  test("matrix: one colour range over every frame; diverging is symmetric; colours on black", () => {
    const v = { frames: [{ values: [[0, 1]] }, { values: [[-3, 2]] }] }
    expect(matrixRange(v)).toEqual([-3, 2])
    expect(matrixRange({ ...v, diverging: true })).toEqual([-3, 3])
    expect(matrixRange({ ...v, range: [0, 9] })).toEqual([0, 9])
    expect(cellColor(null, [0, 1])).toBe("oklch(0.25 0 0)")
    expect(cellColor(0, [0, 1])).toBe("oklch(0.180 0.050 290.0)")
    expect(cellColor(1, [0, 1])).toBe("oklch(0.880 0.210 220.0)")
    expect(cellColor(-3, [-3, 3], true)).toBe("oklch(0.760 0.190 250)")
    expect(cellColor(1.5, [-3, 3], true)).toBe("oklch(0.460 0.105 25)")
  })

  test("flowLayout: groups are columns; without groups, depth from the sources; order follows columns", () => {
    const dec = flowLayout({ nodes: [{ id: "emb" }, { id: "attn" }, { id: "mlp" }, { id: "out" }], edges: [{ from: "emb", to: "attn" }, { from: "attn", to: "mlp" }, { from: "mlp", to: "out" }, { from: "emb", to: "out" }] }, { width: 600, height: 200, pad: 50 })
    expect(dec.cols).toBe(4)
    expect(dec.nodes.map((n) => [n.id, n.col, n.x])).toEqual([
      ["emb", 0, 50],
      ["attn", 1, 216.66666666666666],
      ["mlp", 2, 383.3333333333333],
      ["out", 3, 550],
    ])
    expect(dec.order).toEqual(["emb", "attn", "mlp", "out"])
    expect(dec.edges[0].path).toBe("M50.0,100.0 C133.3,100.0 133.3,100.0 216.7,100.0")
    const grouped = flowLayout({ nodes: [{ id: "a", group: "enc" }, { id: "b", group: "dec" }, { id: "c", group: "enc" }], edges: [] }, { width: 400, height: 300, pad: 40 })
    expect(grouped.nodes.map((n) => [n.id, n.col, n.y])).toEqual([
      ["a", 0, 100],
      ["b", 1, 150],
      ["c", 0, 200],
    ])
    const loop = flowLayout({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] })
    expect(loop.cols).toBeLessThanOrEqual(2)
    const down = flowLayout({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }], direction: "down" }, { width: 200, height: 400, pad: 50 })
    expect(down.nodes.map((n) => [n.x, n.y])).toEqual([
      [100, 50],
      [100, 350],
    ])
    expect(flowLayout({ nodes: [{ id: "a" }, { id: "b" }], edges: [], order: ["b", "a"] }).order).toEqual(["b", "a"])
  })

  test("linePaths and scatterScales: one domain over every series and frame", () => {
    const l = linePaths({ series: [{ name: "a", points: [[0, 10], [10, 0]] }, { name: "b", points: [[5, 5], [null, 1]] }], marks: [{ x: 20, label: "lr drop" }] }, { width: 200, height: 100, pad: 20 })
    expect(l.xs).toEqual([0, 20])
    expect(l.series[0].d).toBe("M20.0,10.0 L105.0,80.0")
    expect(l.series[1].last).toEqual([5, 5])
    expect(l.marks[0].px).toBe(190)
    const { sx, sy } = scatterScales({ frames: [{ points: [{ x: 0, y: 0 }] }, { points: [{ x: 10, y: 4 }] }] }, { width: 100, height: 100, pad: 10 })
    expect([sx(10), sy(4)]).toEqual([90, 10])
    expect(frameCount({ frames: [1, 2, 3] })).toBe(3)
    expect(frameCount({ steps: [] })).toBe(1)
    const color = paletteOf(["dec-only", "enc-dec", "dec-only"])
    expect([color("dec-only"), color("enc-dec")]).toEqual(["#d946ef", "#38bdf8"])
  })

  test("2026-10-17 token heat: by surprisal (hot = surprising), p (hot = unlikely) or entropy; a translucent tint; the range", () => {
    const v = { tokens: [{ text: "a", p: 0.5, surprisal: 1 }, { text: "b", p: 0.01, surprisal: 6.64 }, { text: "c" }] }
    expect(tokenColorOf(v)).toBe("surprisal")
    expect(tokenColorOf({ tokens: [{ p: 0.5 }] })).toBe("p")
    expect(tokenColorOf({ tokens: [{ text: "x" }] })).toBeNull()
    expect(tokenColorOf({ ...v, color: "entropy" })).toBe("entropy")
    expect(tokenRange(v)).toEqual([0, 6.64])
    expect(tokenRange({ ...v, range: [0, 16] })).toEqual([0, 16])
    expect(tokenRange(v, "p")).toEqual([0, 1])
    expect(tokenHeat(v.tokens[1], "surprisal", [0, 6.64]).level).toBe(1)
    expect(tokenHeat(v.tokens[0], "p", [0, 1]).level).toBe(0.5)
    expect(tokenHeat(v.tokens[1], "p", [0, 1]).level).toBeCloseTo(0.99)
    expect(tokenHeat(v.tokens[2], "surprisal", [0, 6.64])).toBeNull()
    expect(tokenHeat(v.tokens[1], "surprisal", [0, 6.64]).bg).toBe("oklch(0.72 0.17 50.0 / 0.560)")
  })

  test("2026-10-17 matrix cells: a frame's own text, else the visual's; ink that reads on the cell", () => {
    const v = { cells: [["a", "b"]], frames: [{ values: [[0, 1]] }, { values: [[0, 1]], cells: [["x", "y"]] }] }
    expect(cellText(v, v.frames[0], 0, 1)).toBe("b")
    expect(cellText(v, v.frames[1], 0, 1)).toBe("y")
    expect(cellText({ frames: [] }, {}, 0, 0)).toBe("")
    expect(CELL_TEXT_PX).toBe(24)
    expect(cellInk(1, [0, 1])).toBe("oklch(0.15 0 0)") // the bright end: dark ink
    expect(cellInk(0, [0, 1])).toBe("oklch(0.95 0 0)")
    expect(cellInk(null, [0, 1])).toBe("oklch(0.9 0 0)")
  })

  test("2026-10-17 touch targets: a transparent stroke makes a small mark ≥ 40 px across on a coarse pointer, nothing on a fine one", () => {
    expect(HIT_PX).toBe(40)
    expect(hitStroke(false, 1, 10)).toBe(0)
    expect(hitStroke(true, 1, 10)).toBe(30) // a 10-unit point drawn 1:1: 10 + 30 = 40 px
    expect(hitStroke(true, 0.5, 9)).toBe(71) // a label drawn at half size: (9 + 71) × 0.5 = 40 px
    expect(hitStroke(true, 2, 50)).toBe(0) // already big enough
  })

  test("2026-10-27 matrixRange: no frames, null frames or a malformed range never throw; the empty range is safe", () => {
    expect(matrixRange({})).toEqual([0, 1])
    expect(matrixRange({ frames: [] })).toEqual([0, 1])
    expect(matrixRange({ diverging: true })).toEqual([-1, 1])
    expect(matrixRange({ frames: [null, { values: [[2, 4]] }, {}] })).toEqual([2, 4])
    expect(matrixRange({ range: [0], frames: [{ values: [[1, 3]] }] })).toEqual([1, 3])
    expect(matrixRange({ range: ["a", 2], frames: [] })).toEqual([0, 1])
    expect(matrixRange({ range: [0, NaN], frames: [{ values: [[-2, 1]] }], diverging: true })).toEqual([-2, 2])
  })
})

