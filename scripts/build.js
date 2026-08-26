/** The static export.
 *
 *     bun run scripts/build.js                       # opens from the filesystem
 *     bun run scripts/build.js --public-path=/ASKK/  # opens from a subpath
 *
 * Two entrypoints, and the second one is the whole reason this file exists.
 * Measured (PORTING-GUIDE §1.6): `bun build --target=browser` does **not** emit
 * a worker from `new Worker(new URL("./w.js", import.meta.url).href)` — the
 * string comes out byte-identical and the file is never written. So the worker
 * host is handed to the build as its own entrypoint, and the name it lands
 * under has to be the name the spawner asks for. That name is not restated
 * here: it is imported from `app/ports-browser.js`, because a mismatch between
 * a constant and a build script is a page that boots and then does nothing,
 * which is this project's historical failure mode.
 *
 * Two more measured facts are load-bearing:
 *
 * - **No `[hash]` in the entry naming.** The HTML entry is an entry, so a
 *   hashed entry naming produces no `index.html` at all. Chunks and assets
 *   carry the hash instead, and the HTML is rewritten to point at them.
 * - **`--public-path` rather than a rewrite afterwards.** It fixes the paths
 *   embedded in the JS too, which the sed-the-HTML hack this replaces never
 *   did.
 *
 * And the output directory is deleted before every build, because a cache that
 * serves a chunk without your edit in it costs hours — the symptom is "my
 * change did nothing", which reads as a code problem and is not one.
 */

import { existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { WORKER_FILE } from "../app/ports-browser.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PAGE_ENTRY = "app/index.html";
/** The worker's source sits beside the page and lands under the name the
 * spawner resolves — `app/worker.js` -> `dist/worker.js`. */
const WORKER_ENTRY = join("app", WORKER_FILE);

/** @param {string[]} argv @returns {{ outdir: string, publicPath: string | undefined, minify: boolean }} */
function options(argv) {
  let outdir = "dist";
  /** @type {string | undefined} */ let publicPath = undefined;
  let minify = true;
  for (const arg of argv) {
    const [flag, value] = arg.includes("=") ? arg.split(/=(.*)/s) : [arg, undefined];
    if (flag === "--outdir") outdir = value ?? outdir;
    else if (flag === "--public-path") publicPath = value;
    else if (flag === "--no-minify") minify = false;
    else throw new Error(`unknown option ${arg} — build takes --outdir=, --public-path=, --no-minify`);
  }
  return { outdir, publicPath, minify };
}

/** @param {number} bytes @returns {string} */
const size = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`);

/** Loud, and with the reason, because the alternative is a silent half-export.
 * @param {string} message @returns {never} */
function stop(message) {
  console.error(`\nbuild FAILED — ${message}`);
  process.exit(1);
}

const { outdir, publicPath, minify } = options(process.argv.slice(2));
const out = join(ROOT, outdir);

for (const entry of [PAGE_ENTRY, WORKER_ENTRY]) {
  if (!existsSync(join(ROOT, entry))) {
    stop(`${entry} does not exist. The worker host is a build entrypoint of its own and its file name is WORKER_FILE in app/ports-browser.js; rename one and the page boots into nothing.`);
  }
}

// Never trust a directory a previous build wrote.
rmSync(out, { recursive: true, force: true });

console.log(`build\n  entries      ${PAGE_ENTRY}, ${WORKER_ENTRY}`);
console.log(`  outdir       ${relative(ROOT, out) || "."}`);
console.log(`  public path  ${publicPath ?? "(relative — opens from the filesystem)"}`);

const result = await Bun.build({
  entrypoints: [join(ROOT, PAGE_ENTRY), join(ROOT, WORKER_ENTRY)],
  outdir: out,
  target: "browser",
  minify,
  publicPath,
  // The hash lives on chunks and assets and nowhere near an entry: `index.html`
  // is an entry, and an entry naming that hashes leaves no `index.html` behind.
  // `worker.js` is an entry for the same reason from the other side — its name
  // is a contract with `workerUrl()`, so it may never be hashed.
  naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
});

for (const log of result.logs) console.log(`  ${log.level}: ${log.message}`);
if (!result.success) stop(`${result.logs.length} error(s) above`);

/** @type {{ name: string, kind: string, bytes: number }[]} */
const emitted = result.outputs
  .map((artifact) => ({ name: relative(out, artifact.path), kind: artifact.kind, bytes: artifact.size }))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log("\nemitted");
const width = Math.max(...emitted.map((f) => f.name.length));
for (const file of emitted) console.log(`  ${file.name.padEnd(width)}  ${size(file.bytes).padStart(9)}  ${file.kind}`);
console.log(`  ${"total".padEnd(width)}  ${size(emitted.reduce((n, f) => n + f.bytes, 0)).padStart(9)}`);

// A build can succeed and still be useless in exactly two ways, and both have
// happened to somebody: no page, or a page whose workers 404.
if (!emitted.some((f) => f.name === "index.html")) stop("no index.html was emitted. Check that the entry naming carries no [hash].");
if (!emitted.some((f) => f.name === WORKER_FILE)) {
  stop(`the build succeeded but emitted no ${WORKER_FILE}. Every agent runs in a worker, so this export would render a page that does nothing at all.`);
}

console.log(`\nok — ${emitted.length} files, ${WORKER_FILE} present`);
