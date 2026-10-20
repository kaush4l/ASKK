// Visual specs an agent builds for the preview (backend/kernel/builtin/visual.js, 2026-10-17): each kind normalized,
// what is wrong said plainly, sizes capped, one line per visual for the prompt.

import { describe, expect, test } from "bun:test"
import { checkParams, checkVisual, linksOf, metaLine, VISUAL_KINDS, visualBrief } from "../builtin/visual.js"

describe("visual specs", () => {
  test("flow: nodes and edges checked, groups kept, order filtered to known nodes", () => {
    const v = checkVisual({ kind: "flow", title: "decoder-only", nodes: [{ id: "emb", label: "embed", group: 0 }, { id: "attn", group: 1, note: "causal mask" }, "out"], edges: [{ from: "emb", to: "attn", weight: "0.8" }, { from: "attn", to: "out" }], order: ["emb", "ghost", "attn"] })
    expect(v).toEqual({ kind: "flow", title: "decoder-only", nodes: [{ id: "emb", label: "embed", group: "0" }, { id: "attn", label: "attn", group: "1", note: "causal mask" }, { id: "out", label: "out" }], edges: [{ from: "emb", to: "attn", weight: 0.8 }, { from: "attn", to: "out" }], direction: "right", order: ["emb", "attn"] })
    expect(visualBrief(v)).toBe("flow 3 nodes, 2 edges")
    expect(() => checkVisual({ kind: "flow", nodes: ["a"], edges: [{ from: "a", to: "b" }] })).toThrow("edges[0]: a → b names a node that is not listed")
    expect(() => checkVisual({ kind: "flow", nodes: ["a", "a"] })).toThrow("nodes: ids must be unique")
  })

  test("matrix: one grid or frames of the same shape; labels must fit; 64 × 64 and 80 000 numbers at most", () => {
    const v = checkVisual({ kind: "matrix", rows: ["a", "b"], cols: ["x", "y"], values: [[0.1, "nope"], [0.3, 0.4]], range: [-1, 1], diverging: true })
    expect(v).toEqual({ kind: "matrix", frames: [{ values: [[0.1, null], [0.3, 0.4]] }], rows: ["a", "b"], cols: ["x", "y"], range: [-1, 1], diverging: true })
    expect(visualBrief(checkVisual({ kind: "matrix", frames: [{ label: "step 0", values: [[1]] }, { label: "step 50", values: [[2]] }] }))).toBe("matrix 1×1, 2 frames")
    expect(() => checkVisual({ kind: "matrix", frames: [{ values: [[1, 2]] }, { values: [[1]] }] })).toThrow("frames[1]: 1 × 1, the first is 1 × 2")
    expect(() => checkVisual({ kind: "matrix", values: [[1, 2], [3]] })).toThrow("row 1 has 1 values, the first has 2")
    expect(() => checkVisual({ kind: "matrix", values: Array.from({ length: 65 }, () => [1]) })).toThrow("at most 64 × 64")
    const big = Array.from({ length: 64 }, () => Array(64).fill(0))
    expect(() => checkVisual({ kind: "matrix", frames: Array.from({ length: 20 }, () => ({ values: big })) }, { maxChars: 1e9 })).toThrow("at most 80 000 numbers")
    expect(() => checkVisual({ kind: "matrix", rows: ["a"], values: [[1], [2]] })).toThrow("rows: 1 labels for 2")
  })

  test("steps, line, bars, tokens, scatter normalize; frames where they replay", () => {
    expect(checkVisual({ kind: "steps", steps: ["tokenize", { title: "embed", detail: "4096 × 448", value: 1.8 }] })).toEqual({ kind: "steps", steps: [{ title: "tokenize" }, { title: "embed", detail: "4096 × 448", value: "1.8" }] })
    expect(checkVisual({ kind: "line", series: [{ name: "dec-only", points: [[0, 8.3], { x: 100, y: 3.1 }] }], x: "step", y: "loss" })).toEqual({ kind: "line", series: [{ name: "dec-only", points: [[0, 8.3], [100, 3.1]] }], x: "step", y: "loss" })
    expect(checkVisual({ kind: "bars", bars: [{ label: "the", value: 0.4 }, ["a", 0.2]] }).frames[0].bars).toEqual([{ label: "the", value: 0.4 }, { label: "a", value: 0.2 }])
    expect(checkVisual({ kind: "tokens", prompt: "Once", tokens: [{ text: " upon", p: 0.9, top: [[" upon", 0.9], [" there", 0.05]] }] }).tokens[0]).toEqual({ text: " upon", p: 0.9, surprisal: 0.152, top: [[" upon", 0.9], [" there", 0.05]] }) // surprisal: −log2 p
    const sc = checkVisual({ kind: "scatter", frames: [{ label: "layer 0", points: [[0, 1], { x: 2, y: 3, label: "She", group: "t" }] }], trails: true })
    expect(sc.frames[0].points).toEqual([{ x: 0, y: 1 }, { x: 2, y: 3, label: "She", group: "t" }])
    expect(visualBrief(sc)).toBe("scatter 2 points")
  })

  test("compare: two or three visuals side by side, each checked, never nested", () => {
    const v = checkVisual({
      kind: "compare",
      title: "encoder-decoder vs decoder-only",
      sides: [
        { title: "encoder-decoder", note: "cross-attention reads the source", visual: { kind: "flow", nodes: ["src", "enc", "dec"], edges: [{ from: "src", to: "enc" }, { from: "enc", to: "dec", label: "cross-attn" }] } },
        { title: "decoder-only", visual: { kind: "flow", nodes: ["prompt", "dec"], edges: [{ from: "prompt", to: "dec" }] } },
      ],
      verdict: "same params: decoder-only reaches val_bpb 0.70 vs 0.74",
    })
    expect(v.sides.map((s) => s.title)).toEqual(["encoder-decoder", "decoder-only"])
    expect(v.sides[0].visual.edges[1]).toEqual({ from: "enc", to: "dec", label: "cross-attn" })
    expect(visualBrief(v)).toBe("compare encoder-decoder (flow 3 nodes, 2 edges) vs decoder-only (flow 2 nodes, 1 edges)")
    expect(() => checkVisual({ kind: "compare", sides: [{ visual: { kind: "steps", steps: ["a"] } }] })).toThrow("sides: 1 — two or three")
    expect(() => checkVisual({ kind: "compare", sides: [{ visual: { kind: "compare" } }, { visual: { kind: "steps", steps: ["a"] } }] })).toThrow("sides[0].visual: a visual of one kind")
    expect(() => checkVisual({ kind: "compare", sides: [{ visual: { kind: "steps", steps: [] } }, { visual: { kind: "steps", steps: ["a"] } }] })).toThrow("sides[0].visual: steps: at least one")
  })

  test("the kind, JSON text and size limits", () => {
    expect(VISUAL_KINDS).toEqual(["flow", "steps", "matrix", "line", "bars", "tokens", "scatter", "compare"])
    expect(checkVisual('{"kind": "steps", "steps": ["a"]}').steps).toEqual([{ title: "a" }])
    expect(() => checkVisual("{nope")).toThrow("visual: not JSON")
    expect(() => checkVisual({ kind: "pie" })).toThrow('visual.kind: "pie" — one of flow, steps')
    expect(() => checkVisual([1])).toThrow("visual: an object with a kind")
    expect(() => checkVisual({ kind: "steps", steps: Array(30).fill("x".repeat(100)) }, { maxChars: 1000 })).toThrow("a larger one goes in a file")
  })

  test("2026-10-17 token detail: surprisal (given or −log2 p), target, id, the heat's colour and range; open links; meta", () => {
    const v = checkVisual({ kind: "tokens", color: "surprisal", range: [0, 16], meta: { run: "r04", step: 1700, cfg: { n_layer: 6 } }, tokens: [{ text: "rā", id: 812, p: 0.125, target: "rā", top: [["rā", 0.125]], open: { id: "tok", params: { run: "r04", t: 0 } } }, { text: "ma", surprisal: 3.2, p: 0.5 }, { text: "x", p: 0 }] })
    expect(v.tokens[0]).toEqual({ text: "rā", id: 812, p: 0.125, surprisal: 3, target: "rā", top: [["rā", 0.125]], open: { id: "tok", params: { run: "r04", t: "0" } } })
    expect(v.tokens[1].surprisal).toBe(3.2) // given wins
    expect(v.tokens[2].surprisal).toBeUndefined() // p 0: no finite surprisal
    expect(v).toMatchObject({ color: "surprisal", range: [0, 16], meta: { run: "r04", step: 1700, cfg: '{"n_layer":6}' } })
    expect(metaLine(v.meta)).toBe('run r04, step 1700, cfg {"n_layer":6}')
    expect(visualBrief(v)).toBe("tokens 3, 1 link")
    expect(() => checkVisual({ kind: "tokens", color: "heat", tokens: ["a"] })).toThrow('color: "heat" — surprisal | p | entropy')
    expect(() => checkVisual({ kind: "steps", steps: ["a"], meta: [1] })).toThrow("meta: a small object")
  })

  test("2026-10-17 matrix cells (text per cell, per frame) and links per row / column", () => {
    const v = checkVisual({ kind: "matrix", rows: ["L0", "L1"], cols: ["t0", "t1"], values: [[0.1, 0.9], [0.5, 0.2]], cells: [["the", "a very long token text"], [null, 7]], open_rows: [{ id: "layer", params: { l: 0 } }, "layer"], open_cols: [null, null] })
    expect(v.cells).toEqual([["the", "a very long "], ["", "7"]])
    expect(v.open_rows).toEqual([{ id: "layer", params: { l: "0" } }, { id: "layer" }])
    expect(v.open_cols).toBeUndefined() // none links: dropped
    expect(linksOf(v)).toHaveLength(2)
    const f = checkVisual({ kind: "matrix", frames: [{ label: "L0", values: [[1, 2]], cells: [["a", "b"]] }, { values: [[3, 4]] }] })
    expect(f.frames.map((x) => x.cells ?? null)).toEqual([[["a", "b"]], null])
    expect(() => checkVisual({ kind: "matrix", values: [[1, 2]], cells: [["a"]] })).toThrow("cells: row 0 has 1 texts, the values have 2")
    expect(() => checkVisual({ kind: "matrix", values: [[1, 2]], open_cols: ["a"] })).toThrow("open_cols: 1 links for 2")
  })

  test("2026-10-17 open links on every clickable element; params are short words (or {x}), never a path", () => {
    const link = { id: "step", params: { run: "r04", step: "{x}" } }
    expect(checkVisual({ kind: "flow", nodes: [{ id: "b3", open: { id: "layer", params: { l: 3 } } }] }).nodes[0].open).toEqual({ id: "layer", params: { l: "3" } })
    expect(checkVisual({ kind: "steps", steps: [{ title: "a", open: "trace" }] }).steps[0].open).toEqual({ id: "trace" })
    expect(checkVisual({ kind: "line", series: [{ name: "loss", points: [[0, 1]], open: link }] }).series[0].open).toEqual(link)
    expect(checkVisual({ kind: "bars", bars: [{ label: "r04", value: 1.2, open: { id: "run", params: { run: "r04" } } }, ["r05", 1.1]] }).frames[0].bars.map((b) => b.open ?? null)).toEqual([{ id: "run", params: { run: "r04" } }, null])
    expect(checkVisual({ kind: "scatter", points: [{ x: 0, y: 1, open: link }] }).frames[0].points[0].open).toEqual(link)
    expect(() => checkVisual({ kind: "flow", nodes: [{ id: "a", open: { id: "no such!" } }] })).toThrow('nodes[0].open.id: "no such!"')
    expect(() => checkVisual({ kind: "flow", nodes: [{ id: "a", open: { id: "x", params: { p: "a/b" } } }] })).toThrow('nodes[0].open.params.p: "a/b"')
    expect(checkParams({ t: 7, run: "r04" })).toEqual({ t: "7", run: "r04" })
    expect(checkParams({})).toBeNull()
    expect(() => checkParams({ t: "{x}" })).toThrow('params.t: "{x}"') // only a link's params take {x}
    expect(() => checkParams({ t: "..." })).toThrow('params.t: "..."')
    // never an option to the bound program (critic): no leading "-", a negative number too
    expect(() => checkParams({ out: "-rf" })).toThrow('params.out: "-rf" — letters, digits, . _ - (at most 40, not starting with -)')
    expect(() => checkParams({ t: -1 })).toThrow('params.t: "-1"')
    expect(checkParams({ name: "a-b", v: "1e-3" })).toEqual({ name: "a-b", v: "1e-3" })
    expect(() => checkVisual({ kind: "steps", steps: [{ title: "a", open: { id: "x", params: { flag: "--help" } } }] })).toThrow('steps[0].open.params.flag: "--help"')
    expect(() => checkParams(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])))).toThrow("params: 9 — at most 8")
  })
})

