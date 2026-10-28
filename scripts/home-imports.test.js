import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { rankImports, walkImports, writeImports } from "./home-imports.js"

describe("rankImports (home-import-map)", () => {
  test("heaviest first; the top 3 of 5", () => {
    const nodes = [["a.js", 10], ["b.jsx", 500], ["c.js", 40], ["d.jsx", 900], ["e.js", 200]].map(([path, bytes]) => ({ path, bytes, via: "app/page.jsx" }))
    expect(rankImports(nodes).slice(0, 3).map((n) => n.path)).toEqual(["d.jsx", "b.jsx", "e.js"])
    expect(rankImports(nodes)).toHaveLength(5)
  })

  test("equal sizes keep a stable order by path, and the entry's via is null", () => {
    expect(rankImports([{ path: "z.js", bytes: 5 }, { path: "a.js", bytes: 5 }])).toEqual([{ path: "a.js", bytes: 5, via: null }, { path: "z.js", bytes: 5, via: null }])
  })
})

describe("walkImports (home-import-map)", () => {
  test("follows @/ and relative imports once, leaves out packages and next/dynamic", () => {
    const root = mkdtempSync(join(tmpdir(), "home-imports-"))
    const put = (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    put("app/page.jsx", 'import { Dashboard } from "@/components/home/dashboard";\nimport React from "react"\n')
    put("components/home/dashboard.jsx", 'import { A } from "./a"\nimport { B } from "@/lib/b"\nconst Lazy = dynamic(() => import("./lazy"))\n')
    put("components/home/a.jsx", 'import { B } from "@/lib/b"\n')
    put("components/home/lazy.jsx", "export const L = 1\n")
    put("lib/b/index.js", "export const B = 1\n")
    const nodes = walkImports(root)
    expect(nodes.map((n) => n.path).sort()).toEqual(["app/page.jsx", "components/home/a.jsx", "components/home/dashboard.jsx", "lib/b/index.js"])
    expect(nodes.find((n) => n.path === "lib/b/index.js").via).toBe("components/home/dashboard.jsx")
  })
})

describe("package rows (home-imports-packages)", () => {
  test("each bare package is one pkg:<name> row sized by its module, else main, entry; subpaths fold into it", () => {
    const root = mkdtempSync(join(tmpdir(), "home-imports-"))
    const put = (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    put("app/page.jsx", 'import anime from "animejs"\nimport * as D from "@radix-ui/react-dialog"\nimport x from "animejs/lib/x"\nimport fs from "node:fs"\nimport gone from "missing-pkg"\n')
    put("node_modules/animejs/package.json", JSON.stringify({ main: "lib/anime.js", module: "lib/anime.esm.js" }))
    put("node_modules/animejs/lib/anime.esm.js", "x".repeat(300))
    put("node_modules/animejs/lib/anime.js", "x".repeat(100))
    put("node_modules/@radix-ui/react-dialog/package.json", JSON.stringify({ main: "dist/index.js" }))
    put("node_modules/@radix-ui/react-dialog/dist/index.js", "x".repeat(120))
    const ranked = rankImports(walkImports(root))
    expect(ranked.filter((n) => n.path.startsWith("pkg:"))).toEqual([
      { path: "pkg:animejs", bytes: 300, via: "app/page.jsx" },
      { path: "pkg:@radix-ui/react-dialog", bytes: 120, via: "app/page.jsx" },
    ])
    expect(ranked[0].path).toBe("pkg:animejs")
  })
})

describe("writeImports (home-import-map)", () => {
  test("the ranked report is written as JSON", () => {
    const file = join(mkdtempSync(join(tmpdir(), "home-imports-")), "logs", "home-imports.json")
    const top = [{ path: "d.jsx", bytes: 900, via: "app/page.jsx" }]
    expect(writeImports(file, top, "2026-10-26T08:30:00.000Z")).toEqual({ at: "2026-10-26T08:30:00.000Z", top })
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ at: "2026-10-26T08:30:00.000Z", top })
  })
})
