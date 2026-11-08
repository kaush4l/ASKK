// Writes the app.css token block from design/tokens.json (the single source). `--check` exits 1 when it is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { tokenBlock, BLOCK_START, BLOCK_END } from "../src/lib/logic/theme.js";
const file = new URL("../src/app.css", import.meta.url);
const css = readFileSync(file, "utf8");
const a = css.indexOf(BLOCK_START), b = css.indexOf(BLOCK_END);
if (a < 0 || b < 0) { console.error("app.css has no token block markers"); process.exit(1); }
const next = css.slice(0, a) + tokenBlock() + css.slice(b + BLOCK_END.length);
if (process.argv.includes("--check")) process.exit(next === css ? 0 : 1);
if (next !== css) writeFileSync(file, next);
console.log(next === css ? "app.css tokens up to date" : "app.css tokens written");
