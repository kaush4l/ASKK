# RESEARCH.md — G0 findings

G0 ran as 15 parallel units (4 spikes as running code, 6 research docs, plus G1/G2 drafts).
Full evidence lives in `docs/research/*.md` and `spikes/*/README.md`; this file is the §18
checklist synthesis. Per finding: **true / uncertain / constrains**.

## Spikes (all ran; none partial)

**Spike A — the seam** (`spikes/seam/`): TRUE — Rust `handle(Request) -> Response` → Wasm serves
fragments to unmodified vendored htmx 2.0.10 through a ~35-line extension; 6/6 native + 2/2
headless-Chrome tests. Streaming proven as core-driven `hx-trigger` chaining (3 progressive
chunks, zero streaming JS). UNCERTAIN — hop latency (~1 s observed vs 250 ms declared) in the
headless harness; Worker-hosted variant untested. CONSTRAINS — ADR-002 accepted PROVISIONAL;
G4 must re-measure chaining latency in a real page and drive the Worker transport.

**Spike B — forged module** (`spikes/forge/`): TRUE — Rhai module loaded from a data string
serves a route, renders a fragment; default-deny + one grant works with typed errors; manifest
is an enforced upper bound (grants = declared ∩ host-granted); 6/6 host tests; wasm32 build
452 KB. CONSTRAINS — ADR-003 accepted PROVISIONAL (Rhai); capability binding surface fixed as
per-module Engine + closures.

**Spike C — the paper** (`spikes/paper/`): TRUE — 11-section Document assembles pure, renders to
OpenAI chat, golden-tested; volatile-only change leaves the prefix byte-identical through the
last Dynamic section; degradation deterministic and recorded. CONSTRAINS (4 frictions → ADR-009):
`response_contract` placement trades cache vs recency; compaction field must split declared-floor
vs current-level; summaries must be precomputed artifacts in `State` (pure assemble cannot
author them); the degradation notice renders at the tail.

**Spike D — IndexedDB** (`spikes/idb/` + `docs/research/indexeddb.md`): TRUE — hand-rolled
web-sys KV is ~70 lines of once-written plumbing; put p50 0.11 ms / get p50 0.07 ms (relaxed
durability); `indexed_db_futures` costs a 52-crate tree and conflicts with the wasm-bindgen pin.
CONSTRAINS — eviction is the real risk (whole-origin LRU; Safari 7-day ITP wipe): call
`navigator.storage.persist()`, surface grant state, make export first-class (ADR-005).

## §18 research list

**Prompt caching** (`docs/research/prompt-caching.md`): TRUE — all six providers are exact
longest-prefix caches; §8.3 stable-first ordering confirmed universally, the §18 escape hatch is
NOT triggered. Minimums 512–4096 tokens → engineer for a ≥4K static prefix; boundary after
Semi-static. CONSTRAINS — `render` needs a per-provider post-pass (Anthropic `cache_control`
breakpoints, OpenAI `prompt_cache_key`); volatile media must trail the last breakpoint.

**Multimodal + tokens** (`docs/research/multimodal-and-tokens.md`): TRUE — the real
"OpenAI-compatible" intersection is text + base64 image + system role only; canonical Part =
bytes, not URLs; 3 render targets suffice (OpenAiChat+capability flags, Anthropic, Gemini).
Token counting v1 = chars-heuristic + per-model EMA from provider `usage`, budgets ≤80% of
context; no shipped tokenizer (1.2–8.8 MB, OpenAI-only exactness). CONSTRAINS — audio degrades
to transcript with a recorded ledger entry (I15), never a silent drop.

**Provider CORS** (`docs/research/provider-cors.md`): TRUE (live-probed from the real origin) —
seven first-class BYOK providers: Anthropic (with `anthropic-dangerous-direct-browser-access`),
Gemini, OpenRouter, Groq, Mistral, Together, DeepSeek. UNCERTAIN — OpenAI direct (preflight
passes; 401 path lacks ACAO); verify with a live key or route via OpenRouter. CONSTRAINS —
BYOK key is browser-visible by design (XSS = key theft; recommend scoped/credit-limited keys);
Chrome 142+ Local Network Access prompt gates page→localhost model calls.

**Prior-art prompts** (`docs/research/prior-art-prompts.md`): TRUE — 5-system table from primary
source; Hermes has the best degradation ladder; OpenClaw uses numeric file priority + stable
prefix; ASKK's own Clock-at-position-3 busted its cache (lesson encoded in §8.3). Corrections to
PROMPT §4: Ada-SI is public; the `{success, data}` envelope is a paraphrase. CONSTRAINS —
OpenClaw/Hermes mutate history mid-stream, incompatible with I7/I14: HARNESS compacts only
inside `assemble`. Ada-SI's forge reduces cleanly: human gates survive, venv/pip machinery
collapses, dry-run and production share the interpreter.

**Script engines** (`docs/research/script-engine.md`): TRUE (measured) — Rhai 1.30 MB opt,
Koto 1.12, Steel 2.42, Boa 2.53; rquickjs/mlua FAIL in-core (rquickjs 0.72 MB as wasip1).
In-core C engines disqualified: shared linear memory + quickjs-ng CVEs. CONSTRAINS — ADR-003
Rhai, with the named reversal trigger (LLM-authoring failures → QuickJS as Tier 3 WASI).

**Phase cut** (`docs/research/phase-cut.md`): TRUE — the predecessor's gemma loop (e853fc7) was
a mandatory-Plan + repair-loop failure, not a phase-machine failure; Reflexion-style Verify pays
only with concrete checkable feedback; ReWOO-style Plan pays on long tasks only. CONSTRAINS —
ADR-010: **Work/Verify default, Plan-on-demand, Answer as a cheap fourth exit**; every graph has
a cheap exit; mechanical checks run before LLM Verify; reversal is a routing-config one-liner.

## Deltas against PROMPT §4/§5/§7/§8 (reported per §20)

1. §4 table: Ada-SI is public (`nazirlouis/Ada-SI`); tool envelope `{success, data}` is a
   paraphrase of OpenClaw's `AgentToolResult { content, details }`.
2. §5's streaming options omitted the winner: core-driven chaining (no SSE ext, no OOB JS).
3. §8.2's `response_contract` "Static per phase" conflicts with recency-based prior art —
   resolved in favor of cache (placed in the static region, last), flagged in ADR-009.
4. §9's Plan/Work/Verify symmetric cut is softened by evidence to Work/Verify + Plan-on-demand.
5. §11's layering table had two real bugs (unconstrained intra-domain imports; impossible
   wiring) — fixed in ARCHITECTURE.md (composition root = `adapters_web`).
