# What the gate proves

`bun run check` is five steps. This page says what each one can see, and what it
still cannot, because the question came up as a claim that turned out to be half
wrong, and the only way to settle any of it was to break the tree deliberately
and watch.

    lint    biome over src, scripts, test, bench, next.config.js,
            public/sandbox/vm-worker.js
    test    bun test --isolate ./test, importing modules directly
    build   next build, static export
    smoke   scripts/smoke.js — boots out/ in headless Chrome

`check` is `lint && test && smoke`, and `smoke` composes `build`, so the four
steps above are what runs and the definition lives in `package.json` once.

**Two of those targets collide with the benchmark rig's output, and only one of
the collisions is fixed.** `bun run bench` writes a throwaway workspace under
`bench/work/`, seeded from task fixtures and filled by both arms' models. That
directory is in `.gitignore`, which stops neither tool: `bun test` was scoped to
`./test` because the rig writes files matching both `test` and `test/` (measured
with two failing files planted at once: `test` → 2 fail, `test/` → 1 fail,
`./test` → 0), and `biome check` was **not** scoped, because `biome.json` has no
`vcs` block and so does not read `.gitignore` either. Measured: without `bench`,
123 files clean; with `bench` after a benchmark run, 136 files and **6 errors**,
all six in files a model wrote. **Running the benchmark turns this gate red and
the gate cannot tell that from a real fault.** `docs/LEDGER.md`, row S30.

Every row in the table below is one exact edit applied to a clean tree, all four
steps run, then the file restored byte for byte. `pass` means the step went
green **over the fault**.

**There is a fifth step now and this table has no column for it, which is stated
rather than filled in.** `bun run toolchain` (`scripts/wasm/toolchain-check.js`)
boots three more real guests and makes them write a Python module, run a
`unittest` suite over it and read the result back out of a later guest. Adding a
column would mean re-running twenty-odd fault rows against it, and nobody has;
inventing the cells would be worse than leaving them out. What IS measured about
it is the one thing that matters: **it is the only step that can see the guest's
contents.** Put the pre-Python guest back under the current tree and `bun run
smoke` passes in every particular — it asserts `uname`, an exit status and a file
round trip, and none of those names Python — while this step exits 1 with *"the
guest has no python3"*. Cost: 8.9 s.

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
raw CDP, and makes **four** realms answer — the page, the backend worker, a
sub-agent's own thread, and the classic sandbox worker — driving four features
by clicking or typing at them.

It also serves a **scripted model**: an OpenAI-compatible endpoint on the same
host that answers with a reply chosen by what the prompt it was sent already
contains, on both the plain-JSON and the SSE paths, because the page streams
whenever anyone is watching. Nothing of the tree is mocked by it. The transport,
the contract, the parser, the loop and the toolbox are all the real ones; the
only thing standing in for reality is the model, and the branch it takes is read
off evidence in the prompt rather than off a turn counter, so a reply arriving in
the wrong order fails rather than passing by luck.

- **the page and the backend worker.** It waits for `data-live` on the wordmark,
  which goes true only after `worker.js` has answered `conversations.list`,
  `settings.get`, `agents.list` and `conversations.create` — one attribute, but
  reaching it exercises the envelope, IndexedDB and the agent catalogue fetch.
- **the file view, through the rail.** Every other assertion in this step is
  made by calling something. This one clicks: it plants two files in a real
  `Workspace`, presses `[data-testid="files-toggle"]`, opens the file from the
  listing, and asserts the bytes on screen, that they are coloured, that the
  download hands over the SAME bytes under a flattened name, that a file in no
  known language is told which languages there are, and that the pane says it is
  read-only. It is here because nothing else can see it: `bun test` has no DOM
  and this tree has no component renderer, so a `FilesPanel` that never calls
  `files.list`, a colour cap of 1, an `INSTRUMENTS` without `files`, a download
  carrying the wrong bytes and a page that never mounts the component at all
  were five deletions of the feature, all green at 665/665, measured by mutation
  on 2026-09-01. All five are red now. **Two are still green** and both need a
  real model — the run panel discarding its steps at turn end, and `turnsDone`
  never bumping — which is `scripts/deploy-check.js`'s ground and not this
  step's. `docs/LEDGER.md`, rows S46 and S47.

- **a sub-agent's own thread.** `AgentWorkerPool` is asked for `researcher`; the
  thread fetches its own agent file from the base path the pool handed it,
  builds the tools its own file declares, reads a page with its own `fetch`,
  reports each finished pass, and answers — and the check asserts the name the
  worker reported for `self.name`, not the name it was asked for. This realm was
  the one on the architecture's diagram nothing had ever entered.
- **a delegating turn, typed into the composer.** The parent chooses to call the
  researcher, the rail is watched by a `MutationObserver` while it happens (a
  poll on a timer read either side of the line it was looking for), and the
  answer is asserted in the transcript. It also asserts the clock moved, which
  is the difference between an app that is working and one that is wedged.
- **work handed over and read back.** Two typed questions: the first hands a
  question to another agent with `wait: false` and answers immediately; the
  second is where the context block reports it finished and the parent reads it
  with `check_task`.
- **a question that asks itself.** A schedule is created by clicking through the
  panel, and the reload runs the tick. What that proves is a NEW schedule firing
  once; the overdue path — a real past `lastRanAt`, reopened after its period —
  is not covered, and saying so is the difference between a check and a claim.
- **an app that is ready and a model that is not.** The discard port is planted
  as the model address and the page has to say which address it tried. Pointing
  it at the default would make the check depend on whether whoever runs the gate
  happens to have a model server up.
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
guest image is ~100 MB and cannot be a gate's dependency at all — which is not
the same as saying the gate may never run it, and the third realm is what that
distinction bought.

- **the real guest, through `src/backend/sandbox/C2wSandbox.js`.** Two
  waves measured this guest and neither ever ran it through the tree's own port:
  everything known about it came from scratch copies of the host half, and a
  refuter killed both claims for exactly that. This step imports the real module
  — possible only because there is no transpile over `src/`, so the browser gets
  the file the repository holds — points it at `out/sandbox/sandbox.wasm.gz` and
  `out/sandbox/vm-worker.js`, and runs two commands. It asserts
  `available === true`, that `uname -a` answers a line starting `Linux `, and
  that a failing command's diagnostic comes back.

  **The `.gz` is the point, not a detail.** GitHub blocks any file over 100 MiB
  and the block is on the file at rest, so the uncompressed guest could be in
  neither the repository nor the Pages branch and
  `https://kaush4l.github.io/ASKK/sandbox/sandbox.wasm` was a 404 while the page
  beside it answered 200. `gzip -9` is under the limit, GitHub takes it, and
  `vm-worker.js` inflates it with `DecompressionStream`. Pointing this step
  at the raw module would prove the emulator runs and prove nothing about the
  artifact that ships, so it asserts the boot note carries two DIFFERENT sizes:
  a gzip stream does not begin `\0asm`, so a loader that stopped inflating, or a
  build that shipped the raw module under this name, fails here rather than
  sending a visitor the whole uncompressed module.

  **The two sizes live here and nowhere else.** They are a measurement, and a
  measurement that is copied into a comment becomes a confident lie the next time
  `scripts/wasm/build.sh` runs. What belongs in a comment is the threshold — over
  100 MiB raw, under it compressed — because that survives a rebuild. Measured
  2026-09-01, on the artifact `scripts/wasm/build.sh` produced:

      wc -c public/sandbox/sandbox.wasm          143205983   (136.6 MiB)
      wc -c public/sandbox/sandbox.wasm.gz        52602121   ( 50.2 MiB)
      shasum -a 256 public/sandbox/sandbox.wasm  ed788162…e96f47b
      gzip -dc public/sandbox/sandbox.wasm.gz | shasum -a 256   the same digest

  Re-measured by the accountant on 2026-09-01 after the guest gained Python; the
  pair before it was 107,054,914 / 40,029,960, and that is the number still
  written into `C2wSandbox.js`, `composition.js`, `deploy.js` and `tinyGuest.js`
  (`docs/LEDGER.md` row S54). **The two sizes above are the WORKING TREE's**: the
  blob at `HEAD` is still the pre-Python one, so the fifth step of this gate is
  red on a fresh clone (S51).

  100 MiB is 104,857,600, so the raw module is 38,348,383 bytes over and the
  compressed one uses 50.2% of what is left. The last
  line matters more than the sizes: the `.gz` inflates to the raw module's own
  digest, so the compressed artifact is the same guest and not a stale one.

  Two other compressors were priced and neither earns its time. Against
  `gzip -9`'s 10.5 s (`time gzip -9 -c … > /dev/null`), brotli q11 with a
  `BROTLI_PARAM_SIZE_HINT` reaches 30,089,508 in 116.1 s and zstd −19 reaches
  30,617,879 in 15.8 s (both via `node:zlib`, same machine, same day). Both are
  ~24% smaller, and neither is reachable: the loader sniffs `1f 8b` and runs
  `DecompressionStream('gzip')`, and a static host that answers a `.br` or `.zst`
  with `Content-Encoding` would inflate it before `fetch` resolved anyway. The
  saving is real and it is not worth a second format in the loader.

  **What the real host sends was a hope and is now a measurement.** The loader
  sniffs the magic bytes instead of switching on the extension, which is correct
  either way — but only one of the two ways needs the inflate, and which one
  GitHub Pages picks had never been asked. It can be asked without deploying, on
  somebody else's Pages site that already serves a `.gz`:

      curl -s -D - -H 'Accept-Encoding: gzip, deflate, br' \
        https://yanniboi.github.io/game-ci-test/Build/WebGL.wasm.gz

      HTTP/2 200 · server: GitHub.com · content-type: application/gzip
      content-length: 3289414 · NO content-encoding
      curl -s -r 0-7 <same url> | xxd  ->  1f8b 0818 7f24 3f61

  Raw gzip bytes, no `Content-Encoding`, body beginning with exactly the `1f 8b`
  the loader looks for. So on the deploy `fetch` does NOT pre-inflate, the sniff
  fires and `DecompressionStream` runs — the path the smoke exercises is the path
  that ships. Measured 2026-09-01.

  **None of which is deployed.** Same day, `curl -s -o /dev/null -w '%{http_code}'`
  against `https://kaush4l.github.io/ASKK`: `/` 200, `/sandbox/vm-worker.js` 200,
  `/sandbox/sandbox.wasm` **404**, `/sandbox/sandbox.wasm.gz` **404**. The
  compressed guest is built and gated and it is not tracked, so every `shell`
  call on the live page still reaches `boot-failed`. This step proves the
  artifact works; it cannot prove anyone can reach it, and nothing here should be
  read as saying the 404 is closed.

  It also asserts, from `out/_next/static/chunks/`, that some chunk contains the
  string `/sandbox/sandbox.wasm.gz` — or, under a `SANDBOX_IMAGE` override, that
  URL instead. That is not decoration. Until this slice
  `composition.js` read the image URL from an environment variable nothing
  anywhere set, so every build ever made shipped `imageUrl:""` and the string
  `sandbox.wasm` appeared nowhere in `out/_next/` at all. A source-level check
  cannot see that fault, because the source was always readable and always
  wrong; only the artifact says whether the URL survived into it.

  **The image is a build output, so a clone that has never run
  `scripts/wasm/build.sh` may have none.** The step then SAYS it
  is skipping and why, in one line on stdout, and the chunk scan still runs — a
  build that forgot where its guest lives is a source fault and fails on any
  machine, with or without a guest on disk. A check that opts out silently is the
  thing this file was written against; a check that cannot run at all until
  `scripts/wasm/build.sh` has been run once is a check nobody can adopt.

  It also asserts the exit status, and that assertion is the only place in the
  gate where the status can be proved: a fake sandbox in a unit test prints
  whatever the test wrote into it. This step used to assert the WRONG value —
  the c2w module's `proc_exit` is the emulator's and returned 0 whatever ran —
  pinned red-on-repair the way `Toolbox.test.js` pins the tool that throws. The
  repair landed, the pin came out with it, and `C2wSandbox` now asks the shell
  for the status on stdout. `docs/LEDGER.md`, row S20.

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

## What it can see now that it could not

Three checks were added after three blind reviewers drove the built page and
found faults that ~880 unit tests could not, because every one of them is a fact
about how the page LAYS OUT or about what is on screen WHILE something happens.

**The settings sheet, on a phone.** Opened at 390x844, then measured: the wrap's
overflow, the right edge of every descendant against the viewport, and whether
Escape closes it. It earned its keep on the run that added it, finding a 3px
overflow nothing could see — a `<label>` is itself a grid, so `min-width: 0` on
it narrows the label and leaves its single `auto` column sized to the longest
option of the `<select>` inside, which then overflows the box that was correctly
narrowed.

**Every control a finger has to hit.** Measured across everything on screen at
once rather than control by control, because a named list would only ever have
measured the ones somebody remembered. Two facts cost a run each:
`Emulation.setDeviceMetricsOverride` **resizes and nothing more** — with the
width alone `matchMedia('(hover: none)').matches` is false, so every touch rule
in the stylesheet is inert and the desktop's controls are measured at the
phone's width and pass. `Emulation.setTouchEmulationEnabled` is what flips it;
`setEmulatedMedia` takes `prefers-color-scheme` and answers false for hover and
pointer.

**The reply's contract, while it streams.** A `MutationObserver` watches for
`think:`, `plan:`, `act:` or `result:` appearing in the transcript for the
length of a turn. It watches `document.body` and not the transcript, because on
a cold page there are no messages, the empty screen is what is mounted, and the
transcript element does not exist yet — the first version attached to null and
passed by never having run.

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

Re-measured when the real guest was added, same machine, three runs each:

    the smoke step, image absent (skipped)   0.71 s
    the smoke step, the raw image            2.33 / 2.30 / 2.49 s
    the smoke step, the gzipped image        2.41 / 2.58 / 2.38 s

The 1.6 s is the guest and nothing else: 0.94 s for the cold call — the fetch
over loopback, the inflate, `WebAssembly.compile`, an instance and the Alpine
boot — and 0.73 s for the second, which pays for everything but the fetch and
the compile. **Compressing the image cost the gate nothing measurable**: the
cold call went 1015 / 951 / 965 ms raw to 1011 / 1046 / 1023 ms gzipped, because
inflating 40 MB buys back most of the 67 MB it no longer moves. Over loopback
that trade is a wash and the number to keep is the deploy's: 67 MB less down a
real connection. Measured separately, cross-origin over loopback in
`scripts/probe/results/2026-09-01T10-13-54-host.md`, the inflate itself is
~150 ms — a raw cross-origin boot is 51 ms and a gzipped one 199 ms. It is the
most expensive thing in the gate, and the only thing in the gate that executes
the substrate this project's claim rests on. A machine that does not want to pay
it does not have the file.

The file view costs **0.20 s**, which is what clicking through a built page in a
real browser is worth. Medians of three interleaved runs against one `out/`,
alternating the two versions of this file so machine noise lands on both:
4.89 s without the section, 5.09 s with it. Measured 2026-09-01, on the guest
image of that day — the whole step is seconds rather than the 0.72 s priced
above because the image grew, not because of this.

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
Linux paths. It does NOT need `public/sandbox/sandbox.wasm.gz`: without it the
third realm prints that it was skipped, and everything else still runs.
**A missing browser fails the step**; it does not skip it. A check that quietly
opts out on the machine where it matters is not a check, and this repository has
shipped a dead page under a green gate before.

`bun run smoke` builds first. It used to run `scripts/smoke.js` against whatever
`out/` happened to be lying around, which is how it reported `ready in 176ms` over
a `src/` tree carrying row 6 — the exact fault this whole step exists to catch.
The same trap eats mutation checks: `public/sandbox/` is COPIED into `out/` at
build time, so an edit to `public/sandbox/vm-worker.js` followed by bare
`bun scripts/smoke.js` measures the old worker and passes. Row 3 above was
re-verified that way once and read as a hole in the gate before the rebuild
turned it red. Mutate, then `bun run smoke`, never `bun scripts/smoke.js`.
Inside `check` it was safe, because build ran first; alone it manufactured the
false green. `check` now composes `smoke` rather than repeating the build, so it
costs nothing.
