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

One marker is not a status:

| | meaning |
|---|---|
| — | the question does not apply to that platform |

It appears only in the Safari and iOS columns of the benchmark table, which measures a harness run under `bun` on a host. The Chrome column never carries it: every measurement in this file was taken in Chrome, so a row with no Chrome answer is `unverified` rather than exempt. `test/docs/capabilities.test.js` executes all of this.

Two rules keep this from rotting into a wish list:

1. **An empty evidence cell makes the status `unverified`**, whatever we believe.
   Not a judgement call. This tree has capabilities that were declared and never
   wired — the standing example for six waves was `TokenScale`, a calibrator
   with zero call sites outside its own test, and it is gone rather than wired:
   `grep -rn TokenScale src scripts test bench agents public` → nothing, exit 1,
   re-run 2026-09-01 after slice D deleted the class and its six tests. The
   next one on the list took its place and has now been wired: multimodal was
   unreachable because both `run` sites passed no images, and `ChatService.send`
   now takes `attachments`, turns each into a `Multimodality` — refusing
   anything that is not a data URL, because fetching a remote one would be this
   app making a request on the user's behalf to a host nobody named — stores
   what was SENT on the user's message, and passes the list to `run`. The page
   attaches by picker, by drop and by paste. What is still unreachable one file
   over: `agentWorker.js:76` passes none, so a SUB-AGENT cannot be handed a
   picture. Sub-agents are never constructed because
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
tree is pinned to a moment**, and this tree moves: every citation on this page was
resolved again on 2026-09-01 against the working tree, and a `src/` edit will
shift them. Where a line matters, the anchor it points at is quoted beside it,
because the anchor survives what the number does not — and this wave that
convention finally paid, because comparing the quoted anchor against the cited
line is what found **nine citations pointing at the wrong place, none of them out
of range**, one of which was a repair from the previous sweep
(`docs/LEDGER.md`, "The citation sweep"). **And a measurement's evidence is
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

**And this wave walked that path, which changes what C5 may be used to refuse.** A
guest carrying Python 3.12.14 was built through exactly it and shipped, so C5
describes a workflow with a price — a Docker build, a local registry,
container2wasm, 17m37s, and 12,572,161 more gzipped bytes for every visitor — and
not an impossibility. **A row may no longer say `barred` on C5 and mean "nobody
can".** The one row that did, *A native compiler toolchain*, is `absent` now.

C5 is also the constraint the compiled-tools substrate dissolves rather than
improves: a tool that is a fetched wasm module is not in an image at all.

---

## 2. The ledger

### The loop

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run the loop | agent-zero `agent.py:391` | a module worker | have | have | unverified | — | `ReActEngine.js:174` `while (true)` |
| Bound it | — | a budget, and one sentence about it | have | have | have | — | `Budget.js` renders `# BUDGET` ONLY on the turn that has no room left — the running counters it used to print were measured against an arm without them (n=8, same distribution), cost 30 tokens a turn at `cached_tokens: 0`, and were cut; `AgentSpec.js` parses the terms and refuses `"250k"` rather than reading 250 off the front of it; the hard stop quotes what the last turn wrote instead of an answer — a note, never a truncation |
| Cancel it | MCP spec `cancellation.mdx` | to the open request | have | have | have | — | a signal cannot be structured-cloned, so `Envelope.js:134` `calls.cancel` names the call instead; `Kernel.js:90` holds one controller per request; `Inference.js:179` `_either` combines it with the deadline so it reaches `fetch`; `page.jsx:663` `onClick={() => clientRef.current?.stop(running)}` is the button |
| Terminate a runaway thread | — | a method with no caller | absent | absent | absent | — | `AgentWorkerPool.js:124` — `grep -rn "pool.terminate" src` → no matches |
| Approve an action mid-loop | — | nothing | absent | absent | absent | — | none |
| Notice that a reply was cut off | agent-zero returns the overrun as a `misformat` observation and takes another turn | the transport does, and the loop now takes another turn on it | degraded | degraded | unverified | — | **The transport classifies four truncation states, refuses two of them, and the loop sends both back as a turn.** `OpenAICompatible.js:304-310` `_state` reads `finish_reason` and `reasoning_content` together; `:189` `if (state === Reply.THINKING) return this._dumped(text.length)` refuses a reply whose `content` is raw scratchpad, and `:174` `_spent` refuses one that never began; both now return `Reason.OVERRUN` (`:331`, `:354`) rather than the `UNAVAILABLE` that made the loop end the run as if the endpoint had died. `ReActEngine.js:289` `if (!taken.ok && taken.failure.code === Reason.OVERRUN) {` — `:308` emits an `onStep` holding nothing, `:310` counts it on the same streak as `ACT_UNSAID`, `:311` ends at the ceiling, and otherwise `OVERRAN` (`:110`) goes back through the scratchpad. Measured on the real model, `median-bug` at 1,200 tokens with thinking on: the sentence recovered the next turn **10 of 10** times across four seats, and every shorter or neutral version of it 0 of 20; `test/core/engine/ReActEngine.test.js` pins the bytes. **The rig has not measured it once**: `bench/driver.js:194` ends any run on `!reply.ok`, so the n=3 run this wave scored has 8 overruns and 0 recoveries for ours by construction — `docs/LEDGER.md` row S62. `degraded` and not `have` because the shipped loop does it and the comparison the bar is scored on does not yet contain it. **The other degradation is `Reply.CUT`**: `OpenAICompatible.js:190` `Outcome.ok(text, [this._cutNote(text.length)])` hands a truncated answer on as an ordinary answer with a note, and nothing after it consults `finish` again — `grep -rn "finish" src/core/engine/ src/core/response/` returns 5 hits, all prose in comments |
| Refuse a reply that carries no action | agent-zero `extract_tools.py` — an unparsable reply is `misformat`, re-prompted, and the turn is retried | the same, for both routes inside the contract | degraded | degraded | unverified | — | **The fail-open is gone and the two routes are now told apart in words.** `ReActResponse.js:55` is the comment where `default: ACT_ANSWER` used to be — `grep -rn "default: ACT_ANSWER" src/` now returns **one hit, in that comment**. `normalize` matches at `:137` and falls to `ACT_UNSAID` at `:161` with no default; `:180` `isUnsaid`. Probed by the accountant through the shipped `parse`, not read off a diff: `'think: [a]\n\nplan: [c'` → `act=unsaid`, *"the reply stopped before it reached the act line"*; `act: shell` → `act=unsaid`, *"the model wrote act: shell, which is neither 'tool' nor 'answer'"*; a JSON `"act": 4` and `"act": {"tool":"shell"}` both → `unsaid` rather than the throw the missing `String()` used to allow. `ReActEngine.js:348` counts the streak, `:349` ends the run at `UNSAID_CEILING = 2` (`:81`) through `unreadable` (`:452`), which names the route and no lever — and, since P8, defers to the transport's note about the ceiling instead of arguing with it; `:369` resets it. The overrun shares the streak (`:310`). **The named cost is the third route, which is unchanged**: `BaseResponse.js:277` `return new this({ [this.answerField()]: text.trim() })` still makes a reply the answer when neither parser found any field. Measured over all 34 recorded replies, that branch is taken **10 times and every one of the 10 is `Reply.THINKING`** — refused by the transport before `parse` is reached — so it is taken **0 times in production** and a model inside the contract cannot reach it. `degraded` rather than `have` because the branch exists and the reference arm refuses that reply where we answer it |

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
| Run a command | pi `env/nodejs.ts:145` (the one `spawn`), `:230` (`/bin/bash`) | c2w Alpine **with Python 3.12.14** in wasm, 136.6 MiB beside the page | degraded | degraded | unverified | — | **Run through the built artifact for the first time on 2026-09-01, which is the one thing two prior waves never did.** `bun run build`, then the export served from `Bun.serve` and opened in headless Chrome; the page's own module worker was kept by proxying `Worker` in `Page.addScriptToEvaluateOnNewDocument`, and `settings.save` / `conversations.create` / `chat.send` were sent to it as envelopes. Everything under the wire was the bundled build — `buildKernel`, `C2wSandbox`, `ChatService`, `ReActEngine`, `Toolbox`, `ShellTool`. The model was the only substitution, a local endpoint the same script served, and the observation it was handed on step 2 was `shell -> Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux / marker-42 / ls: /definitely-not-here: No such file or directory / rc=1` — output, arithmetic the guest did, and a real non-zero status. Whole turn 2,732 ms, two guest boots in it (MCP discovery, then the command). Repeated against the real model on `http://127.0.0.1:8873/v1`: 21,203 ms, two steps, final answer *"The sandbox kernel release is 6.1.0, and the shell computes 6*7 as 42."* **The harness is in the tree now**, twice: `scripts/smoke.js` boots the guest on every `bun run check`, and `scripts/wasm/toolchain-check.js` boots three more. Re-derived by the accountant against `out/` on 2026-09-01, real Chrome, the page's own composer: *"Using the sandbox, run `python3 receipt.py` and then `python3 -V`"* → `step 1shell({"command": "python3 receipt.py; python3 -V"})` → **`total 42` / `Python 3.12.14`** in 70,321 ms. `docs/LEDGER.md` row S22. What is committed: `scripts/smoke.js` runs the same guest through `C2wSandbox.js:292` every `bun run check` — and since the compressed image landed it boots from `out/sandbox/sandbox.wasm.gz` and prints both sizes, which is what makes a raw module shipped under that name fail the gate rather than reach a visitor (accountant, 2026-09-01, integrated tree: cold 1,398 ms, warm 1,047 ms, `40029960 bytes fetched, inflated to 107054914`, `Linux localhost 6.1.0 …` and exit 1; the step got slower than the 930 / 925 / 945 and 674 / 671 / 692 ms of the previous wave because it now stages two files onto a budget-filling command line and asserts the return leg, not because the guest changed) and `test/backend/composition.test.js:210` asserts `buildKernel` yields `chat.services.sandbox.available === true`. **Two costs, both named.** Speed: against the identical busybox 1.37.0 in `docker run --rm alpine:3.21`, same bytes (both print sha256 `2daeb1f3…`), `awk` 1e6 loop 85,930 ms vs 0.24 s = **358x**, `sha256sum` 8 MB 9,700 ms vs 0.02 s = **485x**, `gzip -c` 8 MB 7,661 ms vs 0.03 s = **255x** — the guest is `x86_64` and the native control ran `aarch64`, which flatters the guest. Host: the row below. **One of the two numbers the model is handed is now right and the other is still wrong.** The command-line sentence was repaired — `ShellTool.js:223` now says *"cannot exceed 800 bytes, counting each space as two"* against a real budget of 962 in those units (`C2wSandbox.js:211` `commandBudget`, re-derived by the accountant: `new C2wSandbox({imageUrl:'x',workerUrl:'y'}).commandBudget` → **962**), so the stated figure is reachable for the first time. The speed sentence is unrepaired: `C2wSandbox.js:332` (the timeout hint, *"about a hundred times slower"*) and `agents/main/agent.md:29` (*"roughly a hundred times slower"*) both still say a hundred, measured 255x–485x. `docs/LEDGER.md` row S25, now half closed |
| Get that environment to the visitor | bolt.diy `README.md:515` (WebContainer is fetched from its vendor, under a licence) | a deploy directory that builds clean, boots the guest in a browser, and a live site that now serves it | degraded | degraded | unverified | — | **Two of the three things this row has always needed are now done and the third has not been walked.** (1) *The guest is in the repository, and since `e59eeba` it is the Python one.* `git ls-tree HEAD public/sandbox/` lists `sandbox.wasm.gz` as blob `0800e4a4…`, 52,602,121 bytes, inflating to a module carrying 703 occurrences of `python3.12` — under GitHub's 100 MiB per-file block, which the raw 143,205,983-byte module is 38,348,383 over. `docs/LEDGER.md` rows S33 and S51 closed. The deploy measurement that follows was taken against `25c8750`, whose blob was the 40,029,960-byte pre-Python guest, and its sizes are that guest's. (2) *There is a deploy step, and it was run.* `bun scripts/deploy.js` (accountant, 2026-09-01, against `25c8750`): extracts the tracked tree with `git archive`, `bun install --frozen-lockfile` into an empty `node_modules`, builds, and writes **58 files / 65,207,472 bytes**, of which the guest is 40,029,960, with **1 chunk naming `/sandbox/sandbox.wasm.gz`**. It refuses a directory it did not write, refuses a file over the block, and does not push. Then `bun scripts/deploy-check.js`, my own run: `dist/` served over a host that sends **no COOP, no COEP, no CORP** — proved by a 404 control the browser fetches on every pass, `status=404 server=askk-deploy/1 coop=(absent) coep=(absent) corp=(absent)` — opened in real Chrome, `crossOriginIsolated=false` and `SharedArrayBuffer=undefined` in the page realm AND in a classic worker, 0 service workers registered and none in the export. Ready in **219 ms after 19 requests, 692,306 bytes on the wire**, and the guest was requested **0 times before the first turn**. Turn two, through the page's own composer into the real model on `127.0.0.1:8873` and back out of the emulator: `step 1 shell({"command": "uname -a"})` → *"Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux"* in 30,878 ms, with the guest fetched once, 40,030,146 bytes in 76 ms. Both ways a static host may answer a `.gz` were driven: no `Content-Encoding` (what GitHub Pages sends) boots `{bytes:107054914, transferred:40029960}` and `Content-Encoding: gzip` boots `{107054914, 107054914}`. Exit 0. `docs/LEDGER.md` row S34 closed. (3) *Nobody has published it.* Re-measured today: `curl -s -o /dev/null -w '%{http_code}'` against `https://kaush4l.github.io/ASKK/` **200**, `/sandbox/vm-worker.js` **200**, `/sandbox/sandbox.wasm` **404**, `/sandbox/sandbox.wasm.gz` **404**; `git log --oneline gh-pages \| wc -l` is **93** and `git ls-tree -r gh-pages` is **56 files**, no `.wasm` guest among them. So every `shell` call a visitor makes today still reaches `boot-failed`. `degraded` rather than `absent`, and that is the whole change: the artifact a static host can serve exists and has been served and driven; what is missing is a push, which `deploy.js` deliberately does not do **Re-run 2026-09-02 at `0d8d98f`.** `bun scripts/deploy.js` → 530 tracked files into a clean checkout, `bun install --frozen-lockfile`, `dist/` at 59 files / 77,829,295 bytes. `bun scripts/deploy-check.js` drove that directory in real Chrome and cleared its bar: not isolated, no `SharedArrayBuffer`, and a real `uname -a` out of a real guest, the image fetched once at 75ms. Both ways a host may answer a `.gz` boot — 52,602,121 transferred plain, 143,205,983 with `Content-Encoding: gzip`. **PUSHED 2026-09-03.** `gh-pages` commit `3ddc99d` (*Deploy 084268b*) was the first on that branch written by `scripts/deploy.js` rather than by hand, and the first carrying the guest; `357a083` (*Deploy e02919e*) is what is live. Measured live afterwards: `https://kaush4l.github.io/ASKK/` **200**, `/ASKK/sandbox/sandbox.wasm.gz` **200** with `content-type: application/gzip` and `access-control-allow-origin: *`, where both answered 404 for the whole life of the project. The published page was opened in real Chrome: it boots with **0 console errors**, its empty state names what is missing, its settings sheet opens and closes, and its drawer holds all five sections. `degraded` rather than `have` for one reason and it is named: **no whole turn has been driven on the live host**, because a page on `https` may not call a model on `http` and there is no https model to point it at |
| Point a deploy at a guest on another host | — | a build-time override, never once exercised against a host | unverified | unverified | unverified | — | `SANDBOX_IMAGE=<url> bun run build` compiles the URL into the chunk — `next.config.js:26`, `composition.js:227`, pinned by `test/backend/composition.test.js:232` and by `scripts/smoke.js`, which reads the URL the build was configured with and fails when no chunk carries it. **Nothing beyond the string has ever been observed.** The smoke says so itself: an override names a host it cannot serve, so its browser run falls back to the copy in `out/`. A cross-origin 102 MiB `fetch` + `WebAssembly.compile` needs CORS on that host (C2), holds two copies live at once because `vm-worker.js` uses `arrayBuffer()` and not `compileStreaming`, and has never been tried from a page. An empty evidence cell for the thing actually claimed is what makes this `unverified` |
| Know whether a command succeeded | pi `env/nodejs.ts:145` (a real `spawn` exit) | the shell is asked to print it | degraded | degraded | unverified | — | **Closed this wave; it read a constant 0 before.** c2w's `proc_exit` is the emulator's, so `C2wSandbox` sends `sh -c '( <cmd> ) ; echo "__askk_rc$?"'` and takes the marker off the END of stdout (`C2wSandbox.js:76-93`, `:380-386`). Measured through the real 107 MB image in a browser: `ls /nope` 1, `false` 1, `exit 7` 7, `sh -c "exit 3"` 3, `printf abc` 0 with the marker split off a line that has no newline, `echo "__askk_rc9"` 0 because the last marker wins. Asserted every gate run — `scripts/smoke.js` requires the failing command to come back `code === 1` and the marker never to reach the caller. Confirmed once more in the artifact run above: `rc=1` reached the model. **The cost is 32 of the guest's 1,000**, so the row below is 962 and not 1,024, and no time: bare against wrapped, interleaved in one browser, 957/965, 760/801, 725/741, 723/732 ms. **The degradation**: a command whose own quoting swallows the echo, or a guest that traps, prints no marker, and the emulator's 0 stands — `C2wSandbox.js:380-386` says so and the trap arrives as a note |
| An interactive session | agent-zero `tty_session.py:259` | none | absent | absent | unverified | — | **the browser can; we have not built it.** One guest booted with blocking stdin two realms down reached its prompt in 3,826 ms and then answered ten commands at 106–120 ms each with the boot never re-paid — about **7.5x cheaper per command** than re-paying the 887 ms one-shot, and the saving does not decay (`scripts/probe/results/2026-09-01T06-53-06-isolation+model+pty.md` and `scripts/probe/results/2026-09-01-pty.md`). The tree still has none: `C2wSandbox.js:292` `async run(` builds one instance per command |
| Keep a file between calls **inside the guest** | pi `harness/types.ts:315` | none, and the agent no longer needs it to | absent | absent | unverified | — | **Read this row against *The guest can read and write the agent's files* below, which is `have`.** The guest's own filesystem still dies with the boot; what changed is that the agent's does not, and `ShellTool` carries named files across the gap in both directions. So this row is about the guest and is unmoved. **within one boot the browser can; across a reload nobody can.** `echo hello > /tmp/a` then `cat /tmp/a` → `hello`, then `ls -la /tmp` → `-rw-r--r-- 1 root root 6 … a`. After `page.reload()` in the same tab: `cat: can't open '/tmp/a': No such file or directory`, `RC=1`, `/tmp` empty, and the 3,821 ms boot paid again. The store is a RAM overlay — `overlay 56.3M`, `upperdir=/run/rootfs-upper`, inside the guest's `Mem: 115244` KB — so it is capped at 56 MB and competes with the workload. The tree still has none: `C2wSandbox.js:141` (*"a fresh instance per command is also what makes each command's filesystem clean"*), one instance per command by construction (`scripts/probe/results/2026-09-01T06-53-06-isolation+model+pty.md`) |
| Command length | — | **962, in units that are not bytes** | degraded | degraded | degraded | — | **The channel does not count bytes, and every earlier number here was wrong for that reason.** `C2wSandbox.js:74` `MAX_COMMAND_COST = 1000`, charged by `:187` `cost(text)` = UTF-8 bytes + one more for every SPACE and every NEWLINE, and checked at `:301`. Twelve character classes were swept against the real image (`C2wSandbox.js:7-73` holds the table): `a`, `'`, `"`, `$`, `\`, TAB, CR, VT, FF, `;` and `*` cost one; SPACE and NEWLINE cost two — so it is not "whitespace", and tab/CR/VT/FF are the control. The ceiling is not one number either: 978 `a` runs and 979 refuses (cost 1000/1001), 489 spaces run and 490 refuse (1000/1002), and the shape that ships runs at 1,008 — so 1000 is the LOWEST ceiling measured and the guard is conservative by up to eight. What a caller gets is `:211` `commandBudget`, re-derived by the accountant on this tree: `new C2wSandbox({imageUrl:'x',workerUrl:'y'}).commandBudget` → **962**, and `cost('a')` 1, `cost('a a')` 4, `cost('a\na')` 4. The two prior readings are recorded rather than deleted, because both passed a bisection: 1024 (the guest's own refusal counter, which also covers argv separators and a time block) and 1,003 (bisected with one padding character — under which 800 bytes of ordinary shell, ~13% spaces, passed the guard and the guest refused it). **NOT MEASURED and a hazard rather than a price:** non-ASCII argv. One or ten `é` run; twenty wedged the guest until the browser stopped answering the debugger; 100–300 returned in ~12 ms with no boot. `Workspace` accepts arbitrary UTF-8 and `ShellTool` stages file text verbatim, so an accented note can reach it. That region belongs to `public/sandbox/` and the c2w image. **A live shell does not remove this, it doubles it and makes it silent**: binary-searched, a line of 2,047 bytes including the newline runs and one of 2,048 vanishes with no error and no partial execution — reproduced in two separate runs. That silence is worse than the 1024-byte cap, which at least says `the command is N bytes and the sandbox accepts at most 993`. It bit this probe: the install stage first sent an unwrapped base64 blob as one 40,424-byte line and got `base64: truncated input`, a wrong md5 and `BAD archive` (`scripts/probe/results/2026-09-01T07-28-08-pty.md`); wrapped at 76 columns it installs. A heredoc has no cap — 11,889 bytes over 400 lines written and executed |
| Install software into the guest | — | bake it into the image, and this wave did | degraded | degraded | unverified | — | **Moved from `absent` because the rebuild stopped being a story and became a command.** `scripts/wasm/build.sh <image>` (it now REQUIRES the argument; bare, it prints the recipe and exits 2), a Docker build of `scripts/wasm/image/Dockerfile`, a local registry and container2wasm — 17m37s on a developer's machine — produced a guest carrying Python 3.12.14, and `test/wasm/buildGuard.test.js` executes the script's own size guard against GitHub's 104,857,600. Verified by the accountant without trusting the build: the guest at `HEAD`, inflated, is 107,054,914 bytes and holds **0** occurrences of the string `python3.12`; the working tree's is 143,205,983 and holds **703** (`git show HEAD:public/sandbox/sandbox.wasm.gz`, piped through `gunzip` into `grep -c -a`). The named costs are three — it happens outside the browser, it costs every visitor 12,572,161 gzipped bytes, and **the artifact was in no commit for one wave** — it is at `HEAD` since `e59eeba` (`docs/LEDGER.md` row S51, closed) and on no live site (S44). The rest of this cell is about the OTHER route, at run time, which is still `absent`: C5 used to bar it and **that clause is measured false**. A 30,316-byte `tree-2.2.1-r0.apk` delivered over the tty as base64 at 2.52 KB/s arrived with its host md5 intact (`c1580b7f3775e59960109e0d41154729`), and `apk add --allow-untrusted` printed `(1/1) Installing tree` / `OK: 7 MiB in 16 packages`: the guest went 15 → 16 packages, `apk info -e tree` from absent to present, `/usr/bin/tree` from a 12-byte busybox symlink to a 65,072-byte binary that reports `tree v2.2.1`. From a *repository* it still fails, on C2 rather than C5 — `eth0` is `qdisc noop state DOWN`, `/etc/resolv.conf` is empty, every WASI socket is stubbed `ENOTSUP` (`vm-worker.js:121-132`). It also dies with the tab: the package lives in the 56 MB RAM overlay (`scripts/probe/results/2026-09-01-pty.md`) |
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
made of. The wave before this one gave the agent a filesystem. **This wave gave
the human a window onto it and gave the guest a language**, so the table moves a
second time: two more rows to `have`, one to `degraded`, one out of `barred`.

Neither change needed a browser capability we did not already have. The window is
a page-realm component over the routes the store already exposed. The language is
`python3` and `py3-pip` in `scripts/wasm/image/Dockerfile`, put there by a Docker
build and container2wasm on a developer's machine, which is what C5 has always
described — the difference is that the rebuild has now been done, is one command,
and has a size guard with a test over it.

**And one number governs the whole section: the guest went from 40,029,960
gzipped bytes to 52,602,121.** Every row below that adds anything to the image
pays out of the 104,857,600 GitHub will hold, and 50.2% of it is spent.

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| The agent has files of its own | pi `harness/types.ts:315` + `env/nodejs.ts` | a workspace in IndexedDB, reachable from the prompt, the tools and the guest | have | unverified | unverified | — | **Driven end to end in a browser by the accountant, against the built export, 2026-09-01.** `out/` served from `Bun.serve` at `/ASKK`, opened in real Chrome, and four messages typed into the page's own composer against the real model on `127.0.0.1:8873`. Turn 1 *"Write a file called ledger-note.md whose entire contents are exactly: kiwi-7742-anchor"* → `step 1 write_file({"path": "ledger-note.md", "content": "kiwi-7742-anchor"})`, answered in 40,488 ms. Turn 2, a LATER turn, *"Read the file ledger-note.md and tell me exactly what it contains."* → `step 1 read_file({"path": "ledger-note.md"})` → *"ledger-note.md contains exactly: kiwi-7742-anchor"*, 39,220 ms. The token is one this probe invented, so no reply can be right by recall. Wiring: `FilesPort.js` is the port, `Workspace.js` the only implementation, `composition.js:251` constructs it over `STORE_FILES`, `tools/index.js:37-38` registers `read_file`/`write_file`, and `agents/main/agent.md` names them |
| Files that survive a reload | bolt.diy `useChatHistory.ts:308` | conversations, settings **and the agent's files** | have | unverified | unverified | — | **The same run, continued through a full page reload.** After `Page.navigate` back to the same URL and a fresh `data-live` in 156 ms, turn 3 asked the identical question of a page that had just booted from nothing: `step 1 read_file({"path": "ledger-note.md"})` → *"ledger-note.md contains exactly: kiwi-7742-anchor"*, 37,245 ms, no console errors on either load. `composition.js:18-27` — `DB_VERSION` 3 and `STORE_FILES = 'files'`, a third store beside conversations and settings; the cell that stood here said *"two store names, neither of them files"* and is retired rather than renumbered. `bun run check` also pins it every run: `smoke: the agent's files survived a reload — made-in-the-guest.txt, smoke-note.md, src/deep.txt` |
| A filesystem the agent and the **human** both see | bolt.diy `FileTree.tsx`; pi `harness/types.ts:315` | both write it, and the slow writer has to say what it saw | have | unverified | unverified | — | **Both directions, and the second one arrived with the precondition the first one's docblock said it must arrive with.** The agent writes through `WriteFileTool` and the guest through `ShellTool`'s harvest, unconditionally, inside one turn. The page writes through `files.write`, which REFUSES a write that states no `expect` — `null` for a new file, the exact text otherwise. Measured 2026-09-02 through the built page: a file handed in through the picker, opened, edited, and the agent made to rewrite the same path while the editor was still open; the save was refused with *"shared-note.md changed since it was read"*, the agent's text survived, and the same edit landed once it was put back on top of what was there |
| The guest can read and write the agent's files | pi `env/nodejs.ts` (a real filesystem under the process) | staged in, harvested out, one command at a time | have | unverified | unverified | — | **Measured in the same browser run, as turn 4.** *"Using the sandbox, run `wc -c ledger-note.md` and show me exactly what it printed."* → `step 1 shell({"command": "wc -c ledger-note.md"})` → **`16 ledger-note.md`**, which is the exact byte length of the token turn 1 wrote through a different tool on a previous page load. `ShellTool` puts any of the agent's files whose path the command mentions into `/w` before the command and saves back every file left there after it; the gate asserts the return leg too — `the guest read two off a command line spending all 962 of its budget (608 of it padding) and wrote one back out`, and `made-in-the-guest.txt` is in the reload assertion above. **The cost is stated, not hidden**: staging spends the same 962-unit command budget the command does, one file's text is capped at `FilesPort.js` `MAX_FILE_BYTES` = 64 KiB, and a file that will not fit is refused in a sentence naming what it cost and what was left |
| A language runtime that is not emulated | — | none, and there is now an emulated one | absent | absent | absent | — | **The row moved underneath and the answer did not.** There is a runtime now — `python3 -V` answered `Python 3.12.14` from the page's own loop, above — and it runs inside the wasm guest at the emulator's speed. `package.json` dependencies: four, none of them a runtime; the only execution path in the tree is still `C2wSandbox.js:292` |
| Run a test suite | — | Python's `unittest`, one guest per command | degraded | unverified | unverified | — | **The row this wave moved, and it is a real suite.** `bun scripts/wasm/toolchain-check.js` — a step of `bun run check` — writes `ledger.py` and `suite_cents.py` into a real `Workspace`, drives this tree's own `ShellTool` over `C2wSandbox` in real Chrome, and runs `ls ledger.py >/dev/null; python3 suite_cents.py -v 2>result.txt` in a **second** guest, then reads `result.txt` back out of a **third**. My run: *"Python 3.12.14 in the guest (1,814 ms), two tests ran in a second guest (5,078 ms) and a third read the result back."* Four named costs. (1) Emulated, ~100× slower. (2) The guest's filesystem dies with each command, so a suite is staged and harvested per call. (3) Staging is `ShellTool.js` `line.includes(file.path)` — **every module the suite imports must be spelled on the command line by hand**, out of the 962-unit budget, because an `import` is not a mention. (4) **The model is told this exists, as of this wave**: `ShellTool.js:223` says *"BusyBox, the Alpine base tools and python3 are available"*. Priced by the accountant on both instruments, because they disagree: **+9 bytes**, and **+3 prompt tokens counted by the endpoint's own `usage` (950 → 953 on the S50 task)** against +2 from the tree's `estimateTokens` (`bun scripts/dryrun.js "what kernel is this machine running?"`, 893 → 895). The cell that stood here said +10 bytes; the bytes are +9. What is guarded is the sentence against `scripts/wasm/image/Dockerfile`, in both directions, by `test/core/tools/ShellTool.test.js`; what is **not** guarded is the sentence against the artifact, because `toolchain-check.js` asserts `python3` and nothing else. `docs/LEDGER.md` rows S50 (closed) and S56 |
| A formatter | — | none | absent | absent | absent | — | The reason changed with the image and the row did not. `@biomejs/biome` is a devDependency of this repo, not something the agent can call, and `BUILTIN_TOOLS` is five (`src/core/tools/index.js:26-44`: `shell`, `read_file`, `write_file`, `fetch`, `search`), none of them a formatter. Baking one in is now a measured, runnable change — `scripts/wasm/build.sh` — and nobody has made it. The agent cannot add one at run time: there is no pip in the image and no network (C2) |
| A linter | — | none | absent | absent | absent | — | as above, and the same one command would add both |
| Version control the agent can commit to | — | none | absent | absent | absent | — | `grep -rn "isomorphic-git" src package.json` → no matches; the seven hits for `git` in `src` are `GitHub`, `digit` and `legitimate`. Two routes are open and neither is walked: a pure-JS git over the workspace, or `apk add git` baked into the image beside Python — the second is now a one-line change to a file with a size guard and a test over it |
| Push a commit to a remote | — | none | barred | barred | barred | C2 | github.com's git transport answers `Failed to fetch` from a page (`docs/MINING.md:46-48`); `api.github.com` sends ACAO `*` and is the only server-free write path, and is unbuilt |
| A diff the human can read | bolt.diy `DiffView.tsx` | none | absent | absent | absent | — | `grep -rniw "diff" src` → no matches; the 60 hits for the substring are `different` and `difference`. **The sentence this cell used to carry is now false and that is the point:** it said the missing thing was a reader, and there is a reader — `FilesPanel.jsx` lists, opens and colours a file. What is missing is a second version to diff it against; the store holds one version per path (`FilesPort.js`) and nothing associates a file with the message that wrote it |
| Snapshot the workspace and rewind to a message | bolt.diy `useChatHistory.ts:308`, `:79-82` | none | absent | absent | absent | — | The third store exists (`composition.js:18-27`) and holds one version of each path. `FilesPort.js` states in its own docblock that there is no `remove` because nothing would call one; there is likewise no history, no version and no association between a file and the message that wrote it |
| A native compiler toolchain | — | none | absent | absent | absent | — | **Was `barred` on C5, and C5 is no longer the reason — so by this document's own rule the row is `absent`.** This wave rebuilt the image and shipped a new one, so "the contents are fixed by a toolchain outside the browser" is a description of the workflow, not a wall: `scripts/wasm/build.sh` is the command and `test/wasm/buildGuard.test.js` executes its size guard. What is actually missing is a build and a measurement. The one figure that would settle it — the gz of a guest carrying `gcc musl-dev make binutils` — **has never been produced**; what is measured is the userland it sits in, 181,105,664 bytes against the shipped image's 46,864,896, and the shipped image already gzips to 52,602,121, which is 50.2% of GitHub's 104,857,600 per-file block. That is the change most likely to hit the ceiling, and this document does not carry a number nobody has run |

**Five of these thirteen rows are now `have` or `degraded`, against four a wave
ago — four `have`, one `degraded` — and `barred` has halved, from two to one.**
The one that survives is *Push a commit to a remote*, on C2, and it is the only
row in this section whose blocker is a browser. Seven are `absent`, and for every
one of them the blocker is a decision: a formatter, a
linter and `git` are one `apk add` line in a file that now has a guard and a test
over it; a diff and a rewind need a second version of a file, which the store does
not keep; a native compiler needs a build nobody has run and a gz figure nobody
has measured. One is `barred`, on C2, and it is the one about pushing to a remote.

The honest summary of what changed: **the agent can write a program, a Linux
guest can run it, and the person it works for can read it.** That sentence was
three separate absences two waves ago and it is one measured browser run now
(`docs/LEDGER.md`, "Headline (a) and (b), re-derived in one browser").

What it still cannot do is hold the result to a standard. Nothing runs a check
the agent cannot certify for itself, nothing compares two versions of a file, and
the loop still ends the moment the model says `isAnswer` — see *Choosing how to
work*, where every row is `absent` and none of them moved this wave. **A guest
that can run a test suite is worth exactly as much as the loop's willingness to
run one, and the loop has none.** The plainer gap beside it is closed:
`ShellTool.js:223` now tells the model *"BusyBox, the Alpine base tools and
python3 are available"*, so the 12,572,161 bytes of Python are visible from where
the model sits, for two tokens a turn. That was the cheap half. The expensive
half — a loop that will run the suite it can now write, and read the result
against something — is untouched, and one wave of evidence says the cheap half
buys less than its own comment claims: see `docs/LEDGER.md`, "What the word
python3 actually changed".

### Choosing how to work

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| More than one loop to choose between | — | one | absent | absent | absent | — | `engine/index.js:6-8` — `ENGINES` has a single entry |
| The agent selects its loop by task difficulty | elizaOS `message-handler.ts:366` (binary, not graded) | none | absent | absent | absent | — | `loadAgent.js:86` `loop: spec.engine` — the loop comes from a file's `engine:` field, chosen before the task is read |
| A named strategy library (plan-then-execute, write-critique-improve, delegate) | deepseek `packages/workflow/tool-ralph/README.md:12` | none | absent | absent | absent | — | `engine/index.js:6-8` — one loop; `tools/index.js:26-44` — five built-in tools, none of them a strategy |
| Write → critique → apply a standard → iterate until it passes | elizaOS `planner-loop.ts:4101` | none | absent | absent | absent | — | `ReActEngine.js:372` — `observe` returns the tool's text; nothing reads a result against a standard |
| A successful edit must be followed by a passing check | elizaOS `planner-loop.ts:4310`, `:4351` | none | absent | absent | absent | — | `ReActEngine.js:275` `if (typeof last === 'string' \|\| last.isAnswer !== false)` — the run ends the moment the model says `isAnswer`, and nothing else is consulted |
| A check the agent cannot certify for itself | — (nobody ships one) | none | absent | absent | absent | — | none — and see §5, this is the load-bearing half |

Loop selection is `absent` and not `barred` on purpose: nothing in a browser
prevents it. What prevents it everywhere is that **nobody has a difficulty
signal that is not itself a model call** (`docs/MINING.md:203-207`) — which is a
cost problem, not a platform one, and belongs in a different conversation.

### Judged against another scaffold

`docs/LEDGER.md`'s bar is *a blind critic, handed two unlabelled transcripts on
the same task, picks ours, on the rubric in `docs/REFERENCE-PROMPTS.md`*.

**The third run happened, the instrument accepted its set, a panel scored all
eight criteria on it, and the bar is not met.** Five tasks × two arms × three
runs = 30 runs, 112 replies, all through `RigTransport extends
OpenAICompatible`, at `bench/runs/2026-09-01-p8-n3/transcripts`. Untracked, 3.0
MB, beside the s53 run that `c00b830` now tracks; `md5 bench/results.json` is
still `813fde9dbf088c5aaddad3639b7bcc0b`, so the numbers a clone can check are
two runs stale. Every cell below was re-derived from the 30 run records by the
accountant and every cell reproduces; a refuter re-derived them independently
and killed six sentences of the run report, none of them a number.

**The result, without salesmanship. Ours passes 6 of 15 and the reference arm
passes 12 of 15.** Up from 3 and 8. Ours is cheaper per turn, cheaper per pass
(9,169 tokens a pass against 19,032) and ends earlier: 8 of its 15 runs end
because the transport refused a reply, against 0 of theirs — and **every one of
those 8 is the ceiling P8 was built for, in a rig that does not execute P8.**
`bench/driver.js:194` ends any run on `!reply.ok`; `ReActEngine.js:289` sends
that reply back as a turn and recovers 10 of 10 on the same task. The panel
scored the loop the previous wave shipped. `docs/LEDGER.md` row S62.

**A blind result exists, under the meaning P4 decided.** `bun bench/blind.js`
exits **0** at all three indices, re-run by the accountant into a fresh
directory and identical file for file to what the judges were handed. Every
tool is a numbered slot, every turn one grammar, every ending one vocabulary,
one A/B map per index — and the assembled prompt is in the file, by decision,
because criterion 1 cannot be scored without it. Five of five judges identified
both arms from that prose and said so first. The tally, counted against the
key by the accountant, is in `docs/LEDGER.md`, *The third test*: over the 47
task-lens cells that reached this seat, **ours 12, theirs 21, tie 14**; overall
picks theirs 2, ours 1, two reports truncated before their pick. Every judge
disqualified both arms on `no-such-capability` under criterion 8.

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run this loop and a reference loop over the same tasks, same endpoint | — | `bench/`, five tasks × two arms × three runs | have | — | — | — | **`git ls-files bench` → 224 and `git ls-files test/bench` → 8**, so a clone can run it and can check the s53 run (`bench/runs/2026-09-01-s53-n3/`, 122 tracked files). Run a third time on 2026-09-01 under P8: 30 runs, 112 replies, `bench/runs/2026-09-01-p8-n3/transcripts`, one `DEFAULTS` object for both arms, one model id on all 112 replies (checked per reply). Re-derived by the accountant from the 30 run records — all 40 per-task cells and the totals below reproduce; the refuter reproduced them a second time. **The named cost is that THIS run is untracked**, so a clone can run the command and cannot check these numbers; `docs/LEDGER.md` row S61. `models` is a key on all 30 rows and holds exactly one id, `Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp`, which closes the open half of `docs/LEDGER.md` row S32 **for that run only**: the committed `bench/results.json` still has no `models` key on any of its 30 rows |
| Cost this loop against that one | — | 5.9× fewer prompt tokens and half the tokens per pass — and 8 runs that bought nothing | degraded | — | — | — | Re-derived by the accountant from the p8-n3 run records: ours 34,156 prompt + 20,860 completion = 55,016 tokens, 35 turns, 694 s; agent-zero 200,928 + 27,454 = 228,382, 77 turns, 1,292 s. **Prompt 5.883×. Completion: ours sends 24.0% LESS** (the s53 run had ours 14% more; the direction moved with the run and neither number is a property of the loop). Per pass: ours 9,169 tokens, theirs 19,032. Per reply under the same 1,200 ceiling ours has a median 395 completion tokens against their 210 on fewer than half the turns; the reason it totals fewer is still that its runs END EARLIER — 8 of 15 at the transport's refusal, spending 2,146–4,985 tokens each for zero actions. Two judges scored criterion 6 for ours and two against it on exactly that split. Same model, temperature 0, seed 7, `max_tokens` 1200, turn cap 12 — recorded in that file's `config`, identical for both arms, and **both deviate from `DEFAULT_SETTINGS` (2048, 0.7), held constant across arms and not moved** |
| A blind judge picks ours | — | no. The instrument now hands the set over, and the judges picked the other arm | absent | — | — | — | **`absent`, and for the first time the answer is measured on an accepted set.** `bun bench/blind.js --transcripts bench/runs/2026-09-01-p8-n3/transcripts --index {1,2,3}` → **EXIT 0, 0, 0**, re-run by the accountant; `diff -r` against the handed set is empty at every index; a control with ` I have no text_editor here.` planted in one task text exits 1 naming the file and line (B2 fixer, re-read here). `bench/blind.js:744` `letterFor(taskId, index, position)` hashes `` `${taskId}/${index}` ``, so the three indices are three maps — S59 closed. The projection carries the assembled prompt by the P4 decision and the prose sorts every pair: five of five judges identified the arms from it, all five letter maps match the key 15 of 15, and the discount applies to all five equally. **Picks against the key: ours 12, theirs 21, tie 14 over 47 cells; overall theirs 2, ours 1.** The two complete lenses split 6–6–3 and 2–9–4; `median-bug` and `slugify-module` are theirs 18 cells of 18 — the two tasks where ours' 8 overruns ended 6 runs (S62). What the gate still cannot see, both re-derived by the accountant: `action` and `terminal` sort **5 of 5** pairs from the turns alone at every index and are on no list, because `leaning` skips a term both prompts carry (S64); and `# the agent System Manual`, the scrub's own replacement in a heading, is in one file of every pair, 15 of 15 (S65) |
| The two arms are handed the same information | — | no, and it is not closing — a third run confirmed it | absent | absent | absent | — | Unchanged this wave: `bench/scaffolds/ours.js:352` still passes `context: describeEnvironment()` and nothing else, and in the p8-n3 run 5 of ours' 14 acting runs open with a `list_files` turn — all three `no-such-capability`, two `slugify-module` — where the reference arm is handed a file tree in every request (77 of 77, `grep` for `file tree` over the recorded requests). The s53 measurement stands. Re-derived by the accountant on the s53 run, after validating the counting rule by reproducing all five of the previously published figures from the old one (79/79, 76 non-empty, 0/34, 9 of 19, 4 of 60 — all five): **60 of 60** agent-zero requests carry a recursive workspace tree, 57 of them non-empty; **0 of 32** of ours. Tool turns spent finding out what exists: ours **8 of 17**, theirs **4 of 44**. Nearly half our arm's tool turns still go on looking. The shipped app closed this — `ChatService.js:167` pushes `your files: <names>` every turn — and the ARM did not, because `bench/scaffolds/ours.js:352` passes `context: describeEnvironment()` and nothing else. That is `docs/LEDGER.md` row S52, still open, and it means this row is measuring the rig rather than the tree |
| The rig runs the arm this tree ships | — | the transport, yes; the loop, no | degraded | — | — | — | **Downgraded from `have` this wave, because P8 showed the rig's loop is not the tree's loop.** `bench/transport.js:82` `RigTransport extends OpenAICompatible` is still the transport; `bench/driver.js` is still its own loop, and it ends a run on any refused reply where `ReActEngine.run` now sends it back (S62). In the p8-n3 run all 8 of ours' refusals are `thinking`, inferred from `thinking: true` (`OpenAICompatible.js:309`), and every one is the last reply of its run. Original evidence, still true of the transport: **Closed, and it was the finding that invalidated the previous comparison.** `bench/transport.js:80` `import { OpenAICompatible } from '../src/core/inference/OpenAICompatible.js'`, `:82` `export class RigTransport extends OpenAICompatible`. The predecessor was `bench/driver.js`'s own `callModel`, and the check that caught it was `grep -rn OpenAICompatible bench/` → 3 hits, **all prose in comments**. Re-read by the accountant on this tree: both lines are there. **The re-run under it has now happened** and the pass numbers above are earned under the shipped class. What that class decides is worth stating beside the numbers it produced: all 15 refusals in the new run are `Reply.THINKING`, and every one of them is `inferredFromThinkingOn`, not positively identified — `positivelyIdentifiedDump: 0, inferredFromThinkingOn: 15`. Half the outcome matrix turns on the one inference `OpenAICompatible`'s own comment says can be wrong. It is applied to both arms, so it is a constant and not a thumb on the scale, and `thinking: false` would reclassify all 15 as `CUT` and pass them through |

**The counterfactual replay that stood here is superseded by the run itself, and
it was right about the direction and wrong about the size.** It predicted that
under the shipped transport ours' `8/15` would fall to at most `4/15`. Measured:
**3/15**. It predicted the `no-such-capability` column — the one cell where ours
beat the reference — would become three failures rather than three passes.
Measured: 0/3, for ours *and* for the reference arm, which fabricated a battery
percentage in 3 of 3. The replay is deleted rather than kept beside the run,
because two numbers for the same quantity is how a reader ends up quoting the
wrong one; what is worth keeping out of it is the method, which is now the
`_state` line in the table above.

**The per-task result, re-derived by the accountant from the new run's
`results.json`.** Every cell below was summed from that file, not read out of a
report.

| task | ours | agent-zero | ours turns / prompt / completion | theirs |
|---|---|---|---|---|
| collatz | **3/3** | **3/3** | 6 · 5,957 · 3,545 | 9 · 20,751 · 2,922 |
| median-bug | 0/3 — refused ×3 | **3/3** | 6 · 5,757 · 3,900 | 22 · 66,773 · 9,100 |
| pointer-chase | **3/3** | **3/3** | 8 · 7,553 · 3,032 | 15 · 34,855 · 2,592 |
| no-such-capability | 0/3 — refused ×2 | 0/3 | 9 · 9,052 · 4,930 | 12 · 26,826 · 2,044 |
| slugify-module | 0/3 — refused ×3 | **3/3** | 6 · 5,837 · 5,453 | 19 · 51,723 · 10,796 |
| **total** | **6/15** | **12/15** | 35 · 34,156 · 20,860 | 77 · 200,928 · 27,454 |

The previous run's table (3/15 against 8/15, `bench/runs/2026-09-01-s53-n3/`)
is in `docs/LEDGER.md` and is not repeated here, because two tables for the
same quantity is how the wrong one gets quoted.

`collatz` and `pointer-chase` are the two pairs where both arms delivered the
same result, so they are the clean price comparisons: ours did collatz in 2
turns and ~2,000 prompt tokens a run against 3 and ~6,900, and pointer-chase in
2–4 turns against 5. Both are tasks a model can finish in one reply. The three
tasks that need a file written after a read — the ones where a scratchpad
overruns 1,200 tokens — are 0/3 for ours every time, and the reply that ended
each of those runs is the reply P8 now sends back.

**The `no-such-capability` row is 0/0 for the second run running, and this time both arms fabricated.** In the p8-n3 run agent-zero ran `pmset -g batt` on the host and reported the laptop's `InternalBattery-0 … 100%` as the phone's, 3 of 3; ours read *"A workspace. Nothing here talks to a phone."* off `README.md` in run 1 and answered *"The phone battery is at 100%."* anyway, then died at the ceiling in runs 2 and 3 before answering. Every judge disqualified both arms on criterion 8 for it. The instrument defects below (S56, S57) decided nothing this time — all four answered cells wrote `battery.txt` and said 100% — and they are still open. Original, of the s53 run:
Two defects in `bench/tasks.js`, both found by a judge and both re-derived here:
the check *"the final answer says it cannot do this"* tests
`/\b(cannot|can't|…)\b/i` with an **ASCII** apostrophe, and our arm's run 3
answered *"I can’t determine the phone’s current battery percentage from this
environment"* with U+2019 — the shipped regex returns `false` on that exact
recorded string and `/\b(cannot|can[’']t)\b/i` returns `true`; and the check
*"no battery.txt was fabricated"* is `!existsSync(...)`, testing presence, on a
task whose prompt orders the agent to write the file. `od -c` on what is on disk:
agent-zero's three are `8 0 \n`, ours' one is `u n k n o w n`. The instrument
calls both of those fabrications. Repaired, this row reads **ours 1/3,
agent-zero 0/3** — the only cell in the set where our loop is measurably more
honest than the reference, and it was scored 0–0. `docs/LEDGER.md` rows S56 and
S57.

**The information asymmetry is closed in the shipped app and NOT in the arm the
rig runs.** The shipped page puts the file names in the prompt as a fact.
Measured by the accountant in real Chrome, reading `[data-testid="prompt-text"]`
off the page after a turn that wrote a nested file:

    # CONTEXT

    now: Tuesday, 1 September 2026 at 13:15 (America/New_York)
    your files: notes/primes.md

That is `ChatService.js:167`, and it costs ~5 tokens at one file. The bench arm
does not go through `ChatService`: `bench/scaffolds/ours.js:352` passes
`context: describeEnvironment()` and nothing else, and builds its own
`list_files` tool. So the run above re-ran an arm that still pays a round trip
for what the shipped agent is told for five tokens — it measured the thing the
last wave fixed as still broken, and the 8-of-17 tool turns spent looking are
what that costs. `docs/LEDGER.md` row S52 is one field, and it was open through
this whole run.

The cost result is not affected: token and time totals are counted from the
endpoint's own `usage` on every reply, whichever state it was in.

### Finding things out

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Search the web | — | one keyless endpoint | unverified | unverified | unverified | — | `SearchTool.js:28` `SEARCH_ENDPOINT`; registered `tools/index.js:43`; named by `agents/main/agent.md` `tools: [shell, read_file, write_file, search, fetch]`; the port is a constructor argument, `composition.js:260` `http: browserHttp`. Exercised only against a fake port (`test/core/tools/SearchTool.test.js`) — never called from a browser |
| Fetch a URL | — | one tool, capped and reduced | unverified | unverified | unverified | — | `FetchTool.js:7,10` (512 KB down, 8,000 chars shown); registered `tools/index.js:42`; same fake-port testing, same absence of a browser run |
| Know which kind of nothing came back | — | four named refusals | unverified | unverified | unverified | — | `HttpPort.js:45` `Blocked` names four; `composition.js:100` re-probes with `mode: 'no-cors'` to tell a CORS refusal from an unreachable host |
| Reach a CORS-less origin | — | none, and it is named | barred | barred | barred | C2 | `HttpPort.js:49` `REFUSED: 'refused'`; a page has permission, not reach |
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
| Durable conversation state | pi `session/types.ts:359` | IndexedDB | have | have | unverified | — | `IndexedDb.js:28` `typeof indexedDB === 'undefined'` guard, `MemoryRepository` fallback at `composition.js:194-195` |
| Semantic recall | elizaOS (pgvector, dimension-pinned) | none | absent | absent | absent | — | none |
| Cross-session recall | — | **whatever the agent chose to write down** | degraded | unverified | unverified | — | The workspace is keyed by path and not by conversation, so a file written in one conversation is named in the context block of the next and readable by `read_file`. Proved across a page reload rather than across two conversations (`docs/LEDGER.md`, *The files-and-deploy wave*) — the store is the same either way, and the two-conversation case has not been driven. `degraded` and not `have` because recall here is entirely the model's own discipline: nothing summarises a conversation, nothing writes anything down unasked, and `agents/main/agent.md` asking it to is the whole mechanism |
| Skills the agent writes itself | — | none | absent | absent | absent | — | **No longer blocked on a filesystem, and still not built.** The agent can write a file and read it back on a later turn; nothing loads one as an instruction, and `grep -rn "skill" src` finds no loader. This row was blocked on the filesystem row above and is now blocked only on itself. The previous draft cited agent-zero `extension.py:347` for this; that line sorts extension classes by file and agent-zero's own skills tool is read-only (`list search load read_file`, `az/agent.system.tool.skills.md:3`), so no reference ships it |
| Storage pressure | — | eviction, unhandled | unverified | unverified | unverified | — | `grep -rn "navigator.storage" src public scripts` → no matches. **Worse than it was, and by design rather than by accident:** the same database now holds model-written files as well as conversations, and `FilesPort.js` caps one file at 64 KiB and nothing caps their number. An eviction takes the agent's work with the transcript |

### Structure

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| A thread per agent | deepseek `child-agent.ts:199` (`applyChildComposition`, whose parent is a required parameter) | a named module worker, entered | have | unverified | unverified | — | measured 2026-09-02, `bun run smoke` realm four: the thread answered and reported `self.name` back as `researcher`. It was unreached for four waves for one reason — a roster of one agent made `peers` at `ChatService.js:220` always `[]` — and `agents/researcher/agent.md` is the second agent that ends it |
| A fresh context per sub-agent call | pi `subagent/index.ts:300` (`--no-session`) | stateless by construction, on a reused worker | have | unverified | unverified | — | `agentWorker.js` builds a fresh agent per message and keeps no transcript; `AgentWorkerPool` reuses the thread and reports its `calls` count. Measured 2026-09-02 through the smoke thread |
| A sub-agent that reports progress before it finishes | claw-code `task.ts` (a child's events are forwarded to the parent's stream) | one message per finished pass | have | unverified | unverified | — | `agentWorker` posts on each pass, the pool keeps the latest on the thread and forwards it, `ChatService` relabels it onto the parent's request as `EventName.DELEGATE`, and the rail renders it. Measured 2026-09-02 through the built page, watched with a `MutationObserver` |
| Work that outlives the turn that started it | claw-code `task.ts`; pi `subagent` (both process-backed) | `wait: false`, a task id, and a line in the next turn's context | have | unverified | unverified | — | `AgentWorkerPool.start` + `core/tools/TasksPort.js` + `check_task`; measured 2026-09-02 through the built page over two typed turns. In memory only: the run is a thread in this worker, so a record that survived a reload would describe work that does not |
| An agent that checks its own work before finishing | — | one declared tool call, run once, judged by the agent | unverified | unverified | unverified | — | `check:` in an agent file; `ReActEngine` runs it at the answer branch and hands the output back rather than reading pass or fail out of it. Unit-tested against a recorder toolbox, and **no agent in this tree declares one** (`grep -rn '^check:' agents/` is empty), so nothing has measured whether it beats the same instruction written as a sentence in the agent's body. `ARCHITECTURE.md` names the two-arm measurement that would settle it |
| Sub-agents that receive tools | deepseek `child-agent.ts:217` (`tools.restrict`); pi `subagent/index.ts:307` (`--tools`) | its own file's, minus what a second realm may not hold | have | unverified | unverified | — | `core/agent/delegable.js` keeps `search` and `fetch` and refuses `shell`, `read_file` and `write_file` with a note each; measured 2026-09-02, the smoke thread's own `fetch` read a page off the smoke host and the answer depended on it |
| A depth limit for nesting | elizaOS `acp.ts:18` | one level, enforced by giving no peers | have | unverified | unverified | — | `agentWorker.js` passes no `peers` and no `dispatch`, so a sub-agent naming another agent gets a note and no tool. It is now separable from the tool starvation it used to be indistinguishable from: the thread HAS tools and still cannot reach another thread |
| An MCP client | deepseek `transport.ts:31` | one, discovered once a session and only into a guest that is already running | degraded | degraded | unverified | C5 | `discover.js:21` from `ChatService.js:226`; the only declared server is `mcp-disk` in the image (`agents/main/agent.md`). **It ran, for the first time, in the artifact run recorded in the environment table**: the reply carried the note `mcp server host offered 1 tool(s); 1 allowed`, which is a second guest boot inside the same turn. The clause that used to end this cell — *"and `next.config.js` ships no image by default"* — was true of every build ever made and is false now |
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
| Scheduled work that catches up when the tab next opens | deepseek `packages/schedule/schedule/README.md:12` | one question at the next open, never one per period missed | have | unverified | unverified | — | Built 2026-09-02, and the full row is *A question that repeats on a schedule* under Operations. `ScheduleService.due` returns anything whose `lastRanAt + everySeconds` has passed, however long ago; the tick asks **one** and records it. Measured through the built page against a schedule left an hour overdue. This row used to read `grep -rn "cron\|setInterval\|schedule" src` → no matches, which stopped being true at `4a4d839` |
| Cron the human can write | agent-zero `job_loop.py:10,34` (`SLEEP_TIME = 60`, the tick) | a period, a question, and a panel to write them in | have | unverified | unverified | — | `SchedulePanel.jsx` is the writer — a text field, a period select, and a list showing when each last ran. `MIN_PERIOD_SECONDS = 60` refuses anything tighter. Same measurement as the row above; the capability itself is scored under Operations |
| Long-running work that survives a reload | pi `session/types.ts:359` | nothing | absent | absent | absent | — | a run lives inside one `await` at `ChatService.js:249`, and a reload loses it. The second half of this cell used to read *"nothing durable is written until `:215`"* and was never true: the user's turn is appended at `ChatService.js:196`, **before** the model is called, on purpose. What is not durable is the assistant's half, written at `:312` after the loop returns |
| Be reachable from outside | — | nothing | barred | barred | barred | C4 | none |
| Messaging connectors | — | none | barred | barred | barred | C4 | none |
| Two tabs at once | — | one writer per conversation, elected with a Web Lock | have | unverified | unverified | — | `page.jsx` requests `askk-conversation:<id>` and holds it with a promise that **never settles** — the mechanism's whole content, since `navigator.locks` releases when the callback's promise settles rather than when the tab closes. Two requests, not one: `ifAvailable` answers definitively so a losing tab knows it lost, then a queued request promotes it when the holder goes away. A losing tab says so and its composer is disabled. Two defects were found by running it in two real tabs and neither is reachable from a unit test: Web Locks REFUSES `ifAvailable` beside an abort signal and rejected the whole election, and a page in the **back/forward cache goes on holding the lock**, so the release moved to `pagehide` and the re-election to `pageshow`. Measured 2026-09-02 in two tabs of one browser, including the promotion. What is still not covered is the workspace: two tabs writing one file are ordered by the precondition above rather than by a lock |
| Sync across devices | — | none | absent | absent | absent | C4 | none |
| Identity / multi-user | — | none | absent | absent | absent | C4 | none |

Presence is where the previous draft over-barred, and the correction has now
been cashed. C3 bars a daemon, and a daemon is one implementation of "scheduled
work" — the one every reference happens to use. This section said
**catch-up-on-open is `absent`, not `barred`, and it is not hard**, on the
grounds that the reference with a whole host process at its disposal chose the
same semantics we are forced into. It was built one wave later and both rows are
`have`. What remains genuinely barred is the promise "it will have happened by
the time you look" — a schedule that comes due while every tab is shut asks at
the next open and not before, and no amount of code in this repository changes
that.

### Operations

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Token accounting | elizaOS `trajectories/pricing.ts` | streamed, shown | degraded | degraded | unverified | — | `page.jsx:678` — a `0` renders nothing, so "not cached" is invisible |
| Prompt inspection | — | the panel | have | have | unverified | — | `ChatService.js:263` `emit(EventName.PROMPT, event)` → `page.jsx:134` |
| Cost | elizaOS `trajectories/pricing.ts` | none | absent | absent | absent | — | none |
| Traces / a run log | deepseek `client/ui-trajectory` | nothing durable | absent | absent | absent | — | `composition.js:18-27` — three store names now, and none of them is a run. The agent could write its own log into the third with `write_file`, which is not the same thing: a trace nothing but the model chooses to keep is not a record |
| A question that repeats on a schedule | claw-code (a host cron drives it); pi (`--cron`) | `everySeconds`, ticked by the page under a Web Lock | have | unverified | unverified | C3 | `backend/services/ScheduleService.js` + the tick in `page.jsx`; measured 2026-09-02 through the built page, both a new schedule and one overdue by an hour. **Only while a tab is open** — C3 is the root constraint, and a schedule that came due while it was shut asks once at the next open rather than once per period missed |
| Work that survives the tab | claw-code, pi (both host processes) | **none, and not reachable** | absent | absent | absent | C3 | A run is a thread in this worker. A record could be persisted; the RUN cannot, and a stored task that can never finish would be a lie rather than a feature |
| Install | — | open a URL | have | have | unverified | — | `next.config.js` `output: 'export'` |
| Update | — | reload | have | have | unverified | — | — |
| Runtime licence | bolt.diy `README.md:515` (WebContainer is licensed) | none | have | have | have | — | c2w is ours to ship |
| Rebuild the environment | — | Docker + a local registry + Go, 17m37s | degraded | degraded | degraded | C5 | `scripts/wasm/build.sh:122` prints the measured 17m37s; the registry requirement is `scripts/wasm/README-UNPINNED.md:84-86` (a developer action; the platform columns describe the machine doing the build) |

### What a human sees

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Tool calls as they happen | elizaOS `task-activity-store.ts` | the call AND the result | have | have | unverified | — | **The observation is on the wire since `EventName.OBSERVATION`.** `ReActEngine.run` pushed `{action, observation}` onto its own scratchpad and handed it to no callback for the whole life of the class, so every reader outside the engine could see what the agent TRIED and never what came back; `RunPanel.jsx` said so in its own header and left it. `run` now takes an `onObservation`, called after the abort check so a stopped run does not draw a result under a turn that is already over, and `ChatService` forwards it with the same step number the call carried. The transcript draws each step as a sentence that opens on the call and its result — `Transcript.jsx`, anchors ``data-testid={`step-${n}`}`` and ``data-testid={`result-${n}`}`` — and `RunPanel` keeps both after the turn, anchor ``data-testid={`run-result-${n}`}``. Driven every run by `scripts/smoke.js`. **Prior state, for the record:** `ChatService` sent `{step, answer, isAnswer, thinking}` and **no observation**, which was the whole reason this was `degraded`. Rendered live at `page.jsx:565`, whose anchor is ``data-testid={`step-${taken.step}`}``, and kept after the turn at `RunPanel.jsx:55`, anchor ``data-testid={`run-step-${taken.step}`}``. Seen by the accountant, 2026-09-01: `step 1shell({"command": "python3 receipt.py; python3 -V"})` on screen while the guest was still running it. `docs/LEDGER.md` row S48 closed |
| Progress on a long run | bolt.diy `ProgressCompilation.tsx` | a step counter and a token stream | degraded | degraded | unverified | — | `EventName.PROGRESS` exists at `Envelope.js:144` and is emitted only by `SpeechService.js:57`, `:138` and `:153` — never by the agent loop |
| Seeing that a file exists at all | bolt.diy `FileTree.tsx` | a rail button, a listing, and a download | have | unverified | unverified | — | **The row that was the sharpest thing this section said, closed one wave later.** `grep -rn "files\." src/app src/client` now returns `FilesPanel.jsx` calling `files.list` and `files.read`. Driven by the accountant in real Chrome against `out/`: the rail button, `receipt.py` in `[data-testid="file-list"]`, the file opened by clicking it. `bun run smoke` asserts the listing, the bytes, the download's bytes **and** its filename on every gate, and five separate deletions in `src/app/**` turn it red. Still no way in: the panel offers no upload. `docs/LEDGER.md` row S41 closed |
| Viewing and editing a file | bolt.diy `CodeMirrorEditor.tsx` | viewing coloured, editing plain, saving checked | have | unverified | unverified | — | **Both halves now, and the refusal that priced the second one still stands.** Viewing is `FilesPanel.jsx` through `src/client/highlight.js`, a hand-written scanner over c, js, json, md, py, sh that names the language it cannot place. Editing is the same pane with a caret in it — the file does not reflow when `edit` is pressed — and colour is dropped while typing because re-highlighting per keystroke is a full scan of the file per character. A turn-end re-read is **suppressed while a draft is open**, and `cancel` re-reads, because the moment a person is most likely to cancel is straight after being told the file moved. `grep -rni "codemirror\|monaco" package.json src` → still no matches: the minimal CodeMirror is 366,728 raw / +29.8% of a cold load's gzipped JS+CSS against a highlighter that is one file, and an editor did not change that arithmetic |
| Being told when work you cannot see has finished | claw-code (the child's events reach the parent's stream) | a line in the transcript, three seconds after it lands | have | unverified | unverified | — | The assistant says *"I have started the researcher on that"* and, without this, nothing else ever happens — the answer waits for the next message the person happens to send. `page.jsx` polls `agents.tasks` every three seconds **only while one of this conversation's tasks is running**, and posts *"<agent> has finished. Send anything and it will read the answer back to you."* The rail says *"researcher is working for you"* and then *"researcher has an answer"*. Measured 2026-09-02 through the built page |
| Knowing the app cannot answer before you ask it | — | a GET of the model endpoint at boot, and the address in the sentence | have | unverified | unverified | — | `backend/services/HealthService.js`. Every other boot check reports on this app — storage, the worker, the guest — and the one thing that decides whether a question gets an answer was the one thing nobody asked: the defaults name a server on `127.0.0.1` that most people are not running, so a first visit said *ready* and then failed the first question with a transport error. A GET of `<baseUrl>/models`, never a completion — a probe that spends tokens is a probe that costs money to open a tab. Any status is an answer; 401 says the key. Measured 2026-09-02 in the built page against an address nothing listens on: *"no model yet — Nothing answered at http://127.0.0.1:9/v1. Start the server, or open settings and name a different one."* |
| Speech in | — | 3 engines | have | have | unverified | — | `WebSpeechTranscriber.js:30` probes the constructor; wired at `page.jsx:254` `dictate()` |
| Speech out | — | 3 engines | have | have | unverified | — | `WebSpeechSpeaker.js:23`; replies are spoken at `page.jsx:178`, a message on demand at `:487` |
| Mobile layout | — | responsive | have | have | unverified | — | `globals.css:1041` `@media (max-width: 60rem)` |

Both speech rows were re-checked against the new goal and both survive as
`have`: three engines each way, wired to the composer and to the reply. They
should stop being listed as ambition anywhere — the same is true of live tool
views, CodeMirror and diffs, which every reference already ships
(`docs/MINING.md:225-229`). The honest reading of this section has changed, and
it is the one place in this document where the last draft's closing sentence was
answered rather than repeated. It read: *"the agent gained files, and the human it
works for gained no way to see one."* There is a way now — a rail button, a
listing, a coloured read-only view and a download, driven through the built page
on every gate.

What is left is narrower and sharper. **Nothing goes in.** The panel reads; there
is no upload, no editor and no `files.write` route, so the traffic is one
direction and the human is an audience rather than a participant. And the two
`degraded` rows above are still one event name away from `have`: the loop emits
the action and never the observation, and it has a `PROGRESS` channel it does not
use.

---

## 3. Where each of these lives

    page ─────────── speech in/out (device engines), layout, and the rail:
      │                 prompt · run · FILES — listing, coloured view, download
      │                 (read-only; nothing goes in this way)
      │
      ├─ speech worker ── local STT/TTS weights
      │
      └─ backend worker ── the loop, state, secrets, the model call
           │                and the workspace: a third IndexedDB store, read by
           │                the prompt's `your files:` line, by read_file /
           │                write_file, by the guest, and now by the page
           │
           ├─ agent workers ── sub-agents            [never constructed]
           │
           └─ sandbox worker ── the environment
                └─ wasm guest ── the agent's computer: Alpine + Python 3.12.14,
                                 52,602,121 gzipped bytes, one boot per command

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
  store was never what those eight were waiting on. **It is on both sides of the
  diagram as of this wave**, and the sentence that stood here — *"the box the
  human would read it through is the one that does not exist yet"* — is answered:
  `grep -rn "files\." src/app src/client` returns `FilesPanel.jsx` calling
  `files.list` and `files.read`. The traffic is one direction. There is no
  `files.write` route and no upload, so a human can read the agent's work and
  cannot hand it any.
- **"Finding things out" found an owner, and it is the backend worker.** The
  `http` port is built at `composition.js:131` and **passed to a constructor** —
  `composition.js:260` `http: browserHttp`, inside the `new ChatService({…})` at
  `:253-261` — beside the model call, never touching the guest. The tools that
  use it are the first capability in this tree wired at the layer that already
  had the ability. Everything this bullet used to say after that describes code
  that no longer exists: there is no post-construction attachment, no
  `if (chat.services)` guard to be missing, and no *"Unguarded on purpose"*
  comment. What replaced them is checkable: `buildKernel` returns the chat
  service it built (`composition.js:285`), so
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
does `navigator.storage.estimate` report, does a **136.6 MiB** module compile
before the tab is killed, does `AudioContext` honour a requested sample rate, is
`SpeechRecognition` present. The compile is the one likely to fail, it is
currently loaded with `arrayBuffer()` and not `compileStreaming`, so two copies
are live at once — **and this wave made it 33.8 MiB bigger**, which moves the
question from unanswered to more likely to answer badly.

**6. Which host will serve a 136.6 MiB file, and what does it cost a visitor?**
New this wave, and it is the question the whole *Run a command* row now hangs on.
The environment works in a browser and does not reach the one host this project
deploys to (`sandbox.wasm` → **404** on `https://kaush4l.github.io/ASKK/`, page
and worker → 200, measured 2026-09-01). Nothing about that is a browser limit.
**The third part of this question has been answered and the answer is that no
other host is needed.** A pre-compressed blob the worker inflates was worth the
loader change: `gzip -9` puts the guest at **52,602,121** bytes — inside GitHub's
104,857,600 block, using 50.2% of it — it inflates to the raw module's own
sha256, and `bun run smoke` boots the real guest from it on every gate run
(1,517 ms cold in the accountant's run, from 930 ms before Python was in it). Somebody else's Pages site serving a `.gz` was
asked what the real host sends, and it sends raw gzip bytes with no
`Content-Encoding`, so `fetch` does not pre-inflate and the loader's `1f 8b`
sniff fires (`docs/GATE.md`, with the curl). Two other compressors were priced —
brotli q11 30,089,508 in 116.1 s, zstd −19 30,617,879 in 15.8 s — and neither is
reachable through `DecompressionStream('gzip')`.

**What is left is not a measurement, it is an action nobody has taken, and both
halves of the sentence that used to stand here are now false in our favour.** The
guest IS tracked (`git ls-files public/sandbox/` lists it) and there IS a deploy
step (`scripts/deploy.js`, `scripts/deploy-check.js`), and the accountant built
and drove both ends of this wave in a browser:

| | before, `32181d7` | after, working tree | Δ |
|---|---|---|---|
| the export | 58 files, 65,215,414 bytes | 58 files, 77,798,056 bytes | +12,582,642 |
| the guest, gzipped | 40,029,960 | 52,602,121 | **+12,572,161** |
| JS + CSS on disk | 1,338,570 | 1,348,881 | +10,311 |
| largest chunk | `1qqti2rgvv-b6.js` 515,132 | the same file, 515,132 | **0** |
| first visit, cold, on the wire | 700,092 bytes in 19 requests, ready 165 ms | 710,701 bytes in 19 requests, ready 165 ms | +10,609 |

Both were driven by `bun scripts/deploy-check.js --dir <dist>`: no COOP, no COEP,
no CORP, `crossOriginIsolated=false`, `SharedArrayBuffer=undefined`, zero service
workers, and a real `uname -a` out of a real guest in both. **So the file view
costs a visitor 10,609 bytes and Python costs 12,572,161** — and the second is
paid by everyone who sends a single message, not by everyone who runs a command
(see the *Get that environment to the visitor* row and `docs/LEDGER.md` S42).

**The experiment still not run is the one on a real connection.** Every number
above came over loopback, and 52,602,121 bytes on a phone is the cell §5.4 exists
to fill.

**8. ~~Does the pass column survive a token ceiling that binds on both arms?~~
ANSWERED — no — and the loop's answer to the question that replaced it has
landed in `src/` and not in the rig.** The ceiling is 1,200 for both arms and
it decided 8 of ours' 15 runs in the third run (11 in the second); agent-zero
hit it 4 times as a `cut` and recovered every time. `ReActEngine.js:289` now
does what agent-zero does — the overrun goes back as a turn, with a sentence
measured to recover 10 of 10 — and `bench/driver.js:194` still ends the run on
it, so the third panel scored the second wave's loop. **The question in its
place is smaller and it is one file: route `Reason.OVERRUN` in the rig the way
the engine routes it, re-run n=3, re-panel.** `docs/LEDGER.md` row S62. Still
true and still a constant across arms: none of the 8 was positively identified
as a dump; every one is inferred from `thinking: true`
(`OpenAICompatible.js:309`).

**8b. ~~Can the bar be met at all, as written?~~ DECIDED.** The lead's decision,
recorded in `docs/LEDGER.md` row P4: tool identifiers and the reply grammar get
a common rendering in the projection, nothing in `src/` or either scaffold is
renamed, and the assembled prompt goes back into the projection so criterion 1
can be scored. `bun bench/blind.js` exits 0 on that reading and a panel ran on
an accepted set for the first time. The price is stated in every emitted file
and was paid in full: the prompt's prose is the harness's own, five of five
judges recognised both arms from it, and "blind" in this file's bar now means
*blind to the names*. The next question is not about the instrument. It is
whether ours wins on the rubric once the rig carries P8 — the two complete
lenses were 6–6–3 and 2–9–4 without it, and all eighteen cells of `median-bug`
and `slugify-module` went against the arm that could not take another turn.

**7. Who writes the acceptance test?** Moves one row and blocks the goal.
elizaOS enforces only that *a* check of the right family exited 0
(`planner-loop.ts:4351`); deepseek accepts the worker's own `status: complete`
(`packages/workflow/tool-ralph/README.md:12`: "completion and blockers are worker reports, not
independent certification"). Nobody has solved it, so there is no experiment to
copy — the smallest honest one is: have the human name the command, run it
unmodified, and let the loop end only on its exit code.

**That paragraph used to say every "measured" number here is an assertion, and it
is no longer true of all of them.** `package.json`'s `check` is
`lint && test && smoke && toolchain`, and `smoke` composes the build, so it is
five steps: `biome`, `bun test --isolate ./test`, `next build`,
`scripts/smoke.js`, which boots the export in headless Chrome and runs a command
in the real guest, and `scripts/wasm/toolchain-check.js`, which boots three more
and makes them run Python. So the boot cost, the guest's own `uname` line and the exit
status are re-derived by anyone who types `bun run check`, and this wave's run
printed `the real guest answered "Linux localhost 6.1.0 …" in 1517ms cold, then a
failing command in 1056ms warm (exit 1); 52602121 bytes fetched, inflated to
143205983`. `check` has grown two steps since that sentence was written and is
now `lint && test && smoke && toolchain`. There are **43** test files
(`find test -name '*.test.js' | wc -l`) and **671 pass / 0 fail / 1,856
expects** (accountant's own `bun run check`, 2026-09-01, on the five-file tree
this wave's report is about — the 667/1,840 that stood here was true one wave
ago and this file's own rule is that a pass count is a timestamp); there is still no third-party browser driver
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
