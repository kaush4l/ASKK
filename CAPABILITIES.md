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
   wired — `identity` renders empty because `buildAgent` passes `system` and
   never `soul` (`loadAgent.js:86` against `Engine.js:33`), `TokenScale` has zero
   call sites outside its own test (`grep -rn TokenScale src` → one file, its own
   definition), multimodal is unreachable because both `run` sites pass no
   images — `ChatService.js:145` and `agentWorker.js:73` both call `run(...)`
   with none, against the parameter at `Engine.js:210` `multimodal = []` —
   sub-agents are never constructed because `peers` is always empty
   (`ChatService.js:116` `const peers = …`, and `agents/` holds one directory),
   sub-agents get `tools: []` (`agentWorker.js:59`), `AgentWorkerPool.terminate`
   has no caller (`:124`; `grep -rn "pool.terminate" src` → no matches), and the
   sandbox is off unless a build-time variable is set (`next.config.js`
   `NEXT_PUBLIC_SANDBOX_IMAGE` defaults to `''`). A status column without
   evidence beside it would have called all of them `have`.

   Two entries that used to be on that list are **not** defects of the code and
   have been corrected: `HttpTransport` *does* have a caller — `discover.js:29-30`
   constructs it whenever a server declares `url` — and `SimpleResponse` *is*
   selectable — `response/index.js:6` through `AgentSpec.js:139`
   `if (!RESPONSE_MODELS[response])`. What is dead in both cases is the
   **configuration**: no agent file declares a `url:` server or
   a `response: simple`. A dead configuration and a dead code path fail
   differently and need different fixes, so they are no longer counted together.
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
          `api.firecrawl.dev`, `huggingface.co` at `SupertonicSpeaker.js:35`),
          and `github.com` is a comment in `public/sandbox/wasi-util.js:5`
        → costs it ONE thing today: `composition.js:93` re-probes a failed
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
`ENOTSUP` (`vm-worker.js:93-98`). Evidence:
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
| Run the loop | agent-zero `agent.py:391` | a module worker | have | have | unverified | — | `ReActEngine.js:116` `while (true)` |
| Bound it | — | a budget, and one sentence about it | have | have | have | — | `Budget.js` renders `# BUDGET` ONLY on the turn that has no room left — the running counters it used to print were measured against an arm without them (n=8, same distribution), cost 30 tokens a turn at `cached_tokens: 0`, and were cut; `AgentSpec.js` parses the terms and refuses `"250k"` rather than reading 250 off the front of it; the hard stop quotes what the last turn wrote instead of an answer — a note, never a truncation |
| Cancel it | MCP spec `cancellation.mdx` | to the open request | have | have | have | — | a signal cannot be structured-cloned, so `Envelope.js:129` `calls.cancel` names the call instead; `Kernel.js:90` holds one controller per request; `Inference.js:168` `_either` combines it with the deadline so it reaches `fetch`; `page.jsx:606` is the button |
| Terminate a runaway thread | — | a method with no caller | absent | absent | absent | — | `AgentWorkerPool.js:124` — `grep -rn "pool.terminate" src` → no matches |
| Approve an action mid-loop | — | nothing | absent | absent | absent | — | none |

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
| Run a command | pi `env/nodejs.ts:145` (the one `spawn`), `:230` (`/bin/bash`) | c2w Alpine in wasm | degraded | degraded | unverified | — | `C2wSandbox.js:144`. One boot per command, measured under isolation at 107 ms to fetch+compile and 887 ms to instantiate, boot the guest and run `uname -a` (`scripts/probe/results/2026-09-01-pty.md`, oneshot). **The ~100x was wrong.** Against the identical busybox 1.37.0 in `docker run --rm alpine:3.21`, on the same bytes (both sides print sha256 `2daeb1f3…`): `awk` 1e6 loop 85,930 ms vs 0.24 s = **358x**; `sha256sum` 8 MB 9,700 ms vs 0.02 s = **485x**; `gzip -c` 8 MB 7,661 ms vs 0.03 s = **255x**. Disclosed caveat, because it flatters the guest and nobody had said it: the guest is `x86_64` and the native control ran `aarch64` |
| An interactive session | agent-zero `tty_session.py:259` | none | absent | absent | unverified | — | **the browser can; we have not built it.** One guest booted with blocking stdin two realms down reached its prompt in 3,826 ms and then answered ten commands at 106–120 ms each with the boot never re-paid — about **7.5x cheaper per command** than re-paying the 887 ms one-shot, and the saving does not decay (`scripts/probe/results/2026-09-01T06-53-06-isolation+model+pty.md` and `scripts/probe/results/2026-09-01-pty.md`). The tree still has none: `C2wSandbox.js:144` runs one command per instance |
| Keep a file between calls | pi `harness/types.ts:315` | none | absent | absent | unverified | — | **within one boot the browser can; across a reload nobody can.** `echo hello > /tmp/a` then `cat /tmp/a` → `hello`, then `ls -la /tmp` → `-rw-r--r-- 1 root root 6 … a`. After `page.reload()` in the same tab: `cat: can't open '/tmp/a': No such file or directory`, `RC=1`, `/tmp` empty, and the 3,821 ms boot paid again. The store is a RAM overlay — `overlay 56.3M`, `upperdir=/run/rootfs-upper`, inside the guest's `Mem: 115244` KB — so it is capped at 56 MB and competes with the workload. The tree still has none: `C2wSandbox.js:30-33`, one instance per command by construction (`scripts/probe/results/2026-09-01T06-53-06-isolation+model+pty.md`) |
| Command length | — | 1024 bytes | degraded | degraded | degraded | — | `C2wSandbox.js:18`, `:149-152`; c2w's fixed entrypoint channel, unrelated to isolation. **A live shell does not remove this, it doubles it and makes it silent**: binary-searched, a line of 2,047 bytes including the newline runs and one of 2,048 vanishes with no error and no partial execution — reproduced in two separate runs. That silence is worse than the 1024-byte cap, which at least says `the command is N bytes and the sandbox accepts at most 1024`. It bit this probe: the install stage first sent an unwrapped base64 blob as one 40,424-byte line and got `base64: truncated input`, a wrong md5 and `BAD archive` (`scripts/probe/results/2026-09-01T07-28-08-pty.md`); wrapped at 76 columns it installs. A heredoc has no cap — 11,889 bytes over 400 lines written and executed |
| Install software into the guest | — | bake it into the image | absent | absent | unverified | — | C5 used to bar this and **that clause is measured false**. A 30,316-byte `tree-2.2.1-r0.apk` delivered over the tty as base64 at 2.52 KB/s arrived with its host md5 intact (`c1580b7f3775e59960109e0d41154729`), and `apk add --allow-untrusted` printed `(1/1) Installing tree` / `OK: 7 MiB in 16 packages`: the guest went 15 → 16 packages, `apk info -e tree` from absent to present, `/usr/bin/tree` from a 12-byte busybox symlink to a 65,072-byte binary that reports `tree v2.2.1`. From a *repository* it still fails, on C2 rather than C5 — `eth0` is `qdisc noop state DOWN`, `/etc/resolv.conf` is empty, every WASI socket is stubbed `ENOTSUP` (`vm-worker.js:93-98`). It also dies with the tab: the package lives in the 56 MB RAM overlay (`scripts/probe/results/2026-09-01-pty.md`) |
| Network from inside the guest | — | none | absent | absent | absent | C2 | `vm-worker.js:93-98` — every WASI socket stubbed `ENOTSUP`; a page has no raw socket, so any guest network is a `fetch` bridge and inherits C2 |
| Choose where it runs | elizaOS `shell-execution-router.ts:493` | one, in the tab | barred | barred | barred | C4 | none |
| Drive a GUI | agent-zero `supervisord.conf` | none | barred | barred | barred | C2 | `vm-worker.js:93-98` — a display server needs a socket the guest does not have |

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

Four things the port would have to handle that the current design does not: a
pty returns no exit code, prompt detection becomes load-bearing, the transcript
is a terminal rather than a stream, and the backend worker becomes the guest's
scheduler at 8,803 `postMessage` + `Atomics` round-trips for a three-command
session. They are §5.3d.

### Building software

The section the previous draft did not have, and the one the sharpened goal is
made of. Every row here is `absent` or worse, and only two of them have a
browser reason.

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| A filesystem the agent and the human both see | pi `harness/types.ts:315` + `env/nodejs.ts` | none | absent | absent | absent | — | `grep -rni "opfs\|getDirectory\|FileSystemHandle" src public scripts` → one prose comment, `Repository.js:8`; `Sandbox.js:30` is `run()` and nothing else |
| Files that survive a reload | bolt.diy `useChatHistory.ts:308` | conversations and settings only | degraded | degraded | unverified | — | `composition.js:18-19` — two store names, neither of them files |
| A language runtime that is not emulated | — | none | absent | absent | absent | — | `package.json` dependencies: four, none of them a runtime; the only execution path in the tree is `C2wSandbox.js:144` |
| Run a test suite | — | none | absent | absent | absent | — | as above; `package.json` `test: bun test` is the repo's own gate, not a tool the agent can call |
| A formatter | — | none | absent | absent | absent | — | `@biomejs/biome` is a devDependency of this repo, not something the agent can call; `BUILTIN_TOOLS` is `shell`, `fetch`, `search` (`tools/index.js:24-31`) |
| A linter | — | none | absent | absent | absent | — | as above |
| Version control the agent can commit to | — | none | absent | absent | absent | — | `grep -rn "isomorphic-git" src package.json` → no matches; the seven hits for `git` in `src` are `GitHub`, `digit` and `legitimate` |
| Push a commit to a remote | — | none | barred | barred | barred | C2 | github.com's git transport answers `Failed to fetch` from a page (`docs/MINING.md:46-48`); `api.github.com` sends ACAO `*` and is the only server-free write path, and is unbuilt |
| A diff the human can read | bolt.diy `DiffView.tsx` | none | absent | absent | absent | — | `grep -rniw "diff" src` → no matches; the 60 hits for the substring are `different` and `difference` |
| Snapshot the workspace and rewind to a message | bolt.diy `useChatHistory.ts:308`, `:79-82` | none | absent | absent | absent | — | `composition.js:18-19` — no third store |
| A native compiler toolchain | — | none | barred | barred | barred | C5 | `docs/MINING.md:46` — no browser answer measured for one |

**Eight of these eleven rows are `absent`, which means nothing in the browser
stops them.** That is now the largest and most actionable hole in the document.
One is `degraded` and two are `barred` — and neither of the two is barred for a
reason that has anything to do with isolation.

### Choosing how to work

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| More than one loop to choose between | — | one | absent | absent | absent | — | `engine/index.js:6-8` — `ENGINES` has a single entry |
| The agent selects its loop by task difficulty | elizaOS `message-handler.ts:366` (binary, not graded) | none | absent | absent | absent | — | `loadAgent.js:83-84` — the loop comes from a file's `engine:` field, chosen before the task is read |
| A named strategy library (plan-then-execute, write-critique-improve, delegate) | deepseek `packages/workflow/tool-ralph/README.md:12` | none | absent | absent | absent | — | `engine/index.js:6-8` — one loop; `tools/index.js:24-31` — three built-in tools, none of them a strategy |
| Write → critique → apply a standard → iterate until it passes | elizaOS `planner-loop.ts:4101` | none | absent | absent | absent | — | `ReActEngine.js:235` — `observe` returns the tool's text; nothing reads a result against a standard |
| A successful edit must be followed by a passing check | elizaOS `planner-loop.ts:4310`, `:4351` | none | absent | absent | absent | — | `ReActEngine.js:186` — the run ends the moment the model says `isAnswer`, and nothing else is consulted |
| A check the agent cannot certify for itself | — (nobody ships one) | none | absent | absent | absent | — | none — and see §5, this is the load-bearing half |

Loop selection is `absent` and not `barred` on purpose: nothing in a browser
prevents it. What prevents it everywhere is that **nobody has a difficulty
signal that is not itself a model call** (`docs/MINING.md:203-207`) — which is a
cost problem, not a platform one, and belongs in a different conversation.

### Finding things out

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Search the web | — | one keyless endpoint | unverified | unverified | unverified | — | `SearchTool.js:28` `SEARCH_ENDPOINT`; registered `tools/index.js:30`; named by `agents/main/agent.md` `tools: [shell, search, fetch]`; port attached `composition.js:219`. Exercised only against a fake port (`test/core/tools/SearchTool.test.js`) — never called from a browser |
| Fetch a URL | — | one tool, capped and reduced | unverified | unverified | unverified | — | `FetchTool.js:7,10` (512 KB down, 8,000 chars shown); registered `tools/index.js:29`; same fake-port testing, same absence of a browser run |
| Know which kind of nothing came back | — | four named refusals | unverified | unverified | unverified | — | `HttpPort.js:45` `Blocked` names four; `composition.js:93` re-probes with `mode: 'no-cors'` to tell a CORS refusal from an unreachable host |
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
`composition.js:93` is a `no-cors` fetch, and a `no-cors` fetch to a host that
sends no CORP is exactly what `COEP: require-corp` blocks. Buying isolation
would make `Blocked.REFUSED` and `Blocked.UNREACHABLE` collapse into one
another for a large class of hosts — the first concrete, cited thing in this
tree that isolation would cost.

### Memory

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Durable conversation state | pi `session/types.ts:359` | IndexedDB | have | have | unverified | — | `IndexedDb.js:28` `typeof indexedDB === 'undefined'` guard, `MemoryRepository` fallback at `composition.js:187-188` |
| Semantic recall | elizaOS (pgvector, dimension-pinned) | none | absent | absent | absent | — | none |
| Cross-session recall | — | none | absent | absent | absent | — | none |
| Skills the agent writes itself | — | none | absent | absent | absent | — | none; blocked on the filesystem row above. The previous draft cited agent-zero `extension.py:347` for this; that line sorts extension classes by file and agent-zero's own skills tool is read-only (`list search load read_file`, `az/agent.system.tool.skills.md:3`), so no reference ships it |
| Storage pressure | — | eviction, unhandled | unverified | unverified | unverified | — | `grep -rn "navigator.storage" src public scripts` → no matches |

### Structure

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| A thread per agent | deepseek `child-agent.ts:199` (`applyChildComposition`, whose parent is a required parameter) | a named module worker | unverified | unverified | unverified | — | `AgentWorkerPool.js:38` — never reached; the roster is one agent (`agents/main/`, published to `public/agents/index.json`) so `peers` at `ChatService.js:116` is always `[]` |
| A fresh context per sub-agent call | pi `subagent/index.ts:300` (`--no-session`) | stateless by construction, on a reused worker | unverified | unverified | unverified | — | `agentWorker.js:68-73` builds a fresh agent per message; `AgentWorkerPool.js:33-34` reuses the thread |
| Sub-agents that receive tools | deepseek `child-agent.ts:217` (`tools.restrict`); pi `subagent/index.ts:307` (`--tools`) | **none** | absent | absent | absent | — | `agentWorker.js:59` `tools: []` |
| A depth limit for nesting | elizaOS `acp.ts:18` | enforced by giving nothing | degraded | degraded | degraded | — | `agentWorker.js:9-12` and `:59` are the same line: the limit and the tool starvation cannot be separated |
| An MCP client | deepseek `transport.ts:31` | one, run per turn | degraded | degraded | unverified | C5 | `discover.js:21` from `ChatService.js:122`; the only declared server is `mcp-disk` in the image (`agents/main/agent.md`), and `next.config.js` ships no image by default |
| An MCP server running in this tab | `@mcp-b/transports` `TabServerTransport.ts` | none | absent | absent | absent | — | `grep -rn "MessagePort\|InMemoryTransport" src` → no matches; `core/mcp/` offers exactly two transports at `discover.js:29-37` |
| An MCP client that talks over a port, not a process | MCP spec `transports/index.mdx` (Custom Transports) | none | absent | absent | absent | — | as above |
| An MCP server holding state across calls, in the guest | agent-zero `mcp_handler.py:1332` `_execute_with_session` (also stateless) | none | barred | barred | barred | C5 | `SandboxTransport.js:42` replays `initialize` ahead of every call because `C2wSandbox.js:30-33` gives it a new process |
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
| Long-running work that survives a reload | pi `session/types.ts:359` | nothing | absent | absent | absent | — | a run lives inside one `await` at `ChatService.js:145`; nothing durable is written until `:215` |
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
| Prompt inspection | — | the panel | have | have | unverified | — | `ChatService.js:159` → `EventName.PROMPT` → `page.jsx:134` |
| Cost | elizaOS `trajectories/pricing.ts` | none | absent | absent | absent | — | none |
| Traces / a run log | deepseek `client/ui-trajectory` | nothing durable | absent | absent | absent | — | `composition.js:18-19` — two store names, and neither is a run |
| Install | — | open a URL | have | have | unverified | — | `next.config.js` `output: 'export'` |
| Update | — | reload | have | have | unverified | — | — |
| Runtime licence | bolt.diy `README.md:515` (WebContainer is licensed) | none | have | have | have | — | c2w is ours to ship |
| Rebuild the environment | — | Docker + a local registry + Go, 17m37s | degraded | degraded | degraded | C5 | `scripts/wasm/build.sh:122` prints the measured 17m37s; the registry requirement is `scripts/wasm/README-UNPINNED.md:84-86` (a developer action; the platform columns describe the machine doing the build) |

### What a human sees

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Tool calls as they happen | elizaOS `task-activity-store.ts` | the call, never the result | degraded | degraded | unverified | — | `ReActEngine.js:172` emits the step before `:207` runs it; `ChatService.js:167-175` sends `{step, answer, isAnswer, thinking}` and no observation; `page.jsx:505` renders it |
| Progress on a long run | bolt.diy `ProgressCompilation.tsx` | a step counter and a token stream | degraded | degraded | unverified | — | `EventName.PROGRESS` exists at `Envelope.js:144` and is emitted only by `SpeechService.js:57`, `:138` and `:153` — never by the agent loop |
| Viewing and editing a file | bolt.diy `CodeMirrorEditor.tsx` | none | absent | absent | absent | — | `grep -rni "codemirror\|monaco" package.json src` → no matches |
| Speech in | — | 3 engines | have | have | unverified | — | `WebSpeechTranscriber.js:30` probes the constructor; wired at `page.jsx:205` `dictate()` |
| Speech out | — | 3 engines | have | have | unverified | — | `WebSpeechSpeaker.js:23`; replies are spoken at `page.jsx:178`, a message on demand at `:487` |
| Mobile layout | — | responsive | have | have | unverified | — | `globals.css:825` `@media (max-width: 60rem)` |

Both speech rows were re-checked against the new goal and both survive as
`have`: three engines each way, wired to the composer and to the reply. They
should stop being listed as ambition anywhere — the same is true of live tool
views, CodeMirror and diffs, which every reference already ships
(`docs/MINING.md:225-229`). The honest reading of this section is that the two
`degraded` rows are one event name away from `have`: the loop emits the action
and never the observation, and it has a `PROGRESS` channel it does not use.

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
  1024-byte command line.
- **There is no filesystem layer anywhere on this diagram.** Not in the page,
  not in the backend worker, not beside the guest. Eleven rows in *Building
  software* are waiting on a box that does not exist yet, and the measured
  candidate — OPFS in the backend worker — would sit exactly where "state" is.
- **"Finding things out" found an owner, and it is the backend worker.** The
  `http` port is built at `composition.js:123` and attached at `:219`, beside the
  model call, never touching the guest. The tools that use it are the first
  capability in this tree wired at the layer that already had the ability.
  The attachment is a post-construction mutation, and the previous draft said it
  was guarded by `if (chat.services)`; it is not, and the comment above it says
  why: *"Unguarded on purpose: if that record is ever renamed this throws at
  boot, where a guard would have skipped it in silence"* (`composition.js:214-219`).
  Nothing checks at boot that the two tools resolved — the previous draft cited
  a check at `:184` and there is none — so the deliberate throw is the whole
  safety net.
- **The agent worker branch is dead** and has never executed. `ARCHITECTURE.md`
  says nested module workers are verified; this ledger says the branch is never
  reached. Both are true and they are about different things — the mechanism
  works, and `ChatService.js:116` never gives it anything to do.

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

**1. Is there a filesystem in this tab at all?** Moves eight of the eleven rows
in *Building software*, plus skills-the-agent-writes, cross-session recall, snapshot/rewind,
long-running work, and the file-viewer row — every one of them is currently
waiting on the same missing box. **The experiment:** open one OPFS sync access
handle in `src/backend/worker.js`, write a file, read it back, reload the tab,
read it again, and print `navigator.storage.estimate()` beside the result. The
mining round measured 408 MB/s through one handle and an 8 GB quota
(`docs/MINING.md:42`) — in a scratch page, not in this tree, against a
`grep -rn "navigator.storage" src` that returns nothing.

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
- **3b. Does the tree's own sandbox do any of this?** It has never been asked.
  The refuter: *"No code from the tree's own application was ever loaded in a
  browser … `src/backend/sandbox/C2wSandbox.js`, `Kernel.js` and the built Next
  app in `out/` were never executed."* And the narrower one: *"no run set
  `SANDBOX_IMAGE`, rebuilt, and observed `C2wSandbox.available === true` with
  `run()` returning anything other than `UNAVAILABLE`. 'One env var fixes that'
  is a code-reading claim with zero execution behind it."* **The experiment:**
  `SANDBOX_IMAGE=<url> bun run build`, open `out/`, call the shell tool, and
  print what comes back.
- **3c. What is the store that survives, and when does it fill?** Measured to be
  a RAM overlay — `overlay 56.3M`, `upperdir=/run/rootfs-upper`, inside the
  guest's 115,244 KB of memory. Nothing reaches OPFS, so question 1 is still the
  binding one for anything that must outlive a tab. The refuter who found the
  overlay also measured its ceiling — *"A single `dd bs=1M count=60` exhausts it
  (56.3 MB written) and the next write lands 0 bytes"* — and the probe in the
  tree does not yet repeat that: its `speed` stage writes 8 MB and stops.
- **3d. What does the port cost?** Four things the spike exposed that the
  current design does not handle: a pty returns no exit code, so every call
  needs `echo $?` and a parser; prompt detection becomes load-bearing and the
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

**6. Who writes the acceptance test?** Moves one row and blocks the goal.
elizaOS enforces only that *a* check of the right family exited 0
(`planner-loop.ts:4351`); deepseek accepts the worker's own `status: complete`
(`packages/workflow/tool-ralph/README.md:12`: "completion and blockers are worker reports, not
independent certification"). Nobody has solved it, so there is no experiment to
copy — the smallest honest one is: have the human name the command, run it
unmodified, and let the loop end only on its exit code.

**Every "measured" number in this repository is still an assertion.** The 814 ms
boot, the ~100x, the 3,717→1,332 token filter, the 10 ms worst frame gap. There
are nineteen test files (`find test -name '*.test.js' | wc -l`) and they are pure unit tests of
`core/` against fakes — the three newest exercise the web tools through a stub
port and never open a socket; `package.json`'s `check` is `biome` plus `bun test`; there is no browser
check in the tree at all (`grep -rn "playwright\|puppeteer" package.json` → no
matches, and Next lists Playwright only as an optional peer). **The tests being
written right now do not cover a single number above**, and every row whose
evidence cell is a sentence rather than a command is a row this paragraph is
about.
