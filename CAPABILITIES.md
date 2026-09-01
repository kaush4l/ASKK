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
   images, sub-agents are never constructed because `peers` is always empty
   (`ChatService.js:111`, roster `public/agents/index.json`), `Engine.render()`
   has no caller (`Engine.js:163`; every path uses `plan()` at `:207`),
   sub-agents get `tools: []` (`agentWorker.js:43`), `AgentWorkerPool.terminate`
   has no caller (`:103`), and the sandbox is off unless a build-time variable
   is set (`next.config.js` `NEXT_PUBLIC_SANDBOX_IMAGE` defaults to `''`). A
   status column without evidence beside it would have called all of them
   `have`.

   Two entries that used to be on that list are **not** defects of the code and
   have been corrected: `HttpTransport` *does* have a caller — `discover.js:29-30`
   constructs it whenever a server declares `url` — and `SimpleResponse` *is*
   selectable — `response/index.js:6` through `AgentSpec.js:108`. What is dead in
   both cases is the **configuration**: no agent file declares a `url:` server or
   a `response: simple`. A dead configuration and a dead code path fail
   differently and need different fixes, so they are no longer counted together.
2. **`barred` must name a root constraint.** If it cannot, it is `absent`, and
   that is a different conversation — one about priorities rather than physics.

Evidence is a `file:line`, a probe result, or a measurement with the command
that produced it. Never prose.

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

Measured and recorded at `docs/MINING.md:5-20`. The experiment itself — a
five-file probe page plus drivers `drive.mjs` / `nested.mjs` / `bypass.mjs` /
`realmodel.mjs` — was run in a scratch directory outside this repository and is
**not in the tree**, which is the first thing question 4 in §5 is about. It ran
on `python3 -m http.server`, proven header-free by a browser-executed control on
every pass (`404 CONTROL: status=404 coep=(absent) coop=(absent)`,
`FIRST NAV: coep_on_wire=(absent)`), and independently re-executed end to end by
a second party who reproduced every load-bearing cell:

| ran | Chromium 140 | WebKit 26.0 |
|---|---|---|
| `self.crossOriginIsolated`, no SW | `false` | `false` |
| `self.crossOriginIsolated`, SW + `require-corp` | `true` | `true` |
| `new SharedArrayBuffer(8)` | `{ok:true, byteLength:8}` | `{ok:true}` |
| `Atomics.wait(ia,1,0)`, **no timeout**, in a worker | `ok`, woke after 252 ms | `ok`, 251 ms |
| the same, in a **nested** worker (page→worker→worker) | `ok`, blocked 202 ms | `ok`, 200 ms |

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
        → costs this tree's own hosts nothing: `grep -oE "https://[a-zA-Z0-9.-]+"
          -r src public/sandbox` returns four, all fetched CORS-mode
        → costs it ONE thing today: `composition.js:94` re-probes a failed
          request with `mode: 'no-cors'` to tell a CORS refusal from a dead
          host, and that is precisely the request `require-corp` blocks
        → costs the roadmap any arbitrary origin the agent decides to pull
      → the service worker joins the correctness path, not just the cache path

**What it does not cost, measured:** the model call. The real request this app
sends — a preflighted streaming `POST https://api.anthropic.com/v1/messages`
with `x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access`
and `stream: true` (`src/core/inference/AnthropicCompatible.js:56, :103-107`) — arrived
with `type:"cors"` and a readable stream under `off`, `require-corp` and
`credentialless`, in both engines. cdnjs and Google Fonts send
`cross-origin-resource-policy: cross-origin` and keep loading.

**Not measured, and each of these is a reason not to spend the price yet:**
nobody booted a pty — the primitive was measured and the pty inferred; nobody
ran any of it on `https://kaush4l.github.io/ASKK/`, on Safari.app, on iOS, or on
Firefox; nobody tested `COOP: same-origin` against a popup or OAuth flow. See §5.

**The consequence for the ledger:** rows that were `barred | C1` are not
automatically `have`. They are mostly `unverified` or `absent` now, because the
thing that made them impossible turned out not to, and nobody has built them.
That is a worse position to be in than `barred`, and an honest one.

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
running page cannot add a binary to its own guest, which is the real reason
`apk add` is impossible and the real reason an MCP server has to be baked in.

C5 is also the constraint the compiled-tools substrate dissolves rather than
improves: a tool that is a fetched wasm module is not in an image at all.

---

## 2. The ledger

### The loop

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run the loop | agent-zero `agent.py:391` | a module worker | have | have | unverified | — | `ReActEngine.js:80` `while (true)` |
| Bound it | — | a budget the agent reads | have | have | have | — | `Budget.js` renders `# BUDGET` into every prompt (`PromptTemplate.js:117` lists the block, without which it was dropped silently); `AgentSpec.js:45` declares it, `max_steps` revived as `budget.steps`; the last word at `Budget.js:205`, the hard stop at `ReActEngine.js:89` — a note, never a truncation |
| Cancel it | MCP spec `cancellation.mdx` | to the open request | have | have | have | — | a signal cannot be structured-cloned, so `Envelope.js:129` `calls.cancel` names the call instead; `Kernel.js:87` holds one controller per request; `Inference.js:117` combines it with the deadline so it reaches `fetch`; `page.jsx:614` is the button |
| Terminate a runaway thread | — | a method with no caller | absent | absent | absent | — | `AgentWorkerPool.js:103` — `grep -rn "pool.terminate" src` → no matches |
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
| Run a command | pi `tools/bash.ts:99` | c2w Alpine in wasm | degraded | degraded | unverified | — | `C2wSandbox.js:144`; the ~100x and the 814 ms are assertions — see §5 |
| An interactive session | agent-zero `tty_session.py:259` | none | unverified | unverified | unverified | — | was `barred` under the old C1; blocking `Atomics.wait` is measured available two realms deep (`docs/MINING.md:5-11`), and **no pty has been booted** |
| Keep a file between calls | pi `harness/types.ts:315` | none | unverified | unverified | unverified | — | `C2wSandbox.js:30-33` — one instance per command by construction, not by header |
| Command length | — | 1024 bytes | degraded | degraded | degraded | — | `C2wSandbox.js:18`, `:149-152`; c2w's fixed entrypoint channel, unrelated to isolation |
| Install software into the guest | — | bake it into the image | barred | barred | barred | C5 | `scripts/wasm/README-UNPINNED.md`; rebuild is Docker + a registry + Go |
| Network from inside the guest | — | none | absent | absent | absent | C2 | `vm-worker.js:93-98` — every WASI socket stubbed `ENOTSUP`; a page has no raw socket, so any guest network is a `fetch` bridge and inherits C2 |
| Choose where it runs | elizaOS `shell-execution-router.ts:493` | one, in the tab | barred | barred | barred | C4 | none |
| Drive a GUI | agent-zero `supervisord.conf` | none | barred | barred | barred | C2 | `vm-worker.js:93-98` — a display server needs a socket the guest does not have |

Three of these rows used to say `barred | C1` and none of them can any more. The
interactive session is the sharpest: its evidence cell used to read *"no
`Atomics` in tree"*, which is the tree citing its own abstinence as physics. It
is `unverified` now, which is exactly what the vocabulary is for — and the
persistence row is `unverified` for the same reason it always was, with the
suspected root removed rather than confirmed.

### Building software

The section the previous draft did not have, and the one the sharpened goal is
made of. Every row here is `absent` or worse, and only two of them have a
browser reason.

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| A filesystem the agent and the human both see | pi `harness/types.ts:315` + `env/nodejs.ts` | none | absent | absent | absent | — | `grep -rni "opfs\|getDirectory\|FileSystemHandle" src public scripts` → one prose comment, `Repository.js:8`; `Sandbox.js:30` is `run()` and nothing else |
| Files that survive a reload | bolt.diy `useChatHistory.ts:308` | conversations and settings only | degraded | degraded | unverified | — | `composition.js:15-16` — two stores, neither of them files |
| A language runtime that is not emulated | — | none | absent | absent | absent | — | `package.json` dependencies: four, none of them a runtime; the only execution path in the tree is `C2wSandbox.js:144` |
| Run a test suite | — | none | absent | absent | absent | — | as above; `package.json` `test: bun test` is the repo's own gate, not a tool the agent can call |
| A formatter | — | none | absent | absent | absent | — | `@biomejs/biome` is a devDependency of this repo, not something the agent can call; `BUILTIN_TOOLS` is `shell`, `fetch`, `search` (`tools/index.js:24-31`) |
| A linter | — | none | absent | absent | absent | — | as above |
| Version control the agent can commit to | — | none | absent | absent | absent | — | `grep -rn "isomorphic-git" src package.json` → no matches; the seven hits for `git` in `src` are `GitHub`, `digit` and `legitimate` |
| Push a commit to a remote | — | none | barred | barred | barred | C2 | github.com's git transport answers `Failed to fetch` from a page (`docs/MINING.md:43`); `api.github.com` sends ACAO `*` and is the only server-free write path, and is unbuilt |
| A diff the human can read | bolt.diy `DiffView.tsx` | none | absent | absent | absent | — | `grep -rniw "diff" src` → no matches; the 52 hits for the substring are `different` and `difference` |
| Snapshot the workspace and rewind to a message | bolt.diy `useChatHistory.ts:308`, `:79-82` | none | absent | absent | absent | — | `composition.js:15-16` — no third store |
| A native compiler toolchain | — | none | barred | barred | barred | C5 | `docs/MINING.md:43` — no browser answer measured for one |

**Eight of these eleven rows are `absent`, which means nothing in the browser
stops them.** That is now the largest and most actionable hole in the document.
One is `degraded` and two are `barred` — and neither of the two is barred for a
reason that has anything to do with isolation.

### Choosing how to work

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| More than one loop to choose between | — | one | absent | absent | absent | — | `engine/index.js:6-8` — `ENGINES` has a single entry |
| The agent selects its loop by task difficulty | elizaOS `message-handler.ts:366` (binary, not graded) | none | absent | absent | absent | — | `loadAgent.js:83-84` — the loop comes from a file's `engine:` field, chosen before the task is read |
| A named strategy library (plan-then-execute, write-critique-improve, delegate) | deepseek `tool-ralph/README.md` | none | absent | absent | absent | — | `engine/index.js:6-8` — one loop; `tools/index.js:24-31` — three built-in tools, none of them a strategy |
| Write → critique → apply a standard → iterate until it passes | elizaOS `planner-loop.ts:4101` | none | absent | absent | absent | — | `ReActEngine.js:91` — `observe` returns the tool's text; nothing reads a result against a standard |
| A successful edit must be followed by a passing check | elizaOS `planner-loop.ts:4310`, `:4351` | none | absent | absent | absent | — | `ChatService.js:137-163` — the run ends when the model says `isAnswer` |
| A check the agent cannot certify for itself | — (nobody ships one) | none | absent | absent | absent | — | none — and see §5, this is the load-bearing half |

Loop selection is `absent` and not `barred` on purpose: nothing in a browser
prevents it. What prevents it everywhere is that **nobody has a difficulty
signal that is not itself a model call** (`docs/MINING.md:180-182`) — which is a
cost problem, not a platform one, and belongs in a different conversation.

### Finding things out

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Search the web | — | one keyless endpoint | unverified | unverified | unverified | — | `SearchTool.js:24` `ENDPOINT`; registered `tools/index.js:30`; named by `agents/main/agent.md` `tools: [shell, search, fetch]`; port attached `composition.js:167`. Exercised only against a fake port (`test/core/tools/SearchTool.test.js`) — never called from a browser |
| Fetch a URL | — | one tool, capped and reduced | unverified | unverified | unverified | — | `FetchTool.js:7,10` (512 KB down, 8,000 chars shown); registered `tools/index.js:29`; same fake-port testing, same absence of a browser run |
| Know which kind of nothing came back | — | four named refusals | unverified | unverified | unverified | — | `HttpPort.js` `Blocked`; `composition.js:94` re-probes with `mode: 'no-cors'` to tell a CORS refusal from an unreachable host |
| Reach a CORS-less origin | — | none, and it is named | barred | barred | barred | C2 | `HttpPort.js` `Blocked.REFUSED`; a page has permission, not reach |
| The tools are actually attached | — | checked at boot | have | have | unverified | — | `composition.js:184` resolves `fetch` and `search` exactly as an agent file does and counts the ones reporting `available` |
| Remote model | — | OpenAI/Anthropic-shaped | have | have | unverified | — | `AnthropicCompatible.js:56` (the streaming POST), `:103-107` (the headers); the preflight returns 200 with ACAO `*` once `anthropic-dangerous-direct-browser-access` is sent, measured in Chromium and WebKit under three COEP modes |
| Local model weights | — | transformers.js | degraded | degraded | unverified | — | 22.5 MB ORT wasm, single-threaded; threading needs isolation, which C1 now says is purchasable at the price above |
| Embeddings | elizaOS (pgvector) | none | absent | absent | absent | — | none |

**This was the largest hole in the previous draft and it closed while this one
was being written** — `search`, `fetch` and an `HttpPort` seam landed
uncommitted (`git status --short` lists `src/core/tools/SearchTool.js`,
`FetchTool.js`, `HttpPort.js`, `readable.js` as untracked). None of the three
rows is `have`, because a tool that has only been run against a stub is a tool
whose endpoint has never answered: `browserHttp` at `composition.js:80` has no
test, by its own design (`HttpPort.js:5-11` says so). The endpoint choice cites
a probe at `SearchTool.js:6-23` and names `docs/CORS-PROBE.md` as where the
header blocks live; `ls docs/` returns `LEDGER.md MINING.md
REFERENCE-PROMPTS.md`, so that citation does not currently resolve.

The remote-model row moved from `degraded` to `have` because the header the
previous draft said we never send is at `AnthropicCompatible.js:107` and was
measured working.

**One row here is now coupled to C1's price.** The refusal-classifier at
`composition.js:94` is a `no-cors` fetch, and a `no-cors` fetch to a host that
sends no CORP is exactly what `COEP: require-corp` blocks. Buying isolation
would make `Blocked.REFUSED` and `Blocked.UNREACHABLE` collapse into one
another for a large class of hosts — the first concrete, cited thing in this
tree that isolation would cost.

### Memory

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Durable conversation state | pi `session/types.ts:359` | IndexedDB | have | have | unverified | — | `IndexedDb.js:29` guard, `MemoryRepository` fallback, `composition.js:33-37` |
| Semantic recall | elizaOS (pgvector, dimension-pinned) | none | absent | absent | absent | — | none |
| Cross-session recall | — | none | absent | absent | absent | — | none |
| Skills the agent writes itself | agent-zero `extension.py:347` | none | absent | absent | absent | — | none; blocked on the filesystem row above |
| Storage pressure | — | eviction, unhandled | unverified | unverified | unverified | — | `grep -rn "navigator.storage" src public scripts` → no matches |

### Structure

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| A thread per agent | deepseek `child-agent.ts:199` | a named module worker | unverified | unverified | unverified | — | `AgentWorkerPool.js:38` — never reached; roster is `["main"]` (`public/agents/index.json`) so `peers` at `ChatService.js:111` is always `[]` |
| A fresh context per sub-agent call | pi `subagent/index.ts:300` (`--no-session`) | stateless by construction, on a reused worker | unverified | unverified | unverified | — | `agentWorker.js:52-55` builds a fresh agent per message; `AgentWorkerPool.js:33-34` reuses the thread |
| Sub-agents that receive tools | deepseek `child-agent.ts:199`; pi `subagent/index.ts:307` | **none** | absent | absent | absent | — | `agentWorker.js:43` `tools: []` |
| A depth limit for nesting | elizaOS `acp.ts:18` | enforced by giving nothing | degraded | degraded | degraded | — | `agentWorker.js:9-12` and `:43` are the same line: the limit and the tool starvation cannot be separated |
| An MCP client | deepseek `transport.ts:31` | one, run per turn | degraded | degraded | unverified | C5 | `discover.js:21` from `ChatService.js:117`; the only declared server is `mcp-disk` in the image (`agents/main/agent.md`), and `next.config.js` ships no image by default |
| An MCP server running in this tab | `@mcp-b/transports` `TabServerTransport.ts` | none | absent | absent | absent | — | `grep -rn "MessagePort\|InMemoryTransport" src` → no matches; `core/mcp/` offers exactly two transports at `discover.js:29-37` |
| An MCP client that talks over a port, not a process | MCP spec `transports/index.mdx` (Custom Transports) | none | absent | absent | absent | — | as above |
| An MCP server holding state across calls, in the guest | agent-zero `mcp_handler.py:1331` (also stateless) | none | barred | barred | barred | C5 | `SandboxTransport.js:88` replays `initialize` every call because `C2wSandbox.js:30-33` gives it a new process |
| An MCP server holding state across calls, in this tab | — | none | absent | absent | absent | — | no in-tab server exists to hold anything |
| A remote MCP server over HTTP | bolt.diy `mcpService.ts:219` | code, no configuration | degraded | degraded | unverified | C2 | `discover.js:29-30` constructs `HttpTransport` for any server declaring `url`; no agent file declares one, and it needs CORS — ~23% of a 200-server sample answered a preflight from our origin (`docs/MINING.md:207-210`) |
| Secrets | — | plaintext in IndexedDB | degraded | degraded | unverified | — | `SettingsService.js:23` |

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
| Scheduled work that catches up when the tab next opens | deepseek `schedule/README.md` | nothing | absent | absent | absent | — | `grep -rn "cron\|setInterval\|schedule" src` → no matches. Split out of the row below: deepseek had a host process available and chose these semantics anyway (`docs/MINING.md:175-177`) |
| Cron the human can write | agent-zero `job_loop.py:33` | nothing | absent | absent | absent | — | as above — a schedule is a record and a tick, and C3 bars neither |
| Long-running work that survives a reload | pi `session/types.ts:359` | nothing | absent | absent | absent | — | a run lives inside one `await` at `ChatService.js:137`; nothing durable is written until `:187` |
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
| Token accounting | elizaOS `trajectories/pricing.ts` | streamed, shown | degraded | degraded | unverified | — | `page.jsx:648` — a `0` renders nothing, so "not cached" is invisible |
| Prompt inspection | — | the panel | have | have | unverified | — | `ChatService.js:146` → `EventName.PROMPT` → `page.jsx:130` |
| Cost | elizaOS `trajectories/pricing.ts` | none | absent | absent | absent | — | none |
| Traces / a run log | deepseek `client/ui-trajectory` | nothing durable | absent | absent | absent | — | `composition.js:15-16` — no store for a run |
| Install | bolt.diy `README.md:515` | open a URL | have | have | unverified | — | `next.config.js` `output: 'export'` |
| Update | — | reload | have | have | unverified | — | — |
| Runtime licence | bolt.diy `README.md:515` (WebContainer is licensed) | none | have | have | have | — | c2w is ours to ship |
| Rebuild the environment | — | Docker + a local registry + Go, 17m37s | degraded | degraded | degraded | C5 | `scripts/wasm/README-UNPINNED.md` (a developer action; the platform columns describe the machine doing the build) |

### What a human sees

| Capability | Reference | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Tool calls as they happen | elizaOS `task-activity-store.ts` | the call, never the result | degraded | degraded | unverified | — | `ReActEngine.js:67` emits the step before `:78` runs it; `ChatService.js:156` sends `{step, answer, isAnswer, thinking}` and no observation; `page.jsx:490-497` renders it |
| Progress on a long run | bolt.diy `ProgressCompilation.tsx` | a step counter and a token stream | degraded | degraded | unverified | — | `EventName.PROGRESS` exists at `Envelope.js:128` and is emitted only by `SpeechService.js:57` — never by the agent loop |
| Viewing and editing a file | bolt.diy `CodeMirrorEditor.tsx` | none | absent | absent | absent | — | `grep -rni "codemirror\|monaco" package.json src` → no matches |
| Speech in | — | 3 engines | have | have | unverified | — | `WebSpeechTranscriber.js:30` probes the constructor; wired at `page.jsx:190` |
| Speech out | — | 3 engines | have | have | unverified | — | `WebSpeechSpeaker.js:23`; replies are spoken at `page.jsx:168`, a message on demand at `:472` |
| Mobile layout | — | responsive | have | have | unverified | — | `globals.css:825` `@media (max-width: 60rem)` |

Both speech rows were re-checked against the new goal and both survive as
`have`: three engines each way, wired to the composer and to the reply. They
should stop being listed as ambition anywhere — the same is true of live tool
views, CodeMirror and diffs, which every reference already ships
(`docs/MINING.md:199-203`). The honest reading of this section is that the two
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
  `http` port is built at `composition.js:80` and attached at `:167`, beside the
  model call, never touching the guest. The tools that use it are the first
  capability in this tree wired at the layer that already had the ability —
  and the attachment is a post-construction mutation guarded by
  `if (chat.services)` (`composition.js:165-167`), which is the shape of the
  defect rule 1 exists to catch, caught this time by the check at `:184`.
- **The agent worker branch is dead** and has never executed. `ARCHITECTURE.md`
  says nested module workers are verified; this ledger says the branch is never
  reached. Both are true and they are about different things — the mechanism
  works, and `ChatService.js:111` never gives it anything to do.

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
  command so `grep` cannot be passed off as proof (`:4351`), added after the
  ~5,000 tokens of prose policy failed in production (`message-handler.ts:374`).
  It is the only working answer anywhere to *improve until it passes*.
- **pi** (column 3) — establishes that a host dependency can be **quarantined and
  the quarantine enforced**: one `FileSystem` + `Shell` seam
  (`harness/types.ts:315`), a single implementation file (`env/nodejs.ts`), and a
  build that fails on a leaked import (`scripts/check-browser-smoke.mjs`). It is
  the only mechanism cited anywhere that would have caught this tree's
  declared-but-never-wired list in rule 1 above.
- **bolt.diy** (column 4) — establishes both halves of the client-only bet: that
  the model works, and its price. WebContainer needs cross-origin isolation,
  Chromium, and a commercial licence (`README.md:515`) — and it ships the human
  side we do not have at all, CodeMirror 6, a diff view, and a filesystem
  snapshot keyed to a message id (`useChatHistory.ts:308`).
- **deepseek-harness** (column 5) — establishes two things: a sub-agent's tool
  set is a **required parameter of its construction** with inheritance declared
  as a boolean (`child-agent.ts:199`), and that scheduled work with no live
  session stays *overdue* rather than lost (`schedule/README.md`) — which it
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
(`docs/MINING.md:39`) — in a scratch page, not in this tree, against a
`grep -rn "navigator.storage" src` that returns nothing.

**2. Does a compiled tool run in the backend worker with no isolation?** Moves
the language-runtime, test-suite, formatter, linter and version-control rows, and
would demote the whole c2w column of the environment table from *the environment*
to *one tool*. **The experiment:** load one of `esbuild-wasm`,
`@biomejs/wasm-web` or Pyodide inside `src/backend/worker.js`, run a real
invocation, and assert `SharedArrayBuffer === undefined` in the same console
line as the result. Nineteen candidate binaries were surveyed and exactly one
declares shared memory (`docs/MINING.md:30-34`); none of that ran here.

**3. Does a pty actually boot?** Moves the interactive-session row, the
keep-a-file row, the command-length row, and the in-guest MCP state row — and it
is the only one of these questions whose answer requires paying C1's price.
**The experiment:** register a coi-serviceworker, wire `xterm-pty`'s
`workerTools.js` to `fd_read(0)` in `public/sandbox/vm-worker.js:134`, and run
two commands in one boot where the second reads a file the first wrote. The
primitive is measured; the pty is inferred, and inference is not a status in this
document. Note that the ~100 MB module fetch must stay CORS-mode under
`require-corp` — it already is (`vm-worker.js:44` is a plain `fetch`), untested
under isolation.

**4. Does any of C1's measurement survive the real deploy?** Moves the Chr / Saf
/ iOS columns of everything question 3 touches, plus local model weights.
Everything was measured on `127.0.0.1`, which is a secure-context exemption, and
in a five-file probe page — never on `https://kaush4l.github.io/ASKK/`, never
against this tree's Next static export, and never against a service-worker
update cycle behind Pages' `max-age=600`. **The experiment:** deploy
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
(`tool-ralph/README.md`: "completion and blockers are worker reports, not
independent certification"). Nobody has solved it, so there is no experiment to
copy — the smallest honest one is: have the human name the command, run it
unmodified, and let the loop end only on its exit code.

**Every "measured" number in this repository is still an assertion.** The 814 ms
boot, the ~100x, the 3,717→1,332 token filter, the 10 ms worst frame gap. There
are twelve test files (`ls test/**/*.test.js`) and they are pure unit tests of
`core/` against fakes — the three newest exercise the web tools through a stub
port and never open a socket; `package.json`'s `check` is `biome` plus `bun test`; there is no browser
check in the tree at all (`grep -rn "playwright\|puppeteer" package.json` → no
matches, and Next lists Playwright only as an optional peer). **The tests being
written right now do not cover a single number above**, and every row whose
evidence cell is a sentence rather than a command is a row this paragraph is
about.
