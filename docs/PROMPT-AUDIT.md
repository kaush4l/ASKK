# Prompt audit — what we send, against what the references send

Read on 2026-09-01 at `main` `41b9e6e` plus an uncommitted working tree. The tree
moved twice during this audit — `agents/main/agent.md` gained `search` and
`fetch`, and `CAPABILITIES.md` was rewritten around a new C1 — so every number
below names the artifact it came from and, where it matters, its sha256. Two
measurements of the same prompt taken forty minutes apart are both reported
rather than one silently replacing the other.

Everything here was produced by running something. The commands are in the
sections that use them. Where a number could not be obtained it says
`not established`, and there are no estimates dressed as measurements.

**Since this audit was written, the code it cites has moved.** The contract was
cut on the evidence below, and a later wave deleted `soul`, the `identity`
block, the `Format` enum and the `overrides` bag. Every `BaseResponse.js` and
`ReActResponse.js` line number in the `contract` section is an anchor into the
**463-token contract as it stood when it was audited**, and that text exists
nowhere in the tree now; read it with `git show 41b9e6e:src/core/response/BaseResponse.js`
rather than by opening the file. The live equivalents are `instructions()` at
`BaseResponse.js:162`, its header line at `:169` and its example at `:173`. Line
numbers outside that section have been repointed at the current tree and are
marked where a claim, not just a number, changed.

## How the tokens were counted

Three counters, because one counter is an opinion:

| counter | what it is | how it was run |
|---|---|---|
| `estimateTokens` | ours, `src/core/prompt/tokens.js:30` | `bun scripts/dryrun.js` and a harness importing it directly |
| `cl100k_base` | tiktoken, a real BPE vocabulary, offline | `tiktoken.get_encoding("cl100k_base").encode(s)` |
| Qwen3.8-27B | the tokenizer of the model actually in the loop | `usage.prompt_tokens` from `http://127.0.0.1:8873/v1/chat/completions`, minus a measured 53-token chat-template overhead |

On our own prompt the three agree closely — 1,092 (ours) / 1,000 (cl100k) /
~1,010 (Qwen). Across the five reference prompts our estimator runs between
**+0.7% and +12% above cl100k** (bolt +0.7%, eliza +4.7%, Open SWE +7.8%, ours
+9.2%, agent-zero +11.9%). `docs/REFERENCE-PROMPTS.md` says the estimator is
"within 1.6% of the provider's count before calibration"; that is true against
this Qwen build and **not** true against cl100k on prose-heavy prompts. The
estimator is good enough to rank sections and not good enough to quote to a
provider — which is what `TokenScale` (`tokens.js:55`) exists to fix and which
has zero call sites outside its own test.

Cross-project comparisons below use **cl100k**, because it is the only counter
that is free, deterministic, offline, and identical for all five. Our own
internal accounting uses our estimator, because that is what the app reports.

---

## What we send

The artifact: `bun scripts/dryrun.js "Check whether /etc/os-release exists in the
sandbox and say which distro it is"`, step 1, **sha256 `e46ce36dbc39`**, 4,137
bytes / 4,109 chars, agent `agents/main/agent.md` with `tools: [shell, search,
fetch]`.

| block | volatility | chars | ours | cl100k | in the reusable prefix |
|---|---|---:|---:|---:|---|
| `instructions` | static | 1,104 | 253 | 245 | yes |
| `tools` | static | 1,216 | 302 | 287 | yes |
| `contract` | static | 1,532 | **463** | **392** | yes |
| `conversation` | append | 104 | 26 | 26 | no |
| `context` | volatile | 58 | 19 | 22 | no |
| `reminder` | static, `tail` | 81 | 23 | 22 | no |
| `cue` | static, `tail` | 14 | 6 | 6 | no |
| **total** | | **4,109** | **1,092** | **1,000** | 1,018 / 914 cacheable |
| `identity`, `scratchpad` | | 0 | 0 | 0 | empty, so absent entirely |

`identity` no longer exists. It rendered 0 bytes here because nothing ever wrote
the `soul` it was built from, and nothing ever did on any call before or after —
so the block and its parameter were deleted rather than wired. The row stays
because it is what the measurement found; there is no block behind it now.

**Ceremony — everything that is identical no matter what the user asked — is
1,047 of 1,092 tokens on the first turn. 96%.** The task and the clock are the
other 45.

Forty minutes earlier, before `search` and `fetch` landed, the same command
produced **sha256 `6c32302b7da6`**, 3,349 bytes, 893 tokens: `instructions` 195,
`tools` 161, `contract` 463, `conversation` 26, `context` 19, `reminder` 23,
`cue` 6, prefix 819 (92%). That is the reading the brief quotes, and **the brief
is right: the contract was 463 of 893 = 51.8% of the prompt, more than the
system text (195) and the whole tool table (161) combined.** It is now 42.4%
because the denominator grew by 199 tokens of new tools, not because the contract
shrank by a byte. Both readings describe the same 463-token block.

Ceremony does not fall away as work accumulates. A three-step run
(`bun scripts/dryrun.js "Write a JS function that dedupes an array…" <3 replies>`,
measured at the one-tool state) costs 903 / 1,006 / 1,059 tokens; the fixed
blocks are 848 of each. **Over the whole run, 2,544 of 2,968 prompt tokens —
86% — were the same bytes sent three times.**

### The reusable prefix is under the caching threshold

`PromptTemplate.assemble` (`src/core/prompt/PromptTemplate.js:164-240`) puts the
breakpoint at the end of the last `STATIC` block — char 3,852. Three counters
agree on what that is worth: **1,018 tokens (ours), 953 (Qwen, measured via
`usage.prompt_tokens`), 914 (cl100k)**. Our own panel reports 1,018 — six
tokens under the 1,024 threshold below — but that near-miss is an artifact of our
estimator running ~9% high; by the two real tokenizers the gap is 71 and 110
tokens. `AnthropicCompatible._content`
(`src/core/inference/AnthropicCompatible.js:121-129`) sends that as a real
`cache_control: {type: "ephemeral"}` marker. `OpenAICompatible` never reads
`cacheAt` (`grep -n cacheAt src/core/inference/OpenAICompatible.js` → no matches)
and relies on automatic prefix matching, which is correct for that API.

Anthropic's minimum cacheable prefix is model-dependent, and shorter prefixes
**silently do not cache — no error, just `cache_creation_input_tokens: 0`**
(`claude-api` skill, `shared/prompt-caching.md:129-140`;
docs.anthropic.com/en/docs/build-with-claude/prompt-caching):

| model | minimum | does our 914–1,018-token prefix cache? |
|---|---|---|
| Claude Opus 5, Fable 5, Mythos 5 | 512 | yes |
| Opus 4.8, Sonnet 5, Sonnet 4.6, Sonnet 4.5, Opus 4.1/4, Sonnet 4 | 1,024 | **no** |
| Opus 4.7, Haiku 3.5 | 2,048 | **no** |
| Opus 4.6, Opus 4.5, Haiku 4.5 | 4,096 | **no** |

The whole prefix machinery — the `Volatility` enum, the ordering argument, the
`tail` flag, the `audit()` method, the `cacheAt` plumbed through two realms —
currently buys a cache entry on exactly one model family. On every other Claude
model the marker is inert and nobody is told. This is the single most
consequential thing in the audit, and it inverts the obvious conclusion: the
contract is the largest removable block in the prompt, **and removing it moves
the prefix further from the threshold that would make the caching real.**

The app already has both numbers that would settle this and shows neither.
`Inference._usage` reads `cached_tokens` / `cache_read_input_tokens`
(`src/core/inference/Inference.js:96-101`) **and** `cache_creation_input_tokens`
as `written` (`:102`). `page.jsx:648` renders the first as the empty string when
it is zero — `{usage.cached ? \`, ${usage.cached...} cached\` : ''}` — and
`grep -rn "\.written" src/app/page.jsx src/backend/services/ChatService.js
src/client/BackendClient.js` returns nothing, so the second is collected and
never displayed. `cache_creation_input_tokens: 0` is precisely the signal the
Anthropic docs name for "your prefix was too short"
(`shared/prompt-caching.md:129`), and it is the one field this app throws away.
Measured on the local server: `cached_tokens: 0` on a first call — correct, and
indistinguishable from failure.

---

## The standard this is judged against

Not taste. Four sources, and where they disagree or do not reach, it says so.

**S1 — Prompt caching is a byte prefix match with a model-dependent minimum.**
`claude-api` skill `shared/prompt-caching.md:125-142`: max 4 breakpoints; render
order `tools` → `system` → `messages`; minimums 512/1,024/2,048/4,096 by model;
"verify with `usage.cache_read_input_tokens` — if it's zero across repeated
requests, a silent invalidator is at work". Public equivalent:
docs.anthropic.com/en/docs/build-with-claude/prompt-caching. **Not contested.**

**S2 — Position matters at long context; "lost in the middle".** Liu, Lin,
Hewitt, Paranjape, Bevilacqua, Petroni & Liang, *Lost in the Middle: How Language
Models Use Long Contexts*, arXiv:2307.03172 (TACL 2024): accuracy is highest when
the relevant information is at the beginning or the end of the input and degrades
in the middle. **Contested in application, not in finding.** The effect was
measured on multi-document QA with 10–30 documents — tens of thousands of tokens.
`PromptTemplate.js:66-80` cites it to justify a 23-token reminder at the end of a
1,092-token prompt. At that length there is no middle to be lost in, and the
paper does not license the inference. The reminder may still be right; the
citation is not evidence for it. Our own compliance run below is.

**S3 — Prohibition lists and counter-examples are a deletion candidate, not a
default.** `claude-api` skill `shared/prompt-audit.md` Group 1c: *"Prohibition
lists ('do not X, never Y, avoid Z…') — describing success beats enumerating
failure; a prohibition against a failure the model wasn't going to make can
anchor it toward that failure. Keep prohibitions whose failure reproduces on the
target model; rewrite the rest as positive statements of intent."* And Group 1e:
a prohibition with **provenance** stays; one that merely describes an undesirable
output style with no provenance is cruft. The same file's Group 1c on repetition:
*"duplicated rules make the model spend effort reconciling wordings"*. The
public-facing form of the same advice is OpenAI's prompt-engineering guide
("Instead of just saying what not to do, say what to do instead",
platform.openai.com/docs/guides/prompt-engineering) — **a vendor guideline, not
an experimental result**, and labelled as such here.

**S4 — Unenforced instructions are cruft, and enforceable ones belong in code.**
`shared/prompt-audit.md` Group 1d: *"Unenforced instructions: rules no code path,
eval, or reviewer checks… Enforce in code what can be enforced in code; delete
what nothing enforces and nobody misses."* This is the sharpest tool for this
particular prompt, because this prompt has a parser sitting behind it that
already enforces most of what it asks for.

**And the counterweight, which this audit is bound by.** The same source's prime
directive: *"The audit's job is to find specific dated instructions, not to make
prompts shorter… 'Every token earns its place' is the frame; 'make it short' is
not."* Its keep list explicitly protects four things this document might
otherwise have cut: **tool contract detail** ("stays — and often grows"),
**format-pinning examples on genuinely format-sensitive outputs**, **a single
end-of-prompt restatement of key constraints** ("deliberate recap is not
padding"), and **working redundancy** ("if it isn't causing errors and the target
model reconciles it, an audit leaves it alone"). Three of the eight changes below
were softened by that list, and the reminder block survived it.

---

## What the others send

Sources on disk at
`/private/tmp/claude-501/-Users-kaush-Downloads-Dev-ASKK/c66f33f7-5253-4e64-a2fa-a163866b9b53/scratchpad/`.
Every token figure is cl100k over the named file, run as
`tiktoken.get_encoding("cl100k_base").encode(open(f).read())`. Assembly for the
four references is `assembled/*.txt`, built as `docs/REFERENCE-PROMPTS.md`
describes; I re-counted every token figure rather than copying it, and re-ran
every structural claim as a `grep` against the extracted source. Where a claim
comes from `docs/REFERENCE-PROMPTS.md` and the file behind it is not in the
extract, the cell says so rather than borrowing its confidence.

| | **us** | **bolt.diy** | **agent-zero** | **Open SWE** | **elizaOS** |
|---|---|---|---|---|---|
| **static system prompt, cl100k** | **924** (`instructions`+`tools`+`contract`) | **6,934** (`assembled/bolt.system.txt`, 31,883 ch) | **3,784** (`assembled/agent-zero.system.txt`, 16,657 ch) | **4,991** (`assembled/open-swe.system.txt`, 23,562 ch) | **4,020** stage 1 + **2,603** stage 2 (`assembled/eliza.messageHandler.txt`, `eliza.planner.txt`) |
| **same, Qwen tokenizer** | **960** (251+298+411, measured) | 7,283 | 3,949 | 5,092 | 4,062 / 2,623 |
| **whole first-turn prompt, cl100k** | **1,000** | not established — depends on the selected file set, appended per request (`bolt.diy/app/lib/.server/llm/stream-text.ts:166-173`) | 3,784 + 109 extras template (`assembled/agent-zero.extras.txt`, a floor: `{{file_structure}}` is unexpanded) | not established — repo-dependent | not established — provider-dependent |
| **response contract, cl100k** | **392** = **42%** of our static prompt (414 with the 22-token reminder) | **2,519** (`artifact_info` 1,753 + `examples` 766) = 36% — but the DSL *is* the tool description, so this is not a like-for-like contract | **284** (`az/agent.system.main.communication.md` minus its include) = **7.5%** | **0**. `grep -inE "response format\|field_name\|reply with\|json object containing\|output only" oswe_prompt.py` → no matches. Native function calling | **~20**. One line: *"plain-JSON fallback only (when native tool calls are unavailable)…"* (`el_planner.ts:32`, `el_prompts.ts:845`) |
| **how tools are described** | signature + prose + per-parameter prose, rendered from the class (`src/core/tools/Tool.js:37-58`); the model writes the call as text and `Toolbox.parse` (`Toolbox.js:57-102`) reads it back | a DSL — `<boltArtifact>`/`<boltAction type="shell\|file\|start">` taught by numbered rules and two full worked `<examples>` | prose markdown, one file per tool, each ending in a complete JSON usage example (`az/agent.system.tool.*.md`; the nine root files are 2,131 cl100k of the 3,784) | native JSON schema; the prompt spends its words on *when not to* use each tool | native JSON schema generated from the action catalogue, plus `REPLY`/`IGNORE`/`STOP` sentinels |
| **how an observation re-enters** | a labelled `# WORK SO FAR` block, `action:` / `observation:` pairs (`src/core/engine/Engine.js:110-117`) — nobody's voice | it does not, automatically. A human clicks a button and the terminal output is posted as a **user message** (`bolt.diy/app/components/chat/ChatAlert.tsx`) | as a **user turn**: `hist_add_tool_result` → `hist_add_message(False, …)` where `False` is the `ai` flag (`az_agent.py:785`, `:808`) | on the provider's tool channel, paired by `tool_call_id`. **Not re-verified here** — `grep -n "ToolMessage\|tool_call_id" oswe_server.py` finds nothing in the extract on disk; the claim is `docs/REFERENCE-PROMPTS.md`'s, from `agent/middleware/tool_error_handler.py`, which was not extracted | as **provider text** — the `ACTION_STATE` provider renders results into the next planner prompt |
| **what ends the loop** | the parsed `act` is not `tool` (`ReActEngine.js:70`). No ceiling, no cancel (`CAPABILITIES.md:180-181`, both `absent`). In practice the terminator is a **parser fallback**: an unreadable reply becomes an answer (`BaseResponse.js:170`) | nothing loops. One assistant turn per user turn; `MAX_RESPONSE_SEGMENTS = 2` (`bolt.diy/app/lib/.server/llm/constants.ts:47`) | the model calls the `response` tool; backstopped by *N* consecutive **unusable** replies, not by a step count (`agent-zero/extensions/python/_functions/agent/Agent/hist_add_warning/end/_90_stop_unusable_response_loop.py`, `prompts/fw.msg_unusable_response_limit.md`) | a turn with no tool call, stated as a rule (`oswe_prompt.py:113`); backstopped by `ModelCallLimitMiddleware(run_limit=MODEL_CALL_RECURSION_LIMIT, exit_behavior="end")` (`oswe_server.py:1800`; the constant's value is in `runtime/constants.py`, not on disk here) | a terminal `REPLY`/`IGNORE`/`STOP` or `completed=true`; backstopped by `maxToolCalls` (16 chat / 32 coding, `eliza2/packages/core/src/runtime/planner-loop.ts:340,358`) and a required-tool miss budget |
| **cacheable prefix** | **914 cl100k / 953 Qwen of a 1,000-token prompt = 91%**, explicit breakpoint at char 3,852 (`AnthropicCompatible.js:121-129`) — **and below the 1,024-token minimum on every Claude model except the Opus-5 family** | **~0% by construction.** The volatile file context is appended *to the system message*, ahead of the turns (`stream-text.ts:166-173`), so the first differing byte is inside the system message. Bought back by slicing the transcript instead | **high.** `[SystemMessage(system_text), *history_langchain]` where the history list is `protocol + history_output + extras` — the volatile datetime block goes **after** the whole history (`az_agent.py:601-609`). Same conclusion as ours, reached independently | **defends the byte prefix as policy** and sets no explicit breakpoint (`grep -n "cache_control" oswe_prompt.py oswe_server.py` → no matches); a middleware re-sorts parallel tool results into call order so a swapped pair cannot invalidate the tail | **per-provider reuse policy**: `cacheStable: false` / `cacheScope` declared on the provider (`eliza2/plugins/plugin-computeruse/src/providers/scene.ts:38`, `computer-state.ts:29`) |

Three things fall out of the table.

**We are the smallest prompt by a factor of four to seven, and we spend the
largest share of it on format.** 42% against agent-zero's 7.5%, Open SWE's zero
and eliza's one line. bolt.diy's 36% is the only comparable figure, and it is not
really comparable: bolt's `<boltArtifact>` rules are simultaneously its response
contract *and* its entire tool interface, so the same tokens do two jobs. Ours do
one.

**Two of the four references pay nothing for a contract because the provider
enforces the format.** That is the whole explanation for the gap. Our 414 tokens
are the price of supporting a model with no function-calling API — which, for a
browser agent whose user may point it at anything with a `/v1/chat/completions`
endpoint, is a real requirement and not an oversight. The question the rest of
this document asks is not whether to pay it but whether 414 is the price.

**Our ordering is the best of the five and the one nobody notices.** bolt.diy
puts volatile content ahead of the transcript and forfeits the prefix; we and
agent-zero both put it after, and arrived there separately. The cost of that
decision is one line in `Engine.blocks` (`Engine.js:118-124`) and it is worth
more than every cut proposed below — which is exactly why the caching finding
above matters: the ordering is right and the threshold makes it moot.

---

## Where our tokens go and what they buy

### `instructions` — 164 tokens today, 253 as audited, static, `agents/main/agent.md:16-30`

What it buys: the one thing only the author knows. That the page has no server;
that the sandbox is an emulator ~100× slower than a real machine and should be
asked one focused question. Both are environment context the model cannot
derive, which `shared/prompt-audit.md`'s keep list #1 protects absolutely:
*"Context is never cruft."*

This block used to say three more things, and they were cut when this audit's
own rule was turned on the block itself: *"there is no network"*, *"search and
then fetch the page that looked right"* and *"do not use it for work you can
simply do yourself"*. None was a second fact — the tool table restates the first
two roughly 300 characters below (`ShellTool.js:25`, `SearchTool.js:54`) and the
third is a special case of the retained line at `agent.md:25`. Measured on the
two-step dry run: 200 → 164 tokens for this block, 750 → 714 and 804 → 768 for
the two prompts. The ~100× sentence was deliberately NOT moved into `ShellTool`'s
description — see `docs/TESTBED.md` thumb 13, and `ShellTool.js:14-17`, which
says in as many words that where the command runs is not that tool's business.

The two sentences that are not context are the two that would go:
*"Answer the question that was asked. Prefer a short, complete reply over a long,
hedged one"* and *"When you do not know something, say so plainly rather than
guessing in a confident tone"* — restatements of trained defaults, Group 1d
identity-stub territory. They cost about 35 tokens. They are also the only place
this agent's register is set, and the same standard warns that a too-short prompt
produces generic output. **Cheaper alternative: none. Leave it.**

### `tools` — 302 tokens, static, `Toolbox.render` + three `Tool.render`

The standard is explicit that this block is where a trim instinct points the
wrong way: *"The rubric for tool descriptions is precision and contract accuracy,
not brevity… the most common failure is under-description"*
(`shared/prompt-audit.md` Group 3). Our `shell` description names the shell, the
available tools, the absence of network, the clean filesystem between calls, the
consequence for multi-step work, and the 1,024-byte limit. That is a man page,
and it is correct.

The one line in this block that is neither contract nor mechanics is
`Toolbox.js:38` — *"Call a tool by writing it in the result field, exactly as
shown"* — which is a **response-format** rule living in the tools block. It is
7 tokens and it is in the right place semantically (it is where the model is
looking when it needs it), so this is a note, not a finding.

### `contract` — 463 tokens as audited, 243 today, static, `BaseResponse.instructions`

It also called a per-subclass `ReActResponse.formatNotes` hook; that was deleted
with the cut, and every line number in this section is an anchor into the
463-token version. See the note at the top of this file.

52% of the prompt as the brief measured it, 42% as it now stands. This is the
block with a parser behind it, so every rule can be checked against the code that
already enforces it. Priced individually with `estimateTokens`:

| piece | tokens | source |
|---|---:|---|
| header line, *"Reply with exactly these fields, in this order: …"* | 25 | `BaseResponse.js:97` |
| the four field descriptions | 162 | `ReActResponse.js:8-28` |
| the six numbered rules | 125 | `BaseResponse.js:101-107` |
| the `Example:` block | 55 | `BaseResponse.js:86-92`, `:109` |
| *"The 'act' field is a single word…"* | 29 | `ReActResponse.js:55` |
| `CORRECT (final reply):` block | 32 | `ReActResponse.js:57-62` |
| `WRONG (never do this):` block | 33 | `ReActResponse.js:64-69` |

#### Rules whose violation is already repaired in code

| # | the rule, verbatim | the repair | verdict |
|---|---|---|---|
| 1 | *"Start each field on its own line as `field_name: value`, lowercase name."* | `_parseToon` lowercases the key: `.toLowerCase()`, `BaseResponse.js:214` | **repaired.** 20 tokens |
| 2 | *"Separate fields with a blank line."* | none needed. `_parseToon` (`:224-231`) takes every line up to the *next field line*; blank lines are not read at all | **enforces nothing and prevents nothing.** 9 tokens |
| 3 | *"A multi-line value just continues on the next lines — do not repeat the field name."* | **not repaired.** `:229` `data[name] = …` — a repeated field name silently overwrites the earlier value | **keep.** The only rule of the six carrying real weight |
| 4 | *"List fields use bracket notation… Use `[]` when there are none."* | `_asList` (`:254-262`) accepts brackets, one-item-per-line, `- ` bullets and `1.` numbering; `_parseJson` (`:188`) coerces a string list field | **repaired.** 30 tokens |
| 5 | *"No markdown decoration on field names: no `**`, no `-`, no numbering."* | `:211-212` strip `^[\s\-*#\d.]+` and `[*\`\s]+$`; `:219` strips the orphaned `**` off the value. There is a test for it (`ReActResponse.test.js:146-153`) | **repaired.** The regex was written for exactly this sentence. 23 tokens |
| 6 | *"Use no field names other than the ones listed above."* | `:215` `if (!known.has(cleaned)) continue` | **repaired.** 13 tokens |

Rules 1, 4, 5 and 6 are 89 tokens paid on every call to prevent four failures the
parser handles without complaint. Rule 2 is 9 tokens for a failure that does not
exist. That is the `shared/prompt-audit.md` Group 1d row exactly: *"Enforce in
code what can be enforced in code; delete what nothing enforces."*

**That reasoning is right about three of the four and wrong about one, and the
experiment below is what says which.** Rules 1, 5 and 6 have a measured 0/48
violation rate including in the arm that never states them. Rule 4 does not: an
arm that dropped it produced four bulleted lists in sixteen replies. A repair
existing does not mean the rule is free to delete — it means the *failure* is
invisible, which is a different thing and a worse one for auditing by reading.

#### The `act` rule, stated three times, repaired once

The same instruction appears in three places:

1. `ReActResponse.js:22` — *"Never write a tool name here — 'act: echo' is always wrong."*
2. `ReActResponse.js:55` — *"The 'act' field is a single word — 'tool' or 'answer' — never a tool name and never a call."*
3. `ReActResponse.js:64-69` — the `WRONG (never do this):` block, whose body is literally `act: echo({"text": "hello"})`.

`normalize()` (`ReActResponse.js:35-51`) repairs all three cases: it strips
quotes, backticks and asterisks, lowercases, and — if `act` contains `(` or `{` —
moves the call into `result` and sets `act` to `tool`. There are five tests for
it (`ReActResponse.test.js:21-69`).

This is the counter-example the standard names twice: Group 1c, *"a prohibition
against a failure the model wasn't going to make can anchor it toward that
failure"*, and Group 1c on repetition, *"duplicated rules make the model spend
effort reconciling wordings"*. **Which of these rules exists because a model
actually got it wrong?** The provenance is in the code and it is real —
`ReActResponse.js:31-33` says *"Models routinely write the call itself into `act`
and leave `result` empty"*, and `ReActResponse.test.js:29-30` calls it *"the one
the engine depends on: models write the call where the verb belongs more often
than they get it right."* So the **failure is documented**. What is not
documented is why it needs three statements *and* a repair. Under Group 1e the
first statement has provenance and stays; statements two and three are the same
provenance spent twice more.

The test itself argues the wrong way round and pins the block in place:

> `test/core/response/ReActResponse.test.js:164-167` — *"The one mistake worth
> spending prompt tokens on, because it is the one `normalize` exists to
> repair."* `expect(instructions).toContain('act: echo({"text": "hello"})')`

A repair existing is a reason to spend *fewer* prompt tokens on the case, not
more. Any cut here has to change that test, which is the correct amount of
friction.

#### The field order: stated three times, enforced nowhere

*"in this order: think, plan, act, result"* appears at `BaseResponse.js:97`, is
demonstrated by the `Example:` block at `:109`, and is restated by
`reminder()` at `:131`. `_parseToon` records fields **in the order they appear**
(`:220`) and the constructor fills from `FIELDS` declaration order (`:29-33`), so
a reply that writes `result` before `think` parses identically. Order is a
requirement of nothing. This is not a proposed cut — the reminder is protected by
keep-list #10 (*"a single end-of-prompt restatement of the few key constraints is
a known, reasonable pattern"*) and the header costs 25 tokens for the field names
it must state anyway. It is named because a document that lists what the prompt
demands should say which demands are real.

#### Repairs with no matching rule — rules we forgot to write

Four, and the first is the dangerous one.

1. **An unrecognised `act` silently becomes `answer`.** `ReActResponse.js:48-49`:
   if `act` is neither `tool` nor `answer` and contains no bracket, `act =
   ACT_ANSWER`. So `act: use_tool` or `act: shell` ends the run, and whatever is
   in `result` — which may be a tool call the model intended to make — is shown
   to the user as the final reply. The test at `:55-64` documents this and calls
   it *"what stops a run that could otherwise never terminate"*. Nothing in the
   prompt tells the model that an unrecognised verb ends the turn, and nothing in
   the transcript tells the user it happened. **This is a rule we forgot to
   write, and it is also a missing observation.**
2. **An unparseable reply becomes the answer.** `BaseResponse.js:170` puts the
   whole raw text into the answer field; `ReActEngine.js:70` then ends the run
   (`last.isAnswer !== false`). Combined with (1), **the loop's only reliable
   terminator is a parse failure.** `CAPABILITIES.md:180` scores "Bound it" as
   `absent`; this is what fills the gap, by accident.
3. **Either format is accepted.** `parse` tries TOON and then JSON
   (`BaseResponse.js:242`), with a test proving a fenced JSON reply is read
   (`ReActResponse.test.js:120`). The contract says *"Reply with exactly these
   fields"* in TOON and never mentions that JSON also works. This is now settled
   in the direction of keeping the fallback and saying nothing: the `Format` enum
   that let a file ask for the JSON contract was deleted — no run ever chose it —
   so JSON is a REPAIR the parser performs, not a form the prompt offers. The
   argument for withholding the permission is in `BaseResponse.parse`'s own
   comment, and it is reasoning rather than measurement.
4. **List items may be bullets or numbers.** `_asList:261` strips `- `, `* `,
   `1.` and `1)` from each item. Rule 5 forbids markdown decoration on field
   *names*; nothing says anything about items. Harmless, and it shows the pattern:
   the parser is consistently more permissive than the prompt.

There is one place this tree already does the right thing, and it should be the
model for the rest: `Toolbox.runOne` returns *"the arguments were not valid JSON
(…). Write them as `{"key": "value"}`"* (`Toolbox.js:119`) and *"there is no tool
called X. Available: …"* (`:112`). **Those are contract rules delivered as
observations — paid only by the turn that broke them, and stated at the moment
the model can act on them.** That is strictly better than a prefix rule, and it
is the cheapest available replacement for rules 1–6.

### `reminder` — 23 tokens, static, `tail`

Justified in `PromptTemplate.js:66-80` by "lost in the middle" (S2), which does
not reach a 1,092-token prompt. Justified independently by
`shared/prompt-audit.md` keep-list #10, which does. **Keep**, on the second
reason rather than the first, and fix the comment.

### `cue` — 6 tokens, `[ASSISTANT]:`, `Engine.js:5`

A text-completion idiom in a chat-completions request. Harmless at 6 tokens. Not
a finding.

### `context` — 19 tokens, volatile

One fact. Its own section, below.

---

## The context block is empty

`# CONTEXT` contains `now: Tuesday, 1 September 2026 at 09:00 (UTC)` and nothing
else, by an explicit decision documented at `src/core/agent/Environment.js:1-29`:
*"The bar a fact has to clear: it must change an answer."* Locale, agent name,
platform, realm and storage durability were each tried and removed. That
reasoning is good and the bar is the right bar. **For an agent whose job is
writing software, several facts clear it and are not there.**

The structural point first, because it decides everything else: `context` is
rendered **after** `conversation` and `scratchpad` (`Engine.js:118-124`,
`PromptTemplate.js:104`). A volatile block in that position costs its own length
and nothing else — it cannot push the transcript out of a shared prefix, because
the prefix already ended. bolt.diy makes the opposite choice and appends its file
context to the *system message* ahead of the turns
(`stream-text.ts:166-173`), which costs it the whole prompt every request. **We
have already paid for the right to have a rich context block and are not using
it.** Everything below is priced at its own length, once, per call.

Measured on this repository, `2026-09-01`:

| candidate | how it was produced | ours | cl100k | volatility | earns it? |
|---|---|---:|---:|---|---|
| working directory + branch | 2 lines | 16 | 19 | static | **yes.** Costs nothing and every path in every later tool call depends on it. Open SWE puts `working_dir` in the first section of its system prompt (`oswe_prompt.py:550-607`) |
| directory skeleton | `find src -type d` | 36 | 54 | append | **yes.** 36 tokens buys "where does a new file go", which is otherwise a `shell` round trip at ~100× native |
| full file list | `git ls-files 'src/**' 'test/**' 'agents/**'` (72 files) | 760 | 690 | append | **no, not yet.** 63% of a whole current prompt, and agent-zero's own version (`{{file_structure}}`, `agent.extras.workdir_structure.md`) is depth-limited and gitignore-filtered for exactly this reason. Earns it only when the alternative is repeated `ls` calls, which the sandbox makes expensive — measure it, do not assume it |
| the open file | `src/core/response/ReActResponse.js`, 80 lines | 696 | 586 | volatile | **conditionally.** bolt.diy ships every selected file verbatim on every turn (`createFilesContext`, `bolt.diy/app/lib/.server/llm/utils.ts`) and pays for it by throwing the transcript away. One file, when the user has one open, is the version of that idea we can afford |
| last diff, one file | `git diff src/core/tools/index.js` | 359 | 316 | volatile | **yes, when there is one.** This is the fact most likely to change an answer for a critique-and-improve loop, and it is unobtainable any other way — there is no VCS in the sandbox |
| `git diff --stat` | | 97 | 55 | volatile | **yes** as the cheap always-on form; the full diff is the opt-in |
| test result, summary line | `bun test 2>&1 \| tail -3` | 21 | 26 | volatile | **yes, unambiguously.** 21 tokens for the single fact that decides whether the loop is finished. Nothing else in this table has a better ratio |
| test result, last 20 lines | `bun test 2>&1 \| tail -20` | 172 | 167 | volatile | **yes when red, no when green.** A passing run needs the count; a failing run needs the failure |

**What should be there, in order of tokens-per-decision:** the test result summary
(21), the working directory and branch (16), `git diff --stat` (97), the directory
skeleton (36). That is 170 tokens — a 16% increase on the current prompt — and it
turns the block from a clock into a working set. The open file (696) and the full
diff (359) are opt-in, attached when the user has actually opened or changed
something, in the same spirit as elizaOS's `dynamic: true` providers, of which
seventeen of its twenty-two are opt-in per call.

**What should not be there:** the full file list, until somebody measures the
`shell` calls it replaces. None of the four references ships an unfiltered one.

**What none of them has, and neither should we:** a token countdown.
`shared/prompt-audit.md` Group 4 — *"surfacing remaining-token counts to the model
can cause premature wrap-up behavior"*.

The blocker is not the prompt. Every fact in that table needs a filesystem that
survives between calls, and `CAPABILITIES.md` scores that row `unverified`. The
context block is empty partly by policy and mostly because there is nothing yet
to put in it.

---

## Eight changes, ranked

Ranked by tokens saved per unit of risk, with the risks now measured rather than
guessed — **every risk line below cites the compliance run in the next section,
which was run before this list was written.** Deltas are `estimateTokens` over
the exact strings. This is not the ranking I drafted before running it: change 5
was originally "delete rule 4", and the measurement reversed it.

**1. Delete contract rules 5 and 6.**
`src/core/response/BaseResponse.js:106-107`; the repairs are at `:211-219` and `:215`.
−36 tokens/call, measured.
Risk: the lowest here and close to zero — 0 violations in 48 replies across all three arms, *including* the `minimal` arm that states neither, and both failures are repaired silently in the parser if they ever occur.

**2. Delete contract rules 1 and 2.**
`src/core/response/BaseResponse.js:102-103`; rule 1's repair is `.toLowerCase()` at `:214`, and rule 2 has nothing to repair because `_parseToon:224-231` never reads blank lines.
−29 tokens/call, measured.
Risk: near zero, with one asterisk — the single `r1_lowercase` violation in the whole run came from the `trimmed` arm, which kept a *shortened* rule 1, so it is evidence about that shortening and not about deletion; and blank lines are what make a reply legible to the human watching the prompt panel.

**3. Delete the `WRONG (never do this):` block and the standalone act-rule line.**
`src/core/response/ReActResponse.js:64-69` and `:55`; the test that pins them is `test/core/response/ReActResponse.test.js:164-167`; `normalize():35-51` is the repair; `FIELDS.act:22` keeps the rule stated once.
−62 tokens/call, measured — the largest single saving in the contract.
Risk: low but not nil. Both arms with 0 `act_single_word` violations differ from `trimmed` in more than one way, so the safe inference is that *one terse statement suffices*, not that any single statement suffices; if this ships, shorten `FIELDS.act:22` toward `minimal`'s wording rather than leaving the long one alone.

**4. Delete the `CORRECT (final reply):` block.**
`src/core/response/ReActResponse.js:57-62`; the `Example:` block at `BaseResponse.js:86-92, :109` already pins the field shape.
−32 tokens/call, measured.
Risk: moderate, and the keep list objects — `shared/prompt-audit.md` protects "format-pinning examples on genuinely format-sensitive outputs", and this is the only place a *complete two-field answer turn* is shown; `minimal` has no example block at all and scored 94%, which is the evidence in favour, at n=16.

**5. Move rule 4's bracket notation into the two list field descriptions and delete the standalone rule.**
`src/core/response/BaseResponse.js:105` out; `ReActResponse.js:9-18` gains `` `[a, b]` or `[]` `` the way `minimal` states it.
−24 tokens/call, measured (30 out, ~6 in).
Risk: the only demonstrated regression in the whole experiment — deleting this rule without replacing it produced 4 bulleted lists in 16 replies (p = 0.101), all of them repaired by `_asList:261` and none of them visible in a transcript; re-run `bun score.js` after the edit rather than assuming the inline form carries.

**6. Say what an unrecognised `act` did.**
`src/core/response/ReActResponse.js:48-49` sets `act = answer` for any unrecognised verb and `ReActEngine.js:70` then ends the run; the observation belongs beside `Toolbox.js:112,119`, which already does exactly this for tool arguments.
+0 tokens in the prefix, ~15 tokens on the affected turn only.
Risk: none to cost, and it is the only change here making a correctness claim — today a run that ends this way is indistinguishable from one that finished, `CAPABILITIES.md:180-181` scores the loop `absent` on both bounding and cancelling, and this parse fallback is currently the loop's most reliable terminator.

**7. Put the test-result summary, the working directory and `git diff --stat` in `# CONTEXT`.**
`src/core/agent/Environment.js:60`, one pair per fact; nothing else moves, because `context` already renders after the transcript (`Engine.js:118-124`, `PromptTemplate.js:103`).
**+134 tokens/call**, measured on this repository (21 + 16 + 97). A cost, listed because the audit found the block empty.
Risk: two of the three are volatile and re-sent forever, and a stale test result is worse than no test result — which makes this change entirely dependent on the persistence spike `CAPABILITIES.md` §5 names as next.

**8. Settle whether the prefix caches at all, before changes 1–5 ship.**
`src/core/prompt/PromptTemplate.js:164-240`, `src/core/inference/AnthropicCompatible.js:121-129`, and the display at `src/app/page.jsx:648`.
Changes 1–5 remove **183 tokens**, taking the contract from 463 to 280 and the reusable prefix from 1,018 to ~835 by our estimator (~750 cl100k) — *further below* the 1,024-token minimum that Sonnet 5, Opus 4.8 and Sonnet 4.6 require.
Risk: `unmeasured`, and it is the direction of the whole document. Nobody here has ever observed a non-zero `cache_read_input_tokens` from a real Anthropic endpoint; if the threshold bites, the right change is to *lengthen* the prefix, and every saving above is a loss.

## What must be measured before any of this ships

The prompt is half of it. The other half is whether the model still complies
once you cut, and a token saving bought with a compliance failure is not a
saving — it is a round trip on a sandbox that runs at roughly a hundred times
native.

### The experiment, as run

**Design.** Same tasks, same model, contract before and after. Three variants
differing in the `contract` block and **in nothing else** — same instructions,
same tools, same reminder, same cue, byte-identical elsewhere:

| variant | contract | whole first-turn prompt | what it removes |
|---|---:|---:|---|
| `full` | 463 tok / 1,532 ch | 893 | nothing — what ships |
| `trimmed` | 285 tok / 1,000 ch | 715 (−20%) | rules 1, 4, 5, 6; the act-line note; the `CORRECT` and `WRONG` blocks (= changes 1–4) |
| `minimal` | 131 tok / 374 ch | 561 (−37%) | everything except the field table — the floor |

**State.** The variants were built before `search` and `fetch` landed, so the
`full` variant here is the 893-token one-tool prompt (sha256 `6c32302b7da6`), not
the 1,092-token three-tool prompt measured above. The `contract` block is
byte-identical in both, which is what this experiment varies; the two extra tools
change the denominator, not the thing under test.

**Model.** `Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp` at
`http://127.0.0.1:8873/v1/chat/completions`, `temperature: 0.7`, `seed: 1000`,
`max_tokens: 450`. 16 tasks (`scratchpad/audit/tasks.json`) mixing tool-needing
and answer-only work, two of them carrying a pre-filled scratchpad so the
multi-step shape is exercised.

**Scoring.** Ten named checks, one per contract rule, so the result says *which*
rule the model breaks rather than "did it parse" — the whole point being that
`ReActResponse.parse` repairs almost everything and would report 100% either way:
`all_fields`, `order`, `r1_lowercase`, `r3_no_repeat`, `r4_brackets`,
`r5_no_markup`, `r6_no_extra`, `act_single_word`, `no_fence`,
`tool_call_wellformed`. Plus **after-repair usability**: does
`ReActResponse.parse` yield an `act` the loop can read and a non-empty `result`.

**Reproduce it:**

```
cd <scratchpad>/audit
bun variants.js          # builds prompts.json from the real AgentCatalogue
SAMPLES=1 bun run.js     # 48 calls, max_tokens 450  -> replies.json
bun redo.js              # re-runs whatever hit the cap at 1500 -> replies2.json
bun score.js             # ten named checks per reply, per variant
bun peek.js / bun bad.js # the individual violations, and the one unusable reply
```

### Results

Two runs. The first capped output at 450 tokens and **nine of 48 replies hit the
cap**, emitting an unstructured preamble and getting truncated before any field —
a harness artifact, not a compliance failure. Those nine were re-run at
`max_tokens: 1500` (`redo.js`). One still did not finish (`trimmed/t06`, 1,500
completion tokens of deliberation about the BusyBox `sort` man page, no fields at
all) and is scored as a failure in both columns; whether it would finish with
more room is `not established`. The first run's numbers are discarded and named
here so nobody re-derives them.

| variant | contract | prompt tokens (measured `usage.prompt_tokens`) | mean completion | strict-clean | usable after `parse` |
|---|---:|---:|---:|---:|---:|
| `full` | 463 | 899 | 319 | **14/16 = 88%** | **16/16 = 100%** |
| `trimmed` | 285 | 745 (−154, −17%) | 325 | **10/16 = 63%** | **15/16 = 94%** |
| `minimal` | 131 | 599 (−300, −33%) | 286 | **15/16 = 94%** | **16/16 = 100%** |

Violations by check, out of 16 replies per arm:

| check | rule it comes from | `full` | `trimmed` | `minimal` |
|---|---|---:|---:|---:|
| `all_fields` | header line | 1 | 1 | 0 |
| `order` | header line, `Example`, reminder | 1 | 1 | 0 |
| `r1_lowercase` | rule 1 | 0 | 1 | 0 |
| `r3_no_repeat` | rule 3 | **0** | **0** | **0** |
| `r4_brackets` | rule 4 | 0 | **4** | 0 |
| `r5_no_markup` | rule 5 | **0** | **0** | **0** |
| `r6_no_extra` | rule 6 | **0** | **0** | **0** |
| `act_single_word` | field doc + act line + `WRONG` | 0 | 2 | 0 |
| `no_fence` | not stated for TOON | 1 | 3 | 1 |
| `tool_call_wellformed` | `result` field doc | 0 | 1 | 0 |

**Six findings, in descending order of how much weight they carry.**

**1. Rules 3, 5 and 6 have a zero violation rate in every arm, including the arm
that never states them.** 0 of 48. Zero has no variance to hide in: the `minimal`
prompt contains no rule about markdown decoration on field names and no rule
about extra fields, and across sixteen replies the model produced neither
failure. Those two rules are 36 tokens on every call for nothing. Rule 3 is the
same measurement with a different implication — see finding 5.

**2. Rule 4 is load-bearing, and it costs a sixth of what we pay for it.**
`trimmed` deleted rule 4 outright and produced **four** bulleted `think:` /
`plan:` blocks (`trimmed/t01`, `t05`, and two others) — exactly the failure the
rule names, and exactly the failure `_asList:261` repairs. `minimal` never states
rule 4 either, but folds the notation into the field description itself
(*"your reasoning, `[a, b]` or `[]`"*, ~6 tokens) and produced **zero**. The
30-token standalone rule is not what buys compliance; six tokens in the right
place is. **This is the change I had proposed and it was wrong**, and the
experiment is the only reason that is known. (Fisher exact, 16/16 vs 12/16:
p = 0.101 — suggestive, not conclusive, and mechanistically explained, which is
why it is acted on.)

**3. Nothing supports the `WRONG (never do this):` block.** `full` states the
`act` rule three times *and* shows the counter-example: 0/16 violations.
`minimal` states it once, tersely, with no counter-example and no example block
at all: 0/16. `trimmed` states it once at full length and drops the
counter-example: 2/16. Whatever is producing the two failures, it is not the
absence of the counter-example, because the arm with the least warning has none.
This is consistent with S3 — *"a prohibition against a failure the model wasn't
going to make can anchor it toward that failure"* — and is not strong enough to
claim the counter-example causes harm. It is strong enough to say it buys
nothing measurable.

**4. Compliance is not monotonic in contract size, and the ordering is backwards
from the intuition.** `minimal` (131 contract tokens) scored 94% strict-clean
against `full`'s 88% and `trimmed`'s 63%. A denser, shorter field table
outperformed a longer one with a `Rules:` section. None of the aggregate
differences is statistically distinguishable at this N — Fisher exact, `full` vs
`minimal` p = 1.000, `full` vs `trimmed` p = 0.220, `minimal` vs `trimmed`
p = 0.083 — so the correct claim is the negative one: **across a 3.5× range of
contract length there is no evidence that a longer contract produces better
compliance, and the point estimate runs the other way.**

**5. Rule 3 was the one rule with a zero violation rate that should probably
stay — and that is now settled by writing the repair first.** It was the only
one of the six the parser did not repair: a repeated field name overwrote, so
the earlier value vanished with nothing raised anywhere. Its measured rate was
0/48, an argument for deleting it; its failure mode was silent data loss, an
argument for a repair before the deletion. The repair was written —
`BaseResponse.js:391-398` concatenates a repeated field instead of overwriting
it — and the rule came out of the prompt after it, not before.

**6. The contract does not control the preamble, at any size.** Mean completion
was 319 / 325 / 286 tokens across the three arms and the worst case was 1,500 —
a model writing a page of unstructured deliberation before any field, in the
`trimmed` arm, on a task that wanted one `shell` call. `full/t06` needed 1,112
completion tokens for the same question. Nothing in any variant addresses this,
and output tokens cost more than input tokens everywhere. **The largest available
saving in this prompt is not in the prompt.**


### What this experiment does not settle, and what would

- **The preamble, which is bigger than anything cut here.** One reply spent
  1,500 output tokens deliberating before emitting a field, and never emitted
  one. Nothing in any of the three contracts addresses that, and no cut proposed
  in this document would have changed it.
- **One model, one family.** Qwen is not Claude and is not GPT. The contract
  exists to serve models with no function-calling API; the compliance of the
  models people will actually point this at is `not established`. The same
  harness runs against any OpenAI-compatible endpoint by changing one string.
- **N is small enough that only the zeros are safe.** 16 tasks × 1 sample per
  arm. Fisher exact on the aggregate: `full` vs `minimal` p = 1.000, `full` vs
  `trimmed` p = 0.220, `minimal` vs `trimmed` p = 0.083 — **even the 25-point
  gap between 88% and 63% is not significant here.** What survives is the
  per-check zeros (a rule omitted in one arm and violated by nobody in any arm)
  and the one localised, mechanistically explained effect (rule 4, p = 0.101).
  Raise `SAMPLES` to 5 and re-run before believing any aggregate ordering,
  including the one that flatters `minimal`.
- **Cost per completed task is not measured, and it is the outcome that
  matters.** A contract that saves 154 prompt tokens and costs one extra round
  trip on 5% of turns is a loss, because a turn is ~900 prompt tokens. Worse,
  the measured mean *completion* was 319 / 325 / 286 tokens — output, which is
  priced several times higher than input everywhere — so the arm that saved 300
  input tokens also saved 33 output tokens, and neither number was the one the
  experiment was designed to see. The next experiment is the same tasks driven
  through the real `ReActEngine` loop to a correct answer, scored on total
  tokens and on round trips, not on first-reply compliance.
- **The caching threshold is untested.** Every claim in this document about
  what does and does not cache comes from a documented minimum
  (`shared/prompt-caching.md:129-140`), not from an observed
  `cache_read_input_tokens`. **The one experiment that must happen before
  changes 1–4 ship:** one Anthropic key, two identical requests thirty seconds
  apart on `claude-sonnet-5` and on `claude-opus-5`, and read
  `usage.cache_read_input_tokens` on the second. If it is zero on Sonnet 5 and
  non-zero on Opus 5, the threshold is real and cutting the contract makes the
  prefix permanently uncacheable on the larger half of the model table. If it is
  non-zero on both, this document's largest finding is wrong and should be
  struck.
