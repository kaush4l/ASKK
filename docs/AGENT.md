# AGENT — the anatomy of one agent, and the flow of one turn

> **Scope.** `NORTH-STAR.md` says what we are building. `ARCHITECTURE.md` says
> where files live and what crosses the wire. `DESIGN.md` says what the surfaces
> show. **This file says what an agent *is*, what it needs to run, what one turn
> does step by step, and which patterns this tree uses to keep that navigable.**
>
> It is subordinate to all three. Where it disagrees with `ARCHITECTURE.md`
> about a path, a contract or a realm, `ARCHITECTURE.md` wins and this file is
> the one with the bug.
>
> **One exception, and it is why §3.2 exists.** `docs/scratch/FLOW.md` is a
> measured trace of the tree as it stands, `file:line` on every claim, and it
> records **eight places where `ARCHITECTURE.md` asserts the present tense and
> is wrong** (its gaps A1–A8). Where this file describes *what is true today*,
> it cites FLOW; where it describes *what is designed*, it cites ARCHITECTURE.
> This file does not build on any sentence FLOW contradicts, and where an
> earlier draft did, the correction is marked in place.
>
> The sentence it serves: **"An agent is four things and no more — an identity,
> a loop, a set of tools, a memory."** (`NORTH-STAR.md`.) This file is what that
> sentence looks like when you try to build it with the fewest moving parts.

---

## 0. The thesis, and where it breaks

**An agent is not a program. It is a message, plus the contract governing the
reply.**

Everything the agent "is" — who it is, what it remembers, what time it is, what
tools it may reach for, what the user just said — exists in exactly one place
at the moment it matters: **the bytes handed to the model.** And everything the
agent "decides" arrives back through exactly one channel: **the reply, read
against a declared contract.** There is no side band. There is no hidden state
the model consults. If a fact is not in the prompt, the model does not have it;
if a decision is not in the reply, the harness did not receive it.

The tree already asserts this in code, harder than most:

- `InferenceRequest` is `{ prompt: string }` — **one string, one message, one
  role.** There is no message array, no system/user split, no per-turn history
  parameter. `openai.ts` sends `messages: [{ role: 'user', content: prompt }]`.
  The whole agent is that string.
- The reply is read by `BaseResponse.parse` against a `FIELDS` table, and
  **that same table wrote the instructions asking for it.** One declaration is
  both halves of the contract.

If the thesis is true, then composition is not a style preference. It is the
domain model: the message is a **sorted bag of parts**, each of which knows how
to write itself down and how to vanish when it has nothing to say. That is
exactly `core/prompt/` as shipped at 2.6.

### 0.1 The five places the thesis does not hold

An architecture document that cannot name its own exceptions is advertising.
These are real and none of them is going to be argued away.

**E1 — The loop is not a message.** `core/agent/react.ts` decides whether to go
round again. That decision is a *reduction over replies*, not a contribution to
one. A phase's own words *would* be a component at slot 40, and the edges —
`(phase, outcome) → next` — would remain a table in source the model never sees.
**Consequence:** composition governs the message; a **table** governs control
flow. Two patterns, on purpose, and §5 says which is which.

> **Correction, per FLOW gap A3.** `ARCHITECTURE.md` §4 lists a
> `PhaseInstructions` class in `core/prompt/components.ts`, untagged, and it
> **does not exist** — the file declares six classes and says so in its own
> header. So `Slot.PHASE = 40` and `Slot.SKILLS = 30` are today **addressable
> and unfillable**: two of eight slots with no component class in existence.
> That is the correct state (§9 already rules `SKILLS` a stated exception so
> the integers never renumber), but it means E1's phase half is a *design*, not
> a description, and this file does not write it in the present tense.

**E2 — Tool execution is an effect, not a contribution.** A tool's
*declaration* is prompt bytes (slot 60, composable, `applies()`-able). A tool's
*execution* reaches a port and changes something. Nothing about composition
helps there. The only thing the thesis recovers is the **return path**: a
`ToolResult`'s `toString()` is model-facing text, and its error sentence is a
product surface, not a log line.

**E3 — The stream is outside the contract.** The contract is total over the
final reply and **empty over the partial one.** `onDelta` hands out raw model
text, including the half-written `tool_name({…})` the parser has not consumed
yet, and DESIGN §4.2 puts those bytes on the same tape as the parsed rows.
`ARCHITECTURE.md` §11 already carries this as an open question. Named here so it
is not mistaken for an oversight: **there is no contract governing a token.**

**E4 — The harness sometimes speaks in the model's voice.** The repeat guard's
third tier synthesises a give-up answer *of the response class the model was
already answering in*, and `Agent.turn` writes it into the transcript as an
`assistant` message. The model did not write those words. This is the correct
behaviour — a loop that ends without a reply is worse — but it sits one step
from `LESSONS.md` defect 3, and it is the sharpest exception in the file.
**Mitigation that exists:** DESIGN §4.2 has a `retry` row kind, so the tape can
show it. **UNENFORCED:** nothing distinguishes a synthesised assistant message
from a real one *in the transcript itself*, which is what the next prompt
renders. See §7.

**E5 — `src/engine/` is not covered by the thesis at all.** The single-writer
election, the `seq` allocator, orphan-turn reconciliation, the boot deadline:
none of it is a message and none of it is a contract with a model. It is the
machinery that makes a message *possible* and a memory *survive a reload*. The
thesis is a law about `src/core/`. Outside `src/core/` it is a metaphor, and a
metaphor applied to a database is how you get a database that loses writes.

**One more, smaller:** a component's bytes are a function of `(session,
environment)`, not of the session alone — which is why `Recipe.context` is a
**function** and `ContextBlock.CACHEABLE` is **false**. A cached clock is a
wrong clock.

---

## 1. The anatomy — what one agent needs to run

Read the last column first if you are in a hurry: **five rows are the minimum**
and everything else is an agent being good rather than an agent existing.

| # | Part | What it is | Where it lives | Authored by | Read when | Slot | If missing | Min? |
|---|---|---|---|---|---|---|---|---|
| 1 | **Identity** | The words that say who it is, read verbatim | `public/seed/agents/main/agent.md`, overridden in the `agents` store `[4.1]` | **Human** | Every render (memoised on `key()`) | 0 `SOUL` | Assembler **raises** unless a SYSTEM exists — an agent must be someone | ● one of 1/2 |
| 2 | **System instructions** | Standing policy, distinct from personality | same file, its own section `[4.1]` | **Human** | Every render (memoised) | 10 `SYSTEM` | Component `applies()` false; block vanishes | ● one of 1/2 |
| 3 | **Environment snapshot** | The facts that are true *right now* — date, day, zone | Derived in `adapters/browser/clock.ts` `[3.1]`, passed as `Recipe.context()` | **Machine**, per turn | Every render, **never cached** | 20 `CONTEXT` | Block vanishes; the model has no clock and will invent one | ○ |
| 4 | **User input** | What the person just said | `turn/start` → `messages` store → `Transcript` | **Human**, per turn | Rendered as the last history line | 50 `HISTORY` | There is no turn | ● |
| 5 | **Memory** | The transcript that survives the turn, the session and the reload | `messages` store (worker) → `Transcript` → `historyLines()` | Machine-appended | Every render (new `key()` each turn) | 50 `HISTORY` | `applies()` false — correct on turn one, amnesia on turn two | ○ |
| 6 | **Tools** | Declared once, described in their own words, executed against ports | `agent.md` `tools:` list → `engine/tools/index.ts` static table `[4.3]` → usage lines | **Human declares**, machine renders | Every render (memoised) | 60 `TOOLS` | Block vanishes; the agent answers from what it knows | ○ |
| 7 | **The contract** | The `FIELDS` table that writes the instructions **and** reads the reply | `core/response/responses.ts` | **Engineer** | Every render *and* every parse | 99 `RESPONSE` | Assembler **raises**: exactly one RESPONSE component. `null` is legal and means plain text — a real configuration | ● |
| 8 | **The loop** | The smallest cycle that terminates, plus the repeat guard | `core/agent/react.ts`; flow table at `[4.5]` | **Engineer** | Around every turn | — | Compiled in; cannot be missing. A *mistyped edge* fails at load `[4.5]`, not on turn 40 | ● |
| 9 | **Transport config** | Endpoint, model, key, sampling, and `accepts` (§4) | `config` store row, set in Setup | **Human**, once | Turn start | — | The Door cannot connect and there is no turn | ● |
| 10 | **Ports** | Clock, fetch, store, newId — the environment, made explicit | `core/ports.ts`; built in `engine/entry.worker.ts` `[3.1]` | **Engineer** | Construction | — | `stubPorts()` throws `no <name> port configured` — loudly, never a silent no-op | ● |
| 11 | **Turn identity** | The id every event, message and record hangs off | `ports.newId()` | Machine | `Agent.open()` | — | Events become unattributable; the tape cannot group a turn | ○ |

### 1.1 Reconciling the two cuts

`NORTH-STAR.md` names four things: **identity, loop, tools, memory.**
The owner names four things: **user input, environment, context, the contract.**

They are not the same list and the difference is the useful part:

> **NORTH-STAR cuts by *source*. The owner cuts by *contribution*.**

NORTH-STAR enumerates the durable nouns — the things that exist between turns,
that a human edits, that survive a reload. The owner enumerates the ingredients
of one message — the things that vary per turn and get concatenated. Laid on
each other:

| | **Durable / authored (NORTH-STAR's cut)** | **Per-turn / computed (the owner's cut)** |
|---|---|---|
| **Identity** | `agent.md` — rows 1, 2 | rendered `Soul` + `SystemInstructions` bytes |
| **Memory** | the `messages` store — row 5 | the `History` block, and the user's line inside it — row 4 |
| **Tools** | the declaration — row 6 | usage lines, and results returned as text — E2 |
| **Loop** | the flow table + repeat limit — row 8 | *(nothing today: slot 40 has no component class — FLOW gap A3)* |
| **Environment** | *(nothing durable)* | `ContextBlock` — row 3 |
| **Contract** | the `FIELDS` table — row 7 | the response instructions, and the parse |

Two observations fall out, and both are load-bearing:

1. **Environment is the only contribution with no durable source.** It is
   recomputed every turn and cached never. That is precisely why it is the one
   component with `CACHEABLE = false` and why the clock is a *port* rather than
   a call.
2. **The user's message is not privileged.** It enters as the last line of the
   `History` block, in the same shape as every line before it. There is no
   `UserQuery` component and there must not be one — the moment the current
   input renders differently from a past input, the model is being taught that
   recency has a special format, and every turn after the first contradicts it.

---

## 2. The dependency floor

The owner's first sentence is *"the project is aiming for the least
dependencies."* Taken literally, that is a question with a measurable answer.

### 2.1 (a) What the platform actually requires for one turn

Strip everything optional. **A turn needs three things:**

1. **A way to send bytes and read a stream** — `fetch` returning a
   `ReadableStream`. There is no substitute; a static page has no other exit.
2. **An endpoint that answers** — the user's own key or their own local server.
   Not ours (`NORTH-STAR.md`: zero backend).
3. **A JavaScript runtime that can run the bundle.**

That is the floor. Note what is *not* on it: **storage is not required for a
turn.** It is required for the *Reload* test, which is a different requirement,
and conflating the two is how a harness ends up unable to answer a question
until its database opens. `ARCHITECTURE.md` §6.5's boot deadline exists for the
same reason.

`Worker`, `navigator.locks` and `indexedDB` are requirements of *this
architecture*, not of an agent turn. They are chosen and they are measured
(`MEASURED.md` M1, M5).

### 2.2 (b) The four we chose

| Dep | What it buys | To remove it, this would have to be true | Ruling |
|---|---|---|---|
| `react` + `react-dom` | The tape is a live list re-rendered from a streamed mirror; `useSyncExternalStore` is the exact binding for `client/store.ts` | We hand-write DOM reconciliation for eight row kinds streaming at token rate, and DESIGN's five-states-per-primitive rule survives it | **Keep.** The alternative is a worse React. |
| `next` | `output: 'export'`, basePath rewriting for assets, and the **measured** webpack worker emission (M1/M2) | A bundler emits a classic worker chunk with subpath-correct URLs, plus one route's worth of HTML | **Keep, with an exit condition.** This is the largest dependency buying the least per byte — we use one route and no server feature. But removing it **expires M1, M2 and M3 simultaneously** and takes §3.2 and §8.1 with them. It goes only in an increment whose first act is re-running the probe. |
| `idb` | Promise-shaped IndexedDB *with correct transaction lifetime* | We hand-roll ~80 lines of promise wrapping and never once `await` a non-IDB promise inside a `readwrite` transaction | **Keep — but see below.** The line is thin and the payload is not: the `seq` allocator's atomicity (§5.1, critic :317) is exactly the property a hand-rolled wrapper loses first, and this tree has already paid for that defect class once. |

> **`idb@8.0.3` currently has ZERO importers** (FLOW; `StorePort` has zero
> callers and its only mention is a comment). The tree ships a declared runtime
> dependency nobody imports, while the owner's directive is *least
> dependencies*. **Ruling: it stays, and the ruling is conditional and dated.**
> Its caller is `engine/db.ts` at PLAN 3.4, one wave away, and removing a
> dependency in order to re-add it in three increments is churn. **But it is
> exactly the §3.2 defect wearing a `package.json` hat** — a declared thing with
> no consumer — and if 3.4 slips past wave 4, it is deleted and re-added with
> its caller. Recorded so that "we always meant to use it" is not available as
> an argument later.

### 2.3 (c) The seven that look mandatory and are not

| Looks required | Why it is not | Cost of doing without |
|---|---|---|
| A proxy/server for CORS or to hide the key | The endpoint is the user's own; `engine/probe.ts` distinguishes *refused* / *CORS* / *http* / *timeout* so the failure is legible | One probe with four named outcomes, which we want regardless |
| A tokenizer, for the cost row | `usage` comes from the endpoint or it is `null`. DESIGN prints "reported" or "unknown", never a confident number (`ARCHITECTURE.md` §11) | Honesty instead of a number |
| A YAML parser, for `agent.md` frontmatter | The grammar we accept is a closed, documented subset. `core/agent/agentfile.ts` `[4.1]` | A hand-written line parser and a *stated* grammar — which is better, because a full YAML parser silently accepts things `agent.md` should reject |
| An SSE client library | Already hand-rolled in `core/inference/openai.ts`, ~40 lines, frame-by-frame to `[DONE]` | Done. Zero. |
| A UUID library | `crypto.randomUUID` behind `NewIdPort` | Zero |
| A state manager | `client/store.ts` is one switch over a closed union, subscribed via `useSyncExternalStore` | Zero, and the switch is what `checks/protocol.ts` proves total |
| A base64 codec / image library (§4) | `Blob.arrayBuffer()` in the main realm, `btoa` or a hand-written `Uint8Array` pass in the worker. **The worker is classic (M2) — a dynamic `import()` of a codec is not available anyway** | ~20 lines, statically bundled |

**Ruling on the floor: four dependencies, and the number does not change for
multimodality.** If a proposal adds a fifth, the increment that adds it names
which row of §2.3 it just refuted.

---

## 3. The whole flow — one turn, thirteen steps

Realms: **M** = main, **W** = worker host, **C** = pure core (running inside W),
**A** = adapter.

**Three states, not two.** A step is `[N.M]` (not written), **DONE** (written,
tested), or **DONE, ✂ UNJOINED** — written, tested, and **never once executed
against its real neighbours.** The third state is the one that matters and §3.2
is about it.

| # | Step | In → Out | Realm | Fails as | PLAN |
|---|---|---|---|---|---|
| 1 | **Intake** | composer text → `turn/start` message → an admitted, recorded user message with an allocated `seq` | M → W | Refused because a turn is already live on this session; empty input is refused at the composer | 3.2 · 3.4 · 6.3 |
| 2 | **Context gathering** | `sessionId` → `Transcript` (the messages this session already holds) | W | A store read fails → `turn/failed`, session intact | 3.4 |
| 3 | **Environment snapshot** | `ClockPort.now()` + `.zone()` → `{ date, day, … }` facts | A → C | Stub port **throws** `no clock port configured` | 2.1 (port) · 3.1 (adapter) |
| 4 | **Prompt assembly** | agent config + transcript + facts + tool usages → `Component[]` → **one string** and a `Breakdown` (`assembler.ts:63-70`; **not** `PromptBreakdown`, which no file defines — FLOW gap A6) | C | **Raises**, never repairs: not exactly one RESPONSE; no SOUL and no SYSTEM; RESPONSE not last | **2.6 DONE, ✂ UNJOINED** |
| 4½ | **Resolve parts** *(§4)* | `PartRef[]` + the `blobs` store → `ResolvedPart[]` (bytes) | W | A part whose mime the active config does not `accept` → `turn/failed` naming the model and the setting. **Bytes never enter `core/`** | `[7.1]` proposed |
| 5 | **Transport** | `{prompt, parts?}` → `describeRequest()` → `RequestRecord` → `fetchPort` | C (+ `FetchPort`) | Non-2xx throws with the first 500 bytes of the body; a 200 with no body throws naming the URL | **2.3 DONE, ✂ UNJOINED** |
| 6 | **Stream** | `ReadableStream` → SSE frames → `onDelta(chunk)` → `turn/delta` → the tape | C → W → M | The transport honours a signal in three places. **No caller can supply one** (FLOW §3, `agent.ts:119-121`) — a turn in flight today is **uncancellable** | 2.3 DONE, **✂ SEVERED** · 3.3 |
| 7 | **Parse** | raw reply text → a typed response | C | **Never throws.** Requested format, then the other, then the entire reply lands in the answer field | **2.5 DONE, ✂ UNJOINED** |
| 8 | **Validate** | parsed values → `normalize()` | C | **Nothing here rejects.** `normalize` fails toward the *careful* branch. See the note below | **2.5 DONE, ✂ UNJOINED** |
| 9 | **Route** | `Reply.isAnswer` → answer, or tool calls | C | A reply that is neither reads as an answer, because the alternative is a turn that ends with nothing | **2.4 DONE, ✂ UNJOINED** |
| 10 | **Act** | call text → `Toolbox.parseBatches` → `ToolResult[]` → one string the model reads next | C + ports | **`call` never throws.** Output capped at `TOOL_OUTPUT_CAP`, overflow replaced by `TOOL_ELISION` with the dropped count | `[4.2]` · `[4.3]` · `[4.4]` |
| 11 | **Observe** | core `Observer` callbacks → `engine/observer.ts` → `turn/*` events → client mirror → pixels | C → W → M | An event declared and never emitted — **this tree's recurring defect** | 3.2 · 6.3 |
| 12 | **Record** | assistant message + turn events → `messages` / `events` stores | W | The store allocates `seq` inside one `readwrite` transaction; a caller cannot compute it | **3.4** |
| 13 | **Decide to continue** | reply + `Session.seen` ledger → another turn, or stop | C | Three-tier repeat guard: scold, then a synthesised give-up **of the same response class** (E4). `[4.5]` adds a declared terminal from the flow table | 2.4 DONE · `[4.5]` |

### 3.1 Which steps make their defect *inexpressible*, and which merely test for it

Not every step has one. Saying so is the point of the section.

| Step | The defect | What makes it inexpressible |
|---|---|---|
| 1 | The UI hand-builds a protocol message and drifts from the union | Only `client/actions.ts` may construct a `ToEngine`; `checks/protocol.ts` has one file as its subject, so a message with no sender is a **named** failure |
| 1 · 12 | Two turns interleave and one overwrites the other's `seq` | The allocator lives **inside** the store's `readwrite` transaction. There is no API that takes a caller-computed `seq`, so the read-modify-write has nowhere to happen |
| 3 | A cached clock reading, or an ambient one | `ContextBlock.CACHEABLE = false` removes it from the memo; `checks/purity.ts` refuses zero-arg `new Date()`, `Date.now()` and `Math.random()` **on the token stream**, so core cannot read a clock it was not handed |
| 4 | A prompt with no completion cue, or one that does not end with the contract | The assembler's three invariants **raise**. And `tests/golden/render-*.prompt` pins the bytes, with an md5 on the fixture so the oracle cannot drift |
| 4½ | Core silently acquires the ability to hold bytes | **Proposed:** remove `ArrayBuffer`, `Blob`, `File`, `FileReader`, `btoa`, `atob` from `checks/purity.ts`'s permitted built-ins for `src/core/**`. One line; makes "core never holds bytes" executable rather than aspirational |
| 5 | A `RequestRecord` carrying a raw API key | Redaction happens **at construction** `[6.4]`, so a record holding a key never exists at any instant. Plus a host test asserting the key string appears nowhere in `JSON.stringify(describeRequest(...))` |
| 5 | A test that quietly reaches the network | `stubPorts().fetch` throws. A fake handed the stub goes red on contact |
| 6 | **Nothing.** | Deltas are raw model text and no contract governs them (E3). `ARCHITECTURE.md` §11 holds it open; `turn/delta` gains a `channel` field only **after** a human watches a tool-calling turn stream — not before |
| 7 · 10 | An exception escaping into the loop | `parse` and `Tool.call` have no throwing path by construction; a failure is a **value the model reads** |
| 8 | **Nothing.** | There is no rejecting validator, and that is a decision, not a gap — see below |
| 11 | An event declared and never emitted | `checks/protocol.ts` requires every `FromEngine` be emitted **and** written into client state. **The core `Observer` has no equivalent check.** UNENFORCED — see §7 |

**On step 8, plainly.** The contract is *advisory to the model and total on our
side*. `parse` degrades rather than rejects, `normalize` fails toward the
careful branch, and a reply that satisfies nothing still becomes an answer. That
is deliberate: a rejecting validator in a loop with small local models produces
a repair cycle that burns the budget and ends with nothing (`SALVAGE.md`: the
plan-contract phase machine looped `MAX_REPAIRS` on gemma). **We do not
validate. We degrade, and we show what we degraded** — which is what the Prompt
and Context surfaces are for.

---

### 3.2 The third state — exists, is tested, has never been joined

**This is where the project actually is, and no check in the gate can see it.**

`docs/scratch/FLOW.md` measured it. Every fact below carries a `file:line`
there; none of it is inference:

| Seam | The measurement | Consequence |
|---|---|---|
| assembler ↔ agent | `promptFor` (`recipe.ts:84`) has exactly one caller, `tests/prompt.test.ts:60`, and it constructs no `Agent`. `agent.ts` imports nothing under `core/prompt/**` | **The two halves of "assemble → infer" have each been proven and have never run in the same process.** The agent tests fill the prompt seam with a one-line double (`tests/agent-react.test.ts:89`) |
| agent ↔ anything | `new Agent(` appears in `src/` **zero** times — the only occurrence is a doc comment | Nothing constructs an agent outside tests |
| core ↔ page | `grep -rn "core/" src/app src/client src/ui` returns **nothing** | No part of the core is reachable from the page at all |
| response ↔ loop | No code passes a `BaseResponse` subclass as `Agent.model` (FLOW §4) | The `ReActResponse` → `ReplyModel` adapter is structural and unexercised |
| cancellation | `Agent.turn` calls `infer` with **two** arguments (`agent.ts:119-121`); `Agent`, `Session` and `react()` have no signal field | The seam for "reach in mid-flight" is **severed one level above where it was built** |
| storage | `StorePort` has zero callers; its only mention is a comment | And `idb@8.0.3` is a declared runtime dependency with **zero importers** — see §2.2 |

Each of those parts is individually green: 86 tests, 6 checks, byte-exact
goldens. **The gate cannot see this defect class because every check it runs is
per-part.** `checks/purity.ts` reads one file at a time. `checks/size.ts` counts
functions. The goldens prove the assembler against a fixture, not against a
caller. There is no check anywhere whose subject is *a relationship*.

**Name the shape, because this project has been bitten by it before.** The
recurring defect here is the declared-but-never-emitted event: a thing that
exists, is correct, and has no consumer. This is that defect **one layer up** —
not a component that is never emitted, but **a seam that is never joined.** It
is worse than the original in exactly one way: the original is visible to
anyone who greps for the event name, and this one is invisible to every grep,
because both endpoints exist and both are exercised.

**The read-through test is not merely unmet. It is currently impossible.**
`NORTH-STAR.md` asks that a competent reader follow a request from the input box
to the model call and back. Today there is no input box, and there is no path
from any file in `src/app`, `src/client` or `src/ui` to any file in `src/core`.
The chain the reader is asked to follow does not exist as a chain; it exists as
seven correct pieces of one.

### 3.3 The joining increment — ruled, and it comes first

**No increment in `PLAN.md` is assigned the job of connecting these parts.**
FLOW gap F1 says so explicitly: 4.1 builds the agent identity file and
`engine/build-agent.ts` `[4.1]` is the plausible home, but nothing in 4.1's
acceptance says so, and 4.1 is three increments away behind two waves.

**Ruling: the join is one increment, it is next, and it comes before every wave
4, 5 and 6 increment.** The coordinator's steer is accepted, and here is the
reason it is right rather than merely reasonable:

> **Every increment added before the join makes the join bigger, and waves 4 and
> 5 add nothing but more unjoined parts.** 4.2 adds a `Toolbox` whose `invoke`
> would fill a seam nothing calls. 4.5 adds a driver over a loop that has never
> run against a real prompt. 5.x adds a sandbox below an agent that has never
> executed. The compounding is not linear: a join of two parts is one
> assertion; a join of six is a wave.

**The join has two halves, at two places, and conflating them is how it gets
mis-scheduled.**

**Half one — `2.7`, "one turn, joined." Next, before wave 3.** It is
core-only and needs no worker.

- `src/core/agent/build.ts` — `buildAgent(options): Agent`. One function whose
  entire job is to be **the single place `promptFor` meets `new Agent`**: it
  builds the recipe, hands `promptFor(recipe, assembler)` to `AgentOptions.prompt`
  and a `BaseResponse` subclass to `AgentOptions.model`.
- **`Agent` accepts and forwards an `AbortSignal`**, so `infer` is called with
  three arguments and the severed seam is rejoined. This is the smallest change
  that turns "uncancellable" into "cancellable", and it is one field.
- **`RenderPrompt` returns the `Breakdown`, not a bare string** (see §3.5), and
  `AssembledEvent` carries it.
- `tests/turn.test.ts` — the integration assertion of §3.4.

**Half two — the page reaches it, and that is PLAN 3.3.** PLAN 3.3's acceptance
is *"tokens render as they arrive, through the worker, in the built export
served at a subpath."* **That acceptance is not satisfiable unless 2.7 has
landed** — there is nothing to stream. 3.3 does not need rewriting; it needs
2.7 in front of it, and stating that here is the point of this paragraph.

**What I am NOT doing:** editing `PLAN.md`. This is a ruling in the architect's
document that the architect must then land in PLAN as an increment. Until it is
there, it is a recommendation with a reason, and `PLAN.md` remains what is next.

**Why `buildAgent` is not itself the defect it fixes.** At 2.7 its only caller
is a test, which is precisely the shape FLOW just indicted. Two things make it
different and both must be true or the ruling is wrong: its **second caller is
named and scheduled** — `engine/build-agent.ts` at 4.1, which becomes the thin
thing that reads a config record and an `agent.md` and calls this — and it goes
into §3.4's reachability allowlist **with an expiry increment**, so the gate
fails if 4.1 ships and the function is still unreachable from a real entry
point. An allowlisted exception with an expiry is a decision; one without is the
thing being allowlisted.

### 3.4 The check that makes an unjoined seam inexpressible

Two checks. The first is the authority; the second is what proves the first was
pointed at something real.

#### Check 1 — `scripts/checks/reach.ts`, source import-graph reachability

> **Every module under `src/**` must be reachable, by static imports, from a
> declared entry point — or be in an allowlist that names a reason and an
> expiry increment.**

- **Roots**, as one exported constant: `src/app/layout.tsx`, `src/app/page.tsx`,
  and every `*.worker.ts` under `src/engine/`. A root is a file the platform
  loads without anyone importing it, and there are only these.
- **Edges**: static `import` and `export … from`, resolving `@/*` → `src/*`. Plus
  `import()` **with a literal specifier**, which §8.3's lazily-fetched speech
  chunk needs. **A non-literal `import()` is a hard failure**, not an unknown:
  a computed specifier is unanalysable, this tree has no need for one, and
  letting it through would put a hole in the check's own authority.
- **Failure**: names the unreached file *and the roots it searched from*, so the
  message answers "unreachable from what".
- **The allowlist is `{ path, reason, expiresAt }`, and it is checked in both
  directions.** Unreached-and-not-allowlisted fails. **And an allowlist entry
  whose `expiresAt` increment is DONE in `PROGRESS.md` while the file is still
  unreachable also fails** — the same PROGRESS-reading mechanism
  `checks/docs.ts` `[1.7]` already uses. That second direction is what stops the
  allowlist becoming the place unjoined code goes to live.

**Source, not bundle, and that is a ruling.** A bundle grep is at best a
corroborator: folding, inlining, renaming and tree-shaking defeat it, and this
tree has **measured** exactly that (M3 — `typeof window` folded to a constant;
`grep -c` on the worker chunk returns 0 for an idiom that is in the source).
`checks/bundle.ts` keeps its job, which is a *different* question — does core
reach the **main** chunk — and that one a sentinel string can honestly answer
because `CORE_MARK` is a value a function returns rather than an identifier a
minifier may rename.

**Watched red, two ways, both cheap:**
1. Delete the single import of `promptFor` from `core/agent/build.ts` → the
   check names `src/core/prompt/recipe.ts` unreachable and lists the roots.
2. Set an allowlist entry's `expiresAt` to an increment already DONE in
   PROGRESS → the check fails naming the stale entry, with the file still
   unreachable.

**What it would have caught, run today:** `core/prompt/*` (7 files),
`core/agent/*` (4), `core/response/*` (3), `core/inference/*` (4),
`core/ports.ts`, `core/observer.ts` — **essentially all of `src/core/`** —
because no root reaches any of it. That is not a check with a hypothetical
subject. Its first run is red on nineteen files, and the allowlist it starts
with is the honest inventory of what 2.7 and 3.3 are for.

#### Check 2 — `tests/turn.test.ts`, one real turn with no doubles

A reachability check proves the wire exists. It cannot prove the wire carries
the right bytes. So:

> **One test constructs a real `Agent` via `buildAgent`, with the real
> `PromptAssembler`, the real components, a real `ReActResponse` as `model`, and
> `ScriptedInference` holding a recorded reply — and runs a turn end to end.**

Four assertions, and the first is the one that does the work:

- **(a)** The prompt string the **transport received** is byte-identical to
  `tests/golden/render-*.prompt`. Not the assembler's output compared to the
  golden — *the transport's input* compared to the golden. That is the
  difference between proving a part and proving a path.
- **(b)** The observer callback sequence is exactly `assembled` before the first
  `delta`, which is the contract §5.1 states and §7.1 lists as unenforced.
- **(c)** The reply parsed through `ReActResponse` yields the expected
  `isAnswer` — crossing the `BaseResponse` → `ReplyModel` seam FLOW §4 records
  as never crossed.
- **(d)** A signal aborted mid-stream ends the turn as `inference aborted`.
  Impossible to write today; possible the moment 2.7's one field lands, which is
  what makes it the acceptance for that field rather than a hope about it.

**No double at the prompt seam**, and that is assertable rather than promised:
`grep -c 'prompt: () =>' tests/turn.test.ts` returns `0`. Crude, and it is
aimed at exactly the shape `tests/agent-react.test.ts:89` already contains.

**Watched red:** replace `buildAgent`'s prompt with the one-line double the
agent tests use → **(a)** goes red, because the double does not produce the
golden bytes. **The golden is what makes the double detectable**, which is the
sharpest argument available for why 2.0 landed the oracle first.

### 3.5 The work done every turn for no consumer

`PromptAssembler.assemble()` is `this.detail(components).prompt`
(`assembler.ts:119-120`). Every `Band`, both hit/miss counters and `CORE_MARK`
are computed on every turn and then discarded, because `AssembledEvent.prompt`
was supposed to become the breakdown at 2.6 and did not.

**Ruling: a missing wire, not dead weight — and the wire belongs to 2.7.**

The breakdown has two consumers, one designed and one that already exists and is
being handed the wrong thing. The designed one is `turn/prompt` carrying it to
DESIGN §4.3's Prompt surface. The existing one is `AssembledEvent`, which fires
**before** inference precisely so a UI can show what was assembled — and it
currently carries a string, throwing away the per-component bands that are the
only reason that surface is worth having.

So: **`RenderPrompt` returns the `Breakdown` and `AssembledEvent` carries it.**
One change, at the seam 2.7 is opening anyway, and the same seam §4 widens for
parts. Three consumers served by one edit.

**The alternative is rejected:** adding a cheap `assemble()` path that skips the
bands would create **two code paths through the one function whose byte-exactness
is the oracle.** That is the highest-risk divergence available in this tree, and
it would be bought to save work that FLOW measures in the noise.

*(FLOW also records four other repeated computations per turn — UTF-8 length
twice, each component's fields walked twice, the transcript materialised four
times, the reply scanned twice. Those are measured costs and they are **not**
this ruling's business. The ruling here is about a **consumer**, not a
microsecond; conflating the two is how a correctness fix becomes a performance
argument nobody can settle.)*

---

## 4. Multimodality

Nothing in `src/` handles a non-text part today, and `ARCHITECTURE.md` §9 lists
attachments under "deliberately not here" because the only prior implementation
was **silently broken** (`{data:"", format:""}`). This section is the design
that would let it back in. It is not scheduled yet; §8 says where it goes.

### 4.1 The thing that breaks

`Component.render()` returns a **string**. `InferenceRequest` is `{ prompt:
string }`. If a message can contain bytes, one of those two sentences is false.

**Ruling: neither becomes false. Bytes never travel as prompt text.**

The prompt string stays the whole of what the model reads *as language*. A part
is **named in the prompt and carried beside it.** Concretely:

```ts
// core/prompt/part.ts                                                   [7.1]
/** A non-text part, by reference. Metadata only — never bytes. */
interface PartRef { id: string; sha: string; mime: string; name: string; bytes: number }
```

- `Component` gains **one** optional method, `parts(): readonly PartRef[]`,
  defaulting to `[]`. A component that carries a part **renders text that names
  it** (`image 1: photo.jpg (image/jpeg, 412 KB)`) *and* declares the ref.
- **Text-only components pay exactly one empty array.** That is the whole cost,
  and it is why this shape was chosen over the obvious alternative.
- **Rejected:** `render(): string | Part[]`. It changes the return type of every
  component, breaks `key()` and the memo, and forces the assembler to
  type-branch — forty files paying for one.
- **Rejected:** a visitor over components. One new question does not earn double
  dispatch (§5).

The seam widens by exactly one field, at one place:

```ts
// core/agent/agent.ts                                                   [7.1]
type RenderPrompt = (session: Session) => { text: string; parts: readonly PartRef[] }

// core/inference/base.ts                                               [7.1]
interface InferenceRequest { prompt: string; parts?: readonly ResolvedPart[] }
interface ResolvedPart { mime: string; data: ArrayBuffer }
```

`parts` is **optional**, so every existing caller, every scripted fixture and
every golden prompt is untouched. It gains its caller in the same increment that
declares it.

### 4.2 Where the bytes live, and what crosses

**Bytes live in IndexedDB, in a `blobs` store, keyed by the SHA-256 of the
content, owned by the worker.**

| | |
|---|---|
| Store | `blobs`, keyPath `sha`, value `{ sha, mime, name, bytes, data: ArrayBuffer, at }` |
| Owner | **WORKER**, like every other store. MAIN may not name `indexedDB` (checked) |
| Lifetime | Deleted with the session that references them |
| Dedup | Content-addressed: the same image attached twice is one row |

**Not OPFS.** OPFS buys synchronous access handles for large streaming writes,
which we do not do; IndexedDB is already the realm's medium, already has a
schema, an upgrade path and a single-writer election. One store beats a second
storage system with its own lifecycle.

**What crosses the worker boundary, in both directions, stated exactly:**

- **MAIN → WORKER, once per attachment.** `blob/put { mime, name, data:
  ArrayBuffer }` → reply `{ sha }`. §6.4 already permits `ArrayBuffer`.
- **It crosses as `ArrayBuffer` + fields, not as a `File`.** `File` and `Blob`
  are structured-cloneable and it is tempting. §6.4's rule is *plain data*, and
  admitting one platform class is how the next one gets admitted. The worker
  needs nothing `File` offers.
- **WORKER → MAIN: never in an event.** No `turn/*` message ever carries bytes.
  A 4MB buffer inside a streamed event would put one clone per event through the
  structured-clone path and one copy per event into the render mirror.
- **WORKER → MAIN: once, on request, after a reload.** `blob/read { sha }` →
  `{ mime, data }`. Before a reload the thumbnail is the user's own `File`
  through a main-realm `URL.createObjectURL`; the page never asks. After a
  reload that object URL is gone and the only source is the store. Saying "bytes
  never come back" would have been a tidier sentence and a false one.

### 4.3 How it reaches the transport without text-only paths paying

Resolution happens in the **worker**, between assembly and transport — step 4½.
`engine/parts.ts` `[7.1]` turns `PartRef[]` into `ResolvedPart[]` by reading the
`blobs` store. **`src/core/` therefore never holds a byte it was not handed**,
and purity is preserved *absolutely* rather than by convention.

`OpenAiInference.describeRequest` then branches **once**:

```
parts absent or empty  →  content: "<the prompt string>"            (byte-identical to today)
parts present          →  content: [ { type: "text", text: "<the prompt string>" },
                                     { type: "image_url",
                                       image_url: { url: "data:<mime>;base64,<…>" } }, … ]
```

**The acceptance for "text-only pays nothing" is not an argument, it is a
diff:** the recorded request-body fixtures from 2.3 must not change by one byte
when `[7.1]` lands.

**`describeRequest` elides the payload.** The Context surface must render what
left the tab without a 500KB base64 string in the DOM. The body it returns
carries `"url": "data:image/jpeg;base64,<412144 bytes elided>"`. This is the
third appearance of one house rule — **never the content, always the length** —
after `TOOL_ELISION` and the header redaction (§5). A host test asserts the
serialised record stays under a fixed size for a 4MB part.

Base64 is produced in the worker with `btoa` over a `Uint8Array` chunk loop, or
in the main realm at attach time. **Classic worker (M2): no dynamic `import()`
of a codec is available**, so anything used here is statically bundled or
hand-written. It is about twenty lines.

### 4.4 A model that cannot see images fails **loudly, at assembly, before any byte leaves the tab**

Not silently at the endpoint. A 400 from an arbitrary OpenAI-compatible server
is uninterpretable, and letting the user attach an image the model will never
see is `LESSONS.md` defect 3 pointed at the operator instead of the model.

**Ruling on `core/inference/catalog.ts`: it does NOT get a capability field.**

The catalogue maps a `kind` to a **wire protocol**. One endpoint speaks `openai`
for a vision model and a text-only model at the same time, so capability is not
a property of the kind and putting it there would be a table growing a column
for a consumer that disagrees with its row identity (§5, strategy-via-table's
failure mode).

**Capability is a field on the `config` record:**

```
config: { …, accepts: readonly string[] }     default ['text']
```

Two gates, and the second is the one that cannot be bypassed:

1. **At the composer** — the attach control is disabled, and says why: *the
   active model is not declared to accept images (Setup › accepts)*. UX.
2. **At step 4½** — `engine/parts.ts` refuses to resolve a part whose mime the
   active config does not accept, and the turn ends `turn/failed` naming the
   model and the setting. Structural.

**`accepts` is operator-declared, not probed**, because there is no reliable
capability probe across the OpenAI-compatible family. It defaults to `['text']`,
so an unclassified model **fails toward refusal** — an allowlist, the same
direction as the header redaction, for the same reason.

### 4.5 Only images ship, and there is no `kind` enum

The OpenAI-compatible content array has exactly one broadly interoperable
non-text shape: `image_url`. Audio (`input_audio`) has far less agreement, and a
file part has none at all.

So: **`mime` is the discriminator and `image/` is the only accepted prefix.**
There is no `kind: 'image' | 'audio' | 'file'` union, because a union with one
inhabited member is a knob with one caller — the exact thing CLAUDE.md forbids
and the exact thing that produced `{data:"", format:""}` last time.

---

## 5. The pattern catalogue

Not a textbook list. Each entry names the problem **in this tree**, the shape it
takes here, an example that exists or is planned, and **what it costs and when
not to reach for it.**

### 5.1 Accepted

**Composite — the prompt is a sorted bag of parts.**
*Problem:* the message has seven-ish contributors authored by four different
parties and their order is load-bearing. *Shape:* `Component` with `SLOT`,
`FIELDS`, `render()`, `key()`, `applies()`; `PromptAssembler` filters, sorts on
`(SLOT, priority)`, checks three invariants, joins with no separator.
*Example:* `core/prompt/*` — shipped at 2.6. *Cost:* **the prompt exists in no
single file.** You cannot read it; you must run it. *Mitigation:* DESIGN §4.3's
Prompt surface renders the assembled bands, and the goldens pin the bytes.
*Do not use where the whole is not homogeneous* — the flow is not a composite,
it is a table (E1).

**Strategy-via-table — one declaration, several consumers.**
*Problem:* the same fact is needed by the prompt writer, the parser and the
router, and three copies drift. *Shape:* an ordered `as const` table read by
everyone. *Examples, all shipped or scheduled:* `BaseResponse.FIELDS` (writes
the instructions, targets the parse, routes the reply), `Slot`, `FLOWS` `[4.5]`,
`REPLY_OF`, `ui/shell/surfaces.ts`, `KINDS`. **This is the house pattern.**
*Cost:* a table that grows a column for one consumer becomes a god-table.
*Do not use where two consumers disagree about what a row is* — which is exactly
why §4.4 puts `accepts` on the config row and not on the kind catalogue.

**Ports and adapters.**
*Problem:* a pure core that must still know the time and reach a network.
*Shape:* `Ports` handed in at construction; one adapter per real environment.
*Example:* `core/ports.ts`, `adapters/browser/*`, `adapters/test/*`.
*Cost:* every environmental read gets a name, a stub and a test double — four
members today, one of which has a caller. *Rule that keeps it honest:* **no port
before its caller**, and `stubPorts()` members **throw** rather than no-op.

**Abstract base, concrete chosen by a config string.**
*Problem:* two wire protocols, one loop. *Shape:* `abstract class Inference` +
`inferenceFor(kind, …)`. *Example:* `ScriptedInference` and `OpenAiInference`.
*Cost:* a base with one concrete is pure tax. *Rule:* **the second
implementation earns the interface, and never the other way round.** There is no
`register()` seam; two entries do not need one.

**Loud null object.**
*Problem:* absence has to be distinguishable from silence.
*Shape:* three flavours, and the distinction matters — a stub that **throws**
(`stubPorts()`), a **declared configuration** (`PLAIN_TEXT` — `response_model:
null` is a real setting, not a placeholder), and a **deliberate no-op**
(`SILENT` observer, whose whole job is to be absent).
*Cost:* none, if the rule holds. *The rule:* **a null object either throws or is
a named configuration. It never returns success.** A stub returning success is
the worst artifact this project can produce (`LESSONS.md` defect 3).

**Value object with a content hash.**
*Problem:* the expensive head of the prompt must be byte-stable across turns so
the server's prefix cache hits. *Shape:* frozen components, `key()` = class name
+ FNV-1a over the declared fields, memoised by the assembler with `MEMO_LIMIT`.
*Cost:* **a mutable field silently poisons the memo** — the hash would be right
and the bytes wrong. *This is UNENFORCED* (§7).

**Observer with an ordering contract.**
*Problem:* an honest live UI needs to know that `assembled` fired *before*
inference and that `entered` fires at phase entry, so `verify→plan` and
`verify→respond` are distinguishable. *Shape:* an interface of optional
callbacks; `engine/observer.ts` serialises them onto the wire.
*Cost:* **an event declared and never emitted is this tree's recurring defect**
(four prior occurrences on record). Checked on the wire, unchecked in core (§7).

**Two vocabularies at one boundary.**
*Problem:* a storage record and a wire shape are different things that look the
same. *Shape:* `core` records, `protocol` shapes, and `engine/wire.ts` as the
only mapper, exporting `SHAPE_PAIRS` for the check. *Cost:* two type families
and a mapper nobody enjoys writing. *Earned because* the mapper is the single
place redaction can happen, and a place a step cannot be forgotten is worth more
than the step being short.

**Reducer / mirror.** `client/store.ts`: one switch over a closed union, the
main realm holding a *mirror* and never a truth. *Cost:* every UI read is a
round trip; if Setup and Tools prove chatty, the pressure to cache config in
main is the first step back toward duplicated state.

**Elision with a count — "never the content, always the length."**
*Problem:* three unrelated places must show that something large or secret
exists without showing it. *Shape:* replace the payload with a sentence naming
the count. *Examples:* `TOOL_ELISION` (model-facing, so the model knows content
was withheld rather than reasoning over a silent truncation), `<redacted, N
bytes>` in the header record `[6.4]`, `<412144 bytes elided>` in an image body
(§4.3). *Three independent appearances is what earns it a name.*

### 5.2 REJECTED, and why

| Pattern | Why not, here |
|---|---|
| **Plugin registry / `register()`** | Two entries in `inferenceFor`. A plugin point with no plugin. Already ruled in `catalog.ts`'s own header. |
| **Middleware / hook pipeline** (`before_run`, `transform_context`, `before_tool`, … — pi's nine hooks, `REFERENCES.md`) | Nine knobs, zero callers. The prompt already has an extension point (add a component) and control flow already has one (add a flow row). A hook surface is a second way to say both, with no listener. |
| **Shared cross-realm event bus** | The exact shape of a realm-duplicated singleton — `LESSONS.md` defect 1. `ARCHITECTURE.md` §9. |
| **DI container** | Construction is one function in `engine/entry.worker.ts`. A container is a layer that only forwards. |
| **Generic `Repository<T>` base over the stores** | The four-verb shape is a *convention*, and `messages` (`append`, no whole-list write) and `events` (`pruneBefore`) both break it. A shared base class would have made the exceptions the hard part. Convention beat inheritance. |
| **Visitor over components** | One new question (`parts()`) does not earn double dispatch. A method with a default answer costs one line per class and zero at every call site. |
| **Builder for the prompt** | `baseComponents()` returns an array. A fluent builder adds an object whose only useful call sequence is "add everything, in the order the array already had". |
| **FSM as classes with `next()` transitions** | A phase returns an **outcome name**, never a next phase; the table maps `(phase, outcome) → next` and `validateFlow` proves four properties at load `[4.5]`. Objects that know their successors cannot be validated as a graph. |
| **`Result<T, E>` everywhere** | This tree has one error discipline plus one named exception: things throw, *except* the tool path and `parse`, which return values. Two disciplines is worse than one and a documented carve-out. |
| **Barrel files / a `core/index.ts`** | Defeats tree-shaking, and it existed for a Python `__init__.py` problem we do not have. `ARCHITECTURE.md` §9. |
| **`Capability` interface with `isSupported()`** | For §4.4 this would be an interface with one implementation and one consumer. Capability is a **field on a config row**. |
| **`Inference` as an async iterator** | `onDelta` already has two implementations. An iterator would be a second spelling of the same thing, and the callback is what the observer path already consumes. |
| **A `MODALITIES` table** (§6, recipe 5) | It is the right shape and it has **one row**. It is built when the second modality exists, and §6 says so out loud so it is not later mistaken for an oversight. |
| **Compaction, in any shape** | `ARCHITECTURE.md` §9. The prior trigger was *message count*, which was wrong; rebuilding it wrong is worse than not having it. `REFERENCES.md` items 1–3 hold the design for when it is earned. |

---

## 6. How to add a feature

The payoff. Each recipe is ordered; each ends with the observation that proves
it. **More than ~4 touch points is a design smell and is named as one.**

**1 — A new tool.** *(3 code files + 1 data line.)*
1. `core/tools/<name>.ts` `[4.2]` — the function, its `ToolMeta` and its usage
   line. Its error sentences are product copy; write them once, verbatim.
2. `engine/tools/index.ts` `[4.3]` — one row in the static table, bound to
   ports. **It must be static: the worker is classic (M2), so a tool cannot be a
   module loaded from storage.**
3. The agent's `agent.md` `tools:` list — **the declaration is authoritative**
   (`LESSONS.md` defect 5); what is not named is not present.
4. *Prove it:* one host test on the tool's **own sentence**, and one real turn in
   the page that calls it.

**2 — A new response field.** *(1 code file.)*
1. `core/response/responses.ts` — one `FieldSpec` in `FIELDS`, in the right
   position, because **`FIELDS` order is prompt order**.
2. Regenerate the golden fixture **deliberately**, in the same commit, and say so
   in `PROGRESS.md`. A silently regenerated oracle is not an oracle.
3. Any router reading the new field — often nothing.
4. *Prove it:* the golden diff shows exactly the intended bytes, and a malformed
   reply still parses.
**This is the pattern working: one declaration, three consumers, one edit.**

**3 — A new prompt component.** *(2 code files.)*
1. `core/prompt/components.ts` — the class, with `SLOT`, `NAME` (written out —
   the build minifies), `FIELDS` in declaration order, `TEMPLATE`, and
   `applies()`. Freeze in the constructor.
2. `core/prompt/recipe.ts` — one entry in `baseComponents()`.
3. *Prove it:* golden diff. `ui/prompt/BandStack.tsx` needs **no** change — it
   renders the breakdown, which is data.

**4 — A new model provider.** *(3 code files + 1 data row.)*
1. `core/inference/<kind>.ts` — implement `infer` and `describeRequest`. Build
   the redacted header records **at construction**.
2. `core/inference/catalog.ts` — one line in `KINDS`, one branch in
   `inferenceFor`.
3. `public/seed/models.json` — one row.
4. `adapters/test/fetch.ts` — a **recorded** body, including SSE chunks.
5. *Prove it:* >1 delta chunk, and the key string absent from
   `JSON.stringify(describeRequest(...))`.

**5 — A new modality.** *(4 touch points — the limit, and a named smell.)*
1. `core/prompt/part.ts` — extend the accepted mime prefix.
2. The transport's content-array mapper (`core/inference/openai.ts`).
3. `ConfigRecord.accepts` — a new declared value, and the Setup control for it.
4. The composer's `accept` attribute.
**Named smell:** four files must agree about one mime prefix. The fix is a
single `MODALITIES` table mapping prefix → `{ contentPartType, acceptsValue,
inputAccept }` read by all four. **Do not build it for the first modality** — it
would be a table with one row. Build it in the increment that adds the second,
and that increment's first commit is the table.

**6 — A new surface.** *(2 files.)* `ui/surfaces/X.tsx`, plus one row in
`ui/shell/surfaces.ts` carrying id, label, order, component and `?panel=` address.
*Prove it:* the address is honoured **on load**, and `data-panel-ready` is set.

**7 — A new worker message.** *(4 files, and all four are checked.)*
`protocol/messages.ts` (union + `REPLY_OF`) → `engine/host.ts` (a case) →
`client/actions.ts` (a sender) → `client/store.ts` (a case). `checks/protocol.ts`
proves the pairing total, every request handled, and every event both emitted
and written into client state. **Four touch points that a check enumerates is
not the same smell as four that a human must remember.**

---

## 7. What this file asserts, and how each assertion is checked

Per CLAUDE.md: a claim the gate cannot execute is not a verified claim.

| Assertion | Checked by |
|---|---|
| Core references no ambient global; no ambient clock or randomness | `checks/purity.ts` (tokeniser + allowlist) |
| **Core never holds bytes** (§4) | **PROPOSED:** remove `ArrayBuffer`, `Blob`, `File`, `FileReader`, `btoa`, `atob` from core's permitted built-ins in `checks/purity.ts`. Until then: **UNENFORCED** |
| The assembled prompt is byte-exact | `tests/golden/render-*.prompt` + an md5 on the fixture |
| Adding parts costs text-only paths nothing (§4.3) | The 2.3 request-body fixtures must not change by one byte in `[7.1]` |
| `describeRequest` never carries a key | Host test: the key string is absent from `JSON.stringify(...)` |
| `describeRequest` is bounded regardless of part size | **PROPOSED** host test: a 4MB part yields a record under a fixed size |
| Every `ToEngine` has a sender and a handler; every `FromEngine` is emitted and stored | `checks/protocol.ts` |
| Realm is positional; `typeof` never asks | `checks/realm.ts` + banners |
| **Every module under `src/**` is reachable from a real entry point** | **PROPOSED** `scripts/checks/reach.ts` (§3.4), with a `{path, reason, expiresAt}` allowlist checked in both directions. Today: **UNENFORCED, and red on ~19 files if it existed** |
| **The assembler's output is what the transport actually receives** | **PROPOSED** `tests/turn.test.ts` assertion (a) — the golden compared against the transport's input, not the assembler's output |
| Every check runs | `checks/gate-coverage.ts`, plus the printed check count in `PROGRESS.md` |
| Every file and contract named here exists or is tagged | `checks/docs.ts` §8.7 — **this file must be added to its §N.M resolver** |

### 7.1 UNENFORCED, stated plainly

0. **Nothing checks that a seam is joined.** The whole of §3.2. Every check in
   the gate has a *file* as its subject; none has a *relationship*. This is the
   largest unenforced item in this document and §3.4 is the proposal that closes
   it. Until then the honest statement is: **86 green tests and 6 green checks
   do not establish that any two parts of this system have ever run together.**
1. **Components are frozen.** Nothing asserts a concrete class froze itself at
   the end of its constructor. A mutable field makes `key()` correct and the
   bytes wrong — the memo's one silent failure. *Cheapest fix:* a host test that
   instantiates every exported component class and asserts
   `Object.isFrozen(instance)`.
2. **The core `Observer` callback sequence.** The wire has a check; core does
   not. *Cheapest fix:* one host test running a full turn with a recording
   observer, asserting the exact callback order including `assembled` before the
   first `delta`.
3. **A synthesised give-up answer is distinguishable from a real one** (E4).
   DESIGN gives the tape a `retry` row kind; nothing marks the **transcript
   message**, which is what the next prompt renders.
4. **`accepts` reflects what the endpoint can actually do** (§4.4). It is
   operator-declared. There is no probe, and inventing a confident one would be
   the failure mode this file's §3 step 8 note is about.
5. **Prompt bytes are copied character-for-character** beyond the reach of a
   golden fixture — tool descriptions, tool error sentences, phase prompt
   bodies. Already `ARCHITECTURE.md` §8.5; restated because §6's recipes 1 and 3
   are exactly where a new uncovered string enters.

---

## 8. Speech — STT and TTS

The owner's framing: *an agent can be summarised as having STT and TTS, where
the code takes only the name of the model and has the code around it.* The API
law inside that sentence is the valuable part, and this tree already obeys it in
one place.

### 8.1 The law: a name is the whole required config surface

`inferenceFor(kind, config, fetchPort)` is one registry keyed by a name,
returning a fully-constructed thing, with an error that names the known set. A
speech API should read the same:

```ts
sttFor('whisper-tiny')      // client/speech/stt.ts   [proposed]
ttsFor('system')            // client/speech/tts.ts   [proposed]
```

**Ruling: ONE law, THREE registries. Not one registry, and not three laws.**

*One registry, rejected.* A generic `registry<T>(name)` would have to be
parameterised over three unrelated config shapes — `InferenceConfig` carries a
baseUrl, a key and sampling; an STT model carries a model id and a language and
no endpoint at all; a voice carries a rate and a pitch. Unifying them produces
either a union nobody can narrow or a layer that only forwards. **Cost of the
rejected answer:** one abstraction earning nothing, which is the thing CLAUDE.md
forbids by name.

*Three unrelated laws, rejected.* If each registry invents its own spelling, a
developer learns the pattern three times and the fourth one invents a fourth.

*What we do instead — the law, written down so it is checkable:*

> **A registry is a function `xFor(name, …) → X`, beside an exported `NAMES`
> const, whose unknown-name error is `Unknown <thing> '<name>'. Known: a, b`.**

**Checked by** one host test per registry asserting the literal unknown-name
sentence, exactly as `tests/inference.test.ts` will for `inferenceFor`.
**UNENFORCED:** that a *fourth* registry follows the shape. A static check could
grep for `*For(` exports without a sibling `NAMES`, and it would be cheap, but
it has two subjects today and a check with two subjects is a check written
before its problem.

### 8.2 The placement ruling, which is the load-bearing decision

**Speech is NOT a core port. `core/ports.ts` gains no member.**

This overrules the steer I was given, and here is why, in the order the reasons
matter:

1. **Speech is not in the message and not in the contract.** STT produces text
   *before* a turn; TTS consumes text *after* one. Neither is a prompt
   contribution and neither is read by the model. `Ports` exist so the pure core
   can reach the environment **while deciding** — the core never needs to hear
   or to speak. A microphone is a keyboard and a voice is a screen.
2. **It is the only placement `MEASURED.md` M2 permits.** The worker is a
   **classic** worker: no runtime ESM, no dynamic `import()` of application
   code. Every honest local speech runtime — transformers.js, ONNX Runtime Web —
   is ESM and spawns workers of its own. **A `SpeechPort` in core, satisfied by
   an adapter running in the engine worker, is the naive design M2 invalidates**,
   and it is the single most likely way this feature gets built wrong. In the
   **main** realm the page bundle is ESM, `import()` works, and a lazily fetched
   runtime is ordinary.
3. **Audio bytes then never cross the worker boundary at all.** Not as
   `ArrayBuffer`, not once. There is no `blobs`-store question, no §4.2 to
   re-derive, and no per-frame clone through structured clone. The design gets
   *smaller* by being placed correctly.

So: **speech lives in `src/client/speech/`, main realm, `// REALM: main`.** STT
calls `actions.submitTurn(text)` — the same function the composer calls. TTS
subscribes to the store — the same mirror the tape renders from.

**The exception this creates, named rather than discovered.** The engine cannot
*initiate* speech. If a `speak` tool ever exists, the worker would have to ask
main to do something, and the protocol has no such direction — main→worker is
request/reply, worker→main is events. **The change it would need:** one
`FromEngine` event the client honours (`speak/say`), built with that tool and
never before. Recorded so the limit is a decision.

### 8.3 The dependency collision, and how "least dependencies" is measured

Two honest options and they are not comparable on a package count:

| | Web Speech API | ONNX / transformers.js |
|---|---|---|
| Bytes shipped | zero | tens to hundreds of MB of weights |
| Offline | **STT: no.** Chrome transports audio to Google. **TTS: yes** — `speechSynthesis` uses OS voices, locally | yes, **after one download** |
| Quality | platform-dependent | good, and pinnable |
| North star | STT fails the airplane test outright | passes, once cached |

The asymmetry between the two halves of Web Speech is the whole finding and
collapsing them is how this gets decided wrong:

**Ruling A — `speechSynthesis` SHIPS, as the default voice.** It is zero bytes,
local, offline, on every platform, and needs no download consent. `ttsFor('system')`
is the default and a Kokoro-class model is the second entry for people who want
better. **TTS therefore has two implementations on day one, so the base is
earned.**

**Ruling B — `SpeechRecognition` DOES NOT SHIP, not even labelled-degraded.** In
the implementation that matters it sends the user's microphone audio to a third
party. A label is not a mitigation for exfiltration, and a harness that quietly
does something it did not tell you about is `LESSONS.md` defect 3 pointed at the
user instead of the model. It returns **only** if a browser exposes a
*checkable* on-device guarantee (`SpeechRecognition.availableOnDevice()` /
`processLocally`) and we have measured it true in this build — a measurement, in
`MEASURED.md`, not a capability read out of a spec.

**Consequence, applied: STT has ONE implementation, so it gets NO abstract
base.** `client/speech/stt.ts` exports a concrete and `sttFor` with one name in
`NAMES`. The base appears with the second engine. This is the house rule doing
visible work rather than being quoted.

**And "least dependencies" is therefore measured as bytes on the cold-open path,
not as a count in `package.json`.** A user who never presses the microphone
pays nothing. The claim needs three checks, and only the third is load-bearing:

1. **Static, weak.** `checks/bundle.ts` gains an assertion that the speech
   runtime's chunk is a *separate* emitted file — present in `out/`, absent from
   the transitive static imports of the scripts `out/index.html` references. It
   is the same shape as the existing `CORE_MARK` assertion and it can be
   satisfied by a chunk that is nonetheless prefetched.
2. **Static, ratcheted.** The total bytes of the scripts `out/index.html`
   references transitively may only go down, seeded on the build before the
   feature lands. This is what catches an accidental static import.
3. **Behavioural, and this is the one that counts.** A browser check loads the
   built export at a subpath, records every network request, and asserts **zero
   requests to any model host before the microphone control is pressed.** An
   unchecked bundle claim in this tree is exactly the §8.5 failure mode, and a
   claim about a bundle read out of a config file is one of the two rules
   CLAUDE.md names as learned the hard way.

**The honest cost, stated because it is a north-star tension:** local STT works
offline **only after one online download**. The cold open never requires it, the
size is shown before the download begins (§8.6), and the offline state is
labelled — *voice needs one online download* — rather than presented as a button
that does nothing.

### 8.4 Streaming, in both directions

**STT partials never enter the prompt.** A partial transcript is **composer
draft state, in the main realm**, and only the *final* transcript is handed to
`submitTurn(text)`. The microphone writes to the composer, not to the session.

Three reasons, in order of weight: a component re-rendering per audio frame gets
a new `key()` every hundred milliseconds and turns the memo into a cache with a
0% hit rate, which is the entire reason the memo exists; a half-heard sentence
written into the `messages` store is a durable record of something the user did
not say; and `submitTurn` already exists and needs no second entrance.

**TTS off a token stream, and the sentence-boundary problem.** Naively
`onDelta → speak(chunk)` produces gravel. The fix is a **pure segmenter**:

```ts
// client/speech/segment.ts                                       [proposed]
function segment(buffer: string): { utterances: string[]; remainder: string }
```

Flush on terminal punctuation followed by whitespace; or, past a character
ceiling, at the last space; the remainder carries forward; at stream end the
remainder flushes whole. It is pure and testable with no DOM and no audio. It is
**not** in `src/core/` — it is not a decision the agent makes, and core is for
the agent's decisions, not for every pure function in the tree.

**But there is a second gravel problem, and it is the one that decides the
design.** With a structured response contract, the raw delta stream contains the
contract's scaffolding — field names, TOON or JSON punctuation. Speaking it is
worse than speaking mid-word.

> **Ruling: streamed TTS ships for `PLAIN_TEXT` agents only. For an agent with a
> structured contract, the voice speaks once, at `turn/done`, from the parsed
> answer field.**

For a plain-text agent the deltas **are** the answer, so streaming costs nothing
new and the owner's requirement — start speaking before generation finishes — is
met exactly where voice is actually used. Making it true for structured agents
needs a **prefix-tolerant incremental extractor for the answer field**, which is
a change to `core/response/parse.ts` and not a small one. It is named as the
change rather than implied by a design that quietly does not do it.

### 8.5 Barge-in

The user speaks while the voice is playing.

- **What cancels:** the utterance queue, immediately, in main —
  `speechSynthesis.cancel()` or the adapter's `stop()`.
- **What survives:** **the turn.** By default, barge-in stops audio and nothing
  else. Cancelling the record because the user stopped listening would make the
  transcript disagree with what happened.
- **If the barge-in becomes a submission**, `submitTurn` is preceded by
  `abortTurn()`, which sends `turn/abort`, which aborts the **real**
  `AbortSignal` on the **real** `fetch` in the worker.

**That last sentence describes a thread that does not exist yet.** The signal is
honoured by both transports and supplied by nobody (FLOW §3, §3.2 above), so
barge-in-as-submission is blocked on 2.7's one field like everything else that
reaches into a turn.

**The `AbortSignal` in `core/inference/base.ts` is deliberately NOT reused for
the audio.** It lives in the worker, on a `fetch`. Wiring a main-realm audio
event to it would mean main holding a handle to a worker-owned controller, and
§3.3 rules exactly that: *`turn/abort` is a message, not a shared handle.* So
there are **two cancellations in two realms with one message between them**, and
that is the existing thread being used rather than a new sharing mechanism being
invented.

**One ordering hazard, with its fix:** a `turn/delta` for the cancelled turn
arrives after the cancel. The segmenter carries the turn id it is speaking for
and drops deltas that do not match. One field, checked by a host test on the
pure segmenter, not by hope.

### 8.6 The five failures a developer will actually hit

Each fails loudly, early, and says what to do. None is a control that does
nothing.

| Failure | Where it surfaces | The message |
|---|---|---|
| A model name that does not exist | `sttFor` / `ttsFor`, at construction, synchronously | `Unknown speech model 'whisper-huge'. Known: whisper-tiny, whisper-base` — the §8.1 law, visible |
| The browser has no `speechSynthesis` | `ttsFor('system')`, at construction | Setup renders a real state: *this browser has no system voice*. Never a silent no-op — §5.1's loud-null-object rule |
| Microphone permission denied | The mic control, on the `getUserMedia` rejection | *The browser blocked the microphone for this origin* — and the control renders **denied**, one of DESIGN's five required states |
| A 200 MB download on a phone | **Before** it starts, never during | The declared byte size is a constant on the model row and the control reads *Enable voice — downloads 74 MB*. The download is an explicit act with a progress row |
| Weights unreachable (airplane, first use) | The download attempt | *Voice needs one online download; text works offline now* — the distinction between the harness being broken and the feature being uninstalled |

### 8.7 Where speech sits in the anatomy

Rows 12 and 13 of §1, and they are marked differently on purpose:

| # | Part | What it is | Where it lives | Author | Read when | Slot | If missing | Min? |
|---|---|---|---|---|---|---|---|---|
| 12 | **Voice in (STT)** | A microphone that writes text into the composer | `client/speech/stt.ts` `[proposed]`, **main** | Human speaks; machine transcribes | Before a turn exists | **none — never in the prompt** | The composer still takes typing | ○ |
| 13 | **Voice out (TTS)** | A speaker that reads the answer | `client/speech/tts.ts` `[proposed]`, **main** | Machine | After a turn, or during it for plain-text agents | **none — never in the prompt** | The tape still shows the answer | ○ |

**This is the anatomy table earning its keep.** The question "is speech part of
the agent?" was answerable only once every other part had a *slot* column, and
these two are the only rows with none. A part with no slot is not agent
anatomy — it is a peripheral of the interface, and it belongs in the realm that
owns the interface.

---

## 9. Robust, and developer-friendly, in testable terms

The deliverable is judged on two words. Neither means anything until it names an
observation, so here is what each one means here, and then this document's own
design held to it.

### 9.1 Robust — four tiers, and the count that matters

| Tier | Meaning | Example in this tree |
|---|---|---|
| **R1 — inexpressible** | There is no syntax that produces the defect | You cannot compute a `seq`: allocation lives inside the store's transaction and no API accepts one. You cannot ask what realm you are in: `typeof` on the discriminating globals is refused everywhere |
| **R2 — refused by shape** | It can be written and it cannot survive construction | The assembler **raises** on a prompt with no RESPONSE component. `stubPorts()` members throw. `parse` and `Tool.call` have no throwing path at all |
| **R3 — caught at runtime** | It happens and is reported honestly | `turn/failed` with a named reason; the four probe outcomes; the boot deadline emitting `storage-blocked` |
| **R4 — unenforced** | A human is the check | The five items in §7.1 |

**Robustness is not a score, it is a direction: every named failure should move
down a tier over time, and nothing should move up.** That is measurable because
§3.1 and §7 already enumerate this file's failures by tier, so a later revision
that adds an R4 without a plan to demote it is visibly doing so.

**And there is a fifth state the tiers did not have a name for until FLOW
measured it: R0 — a defect no tier applies to, because the code it would occur
in has never run.** An unjoined seam is not robust or fragile; it is untested in
the only sense that counts. §3.4's reachability check exists to make R0
impossible, which is the highest-leverage move available, because every other
tier assumes the code executes.

The tier that matters most is R1, and R1 is almost always bought the same way:
**remove the place where the mistake could happen**, rather than adding a check
that it did not. Three of this tree's four R1s are that exact move.

### 9.2 Developer-friendly — three properties, each observable

**D1 — Touch points, and whether a check enumerates them.** §6 counts them. The
distinction that matters is not four versus two; it is **four that a check
enumerates versus four a human must remember.** Adding a worker message touches
four files and `checks/protocol.ts` names every one you forgot. Adding a
modality touches four files and nothing names them. Those are different numbers
wearing the same digit.

**D2 — The error message at the moment of the mistake.** The standard, stated so
it can be argued with: **an error names the thing that was wrong, the set of
things that would have been right, and — where there is one — the remedy.**
`Unknown model kind 'anthropic'. Known: openai, scripted` passes.
`no clock port configured` passes. `undefined is not a function` is a defect
regardless of what caused it. **UNENFORCED**, and the cheap version is a host
test per registry asserting the literal sentence, which §8.1 already requires
for the three registries.

**D3 — The right way is the shortest way.** Observable as: *is the shortest path
to the wrong thing longer than the shortest path to the right thing?* The tree
passes on `seq` (there is no shorter wrong way; there is no wrong way). It
**fails** on component mutability — the shortest way is to assign a field in a
constructor and forget to freeze, and that is shorter than the right way.

### 9.3 Where this document's own design fails its own criteria

Stated because a section defining robustness that exempts itself is the same
advertising §0.1 refuses.

- **§4's "core never holds bytes" is R4 today and R1 only if the purity
  allowlist change lands.** The design claims a structural guarantee it does not
  yet have. The one-line check is named in §7; until it exists, the sentence is
  a convention.
- **§8.3's "never in the base bundle" is R3, not R2.** The load-bearing check is
  a browser network recording. A static check would be stronger and I do not
  have an honest one — a chunk can be listed as separate and still be
  prefetched, so the layout assertion would be a check that passes while the
  bytes ship.
- **§6 recipe 5 fails D1 outright**: four remembered touch points, zero
  enumerated. Named as a smell there and the fix is deferred **on purpose**,
  which means D1 stays failed for exactly as long as there is one modality.
- **§8.4's segmenter passes everything**; it is a pure function with a pure
  test, which is why it was worth extracting from the code around it.
- **The whole document assumed a joined system and it is not one.** §3 was
  written as a flow before FLOW measured that the flow does not run; the third
  state in §3's status column is that correction, applied in place rather than
  quietly. Any section of this file that says "the core does X then Y" is
  describing a **design that has been unit-proven at each step and never
  executed as a sequence**, and §3.2 is the standing caveat on all of it.
- **§4.4's `accepts` field fails D2 in one direction**: the refusal names the
  setting, but nothing tells the operator that their declaration is wrong when
  it is. There is no probe (§7.1 item 4) and inventing a confident one would be
  worse than the gap.

---

## 10. The read-through, and how to steer a turn

`NORTH-STAR.md`'s fourth test: *a competent reader follows a request from the
input box to the model call and back, in one sitting, without asking anyone.*
This section is that test written down. Signatures and prose; no bodies.

> **Read §3.2 first.** Rows 1–4 of the table below do not exist, and rows 5–13
> exist as parts that have never run in sequence. This is the chain **after
> 2.7 and 3.3**; it is written in the present tense because it is the design of
> record, and it is the shape the join must produce. Today the reader cannot
> take this walk, and that is the finding, not a caveat on the finding.

### 10.1 One turn, with control named at every step

The column that matters is the last one. **Control-flow inversion is where a
system like this becomes unreadable**, so every inversion is named, and every
one is either justified here or is a bug.

| Before | The call | After | May fail | **Who holds control** |
|---|---|---|---|---|
| a string in a React state hook | `submitTurn(text)` | a `ToEngine` message posted, a promise pending | nothing yet | **The React handler**, until it returns |
| that message | `workerClient.request(msg)` | a promise keyed by `id` in the in-flight map | the worker is dead → **every** in-flight request rejects with `worker stopped` | **INVERTS** → the `MessagePort`. The promise is resolved by a later `onmessage`, not by this stack. *Right because two realms cannot share a stack, and a promise is the smallest thing that spans one.* |
| the message, in the worker | `serve(scope)` → one `case` | a queued turn | a live turn on this session → refused, named | **`engine/host.ts`**, one switch, one case per type |
| a queued turn | `turns.start(...)` | a `Session` with an id from `ports.newId()` | — | **`engine/turns.ts`**, which owns the whole turn |
| a `Session` | `agent.turn(session)` | — | — | **`core/agent/agent.ts`**. The core now holds control and does not give it back until it has a `Reply` |
| a `Session` | `this.#prompt(session)` → `promptFor(recipe)` → `baseComponents` → `assembler.assemble` | **one string** | **raises** on the three invariants | Still the core, synchronously. **Nothing inverts inside assembly, and that is why the prompt is reproducible** |
| that string | `observer.assembled?.({ turnId, phase, prompt })` | an event on its way to a pixel | a throwing observer would take the turn with it | **INVERTS** → out of core, into `engine/observer.ts`, onto the wire. *Right because core cannot know a wire exists; the alternative is core importing protocol, which §2 forbids in both directions.* |
| `{ prompt }` | `inference.infer(req, onDelta, signal)` | a `Promise<InferenceResult>` | non-2xx throws with the first 500 bytes; a 200 with no body throws naming the URL | **INVERTS** → the transport. It holds control for the entire stream and calls **back** per chunk |
| each SSE frame | `onDelta(chunk)` | `turn/delta` posted | — | **The transport's read loop.** *Right, and an async iterator was rejected: `Agent.turn` has nothing to do between chunks, so `for await` would be a loop whose body is one call — and the observer path already consumes callbacks, so an iterator would be a second spelling of one thing* |
| `turn/delta` | `postMessage` | a row on the tape | **no back pressure exists here** | **Nobody.** Fire and forget, never awaited. A fast local model can outrun the main thread's render and nothing today measures it. Honest gap |
| `result.text` | `model.parse(raw)` | a typed `Reply` | **never throws**; degrades through the other format, then whole-reply-as-answer | Back to the core, synchronously |
| a `Reply` | `session.transcript.add('assistant', …)` | the transcript mutated **inside** the turn | — | The core. Noted in §0.1 as the one place the agent holds state that is not a message |
| `reply.isAnswer === false` | `tools(call)` → `Toolbox.invoke(text, onResults)` | one string the model reads next | **never throws**; a failure is a value | **INVERTS** → the toolbox, calling back **per batch** so the tape shows a batch completing rather than everything at the end |
| a `Reply` + `session.seen` | the react loop | another turn, or a stop | the give-up path synthesises an answer (E4) | **`core/agent/react.ts`** — the only place that decides to go round again |
| the final reply | `turn/done` | the tape's answer row, the `messages` store | — | Back to `engine/turns.ts`, which closes the turn it opened |

**Where control deliberately does not invert:** `client/actions.ts` is plain
async functions, not hooks. The Door's `probeEndpoint` fires **before any
surface has mounted**, and a hook cannot serve that. Read and write are two
directions and they do not have to be one object.

### 10.2 Steering — reaching in and changing a turn mid-flight

The theme demands it — *a person should be able to reach in and change a turn
mid-flight* — and **today nothing in the tree can.** Five asks, ruled by cost.

| Steer | Cost | Ruling |
|---|---|---|
| **Cancel mid-stream** | **Not free — the seam is severed.** ~~designed and scheduled~~ | The transports honour a signal in four places, and **no caller can supply one**: `Agent.turn` calls `infer` with two arguments and neither `Agent`, `Session` nor `react()` has a signal field (FLOW §3). **A turn in flight today is uncancellable.** The change is one field threaded `AgentOptions → Session → turn → infer`, and it is **2.7's** (§3.3), which is also what makes assertion (d) of §3.4 writable. After that: `abortTurn()` → `turn/abort` → the real `AbortController` on the real `fetch` |
| **Inject a correction while generating** | **Cheap, but the semantics are undesigned** — `steerTurn(text)` is declared in §5.8 and nothing says what the engine does with it | **Ruled here: steer = abort the in-flight inference, append the correction to the transcript as a `user` message, and let the next loop iteration re-assemble.** No mid-prompt injection, no new component, and the correction lands in HISTORY where the model already reads. **And the partial reply is recorded as an aborted assistant message, not deleted** — a tape that drops what was already said is a tape that lies |
| **Force a tool call** | **Cheap.** One new `ToEngine` request | The harness runs the tool and inserts the `ToolResult` text as the next thing the model reads. **This is not E4** — a tool result is not a model message, so the harness is not speaking in the model's voice |
| **Replay with one component changed** | **Cheap one way, not the other.** "Re-send this exact prompt" becomes nearly free once §3.5's ruling lands and the `Breakdown` reaches `AssembledEvent` — it is plain data. *(It does not cross today: `protocol/` does not exist, and `PromptBreakdown` is a name no file defines — FLOW gap A6.)* | "Re-send with component X edited" needs `assemble(components, { overrides: Map<key, string> })` — an override map keyed by the existing `key()`, **not** a new component type. It is a knob with one caller until DESIGN §4.3's Prompt surface has an edit box, so **it is built at 6.4 with that box and not before** |
| **Pause before an action commits** | **Expensive, and it changes the protocol.** The worker would have to await a main-realm decision, and worker→main is events only | **The change, named:** a `FromEngine` event `tool/pending` plus a `ToEngine` `tool/approve` / `tool/deny`, correlated by turn id and batch index. This makes the worker **block on the main thread for the first time in this architecture**, so it is not optional that it carries a **reporting deadline** (§6.5) — without one, a closed panel or a dead main thread hangs a turn forever and the session is unrecoverable. The alternative shape — a `requiresApproval` flag that simply ends the turn and resumes as a new one — needs no protocol change and is worse, because the model's context is rebuilt around a gap it cannot see |

Two of the five are free, two are cheap, and one is a protocol change with a
mandatory deadline attached. That distribution is the useful output of the
section: **the theme's mid-flight promise is mostly already paid for by the
shape, and the one part that is not is the one that inverts control between the
realms.**

---

## What this document does not decide

| Open question | Left to |
|---|---|
| **Whether `2.7` is adopted as an increment**, and its exact file list. §3.3 rules that it is next and gives its shape; only the architect editing `PLAN.md` can make it real, and this file cannot | The next `PLAN.md` edit. **Everything else in this table is behind it** |
| Whether `scripts/checks/reach.ts` is a gate check or a deploy check, and what its opening allowlist is | The increment that writes it — proposed as part of `2.7`, so the check and its first red run land together |
| Whether the eight false present-tense sentences FLOW records in `ARCHITECTURE.md` (gaps A1–A8) are corrected, and the three DONE-but-absent files (B1–B3, including the `max` ratchet PLAN says 2.6 armed) | The architect, in `ARCHITECTURE.md` and `PLAN.md`. **Not this file — it does not own them, and it cites FLOW wherever it would otherwise have relied on one** |
| **Whether multimodality is built at all**, and in which wave. §4 is a design, not a schedule; `ARCHITECTURE.md` §9 still lists attachments as out and only the architect editing `PLAN.md` may move that | A PLAN increment — proposed as **wave 7**, after `[4.3]` (tools work) and `[6.4]` (Context can render the elision). Nothing before, **and nothing before the join** |
| Whether `turn/delta` needs a `channel` field to keep a tool-calling turn readable (E3) | `ARCHITECTURE.md` §11, settled by a human watching PLAN 3.3's smoke run — **observation first, design after** |
| Whether the repeat guard's ledger keys on the sorted set of call *names* | `[4.2]`, which is the first increment that knows what a call name is. `ARCHITECTURE.md` §9 carries it as a knowing defect |
| Whether a per-turn tool-output budget exists, and what it drops when hit | The first measured turn that overruns. A second cap needs a drop policy and a drop policy has no caller yet |
| Compaction, and whether it is an **event** in the log rather than a mutation (`REFERENCES.md` item 1) | After real token accounting. `ARCHITECTURE.md` §11's `usage` question blocks it |
| Whether `next` stays (§2.2) | A retro, in an increment whose **first act** is re-running the M1/M2/M3 probes |
| The `MODALITIES` table (§6 recipe 5) | The increment that adds the second modality, first commit |
| Whether the tool that ends a turn should be a tool the model calls, rather than a parser deciding what looks like an answer (`REFERENCES.md`: two independent designs converged on it) | A ruling weighed against the response-model approach, no earlier than `[4.5]` |
| Sub-agents, skills, MCP | `ARCHITECTURE.md` §9. Each returns with its second caller or never |

---

**DECISION (amended after `docs/scratch/FLOW.md`).** The most important thing
this document says is §3.2: **the parts of this system have never run
together.** `promptFor` has one caller and it is a test; `new Agent(` appears in
`src/` zero times; nothing under `src/app`, `src/client` or `src/ui` reaches
`src/core` at all; and `Agent.turn` calls `infer` with two arguments, so the
seam for reaching into a turn is severed one level above where it was built.
Every part is green — 86 tests, 6 checks, byte-exact goldens — because **every
check in this gate has a file as its subject and none has a relationship.** This
is the declared-but-never-emitted defect one layer up: not an event with no
consumer, but a seam with no join, and it is invisible to grep because both
endpoints exist and both are exercised. The ruling: **`2.7` "one turn, joined"
is next and precedes every wave 4, 5 and 6 increment**, because each of those
adds only more unjoined parts and the join's cost compounds; PLAN 3.3's
acceptance — a streamed token in the built export — is not satisfiable without
it. The check that makes it inexpressible in future is a **source import-graph
reachability check** with an allowlist carrying an expiry increment, checked in
both directions, plus **one integration test asserting that the prompt the
transport received is byte-identical to the golden** — the transport's input,
not the assembler's output, which is the whole difference between proving a part
and proving a path. And `assemble()`'s discarded breakdown is ruled **a missing
wire, not dead weight**: `RenderPrompt` returns the `Breakdown` and
`AssembledEvent` carries it, at 2.7, at the same seam §4 widens for parts.

**DECISION (original).** An agent here is one message and one contract: the prompt is a
sorted bag of immutable components and the reply is read against the same
`FIELDS` table that asked for it, which makes composition the domain model
rather than a code-style preference. The thesis is stated with five named
exceptions — the loop is a table not a message, tool execution is an effect, the
token stream has no contract, the repeat guard speaks in the model's voice, and
`src/engine/` is outside the law entirely — because an architecture that cannot
name its exceptions is advertising. On the owner's "least dependencies": the
floor for a turn is `fetch` plus an endpoint, the four chosen deps all stay with
their exit conditions written down, and seven things that look mandatory are
refused by name. On multimodality: **bytes never become prompt text and never
enter `src/core/`** — a component declares a `PartRef`, the worker resolves it
from a content-addressed `blobs` store at a new step between assembly and
transport, the OpenAI content array is emitted only when a part exists so
text-only bodies stay byte-identical to the recorded fixtures, and a model that
cannot see images is refused **at assembly** against an operator-declared
`accepts` field on the config row — not on the kind catalogue, which describes a
wire protocol and not a model. The trade I made: one optional method on
`Component` and one optional field on `InferenceRequest`, paid by every text-only
path as an empty array, bought instead of a `render(): string | Part[]` union
that would have made forty files pay for one.

**FILES.** Creates `/Users/kaush/Downloads/Dev/ASKK/docs/AGENT.md` (owner:
architect). No other file created or edited. Raises three items against files
owned elsewhere and **not touched here**: `docs/PLAN.md` must adopt a wave 7 if
§4 is ever built (owner: architect, later increment);
`docs/ARCHITECTURE.md` §9's "Attachments / multimodality" row and §4's file map
would gain `core/prompt/part.ts` and `engine/parts.ts` in that same increment
(owner: architect); `scripts/checks/docs.ts` `[1.7]` must add this file to its
`§N.M` resolver and its cross-reference set (owner: coder, at 1.7).

**CONTRACTS.** Proposed, none built:
`interface PartRef { id; sha; mime; name; bytes }` — a non-text part by
reference, metadata only.
`Component.parts(): readonly PartRef[]` — default `[]`; what this component
carries beside its text.
`type RenderPrompt = (session: Session) => { text: string; parts: readonly PartRef[] }` —
the prompt seam, widened by one field.
`interface ResolvedPart { mime: string; data: ArrayBuffer }` — bytes, produced
in the worker, never in core.
`InferenceRequest.parts?: readonly ResolvedPart[]` — absent means the body is
byte-identical to today's.
`ConfigRecord.accepts: readonly string[]` — default `['text']`; what the
operator declares this model can read.
`blob/put { mime, name, data } → { sha }` and `blob/read { sha } → { mime, data }` —
the only two messages that carry bytes, in that direction each.

**ACCEPTANCE.** Verbatim, runnable today:
`test -f docs/AGENT.md` exits 0.
`grep -c 'UNJOINED' docs/AGENT.md` returns non-zero — the third state is in the
flow table, not only in prose.
`grep -n 'reach.ts' docs/AGENT.md` names both the check and how it is watched red.
`grep -n 'UNENFORCED' docs/AGENT.md` returns non-zero, and item 0 of §7.1 is the
unjoined-seam gap.
`grep -n 'PhaseInstructions\|PromptBreakdown' docs/AGENT.md` returns only lines
that cite FLOW and correct them — this file relies on neither.
Every `[N.M]` tag resolves to an increment in `docs/PLAN.md` **or** appears in
the "does not decide" table as unscheduled; the `[7.1]` and `[proposed]` tags
are the unscheduled ones and each is named there.
Human acceptance: a reader who has not read `ARCHITECTURE.md` can name the
thirteen parts of an agent, the thirteen steps of a turn, one pattern this tree
refuses, and **why 86 green tests do not prove the system runs.**

**RISKS.** (0) **The largest risk is that §3.2 is read and not acted on.** This
file can rule that the join comes next; only `PLAN.md` can make it next, and
every increment that lands before it makes it bigger. A ruling in a document
nobody schedules is the same shape as the defect it describes. (0b) §3.4's
reachability check is red on ~19 files on its first run, which means its opening
allowlist is large — and a large allowlist written in a hurry is how a check
becomes a formality. Its `expiresAt` direction is the only thing standing
against that, and it is unwritten. (1) §4 designs a feature `ARCHITECTURE.md` §9 currently forbids; if it
is read as a licence rather than a design, someone builds attachments before
tools work, which is exactly the ordering that produced `{data:"", format:""}`
last time — the "does not decide" table is the only thing holding that line and
it is prose, not a check. (2) `accepts` is operator-declared and will be wrong
on somebody's endpoint; the failure is a refused attach on a model that would
have worked, which is the safe direction but is still a wrong answer with no
probe behind it. (3) This file is a fifth document in a system whose CLAUDE.md
says the documents are the only channel between agents — a fifth channel is a
fifth thing that can go stale, and `checks/docs.ts` does not yet know it exists.
(4) Five named exceptions to a thesis is either honesty or the thesis being too
weak to be load-bearing; I have argued the former and E1 is the one that would
overturn it, because if control flow ever needs to be composable the message
model stops being the whole domain. (5) The `PartRef`/`ResolvedPart` split keeps
core pure at the cost of a step (4½) that exists in no other flow, and a step
with one caller is the shape this tree deletes.
