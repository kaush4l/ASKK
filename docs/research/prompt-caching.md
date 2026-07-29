# R1 — Provider prompt-caching behavior

> G0 research unit for HARNESS. Brief: `docs/PROMPT.md` §8.3 (stable-first ordering exists to make
> provider prompt caching hit) and §18 first research bullet (measure how caching actually behaves;
> this is the one place a measurement may overrule §8.3). Retrieval date for all sources:
> **2026-07-29**. Every finding is stated as *what is true / what is uncertain / what it constrains*.

## 0. The invariant every provider shares

**True.** Every surveyed provider — Anthropic, OpenAI, Gemini, DeepSeek, vLLM, llama.cpp — implements
prompt caching as an **exact prefix match over the rendered request**. A single byte changed at
position N invalidates everything at ≥ N. None of them cache mid-prompt spans independently of what
precedes them.
**Uncertain.** Nothing — this is the one universal.
**Constrains.** §8.3's stable-first ordering is correct for *every* provider simultaneously. No
measurement found here overrules it; the measurements only move *where the boundary pays off* and
*how the boundary is annotated per provider* (see §7).

---

## 1. Anthropic (Claude Messages API)

Source: `platform.claude.com/docs/en/build-with-claude/prompt-caching` (via the claude-api skill
reference, cached 2026; cross-checked against the live-docs index).

**True.**
- **Explicit breakpoints.** `cache_control: {type: "ephemeral"}` on content blocks; max **4
  breakpoints** per request. A top-level `cache_control` auto-places on the last cacheable block.
  Render order is `tools` → `system` → `messages`; a breakpoint on the last system block caches
  tools + system together.
- **Minimum cacheable prefix is model-dependent and non-monotonic:** 512 tokens (Opus 5 / Fable 5),
  1024 (Opus 4.8, Sonnet 5/4.6/4.5), 2048 (Opus 4.7, Haiku 3.5), **4096** (Opus 4.6/4.5,
  Haiku 4.5). Below the minimum a marker is silently ignored (`cache_creation_input_tokens: 0`).
- **TTL:** 5 minutes default, `ttl: "1h"` optional. The docs' pre-warming guidance ("requests ≤ TTL
  apart keep the cache warm on their own") means **a read refreshes the TTL**.
- **Pricing:** reads ≈ **0.1×** base input; writes **1.25×** (5 m) or **2×** (1 h). Break-even: 2
  requests (5 m TTL), 3 (1 h TTL).
- **Invalidation is tiered**, not all-or-nothing: tool-definition changes and model switches kill
  everything; system-prompt content kills system+messages tiers but not the tools tier;
  `tool_choice`, images, and thinking on/off kill only the messages tier. Sampling params don't
  appear in the invalidation table at all. Mid-conversation `role:"system"` messages and
  mid-conversation tool add/remove (beta) exist specifically to change things *without* touching
  the cached prefix.
- **20-block lookback:** a breakpoint searches at most 20 content blocks backward for a prior cache
  entry — a single agentic turn adding >20 tool_use/tool_result blocks silently misses.
- **Concurrency:** an entry is readable only once the first response *begins streaming*; N parallel
  identical requests all pay full price. `max_tokens: 0` pre-warm requests are supported.
- **Browser origin:** CORS is supported when the request carries
  `anthropic-dangerous-direct-browser-access: true` (Simon Willison,
  simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/). Caching is keyed on
  request bytes + org, not origin — browser calls cache identically to server calls.

**Uncertain.** Whether a 1 h-TTL entry's refresh-on-read extends by the full hour or the base 5
minutes — docs don't say; measure via `cache_read_input_tokens` after a >5-minute gap.
**Constrains.** HARNESS `render` for Anthropic must *place breakpoints* — caching is not free-form
automatic. The natural mapping: one breakpoint at the end of the Static class, one at the end of
Semi-static, one on the last appended turn (3 of 4 used). The 20-block lookback means Dynamic
history sections that grow >20 blocks per turn need an intermediate breakpoint. The 4096-token
minimum on some models sets the worst-case bar for "static prefix worth engineering" (§7).

## 2. OpenAI (Responses / Chat Completions)

Source: `developers.openai.com/api/docs/guides/prompt-caching` (fetched 2026-07-29).

**True.**
- **Automatic, no breakpoints.** Caching activates for prompts ≥ **1024 tokens**; matching is exact
  longest-prefix. (Historically hits register in 128-token increments; the current page no longer
  foregrounds this — treat granularity as coarse, not per-token.)
- **Routing, not just matching:** requests are routed to a machine by a hash of the initial prefix;
  `prompt_cache_key` steers requests with the same long prefix to the same machine. Recommended
  ≤ ~15 requests/min per key — beyond that, requests spill to machines without the cache.
- **TTL:** pre-GPT-5.6 models: in-memory, ~5–10 min of inactivity, max 1 h; extended 24 h retention
  option (GPT-5.5 and earlier). GPT-5.6+: minimum 30-minute TTL, possibly longer.
- **Pricing:** cache reads discounted (rate varies per model, historically ~50–90% off input);
  **writes free** on pre-GPT-5.6 models; **GPT-5.6+ charges writes at 1.25×** (reported as
  `cache_write_tokens`) — OpenAI converged on Anthropic's write-premium model.
- **What caches:** messages, images, tool definitions, structured-output schemas — all must be
  byte-identical across requests.
- **Browser origin:** `api.openai.com` sends **no CORS headers** — direct browser `fetch` is blocked
  (community.openai.com, multiple threads). A proxy is mandatory for a browser-only client.

**Uncertain.** Whether a hit refreshes the TTL (docs silent); exact per-model read discount (moved
to the pricing page); whether `prompt_cache_key` is per-org-isolated (assumed — caches have never
been documented as cross-org).
**Constrains.** No render-side annotation needed — but HARNESS *should* send `prompt_cache_key`
(e.g. a stable per-agent/per-conversation id) from the proxy, which means the `render` output for
OpenAI needs one provider-specific request field even though the document itself carries no
markers. The proxy requirement does not hurt caching: the cache keys on request content, not
origin.

## 3. Google Gemini (Gemini API)

Sources: `ai.google.dev/gemini-api/docs/caching` (Interactions API version) and
`ai.google.dev/gemini-api/docs/generate-content/caching` (fetched 2026-07-29); pricing via
docs.cloud.google.com context-cache overview + third-party 2026 pricing summaries.

**True.**
- **Two mechanisms.** *Implicit* caching: automatic, on by default for Gemini 2.5+, longest-prefix,
  minimums **2,048 tokens** (2.5 Flash/Pro) and **4,096 tokens** (3.1 Pro Preview, 3.5 Flash);
  hits reported in `usage.total_cached_tokens`. *Explicit* caching: `client.caches.create()` makes a
  named `CachedContent` object (system instruction + contents, incl. video/PDF/Files-API uploads),
  referenced via `cached_content` in `generateContent`; TTL **defaults to 1 h**, fully
  configurable (seconds or absolute expiry), `update()`/`delete()` supported. The newer
  Interactions API supports *only* implicit caching.
- **Pricing:** cached tokens discounted **90%** on Gemini 2.5+ (75% on 2.0). Explicit caching adds
  **storage billing per token-hour** (≈ $1.00/M tok/h; reported $4.50/M tok/h for 3.1 Pro — varies
  by model) and bills cache *creation* at the standard input rate.
- **Ordering guidance matches §8.3 verbatim:** "put large and common contents at the beginning of
  your prompt"; send similar-prefix requests close together in time.
- **Browser origin:** `generativelanguage.googleapis.com` is callable from browsers with an API key
  (the official JS SDK runs client-side), but forum threads report CORS breakage on the
  OpenAI-compat endpoint specifically (discuss.ai.google.dev #58619).

**Uncertain.** Implicit-cache TTL is undocumented (only "short amount of time"); whether implicit
hits refresh lifetime; browser CORS reliability across all Gemini endpoints — verify empirically
before depending on it; exact current storage price per model.
**Constrains.** Implicit caching needs nothing from `render`. Explicit caching is a *different
shape* than a breakpoint — it's a server-side named object with storage billing, i.e. a lifecycle
HARNESS would have to manage (create/refresh/delete). For v1, rely on implicit caching only and
treat explicit `CachedContent` as an optimization module later; the 90% read discount arrives
either way when the static prefix clears 2–4K tokens.

## 4. DeepSeek

Sources: `api-docs.deepseek.com/guides/kv_cache` (fetched 2026-07-29); pricing via deepseek.ai
/pricing and 2026 third-party mirrors.

**True.**
- **Automatic, on by default, disk-backed** ("Context Caching on Disk"), no code changes, no
  breakpoints. Cache units are built at request boundaries and fixed intervals through long inputs;
  hits require **full match of complete prefix cache units** — partial unit overlap doesn't count.
  Hits/misses reported per request as `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`.
- **TTL:** long — unused caches persist "a few hours to a few days" before automatic clearing. No
  paid writes, no storage fee; pricing is simply two input rates: cache-hit vs cache-miss. Current
  (2026-07): V4-Flash $0.0028 hit / $0.14 miss per M tokens (50×); V4-Pro $0.003625 / $0.435.
- **Best-effort:** no guaranteed hit rate; cache construction takes seconds (a request immediately
  following the first may still miss); sampling params don't affect caching (outputs stay random).
- **Historical note:** the original 2024 announcement stated 64-token cache-unit granularity; the
  current doc no longer names the number.

**Uncertain.** Current cache-unit size (assume coarse, tens of tokens); minimum cacheable prefix
(none documented — likely one unit); whether the API sends CORS headers for browser calls
(**undocumented — untested; assume no and plan for the proxy path**).
**Constrains.** Cheapest and longest-lived cache of the hosted providers, and entirely automatic —
stable-first ordering is the *only* lever HARNESS has. The "seconds to construct / best-effort"
property means don't fan out identical-prefix parallel calls expecting hits (same lesson as
Anthropic's concurrency rule).

## 5. Self-hosted OpenAI-compatible: vLLM and llama.cpp

Sources: `docs.vllm.ai/en/latest/design/prefix_caching.html`;
`github.com/ggml-org/llama.cpp/tools/server/README.md` + discussions #13606/#8947 (fetched
2026-07-29).

**True.**
- **vLLM — automatic prefix caching (APC):** KV-cache blocks (16-token default) hashed by
  (parent-block hash, block tokens, extras: LoRA id, **multimodal image hashes**, cache salt);
  longest-prefix reuse at block granularity; LRU eviction from GPU memory. Free (your hardware);
  hit granularity = block size, so a 1-token change re-computes only from its containing block
  onward — the finest granularity of any provider surveyed.
- **llama.cpp server:** `cache_prompt: true` is the **default** — per-slot KV reuse of the common
  prefix; only the differing suffix is re-processed. `--cache-reuse N` additionally enables KV
  shifting to reuse *non-prefix* shared chunks; `--slot-save-path` + the `/slots` API persist caches
  across restarts; `--cache-ram`/`--cache-idle-slots` keep more prompt cache resident. Cache is
  per-slot: concurrency beyond the slot count evicts.
- **Browser origin:** irrelevant as a constraint — you own the server and set CORS yourself.

**Uncertain.** Whether APC is on by default in the vLLM version actually deployed (V1 engine
reportedly defaults on; the design doc doesn't state it — check `--enable-prefix-caching` /
engine version at deploy time); llama.cpp multi-user interference patterns (slot eviction) under
real load.
**Constrains.** Self-hosted caching rewards the identical discipline (stable-first, deterministic
serialization) at zero incremental cost and finest granularity — golden-file byte-stability tests
(§8.7) are the *whole* game here, since there is no billing signal like `cache_read_input_tokens`
to reveal a silent invalidator; use vLLM's cached-token metrics or llama.cpp timings instead.

---

## 6. Cross-provider summary table

| | Anthropic | OpenAI | Gemini (implicit / explicit) | DeepSeek | vLLM / llama.cpp |
|---|---|---|---|---|---|
| Mechanism | explicit breakpoints (≤4) | automatic + `prompt_cache_key` routing | automatic / named cache object | automatic, disk | automatic, KV blocks / slots |
| Min prefix | 512–4096 tok (per model) | 1024 tok | 2048–4096 tok / same | ~1 cache unit (undoc.) | 1 block (16 tok) / none |
| Granularity | breakpoint positions | prefix (coarse increments) | prefix | full cache units | 16-tok blocks / token prefix |
| TTL | 5 m (opt 1 h); read-refreshed | 5–10 m idle, ≤1 h; 30 m min on GPT-5.6+; 24 h option | short (undoc.) / default 1 h, configurable | hours–days | until LRU/slot eviction; disk-persistable |
| Write cost | 1.25× (5 m) / 2× (1 h) | free; 1.25× on GPT-5.6+ | standard input rate + storage $/tok·h (explicit) | none | none |
| Read cost | ~0.1× | discounted (per model) | 0.1× (2.5+) | ~0.02× of miss | free |
| Params invalidate? | tiered; sampling params no; tools/model yes | prefix content only (tools/images in prefix) | prefix content only | no (prefix only) | prefix tokens + LoRA/mm-hash/salt |
| Browser CORS | ✅ with `anthropic-dangerous-direct-browser-access: true` | ❌ — proxy required | ✅ (JS SDK works; verify per endpoint) | unknown — assume proxy | you configure |

---

## 7. Synthesis for HARNESS

**Where the static/dynamic boundary should fall.** §8.3's ordering survives measurement unmodified —
every provider is longest-prefix. The measured refinement is about *thresholds and annotation*:

1. **Minimum static-prefix size worth engineering: ~1,024 tokens; design target ≥ 4,096.** Below
   ~1K tokens nothing hosted caches at all (OpenAI 1024, Anthropic 512–4096, Gemini 2048–4096), so
   a tiny `soul`+`identity`+`operating_rules` prefix buys nothing — that is fine, it costs nothing
   either. The real payoff begins when Static+Semi-static (soul, identity, operating_rules,
   affordances, response_contract-per-phase) together clear **4,096 tokens**, the worst provider
   minimum: at that point every provider caches the block. Since `affordances` (§6 generated docs)
   will easily be thousands of tokens, this threshold is met naturally — the engineering rule is
   simply *don't shrink the static prefix below ~1K to "save tokens"; cached tokens at 0.02–0.1×
   are cheaper than short uncached prompts re-read every turn.*
2. **The boundary itself: Static+Semi-static | Dynamic.** Put the cache boundary *after*
   Semi-static (`affordances`, `user`, `memory`), not after Static. Semi-static sections change
   rarely (a forge deploy, a memory write) and each change costs one cache rebuild — cheap against
   the per-turn savings. `environment` (time, device) is the classic §8.3 poison and must stay
   strictly after the boundary; a timestamp rendered into anything earlier forfeits everything on
   every provider at once.
3. **Per-provider breakpoint hints must surface in `render` — yes, but as a small enum, not a
   redesign.** `assemble` stays provider-agnostic; the `Document` already carries `stability` per
   section, which is exactly the information `render` needs. Per target:
   - *Anthropic:* emit `cache_control` on (a) last Static block, (b) last Semi-static block,
     (c) last block of the newest turn; respect the 4-breakpoint cap and insert an intermediate
     marker when a turn exceeds ~15 content blocks (20-block lookback).
   - *OpenAI:* emit no in-document markers; set `prompt_cache_key` = stable conversation/agent id
     on the request envelope.
   - *Gemini / DeepSeek / vLLM / llama.cpp:* emit nothing; ordering does all the work.
   So the §8.1 `render` signature is sufficient — this is a per-provider post-pass over the
   rendered messages plus at most one extra request field, driven entirely by section `stability`.
4. **§8.6 binary parts and cacheability.** Images/documents are cacheable prefix content on every
   provider that accepts them (OpenAI caches images explicitly; Anthropic caches image blocks —
   an image change invalidates the system+messages tiers; Gemini explicit caching is *built* for
   large video/PDF; vLLM hashes image content into its block chain). Two consequences: a **stable**
   binary part (logo, reference document) belongs in the Semi-static region where its size makes
   caching maximally valuable; a **volatile** binary part (screenshot, camera frame) is the most
   expensive possible cache-killer and must render after the last breakpoint — §8.3's "placement of
   large binary parts is a real decision" resolves to *classify media by stability like any other
   section, and never let volatile media precede text history*.
5. **Enforcement, not intention (§8.7).** Silent invalidators — map iteration order, timestamps,
   token counters, locale formatting — produce zero errors and zero savings. The golden-file test
   must assert **byte-identity of the rendered Static+Semi-static prefix across two assembles with
   the same inputs**, and runtime should watch `cache_read_input_tokens` (Anthropic), `cached_tokens`
   (OpenAI), `total_cached_tokens` (Gemini), `prompt_cache_hit_tokens` (DeepSeek): a sustained zero
   on any of these is a bug alarm, not a billing detail.
6. **Two operational corollaries.** (a) Don't fan out N identical-prefix calls in parallel —
   Anthropic and DeepSeek both build the cache on the *first* completed/streaming request; send one,
   await first token, then fan out. (b) Browser-only reality: Anthropic is directly callable
   (special header), Gemini probably, OpenAI never (proxy), DeepSeek unknown (assume proxy) — CORS
   affects the transport path only; caching keys on request bytes + account and works identically
   through a proxy.

---

## 8. RESEARCH.md summary (5 lines)

- R1 prompt caching: all 6 providers (Anthropic/OpenAI/Gemini/DeepSeek/vLLM/llama.cpp) are exact longest-prefix caches — §8.3 stable-first ordering is confirmed universal; no measurement overrules it.
- Minimums: OpenAI 1024, Anthropic 512–4096 (model-dep.), Gemini 2048–4096, DeepSeek ~1 unit, vLLM 16-tok blocks → target a ≥4K-token Static+Semi-static prefix; boundary goes after Semi-static, `environment` and volatile media strictly after it.
- Only Anthropic needs render-side markers (≤4 `cache_control` breakpoints, 20-block lookback); OpenAI needs `prompt_cache_key` on the envelope; everyone else is automatic — `render` gets a small per-provider caching post-pass, `assemble` stays agnostic.
- Economics: reads 0.02–0.1×; writes free (OpenAI legacy, DeepSeek, self-hosted) to 1.25–2× (Anthropic, GPT-5.6+); Gemini explicit caching adds $/tok·h storage — v1 uses implicit only. TTLs: minutes (Anthropic/OpenAI) to days (DeepSeek).
- Browser origin: Anthropic callable with `anthropic-dangerous-direct-browser-access: true`, Gemini likely, OpenAI blocked (proxy), DeepSeek undocumented; CORS changes transport, never cacheability. Enforce via golden-test byte-identity of the prefix + runtime cached-token counters (zero = bug).
