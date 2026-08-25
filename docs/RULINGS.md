# RESEARCH & RULINGS — the JS rewrite

> **Standing on ground that already moved.** Three of the six architecture critiques have been ruled on and LANDED before this document was written: the seam is frozen as a typed projection (`docs/SEAM.md`), the event envelope is versioned (`packages/kernel/src/event.js:20,38`), and the ports carry streaming, native tool calls and separated reasoning (`packages/kernel/src/ports.js:53-78`). `INVARIANTS.md` was rewritten for the JS build on 2026-08-25 and now runs to I19. This ruling does not re-litigate frozen rows. It rules on what is still open — `packages/{core,agent,context,adapters-web}` contain a `package.json` and nothing else.

---

## 1. What the rivals do that we do not

Ranked by user-visible value. Twenty rows, no more.

| # | Capability | Who has it | Why it matters | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | Read a web page (fetch + extract to markdown) | Firecrawl keyless, verified live: `POST /v2/search` and `/v2/scrape` with **no** Authorization header, `access-control-allow-origin: *` ([docs](https://docs.firecrawl.dev/rate-limits#keyless-no-api-key)) | We can see a headline and never the article. `crates/kernel/src/ids.rs:46-47` defines exactly two endpoint names ever | **ADOPT** | The one measured keyless CORS-`*` web index that answers from a residential IP |
| 2 | Streaming tokens | Everyone | `crates/context/src/openai.rs:81` hardcodes `stream: false`; a long local reply reads as a hang | **ADOPT — landed** | `ports.js:70-78` `onDelta`; I15 makes a non-streaming port legal |
| 3 | Native provider tool calls with `tool_call_id` | Hermes 4 / DeepSeek V3.2 / OpenAI / Anthropic ([DeepSeek](https://api-docs.deepseek.com/guides/thinking_with_tools)) | Our `name({json})` scraper corrupted a file in production (`crates/agent/src/reply.rs:55-86`) | **ADOPT — landed** | `ports.js:56` `calls: [{id, tool, args}]` — the whole `Asked`/`Retries` correlation layer dies |
| 4 | Errors returned TO the model as tool results | Hermes-Function-Calling `utils.py`; Agent Zero `fw.*` prompts ([Nous](https://github.com/NousResearch/Hermes-Function-Calling/blob/main/utils.py)) | A typed error that only reaches a trace view teaches the model nothing | **ADOPT** | Converts every malformed-output bug into one extra iteration |
| 5 | Attach a file / paste an image | Every product surveyed | `grep FileReader\|DataTransfer\|ondrop crates/ui/src` = **0** | **ADOPT** | The most common thing anyone asks a personal agent, unrepresentable today |
| 6 | Graded compaction ladder with per-tier token budgets (50/30/20) | Agent Zero `helpers/history.py:15-25` | Ours truncates the FRONT 200 chars (`crates/context/src/assemble.rs:57`), losing the newest turn | **ADAPT** | Take the tiering and the cheap-first ladder; refuse the FAISS layer |
| 7 | Large tool output spilled to a handle, re-spliced by reference (`§§include(path)`) | Agent Zero `_90_save_tool_call_file.py` | Biggest context win per line of code; a 200KB result crosses a tool boundary un-re-emitted | **ADOPT** | We already have an artifact store; the handle is an artifact id |
| 8 | Run roster grouped by STATE with a six-glyph vocabulary; peek → attach | Claude Code `agent view` ([docs](https://code.claude.com/docs/en/agent-view)) | Answers the only question that matters at a glance: which one needs me | **ADOPT** | Pure CSS/text; `/board` already projects status |
| 9 | Recap on re-attach | Claude Code agent view | Turns re-entry from scrollback archaeology into one paragraph | **ADOPT** | Deterministic fold of events since last view — no model call |
| 10 | MCP client | Cursor, Claude Code, Agent Zero | `grep -rni mcp crates` = **1**, and it is a comment | **ADAPT** | Remote MCP over HTTP works from a page; stdio needs a host — ship remote only |
| 11 | Long-term memory with retrieval | Agent Zero (`Area.{MAIN,FRAGMENTS,SOLUTIONS}` + auto recall/memorise) | Ours is a 20-line notepad: `crates/agent/src/memory.rs:40` | **ADAPT** | Take auto-recall and `behaviour.md` merge; start with BM25/trigram over IndexedDB, not embeddings |
| 12 | Four-state tool-call inspector, auto-open when complete | Vercel AI Elements `Tool` ([docs](https://elements.ai-sdk.dev/components/tool)) | Running tools stay one line; finished ones show their result without a click | **ADOPT** | `<details>` + a status enum; the trace already carries all three fields |
| 13 | Context budget meter (ring + hover breakdown of input/output/reasoning/cached) | AI Elements `Context` ([docs](https://elements.ai-sdk.dev/components/context)) | Our budget is a literal — `crates/agent/src/phase.rs:111` `max_tokens: 8192` | **ADOPT** | Turns a contested constant into an observation; `Usage` already carries cached |
| 14 | Turn/step vocabulary, logged even when a turn spends no step | DeepSeek `dsh` ([architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)) | We have no name for "the model asked for tools so we owe another request"; `state.phase` is assigned nowhere | **ADOPT** | Cancellation, resume, budget and trace all become one shape |
| 15 | "Model-visible means logged", asserted at runtime | dsh | I8 claims it; the Rust board was `Board::default()` and never a fold (`crates/core/src/boot.rs:170`) | **ADOPT** | I17 applied to I8 — an assertion, not a convention |
| 16 | Reasoning as a typed block, never a string field | dsh `ContentBlockMap` ([docs](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/llm-streaming.md)) | Retrofitting touches adapter, log, compaction and UI at once | **ADOPT — landed** | `ports.js:48-50` keeps `reasoning` separate and out of history |
| 17 | Model Arena — same prompt, two models, sequential | Unsloth Desktop ([docs](https://unsloth.ai/docs/new/studio/chat.md)) | Our roadmap keeps producing false claims; an arena makes one cheap to test in the product | **ADAPT** | Sequential is enough; two `handle` calls into two columns |
| 18 | Profiles as directories of prompt OVERRIDES, incl. a `tiny-local` profile | Agent Zero `agents/tiny-local/agent.yaml` | Model-class adaptation becomes a data change, not a code change | **ADOPT** | Our agents are already declarative files; this is a resolution order |
| 19 | Two API dialects on one port (`/v1/messages` + `/v1/chat/completions`) | Unsloth Desktop ([docs](https://unsloth.ai/docs/basics/api.md)) | Turns a harness into infrastructure any client can point at | **REFUSE (now)** | I1: a page cannot listen on a port. Revisit only if a host companion is chartered |
| 20 | Scheduled / background work, notifications | Unsloth `cron`, Agent Zero, every assistant | Zero hits for cron/Notification across the tree; the agent only exists while you watch it | **REFUSE (now)** | Nothing fires with the tab closed on any browser we can rely on. Naming it honestly beats half-shipping it |

---

## 2. Bun 1.4 and Next: what the runtime now gives us for free

Bun 1.4 shipped 2026-08-20, rewritten in Rust ([blog](https://bun.com/blog/bun-v1.4)). The precision that matters: **every headline `Bun.*` API is server-runtime-only**. `target: "browser"` is a module-resolution setting that "prioritizes the browser export condition" and `target: "node"` "does not polyfill the Bun global or the built-in `bun:*` modules" ([bundler docs](https://github.com/oven-sh/bun/blob/main/docs/bundler/index.mdx)). Nothing labelled `Bun.*` executes in the shipped page.

### Hand-rolled in Rust → one line now (BUILD TIME ONLY)

| The Rust tree did | Bun 1.4 gives | Where it runs |
|---|---|---|
| `scripts/shot.sh` + `layout-probe.js` + `deck-probe.js` + an unowned Chrome | `Bun.WebView`: `navigate('file://…')`, `evaluate()`, `screenshot({format})`, native events so pages see `isTrusted: true`; zero-install on macOS via WKWebView ([docs](https://github.com/oven-sh/bun/blob/main/docs/runtime/webview.mdx)) | Build/CI. Marked EXPERIMENTAL; WebKit backend cannot emit webp |
| A hand-rolled gate runner | `bun test --parallel --shard=i/n --timings --update-timings`; coordinator merges coverage + JUnit ([docs](https://github.com/oven-sh/bun/blob/main/docs/test/parallel.mdx)) | Build/CI. `--parallel` implies `--isolate` — cross-file state leaks become findings |
| `sed` over HTML in `publish.sh` | `HTMLRewriter` (lol-html) with real CSS selectors ([docs](https://github.com/oven-sh/bun/blob/main/docs/runtime/html-rewriter.mdx)) | Build. Handlers must be synchronous for string input |
| An ad-hoc static preview server | `Bun.serve({routes:{'/*':{dir:'./out'}}})` — real ETag/304/Range/index.html, `openat2(RESOLVE_IN_ROOT)` ([docs](https://github.com/oven-sh/bun/blob/main/docs/runtime/http/routing.mdx)) | Local only. Never the production path (I1) |

### Crosses the boundary into the shipped page — exactly three things

1. **The `md` loader.** `.md`/`.markdown` are first-class importable; "during bundling, Bun inlines the rendered HTML into the bundle as a string" ([file-types](https://github.com/oven-sh/bun/blob/main/docs/runtime/file-types.mdx)). Our `apps/web/public/stages/*.md` and `skills/*/skill.md` render at build. Note `Bun.markdown` itself is marked **UNSTABLE** — use the loader, or call `Bun.markdown.html()` in a build script and write the output.
2. **`--compile --target=browser`** inlines JS/CSS/fonts/images as data: URIs into one `.html` ([standalone-html](https://github.com/oven-sh/bun/blob/main/docs/bundler/standalone-html.mdx)). The one UNVERIFIED risk in that research — whether the `new URL('./pkg_bg.wasm', import.meta.url)` + `instantiateStreaming` idiom survives data: URI inlining — **evaporates for us**: the JS rewrite ships no wasm-bindgen.
3. **`define` / `--env` inlining**, which is how `basePath` reaches the page.

### Next 16.3 static export

`output: 'export'`, `basePath: process.env.PAGES_BASE_PATH` injected by `actions/configure-pages@v5` — two lines, copied verbatim from Vercel's own template ([nextjs/deploy-github-pages](https://github.com/nextjs/deploy-github-pages)). Read it back at runtime as `import.meta.env.BASE_URL` (Turbopack only, includes the trailing slash — [turbopack ref](https://nextjs.org/docs/app/api-reference/turbopack)). Server Components run at build and render to static HTML; Client Components are **prerendered**, so `window`/`localStorage`/`indexedDB` may only be touched in `useEffect` ([static-exports](https://nextjs.org/docs/app/guides/static-exports)).

Two hard rules for our deploy specifically:

- **`.nojekyll` is mandatory.** The official template omits it because `upload-pages-artifact` bypasses Jekyll. `publish.sh` pushes to the `gh-pages` **branch**, which does not — and every `_next/` path 404s silently ([GitHub](https://github.blog/news-insights/bypassing-jekyll-on-github-pages/)). Assert its presence in `publish.sh`.
- **`ssr: false` only inside a Client Component**, or it is a hard error ([lazy-loading](https://nextjs.org/docs/app/guides/lazy-loading)). That is where the worker/IndexedDB bootstrap goes.

### Dependencies we now allow

| Dependency | Where | One-line justification |
|---|---|---|
| `next`, `react`, `react-dom` | `apps/web` only (landed: `apps/web/package.json`) | The FACE lane's rendering substrate; per-route HTML entries and free code splitting |
| `typescript`, `@types/bun` | root devDeps (landed: `package.json`) | I19 is the rewrite's replacement for Rust's type system; `bunx tsc -p jsconfig.json` is a gate step |
| **Nothing else, anywhere under `packages/**`** | — | The dependency count below the UI is **zero** and stays zero. `packages/kernel` has no `dependencies` key at all |

### Dependencies we still refuse

| Refused | Instead |
|---|---|
| `zod` | Per-fact validators of a few lines each; `packages/kernel/src/event.js:48` `isKnownFact` already shows the shape. A schema library below the UI would be the first dependency in a pure package |
| Tailwind + `@tailwindcss/postcss` | CSS Modules via Lightning CSS — native to Turbopack, **zero dependencies** ([css docs](https://nextjs.org/docs/app/getting-started/css)) |
| `framer-motion` | The shimmer spec is one CSS keyframe: gradient sweep, 2s, linear ([AI Elements](https://elements.ai-sdk.dev/components/shimmer)) |
| Any charting library | Inline SVG. The context ring is ~20 lines |
| `marked` + `dompurify` | Markdown is parsed IN the core into typed inline nodes; JSX escapes text children by construction |
| An XML/HTML parser for tool calls | Native `calls` (`ports.js:56`) with a hand-rolled tag scanner as the declared fallback |
| `htmx` | Already dead: `grep -rn '\.hx_' crates` = **1** |

---

## 3. The eight attacks on our architecture

Six came from the architecture critique lenses; two are mounted by the research and were not covered by any lens. Numbered honestly.

### Attack 1 — The seam ships markup, and the UI parses it back with `str::find`
**Strongest flaw.** `crates/kernel/src/http.rs:81-83` calls the body "a fragment htmx can swap directly" while `grep -rn '\.hx_' crates` returns **1**. The real wire format was already a typed projection, badly encoded: **31 distinct application `x-*` header names** in `crates/core/src`, plus 14 `data-*` attributes per board row, recovered by substring scan (`crates/ui/src/board/read_attrs.rs:16-19`). `kernel::Status` is a closed enum stringified and re-matched against `"working" | "starting"` string literals in the UI. Control flow keyed on CSS class names (`crates/ui/src/chat/retry_actions.rs:28-34`). `x-file` carries an entire file body in an HTTP header — which works only because `handle` is an in-process call today.

**RULING: SUSTAINED, and already executed.** `docs/SEAM.md` freezes `{status, view, data}` with 25 named views and one `problem` shape. I5 is AMENDED in `INVARIANTS.md` from "no application logic in JS" to "the UI renders `data`; it may not compute it."

Two sub-rulings the critique got right and one it got wrong:
- **Right, and now law:** the projection is a **VIEW MODEL, not a domain dump** — it carries already-worded strings (`elapsedLabel`) beside machine fields (`elapsedSecs`). `crates/core/src/words.rs` exists so two panes cannot word one fact differently; that property must survive. Gate it: any date/duration/plural formatting or string concatenation into rendered text inside `apps/web` is a bug of the same standing as a size violation.
- **Right:** `dangerouslySetInnerHTML` count in `apps/web` must be **zero**. The Rust tree has 13 `dangerous_inner_html` sites in `crates/ui/src`, and inside each one the VDOM cannot diff, key or preserve scroll.
- **Wrong:** "a typed projection loses escaping by construction." The critique concedes this itself. JSX escapes text children by default; 13 injection sites is the *current* risk, not the future one.
- **Deferred, correctly:** the forge's HTML extension point. `Logic::Script` returns 501 and `crates/agent/src/forge.rs` was deleted. Reserve **one** escape hatch — `{kind:'custom', nodes:[…]}` over a closed node vocabulary — and pay nothing else.

### Attack 2 — The event log is three persistence mechanisms wearing one name
**Strongest flaw.** Boot reads one IndexedDB record per event with **one read-only transaction per record** (`crates/core/src/boot.rs:98-122`), against a measured real browser holding **39,237 events** (`crates/core/src/boot.rs:36-41`). Every seam request then deep-clones the entire log: `crates/core/src/dispatch.rs:108-109` builds `recent: app.log.iter().map(|e| e.kind.clone()).collect()` — request cost O(history), session cost O(history²), with four panes polling. Meanwhile `crates/kernel/src/event.rs:154-156` documents persistence as "segments (ADR-005 `events/seg-*`)" and `crates/core/src/log/store.rs:181` writes `events/{seq}`. **The documented format does not exist.**

Worse, `persist` does `std::mem::take(&mut a.unpersisted)` **before** the write loop and returns on the first error (`crates/core/src/log/store.rs:177,192`) — one quota hiccup and the rest of the batch is gone forever.

**RULING: SUSTAINED IN FULL. This is the largest open item and it belongs to lane C.**

| Ruling | Shape |
|---|---|
| Segments, never one record per event | `seg/{stream}/{000123}` = one IDB record, ~512 NDJSON envelopes + `{firstSeq,lastSeq,count}`. Boot = one `getAll` over a key range |
| Snapshots | `snap/{stream}/{seq}` = `{seq, reducerVersions, state}` every N segments. Boot = newest matching snapshot + tail |
| Projections are registered reducers, folded incrementally | No handler ever receives the event array. `dispatch` reads a memoised object |
| Transactional persist | Append the whole pending batch as ONE segment write; on failure leave the queue intact and retry with backoff. Never `take` before success |
| Compound numeric key | `[stream, segmentIndex]`, not zero-padded `{:08}` strings — no ceiling, no U+10FFFF sentinel, no rule living in a comment |
| `BlobStore` gets its consumer | Segments are the append-heavy payload `ports.js:33-41` was written for |

Two of this lens's rulings are **already landed**: I18 (per-record envelope version) is law, and `packages/kernel/src/event.js:8-10` makes `fact` a nested object so "a new payload key is additive by construction." The unknown-record path is half-built — `isKnownFact` (`event.js:48`) refuses by name; the **quarantine** half (`events/quarantine/`, boot completes, banner shown) is not written. Write it. Refusing to boot is data loss with extra steps.

**Where the critique is wrong:** it recommends dropping the closed/open split because "in JS there is no enum to close." `event.js:41-45` keeps `FACT_TYPES` as a `/** @type {const} */` array precisely so a reader can refuse an unknown fact **by name** under I19. Keep it. `custom` survives as one variant, but every `core.*` kind that carries load-bearing semantics (writership, chat-clear, stage, pass spend) is promoted to a real fact type with a validator.

### Attack 3 — Nine ports, of which several were Rust ceremony
**Strongest flaw.** `BlobStore` had three implementations and **zero** consumers. `RngPort` had one production call site. `ModelPort::resolves` is a read query riding an effect trait three lines below the doc claiming "the port moves bytes, it does not interpret them" (`crates/kernel/src/ports.rs:98-100,130`). `WorkspacePort::durable()` defaulted to `true` while the only shipping implementation returns `false` (`crates/adapters_web/src/c2w.rs:101-103`). Three module headers state a port count and all three are wrong.

**RULING: PARTLY SUSTAINED — and the landed `ports.js` already answers most of it.**

| Critique said | Ruling |
|---|---|
| Delete `BlobStore` | **REFUSED.** It was dead in Rust; the segment log is its consumer. Kept at `ports.js:33-41` |
| Merge `RngPort` into the clock | **REFUSED.** The ceremony was Rust's — `dyn`, `Rc`, `BoxFuture`. As typedefs the cost is two lines (`ports.js:16-18`) and `check-purity.js` bans `Math.random()` and `Date.now()` separately |
| Merge `NetPort` into `ModelPort` | **REFUSED.** `ModelPort` now owns streaming and provider-native tool-call parsing (`ports.js:53-78`). Merging puts wire-shape knowledge into the general broker |
| Split `resolves` off as a query | **PARTLY.** Kept on the port (`ports.js:76`) but with **no default** — an adapter with no catalogue returns `null` explicitly. Default methods that lie are the defect, not co-location |
| Replace the emulator with OPFS + a separate runner | **SUSTAINED.** See Attack 6 |
| No `Rc`/`BoxFuture`/classes | **SUSTAINED and landed.** `ports.js:1-11`: "They are TYPEDEFS and not classes: a port is a bag of functions, `implements` buys nothing in JS" |

One thing the landed shape got right that no critique asked for: **every port takes an optional `AbortSignal`** (`ports.js:74,91,98,110`). That is the structural answer to Attack 5's hang.

### Attack 4 — The Context Document budgets against a constant and truncates from the wrong end
**Strongest flaw, and it is a triple.** (a) `crates/agent/src/phase.rs:111` is `const WORK_BUDGET: Budget = Budget { max_tokens: 8192 }` — the only real Budget construction in the product, and nothing anywhere reads a per-model context length. (b) `crates/context/src/assemble.rs:57` `const KEEP: usize = 200` takes the **front** 200 characters, and history renders oldest-first — so on any constrained turn the model keeps the greeting and loses the user's actual message. (c) Compaction assembles its own summarising sheet with the **same** 8192 budget and the transcript in a `Task` component whose floor is `Summarized` — so a transcript larger than the budget is reduced to 200 chars, summarised, and the result **replaces the entire window**. Silent, irreversible, and it is exactly the case compaction exists to serve.

**RULING: SUSTAINED IN FULL. Lane A.**

1. **Budget is DERIVED, never declared.** `budgetFor(modelCard, turn)` where the card is the single source: `contextTokens` REQUIRED, and a catalogue entry without one is a config error at install. `apps/web/public/models.json` gains the field.
2. **Ban head-of-string truncation from the codebase.** The only generic degrade primitives are `dropOldest`, `headAndTail`, `usePrecomputedSummary`. History drops **whole turns from the oldest end**, always keeps the last user message and never splits a `tool_call` from its `tool_result`.
3. **Compaction is map-reduce over chunks.** The compaction sheet's transcript declares `floor: 'full'` — unsummarisable by construction. Never replace the window until the new summary is non-empty and smaller than what it replaced.
4. **Estimate the RENDERED artifact**, not the source. `estimate(adapter.buildRequest(doc, card).body)`. Per-modality: a flat `bytes/4` over base64 charged a 200KB PNG ~66,000 tokens against a 2048 ceiling — the type system carefully preserves image parts all the way to the wire and the arithmetic guarantees they never arrive.
5. **`validate()` moves inside `assemble()`.** `grep -rn 'context::validate' crates` returns **only tests**. A law with no runtime call site is a claim about the test suite. Make the invalid state unconstructible: `assemble` returns the document or an error, and there is no other way to obtain one.
6. **Trust boundary.** Every section declares `trust: 'authored' | 'derived' | 'untrusted'`. Untrusted content never enters the system prompt, is wrapped in a per-turn nonce-delimited envelope, and the delimiter is escaped inside the payload. Cheap now, impossible to retrofit.
7. **Cache breakpoints must be measurable or deleted.** `render.rs:44-49` asserts `cache_control` breakpoints are applied when the body is written; `grep -rn cache_control crates/context` is **empty**. Either stamp them and put the cache-hit ratio in the debug view, or stop claiming the Stability architecture buys anything.

**Where the critique is wrong:** it treats "one renderer, `todo!()` for Anthropic and Gemini" as a major flaw. It is a *scope* fact, not a design fault — but the fix it proposes is right and cheap: one `ProviderAdapter` owning `buildRequest` **and** `parseResponse`, so the rendered shape and the serialized shape cannot disagree. `crates/core/src/effects.rs:44` calls `openai_request_body` unconditionally regardless of the format it just rendered with; that specific bug is what the merged adapter makes unrepresentable.

### Attack 5 — The loop can restart an abandoned turn, and cannot time out a hung one
**Strongest flaw.** `on_tool_result` decrements with `saturating_sub` and emits a fresh `call_model` with **no check that a turn is running** — while two sites clear `agent.task` from *outside* `step` (`crates/core/src/runtime/requests.rs:83`, `crates/core/src/failure/card.rs:129`). A late result from an abandoned turn silently bills a model call. And a delegated turn has **no timeout**: if a sub-agent Worker never posts back, `pending_tools` never reaches zero and the lead sits Working forever — documented in `crates/agent/src/step/line.rs:11-28` and fixed only for the narrow duplicate-name case.

Second-strongest: the turn **ends by absence**. `parse_reply` returns `Tools(vec![])` for any prose, so "no call in the text" reads as "the model answered" — which is why `malformed_call` (`crates/agent/src/reply.rs:55-86`) exists as a hand-rolled heuristic patching a missing protocol.

**RULING: SUSTAINED.** Lane B.

- **`turnId` on every effect, required on every event.** `step` drops any event whose `turnId` is not live. `awaiting: 'model' | 'tools' | null` is explicit; a result with nothing awaited is a logged anomaly, never a model call.
- **Every outstanding call gets a deadline and an `AbortController`.** A timeout resolves as a *failed tool result* so the counter always drains. Stop aborts the controllers rather than refusing to schedule new work. `ports.js` already threads `signal` through `call`, `fetch`, `delegate` and `exec` — use it.
- **End on a signal, not a silence.** `finish_reason: 'tool_calls'` vs `'stop'` is the exit. Where a model has no tool API, require an explicit `respond({…})` call — Agent Zero's shape, where the response tool returns `break_loop=True` and everything the agent "says" is a tool call ([tools/response.py](https://github.com/agent0ai/agent-zero/blob/main/tools/response.py)).
- **Declare the negative case**: "if the available tools are not relevant, respond in natural conversational language" — verbatim in both Hermes prompts ([Nous](https://github.com/NousResearch/hermes-agent/blob/main/agent/agent_runtime_helpers.py)). A prose-only turn must end the loop cleanly, with a test.
- **Parallelise all effects, not just delegation.** `crates/core/src/batch.rs:121-146` awaits non-delegate effects one at a time while `crates/agent/src/effect.rs:48-53` declares same-line calls independent. The rule is right; only its scope is wrong.
- **`observations` is an array.** `crates/agent/src/step.rs:160-162` builds `Observations { lines: vec![r.line()] }` and `set_component` upserts by id — three calls on one line produce three overwrites and the model sees one.
- **Retry with backoff, as a fact the reducer sees.** `crates/agent/src/step.rs:80-82`'s catch-all `_ => (state, Vec::new())` swallows `core.error`, so the loop cannot decide anything about a failure. Add a typed `effect_failed` fact the reducer must handle. Borrow DeepSeek's determinism test: two consecutive zero-output completions from the same `(model, finishReason)` stop the retry immediately ([empty_response_guard.py](https://github.com/NousResearch/hermes-agent/blob/main/agent/empty_response_guard.py)).
- **Persist turn state.** I11 promises resume across refresh; only the history window was mirrored. The reducer state is plain JSON — checkpoint it with an `effectsInFlight` list, and on boot either resume or emit an `interrupted` ending. Never leave a turn in limbo.

**Where the critique is wrong:** "the pure/impure wall is breached by `mem::take`." That specific mechanism is a Rust borrow-checker artifact and does not port — in JS the reducer takes a frozen snapshot and returns a new state. The *principle* it defends is sustained and stronger: **the reducer is the only writer**, and every out-of-band mutation (`task = None`, board status, senses refresh) becomes a fact through the same door.

**Retire the phase machine.** `state.phase` is assigned nowhere, `v1_phases()` has one entry, `PhaseConfig.exits` and `ExitCondition` have zero readers, and `AgentState.{plan, cursor, retries, replans}` have no writers anywhere in the tree. Keep **stages** — what they actually are is `{brief, toolAllowlist, responseSchema}` — and delete the rest.

### Attack 6 — An unusually well-engineered loop around an almost-empty capability set
**Strongest flaw.** The complete toolbox is ~22 names, of which exactly one leaves the browser, and that one is unconfigured by default. `web/c2w` is **47 MB** on disk to serve four file operations, running a single interpreted Bochs thread, and the product tells its own model it has no python3, no node, no git, no curl, no make and no compiler (`crates/agent/src/environment/mod.rs:101`), `network: none`, and — decisively — `durable() -> false` (`crates/adapters_web/src/c2w.rs:101-103`). Every file is lost on refresh. Zero uses of OPFS anywhere in the tree.

**RULING: SUSTAINED. The emulator does not come back.**

- **Split the port along the real seam** — and the landed `ports.js:109-117` already did it: `read`/`write`/`list` are direct operations, not shell commands with base64 quoting. Back them with **OPFS**, which makes `durable()` finally return `true`.
- **`exec` becomes an OPTIONAL runner** (`ports.js:110`), instance-scoped, one per space. The Rust version serialised every agent's every command through one shared PTY behind one module-global promise queue — shared fate by construction.
- **Widen the address space, keep the broker.** `crates/kernel/src/ids.rs:46-47` defines exactly two endpoint names ever. The I6 property that matters is "no module gets raw `fetch`" — enforced by `check-purity.js`'s `fetch()` rule — not "only two destinations exist." Per-origin allowlist, default deny, one prompt per new origin.
- **Ship search that works on arrival.** Firecrawl keyless is verified: preflight 204 with `access-control-allow-origin: *`, POST 200 with no Authorization header, ~1,000 free credits/month at 2 credits per search ([launch](https://www.firecrawl.dev/blog/firecrawl-keyless-launch)). Fall back to Wikipedia/Wikimedia, HN Algolia, OpenAlex and Crossref — all verified keyless with CORS. BYOK upgrade to Tavily or keyed Firecrawl, both of which return preflights explicitly allowing the `authorization` header.
- **Delete two dead assumptions from our plans, with the measurement that killed them.** Public SearXNG: of 76 healthy instances, 60 returned 429 and only **2** emit any `access-control-allow-origin` (both rate-limited). `r.jina.ai`: hard 401, *"blocked from performing anonymous queries due to bad network reputation (AS7922)"* — a consumer residential ISP, i.e. exactly where a browser agent lives. Both were load-bearing in project memory and both are false.
- **RE-MEASURED BY THE LEAD, 2026-08-25**, with `scripts-js/check-cors.js` from
  `https://kaush4l.github.io`. Nine of ten candidates answer a preflight from
  our real origin: Firecrawl search AND scrape keyless (204, `allow-origin: *`,
  no Authorization header), Wikipedia REST, HN Algolia, OpenAlex, Crossref,
  Tavily with `authorization` allowed, OpenRouter, and `r.jina.ai` — whose CORS
  layer is fine and whose 401 is IP gating, which is a different refusal and has
  a different repair. The one that does not is the Wikimedia `w/api.php`
  endpoint, which emits no `allow-origin` at all: use the REST API, not the
  action API. Re-run the probe whenever the search story changes; it is not in
  `bun run gate`, because a third party being down must not block a deploy of
  unrelated work.
- **Keep a `scripts-js/check-cors.js` probe beside the gate.** Every wrong answer here is invisible from documentation and obvious from one curl: Exa's docs imply CORS but its preflight has no `allow-origin`; Brave's docs show fetch examples but `OPTIONS` returns 405. I17 applied to a third party.

### Attack 7 — Reasoning passback is provider-conditional, and getting it wrong is a 400 (research, no lens)
Not covered by any critique lens, and it will brick sessions.

- **DeepSeek:** without `tools`, intermediate `reasoning_content` need not be concatenated back. **With `tools` it must be passed back in every subsequent turn, including turns where the model made no tool call**, or the API returns 400 ([guide](https://api-docs.deepseek.com/guides/thinking_mode)).
- **Anthropic:** the opposite polarity, signature-verified — echo the assistant content array back *exactly as received*; rebuilding the message or filtering `redacted_thinking` triggers a 400 ([docs](https://platform.claude.com/docs/en/build-with-claude/thinking-tool-workflows)).
- **The session-bricking bug**, documented by DeepSeek's own adapter: a reasoning-only or tool-call-only assistant turn must serialise `content` as `""`, **never `null`** — and because the message sits durably in the session log, one null bricks every later turn of that session ([serialize.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/src/serialize.ts)).

**RULING: ADOPT all three as tested policy, plus provenance gating.** Store `{provider, model, replayState}` on every assistant turn and hand `replayState` to an adapter **only** when that adapter owns both the historical and the target provider. We are explicitly multi-provider; feeding one vendor's opaque thinking signature to another is the concrete corruption case. `ports.js:48-50` keeps `reasoning` out of history by default — correct for the no-tools case, and the tools case now needs the explicit replay path. **One line, one test, highest value-per-line on this list: never serialise `null` content.**

### Attack 8 — Token accounting will over-report and trigger compaction early (research, no lens)
`reasoningTokens`, where present, is **informational detail already included in `outputTokens`; totals must not add it again**. Cache fields are disjoint, and providers that fold cache hits into one prompt total (DeepSeek's `prompt_tokens`) must have them subtracted back out ([llm-streaming](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/llm-streaming.md)).

**RULING: ADOPT.** `ports.js:45` already declares `{inputTokens, outputTokens, cachedInputTokens}`. Add one test asserting `total !== output + reasoning`. Our budget is the thing this corrupts, and the budget is already the most contested number in the project.

---

## 4. The target architecture

### Packages

| Package | Owns | Depends on |
|---|---|---|
| `packages/kernel` | Vocabulary only: `Fact`/`Event`/`EventLog`, port typedefs, `Request`/`Response`, ids, capabilities, status, typed errors. No I/O, no logic | nothing |
| `packages/context` | The Document: components, slots, budget derivation, the degrade ladder, `assemble` + `validate`, one `ProviderAdapter` per provider owning `buildRequest` and `parseResponse` | kernel |
| `packages/agent` | The pure loop: `step(state, event) -> {state, effects}`, turn/step lifecycle, stages, tools, compaction policy | kernel, context |
| `packages/core` | The App aggregate, `handle` (the one door), the log with segments + snapshots + reducers, the effect driver, every projection named in `docs/SEAM.md` | kernel, agent, context |
| `packages/adapters-web` | IndexedDB, OPFS, `fetch` broker, Workers, speech. The only package allowed a browser global | kernel |
| `packages/adapters-test` | Host doubles: fake clock, seeded rng, in-memory stores, scripted model and agents | kernel |
| `apps/web` | Next static export. Renders `response.data`. Imports packages, never edits them | kernel, core, adapters-web |

**Dependency direction is one-way and gated.** `scripts-js/check-purity.js` lists `PURE = ['kernel','context','agent','core','adapters-test']` and fails any of them on `window`, `document`, `navigator`, `localStorage`, `indexedDB`, `fetch(`, `new Worker`, `Date.now()`, `new Date()`, `Math.random()`. That is I3 and I7, executable.

### The seam contract (frozen — `docs/SEAM.md`)

```js
/**
 * The one entry point (I4). Synchronous by construction: a request either
 * projects what the log already holds, or it RECORDS a fact and returns the
 * projection that fact produced. Work that takes time is never awaited here —
 * it is queued as an effect and the driver runs it, so the interface can never
 * hang on a model call.
 * @param {App} app
 * @param {Request} request
 * @returns {Response}
 */
export function handle(app, request) {}

/** @typedef {{method: string, path: string, headers: Record<string,string>, body: Record<string,string>}} Request */
/** @typedef {{status: number, view: string, data: Record<string, unknown>}} Response */

/**
 * The second half, and the ONLY other public entry (not a second door: it takes
 * no request and returns no projection). Runs queued effects to completion,
 * appending facts as they land. Every effect carries the `turnId` it was queued
 * under; a result whose turn is no longer live is dropped and logged.
 * @param {App} app
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<void>}
 */
export async function drive(app, opts) {}
```

25 routes, a `problem` view with `{kind, message, detail, repair}` as the single failure shape, and `headers['x-agent']` addressing one agent so `/chat` stays one route however many conversations it projects.

### Invariants: survives / amended / retired

`INVARIANTS.md` was rewritten on 2026-08-25 and its own footer states: *"What was retired: Nothing."* That footer is now **wrong by one row**, and this ruling corrects it.

| ID | Status | Ruling |
|---|---|---|
| I1 Static, I2 Local, I4 One seam, I6 Default-deny, I7 Deterministic, I8 Observable, I9 Uniform modules, I10 Reversible, I11 Updatable, I13 Sectioned, I14 Pure assembly, I15 Degradable, I16 Stated truth, I17 Executable gate | **UNCHANGED** | Every one survives the language change intact |
| I3 Pure core | **AMENDED — landed** | Was prose; now `scripts-js/check-purity.js` fails a package that imports a browser global |
| I5 Dumb frontend | **AMENDED — landed** | Was "no application logic in JS" (a claim about a language). Now: named typed projections cross the seam; the UI renders `data` and may not compute it |
| I5 | **AMENDED FURTHER — this ruling** | Add: the projection is a VIEW MODEL. It carries already-worded strings beside machine fields. The UI chooses layout and never composes prose. Gated by grep for formatting and concatenation in `apps/web` |
| I12 Small | **AMENDED — landed** | Both halves now gated: `scripts-js/check-size.js`, `FILE_LIMIT = 200`, `FN_LIMIT = 40` |
| I18 Versioned facts | **NEW — landed** | `EVENT_VERSION` at `event.js:20`; `fact` nested so envelope and payload cannot collide |
| I19 Typed at the boundary | **NEW — landed** | `tsc --checkJs` under `strict`; `any` is a defect with a written reason. No package below the UI has a build step |
| **I20 Bounded boot** | **NEW — this ruling** | Cold boot issues a bounded number of storage transactions and reads a bounded number of records, independent of history length. Gated: write 10k facts, assert the record count is ~`history/512 + snapshots` and the transaction count does not grow with history. The 39,237-event browser is the reason (`crates/core/src/boot.rs:36-41`) |
| **I21 Turn identity** | **NEW — this ruling** | Every effect carries the `turnId` it was queued under, and the reducer drops any event whose turn is not live. No path exists by which an abandoned turn bills a model call |
| **Phases** | **RETIRED** | `PhaseId`, `PhaseConfig.exits`, `ExitCondition`, `AgentState.{plan,cursor,retries,replans}`. `state.phase` was assigned nowhere in 67,476 lines of Rust; a machine with no writer is not a machine. `PhaseId` stays in `kernel/ids.js` only as long as a stage needs a name, then goes |
| **`resolves()` default** | **RETIRED** | A default method that returns an optimistic answer the real implementation must remember to override (`workspace.rs`'s `durable() -> true` against `c2w.rs`'s `false`) is how a card told a user their endpoint switch had not taken. Capability descriptors are filled in honestly or absent |

---

## 5. The translation order

Four lanes, matching `docs/TEAMS.md`. **Two lanes never edit one file.** A lane needing a change in another lane's package files a request in `STATUS.md`; it never reaches across.

Prerequisite already met: `packages/kernel` and `packages/adapters-test` are landed and the seam is frozen. All four lanes start against a frozen contract.

### Lane A — PAPER (`packages/context/**`)

| # | Increment | Done when |
|---|---|---|
| A1 | Types + slots + `Part` union incl. `thinking` with an opaque signature | Golden test: a fixed component set assembles byte-identically across runs (I14) |
| A2 | `modelCard` + `budgetFor(card, turn)`; catalogue entries require `contextTokens` | A card with no window is a config error at install; a 4k model and a 200k model produce different budgets from the same code |
| A3 | Continuous `fit(section, allowance)` replacing the one-way ladder; `dropOldest`/`headAndTail`/`usePrecomputedSummary` only | Head-truncation appears nowhere; a constrained history keeps the newest turn and never splits `tool_call` from `tool_result` |
| A4 | `ProviderAdapter` × 3 (openai, anthropic, gemini): `buildRequest` + `parseResponse`, one conformance suite | Reasoning passback: tools-present replays verbatim, tools-absent elides, `content` is `""` and never `null`. Usage: `total !== output + reasoning` |
| A5 | `validate()` moved inside `assemble()`; trust levels; nonce-delimited untrusted envelope | An invalid Document is unconstructible. Untrusted content never reaches the system prompt |
| A6 | Golden matrix: 3 adapters × {no-budget, tight, impossible} × {text, image, tool-calls, thinking}, snapshotting the **final request body** | 36 snapshots plus a `CompactionReport` snapshot each |
| A7 | Compaction as map-reduce over chunks; transcript component declares `floor: 'full'` | A transcript larger than the budget summarises correctly instead of being cut to 200 chars |

**Definition of done:** `bun run gate` green; no `apps/web` or `packages/{core,agent}` file touched.

### Lane B — LOOP (`packages/agent/**`)

| # | Increment | Done when |
|---|---|---|
| B1 | `AgentState` + `step(state, event) -> {state, effects}`, frozen-snapshot in, new state out | Reducer is the only writer; a test proves an out-of-band mutation is impossible |
| B2 | Turn/step lifecycle with `turnId`, `awaiting`, explicit ending kinds | I21 test: a result from an abandoned turn is dropped and logged, never re-queued (the `saturating_sub` restart) |
| B3 | Native tool calls end-to-end: `calls[].id` carried through execution onto `tool_result` | The `Asked`/`Retries` correlation layer is not ported. A multi-call turn correlates by lookup |
| B4 | Deadlines + `AbortSignal` per call; a timeout resolves as a failed tool result | A never-returning delegate does not hang the lead. Stop aborts, not defers |
| B5 | Errors back to the model: parse failure, schema failure, execution exception each become a tool result with a retry instruction | A malformed call costs one iteration, not a dead run. Blank tool name gets the terse "that was data" rejection **without** the catalogue |
| B6 | `observations` as a per-round array; turn-scoped paper derived per call, not mutated | Three calls on one line produce three observation lines. Turn N+1 carries nothing from turn N |
| B7 | Retry with backoff via a typed `effect_failed` fact; determinism guard on empty completions | The reducer sees failures. Two zero-output completions from the same `(model, finishReason)` stop retrying |
| B8 | Stages as `{brief, toolAllowlist, responseSchema}`. Phases deleted | `grep -rn phase packages/agent` returns only stage names |
| B9 | Tool registry with a per-tool availability predicate, fail-safe to unavailable | A tool the environment cannot run is not advertised. `mutates` and `isEvidence` are declared, not allowlisted by name |

**Definition of done:** every increment host-tested against `adapters-test` doubles; `packages/context` imported, never edited.

### Lane C — SPINE (`packages/core/**`, `packages/adapters-web/**`)

The heaviest lane. It owns the storage rewrite, which is the largest open item in this ruling.

| # | Increment | Done when |
|---|---|---|
| C1 | `App` aggregate + `handle` skeleton: route table, `problem` shape, 404 naming the address | Every one of the 25 routes returns its named view or `problem`. No route invents a view name |
| C2 | Segment log: `seg/{stream}/{n}` NDJSON, ~512 facts, compound numeric key `[stream, segmentIndex]` | **I20 test**: 10k facts, bounded record count, bounded boot transactions |
| C3 | Snapshots `snap/{stream}/{seq}` with `reducerVersions`; boot = newest matching snapshot + tail | Bumping a reducer's version invalidates its snapshot and replays from a segment boundary |
| C4 | Transactional persist; quarantine path for unreadable records | A failed write leaves the queue intact and retries. An unparseable record quarantines with a banner; boot completes |
| C5 | Reducer registry: every projection a named pure fold, memoised incrementally | No handler receives the event array. `dispatch` never clones the log |
| C6 | The effect driver: batched parallel execution, `turnId` stamping, signal propagation | Independent same-line calls run concurrently, results ordered by written order |
| C7 | `adapters-web`: IndexedDB kv + blob, OPFS files, brokered `fetch` with a per-origin allowlist | `durable()` returns `true`. `check-purity` still passes for the pure five |
| C8 | Model adapter with streaming (`onDelta`) and native call parsing | First token reaches the projection before the reply completes |
| C9 | Search: Firecrawl keyless default, vertical fallbacks, BYOK upgrade + `scripts-js/check-cors.js` in the gate | Search answers on arrival with no configuration |
| C10 | Attachments: OPFS-backed, `Part::File`/`Part::Image` into the turn | A dropped image reaches a vision model |
| C11 | Tool-result spill: results over a threshold go to the artifact store, re-spliced by handle | A 200KB result crosses a tool boundary without the model re-emitting a byte |

**Definition of done:** every projection named in `docs/SEAM.md` is produced by a registered reducer; `packages/{agent,context}` imported, never edited.

### Lane D — FACE (`apps/web/**`)

Can start immediately against the frozen seam using `adapters-test` doubles — it does not wait for lane C.

| # | Increment | Done when |
|---|---|---|
| D1 | Next static export skeleton: `output:'export'`, `basePath` from `PAGES_BASE_PATH`, `.nojekyll` asserted in `publish.sh` | Deep links work under the subpath; `_next/` is served |
| D2 | One component per view name, plus `problem`. Browser-only subtrees behind `next/dynamic({ssr:false})` inside a Client Component | A view the table does not list cannot be produced |
| D3 | State-grouped roster with the six-glyph vocabulary (shape = liveness, colour = state) | "Needs input" is above the fold by construction |
| D4 | Peek panel → attach with recap | One owner supervises N agents without opening N threads |
| D5 | Four-state tool inspector; three-status trace steps; plan panel with completed/total | Completed tools auto-open; running tools stay one line |
| D6 | Composer: three bands, status-morphing submit, context ring + hover breakdown | The 8192 argument becomes an observation |
| D7 | Motion: shimmer sweep (2s linear), View Transitions with `::view-transition{pointer-events:none}` and a `prefers-reduced-motion` block | Clicks during a transition are not lost |
| D8 | `Bun.WebView` probe replacing `shot.sh` + the two probe scripts; ratchets that only go up | Per-route screenshots and measurements from one TypeScript file, no Chrome dependency |

**Definition of done:** `grep -rn dangerouslySetInnerHTML apps/web` = **0**; no date, duration, plural or sort computed in `apps/web`; every fact rendered came from `response.data`.

---

## 6. What we refuse to build

| Refused | Why |
|---|---|
| **A second API dialect on a port** (`/v1/messages` + `/v1/chat/completions`) | A page cannot listen on a port (I1). Unsloth's version is genuinely how a tool becomes infrastructure, and it needs a host process we have not chartered. Recording it as refused-for-now, not overlooked |
| **Background/scheduled agents with the tab closed** | Nothing fires reliably with the tab closed on any browser we can depend on. An in-page scheduler with catch-up-on-open and Web Locks leader election is honest; "your agent runs while you sleep" is not, in a static page |
| **Bringing back the emulator** | 47 MB (`web/c2w`), 13–15× slower than a JIT, `durable() -> false`, no python3/node/git/curl/make/compiler, one shared PTY. It served four file operations OPFS provides natively |
| **Runtime plugin discovery / an extension-hook system** | Agent Zero's ~20 named hooks and `@extensible` decorator make control flow genuinely hard to follow — the hooks fire from a `while True` you cannot read linearly. Colocation (a module owns its prompt fragment and its view) is the good half; take that only |
| **A vector store / embeddings, first** | The 20-note cap is the defect. BM25/trigram over IndexedDB ships this week, works offline, needs no model. Embeddings are tier two, and FAISS is not portable |
| **`zod` or any dependency under `packages/**`** | The count is zero and stays zero. Per-fact validators are a few lines each; `isKnownFact` (`event.js:48`) is the pattern |
| **Tailwind, framer-motion, a chart library, `marked`+`dompurify`** | CSS Modules via Lightning CSS are dependency-free; the shimmer is one keyframe; the ring is 20 lines of SVG; markdown parses in the core into typed nodes and JSX escapes by construction |
| **Porting `FragmentBuilder` and the `hx_*` vocabulary** | `grep -rn '\.hx_' crates` = 1. The justification for an HTML body died before the rewrite did |
| **A generic public CORS proxy as a fallback** | Measured: `allorigins` 502, `codetabs` 522, `thingproxy` timeout, `corsproxy.io` 403 paywalled, `corsfix` 403 domain-not-registered. A dependency that is down is worse than an absent feature |
| **Public SearXNG instances as the search default** | 60 of 76 healthy instances returned 429; **2** emit any `access-control-allow-origin`, and both were rate-limited at the same moment |
| **`r.jina.ai` keyless as the reader default** | Hard 401: *"blocked from performing anonymous queries due to bad network reputation (AS7922)"* — a consumer residential ISP. Its CORS layer is fine; its anonymous tier is IP-gated against exactly our users |
| **Reviving the phase machine, `PlanStep`, `ExitCondition`, `Verdict`** | Zero writers and zero readers across 67,476 lines. Rebuilding an unbuilt subsystem in a new language is the most expensive way to learn nothing |
| **The forge's HTML extension point** | `Logic::Script` returns 501; `forge.rs` was deleted. It is the only real argument for markup crossing the seam, and it is defending a subsystem that does not exist. Reserve one closed-vocabulary node union and pay nothing else |
| **`--compile --target=browser` as the production deploy** | Attractive after the SRI incident, and the +33% base64 overhead plus no `--splitting` costs us the per-route entry points Next gives free. Keep it as a fallback single-file artifact, not the path |
| **Any claim in `docs/ROADMAP.md` taken on trust** | Five teams re-verified that file and each found claims that no longer held; eleven were reported before its correction table was written, and re-running the reports found errors *in those*. Every load-bearing number in this document was settled with a command in this checkout |