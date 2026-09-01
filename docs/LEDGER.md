# Ledger

One line per slice. A slice is one row from `CAPABILITIES.md` that can be judged
on its own. This is a record, not a plan — the queue below is an ordering of
rows that already exist in the ledger, and it is re-cut after every wave.

Every slice is built by one agent, judged by a second that never sees the
first's reasoning, cut by a third that only asks whether deleting a line
changes an output, and then fixed. Nothing is marked done without the gate:

    bun run check
    bun scripts/dryrun.js "<a task that exercises the slice>"

`check` is lint, then tests, then the static export — one definition, in
`package.json`, and nothing here restates it. An earlier version of this file
spelled the gate out a second way and immediately drifted from the scripts,
which is the failure it was warning about.

The dry run is the second half and it is not optional. A slice changes what the
model is handed; the transcript is how anyone sees that, and it prints the
prompt byte for byte with a sha256 rather than a summary of it. Output pasted,
both commands, always.

`test` runs `bun test --isolate`. Not a preference: Bun 1.4.0 segfaults when two
or more test files import a module that fails to parse, which is the ordinary
state of the tree while a slice is being written. `--isolate` turns that panic
into a named error and keeps discovery unscoped — a `bunfig` test root was
measured to silently drop a colocated test file, and a gate that hides a test is
worse than one that crashes, because a crash is visible. `lint` running first is
the real guard: biome catches the parse error before the runner ever sees it.

Status: `open` -> `built` -> `judged` -> `landed` | `rejected`

## Done and in flight

| # | Slice | Row it closes | Status | Verdict |
|---|---|---|---|---|
| 0A | Verification harness — `bun test`, dry-run transcript, scripted model | §5 "every measured number is an assertion" | built | — |
| 0B | Reference study — what agent-zero / bolt.diy / Open SWE / eliza put in the context window | §4 calibration | built | — |

## Queue

Ordered by what unblocks the most rows, not by what is easiest.

| # | Slice | Row it closes |
|---|---|---|
| 1A | `fetch` and `search` tools in the backend worker | Search the web `absent`; Fetch a URL `absent` |
| 1B | Bound and cancel the loop — abort through the envelope, a budget the agent can read | Bound it `absent`; Cancel it `absent` |
| 2A | The persistence spike — an OPFS-backed disk reattached across guest boots | Keep a file between calls `unverified` — §5, the open question |
| 2B | `navigator.locks` single writer + `navigator.storage` pressure | Two tabs at once `absent`; Storage pressure `unverified` |
| 3A | Sub-agents actually constructed, with tools | Sub-agents `unverified`; Sub-agent tools `absent` |
| 3B | A durable run log — every turn, prompt and observation, replayable | Traces / a run log `absent` |
| 4A | Cost per call, derived from usage already streamed | Cost `absent`; Token accounting `degraded` |
| 4B | The iOS probe page | the whole `iOS` column |
| 5A | Embeddings and semantic recall over the conversation store | Embeddings `absent`; Semantic recall `absent` |

Two units in `src/core/` have zero call sites anywhere in `src/`, `scripts/`,
`agents/` or `public/`, and are reached only from their own tests:
`Outcome.unwrapOr` and `prompt/tokens.js`'s `TokenScale`. Each is either wired
into the path it was written for — `TokenScale` into the usage `Inference._usage`
already produces — or deleted with its test. Left here rather than done inside
slice 0A, whose whole rule was to add tests without changing `src/`.

## The bar

The run ends when a blind critic, handed two unlabelled transcripts — ours and
agent-zero's on the same task — picks ours, on the rubric in
`docs/REFERENCE-PROMPTS.md`, without knowing which is which.

## Who judges

`docs/ROLES.md`. Three seats — coder, critic, bar raiser — and what each one
is allowed to say. Waves 0 through 2 ran with the third seat briefed as a
cutter rather than a bar raiser; every slice they passed is owed a bar-raiser
pass it never got.

## The bar-raiser survey

Read-only, four lenses, every finding attacked by an independent skeptic that
defaulted to refuted. 12 raises, 8 survived, 4 killed. Three refuters applied
the rewrite in a scratch tree and ran the suite before voting.

The verdict: **the tree meets the bar on composition and fails on
bookkeeping.** 25 real `extends` in `src/`, and all but six have two or more
real implementations. The six are the four transformers.js speech leaves —
config records spelled as classes, and the tree's only two three-deep chains —
and `Entity`, whose `equals` has zero callers while both subclasses shadow its
`toJSON`. The port-in-the-constructor rule holds at every backend seam except
one line, `composition.js:219`, which writes `chat.services.http` after
construction behind five lines of comment defending it.

What is not enforced is that a declaration must have a writer. Five dead ones:
`soul`, the `identity` prompt block that has rendered zero bytes on every call
ever made, `Format`'s JSON arm, `Entity.equals`, and `ShellTool`'s `description`
option. Both standing rules in `docs/ROLES.md` come from this.

Slices, ordered by concepts deleted per line edited:

| # | what | files | call sites | state |
|---|------|-------|-----------|-------|
| S1 | delete `Entity` | Entity, Message, Conversation | 2 | ready |
| S2a | speech: collapse the two transcriber leaves into the registry | speech/index, TransformersTranscriber, Transcriber | 0 outside index | ready |
| S2b | speech: collapse the two speaker leaves | speech/index, TransformersSpeaker, Speaker | 0 outside index | ready |
| S3 | `ChatService` takes `http` in its constructor | ChatService, composition | 1 | ready |
| S4 | delete `soul` and the `identity` block | Engine, PromptTemplate, 8 assertions, 5 prose | — | Budget.js line blocked |
| S5 | delete `Format` | 5 source, 2 test | — | in flight |
| S6 | `Promise.withResolvers` in `BackendClient` | BackendClient | 1 | ready |
| S7 | cut the duplicated paragraph from `agents/main/agent.md` | agent.md | — | ready |

S2 must be split: the ear and voice halves have different option signatures and
no coder holds both at once. S4 and the finding filed as 8 are the same
deletion at the same line — slicing them twice buys a merge conflict.

Three rewrites the survey explicitly refused: moving the ~100x-slower sentence
into `ShellTool`'s description (it is a property of `C2wSandbox`, and
`docs/TESTBED.md` records keeping it as deliberate, so moving it silently drops
it from our arm of the only head-to-head in the repo); turning `static LABEL`
into instance state (it is the tree-wide spelling and a registry key); and
wiring `soul` rather than deleting it (identity already lives in the agent
file's own body).
