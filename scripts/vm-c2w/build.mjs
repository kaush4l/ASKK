// Build the c2w VM main-thread bundle + stage the worker and its
// classic-script dependencies into crates/web/assets/vm/c2w/.
// The multi-hundred-MB alpine64.wasm is NOT staged here — see
// scripts/vm-c2w/README.md for how it is produced (container2wasm) and
// where it lands.
import { build } from "bun";
import { copyFileSync, mkdirSync } from "fs";

const OUT = "../../crates/web/assets/vm";
const SUPPORT = `${OUT}/c2w`;
mkdirSync(SUPPORT, { recursive: true });

const result = await build({
  entrypoints: ["./entry.js"],
  outdir: OUT,
  naming: "c2w.js",
  format: "iife",
  target: "browser",
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Classic worker + importScripts deps: copied verbatim (not bundled — the
// worker relies on script-global cross-talk, and Dioxus serves them as-is).
copyFileSync("./worker-entry.js", `${SUPPORT}/worker.js`);
copyFileSync("node_modules/xterm-pty/workerTools.js", `${SUPPORT}/workerTools.js`);
for (const f of ["index.js", "wasi_defs.js"]) {
  copyFileSync(`vendor/browser_wasi_shim/${f}`, `${SUPPORT}/wasi_shim_${f}`);
}
for (const f of ["worker-util.js", "wasi-util.js"]) {
  copyFileSync(`vendor/${f}`, `${SUPPORT}/${f}`);
}
console.log("built assets/vm/c2w.js + staged worker support files");
