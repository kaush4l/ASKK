import { describe, expect, test } from "bun:test"
import { cellColor, extent, flowLayout, frameCount, linePaths, matrixRange, paletteOf, scale, scatterScales } from "./visual-layout.js"

describe("stage visual geometry", () => {
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
})
