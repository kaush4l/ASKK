# RESIDENT — the long-running agent, the browser's reach, the shared space, and the boot path

> A ruling on an owner directive that changes a shape already designed.
> `ARCHITECTURE.md` remains the architecture of record; this file rules on four
> questions and names the increments that carry each ruling into it. Where this
> file and `ARCHITECTURE.md` disagree today, this file is the newer ruling and
> `ARCHITECTURE.md` is amended by the increment named, **not** by a reader
> reconciling them in their head.
>
> The sentence this serves: **"You open a URL. The agent is there — its
> identity, its memory, its tools, its sandbox — running in the tab."**
> The word the directive turns on is *there*, and §2 rules what makes it true.
>
> §5 is a **measurement**, and it carries the `AGENT.md` §11 header so
> `checks/stale.ts` `[1.8]` can tell you when it rots:

```
MEASURED AT: 5799940d0093d8b645bf4585f6f9b6aa8a4d69c4
SUBJECTS:    src/app/**, src/client/**, src/engine/**, next.config.ts
REPRODUCE:   bun run build && grep -ao 'new Worker(.\{0,60\}' out/_next/static/chunks/app/page-*.js
             && for f in out/_next/static/chunks/[0-9]*.js; do grep -al 'askk.writer' "$f"; done
```

> **A caveat on the artifact evidence, stated because it bit me while writing
> this.** `out/` moved twice during this pass — it currently holds a build of
> increment 3.2's in-flight worktree (its worker chunk contains a `models`
> URL, which is `engine/probe.ts`, which does not exist at `5799940`). So **no
> chunk hash is cited anywhere below.** Only shapes are cited, and each is
> re-derivable by the `REPRODUCE` line above. A hash from a directory that is
> being rebuilt underneath you is the "stale Turbopack cache" defect
> (`LESSONS.md`) wearing a measurement's clothes.

---

## The directive, verbatim

> Exactly similar to the current python project, and hermes, we might the single
> long running agent to work. Tools to support web browser, have a shared memory
> space. Thinking like a developer and debug perspective, always start with the
> first line of code to run and follow the control path.

## The four rulings, in one line each

| # | Ask | Ruling |
|---|---|---|
| 1 | A single long-running agent | **Granted as an outcome, refused as an inversion.** The resident is the **worker realm**, which already outlives every request; residency is given a named owner — `engine/turns.ts`, re-tagged `[3.3]` — that holds the `Agent`, the queue and the `AbortController` across turns and calls the turn-shaped `react()` as a subroutine. `src/core/**` does not change. |
| 2 | Tools to support the web browser | **One tool: `fetch_url`.** Reading an arbitrary web page is **not reachable** from a static page with no backend and never will be. Every named third-party search endpoint is **UNVERIFIED**; none is designed until a browser-run measurement exists. |
| 3 | A shared memory space | **A shared *state* space, not shared linear memory.** `SharedArrayBuffer` is unavailable and refused (§9). The durable half already exists and is scheduled — it is 3.4's stores, not a new mechanism. The *model-facing* board is **earned but deferred** to the increment that produces its first writer. |
| 4 | Start at the first line and follow the control path | **§5 is that trace**, `file:line`, verified, and it names the hop where it stops and the increment that continues it. |

---

## 2. Ruling 1 — the resident is the realm, not the loop

### 2.1 What the directive is actually asking for

The Python tree and Hermes both have a process you keep alive. The agent is
*there* because a daemon is there. The directive asks for that outcome. It does
**not** specify the mechanism, and the mechanism that produces it here is
different, because here there is no process to keep alive — **NORTH-STAR
consequence 1** removes it.

What is already alive in this tree, as of `5799940`:

- **The worker realm.** It is constructed once, on mount, and torn down only
  when the tab is destroyed (`worker-client.ts:75`, `page.tsx:26`).
- **A held Web Lock.** `lease.ts:44` returns a promise that never settles, so
  `askk.writer` is held for the realm's entire life — not for a callback's.
- **An installed message handler and nothing else.** `entry.worker.ts:61`.

So there is already a resident. It has one held lock, one handler, and no
identity, no memory and no tools — because nothing has been given to it yet.

**That is the whole of the gap the directive names, and it is a missing owner,
not a missing shape.**

### 2.2 The ruling: keep the turn shape, name the owner

`engine/turns.ts` — already in the `ARCHITECTURE.md` §4 file map, tagged `[3.1]`
and **not shipped** (`PROGRESS.md` 3.1 "Open") — **is the resident.** It is
re-tagged `[3.3]` and its one-line description in the file map changes from *"the
turn queue"* to:

> `engine/turns.ts  [3.3]  THE RESIDENT: owns the Agent, the transcript, the
> live AbortController and the one-turn queue, for the life of the worker
> realm. Turns are its subroutines.`

No new file. No new layer. No new increment. If the ruling had needed either,
it would have been the wrong ruling — a layer whose only job is to be
long-lived is a layer that only forwards.

### 2.3 Who owns the loop, and where control lives

Today the caller drives: `react(agent, query)` (`react.ts:56`) runs to a
declared terminal and unwinds, and its return value is a `Reply`. Under the
resident, **that does not change.** What changes is who the caller is and how
long it lives.

| | Control lives in | Held from | Held until |
|---|---|---|---|
| **Today** | `entry.worker.ts:61`'s `onmessage`, one message deep | `boot` arrives | `postMessage('ready')` |
| **Under the resident** | `engine/turns.ts` | the realm is constructed | the realm is destroyed |
| **Inside one turn** | `core/agent/react.ts:70`'s `loop`, exactly as today | `turn/start` is dispatched | the terminal outcome |

**One inversion is added, and it is named.** The resident's "take the next piece
of work" is resolved by a later `onmessage`, not by the stack that finished the
previous turn. That is the same inversion `AGENT.md` §10.1 already names for
`workerClient.request` and justifies the same way — *two realms cannot share a
stack, and a promise is the smallest thing that spans one.* It is not a new
class of inversion, and no inversion is added **inside `src/core/**`**, which is
the property that keeps the read-through test passable.

**What is refused, and why.** A resident that owns its own `while (true)` in the
core would need three things the core cannot have: a queue to await, an idle
wait, and something to wake it. Each arrives as a port, each would have exactly
one caller, and together they would put a loop with no stack owner inside the
one directory whose whole value is that it can be run to completion under
`bun test` with no browser. That is three violations of "no knob with one
caller" bought for a property the realm already provides for free.

### 2.4 Where it lives, and what the writer lock was protecting

**The lock protects the database. The resident is the only thing that writes
it.** So the resident and the lock have the same lifetime by construction, and
the `another-tab` fatal (`entry.worker.ts:55`) means exactly this:

> **A second tab has no resident.** It is not a viewer, not a read-only mirror,
> not a follower. It renders one sentence and stops.

That is a decision, not a limitation to apologise for. A read-only second tab
would need a change feed out of a database its own worker may not open, and
`ARCHITECTURE.md` §3.5 rule 4 bans `BroadcastChannel` and `SharedWorker`
outright. The honest refusal is cheaper than the merge protocol nobody reads,
and `verify-worker.ts` already drives it in a real second instance of the whole
page on every deploy.

### 2.5 What survives what — stated so the four boundaries stop being one word

| Boundary | Survives | Owner | Increment |
|---|---|---|---|
| **A turn** | the `Agent`, the `Transcript`, the config, the toolbox, the assembler memo | `engine/turns.ts`, in memory | 3.3 |
| **A session** | messages (seq-allocated), events, config, agents, `meta.activeSession` | IndexedDB, `engine/stores/*` | 3.4 |
| **A reload** | everything durable. **NOT** the in-flight turn — it reopens as a turn *labelled interrupted*, per §7.5's orphan reconciliation | IndexedDB + `session/open` | 3.4 |
| **A tab close** | the same as a reload. The Web Lock releases when the browser tears the realm down — **not** when a callback settles | the browser | shipped, 3.1 |
| **The browser profile** | **nothing.** There is no server and no export path yet | — | unscheduled |

The `Session` object (`session.ts`) is **per run and stays per run.** This is
load-bearing under the resident: `Session.seen` is the repeat guard's ledger,
and a `Session` promoted to session-lifetime would make the guard fire across
unrelated turns. A resident that reused one `Session` would ship that defect on
day one.

### 2.6 How it idles

**It does nothing at all.** No timer, no poll, no spin, no `setInterval`. An
idle resident holds one Web Lock, one IndexedDB connection and one installed
`onmessage`, and burns zero CPU until a message arrives.

This is the strongest argument for the ruling and it deserves stating plainly:
**the event loop is already the resident loop.** A `while (true) { await
queue.next() }` written over it idles *identically* — it is parked on a promise
either way — while adding a stack frame nobody can inspect and a wake path
nobody can name. It is a decoration on a mechanism the platform already
provides, and it costs a battery nothing and a reader a great deal.

### 2.7 How it is steered — the argument FOR resident, made concretely and found weak

`AGENT.md` §10.2 rules five steering operations. Re-costed against both shapes:

| Steer | Turn-shaped + resident owner | Fully resident loop | Winner |
|---|---|---|---|
| **Cancel mid-stream** | `AbortController` on the resident; `turn/abort` finds it by turn id; the signal is already threaded `AgentOptions → Session → turn → infer` (2.8, `agent.ts:110,128,147`) | identical | **tie** |
| **Inject a correction** | abort the inference, append the correction as a `user` message, let `loop()`'s next pass re-assemble | identical | **tie** |
| **Force a tool call** | run the tool, insert the `ToolResult` text as the next thing the model reads | identical | **tie** |
| **Replay with one component changed** | a **function call**: build a `Session` with an override map, call `react()`, get a `Reply` back | work injected into a queue, result correlated back by id | **turn shape** |
| **Pause before an action commits** | protocol change: `tool/pending` + `tool/approve`, with a mandatory reporting deadline | identical protocol change, identical deadline | **tie** |

**Four of five are ties and the fifth favours the shape we already have.**
Stated as the directive asked: the argument that residency buys steering is
**weak**, and I am not going to pretend otherwise to make the change look
better. What residency actually buys is that the *object* survives — the agent,
its transcript, its tools, its warm assembler memo — and a named owner in
`engine/` delivers that without touching a line of `src/core/**`.

### 2.8 Migration cost, honestly — what a full resident rewrite would have cost

Not hypothetical: this is the bill the ruling declines to pay.

| File | Change under a full resident rewrite |
|---|---|
| `core/agent/agent.ts` | **none.** `turn(session)` is already the right size |
| `core/agent/react.ts` | `react()` stops returning a `Reply`. Every host test that `await`s a reply becomes an event-log assertion with a timeout |
| `core/agent/session.ts` | either unchanged (and then residency bought nothing here) or promoted to session-lifetime, which **breaks the repeat guard** — see §2.5 |
| `core/agent/build.ts` | constructs once instead of per turn. Fine either way; not a reason |
| `core/ports.ts` | **+3 ports with one caller each**: a queue, an idle wait, a waker |
| `src/protocol/**` (3.2, **mid-flight**) | **none.** `turn/start → turn/started` is a request/reply pairing either way; the resident still replies `turn/started` and still streams `turn/delta`. The protocol is shape-neutral, and that is worth knowing |
| `tests/**` | 96 passing tests; every one that asserts a returned value is rewritten |

**What a resident shape makes impossible that the turn shape allows:**
`tests/turn.test.ts` asserting that `await react(...)` returned the expected
`Reply` and that the transport received a **byte-identical** golden prompt. The
oracle is a return value. Give up the return value and the oracle becomes an
event log — still assertable, materially weaker, and it is the one thing in this
tree that has caught a transliteration error.

**What the turn shape makes impossible that a resident allows:** the agent
starting work **with no request** — a scheduled turn, a continue-on-its-own.
This is real and I am not going to hide it. Three notes: `schedule.js` was cut
in `SALVAGE.md` as machinery with no caller; NORTH-STAR's four things do not
include *acts unprompted*; and when it is wanted, it is **the resident posting a
message to itself**, which is the same shape rather than a rewrite. The loss is
deferred, not permanent.

---

## 3. Ruling 2 — the browser tool family, and what a static page can actually reach

### 3.1 What is reachable, ranked by how certain each is

| Capability | Reachable? | Evidence |
|---|---|---|
| Fetch the deployed artifact's own files (`public/seed/*`) | **YES, certain** | same-origin; `ARCHITECTURE.md` §6.6 already fetches seeds through `ports.fetch` |
| Fetch a cross-origin URL **whose server sends `Access-Control-Allow-Origin`** | **YES, certain as a mechanism** | this is how the model endpoint itself is called (`core/inference/openai.ts`). Which hosts do so is per-host and **UNVERIFIED** |
| Fetch a cross-origin URL that does **not** send ACAO | **NO** | the browser blocks the read. There is no proxy and there may not be one — NORTH-STAR consequence 1 |
| `fetch(url, {mode:'no-cors'})` | **Technically yes, useless** | returns an opaque response: `status 0`, body unreadable. Named here so nobody builds a tool on it and discovers the emptiness at the call site |
| `window.open(url)` — hand a page to the **human** | **YES, but main-realm** | a worker cannot call it. It would need a `tool/pending`-shaped round trip (`AGENT.md` §10.2's expensive row). **Cut for now** |
| Read the DOM of another site | **NO, and never** | not CORS, not iframes, not `postMessage` without the other side's cooperation |

**The headline, stated first because it is what the directive most needs to
hear: reading an arbitrary web page from a static page with no backend is not
possible.** Every browser-agent product that does it runs a server. We do not
have one, by choice, in the first sentence of `NORTH-STAR.md`.

### 3.2 The one tool that is honest: `fetch_url`

```
fetch_url(url: string, method?: string, body?: string) -> ToolResult
```

- Runs in the **worker**, through `ports.fetch` (`adapters/browser/fetch.ts`
  `[3.1]`). No new port, no new realm, no new inversion.
- **Never throws** — `ARCHITECTURE.md` §5.3. A failure is a `ToolResult` the
  model reads.
- **Its failure sentences are a closed set and they are the product**, modelled
  on `ProbeOutcome` (`'ok' | 'refused' | 'cors' | 'http' | 'timeout'`) for the
  same reason the Door needs it: *CORS-blocked* and *connection-refused* have
  different remedies and only one of them is the user's fault. Collapsing them
  into "could not fetch" teaches the model to retry a thing that can never work.
- **Its description tells the model the truth about its own reach.** Something
  to the effect of: *this reads URLs whose server permits cross-origin reads —
  most JSON APIs do, most web pages do not.* This is `LESSONS.md` defect 3
  applied to a tool description: the harness never tells the model something it
  has not done, and a `fetch_url` described as "reads a web page" is a lie the
  model will spend a whole session discovering.
- Output is capped at `TOOL_OUTPUT_CAP` with `TOOL_ELISION`, like every tool.

**It lands at 4.3** ("the first real tools"), inside the existing increment. It
is not a new increment because it is not a new mechanism.

### 3.3 Search — UNVERIFIED, all of it, and what would promote it

**Nothing in this tree has measured any search endpoint.**
`docs/scratch/REFERENCES.md` contains zero hits for `search`, `CORS` or
`fetch`. `MEASURED.md` measures workers and locks. `SANDBOX.md` measures WASM
runtimes. There is no third file.

Therefore, and this is a rule and not a caution:

> **Every claim about a specific third-party endpoint's CORS behaviour is
> UNVERIFIED until a browser-run measurement is recorded in
> `docs/scratch/BROWSER-TOOLS.md`. No search tool is designed before that file
> exists.** Not the tool, not the port, not the catalogue entry, not the
> `Slot` reservation.

The remembered candidates — a keyless Firecrawl endpoint, a public SearXNG
instance, keyless `r.jina.ai` — are each **UNVERIFIED here**, and the memory
that names them also records that two of the three were later found FALSE. A
remembered endpoint repeated as fact is exactly the artifact `CLAUDE.md` names:
*a behaviour you have only read is not a measured behaviour.*

**What promotes a claim, and the trap that makes the obvious method worthless:**

1. `curl -i <url>` showing an `Access-Control-Allow-Origin` header. **Necessary
   and nowhere near sufficient.** `curl` does not enforce CORS. A `curl` that
   returns 200 with a body proves nothing whatsoever about what a page can read,
   and treating it as proof is how this claim class became false three times.
2. **The load-bearing half:** a `fetch()` executed **from a page served at the
   deploy origin** — the built export under `/ASKK/`, per `ARCHITECTURE.md`
   §8.4 — that reads `response.text()` and prints its length. A non-zero length
   from that context is the only evidence that counts.
3. Recorded with the date, the exact URL, the response headers, and the browser
   version. And re-run, because a keyless endpoint's terms are one commit away
   from a key requirement.

A BYOK search (a key the user supplies, like the model key) is the same
measurement with a header added, and is **equally UNVERIFIED**. It is not
architecturally harder — `config` already stores a key — it is just as
unmeasured.

---

## 4. Ruling 3 — "shared memory" resolves to a shared **state** space, and most of it already exists

### 4.1 What it is not

**Not `SharedArrayBuffer`.** It requires cross-origin isolation; a static host
sets no headers; `ARCHITECTURE.md` §9 refuses COOP/COEP outright and
`PLAN.md` wave 7 re-refuses them. `SANDBOX.md` measured
`crossOriginIsolated = false` / `SharedArrayBuffer = false` on a server sending
no such headers and had to prove the whole substrate worked without it. The
obvious reading of the directive is closed, negatively, with evidence.

**Not `SharedWorker` and not `BroadcastChannel`** either — §3.5 rule 4.

### 4.2 What it is, and it is not new

The shared space is **the state the resident owns and publishes.** It is three
things that are already designed, and naming a fourth would be inventing a
parallel mechanism:

| Layer | What is in it | Increment |
|---|---|---|
| **Per run** | `core/agent/session.ts` — its own docstring already calls it *"the blackboard for one run"* | shipped |
| **Per conversation, in memory** | `core/agent/transcript.ts`, held by the resident across turns | shipped; owned by `engine/turns.ts` at 3.3 |
| **Durable** | `sessions` / `messages` / `events` / `config` / `agents` / `meta` — `ARCHITECTURE.md` §7.1 | **3.4** |
| **The reader's copy** | `client/store.ts`, one switch over every `FromEngine` type | **3.2, mid-flight** |

**Answering the directive's implicit questions against that, one by one:**

- **Who may write.** Only the elected writer worker, and inside it only the
  resident — one turn at a time per session (§7.5). One writer, one lock, one
  turn.
- **How a reader learns it changed.** It is told. `turn/message` carries the
  **allocated** `seq`; `turn/delta`, `turn/tool`, `turn/phase`, `turn/done`
  carry the rest. There is no polling and no change feed, because the only
  mutator already owns a wire and announces every mutation on it.
- **How it survives a reload.** IndexedDB, plus orphan reconciliation on
  `session/open` — a turn interrupted by a tab close reopens **labelled
  interrupted**, never as a spinner that never resolves.
- **How two tabs interact.** They do not. §2.4.
- **Its relation to `StorePort`.** See §4.4 — this is the one place the directive
  exposes a live problem.

### 4.3 The model-facing board — earned in principle, deferred with the increment that earns it

The directive's plainest reading is the thing `SALVAGE.md` cut: `core/space.js`,
a board the agent, its tools and the user all write to, rendered into the prompt
as a band. It was cut as **unpaid-for** — *"~200 lines and ~22 lines of every
turn's prompt budget for a shared board that, in the default config, nothing
else writes to."*

**Re-tested against this directive.** A band earns its prompt budget when it has
writers. Prospective writers: a tool leaving a note, the agent recording a
finding, the user pinning a fact. **Two of those three do not exist** — there is
no tool in this tree at all until 4.2/4.3. So the board today would be a
declaration with no consumer, in the one place where that costs bytes on every
single turn forever.

> **Ruling: the shared board is granted in principle and gated on a writer.**
> It lands in an increment (**4.6**, defined in `PLAN.md`) whose acceptance is
> that a **real tool call, in a real turn, writes to it and the next prompt
> renders it**, byte-compared against a golden. If 4.3's tools produce no
> writer, 4.6 is CUT and the reason is recorded. No slot number is reserved for
> it in advance — `Slot.SKILLS = 30` is already this tree's one stated
> exception to "no declaration without a consumer" and one is enough.

### 4.4 The live problem this directive exposes: `StorePort` has no future caller

`core/ports.ts` declares `StorePort` — five verbs — and its own header says so:
*"as of 2.2 exactly ONE has a caller."* `FLOW.md` confirms `StorePort` has
**zero**. 3.4 is scheduled to make persistence real — and 3.4 puts it in
`engine/stores/*`, in the worker, **not** behind the core port.

Both cannot be true. Either:

- **(a) the core writes through `StorePort`** — and then a golden prompt test
  depends on a store, which is precisely what `adapters/test/store.ts` exists to
  absorb, but also what makes `Transcript` (`transcript.ts`, whose header says
  *"Durability is not here: 3.4 owns the store"*) contradict itself; or
- **(b) `engine/` persists from the observer, and `StorePort` is deleted from
  `Ports`** — which is the reading every existing file comment supports, and
  which leaves `Ports` with three members.

**I rule (b), and I am not editing it here** — 3.4 is not mid-flight but
`ARCHITECTURE.md` §5.1 and `core/ports.ts` are both outside this task's file
list. It is recorded as an obligation on 3.4 in `PLAN.md`, because an interface
with zero callers that survives the increment that was supposed to give it one
is `LESSONS.md` defect 6, and this directive is the thing that surfaced it.

---

## 5. The boot trace — the first line, and every hop to idle

> As of `5799940`. Realm named at every hop. **Every `file:line` was read from
> the tree, not recalled.** Where a hop's failure mode was driven for real, the
> PROGRESS 3.1 planted break that drove it is cited.

### 5.0 The first line to execute is not in this repository

The browser parses `out/index.html`. Before one byte of this project's code
runs, the DOM already contains the answer surface:

```html
<main data-page-mark="ASKK_PAGE_ALIVE"><h1>ASKK</h1><p>ASKK_PAGE_ALIVE</p>
<pre data-engine=""></pre></main>
```

Two facts worth holding onto:

- **`PAGE_MARK` is in the prerendered HTML.** It proves the export exists; it
  does **not** prove React woke up. `verify-export.ts:122-131` knows this and
  asserts a `__react` key on `[data-page-mark]` separately — the comment there
  says so in as many words. Good.
- **`data-engine` is empty in the prerender** and is written only by a state
  update from a resolved promise. **It is therefore the honest liveness probe
  for the whole system**: non-empty means React hydrated *and* the effect
  flushed *and* the worker chunk loaded *and* the lock was elected *and* a
  message crossed both ways. `verify-worker.ts` reads exactly that.

The `<head>` declares four `async` scripts. **Execution order among them is not
document order** — webpack's chunk runtime resolves it, and each chunk pushes
onto `self.webpackChunk_N_E`. So "the first line" of *our* code is decided by
the loader, and the only ordering this project may rely on is the one webpack
guarantees: React's client entry runs before `app/page`'s module factory is
invoked.

### 5.1 The hops

| # | Realm | `file:line` | What happens | Waiting on | If it never arrives |
|---|---|---|---|---|---|
| 1 | MAIN | `src/app/layout.tsx:11` | **Does not run in the browser.** No `'use client'`, so `RootLayout` is a server component: it executed at **build** time and ships as flight payload. The `metadata` export (`:6`) became the `<title>` in the HTML. **The first line of this repo that runs in a browser is in `page.tsx`.** | — | a manual `<head>` here has previously stopped Next's client runtime dead (`LESSONS.md`); the comment at `:3-5` is the guard |
| 2 | MAIN | `src/app/page.tsx:23` | `Page()` runs during hydration. `useState('')` → `''` (`:24`). Returns JSX with `data-engine=""` (`:42`) | React's hydration pass | no hydration → `data-engine` stays empty forever; `verify-export.ts:131` fails naming the missing `__react` key |
| 3 | MAIN | `src/app/page.tsx:26` | commit → **passive effect** fires | React flushing effects | **`next.config.ts:29` sets `reactStrictMode: false` on purpose.** This operator has measured strict mode stopping this build flushing *any* passive effect. With it on, the trace ends here, silently, with a page that renders and does nothing |
| 4 | MAIN | `src/app/page.tsx:27` → `src/client/worker-client.ts:74` | `startEngine()` | — | — |
| 5 | MAIN | `worker-client.ts:75` | `new Worker(new URL('../engine/entry.worker.ts', import.meta.url))`. **Verified in the artifact:** the emitted call is `new Worker(n.tu(new URL(n.p+n.u(<id>),n.b)))` — **one argument, no options object.** MEASURED M2 holds. The browser begins fetching a chunk under `basePath` | nothing — construction is synchronous and does **not** throw on a 404 | a 404 surfaces later as an `error` event → hop 12. **PROGRESS 3.1 break #3** removed the chunk and drove exactly this |
| 6 | MAIN | `worker-client.ts:77-84` | the outcome promise is built; `settle` closes over the timer and both listeners | — | — |
| 7 | MAIN | `worker-client.ts:85-91` | `window.setTimeout(..., BOOT_DEADLINE_MS)` — **15 000 ms**. A *reporting* deadline (§6.5): it stops the page waiting, it never claims to stop the worker | — | it is the thing that arrives when nothing else does. **PROGRESS 3.1 break #5** (a worker whose `onmessage` does nothing) drove it red after 15s |
| 8 | MAIN | `worker-client.ts:96-97` | `message` and `error` listeners attached | — | — |
| 9 | MAIN | `worker-client.ts:98` | `postMessage({ id: 1, type: 'boot' })` — sent **before** the worker script has evaluated. Correct: the message queues until it does | — | — |
| 10 | MAIN | `worker-client.ts:99` → `page.tsx:29-31` | the handle returns; `.then` is registered behind a `live` flag; the effect returns its cleanup (`:32-35`). **Main-realm control returns to React.** The page is now idle, rendering `data-engine=""` | the worker | — |
| 11 | **WORKER** | `src/engine/entry.worker.ts` module scope | **The worker realm's first line.** The chunk is a single classic IIFE — verified: it opens `(()=>{"use strict";` and closes `_N_E={}`, with the `lease.ts` body inlined and **no `import` surviving to runtime**. M2's consequence is visible in the artifact, not inferred. Module scope binds `WORKER_MARK` (`:32`), `SCHEMA_VERSION` (`:35`), `scope` (`:42`), then installs `scope.onmessage` (`:61`) and ends | — | if the chunk 404s, this hop never runs and hop 12 fires instead |
| 12 | MAIN | `worker-client.ts:95` | *(alternate path)* `error` → `{kind:'fatal', reason:'internal', message:'worker stopped'}` — §6.5's rule that a dead worker's replies are never coming | — | — |
| 13 | **WORKER** | `entry.worker.ts:61-62` | the queued `boot` is delivered; `void boot(event.data.id)`. **`void`, so nothing awaits it.** §6.5 says a throwing handler is caught in `engine/host.ts` — **`engine/host.ts` is `[3.2]` and does not exist.** So today a rejection here is an unhandled rejection: **no `fatal`, no message, and the page falls through to hop 7's 15s deadline.** Named as a real gap; 3.2 closes it | — | see the cell |
| 14 | **WORKER** | `entry.worker.ts:53` → `src/engine/lease.ts:36` | `await elect()` | the lock manager | if `navigator.locks` were absent, the `TypeError` lands in the promise executor and takes the same silent path as hop 13 |
| 15 | **WORKER** | `lease.ts:38` | `navigator.locks.request('askk.writer', {ifAvailable:true}, cb)` | the browser | — |
| 15a | **WORKER** | `lease.ts:43-44` | **won:** `resolve(null)`, then return `new Promise<never>(() => {})`. **The lock is now held for the realm's life** — this is the mechanism, and it is not the obvious code. `elect()` resolves *while the callback is still pending* | — | writing `Promise.resolve()` here releases the lock instantly and the second tab writes. **PROGRESS 3.1 break #1** planted precisely that and the check named "THE ELECTION IS BROKEN" |
| 15b | **WORKER** | `lease.ts:40-41` | **lost:** resolve the sentence *"this agent is open in another tab, which holds askk.writer. Close it and reload."*, return `Promise.resolve()` | — | — |
| 16 | **WORKER** | `entry.worker.ts:54-57` | refused → `postMessage({type:'fatal', reason:'another-tab', message})` and **return**. No later step runs | — | asserted from the DOM of a **second instance of the whole page** in a same-origin iframe, on every deploy |
| 17 | **WORKER** | `entry.worker.ts:58` | won → `postMessage({ id, type:'ready', mark:'askk/engine@entry.worker', schemaVersion:1 })`. **This is where §6.6's boot sequence stops** — see §5.2 | — | — |
| 18 | MAIN | `worker-client.ts:92` → `:51` `received()` | `fatal` is checked **first** (`:60`) because it is unsolicited and may arrive instead of any reply; then `type==='ready' && id===BOOT_ID` (`:63`); anything else falls to `:66` *"the engine answered boot with …"* | — | **PROGRESS 3.1 break #4** replied with `id+1` and drove that fallback for real, so it is not dead code |
| 19 | MAIN | `worker-client.ts:79-82` | `settle` clears the timer, removes **both** listeners, resolves | — | — |
| 20 | MAIN | `page.tsx:29-31` → `:42` | `setEngine(JSON.stringify(state))` → re-render → `<pre data-engine='{"kind":"ready","mark":"askk/engine@entry.worker","schemaVersion":1}'>` | — | — |
| 21 | **both** | — | **IDLE.** MAIN holds: one `Worker` handle, one resolved promise, one rendered string, zero timers. WORKER holds: one Web Lock, one installed `onmessage`, zero pending work, zero timers. **Nothing polls. Nothing will run again** until a `postMessage` arrives or the tab closes | a second message | **no sender exists.** `client/actions.ts` is `[3.2]` |

### 5.2 Where the trace stops, and the increment that continues it

**It stops at hop 21, and it stops because there is no second sender.** Named
precisely:

| The missing hop | Blocked on |
|---|---|
| a UI event calls `submitTurn(text)` and constructs a `ToEngine` message | `client/actions.ts` — **3.2 (mid-flight)** |
| `engine/host.ts` dispatches it, one `case` per type | `engine/host.ts` — **3.2 (mid-flight)** |
| the resident takes the work, builds a `Session`, calls `react()` | `engine/turns.ts` — **3.3** (§2.2 re-tags it) |
| a token renders as it arrives, through the worker, in the built export | **3.3** |
| the other **three** steps of §6.6's boot — open the database under the reporting deadline, seed from `seedBaseUrl`, reconcile orphan turns | `engine/db.ts`, `engine/boot.ts`, `engine/stores/*` — **3.4** |

**Boot is 1 of 4 steps, and that is the honest headline of this trace.**

Two divergences between `ARCHITECTURE.md` and the source, found by walking it:

1. **§6.2 says `boot` carries `{ seedBaseUrl }`.** `worker-client.ts:98` sends
   `{ id, type: 'boot' }`. Seeding is 3.4's and the field arrives with it.
2. **§6.2 says `ready` carries `{ schemaVersion, configured, activeSessionId }`.**
   `entry.worker.ts:58` sends `{ mark, schemaVersion }`. `configured` and
   `activeSessionId` both need the config store — 3.4. **`configured` is the
   whole cold-open branch**, so the Door cannot be wired before 3.4 regardless
   of what wave 6 builds.

Also noted, not a defect: `worker-client.ts:35` names `BOOT_DEADLINE_MS =
15_000` while §6.5 names 5000. **They are two different deadlines** — the
client's wait for any reply, and the worker's wait for `openDB`. One document
number for two clocks reads as a contradiction; it is not one.

### 5.3 Where this trace meets `FLOW.md`

`FLOW.md` traces the **turn** and begins at `react()` / `agent.turn`. This
traces the **boot** and ends at idle. **Today the two do not meet at all** —
there is no edge from hop 21 to FLOW's first hop, and building that edge is the
entire content of 3.2 and 3.3. The junction, when it exists, will be:

```
engine/host.ts  case 'turn/start'  →  engine/turns.ts (the resident)  →  react(agent, text)
```

That single arrow is the read-through test passing.

---

## 6. What this directive breaks in the existing design

| Broken | Fixed by |
|---|---|
| `ARCHITECTURE.md` §4 tags `engine/turns.ts` `[3.1]` and describes it as *"the turn queue"* | **3.3** re-tags it and rewrites the line as the resident's contract (§2.2) |
| `PROGRESS.md` 3.1 "Open" leaves `engine/turns.ts`, `engine/boot.ts` and `checks/bundle.ts` tagged `[3.1]` and unshipped — *"retagging the file map is the architect's"* | this ruling calls it: `turns.ts` → **3.3**, `boot.ts` → **3.4**, `checks/bundle.ts` → **3.3** (it cannot assert `CORE_MARK` reaches the worker until the worker imports core, which the resident is what does) |
| `core/ports.ts`'s `StorePort` has zero callers and 3.4 gives it none | **3.4**, ruled (b) in §4.4: `engine/` persists from the observer and `StorePort` leaves `Ports` |
| `ARCHITECTURE.md` §9 lists *"`space.js` / a shared board — unpaid-for"* as refused outright | **4.6**, gated: it is refused **until a writer exists**, which is a different sentence and needs §9's row amended to say so |
| `AGENT.md` §10.2's steering table is costed against a shape with no owner | it survives unchanged — §2.7 re-costed all five against both shapes and four are ties |
| `engine/entry.worker.ts:62`'s `void boot(...)` has no error path | **3.2**, which is where §6.5's "a handler that throws is caught in `engine/host.ts`" becomes true |

**Nothing in this ruling touches `src/core/**`.** That is the test it was
designed to pass.

---

## 7. How each rule here is CHECKED

| Rule | Check | Status |
|---|---|---|
| The resident lives in `engine/` and core gains no loop | `checks/layers.ts` `[3.2]` (`core` may not import `engine`) + `checks/purity.ts` (no ambient anything in core) | **CHECKED** once 3.2 lands |
| No `SharedArrayBuffer`, `SharedWorker`, `BroadcastChannel` | `checks/realm.ts`'s per-directory global allowlist refuses each identifier | **CHECKED today** — none is on any allowlist |
| `fetch_url` runs in the worker, never the main realm | `checks/realm.ts` refuses `fetch` outside `engine/**` and `adapters/browser/**` | **CHECKED today** |
| `fetch_url` never throws | a host test asserting a `ToolResult` for each of the five outcomes | **4.3** |
| Every `fetch_url` failure sentence is a closed union | TypeScript, plus a test per member | **4.3** |
| No search endpoint is designed before it is browser-measured | **UNENFORCED.** No check can see an absence of design. It is a ringmaster obligation, and `docs/scratch/BROWSER-TOOLS.md`'s non-existence is the only visible sign | **UNENFORCED, stated** |
| The shared board has a writer before it has a slot | 4.6's acceptance: a real tool call writes it and the next prompt renders it, golden-compared | **4.6** |
| The boot trace stays true | `checks/stale.ts` `[1.8]` against this file's `MEASURED AT` header + `SUBJECTS` glob. 3.2 will turn it red, which is correct | **CHECKED once 1.8 lands** |
| `ready` and `boot` carry the fields §6.2 declares | `checks/protocol.ts` `[3.2]` rules 1–3 | **3.2** |

---

## What this does not decide

| Open question | Closed by |
|---|---|
| Whether the resident ever starts work with **no request** (a scheduled turn) | Unscheduled. It is a message the resident posts to itself, which needs no shape change; it needs a reason, and there is none yet |
| Whether `StorePort` is deleted from `Ports` or gains a core caller | **3.4.** §4.4 rules (b); 3.4 executes it or records why not |
| Whether any search endpoint is reachable from a page at the deploy origin | **A measurement**, `docs/scratch/BROWSER-TOOLS.md`, gating **4.7**. Until it exists, 4.7 does not start |
| Whether the shared board earns its prompt bytes | **4.6**, whose acceptance is a real writer in a real turn. CUT if 4.3 produces none |
| Whether `window.open` becomes a human-handoff tool | Needs `AGENT.md` §10.2's `tool/pending` protocol change and its mandatory reporting deadline. Not before 6.3 has a surface to render the pending state |
| Whether a second tab ever becomes a read-only viewer | Refused (§2.4). Reopening it means reopening §3.5 rule 4, and the answer there is still no |
| Whether serialised turns are acceptable under a slow tool | Already open in `ARCHITECTURE.md` §11; **4.3** measures it with a deliberately slow tool. The resident does not change the answer — one turn at a time is a §7.5 ruling, not a shape consequence |
