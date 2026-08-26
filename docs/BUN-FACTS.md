# Bun factsheet for a Python → vanilla-JS port (verified 2026-08-26)

## 0. Version

- **Latest released Bun = `1.4.0`, published 2026-08-20T14:07:21Z.** Source: GitHub releases API `https://api.github.com/repos/oven-sh/bun/releases` — top tag `bun-v1.4.0`; blog index https://bun.sh/blog lists "Bun 1.4 — Aug 20, 2026" as newest.
- **Installed locally = `1.4.0+34cbb9a40b4bd1bd767d134a7065e66c2432a676`** (`bun --version`, `Bun.version` / `Bun.revision`). **We are already on the latest release — no upgrade needed.** (`bun upgrade --dry-run` was NOT run; `bun upgrade --help` shows only `--canary`, no dry-run flag.)
- 1.4 is the successor to the 1.3.x line (1.3.0 2025-10-10 → 1.3.14 2026-05-13). The 1.4 post "covers everything shipped since Bun 1.3.0", so **1.3.x features are all in 1.4**.
- Structural fact worth knowing: **Bun 1.4 rewrites Bun from Zig to Rust.** Verbatim from https://bun.com/blog/bun-v1.4: *"And it rewrites Bun from Zig to Rust."* API compatibility is maintained. (Docs footer now reads "© 2026 Anthropic, PBC".)

Docs trick used throughout: **every Bun docs page has a raw-markdown twin at `<url>.md`** (e.g. `https://bun.com/docs/typescript.md`). Cheap and exact.

---

## 1. Test runner (`bun test`)

All of the below **verified by executing it locally on bun 1.4.0**, not just read.

### Import surface
`import { test, it, describe, expect, mock, spyOn, jest, beforeAll, afterAll, beforeEach, afterEach, setSystemTime } from "bun:test"` — all present.

### `expect` matchers — measured
Probed 28 matcher names on `expect(1)`. **Only `toMatchImageSnapshot` was missing.** Present and confirmed: `toBe toEqual toStrictEqual toMatchObject toThrow toContain toContainEqual toBeCloseTo toMatchSnapshot toMatchInlineSnapshot toThrowErrorMatchingSnapshot toHaveBeenCalledWith toHaveBeenLastCalledWith toHaveBeenNthCalledWith toBeInstanceOf toSatisfy toBeOneOf toBeTypeOf toBeArrayOfSize toHaveReturned toHaveReturnedTimes toBeNil toBeEmpty toBeWithin toBeValidDate toHaveProperty toBeGreaterThan`, plus `.not`, `.resolves`, `.rejects`.

`expect` statics (measured): `addSnapshotSerializer, any, anything, arrayContaining, assertions, closeTo, extend, hasAssertions, not, objectContaining, rejectsTo, resolvesTo, stringContaining, stringMatching, unreachable`. → **`expect.extend()` exists**, so custom matchers are available with zero deps.

### `test.each`
Works: `test.each([[1,2,3],[4,5,9]])("each %i+%i=%i", (a,b,c)=>{...})` — verified passing. `describe.each` likewise exists.

### Snapshots
`toMatchSnapshot()` and `toMatchInlineSnapshot()` both verified (run reported `snapshots: +2 added`). Update with **`bun test -u` / `--update-snapshots`** (`bun test --help`).

### Coverage
`--coverage`, `--coverage-reporter=text|lcov`, `--coverage-dir=<dir>` (`bun test --help`). Config in `bunfig.toml` `[test]` (https://bun.com/docs/runtime/bunfig.md):
`coverage`, **`coverageThreshold = 0.9`** or `{ lines = 0.7, functions = 0.8 }` (a `statements` key is accepted but *not enforced*), `coverageSkipTestFiles`, `coverageIgnoreSourcemaps`, `coveragePathIgnorePatterns`, `coverageReporter = ["text","lcov"]`, `coverageDir`. **A failed threshold exits non-zero** — usable directly in `bun run gate`.

### Lifecycle hooks
`beforeAll / afterAll / beforeEach / afterEach` — imported and used successfully.

### Mocking
- `mock(fn)` → verified; `mock` statics measured: **`mock.module`, `mock.clearAllMocks`, `mock.restore`**.
- `spyOn(obj, "method")` → verified.
- `jest.*` measured surface: `fn, spyOn, mock, now, clearAllMocks, resetAllMocks, restoreAllMocks, setTimeout, advanceTimersByTime, advanceTimersToNextTimer, clearAllTimers, getTimerCount, isFakeTimers, runAllTimers, runOnlyPendingTimers, setSystemTime, useFakeTimers, useRealTimers`.
- Mock-fn methods documented at https://bun.com/docs/test/mocks.md: `mockClear, mockReset, mockRestore, mockImplementation, mockImplementationOnce, mockName, mockReturnThis, mock.calls, mock.results, mock.instances, mock.contexts, mock.lastCall`.

### Fake timers — YES, and they are real
Added **v1.3.4** (blog index: "1.3.4 — URLPattern API, Fake Timers for bun:test"), improved in 1.4. Verified locally: `jest.useFakeTimers()` + `setTimeout` + `jest.advanceTimersByTime(1001)` fired the callback; `jest.setSystemTime(new Date(0))` made `Date.now() === 0`; `jest.useRealTimers()` restored. **This means the "no ambient clock" purity rule can be tested with fake timers instead of hand-rolled clock injection** — though injection is still cleaner for a pure core.

### New in 1.4 worth adopting (source: https://bun.com/blog/bun-v1.4)
- **`bun test --parallel[=N]`** — N worker processes; coverage and JUnit merged across workers; implies `--isolate`.
- **`bun test --isolate`** — fresh `globalThis` per file, ESM+CJS registries cleared, servers/sockets/watchers/subprocesses closed, timers cancelled, fake timers restored between files. Directly relevant to a purity gate.
- **`bun test --changed[=REF]`** — run only tests affected by a git diff, by walking the import graph backward (honours tsconfig `paths`).
- **`bun test --shard=M/N`** and **`--timings=<path>` / `--update-timings`** (balance shards by wall time).
- **`test(name, fn, { retry: N })`** and **`{ repeats: N }`**; suite-wide `bun test --retry <N>`.
- Other flags present in 1.4 `--help`: `--randomize --seed --concurrent --max-concurrency --bail --dots --only-failures --pass-with-no-tests --path-ignore-patterns --reporter=junit|dots --rerun-each --todo --only -t/--test-name-pattern --timeout`.

---

## 2. Type-checking a plain-JS (JSDoc) project

- **Bun ships NO typechecker.** `bun tsc` → `error: Script not found "tsc"` (verified). `bun --help` lists no `typecheck`/`tsc`/`check` command. Bun's transpiler *strips* types; it does not check them.
- **The recommended path is still `tsc`** (or `tsgo`/TS7 when you move to it), plus `@types/bun` for Bun's globals. https://bun.com/docs/typescript.md: *"To get TypeScript definitions for Bun's built-in APIs, install `@types/bun`."*
- Suggested `compilerOptions` from the same page — note **`"allowJs": true`** is in Bun's own recommended config, which is exactly what `--checkJs` needs: `lib:["ESNext"], target:"ESNext", module:"Preserve", moduleDetection:"force", allowJs:true, types:["bun"], moduleResolution:"bundler", allowImportingTsExtensions:true, verbatimModuleSyntax:true, noEmit:true, strict:true, skipLibCheck:true, noFallthroughCasesInSwitch:true, noUncheckedIndexedAccess:true, noImplicitOverride:true`.
- **TypeScript 6.0+ gotcha**: `compilerOptions.types` now defaults to `[]` instead of auto-discovering `@types/*`. You **must** add `"types": ["bun"]` or you get "Cannot find name Bun". Same applies to TS 7. Source: https://bun.com/docs/typescript-6.md.
- **Verdict for HARNESS: `tsc --checkJs` under `strict` remains correct and is unchanged by 1.4.** Add `"types": ["bun"]` to be TS6/7-proof.

---

## 3. Bundler (`bun build` / `Bun.build`)

### CLI flags actually present in 1.4.0 (`bun build --help`, verified)
`--production` (sets `NODE_ENV=production` **and** enables minification) · `--target=browser|bun|node` · `--outdir` / `--outfile` · `--splitting` · `--public-path=<prefix>` · `--format=esm|cjs|iife` · `--sourcemap=linked|inline|external|none` · `--root` · `--entry-naming` (default `[dir]/[name].[ext]`) · `--chunk-naming` (default `[name]-[hash].[ext]`) · `--asset-naming` (default `[name]-[hash].[ext]`) · `--minify` / `--minify-syntax` / `--minify-whitespace` / `--minify-identifiers` / `--keep-names` · `--css-chunking` · `--external` / `--packages=external|bundle` · `--conditions` · `--banner` / `--footer` · `--env=inline|disable|PREFIX_*` · `--no-bundle` · `--watch` · `--metafile` / **`--metafile-md`** · `--bytecode` · `--compile` (+ `--asset`, `--compile-executable-path`, all the `--windows-*` flags) · **`--react-compiler`** · `--react-fast-refresh` · `--emit-dce-annotations` · `--allow-unresolved` / `--reject-unresolved` · `--app` and `--server-components` (both EXPERIMENTAL).

### `Bun.build()` JS API — verified working
```js
const r = await Bun.build({
  entrypoints: ["./site/index.html"], outdir: "./dist",
  target: "browser", minify: true, metafile: true,
  naming: { entry: "[dir]/[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
});
// r.success === true; r.outputs[] each has { path, kind, loader, hash }; r.metafile → { inputs, outputs }
```
`metafile: true` returns esbuild-compatible metadata (usable at https://esbuild.github.io/analyze/). Also new in 1.4: **`files: {…}`** virtual in-memory file map (paths → string/Blob/TypedArray, taking precedence over disk), **`optimizeImports: [...]`** barrel-export pruning, **`features: [...]` / `feature("FLAG")` from `bun:bundle`** compile-time flags with dead-branch removal (works in `bun build`, `bun run` AND `bun test`), `reactCompiler: true`. Source: https://bun.com/blog/bun-v1.4.

### HTML entrypoints — verified end-to-end
`bun build ./index.html --outdir=out --target=browser --production` produced:
```
out/index.html            (203 B, entry point, name preserved)
out/index-y8xyzedr.js     (entry point, content-hashed)
out/index-rfm9w4xn.css    (asset, content-hashed)
```
and rewrote the HTML to `<link rel="stylesheet" crossorigin href="./index-rfm9w4xn.css">` / `<script type="module" crossorigin src="./index-y8xyzedr.js">`.
What gets processed (https://bun.com/docs/bundler/html): `<script src>` through the JS/TS/JSX bundler; `<link rel="stylesheet">` through the CSS bundler; `<img>`/`<picture>`/`<video>`/`<audio>`/`<source>` copied+hashed; any `<link href>` to a local file rewritten and hashed. CSS `@import` is bundled and `url("./logo.png")` references are copied+hashed+rewritten.

### `--public-path` — verified, and it is the gh-pages base-path lever
`bun build ./index.html --outdir=out2 --production --public-path=/ASKK/` emitted
`<link ... href="/ASKK/index-n53fzk63.css">` and `<script ... src="/ASKK/index-dg4q86rm.js">`.
**This replaces the old sed-the-HTML hack.** (Relevant to the memory note "release MUST use `--base-path /ASKK/`; HTML-only sed leaves JS-embedded paths at root".)

### Two traps found by measurement
1. **Do NOT put `[hash]` in `naming.entry` for a static site.** With `naming: { entry: "[dir]/[name]-[hash].[ext]" }` the **HTML entry itself was hashed** → `index-g74px5q5.html`, i.e. no `index.html`. Keep entry naming at the default and let chunk/asset naming carry the hash.
2. **`bun build` CLI does not support plugins.** Docs, verbatim: *"Plugins are only supported through `Bun.build`'s API or through `bunfig.toml` with the frontend dev server, not through `bun build`'s CLI."* (https://bun.com/docs/bundler/html)

### CSS
Native CSS parser + bundler (docs: "about 70,000 lines of Rust"). `@import` bundling, minification, `--css-chunking` to dedupe CSS across multiple entrypoints. Importing `./x.css` from JS emits `app.css` beside `app.js`, deduped.

### Code splitting
`--splitting` / `splitting: true`. 1.4: 14× faster on 20k-module graphs (BFS reachability, O(V+E)). Bug fixed in 1.4: `--splitting` no longer emits a chunk for an `import()` reachable only from dead code removed by `--define`.

---

## 4. Static site / dev server

- **Dev server: `bun ./index.html`** — zero config, bundles+serves HTML/JS/TS/JSX/CSS, HMR, reads `tsconfig.json` for `paths`/JSX, plugins via `bunfig.toml [serve.static] plugins = [...]`. Single `.html` file ⇒ SPA fallback for all paths. Multiple files or a glob (`bun ./**/*.html`) ⇒ MPA routing by longest-common-prefix path normalization. Source: https://bun.com/docs/bundler/html.
  - `--console` streams browser `console.log`/`console.error` into the terminal over the existing HMR WebSocket. Keyboard: `o`+Enter open browser, `c`+Enter clear, `q`+Enter quit.
  - Env inlining on the dev server via `bunfig.toml [serve.static] env = "PUBLIC_*"` (default `"disable"`). **Only literal `process.env.FOO` is replaced** — not `import.meta.env`, not indirect `const e = process.env; e.FOO`.
- **`Bun.serve()` with `routes` + HTML imports** is the fullstack path (https://bun.com/docs/bundler/fullstack). New in 1.4: **`routes: { "/static/*": { dir: "./public" } }`** directory serving with `sendfile`, `Content-Type`, `ETag`, `Last-Modified`, `304`, `Range`/`206`, `index.html` for directories, and `openat2`+`O_RESOLVE_BENEATH` symlink protection on Linux; plus `If-None-Match`/`If-Modified-Since` → 304 and `If-Match`/`If-Unmodified-Since` → 412; `http3: true` (experimental). HTML-route sourcemaps are now **disabled in production**, configurable with `[serve.static] sourcemap = "linked"`. Source: https://bun.com/blog/bun-v1.4.
- **Static export to plain files: YES — `bun build ./index.html --outdir=dist --minify`** (or `Bun.build`). Confirmed by execution (§3). `--watch` rebuilds. Recommended production form per docs: `bun build ./index.html --outdir=dist --env=PUBLIC_*` (+ `--minify`/`--production`).
- **Single-file variant: `bun build --compile --target=browser ./index.html --outdir=dist`** inlines all JS/CSS/images into one `.html` openable from `file://`. New in 1.4. Docs: https://bun.com/docs/bundler/html ("Standalone HTML").

---

## 5. Runtime APIs — all probed on the local 1.4.0 binary

`typeof Bun.X` measured (nothing below is guesswork):

| API | Status | Notes |
|---|---|---|
| `Bun.file` / `Bun.write` | function / function | `.text()`, `.json()`, `.stream()`, `.bytes()` |
| **`Bun.YAML`** | object → **`{ parse, stringify }`** | see §6a |
| `Bun.TOML` | object → `{ parse, stringify }` | `stringify()` new in 1.4; TOML v1.1.0 |
| `Bun.JSON5` / `Bun.JSONC` / `Bun.JSONL` | object | JSON5 v1.3.7, JSONC v1.3.6, JSONL v1.3.7 |
| `Bun.XML` | object | new in 1.4, SIMD parser, ~5× faster than fast-xml-parser |
| `Bun.markdown` | object | new in 1.4: `.html()`, `.render()`, `.react()`; `.md` is a bundler loader |
| `Bun.hash` | function + `{ wyhash, adler32, crc32, cityHash32, cityHash64, xxHash32, xxHash64, xxHash3, murmur32v2, murmur32v3, murmur64v2, rapidhash }` | measured keys |
| `Bun.password` | object → `{ hash, hashSync, verify, verifySync }` | 1.4: argon2 now requires `memoryCost >= 8`; old hashes still verify |
| `Bun.Glob` | function (class) | `new Bun.Glob("*.js").scanSync(".")` / `.scan()` / `.match()` — verified |
| `Bun.$` | function | shell; `await Bun.$\`echo hi\`.text()` → `"hi"` verified |
| `Bun.SQL` | function | unified SQL (Postgres/MySQL/SQLite) since 1.3 |
| `bun:sqlite` | works | `new Database(":memory:").query("select 1 as x").get()` → `{x:1}` verified |
| `Bun.deepEquals` | function | verified; 2nd arg `true` = strict (undefined keys matter) |
| `Bun.inspect` | function | verified |
| `Bun.color` | function | `Bun.color("#ff0000","css") → "red"`; `Bun.color("red","[rgb]") → [255,0,0]` verified |
| `Bun.CookieMap` | function (class) | `new Bun.CookieMap("a=1; b=2")` iterates 2 entries — verified |
| `Bun.randomUUIDv7` | function | returns 36-char UUID — verified |
| `Bun.Image` | function | **new in 1.4**, JPEG/PNG/WebP/GIF/BMP (+HEIC/AVIF/TIFF on macOS/Win) |
| `Bun.WebView` | function | **new in 1.4**, headless browser automation + CDP — a possible replacement for the `smoke.js`/`check-contrast.js` browser gates |
| `Bun.cron` | function | **new in 1.4**, in-process and OS-level; driven by fake timers under `bun test` |
| `Bun.Terminal` | function | **new in 1.4**, real PTY for `Bun.spawn({ terminal: {...} })` |
| `Bun.Archive` | function | tar create/extract off-thread (v1.3.6) |
| `Bun.stringWidth` / `Bun.sliceAnsi` / `Bun.wrapAnsi` | function ×3 | ANSI/grapheme aware |
| `Bun.semver`, `Bun.CSRF`, `Bun.secrets`, `Bun.embeddedFiles`, `Bun.which`, `Bun.escapeHTML`, `Bun.peek`, `Bun.gzipSync`, `Bun.spawn`, `Bun.Transpiler`, `Bun.plugin`, `Bun.mmap`, `Bun.udpSocket`, `Bun.dns`, `Bun.openInEditor` | all present | measured |

Globals measured present: `structuredClone`, `WebSocket`, `Worker`, `URLPattern` (v1.3.4), `CompressionStream`/`DecompressionStream` (v1.3.3, native in 1.4: gzip/deflate/deflate-raw/brotli/zstd), `navigator`, `crypto`, `performance`, `AbortSignal`. `AsyncLocalStorage` from `node:async_hooks` — verified working (`a.run({x:1}, …)` → `{x:1}`).
`structuredClone` is **25× faster** as of 1.3.10.

### Import attributes — verified by execution
```js
import y from "./f.yaml" with { type: "yaml" };  // → { a: 1, list: ["one"] }   ✅
import t from "./f.toml" with { type: "toml" };  // → { x: 5 }                  ✅
import s from "./f.txt"  with { type: "text" };  // → "hello\n"                 ✅
import j from "./f.json" with { type: "json" };  // → { k: 2 }                  ✅
import y2 from "./f.yaml";                       // bare, no attribute → works  ✅
```
So **`.yaml`/`.toml` are first-class loaders**, both with and without the attribute.

---

## 6. The five questions — answered

### (a) Built-in YAML parser? **YES.**
- **`Bun.YAML.parse()` and `Bun.YAML.stringify()` both exist.** `Object.keys(Bun.YAML)` → `["parse","stringify"]` on the local 1.4.0 binary. Verified round-trip: `Bun.YAML.parse("a: 1\nb:\n  - x\n  - y\nc: yes\n")` → `{"a":1,"b":["x","y"],"c":"yes"}`.
- **`import x from "./f.yaml"` works too**, with or without `with { type: "yaml" }` — verified (§5).
- Docs page exists: https://bun.com/docs/api/yaml (nav item "YAML" under Utilities).
- 1.4 hardening (https://bun.com/blog/bun-v1.4): **`Bun.YAML` passes 402/402 of the yaml-test-suite**; follows **YAML 1.2**, so **`yes`/`no`/`on`/`off` parse as STRINGS, not booleans** (confirmed above: `c: yes` → `"yes"`) — a behavior change from earlier Bun, landed v1.3.5; supports cyclic anchors/aliases; `parse()` throws `SyntaxError` on a NUL byte; `stringify()` correctly quotes number-like strings.
- **Consequence for the port: do NOT hand-roll a YAML frontmatter parser.** `Bun.YAML.parse` covers it with zero npm deps. Caveat: it is a **Bun runtime API**, so a browser-shipped bundle cannot call it — it is available at build time and in `bun test`. If frontmatter must be parsed *in the browser*, either pre-parse at build time (bake the parsed object in) or hand-roll a minimal browser-side parser; that split is the real design decision, not "does Bun have YAML".

### (b) Fully static site from an HTML entrypoint? **YES.**
Exact command:
```
bun build ./index.html --outdir=dist --production
# add --public-path=/ASKK/ for a GitHub Pages subpath
# add --env=PUBLIC_*      to inline PUBLIC_-prefixed env vars
```
Verified output layout (no server involved, files on disk):
```
dist/index.html            <- entry name preserved, references rewritten
dist/index-<hash>.js       <- entry chunk, content-hashed
dist/index-<hash>.css      <- CSS asset, content-hashed
dist/<name>-<hash>.<ext>   <- images/media, copied + hashed
```
`--production` = `NODE_ENV=production` + minify. Add `--splitting` for shared chunks, `--sourcemap=linked|none`. `Bun.build({ entrypoints:["./index.html"], outdir:"./dist", minify:true })` is the equivalent JS API and is the **only** way to use plugins. For a one-file deliverable: `bun build --compile --target=browser ./index.html --outdir=dist`. Source: https://bun.com/docs/bundler/html + local execution.

### (c) Type-checking plain JS in a Bun repo? **`tsc --checkJs` is still the answer.**
Bun has **no** typechecker and **no `bun tsc`** (`bun tsc --version` → `error: Script not found "tsc"`; absent from `bun --help`). Bun's official guidance is `bun add -d @types/bun` + a `tsconfig.json` with `"allowJs": true`, `"noEmit": true`, `"strict": true`, run through `tsc` (https://bun.com/docs/typescript.md). **Add `"types": ["bun"]`** — mandatory from TypeScript 6.0 onward, which stopped auto-discovering `@types/*` (https://bun.com/docs/typescript-6.md). No change needed to HARNESS's existing gate.

### (d) Does `bun test` run in a browser-like environment? **NO — Bun runtime only, no DOM.**
Verified by execution inside `bun test`: `typeof document === "undefined"`, `typeof window === "undefined"` (`typeof navigator === "object"` — that one *is* present, Bun implements the WinterCG `navigator`). A DOM is **opt-in** via a third-party polyfill: `bun add -d @happy-dom/global-registrator` + `bunfig.toml [test] preload = ["./happydom.ts"]` (https://bun.com/docs/test/dom.md). **This is exactly the property the pure core needs: `bun test` on the host, no DOM, no browser.** `--isolate` (new in 1.4) strengthens it further by giving each test file a fresh `globalThis` and closing leaked handles between files.

### (e) Web Workers? **Supported, with real caveats.** (https://bun.com/docs/api/workers)
- **Bun runtime**: `Worker` is a global. Docs state verbatim: *"The Worker API is still experimental (particularly for terminating workers)."*
  - **`{ type: "module" }` is NOT required** — "Unlike in browsers, you don't need to pass `{type: "module"}` to use ES modules." Passing it is harmless for browser parity.
  - Specifier is resolved **relative to the project root**, not the importing file — so use `new Worker(new URL("./w.js", import.meta.url).href)` for portability.
  - Messages use the **HTML Structured Clone Algorithm**; fast paths for pure strings and flat primitive-only plain objects (2–241× faster than Node). Complex values (Date, ArrayBuffer, nested) still take the standard structured-clone path. **Transferables: UNVERIFIED** — the workers doc does not document a `transfer` list argument for `postMessage`; do not assume zero-copy transfer works.
  - Bun-only extensions that do **not** exist in browsers: `"open"` and `"close"` events, `worker.ref()`/`worker.unref()`/`{ ref:false }`, `{ smol:true }`, `{ preload:[...] }`, `Bun.isMainThread`, `process.on("worker", …)`, `setEnvironmentData`/`getEnvironmentData` from `worker_threads`. **Using any of these breaks browser portability** — keep the pure core to the Web-standard subset.
  - `blob:` URL workers are supported (and Bun transpiles TS inside them).
  - 1.4 adds `resourceLimits`, `stdout`, `stderr`, `eval` options.
- **`bun build --target=browser` caveat, measured**: Bun **does not** rewrite or bundle `new Worker(new URL("./w.js", import.meta.url).href)`. Input `new Worker(new URL("./w.js", import.meta.url).href)` came out of the bundle **byte-identical**, and `w.js` was **not emitted** into `outdir`. → **Worker scripts must be passed to `bun build` as their own entrypoints** (Bun's own help example does exactly this: `bun build --minify --splitting --outdir=out ./index.jsx ./lib/worker.ts`). Plan the output filename accordingly, since the worker entry gets its own hashed/unhashed name and the `new URL(...)` string must match it.
- Browser side: standard `Worker` semantics apply; the built output is plain ESM, so `type: "module"` on the browser `new Worker(url, { type: "module" })` is what you want for an ESM worker chunk.

---

## 7. New in 1.4 that a fresh project should adopt (over older idioms)

Source for all: https://bun.com/blog/bun-v1.4 unless noted.

| Adopt this | Instead of |
|---|---|
| `Bun.YAML.parse` / `Bun.TOML.parse` / `Bun.JSON5` / `Bun.JSONC` / `Bun.XML` | `js-yaml`, `@iarna/toml`, `json5`, `fast-xml-parser` npm deps |
| `Bun.markdown.html()` | `marked` / `markdown-it` (and 1.4 made `marked.parse()` 138× faster anyway) |
| `bun test --isolate --parallel` | serial `bun test` with cross-file leakage |
| `bun test --changed` | running the full suite on every edit |
| `jest.useFakeTimers()` | hand-rolled clock injection *for tests* (injection still right for the pure core's design) |
| `--public-path=/ASKK/` | sed-ing base paths into built HTML |
| `metafile: true` / `--metafile-md` | guessing at bundle composition |
| `feature("FLAG")` from `bun:bundle` + `--feature=` | `--define`-based flag hacks; dead branches are removed and it works in `bun build`, `bun run` **and** `bun test` |
| `Bun.build({ files: {...} })` virtual files | writing temp files to disk for codegen/test stubbing |
| `Bun.WebView` | Puppeteer/Playwright for the browser-only gates |
| `CompressionStream`/`DecompressionStream` (native) | `node:zlib` shims in browser-shared code |
| `Bun.cron()` | node-cron / setInterval schedulers |
| native `ReadableStream`/`WritableStream`/`TransformStream` (100% WPT) | stream polyfills |
| `bun prune --production`, `bun dedupe --check`, `bun audit fix`, `bun pm licenses`, `bun pm diff` | ad-hoc scripts |
| `bunfig.toml [install] linker = "isolated"` | hoisted `node_modules` (7× faster warm CI installs; opt-in for new projects) |
| `bun run --parallel "build:*"` | `&`-chained shell scripts |
| `--cpu-prof-md` / `--heap-prof-md` | reading raw `.cpuprofile`/`.heapsnapshot` |
| `--no-env-file` / `[env] = false` | accidental `.env` loading in CI |
| `--no-orphans` | orphaned child processes after a killed parent |

## 8. Deprecated / removed / behavior changes to avoid

All from https://bun.com/blog/bun-v1.4 ("Every behavior change in 1.4"):

- **`fs.rmdir(path, { recursive: true })` now THROWS `ERR_INVALID_ARG_VALUE`.** Use `fs.rm(path, { recursive: true, force: true })`. (#31830)
- **Bun now reports Node.js 26**: `process.versions.modules` = `147`; **`res.writeHeader()` in `node:http` is removed** — use `res.writeHead()`; in paused mode `readable.read()` with no size returns one buffered chunk, not the whole buffer.
- **`Bun.serve({ inspector })` removed** (v1.3.14) — the undocumented `inspector: true` is now silently ignored. Use `bun --inspect`.
- **Global `WebSocket` no longer accepts an `agent` option** (v1.3.6) — non-standard; the `ws` package's polyfilled `WebSocket` takes `agent` instead.
- **`bun feedback` command removed.** (#38444)
- **`Bun.password.hash()` with argon2 now requires `memoryCost >= 8`** — old lower-cost hashes still verify.
- **`Bun.TOML.parse()` now throws on syntax errors** it previously tolerated; `Bun.YAML.parse()` throws `SyntaxError` on embedded NUL bytes; `Bun.YAML/TOML/JSON5.stringify()` and `Bun.markdown` renderers throw `ERR_OUT_OF_RANGE` past limits.
- **`Temporal` is now defined by default**, and `toEqual()` compares Temporal objects by value.
- **`Response.clone()`/`Request.clone()` now tee the body** when `.body` was accessed-but-not-read (previously silently drained the original to zero bytes).
- **`new TextDecoder()` / `.decode()` throw `TypeError` on a primitive.**
- `ReadableStream` no longer advertises non-existent `.formData()` / `.arrayBuffer()` methods; `FileSink.write()` returns `number | Promise<number>`.
- `bun update` now updates **transitive** dependencies, not just direct ones.
- `trustedDependencies` now auto-trusts **only** the npm registry; `file:`/`link:`/`git:`/`github:` deps must be listed explicitly.
- The "CPU lacks AVX support" startup warning is removed (baseline builds unchanged).

## 9. UNVERIFIED / open

- **`postMessage` transferable-object list** (`postMessage(value, [buffer])`) in Bun's `Worker` — not documented on https://bun.com/docs/api/workers and not tested here. **UNVERIFIED.**
- Whether `bun build --target=browser` can be made to emit a worker chunk automatically from `new Worker(new URL(...))` via some flag — measured to NOT happen by default; no flag found. **UNVERIFIED that any flag enables it.**
- `Bun.YAML` availability *inside a browser bundle* — it is a Bun runtime API; there is no documented browser shim. Assume build-time/test-time only.
- `expect().toMatchImageSnapshot` — measured **absent**.
