// Copies the @wasmer/sdk browser assets out of node_modules into ./vendor/
// so the page can load them as plain static files with no bundler.
//
// We deliberately self-host instead of pulling from a CDN: the whole point of
// the ASKK execution-model spikes is "deployable as static files on gh-pages",
// and the SDK ships a 6.6 MB .wasm that we want to measure and cache locally.
//
// node_modules/ and vendor/ are gitignored (see .gitignore); run `npm run vendor`
// after `npm install` to (re)populate vendor/.
import { mkdir, copyFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcDir = join(root, "node_modules", "@wasmer", "sdk", "dist");
const outDir = join(root, "vendor", "wasmer-sdk");

// The minimal set of files the browser needs to run the SDK self-hosted:
//   index.mjs           - the SDK entry (ESM)
//   worker.mjs          - thread-pool web worker driver (needs SAB + COOP/COEP)
//   wasmer_js_bg.wasm   - the SDK's own WASM core (~6.6 MB)
const FILES = ["index.mjs", "worker.mjs", "wasmer_js_bg.wasm"];

async function fmtSize(p) {
  const s = await stat(p);
  return `${(s.size / 1024).toFixed(1)} KiB`;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const present = new Set(await readdir(srcDir));
  for (const f of FILES) {
    if (!present.has(f)) {
      throw new Error(
        `Missing ${f} in ${srcDir}. Did you run \`npm install\` first?`,
      );
    }
    const from = join(srcDir, f);
    const to = join(outDir, f);
    await copyFile(from, to);
    console.log(`  vendored ${f}  (${await fmtSize(to)})`);
  }
  console.log(`\nVendored @wasmer/sdk -> ${outDir}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
