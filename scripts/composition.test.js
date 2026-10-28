import { expect, test } from "bun:test"

import { kernelClasses } from "../backend/kernel/index.js"
import { compositionMarkdown, fileProblems, viewsDrawn } from "./composition.js"

test("viewsDrawn reads the VIEWS table's keys", () => {
  const src = 'const X = 1\nconst VIEWS = {\n  list: ListView,\n  "pipeline": W, // a note\n  dev: DevView,\n}\nconst Y = { other: 1 }'
  expect([...viewsDrawn(src)]).toEqual(["list", "pipeline", "dev"])
})

test("fileProblems names a missing renderer, test and README entry", () => {
  const k = { name: "Widget", type: "widget", view: "widget" }
  expect(fileProblems(k, { views: new Set(), readme: "", exists: () => false })).toEqual([
    "view widget has no renderer in components/views/artifact.jsx",
    "no backend/kernel/test/builtin-widget.test.js",
    "backend/kernel/README.md does not name it",
  ])
  expect(fileProblems(k, { views: new Set(["widget"]), readme: "`Widget` (view widget)", exists: () => true })).toEqual([])
})

test("the document is deterministic and carries every class and the recipe", () => {
  const c = kernelClasses()
  const a = compositionMarkdown(c), b = compositionMarkdown(c)
  expect(a).toBe(b)
  for (const name of [...c.bases.map((x) => x.name), ...c.kinds.map((x) => x.name)]) expect(a).toContain(`### ${name}`)
  expect(a).toContain("## Changing ASKK from within")
  expect(compositionMarkdown(c, { Files: ["no renderer"] })).toContain("- Files: no renderer")
})
