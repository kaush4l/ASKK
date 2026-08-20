# CORE-ELEMENTS — the elements inside the core, researched

> Closes `tracker.md` **T6**. Brief: "even inside the core, every element needs to be
> researched" — typed tool calling, JSON vs TOON, prompt and context engineering, coupling
> to nothing, and what a current browser gives us. Retrieval date for every source:
> **2026-08-20**. Code read at `main` 65e0e56; no file outside this one was touched. §5 additionally
> rests on an independent browser-platform sweep cross-checked against vendor release notes,
> WHATWG/W3C specs, `mdn/browser-compat-data` on `main`, and WebKit/Chromium engine source.
>
> **The ground moved mid-research.** T1 (stage briefs out of Rust) landed in the working tree
> while §§1–2 were being written: the brief *prose* now lives in `public/stages/*.md`, fetched
> at boot, refused loudly as a set, and `crates/agent/src/brief.rs` keeps only what was never
> prose. §3 is written against the new shape. Nothing in it changes as a result except for the
> better — item 1 of §3's ruling used to mean "delete a `const &str`" and now means "delete a
> data file", which is a smaller change than it was this morning.

**How to read this.** A number I saw with my own eyes in a source is a **fact** and carries the
URL it came from. A number a vendor reports about its own product is a **claim** and is
attributed to the party that measured it. Anything I could not confirm is marked
**UNVERIFIED** and is not used to support a ruling. Each section ends with a **RULING** — one
paragraph an architecture lead can hand to a coding agent unchanged.

**The bias I brought and had to correct.** I expected to find that our text-as-tools decision
was a legacy of the Python port and that the field had moved past it. Sections 1 and 2 are
the opposite result: the 2026 literature is now *against* the thing we were tempted to adopt,
and the decision on record is better than the one that would have replaced it. That is a
result, and it is written up as one.

---

## 1. Typed tool calling

### 1.1 What this build actually does, in the code

One `Tool` is a **descriptor and nothing else** — `crates/agent/src/tools.rs:27-39`:

```rust
pub struct Tool { name: String, description: String, usage_args: String, agent: bool }
```

`Tool::new(name, description, &["path", "contents"])` (`tools.rs:44-52`) formats the argument
NAMES into a string `{"path": "<path>", "contents": "<contents>"}` and **discards the list**.
`usage()` (`tools.rs:68-70`) renders one line: `name({...}): description`. `Toolbox::usages()`
(`toolbox.rs`) collects them, `Affordances` (`components/affordances.rs:75-83`) prints them
under `AVAILABLE TOOLS` followed by the constant `HOW_TO_CALL` (`affordances.rs:42-45`), which
states the layout rule: same line = parallel, new line = sequential.

The model replies in prose. `calls::parse_batches` (`crates/agent/src/calls.rs:19-30`) scans
the reply for `ident({…})`, groups by the newlines *between* calls, and returns
`Vec<Vec<Call>>`. `scan_object` (`calls.rs:147-168`) is string- and nesting-aware, so a nested
JSON argument — the shape a real MCP tool sends — parses rather than being refused.
`Call.args_error` is a typed field, so "arguments I could not read" is structurally distinct
from "no arguments" (`calls.rs:8-13`); that distinction was found by test in the Python and it
is why a sub-agent never receives an empty goal.

Two things already exist that the brief did not assume:

1. **We already ingest native tool calls.** `context::openai::openai_reply_text`
   (`crates/context/src/openai.rs:91-116`) falls back to `native_calls` when `message.content`
   is empty: a provider's `tool_calls` array is rendered **down into our one text syntax**,
   one call per line, with the provider's namespace prefix stripped (`openai.rs:120-141`).
   Nothing downstream learns a second call syntax. This is a real seam and it cost 22 lines.
2. **We never SEND a `tools` array.** `openai_request_body` (`openai.rs:53-86`) writes
   `{model, stream, messages, temperature?}` and no `tools` key. So the ingest path above only
   catches servers that volunteer `tool_calls` from prose affordances (the file names omlx).
   Every hosted provider whose tool-calling is *conditioned on* a declared `tools` array — that
   is all of them: OpenAI, Anthropic, Gemini — will never emit one to us.

### 1.2 What the field does now

- **MCP.** The current spec revision is **2026-07-28**, "the largest revision of the protocol
  since launch" (https://blog.modelcontextprotocol.io/posts/2026-07-28/). A Tool is
  `{name, title?, description, inputSchema, outputSchema?, annotations?}`; `inputSchema` **is
  JSON Schema** and in 2026-07-28 is lifted to full **JSON Schema 2020-12** with composition
  (`oneOf`/`anyOf`/`allOf`), conditionals and `$ref`/`$defs`, still rooted at `type: "object"`
  (spec text at https://modelcontextprotocol.io/specification/2026-07-28/server/tools; the
  2025-06-18 field list I read verbatim at the same path with the older date). Results are
  `content[]` (text/image/audio/resource_link/resource) plus optional `structuredContent`, and
  errors come back **two ways**: JSON-RPC protocol errors for unknown-tool/invalid-arguments,
  and `isError: true` inside a normal result for execution failures. There is no non-JSON-Schema
  alternative in MCP.
- **Native function calling** on the wire is now universal among hosted providers, and
  **constrained/grammar decoding** is available locally: llama.cpp compiles JSON Schema to GBNF
  (`json_schema_to_grammar.py`), LM Studio accepts OpenAI `response_format`
  (https://lmstudio.ai/docs/developer/openai-compat/structured-output). Support over the
  OpenAI-compatible HTTP surface is still uneven — llama.cpp has a long tail of issues where
  `response_format: json_object` works and `json_schema` does not
  (https://github.com/ggml-org/llama.cpp/issues/10732, /11847), and where `json_schema` and
  `grammar` are mutually exclusive.

### 1.3 The evidence, and it does not point where the marketing does

**(a) The cost of asking for a format is paid at the PROMPT, not the decoder.**
*The Format Tax* (arXiv 2604.03616, https://arxiv.org/html/2604.03616v1) measures 10 models
(Qwen3-32B/8B, OLMo3.1-32B, OLMo3-7B, SmolLM3-3B, Nemotron3-Nano, GPT-5-Nano, GPT-5.4-Nano,
Claude-Haiku-4.5, Grok-4.1-Fast) × 4 formats (JSON Schema, XML, Markdown, LaTeX) × 4 benchmarks
(MATH-500, GPQA-Diamond, ZebraLogic, WritingBench). The format-*requesting instruction alone*
costs **≈ −3.9 pp**; adding grammar-constrained decoding costs a further **≈ −1.6 pp** only.
Across 72 model-task-format cells, **92 % of significant degradation is already present from
the prompt with no constraint applied**. Their fix — generate free-form, then reformat —
recovers **+6.8 pp**.

This is the single most useful finding in this document, because it inverts the usual argument.
The expensive act is *telling a small model to speak JSON*. We do not do that on the work path.

**(b) For small models, hard schema decoding buys validity and sells correctness.**
*The Constraint Tax* (arXiv 2605.26128, https://arxiv.org/html/2605.26128) on Qwen2.5-0.5B/1.5B/3B
and SmolLM2-1.7B: schema validity **61.5 % → 100.0 %** (+38.5 pp) while answer accuracy fell
**19.7 % → 11.0 %** (−8.7 pp), and "wrong but schema-valid" rose **49.5 % → 88.9 %**. The
headline case is a tool call: on a calendar-scheduling task, Qwen2.5-1.5B scored **91.5 %
executable accuracy with prompt-only JSON and 48.0 % under hard schema decoding — −43.5 pp —
with both modes at 100 % schema validity.** The semantic failure was invisible to the validator.

That is precisely the failure `calls::swallowed_close` (`calls.rs:80-87`) was written for: a
call that is strictly valid JSON and still wrong, measured in a browser against gemma-4-12B.

**(c) Schema constraints and tool calls can annihilate each other.**
*Constraint Tax in Open-Weight LLMs* (arXiv 2606.25605, https://arxiv.org/html/2606.25605v1)
on seven open-weight models (20B–397B: Qwen3.6-35B-A3B, Qwen3.5-122B-A10B, GPT-OSS-20B,
Nemotron 3 Super 120B, Qwen3.5-397B-A17B, Qwen3-VL-235B-Thinking). With tools enabled AND a
JSON-schema response format enabled together, **Tool Invocation Rate went from 100 % to 0 %
on every open-weight model tested, at 100 % schema compliance.** Cause traced in the inference
stack: the schema is compiled to an FSM whose vocabulary mask excludes `<`, the character that
opens a tool-call tag, so the tokens are unreachable regardless of what the model wants.

**(d) The honest counter-evidence.** *JSONSchemaBench* (arXiv 2501.10868,
https://arxiv.org/html/2501.10868v1) finds the opposite sign: constrained decoding **improves**
downstream tasks by up to 4 % (GSM8K 80.1 % LM-only → 83.8 % with Guidance; Last Letter
50.7 → 54.0; Shuffle Objects 52.6 → 55.9) and Guidance is *faster* than unconstrained
(6.37–9.47 ms/token vs 15–16 ms LM-only) via token skipping. Empirical schema coverage varies
widely: Guidance ≈ 68 %, llama.cpp ≈ 64 %, XGrammar ≈ 56 %, Outlines ≈ 47 %.
**Why it does not overturn (a)–(c) for us:** it is measured on Llama-3.1-8B with an in-process
library that owns the decoder, on a *schema-filling* task where the structure is the answer.
Our work path is a reasoning-and-acting loop over an HTTP boundary we do not own. Both results
can be true; they are different jobs.

**(e) Changing the call notation collapses parallel calls.** *Notation Matters* (Kutschka &
Geiger, Know-Center/TU Graz, arXiv 2605.29676, https://arxiv.org/abs/2605.29676) — five
open-weight models on BFCL, MCPToolBench++, MCP-Universe, StableToolBench — reports that when
models must *generate* a non-JSON call notation, BFCL's `parallel` / `parallel_multiple`
categories reach **near-zero accuracy for most (model, format) pairs**. Our layout rule *is* a
parallel-call encoding. It is the part of our syntax least safe to renegotiate.

### 1.4 What each option costs in OUR code

| Option | Files touched | Crates | Invariants engaged | Verdict |
|---|---|---|---|---|
| **Keep text-as-tools as the only syntax** | 0 | — | I13 holds trivially | Correct today |
| **Ingest native calls (already built)** | `context/src/openai.rs` (done) | `context` | I13 held: reply parsing is not prompt assembly | Keep, extend |
| **EMIT a `tools` array when the endpoint wants one** | `agent/src/tools.rs` (store arg names), `agent/src/toolbox.rs` (expose schemas), `context/src/openai.rs` (write `tools`), `context/src/render.rs` (carry it out of the Document), `adapters_web/src/catalogue.rs` (one key) | `agent`, `context`, `adapters_web` | **I13 is the live question**; I14 must still hold (deterministic, golden-testable) | Behind a declared per-entry seam, not by default |
| **Constrained decoding / `response_format: json_schema` on the WORK call** | `context/src/openai.rs`, `adapters_web/src/catalogue.rs` | `context`, `adapters_web` | I15 (a server that ignores it must not break) | **No.** (c) says it can zero our tool calls |

Two concrete blockers worth naming, because they are cheap and they are load-bearing:

- **`Tool::new` throws away the argument names it was given** (`tools.rs:44-52`). It formats
  them into `usage_args: String` and keeps only the string. Nothing in the codebase can produce
  a JSON Schema, an MCP `inputSchema`, or a provider `tools` entry without re-parsing our own
  prose. Storing `args: Vec<String>` and deriving `usage_args` in `usage()` is one field, one
  file, and makes every later option possible. It changes no rendered byte.
- **`render()` panics on two of its three targets.** `crates/context/src/render.rs:66` is
  `ProviderFormat::Anthropic | ProviderFormat::Gemini => todo!("G5: second provider")`. A
  `todo!()` on a public enum arm is a live panic in a Wasm tab, not a stub.

### 1.5 Is our `Tool` the owner's definition?

The owner's definition (tracker.md): *anything invokable that accepts variable input and
produces a result for a query.* Read `tools.rs` against it:

- **"anything invokable"** — held, and held well. `Tool::from_engine` (`tools.rs:58-65`) makes a
  sub-agent a tool; `skills::tools()` makes a pure text lookup a tool; `web_search()` makes a
  network call a tool. The usage line is *generated* from name/description/args by one
  constructor, so a sub-agent, a skill and a built-in are indistinguishable in the prompt (I9).
  This is the best part of the file.
- **"accepts variable input"** — held, but as prose. `usage_args` is a rendered example, not a
  description of the input. See the blocker above.
- **"produces a result for a query"** — held. `ToolResult` is total: every failure is a result
  the model can read, never an error return (`tools.rs:73-101`). That is correct and it is why
  a refused call still teaches the model how to rewrite it.
- **The one thing that does NOT read that way: `agent: bool`.** Its own doc comment says "the
  MODEL is never told which is which", and yet the type carries the distinction. Worse, it is
  not even sufficient: `subagent.rs:162` reads `if !tool.agent && tool.name != SPAWN_AGENT`,
  i.e. the same concept is decided twice, once by a flag and once by a name constant. A tool
  that *is* another agent is exactly the case the definition says should be invisible. The
  honest shape is either a `kind` the UI reads and the prompt never sees (which is what
  `core/src/agents/card_sentences.rs:131` actually wants — it partitions on `t.agent` to draw
  two lists for a *person*), or no flag at all and one predicate. Today it is both and neither.

### RULING

**Keep text-as-tools. The decision on record is right, and the 2026 literature strengthens it
rather than dating it.** Do not add `response_format: json_schema` or a grammar to the work
call under any circumstance — arXiv 2606.25605 measured tool invocation going 100 % → 0 % on
seven open-weight models when a schema constraint and tools were enabled together, and
arXiv 2605.26128 measured −43.5 pp executable accuracy on a tool-calling task at 100 % schema
validity, which is the exact silent failure `calls::swallowed_close` exists to catch. Do
three things instead. **(1)** In `crates/agent/src/tools.rs`, change `Tool` to store
`args: Vec<String>` and derive `usage_args` inside `usage()`; this changes no rendered byte,
keeps I14's goldens green, and is the prerequisite for MCP `inputSchema`, a provider `tools`
array, or anything else that needs the argument names we currently throw away. **(2)** Make
native tool calls a **declared per-endpoint seam, not a global mode**: add one key to the
catalogue entry in `crates/adapters_web/src/catalogue.rs` (`tool_style: text | native`,
refused-never-defaulted on `yaml.rs`'s `one_of` rule), have `crates/context/src/openai.rs`
write a `tools` array only for `native`, and have `Affordances` render a pointer instead of
the signature block in that case so the model is not shown its toolbox twice. The ingest half
already exists at `openai.rs:120-141` and needs no change. To keep **I13**, derive that array
inside `crates/context` from the *same assembled `## affordances` section* rather than from
the `Toolbox` directly — one Document, two renderings, `assemble` still pure (**I14**).
**(3)** Resolve `Tool.agent`: delete the bool from the model-facing path and keep exactly one
predicate for "this invocation is delegation", used by `subagent.rs:162` and by
`card_sentences.rs:131`, so the owner's definition ("anything invokable") is true in the type
and not only in the comment. Replace `render.rs:66`'s `todo!()` with a typed
`ModelError::Unsupported` in the same increment — a panic on a public enum arm is not a stub,
it is a crash in a tab (**I15**).

---

## 2. JSON vs TOON

### 2.1 What TOON is

**Token-Oriented Object Notation.** Spec at https://github.com/toon-format/spec — **SPEC.md
v4.1, 2026-07-26, status Working Draft**, author Johann Schopplich, MIT; reference
implementation https://github.com/toon-format/toon; site https://toonformat.dev/. It is a
line-oriented, indentation-based, **lossless** encoding of the JSON data model: YAML-style
indentation for nesting, CSV-style rows for uniform arrays. Four rendering forms — inline,
tabular, keyed tabular, and a list fallback for non-uniform data. The tabular header
`key[N,delim]{f1,f2}:` declares the row count and the field list up front, which is the design's
actual payload: a redundancy check a decoder (and, in theory, a model) can validate against.
That declaration is also why TOON *accepts being larger than CSV*.

### 2.2 The claim, attributed

All of the following is **measured by the TOON project on its own format** (self-benchmark,
tokenizer GPT-5 `o200k_base` via `gpt-tokenizer`, 13 datasets, 244 questions × 6 formats ×
4 models = 5,856 calls; Claude Haiku 4.5, Gemini 3.6 Flash, GPT-5.4 Nano, Grok 4.5):

> "TOON reaches 72.2 % accuracy (vs JSON's 71.4 %) while using 42.6 % fewer tokens across
> 244 retrieval questions on 4 models." — https://toonformat.dev/guide/benchmarks

Their own token table: **−32.7 % vs pretty JSON** on mixed-structure data, **−58.7 %** on
flat-only data, **−15.7 % vs YAML**, **−40.9 % vs XML** — but **+1.6 % vs JSON-compact** (TOON
is *larger*) on mixed data and **+5.9 % vs CSV** (larger again) on flat data. Per-model
accuracy shows GPT-5.4 Nano preferring JSON (57.4 vs 57.0). The overall +0.8 pp accuracy margin
sits **inside their own stated ±2.8 confidence interval.**

The project's README states its own limits plainly, and quoting it is fair: TOON is for
"uniform arrays of objects"; for deep nesting "compact JSON often wins outright"; "Data is
purely tabular – CSV is smaller."

**UNVERIFIED:** the widely-circulated "30–60 % fewer tokens" phrasing is not on the project's
current pages as of 2026-08-20. It is blog-repeated. Do not cite it.

### 2.3 What independent measurement says

- **Kutschka & Geiger, *Notation Matters*, arXiv 2605.29676** (Know-Center / TU Graz, rev.
  2026-06-17, code at https://github.com/lkutschka/notation-matters). Four agentic benchmarks
  (BFCL, MCPToolBench++, MCP-Universe, StableToolBench), five open-weight models
  (Qwen3-32B think/no-think, DeepSeek-R1-Distill-32B, Mistral-Small-24B, Llama-4-Scout-17B),
  input compression decoupled from output compression. Abstract, verbatim: **"TOON achieves up
  to 18 % reduction at a similar 9 pp accuracy cost, but additionally cascades on multi-turn
  parsing failures and collapses parallel tool-call output for most models."** Worst single
  input-side drop: **Mistral-Small-24B on BFCL, 89 % (JSON) → 53 % (TOON)**. Component split:
  tool schemas −23 %, tool results −32 %, **tool calls no net saving** — parse failures in
  multi-turn eat the gains; Qwen3-32B-with-thinking ends at **+11 % tokens** under full TRON
  despite per-call compression. Their guidance: **"TOON is not safe as a default in multi-turn
  agentic systems."** They name a rival, TRON, as the defensible drop-in instead.
- **Masciari et al., arXiv 2601.12014**, on *generation*. Structural correctness (GCS),
  TOON vs JSON: **Gemma-3-4B 0.045 vs 0.779. Gemma-3-12B 0.278 vs 0.875.** Qwen3-4B 0.334 vs
  0.769; Mistral-7B 0.435 vs 0.848. It only closes at scale (Llama-3.3-70B 0.819 vs 0.808 — no
  significant difference). Their explanation: TOON "is not natively supported by the evaluated
  LLMs and must be enforced exclusively through prompt-level instructions."
- **Matveev, arXiv 2603.03306** (2026-02-08), 21 models, generation with Pydantic validation
  and up to 3 repair cycles. Names two taxes: a **prompt tax** (TOON needs a large instructional
  preamble — on Qwen3-235B, 4,715 tokens vs plain JSON's 2,772) and a **repair-loop tax**
  (invoice case: TOON 3,626 tokens vs JSON 1,723, because each failure re-feeds the big
  preamble). One-shot success on the invoice case: JSON 90.0 %, TOON **0.0 %**.
- **improvingagents.com** (blog, not peer-reviewed; https://www.improvingagents.com/blog/toon-benchmarks/):
  GPT-4.1-nano over a 1,000-row table — TOON 47.5 % @ 21,518 tok vs JSON 52.3 % @ 66,396 vs
  **Markdown-Table 51.9 % @ 25,140** vs CSV 44.3 % @ 19,524. On nested data with GPT-5-nano,
  TOON was both least accurate (43.1 %) and *more expensive* than Markdown.
- **Prior art the TOON discussion mostly ignores:** Sui et al., *Table Meets LLM*, WSDM 2024
  (arXiv 2305.13062) already established that serialization format changes table-understanding
  accuracy materially, and found **HTML with a format explanation best (65.43 %)**. "Markdown is
  best" is a folk result that contradicts it; treat the specific ranking as **UNVERIFIED** and
  model-dependent.

**The one number that decides this for us:** we ship against a gemma-class 12B running locally.
Gemma-3-12B produced structurally valid TOON **27.8 %** of the time against **87.5 %** for JSON
(arXiv 2601.12014). Gemma-3-4B: **4.5 %**.

### 2.4 Where the shape actually matters in OUR prompt

The two directions are already separate types in this codebase, and they already have
different answers — which is the correct architecture and worth saying out loud.

**What we SEND.** `Form` (`crates/context/src/form.rs`) is chosen by
`Form::for_target(ProviderFormat)` (`form.rs:47-52`), which returns `Markdown` for every target
today. Sections are emitted by `render_chat` (`crates/context/src/render.rs:73-100`) as
`## {id}\n({intent})\n` followed by the component's own body, all inside **one system message**,
then a fixed user message. So the send direction is already a headed-Markdown document, not
JSON, and TOON would only apply to a component whose body is a *uniform array* — and we have
none. `Affordances` is one line per tool. `History` is tagged turns. `Sensed` is
host-supplied parts. There is no table in this prompt to compress.

**What we ask BACK.** `ResponseContract` (`components/contract.rs`) has four constructors:
`prose()`, `tool_envelope()`, `saying()`, and `shaped(ResponseObject)`. Only `shaped` has a
second notation, and `ResponseObject::render_in` (`components/respond.rs:40-46`) is the only
place `Form::Json` changes a byte. Exactly one stage uses it today — the strategy vote
(`brief::contract`, `brief.rs:141-146`, `strategy::OBJECT`). Its default is named lines (`ROUTE: …` / `WHY: …`),
and the reason is already written in `respond.rs:11-18` and is correct.

### 2.5 What breaks when a small model half-follows

This matters more than the token count, because the failure mode differs by notation:

- **Named lines** (`ROUTE: react`). `strategy::route_of` (`strategy.rs:71-83`) scans for a line
  whose first word is `ROUTE`, tolerates `*`, backticks, quotes, a trailing period, and
  case. A model that adds a preamble, a fence, or a paragraph after the lines **still parses**.
  A model that answers the question instead of voting lands on `React` — the middle route, which
  can still reach either outcome. Degradation is graceful and visible in the reply itself.
- **JSON**. A stray fence, a trailing comma, or a preamble before the brace makes
  `serde_json::from_str` return `Err` and the whole vote is a fallback. Nothing on screen says
  the shape was the problem. This is the "silent failure" `respond.rs` already names.
- **TOON**. Adds a third failure the other two do not have: `[N]{f1,f2}` declares a row count
  and a field list, so a model that writes 4 rows after declaring 5 produces a document that is
  *strictly invalid* under the spec's default strict mode — and a permissive reader that accepts
  it has thrown away the only thing TOON bought. Kutschka & Geiger measured that failure
  *cascading*: a parse failure costs an extra reasoning iteration whose own payload erases the
  saving.

There is also an interaction we would hit immediately. Our layout rule — same line parallel,
new line sequential (`affordances.rs:42-45`, `calls.rs:19-30`) — is a **whitespace-significant
parallel-call encoding**. TOON is a **whitespace-significant document format** whose spec says
"Encoders MUST use a consistent number of spaces per level… Tabs MUST NOT be used". Two
whitespace-significant grammars in one reply is a parser we would be debugging for months, and
it is the exact category (`parallel`, `parallel_multiple`) that arXiv 2605.29676 measured
collapsing to near zero.

### RULING

**Do not adopt TOON in either direction, and record why so the question does not come back.**
On the SEND side the question is moot: `render_chat` (`crates/context/src/render.rs:73-100`)
emits a headed-Markdown document and no component in `crates/agent/src/components/` carries a
uniform array, so there is no table here for TOON to compress — its measured win is
**−32.7 % vs pretty JSON but +1.6 % vs JSON-compact and +5.9 % vs CSV** (the project's own
benchmark), and it wins nothing against prose. On the REPLY side it is actively disqualified:
this build's own model class produced structurally valid TOON **27.8 %** of the time
(Gemma-3-12B, arXiv 2601.12014) against 87.5 % for JSON, and an independent agentic benchmark
measured **−9 pp accuracy for ≤18 % tokens with parallel tool-call output collapsing to near
zero** (arXiv 2605.29676) — and our layout rule *is* parallel-call output. **Keep
`Form::{Markdown, Json}` as a closed two-variant enum and do not add a third**; the type is
right, `Form::for_target` (`form.rs:47-52`) is the right chooser, and `respond.rs`'s
lines-by-default reasoning is confirmed by outside measurement, so amend its doc comment to
cite arXiv 2604.03616 and 2601.12014 rather than only this build's own observation.
**Keep asking for named lines wherever a machine parses the reply** (`brief::contract`,
`brief.rs:141-146`), because
`strategy::route_of` (`strategy.rs:71-83`) degrades gracefully under a preamble and
`serde_json::from_str` does not; when a second machine-parsed stage lands, give it a
`ResponseObject` with named lines, never a JSON contract, and never a `response_format` on the
request (see §1). The only defensible future use of `Form::Json` is an endpoint that declares
it can *constrain* generation — that is a per-catalogue-entry fact, so it belongs on the same
`tool_style`-style key §1 rules for, and `Form::for_target` should read the entry rather than
match on the bare `ProviderFormat` variant. **I13** and **I14** are untouched by all of this.

---
## 3. Prompt and context engineering

### 3.1 The state of the practice, filtered to what a small local model gains from

- **Context is an attention budget, not a buffer.** Anthropic's *Effective context engineering
  for AI agents* (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  states it as: treat context as "a precious, finite resource", organize the system prompt into
  "distinct sections… using XML tagging or Markdown headers", find "the right altitude" between
  brittle if-else logic and vague guidance, prefer "diverse, canonical examples" to exhaustive
  edge cases, and load context **just-in-time** via lightweight identifiers so the agent
  "incrementally discover[s] relevant context through exploration". Long-horizon work gets three
  named tools: **compaction**, **note-taking** (persistent memory outside the window), and
  **sub-agents** returning condensed 1,000–2,000-token summaries.
- **Degradation with length is measured, not folklore.** Chroma's *Context Rot*
  (https://www.trychroma.com/research/context-rot) evaluated **18 models** (GPT-4.1, Claude 4,
  Gemini 2.5, Qwen3 among them) across 8 input lengths × 11 needle positions, plus LongMemEval
  (306 prompts averaging ~113k tokens) and a repeated-words task (1,090 length/position
  variations, 25–10,000 words). Findings: performance degrades with input length in every
  experiment; **a single distractor already lowers accuracy below the needle-only baseline and
  four compound it**; low needle-question similarity accelerates the decline; and —
  counter-intuitively — **all 18 models scored better on a shuffled haystack than on a
  logically coherent one**. LongMemEval's focused inputs (~300 tokens) versus full inputs is
  the direct measurement that *cutting irrelevant context is worth more than adding relevant
  context*.
- **Asking for a format is the expensive part.** *The Format Tax* (arXiv 2604.03616) — see §1.3
  — attributes ≈ −3.9 pp to the format-requesting instruction and only ≈ −1.6 pp to the decoder
  constraint, and recovers **+6.8 pp** by splitting generation from formatting into two passes.
- **Progressive disclosure is now a standard, not a technique.** Agent Skills (Anthropic, open
  standard) is a three-tier load: name + description at startup (~100 tokens per skill), the
  `SKILL.md` body on activation (recommended under 5,000 tokens), reference files only when
  needed. Frontmatter requires exactly two fields, `name` and `description`.
- **Prompt caching is an exact prefix match over the rendered request, universally.** Our own
  `docs/research/prompt-caching.md` §0 established this across Anthropic, OpenAI, Gemini,
  DeepSeek, vLLM and llama.cpp: one byte changed at position *N* invalidates everything at ≥ *N*,
  and no provider caches mid-prompt spans independently.

### 3.2 Block ORDER — `Slot` is right, and the reason is now externally supported

`crates/context/src/slot.rs` pins two ends: `SOUL = 0` ("an agent must be someone before it is
told anything") and `RESPONSE = 99` ("the instruction the model should be holding when it starts
writing"), with `AFFORDANCES = 30` deliberately ahead of `HISTORY = 80` so the toolbox sits
inside the cacheable head. The open `Slot(u8)` newtype with gaps of ten lets a faculty declare
its own position without patching the pure core.

**Verdict: correct, and keep it.** Three independent supports: (i) primacy/recency is what
Chroma's positional sweep measures, so pinning identity first and the reply contract last puts
the two most load-bearing instructions at the two positions models actually attend to;
(ii) `contract.rs:1-8`'s argument that the tail position costs no *reachable* cache is proven
by our own `prompt-caching.md` §0 — a prefix cache is already dead above slot 60 because
`Environment` changes every call, so nothing after it was cacheable wherever it sat;
(iii) Anthropic's own guidance is literally "distinct sections… Markdown headers", which is what
`render_chat` (`render.rs:80`) emits as `## {id}\n({intent})`.

**The one order defect, and it is the important one.** The durable goal — the `outcome` and
`done_when` that `public/stages/durable.md` tells the model to write — renders inside
the **shared-space block at `Slot::SPACE = 55`**, which is the middle of the document. That is
the single position Chroma's sweep and the whole lost-in-the-middle literature identify as
worst-recall, and it is holding the one fact the entire `project` route depends on surviving.
Everything else in this prompt is where it should be; this is not.

### 3.3 Cached prefix vs hot tail — `Stability` is now honest, and one literal undoes it

`Stability` (`crates/context/src/types.rs:44-49`) is a declared cache class and no longer does
an ordering job — that split is `slot.rs`'s opening paragraph and it was the right fix.
`Affordances` declares `SemiStatic` (`affordances.rs:61-63`); `ResponseContract` declares
`Static` and sits last anyway, justified above. `Environment` is the deliberate cache boundary:
"a cached clock is a wrong clock" (`slot.rs:51-54`).

So the cacheable head is slots 0–55: soul, identity, operating rules, affordances, user, memory,
space. That is exactly the right set, and on a local llama.cpp/LM Studio server with prefix
reuse it is most of the static text. No change needed.

### 3.4 Compaction — the mechanism is right, its unit is wrong

`public/agents/main/agent.md` declares `compact_at: 8`, `keep_recent: 3`. `window::due`
(`window.rs:62-64`) fires when the history reaches 8 **entries**; `window::transcript`
(`window.rs:69-76`) hands everything but the newest 3 to the same model as a toolless sheet
(`window.rs:146-162`) with `COMPACT_PROMPT`, and `window::compacted` (`window.rs:83-96`) refuses
an empty summary so a failed summarizer leaves the conversation alone. Deleting the summarizer
*agent* in favour of a sheet was right: it removed a whole Worker, a whole file and the silent
failure where a missing role file meant compaction never ran.

Two real problems:

1. **`compact_at` counts entries; `Budget` counts tokens; neither reads the model.** Eight
   entries is 500 tokens of chat or 50,000 tokens if one of them is an `exec` that `cat`-ed a
   file. Downstream, `degrade` then trims the assembled document to
   `Budget { max_tokens: 4096 }` (`phase.rs:104`) — a literal, identical for every model. Two
   mechanisms, two units, and no connection to the endpoint's actual window. This is the same
   defect as §4's and should be fixed once.
2. **A `project` turn compacts inside itself.** The route walks plan → work → verify → critique
   with a react loop inside `work`; every model reply and every tool result is a history entry.
   At `compact_at: 8` the turn summarises away the brief it opened with, which is the exact
   scenario `public/stages/durable.md` was written to survive. So compaction and
   the plan are in a race that is currently settled by a paragraph in a prompt file.

Compaction itself is the right primitive — Chroma's LongMemEval focused-vs-full comparison is
the measurement that removing irrelevant context beats keeping it. I read no source that would
justify removing it. (The "we stopped compacting" line circulating in 2026 blog coverage was
**not read** and is not relied on here.)

### 3.5 Skills — aligned with the standard, with one hole and one gap

`crates/agent/src/skills.rs` is the Agent Skills three-tier pattern almost exactly:
`list_skills` returns one `name: description` line each (`catalogue`, `skills.rs:135-148`),
`read_skill` puts the body in the window (`instruction`, `skills.rs:154-177`), frontmatter
requires `name` and `description` and a missing description is **refused, not defaulted**
because "the description is the whole basis on which a model decides to load a skill". A skill
runs nothing — both tools are pure functions of compiled-in text — and the load is still an
`EventKind::ToolInvoked` fact, so the trace shows which instruction entered the context and
when (I8). That is a better design than most implementations of the standard.

**The hole: only the `plan` stage can read a skill.** `brief::skill_only` (`brief.rs:154-156`)
returns true for `PLAN` alone, and `ask::scoped_tools` (`ask.rs:42-51`) grants the two skill
tools there and nowhere else — every other stage gets either the full toolbox or nothing, and
`skills::tools()` is inside `builtin_tools()` so `work` *can* name them only if the agent's
`tools:` list does. Meanwhile the strategy vote **fails towards `react`** by design
(`strategy.rs:20-25`), and `Route::React` walks `[work]` only — no plan stage. So on the route
that is both the fallback and the most common, house rules are unreachable. Skills apply to the
`project` route and nowhere else, which is not what "pull in instruction when a job calls for
it" means.

**The gap:** `INSTALLED` is `include_str!` at `skills.rs:43-52` with its own comment admitting
the fetch is not wired. Agents are data fetched from `public/agents/`, and since T1 **briefs are
data fetched from `public/stages/`** — skills are the last instruction surface still compiled
into the binary. A person cannot add a skill without a rebuild, which is a straight failure of
the goal's "easy to define a flow, add a tool" and of the uniformity spirit of **I9**. T1 has
just built the exact road this needs (`core::agents::briefs`, fetched at boot, refused as a set);
skills should travel it.

### 3.6 The durable goal — right pattern, wrong enforcement, wrong position

Since T1 this is a data file: `public/stages/durable.md`, joined onto the plan brief by
`brief::directive` (`brief.rs:109-120`) when and only when the agent has a space, keyed rather
than appended to `plan.md` so the core never splits a file on a separator. That is the right
shape and the right restraint — the core parses none of it, a missing key **refuses loudly**
(`AgentError::MalformedBrief`), and there is no compiled-in fallback to make a missing file look
like a working one. The pattern itself is Anthropic's note-taking: the space survives compaction,
is re-read by `core::space::refresh` before every pass, is already in the environment block, and
already crosses Workers.

But it is still **an instruction, not a mechanism**. A model that skips the two `remember` calls
loses the goal, and nothing observes that it happened; the run continues believing it holds a
plan it does not. The machine already has everything it needs to do this itself: `stages::next`
holds the plan stage's reply in hand at exactly the moment the OUTCOME and DONE WHEN lines
exist, and `public/stages/plan.md` already demands those two lines by name. Writing them from
Rust is deterministic (**I7**), emits a fact (**I8**), and deletes a paragraph from the prompt —
which §1.3(a) measured as the expensive kind of deletion. Note what does **not** change:
`brief.rs`'s rule that the core parses no brief stays intact, because the lines being read here
come from the **model's reply**, not from the brief.

### RULING

**The order and the cache classes are right; do not touch `slot.rs` or `Stability`.** Change
three things, in this order of payoff. **(1) Pin the durable goal to the tail.** Stop asking the
model to write it: in `crates/agent/src/stages.rs`, where the plan stage's reply is already in
hand, parse the OUTCOME and DONE WHEN lines `public/stages/plan.md` already demands and set them
as a small component at a new `Slot(94)` — immediately before `DIRECTIVE = 95`, inside the
pinned tail — then delete `public/stages/durable.md`, the `DURABLE` key from `brief::BRIEF_KEYS`
(`brief.rs:41,47`) and the append in `brief::directive` (`brief.rs:114-118`). This moves
the one fact a `project` turn cannot lose out of `Slot::SPACE = 55` (worst-recall middle,
Chroma) into the recency position, makes it survive compaction by construction rather than by
instruction, removes a prompt sentence (arXiv 2604.03616: prompt-level asks are where the tax
is), and satisfies **I7** and **I8** where a model instruction satisfied neither. Two files.
**(2) Give the `react` route access to skills.** `brief::skill_only` (`brief.rs:154-156`) grants
`list_skills`/`read_skill` to `plan` alone while `strategy.rs` deliberately fails towards
`react`, whose stage list is `[work]` — so the most-taken route can never load a house rule.
Grant the two skill tools to `WORK` unconditionally in `ask::scoped_tools` (`ask.rs:42-51`);
they are pure, capability-free, I/O-free functions of compiled-in text (`skills.rs:12-17`), so
this widens no capability surface and **I6** is untouched. **(3) Make `compact_at` and `Budget`
speak one unit that the endpoint declares.** `compact_at: 8` counts entries (`window.rs:62-64`)
while `Budget { max_tokens: 4096 }` counts tokens (`phase.rs:104`) and neither knows the model's
window; fold both into §4's single change and stop there. Explicitly **do not** add few-shot
examples, a scratchpad block, or a second summarizer — the summarizer-as-sheet
(`window.rs:98-133`) is a deletion this codebase already paid for and should not buy back. Wire
skills to `public/skills/` fetching in the same increment that touches `skills.rs:43-52`, so
skills are data like agents are data.

---

## 4. Model agnosticism — coupling to nothing

### 4.1 The coupling surface, found in the code

The good news first: **the seam that matters is already in the right place and already
data-driven.** `crates/adapters_web/src/catalogue.rs` ports the Python's central decision —
there is *no provider table*, because nearly every server speaks the OpenAI protocol and differs
only in `base_url`. `Entry::chat_url` (`catalogue.rs:66-94`) refuses rather than defaults: an
entry whose `kind`/`api` is not `openai`/`completions` returns a typed
`ModelError::Unsupported` naming what it speaks. `kind: "on-device"` is a whole second inference
substrate — Chrome's Prompt API — reached behind the same `ModelPort` with no URL, no header and
no `fetch` (`crates/adapters_web/src/ondevice.rs:1-20`). `ModelPort::resolves`
(`crates/kernel/src/ports.rs`) exists specifically so the UI can say what a name *actually*
reaches. That is a genuinely decoupled design and most of this section is about the handful of
literals that leak past it.

The leaks, exhaustively:

| # | Where | The assumption | Consequence on a swap |
|---|---|---|---|
| C1 | `crates/agent/src/ask.rs:68-71` and `crates/agent/src/window.rs:123` | `ProviderFormat::OpenAiChat { vision: false, audio: false }` written as a **literal in the agent crate** | A vision- or audio-capable endpoint is permanently text-only. `render::place`/`audible` and `openai::part_json` are fully built for image/audio/file parts and are dead code. **I15 inverted:** we advertise *less* than is available. |
| C2 | `crates/agent/src/phase.rs:104,115` | `Budget { max_tokens: 4096 }` (Work) / `2048` (Verify), identical for every model | A 128k-window model is degraded to 4k; a 4k-window model has no room left for output. `degrade` then elides sections we could afford. |
| C3 | `crates/context/src/assemble.rs:12-27` | `cost()` = `bytes / 4`, one ratio for every model and every content type | Under-counts CJK and code, mis-counts base64. It drives `degrade`, so the error becomes either an over-long prompt or a needlessly elided section. `kernel::Usage.prompt_tokens` is already parsed (`openai.rs:151-167`) and **never fed back** — the per-model EMA the research called for is designed and not built. |
| C4 | `crates/context/src/render.rs:66` | `ProviderFormat::Anthropic \| Gemini => todo!("G5: second provider")` | Selecting either **panics the Wasm instance**. A `todo!()` on a public enum arm is not a stub. |
| C5 | `crates/context/src/openai.rs:53-86` | No `tools` array is ever written | Any provider whose tool calling is conditioned on a declared `tools` array can never call a tool (§1.1). |
| C6 | `crates/context/src/openai.rs:91-116` | Reply is `choices[0].message.content` | Correct for OpenAI-compatible; `None` yields a typed error, never a fake reply — good. But `reasoning_content` (DeepSeek-style) is unread, and **`<think>…</think>` inside `content` is never stripped**, so `calls::parse_batches` will happily parse a `foo({…})` the model only *thought about*. |
| C7 | `crates/agent/src/ask.rs:81`, `window.rs:124` | `EndpointName("model")` — one endpoint for every call | The strategy vote and the compaction call, both cheap and mechanical, are billed to the main model. `window.rs:126-129` argues this deliberately for the summarizer and the argument is sound; the *vote* is the weaker case. |
| C8 | `crates/agent/src/reply.rs:38-40` | `todo!("Plan/Verify contracts")` | `phase.rs:113` configures Verify with `ResponseContract::Verdict`. Unreachable today by comment; a panic the moment it is not. |
| C9 | `crates/agent/src/components/affordances.rs:42-45` + `calls.rs` | The model can follow a bespoke whitespace layout rule | Genuinely model-agnostic (it is plain text), and `native_calls` is the escape hatch. **Not a defect** — recorded so it is not mistaken for one. |

### 4.2 Where a model swap actually breaks us

Ranked by how loud the failure is, loudest first:

1. **Anthropic or Gemini → panic** (C4). Loud, immediate, and the easiest to fix.
2. **A native-tool-calling-only provider → an agent with no tools** (C5). Silent; it looks like a
   model that never wants to act.
3. **A vision model → text-only forever** (C1). Silent, and the code to do it right already
   exists and is unreachable.
4. **Any window other than ~8k → wrong on both sides** (C2, C3). Silent, and it degrades the
   product's headline capability (long work) without saying so.
5. **A reasoning model → phantom tool calls** (C6). Silent, intermittent, and would be blamed on
   the model.

Notice the shape: **one loud failure and four silent ones**, and every silent one is a literal
sitting in the wrong crate. This codebase's own standard — "refused, never defaulted"
(`spec/yaml.rs:6-8`) — is applied rigorously to agent frontmatter and not at all to provider
capability.

### 4.3 The smallest seam that fixes it

There is no new abstraction to invent. **The catalogue entry is already the seam**; it is data,
per-endpoint, user-editable, and already the one place a URL and a protocol are decided. It is
missing three declared facts, and every leak above is a consequence of that absence:

```
context_window: 131072     # tokens; the ONLY input to Budget
vision: true               # what parts this endpoint can hear
audio: false
tool_style: text | native  # §1's ruling
```

With those, C1 becomes `ask.rs` reading the entry instead of writing `false`; C2 becomes
`PhaseConfig.budget` expressed as a *share of the declared window* rather than a literal; C5
becomes §1's `openai.rs` branch. C3 stays an estimate but gains a correction term the moment
`Usage.prompt_tokens` is folded back per entry. C4 and C8 are two `todo!()`s that become typed
errors. The whole change is one struct, one parser following `catalogue.rs`'s existing rules,
and the deletion of four literals.

### RULING

**Push provider capability into the catalogue entry and delete the literals that duplicate it.**
Add `context_window`, `vision`, `audio` and `tool_style` to `Entry`
(`crates/adapters_web/src/catalogue.rs:19-33`), parsed on the same refused-never-defaulted rule
`chat_url` already follows (`catalogue.rs:66-94`) and on `spec/yaml.rs`'s `one_of` discipline.
Then: **(a)** delete the `vision: false, audio: false` literals at `crates/agent/src/ask.rs:68-71`
and `crates/agent/src/window.rs:123` and read the resolved entry instead — `render::place`,
`render::audible` and `openai::part_json` are already written for all four content parts and are
currently dead code, and a hardcoded `false` is **I15 backwards**: the environment must advertise
what is actually available. **(b)** Replace `Budget { max_tokens: 4096 }` and `2048` at
`crates/agent/src/phase.rs:104,115` with a share of the entry's declared `context_window`, and
make `compact_at` (`window.rs:62-64`) read the same number so the two mechanisms that control
window size stop using two units (§3.4). **(c)** Feed `kernel::Usage.prompt_tokens`, which
`openai_usage` (`crates/context/src/openai.rs:151-167`) already parses and nothing consumes, back
as a per-entry correction to `assemble::cost`'s `bytes/4` (`crates/context/src/assemble.rs:12-27`)
— an estimate with a measured correction, per the ADR-009 research note, not a shipped tokenizer.
**(d)** Replace both `todo!()`s — `crates/context/src/render.rs:66` and
`crates/agent/src/reply.rs:38-40` — with typed `ModelError::Unsupported` / `AgentError` values;
a panic on a reachable enum arm violates **I15** and takes the tab with it. **(e)** Strip
`<think>…</think>` from `content` in `openai_reply_text` before it reaches `calls::parse_batches`,
because a tool call the model only reasoned about currently executes. **I3** (pure core), **I7**
(deterministic) and **I13** are unaffected throughout: every one of these is a value moving from
a literal in a pure crate to a declared fact in the adapter that already owns it.

---
## 5. What a 2026 browser gives us, and the one thing it has taken away

> Sources for this section were swept independently and cross-checked against vendor release
> notes, WHATWG/W3C specs, `mdn/browser-compat-data` on `main`, and WebKit/Chromium engine
> source. Where caniuse/BCD and a vendor blog disagree, both are given. Stable heads at
> retrieval: Chrome **151**, Firefox **154**, Safari **26.6** (Safari 27 in beta).

### 5.0 What this build already stands on

`IndexedDB` for everything, hand-rolled over `web-sys`, two object stores (`crates/adapters_web/src/idb.rs`,
ADR-005). **One dedicated Worker per agent**, `postMessage` only, with the absence of shared
memory typed into `BoxFuture`'s missing `Send` bound (`crates/kernel/src/ports.rs:11-20`,
ADR-008). **Cross-origin isolation by service worker** — `web/coi-sw.js`, 33 lines, rewriting
`COOP: same-origin` / `COEP: require-corp` / `CORP: cross-origin` onto our own responses because
GitHub Pages cannot set headers; headers only, no listener, because a worker may `respondWith`
once per fetch and `web/sw.js` owns that handler. **Chrome's Prompt API** as a catalogue entry
(`crates/adapters_web/src/ondevice.rs`). **A local OpenAI-compatible server as the DEFAULT
model**: `public/models.json` entry `local` → `http://127.0.0.1:8873/v1`, and
`public/agents/main/agent.md:4` says `model: local`.

That last sentence is the one to worry about.

### 5.1 THE FINDING: our default model path is now permission-gated, and on Safari it is dead

**Local Network Access.** Chrome shipped LNA in **Chrome 142 (2025-10-28)**
(https://developer.chrome.com/blog/local-network-access, https://developer.chrome.com/release-notes/142).
Its definition, verbatim: *"A local network request is any request from a public website to a
local IP address or loopback."* That is exactly `https://kaush4l.github.io/ASKK/` →
`http://127.0.0.1:8873/v1`. Gated at ship: `fetch()`, subresources, subframe navigation;
**Chrome 147 extended the gate to WebSocket and WebTransport**. Firefox implemented the same
design — ETP-Strict users from **Firefox 149 (2026-03-24)**, general rollout **Firefox 151
(2026-05-19)**, WebSockets in **Firefox 154 (2026-08-18)**
(https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox).

Two consequences land directly on our code:

1. **Denial is indistinguishable from "server down."** The failure is silent. Our discipline is
   "refused, never defaulted, in the words that name the fix" — and this is a refusal we cannot
   currently name, because `crates/adapters_web/src/model.rs`'s fetch error cannot tell a denied
   permission from a closed port. A boot-time or turn-time probe therefore reports the wrong
   cause. The mitigations are real and cheap: `fetch(url, { targetAddressSpace: "loopback" })`
   skips the up-front mixed-content check, and **the first local call must sit behind an explicit
   user gesture** rather than a boot probe, because a permission prompt raised from a background
   health check is a prompt the person will decline.
2. **Safari cannot do it at all, and has not been able to since 2017.** There is no LNA prompt
   in Safari because there is a prior blocker: an `https://` page may not fetch `http://localhost`
   at all. WebKit bug **171934** ("don't treat loopback as mixed content", filed **May 2017**) is
   **still `NEW`**, with no substantive movement since June 2023
   (https://bugs.webkit.org/show_bug.cgi?id=171934). Our default configuration is Safari-dead
   unless the local server terminates TLS with a trusted certificate.

This outranks everything else in this section. It is not a capability we are failing to adopt;
it is a capability the platform withdrew from underneath the product's default path while the
code was being written. It also reframes §4: the catalogue entry needs to carry not just what a
model *is* but whether this browser can *reach* it, and `ModelPort::resolves` — which already
exists to answer "what would this name actually reach today" — is the natural home for the
answer.

### 5.2 Worth doing now

1. **Web Locks — leader election, and it is now also freeze insurance.** Baseline in every
   browser since **March 2022**; Safari shipped it in **15.4 (2022-03-14)** and said so
   explicitly (https://webkit.org/blog/12445/). *The "Safari doesn't support Web Locks" claim
   still circulating is four years stale.* We keep an append-only event log in IndexedDB (**I8**)
   and one Worker per agent, and nothing stops two tabs driving the same agent into the same log;
   `replace_prefix` is atomic per transaction, which makes each write safe and does nothing about
   two writers. **The second reason is new and is the stronger one:** since **Chrome 133
   (Feb 2025)** Chrome freezes a browsing-context group when *"all pages within the group have
   been hidden and silent for more than five minutes"* and any same-origin subgroup is
   *"CPU-intensive"* (https://developer.chrome.com/blog/freezing-on-energy-saver). A wasm x86
   emulator in a hidden tab is the textbook target, and freezing suspends the group **including
   its workers** — which is every agent we have. The documented exemption list includes holding
   *"a Web Lock … that blocks operations outside the group"*, so a **contended** lock buys freeze
   immunity for free. `navigator.wakeLock` does not help: Screen Wake Lock requires a visible
   document and auto-releases on hide. Twenty lines in `crates/adapters_web/src/workers.rs`, two
   distinct problems solved. Scope caveat: locks are keyed by **origin including port**, so
   `localhost:8080` and `localhost:3000` do not share them.
2. **Storage durability — but the honest version, not `persist()` alone.** WebKit's live
   tracking-prevention page still states that ITP *"deletes all cookies created in JavaScript and
   all other script-writable storage after 7 days of no user interaction"*, and enumerates
   **IndexedDB, LocalStorage, SessionStorage, Media keys, and Service Worker registrations and
   cache** (https://webkit.org/tracking-prevention/). Two things I had wrong or unresolved before
   the sweep, now settled: **"7 days" means seven days of *Safari use*, not calendar days** —
   which is precisely why this fails intermittently and irreproducibly — and **the one documented
   unambiguous exemption is a Home Screen web app**, not a granted `persist()`. WebKit: *"The
   first-party domain of home screen web applications is exempt from ITP's 7-day cap on all
   script-writeable storage."* Whether `persist()` exempts a non-home-screened site is
   **UNVERIFIED and unreconciled in WebKit's own posts** — plan as if it does not. Two further
   facts change the design rather than the settings: **eviction is all-or-nothing per origin**
   (*"All of an origin's data is deleted at once"*, MDN), so we cannot lose only the model cache
   and keep the log; and **OPFS is not on WebKit's enumerated list only because the list predates
   OPFS**, so assume it is included. **Therefore: call `persist()` and `estimate()`, show what
   they say, and additionally treat a total origin wipe as a normal event** — a cheap manifest
   (sha256 + size + source per artifact; `BUNDLES.json` is already this shape) with idempotent
   resumable re-download, so a wipe costs bandwidth and not correctness. Also correct two stale
   numbers if they are anywhere in our docs: Safari's 1 GB-then-prompt model died in **Safari 17
   (Sept 2023)** — it is now up to **60 % of disk per origin / 80 % overall** for browser apps
   and **15 % / 20 % for embedded WKWebView** (https://webkit.org/blog/14403/). Our own recorded
   "quota exceeded at KB scale despite 23 GB free" is consistent with the WKWebView tier, not
   with a Safari-wide bug, and is worth one re-test in a real Safari 26 tab. `estimate()` is
   **Safari 17+**, two versions later than OPFS and `persist()` — feature-detect it separately,
   and never pre-flight with it; write, catch `QuotaExceededError`, recover.
3. **Move the headers off the service worker.** `web/coi-sw.js` is correct and load-bearing, and
   `require-corp` is the right choice because **Safari does not support `COEP: credentialless`**
   through Safari 27 — WebKit's standards position has been *"support"* since **2023-11-23** with
   no implementation since. But the SW trick has structural costs no code can remove: **a service
   worker cannot control the navigation that registered it**, so the first load is non-isolated
   and must `location.reload()` (gate the UI on `crossOriginIsolated` and render a loader, not
   the app, on that pass); Chrome has an open intermittent second-load failure; and **iOS evicts
   SW registrations after ~7 days of no interaction**, so returning users re-pay the reload. Our
   COEP audit *passes* today, and it passes for a reason worth writing down: **I1** and **I5**
   leave us with no cross-origin no-cors subresources at all. One DNS change — a custom domain
   fronted by Cloudflare with a Transform Rule, or Cloudflare Pages / Netlify `_headers` —
   deletes the reload, the flash, the intermittent and the iOS re-pay together. GitHub staff's
   answer on custom headers, **July 2023**, remains *"a scenario we would support… No ETA"*
   (https://github.com/orgs/community/discussions/13309), still open.

### 5.3 Real, but not now

4. **WebGPU + in-tab inference.** WebGPU is genuinely everywhere for our targets now: Chrome 113
   (2023-05-02), **Safari 26.0 (2025-09-15)** on macOS Tahoe/iOS/iPadOS, Firefox 141 (Windows)
   / 147 (Apple Silicon). Note two corrections to the common story: **Chrome on Linux is two GPU
   allowlists, not support** (Intel Gen12+ in 144; NVIDIA on Wayland in 147; no AMD, no X11), and
   **"WebGPU is Baseline" is false** — MDN still labels it Limited availability and the spec is a
   Candidate Recommendation Draft. On limits, the real constraint is not the spec defaults
   (`maxBufferSize` 256 MiB, `maxStorageBufferBindingSize` 128 MiB) but that **Chrome/Dawn reports
   *tiered* limits** for fingerprinting reasons, so you land on a tier and not on your hardware,
   while **Safari sets `maxStorageBufferBindingSize == maxBufferSize`** (~2 GiB−4 on macOS;
   **256 MiB floor / 1 GiB ceiling on iOS**, not raisable). The one rigorous measurement is
   *Llamas on the Web* (UCSC + Microsoft Research, arXiv 2605.20706): decode **+45–69 %** and peak
   memory **41–49 % lower** than transformers.js/WebLLM, but **prefill 21–51 % worse (~49 % of
   WebLLM's throughput)**, attributed directly to the unshipped subgroup-matrix proposal — so
   **long prompts are disproportionately expensive in a browser**, which is a bad match for a
   product whose whole §3 is about long context. It also records that **iOS Safari tab memory is
   capped below ~500 MB** and that **f16 accumulation produces incoherent output on Apple
   M-series GPUs**. Verdict unchanged and now better supported: the substrate seam is already
   proved by `ondevice.rs`, and the tab's memory is already committed to a c2w guest. One
   argument *for* it later, which is new: **WebGPU works in workers and the Prompt API does not**
   (see 7 below).
5. **OPFS.** Safari 15.2+, sync access handles **worker-only in every engine** (verified against
   WebKit's own IDL, `[Exposed=DedicatedWorker]`), all methods synchronous since **Safari 16.4** —
   and Chrome's stated rationale for that change is literally our case: *"asynchronous calls are
   not fully supported on Wasm yet"* and Asyncify workarounds *"cause significant performance
   degradation."* Traps to record before anyone starts: **Safari Private Browsing has no OPFS at
   all** (`getDirectory()` rejects); `mode: "readwrite-unsafe"` is **Chrome 121+ only**, so
   elsewhere it is one exclusive lock per file; and WebKit bug 250495 loses data written via a
   sync handle unless you `flush()` then `close()` before re-acquiring. ADR-005's two-trait split
   already makes this a measurement rather than an architecture question. Measure first.
6. **JSPI, and the Asyncify question.** JSPI is **Chrome 137 (2025-05-27)**, **Firefox 153
   (2026-07-21)**, and **Safari 27 beta** — where the sources conflict: the WWDC26 WebKit post
   states plainly that *"Safari 27 beta adds support for WebAssembly JavaScript Promise
   Integration"* while caniuse/BCD still say no. I believe the vendor and mark it **test before
   betting**. This matters to us specifically because our own measurements already blamed
   **ASYNCIFY** for a 2.6× loss on guest shell loops. Whether container2wasm's browser path uses
   Asyncify is **UNVERIFIED from primary source** — it is one grep of the emscripten flags in
   `web/c2w/`, and it is worth doing, because if the answer is yes then JSPI is the largest
   single performance lever available to the guest and it costs a feature-detect
   (`typeof WebAssembly.Suspending === 'function'`) plus keeping the old artifact.

### 5.4 Distraction, with the reason

7. **A second on-device inference entry.** Chrome's Prompt API went stable on the open web in
   **Chrome 148 (2026-05-05)** with real structured output (regex + JSON schema constraints) —
   and **it is not exposed in Web Workers**, main-thread only, with `create()` requiring user
   activation, ~22 GB free storage and a ~4.27 GB Gemini Nano download. **Our code already knows
   this**: `crates/adapters_web/src/lib.rs:76-79` says verbatim that a sub-agent's Worker is
   handed the shipped bytes because *"Chrome does not offer the Prompt API inside a Worker, so an
   on-device entry there would be an entry that always fails."* That is the right handling. It
   does leave a question for the arch lead rather than a bug for a coding agent: **every agent
   runs in a Worker, including `main`** (`crates/adapters_web/src/worker.rs:87-112`), so an
   `on-device` entry the page can resolve may be an entry no agent can actually use. Worth one
   test before anyone builds on it. Also settled: Mozilla filed **`position: negative`** on the
   Prompt API, WebKit has no signal, and Firefox's local inference is **WebExtensions-only** with
   no web API — so this is Chromium-only indefinitely.
8. **WebNN.** One implementation, in a repeatedly-delayed **desktop-only** origin trial: Chrome's
   own chromestatus entry shows status *Proposed* with desktop/Android/WebView ship milestones all
   `null`, and Chrome is on 151. The W3C CR of **2026-01-22** requires two independent
   interoperable implementations; WebKit's standards position (opened 2025-04-30) has **no label
   and no maintainer statement**; Mozilla is `positive` but not implementing. **WebGPU is the only
   credible acceleration path through at least 2027.**
9. **`memory64` — my UNVERIFIED is now resolved, and the popular claim is false.** **Safari has
   no memory64 at all** and has not committed to it; "Safari 18.2 shipped memory64 as part of
   Wasm 3.0" is wrong (18.2 shipped WasmGC and tail calls). So: wasm32, a 4 GiB ceiling, and far
   less on iOS. Even on Chrome, memory64 costs throughput — explicit bounds checks instead of the
   4 GiB guard-region trick — which is the wrong trade for an already 13–15× slow emulator.
   **This is the structural reason `VM_MEMORY_SIZE_MB` is the device lever, exactly as we
   measured.** Related: `relaxed SIMD` and `multi-memory` are Chrome+Firefox only — feature-detect,
   never require. Fixed-width SIMD is universal since Safari 16.4 and is the one to use.
10. **File System Access pickers — architect around them permanently.** Not a "not yet": WebKit is
    **`position: oppose`** (`concerns: security`, explicitly noting it already shipped the OPFS
    half) and Mozilla is **`position: harmful`** on the pickers while `position: positive` on OPFS
    access handles. There is no realistic path to `showSaveFilePicker` in Safari or Firefox.
    **I2** already puts the system of record in browser storage; keep import/export as explicit
    user-gestured boundary crossings and never fork the storage model on picker availability.
11. **Background Sync / Periodic Background Sync / Background Fetch.** Chrome-only, and WebKit has
    sat on *"Needs position"* with `concerns: power` / `concerns: privacy` since **2022**.
    Periodic Sync additionally requires an installed PWA with a non-zero site-engagement score and
    treats `minInterval` as advisory. Put nothing load-bearing behind any of them. Related and
    worth correcting if it is anywhere in our notes: **there is no specified lifetime for web
    service workers** — the 30-seconds-idle / 5-minute numbers are for *extension* service workers
    and do not apply. **A service worker is still not a place to run an agent loop**; it is a
    fetch router and a cache, which is exactly what `web/sw.js` is.
12. **Streaming.** Do not reopen; ADR-002 stands. Recording the facts so it does not get reopened
    on a wrong premise: fetch **response**-body streaming works everywhere back to Safari 10.1, so
    the ADR was a design choice and not a compatibility one; fetch **request**-body streaming is
    **Chrome-only** and needs HTTP/2+; `EventSource` cannot send an `Authorization` header at all,
    which disqualifies it for BYOK regardless; and `for await...of` over a `ReadableStream` is
    unsafe below Chrome 124 / Firefox 110 / Safari 26.4, so any future streaming must use
    `getReader()`.

### 5.5 Three cheap wins the sweep turned up that we were not asking about

- **`Atomics.waitAsync()` is Baseline 2025** — async block-wait on a SharedArrayBuffer from the
  main thread in every engine. This is the correct primitive for driving a synchronous wasm
  emulator from an async host without deadlocking, and we are already cross-origin isolated.
- **Zstd as an HTTP `Content-Encoding` is Baseline 2026** (Chrome 123+, Firefox 126+, **Safari
  26.3, 2026-02-11**). GitHub Pages will not negotiate it, but shipping `.zst` artifacts and
  decompressing client-side beats **T11**'s `gzip -9` (475 KB). Feature-detect the stream API with
  `try { new DecompressionStream("zstd") } catch {}` — per-engine `DecompressionStream` format
  coverage is **UNVERIFIED** and the Baseline banner covers the HTTP header, not the JS API.
- **SharedWorker became Baseline in May 2026, and Safari was never the blocker** — Safari has had
  it since **Safari 16 (2022)**; the holdout was Chrome on **Android**, re-enabled in **Chrome 148
  (2026-05-05)**. This retires a standing backlog item that was gated on exactly this. Chrome 148
  also added `{ extendedLifetime: true }` so an in-flight tool call can drain when the last tab
  closes (Chrome-only). Android caveat from the Intent: shared workers there face *"unexpected
  termination by the operating system due to memory pressure"* — design for resumability. Also:
  **JS modules in shared and service workers are both Baseline 2026**, so classic-worker IIFE
  bundling for Safari can stop.

### RULING

**One withdrawal to absorb, two capabilities to take, and a long list to refuse.** **(1) Absorb
Local Network Access, because it hits the default path.** `public/models.json`'s `local` entry is
`http://127.0.0.1:8873/v1` and `public/agents/main/agent.md:4` selects it, and that request is now
permission-gated in Chrome (142+, extended to WebSocket/WebTransport in 147) and Firefox
(149/151/154), and **impossible in Safari**, where an `https://` page cannot fetch `http://localhost`
at all (WebKit bug 171934, open since May 2017). Do three things in
`crates/adapters_web/src/model.rs` and `endpoint.rs`: pass
`targetAddressSpace: "loopback"` on loopback entries; make the first call to a local entry require
an explicit user gesture rather than a boot probe, because a prompt raised from a background health
check gets declined; and give `ModelError` a variant that says *"this browser would not let the page
reach a local server"* distinctly from *"nothing answered"*, wired through `ModelPort::resolves`
so Settings can say it before a turn is spent — a refusal we cannot name is exactly the failure
`spec/yaml.rs:6-8` forbids everywhere else. **(2) Take a Web Lock per agent** in
`crates/adapters_web/src/workers.rs` — it is Baseline since March 2022 including Safari 15.4, it
closes the two-tabs-one-log hole (**I8**), and a *contended* lock is a documented exemption from
Chrome's background-tab freezing (Chrome 133+, five minutes hidden, CPU-intensive — which is our
c2w guest exactly), so one twenty-line change buys two unrelated fixes. **(3) Call `persist()` and
`estimate()` in `crates/adapters_web/src/idb.rs`, and design for total origin wipe anyway** —
eviction is all-or-nothing per origin, WebKit's 7-day ITP cap is still live and counts days of
*browser use*, and the only documented exemption is a Home Screen web app, not a granted
`persist()`; so add a sha256+size manifest with idempotent resumable re-download (`BUNDLES.json`
is already the shape) and let a wipe cost bandwidth instead of correctness (**I11**, **I15**).
**Do not** build a WebGPU inference entry (`ondevice.rs` already proved the seam; and browser
prefill is 21–51 % worse than WebLLM for want of an unshipped subgroup-matrix proposal, which is
the wrong weakness for a long-context product). **Do not** plan on WebNN, `memory64` (Safari has
none — now verified, and the contrary claim is false), File System Access pickers (WebKit
`oppose`, Mozilla `harmful` — permanent), or any Background Sync/Fetch API. **Do not** reopen
streaming. Separately: **grep `web/c2w/` for Asyncify**, because if it is there then JSPI
(Chrome 137 / Firefox 153 / Safari 27 beta) is the largest guest-performance lever available and
costs one feature-detect. And **correct `DECISIONS/ADR-008-hosting-coi.md:69`**, which still rules
"no COOP/COEP, no SAB, no COI in v1" while `web/coi-sw.js` has shipped exactly that since
2026-08-18 — recording in the same edit that the COEP audit passes *because* **I1** and **I5**
leave us no cross-origin no-cors subresources, that `require-corp` is forced because Safari has no
`credentialless`, and that one DNS change (Cloudflare in front of a custom domain, or Cloudflare
Pages / Netlify `_headers`) would delete the first-load reload, the flash, Chrome's intermittent
second-load failure and iOS's 7-day SW-registration eviction in a single move.

---

## The three worth doing first, and why each beats the next

**1. Absorb Local Network Access — the default model path is permission-gated in Chrome and
Firefox and impossible in Safari** (§5 ruling item 1; `crates/adapters_web/src/model.rs`,
`endpoint.rs`, `crates/kernel/src/error.rs`, `public/models.json`).

It beats everything because it is the only item on this list where **the product's shipped default
configuration does not work**, and because the platform did this to us rather than us doing it to
ourselves. `public/models.json`'s `local` entry is `http://127.0.0.1:8873/v1`,
`public/agents/main/agent.md:4` selects it, and since **Chrome 142 (2025-10-28)** that is a gated
local-network request; Firefox followed through 149/151/154; Safari has been unable to make it at
all since **2017** (WebKit bug 171934, still `NEW`). Worse than the breakage is its *shape*: the
denial is silent and indistinguishable from a closed port, so the one thing this codebase is
rigorous about — naming a refusal in the words that name the fix — is precisely what it cannot
currently do here. Three changes: `targetAddressSpace: "loopback"`, first-call-behind-a-gesture
instead of a boot probe, and a distinct `ModelError` surfaced through `ModelPort::resolves`.

**2. Pin the durable goal to the tail and stop asking the model to write it** (§3 ruling item 1;
`crates/agent/src/stages.rs`, `public/stages/durable.md`, a new `Slot(94)`).

It beats #3 because it fixes a **correctness** hole in the capability the owner named as the point
of the product, where #3 fixes a *smallness*. T7's phase mandate and T2's standing goal both assume
a `project` turn still knows its own outcome on round twelve, and today that rests on a paragraph
in a prompt file whose product lands at `Slot::SPACE = 55` — the exact middle position eighteen
models measurably fail to recall from (https://www.trychroma.com/research/context-rot). Moving it
into the pinned tail makes it survive compaction by construction, converts a model behaviour into
a machine behaviour (**I7**, **I8**), and deletes a prompt instruction, which arXiv 2604.03616
measured as the expensive kind. Two files, and T1 just made the deletion half of it trivial.

**3. Make the catalogue entry the whole truth about a provider** (§4 ruling; §1 ruling item 2;
`crates/adapters_web/src/catalogue.rs`, `crates/agent/src/ask.rs:68-71`,
`crates/agent/src/phase.rs:104,115`, `crates/context/src/render.rs:66`).

It beats the rest because it is **one change that closes five silent defects and unblocks two
future ones**. `vision: false` written as a literal in the *agent* crate makes fully-written
multimodal code unreachable (**I15** backwards); `Budget { max_tokens: 4096 }` decides on every
model's behalf that it has an 8k window; `cost()`'s `bytes/4` never sees the `Usage.prompt_tokens`
we already parse; two `todo!()`s are crashes on reachable enum arms. All of it is the same mistake
— a provider fact living in a pure crate instead of in the adapter that owns the catalogue — and
the codebase's own rule for exactly this ("refused, never defaulted", `spec/yaml.rs:6-8`) is
already written and already enforced on the other config surface. Do it third and it becomes the
landing site for **§1's `tool_style` key** and **§5's reachability fact** at no extra cost. Its
cheap companion, worth doing in the same pass: store `args: Vec<String>` on `Tool`
(`crates/agent/src/tools.rs:44-52`), which changes no rendered byte and is the prerequisite for
MCP's `inputSchema`.

*The runner-up, and it is close:* the Web Lock per agent (§5 ruling item 2) — twenty lines that
close the two-tabs-one-log hole **and** buy exemption from Chrome's background-tab freezing. It
loses only because nothing has bitten us yet.

## What to explicitly NOT do

This is the more valuable half, so it is stated as refusals with the reason attached.

- **Do not adopt TOON, in either direction.** Our own model class produced structurally valid TOON
  **27.8 %** of the time (Gemma-3-12B; JSON 87.5 %, arXiv 2601.12014), and an independent agentic
  benchmark measured **−9 pp accuracy for ≤18 % tokens with parallel tool-call output collapsing to
  near zero** (arXiv 2605.29676) — and our layout rule *is* parallel-call output. There is also no
  table in our prompt for it to compress. The answer is in §2 and does not need re-researching.
- **Do not put `response_format: json_schema` or a grammar on the work call.** Seven open-weight
  models went from **100 % to 0 % tool invocation** when a schema constraint and tools were enabled
  together, at 100 % schema compliance (arXiv 2606.25605). This is the single most expensive
  mistake available in this codebase right now, and it looks like an improvement.
- **Do not convert the reply contract to JSON for a small local model.** The failure mode is silent
  (`serde_json::from_str` → fallback, nothing on screen) where the named-lines failure mode is
  visible and `strategy::route_of` (`strategy.rs:71-83`) tolerates it. `respond.rs:11-18` had this
  right before the literature did. And do not add a third `Form` variant: two are used, and a third
  notation is a third parser for a shape we ask for in exactly one stage.
- **Do not probe the local model endpoint at boot.** Under LNA a background probe raises a
  permission prompt the person will decline, and a declined prompt is indistinguishable from a
  closed port. The first local call belongs behind a user gesture. (§5.1.)
- **Do not build a WebGPU/WebLLM inference entry yet.** `crates/adapters_web/src/ondevice.rs`
  already proved the substrate seam at zero download, and the one rigorous measurement
  (arXiv 2605.20706) puts browser **prefill 21–51 % worse** than WebLLM for want of an unshipped
  subgroup-matrix proposal — the wrong weakness for a product whose §3 is entirely about long
  context.
- **Do not plan on WebNN, `memory64`, or the File System Access pickers.** WebNN has one
  implementation in a repeatedly-delayed desktop-only origin trial with Apple silent. **Safari has
  no `memory64` at all** — now verified, and the widely repeated "Safari 18.2 shipped it with Wasm
  3.0" is false; this is the structural reason `VM_MEMORY_SIZE_MB` is the lever. The pickers are
  not "not yet" but **permanent**: WebKit is `position: oppose` and Mozilla `position: harmful`,
  both while explicitly supporting OPFS.
- **Do not put anything load-bearing behind Background Sync, Periodic Background Sync or Background
  Fetch** — Chrome-only, with WebKit parked on "Needs position" and `concerns: power` since 2022.
  And **do not run the agent loop in a service worker**: there is no specified lifetime for web
  service workers, the familiar 30-second/5-minute numbers are *extension* service workers and do
  not apply, and `web/sw.js` is correctly a fetch router and a cache. The loop belongs in a worker
  with a Web Lock electing the leader.
- **Do not reopen streaming.** ADR-002 decided it, and the facts confirm it was a design choice
  rather than a compatibility one: response-body streaming works back to Safari 10.1. The cost is
  partial-reply state crossing **I4**, for perceived latency on a loop bounded by the model.
- **Do not re-introduce the summarizer as an agent.** `window.rs:98-133` records that deletion and
  what it bought: a summarizer has no tools, no space, no history and no conversation, so it was a
  whole Worker and a whole file to carry one system prompt. *(Note the contrast, because it is
  instructive rather than contradictory: the **critic** went the other way and shipped as a real
  agent in T3 — `crates/agent/src/critic.rs:1-14` and `public/agents/critic/agent.md` argue that a
  reviewer's whole value is a window that did **not** do the work, which a sheet in the caller's own
  window cannot give. The rule is not "fewer Workers"; it is "a Worker must buy a different
  context." When T7's deep path asks for a **grounder**, that is the test it has to pass, and the
  critic is the precedent for how to pass it.)*
- **Do not "fix" `Slot` ordering or `Stability`.** They are right, they were right for reasons this
  document verified from outside, and the split between them was the fix. The thing that looks
  wrong about the prompt's order is the durable goal at slot 55, and that is item #2 above.
