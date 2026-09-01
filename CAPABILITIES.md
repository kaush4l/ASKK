# Capabilities

What an agent needs, what the browser gives us instead, and how we know.

## How to read this

The bar is not "a web app with a chat box". It is **the agent has its own
environment and can do things in it** — and since the target sharpened, that
environment has a specific job: **write software, critique it, hold it to a
standard, and improve it until it passes.** Delivered with bolt.diy's deployment
model, which is a static page and nothing else. Every row is measured against
that.

Five statuses, and only five:

| | meaning |
|---|---|
| `have` | works, and the evidence cell says how we know |
| `degraded` | works at a named cost |
| `absent` | not built — and no browser reason it could not be |
| `barred` | cannot be built here. Must name a root constraint |
| `unverified` | claimed, with nothing in the evidence cell |

Two rules keep this from rotting into a wish list:

1. **An empty evidence cell makes the status `unverified`**, whatever we believe.
   Not a judgement call. This tree has capabilities that were declared and never
   wired — `TokenScale` has zero call sites outside its own test
   (`grep -rn TokenScale src scripts test` → `src/core/prompt/tokens.js` and
   `test/core/prompt/tokens.test.js`, nothing else), multimodal is unreachable
   because both `run` sites pass no images — `ChatService.js:249` and
   `agentWorker.js:76` both call `run(...)` with none, against the parameter at
   `Engine.js:199` `multimodal = []` — sub-agents are never constructed because
   `peers` is always empty (`ChatService.js:220` `const peers = …`, and `agents/`
   holds one directory), sub-agents get `tools: []` (`agentWorker.js:60`), and
   `AgentWorkerPool.terminate` has no caller (`:124`;
   `grep -rn "pool.terminate" src` → no matches; the three `.terminate()` hits in
   `src` are the page's own client, the pool's loop body and the sandbox worker).
   A status column without evidence beside it would have called all of them
   `have`.

   Three entries that used to be on that list are **not** defects of the code and
   have been corrected. `HttpTransport` *does* have a caller — `discover.js:29-30`
   constructs it whenever a server declares `url` — and `SimpleResponse` *is*
   selectable — `response/index.js:6` through `AgentSpec.js:143`
   `if (!RESPONSE_MODELS[response])`. What is dead in both cases is the
   **configuration**: no agent file declares a `url:` server or
   a `response: simple`. A dead configuration and a dead code path fail
   differently and need different fixes, so they are no longer counted together.
   The third was a real defect and it is **closed**: the sandbox used to be off
   in every build ever made, because `composition.js` read its image URL from an
   environment variable nothing anywhere set. It is derived now, exactly like the
   worker URL beside it (`composition.js:227`), and a shell command has been run
   through the built artifact end to end — the environment table below carries
   the run.

   The `soul` clause that stood here for two drafts is gone rather than
   renumbered. `soul` no longer exists in `src/`
   (`git grep -n soul -- src agents` → one prose tombstone,
   `loadAgent.js:60`), so the sentence was vacuous, not mis-cited.
2. **`barred` must name a root constraint.** If it cannot, it is `absent`, and
   that is a different conversation — one about priorities rather than physics.

Evidence is a `file:line`, a probe result, or a measurement with the command
that produced it. Never prose.

Two things about that, learned by getting it wrong. **A `file:line` into this
tree is pinned to a moment**, and this tree moves: the citations here were
re-derived against the working tree on 2026-09-01, and a `src/` edit will shift
them. Where a line matters, the anchor it points at is quoted beside it, because
the anchor survives what the number does not. **And a measurement's evidence is
the artifact, not the story** — every number below that came from a browser
points at a committed file in `scripts/probe/results/`, produced by
`bun scripts/probe/run.js`, which anyone can re-run. A measurement that lives
only in a scratch directory somebody will delete is an assertion with extra
steps, and this document cited two of those until now.

The **Reference** column names a project that ships the capability, with a
`file:line` in that project as read in `docs/MINING.md`. A cell with no citation
is `—`, not a claim. This column is a comparator, never our evidence.

`Chr` is Chrome on a desktop. `Saf` is Safari on macOS. `iOS` is Safari on
iPhone — **the column we cannot measure from a development machine**, so it is
`unverified` almost everywhere until the probe in §5 is run on a real device.
That is the rule working, not the document being unfinished.

---

## 1. Root constraints

Five. Almost every limit below descends from one of them, and a row that says
`barred` points here rather than re-arguing.

**C1 has been tested and it is no longer a wall.** It is now a bill. What it
used to bar is redistributed across the four constraints that survived and one
new one, C5.

### C1 — cross-origin isolation is a priced choice, not a missing header

The old title clause — *a static host cannot set COOP/COEP* — is **true and
irrelevant**. The host does not have to. The page sets the headers on itself
through a service worker, and the four arrows that used to hang below this
heading are false.

Measured and recorded at `docs/MINING.md:5-30`. **The experiment is now in the
tree** — `scripts/probe/`, one entry point `bun scripts/probe/run.js`, with the
run this section cites committed at `scripts/probe/results/`. It serves its own
header-free host, proven header-free by a browser-executed control on every pass
(`404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)`,
`FIRST NAV: coep_on_wire=(absent)`). The original run was on
`python3 -m http.server` in a scratch directory, and was independently
re-executed end to end by a second party who reproduced every load-bearing cell:

| ran | Chromium 140 | WebKit 26.0 |
|---|---|---|
| `self.crossOriginIsolated`, no SW | `false` | `false` |
| `self.crossOriginIsolated`, SW + `require-corp` | `true` | `true` |
| `new SharedArrayBuffer(8)` | `{ok:true, byteLength:8}` | `{ok:true}` |
| `Atomics.wait(ia,1,0)`, **no timeout**, in a worker | `ok`, woke after 252 ms | `ok`, 251 ms |
| the same, in a **nested** worker (page→worker→worker) | `ok`, blocked 202 ms | `ok`, 200 ms |

Every one of those rows was re-executed by `bun scripts/probe/run.js isolation`
from inside this repository on 2026-09-01 and reproduced: `require-corp` reaches
`coi=true` after one reload in both engines, the nested worker blocks 197 ms in
Chromium and 206 ms in WebKit, and `credentialless` isolates in Chromium but
leaves WebKit at `coi=false` after two reloads (`scripts/probe/results/2026-09-01T06-53-06-isolation+model+pty.md`).

The nested row is the one that matters here: it is exactly the
`page → backend worker → sandbox worker` shape in §3. **Blocking stdin's exact
primitive is available two realm hops deep, on a host that sends nothing.**

So the chain is re-derived. What actually follows is a price, and it is
itemised:

    cross-origin isolation is reachable from a static host
      → first paint is ALWAYS un-isolated; one extra navigation
        (`isolated_at_first_load=false → reloads_needed=1, navigations=2`)
        → every boot path must survive `SharedArrayBuffer === undefined`
      → a service-worker-bypassing hard reload drops it entirely
        (CDP `Network.setBypassServiceWorker` → `coi=false, controller=false`)
      → WebKit ignores `COEP: credentialless` and reload-loops on it
        (`coi=false` after 2 reloads) → Safari must be sent `require-corp`
      → under `require-corp`, cross-origin `no-cors` subresources without CORP die
        (`esm.sh`, `python.org`, MDN: `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin…`)
        → costs this tree's own hosts nothing: `grep -ohrE "https://[a-zA-Z0-9.-]+"
          src public/sandbox | sort -u` returns four hosts and one fragment;
          three are fetched and all in CORS mode (`api.anthropic.com`,
          `api.firecrawl.dev`, `huggingface.co` at `src/core/speech/index.js:113`),
          and `github.com` is a comment in `public/sandbox/wasi-util.js:5`
        → costs it ONE thing today: `composition.js:100` re-probes a failed
          request with `mode: 'no-cors'` to tell a CORS refusal from a dead
          host, and that is precisely the request `require-corp` blocks
        → costs the roadmap any arbitrary origin the agent decides to pull
      → the service worker joins the correctness path, not just the cache path

**What it does not cost, measured:** the model call, in all six cells, with the
enforcement control failing beside it. The real request this app sends — a
preflighted streaming `POST https://api.anthropic.com/v1/messages` with
`x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access` and
`stream: true` (the POST at `src/core/inference/AnthropicCompatible.js:61-64`,
the headers at `:109-113`) — arrived with `type:"cors"`, `acao: *` and a readable
body in Chromium and WebKit under `off`, `require-corp` and `credentialless`
(`scripts/probe/results/2026-09-01T06-53-06-isolation+model+pty.md`). So did the long local stream, read to the last
byte: under `chromium/require-corp` with `crossOriginIsolated=true`, 378 chunks
and 80,087 bytes; from a **nested worker** — `page → worker → worker`, the realm
`agentWorker.js` builds its `Inference` in — `inner_coi=true`, `SAB=function`,
status 200; and again after the page had sat isolated for 30 seconds. In the same
cell a cross-origin no-CORP `<img>` was dying with
`corp-not-same-origin-after-defaulted-to-same-origin-by-coep`, which is what
makes those arrivals mean something. cdnjs and Google Fonts send
`cross-origin-resource-policy: cross-origin` and keep loading.

Two details worth keeping, because each looks like a COEP cost and is not:

- **The one refusal in the matrix is not COEP's.** `api.openai.com` with an
  *invalid* `authorization` fails in every cell — Chromium
  `TypeError: Failed to fetch`, WebKit `TypeError: Load failed` — **including
  the un-isolated `off` baseline in both engines**, so isolation cannot be the
  cause. OpenAI's bad-key 401 branch omits `access-control-allow-origin`
  entirely. Called the way this app calls it with no key, the same endpoint
  answers 401 with `acao: *` and arrives everywhere. Without the matched `off`
  control this row would have been filed as a price of isolation.
- **COEP does not touch the CORS preflight.** A CORP-less recording server was
  asked, server-side, what reached it: under `chromium/require-corp` with
  `coi=true` it logged `OPTIONS` then `POST`, and the POST carried all three
  Anthropic headers. A CORS-mode request that passes its CORS check satisfies
  COEP by that fact alone; CORP is consulted only for `no-cors`.
  **A WebKit divergence fell out of this and the earlier report explained it
  wrongly:** WebKit sent *no* `OPTIONS` at all under `require-corp` **and** under
  `credentialless`, while Chromium always preflighted. The earlier report tied
  that to cross-origin isolation; this run does not, because the WebKit
  `credentialless` cell never isolated (`coi=false` after 2 reloads) and skipped
  the preflight anyway. Whatever it is, a WebKit result can never be used as
  evidence about how a server treats a preflight.

**A pty has now been booted** — the primitive is no longer the only thing
measured. `scripts/probe/run.js pty` boots one guest with blocking stdin two
realms down and runs many commands in it; the numbers are in the environment
table below and the gaps its refuters named are in §5.

**Still not measured, and each of these is a reason not to spend the price yet:**
nobody ran any of it on `https://kaush4l.github.io/ASKK/`, on Safari.app, on
iOS, or on Firefox; nobody tested `COOP: same-origin` against a popup or OAuth
flow; and no probe has ever loaded this tree's own built app under isolation.
See §5.

**The consequence for the ledger:** rows that were `barred | C1` are not
automatically `have`. They are `absent` now — the thing that made them
impossible turned out not to, a probe has since done each of them in a browser,
and nobody has built them here. That is a worse position to be in than `barred`,
and an honest one.

### C2 — same-origin policy

The agent can only reach a server that chooses to send CORS headers. This, not
the guest's lack of network, is what actually bounds *"can the agent find things
out"* — and it is now also what bounds *"can the agent push a commit"*. A page
has `fetch`; it does not have permission, and it does not have a socket.

### C3 — the tab is the process

There is no daemon. Nothing runs when the tab is closed, and on a phone, nothing
runs when the tab is merely backgrounded. **C3 bars the daemon, not the
feature.** Work that must happen while nobody is looking is barred; work that is
*due* while nobody is looking and catches up when the tab next opens is not —
that distinction was collapsed in the previous draft and the rows are now split.

### C4 — no server means no rendezvous

Two devices cannot meet without something in the middle. Sync, identity,
multi-user and being-reachable all descend from this one. There is no
arrangement of client-only code that avoids it; there are only choices about
*whose* middle, and whether it can read the data.

### C5 — the guest's contents are fixed by a toolchain that is not in the browser

New, and it inherits most of what C1 used to carry. Anything that must exist
*inside* `public/sandbox/sandbox.wasm` has to be put there by Docker, a local
registry and container2wasm on a developer's machine — 17m37s, documented at
`scripts/wasm/README-UNPINNED.md` and in `ARCHITECTURE.md`'s rebuild commands. A
running page cannot change what the *image* contains, which is the real reason
an MCP server has to be baked in.

**One clause of this was measured and is false.** C5 used to say a running page
cannot add a binary to its own guest, and give that as the reason `apk add` is
impossible. It is not. With a live shell, a package handed to the guest over the
tty installs: `apk add --allow-untrusted /tmp/t.apk` took a 30,316-byte
`tree-2.2.1-r0.apk` delivered as base64 and the guest went from 15 to 16
packages, `apk info -e tree` from absent to present, and `/usr/bin/tree` from a
12-byte busybox symlink to a 65,072-byte binary. What actually blocks `apk add`
from a *repository* is C2, not C5: `eth0` exists but is `qdisc noop state DOWN`
and `/etc/resolv.conf` is empty, because every WASI socket call is stubbed
`ENOTSUP` (`vm-worker.js:121-132`). Evidence:
`scripts/probe/results/` (`pty`, install stage).

What survives is narrower and still binding: the image's *contents at boot* are
fixed by a toolchain that is not in the browser, an installed package lives only
in a RAM overlay that dies with the tab, and nothing installed this way is
reproducible.

C5 is also the constraint the compiled-tools substrate dissolves rather than
improves: a tool that is a fetched wasm module is not in an image at all.

---

## 2. The ledger

### The loop

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run the loop | agent-zero `agent.py:391` | a module worker | have | have | unverified | — | `ReActEngine.js:174` `while (true)` |
| Bound it | — | a budget, and one sentence about it | have | have | have | — | `Budget.js` renders `# BUDGET` ONLY on the turn that has no room left — the running counters it used to print were measured against an arm without them (n=8, same distribution), cost 30 tokens a turn at `cached_tokens: 0`, and were cut; `AgentSpec.js` parses the terms and refuses `"250k"` rather than reading 250 off the front of it; the hard stop quotes what the last turn wrote instead of an answer — a note, never a truncation |
| Cancel it | MCP spec `cancellation.mdx` | to the open request | have | have | have | — | a signal cannot be structured-cloned, so `Envelope.js:129` `calls.cancel` names the call instead; `Kernel.js:90` holds one controller per request; `Inference.js:179` `_either` combines it with the deadline so it reaches `fetch`; `page.jsx:607` `onClick={() => clientRef.current?.stop(running)}` is the button |
| Terminate a runaway thread | — | a method with no caller | absent | absent | absent | — | `AgentWorkerPool.js:124` — `grep -rn "pool.terminate" src` → no matches |
| Approve an action mid-loop | — | nothing | absent | absent | absent | — | none |
| Notice that a reply was cut off | — | the transport does; nothing below it does | degraded | degraded | unverified | — | **The transport classifies four truncation states and refuses two of them.** `OpenAICompatible.js:304-310` `_state` reads `finish_reason` and `reasoning_content` together; `:189` `if (state === Reply.THINKING) return this._dumped(text.length)` refuses a reply whose `content` is raw scratchpad, and `:174` `_spent` refuses one that never began. `ReActEngine.js:242` `if (!taken.ok) return taken.withNote(...)` — so a refusal ends the run with a named failure instead of with a fabricated answer. **The degradation is `Reply.CUT`**: `:190` `Outcome.ok(text, [this._cutNote(text.length)])` hands a truncated answer on as an ordinary answer with a note, and nothing after it consults `finish` again — `grep -rn "finish" src/core/engine/ src/core/response/` returns 5 hits, all prose in comments |
| Refuse a reply that carries no action | agent-zero `extract_tools.py` — an unparsable reply is `misformat`, re-prompted, and the turn is retried | the same, for both routes inside the contract | degraded | degraded | unverified | — | **The fail-open is gone and the two routes are now told apart in words.** `ReActResponse.js:55` is the comment where `default: ACT_ANSWER` used to be — `grep -rn "default: ACT_ANSWER" src/` now returns **one hit, in that comment**. `normalize` matches at `:137` and falls to `ACT_UNSAID` at `:161` with no default; `:181` `isUnsaid`. Probed by the accountant through the shipped `parse`, not read off a diff: `'think: [a]\n\nplan: [c'` → `act=unsaid`, *"the reply stopped before it reached the act line"*; `act: shell` → `act=unsaid`, *"the model wrote act: shell, which is neither 'tool' nor 'answer'"*; a JSON `"act": 4` and `"act": {"tool":"shell"}` both → `unsaid` rather than the throw the missing `String()` used to allow. `ReActEngine.js:251` counts the streak, `:253` ends the run at `UNSAID_CEILING = 2` (`:81`) through `unreadable` (`:349`), which names the route and no lever; `:272` resets it. **The named cost is the third route, which is unchanged**: `BaseResponse.js:277` `return new this({ [this.answerField()]: text.trim() })` still makes a reply the answer when neither parser found any field. Measured over all 34 recorded replies, that branch is taken **10 times and every one of the 10 is `Reply.THINKING`** — refused by the transport before `parse` is reached — so it is taken **0 times in production** and a model inside the contract cannot reach it. `degraded` rather than `have` because the branch exists and the reference arm refuses that reply where we answer it |

The loop was unbounded **and** uncancellable at the same time, which was worse
than either alone: an agent that alternated between two different tool calls ran
until the endpoint failed, and the only way to stop it was to close the tab.
Both rows are `have` now, and the shape of each is the part worth keeping.

The bound is a fact in the prompt rather than a counter in the loop. `# BUDGET`
carries what the run has spent against what it may — steps, tokens, seconds —
so the model can wrap up on terms it can see; when the next call would exhaust
it the block says so in words and the agent gets one turn to answer with what it
has. Behind that is a hard stop for the agent that is told this is its last turn
and calls a tool anyway, and it fails loudly, naming the budget that went. The
step ceiling this repository deleted is not back: what came back is the number,
told to the agent instead of applied to it, which is also why `max_steps` in an
agent file is honoured again rather than reported as retired.

Cancellation reaches the open request and not the next iteration. An AbortSignal
does not survive structured-clone, so the stop cannot ride on the call it stops:
it is a second request naming the first by id — the same trick `Event` already
uses backwards — the controller lives in the Kernel where the ids are, and it is
combined with the transport's own deadline so `fetch` is the thing that ends. A
stopped run comes back `ok` with whatever it produced, and `ChatService` refuses
to write an unanswered turn into the transcript, because a stop that corrupts
the conversation it stopped is worse than no stop at all.

Two rows in this table are still `absent`, and the first of them is the next
thing to want: a runaway *thread* — a delegated sub-agent — is still only
stoppable by closing the tab, because `AgentWorkerPool.terminate` has no caller
and the budget is per-run rather than per-tree.

### The environment

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run a command | pi `env/nodejs.ts:145` (the one `spawn`), `:230` (`/bin/bash`) | c2w Alpine in wasm, ~102 MiB beside the page | degraded | degraded | unverified | — | **Run through the built artifact for the first time on 2026-09-01, which is the one thing two prior waves never did.** `bun run build`, then the export served from `Bun.serve` and opened in headless Chrome; the page's own module worker was kept by proxying `Worker` in `Page.addScriptToEvaluateOnNewDocument`, and `settings.save` / `conversations.create` / `chat.send` were sent to it as envelopes. Everything under the wire was the bundled build — `buildKernel`, `C2wSandbox`, `ChatService`, `ReActEngine`, `Toolbox`, `ShellTool`. The model was the only substitution, a local endpoint the same script served, and the observation it was handed on step 2 was `shell -> Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux / marker-42 / ls: /definitely-not-here: No such file or directory / rc=1` — output, arithmetic the guest did, and a real non-zero status. Whole turn 2,732 ms, two guest boots in it (MCP discovery, then the command). Repeated against the real model on `http://127.0.0.1:8873/v1`: 21,203 ms, two steps, final answer *"The sandbox kernel release is 6.1.0, and the shell computes 6*7 as 42."* **The harness is a scratch file and is NOT in the tree** — `docs/LEDGER.md` row S22. What is committed: `scripts/smoke.js` runs the same guest through `C2wSandbox.js:292` every `bun run check` — and since the compressed image landed it boots from `out/sandbox/sandbox.wasm.gz` and prints both sizes, which is what makes a raw module shipped under that name fail the gate rather than reach a visitor (accountant, 2026-09-01, integrated tree: cold 1,398 ms, warm 1,047 ms, `40029960 bytes fetched, inflated to 107054914`, `Linux localhost 6.1.0 …` and exit 1; the step got slower than the 930 / 925 / 945 and 674 / 671 / 692 ms of the previous wave because it now stages two files onto a budget-filling command line and asserts the return leg, not because the guest changed) and `test/backend/composition.test.js:210` asserts `buildKernel` yields `chat.services.sandbox.available === true`. **Two costs, both named.** Speed: against the identical busybox 1.37.0 in `docker run --rm alpine:3.21`, same bytes (both print sha256 `2daeb1f3…`), `awk` 1e6 loop 85,930 ms vs 0.24 s = **358x**, `sha256sum` 8 MB 9,700 ms vs 0.02 s = **485x**, `gzip -c` 8 MB 7,661 ms vs 0.03 s = **255x** — the guest is `x86_64` and the native control ran `aarch64`, which flatters the guest. Host: the row below. **One of the two numbers the model is handed is now right and the other is still wrong.** The command-line sentence was repaired this wave — `ShellTool.js:148` now says *"cannot exceed 800 bytes, counting each space as two"* against a real budget of 962 in those units (`C2wSandbox.js:211` `commandBudget`, re-derived by the accountant: `new C2wSandbox({imageUrl:'x',workerUrl:'y'}).commandBudget` → **962**), so the stated figure is reachable for the first time. The speed sentence is unrepaired: `C2wSandbox.js:332` (the timeout hint, *"about a hundred times slower"*) and `agents/main/agent.md:29` (*"roughly a hundred times slower"*) both still say a hundred, measured 255x–485x. `docs/LEDGER.md` row S25, now half closed |
| Get that environment to the visitor | bolt.diy `README.md:515` (WebContainer is fetched from its vendor, under a licence) | a deploy directory that carries it, and a live site that still does not | degraded | degraded | unverified | — | **Two of the three things this row has always needed are now done and the third has not been walked.** (1) *The guest is in the repository.* `git ls-tree HEAD public/sandbox/` lists `sandbox.wasm.gz` as blob `7bb91246…`, 40,029,960 bytes — under GitHub's 100 MiB per-file block, which the raw 107,054,914-byte module is 2,197,314 over. `docs/LEDGER.md` row S33 closed. (2) *There is a deploy step, and it was run.* `bun scripts/deploy.js` (accountant, 2026-09-01, against `25c8750`): extracts the tracked tree with `git archive`, `bun install --frozen-lockfile` into an empty `node_modules`, builds, and writes **58 files / 65,207,472 bytes**, of which the guest is 40,029,960, with **1 chunk naming `/sandbox/sandbox.wasm.gz`**. It refuses a directory it did not write, refuses a file over the block, and does not push. Then `bun scripts/deploy-check.js`, my own run: `dist/` served over a host that sends **no COOP, no COEP, no CORP** — proved by a 404 control the browser fetches on every pass, `status=404 server=askk-deploy/1 coop=(absent) coep=(absent) corp=(absent)` — opened in real Chrome, `crossOriginIsolated=false` and `SharedArrayBuffer=undefined` in the page realm AND in a classic worker, 0 service workers registered and none in the export. Ready in **219 ms after 19 requests, 692,306 bytes on the wire**, and the guest was requested **0 times before the first turn**. Turn two, through the page's own composer into the real model on `127.0.0.1:8873` and back out of the emulator: `step 1 shell({"command": "uname -a"})` → *"Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux"* in 30,878 ms, with the guest fetched once, 40,030,146 bytes in 76 ms. Both ways a static host may answer a `.gz` were driven: no `Content-Encoding` (what GitHub Pages sends) boots `{bytes:107054914, transferred:40029960}` and `Content-Encoding: gzip` boots `{107054914, 107054914}`. Exit 0. `docs/LEDGER.md` row S34 closed. (3) *Nobody has published it.* Re-measured today: `curl -s -o /dev/null -w '%{http_code}'` against `https://kaush4l.github.io/ASKK/` **200**, `/sandbox/vm-worker.js` **200**, `/sandbox/sandbox.wasm` **404**, `/sandbox/sandbox.wasm.gz` **404**; `git log --oneline gh-pages | wc -l` is **93** and `git ls-tree -r gh-pages` is **56 files**, no `.wasm` guest among them. So every `shell` call a visitor makes today still reaches `boot-failed`. `degraded` rather than `absent`, and that is the whole change: the artifact a static host can serve exists and has been served and driven; what is missing is a push, which `deploy.js` deliberately does not do |
| Point a deploy at a guest on another host | — | a build-time override, never once exercised against a host | unverified | unverified | unverified | — | `SANDBOX_IMAGE=<url> bun run build` compiles the URL into the chunk — `next.config.js:26`, `composition.js:227`, pinned by `test/backend/composition.test.js:232` and by `scripts/smoke.js`, which reads the URL the build was configured with and fails when no chunk carries it. **Nothing beyond the string has ever been observed.** The smoke says so itself: an override names a host it cannot serve, so its browser run falls back to the copy in `out/`. A cross-origin 102 MiB `fetch` + `WebAssembly.compile` needs CORS on that host (C2), holds two copies live at once because `vm-worker.js` uses `arrayBuffer()` and not `compileStreaming`, and has never been tried from a page. An empty evidence cell for the thing actually claimed is what makes this `unverified` |
| Know whether a command succeeded | pi `env/nodejs.ts:145` (a real `spawn` exit) | the shell is asked to print it | degraded | degraded | unverified | — | **Closed this wave; it read a constant 0 before.** c2w's `proc_exit` is the emulator's, so `C2wSandbox` sends `sh -c '( <cmd> ) ; echo "__askk_rc$?"'` and takes the marker off the END of stdout (`C2wSandbox.js:76-93`, `:380-386`). Measured through the real 107 MB image in a browser: `ls /nope` 1, `false` 1, `exit 7` 7, `sh -c "exit 3"` 3, `printf abc` 0 with the marker split off a line that has no newline, `echo "__askk_rc9"` 0 because the last marker wins. Asserted every gate run — `scripts/smoke.js` requires the failing command to come back `code === 1` and the marker never to reach the caller. Confirmed once more in the artifact run above: `rc=1` reached the model. **The cost is 32 of the guest's 1,000**, so the row below is 962 and not 1,024, and no time: bare against wrapped, interleaved in one browser, 957/965, 760/801, 725/741, 723/732 ms. **The degradation**: a command whose own quoting swallows the echo, or a guest that traps, prints no marker, and the emulator's 0 stands — `C2wSandbox.js:380-386` says so and the trap arrives as a note |
| An interactive session | agent-zero `tty_session.py:259` | none | absent | absent | unverified | — | **the browser can; we have not built it.** One guest booted with blocking stdin two realms down reached its prompt in 3,826 ms and then answered ten commands at 106–120 ms each with the boot never re-paid — about **7.5x cheaper per command** than re-paying the 887 ms one-shot, and the saving does not decay (`scripts/probe/results/2026-09-01T06-53-06-isolation+model+pty.md` and `scripts/probe/results/2026-09-01-pty.md`). The tree still has none: `C2wSandbox.js:292` `async run(` builds one instance per command |
| Keep a file between calls **inside the guest** | pi `harness/types.ts:315` | none, and the agent no longer needs it to | absent | absent | unverified | — | **Read this row against *The guest can read and write the agent's files* below, which is `have`.** The guest's own filesystem still dies with the boot; what changed is that the agent's does not, and `ShellTool` carries named files across the gap in both directions. So this row is about the guest and is unmoved. **within one boot the browser can; across a reload nobody can.** `echo hello > /tmp/a` then `cat /tmp/a` → `hello`, then `ls -la /tmp` → `-rw-r--r-- 1 root root 6 … a`. After `page.reload()` in the same tab: `cat: can't open '/tmp/a': No such file or directory`, `RC=1`, `/tmp` empty, and the 3,821 ms boot paid again. The store is a RAM overlay — `overlay 56.3M`, `upperdir=/run/rootfs-upper`, inside the guest's `Mem: 115244` KB — so it is capped at 56 MB and competes with the workload. The tree still has none: `C2wSandbox.js:141` (*"a fresh instance per command is also what makes each command's filesystem clean"*), one instance per command by construction (`scripts/probe/results/2026-09-01T06-53-06-isolation+model+pty.md`) |
| Command length | — | **962, in units that are not bytes** | degraded | degraded | degraded | — | **The channel does not count bytes, and every earlier number here was wrong for that reason.** `C2wSandbox.js:74` `MAX_COMMAND_COST = 1000`, charged by `:187` `cost(text)` = UTF-8 bytes + one more for every SPACE and every NEWLINE, and checked at `:301`. Twelve character classes were swept against the real image (`C2wSandbox.js:7-73` holds the table): `a`, `'`, `"`, `$`, `\`, TAB, CR, VT, FF, `;` and `*` cost one; SPACE and NEWLINE cost two — so it is not "whitespace", and tab/CR/VT/FF are the control. The ceiling is not one number either: 978 `a` runs and 979 refuses (cost 1000/1001), 489 spaces run and 490 refuse (1000/1002), and the shape that ships runs at 1,008 — so 1000 is the LOWEST ceiling measured and the guard is conservative by up to eight. What a caller gets is `:211` `commandBudget`, re-derived by the accountant on this tree: `new C2wSandbox({imageUrl:'x',workerUrl:'y'}).commandBudget` → **962**, and `cost('a')` 1, `cost('a a')` 4, `cost('a\na')` 4. The two prior readings are recorded rather than deleted, because both passed a bisection: 1024 (the guest's own refusal counter, which also covers argv separators and a time block) and 1,003 (bisected with one padding character — under which 800 bytes of ordinary shell, ~13% spaces, passed the guard and the guest refused it). **NOT MEASURED and a hazard rather than a price:** non-ASCII argv. One or ten `é` run; twenty wedged the guest until the browser stopped answering the debugger; 100–300 returned in ~12 ms with no boot. `Workspace` accepts arbitrary UTF-8 and `ShellTool` stages file text verbatim, so an accented note can reach it. That region belongs to `public/sandbox/` and the c2w image. **A live shell does not remove this, it doubles it and makes it silent**: binary-searched, a line of 2,047 bytes including the newline runs and one of 2,048 vanishes with no error and no partial execution — reproduced in two separate runs. That silence is worse than the 1024-byte cap, which at least says `the command is N bytes and the sandbox accepts at most 993`. It bit this probe: the install stage first sent an unwrapped base64 blob as one 40,424-byte line and got `base64: truncated input`, a wrong md5 and `BAD archive` (`scripts/probe/results/2026-09-01T07-28-08-pty.md`); wrapped at 76 columns it installs. A heredoc has no cap — 11,889 bytes over 400 lines written and executed |
| Install software into the guest | — | bake it into the image | absent | absent | unverified | — | C5 used to bar this and **that clause is measured false**. A 30,316-byte `tree-2.2.1-r0.apk` delivered over the tty as base64 at 2.52 KB/s arrived with its host md5 intact (`c1580b7f3775e59960109e0d41154729`), and `apk add --allow-untrusted` printed `(1/1) Installing tree` / `OK: 7 MiB in 16 packages`: the guest went 15 → 16 packages, `apk info -e tree` from absent to present, `/usr/bin/tree` from a 12-byte busybox symlink to a 65,072-byte binary that reports `tree v2.2.1`. From a *repository* it still fails, on C2 rather than C5 — `eth0` is `qdisc noop state DOWN`, `/etc/resolv.conf` is empty, every WASI socket is stubbed `ENOTSUP` (`vm-worker.js:121-132`). It also dies with the tab: the package lives in the 56 MB RAM overlay (`scripts/probe/results/2026-09-01-pty.md`) |
| Network from inside the guest | — | none | absent | absent | absent | C2 | `vm-worker.js:121-132` — every WASI socket stubbed `ENOTSUP`; a page has no raw socket, so any guest network is a `fetch` bridge and inherits C2 |
| Choose where it runs | elizaOS `shell-execution-router.ts:493` | one, in the tab | barred | barred | barred | C4 | none |
| Drive a GUI | agent-zero `supervisord.conf` | none | barred | barred | barred | C2 | `vm-worker.js:121-132` — a display server needs a socket the guest does not have |

Three of these rows used to say `barred | C1`, then `unverified`, and they are
`absent` now — which is the vocabulary working twice. `unverified` was right
while the pty was inferred from a primitive; `absent` is right now that a pty has
actually been booted and the only thing standing between this tree and one is
that nobody has written it. The interactive-session cell used to read *"no
`Atomics` in tree"*, which was the tree citing its own abstinence as physics.

**What the pty costs, which no earlier draft priced.** A one-shot boot is a
transient: it peaks the browser process tree at +521.4 MB and gives it back. A
pty is a resident: +826.6 MB at the prompt, +835.8 MB after three commands,
+814.8 MB after twenty seconds of doing nothing, and +808.0 MB immediately after
a page reload with no guest running at all — it is not released. The ~7.5x
saving per command is bought entirely by that residency, on a machine reporting
`deviceMemory: 8` and `hardwareConcurrency: 16`. Loading the module with
`compileStreaming` instead of `arrayBuffer()` cuts the one-shot peak from
+521.4 MB to +189.4 MB (a second run: +519.7 MB to +242.4 MB) at no measured
cost in time — 996 ms against 998 ms — which is a real and free improvement to
the path we already ship, and roughly a quarter of the bill the pty would add.

**A re-measurement of those numbers was attempted this wave and none of it is
entered here.** It drove the tree's own `C2wSandbox.js` from a scratch rig and
reported that the resident cost "does not exist in this code" — but its rig ran
with `crossOriginIsolated === false` and `SharedArrayBuffer === undefined`, which
is an environment that cannot host a pty at all, so it measured the one-shot path
and compared it to a resident one. The quotations it attacked are not in this
file either: `grep -rn "790\|843\|820–860" CAPABILITIES.md docs/` returns
nothing, the record says +826.6 / +835.8 / +814.8 / +808.0 MB, and it never uses
the word "leak" — it says *"it is not released"*, which is a description of a
resident, not a claim about a mechanism. What the rig did produce about
`C2wSandbox` itself — a plateau at ~+237 MB over four boot/run/close cycles, and
a second boot re-fetching the whole module because `close()` kills the worker the
compiled module lives in — is plausible, reproduced by a second party, and
**lives in a scratch directory**. By this document's own rule at the top, that is
an assertion with extra steps, so it is a `docs/LEDGER.md` row (S23) and not a
cell. The one part of it that is already citable is in the source: the timeout
path calls `close()` (`C2wSandbox.js:330`), and that comment now says the
next command pays for the whole image again.

Four things the port would have to handle that the current design does not: a
pty returns no exit code, prompt detection becomes load-bearing, the transcript
is a terminal rather than a stream, and the backend worker becomes the guest's
scheduler at 8,803 `postMessage` + `Atomics` round-trips for a three-command
session. They are §5.3d.

### Building software

The section the previous draft did not have, and the one the sharpened goal is
made of. **The wave that produced this draft gave the agent a filesystem**, so
this table has moved for the first time — one row to `have`, three to `degraded`,
and the rest are unchanged and say why in their own cells. Nothing here needed a
browser capability we did not already have; what it needed was a store, and the
store is `src/backend/files/Workspace.js` over a third IndexedDB object store.

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| The agent has files of its own | pi `harness/types.ts:315` + `env/nodejs.ts` | a workspace in IndexedDB, reachable from the prompt, the tools and the guest | have | unverified | unverified | — | **Driven end to end in a browser by the accountant, against the built export, 2026-09-01.** `out/` served from `Bun.serve` at `/ASKK`, opened in real Chrome, and four messages typed into the page's own composer against the real model on `127.0.0.1:8873`. Turn 1 *"Write a file called ledger-note.md whose entire contents are exactly: kiwi-7742-anchor"* → `step 1 write_file({"path": "ledger-note.md", "content": "kiwi-7742-anchor"})`, answered in 40,488 ms. Turn 2, a LATER turn, *"Read the file ledger-note.md and tell me exactly what it contains."* → `step 1 read_file({"path": "ledger-note.md"})` → *"ledger-note.md contains exactly: kiwi-7742-anchor"*, 39,220 ms. The token is one this probe invented, so no reply can be right by recall. Wiring: `FilesPort.js` is the port, `Workspace.js` the only implementation, `composition.js:244` constructs it over `STORE_FILES`, `tools/index.js:37-38` registers `read_file`/`write_file`, and `agents/main/agent.md` names them |
| Files that survive a reload | bolt.diy `useChatHistory.ts:308` | conversations, settings **and the agent's files** | have | unverified | unverified | — | **The same run, continued through a full page reload.** After `Page.navigate` back to the same URL and a fresh `data-live` in 156 ms, turn 3 asked the identical question of a page that had just booted from nothing: `step 1 read_file({"path": "ledger-note.md"})` → *"ledger-note.md contains exactly: kiwi-7742-anchor"*, 37,245 ms, no console errors on either load. `composition.js:17-26` — `DB_VERSION` 3 and `STORE_FILES = 'files'`, a third store beside conversations and settings; the cell that stood here said *"two store names, neither of them files"* and is retired rather than renumbered. `bun run check` also pins it every run: `smoke: the agent's files survived a reload — made-in-the-guest.txt, smoke-note.md, src/deep.txt` |
| A filesystem the agent and the **human** both see | bolt.diy `FileTree.tsx`; pi `harness/types.ts:315` | the agent sees it; the human cannot | degraded | degraded | degraded | — | **This is the half that is missing, and it is missing completely.** `grep -rn "files\." src/app src/client` → **no matches**: nothing in the page realm reads, lists, renders or downloads the workspace. A user can watch the model say it wrote a file and has no way to open it, and no way to put one in. The agent's half is `have` (the row above); a row about both parties cannot be better than its worse half. Not `absent`, because the store is there and a reader is a page-realm change with no unknown in it |
| The guest can read and write the agent's files | pi `env/nodejs.ts` (a real filesystem under the process) | staged in, harvested out, one command at a time | have | unverified | unverified | — | **Measured in the same browser run, as turn 4.** *"Using the sandbox, run `wc -c ledger-note.md` and show me exactly what it printed."* → `step 1 shell({"command": "wc -c ledger-note.md"})` → **`16 ledger-note.md`**, which is the exact byte length of the token turn 1 wrote through a different tool on a previous page load. `ShellTool` puts any of the agent's files whose path the command mentions into `/w` before the command and saves back every file left there after it; the gate asserts the return leg too — `the guest read two off a command line spending all 962 of its budget (608 of it padding) and wrote one back out`, and `made-in-the-guest.txt` is in the reload assertion above. **The cost is stated, not hidden**: staging spends the same 962-unit command budget the command does, one file's text is capped at `FilesPort.js` `MAX_FILE_BYTES` = 64 KiB, and a file that will not fit is refused in a sentence naming what it cost and what was left |
| A language runtime that is not emulated | — | none | absent | absent | absent | — | `package.json` dependencies: four, none of them a runtime; the only execution path in the tree is `C2wSandbox.js:292` |
| Run a test suite | — | none | absent | absent | absent | — | **Unchanged by the filesystem, and the reason is the image and not the store.** `scripts/wasm/image/Dockerfile` is `FROM alpine:3.21` plus one 15-line `sh` MCP server, so the guest has busybox and nothing that runs a test: no node, no python, no compiler. The agent can now write `test/x.test.js` into its workspace and stage it into `/w`; there is nothing in there to run it with. C5 is what stands in the way of changing that, and C5 is a build, not a browser |
| A formatter | — | none | absent | absent | absent | — | as above — `@biomejs/biome` is a devDependency of this repo, not something the agent can call. `BUILTIN_TOOLS` is now five (`tools/index.js:26-44`: `shell`, `read_file`, `write_file`, `fetch`, `search`) and none of them is a formatter |
| A linter | — | none | absent | absent | absent | — | as above |
| Version control the agent can commit to | — | none | absent | absent | absent | — | `grep -rn "isomorphic-git" src package.json` → no matches; the seven hits for `git` in `src` are `GitHub`, `digit` and `legitimate`. Newly reachable in principle — a pure-JS git needs a filesystem and there is one now — and nothing has been built |
| Push a commit to a remote | — | none | barred | barred | barred | C2 | github.com's git transport answers `Failed to fetch` from a page (`docs/MINING.md:46-48`); `api.github.com` sends ACAO `*` and is the only server-free write path, and is unbuilt |
| A diff the human can read | bolt.diy `DiffView.tsx` | none | absent | absent | absent | — | `grep -rniw "diff" src` → no matches; the 60 hits for the substring are `different` and `difference`. It is the same missing reader as the human-visible row above: there is now something to diff and nothing to show it in |
| Snapshot the workspace and rewind to a message | bolt.diy `useChatHistory.ts:308`, `:79-82` | none | absent | absent | absent | — | The third store exists (`composition.js:17-26`) and holds one version of each path. `FilesPort.js` states in its own docblock that there is no `remove` because nothing would call one; there is likewise no history, no version and no association between a file and the message that wrote it |
| A native compiler toolchain | — | none | barred | barred | barred | C5 | `docs/MINING.md:46` — no browser answer measured for one |

**Three of these thirteen rows are `have` and they are the three the environment
could not reach before.** Of the rest, seven are `absent` — nothing in the
browser stops them — one is `degraded`, and two are `barred`, neither for a
reason that has anything to do with isolation. The honest summary of what
changed: **the agent can now keep work between turns, between conversations and
between page loads, and can hand it to a Linux guest and take it back.** What it
still cannot do is build software with it, because the guest holds no toolchain
and the human holds no view of the files.

### Choosing how to work

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| More than one loop to choose between | — | one | absent | absent | absent | — | `engine/index.js:6-8` — `ENGINES` has a single entry |
| The agent selects its loop by task difficulty | elizaOS `message-handler.ts:366` (binary, not graded) | none | absent | absent | absent | — | `loadAgent.js:86` `loop: spec.engine` — the loop comes from a file's `engine:` field, chosen before the task is read |
| A named strategy library (plan-then-execute, write-critique-improve, delegate) | deepseek `packages/workflow/tool-ralph/README.md:12` | none | absent | absent | absent | — | `engine/index.js:6-8` — one loop; `tools/index.js:26-44` — five built-in tools, none of them a strategy |
| Write → critique → apply a standard → iterate until it passes | elizaOS `planner-loop.ts:4101` | none | absent | absent | absent | — | `ReActEngine.js:372` — `observe` returns the tool's text; nothing reads a result against a standard |
| A successful edit must be followed by a passing check | elizaOS `planner-loop.ts:4310`, `:4351` | none | absent | absent | absent | — | `ReActEngine.js:275` `if (typeof last === 'string' || last.isAnswer !== false)` — the run ends the moment the model says `isAnswer`, and nothing else is consulted |
| A check the agent cannot certify for itself | — (nobody ships one) | none | absent | absent | absent | — | none — and see §5, this is the load-bearing half |

Loop selection is `absent` and not `barred` on purpose: nothing in a browser
prevents it. What prevents it everywhere is that **nobody has a difficulty
signal that is not itself a model call** (`docs/MINING.md:203-207`) — which is a
cost problem, not a platform one, and belongs in a different conversation.

### Judged against another scaffold

`docs/LEDGER.md`'s bar is *a blind critic, handed two unlabelled transcripts on
the same task, picks ours, on the rubric in `docs/REFERENCE-PROMPTS.md`*. A rig
exists, it has been run once, and **that run is void**: it did not call this
tree's transport. One row here is `have` — the rig now imports the shipped class
— and it went `have` after the run, so **no pass number below has been re-earned
under it.** The numbers that survive the void are the ones the transport cannot
move: tokens and seconds, counted from the endpoint's own `usage` on every reply
whatever state it was in.

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run this loop and a reference loop over the same tasks, same endpoint | — | `bench/`, five tasks × two arms × three runs | degraded | — | — | — | 30 runs completed, `skipped: []`, one `callModel`, one `DEFAULTS`, one tool-call counter below both adapters. Re-derived by the accountant rather than believed: `md5 bench/results.json` = `be2c057ef0f810ff01c0b6f989122039`, and every median and total in the report reproduces to the digit from that file. **The named cost is that none of it is in the repository** — `git ls-files bench` returns nothing, so a clone cannot re-run the command or check the md5, and by this document's own rule that is an assertion with extra steps until the slice lands |
| Cost this loop against that one | — | 6.6× fewer prompt tokens for the same completions | degraded | — | — | — | Re-derived from `bench/results.json` by the accountant, md5 `be2c057ef0f810ff01c0b6f989122039`: ours 58,439 tokens / 736 s, agent-zero 237,579 / 1,177 s — 4.065× and 1.60×. **Split by usage field it is a stronger claim than the totals make it:** prompt 31,939 vs 211,531 (**6.62×**), completion 26,500 vs 26,048 (**ours 1.7% more**). The two models wrote the same amount and the whole difference is what each harness sent, which rules out the alternative reading that one arm just did less. This is the only figure in this section the transport defect cannot move, because it is the endpoint's own `usage` on every reply whatever state it arrived in. Same model, temperature 0, seed 7, `max_tokens` 1200, turn cap 12, one usage field summed one way. Same cost as the row above — untracked |
| A blind judge picks ours | — | the blinding is better and is still defeated | unverified | — | — | — | **Two of the three defeats are closed and the remaining one separates every pair, so the condition is still unmeasurable.** Re-derived by the accountant, `bun bench/blind.js` on this tree: **exit 0**, `wrote 10 blinded transcripts`, key written to `bench/blind-key.json` **outside** the handed directory. CLOSED — (1) the arm's own directory name: `grep -c "ours/" bench/blind/no-such-capability/B.md` → **0**, was 6; (2) the system-prompt opening: `grep -c "You are a careful, direct assistant"` over all ten files → **5, all in `no-such-capability/B.md`**, was 5 of 5 files, because the request block is no longer projected at all and what remains is the model quoting its own prompt back, which may not be rewritten; it is declared in `RESIDUAL`, counted, and named in the report. OPEN, and it is now the whole defeat — **tool names separate 10 of 10 files and 5 of 5 pairs with no ambiguity**: `text_editor`/`code_execution_tool` appear in exactly the five agent-zero files and `read_file`/`write_file`/`list_files` in exactly the five ours files, checked against `blind-key.json`'s map. `blind.js` reports this itself (`NOT BLIND: 137 line(s) … 7 declared identifying term(s) … 10 of 10 file(s)`) and **exits 0 anyway**, by a documented argument that a tool name is part of what is being judged. That argument is defensible and the consequence is not: A/B assignment is randomised per task, and this residual survives the randomisation. No panel run against this artifact can be reported as blind |
| The two arms are handed the same information | — | no | absent | absent | absent | — | Re-derived: **79 of 79** agent-zero requests carry a recursive workspace file tree; **0 of 34** of ours ever do. On the three tasks that turn on knowing what is in the directory, one arm is given for free every turn what the other must spend a tool call to learn |
| The rig runs the arm this tree ships | — | yes — the rig imports the shipped class | have | — | — | — | **Closed this wave, and it was the finding that invalidated the last comparison.** `bench/transport.js:80` `import { OpenAICompatible } from '../src/core/inference/OpenAICompatible.js'`, `:82` `export class RigTransport extends OpenAICompatible`. The predecessor was `bench/driver.js`'s own `callModel`, and the check that caught it was `grep -rn OpenAICompatible bench/` → 3 hits, **all prose in comments**. Re-run by the accountant on this tree: the same grep now returns the import and the subclass among its hits, and `_state`, `_spent`, `_dumped`, `_cutNote`, the shape guard and the abort handling are inherited rather than repeated. What is overridden is one shape mismatch — `_body`'s single-user-message form — and it is argued in the file rather than worked around. **This row being `absent` is what made every pass number from the previous run not about this tree; it is `have` now and the run has not been repeated, so no pass number in this section has been re-earned yet** |

**What followed from that row, and it is the sentence the panel needed.** The
head-to-head ran our agent file, our `PromptTemplate`, our `Toolbox`, our
`ShellTool` and our `ReActResponse` over a transport we do not ship, and the
transport is where the guard for this exact failure lives. The rig imports the
shipped class as of this wave; the replay below is what the recorded run means
read through it, and it is still a counterfactual, because nothing has been
re-run.

Replayed through the tree's own exported function rather than a transcription of
it — `import { OpenAICompatible } from './src/core/inference/OpenAICompatible.js'`,
then `_state(e.finish, e.reasoning, e.content, true)` over every recorded reply in
`bench/transcripts/*/ours/[123].json`. Run independently by the accountant, and
it reproduces to the reply:

    all 34 replies      { whole: 20, thinking: 12, cut: 2 }
    agent-zero, 79      { whole: 76, cut: 3 }  — zero refusals, so the guard
                                                 costs that arm nothing
    runs containing no reply this tree refuses      5 of 15
    of those 5, still passing                       4  — collatz/1, collatz/2,
                                                          pointer-chase/1, /3
    passes the guard would have ended as refusals   4  — pointer-chase/2 and all
                                                          three no-such-capability

Two numbers here were argued over by two seats and both are right, which is worth
recording because the disagreement was about framing and cost a review cycle:
**10 of 15** runs *contain* a refused reply and **5 of 15** contain *none*. They
are complements of one another, not a discrepancy.

Parsing the same 34 through the shipped `ReActResponse.parse` puts the branch
counts at **TOON-with-`act` 23 · TOON-without-`act` 1 · last resort 10** — and
crossed against the transport state, all 10 last-resort replies are `thinking`.
That is the measurement behind the third route's `degraded` in *The loop* above.

**This is a counterfactual replay, not a run, and it cuts against us.** Under the
transport this tree ships, ours' `8/15` is at most `4/15`, and the
`no-such-capability` column — the one cell where ours beat the reference —
becomes three named failures rather than three passes, because all three of those
"declines" are `Reply.THINKING` replies the model never finished. The guard is
not free either: `pointer-chase/2` genuinely completed the task on two replies
this tree would have refused.

So the pass column is not a measurement of this loop in either direction. It is
too high by four and the win is not a win. **The arm is built on `Inference` as
of this wave, so that blocker is gone and the re-run is now merely undone.** What
still stops the re-run being comparable is on the judge's side and the task's,
not the arm's: the blind set separates every pair on tool names, and one arm is
handed a recursive file tree every turn that the other must spend a call to
learn.

The cost result is not affected: token and time totals are counted from the
endpoint's own `usage` on every reply, whichever state it was in.

### Finding things out

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Search the web | — | one keyless endpoint | unverified | unverified | unverified | — | `SearchTool.js:28` `SEARCH_ENDPOINT`; registered `tools/index.js:43`; named by `agents/main/agent.md` `tools: [shell, read_file, write_file, search, fetch]`; the port is a constructor argument, `composition.js:253` `http: browserHttp`. Exercised only against a fake port (`test/core/tools/SearchTool.test.js`) — never called from a browser |
| Fetch a URL | — | one tool, capped and reduced | unverified | unverified | unverified | — | `FetchTool.js:7,10` (512 KB down, 8,000 chars shown); registered `tools/index.js:42`; same fake-port testing, same absence of a browser run |
| Know which kind of nothing came back | — | four named refusals | unverified | unverified | unverified | — | `HttpPort.js:45` `Blocked` names four; `composition.js:100` re-probes with `mode: 'no-cors'` to tell a CORS refusal from an unreachable host |
| Reach a CORS-less origin | — | none, and it is named | barred | barred | barred | C2 | `HttpPort.js:45` `Blocked.REFUSED`; a page has permission, not reach |
| The tools are actually attached | — | nothing checks | unverified | unverified | unverified | — | |
| Remote model | — | OpenAI/Anthropic-shaped | have | have | unverified | — | `AnthropicCompatible.js:61-64` (the streaming POST), `:109-113` (the headers); the preflight returns 200 with ACAO `*` once `anthropic-dangerous-direct-browser-access` is sent, and the POST arrives with a readable body in Chromium and WebKit under all three COEP modes (`scripts/probe/results/2026-09-01T06-53-06-isolation+model+pty.md`) |
| Local model weights | — | transformers.js | degraded | degraded | unverified | — | 22.5 MB ORT wasm, single-threaded; threading needs isolation, which C1 now says is purchasable at the price above |
| Embeddings | elizaOS (pgvector) | none | absent | absent | absent | — | none |

**This was the largest hole in the previous draft and it closed while this one
was being written** — `search`, `fetch` and an `HttpPort` seam landed. None of
the three rows is `have`, because a tool that has only been run against a stub
is a tool whose endpoint has never answered from a browser. Two claims the
previous draft made here were wrong and are withdrawn: `browserHttp` **does**
have a test (`test/backend/composition.test.js:64`, nine cases against a stubbed
global `fetch` — what it has never had is a real socket), and `docs/CORS-PROBE.md`
**does** resolve; `ls docs/` returns `CORS-PROBE.md GATE.md LEDGER.md MINING.md
PROMPT-AUDIT.md REFERENCE-PROMPTS.md TESTBED.md`, and the endpoint choice at
`SearchTool.js:6-23` cites it correctly.

The remote-model row moved from `degraded` to `have` because the header the
previous draft said we never send is at `AnthropicCompatible.js:113` and was
measured working.

**One row here is now coupled to C1's price.** The refusal-classifier at
`composition.js:100` is a `no-cors` fetch, and a `no-cors` fetch to a host that
sends no CORP is exactly what `COEP: require-corp` blocks. Buying isolation
would make `Blocked.REFUSED` and `Blocked.UNREACHABLE` collapse into one
another for a large class of hosts — the first concrete, cited thing in this
tree that isolation would cost.

### Memory

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Durable conversation state | pi `session/types.ts:359` | IndexedDB | have | have | unverified | — | `IndexedDb.js:28` `typeof indexedDB === 'undefined'` guard, `MemoryRepository` fallback at `composition.js:187-188` |
| Semantic recall | elizaOS (pgvector, dimension-pinned) | none | absent | absent | absent | — | none |
| Cross-session recall | — | **whatever the agent chose to write down** | degraded | unverified | unverified | — | The workspace is keyed by path and not by conversation, so a file written in one conversation is named in the context block of the next and readable by `read_file`. Proved across a page reload rather than across two conversations (`docs/LEDGER.md`, *The files-and-deploy wave*) — the store is the same either way, and the two-conversation case has not been driven. `degraded` and not `have` because recall here is entirely the model's own discipline: nothing summarises a conversation, nothing writes anything down unasked, and `agents/main/agent.md` asking it to is the whole mechanism |
| Skills the agent writes itself | — | none | absent | absent | absent | — | **No longer blocked on a filesystem, and still not built.** The agent can write a file and read it back on a later turn; nothing loads one as an instruction, and `grep -rn "skill" src` finds no loader. This row was blocked on the filesystem row above and is now blocked only on itself. The previous draft cited agent-zero `extension.py:347` for this; that line sorts extension classes by file and agent-zero's own skills tool is read-only (`list search load read_file`, `az/agent.system.tool.skills.md:3`), so no reference ships it |
| Storage pressure | — | eviction, unhandled | unverified | unverified | unverified | — | `grep -rn "navigator.storage" src public scripts` → no matches. **Worse than it was, and by design rather than by accident:** the same database now holds model-written files as well as conversations, and `FilesPort.js` caps one file at 64 KiB and nothing caps their number. An eviction takes the agent's work with the transcript |

### Structure

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| A thread per agent | deepseek `child-agent.ts:199` (`applyChildComposition`, whose parent is a required parameter) | a named module worker | unverified | unverified | unverified | — | `AgentWorkerPool.js:38` — never reached; the roster is one agent (`agents/main/`, published to `public/agents/index.json`) so `peers` at `ChatService.js:220` is always `[]` |
| A fresh context per sub-agent call | pi `subagent/index.ts:300` (`--no-session`) | stateless by construction, on a reused worker | unverified | unverified | unverified | — | `agentWorker.js:57-60` builds a fresh agent per message; `AgentWorkerPool.js:33-34` reuses the thread |
| Sub-agents that receive tools | deepseek `child-agent.ts:217` (`tools.restrict`); pi `subagent/index.ts:307` (`--tools`) | **none** | absent | absent | absent | — | `agentWorker.js:60` `tools: []` |
| A depth limit for nesting | elizaOS `acp.ts:18` | enforced by giving nothing | degraded | degraded | degraded | — | `agentWorker.js:9-12` and `:60` are the same line: the limit and the tool starvation cannot be separated |
| An MCP client | deepseek `transport.ts:31` | one, run per turn | degraded | degraded | unverified | C5 | `discover.js:21` from `ChatService.js:226`; the only declared server is `mcp-disk` in the image (`agents/main/agent.md`). **It ran, for the first time, in the artifact run recorded in the environment table**: the reply carried the note `mcp server host offered 1 tool(s); 1 allowed`, which is a second guest boot inside the same turn. The clause that used to end this cell — *"and `next.config.js` ships no image by default"* — was true of every build ever made and is false now |
| An MCP server running in this tab | `@mcp-b/transports` `TabServerTransport.ts` | none | absent | absent | absent | — | `grep -rn "MessagePort\|InMemoryTransport" src` → no matches; `core/mcp/` offers exactly two transports at `discover.js:29-37` |
| An MCP client that talks over a port, not a process | MCP spec `transports/index.mdx` (Custom Transports) | none | absent | absent | absent | — | as above |
| An MCP server holding state across calls, in the guest | agent-zero `mcp_handler.py:1332` `_execute_with_session` (also stateless) | none | barred | barred | barred | C5 | `SandboxTransport.js:42` replays `initialize` ahead of every call because `C2wSandbox.js:7-73` gives it a new process |
| An MCP server holding state across calls, in this tab | — | none | absent | absent | absent | — | no in-tab server exists to hold anything |
| A remote MCP server over HTTP | bolt.diy `mcpService.ts:219` | code, no configuration | degraded | degraded | unverified | C2 | `discover.js:29-30` constructs `HttpTransport` for any server declaring `url`; no agent file declares one, and it needs CORS — ~23% of a 200-server sample answered a preflight from our origin (`docs/MINING.md:234-237`) |
| Secrets | — | plaintext in IndexedDB | degraded | degraded | unverified | — | `SettingsService.js:24` `apiKey: ''`, stored by `SettingsService` into the same IndexedDB store as everything else |

The MCP rows are the clearest place the goal moved the document. "MCP with both
the server and the client inside the browser" was one row that said `degraded`;
it is six rows now, because the in-guest server and the in-tab server fail for
different reasons and only one of them has a root constraint. The in-tab pair is
`absent` — nobody among the five references ships it, and the SDK's own
`InMemoryTransport` already runs both ends in one realm, so it is
not-yet-built rather than not-possible.

### Presence

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run when the tab is closed | elizaOS `task.ts:76` (daemon) | nothing | barred | barred | barred | C3 | none |
| Scheduled work that catches up when the tab next opens | deepseek `packages/schedule/schedule/README.md:12` | nothing | absent | absent | absent | — | `grep -rn "cron\|setInterval\|schedule" src` → no matches. Split out of the row below: deepseek had a host process available and chose these semantics anyway (`docs/MINING.md:198-201`) |
| Cron the human can write | agent-zero `job_loop.py:10,34` (`SLEEP_TIME = 60`, the tick) | nothing | absent | absent | absent | — | as above — a schedule is a record and a tick, and C3 bars neither |
| Long-running work that survives a reload | pi `session/types.ts:359` | nothing | absent | absent | absent | — | a run lives inside one `await` at `ChatService.js:249`, and a reload loses it. The second half of this cell used to read *"nothing durable is written until `:215`"* and was never true: the user's turn is appended at `ChatService.js:196`, **before** the model is called, on purpose. What is not durable is the assistant's half, written at `:312` after the loop returns |
| Be reachable from outside | — | nothing | barred | barred | barred | C4 | none |
| Messaging connectors | — | none | barred | barred | barred | C4 | none |
| Two tabs at once | — | both drive the same DB | absent | absent | absent | — | `grep -rn "navigator.locks" src` → no matches |
| Sync across devices | — | none | absent | absent | absent | C4 | none |
| Identity / multi-user | — | none | absent | absent | absent | C4 | none |

Presence is where the previous draft over-barred. C3 bars a daemon, and a daemon
is one implementation of "scheduled work" — the one every reference happens to
use. **Catch-up-on-open is `absent`, not `barred`, and it is not hard**: the
reference with a whole host process at its disposal chose the same semantics we
are forced into. What remains genuinely barred is the promise "it will have
happened by the time you look", and that is worth saying out loud rather than
implying with a cron row.

### Operations

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Token accounting | elizaOS `trajectories/pricing.ts` | streamed, shown | degraded | degraded | unverified | — | `page.jsx:678` — a `0` renders nothing, so "not cached" is invisible |
| Prompt inspection | — | the panel | have | have | unverified | — | `ChatService.js:263` `emit(EventName.PROMPT, event)` → `page.jsx:134` |
| Cost | elizaOS `trajectories/pricing.ts` | none | absent | absent | absent | — | none |
| Traces / a run log | deepseek `client/ui-trajectory` | nothing durable | absent | absent | absent | — | `composition.js:17-26` — three store names now, and none of them is a run. The agent could write its own log into the third with `write_file`, which is not the same thing: a trace nothing but the model chooses to keep is not a record |
| Install | — | open a URL | have | have | unverified | — | `next.config.js` `output: 'export'` |
| Update | — | reload | have | have | unverified | — | — |
| Runtime licence | bolt.diy `README.md:515` (WebContainer is licensed) | none | have | have | have | — | c2w is ours to ship |
| Rebuild the environment | — | Docker + a local registry + Go, 17m37s | degraded | degraded | degraded | C5 | `scripts/wasm/build.sh:122` prints the measured 17m37s; the registry requirement is `scripts/wasm/README-UNPINNED.md:84-86` (a developer action; the platform columns describe the machine doing the build) |

### What a human sees

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Tool calls as they happen | elizaOS `task-activity-store.ts` | the call, never the result | degraded | degraded | unverified | — | `ReActEngine.js:231` `onStep?.(…)` emits the step before `:293` runs it; `ChatService.js:273-277` sends `{step, answer, isAnswer, thinking}` and no observation; `page.jsx:505` renders it |
| Progress on a long run | bolt.diy `ProgressCompilation.tsx` | a step counter and a token stream | degraded | degraded | unverified | — | `EventName.PROGRESS` exists at `Envelope.js:144` and is emitted only by `SpeechService.js:57`, `:138` and `:153` — never by the agent loop |
| Seeing that a file exists at all | bolt.diy `FileTree.tsx` | none | absent | absent | absent | — | **New row, and it is the sharpest thing this section now says.** The agent has a workspace and the page has no view of it: `grep -rn "files\." src/app src/client` → **no matches**. A user watches the model say it wrote `notes.md` and cannot list it, open it, download it or put one in. `docs/LEDGER.md` row S41 |
| Viewing and editing a file | bolt.diy `CodeMirrorEditor.tsx` | none | absent | absent | absent | — | `grep -rni "codemirror\|monaco" package.json src` → no matches. Downstream of the row above: there is now something to edit |
| Speech in | — | 3 engines | have | have | unverified | — | `WebSpeechTranscriber.js:30` probes the constructor; wired at `page.jsx:205` `dictate()` |
| Speech out | — | 3 engines | have | have | unverified | — | `WebSpeechSpeaker.js:23`; replies are spoken at `page.jsx:178`, a message on demand at `:487` |
| Mobile layout | — | responsive | have | have | unverified | — | `globals.css:825` `@media (max-width: 60rem)` |

Both speech rows were re-checked against the new goal and both survive as
`have`: three engines each way, wired to the composer and to the reply. They
should stop being listed as ambition anywhere — the same is true of live tool
views, CodeMirror and diffs, which every reference already ships
(`docs/MINING.md:225-229`). The honest reading of this section is that the two
`degraded` rows are one event name away from `have` — the loop emits the action
and never the observation, and it has a `PROGRESS` channel it does not use — and
that this section is now the weakest in the document. Everything the wave that
produced this draft built, it built for the model: the agent gained files, and
the human it works for gained no way to see one.

---

## 3. Where each of these lives

    page ─────────── speech in/out (device engines), the panel, layout
      │
      ├─ speech worker ── local STT/TTS weights
      │
      └─ backend worker ── the loop, state, secrets, the model call
           │
           ├─ agent workers ── sub-agents            [never constructed]
           │
           └─ sandbox worker ── the environment
                └─ wasm guest ── the agent's computer

Four observations the diagram makes obvious:

- **The environment is the deepest thing in the tree and the least reachable.**
  Two realm hops from the page, and everything it can do has to fit through a
  command line the guest prices at 1000 and the tree budgets at 962 — in units
  of bytes-plus-one-per-space-or-newline, not bytes.
- **There is a filesystem layer now, and it is in the backend worker.** This
  bullet said there was none anywhere on the diagram, and it went to the wrong
  technology twice: the candidate it named was OPFS, and what landed is
  `backend/files/Workspace.js` over a third IndexedDB object store, beside the
  two that already held conversations and settings. It sits exactly where the
  bullet predicted — where "state" is — and it moved three *Building software*
  rows and none of the other eight, which is the correction worth carrying: a
  store was never what those eight were waiting on. **It is also only on one
  side of the diagram.** Nothing in the page realm touches it
  (`grep -rn "files\." src/app src/client` → no matches), so the box the human
  would read it through is the one that does not exist yet.
- **"Finding things out" found an owner, and it is the backend worker.** The
  `http` port is built at `composition.js:130` and **passed to a constructor** —
  `composition.js:253` `http: browserHttp`, inside the `new ChatService({…})` at
  `:246-256` — beside the model call, never touching the guest. The tools that
  use it are the first capability in this tree wired at the layer that already
  had the ability. Everything this bullet used to say after that describes code
  that no longer exists: there is no post-construction attachment, no
  `if (chat.services)` guard to be missing, and no *"Unguarded on purpose"*
  comment. What replaced them is checkable: `buildKernel` returns the chat
  service it built (`composition.js:274`), so
  `test/backend/composition.test.js:196` asserts `chat.services.http` **is**
  `browserHttp` by identity rather than by `typeof`, and `:210` asserts the same
  record's sandbox reports `available === true`. The port is checked now instead
  of argued for.
- **The agent worker branch is dead** and has never executed. `ARCHITECTURE.md`'s
  *Sub-agents are threads* (`ARCHITECTURE.md:414`, *"Verified: nested module
  workers"*) says the mechanism is verified; this ledger says the branch is never
  reached. Both are true and they are about different things — the mechanism
  works, and `ChatService.js:220` never gives it anything to do.
- **The sandbox branch is no longer dead, and this is the wave that ran it.**
  Every box on this diagram from the page down to *the agent's computer* has now
  executed in one turn of the built export: the page's worker, the kernel, the
  chat service, the loop, the toolbox, `C2wSandbox`, the classic sandbox worker,
  the WASI shim and the emulator. The environment table has the run. What it
  does not reach is the `agent workers` branch, which is still the one box on
  this diagram nothing has ever entered.

---

## 4. Calibration

Five references, one line each — what each one **establishes**, not what it is.

- **agent-zero** (`docs/MINING.md`, column 1) — establishes the maximal reading
  of "its own environment", and that it is made entirely of daemons: a pty per
  session (`tty_session.py:259`) behind supervisord running sshd, cron and a
  search engine. Every component of it is barred here, and chasing it is how a
  static page acquires a `docker compose up`.
- **elizaOS** (column 2) — establishes that **a structural gate beats written
  policy**: `codingMutationRequiresVerification` (`planner-loop.ts:4101`) refuses
  to end a turn on an unverified edit and regex-classifies the model's own
  command so `grep` cannot be passed off as proof — the classifier at `:4310`,
  and the comment at `:4351` that names `grep`, `ls` and `git status` as
  non-proof. Their own code records the prose failing and the structure working:
  a comment describing a live turn where the model classified itself `simple`
  and the user "got the ack and nothing else"
  (`packages/core/src/runtime/message-handler.ts:450-459`). The previous draft
  cited `message-handler.ts:374` for that, which is the *other* structural
  override and says nothing about a regression.
  It is the only working answer anywhere to *improve until it passes*.
- **pi** (column 3) — establishes that a host dependency can be **quarantined and
  the quarantine enforced**: one `FileSystem` + `Shell` seam
  (`harness/types.ts:315`), a single implementation file (`env/nodejs.ts`), and a
  build that fails on a leaked import (`scripts/check-browser-smoke.mjs`). It is
  the only mechanism cited anywhere that would have caught this tree's
  declared-but-never-wired list in rule 1 above.
- **bolt.diy** (column 4) — establishes both halves of the client-only bet: that
  the model works, and its price. WebContainer needs a commercial licence for
  commercial use, stated outright at `README.md:515`; the isolation and Chromium
  requirements are WebContainer's own documented ones and are **not** evidenced
  anywhere in the bolt.diy tree, so they are stated here without one — and it ships the human
  side we do not have at all, CodeMirror 6, a diff view, and a filesystem
  snapshot keyed to a message id (`useChatHistory.ts:308`).
- **deepseek-harness** (column 5) — establishes two things: a child agent is
  **composed from its parent as a required parameter**, so the tool registry
  cannot be forgotten — `applyChildComposition(childCtx, parent, composition)`
  at `packages/subagent/subagent/src/child-agent.ts:199`, whose own comment says
  a child that joins nothing "sees an empty tool registry" (`:190-194`), calling
  `composeFrom` at `:204` and `tools.restrict` at `:217`. The tool *filter*
  itself is optional (`ChildComposition.toolFilter?`, `:163`), and the previous
  draft's "inheritance declared as a boolean" was `inheritsParentContext`, which
  their own note says "describes conversation seeding, not scope, services,
  tools, or authority" — so that half is withdrawn. Second, that scheduled work
  with no live
  session stays *overdue* rather than lost (`packages/schedule/schedule/README.md:12`) — which it
  chose while owning a host process, which is why our C3 does not bar it.

**Hermes has left this section**, and the ledger's comparator column with it.
It set the original bar and every one of its cells here was an uncited
description; nothing in this round read its source, so under this document's own
rule it establishes nothing we can point at. What it contributed — *the agent
has its own environment* — is now the first sentence of *How to read
this* rather than a column of claims.

**eliza** in the previous draft was one line about pgvector; it is elizaOS above,
and what it turned out to be worth is the verification gate, not the schema.

---

## 5. What is not known, and what would settle it

Ordered by how many rows each one moves.

**1. ~~Is there a filesystem in this tab at all?~~ ANSWERED — yes, and it moved
three rows, not eight.** This question stood at the top of this list for four
waves and its estimate was wrong in a way worth keeping: it predicted eight of
the eleven *Building software* rows plus five others, all "waiting on the same
missing box". The box exists — `backend/files/Workspace.js` over a third
IndexedDB store, driven in a browser through the built export with the real
model, write in one turn and read back after a reload (`docs/LEDGER.md`, *The
files-and-deploy wave*) — and it moved **three**. The other eight were never
waiting on a store: five want a toolchain inside the guest (C5, question 2
below) and three want a reader in the page realm. **The lesson is the estimate,
not the answer:** "waiting on the same missing box" was an inference from a
shared symptom, and a shared symptom is not a shared cause.

**1b. Would OPFS have been better?** Still not measured, and now it is a
narrower question than it was. The mining round measured 408 MB/s through one
sync access handle and an 8 GB quota (`docs/MINING.md:42`) — in a scratch page,
not in this tree, against a `grep -rn "navigator.storage" src` that still
returns nothing. IndexedDB was chosen because the two repositories beside it
already use it and a third store is a version bump rather than a new subsystem;
what nobody has measured is the size at which that stops being true, or what
`navigator.storage.estimate()` reports on a real device. The experiment is
unchanged and it is now an optimisation rather than a blocker.

**2. Does a compiled tool run in the backend worker with no isolation?** Moves
the language-runtime, test-suite, formatter, linter and version-control rows, and
would demote the whole c2w column of the environment table from *the environment*
to *one tool*. **The experiment:** load one of `esbuild-wasm`,
`@biomejs/wasm-web` or Pyodide inside `src/backend/worker.js`, run a real
invocation, and assert `SharedArrayBuffer === undefined` in the same console
line as the result. Nineteen candidate binaries were surveyed and exactly one
declares shared memory (`docs/MINING.md:33-37`); none of that ran here.

**3. ~~Does a pty actually boot?~~ ANSWERED — yes, and four new questions came
out of it.** The experiment is `scripts/probe/run.js pty` and the run is in
`scripts/probe/results/`. It moved the interactive-session row, the keep-a-file
row and the install-into-the-guest row from `unverified`/`barred` to `absent`,
and it refuted a clause of C5. What replaced it:

- **3a. What does a resident guest cost on a device that is not this one?** The
  refuter who measured the memory put it plainly: *"The report's only memory
  figures are the ONE-SHOT path … those are transient peaks that are freed. The
  recommendation replaces that transient with a permanently resident guest and
  never prices it."* Now priced on desktop — the numbers are in the environment
  table — and unpriced everywhere else. Their second sentence is the experiment:
  *"every pass reports `deviceMemory=8` / `hardwareConcurrency=16` on headless
  desktop Chromium pulling the 107 MB module over loopback … no mobile RAM
  ceiling, cellular transfer, tab-discard, or OOM behavior was tested."*
- **3b. ~~Does the tree's own sandbox do any of this?~~ ANSWERED — yes, and the
  variable was the wrong fix.** The refuter's charge was exact: *"no run set
  `SANDBOX_IMAGE`, rebuilt, and observed `C2wSandbox.available === true` with
  `run()` returning anything other than `UNAVAILABLE`. 'One env var fixes that'
  is a code-reading claim with zero execution behind it."* It has now been run,
  and what it showed is that the variable was never the answer: the image ships
  **inside the export**, because `public/` is copied whole, so the URL is
  derived from the base path the way the worker URL beside it always was
  (`composition.js:227`). The environment table's *Run a command* row carries the
  run, the observation the model was handed, and the two committed halves of it.
  `SANDBOX_IMAGE` survives as an override for a host that will not serve the
  file, and **that** is what is now unverified — its own row, two above.
- **3c. What is the store that survives, and when does it fill?** Measured to be
  a RAM overlay — `overlay 56.3M`, `upperdir=/run/rootfs-upper`, inside the
  guest's 115,244 KB of memory. Nothing reaches OPFS, so question 1 is still the
  binding one for anything that must outlive a tab. The refuter who found the
  overlay also measured its ceiling — *"A single `dd bs=1M count=60` exhausts it
  (56.3 MB written) and the next write lands 0 bytes"* — and the probe in the
  tree does not yet repeat that: its `speed` stage writes 8 MB and stops.
- **3d. What does the port cost?** Four things the spike exposed that the
  current design does not handle — and **the first of them is now already paid
  for**: a pty returns no exit code, so every call needs `echo $?` and a parser,
  which is exactly the marker-on-stdout mechanism the one-shot path shipped this
  wave (`C2wSandbox.js:76-93`), measured at 32 of the guest's 1,000 and no time. A pty would
  inherit it rather than invent it. The three that remain: prompt detection becomes load-bearing and the
  spike anchored on `ESC[6n`, an ash implementation detail, because quiescence
  fired early on a 128-second `awk`; the transcript is a terminal, with echo,
  80-column CRLF wrapping and SGR colour; and the backend worker becomes the
  guest's scheduler, at tens of thousands of `postMessage` + `Atomics` round
  trips per session. C1's own bill is unchanged: first paint is never isolated,
  so the one-shot path stays as the fallback rather than being replaced.

**4. Does any of C1's measurement survive the real deploy?** Moves the Chr / Saf
/ iOS columns of everything question 3 touches, plus local model weights.
Everything was measured on `127.0.0.1`, which is a secure-context exemption, and
in a probe page — never on `https://kaush4l.github.io/ASKK/`, never against this
tree's Next static export, and never against a service-worker update cycle behind
Pages' `max-age=600`. The probe is in the tree now, which fixes who can re-run
it; it does not fix where it runs. **The experiment:** deploy
`coi-serviceworker.js` to the live subpath and open the existing probe page
there; then open the app and confirm it starts with `SharedArrayBuffer ===
undefined` on first paint. This tree has form: a manual `<head>` and
`reactStrictMode` have each silently stopped the page starting before.

**5. The iOS column.** Not measurable from a development machine, so it is
`unverified` nearly everywhere above, and question 4's probe is the same visit.
A single self-contained page, opened once on the device, would fill it: does a
module worker start, does IndexedDB survive, **does an OPFS sync access handle
open, does a service worker survive the 7-day script-writable-storage cap**, what
does `navigator.storage.estimate` report, does a 102 MiB module compile before
the tab is killed, does `AudioContext` honour a requested sample rate, is
`SpeechRecognition` present. The 102 MiB compile is the one likely to fail, and
it is currently loaded with `arrayBuffer()` and not `compileStreaming`, so two
copies are live at once.

**6. Which host will serve a 102 MiB file, and what does it cost a visitor?**
New this wave, and it is the question the whole *Run a command* row now hangs on.
The environment works in a browser and does not reach the one host this project
deploys to (`sandbox.wasm` → **404** on `https://kaush4l.github.io/ASKK/`, page
and worker → 200, measured 2026-09-01). Nothing about that is a browser limit.
**The third part of this question has been answered and the answer is that no
other host is needed.** A pre-compressed blob the worker inflates was worth the
loader change: `gzip -9` puts the guest at 40,029,960 bytes — inside GitHub's
block — it inflates to the raw module's own sha256, and `bun run smoke` boots the
real guest from it on every gate run at 930 / 925 / 945 ms cold, which is not
slower than the raw module was. Somebody else's Pages site serving a `.gz` was
asked what the real host sends, and it sends raw gzip bytes with no
`Content-Encoding`, so `fetch` does not pre-inflate and the loader's `1f 8b`
sniff fires (`docs/GATE.md`, with the curl). Two other compressors were priced —
brotli q11 30,089,508 in 116.1 s, zstd −19 30,617,879 in 15.8 s — and neither is
reachable through `DecompressionStream('gzip')`.

**What is left is not a measurement, it is an action nobody has taken.**
`public/sandbox/sandbox.wasm.gz` is neither tracked nor ignored
(`git check-ignore -v` exits 1), so `/ASKK/sandbox/sandbox.wasm.gz` is still a
404 and every `shell` call on the live page still reaches `boot-failed`. And
there is no deploy step in this repository to point at it: `git ls-files |
grep -iE "deploy|publish|pages|workflow|ya?ml"` returns nothing and there is no
`.github/`. **The experiment**, in two parts, neither run: commit the 38.2 MiB
`.gz` and deploy, then `curl` for a 200; and open the deployed page and call the
shell tool, which is the only way to learn what a first visit costs on a real
connection — every measurement in this document pulled the module over loopback.

**8. Does the pass column survive a token ceiling that binds on both arms?**
New this wave, and it is the first thing the next benchmark run must settle.
`max_tokens` was 1200, identical for both arms, and it bound on one:
`finish_reason: 'length'` on **14 of ours' 34 replies** and **3 of agent-zero's
79**, median completion 896 against 217 (re-derived from
`bench/transcripts/*/*/[123].json`). `bench/run.js` has no knob for it —
`parseArgs` takes `n/scaffold/task/workdir/out` — so "raise it and re-run" is a
change to the rig, not a flag. Two things have to happen before any pass number
from that rig means anything: the arm has to be built on `Inference` rather than
on the rig's own `callModel`, because 12 of those 14 truncations are the state
`OpenAICompatible` refuses; and the workspace path has to stop carrying the task
id, because on `no-such-capability` the model quoted its own directory name back
as an answer key 7, 6 and 10 times in three runs while the reference arm did so
zero times.

**7. Who writes the acceptance test?** Moves one row and blocks the goal.
elizaOS enforces only that *a* check of the right family exited 0
(`planner-loop.ts:4351`); deepseek accepts the worker's own `status: complete`
(`packages/workflow/tool-ralph/README.md:12`: "completion and blockers are worker reports, not
independent certification"). Nobody has solved it, so there is no experiment to
copy — the smallest honest one is: have the human name the command, run it
unmodified, and let the loop end only on its exit code.

**That paragraph used to say every "measured" number here is an assertion, and it
is no longer true of all of them.** `package.json`'s `check` is `lint && test &&
smoke`, and `smoke` composes the build, so it is still the four steps
`docs/GATE.md` names: `biome`, `bun test --isolate ./test`, `next build`, and
`scripts/smoke.js`, which boots the export in headless Chrome and runs a command
in the real guest. So the boot cost, the guest's own `uname` line and the exit
status are re-derived by anyone who types `bun run check`, and this wave's run
printed `the real guest answered "Linux localhost 6.1.0 …" in 1406ms cold, then a
failing command in 1086ms warm (exit 1); 40029960 bytes fetched, inflated to
107054914`. There are **38** test files
(`find test -name '*.test.js' | wc -l`) and **551 pass / 0 fail / 1,530
expects**; there is still no third-party browser driver
(`grep -rn "playwright\|puppeteer" package.json` → no matches — the smoke speaks
CDP over a raw WebSocket).

**The first step of that gate was RED on files no human wrote, and it is green
now.** `bun run lint` includes `bench`, and `bench/work/` — the throwaway
workspace the benchmark's own agents write into — is gitignored but not invisible
to biome, which has no `vcs` block and so does not read `.gitignore`. The fix is
`"!bench/work/**"` in `biome.json`'s include list. Re-derived by the accountant
with that line removed and restored: with it **133 files, no errors**; without it
**139 files, 6 errors**, all six under `bench/work/…/agent-zero/`. A planted
unused constant in `bench/driver.js` is still caught and the same constant under
`bench/work/` is still ignored, so the gate's subject narrowed without its
sensitivity dropping. `docs/LEDGER.md` row S30, closed.

Those counts moved a long way in one wave — 484/1,314/36 files to 551/1,530/38 —
and three seats reported three different pass counts on the way, each true when
it was run. **In a tree several agents write to, a pass count is a timestamp.**

What has **not** changed: those tests are unit tests of `core/` against fakes,
and they cover none of the numbers in this document except the ones the smoke
executes. The ~100x, the 3,717→1,332 token filter and the 10 ms worst frame gap
are all still assertions, and the ~100x is now known to be wrong by a factor of
three to five and is still the sentence the model is handed. Every row whose
evidence cell is prose rather than a command is a row this paragraph is about.
