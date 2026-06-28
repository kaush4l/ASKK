// Build the v86 VM bundle. v86's libv86 has a dead Node-only branch that
// `require("perf_hooks")`; the browser build never hits it (it picks
// performance.now first), but Bun still tries to bundle the static require.
// A resolver plugin maps perf_hooks to an empty module so the browser bundle
// stays self-contained.
import { build } from "bun";

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

const result = await build({
  entrypoints: ["./entry.js"],
  outdir: "../../assets",
  naming: "v86_vm.js",
  format: "iife",
  target: "browser",
  minify: true,
  plugins: [stubNodeBuiltins],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("built assets/v86_vm.js");
