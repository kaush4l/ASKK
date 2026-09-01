# Capabilities

What an agent needs, what the browser gives us instead, and how we know.

## How to read this

The bar is not "a web app with a chat box". It is **the agent has its own
environment and can do things in it** — the thing Hermes gives its agent with a
host machine, delivered with bolt.diy's deployment model, which is a static page
and nothing else. Every row is measured against that.

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
   Not a judgement call. This tree has nine capabilities that were declared and
   never wired — `identity` renders empty because `soul` is never passed,
   `TokenScale` has zero call sites, multimodal is unreachable because both
   `run` sites pass no images, sub-agents are never constructed because `peers`
   is always empty, `HttpTransport` has no caller, `SimpleResponse` is never
   selected, `Engine.render()` is never called, sub-agents get `tools: []`, and
   the sandbox is off unless a build-time variable is set. A status column
   without evidence beside it would have called all nine `have`.
2. **`barred` must name a root constraint.** If it cannot, it is `absent`, and
   that is a different conversation — one about priorities rather than physics.

Evidence is a `file:line`, a probe result, or a measurement with the command
that produced it. Never prose.

`Chr` is Chrome on a desktop. `Saf` is Safari on macOS. `iOS` is Safari on
iPhone — **the column we cannot measure from a development machine**, so it is
`unverified` almost everywhere until the probe in §5 is run on a real device.
That is the rule working, not the document being unfinished.

---

## 1. Root constraints

Four. Almost every limit below descends from one of them, and a row that says
`barred` points here rather than re-arguing.

### C1 — a static host cannot set COOP/COEP

This is the big one, and it is a **fork we chose**, not a wall we hit.

    no cross-origin isolation
      → no SharedArrayBuffer
        → no Atomics.wait
          → no blocking stdin
            → no pty, no interactive process
              → one boot runs one command
                → the guest filesystem is discarded between calls
                → an MCP server cannot hold state across calls
              → every call re-pays boot, at ~100x native
                → the leanest MCP wrapper is no wrapper (mcp-disk is POSIX sh)

bolt.diy took the other branch. Its execution substrate is WebContainer, which
**requires** SharedArrayBuffer and cross-origin isolation, runs only in
Chromium-based browsers, and needs a commercial licence for for-profit
production use. That branch buys a real Node filesystem and a real terminal.

Our branch buys: any browser, any static host, no licence, no headers. It pays
~100x and no persistent shell. Both are defensible. Ours is the one that can be
opened on a phone from a URL, which is the goal.

**Not everything below C1 is settled.** The chain to "no pty" is solid. The
chain to "the filesystem is discarded" is *mechanism*, not law — it is about
what the WASI layer hands the emulator as its disk and whether that can be
backed by OPFS or IndexedDB and reattached on the next boot. Nobody has tried.
See §5.

### C2 — same-origin policy

The agent can only reach a server that chooses to send CORS headers. This, not
the guest's lack of network, is what actually bounds *"can the agent find
things out"*. A page has `fetch`; it does not have permission.

### C3 — the tab is the process

There is no daemon. Nothing runs when the tab is closed, and on a phone,
nothing runs when the tab is merely backgrounded. Every capability whose whole
point is happening while the user is elsewhere descends from this.

### C4 — no server means no rendezvous

Two devices cannot meet without something in the middle. Sync, identity,
multi-user and being-reachable all descend from this one. There is no
arrangement of client-only code that avoids it; there are only choices about
*whose* middle, and whether it can read the data.

---

## 2. The ledger

### The loop

| Capability | Hermes gives its agent | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run the loop | a process | a module worker | have | have | unverified | — | `ReActEngine.js:51` `while (true)` |
| Bound it | max turns, budget | nothing | absent | absent | absent | — | `ReActEngine.js:51`; `AgentSpec.js:59` records `max_steps` as retired |
| Cancel it | Ctrl-C | nothing | absent | absent | absent | — | no abort in `BackendClient.call`; `page.jsx` sets `busy` only |
| Approve an action mid-loop | command approval, DM pairing | nothing | absent | absent | absent | — | none |

The loop is unbounded **and** uncancellable at the same time, which is worse
than either alone: an agent that alternates between two different tool calls
runs until the endpoint fails, and the only way to stop it is to close the tab.

### The environment

| Capability | Hermes gives its agent | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run a command | a shell | c2w Alpine in wasm | degraded | degraded | unverified | C1 | `C2wSandbox.js:144`; ~100x, unverified |
| An interactive session | a pty | none | barred | barred | barred | C1 | no `Atomics` in tree |
| Keep a file between calls | a home directory | none | unverified | unverified | unverified | C1? | none — see §5, **the open question** |
| Command length | unbounded | 1024 bytes | degraded | degraded | degraded | C1 | `C2wSandbox.js:18` |
| Install software | `apk add` | bake it into the image | barred | barred | barred | C1 | image rebuild needs Docker + a registry |
| Network from inside | full | none | barred | barred | barred | C1 | every WASI socket stubbed `ENOTSUP`, `vm-worker.js:94` |
| Choose where it runs | 7 backends: local, Docker, SSH, Modal, … | one, in the tab | barred | barred | barred | C4 | none |
| Drive a GUI | XFCE desktop, browser, LibreOffice | none | barred | barred | barred | C1 | none |

The persistence row is `unverified` rather than `barred`, and the difference
is the whole point of the vocabulary: nobody has established that it cannot be
done. `C1?` marks a root cause that is suspected and not demonstrated. It is the
one row whose answer moves the most others.

### Finding things out

| Capability | Hermes gives its agent | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Search the web | a search tool | **nothing** | absent | absent | absent | — | `tools/index.js:22` — `BUILTIN_TOOLS` has one entry |
| Fetch a URL | a fetch tool | **nothing** | absent | absent | absent | — | as above |
| Reach a CORS-less origin | any | none | barred | barred | barred | C2 | `HttpTransport.js` hint |
| Remote model | any provider | OpenAI/Anthropic-shaped | degraded | degraded | unverified | C2 | `OpenAICompatible.js`; Anthropic needs a header we never send |
| Local model weights | optional | transformers.js | degraded | degraded | unverified | C1 | 22.5 MB ORT wasm, single-threaded without isolation |
| Embeddings | pgvector + an embedding model | none | absent | absent | absent | — | none |

**This is the largest hole in the document, and none of it is the browser's
fault.** The agent has no way to obtain a single fact from outside the
conversation. `fetch` works fine in the worker; we simply never built a tool.

### Memory

| Capability | Hermes gives its agent | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Durable conversation state | SQLite + FTS5 | IndexedDB | have | have | unverified | — | `IndexedDb.js:28` guard, `MemoryRepository` fallback |
| Semantic recall | pgvector, dimension-pinned | none | absent | absent | absent | — | none |
| Cross-session recall | LLM-summarised session search | none | absent | absent | absent | — | none |
| Skills the agent writes itself | `~/.hermes/skills/` | none | absent | absent | absent | — | none; blocked on the persistence row |
| Storage pressure | disk | eviction, unhandled | unverified | unverified | unverified | — | zero `navigator.storage` calls in tree |

### Structure

| Capability | Hermes gives its agent | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Sub-agents | isolated subagents | nested module workers | unverified | unverified | unverified | — | `AgentWorkerPool.js:38` — never reached; roster is `["main"]` so `peers` is always `[]` |
| Sub-agent tools | full | **none** | absent | absent | absent | — | `agentWorker.js:43` `tools: []` |
| MCP servers | any | in the guest, or HTTP+CORS | degraded | degraded | unverified | C1, C2 | `SandboxTransport.js`; stateless, one process per call |
| Secrets | a keyring | plaintext in IndexedDB | degraded | degraded | unverified | — | `SettingsService.js:23` |

### Presence

| Capability | Hermes gives its agent | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Run when the user is away | a gateway process | nothing | barred | barred | barred | C3 | none |
| Scheduled work | built-in cron | nothing | barred | barred | barred | C3 | none |
| Be reachable from outside | binds a port, tunnels | nothing | barred | barred | barred | C4 | none |
| Messaging connectors | Telegram, Discord, Slack, … | none | barred | barred | barred | C4 | none |
| Two tabs at once | one process | both drive the same DB | absent | absent | absent | — | zero `navigator.locks` in tree |
| Sync across devices | server-side state | none | absent | absent | absent | C4 | none — **sub-project C** |
| Identity / multi-user | accounts | none | absent | absent | absent | C4 | none |

Presence is where the two models diverge hardest. Hermes solves *"work from
your phone"* by putting the agent on a VM you talk to. We are putting the agent
on the phone. Under C3 and C4, ours cannot answer *"do this while I sleep"* at
all — and that is a real capability we are trading away, not one we are
deferring.

### Operations

| Capability | Hermes gives its agent | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Token accounting | provider usage | streamed, shown | degraded | degraded | unverified | — | `page.jsx:648` — a `0` renders nothing, so "not cached" is invisible |
| Prompt inspection | — | the panel | have | have | unverified | — | `PromptTemplate.assemble` → `EventName.PROMPT` |
| Cost | per-call cost | none | absent | absent | absent | — | none |
| Traces / a run log | session history | nothing durable | absent | absent | absent | — | none |
| Install | `curl \| bash`, Docker | open a URL | have | have | unverified | — | `next.config.js` `output: 'export'` |
| Update | self-update in settings | reload | have | have | unverified | — | — |
| Runtime licence | none | none | have | have | have | — | c2w is ours to ship; contrast WebContainer |
| Rebuild the environment | `docker pull` | Docker + a local registry + Go, 17m37s | degraded | degraded | degraded | — | `scripts/wasm/README-UNPINNED.md` (a developer action; the platform columns describe the machine doing the build) |

### Human input and output

| Capability | Hermes gives its agent | Ours | Chr | Saf | iOS | Root | Evidence |
|---|---|---|---|---|---|---|---|
| Speech in | Whisper, voice channels | 3 engines | have | have | unverified | — | `WebSpeechTranscriber.js:30` probes the constructor |
| Speech out | TTS | 3 engines | have | have | unverified | — | `WebSpeechSpeaker.js:23` |
| Mobile layout | n/a | responsive | have | have | unverified | — | `globals.css` `@media (max-width: 60rem)` |

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

Three observations the diagram makes obvious:

- **The environment is the deepest thing in the tree and the least reachable.**
  Two realm hops from the page, and everything it can do has to fit through a
  1024-byte command line.
- **Nothing owns "finding things out".** A `fetch` tool would live in the
  backend worker, beside the model call, and never touch the guest at all. It is
  missing from the layer that already has the capability.
- **The agent worker branch is dead** and has never executed.

---

## 4. Calibration

What the four references establish, in one line each:

- **bolt.diy** — client-only is achievable, and its price is the C1 fork:
  SharedArrayBuffer, Chromium-only, licensed. It scopes to code, so a scratch
  filesystem that dies with the tab is enough. It is proof of the model and not
  of the ambition.
- **agent-zero** — the maximal reading of "its own environment": a Linux
  desktop, a browser, office applications, a search engine, all co-resident.
  Everything in the GUI row is barred for us under C1.
- **eliza** — memory is a schema, not a bucket: pgvector with the embedding
  dimension frozen at init. Our persistence row is nowhere near this.
- **Hermes** — the bar for what an agent's environment *is*: a home directory it
  writes skills into, memory across sessions, chosen execution backends, a cron,
  and a gateway. It also answers cross-device the opposite way, by moving the
  agent to a server.

None of the four needed anything outside this ledger's rows. Every one of them
needed at least one row the first draft did not have.

---

## 5. What is not known, and what would settle it

**The persistence question, and it comes first.** Can the guest keep a
filesystem between boots — an OPFS- or IndexedDB-backed disk handed to the
emulator through the WASI layer and reattached on the next command? If yes,
seven rows change together: files between calls, installed software, skills the
agent writes for itself, cross-session memory, multi-step work, and the
environment stops being a calculator. If no, the ceiling of this project is a
very good assistant that cannot accumulate anything, and that should be said out
loud rather than discovered later. **Nobody has tried. It is the next spike.**

**The iOS column.** Not measurable from a development machine, so it is
`unverified` nearly everywhere above. A single self-contained probe page,
shipped with the app and opened once on the device, would fill it: does a module
worker start, does IndexedDB survive, what does `navigator.storage.estimate`
report, does a 102 MiB module compile before the tab is killed, does
`AudioContext` honour a requested sample rate, is `SpeechRecognition` present.
The 102 MiB compile is the one likely to fail, and it is currently loaded with
`arrayBuffer()` and not `compileStreaming`, so two copies are live at once.

**Every "measured" number in this repository.** There is no test script and no
committed measurement artifact. The 814 ms boot, the ~100x, the 3,717→1,332
token filter — all are assertions. Each one is a row above whose evidence cell
should say "a check" and currently says a sentence.
