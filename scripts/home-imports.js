// The home page's static import graph (home-import-map, owner speed order l280): every module the first GET of /
// compiles, with its size, so the next lazy cut takes the measured heaviest one, not a guess. From app/page.jsx it
// follows the "@/…" and relative static imports, resolved to .js/.jsx/index files, each file once; next/dynamic
// (import("…")) is left out. A bare package import is one row, "pkg:<name>", sized by its entry file (package.json
// module, else main, else index.js) and not walked into; a package not in node_modules is left out.
//
//   walkImports(root, "app/page.jsx") → [{ path: "components/home/dashboard.jsx", bytes: 5120, via: "app/page.jsx" }, …]
//   packageRow(root, "animejs/lib/x") → { path: "pkg:animejs", bytes: 41000 }, or null
//   rankImports(nodes) → the same, heaviest first
//   writeImports("logs/home-imports.json", ranked, at) → {at, top}: what dev.health shows as the heaviest on /

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, join, normalize } from "node:path"

const STATIC = /^\s*(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s*)?["']([^"']+)["']/gm
const EXT = ["", ".js", ".jsx", "/index.js", "/index.jsx"]
const PKG_EXT = ["", ".js", ".mjs", ".cjs", "/index.js", "/index.mjs"]

// A specifier as a path under root, or null (a package, or no such .js/.jsx file).
export function resolveImport(root, from, spec) {
  const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? join(dirname(from), spec) : null
  if (base == null) return null
  for (const ext of EXT) {
    const path = normalize(base + ext)
    if (/\.jsx?$/.test(path) && existsSync(join(root, path)) && statSync(join(root, path)).isFile()) return path
  }
  return null
}

// A bare specifier's package ("@scope/name" or "name", subpaths dropped) as a row sized by its entry file, or null
// (a local path, a node builtin, or a package not in node_modules).
export function packageRow(root, spec) {
  if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("node:")) return null
  const parts = spec.split("/")
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
  if (builtinModules.includes(name)) return null
  const dir = join(root, "node_modules", name)
  if (!existsSync(join(dir, "package.json"))) return null
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  const entry = typeof pkg.module === "string" ? pkg.module : typeof pkg.main === "string" ? pkg.main : "index.js"
  for (const ext of PKG_EXT) {
    const file = join(dir, entry + ext)
    if (existsSync(file) && statSync(file).isFile()) return { path: `pkg:${name}`, bytes: statSync(file).size }
  }
  return null
}

export function walkImports(root, entry = "app/page.jsx") {
  const via = new Map([[entry, null]])
  const queue = [entry]
  const nodes = []
  while (queue.length) {
    const path = queue.shift()
    const text = readFileSync(join(root, path), "utf8")
    nodes.push({ path, bytes: Buffer.byteLength(text), via: via.get(path) })
    for (const [, spec] of text.matchAll(STATIC)) {
      const next = resolveImport(root, path, spec)
      if (next && !via.has(next)) {
        via.set(next, path)
        queue.push(next)
      }
      const row = next ? null : packageRow(root, spec)
      if (row && !via.has(row.path)) {
        via.set(row.path, path)
        nodes.push({ ...row, via: path })
      }
    }
  }
  return nodes
}

// Heaviest first; equal sizes by path, so the order is the same every run.
export function rankImports(nodes) {
  return [...nodes].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).map(({ path, bytes, via }) => ({ path, bytes, via: via ?? null }))
}

export function writeImports(file, ranked, at = new Date().toISOString()) {
  const report = { at, top: ranked }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  return report
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..")
  const report = writeImports(join(root, "logs", "home-imports.json"), rankImports(walkImports(root)))
  console.log(report.top.slice(0, 3).map((n) => `${n.path} ${n.bytes} B`).join("\n"))
}
