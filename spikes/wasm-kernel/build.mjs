// Componentize a JS module against wit/world.wit: node build.mjs <source.js> <world> <out.wasm> [disable,features]
// preview2-shim 0.30 grants no preopens by default; the splicer reads the WIT and source through it.
import { _setPreopens } from "@bytecodealliance/preview2-shim/filesystem"
import { componentize } from "@bytecodealliance/componentize-js"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

_setPreopens({ "/": "/" })
const [source, worldName, out, disable = ""] = process.argv.slice(2)
const t = Date.now()
const { component } = await componentize({ sourcePath: resolve(source), witPath: resolve("wit/world.wit"), worldName, disableFeatures: disable ? disable.split(",") : [] })
await writeFile(out, component)
console.log(`${out}: ${(component.byteLength / 1e6).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(1)} s`)
