// Visual specs an agent builds for the stage (backend/kernel/builtin/visual.js, 2026-10-17): each kind normalized,
// what is wrong said plainly, sizes capped, one line per visual for the prompt.

import { describe, expect, test } from "bun:test"
import { checkVisual, VISUAL_KINDS, visualBrief } from "../builtin/visual.js"

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
    expect(checkVisual({ kind: "tokens", prompt: "Once", tokens: [{ text: " upon", p: 0.9, top: [[" upon", 0.9], [" there", 0.05]] }] }).tokens[0]).toEqual({ text: " upon", p: 0.9, top: [[" upon", 0.9], [" there", 0.05]] })
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
})
