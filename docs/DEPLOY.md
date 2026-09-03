# The deploy

Until this slice there was no deploy step in this repository at all. What is on
`gh-pages` was made on somebody's machine by hand for the whole life of this
project — 56 files, 25,155,729 bytes, no guest image — so
`https://kaush4l.github.io/ASKK/sandbox/sandbox.wasm.gz` answered 404 while the
page beside it answered 200, and every `shell` call a visitor made reached
`boot-failed`. The environment this project is *for* had never reached anyone
but us.

**It has now.** `3ddc99d` (*Deploy 084268b*) was the first commit on that branch
written by `scripts/deploy.js` rather than by hand, and the first that carried
the guest; `589f541` (*Deploy f9ad603*) is what is live. Measured after the
first push: measured live, `/ASKK/` answers 200 and
`/ASKK/sandbox/sandbox.wasm.gz` answers 200 with `content-type:
application/gzip` and `access-control-allow-origin: *`. The published page boots
with no console errors, its empty state names what is missing, its settings
sheet opens and closes, and its drawer holds all five sections. What is still
unmeasured on the live host is a whole turn, because a page on `https` may not
call a model on `http`, and there is no https model to point it at.

Two commands now, and neither publishes:

```
bun scripts/deploy.js         # dist/ — from a clean checkout of a commit
bun scripts/deploy-check.js   # open dist/ in a real browser and make it work
```

`package.json` is not owned by this slice, so there are no `bun run deploy`
aliases yet, and **`bun run check` does not reach either script**. Nothing in
this repository runs them. Adding `"deploy": "bun scripts/deploy.js"` and
`"deploy:check": "bun scripts/deploy-check.js"`, and a row in `docs/GATE.md`
saying neither is under `check` and why, is the owner's one-line change — and
until it is made, this is a deploy that is declared, documented as load-bearing,
and invoked by nothing, which is the shape this tree has shipped eleven times.

## What each one needs

Written down because `docs/GATE.md` writes its own down, and because a step that
silently needs a thing blames the wrong thing when the thing is missing.

| | `deploy.js` | `deploy-check.js` |
|---|---|---|
| `git`, `tar`, `bun` | yes | — |
| a network for `bun install` | first run only (bun hardlinks from its cache after) | — |
| a Chromium | — | yes; `CHROME` overrides the search |
| a model on the OpenAI wire, **already running**, at `http://127.0.0.1:8873/v1` | — | **yes**; `MODEL_URL` and `MODEL_NAME` name another one, and the address is asked before a browser is launched |
| a `dist/` from `deploy.js` | — | yes, including its `deploy.json` |

The model is the one that bites, and until this pass nothing in the check ever
said its name. `SettingsService.DEFAULT_SETTINGS` shipped
`http://127.0.0.1:8873/v1` and `Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp` — one
machine's, the one `docs/TESTBED.md` records — so a page that had been
configured by nobody was already pointed at a real server, and `deploy-check.js`
inherited that without a line about it. Those defaults are gone, because the
header advertised that model as live while the page under it said there was
none. **So the check plants the model itself**: the settings record goes into
the same IndexedDB store the app boots from, exactly as `scripts/smoke.js`
plants its own, and the page is reloaded onto it — *after* the isolation and
first-load cells, so what a stranger pays is still measured on the page a
stranger gets, with nothing configured.

**It needs a real model by design.** This is the one thing in the tree that
drives the whole loop through the artifact a visitor downloads, and there is no
scripted endpoint in it standing in for one as there is in the smoke; a scripted
model would prove the page can talk to `deploy-check.js`. The address defaults to
`http://127.0.0.1:8873/v1` and the model id to
`Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp` — the testbed, so an operator who already
had this working changes nothing — and **`MODEL_URL` and `MODEL_NAME` override
both**. With nothing there, a `GET $MODEL_URL/models` is refused in
milliseconds and the run stops naming the address, both variables and the reason
it insists on a model. Before, it drove two turns that never answered, spent up
to 2×300 s, and reported *the loop never surfaced the guest's output: ""* —
blaming the loop, the sandbox and the emulator for a server nobody had started.

---

## 1. The 38 MiB decision

> **Every byte count on this page is from before the guest gained Python.** The
> tracked blob at `HEAD` is still 40,029,960 and the working tree's is
> **52,602,121**, from a 143,205,983-byte module. The decision this page argues
> for is unchanged and its price went up by 12,572,161 bytes, which is the number
> to carry away rather than the ones below. Re-measured by the accountant,
> 2026-09-01; `docs/LEDGER.md` rows S51 and S54. The transcripts further down are
> kept verbatim as records of runs that happened, not as current figures.

`public/sandbox/sandbox.wasm.gz` — 40,029,960 bytes at `HEAD`, 52,602,121 in the
working tree — **is tracked**, and this is the argument for it rather than a note
that it happened.

The state the last survey found, where `.gitignore`'s comment described a
tracked artifact and the index held none, is gone: `git ls-files
public/sandbox/` now lists six files including the `.gz`, and
`git check-ignore public/sandbox/sandbox.wasm.gz` still exits 1. The comment and
the index now say the same thing. **`CAPABILITIES.md` still says the opposite**
— see §6.

**What it costs, measured on this repository.**

| | |
|---|---|
| the artifact | 40,029,960 bytes (38.2 MiB), from a 107,054,914-byte module, 2.67:1 |
| as a packed blob | 39,727,190 bytes — gzip output does not delta or re-compress |
| every blob in all history | 7,040 blobs, 1,226,656,622 bytes (1.14 GiB) |
| the guest's share of that | **3.24%** |
| `git clone --depth 1` | 1.5 s, `.git` 40 MiB, working tree 45 MiB |
| `git clone` (full) | 29.0 s, `.git` 1.2 GiB |

The number that decides it is the third row against the fourth. This repository
is 1.14 GiB of blobs *before* the guest, and none of that is the guest's doing:
the largest objects in its history are `bin/rust.tar.gz.part-aa` (94 MB), three
generations of `wasm/out.wasm.gz.part-aa` (93 MB each), Hermes image layers
(82 MB, 48 MB, 37 MB) and `crates/web/assets/vm/alpine.iso` (45 MB) — the
sediment of four previous incarnations of this project. Arguing about 38 MiB
here is arguing about the last 3% of a bill already paid.

And the cost is not paid by the people who matter. A shallow clone is 45 MiB
whatever the history holds, and a shallow clone is what a deploy does and what
anyone who wants to run this needs. What a full clone pays grows by ~38 MiB
**per rebuilt guest**, permanently — that is the real and permanent cost, and it
is the reason `scripts/wasm/build.sh` should not be run casually.

**The two alternatives, and why neither is taken.**

*Build it in the deploy.* This is the right answer for most binary artifacts and
it is not available here. `scripts/wasm/build.sh` clones container2wasm at a
pinned SHA, patches two dead upstream origins, builds a Go CLI from source, and
drives Docker buildx over an Alpine image. It needs Docker, Go and a network
that can reach several origins, and it produces a 107 MB module that then has to
be compressed. A deploy that cannot run without Docker is a deploy that will not
run, and a page whose environment depends on a third-party clone succeeding is
back where the 404 came from.

*Host it elsewhere.* The tree already has the lever — `SANDBOX_IMAGE=<url> bun
run build` compiles a foreign URL into the chunk, and `scripts/deploy.js` passes
the variable through. It is genuinely attractive: GitHub Releases takes files of
any size, and the `host` probe measured a cross-origin guest booting from three
header profiles including huggingface's. It is not the default for one reason:
**it has never been exercised against a real host**, `CAPABILITIES.md` marks it
`unverified` in every cell, and choosing an unverified path as the default way
the project reaches strangers is how the 404 happened the first time. It stays
the override it is, for a host that will not take 38 MiB.

**And until this pass it could not have served that host.** `deploy.js` required
`sandbox/sandbox.wasm.gz` to be in the export unconditionally and shipped it
whatever `SANDBOX_IMAGE` said, so a deploy aimed at a host with a 25 MiB asset
ceiling — the case named in the paragraph above — produced a directory that host
rejects. Exercised end to end for the first time, with
`SANDBOX_IMAGE=https://example.invalid/guest/sandbox.wasm.gz`:

```
57 files, 25177550 bytes (24.0 MiB)
the guest is not in this export at all; the page will ask https://example.invalid/guest/sandbox.wasm.gz for it
1 chunk(s) name https://example.invalid/guest/sandbox.wasm.gz
```

The guest is now required only when the build was told to load it from the
export, and dropped from the output when it was not. What is still unverified is
everything after that: no foreign host has ever answered.

So: tracked, deliberately, with the cost written down here so that the next
person to rebuild the guest knows what they are adding.

---

## 2. What `scripts/deploy.js` does

**From a clean checkout, always.** `git archive <ref> | tar -x` into a temporary
directory, then `bun install --frozen-lockfile` and `bun run build` there.
Nothing in the developer's working tree can reach the output, and the run says
so out loud when the tree is dirty, because shipping a commit while looking at
an uncommitted fix is the most likely way for this script to lie.

That is not ceremony. `next build` copies `public/` **whole**, and a developer's
`public/sandbox/` holds `sandbox.wasm` — the raw module, 143,205,983 bytes as of
this wave, which is gitignored precisely because it is far over GitHub's per-file
block. A deploy built in place carries a file the host refuses. A deploy built
from an archive of the ref cannot, because the file is not in the ref.

It also answers the only question a deploy is really for: can somebody who has
this repository and nothing else produce the page? `bun install
--frozen-lockfile` in a directory with no `node_modules` is that question asked
properly. Measured: 301 tracked files extracted, install 0.2 s (bun hardlinks
from its global cache), build 4.2 s, 770 MB of `node_modules` created and thrown
away.

**Then it refuses to ship a directory that cannot work.**

| guard | what it catches |
|---|---|
| `--out` names an existing non-empty directory without `index.html` **and** `.nojekyll` | the publish step is `rmSync(destination, {recursive: true, force: true})` on a path a human typed: `--out .` deleted the working tree and `--out ~` the home directory, and nothing asked |
| a flag with no value | `--out` with nothing after it used to reach that `rmSync` as `undefined`; `parseArgs` refuses it and the refusal is said as a sentence, not a `node:util` stack |
| `index.html`, `404.html`, `sandbox/vm-worker.js`, `agents/index.json` present — plus `sandbox/sandbox.wasm.gz` **when the build was told to load it from the export** | the live site's exact defect — a page deployed without its environment |
| no file over 104,857,600 bytes | a `public/` copied from a tree that had the raw module; a future guest that grows past the block |
| some chunk contains the configured image path, searched **recursively** under `_next/static/chunks/` | the fault that made every build ever shipped answer `UNAVAILABLE` without fetching a byte, because `composition.js` read an inlined constant nothing set. Today's 19 chunks are all at the top level, so the flat `readdirSync` this replaced was one nested chunk away from being blind |

**Every one of those guards now reads the ARCHIVED config**, not the developer's.
`deploy.js` imported `../next.config.js` at the top — so a build made from
`--ref <old>` was described by whatever config the developer had open, and the
chunk guard passed or failed on a string that ref never had. It is now
`await import(join(source, 'next.config.js'))` after the extract, with a literal
fallback for a ref older than the export it reads, because `--ref` is the flag
that import exists to serve. That is the exact leak `git archive` is here to
close, and it was open inside the script that argues for it.

**And it writes `.nojekyll`.** GitHub Pages runs Jekyll over a branch unless that
file is present, and Jekyll excludes every path beginning with an underscore —
which is `_next/`, i.e. every chunk, stylesheet and font. The page would answer
200 and render nothing. It is written by the deploy rather than kept in
`public/` because it is a fact about one host and not about this application.
`gh-pages` already has one, added by hand; this is the first time anything in
the repository knows why.

**And `deploy.json`, for the same kind of reason.** A fact a *server* needs that
a bundler does not know: the ref, the subject, the base path the build was made
for, and where that build was told its guest is. `deploy-check.js` reads it
instead of importing `next.config.js`, so a `dist/` can be checked at the prefix
it was actually built for rather than the one on the developer's screen — see
§5b. It is also the marker the destination guard looks for.

It does not push. A script that both builds and publishes turns one review into
none.

**The browser half of both checks is one file.** `scripts/browser.js` finds a
Chromium, launches it headless into a throwaway profile, wins the race for the
port file, dials the socket and attaches to a tab. `scripts/smoke.js` and
`scripts/deploy-check.js` both need those hundred and forty lines and neither
of them is about them; a second copy would have been a second place for the
profile leak and the port-file race to be fixed. It owns no assertion, no
server and no teardown order — each caller has its own host to stop and its own
idea of what a failure is — so it takes a `whenLost` and hands back a `close`.

**Measured output**, from `25c8750`:

```
deploy: dist
  58 files, 65207472 bytes (62.2 MiB)
  the guest is 40029960 bytes (38.2 MiB) of that, fetched on demand and not on load
  1 chunk(s) name /sandbox/sandbox.wasm.gz
```

The 58th file is `deploy.json`; it was 57 before it existed.

---

## 3. Cross-origin isolation, on the deploy

**The question.** A static host sends neither `Cross-Origin-Opener-Policy` nor
`Cross-Origin-Embedder-Policy`, so a page served from one is not cross-origin
isolated and has no `SharedArrayBuffer`. The usual technique is a service worker
that synthesises both headers onto its own responses. Is one in this tree, does
it survive the export, and does the deploy need it?

**The answer is that this application deliberately does not need isolation, and
adding it would cost something and buy nothing.** Measured in Chrome against
`dist/`, over a host that sends no COOP, no COEP and no CORP:

```
404 CONTROL          status=404 server=askk-deploy/1 coop=(absent) coep=(absent) corp=(absent)
page                 crossOriginIsolated=false  SharedArrayBuffer=undefined
classic worker       crossOriginIsolated=false  SharedArrayBuffer=undefined
service workers      registered=0  files in the export that register one=none
```

and in the same session, in that same un-isolated page, the guest booted and ran
a real command. The worker row is asked of the worker rather than inferred from
the page, because the page's isolation is not a statement about its workers and
inheritance was the assumption worth checking. The 404 control names the process
that answered and shows all three headers absent on the wire, so the pass is not
an artefact of something quietly adding them. It used to show two: the banner
claimed *no COOP, no COEP, no CORP* and the evidence cell measured COOP and COEP,
which is the shape of claim this line exists to refuse.

**Is a COI service worker in the tree?** One is —
`scripts/probe/page/coi-serviceworker.js` — and it is in the probe rig, not in
the application. The probe README claims the build cannot reach it. Confirmed
against the deploy rather than trusted: `deploy-check.js` scans every `.js`,
`.mjs`, `.html` and `.json` file in `dist/` for `coi-serviceworker` or
`serviceWorker.register` and finds **none**.

**Should one be added?** No, and the reason is the architecture rather than
laziness. `vm-worker.js` uses no `SharedArrayBuffer` and needs none: stdin is a
closed queue, `poll_oneoff` reports only clock subscriptions, and nothing ever
blocks on `Atomics.wait`. That is the whole reason container2wasm was chosen
over a pty. Against that, isolation costs a forced extra navigation on every
first visit (measured in `scripts/probe/results/`, `reloads=1`) and switches on
`require-corp`, under which every cross-origin subresource without a CORP header
is blocked — which this page has, since transformers.js pulls model weights from
huggingface, whose responses carry `corp: (absent)`.

The day this tree wants a **persistent shell** — one guest boot serving many
commands, with a filesystem that survives between them — it needs blocking
stdin, hence `SharedArrayBuffer`, hence isolation, hence the service worker. The
`isolation` probe has already measured that it works from a header-free host and
what it costs. That is the trigger to write it, and until then it is a layer
that earns nothing.

---

## 4. What a visitor pays

**First load, cold cache, measured off the wire as `encodedDataLength` from
navigation to the moment the page reports ready:**

```
ready in 166ms after 19 requests, 692306 bytes on the wire
the guest (40029960 bytes) was requested 0 time(s) before the first turn
```

**676 KiB, not 38 MiB.** The brief's premise — "first load, cold cache, is a
38 MiB transfer before anything runs" — is false, and it is false because
`composition.js` constructs the sandbox without booting it. Opening the page
costs the page.

**But the claim in `composition.js` is still wrong, and this is the finding.**
Two comments were involved and only one of them is false, which the first version
of this section got backwards. `src/backend/sandbox/C2wSandbox.js` says "an agent
that never runs a command must not have downloaded it" — **true**, because MCP
discovery *is* a command through that sandbox. `src/backend/composition.js`, at
the line that constructs the sandbox, says "the first `shell` call is what pays
for it" — **false**, and that is the sentence. `deploy-check.js` printed the
wrong file on every run until this pass; a reader following it found a correct
comment and would have closed the finding.

Measured, on the deploy, with the network of the nested worker realm attached:

```
## turn one — a question that needs no tool
  sent  "Reply with exactly: OK"
  said  "OK" in 15713ms
  note  mcp server host offered 1 tool(s); 1 allowed
  the guest was requested 1 time(s) by the end of this turn
```

A turn that called no tool at all fetched all 38.2 MiB. The cause is not in
`C2wSandbox`: `agents/main/agent.md` declares an MCP server, and
`discoverMcpTools` starts every declared server **once per turn, before the
prompt is rendered**, by running `printf '%s\n' '<request>' | mcp-disk` through
the same sandbox. So the boundary is the first *message*, not the first *tool
call*, and a visitor who types "hi" pays for the environment.

That is a defect and it is not this slice's to fix — it lives in `src/`. It is
reported in §6, and `deploy-check.js` prints `CLAIM REFUTED` with the reason on
every run.

**A printed line can only go quiet, so there is also an assertion.** Make
`discover.js` lazy and that line flips to `CLAIM CONFIRMED` with nothing holding
it there, and the false sentence in `composition.js` — wrong for every artifact
shipped in between — is never rewritten. `deploy-check.js` therefore carries a
recorded expectation, dated, that **fails the day the claim comes true**, with
the instruction to delete both it and the line it guards. That is the only shape
in which "it becomes a failure the day the claim is honoured" is a fact about the
code rather than a hope in a comment.

**What the guest costs once it is asked for:** 40,030,146 bytes on the wire
(the file plus response headers) in 76 ms over loopback, inflating to
107,054,914 bytes in memory. Over a real network that is the number that
matters, and nothing here has measured it over one — see §5.

### 4a. The two ways a host may answer a `.gz`

The guest ships gzipped and the loader handles both host profiles: a host that
declares `Content-Encoding: gzip` (the browser has already inflated the body,
and the magic-byte sniff correctly does nothing) and a host that does not (raw
gzip bytes reach the loader, `1f 8b` fires the sniff, `DecompressionStream` does
the work). GitHub Pages measurably does not declare it.

**Both arms are booted, by the same worker, in the same page.** Until this pass
only one was: the arm that does *not* ship was measured and asserted, and the arm
that *does* ship was a sentence — "the loader sniffed 1f 8b and inflated" —
printed four lines above an assertion whose own comment says a step that prints
what nobody compares passes over an empty answer.

```
no Content-Encoding (GitHub Pages)   {"type":"booted","bytes":107054914,"transferred":40029960}
Content-Encoding: gzip               {"type":"booted","bytes":107054914,"transferred":107054914}
```

Two different sizes on the shipping arm, one on the other. That difference is
asserted: equal sizes mean either a loader that stopped inflating or a raw module
shipped under the `.gz` name, and the second one sends every visitor 102 MiB.

---

## 5. What none of this proves

Stated in the same shape `scripts/probe/README.md` uses, because a measurement
whose limits are not written down is quoted past them.

- **Nothing has been deployed.** Every number here is `127.0.0.1` against
  `dist/`. Nothing in this slice touched `gh-pages`, and the live site is still
  the 404 described at the top.
- **It says nothing about GitHub Pages' own behaviour** beyond the one header
  measurement recorded in `docs/GATE.md`: no cache headers, no CDN, no
  `max-age=600`, no TLS, no HTTP/2.
- **One browser.** Headless Chrome on desktop macOS. No Safari, no iOS, no
  Firefox. The `host` and `isolation` probes cover WebKit for the guest and for
  isolation; the *deploy* has been opened in Chrome alone.
- **No mobile ceiling.** 38.2 MiB down and 102 MiB resident on a phone, over
  cellular, with tab discard, is the one cost with a plausible hard failure in
  it and it is unmeasured.
- **The model is local.** The agent loop was driven against `MODEL_URL`, which
  defaults to `http://127.0.0.1:8873/v1` and answers
  `access-control-allow-origin: *`. A
  visitor with a hosted key is a different CORS story, measured for the request
  shapes in `scripts/probe/results/` but not through this page.
- **The `Content-Encoding` arm is this server's.** Which of the two arms GitHub
  Pages takes was measured by `curl` against somebody else's Pages site and is
  recorded in `docs/GATE.md`; it has not been measured against ours. Both arms
  are now *run*, by the same worker over the same host — see §4a — where the
  shipping one used to be a sentence this file wrote about a boot nobody had
  watched.
- **The prefix is the artifact's, not the tree's.** `deploy-check.js` reads
  `dist/deploy.json`; it used to read `../next.config.js`. It therefore says
  nothing about whether the working tree still builds the artifact it is
  checking — that is `deploy.js`'s job, and `deploy.json` records which ref it
  was.

---

## 5b. How these checks were shown not to be vacuous

A check nobody has watched fail is not a check. Each was broken on purpose and
the failure recorded.

**Two rows are missing, and they are the two added above.** The model probe and
the settings plant were written on a machine with no server on `8873`, so the
probe has only ever been watched do the thing it does when there is no model —
*nothing answered at `http://127.0.0.1:8873/v1`*, in under a second, which is
the whole point of it — and the plant has never been run at all. They are the
only claims on this page resting on reading rather than running, and the first
person with a model owes them a row.

| break | what happened |
|---|---|
| `bun scripts/deploy.js --ref 22e64f0` — the commit before the guest was tracked | refused: *the export is missing sandbox/sandbox.wasm.gz*, exit 1. That is the exact tree state the live 404 came from |
| the per-file block lowered from 100 MiB to 1 MiB | refused, naming both files over it — the guest and the ort wasm — exit 1 |
| the chunk scan given the wrong string to look for | red, on a correct build. This one was not staged: the first version of `deploy.js` searched for the assembled URL, and the base path reaches the bundle as a runtime concatenation, so no chunk contains it. The check failed until the string was right |
| `dist/sandbox/sandbox.wasm.gz` deleted | `deploy-check.js` refuses before launching a browser, naming the state rather than throwing `ENOENT` |
| `dist/sandbox/sandbox.wasm.gz` replaced with a valid gzip of 25 bytes of text (43 bytes) | the browser run reached the model and failed on **three** assertions: *the loop never surfaced the guest's output*, *the shipping arm was not inflated*, and *the guest did not boot from a host that declares Content-Encoding*. The middle one is new; it was two before both host arms were run. The agent's own answer carried the reason: `WebAssembly.compile(): expected magic word 00 61 73 6d, found 74 68 69 73` |
| an `onEvent` handler made to throw | `driver: onEvent threw on Target.attachedToTarget: deliberate` — and the run now **fails in 51 ms**, where it used to print the line and carry on to a green finish. Anything the browser reports is a failure row, not a paragraph after the verdict |
| the shipping `.gz` route made to send `Content-Encoding: gzip` too | red: *the shipping arm was not inflated: {"type":"booted","bytes":107054914,"transferred":107054914}*. This is what proves the new cell is a measurement — with the arms as they ship, the same line reads `transferred: 40029960` |
| `BASE_PATH` changed in the **working tree** and `dist/` left untouched | **green**, exit 0, served at `/ASKK/`. Before `deploy.json` existed this condemned a correct deploy — *the deployed page never reached ready in 56ms*, with a 404 on a chunk, blaming the page for an edit the reader had made somewhere else |
| `dist/deploy.json` removed | refused before launching a browser: *has no deploy.json, so it cannot say what prefix it was built for* |
| `bun scripts/deploy.js --out .` | refused, exit 1, and the working tree is still there. The old version would have `rmSync`-ed it |
| `--out` and `--ref` given no value | *Option '--out <value>' argument missing*, exit 1, as a sentence. `--out` with no value used to reach `mkdirSync(undefined)`; before that, `rmSync(undefined, {recursive: true, force: true})` |
| `scripts/browser.js`'s protocol ceiling set to 1 ms, with a `whenLost` that **returns** | one loss reported, `attach THREW`, **0 Chrome processes left**. It used to announce four losses, hand back a live session, and leave a profile directory behind — the leak this file says it exists to own |
| `SANDBOX_IMAGE` pointed at a foreign URL | 24.0 MiB out, no guest in it, the foreign URL in the chunk. It used to ship the 38 MiB file anyway |

That last row is a repair, not a rehearsal. The first version of the shared
driver defined `send` *below* the socket listener, and `deploy-check.js`'s
handler needs `send` to attach a worker target — so the very first event hit the
temporal dead zone and threw inside a WebSocket listener, where nothing was
awaiting it. The run printed `Cannot access 'send' before initialization` to
stderr **and exited zero**. `send` is now defined above the listener and passed
into `onEvent`, and a throw in there is recorded rather than lost.

---

## 6. Lines this slice invalidated

Reported rather than edited: these files belong to other seats.

**`CAPABILITIES.md`**, *Get that environment to the visitor* — three claims are
now false:

- "`git check-ignore -v public/sandbox/sandbox.wasm.gz` exits **1** and `git
  ls-files public/sandbox/` lists five files, none of them the `.gz` — so it is
  neither tracked nor ignored". It is tracked, in `25c8750`; `git ls-files
  public/sandbox/` lists **six** files.
- "There is also nothing in this repository that writes the deploy: `git ls-files
  | grep -iE "deploy|publish|pages|workflow|ya?ml"` returns **nothing**". That
  grep now returns `docs/DEPLOY.md`, `scripts/deploy-check.js` and
  `scripts/deploy.js`.
- The row's evidence cell says the way out is "built and not walked". It is now
  walked as far as a directory on disk that a browser has driven end to end; what
  remains unwalked is the push, which is the owner's.

**`CAPABILITIES.md`**, *Point a deploy at a guest on another host* — "Nothing
beyond the string has ever been observed" still stands for a foreign host, but
`scripts/deploy.js` now passes `SANDBOX_IMAGE` through to the build, so the
override has a deploy to be exercised by.

**`ARCHITECTURE.md`**, *It does not reach the deployed page* — "there is no
deploy step in this repository at all — `git ls-files | grep -iE
"deploy|publish|pages|workflow|ya?ml"` returns nothing and there is no
`.github/`" is now false in its first half. There is still no `.github/`.

**`README.md`** — "deployed page at `kaush4l.github.io/ASKK` still has no sandbox
anyway" remains true, and now has a repeatable procedure that would end it.

**`docs/GATE.md`**, the third realm — "**None of which is deployed.** … The
compressed guest is built and gated and it is not tracked" is false in its last
clause. The 404s it records were re-measured by nobody today and are not
disputed.

**Registry row 1 — the comment that is wrong, and it is not the one this
document first named.** `src/backend/composition.js` documents, at the line that
constructs the sandbox, "an agent that never runs a command must never download
it — the first `shell` call is what pays for it". `src/core/mcp/discover.js` runs
a guest command once per turn for every declared MCP server, before the prompt is
rendered, so the first *turn* pays. The greps: `git grep -n "pays for it"
src/backend/` returns `composition.js` and nothing in `C2wSandbox.js`, against
`git grep -n "once per turn" src/core/mcp/`. `C2wSandbox.js`'s own comment —
"an agent that never runs a command must not have downloaded it" — is **true**
and should not be touched. Either `composition.js` is rewritten to say the first
turn, or discovery learns to be lazy: a server's tool list is stable within a
session and is being re-derived from a fresh Alpine boot on every single turn,
which is also 38 MiB of nothing from the second turn onwards and about a second
of emulator time on every one.

**Registry row 2 — the boot note is declared, documented as load-bearing, and
never emitted on the path a visitor uses.** This tree's signature defect,
measured on the deploy by two seats independently.
`src/backend/sandbox/C2wSandbox.js` guards its image-size note with
`_announced`, set on the FIRST boot. On `agents/main` that boot is MCP
discovery, and discovery's notes are dropped in transit:
`src/core/mcp/McpClient.js` returns `Outcome.ok(tools, started.notes)` — the
notes of `initialize`, not of the `tools/list` send that actually boots the
guest. By the first real `shell` call `_announced` is already true, so nothing is
emitted ever again. Every `deploy-check.js` run in this document shows it: the
only notes on either turn are `mcp server host offered 1 tool(s); 1 allowed` and
`answered after 2 steps`. The two image sizes and the ENOTSUP list reach no
transcript on the deployed page. `docs/GATE.md` calls the boot note the thing
that makes a raw module fail rather than reach a visitor — true of
`scripts/smoke.js`, which constructs `C2wSandbox` directly, and false of the
page. The grep: `git grep -n "_announced" src/` against `git grep -n
"started.notes" src/core/mcp/McpClient.js`.

**Registry row 3 — `package.json` and `docs/GATE.md` have no row for either
script.** Stated at the top of this document and repeated here because it is the
one thing on this page that nothing in the repository will ever execute.
