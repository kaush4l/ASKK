# ARCHITECTURE

> The architecture of record. `NORTH-STAR.md` says what we are building and why;
> this file says what shape it has. `DESIGN.md` is law for what the interface
> looks like; where it and this file conflict, §10.2 rules which one yields, in
> writing. `PLAN.md` says what is next; `PROGRESS.md` says what was proven.
>
> The sentence this design serves: **"the whole harness is a static page."**
> Everything below is a consequence of having no server to put anything in.
>
> **Revision 2.** Rewritten against `docs/scratch/MEASURED.md`, a ringmaster
> GO-WITH-CONDITIONS (9 conditions) and a critic pass (10 blockers, 15 majors).
> §10.4 records what was overruled and why.

---

## 1. The one-paragraph shape

A tab opens a folder of static files. The page's main thread does nothing but
render and collect input. It starts one Web Worker; that worker is the whole
machine — it owns the database, the agent, the prompt, the model connection and
the tool calls, and it is the only realm that writes anything down. The two
talk over one typed message channel: the page sends intents (`turn/start`,
`config/probe`), the worker streams back what is happening (`turn/delta`,
`turn/phase`, `turn/tool`, `turn/done`). Inside the worker sits a **pure core**
that has no way to reach the outside at all: no `fetch`, no clock, no storage,
no randomness — every one of those arrives as a function handed in at
construction. The model is called directly from that worker to the user's own
endpoint with the user's own key. Nothing else exists.

Read it as four nested boxes: **page → worker → engine host → pure core**, with
one wire between the first two and one port object between the last two.

---

## 2. Layers and dependency direction

Six layers. Every arrow points one way. A cycle is a design bug and the gate
fails on it.

```
  ui  ───▶  client  ───▶  protocol  ◀───  engine  ───▶  adapters  ───▶  core
  (main realm)              ▲             (worker realm)                  │
        └───── import type ─┘                └──────────────────────────▶─┘
```

| Layer | Single responsibility | May import | May NOT import |
|---|---|---|---|
| `src/core/` | Decide things. The agent, prompt, response, tools, flow. Pure. | `src/core/` only | everything else, and every ambient global |
| `src/adapters/` | Satisfy one core port against one real environment. | `src/core/` | `engine`, `client`, `ui`, `protocol` |
| `src/engine/` | Assemble the world in the worker realm, own all mutable state, serve the protocol. | `core`, `adapters`, `protocol` | `client`, `ui`, `app` |
| `src/protocol/` | The message vocabulary. Types and `as const` strings. **Zero runtime state, zero behaviour.** | nothing | everything |
| `src/client/` | Main-realm mirror: own the `Worker` handle, keep render-shaped state, expose subscribe/dispatch. | `protocol` | `core`, `adapters`, `engine` |
| `src/ui/`, `src/app/` | Render. React components and the Next route segments. | `client`, `ui`, and **`import type` from `protocol`** | `core`, `adapters`, `engine`; **value** imports from `protocol` |

Stated pair by pair, out loud:

- `ui → client`: yes. `client → ui`: **never** — the client has no idea React
  exists and is testable under `bun test` with no DOM.
- `ui → protocol`: **type-only.** A panel renders a `PromptBreakdown`; under
  TypeScript that import erases at build time and creates no runtime edge. The
  previous revision banned it outright, which bought nothing and forced
  `client/` to re-export every shape — a forwarding layer manufactured by a
  rule. `checks/layers.ts` distinguishes `import type` from a value import and
  permits only the former. *(Critic :50, accepted.)*
- `client → protocol`: yes, values and types. `protocol → client`: **never**.
- `engine → protocol`: yes. `protocol → engine`: **never**.
- `engine → adapters`: yes. `adapters → engine`: **never** — an adapter that
  knew the engine could not be swapped for a test double.
- `engine → core`: yes. `core → engine`: **never**.
- `adapters → core`: yes, for the port shapes it implements. `core → adapters`:
  **never**.
- `ui ↮ engine`, `client ↮ core`: **never, in either direction, at any strength.**
  These two non-edges are what make the realm split real rather than
  aspirational, and they are the ones with a build-artifact check behind them
  (§8, `checks/bundle.ts`).
- `protocol` is the only module both realms import. That is safe *because* it
  holds no mutable state — and that property is now checked (§8), not asserted.

### 2.1 The purity rule carries, and it is enforced by an allowlist

`src/core/**` may not reference any ambient global outside a small allowlist of
ECMAScript built-ins. Everything environmental arrives through `Ports` (§5.1).

The previous revision expressed this as a **denylist of substrings**, which was
unsatisfiable: banning the token `self` matches the string `"self-contained"`,
which occurs inside prompt bytes that CLAUDE.md forbids editing, and banning
`fetch(` matches the sanctioned `ports.fetch(url)` call site. *(Critic :73 and
:74, both accepted; the rule as written would have been gutted on day one.)*

`scripts/checks/purity.ts` therefore **tokenises** each file, discards string
literals, template contents, comments and JSX text, and collects **free
identifiers** — identifiers in a value position that resolve to neither a local
binding nor an import. It fails on any free identifier outside the
per-directory allowlist in §3.4. `ports.fetch(url)` is a member expression on a
local binding and is not a free identifier; `"self-contained"` is inside a
string and is never scanned.

Three constructs are additionally banned in `src/core/**` because they are
ambient behaviour reached through an *allowed* identifier: a zero-argument
`new Date()`, `Date.now()`, and `Math.random()`.

**These are matched on the token stream, not as source substrings** — same as
everything else in this check. Stating them as patterns would have reintroduced
the string-literal false positive one size smaller, which is the defect that made
the previous revision's `self` ban unsatisfiable. *(Critic :99, accepted;
measured latent rather than live — the tree's one hit is `new Date(at)`, which
takes an argument and is permitted.)* The rules are therefore: a `NewExpression`
on `Date` with zero arguments; a `CallExpression` on the member path `Date.now`;
a `CallExpression` on the member path `Math.random`. `new Date(value)` with an
argument is pure — it converts, it does not read a clock — and is allowed.

The purity rule buys three concrete things and they are the reason it stays:
(1) the core runs under `bun test` on the host with no browser at all; (2) a
prompt can be compared byte-for-byte against a recorded golden file, which is
impossible if a clock is ambient; (3) the core cannot become realm-sensitive,
because it has no way to ask what realm it is in.

---

## 3. The realm map

**This is the most important section in the file.**

### 3.0 What was measured, and what it corrects

`docs/scratch/MEASURED.md` M3 overturned the premise this section was first
written on. Powerhouse's `db.js` guarded with
`if (typeof window === 'undefined') return null;` — and in the shipped worker
chunk that guard **compiles to nothing**. The bundler folds `typeof window` to a
constant and eliminates the branch; `grep -c "typeof window"` on the worker
chunk returns 0. **Powerhouse's worker did have IndexedDB.** LESSONS defect 1's
diagnosis was read out of source and is false in the artifact.

The rule survives and gets sharper, and this section now rests on measured
platform physics rather than on a diagnosis:

> **`typeof window` is not a realm check.** It is a token a compiler replaces
> before your code runs, and it disappears in exactly the realm you most need it
> in. Never branch on it — or on any other spelling of the same question.

Measured from the probe worker running in the built export at a subpath:

```
hasLS: false      localStorage is genuinely ABSENT in a worker    (survived compilation)
hasIDB: true      indexedDB is genuinely PRESENT in a worker      (survived compilation)
hasWindow: true   typeof window was FOLDED TO A CONSTANT          (did not survive)
```

### 3.1 The two realms

- **MAIN** — the page. React, DOM, user input, `localStorage`. Renders.
- **WORKER** — one worker, `engine/entry.worker.ts`. IndexedDB, `fetch` to the
  model, the agent, the tools. Decides and remembers.

There is no third realm and no fallback realm. **If the worker fails to start,
the page shows a failure — it does not run the engine on the main thread.**

### 3.2 The worker is a *classic* worker

MEASURED M2: webpack emits `new Worker(url, {type: void 0})` — the
`{type:'module'}` written in source is **dropped**, and the worker's whole
dependency graph is bundled into one IIFE chunk instead.

Consequences, which are architectural rather than incidental:

- **No runtime ESM in the worker.** No top-level `import` surviving to runtime,
  no dynamic `import()` of application code, no import maps.
- **Everything the engine needs must be statically reachable at build time.**
  An agent's tools cannot be a module loaded from storage; they are compiled in
  and selected by name. This is why `engine/tools/index.ts` is a static table.
- Any future design that assumes a module worker is designing against something
  this toolchain does not emit.

### 3.3 Who owns what

| Mutable state | Owning realm | How the other realm sees it |
|---|---|---|
| IndexedDB connection (`engine/db.ts`) | **WORKER** | never; MAIN may not name `indexedDB` (checked) |
| Sessions / messages / events / config / agents stores | **WORKER** | request/reply + streamed events over the protocol |
| Engine event bus (`engine/bus.ts`) | **WORKER** | serialised into `turn/*` messages |
| Agent instance and its `Session` | **WORKER** | flattened snapshots in `turn/phase` and `turn/done` |
| Inference client and its `AbortController` | **WORKER** | `turn/abort` is a message, not a shared handle |
| Prompt assembler memo | **WORKER** | `turn/prompt` carries the breakdown as plain data |
| The active turn, and the queue behind it | **WORKER** | `turn/started` … `turn/done`/`failed`/`aborted` |
| Status — "what is the engine doing" | **WORKER** (truth) | MAIN keeps a **mirror**, rebuilt from messages |
| UI theme, dense/expanded, composer draft, route | **MAIN** | worker never reads them; they are not engine facts |
| The `Worker` handle and the in-flight request map | **MAIN** | — |

### 3.4 What makes the defect inexpressible

The previous revision claimed "two media" did this work. That claim was
oversold and the ringmaster was right to strike it (condition 1). `indexedDB`
exists on `Window` and always has — that is precisely why powerhouse's
main-thread path worked. Stated honestly, there are three separate mechanisms
and they are not equally strong:

1. **Structural, measured, unfoldable.** `localStorage` is genuinely absent in a
   worker (`hasLS:false` survived compilation). UI preferences living there
   cannot be duplicated into the worker even by accident. This one is physics.
2. **A checked convention.** `indexedDB` is present in *both* realms. Nothing
   about the platform stops MAIN opening the database. What stops it is
   `checks/realm.ts` refusing the identifier `indexedDB` and the specifier `idb`
   anywhere under `src/client/**`, `src/ui/**`, `src/app/**`. Called what it is:
   a convention with a check, not a law of nature.
3. **The `typeof` ban — the one that actually kills the defect class.** No file
   in `src/**` may apply `typeof` to any of a closed set of realm-discriminating
   globals, and `globalThis` is banned as an identifier outright. A module knows
   its realm because of **where it lives in the tree**, and there is no
   expressible way to ask at runtime.

**And the reason no single global could stand in for a realm even if the
compiler left it alone:** availability is **per-API, not per-realm-tier**.
Measured in the same classic worker, in the same build:

| API | In the worker | Measured in |
|---|---|---|
| `localStorage` | **absent** | M1 (`hasLS:false`) |
| `indexedDB` | present | M1 (`hasIDB:true`) |
| `navigator.locks` | present, and fully functional | M5 |
| `window` | folded to a constant — tells you nothing | M3 |

There is no coherent "worker tier" to detect. A realm is a set of independent
capability decisions the platform made one API at a time, so any check that
infers the whole set from one member is guessing — which is why the answer is
positional (the directory) rather than interrogative (a runtime test).

### 3.5 The rules, and how each is checked

**Rule 1 — never feature-detect a realm.** The previous revision grepped three
exact idioms; the defect respelled as `typeof document === 'undefined'`,
`'window' in globalThis`, or `typeof\n window` passed all three. *(Critic :140,
accepted — the open set is the spellings, not the subjects.)*

`checks/realm.ts` therefore uses the same tokeniser as `checks/purity.ts` and
enforces a **per-directory allowlist of permitted free globals**:

| Directory | Permitted, beyond ES built-ins | Explicitly refused |
|---|---|---|
| `src/core/**` | *(nothing)* | every ambient global |
| `src/adapters/browser/**` | `fetch` `crypto` `Intl` `indexedDB` `navigator` `URL` | `window` `document` `localStorage` |
| `src/adapters/test/**` | *(nothing)* | every ambient global |
| `src/protocol/**` | *(nothing)* | every ambient global — it is imported by both realms, so anything ambient in it is ambient in both |
| `src/engine/**` | `self` `fetch` `crypto` `indexedDB` `navigator` `URL` `postMessage` `AbortController` | `window` `document` `localStorage` |
| `src/client/**` | `window` `document` `localStorage` `Worker` `URL` `navigator` | `indexedDB` `self` `importScripts` |
| `src/ui/**`, `src/app/**` | `window` `document` `localStorage` `URL` `navigator` `requestAnimationFrame` | `indexedDB` `self` `importScripts` `Worker` |

And, in every directory without exception: `typeof` may not be applied to
`window`, `document`, `self`, `globalThis`, `localStorage`, `indexedDB`,
`importScripts`, `navigator`, `Worker` or `process`; and `globalThis` may not
appear at all.

**Rule 2 — every file in a realm-bound directory carries a realm banner** as its
first line: `// REALM: worker`, `// REALM: main`, or `// REALM: host`.

The previous revision applied this only to files with module state, which is
unenforceable in the direction that matters — no check can tell that a *new*
stateful module is missing its banner. *(Critic :144, accepted.)* The rule is
now positional and total, so absence is detectable:

- Every file under `src/engine/**` must be banner-ed `worker`.
- Every file under `src/client/**` must be banner-ed `main`.
- **`src/adapters/**` is the one directory that legitimately holds all three**
  *(ringmaster condition 2, accepted)*. A banner is mandatory there and must be
  one of the three; `checks/realm.ts` then applies that directory's global
  allowlist **by banner rather than by path**: `adapters/browser/store.ts` is
  `worker`, `adapters/test/*` is `host` and gets the `core` allowlist, and a
  `main`-banner-ed adapter would be permitted DOM globals and refused
  `indexedDB`. There is currently no `main` adapter and none is planned.
- `src/core/**`, `src/protocol/**`, `src/ui/**`, `src/app/**` need no banner:
  core and protocol are realm-free by construction, and ui/app are unambiguously
  main.

**Rule 3 — one writer, elected, per database.** "The worker is the sole writer"
was true per tab and false per database: two tabs are two workers writing one
`askk` store. *(Critic :148, accepted.)* See §7.3.

**Rule 4 — crossing is always an explicit message.** No `SharedArrayBuffer`, no
`SharedWorker`, no `BroadcastChannel`, no transferables. Structured clone of
plain data, only.

---

## 4. The file map

Every directory, every file, one line each. A coder can build the tree from this
section alone. Routes and token paths are reconciled with `DESIGN.md` per §10.2.

```
next.config.ts          output:'export', trailingSlash:true, basePath from env,
                        reactStrictMode:FALSE, images.unoptimized, webpack (NOT turbopack)
package.json            scripts: dev build test types gate smoke deploy
                        deps: next react react-dom idb   (four, and no more)
tsconfig.json           strict, noUncheckedIndexedAccess, paths "@/*" -> "src/*"
public/
  seed/agents/main/agent.md    the shipped identity file, fetched at boot, copied into IDB once
  seed/models.json             the endpoint catalogue seed
```

### `src/core/` — pure, no ambient anything

```
core/ports.ts                   the Ports interface, stubPorts(), isConfigured()

core/prompt/slots.ts            the Slot integer table, and CORE_MARK (§8 bundle sentinel)
core/prompt/template.ts         the tiny {{ }} / {% if %} / {% for %} renderer, compiled once
core/prompt/component.ts        abstract Component: SLOT, FIELDS, NAME, render(), key(), applies()
core/prompt/components.ts       Soul, SystemInstructions, ContextBlock, History,
                                PhaseInstructions, ToolboxComponent, ResponseContract
core/prompt/assembler.ts        filter -> sort(SLOT,priority) -> 3 invariants -> join; memoised
core/prompt/recipe.ts           which components exist for a given agent + session

core/response/base.ts           BaseResponse: FIELDS table -> instructions(), toString(), parse()
core/response/parse.ts          the TOON and JSON scanners; neither throws out of parse()
core/response/responses.ts      the concrete response classes, their FIELDS and FORMAT_NOTES

core/tools/tool.ts              Tool + ToolResult; call() never throws; output cap + elision
core/tools/toolbox.ts           the declared set; parseBatches(); invoke()
core/tools/prompt.ts            the TOOLS block component body

core/flow/phases.ts             the Phase classes; each declares OUTCOMES [4.5]
core/flow/prompts.ts            phase instruction text, verbatim, as module constants [4.5]
core/flow/flows.ts              FLOWS + validateFlow() + FlowError + MAX_TRANSITIONS [4.5]

core/inference/base.ts          abstract Inference.infer(req, onDelta?, signal?)
core/inference/scripted.ts      concrete #1: replays a fixture; drives every host test
core/inference/openai.ts        concrete #2: /chat/completions, SSE streaming, usage accounting
core/inference/catalog.ts       kind string -> constructor

core/agent/config.ts            AgentConfig: the declared fields an agent.md can set
core/agent/agentfile.ts         frontmatter + body parser for agent.md — runs in the tab
core/agent/session.ts           the blackboard for one run
core/agent/transcript.ts        the message list the History component renders
core/agent/agent.ts             one turn: recipe -> assemble -> infer -> parse -> tools -> repeat
core/agent/react.ts             the react loop and its three-tier repeat guard
core/agent/driver.ts            walks the flow edge table [4.5]
core/observer.ts                Observer: assembled / entered / delta / results / retry / done
```

### `src/adapters/` — one real environment per port

```
adapters/browser/clock.ts       // REALM: worker  Date + Intl resolvedOptions().timeZone
adapters/browser/fetch.ts       // REALM: worker  the global fetch, narrowed to FetchPort
adapters/browser/ids.ts         // REALM: worker  crypto.randomUUID
adapters/browser/store.ts       // REALM: worker  the StorePort over engine/db.ts
adapters/test/clock.ts          // REALM: host    pinned to the golden date and its zone
adapters/test/store.ts          // REALM: host    in-memory StorePort; what wave 2 runs against
adapters/test/fetch.ts          // REALM: host    replays recorded bodies, including SSE chunks
```

*(`adapters/browser/assets.ts` is deleted. `boot` already carries `seedBaseUrl`
and `engine/boot.ts` fetches through `ports.fetch`; two mechanisms for one job
meant one was dead. Critic :220, accepted.)*

### `src/protocol/` — the vocabulary, both realms, no behaviour

```
protocol/messages.ts            ToEngine and FromEngine unions, the type-string constants,
                                and REPLY_OF: the one map pairing a request with its reply
protocol/shapes.ts              the plain-data shapes that cross: MessageRecord, PromptBreakdown,
                                ToolResultRecord, PhaseRecord, TurnSummary, ConfigRecord,
                                ProbeOutcome, RequestRecord, ToolDeclaration,
                                EventRecord and Trace (what `trace/read:ok` and
                                `session/opened.lastTrace` carry — critic :334)
```

### `src/engine/` — worker realm, every file `// REALM: worker`

```
engine/entry.worker.ts          THE worker entrypoint. Elects, builds ports, opens db, serves.
engine/host.ts                  serve(scope): the protocol switch. Every ToEngine type, one case.
engine/lease.ts                 the single-writer election (§7.3) and its failure report
engine/db.ts                    the single openDB call, the schema, upgrade, onblocked, versionchange
engine/stores/sessions.ts       session records, including status and nextTurnOrdinal
engine/stores/messages.ts       append(sessionId, record) -> seq. THE seq allocator lives here.
engine/stores/events.ts         turn events, capped by turnOrdinal range delete
engine/stores/config.ts         endpoints, keys, the active pointer
engine/stores/agents.ts         agent.md overrides
engine/boot.ts                  election, db open with a reporting deadline, first-run seeding,
                                orphan-turn reconciliation
engine/probe.ts                 the Door's endpoint probe: refused vs CORS vs http vs timeout
engine/turns.ts                 the turn queue: one live turn, abort, steer, orphan closing
engine/build-agent.ts           config record + agent.md text -> a constructed Agent
engine/observer.ts              serialises core Observer callbacks onto the wire
engine/tools/index.ts           the static table of tools this build ships, bound to ports
```

### `src/client/` — main realm, no React, every file `// REALM: main`

```
client/worker-client.ts         owns the Worker; request(msg)->Promise; subscribe(fn)
client/store.ts                 the render-shaped mirror. One switch over every FromEngine type.
client/prefs.ts                 localStorage-backed UI preferences
client/use-store.ts             the React binding (useSyncExternalStore)
```

### `src/app/` and `src/ui/` — main realm, render only

**One HTML document, six addressed surfaces.** Six `DESIGN.md` §4 destinations,
reached by `?panel=<id>` rather than by six route segments — see §10.2 ruling 4.
*(DESIGN §4 says "Five destinations" and then specifies six; see §10.2.)*

```
app/layout.tsx                  <html><body> ONLY. No manual <head>. metadata export.
app/page.tsx                    'use client'. The only route. Mounts Shell.
app/globals.css                 imports ui/tokens.css and the reset; nothing else

ui/tokens.css                   DESIGN's sole literal store (§10.2: path moved from app/)
ui/fonts/*.woff2                self-hosted IBM Plex subsets, imported so the bundler
                                rewrites the URL under basePath (§10.2 ruling 2)
ui/shell/Shell.tsx              the rail, the content column, and the persistent
                                endpoint/model/token line. Resolves the address on first render.
ui/shell/surfaces.ts            THE registry: id, label, order, component, and `address`
                                (`?panel=<id>`). A surface is one entry. Six today.
ui/surfaces/Door.tsx            DESIGN 4.1  the cold open — masthead, probe, Connect
ui/surfaces/Workbench.tsx       DESIGN 4.2  ONE scroll: the tape, composer, live prompt
ui/surfaces/Prompt.tsx          DESIGN 4.3  how the prompt was built
ui/surfaces/Context.tsx         DESIGN 4.4  the literal bytes that left the tab
ui/surfaces/Tools.tsx           DESIGN 4.5  the authoritative declaration, one row per tool
ui/surfaces/Setup.tsx           DESIGN 4.6  endpoint, key, identity file, storage
ui/tape/Tape.tsx                the spine; every row hangs off it at --rail-step
ui/tape/Row.tsx                 one row: step, elapsed, kind label, body. Eight kinds, ONE shape.
ui/tape/Caret.tsx               the amber block caret and its 1.5s stall blink
ui/prompt/BandStack.tsx         the slot-ordered band stack, shared by Prompt and Workbench
ui/primitives/*.tsx             Button, Field, Badge, Disclosure — every state renderable
```

`ui/tape/Row.tsx` renders **all eight** DESIGN §4.2 row kinds — `you`,
`thinking`, `tool →`, `tool ←`, `observation`, `answer`, `retry`, `cost` — as
one row shape on one spine. There is no separate transcript component and no
separate trace component; §10.2 ruling 6 records why that is structural rather
than a naming preference.

### `scripts/` and `tests/`

```
scripts/gate.ts                 runs every static check, one line each, non-zero on any failure
scripts/checks/purity.ts        core references no ambient global (tokeniser + allowlist)
scripts/checks/realm.ts         per-directory global allowlist, banners, the typeof ban
scripts/checks/layers.ts        the §2 import matrix, computed from real imports; type vs value
scripts/checks/protocol.ts      request/reply pairing, handler and sender coverage, protocol purity
scripts/checks/orphans.ts       every export has an importer (allowlist in §8)
scripts/checks/size.ts          function <= 40 lines; the max-lines ratchet
scripts/checks/bundle.ts        core reaches the worker chunk and no other (§8)
scripts/checks/lines.json       the ratchet state
scripts/checks/design.ts        DESIGN's static rules, as NAMED sub-checks, each with
                                its own failure message: tokens, ramp, motion, front-door
                                copy. Runs inside `bun run gate`.
scripts/browser/contrast.ts     DESIGN: rendered contrast + the ratchet         [build + browser]
scripts/browser/geometry.ts     DESIGN: radius, elevation, one-chroma-at-rest   [build + browser]
scripts/browser/coldopen.ts     DESIGN: 2 clicks local / 3 BYOK                 [build + browser]
scripts/browser/frontdoor.ts    DESIGN: expressive layer rendered, zero 404s,
                                zero cross-origin requests                      [build + browser]
scripts/serve-subpath.ts        serves out/ under /ASKK/ so the subpath failure is reproducible
scripts/smoke.ts                drives the built export: boot, turn, streamed token, reload
scripts/deploy.sh               build with basePath, publish out/ to gh-pages
tests/golden/                   the oracle. Not editable. A differing byte is the port being wrong.
tests/*.test.ts                 host tests, plain `bun test` (never --isolate; it hides failures)
```

---

## 5. The contracts

Signatures and one line of meaning. No bodies.

### 5.1 The port seam — `core/ports.ts`

```ts
interface ClockPort  { now(): Date; zone(): string }
```
Right now, and the IANA zone it is expressed in — the golden context block needs
both, and a `Date` alone cannot render `PDT`.

```ts
type FetchPort = (input: string, init?: RequestInit) => Promise<Response>
```
The only way out of the process; same signature as the global so the global can
be passed directly.

```ts
interface StorePort {
  putSession(s: SessionRecord): Promise<void>
  readSession(id: string): Promise<SessionRecord | null>
  appendMessage(sessionId: string, m: NewMessage): Promise<number>
  readMessages(sessionId: string, afterSeq?: number): Promise<MessageRecord[]>
  appendEvent(sessionId: string, turnOrdinal: number, e: NewEvent): Promise<void>
}
```
Durable memory as five verbs.

**`appendMessage` allocates the sequence number itself and returns it.** The
previous revision took a fully-formed record whose `id` embedded a `seq` the
*caller* had to compute by reading the tail — append-only at the store,
read-modify-write at the caller, and two overlapping turns interleaving at any
`await` would compute the same `seq` and silently overwrite one. That is the
exact lost-update race §3 claimed was inexpressible. *(Critic :317, accepted —
this was the most serious finding in the pass.)* Allocation now happens inside
one IndexedDB `readwrite` transaction, which is atomic; and §7.4 independently
forbids two concurrent turns on one session.

```ts
type NewIdPort = () => string
```
Ambient randomness, made explicit, so a test can produce reproducible turn ids.

```ts
interface Ports { clock: ClockPort; fetch: FetchPort; store: StorePort; newId: NewIdPort }
function stubPorts(): Ports
function isConfigured(member: unknown): boolean
```
Four members, each with a caller today. `stubPorts()` returns members that
**throw `no <name> port configured`** rather than silently no-op, and
`isConfigured` exists because `if (ports.x)` is true for a stub — that check
registered a capability that died at the call site in the old tree.

*(A `FilesPort` is deliberately absent until the first tool that reads a file
exists. No port without a caller.)*

### 5.2 The inference base — `core/inference/base.ts`

```ts
interface InferenceConfig { model: string; baseUrl: string; apiKey: string;
                            temperature: number; maxTokens: number }
interface InferenceRequest { prompt: string }
interface InferenceResult  { text: string; stopReason: string;
                             usage: { promptTokens: number; completionTokens: number } | null }
type OnDelta = (chunk: string) => void

abstract class Inference {
  constructor(config: InferenceConfig, fetchPort: FetchPort)
  abstract infer(req: InferenceRequest, onDelta?: OnDelta, signal?: AbortSignal): Promise<InferenceResult>
  abstract describeRequest(req: InferenceRequest): RequestRecord
}
```
One prompt string in, the model's whole reply out, with every partial handed to
`onDelta` as it lands. Conversation history is the caller's job — the assembler
already put it in the prompt.

`describeRequest` returns the literal body that would be sent, as data. It is
what DESIGN §4.4's Context surface renders, and it exists on the base because
"what left the tab" is a property of the wire protocol, not of the agent.

**Two deletions, both on ringmaster condition 6, both accepted:**
- `InferenceRequest.attachments` is gone. No `Attachment` type was ever defined,
  no producer and no consumer existed, and SALVAGE records remote-URL
  attachments as a **known defect** (`{data:"", format:""}`, silently broken).
  Shipping a field whose only implementation is known-broken is LESSONS defect 3
  in miniature.
- `InferenceConfig.timeoutMs` is gone. §6 forbids a timeout that cannot cancel,
  and the honest cancellation channel already exists: `turn/abort` aborts the
  real `AbortSignal` on the real `fetch`. A per-request deadline with no
  canceller would have been decoration.

```ts
function inferenceFor(kind: string, config: InferenceConfig, fetchPort: FetchPort): Inference
```
The catalogue. A new server is an entry here plus a row in `models.json`.

**The base is earned on day one by two concretes**, `ScriptedInference` (2.2)
and `OpenAiInference` (2.3). `onDelta` is not speculative: 2.3's acceptance
asserts more than one chunk.

### 5.3 The tool contract — `core/tools/`

```ts
const TOOL_OUTPUT_CAP = 8192
const TOOL_ELISION = "\n… [truncated: {n} more characters were not shown]"

class ToolResult { readonly tool: string; readonly ok: boolean;
                   readonly output: string; readonly error: string
                   readonly truncated: number
                   toString(): string }
```
One tool's answer. `output` is capped at `TOOL_OUTPUT_CAP` characters and the
overflow is replaced by `TOOL_ELISION` with the dropped count filled in.

**Why the cap is in the contract and not left to each tool** *(critic :378, a
BREAK, accepted)*: an uncapped 4MB return enters the transcript, then the
History component, then every prompt after it, forever — and compaction is
explicitly cut (§9). One tool call would make the session permanently
unrecoverable with no UI path to trim it. The elision string is **model-facing
text**: it tells the model that content was withheld rather than letting it
reason over a silent truncation.

```ts
class Tool {
  static fromFunction(fn: ToolFn, meta: ToolMeta): Tool
  readonly name: string
  usage(): string
  declaration(): ToolDeclaration      // name, description, params — for DESIGN 4.5
  call(args: Record<string, unknown>): Promise<ToolResult>
}
```
`call` **never throws** — a failure is a `ToolResult` the model reads, so the
error sentence is a product surface, not a log line.

```ts
class Toolbox {
  static of(...items: unknown[]): Toolbox
  get names(): readonly string[]
  get(name: string): Tool | null
  declarations(): ToolDeclaration[]
  component(): Component
  static parseBatches(text: string): Array<Array<[string, Record<string, unknown>]>>
  invoke(text: string, onResults?: (r: ToolResult[]) => unknown): Promise<string>
}
```
The set an agent may call. **The declaration is authoritative:** what the agent
file does not name is not present, and nothing re-registers behind it.
`parseBatches` splits on the *gaps between regex matches*, so multi-line JSON
arguments survive: commas on one line run together, a newline means "after
everything above".

**The per-turn total is explicitly NOT bounded, and that is a stated gap.**
*(Critic :547.)* The cap is per `ToolResult`; a batch of ten tools adds up to
80KB to the transcript in one turn, permanently, with compaction cut. I am not
inventing a per-turn budget to close it, because a second cap needs a policy for
what to drop when it is hit — oldest result, largest result, whole batch — and
that policy has no caller until a real agent has run real batches. What exists
instead is the observation that makes it visible: DESIGN §4.4's Context surface
renders the literal request body with a byte count per message and a total, so
transcript growth is on screen rather than discovered at a context-limit error.
The bound arrives with compaction, or with a measured turn that needs it.

Only `Tool.fromFunction` exists at first. `fromAgent` and `fromMcp` arrive with
their second and third callers or never.

### 5.4 The response base — `core/response/base.ts`

```ts
interface FieldSpec { name: string; description: string; list?: boolean; default?: string }

abstract class BaseResponse {
  static FIELDS: readonly FieldSpec[]        // ORDER MATTERS — it is the prompt order
  static ANSWER_FIELD: string
  static instructions(fmt?: Format): string
  static formatNotes(): string
  static parse<T>(this: Ctor<T>, raw: string, fmt?: Format): T
  static normalize(values: Values): void
  toString(fmt?: Format): string
  get answer(): string
}
```
**The field table IS the contract**: one declaration produces the prompt
instructions, the parse target and the routing input. `parse` never throws —
the requested format, then the other, then the whole reply lands in the answer
field. `normalize` fails toward the *careful* branch.

### 5.5 The component base — `core/prompt/component.ts`

```ts
const Slot = { SOUL: 0, SYSTEM: 10, CONTEXT: 20, SKILLS: 30,
               PHASE: 40, HISTORY: 50, TOOLS: 60, RESPONSE: 99 } as const

abstract class Component {
  static SLOT: number
  static TEMPLATE: string
  static CACHEABLE: boolean       // false for CONTEXT — a cached clock is a wrong clock
  static FIELDS: readonly string[]
  static NAME: string             // written out; a minifier may rewrite constructor.name
  render(): string                // "" means nothing to say, and the assembler drops it
  key(): string                   // content hash; same key means same bytes
  applies(): boolean
}
```
A prompt part. Immutable, rebuilt each turn from the session, holds no live
state — which is what makes `key()` honest.

```ts
class PromptAssembler {
  assemble(components: Component[]): string
  detail(components: Component[]): { prompt: string; breakdown: PromptBreakdown }
}
```
Filter the empty, sort on `(SLOT, priority)`, check three invariants, join with
no separator. **Raises, never repairs**: exactly one RESPONSE component, at
least one SOUL or SYSTEM, and RESPONSE sorts last. `detail` returns plain data —
that is why the breakdown crosses the worker boundary unchanged, and why
`PromptBreakdown.build` can carry the bundle sentinel (§8).

### 5.6 The phase and flow tables — `core/flow/`  *(increment 4.5)*

```ts
abstract class Phase {
  static OUTCOMES: readonly string[]        // every name this phase can return
  readonly name: string
  run(agent: Agent, session: Session): Promise<string>   // returns an OUTCOME, never a next phase
}

type Flow = { entry: string; edges: Record<string, Record<string, string | null>> }
const FLOWS: Record<string, Flow>
function getFlow(name: string): Flow
function validateFlow(flow: Flow, phases: PhaseTable, label?: string): Flow
class FlowError extends Error
const MAX_TRANSITIONS = 64
```
A phase returns an outcome name; the table maps `(phase, outcome) → next`.
`null` is a **declared** terminal. `validateFlow` proves four things at load:
every target exists and has its own edges, every declared outcome has an edge,
no edge names an outcome the phase cannot return, and every phase is reachable.

**This entire module arrives in increment 4.5, not 2.4** *(ringmaster condition
5, accepted — I wrote the indictment myself and then ignored it)*. A flow table
with one flow in it is a table with nothing to decide; the second flow is what
earns `validateFlow`. Increment 2.4 ships `core/agent/react.ts` and a loop that
ends on a declared terminal, with no `FLOWS`, no `driver.ts` and no
`MAX_TRANSITIONS`.

### 5.7 The worker message protocol

§6. It has its own section because it is the seam most likely to rot.

### 5.8 The storage stores — `engine/stores/*`

Each store module exposes the same four-verb shape:

```ts
put(record: R): Promise<void>
get(key: string): Promise<R | null>
list(query?: Q): Promise<R[]>
remove(key: string): Promise<void>
```

`messages.ts` replaces `put` with `append(sessionId, record): Promise<number>`
and has **no whole-list write at all**, so the read-modify-write cannot be
reintroduced. `events.ts` replaces `remove` with `pruneBefore(sessionId,
turnOrdinal)`, a single range delete.

---

## 6. The worker protocol

One `MessagePort`. Requests carry an `id` and get exactly one reply with the
same `id`. Events carry no `id` and are never awaited.

### 6.1 One vocabulary, one table

The previous revision listed replies only in prose and omitted every one of them
from the `FromEngine` union — while `checks/protocol.ts` derived its universe
from `FromEngine`. Eight of the most-used messages in the system were therefore
unchecked by the check that exists precisely to catch declared-but-never-emitted
messages, *inside that check's own table*. *(Critic :536, accepted; this was the
sharpest finding of the pass.)*

`protocol/messages.ts` now holds **one** list. Every request names its reply in
a single map, and both unions are derived from it:

```ts
const REPLY_OF = {
  'boot':          'ready',
  'config/list':   'config/listed',
  'config/set':    'config/ok',
  'config/probe':  'config/probed',
  'agent/get':     'agent/got',
  'agent/put':     'agent/ok',
  'session/open':  'session/opened',
  'tools/list':    'tools/listed',
  'trace/read':    'trace/read:ok',
  'turn/start':    'turn/started',
  'turn/steer':    'turn/steered',
  'turn/abort':    'turn/abort:ok',
} as const
```

`failed` is the universal alternative reply to any request. `checks/protocol.ts`
asserts that every value of `REPLY_OF` is a member of `FromEngine`, every key is
a member of `ToEngine`, and both unions have no member outside this map plus the
unsolicited-event list below.

### 6.2 Main → worker (`ToEngine`)

| type | payload | reply |
|---|---|---|
| `boot` | `{ seedBaseUrl }` | `ready { schemaVersion, configured, activeSessionId }` |
| `config/list` | `{}` | `config/listed { records, activeKey }` — `apiKey` replaced by `hasKey: boolean` |
| `config/set` | `{ record }` | `config/ok { key }` |
| `config/probe` | `{ baseUrl, apiKey?, kind }` | `config/probed { outcome, models, elapsedMs, detail }` |
| `agent/get` | `{ name }` | `agent/got { name, text }` |
| `agent/put` | `{ name, text }` | `agent/ok { name }`; a frontmatter error returns `failed` with the parser's own words |
| `session/open` | `{ id: string \| null }` | `session/opened { session, messages, lastTrace }` |
| `tools/list` | `{ agent }` | `tools/listed { declarations }` |
| `trace/read` | `{ sessionId, turnOrdinal }` | `trace/read:ok { events }` |
| `turn/start` | `{ sessionId, text }` | `turn/started { turnId, turnOrdinal }`, then the event stream |
| `turn/steer` | `{ turnId, text }` | `turn/steered { turnId }` |
| `turn/abort` | `{ turnId }` | `turn/abort:ok { turnId }` |

`config/probe` exists because the main realm **cannot** fetch — `client` and
`ui` may not import `adapters`, and DESIGN §4.1's Door is built entirely on a
probe result. Without it the Door is unbuildable and NORTH-STAR's cold-open
test has no wire. *(Ringmaster condition 3 and critic :522, both accepted.)*
`ProbeOutcome` is a closed union: `'ok' | 'refused' | 'cors' | 'http' | 'timeout'`.
The distinction is load-bearing: DESIGN §4.1 requires that connection-refused
and CORS-blocked never collapse into "could not connect", because they have
different remedies and only one of them is the user's fault. `elapsedMs` is
what the Door's *Loading* state prints instead of a spinner.

`turn/steer` exists because DESIGN §4.2's Streaming state keeps the composer
live so the operator can steer mid-flight. *(Critic :536 major, accepted.)*
Steer text is appended to the live session as an interjection; it does not
restart the turn.

**Its reader is named, and it is not a phase.** `core/agent/react.ts` drains the
interjection at the top of each loop iteration and renders it as a `you` row on
the tape. Phases moved to 4.5, so "the next phase reads it" — what the previous
revision said — would have left `turn/steer` with a handler and no consumer
between 3.2 and 4.5, satisfied by protocol rule 3 appending to a field nobody
reads. That is LESSONS defect 6 with a check green over it. *(Critic :746,
accepted.)* `turn/steer` lands with the react loop's own increment, and if the
loop cannot drain it there, the message does not ship until it can.

### 6.3 Worker → main (`FromEngine`)

Replies — one per row of `REPLY_OF`, listed above. Plus these unsolicited events:

| type | payload | when |
|---|---|---|
| `fatal` | `{ reason, message }` | the worker cannot continue. `reason` is a closed union: `'another-tab' \| 'storage-blocked' \| 'schema' \| 'internal'` |
| `failed` | `{ id, message }` | a request could not be served |
| `log` | `{ level, message }` | worker warnings; a worker's `console.warn` lands where no user looks |
| `turn/prompt` | `{ turnId, phase, breakdown }` | **before** inference — the bands appear, then the answer arrives against them |
| `turn/request` | `{ turnId, request }` | the literal body about to be sent; DESIGN §4.4's Context surface |
| `turn/phase` | `{ turnId, phase, round }` | at phase *entry*, so `verify→plan` and `verify→respond` are distinguishable |
| `turn/delta` | `{ turnId, seq, text }` | every partial token, as it lands |
| `turn/retry` | `{ turnId, attempt, reason }` | the repeat guard scolded, or a phase looped. DESIGN §4.2's `retry` row |
| `turn/message` | `{ turnId, message }` | a message was appended **and persisted**; carries the allocated `seq` |
| `turn/tool` | `{ turnId, results }` | per **batch**, the moment that batch lands |
| `turn/done` | `{ turnId, answer, usage, ms }` | the run finished. DESIGN §4.2's `cost` row |
| `turn/aborted` | `{ turnId, ms }` | the run was stopped by `turn/abort` |
| `turn/failed` | `{ turnId, message }` | the run ended without an answer, and not by request |

**`turn/aborted` is a distinct terminal.** *(Critic :559, accepted.)* An
`AbortError` out of `infer` is not a failure — collapsing the two would paint
DESIGN §4.2's spine `--fail` for something the operator chose, and would make
"did it break or did I stop it" unanswerable after a reload.

### 6.4 What may cross

Structured-cloneable plain data only: objects, arrays, strings, numbers,
booleans, `null`, `Date`, `ArrayBuffer`. **Not:** class instances (the prototype
does not survive; a parsed response arrives as its data), functions, `Error`
objects (they cross as `{ name, message }`), transferables,
`SharedArrayBuffer`, DOM nodes. `engine/observer.ts` is the one place that
flattens live core objects into wire shapes, so the core never has to know the
wire's constraint and the wire never has to know the core's classes.

### 6.5 Errors, and the one rule about deadlines

- A handler that throws is caught in `engine/host.ts` and returned as `failed`
  or `turn/failed`. The worker never dies from a handled path.
- `worker.onerror` on the main side **rejects every in-flight request** with
  `worker stopped`. A dead worker's replies are never coming, and pretending
  otherwise hangs the UI forever.
- **A deadline that reports is not a race that pretends to cancel.** The
  previous revision banned "timeouts" outright and thereby banned the one thing
  `boot` needed. *(Critic :522, accepted.)* The distinction:
  - **Permitted — a reporting deadline.** It does not claim to stop the
    operation; it emits a message saying the operation has not answered, and
    names what to do. `boot` has one: if the database has not opened in
    `BOOT_DEADLINE_MS` (5000), the worker emits
    `fatal { reason: 'storage-blocked' }` and MAIN renders a real failure with
    the remedy (close the other tab). Without it, an `openDB` that fires
    `blocked` leaves a blank shell forever with no message — which is a page
    that renders and does nothing, this project's signature failure.
  - **Forbidden — a cancellation that cancels nothing.** `Promise.race` against
    a timer, presented as aborting the work. Powerhouse shipped exactly that and
    the runaway kept running. Real cancellation goes through
    `AbortController` on the real `fetch`, and nowhere else.

### 6.6 Enforcement

`scripts/checks/protocol.ts`. **How the members are enumerated is the
load-bearing step and it is named here, because every rule below depends on
it:** the check runs a **TypeScript AST pass over the `ToEngine` and `FromEngine`
union declarations** and reads each member's `type` literal off the declared
type. It does **not** grep string literals out of `messages.ts`.

That distinction is the whole difference between a check and a tautology. If the
members were grepped from the same file `REPLY_OF` lives in, rule 1 would
compare the file to itself and pass no matter what either contained. *(Critic
:825, accepted — and this is the condition on which my no-codegen refusal in
§10.4 stands or falls: a hand-written `REPLY_OF` is equivalent to a generated one
**only** while the members it is checked against come from the type
declarations. Grep the literals and the refusal becomes indefensible.)*

1. `REPLY_OF`'s keys are exactly `ToEngine`'s members; its values are all in
   `FromEngine`.
2. Every `ToEngine` member appears as a `case` in `engine/host.ts` whose body is
   **non-empty**.
3. Every `FromEngine` member is constructed somewhere in `src/engine/**` **and**
   appears as a `case` in `client/store.ts` whose body **writes to the store's
   state object**. The previous formulation ("constructed somewhere and handled
   somewhere") was satisfiable by an empty case or by the type string appearing
   in a comment. *(Critic :563, accepted.)*
4. `src/protocol/**` contains no `function`, `class`, `let`, `var` or `new`, and
   every exported value is `as const`. §2 rests the whole realm split on
   protocol holding no mutable state; a keystone with no check violated §8's own
   opening rule. *(Critic :69, accepted.)*

A declared-but-never-emitted event is this project's recurring defect, recorded
three separate times, and this check is the only thing that has ever caught it.

---

## 7. Storage schema

One database, `askk`, version 1. Opened exactly once, in `engine/db.ts`, in the
worker realm, by the elected writer.

### 7.1 Stores

| Store | keyPath | Indexes | Holds |
|---|---|---|---|
| `meta` | `key` | — | `{key:'schema',version}`, `{key:'seeded',at}`, `{key:'activeSession',id}` |
| `config` | `key` | — | `{ key, label, kind, baseUrl, model, api, apiKey, temperature, maxTokens, isActive }` |
| `agents` | `name` | — | `{ name, text, updatedAt }` — the user's `agent.md`, overriding the seed |
| `sessions` | `id` | — | `{ id, agent, createdAt, updatedAt, status, runningTurnId, nextSeq, nextTurnOrdinal }` |
| `messages` | `id` | `bySession` on `[sessionId, seq]` | `{ id, sessionId, seq, role, content, turnId, at }` |
| `events` | `id` | `byTurn` on `[sessionId, turnOrdinal, seq]` | `{ id, sessionId, turnOrdinal, seq, kind, data, at }` |

### 7.2 What the schema itself enforces

- **`messages` is append-only, and the store allocates.** `id` is
  `` `${sessionId}:${String(seq).padStart(6,'0')}` ``. `append` opens one
  `readwrite` transaction over `sessions` and `messages`, reads `nextSeq`,
  writes the record and the incremented counter, and returns the seq. There is
  no code path that reads the whole transcript to write one message, and no
  caller that computes a seq.
- **`events` is capped by a computable range.** The cap was previously stated as
  "older than the most recent 200 turns", which was uncomputable from the schema:
  `turnId` is a UUID and `at` was unindexed, so it required the full scan the cap
  exists to prevent. *(Critic :591, accepted.)* `sessions.nextTurnOrdinal` is a
  monotonic integer, `events` is indexed on `[sessionId, turnOrdinal, seq]`, and
  the prune is one `IDBKeyRange.bound` delete below
  `nextTurnOrdinal - EVENT_CAP_TURNS` (200). The old tree once wrote 39,237
  event records at boot; a bounded store is the difference between a page that
  opens and one that does not.
- **`apiKey` never leaves the worker.** It is in IndexedDB and nowhere else —
  never in a URL, never in `localStorage`, never in a query string.
  `config/listed` replaces it with `hasKey: boolean`. Per NORTH-STAR there is no
  server to hide it behind, and that is a feature; keeping it out of the render
  realm is the least we can do.
- **No store without a reader.** There is no `skills`, `spaces`, `cron_jobs` or
  `layouts` store. Powerhouse had all four and read none.
- **No index without a query.** `sessions.byUpdated` is gone with
  `session/list` (§9).

UI preferences (`localStorage`, key `askk.prefs`): theme, dense/expanded,
composer draft. Losing them costs nothing, which is why they are not here.

### 7.3 Two tabs — the single-writer election

Two tabs are two workers writing one database. *(Critic :148, accepted.)*

`engine/lease.ts` requests an exclusive Web Lock named `askk.writer` with
`{ ifAvailable: true }` **before** opening the database. If the lock is not
granted, the worker emits `fatal { reason: 'another-tab' }` and opens nothing;
MAIN renders "this agent is open in another tab" with the tab it should return
to. For a one-person tool this is the correct trade: a hard, legible refusal
beats a merge protocol nobody will read.

**How the lock is held, stated as a mechanism because it is not the obvious
one.** `navigator.locks.request(name, options, callback)` **releases the lock
when the callback's returned promise settles** — not when the tab closes. An
implementer who writes the obvious thing:

```ts
await navigator.locks.request('askk.writer', { ifAvailable: true }, async (lock) => {
  if (!lock) return report('another-tab')
  await openDatabase()            // WRONG: the lock releases here
})
```

releases the lock the instant the database is open, and the second tab is then
granted it and writes. The election must instead hold a promise that **never
resolves for the worker's life**:

```ts
navigator.locks.request('askk.writer', { ifAvailable: true }, (lock) => {
  if (lock === null) { report('another-tab'); return Promise.resolve() }
  ready(); return new Promise<never>(() => {})   // held until the tab is destroyed
})
```

The lock is then released by the browser when the worker's realm is torn down,
which is the behaviour §7.3 wants: no stale-lease cleanup, no heartbeat, no
reconciliation, and the second tab works as soon as the first is closed.

> **A correction to my own reading of MEASURED M5.** I cited the probe as
> evidence the election works. It is not: the probe's callback *returned*, so
> the lock released, which is precisely why its subsequent `{ifAvailable:true}`
> request was granted. M5 proves the three **API behaviours** are present in a
> classic worker under the subpath export — that is all it proves, and it is
> what §7.3 needs from it. It does not prove the election, because the probe
> did not implement the election. *(Critic, accepted; this would have shipped a
> broken election with a measurement cited in its defence, which is worse than
> shipping it with none.)*

PLAN 1.5 therefore asserts the never-resolving hold specifically: a second
`{ifAvailable:true}` request made **while the first callback is still pending**
must receive `null`.

`engine/db.ts` additionally handles the two IndexedDB events that exist for this:
`onblocked` (another connection is holding an old version open) emits
`fatal { reason:'storage-blocked' }`, and `onversionchange` closes the connection
and emits `fatal { reason:'schema' }` rather than letting writes fail silently.

**Measured, not assumed.** MEASURED M5 ran this in the classic worker of a
`basePath=/ASKK` static export and got all three behaviours the election needs:

```
{"hasLocks":true, "lockAcquired":true, "ifAvailable":true,
 "lockSteal":"correctly-null-when-held"}
```

`navigator.locks.request` grants in a worker; `{ifAvailable:true}` grants when
the lock is free; and `{ifAvailable:true}` yields **`null`** when it is already
held rather than granting twice or blocking. That third one is the whole
mechanism — it is how the second tab learns it is not the writer without waiting
forever. PLAN 1.5's probe asserts all three so a browser regression is caught.

### 7.4 One turn at a time, and orphan turns

- **`turn/start` on a session with `status:'running'` returns `failed`** with
  "a turn is already running on this session". Serialising turns is not a
  limitation to apologise for; it is what makes a single transcript coherent.
- **A tab closed mid-stream leaves an orphan.** Deltas were rendered but never
  persisted, so the last durable record is the user's message and the trace
  starts and never ends — indistinguishable from a turn still running.
  *(Critic :529, a BREAK, accepted.)* The session record carries `status` and
  `runningTurnId`. On `session/open`, any session found `running` is closed: an
  `aborted` event is appended to its trace, `status` returns to `idle`, and
  `session/opened` carries the reconciled state. The UI therefore shows a turn
  that was interrupted, labelled as interrupted, rather than a spinner that
  never resolves.

---

## 8. The rules that are checked

`bun run gate` runs the static checks; the three browser checks run in the
deploy path beside the smoke check. **A claim the gate cannot execute is not a
verified claim** — so each rule names its check, or is marked **UNENFORCED** in
plain words.

| Rule | Check |
|---|---|
| Core references no ambient global | `checks/purity.ts` — tokeniser + free-identifier allowlist (§2.1) |
| Per-directory global allowlist; realm banners; the `typeof` ban | `checks/realm.ts` (§3.5) |
| The §2 import matrix holds, `import type` distinguished from value imports, no cycles | `checks/layers.ts` |
| `src/protocol/**` has no behaviour and no mutable state | `checks/protocol.ts` rule 4 |
| Request/reply pairing; every `ToEngine` handled; every `FromEngine` emitted **and** consumed into client state | `checks/protocol.ts` rules 1–3 |
| Core and engine never reach the main realm | **`checks/layers.ts`** on the `ui ↮ core` / `client ↮ core` edges is the primary; `checks/bundle.ts` corroborates against the built artifact (§8.1) |
| No exported symbol without an importer outside its own file | `checks/orphans.ts` — allowlist below |
| No function longer than 40 lines | `checks/size.ts` |
| The largest file only ever gets smaller | `checks/size.ts` ratchet, **seeded at the end of wave 2** — see §8.3 |
| **`stubPorts()` throws the named message for every member** | `tests/ports.test.ts` — four members, four assertions on the literal string `no <name> port configured` |
| Golden prompts reproduce byte for byte, and the fixtures themselves have not drifted | `tests/golden/` + an md5 assertion per fixture |
| The static export builds and contains no server code | `scripts/gate.ts`: `bun run build`, then assert `out/` has no server bundle |
| The export loads clean from a subpath, and the worker chunk resolves | `scripts/serve-subpath.ts` + `scripts/smoke.ts` — zero console errors, no 404 |
| A turn renders a streamed token in the **built** export | `scripts/smoke.ts` |
| DESIGN's static rules — tokens, type ramp, reduced motion, front-door copy | `checks/design.ts`, as **named sub-checks each with its own failure message** (§10.2 ruling 3) |
| Every surface is reachable by its address before first paint | `checks/design.ts` — every `surfaces.ts` entry's `address` is asserted unique, and `scripts/browser/*` navigate by it (§10.2 ruling 4) |
| DESIGN's rendered rules — contrast + ratchet, geometry, cold-open click budget, front-door layer, **zero 404s and zero cross-origin requests** | `scripts/browser/{contrast,geometry,coldopen,frontdoor}.ts` — **separately invocable, NOT part of `bun run gate`**; they need a build and a browser and run in the deploy path beside the smoke check |

### 8.1 The bundle check, rewritten against the measurement

The previous formulation was unimplementable three ways over, and MEASURED
confirmed two of them as fact. The emitted chunk layout of a `basePath=/ASKK`
export is:

```
chunks/255-*.js  chunks/424.fbafab08f76007f8.js  chunks/4bd1b696-*.js
chunks/app/_not-found/page-*.js   chunks/app/layout-*.js   chunks/app/page-*.js
chunks/framework-*.js  chunks/main-*.js  chunks/main-app-*.js
chunks/pages/_app-*.js  chunks/pages/_error-*.js  chunks/polyfills-*.js  chunks/webpack-*.js
```

- **The glob was non-recursive.** `chunks/*.js` misses `chunks/app/**` entirely —
  which is exactly where a `ui → core` leak lands. *(Critic :622, confirmed by
  measurement.)* The check now walks `out/**/*.js` recursively and **prints the
  full list of files it scanned**, so a build that silently relocates chunks
  produces a visibly different scan rather than a silent pass.
- **The worker chunk has no name.** It is `chunks/424.<hash>.js`, a bare numeric
  id, in the same directory as everything else. *(Critic :622, confirmed.)* It
  is therefore identified **by content, not by path**: `engine/entry.worker.ts`
  contains `WORKER_MARK`, a string literal it posts in its `ready` payload, and
  the worker chunk is defined as the unique file containing it. If zero or more
  than one file contains `WORKER_MARK`, the check **fails** — it never falls
  back to passing.
- **The sentinel was caught between three checks.** Unexported it is
  unreachable; exported-and-unimported it fails `checks/orphans.ts`;
  exported-imported-but-unused it is **tree-shaken out**, leaving the check green
  while core is bundled — the worst outcome available. *(Critic :622, accepted;
  and MEASURED's closing note says the same thing.)* `CORE_MARK` is therefore a
  value the assembler **returns**: `PromptAssembler.detail()` writes it into
  `PromptBreakdown.build`, which crosses the wire and is rendered by DESIGN
  §4.3's band stack footer. It cannot be shaken because it is used, and it
  cannot be renamed because it is a string literal.
- **`WORKER_MARK` lives in `engine/entry.worker.ts` and nowhere else.** It is
  orphan-allowlisted (§8.2), which makes its home load-bearing: put it in
  `protocol/` — the natural place for a shared constant — and **both** realms
  contain it, so "two candidates" trips on every correct build forever. The main
  side never compares against it; `client/worker-client.ts` treats `ready` as
  the handshake and does not inspect a mark. *(Critic :1002, accepted.)*

**The assertion, restated twice — because the first version was both too narrow
and too brittle.**

*Too narrow:* `CORE_MARK` proves `PromptAssembler` reached a chunk, not that
**core** did. A leak importing anything else — `Slot`, `TOOL_OUTPUT_CAP`,
`parseBatches` — shakes the assembler away and the check goes green with core
sitting in `chunks/app/page-*.js`. This is not hypothetical: **DESIGN §4.3
requires every band to show its slot number, so
`import { Slot } from '@/core/prompt/slots'` in `ui/prompt/BandStack.tsx` is the
single most likely leak in this tree — and one mark cannot see it.** *(Critic,
accepted.)*

*Too brittle:* "exactly the singleton set" fails on a **correct** build.
webpack's `splitChunks` applies to worker compilations too, so a core module
shared between the worker entry and a vendor chunk legitimately puts `CORE_MARK`
in two files. A check that fails on a correct build gets weakened in wave 3, and
that is how checks die. *(Critic, accepted.)*

So:

1. **`checks/layers.ts` is the primary and it is authoritative.** The `ui ↮ core`
   and `client ↮ core` edges are proved from the **import graph of the source**,
   where every import is visible whatever the bundler later does with it. A leak
   is caught here, by name, at the offending file and line.
2. **`checks/bundle.ts` is a corroborator, not the primary.** Its job is to
   catch the case the source graph cannot see — a transitive path through a
   dependency, or a bundler behaviour that contradicts the graph. Its assertion
   is now **reachability, not identity**: `CORE_MARK` must appear in **no file
   reachable from the main entry**, computed from the build manifest's entry →
   chunk mapping rather than from a set comparison. Files reachable only from
   the worker entry are not scanned for it, so `splitChunks` cannot fail the
   check.

Stated plainly, because a check whose declared job exceeds its reach is the
false-green class this whole document is written against: **the bundle check
alone does not prove core stayed out of the page.** It proves one specific
symbol did. `checks/layers.ts` is what proves the rule; `checks/bundle.ts` is
what proves the build did not quietly disagree with the source.

### 8.2 `checks/orphans.ts` and its allowlist

An orphan check with no allowlist red-flags the framework's own entrypoints and
gets weakened in wave 1 — which is how a check dies. *(Critic :624, accepted.)*
The allowlist is closed, is named here, and any addition to it is a ruling:

`src/app/**/page.tsx` default export · `src/app/layout.tsx` default export and
`metadata` · `src/engine/entry.worker.ts` (reached by `new URL`, never imported)
· `next.config.ts` default export · `CORE_MARK` and `WORKER_MARK` (§8.1) ·
anything under `tests/`.

### 8.3 What replaces the 200-line file rule

The old tree capped files at 200 lines. Measured result: **relocation, not
simplification** — `git ls-files` shows **10** files sitting at exactly 200
lines, and one class spread across six files with a header explaining why. *(The
previous revision said "nine". The critic measured 10 and was right; the count
is evidence for a ruling and a wrong count is a wrong ruling.)*

The replacement:

- **The 40-line function rule is kept unchanged.** It did its job and its failure
  mode is extraction, which is the thing we wanted.
- **`max` — the largest single file's line count — is a ratchet that only goes
  down.** It is recorded in `scripts/checks/lines.json`. `checks/size.ts` ships
  at 1.6 and **reports** `max` from then on, but the ratchet **arms at the end of
  wave 2**, seeded from a tree that contains real modules.

  *Seeding it at 1.6 would have reintroduced, for `max`, the exact defect I had
  just diagnosed for `total`.* Wave 1 is ~500 lines of scaffold, so the seed
  would be whatever the largest gate or smoke file accidentally is — and every
  later increment (2.6 at +520, 3.4 at +420, 6.3 at +560) would then either
  contort under an accident or raise the ratchet on arrival, which is a ratchet
  that ratchets nothing. *(Critic :1018, accepted. Diagnosing a defect and then
  committing it one paragraph later is worth recording as its own kind of
  mistake: the fix for `total` was reasoned about in isolation instead of being
  applied to every number in the section.)*
- **`max` can be satisfied by sharding, and I am striking the claim that it
  cannot.** *(Ringmaster condition 7, accepted — splitting a 300-line file into
  two 150s lowers `max` by 150 and that is exactly the relocation the old rule
  produced.)* `max` is a weak signal that prevents one unreadable monolith and
  nothing more. The force against sharding is the critic and the retro's
  standing requirement that a retro which deletes nothing did not happen. Said
  plainly so nobody mistakes the check for the discipline.
- **`total` is not a ratchet.** Claiming it "may only go down" across waves 2–6,
  whose entire purpose is to add source, would mean hand-rewriting the number
  every increment — a logbook wearing a check's clothes. *(Critic :626,
  accepted.)* Instead `checks/size.ts` **reports** `total` and its delta since
  the last recorded value, and each increment **declares its line budget in
  PLAN**; exceeding a declared budget is a ringmaster conversation, not a gate
  failure.
- `total` counts `src/**` **and** `scripts/**`. **Relocating source out of those
  two directories to move the number is a violation**, named here so it cannot
  be discovered as a loophole later. *(Ringmaster condition 7.)*
- A file over 300 lines prints an advisory with its count. It does not fail.

### 8.4 UNENFORCED, stated plainly

- **That prompt text is copied character-for-character from its source.**
  Restated honestly *(ringmaster condition 8)*: this is **enforced wherever a
  golden fixture reaches** — the four files in `tests/golden/` pin the assembled
  prompt, the react loop and the response instructions byte for byte, and an
  md5 assertion stops the fixture itself from drifting. It is **unenforced
  beyond that reach**: phase prompt bodies with no golden, tool descriptions, and
  the error sentences tools return. Extending golden coverage is the only thing
  that shrinks this gap.
- **That a status flag has a test producing its failure value.** Reviewed by the
  critic per increment. LESSONS defect 8.
- **That a new assertion has been watched to go red.** Reviewed by the
  ringmaster per increment. LESSONS defect 7.
- **The DESIGN items DESIGN §9 itself marks unenforced** — five named states per
  surface, `data-bytes` application, the identity test, copy quality.

*"A stub never reports success" has been moved out of this list and into a named
host test* (§8 table). *(Ringmaster condition 8, accepted.)* It is LESSONS
defect 3 — the worst artifact this project can produce — and leaving the worst
defect class in the unenforced pile while checking file lengths was the wrong
allocation of the gate's attention.

---

## 9. What is deliberately not here

| Not here | Reason |
|---|---|
| `core/index.ts` or any barrel | Defeats tree-shaking, and it existed for a Python `__init__.py` problem we do not have. Deep paths. |
| A shared event-bus module | The exact shape of a realm-duplicated singleton. Engine events cross as messages; the UI has its own store. |
| A main-thread engine fallback | A fallback is how a broken worker path goes unnoticed. |
| `session/list`, the `byUpdated` index, and multi-session switching | No PLAN increment and no NORTH-STAR test. The test is *reload*, not session switching. `meta.activeSession` is enough to reopen the one session. *(Critic drift finding :528, accepted — cut all three.)* |
| `space.js` / a shared board | ~200 lines and ~22 lines of every prompt's budget for something nothing else writes to. **Unpaid-for.** |
| `schedule.js` + cron adapters (~540 lines) | Machinery with no caller in one tree, four cron tools with no scheduler in the other. Rules and return strings are recorded in SALVAGE. |
| MCP transport / `Tool.fromMcp` | No transport exists in a static page. A named constructor with no transport is a declaration with no consumer. |
| Sub-agents, a registry, one worker per agent | One agent, one worker. The second agent earns the registry. |
| Skills (`SKILL.md`, catalog, two-stage disclosure) | A good idea with no consumer in waves 1–4. **Stated exception:** `Slot.SKILLS = 30` stays in the table with no consumer, so that skills returning later does not renumber every slot and invalidate every golden prompt. This is a knowing, named violation of "no declaration without a consumer" — one integer, recorded here so it is not discovered as hypocrisy. *(Critic :673, accepted as a stated exception.)* |
| Compaction | Belongs after real token accounting. The old trigger was **message count**, which was wrong, and rebuilding it wrong is worse than not having it. §5.3's output cap is what keeps a session recoverable meanwhile. |
| Attachments / multimodality | SALVAGE records the only implementation as silently broken. |
| A per-request inference timeout | §6.5. Real cancellation is `AbortController`; anything else is decoration. |
| A `FilesPort` | No caller until the first file-reading tool. |
| An `Anthropic` inference concrete | Two concretes earn the base. A third is a catalogue entry when someone needs it. |
| Runtime module loading in the worker | MEASURED M2: webpack emits a **classic** worker. Not a preference — the toolchain does not offer it. |
| The sandbox / WASM container | PLAN 5.1 exists to *decide it on measured evidence*. Designing it now would invent the answer before the measurement. Until then the harness has no sandbox and **says so to the model** — an unimplemented capability is absent, never stubbed. *(MEASURED M4 notes `c2w` is on PATH but a prior finding records Homebrew's build as broken; presence is not proof.)* |
| `reactStrictMode: true` | Previously observed to stop this build flushing passive effects. |
| A manual `<head>` in `app/layout.tsx` | Previously observed to stop Next's client runtime entirely. |
| COOP / COEP headers | Set for a `SharedArrayBuffer` runtime that did not exist, and they silently kill cross-origin subresources. They arrive with a real WASM runtime or not at all. |
| CDN fonts | Airplane test, and they die under COEP. Self-hosted subsets, per DESIGN §3.4. |
| Turbopack | MEASURED used webpack. See §11. |
| `bun test --isolate` | Measured to **hide** failures plain `bun test` shows. |

---

## 10. Rulings

### 10.1 TypeScript, and the honest cost

The previous revision argued this against "~1,400 lines". That number was wrong
and the critic was right to challenge it. Measured with `wc -l` over the twenty
files SALVAGE marks "copy nearly verbatim":

```
total lines                                    2884
  comment / JSDoc lines                        1172   (41%)
    of which carry a JSDoc type tag             359   (@param @returns @type @typedef @template @this)
  blank                                         259
  code                                         1453
```

**Ruling: TypeScript.** The subject of the transliteration is 2884 lines, not
1400 — twice what I claimed. What the number changes is the *shape* of the
argument, not its conclusion:

- **359 of those lines are deleted outright.** They exist only to carry a type
  that TypeScript writes inline in the signature. That is 12% of the file that
  disappears rather than being converted, and it is the most error-prone 12% —
  the old tree needed `@this {(new (data?: Record<string, unknown>) => T) &
  typeof BaseResponse}` to type one static method.
- **1453 lines of real code get transliterated.** This is the actual cost and it
  is real. It is also mostly mechanical: JS class bodies with the JSDoc stripped
  and the types moved inline.
- **The two seams this design leans hardest on are the two JSDoc is worst at.**
  A discriminated union of 25 message types with exhaustiveness checking, and a
  layer boundary that must distinguish `import type` from a value import
  (§2). Both are load-bearing against real defects; both are cheap in TS and
  expensive in JSDoc.
- **The risk is prompt bytes**, and the mitigation is that the golden fixtures
  land **before 2.5**, not 2.6 *(critic :698, accepted)*, so the first
  transliterated prompt-bearing module is written against a live oracle.

Recorded honestly: had the salvage been 2884 lines of *code* rather than 1453,
I would have ruled checked JS and kept the files. It is not, so I did not.

### 10.2 ARCHITECTURE vs DESIGN — who yields, in writing

Both documents are law in their own domain. *(Ringmaster condition 4, critic
:267/:270/:272.)* The ui-director replied to the first draft of this section
before I ruled — yielding on four points and defending two — so what follows is
a decision rather than a collision. The governing principle:

> **DESIGN rules what surfaces exist, what they show, and what they look like.
> ARCHITECTURE rules where files live and what crosses the wire.**

Six rulings.

**1. Tokens live at `src/ui/tokens.css`. DESIGN yielded; taken.** `src/app/` is
a Next route segment and a stylesheet there is a routing artifact. DESIGN will
update its four references and its grep target.

> **Recorded as a caught defect, because it is the more valuable half of this
> exchange.** DESIGN §9's `check-tokens.js` greps `app/`. Once tokens moved to
> `ui/`, that check would have scanned a directory containing no tokens and
> **passed with every colour literal in the tree** — LESSONS defect 7, a test
> that cannot fail, reproduced inside the enforcement section of the document
> whose whole thesis is that a rule the build cannot execute stops applying.
> Found by the ui-director in its own work. The general lesson: **moving a file
> silently re-aims every check that names its directory**, and a path change is
> therefore a check change. `checks/design.ts` takes its scan roots from one
> exported constant so there is a single place to be wrong.

**2. Fonts live at `src/ui/fonts/`, imported — not `public/fonts/`. I am
overruling the ui-director's yield, one step further in the same direction, for
a subpath reason.** A `url()` in a stylesheet served from `public/` resolves
against the emitted CSS path and needs either a hardcoded `/ASKK/` or a relative
climb whose depth depends on where Next chose to emit the stylesheet. An asset
imported from `src/` is rewritten by the bundler to
`/ASKK/_next/static/media/…` with the basePath already applied. This project has
been bricked by exactly this class of failure before — a subpath-correct HTML
file with a root-absolute path embedded in an asset reference — and the fix
costs nothing here.

The disagreement is small and cheap to reverse, so the durable answer is not the
path but the check: `scripts/browser/frontdoor.ts` asserts **zero 404s** and
zero cross-origin requests in the built export's network log *served at a
subpath*. That makes any wrong answer to this question visible instead of
silent, whichever directory wins. The rule all three documents already agree on
— self-hosted, no CDN, because of the airplane test and because COEP silently
kills a cross-origin subresource — is untouched.

**3. All checks are TypeScript under `scripts/`. DESIGN yielded further than I
asked; taken, with both of its conditions granted.** My first draft let DESIGN's
seven scripts keep `.js`; the ui-director instead offered to collapse them into
`checks/design.ts`. Both conditions are correct and are now written into §8:

- **Each enforced rule keeps a named sub-check with its own failure message.**
  A gate that fails with `design check failed` is not actionable, and a check
  nobody can act on is a check that gets disabled. This is the same failure mode
  as an assertion-free suite, one step downstream.
- **The three browser-dependent checks stay separately invocable and out of
  `bun run gate`.** They need a build and a real browser. The old tree kept
  contrast measurement out of the gate for this reason and was right to; putting
  them in would make the gate slow, flaky, and therefore skipped. They run in the
  deploy path beside the smoke check, which is where CLAUDE.md already says no
  surface increment is accepted on unit tests alone. I have added a fourth,
  `frontdoor.ts`, per ruling 2.

**4. Six addressed surfaces in one document, not six routes. The ui-director's
counter-proposal is better than my proposal and I am taking it.** I asked for
six route segments; it replied that it does not need six URLs, only six
independently addressable surfaces a headless driver can navigate to directly
with a stable address the ratchet can key on — and that one document with an
addressed registry fits a static export on a subpath better. It is right: six
route segments mean six prerendered HTML files, six hydration boundaries, and
six chances for a basePath-relative asset to resolve differently, in exchange
for nothing this product needs.

**The address is `?panel=<id>`**, declared on each `surfaces.ts` entry and
asserted unique by `checks/design.ts`. Its condition — that the address is
honoured **on load**, not only by clicking the rail — is granted and is the
whole reason the mechanism is acceptable: `contrast.ts` and `geometry.ts`
measure *at rest*, and a surface whose empty state depends on configuration
cannot be reached by driving the UI.

One implementation constraint follows and is stated here so it is not discovered
as flake. Under `output: 'export'` the HTML is prerendered with no panel
selected, so the address is resolved in the **first client render** and the
first paint of the addressed surface happens immediately after hydration. The
browser checks must therefore wait on an explicit `data-panel-ready="<id>"`
attribute that `Shell.tsx` sets once the addressed surface has rendered —
**never on a fixed delay**. A timing-based wait is a check that passes on a fast
machine and fails on a loaded one, which is a check that gets weakened.

**5. Six surfaces, not four. The ui-director wins, and its Context argument is
the strongest thing in the exchange.** I had already accepted six before the
reply arrived, but the *reason* deserves to be the recorded one rather than
"DESIGN owns surfaces":

> `Context` is the only surface that shows the literal request body that left
> the tab. The prompt inspector cannot cover it, because it shows how the
> prompt was *assembled* — which can be entirely correct while the transport
> sends something else.

That gap is exactly where LESSONS defect 3 lived. The prior harness told its
model it had an Alpine container; the fake returned exit 0 for every command and
the lie was recorded in the default space as a fact the model reads. It survived
testing because **nothing in the interface rendered what was actually sent.**
Both trees adopted the rule "the harness never tells the model something it has
not done" — a rule with no instrument, and assembly-time inspection is
structurally incapable of being that instrument. `Context` is the instrument.
`Tools` is the same argument applied to defect 5: an authoritative declaration
nobody can see is an assertion, and it costs one row per tool.

The protocol consequences are already carried above and were independently
flagged by the critic: `Inference.describeRequest` (§5.2) and `turn/request`
(§6.3) exist so Context has a body to render; `Tool.declaration()` (§5.3) and
`tools/list` (§6.2) exist so Tools has a declaration to render. Neither surface
had a wire underneath it in DESIGN, which is what "a surface with no message" is
worth catching.

**6. Workbench is ONE scroll. Conceded, and it is structural, not cosmetic.**

> If Converse and Trace ship as two panels, the split reinstates the chat
> window — Converse becomes the transcript and Trace the debug view beside it,
> which is the standard arrangement NORTH-STAR argues against.

Correct, and it is the sharper form of the objection I half-made when I called
`Converse.tsx` a chat name. "A turn is a sequence of observable events, not a
message" is unachievable if the messages live in one panel and the events in
another; the arrangement *is* the claim. So: one `Workbench` surface, one
scroll, one spine, and `ui/tape/Row.tsx` renders all eight row kinds — including
`you` and `answer` — in the same shape as `tool →` and `retry`. My
`Converse.tsx` and `Trace.tsx` are deleted, and not merely renamed: two files
rendering into one surface would have been fine, and two surfaces would not.

**Raised, not reconciled:** DESIGN §4 opens "Five destinations" and then
specifies six (4.1 Door, 4.2 Workbench, 4.3 Prompt, 4.4 Context, 4.5 Tools, 4.6
Setup); its REPORT names all six and then states "Destinations — **5**". Per the
ringmaster's flag I have **not** reconciled against the wrong number: this file
says six, and DESIGN §4 needs a one-word correction from its owner. I am not
making that edit — DESIGN is the ui-director's document, and silently correcting
another owner's count is how two documents start disagreeing about what was
agreed.

### 10.3 The PLAN edits

Applied to `docs/PLAN.md` in this increment.

1. **1.5 — worker emission, as a reproducible regression guard.** MEASURED M1
   closes this as a risk: a worker loads, runs and replies from a static export
   at a subpath with zero console errors. It stays as an increment because the
   thing measured once in a scratch probe must be measurable forever in this
   repo — run against `scripts/serve-subpath.ts`, locally, in the gate's deploy
   path.
2. **1.6 — the gate, wave-1 rules only.** Narrowed: it ships `checks/size.ts`
   (arming the `max` ratchet), the build/export assertions, and the smoke
   harness. The checks that need a core, a protocol or a bundle to inspect
   arrive with them.
3. **2.7 → 3.4, "Transcript and persistence, worker-owned."** PLAN landed
   persistence in wave 2, before the worker exists in wave 3 — which means
   building IndexedDB access in the main realm and then migrating it, the
   migration this whole architecture exists to avoid. Wave 2 persists through
   `StorePort` against `adapters/test/store.ts`; 3.4 supplies
   `adapters/browser/store.ts` over `engine/db.ts`. The reload acceptance is
   unchanged. The port seam already exists, so this is a swap, not a rewrite.
4. **4.5 — the second flow, and the flow table with it.** `core/flow/**` and
   `core/agent/driver.ts` move out of 2.4 into 4.5, so the table arrives with
   the second flow that earns it. 2.4 ships the react loop ending on a declared
   terminal.
5. **2.0 — the oracle lands first.** New increment, ahead of everything in wave
   2. §10.1 rules TypeScript, which makes every salvaged module a
   transliteration of 1453 lines; the only thing between a transliteration and a
   silently changed prompt byte is a golden fixture with an md5 assertion behind
   it. The oracle must exist before the first module that can break it.
6. **Wave 6 gains 6.4 and renumbers.** The evidence surfaces — Prompt, Context,
   Tools — are their own increment rather than trailing off 6.3, per §10.2
   ruling 5. Cold-open becomes 6.5.
7. **Every increment declares a line budget.** §8.3 demoted `total` from a
   ratchet to a reported number; a reported number with nothing to compare
   against is a logbook. The comparison is the declared budget, and overrunning
   it is a conversation rather than a gate failure.
8. **0.4 gains the constitution.** `CLAUDE.md` names `docs/PORT-MAP.md` as the
   architecture of record, mandates vanilla JS under `tsc --checkJs`, and
   mandates ≤200-line files — all three contradict this document. *(Ringmaster
   condition 9, accepted.)* Until 0.4 rewrites it, the coder's first instruction
   and the architecture disagree about the language, which is the single most
   expensive kind of disagreement available. 0.4 is now blocking, not
   housekeeping.

### 10.4 What I overruled, and why

Three findings I did not adopt **as written**. The DECISION block lists six
items under "OVERRULED"; that count is the wider one and includes three
acceptances of a *different* position rather than refusals of a finding — the
`public/fonts/` yield I declined in order to go one step further in the same
direction, DESIGN §4's count which I raised rather than silently corrected, and
my own first draft's `Converse.tsx`/`Trace.tsx` which I deleted on the
ui-director's argument. Those are decisions, not refusals. The three below are
refusals. Each is considered, not an omission.

1. **"Give `boot` a timeout" — adopted, but not as a timeout.** The critic asked
   for a deadline; I have given a *reporting* deadline that emits `fatal` and
   explicitly does not claim to cancel the `openDB`. Adopting the word "timeout"
   would have reopened the door §6.5 exists to close. The distinction is now
   written into the rule rather than left to whoever implements it.
2. **"Fold replies into `FromEngine`; make the two tables one generated list" —
   adopted in substance, refused in mechanism.** There is no code generation.
   `REPLY_OF` is a hand-written `as const` map and `checks/protocol.ts` proves it
   total against both unions. A generator is a build step, a build step is a
   thing that can be stale, and "one list" is achieved by the check rather than
   by machinery. **This refusal is conditional and the condition is §6.6's
   opening paragraph:** the members must be read by an AST pass over the union
   *type declarations*. If they are ever grepped as string literals out of
   `messages.ts`, rule 1 compares that file to itself, the check becomes a
   tautology, and this refusal is no longer defensible — at which point the
   generator is the right answer and I was wrong.
3. **"Require the handler to touch the client store" — adopted, and I am
   recording that it is still weak.** A case that writes a field nobody reads
   satisfies it. I could not construct a static check that proves a message
   reached a pixel; the thing that proves that is `scripts/smoke.ts` driving the
   built export, and per CLAUDE.md no increment with a UI surface is accepted on
   unit tests alone. Saying so here rather than overstating the check.

---

## 11. Open questions

| Question | Status | What would settle it |
|---|---|---|
| Does a worker survive static export at a subpath? | **CLOSED.** MEASURED M1: it loads, runs, replies, zero console errors. | — (PLAN 1.5 keeps it measured) |
| Does the emitted worker keep `type:'module'`? | **CLOSED, negatively.** MEASURED M2: `{type: void 0}`. It is a classic worker. §3.2 is written against that. | — |
| Is `typeof window` a usable realm check? | **CLOSED, negatively.** MEASURED M3: folded to a constant in the worker. §3.4 rule 3. | — |
| **Which bundler?** | **PINNED: webpack.** MEASURED probed Next 15.5.24 with webpack; the last tree in this repo shipped **Next 16 with Turbopack**, whose `new URL` worker handling differs. `next build` runs without `--turbopack`, and that flag's absence is load-bearing. *(Critic :752, accepted.)* | Adopting Turbopack, or Next 17 forcing it, re-runs the M1/M2 probe. Until then a Turbopack build is an unmeasured build. |
| Is `navigator.locks` available in a dedicated worker in this build? | **CLOSED, positively.** MEASURED M5: grants in a classic worker under the subpath export, `{ifAvailable:true}` grants when free and yields `null` when held. §7.3 is viable as designed and **the heartbeat fallback this row used to carry is deleted — do not build it.** | — (PLAN 1.5 asserts it as a regression guard) |
| Does streaming survive a tool-calling turn intelligibly? | **OPEN.** Deltas are raw model text including the `tool_name({...})` the parser will consume, and DESIGN §4.2 puts them on the same tape as the parsed rows. | PLAN 3.3's smoke run, watched by a human. If it is noisy, `turn/delta` gains a `channel` field — **not** designed until observed. |
| Is one worker enough, or does a long tool call block the next turn? | **OPEN**, and §7.4 already answers it by policy: turns are serialised per session. | Measure under PLAN 4.3 with a real slow tool. A second worker is a registry, and a registry is a wave of its own. |
| Should `usage` come from the endpoint or be estimated locally? | **OPEN.** Local endpoints report usage inconsistently; the old tree's budget numbers were provisional and never measured against a real model context. | One real turn against the operator's own endpoint with the response body recorded. Until measured, DESIGN §4.2's cost row prints "reported" or "unknown", never a confident number. |

---

**DECISION.** The system is four nested boxes — page, worker, engine host, pure
core — with exactly one wire and exactly one port object between them, and the
worker is the only realm that owns mutable state. This revision rests the realm
split on three named mechanisms of honestly different strength (`localStorage`
absent in a worker is physics; `indexedDB` worker-only is a checked convention;
the `typeof` ban on a closed set of globals is what actually kills the defect
class), because MEASURED proved the compiler deletes the guard the previous
revision was arguing about. The protocol is now one vocabulary with every reply
in the union and a `REPLY_OF` map the check proves total; the message store
allocates its own sequence numbers so append-only is append-only at the caller
too; a single-writer election, a reporting boot deadline, an orphan-turn
reconciliation and a tool-output cap close the four ways the previous revision
lost or bricked a session. The flow table moves to 4.5 where its second flow
earns it, and `total` stops being a ratchet it could never be. On the DESIGN
boundary: DESIGN wins on what surfaces exist and why (six, and Context is the
only instrument that can prove what actually left the tab), this file wins on
where files live, and DESIGN's counter-proposal wins over both of ours on
mechanism — six addressed panels in one document rather than six route
segments, which is a better fit for a static export at a subpath and makes the
rendered design checks navigable. The trade I made: TypeScript at a
measured cost of 1453 code lines transliterated and 359 annotation lines
deleted, bought for a compiler-checked 25-member message union and a layer
boundary that can tell a type import from a value one.

**FILES.** Rewrites `/Users/kaush/Downloads/Dev/ASKK/docs/ARCHITECTURE.md`
(owner: architect). Edits `/Users/kaush/Downloads/Dev/ASKK/docs/PLAN.md`
(owner: architect) per §10.3. Raises one correction against
`/Users/kaush/Downloads/Dev/ASKK/docs/DESIGN.md` §4 and §9 (owner: ui-director;
not edited here). Names `/Users/kaush/Downloads/Dev/ASKK/CLAUDE.md` as in scope
for PLAN 0.4 (owner: ringmaster). No source file is created or edited.

**CONTRACTS.** §5 — `Ports`/`stubPorts`/`isConfigured` with
`appendMessage(sessionId, m) -> seq`; `Inference.infer(req, onDelta?, signal?)`
and `describeRequest`; `Tool.call`/`declaration` and `Toolbox.invoke`, none of
which throw, with `TOOL_OUTPUT_CAP` and `TOOL_ELISION`;
`BaseResponse.FIELDS`/`instructions`/`parse`; `Component.render`/`key`/`applies`
and `PromptAssembler.detail` carrying `CORE_MARK`; `Phase.OUTCOMES`/`run`,
`FLOWS` and `validateFlow` (increment 4.5); the `REPLY_OF` map and the
`ToEngine`/`FromEngine` unions in §6; the six object stores in §7.

**ACCEPTANCE.** Verbatim: `grep -c '^## ' docs/ARCHITECTURE.md` returns `11`;
`grep -c 'config/probe' docs/ARCHITECTURE.md` returns non-zero (the ringmaster's
own condition-3 probe); `grep -n 'turn/aborted\|turn/steer\|turn/retry\|turn/request\|tools/list' docs/ARCHITECTURE.md`
shows each in both §6.2/§6.3 and its originating DESIGN section; every increment
in `PLAN.md` maps to a path in §4 or appears in §10.3. Human acceptance: a coder
can build the §4 tree with no further questions, and every rule in §8 names a
check or sits in §8.4 under the word UNENFORCED.

**OVERRULED, and why.** Six items. *(1)* "Give `boot` a timeout" — taken as a
**reporting** deadline that emits `fatal` and explicitly does not claim to cancel
the `openDB`; adopting the word "timeout" would reopen the door §6.5 exists to
close. *(2)* "Make the two protocol tables one generated list" — taken in
substance, refused in mechanism: `REPLY_OF` is a hand-written `as const` map
proved total by a check, because a generator is a build step and a build step can
be stale. *(3)* "Require the handler to touch the client store" — taken, and
recorded as **still weak**: a case writing a field nobody reads satisfies it, and
the thing that proves a message reached a pixel is `scripts/smoke.ts`, not a
static check. *(4)* Fonts at `public/fonts/` — overruled to `src/ui/fonts/`, one
step further in the direction the ui-director already yielded, because a bundler-
rewritten asset URL carries the basePath and a `public/` `url()` does not; the
durable answer is the new zero-404 assertion, which makes a wrong answer visible
either way. *(5)* DESIGN §4's "Five destinations" against its own six — **raised,
not reconciled**, per the ringmaster's flag; correcting another owner's count
silently is how two documents start disagreeing about what was agreed. *(6)* My
own first draft's `Converse.tsx`/`Trace.tsx` — deleted, not renamed: the
ui-director is right that two files rendering into one surface is fine and two
surfaces is not, because in a workbench the arrangement *is* the claim.

**RISKS.** (1) Every dependency this design rests on is now measured — M1 the
worker, M2 the classic-worker constraint, M3 the folded `typeof`, M5 the lock —
which means the remaining risk has moved from "is this possible" to "does this
stay true", and every one of those measurements expires silently on a toolchain
upgrade. PLAN 1.5 is the only thing that converts them into standing assertions.
(2) Turbopack is pinned out, and if a Next upgrade forces it
the M1/M2 measurements expire together, taking §3.2 and §8.1 with them. (3) The
worker-owns-everything rule makes every UI read a round-trip; if the Setup and
Tools surfaces prove too chatty, `config` gets mirrored into the main realm, and
a mirror is the first step back toward duplicated state. (4) `max` is a
sharding-vulnerable ratchet and I have said so rather than fixed it — the force
against relocation is now the critic, not the gate. (5) The transliteration of
1453 lines is where a prompt byte can silently change; the goldens land before
2.5 and they are the only thing standing between that and a shipped regression.
