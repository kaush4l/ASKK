# Ledger

One line per slice. A slice is one row from `CAPABILITIES.md` that can be judged
on its own. This is a record, not a plan — the queue below is an ordering of
rows that already exist in the ledger, and it is re-cut after every wave.

Every slice is built by one agent, judged by a second that never sees the
first's reasoning, cut by a third that only asks whether deleting a line
changes an output, and then fixed. Nothing is marked done without the gate:

    bun run check && bun run build

`check` is `bun run lint && bun test`; the build is the static export. Written
as one command that composes the other so there is a single definition of the
gate — two wordings of it is how one of them stops being run. Output pasted.

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
