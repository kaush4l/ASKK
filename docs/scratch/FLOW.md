# FLOW — the measured trace of one turn, as of 2026-08-28

> A read-only trace of the code that exists **today**. Every claim carries a
> `file:line`. Nothing here describes intent; where the source and
> `ARCHITECTURE.md` disagree, the disagreement is recorded in the gaps section
> and not smoothed over.
>
> Read against: `src/` at 23 files, `docs/PROGRESS.md` last entry **2.6**
> (`docs/PROGRESS.md:622`). Waves 3–6 have shipped nothing.

---

## STRUCK BY 2.8 — read this before any sentence below

**Increment 2.8 landed the join this document was written to measure the
absence of.** The rest of the file is the pre-join tree and is left standing
because it is the evidence the join rests on — but the findings below are now
**historical**, and every `file:line` in `src/core/agent/*` and
`src/core/prompt/recipe.ts` has moved. It is not re-measured here: a
re-measurement is its own pass, and half a re-stamp is worse than a strike.

| Struck | Was | Is, after 2.8 |
|---|---|---|
| §0 · "`new Agent(` appears in `src/` **zero** times" | only a doc comment | `src/core/agent/build.ts` constructs one, and it is the only place in `src/` that does |
| §0 · "`promptFor` has exactly one caller, `tests/prompt.test.ts:60`" | one test caller | `build.ts` (value import) and `tests/turn.test.ts` |
| §0 · "the assembler and the agent have never run in the same process" | true, and the most load-bearing fact here | `tests/turn.test.ts` runs a turn through `buildAgent`, and asserts the prompt **the transport received** against `tests/golden/render-full.prompt` |
| §0 / §4 · "`ReActResponse` is never used as an `Agent.model`" | the `BaseResponse` → `ReplyModel` adapter was structural and unexercised | `buildAgent` fits it from `Recipe.model`; `tests/turn.test.ts` (c) crosses it in both directions |
| §3 · "Cancellation — threaded to the transport, threaded from nowhere"; "`Agent.turn` calls `infer` with **two** arguments" | severed one level above where it was built | `AgentOptions.signal` → `Session.signal` → `infer`'s third argument. Watched red twice: two-argument `infer`, and `open()` dropping the signal |
| §6 · "give-up notice … `react.ts:102`" | an unmarked `user` message | the same line, written with `origin: 'harness'`, rendered by `historyLines()` as `[HARNESS]: …` |
| §2 · the assembler chain ending in `assemble()` | the `Breakdown` was computed every turn and discarded | `RenderPrompt` returns `{ prompt, breakdown }` and `AssembledEvent` carries both |

**Still true, and still the reason nothing here should be read as "the join is
done":** `grep -rn "core/" src/app src/client src/ui` returns nothing — no part
of the core is reachable from the page. `StorePort` has zero callers. `idb` has
zero importers. Nothing survives a reload. 2.8 joined **one path, in one
process, with a fake transport and a handed-in clock**; core ↔ page and
agent ↔ worker are untouched and are 3.1/3.3's.

---

## 0. The headline, before the detail

**There is no UI end of this chain.** The only route,
`src/app/page.tsx:23-43`, renders an `<h1>`, a page mark and a `<pre>` holding
the JSON of a Web Worker lock probe. It imports exactly one thing —
`runWorkerProbe` (`src/app/page.tsx:4`) — and nothing under `src/core/**` is
reachable from it. There is no composer, no submit, no worker that runs an
agent.

**`Agent` is constructed in exactly one place in the whole tree, and it is a
test.** `tests/agent-react.test.ts:96,123,140,170,195,208,221,254,285,297`. No
file under `src/` contains `new Agent(`.

**The assembler and the agent have never run in the same process.**
`promptFor` (`src/core/prompt/recipe.ts:84`) has exactly one caller,
`tests/prompt.test.ts:60`, which calls it directly with no `Agent`. The agent
tests fill the prompt seam with a one-line double,
`tests/agent-react.test.ts:89`. So the two halves of "assemble → infer" are each
proven and have never been joined. That surprised me and it is the single most
load-bearing fact in this document.

**`ReActResponse` is never used as an `Agent.model`.** Only
`tests/prompt.test.ts` and `tests/responses.test.ts` reference it. The adapter
between `BaseResponse` (`src/core/response/base.ts:107`) and the loop's
`ReplyModel` (`src/core/agent/agent.ts:48-51`) is structural and unexercised.

---

## 1. Entry — where user text first becomes a value the core sees

| # | Function | file:line | In | Out | Realm |
|---|---|---|---|---|---|
| 1 | `test(...)` body | `tests/agent-react.test.ts:107` | `string` literal | — | host (bun) |
| 2 | `react(agent, query)` | `src/core/agent/react.ts:56` | `Agent, string` | `Promise<Reply>` | core |
| 3 | `Agent.open(query)` | `src/core/agent/agent.ts:106` | `string` | `Session` | core |
| 4 | `ports.newId()` | `src/core/agent/agent.ts:107` → `src/core/ports.ts:83` | — | `string` | core (port) |
| 5 | `new Session({id, query, transcript})` | `src/core/agent/session.ts:38` | `{id,query,transcript}` | `Session` | core |
| 6 | `session.phase = PHASE` | `src/core/agent/react.ts:58` (`PHASE = 'react'`, `:30`) | — | — | core |
| 7 | `transcript.add('user', query)` | `src/core/agent/react.ts:59` → `src/core/agent/transcript.ts:44` | `Role, string` | `void` | core |

**Plainly: the UI end does not exist.** The first value the core sees is a
string literal in a `bun test` file. `ARCHITECTURE.md:865` (§5.8) names
`client/actions.ts` as the dispatch surface and tags it `[3.2]`; that file does
not exist. `ARCHITECTURE.md:429` says `app/page.tsx` "Mounts Shell" with **no
increment tag** — i.e. it claims that is true now. It is not
(`src/app/page.tsx:36-42`).

The user's text is stored twice at entry: once as `Session.query`
(`src/core/agent/session.ts:19,40`) and once as the first transcript message
(`src/core/agent/react.ts:59`). Nothing reads `Session.query` afterwards — no
call site for `.query` exists outside the test doubles' prompt renderer
(`tests/agent-react.test.ts:89`).

---

## 2. Prompt assembly — a set of components becomes one string

### The chain

| # | Function | file:line | In | Out | Realm |
|---|---|---|---|---|---|
| 1 | `promptFor(recipe, assembler?)` | `src/core/prompt/recipe.ts:84` | `Recipe`, `PromptAssembler` | `(session) => string` | core |
| 2 | the returned closure | `src/core/prompt/recipe.ts:85` | `Session` | `string` | core |
| 3 | `baseComponents(recipe, transcript)` | `src/core/prompt/recipe.ts:66` | `Recipe, Transcript` | `Component[]` (6) | core |
| 4 | `historyLines(transcript)` | `src/core/prompt/recipe.ts:58` | `Transcript` | `string[]` | core |
| 5 | `recipe.context()` | `src/core/prompt/recipe.ts:69` (declared `:43`) | — | `Record<string,string>` | core |
| 6 | `ResponseContract.of(model, fmt, cue)` | `src/core/prompt/components.ts:193` | `typeof BaseResponse\|null, Format, string` | `ResponseContract` | core |
| 7 | `instructionsText(model, fmt)` | `src/core/prompt/components.ts:160` | class, format | `string` (memoised `:158`) | core |
| 8 | `PromptAssembler.assemble(components)` | `src/core/prompt/assembler.ts:119` | `readonly Component[]` | `string` | core |
| 9 | `PromptAssembler.detail(components)` | `src/core/prompt/assembler.ts:132` | `readonly Component[]` | `{prompt, breakdown}` | core |
| 10 | `Component.render()` | `src/core/prompt/component.ts:71` | — | `string` | core |
| 11 | `Component.template()` → `compile(TEMPLATE)` | `src/core/prompt/component.ts:59` → `src/core/prompt/template.ts:34` | `string` | `(Scope) => string` | core |
| 12 | `render(nodes, scope)` | `src/core/prompt/template.ts:97` | `Node[], Scope` | `string` | core |

### The six components that actually exist

Declared, in the order `baseComponents` builds them
(`src/core/prompt/recipe.ts:67-75`) — which is **not** the prompt order:

`Soul` · `SystemInstructions` · `ContextBlock` · `History` ·
`ToolboxComponent` · `ResponseContract`.

### The slot order actually used

`src/core/prompt/slots.ts:18-27`:

```
SOUL 0 · SYSTEM 10 · CONTEXT 20 · SKILLS 30 · PHASE 40 · HISTORY 50 · TOOLS 60 · RESPONSE 99
```

Sorted at `src/core/prompt/assembler.ts:135`:
`classOf(a).SLOT - classOf(b).SLOT || a.priority - b.priority`. `priority` is
`0` for every component this tree constructs — nothing passes it
(`src/core/prompt/recipe.ts:67-75`; default at `src/core/prompt/component.ts:53`).
**SKILLS (30) and PHASE (40) have no component class at all** — see gaps.

Concrete class → slot: `Soul` 0 (`components.ts:26`), `SystemInstructions` 10
(`components.ts:46`), `ContextBlock` 20 (`components.ts:59`), `History` 50
(`components.ts:89`), `ToolboxComponent` 60 (`components.ts:127`),
`ResponseContract` 99 (`components.ts:177`).

### The elision rule

Two independent filters, both real:

1. **`applies()`**, applied before the sort at `src/core/prompt/assembler.ts:134`.
   - `Soul.applies()` → `Boolean(this.text)` after `.trim()` (`components.ts:39-41,35`).
   - `ContextBlock.applies()` → some fact value truthy (`components.ts:82-84`).
   - `History.applies()` → `lines.length > 0` (`components.ts:113-115`).
   - `ToolboxComponent.applies()` → `usages.length > 0` (`components.ts:145-147`).
   - `ResponseContract.applies()` → **always `true`** (`components.ts:198-200`); the cue must close the prompt.
   - Base default `true` (`component.ts:83-85`).
2. **`{% if %}` inside the template**, which makes a component that passes
   `applies()` still render nothing (`components.ts:61,90,128`;
   truthiness at `template.ts:113-119`).

The assembler's docstring at `assembler.ts:7` says it "drops the components with
nothing to say"; in code it drops only those failing `applies()`
(`assembler.ts:134`). A component that returns `""` from `render()` is still
sorted, still gets a `Band` and still contributes `''` to the join
(`assembler.ts:139-144`). No post-render drop exists.

### The join rule

`prompt += text` in the sorted loop, **no separator**
(`src/core/prompt/assembler.ts:142`). Each component's `TEMPLATE` carries its own
trailing `\n\n` (`components.ts:27,61,90,133,178`). `ResponseContract`'s template
ends with `{{ cue }}` and no newline (`components.ts:178`), so the assembled
prompt ends exactly at `[ASSISTANT]:` (`components.ts:188`).

### The invariants

`check(ordered)` at `src/core/prompt/assembler.ts:174`, run on **every**
`detail()` (`assembler.ts:136`), throwing `AssemblyError` (`assembler.ts:87`):

1. exactly one `Slot.RESPONSE` component (`assembler.ts:175-181`);
2. at least one `SOUL` or `SYSTEM` (`assembler.ts:182-184`);
3. the last sorted component is `RESPONSE` (`assembler.ts:185-188`).

These **throw**. They are the only place in the prompt path that raises.

### The memo

`#render` (`assembler.ts:155`) keys on `component.key()` (`component.ts:76`),
skipping the cache entirely when `CACHEABLE` is false — which is `ContextBlock`
alone (`components.ts:60`). Memo is cleared wholesale at
`MEMO_LIMIT = 512` entries (`assembler.ts:40,166`). `History` overrides `key()`
to hash the joined lines with a NUL separator rather than serialising them
(`components.ts:109-111`). The hash is two 32-bit FNV-1a passes concatenated
(`component.ts:114-123`).

---

## 3. Inference — the request, the transport, the deltas, the cancellation

| # | Function | file:line | In | Out | Realm |
|---|---|---|---|---|---|
| 1 | `Agent.turn` calls `infer` | `src/core/agent/agent.ts:119-121` | `{prompt}`, `OnDelta` | `Promise<InferenceResult>` | core |
| 2 | `OpenAiInference.infer` | `src/core/inference/openai.ts:55` | `InferenceRequest, OnDelta?, AbortSignal?` | `Promise<InferenceResult>` | core |
| 3 | `describeRequest(req)` | `src/core/inference/openai.ts:81` | `InferenceRequest` | `RequestRecord` | core |
| 4 | `this.fetchPort(url, init)` | `src/core/inference/openai.ts:57` → `src/core/ports.ts:32` | `string, RequestInit` | `Promise<Response>` | core (port) |
| 5 | `readStream(body, onDelta, signal)` | `src/core/inference/openai.ts:98` | `ReadableStream<Uint8Array>` | `Promise<InferenceResult>` | core |
| 6 | `readOrAbort(reader, signal)` | `src/core/inference/openai.ts:136` | reader, signal | `{done, value?}` | core |
| 7 | `utf8Decoder()` closure | `src/core/inference/openai.ts:212` | `Uint8Array` | `string` | core |
| 8 | `applyLine(line, state, onDelta)` | `src/core/inference/openai.ts:153` | `string, StreamState` | `boolean` (`[DONE]`) | core |
| 9 | `applyFrame(frame, state, onDelta)` | `src/core/inference/openai.ts:177` | `unknown` | `void` | core |
| 10 | `finish(state)` | `src/core/inference/openai.ts:148` | `StreamState` | `InferenceResult` | core |

### Request shape

Built at `src/core/inference/openai.ts:82-94`. Literal fields: `model`,
`messages: [{role:'user', content: req.prompt}]`, `temperature`, `max_tokens`,
`stream: true`, `stream_options: {include_usage: true}`. Serialised
`JSON.stringify(body, null, 2)` (`openai.ts:93`) — two-space indented, and that
same string is the `fetch` body (`openai.ts:63`), not a re-description of it.
URL is `${baseUrl without trailing slashes}/chat/completions` (`openai.ts:91`).

**One user message. The whole conversation is already inside `prompt`** — the
transcript reached the wire through the `History` component
(`src/core/inference/base.ts:6-7`, `src/core/prompt/components.ts:88`).

### Transport

`fetch` never appears as a global in the core; it arrives as `FetchPort`
(`src/core/ports.ts:32`) held on the base (`src/core/inference/base.ts:81`).
Headers set at `openai.ts:59-64`: `Content-Type`, `Accept: text/event-stream`,
`Authorization: Bearer <apiKey>`. `RequestRecord` has **no headers field**
(`src/core/inference/base.ts:55-65`) — so nothing outside `infer` can observe
what was actually sent.

Non-2xx throws with the first 500 chars of the body (`openai.ts:67-70`); a null
body throws (`openai.ts:72`). Those are the only two throws before the stream.

### Streaming deltas

Deltas surface **per decoded SSE frame**, not per read and not per buffered
reply: `state.text += content; onDelta?.(content)` at `openai.ts:184-187`, only
for a non-empty string `choices[0].delta.content`. `finish_reason`
(`openai.ts:188-189`) and `usage` (`openai.ts:190-195`) are picked off the same
frames. A frame that fails `JSON.parse` is silently dropped and the stream
continues (`openai.ts:161-167`); a line that does not start with `data:` is
ignored (`openai.ts:156`); `[DONE]` ends the read (`openai.ts:158`, sentinel at
`:32`). `reasoning_content` is deliberately not read (`openai.ts:174-176`).

`stopReason` falls back to the literal `'end-of-stream'` (`openai.ts:42,149`)
rather than a guessed `stop`; `usage` stays `null` where the server sent none
(`openai.ts:105,149`).

`ScriptedInference.infer` (`src/core/inference/scripted.ts:43`) emits the
fixture's own declared chunks (`scripted.ts:53-59`) and records every request in
`received` (`scripted.ts:36,44`).

### Cancellation — threaded to the transport, threaded from nowhere

`Inference.infer` declares `signal?: AbortSignal`
(`src/core/inference/base.ts:88`). `OpenAiInference` honours it in three places:
passed to `fetch` (`openai.ts:65`), checked at the top of each read loop
(`openai.ts:109`), and re-labelled `'inference aborted'` when a read rejects
under an aborted signal (`openai.ts:143`, constant `:35`).
`reader.cancel()` runs in a `finally` (`openai.ts:127-130`).
`ScriptedInference` checks between chunks (`scripted.ts:56`).

**Nothing ever supplies a signal.** `Agent.turn` calls
`this.inference.infer({ prompt }, onDelta)` with two arguments
(`src/core/agent/agent.ts:119-121`). `Agent` has no signal field
(`src/core/agent/agent.ts:69-80` `AgentOptions`), `Session` has none
(`src/core/agent/session.ts:16-42`), and `react()`/`loop()`/`step()` take none
(`src/core/agent/react.ts:56,70,82`). `grep` finds `AbortSignal` in exactly two
files: `inference/base.ts`, `inference/openai.ts`, `inference/scripted.ts`.
**A turn in flight today cannot be cancelled by any caller.**

---

## 4. Parse — raw model text becomes typed fields

| # | Function | file:line | In | Out | Realm |
|---|---|---|---|---|---|
| 1 | `this.model.parse(result.text)` | `src/core/agent/agent.ts:122` | `string` | `Reply` | core |
| 2 | `BaseResponse.parse(raw, fmt?)` | `src/core/response/base.ts:231` | `string, Format` | `T extends BaseResponse` | core |
| 3 | `parseToon(FIELDS, text)` | `src/core/response/parse.ts:101` | `FieldSpec[], string` | `Record<string,unknown>` | core |
| 4 | `fieldLines(fields, lines)` | `src/core/response/parse.ts:116` | | `[index,name,firstLine][]` | core |
| 5 | `parseJson(FIELDS, text)` | `src/core/response/parse.ts:70` | | `Record<string,unknown>` | core |
| 6 | `coerceJson` | `src/core/response/parse.ts:86` | | `Record<string,unknown>` | core |
| 7 | `asList(value)` | `src/core/response/parse.ts:60` | `string` | `string[]` | core |
| 8 | `new this(data)` → `accept` | `src/core/response/base.ts:115-127`, `:65` | `Record<string,unknown>` | frozen instance | core |
| 9 | `cls.normalize(values)` | `src/core/response/base.ts:123`, overrides at `responses.ts:40,74,91,157` | `Values` | mutates in place | core |

### The order

`fmt === 'json' ? [parseJson, parseToon] : [parseToon, parseJson]`
(`src/core/response/base.ts:233`). Default format is TOON
(`src/core/response/base.ts:33`). A parser whose result has **zero keys** is
treated as "not this format" and the next one is tried
(`base.ts:236-237`).

### On malformed input

`parse` **cannot throw** — every exit constructs an instance:

- A parser that throws is caught and the loop continues (`base.ts:238-240`).
- Both parsers failing → the whole raw reply, trimmed, is put in the answer
  field (`base.ts:244`).
- Even that constructor throwing → an empty instance (`base.ts:245-247`).

Field-level strictness lives in `accept` (`base.ts:65-73`): a list field refuses
a bare string (`TypeError`, `base.ts:68`), which is what makes an unparseable
reply to a list-answer class come back **empty** rather than holding one long
item.

`normalize` fails toward the careful branch, measurably: `complexity` →
`'complex'` (`responses.ts:42`), `verdict` → `'fail'` (`responses.ts:76`),
`verdict` → `'revise'` (`responses.ts:93`), `act` → `'answer'`
(`responses.ts:168`) unless the written value contains `(` or `{`, in which case
it is rescued into `result` and `act` becomes `'tool'` (`responses.ts:164-167`).

Decoration tolerance is in the scanners: `**Thinking:**`, `- response:`,
`1. steps:` are stripped at `parse.ts:125-129`; `parseJson` finds the first
balanced `{…}` anywhere in prose (`parse.ts:70-84`).

### The seam that has never been crossed

`Agent.model` is typed `ReplyModel` — `parse(raw): Reply` and
`answerOf(text): Reply` (`src/core/agent/agent.ts:48-51`). A `BaseResponse`
subclass satisfies it structurally: `parse` (`base.ts:231`), `answerOf`
(`base.ts:260`), instance `answer` (`base.ts:144`) and `isAnswer`
(`base.ts:154`, overridden `responses.ts:184`). **No code anywhere passes a
response class as `Agent.model`.** The default is `PLAIN_TEXT`
(`agent.ts:58-61,98`); the tests use `CALLS_TOOLS`
(`tests/agent-react.test.ts:43-47`).

---

## 5. Routing / the loop — what decides another iteration

| # | Function | file:line | In | Out | Realm |
|---|---|---|---|---|---|
| 1 | `react` | `src/core/agent/react.ts:56` | `Agent, string` | `Promise<Reply>` | core |
| 2 | `loop` | `src/core/agent/react.ts:70` | `Agent, Session` | `Promise<Reply>` | core |
| 3 | `step` | `src/core/agent/react.ts:82` | `Agent, Session` | `Promise<Reply>` | core |
| 4 | `Agent.turn` | `src/core/agent/agent.ts:116` | `Session` | `Promise<Reply>` | core |
| 5 | `outcomeOf(reply)` | `src/core/agent/react.ts:51` | `Reply` | `'answer'\|'tool'` | core |
| 6 | `callTools` | `src/core/agent/react.ts:95` | `Agent, Session, Reply` | `Promise<Reply>` | core |
| 7 | `observe` | `src/core/agent/react.ts:112` | `Agent, Session, string, number` | `Promise<string>` | core |

### The actual guard

**`while (outcomeOf(parsed) !== TERMINAL)`** at `src/core/agent/react.ts:73`.
`TERMINAL` is `OUTCOMES.ANSWER` (`react.ts:38`, table `:33`). `outcomeOf` is a
single boolean read of `reply.isAnswer` (`react.ts:52`). There is no iteration
cap, no `MAX_TRANSITIONS`, no edge table, no timeout, no deadline.

The **only** brake is the three-tier repeat guard, keyed on the trimmed call
text in `Session.seen` (`src/core/agent/session.ts:36`; incremented
`react.ts:97-98`):

1. `seen === 1` → the tool runs (`react.ts:120`).
2. `1 < seen <= repeatLimit` → the tool does **not** run; the model is scolded
   in a `user` message and gets the turn back (`react.ts:113-118`).
3. `seen > repeatLimit` (default `3`, `agent.ts:100`) → `retry{gaveUp:true}`,
   a `Result: Stopping — …` line is appended, and an answer is synthesised via
   `agent.model.answerOf(...)` (`react.ts:100-104`). That reply is an answer, so
   the `while` exits on the next check. **The give-up never passes through
   `turn`** — no further model call.

Termination therefore rests entirely on the model eventually repeating itself.
Two *different* tool calls alternating forever produce `seen === 1` each time
and the loop does not stop. That is the shape of the guard as written; I state
it because "cannot be handed a runaway loop" (`react.ts:22-23`) is true only for
repeated-identical calls.

With no tool runner, `agent.tools === null` and the observation is the literal
`'Tool not found. Available: none'` (`react.ts:49,120`).

### The observer events, and their order

Emitted: `entered` on **every** pass (`react.ts:71,75`), `assembled` before
`infer` (`agent.ts:118` then `:119`), `delta` per chunk (`agent.ts:120`),
`results` after a tool ran (`react.ts:121`), `retry` on tiers 2 and 3
(`react.ts:101,114`), `done` at the terminal (`react.ts:78`). All six declared
members of `Observer` (`src/core/observer.ts:75-82`) are emitted somewhere. The
default is `SILENT = {}` (`observer.ts:85`, wired `agent.ts:99`).

**No `Observer` implementation exists in `src/`.** The only one in the tree is
in `tests/agent-react.test.ts:79-85`.

---

## 6. Recording — what is written where, and what survives a reload

| What | Where | file:line | Lifetime |
|---|---|---|---|
| user query | `Transcript.#messages` | `react.ts:59` → `transcript.ts:44,23` | process memory |
| assistant reply | `Transcript.#messages` | `agent.ts:125` (`parsed.answer.trim()`) | process memory |
| tool observation | `Transcript.#messages` as a **`user`** message, prefixed `Result: ` | `react.ts:107` | process memory |
| give-up notice | `Transcript.#messages`, `Result: Stopping — …` | `react.ts:102` | process memory |
| repeat ledger | `Session.seen` | `session.ts:36`, `react.ts:98` | one run |
| round count | `Session.round` | `session.ts:26`, `react.ts:74` | one run |
| every request sent | `ScriptedInference.received` | `scripted.ts:36,44` | process memory, fake only |
| prompt memo | `PromptAssembler.#memo` | `assembler.ts:113,168` | as long as the assembler |
| `hits` / `misses` | `PromptAssembler` | `assembler.ts:115-116,161,165` | as long as the assembler |

**Nothing survives a reload. Nothing is written outside process memory at all.**

- `StorePort` (`src/core/ports.ts:69-80`) has **zero callers**: `grep` for
  `ports.store` / `StorePort` across `src/` returns only the declaration and two
  prose mentions (`src/core/agent/transcript.ts:6`,
  `src/core/prompt/recipe.ts:8`).
- `Transcript` holds a private array and hands out copies
  (`transcript.ts:23,31-33`); its own header says durability is 3.4's
  (`transcript.ts:5-7`).
- `indexedDB` appears once in `src/`, as a capability *probe*
  (`src/engine/probe.worker.ts:43`), never as storage.
- `idb@8.0.3` is a declared dependency (`package.json:17`) with **zero
  importers** in `src/`.
- There is no worker that runs an agent: `src/engine/` contains one file,
  `probe.worker.ts`, whose whole job is reporting lock behaviour.

---

## Gaps between the trace and ARCHITECTURE.md

Ordered by how expensive the disagreement is to discover late. Every row cites
both sides.

### A. Untagged §4 / §5 entries that claim the present tense and are wrong

**A1. `app/page.tsx` "Mounts Shell".** `ARCHITECTURE.md:429` — no increment
tag, so per `ARCHITECTURE.md:291-293` it claims to be true now. The page mounts
`runWorkerProbe` and renders three elements (`src/app/page.tsx:23-43`).
`Shell.tsx` is tagged `[6.2]` (`ARCHITECTURE.md:435`) and does not exist. The
untagged line and the tagged line contradict each other inside one map.

**A2. `core/agent/agent.ts` — "recipe -> assemble -> infer -> parse -> tools ->
repeat".** `ARCHITECTURE.md:345`. `Agent.turn` does prompt → observer → infer →
parse → record and returns (`src/core/agent/agent.ts:116-127`). It never calls a
recipe (`recipe.ts` is never imported by `agent.ts`), never runs tools, never
repeats. Tools and repetition are `react.ts:95,73`. The map's own next line
describes `react.ts` correctly (`ARCHITECTURE.md:346`), so the description is
double-counted onto the wrong file.

**A3. `core/prompt/components.ts` lists `PhaseInstructions`.**
`ARCHITECTURE.md:319-320`, untagged. The file declares six classes and no
`PhaseInstructions` (`src/core/prompt/components.ts:25,45,58,88,126,176`), and
says so in its own header (`components.ts:11-15`). `Slot.PHASE = 40` and
`Slot.SKILLS = 30` (`slots.ts:22-23`) therefore have **no component class in
existence** — two of eight slots are addressable and unfillable.

**A4. `core/prompt/template.ts` — "the tiny `{{ }}` / `{% if %}` / `{% for %}`
renderer".** `ARCHITECTURE.md:317`, untagged. `{% for %}` is refused at compile
time (`src/core/prompt/template.ts:63-75`; `statement` accepts only `endif` and
`if`), and the file states the refusal is deliberate
(`template.ts:14-19`). A template using it raises `Unsupported tag`
(`template.ts:70`).

**A5. §5.5 puts `Slot` in `core/prompt/component.ts`.**
`ARCHITECTURE.md:801` heads the block "The component base —
`core/prompt/component.ts`" and the first declaration inside it is `const Slot`
(`ARCHITECTURE.md:804-805`). `Slot` is in `src/core/prompt/slots.ts:18`, and
`slots.ts`'s header (`slots.ts:11-14`) explains at length why it is its own
file. §4 has this right (`ARCHITECTURE.md:316`); §5.5 does not.

**A6. §5.5 says `detail()` returns `PromptBreakdown`.**
`ARCHITECTURE.md:824`, untagged. The source returns `Breakdown`, declared in
`src/core/prompt/assembler.ts:63-70`. `PromptBreakdown` is a `protocol/shapes.ts`
name (`ARCHITECTURE.md:374-378`), tagged `[3.2]`, and that file does not exist.
So §5.5's untagged signature names a type nothing in the tree defines.

**A7. §5.4's `BaseResponse` block is incomplete against the source.**
`ARCHITECTURE.md:785-794` lists nine members. `src/core/response/base.ts` also
exports `answerOf` (`:260`), `value(name)` (`:139`) and the `isAnswer` getter
(`:154`) — and `answerOf` is not incidental: it is what the loop's give-up is
built from (`react.ts:103`) and is named as such in `agent.ts:44-46`. §5's own
rule (`ARCHITECTURE.md:515-519`) is that an untagged declaration claims "now,
with these members".

**A8. §4's `package.json` line.** `ARCHITECTURE.md:301` — "scripts: dev build
test types gate smoke deploy". Actual scripts: `dev build types test gate
purity` (`package.json:6-11`). `smoke` and `deploy` are absent; `purity` is
present and unlisted. `scripts/smoke.ts` is tagged `[3.3]`
(`ARCHITECTURE.md:499`), so its absence is scheduled — but `deploy` and `purity`
are not accounted for either way.

### B. Files whose increment is DONE and which do not exist

§4's stated contract: *"an entry's file exists if and only if its increment is
`DONE` in `PLAN.md`"* (`ARCHITECTURE.md:291-293`). Three violations:

**B1. `adapters/test/fetch.ts` `[2.3]`** (`ARCHITECTURE.md:362`). 2.3 has a
PROGRESS entry (`docs/PROGRESS.md:399`). `src/adapters/` does not exist.

**B2. `adapters/test/clock.ts` `[2.6]`** (`ARCHITECTURE.md:358`). 2.6 has a
PROGRESS entry (`docs/PROGRESS.md:622`). `src/adapters/` does not exist. This
one has a *reason* the map does not record: `Recipe.context` takes a
`() => Record<string,string>` rather than a `ClockPort`
(`src/core/prompt/recipe.ts:43`, argued at `recipe.ts:8-15`), so 2.6 never
needed a test clock. The map still schedules one.

**B3. `scripts/checks/lines.json` `[2.6]`** (`ARCHITECTURE.md:481`). PLAN 2.6's
acceptance is explicit — *"2.6 writes `scripts/checks/lines.json` seeded from a
tree that contains real modules, after which `size.ts` reports a delta and `max`
may only go down"* (`docs/PLAN.md:137`), reinforced at `docs/PLAN.md:139-148`.
`ls scripts/checks/` returns `gate-coverage.ts purity.ts size.ts`. **The `max`
ratchet PLAN says 2.6 arms is not armed.** §8.3 already knows the file is absent
(`ARCHITECTURE.md:1512` — *"does not exist yet. Increment 2.6 creates it"*), but
it is written in the future tense against an increment that has already shipped,
so the two halves of the document now disagree about whether 2.6 is finished.

### C. Files that exist and are in no map

§4's other direction: *"every file under `src/` and `scripts/` appears here"*
(`ARCHITECTURE.md:291-292`).

**C1. `scripts/wasm/**` — nine files, unmapped.** `scripts/wasm/build.sh`,
`PINS.env`, `README-UNPINNED.md`, `serve-probe.ts`, and
`scripts/wasm/boot-probe/{index.html,guest.wasm,probe-worker.js,wasi-util.js,
browser_wasi_shim/{index.js,wasi_defs.js}}`. Not one appears in
`ARCHITECTURE.md:468-507`. `docs/scratch/SANDBOX.md` exists (579 lines) and wave
5 declares no line budget (`docs/PLAN.md:317`), so this is unaccounted work
sitting inside the directory `checks/docs.ts` `[1.7]` is meant to enumerate.

**Caveat, stated because it changes who owns this row:** `scripts/wasm/` is
**untracked** (`git status --short` → `?? scripts/wasm/`) and appeared during
this session, so it is plausibly a parallel agent's in-flight wave-5 work rather
than a landed omission. The gap is real the moment it is committed; today it is
a warning, not yet a violation.

### D. Contracts in §5 with no implementation, and their assigned increment

| §5 contract | ARCHITECTURE cite | Assigned increment | Evidence of absence |
|---|---|---|---|
| `RequestRecord.headers` + `HeaderRecord` | `:632-634` | `[6.4]` (`PLAN.md:252`) | `src/core/inference/base.ts:55-65` |
| `Tool` / `ToolResult` / `Toolbox` / `TOOL_OUTPUT_CAP` | `:715-733` | 4.2 (`PLAN.md:216`) | no `src/core/tools/` |
| `Phase`, `Flow`, `FLOWS`, `validateFlow`, `MAX_TRANSITIONS`, `driver.ts` | `:833-859` | 4.5 (`PLAN.md:219,221`) | no `src/core/flow/`, no `driver.ts` |
| worker protocol `ToEngine`/`FromEngine`/`REPLY_OF` | `:861-862`, `:923+` | 3.2 (`PLAN.md:205`) | no `src/protocol/` |
| `client/actions.ts` dispatch surface | `:865-871` | 3.2 (`PLAN.md:205`) | no `src/client/actions.ts` |
| `engine/stores/*` | `:905-922` | 3.4 (`PLAN.md:207`) | `src/engine/` = 1 file |
| `AgentConfig` / `agentfile.ts` | `:341-342` | 4.1 (`PLAN.md:215`) | no `src/core/agent/config.ts` |

These are correctly tagged and are *scheduled*, not drift. They are listed so
the count is honest: **seven of §5's nine contract blocks have no
implementation.** The two that do are §5.1 (ports) and §5.2 (inference) — and
§5.1 is itself only one-quarter live (see E2).

### E. Where the source and the document disagree about facts already shipped

**E1. §5.2 tells a reader to fix a comment, and the comment is unfixed.**
`ARCHITECTURE.md:684-686`: *"the comment in `base.ts` should read 'headers
arrive at 6.4 per §5.2' rather than asserting the field is unwanted, and that
one-line correction belongs to whoever next opens the file."*
`src/core/inference/base.ts:51-53` still reads *"There is no `headers` field. The
key lives in `InferenceConfig` and the Authorization header is the one part of a
request that must not reach the render realm"* — the assertion §5.2 ruled
against. Both files have been opened since (2.3 shipped `openai.ts` against this
base, `docs/PROGRESS.md:399`).

**E2. `ports.ts`'s own caller count is wrong again — in the file that warns
about exactly this.** `src/core/ports.ts:10-12`: *"As of 2.2 exactly ONE has a
caller — `FetchPort` … and `clock`, `store` and `newId` still have none; they
arrive at 2.6, 2.4 and 2.4."* Measured today: `newId` **did** arrive at 2.4
(`src/core/agent/agent.ts:107`); `clock` did **not** arrive at 2.6 — `ClockPort`
has zero callers in `src/` and `Recipe.context` deliberately takes a function
instead (`src/core/prompt/recipe.ts:43`, reasoned at `:8-15`); `store` has zero
callers. `ports.ts:14-17` calls its predecessor sentence *"the worked example in
§8.7 of what `checks/docs.ts` cannot catch: well-formed, referring to nothing
external, and false"* and instructs *"Keep it counted honestly, or delete the
count."* **The count is stale in two of three directions and the increment that
was supposed to fix one of them has shipped.**

**E3. `AssembledEvent.prompt` was supposed to become the breakdown at 2.6 and
did not.** `src/core/observer.ts:26-29`: *"The whole prompt as one string. 2.6
replaces this with the assembler's `PromptBreakdown`, which is the same fact with
its bands still separate."* 2.6 shipped (`docs/PROGRESS.md:622`). The event still
carries `prompt: string` (`observer.ts:29`), the prompt seam is still
`(session) => string` (`src/core/agent/agent.ts:64`), `promptFor` returns a
string (`recipe.ts:84`), and `assemble()` **computes the breakdown and discards
it** (`assembler.ts:119-120`). Consequence: `Band[]`, `hits` and `misses`
(`assembler.ts:54-70`) are computed on every turn and can reach no consumer.
`ui/prompt/BandStack.tsx` `[6.4]` (`ARCHITECTURE.md:448`) is the intended reader
and does not exist. This is the "declared but never emitted" defect class named
at `observer.ts:15-18`, in its quieter form: emitted, then thrown away.

**E4. `CORE_MARK` is carried out through a value the only caller discards.**
`src/core/prompt/slots.ts:29-38` argues the sentinel must be *returned* by
`detail()` so tree-shaking cannot remove it — and it is
(`assembler.ts:150`). But every non-test caller path goes through `assemble()`,
which drops the whole `Breakdown` (`assembler.ts:120`). There are no non-test
callers at all today. `checks/bundle.ts` is `[3.1]`
(`ARCHITECTURE.md:480`) and is listed as SCHEDULED in the gate
(`scripts/gate.ts:63`), so the sentinel is currently unchecked by anything.

**E5. The gate runs six checks; §8 names thirteen.**
`scripts/gate.ts:48-55` — `types`, `tests`, `purity`, `size`, `gate-coverage`,
`export`. `scripts/gate.ts:58-64` names seven more as SCHEDULED. `checks/docs.ts`
`[1.7]` — the check that would catch A1–A8, B1–B3 and C1 — is in **neither
list** (`scripts/gate.ts:58-64` omits it), and `PLAN.md:173-181` records that
1.7 has not shipped. **Every gap in sections A, B and C above is exactly the
class of defect `checks/docs.ts` was designed to catch, and there is no
mechanical check for any of them today.**

**E6. `Uint8Array` is not in the purity allowlist, and the core works around
it.** `src/core/inference/openai.ts:112-115`: *"`Uint8Array` is an ECMAScript
built-in that `checks/purity.ts` does not list, so the core cannot construct one
— hence the guard rather than an empty-array default. Reported to the architect,
not worked around."* `grep Uint8Array docs/ARCHITECTURE.md` → **no match**. The
report reached `docs/PROGRESS.md:454-455` and never reached the architecture of
record, so `readStream`'s defensive `if (step.value !== undefined)`
(`openai.ts:115`) reads as paranoia to anyone who has not read PROGRESS.

### F. Structural gaps the documents do not name at all

**F1. The prompt path and the agent path have never executed together.**
No file in `src/` imports `recipe.ts` (`promptFor`'s only caller is
`tests/prompt.test.ts:60`), and `agent.ts` does not import anything under
`core/prompt/**`. §4 describes `agent.ts` as "recipe -> assemble -> …"
(`ARCHITECTURE.md:346`) — see A2 — but no increment in `PLAN.md` is assigned the
job of *connecting* them. 4.1 builds the agent identity file
(`PLAN.md:215`) and `engine/build-agent.ts` `[4.1]`
(`ARCHITECTURE.md:398`) is the plausible home, but nothing in PLAN's 4.1
acceptance says so.

**F2. No `Observer` implementation exists outside a test.** `engine/observer.ts`
is `[3.3]` (`ARCHITECTURE.md:399`). Until then, six emitted events have exactly
one consumer, in `tests/agent-react.test.ts:79-85`.

**F3. The loop has no bound on *distinct* tool calls.** `react.ts:73` loops
while the outcome is not the terminal; `Session.seen` (`session.ts:36`) is keyed
on the exact trimmed call text (`react.ts:96-98`). Alternating distinct calls
never trip the guard. `MAX_TRANSITIONS = 64` (`ARCHITECTURE.md:847`) is the
bound the architecture names and it is tagged 4.5. Nothing today bounds a react
run.

**F4. `Session.seen`'s known batch-ordering defect is recorded in source only.**
`src/core/agent/session.ts:36-42` — `a(), b()` and `b(), a()` are two keys for
one intention; the fix is assigned to 4.2 in the comment. `PLAN.md:216` (4.2)
does not mention it and `ARCHITECTURE.md` does not carry it. A debt named in one
file's comment is a debt with no owner.

**F5. `Session.query` is written and never read.** `session.ts:19,40` and
`react.ts:57`. The transcript already carries the same text
(`react.ts:59`). One fact, two homes — the shape `ARCHITECTURE.md:2082` (§10.3)
and `PLAN.md:6-13` both rule against elsewhere.

---

## What one turn costs

Measured against **one round** of the react loop with the six real components
and a real transcript of *M* messages. Counts are of executed calls, not of
lines.

### Hops

The call chain from a string to a recorded answer, one entry per function that
actually runs:

```
react                     react.ts:56
└ Agent.open              agent.ts:106      → ports.newId  ports.ts:83
└ Transcript.add          transcript.ts:44
└ loop                    react.ts:70       → observer.entered
  └ step                  react.ts:82
    └ Agent.turn          agent.ts:116
      ├ #prompt(session)  agent.ts:117      = promptFor closure  recipe.ts:85
      │ └ baseComponents  recipe.ts:66
      │   ├ historyLines  recipe.ts:58      → Transcript.messages  transcript.ts:31
      │   ├ recipe.context()                recipe.ts:69
      │   ├ 5 × constructor + Object.freeze  components.ts:33,67,96,139,185
      │   └ ResponseContract.of             components.ts:193 → instructionsText :160
      │ └ assembler.assemble                assembler.ts:119
      │   └ assembler.detail                assembler.ts:132
      │     ├ 6 × applies()                 assembler.ts:134
      │     ├ sort                          assembler.ts:135
      │     ├ check() × 3 invariants        assembler.ts:136,174
      │     ├ 6 × #render                   assembler.ts:155
      │     │   └ key()  component.ts:76 → fieldsOf + JSON.stringify + hash
      │     │   └ render()  component.ts:71 → templateData → fieldsOf → template render
      │     ├ 6 × band()                    assembler.ts:99  → utf8Bytes per band
      │     └ utf8Bytes(prompt)             assembler.ts:146
      ├ observer.assembled                  agent.ts:118
      ├ inference.infer                     agent.ts:119 → openai.ts:55
      │ ├ describeRequest                   openai.ts:81  → JSON.stringify  :93
      │ ├ fetchPort                         openai.ts:57
      │ └ readStream                        openai.ts:98
      │   └ per read:  readOrAbort :136 → decode :212 → buffer concat :115
      │   └ per line:  applyLine :153 → JSON.parse :162 → applyFrame :177
      │   └ per delta: state.text += :185, onDelta :186 → observer.delta agent.ts:120
      │   └ finish                          openai.ts:148
      ├ model.parse                         agent.ts:122
      │ └ parseToon :101 → splitLines :102 → fieldLines :116   (then parseJson :70 if empty)
      │ └ new this(data) :115 → accept :65 × fields → normalize :123
      └ Transcript.add('assistant', …)      agent.ts:125
└ outcomeOf                                 react.ts:73
  (tool branch adds: callTools :95 → observe :112 → agent.tools() :120
   → observer.results :121 → Transcript.add :107)
```

**Answer round: 21 named functions in the core, of which 12 run per-component or
per-frame.** Tool round: **26**, plus one further model call.

### Prompt string allocations

For 6 components, one turn:

1. **6 template renders** — each builds its own string by `out += node.v`
   (`template.ts:98-104`).
2. **6 `fieldsOf` objects for `templateData`** (`component.ts:66-67` →
   `component.ts:97-101`).
3. **6 more `fieldsOf` objects for `key()`**, plus 6 `JSON.stringify` calls over
   the field pairs and 6 FNV passes (`component.ts:76-78`, `:114-123`) — except
   `History`, which substitutes a `lines.join('\u0000')` of the whole transcript
   (`components.ts:110`), and `ContextBlock`, which skips `key()` entirely
   because `CACHEABLE` is false (`assembler.ts:156`).
4. **6 `prompt += text` concatenations** (`assembler.ts:142`) — 6 intermediate
   strings of growing length; the final one is the prompt.
5. **1 full re-walk of the finished prompt** by `utf8Bytes` (`assembler.ts:146`).
6. **1 full copy of the prompt into JSON** at `describeRequest`
   (`openai.ts:93`), which is also the `fetch` body (`openai.ts:63`).

**The prompt text exists in at least three complete copies per turn**: the
accumulated `prompt`, the `InferenceRequest.prompt` reference held in
`ScriptedInference.received` where a fake is used (`scripted.ts:44`), and the
JSON body string. On the memoised path (turn 2 onwards) items 1–3 are skipped
for every component whose fields did not change; `ContextBlock` and `History`
never are.

### The same data transformed twice

Five instances, all in code that runs every turn:

1. **UTF-8 length is computed twice over the same bytes.** `band()` calls
   `utf8Bytes(text)` per component (`assembler.ts:105`), and `detail()` then
   calls `utf8Bytes(prompt)` over the concatenation (`assembler.ts:146`). The
   second is the sum of the first six. Cost: 2 × the full prompt, character by
   character, with a branchy codepoint switch (`assembler.ts:79-83`).

2. **The whole breakdown is computed and discarded.** `assemble()` is
   `this.detail(components).prompt` (`assembler.ts:119-120`). Every `Band`, both
   counters and `CORE_MARK` are built (`assembler.ts:138-151`) for a caller that
   takes one field. There is no cheap path. See gap E3.

3. **Each component's fields are walked twice.** `templateData()`
   (`component.ts:66`) and `key()` (`component.ts:76`) each call `fieldsOf`
   (`component.ts:97`), building two objects from the same `FIELDS` array in the
   same `#render` call (`assembler.ts:158,167`).

4. **The transcript is materialised three times per prompt.**
   `Transcript.messages` returns a fresh copy of every message object
   (`transcript.ts:31-33`); `historyLines` maps it into *M* new strings
   (`recipe.ts:59-60`); `History.key()` joins those *M* strings into one
   (`components.ts:110`); `History.render()` joins them again with `\n\n`
   (`components.ts:90` → `template.ts:108`). That is O(*M*) allocations and O(total
   transcript bytes) of copying, **four times**, per turn — and the memo cannot
   help, because the key changes every turn by construction.

5. **The reply text is scanned twice on the common path.** `parseToon` runs
   first under the default format (`base.ts:233`), splitting the whole reply
   (`parse.ts:102`) and scanning every line (`parse.ts:119-131`); if it yields
   zero keys, `parseJson` then scans the same text character by character
   looking for a balanced brace (`parse.ts:73-82`). A plain-prose reply pays
   both in full before the fallback at `base.ts:244`.

### What a turn does *not* cost

No storage write (§6 above), no cancellation plumbing (§3 above), no
serialisation across a realm boundary — everything above runs in one process, on
one thread, in `bun test`.
