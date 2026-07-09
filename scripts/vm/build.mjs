// Build the v86 VM bundle + stage the matching wasm. libv86 has a dead
// Node-only `require("perf_hooks")` branch; stub it for the browser bundle.
import { build } from "bun";
import { copyFileSync } from "fs";

const stubNodeBuiltins = {
  name: "stub-node-builtins",
  setup(b) {
    b.onResolve({ filter: /^perf_hooks$/ }, () => ({
      path: "perf_hooks",
      namespace: "stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export const performance = undefined; export default {};",
      loader: "js",
    }));
  },
};

const OUT = "../../crates/web/assets/vm";
const result = await build({
  entrypoints: ["./entry.js"],
  outdir: OUT,
  naming: "v86.js",
  format: "iife",
  target: "browser",
  minify: true,
  plugins: [stubNodeBuiltins],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
// The wasm MUST match the bundled libv86 version — stage it from the same
// installed package, never hand-copy.
copyFileSync("node_modules/v86/build/v86.wasm", `${OUT}/v86.wasm`);
console.log("built crates/web/assets/vm/v86.js + staged matching v86.wasm");
