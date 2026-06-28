// Reports the static asset sizes that ship with @wasmer/sdk, so the findings
// doc can quote concrete numbers. Run after `npm install`.
import { stat, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "node_modules", "@wasmer", "sdk", "dist");

const kib = (b) => (b / 1024).toFixed(1) + " KiB";
const mib = (b) => (b / (1024 * 1024)).toFixed(2) + " MiB";

async function main() {
  const files = await readdir(dist);
  let total = 0;
  const rows = [];
  for (const f of files) {
    const s = await stat(join(dist, f));
    if (!s.isFile()) continue;
    total += s.size;
    rows.push([f, s.size]);
  }
  rows.sort((a, b) => b[1] - a[1]);

  console.log("@wasmer/sdk dist assets:");
  for (const [f, size] of rows) {
    console.log(`  ${f.padEnd(28)} ${kib(size).padStart(12)}`);
  }
  console.log("");

  // The "runtime cost on the wire" is only the files the browser actually loads
  // when self-hosting (we do not ship wasm-inlined.mjs or the .d.ts files).
  const RUNTIME = ["index.mjs", "worker.mjs", "wasmer_js_bg.wasm"];
  let runtime = 0;
  for (const f of RUNTIME) {
    const s = await stat(join(dist, f)).catch(() => null);
    if (s) runtime += s.size;
  }
  console.log(`Browser runtime payload (index.mjs + worker.mjs + .wasm): ${mib(runtime)}`);
  console.log(`Full dist on disk (incl. inlined + types): ${mib(total)}`);
  console.log("");
  console.log("Registry tool packages are downloaded at runtime, on demand,");
  console.log("and cached by the SDK; they are NOT part of the above payload.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
