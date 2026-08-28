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

If the thesis is true, then the message is a **sorted bag of parts**, each of
which knows how to write itself down and how to vanish when it has nothing to
say. That is exactly `core/prompt/` as shipped at 2.6.

**And here is the honest weight of that.** An earlier draft of this sentence
read *"composition is not a style preference, it is the domain model."* That
claims more than §3 demonstrates. Read the whole file for decisions that turn on
the thesis and **there is exactly one**: §1.1 observation 2 — there is no
`UserQuery` component, because the user's message is not privileged in a bag of
parts. Everywhere else the thesis **corroborates** a reason that was already
decisive on its own: `parts()` is one method because a visitor is double
dispatch nobody bought; `accepts` is on the config row because the kind
catalogue describes a wire protocol; the flow is a table because objects that
know their successors cannot be validated as a graph.

> **Ruling: "an agent is a message" is never sufficient grounds for a
> decision.** It is a lens that makes a tree of independently-argued decisions
> legible as one shape. Any later proposal that cites it must also carry the
> reason that would stand if the thesis were deleted. A thesis that can justify
> anything has stopped being load-bearing and started being a slogan.

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
show it. **The gap that mattered:** nothing distinguished a synthesised
assistant message from a real one *in the transcript itself*, which is what the
next prompt renders back — so the model reasons over a sentence it did not
write, which is `LESSONS.md` defect 3 in its purest form.

> **This is no longer an UNENFORCED item. It is scheduled, in `2.8`.** A
> transcript entry gains one field, `origin: 'model' | 'harness'`, defaulting to
> `'model'`; `historyLines()` renders a `'harness'` entry behind a verbatim
> marker so the next prompt cannot present it as the model's own words. The
> marker is model-facing product copy: written once, verbatim, and the golden
> fixture is regenerated deliberately in the same commit (§6 recipe 2's rule).
> It is one field and one branch, it lands at the seam 2.8 is opening anyway,
> and it is the cheapest possible answer to the sharpest exception in this
> file.

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

> **On row 1's path:** `public/seed/agents/main/agent.md` `[4.1]` is
> `ARCHITECTURE.md` §4's own entry, verbatim and with the same tag. A reader who
> greps for it in the tree finds nothing, and in sibling worktrees finds
> `public/agents/main/agent.md` **without** the `seed/` segment — that is stale
> scaffold, not the record. `ARCHITECTURE.md` owns paths; this file follows it.

> **This table is reference, not memorisation material.** A cold reader recalled
> ten of eleven rows, which is one past what anyone should be asked to hold, and
> the fix is not to cut a row — every row is a thing an agent needs. The five
> rows marked ● in the last column are the set worth carrying in your head; the
> rest are looked up. Stated so that a later reader does not read their own
> failure to recall row 11 as a failure of the table.

| # | Part | What it is | Where it lives | Authored by | Read when | Slot | If missing | Min? |
|---|---|---|---|---|---|---|---|---|
| 1 | **Identity** | The words that say who it is, read verbatim | `public/seed/agents/main/agent.md` `[4.1]` — **`public/` does not exist yet**; overridden in the `agents` store `[3.4]` | **Human** | Every render (memoised on `key()`) | 0 `SOUL` | Assembler **raises** unless a SYSTEM exists — an agent must be someone | ● one of 1/2 |
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
| `idb` | Promise-shaped IndexedDB *with correct transaction lifetime* | We hand-roll ~80 lines of promise wrapping and never once `await` a non-IDB promise inside a `readwrite` transaction | **Keep, allowlisted with an expiry (below).** The line is thin and the payload is not: the `seq` allocator's atomicity is exactly the property a hand-rolled wrapper loses first, and this tree has already paid for that defect class once. |

> **`idb@8.0.3` has ZERO importers** (FLOW, as of the commit in its header;
> `StorePort` has zero callers and its only mention is a comment). **A declared
> dependency with no importers is an unreachable module with a different file
> extension** — it is the §3.2 defect wearing a `package.json` hat.
>
> An earlier draft ruled on this in prose — *"it stays, and the ruling is
> conditional and dated; if 3.4 slips past wave 4 it is deleted"*. **That was
> the same defect it was written to indict:** a conditional nobody executes is
> a comment. So the ruling now lives in the mechanism.
>
> **Ruling: `idb` stays, and it stays inside `scripts/checks/reach.ts` `[2.9]`,
> not inside this paragraph.** That check gains a **second allowlist, over
> `package.json` dependencies**: a declared runtime dependency whose name
> appears as an import specifier nowhere in the reachable graph fails, unless it
> holds a `{ name, reason, expiresAt }` entry. `idb`'s entry reads *"caller is
> `engine/db.ts` at 3.4"* and **expires at the end of wave 3** — a wave, not an
> increment number, because §3.3 has just demonstrated that increment numbers
> get inserted into. When wave 3 closes with `idb` still unimported, the gate is
> red, and the dependency is deleted and re-added with its caller. The extension
> is nearly free: reach.ts already builds the specifier set, and the only new
> work is reading `dependencies` and comparing two sets.

### 2.3 (c) The seven that look mandatory and are not

| Looks required | Why it is not | Cost of doing without |
|---|---|---|
| A proxy/server for CORS or to hide the key | The endpoint is the user's own; `engine/probe.ts` distinguishes *refused* / *CORS* / *http* / *timeout* so the failure is legible | One probe with four named outcomes, which we want regardless |
| A tokenizer, for the cost row | `usage` comes from the endpoint or it is `null`. DESIGN prints "reported" or "unknown", never a confident number (`ARCHITECTURE.md` §11) | Honesty instead of a number |
| A YAML parser, for `agent.md` frontmatter | The grammar we accept is a closed, documented subset. `core/agent/agentfile.ts` `[4.1]` | A hand-written line parser and a *stated* grammar — which is better, because a full YAML parser silently accepts things `agent.md` should reject |
| An SSE client library | Already hand-rolled in `core/inference/openai.ts`, ~40 lines, frame-by-frame to `[DONE]` | Done. Zero. |
| A UUID library | `crypto.randomUUID` behind `NewIdPort` | Zero |
| A state manager | `client/store.ts` is one switch over a closed union, subscribed via `useSyncExternalStore` | Zero, and the switch is what `checks/protocol.ts` proves total |
| A base64 codec / image library (§4) | `Blob.arrayBuffer()` in the main realm, `btoa` or a hand-written `Uint8Array` pass in the worker. **The worker is classic (M2) — a dynamic `import()` of a codec is not available anyway.** Costs an allowlist edit, named in §4.3 rather than left to be discovered | ~20 lines, statically bundled |

**Ruling on the floor: four dependencies on the cold-open path, and the number
does not change for multimodality.** If a proposal adds a fifth, the increment
that adds it takes one of the two doors below.

> **Reconciled with §8.3, because one document may not rule twice on one
> question.** §8.3 requires an ONNX/transformers runtime for local STT, and that
> is a fifth package. The earlier draft left the two sentences standing side by
> side, which is a contradiction wearing two section numbers.
>
> The reconciliation is to fix **what is counted**. §8.3 already states it —
> *"least dependencies is measured as bytes on the cold-open path, not as a
> count in `package.json`"* — and **§2.2's sentence is amended to agree, rather
> than the other way round**, because a package count is a proxy and bytes on
> the cold-open path are the thing `NORTH-STAR.md`'s cold-open test actually
> measures.
>
> **The rule with teeth, then, has two doors and a fifth dependency must take
> one:** either (a) it is **absent from the cold-open path, by measurement** —
> and the measurement is §8.3's check 3, a browser recording asserting zero
> requests to any model host before the microphone control is pressed — or (b)
> it **names the row of §2.3 it refutes**. The STT runtime takes door (a) and
> its increment's acceptance is that recording. Multimodality takes neither
> door, which is why §4 adds **no** dependency at all: about twenty hand-written
> lines of base64 instead of a codec, which is §2.3's last row doing its job.

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
| 4½ | **Resolve parts** *(§4)* | `PartRef[]` + the `blobs` store → `ResolvedPart[]` (bytes) | W | A part whose mime the active config does not `accept` → `turn/failed` naming the model and the setting. **Bytes never enter `core/`** | **UNSCHEDULED** — see the closing table |
| 5 | **Transport** | `{prompt, parts?}` → `describeRequest()` → `RequestRecord` → `fetchPort` | C (+ `FetchPort`) | Non-2xx throws with the first 500 bytes of the body; a 200 with no body throws naming the URL | **2.3 DONE, ✂ UNJOINED** |
| 6 | **Stream** | `ReadableStream` → SSE frames → `onDelta(chunk)` → `turn/delta` → the tape | C → W → M | The transport honours a signal in three places. **No caller can supply one** (FLOW §3, `agent.ts:119-121`) — a turn in flight today is **uncancellable** | 2.3 DONE, **✂ SEVERED** · rejoined at **2.8** · 3.3 |
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
| 4½ | Core silently acquires the ability to hold bytes | **Already enforced, in value positions.** `checks/purity.ts`'s `ES_GLOBALS` is a closed allowlist of about forty names and `ArrayBuffer`, `Blob`, `File`, `FileReader`, `btoa` and `atob` are **not among them**, so a core file naming any of them fails today. **The hole that is real:** the check does not reach **type positions** — a planted `interface R { data: ArrayBuffer }` in `src/core/` was **not** flagged. That is UNENFORCED and §7.1 item 6 states it |
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

### 3.3 The joining increments — ruled, and they come first

**No increment in `PLAN.md` was assigned the job of connecting these parts.**
FLOW gap F1 says so explicitly: 4.1 builds the agent identity file and
`engine/build-agent.ts` `[4.1]` is the plausible home, but nothing in 4.1's
acceptance says so, and 4.1 is three increments away behind two waves.

**Ruling: the join is scheduled, it is next, and it precedes every wave 4 and
wave 5 increment.** The reason it is right rather than merely reasonable:

> **Every increment added before the join makes the join bigger, and waves 4 and
> 5 add nothing but more unjoined parts.** 4.2 adds a `Toolbox` whose `invoke`
> would fill a seam nothing calls. 4.5 adds a driver over a loop that has never
> run against a real prompt. 5.x adds a sandbox below an agent that has never
> executed. The compounding is not linear: a join of two parts is one
> assertion; a join of six is a wave.

**Wave 6 is NOT blocked, and an earlier draft was wrong to say it was.**
`PLAN.md` rules that wave 6 runs in parallel with waves 2–5 from 1.4 onward, and
on ordering this file is subordinate to PLAN. 6.1 (tokens and `checks/design.ts`)
and 6.2 (primitives and the addressed shell) import nothing under `src/core/**`
and depend on no core seam; blocking them would have bought nothing and cost the
one lane that is genuinely parallel. **6.3 and 6.4 are a different matter and
PLAN already handles it** — their acceptances are *a person follows a full turn*
and *Context renders the literal request body that left the tab*, and neither is
satisfiable without a turn. That is dependency by acceptance, which is the right
mechanism, and it needs no ordering rule here.

**The join is TWO increments, not one, and the split is not cosmetic.**

#### `2.8` — "one turn, joined." Next, before wave 3.

Core-only; needs no worker. One increment because these four changes cannot be
verified apart from each other — the integration test is the acceptance for the
signal field, and the signal field is what makes the test writable.

- `src/core/agent/build.ts` — `buildAgent(options): Agent`. One function whose
  entire job is to be **the single place `promptFor` meets `new Agent`**: it
  builds the recipe, hands `promptFor(recipe, assembler)` to `AgentOptions.prompt`
  and a `BaseResponse` subclass to `AgentOptions.model`.
- **`Agent` accepts and forwards an `AbortSignal`**, so `infer` is called with
  three arguments and the severed seam is rejoined. This is the smallest change
  that turns "uncancellable" into "cancellable", and it is one field.
- **`RenderPrompt` returns the `Breakdown`, not a bare string** (see §3.5), and
  `AssembledEvent` carries it.
- **A synthesised give-up answer is marked in the transcript** (E4): one
  `origin: 'model' | 'harness'` field on a transcript entry, rendered behind a
  verbatim marker by `historyLines()`, so the next prompt cannot hand the model
  its own harness's words back as its own. The golden is regenerated
  deliberately, in the same commit.
- `tests/turn.test.ts` — the integration assertion of §3.4 check 2.

#### `2.9` — the reachability check, seeded from the joined tree.

**Its own increment, and it must come second.** The check ships with an
allowlist of every module it cannot reach, and **the only tree from which that
allowlist is honest is the post-join tree.** Seeded before 2.8, the allowlist
would contain the entire core — nineteen files whose unreachability 2.8 is
about to fix — and an allowlist written around a defect that is being repaired
in the next commit is a formality on arrival. Seeded after, every remaining
entry is a real, argued exception with an expiry.

It is also **independently revertable**, which one combined increment would not
have been: reverting a check must not revert a join.

#### Half two — the page reaches it, and that is PLAN 3.3.

PLAN 3.3's acceptance is *"tokens render as they arrive, through the worker, in
the built export served at a subpath."* **That acceptance is not satisfiable
unless 2.8 has landed** — there is nothing to stream. 3.3 does not need
rewriting; it needs 2.8 in front of it, and stating that here is the point of
this paragraph.

**Why `2.8` and `2.9` rather than `2.7`.** `2.7` is taken. `PLAN.md` records at
two places that *"2.7 moved to 3.4"* back at increment 0.3, so reusing the
vacated number would put two different 2.7s in one record — and the record is
the only channel between agents. `PLAN.md` now carries the same note beside the
new numbers.

**Why `buildAgent` is not itself the defect it fixes.** At 2.8 its only caller
is a test, which is precisely the shape FLOW just indicted. Two things make it
different and both must be true or the ruling is wrong: its **second caller is
named and scheduled** — `engine/build-agent.ts` at 4.1, which becomes the thin
thing that reads a config record and an `agent.md` and calls this — and it goes
into 2.9's allowlist **with an expiry**. **That expiry is `end of wave 4`, not
`4.1`.** An earlier draft wrote the increment number, and a critic broke it in
one line: if 4.1 slips, an expiry keyed to 4.1 never fires, and `buildAgent`
lives indefinitely with one test caller — the defence firing only when the thing
it guards against does not happen. A wave boundary cannot slip past itself.

### 3.4 The two checks, and exactly what each one proves

Two checks, and the second is where the weight actually sits. An earlier draft
had this the other way round and it was wrong.

#### Check 1 — `scripts/checks/reach.ts` `[2.9]`: **no module is orphaned from a build**

> **Every module under `src/**` must contribute a **value** to the bundle
> reachable, by static imports, from a declared entry point — or hold an
> allowlist entry naming a reason and an expiry.**

**The title says "orphaned from a build" and not "joined", and the difference is
the whole of this subsection.** The first draft called this the check that makes
an unjoined seam inexpressible. It is not, and a critic proved it two ways:

1. **Type-only edges are not edges.** All four inbound imports of
   `src/core/ports.ts` are `import type` (`agent.ts:32`, `base.ts:16`,
   `scripted.ts:23`, `catalog.ts:20`). `tsc` erases every one; the emitted chunk
   contains none of it. A check that counted them would mark a file reachable
   that is, in the artifact, absent — which is the tree's own measured rule
   about the distance between source and bundle, applied against itself.
2. **Reachability is not use.** `buildAgent` could import `ReActResponse` and
   never pass it, and this check would be entirely satisfied. That is FLOW's
   recorded defect verbatim.

**So the fix, and the two consequences that must be accepted with it:**

- **Skip `import type` declarations and type-only specifiers** (`importClause.isTypeOnly`,
  and per-specifier `isTypeOnly`). The TypeScript AST answers both directly;
  reach.ts already needs the compiler for module resolution.
- **The first run is redder than it would otherwise have been**, and that is the
  correct price. `src/core/ports.ts` in particular becomes unreachable **by
  construction** — it exports types and `stubPorts()`, and if only the types are
  imported it genuinely contributes nothing to a chunk. It gets an allowlist
  entry that says exactly that, expiring at **end of wave 3**, when
  `engine/entry.worker.ts` builds real ports and imports the value.

**What this check therefore proves:** no file in `src/` is dead weight — every
one is on a value path from `layout.tsx`, `page.tsx` or a worker entry. **What
it does not prove, stated plainly because §7 previously let it carry weight it
cannot hold:** that anything imported is *called*; that the values crossing a
seam are the right values; that a seam has ever executed. Check 2 carries all
three, and it carries them **for exactly one path** — the one turn it runs.
Every other seam in this tree remains R0 after 2.9, and that sentence is the
honest state of the gate.

**Its parts:**

- **Roots**, as one exported constant: `src/app/layout.tsx`, `src/app/page.tsx`,
  and every `*.worker.ts` under `src/engine/`. A root is a file the platform
  loads without anyone importing it, and there are only these.
- **Edges**: value-carrying static `import` and `export … from`, resolving
  `@/*` → `src/*`. Plus `import()` **with a literal specifier**, which §8.3's
  lazily-fetched speech chunk needs. **A non-literal `import()` is a hard
  failure**, not an unknown: a computed specifier is unanalysable, this tree has
  no need for one, and letting it through would put a hole in the check's own
  authority.
- **Failure**: names the unreached file *and the roots it searched from*, so the
  message answers "unreachable from what".
- **Two allowlists, both `{ path | name, reason, expiresAt }`, both checked in
  both directions.** One over modules, one over `package.json` dependencies
  (§2.2). Unreached-and-not-allowlisted fails. **And an entry whose `expiresAt`
  has passed while the subject is still unreached also fails** — that second
  direction is what stops the allowlist becoming the place unjoined code goes to
  live.
- **`expiresAt` is a wave boundary or a date, never an increment number.**
  §3.3's own numbering is an insertion into the sequence, which is the argument:
  a number that can be renumbered, deferred or cut cannot be a deadline.
- **How expiry is evaluated:** the closed wave is read from `PROGRESS.md`, which
  is the mechanism `checks/docs.ts` `[1.7]` is **designed** to use.
  `scripts/checks/docs.ts` **does not exist** and 1.7 has not shipped; an
  earlier draft wrote "already uses", in the document whose thesis is that this
  tree keeps asserting the present tense about absent files. **2.9 therefore
  depends on 1.7**, and if 1.7 has not landed, 2.9 reads PROGRESS itself and
  1.7 deduplicates.

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
2. Set an allowlist entry's `expiresAt` to a wave `PROGRESS.md` records as
   closed → the check fails naming the stale entry, subject still unreached.
3. Turn a real `import` into `import type` → the file it pointed at goes
   unreachable. This is the one that proves the type-only fix is live, and it is
   the cheapest of the three.

**What it would have caught, run against the pre-join tree:** `core/prompt/*`
(**6** files), `core/agent/*` (4), `core/response/*` (3), `core/inference/*`
(4), `core/ports.ts`, `core/observer.ts` — nineteen, essentially all of
`src/core/` — because no root reaches any of it. *(An earlier draft wrote
"7 files" for `core/prompt/*`; the directory holds six, and the total of
nineteen only ever worked at six.)* That number is why 2.9 is seeded after 2.8
and not before.

#### Check 2 — `tests/turn.test.ts` `[2.8]`, one real turn with no doubles

A reachability check proves a wire exists. It cannot prove the wire carries the
right bytes. **This is the check that closes the unjoined-seam gap, and it
closes it for one path.**

> **One test constructs a real `Agent` via `buildAgent`, with the real
> `PromptAssembler`, the real components, a real `ReActResponse` as `model`, and
> `ScriptedInference` holding a recorded reply — and runs a turn end to end.**

Five assertions, and the first is the one that does the work:

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
  Impossible to write today; possible the moment 2.8's one field lands, which is
  what makes it the acceptance for that field rather than a hope about it.
- **(e)** A turn driven to the repeat guard's third tier produces a transcript
  entry with `origin: 'harness'`, and `historyLines()` on the next render
  carries the marker (E4).

**Watched red:** replace `buildAgent`'s prompt with the one-line double the
agent tests use → **(a)** goes red, because the double does not produce the
golden bytes. **The golden is what makes the double detectable**, which is the
sharpest argument available for why 2.0 landed the oracle first.

*(An earlier draft added a grep — `grep -c 'prompt: () =>' tests/turn.test.ts`
returns 0 — as a structural guard against a double. **Deleted.** It matches
nothing: the existing double is a module-level `const` passed by shorthand at
`tests/agent-react.test.ts:99`, so the pattern returns 0 there too, and in the
new test the token cannot appear at all because the agent comes from
`buildAgent(options)`. A check that cannot be watched fail is not a check, and
one that is green for the wrong reason is worse than none. Assertion (a) is the
real guard and it needed no help.)*

### 3.5 The work done every turn for no consumer

`PromptAssembler.assemble()` is `this.detail(components).prompt`
(`assembler.ts:119-120`). Every `Band`, both hit/miss counters and `CORE_MARK`
are computed on every turn and then discarded, because `AssembledEvent.prompt`
was supposed to become the breakdown at 2.6 and did not.

**Ruling: a missing wire, not dead weight — and the wire belongs to 2.8.**

The breakdown has two consumers, one designed and one that already exists and is
being handed the wrong thing. The designed one is `turn/prompt` carrying it to
DESIGN §4.3's Prompt surface. The existing one is `AssembledEvent`, which fires
**before** inference precisely so a UI can show what was assembled — and it
currently carries a string, throwing away the per-component bands that are the
only reason that surface is worth having.

So: **`RenderPrompt` returns the `Breakdown` and `AssembledEvent` carries it.**
One change, at the seam 2.8 is opening anyway, and the same seam §4 widens for
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
that would let it back in. **It is UNSCHEDULED**, and the closing table says so.

### 4.0 The one-row objection, answered — and §4 shrunk by one field

§5.2 rejects a `MODALITIES` table because it would have **one row**, and this
section then accepts, for that same one row, a `PartRef`, `Component.parts()`,
`ResolvedPart`, `InferenceRequest.parts`, `ConfigRecord.accepts`, a `blobs`
store, `engine/parts.ts`, two protocol messages and a flow step 4½. A critic put
that side by side and asked which rule is real. It is a fair hit and it gets a
straight answer rather than a waiver.

> **The rule is about tables, and a table is not a path.** A table's whole
> function is to **dispatch**: given a key, produce a row. A table with one row
> decides nothing — the branch it replaces was never taken, so it is pure
> indirection, and that is why `MODALITIES` is refused. A **path** carries a
> payload from a source to a sink. Its cost is not a function of how many
> payload *kinds* exist; it is the same code for one mime prefix and for
> twelve. Delete the second modality from the world entirely and every piece
> named above is still required to get one image from a file input to an
> endpoint without bytes entering `src/core/`.
>
> The falsifiable form of that claim, so it is not just a distinction drawn
> conveniently: **name a piece of §4 whose existence is caused by the
> possibility of a second modality.** There is exactly one — the `kind` union —
> and §4.5 already refuses it. If a reviewer finds a second, §4 shrinks again.

**And it does shrink, by one field, found while answering this.** `PartRef.id`
is gone: the store is content-addressed, `sha` **is** the identity, and a second
identifier is a second thing that can disagree with the first. RISK 5 stands
amended rather than merely conceded — step 4½ still has one caller, and that is
the residual cost this answer does not make disappear.

### 4.1 The thing that breaks

`Component.render()` returns a **string**. `InferenceRequest` is `{ prompt:
string }`. If a message can contain bytes, one of those two sentences is false.

**Ruling: neither becomes false. Bytes never travel as prompt text.**

The prompt string stays the whole of what the model reads *as language*. A part
is **named in the prompt and carried beside it.** Concretely:

```ts
// core/prompt/part.ts                                          [UNSCHEDULED]
/** A non-text part, by reference. Metadata only — never bytes. */
interface PartRef { sha: string; mime: string; name: string; bytes: number }
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
// core/agent/agent.ts                                          [UNSCHEDULED]
type RenderPrompt = (session: Session) => { text: string; parts: readonly PartRef[] }

// core/inference/base.ts                                       [UNSCHEDULED]
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
`engine/parts.ts` `[UNSCHEDULED]` turns `PartRef[]` into `ResolvedPart[]` by reading the
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
when multimodality lands.

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

> **That costs a named allowlist edit, and naming it here is the point.**
> `ARCHITECTURE.md` §3.4 gives `src/engine/**` a **closed** permitted list —
> `self fetch crypto indexedDB navigator URL postMessage AbortController` — and
> `btoa`, `atob` and `ArrayBuffer` are not on it, so the first line of this code
> fails `checks/purity.ts`. **The increment that builds parts adds `btoa` and
> `ArrayBuffer` to the `src/engine/**` row, in `ARCHITECTURE.md` §3.4 and in
> `checks/purity.ts`, in its own commit, and says so in `PROGRESS.md`.** Left
> unwritten, a coder meets a red gate on a rule that looks like a bug and the
> tempting repair is to weaken the check — which CLAUDE.md forbids by name. The
> `src/core/**` row is **not** touched: it stays empty, which is what makes
> "core never holds bytes" enforced rather than promised.

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

**Elision with a count — "never the content, always the length." — PROPOSED.**
*Problem:* three unrelated places must show that something large or secret
exists without showing it. *Shape:* replace the payload with a sentence naming
the count. *Would-be examples:* `TOOL_ELISION` (model-facing, so the model knows
content was withheld rather than reasoning over a silent truncation), `<redacted,
N bytes>` in the header record, `<412144 bytes elided>` in an image body (§4.3).

> **Filed under ACCEPTED in an earlier draft, on the strength of three
> appearances, and `grep -c TOOL_ELISION src` returns 0.** All three are
> unwritten: the tool cap is 4.2, the header redaction is 6.4, and the image
> elision is unscheduled. §5.1's own rule is *the second implementation earns
> the interface, and never the other way round*, and the one entry that waived
> it was the one this catalogue invented. **It becomes ACCEPTED when the second
> of the three ships**, which is 6.4 on current ordering — and if the two turn
> out to want different shapes, there was never a pattern here, only a phrase.

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
| **A `MODALITIES` table** (§6, recipe 5) | It is the right shape and it has **one row**, and a table with one row dispatches on nothing. Built when the second modality exists; §6 says so out loud so it is not later mistaken for an oversight. **§4.0 answers why this rule refuses a table and not §4's byte path.** |
| **Compaction, in any shape** | `ARCHITECTURE.md` §9. The prior trigger was *message count*, which was wrong; rebuilding it wrong is worse than not having it. `REFERENCES.md` items 1–3 hold the design for when it is earned. |

---

## 6. How to add a feature

The payoff. Each recipe is ordered; each ends with the observation that proves
it. **More than ~4 touch points is a design smell and is named as one.**

> **Every step whose file does not exist yet carries the `[N.M]` that creates
> it, at the point of use.** A cold reader followed recipe 3 verbatim and it
> worked; recipe 4 stopped dead at step 4, because `src/adapters/` does not
> arrive until 3.1 — a fact this document stated correctly somewhere else, which
> is the same as not stating it. An untagged path in a recipe is a promise that
> `cd` will succeed.

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
3. *Prove it:* golden diff. `ui/prompt/BandStack.tsx` `[6.4]` needs **no**
   change — it renders the breakdown, which is data. **Steps 1 and 2 are
   followable verbatim today; step 3's file is not there yet, and the recipe is
   complete without it.**

**4 — A new model provider.** *(3 code files + 1 data row.)*
1. `core/inference/<kind>.ts` — implement `infer` and `describeRequest`. Build
   the redacted header records **at construction**. *(Exists — 2.3.)*
2. `core/inference/catalog.ts` — one line in `KINDS`, one branch in
   `inferenceFor`. *(Exists — 2.3.)*
3. `public/seed/models.json` `[4.1]` — one row. **`public/` does not exist
   yet.**
4. `adapters/test/fetch.ts` `[3.1]` — a **recorded** body, including SSE chunks.
   **`src/adapters/` does not exist yet**, and this is the step the recipe
   currently stops at.
5. *Prove it:* >1 delta chunk, and the key string absent from
   `JSON.stringify(describeRequest(...))`.

**5 — A new modality.** *(4 touch points — the limit, and a named smell.)*
1. `core/prompt/part.ts` `[UNSCHEDULED]` — extend the accepted mime prefix.
2. The transport's content-array mapper (`core/inference/openai.ts`).
3. `ConfigRecord.accepts` — a new declared value, and the Setup control for it.
4. The composer's `accept` attribute.
**Named smell:** four files must agree about one mime prefix. The fix is a
single `MODALITIES` table mapping prefix → `{ contentPartType, acceptsValue,
inputAccept }` read by all four. **Do not build it for the first modality** — it
would be a table with one row. Build it in the increment that adds the second,
and that increment's first commit is the table.

**6 — A new surface.** *(2 files.)* `ui/surfaces/X.tsx` `[6.3]`, plus one row in
`ui/shell/surfaces.ts` `[6.2]` carrying id, label, order, component and `?panel=`
address. **Neither file exists before wave 6.**
*Prove it:* the address is honoured **on load**, and `data-panel-ready` is set.

**7 — A new worker message.** *(4 files, and all four are checked. **None of
the four exists before wave 3**; the check that enumerates them is 3.2.)*
`protocol/messages.ts` `[3.2]` (union + `REPLY_OF`) → `engine/host.ts` `[3.1]`
(a case) → `client/actions.ts` `[3.2]` (a sender) → `client/store.ts` `[3.2]`
(a case). `checks/protocol.ts` `[3.2]`
proves the pairing total, every request handled, and every event both emitted
and written into client state. **Four touch points that a check enumerates is
not the same smell as four that a human must remember.**

---

## 7. What this file asserts, and how each assertion is checked

Per CLAUDE.md: a claim the gate cannot execute is not a verified claim.

| Assertion | Checked by |
|---|---|
| Core references no ambient global; no ambient clock or randomness | `checks/purity.ts` (tokeniser + allowlist) |
| **Core never holds bytes, in value positions** (§4) | `checks/purity.ts` **today**. `ES_GLOBALS` is a closed allowlist and `ArrayBuffer`, `Blob`, `File`, `FileReader`, `btoa`, `atob` are not on it; `src/core` is allowed nothing beyond it. A planted `btoa` in core **fails**, measured |
| **Core never holds bytes, in type positions** | **UNENFORCED.** A planted `interface R { data: ArrayBuffer }` in `src/core/` was **not** flagged. §7.1 item 5 |
| The assembled prompt is byte-exact | `tests/golden/render-*.prompt` + an md5 on the fixture |
| Adding parts costs text-only paths nothing (§4.3) | The 2.3 request-body fixtures must not change by one byte in the increment that adds parts |
| `describeRequest` never carries a key | Host test: the key string is absent from `JSON.stringify(...)` |
| `describeRequest` is bounded regardless of part size | **PROPOSED** host test: a 4MB part yields a record under a fixed size |
| Every `ToEngine` has a sender and a handler; every `FromEngine` is emitted and stored | `checks/protocol.ts` |
| Realm is positional; `typeof` never asks | `checks/realm.ts` + banners |
| **No module under `src/**` is orphaned from a build** — every one is on a **value** import path from a real entry point | `scripts/checks/reach.ts` `[2.9]` (§3.4 check 1), type-only edges skipped, two allowlists `{subject, reason, expiresAt}` checked in both directions. Today: **UNENFORCED, and red on nineteen files if it existed** |
| A declared `package.json` dependency has an importer | Same check, second allowlist (§2.2). `idb` holds the only entry, expiring **end of wave 3** |
| **The assembler's output is what the transport actually receives** | `tests/turn.test.ts` `[2.8]` assertion (a) — the golden compared against the transport's input, not the assembler's output. **This, and not reach.ts, is what closes the unjoined-seam gap — and it closes it for one path** |
| A synthesised give-up answer is distinguishable from a real one, **in the transcript** (E4) | `tests/turn.test.ts` `[2.8]` assertion (e), against the `origin` field |
| Every check runs | `checks/gate-coverage.ts`, plus the printed check count in `PROGRESS.md` |
| Every file and contract named here exists or is tagged | `checks/docs.ts` §8.7 — **this file must be added to its §N.M resolver** |

### 7.1 UNENFORCED, stated plainly

0. **Nothing checks that a seam is joined.** The whole of §3.2. Every check in
   the gate has a *file* as its subject; none has a *relationship*. Today the
   honest statement is: **86 green tests and 6 green checks do not establish
   that any two parts of this system have ever run together.**

   **And after 2.8 and 2.9 it is still mostly true, which an earlier draft of
   this item obscured.** `reach.ts` proves no module is orphaned from a build;
   it cannot prove an imported value is ever called, and a `buildAgent` that
   imports `ReActResponse` and never passes it would satisfy it completely —
   FLOW's recorded defect, verbatim, passing a check written against it. The
   only thing that proves a seam carries the right bytes is `tests/turn.test.ts`,
   and it proves it **for the one turn it runs**. Every other seam in the tree
   stays R0. Naming a second path worth an integration test is a live question
   and it belongs to the increment that builds the second flow, 4.5.
1. **Components are frozen.** Nothing asserts a concrete class froze itself at
   the end of its constructor. A mutable field makes `key()` correct and the
   bytes wrong — the memo's one silent failure. *Cheapest fix:* a host test that
   instantiates every exported component class and asserts
   `Object.isFrozen(instance)`.
2. **The core `Observer` callback sequence.** The wire has a check; core does
   not. *Cheapest fix:* one host test running a full turn with a recording
   observer, asserting the exact callback order including `assembled` before the
   first `delta`.
3. ~~**A synthesised give-up answer is distinguishable from a real one**
   (E4).~~ **Struck from this list: it is scheduled at `2.8`**, as an `origin`
   field on the transcript entry with assertion (e) of §3.4 check 2 behind it.
   It was the sharpest exception in the file and the least excusable thing to
   leave to a human — the harness writing under the `assistant` role, unmarked,
   is `LESSONS.md` defect 3 in its purest form, because the next prompt renders
   it back and the model reasons over a sentence it did not write.
4. **`accepts` reflects what the endpoint can actually do** (§4.4). It is
   operator-declared. There is no probe, and inventing a confident one would be
   the failure mode this file's §3 step 8 note is about.
5. **Core holds no bytes in a *type* position.** `checks/purity.ts` walks the
   token stream against an identifier allowlist, which reaches value positions
   only; a planted `interface R { data: ArrayBuffer }` in `src/core/` was **not
   flagged**, and the probe was run rather than reasoned. *No cheap fix is
   offered here, and that is deliberate:* a type-position check needs the
   checker's type resolution, not its tokeniser, and inventing one against a
   hole with zero current occurrences would be a check written before its
   problem. **Recorded honestly instead of closed badly**, and it is the reason
   §4.3's "bytes never enter core" is a convention in the type layer even while
   it is enforced in the value layer.
6. **Prompt bytes are copied character-for-character** beyond the reach of a
   golden fixture — tool descriptions, tool error sentences, phase prompt
   bodies. Already `ARCHITECTURE.md` §8.5; restated because §6's recipes 1 and 3
   are exactly where a new uncovered string enters.
7. **A `docs/scratch/` measurement still describes the tree.** §11 rules on
   this and names the check; until that check exists, FLOW.md and MEASURED.md
   are true as of a commit and nothing notices when they stop being.

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
sttFor('whisper-tiny')      // client/speech/stt.ts   [7.2]
ttsFor('system')            // client/speech/tts.ts   [7.1]
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
3. **Audio bytes never cross *the engine worker's* boundary.** The absolute
   version of this sentence — *"never cross a worker boundary, not once"* —
   stood four lines under reason 2's own admission that these runtimes **spawn
   workers of their own**, and it was false. They do cross a worker boundary:
   the runtime's, inside the main realm, by its own arrangement. What is true,
   and what the reason rests on, is that **no audio byte is ever in a
   `postMessage` this architecture writes, in a store this architecture owns, or
   in a `turn/*` event**. So restated exactly: there is no `blobs`-store
   question, no §4.2 to re-derive, and no per-frame clone through *our*
   protocol. **The design gets smaller because this architecture acquires no new
   byte path** — not because bytes stop moving.

So: **speech lives in `src/client/speech/`, main realm, `// REALM: main`.** STT
calls `actions.submitTurn(text)` — the same function the composer calls. TTS
subscribes to the store — the same mirror the tape renders from.

> **Ruling, because a critic found the hole and it is a real one: a main-realm
> dependency's private storage is OUT of scope for the realm rule, and the
> reason is what makes it survivable.** transformers.js caches model weights in
> **IndexedDB, from the main realm**, and `ARCHITECTURE.md` §3.3 refuses
> `indexedDB` to `src/client/**` while `checks/realm.ts` tokenises **our
> source** — so the dependency evades the check silently and no amount of
> tightening our tokeniser will see it.
>
> The rule is not "no IndexedDB in the tab". It is **"this architecture keeps
> its mutable state in one realm, and the worker owns it"** (§3.3's title is
> *who owns what*). A vendored cache of immutable, content-addressed model
> weights is not this architecture's state: nothing reads it but the library,
> nothing in it can disagree with the worker's stores, and losing it costs a
> re-download and nothing else. That is the test, and it is stateable as a rule
> **a human applies at the moment a dependency is added**: *a dependency may
> keep private storage in the main realm if that storage holds no fact this
> architecture also holds*. It is R4, it is checked by the person writing the
> `package.json` line, and pretending otherwise would be the third false
> enforcement claim this revision removed.

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
| **Per-utterance latency, on this deployment, on a phone** | n/a | **UNMEASURED — and it is the number that decides whether local STT is usable at all** |
| North star | STT fails the airplane test outright | passes, once cached |

> **The deployment constrains the runtime, and this table did not say so.**
> `scripts/deploy.sh:33` publishes to **`gh-pages`**. A static host sets no
> headers, and `ARCHITECTURE.md` §9 rules COOP/COEP out — *"they arrive with a
> real WASM runtime or not at all."* Therefore `crossOriginIsolated` is
> **false**, `SharedArrayBuffer` is **unavailable**, and ONNX Runtime Web is
> limited to **single-threaded WASM**. No SIMD-plus-threads path exists on the
> URL this project is judged on.
>
> An earlier draft rated quality *"good, and pinnable"* and named a 200MB
> download as the worst failure a developer would hit, while never naming
> single-thread latency. A 200MB download is an inconvenience with a progress
> bar. **Six seconds to transcribe a four-second utterance is a feature nobody
> uses**, and it would have been discovered after the increment shipped.
>
> **Ruling: `7.2` does not start until `MEASURED.md` carries a row for it.**
> The row: whisper-tiny (or the chosen model), single-threaded WASM, no
> `crossOriginIsolated`, a four-second utterance, on the slowest device the
> owner actually uses, wall-clock from `stop()` to final transcript, measured
> three times. **The acceptance for that measurement increment is the number,
> not a verdict** — if it lands above a threshold the owner sets *before*
> seeing it, `7.2` is cut and the section records why.
>
> **And speech is the "real WASM runtime" `ARCHITECTURE.md` §9 was talking
> about.** That row's own words are that COOP/COEP *"arrive with a real WASM
> runtime or not at all"*. So `7.2` is the increment that reopens the question —
> and the answer on `gh-pages` is **still no**, because a static host cannot
> send the headers, and buying threads would mean buying a server, which
> `NORTH-STAR.md` forbids in its first sentence. **The measurement is therefore
> load-bearing precisely because the escape hatch is closed.**

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
// client/speech/segment.ts                                            [7.1]
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
met for plain-text agents.

> **Struck: *"met exactly where voice is actually used."*** That was a
> preference with no measurement behind it, and it is doing load-bearing work in
> a ruling that gives structured agents no streamed voice at all. **Whether it
> is true turns on one fact this tree has not yet written down: the seeded
> `main` agent's `response_model`.** If it is `null` (`PLAIN_TEXT`), the ruling
> covers the default agent and the sentence was right by luck. If it is
> `ReActResponse`, the ruling gives the **only shipped agent** no streamed voice
> and the owner's requirement is unmet on the default path.
>
> **`4.1` writes that file and therefore owns the answer**; its `PROGRESS.md`
> entry states the seeded `response_model` explicitly, and `7.1` reads it rather
> than assuming. Until then this is **unverified**, marked as such, and not a
> justification anything may lean on.

Making it true for structured agents
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
barge-in-as-submission is blocked on 2.8's one field like everything else that
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
| 12 | **Voice in (STT)** | A microphone that writes text into the composer | `client/speech/stt.ts` `[7.2]`, **main** | Human speaks; machine transcribes | Before a turn exists | **none — never in the prompt** | The composer still takes typing | ○ |
| 13 | **Voice out (TTS)** | A speaker that reads the answer | `client/speech/tts.ts` `[7.1]`, **main** | Machine | After a turn, or during it for plain-text agents | **none — never in the prompt** | The tape still shows the answer | ○ |

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
the only sense that counts.

**R0 is not closed by a reachability check, and an earlier draft said it was.**
§3.4 check 1 removes one *cause* of R0 — a module nobody imports — and leaves
the condition itself intact, because an imported value that is never called is
just as unrun. **The only thing that moves a seam out of R0 is executing it**,
which is §3.4 check 2, and check 2 executes one path. So after `2.8` and `2.9`
the tree's R0 population drops from *all of it* to *everything the one
integration turn does not walk*, and that remains the largest untiered surface
in this project. Every other tier assumes the code executes; R0 is the
assumption failing, and it fails quietly.

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

- **§4's "core never holds bytes" is R1 in value positions and R4 in type
  positions.** An earlier draft said the whole property was R4 pending a purity
  change, in three separate places. **That was wrong, and it was wrong in the
  most embarrassing direction: the property is already enforced.**
  `checks/purity.ts` allows `src/core` nothing beyond a closed forty-name
  built-in list, and `ArrayBuffer` and `btoa` are not on it — a planted probe
  **failed**, measured. The proposal was to remove six names from a list
  containing none of them. It is deleted from all three places rather than
  softened, because a document proposing a no-op as a mitigation is asserting
  coverage it does not add. **The hole that is real** is the one the probe also
  found: type positions are unreachable by an identifier allowlist, and §7.1
  item 5 records it without inventing a check for it.
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
> 2.8 and 3.3**; it is written in the present tense because it is the design of
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
| **Cancel mid-stream** | **Not free — the seam is severed.** ~~designed and scheduled~~ | The transports honour a signal in four places, and **no caller can supply one**: `Agent.turn` calls `infer` with two arguments and neither `Agent`, `Session` nor `react()` has a signal field (FLOW §3). **A turn in flight today is uncancellable.** The change is one field threaded `AgentOptions → Session → turn → infer`, and it is **2.8's** (§3.3), which is also what makes assertion (d) of §3.4 writable. After that: `abortTurn()` → `turn/abort` → the real `AbortController` on the real `fetch` |
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

## 11. Measurements, and when they stop being true

`docs/scratch/` is tracked on purpose, and this revision leaned on it harder
than any document before it: **every ruling in §3 rests on `FLOW.md`, and every
realm ruling rests on `MEASURED.md`.** A cold reader put the obvious question to
that arrangement and nobody had an answer: **nothing re-verifies a measurement
after the tree it measured moves.**

`FLOW.md` is precise and cited to `file:line`. The moment `promptFor` gains a
second caller it becomes **confidently wrong**, in exactly the register that is
hardest to catch — specific, sourced, and stale. That is *"rulings rot in the
present tense"* one level up, and it applies to every measurement in that
directory, including the ones this file spent a section correcting
`ARCHITECTURE.md` with.

**Ruling: a measurement is true *as of a commit*, it says so in its own header,
and a check tells you when its subject moved.**

Every file under `docs/scratch/` that asserts a measurement carries, in its
first ten lines:

```
MEASURED AT: <full sha>
SUBJECTS:    src/core/**, package.json          # what the claims are about
REPRODUCE:   bun test && grep -rn "new Agent(" src
```

`SALVAGE.md` and `LESSONS.md` declare none of these, because they are not
measurements — they are lessons, and a lesson does not expire when a file moves.
**Declaring the header is what makes a file subject to the check**, which keeps
the check's subject an allowlist rather than a directory.

**`scripts/checks/stale.ts` `[1.8]`, one rule, three lines of git:**

> For each scratch file declaring `MEASURED AT`, run
> `git log --oneline <sha>..HEAD -- <SUBJECTS>`. **Non-empty output fails**,
> naming the file, its sha, and the commits that moved its subject underneath
> it.

- **Watched red, and it is trivially watchable:** touch any file under
  `src/core/`, commit, run the gate. `FLOW.md` goes red naming the commit.
- **Green again** by one of exactly two acts, both of which are work someone
  should have done: **re-run `REPRODUCE` and re-stamp the sha**, or **strike the
  claims the change invalidated and re-stamp**. There is no third door, and
  there is deliberately no `--force` flag.
- **The first thing it does is bite this revision.** `2.8` moves `src/core/`,
  which is `FLOW.md`'s declared subject, so `2.8`'s commit turns it red — and
  that is correct, because `2.8` is precisely the increment that makes half of
  `FLOW.md`'s findings historical. **`2.8` is not done until `FLOW.md` is
  re-stamped or struck**, and that sentence is worth more than the check.
- **The cost, named:** a scratch file with a wide `SUBJECTS` glob goes red on
  almost every commit and the temptation is to widen the sha rather than re-run
  the measurement. The defence is that re-stamping without re-running is a lie a
  human types deliberately, which is a different and much rarer failure than a
  document quietly aging. **It is not free and it is not clever; it is the
  cheapest honest thing available.**

*(`ARCHITECTURE.md` §8.7's `checks/docs.ts` is a different check with a
different subject — it asks whether documents agree with each other and with
PROGRESS. This one asks whether a document still agrees with the **tree**.
Merging them would give one check two subjects, and §3.4 has just spent a
subsection on what happens when one check is asked to prove two things.)*

---

## What this document does not decide

| Open question | Left to |
|---|---|
| ~~Whether `2.7` is adopted as an increment~~ | **Closed.** `PLAN.md` now carries **`2.8` "one turn, joined"** and **`2.9` "reachability"**, with file lists and acceptances. `2.7` was not reused: PLAN records at two places that *"2.7 moved to 3.4"* at increment 0.3, and two 2.7s in one record is a collision in the only channel between agents |
| ~~Whether `reach.ts` is a gate check~~ | **Closed.** It is a gate check, it is `2.9`, and its allowlist is seeded from the **post-join** tree, which is the only tree from which the allowlist is honest |
| **Whether `stale.ts` (§11) is worth its noise**, and whether `SUBJECTS` globs stay narrow enough to be survivable | `1.8`, whose acceptance is watching it go red on a real `src/core/` commit and green on a re-stamp. If its first month is all false alarms, it is cut and §11 becomes an R4 obligation |
| Whether the eight false present-tense sentences FLOW records in `ARCHITECTURE.md` (gaps A1–A8) are corrected, and the three DONE-but-absent files (B1–B3, including the `max` ratchet PLAN says 2.6 armed) | The architect, in `ARCHITECTURE.md`. **Not this file — it does not own them, and it cites FLOW wherever it would otherwise have relied on one** |
| **Whether multimodality is built at all.** §4 is a design and is **UNSCHEDULED** — every one of its tags reads `[UNSCHEDULED]`, deliberately, so no tag resolves to a wave-7 number that means something else | A future PLAN increment. It also needs `ARCHITECTURE.md` §9's "attachments" row moved and §3.4's `src/engine/**` allowlist extended (§4.3), neither of which this file may do. Nothing before `[4.3]` (tools work) and `[6.4]` (Context can render the elision), **and nothing before the join** |
| **STT and TTS — scheduled, and here is where.** The owner asked for speech twice; §8 designs it in full and an earlier draft left it off both the schedule and this table, which is the same defect as an unscheduled ruling | **`PLAN.md` wave 7.** `7.1` **voice out** — `speechSynthesis` as the default voice, the segmenter, the registry law; zero bytes, two implementations on day one, so the base is earned. `7.2` **voice in** — local STT, and it is **gated on a `MEASURED.md` latency row taken first** (§8.3), because single-threaded WASM on `gh-pages` is the constraint that decides whether it is usable. Both need `6.3` (a composer and a tape) and `2.8` (a turn) in front of them |
| **What the seeded `main` agent's `response_model` is** — §8.4's streamed-TTS ruling turns on it and it is currently **unverified** | `4.1`, in its `PROGRESS.md` entry, stated explicitly rather than left to be read out of a seed file |
| Whether a **second** integration test is worth it, and for which path — §3.4 check 2 proves one turn and leaves every other seam R0 | `4.5`, the increment that builds the second flow and therefore the second path worth asserting |
| Whether `turn/delta` needs a `channel` field to keep a tool-calling turn readable (E3) | `ARCHITECTURE.md` §11, settled by a human watching PLAN 3.3's smoke run — **observation first, design after** |
| Whether the repeat guard's ledger keys on the sorted set of call *names* | `[4.2]`, which is the first increment that knows what a call name is. `ARCHITECTURE.md` §9 carries it as a knowing defect |
| Whether a per-turn tool-output budget exists, and what it drops when hit | The first measured turn that overruns. A second cap needs a drop policy and a drop policy has no caller yet |
| Compaction, and whether it is an **event** in the log rather than a mutation | After real token accounting. `ARCHITECTURE.md` §11's `usage` question blocks it |
| Whether `next` stays (§2.2) | A retro, in an increment whose **first act** is re-running the M1/M2/M3 probes |
| The `MODALITIES` table (§6 recipe 5) | The increment that adds the second modality, first commit. §4.0 argues why this refusal does not also condemn §4 |
| Whether the tool that ends a turn should be a tool the model calls, rather than a parser deciding what looks like an answer | A ruling weighed against the response-model approach, no earlier than `[4.5]` |
| Sub-agents, skills, MCP | `ARCHITECTURE.md` §9. Each returns with its second caller or never |

---

**DECISION.** The most important thing this document says is §3.2: **the parts of
this system have never run together** — `promptFor` has one caller and it is a
test, `new Agent(` appears in `src/` zero times, nothing under `src/app`,
`src/client` or `src/ui` reaches `src/core`, and `Agent.turn` calls `infer` with
two arguments, so the seam for reaching into a turn is severed one level above
where it was built. Every part is green because **every check in this gate has a
file as its subject and none has a relationship.** The join is therefore
scheduled as **two** increments, not one: **`2.8` "one turn, joined"** — a
`buildAgent` seam, an `AbortSignal` field, `RenderPrompt` returning the
`Breakdown`, an `origin` field that marks a synthesised give-up answer **in the
transcript** so the next prompt cannot hand the model its own harness's words
back, and one integration test that compares the **transport's input** to the
golden — and **`2.9`**, the reachability check, seeded from the **post-join**
tree, which is the only tree from which its allowlist is honest and the only
split under which reverting a check does not revert a join. Both precede every
wave 4 and wave 5 increment, because each of those adds only more unjoined parts
and the join's cost compounds; **wave 6 is not blocked** — PLAN rules it parallel
from 1.4 and 6.1/6.2 import no core seam, while 6.3 and 6.4 are already gated by
their own acceptances, which is the better mechanism. Three enforcement claims
were deleted rather than softened: the purity proposal for §4 was a no-op
(`ArrayBuffer` and `btoa` already fail, measured), the anti-double grep matched
nothing, and `reach.ts` was mis-sold — it proves **no module is orphaned from a
build**, not that a seam is joined, and with type-only edges correctly skipped it
would have marked `core/ports.ts` reachable on four erased imports. The trade
made across this revision: **every claim that could not be executed was demoted
or deleted, at the cost of a document that now admits it closes one path and
leaves the rest R0.**

**FILES.** Edits `/Users/kaush/Downloads/Dev/ASKK/docs/AGENT.md` (owner:
architect) and `/Users/kaush/Downloads/Dev/ASKK/docs/PLAN.md` (owner: architect).
No other file created or edited; `ARCHITECTURE.md`, `PROGRESS.md`, `src/` and
`scripts/` are untouched by design. Raised against files owned elsewhere and
**not touched here**: `ARCHITECTURE.md` §3.4 must add `btoa` and `ArrayBuffer`
to the `src/engine/**` row **in the increment that builds parts**, and §9's
attachments row moves in that same increment (owner: architect, later);
`scripts/checks/docs.ts` `[1.7]` must add this file to its `§N.M` resolver and
its cross-reference set (owner: coder, at 1.7).

**CONTRACTS.** Built at `2.8`:
`buildAgent(options: BuildOptions): Agent` — the single place `promptFor` meets
`new Agent`; the only constructor of a real agent outside a test double.
`AgentOptions.signal?: AbortSignal` — threaded `AgentOptions → Session → turn →
infer`, turning an uncancellable turn into a cancellable one.
`type RenderPrompt = (session: Session) => Breakdown` — the prompt seam returns
the bands it already computes, and `AssembledEvent` carries them.
`TranscriptEntry.origin: 'model' | 'harness'` — default `'model'`; `'harness'`
renders behind a verbatim marker in `historyLines()`.
Built at `2.9`:
`ROOTS: readonly string[]` and `ALLOW: readonly {subject, reason, expiresAt}[]`,
exported from `scripts/checks/reach.ts` — the roots it searches from and the two
allowlists it checks in both directions.
Built at `1.8`:
`scripts/checks/stale.ts` — fails when a `docs/scratch/` file's declared
`SUBJECTS` moved after its declared `MEASURED AT` sha.
Designed, **UNSCHEDULED**:
`interface PartRef { sha; mime; name; bytes }` — a non-text part by reference,
metadata only, content-addressed (an earlier draft carried a redundant `id`).
`Component.parts(): readonly PartRef[]` — default `[]`.
`interface ResolvedPart { mime: string; data: ArrayBuffer }` — bytes, produced
in the worker, never in core.
`ConfigRecord.accepts: readonly string[]` — default `['text']`.
Scheduled at wave 7: `ttsFor(name)` `[7.1]`, `segment(buffer)` `[7.1]`,
`sttFor(name)` `[7.2]`.

**ACCEPTANCE.** Verbatim, runnable today:
`grep -n 'PROPOSED' docs/AGENT.md` returns exactly two lines — the elision
pattern's status in §5.1 and the bounded-record host test that belongs to
unscheduled multimodality. Every other proposal in this file is now a numbered
increment or an admitted UNENFORCED item; the earlier draft's four proposals
that named `checks/purity.ts` are gone, because they proposed a no-op.
`grep -n '2\.7' docs/AGENT.md` returns only the paragraph explaining why `2.8`
and `2.9` do not reuse the vacated number.
`grep -n '\[7\.1\]' docs/AGENT.md` returns only speech, and `grep -c
'UNSCHEDULED' docs/AGENT.md` is non-zero — multimodality's tags resolve to no
increment number, on purpose.
`grep -n 'precedes every wave' docs/AGENT.md` names waves 4 and 5 and **not**
wave 6; the only §3.3 paragraph about wave 6 is the one that un-blocks it.
`grep -n 'expiresAt' docs/AGENT.md` shows every expiry as a wave boundary or a
date, and none as an increment number.
`grep -n 'already uses' docs/AGENT.md` returns only the two lines that quote and
retract the phrase — there is no present-tense claim left about
`scripts/checks/docs.ts`, which does not exist.
`grep -n 'public/seed' docs/ARCHITECTURE.md` returns line 305 with the same
`[4.1]` tag this file carries, so the path is the architecture's and not this
file's invention.
`bun run gate` is untouched and still green; this increment changes no code.
Human acceptance: a reader who has not read `ARCHITECTURE.md` can name the five
minimum parts of an agent, the thirteen steps of a turn, one pattern this tree
refuses, **why 86 green tests do not prove the system runs**, and **which single
check closes that and for how many paths.**

**RISKS.** (1) **`2.9`'s allowlist is still the soft spot.** It is smaller after
the join than before, but it is written by the same person under the same
pressure, and its only defence is an expiry keyed to a wave boundary that
`PROGRESS.md` must record honestly. An allowlist is a place code goes to live
and no amount of structure changes that; only somebody reading it does. (2)
**§3.4 check 2 proves one path and this document now says so loudly, which
invites the reading that one path is enough.** It is not: after `2.8` and `2.9`
every seam except the one that test walks is still R0, and the next integration
assertion has no owner before 4.5. (3) **§11's check may be noise.** A scratch
file with a wide `SUBJECTS` glob goes red on nearly every commit, and a check
people learn to re-stamp past is worse than no check — 1.8's acceptance is the
only thing standing between the rule and that outcome, and it is one increment
of evidence. (4) **`7.2` may be cut by its own measurement**, and §8 is a long
design for a feature single-threaded WASM on a static host might make unusable;
the mitigation is that the measurement comes first and costs one afternoon,
while the design already exists and cost nothing further. (5) **§4.0's
table-versus-path argument is the one piece of new reasoning in this revision
that nobody has attacked yet.** If a reviewer names a second piece of §4 caused
by the *possibility* of a second modality, the argument weakens and §4 shrinks
again — I have stated that test in the section rather than hoping it is not
applied. (6) **`accepts` is operator-declared** and will be wrong on somebody's
endpoint; the failure is a refused attach on a model that would have worked,
which is the safe direction and still a wrong answer with no probe behind it.
(7) **This file is a fifth document** in a system whose CLAUDE.md says the
documents are the only channel — a fifth thing that can go stale, and
`checks/docs.ts` does not yet know it exists.
