// util/yamlish.js: the YAML subset agents write structures in (2026-10-18).
import { expect, test } from "bun:test"
import { parseYamlish } from "../util/yamlish.js"

test("maps, nested lists of maps, nested maps, scalars", () => {
  expect(parseYamlish("kind: flow\nnodes:\n  - id: a\n    label: embed\n  - id: b\nedges:\n- from: a\n  to: b\nmeta:\n  run: r07\n  step: 723\nok: true\nnone: null\ntags: [x, y]\nq: \"a: b\"")).toEqual({
    kind: "flow",
    nodes: [{ id: "a", label: "embed" }, { id: "b" }],
    edges: [{ from: "a", to: "b" }],
    meta: { run: "r07", step: 723 },
    ok: true,
    none: null,
    tags: ["x", "y"],
    q: "a: b",
  })
})

test("a top-level list; scalars and inline JSON items", () => {
  expect(parseYamlish("- 1\n- two\n- {\"a\": 3}")).toEqual([1, "two", { a: 3 }])
})

test("anything that does not fit → null (the caller keeps the text)", () => {
  expect(parseYamlish("kind: bars\nthis line is prose")).toBeNull()
  expect(parseYamlish("")).toBeNull()
  expect(parseYamlish("a: 1\n    b: 2")).toBeNull()
})
