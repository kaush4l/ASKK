# What the gate proves

`bun run check` is four steps. This page says what each one can see, and what it
still cannot, because the question came up as a claim that turned out to be half
wrong, and the only way to settle any of it was to break the tree deliberately
and watch.

    lint    biome over src, scripts, test, next.config.js, public/sandbox/vm-worker.js
    test    bun test --isolate, importing modules directly
    build   next build, static export
    smoke   scripts/smoke.js — boots out/ in headless Chrome

Every row in the table below is one exact edit applied to a clean tree, all four
steps run, then the file restored byte for byte. `pass` means the step went
green **over the fault**.

## The claim that started this

> "`composition.js` was left syntactically invalid for roughly a minute. `bun run
> lint` failed and two tests failed at that moment — but `bun run build` STAYED
> GREEN THROUGH THE SYNTAX ERROR, so the build gate does not compile the backend
> worker entry at all."

The conclusion is false and the observation is unreproduced.

`next build` **does** compile every module-worker entry. Turbopack follows
`new Worker(new URL('./x.js', import.meta.url), { type: 'module' })`, so the
whole backend is reachable from the page:

    ./src/backend/composition.js  [Client Component Browser]
    ./src/backend/worker.js       [Client Component Browser]
    ./src/client/BackendClient.js [Client Component Browser]
    ./src/app/page.jsx            [Client Component Browser]
    ./src/app/page.jsx            [Server Component]

That import trace is `next build` failing on a syntax error injected into
`composition.js`. `src/backend/agentWorker.js` and `src/backend/speechWorker.js`
are reached the same way, via `AgentWorkerPool` and `src/client/Speech.js` —
and note that this holds even though both are constructed lazily, at the first
sub-agent call and the first dictation. The bundler follows the `new URL`, not
the call.

One detail is worth knowing because it looks like the opposite of this. Each
worker entry is emitted **twice**: once compiled, into the chunk the worker
actually runs, and once **verbatim, byte for byte** as an asset under
`out/_next/static/media/worker.<hash>.js` — that copy is what
`new URL(..., import.meta.url)` evaluates to. The verbatim copy still contains
`import { buildKernel } from './composition.js'`, a specifier that resolves to
nothing in `out/`. It is dead weight, not the thing that runs; reading it is the
easiest way to convince yourself the worker was never bundled, and be wrong.

    md5 src/backend/worker.js                      316e3a221d31a0e266390ab49bf13cc8
    md5 out/_next/static/media/worker.<hash>.js    316e3a221d31a0e266390ab49bf13cc8

What was true in the original claim: **the composed gate held.** Lint caught that
particular error. What could not be reproduced is a green build over it. What the
investigation found instead is a different and larger hole.

## The measurement

| # | fault | lint | test | build | smoke |
|---|---|---|---|---|---|
| 1 | syntax error in `composition.js` | FAIL | FAIL | FAIL | – |
| 2 | bad import path in `worker.js` | pass | pass | **FAIL** | – |
| 3 | bad import path in `agentWorker.js` | pass | pass | **FAIL** | – |
| 4 | bad import path in `speechWorker.js` | pass | pass | **FAIL** | – |
| 5 | import of a name nothing exports, used | pass\* | pass | **FAIL** | – |
| 6 | `window.*` in `worker.js`, the entry | pass | pass | pass | **FAIL** |
| 7 | `document.*` in `composition.js` | pass | FAIL | pass | **FAIL** |
| 8 | `importScripts` in `vm-worker.js` naming a file that is not there | pass | pass | pass | **FAIL** |
| 9 | `public/sandbox/vm-worker.js` deleted outright | pass | pass | pass | **FAIL** |
| 10 | the page boots but never goes live, nothing thrown | pass | pass | pass | **FAIL** |
| 11 | `public/sandbox/wasi-util.js` emptied | pass | pass | pass | **FAIL** |
| 12 | `browser_wasi_shim/index.js` emptied — the file that defines `WASI` | pass | pass | pass | **FAIL** |
| 13 | `browser_wasi_shim/wasi_defs.js` emptied — the file that defines `Ciovec` | pass | pass | pass | **FAIL** |
| 14 | a chunk missing from the built `out/`, source untouched | pass | pass | pass | **FAIL** |
| 15 | `window.*` in `agentWorker.js`, the entry | pass | pass | pass | pass |
| 16 | `window.*` in `speechWorker.js`, the entry | pass | pass | pass | pass |

\* Rows 5, 15 and 16 are sensitive to **how** they are injected, which is worth
saying out loud because it is how a fault table lies. Writing row 5 as
`const _use = zzNoSuchExport` also fails lint, on the unused binding, not on the
missing export; writing rows 15 and 16 as `const _href = window.location.href`
above the imports does too. Injected so that lint has nothing to see —
`self.name = window.location.href` — rows 15 and 16 pass **every step**. The
table gives each row the version where only the fault under test is present.

Rows 2–5 answer "does the build reach the workers": it does, and it fails on
unresolvable specifiers and on missing exports, by name —
`Export zzNoSuchExport doesn't exist in target module`.

Rows 6–14 are the hole this file exists for. They have one shape in common: **a
module can parse, resolve and pass its unit tests and still be unable to run in
the realm it was written for.** Rows 8, 9 and 11–13 add a second: everything
under `public/sandbox/` is a realm entry point that no bundler ever sees, so
nothing resolved anything in it — not the worker, and not the three files it
pulls in with `importScripts`.

Row 7 fails `test` only because a test happens to import `composition.js`
directly. Row 6 is the same fault one file further out and no test imports
`worker.js`, so nothing saw it. That difference is the whole argument: **tests
prove a module behaves; they prove nothing about whether the realm boundary is
wired.**

ARCHITECTURE.md:21 says the boundary is "enforced by the realm, not by convention".
That is still true of the *boundary* — a component genuinely cannot import
`backend/` and have it work. It was not true of the *gate*: nothing executed a
realm, so nothing could tell a file that runs there from one that only compiles
for there. It is now true of two realms out of four. See "What this still cannot
see", below, for the other two.

## What the smoke does

`scripts/smoke.js` serves `out/` from `Bun.serve`, drives headless Chrome over
raw CDP, and makes two realms answer:

- **the page and the backend worker.** It waits for `data-live` on the wordmark,
  which goes true only after `worker.js` has answered `conversations.list`,
  `settings.get`, `agents.list` and `conversations.create` — one attribute, but
  reaching it exercises the envelope, IndexedDB and the agent catalogue fetch.
- **`public/sandbox/vm-worker.js`, running an actual guest.** The smoke serves a
  ~300-byte wasm module it assembles itself (`scripts/wasm/tinyGuest.js`), posts
  `boot` and then `run`, and requires the answer to be `stdout: '!'` with exit
  code 0.

The second one is deliberately not a refusal. Asking the worker to run a command
with no image loaded — which is what this step used to do — returns from the top
of the handler, before `runOnce` touches a single symbol from the three files
the worker imports. Rows 11, 12 and 13 all passed that version of the check. The
tiny guest calls `fd_write`, `fd_read` and `poll_oneoff`, which is the path
through `new WASI` (the shim), `Ciovec` (`wasi_defs.js`) and `Subscription` /
`Event` / `EventType` (`wasi-util.js`); it also imports one call the shim does
not implement, so the worker's socket-stubbing loop runs too. A missing file now
arrives as an answer naming it:

    smoke: the sandbox worker ran the guest and returned
      {"ok":true,"stdout":"!","code":-1,"trap":"Subscription is not defined", ...}
    smoke: the sandbox worker ran the guest and returned
      {"ok":false,"message":"WASI is not defined"}

The guest is hand-assembled from bytes rather than compiled because a toolchain
would be a dependency and a checked-in binary would be unreadable. The real
guest image is ~100 MB and cannot be a gate's dependency at all.

Rejected, with reasons:

- **Making the build bundle every worker entry.** It already does. This was the
  narrow reading of the original claim and it fixes nothing that is broken.
- **A resolver that walks the import graph from each realm entry and fails on an
  unresolvable specifier.** For `src/backend/**` this duplicates what `next build`
  proved above. For `public/sandbox/**` it would have caught rows 8, 9 and 12–13
  — but only by re-deriving, in a second implementation, what the browser
  settles by loading the files. It cannot see rows 6, 7, 10, 11 or 14 at all,
  because those are not resolution failures.
- **A denylist of page-realm spellings (`window`, `document`, `localStorage`) in
  `src/backend/**`.** A list of forbidden words is a guess at the failure, not the
  failure. `WorkerGlobalScope` grows, `window` appears legitimately in strings and
  comments, and every miss is silent. It is also the one design that would have
  caught rows 15 and 16, which is worth weighing honestly — and still not enough
  to buy a check whose failures are all invisible.

## What this still cannot see

**Rows 15 and 16: two of the four worker realms are never executed.** `data-live`
goes true off `worker.js` alone. `agentWorker.js` is spawned by
`AgentWorkerPool` at the first sub-agent call and `speechWorker.js` by
`speechBackend()` at the first dictation, and neither happens without a model or
a microphone. Their *import paths* are covered — that is rows 3 and 4, and the
build catches those — but a page API at the top of either file ships green.

Closing it needs a change in `src/`, which is why it is written down here
instead of done: `src/app/page.jsx` would have to force both spawns before it
sets `ready` (an `AgentWorkerPool` warm-up and a `speechBackend().ready()`), or
expose the two worker URLs so the smoke can boot them the way it boots
`vm-worker.js`. Deriving the chunk names out of `out/` is the re-implementation
rejected above.

**Row 14 is a deploy fault, not a source fault.** It was produced by deleting a
chunk from a built `out/`; `bun run smoke` rebuilds first, so nothing in the
source tree reproduces it. It is in the table because it is the one fault that
reaches the page's own give-up text — see below.

**Two agents cannot run the gate in one working tree, and it fails false-RED
three different ways.** Four coders shared this tree for one wave, and each of
them watched a green tree go red under a concurrent slice. All three failures
are the gate reading a tree that is being written, and none is a fault in the
source:

    build   ENOENT .next/static/<hash>/_buildManifest.js.tmp
            — `bun run build` deletes `.next` and `out` before it compiles, so one agent's
              clean throws away the other's half-written output
    smoke   smoke: the backend never reached ready (data-live=none), 404 on /ASKK/
            — the same clean, this time under a Chrome already fetching out/
    test    330 pass / 1 fail in test/core/speech/index.test.js
            — the runner imported src/core/speech/ while that slice was
              rewriting all eight of its files

Every one passed on re-run. That is the cheap direction to fail, and it is still
a gate that cannot be trusted on a single observation: a real red and a
concurrent red are indistinguishable from the output. The fix is one worktree
per slice, not a retry — and until there is one, **"`bun run check` is green" is
not a claim a coder in a shared tree can own.** Only the run after integration
settles it.

**Two failures spend the full 15 s ceiling.** Rows 10 and 14 report nothing on
either console channel, so there is nothing to short-circuit on. Every other
failing row answers in well under a second: row 6 in 149 ms, row 7 in 153 ms.

## Four things in the smoke that look removable and are not

All four were measured by deleting them and watching.

**The `/favicon.ico` 204.** Chrome asks the *origin root* for it, outside the
base path, and a static host at a subpath answers 404 — which arrives as a
console error and fails the run on a page that is perfectly fine. Deleting the
branch turns the gate red on a healthy tree:

    smoke: the backend never reached ready (data-live=false) after 126ms
      network: Failed to load resource: ... 404 (Not Found) <http://127.0.0.1:63604/favicon.ico>

**Both CDP error channels.** They look like two subscriptions to one stream.
They are not, and neither one sees the other's faults:

    a page-realm uncaught throw    Runtime.exceptionThrown only
    a worker-realm uncaught throw  Log.entryAdded (source: worker) only

Dropping `Log.entryAdded` would blind the gate to exactly the class of fault it
was written for — the whole of rows 6 to 9.

**`SIGKILL`, and then waiting for the browser to be gone.** The teardown used to
send the default `SIGTERM` and delete the profile directory immediately, so
Chrome re-created it on the way out. Measured in a private `TMPDIR`, eight runs:

    kill() then rmSync             8 profiles left of 8 runs
    kill('SIGKILL'), await exited  0 profiles left of 8 runs

The machine this was found on had 167 of them.

**The signal handlers.** Without them, a `SIGTERM` to the smoke — a tool
timeout, a Ctrl-C, an agent that gave up waiting — skips teardown entirely.
Measured, two seconds after the interrupt:

    no handler    1 profile left, 10 Chrome processes still alive
    handler       0 profiles, 0 processes, exit 130

## What the page says, and when

A failing realm-one run also prints the page's own give-up text, when there is
any. There usually is not: that text is rendered by the client's give-up path,
which listens on the worker's `error` event, and a module worker's top-level
throw does not fire it — it arrives as an unhandled rejection instead. Of every
row in the table only row 14 reaches it:

    smoke: the backend never reached ready (data-live=false) after 15010ms
      the page says: The backend did not start.Reload the page.

Everything else is silent there and loud in `problems`. The line stays because
row 14 is a real way to ship a dead page, and it is the only view of it.

## Cost

`bun run check` is run by every agent many times an hour, so the smoke has to
earn its place twice: once by catching something, once on the clock. Medians of
five interleaved runs, alternating the two versions of the file so that machine
noise lands on both:

    lint + test + build                    2.74 s
    check, before this slice               3.72 s
    check, after                           3.55 s
    the smoke step alone, before           0.74 s
    the smoke step alone, after            0.72 s

Booting and running a guest costs nothing measurable: the module is ~300 bytes,
`WebAssembly.compile` on it is sub-millisecond, and the round trip is one
`postMessage` more than the refusal it replaced. What it buys back is the
`SIGKILL` teardown, which no longer waits for Chrome to shut down politely.

An earlier version of this step took 1.81 s. `--disable-gpu` was **0.93 s of
it** — more than half — and bought nothing: `--headless=new` already falls back
to software rendering where there is no GPU, so the flag only forces the slow
path on machines that have one. `--no-first-run` and `--no-default-browser-check`
went with it: the profile is a fresh `mkdtemp` directory discarded at the end of
every run, so there is no state for either flag to suppress.

## Requirements

The smoke needs a Chromium. It looks at `$CHROME` first, then the usual macOS and
Linux paths. **A missing browser fails the step**; it does not skip it. A check
that quietly opts out on the machine where it matters is not a check, and this
repository has shipped a dead page under a green gate before.

`bun run smoke` builds first. It used to run `scripts/smoke.js` against whatever
`out/` happened to be lying around, which is how it reported `ready in 176ms` over
a `src/` tree carrying row 6 — the exact fault this whole step exists to catch.
Inside `check` it was safe, because build ran first; alone it manufactured the
false green. `check` now composes `smoke` rather than repeating the build, so it
costs nothing.
