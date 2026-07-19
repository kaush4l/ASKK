# 02 — State & Memory Review (boop-agent)

Status: review. Scope: what boop stores, how the memory pipeline works, and how each
piece maps to browser-only storage. Lifecycle/scheduling is `01-runtime-lifecycle.md`,
cross-device sync is `03-sync-devices.md`, LLM transport is `04-llm-transport.md`.
All boop cites are against the clone's `convex/` and `server/` trees.

## 1. Where state lives

Convex (hosted realtime DB) is the **sole truth store**. The Node server holds no
durable state of its own — every read/write goes through `server/convex-client.ts`
into the 13 tables of `convex/schema.ts`. Images live in Convex `_storage` and are
referenced by id (`convex/schema.ts:12`, `:54`). The one on-disk exception is a
~1.3GB HuggingFace model cache for the local embedding fallback
(`server/embeddings.ts:19-26`) — a cache, not state.

## 2. Schema review, table by table

| Table | Purpose (schema.ts) | Verdict |
|---|---|---|
| `messages` | transcript rows, per-conversation + per-turn indexes, image storage refs (`:5-17`) | Clean. Conversation-scoped indexes are exactly the query shape a chat UI needs. |
| `conversations` | thread metadata: title, summary, messageCount, lastActivityAt (`:19-25`) | Fine. Denormalized counters are the right call for a list view. |
| `memoryRecords` | the memory store — tier, segment, importance, decayRate, accessCount, lifecycle, supersedes, 1024-dim embedding + vectorIndex (`:27-64`) | The centerpiece; detailed below. |
| `executionAgents` | one row per spawned background agent: status FSM, token/cost totals (`:66-96`) | Good — agent runs as data, inspectable after the fact. |
| `usageRecords` | append-only per-LLM-call cost log, tagged by source (dispatcher/extract/consolidation-*/…) (`:101-128`) | Excellent. Append-only, never mutated, queryable by source/conversation. Keep verbatim. |
| `agentLogs` | per-agent thinking/tool_use/tool_result stream (`:130-146`) | Fine as an append-only debug stream. |
| `memoryEvents` | append-only audit of memory pipeline actions (extracted/recalled/cleaned) (`:148-157`) | Good — the memory system explains itself. |
| `automations` + `automationRuns` | cron-style standing tasks + per-run outcome rows (`:159-178`, `:233-248`) | Good split: definition vs execution history. Timezone pinned at create time (`:166-169`) is a thoughtful detail. |
| `drafts` | staged external actions (email/message) with pending/sent/rejected/expired status (`:185-201`) | The best idea in the schema: **the human-approval gate is a data row**, not code flow. Keep verbatim. |
| `consolidationRuns` | per-run record incl. full proposals/decisions JSON for post-hoc inspection (`:203-222`) | Good provenance. |
| `sendblueDedup` | iMessage webhook claim table (`:180-183`) | Transport artifact; irrelevant to a browser build (see 04). |
| `settings` | kv rows overriding `.env` at runtime (`:227-231`) | Good pattern (reconfigure without redeploy). In a browser there is no `.env`, so settings simply become *the* config store. |

### What's well-designed

- **Append-only where it matters.** `usageRecords`, `memoryEvents`, `agentLogs` are
  never rewritten; state tables (`memoryRecords`, `drafts`) carry explicit status
  enums instead of deletes.
- **Lifecycle + provenance.** Memories are never hard-deleted: `lifecycle`
  active/archived/pruned plus `supersedes: string[]` (`schema.ts:45-46`) means every
  consolidation decision is reconstructable, and `consolidationRuns.details`
  (`:215-217`) keeps the reasoning.
- **Draft gate as data.** External side effects pause in `drafts` until a human
  flips the status. This is the correct trust boundary for a proactive agent and
  ports to any storage backend unchanged.
- **Segment defaults as a table, not scattered ifs.** `SEGMENT_DEFAULTS` in
  `server/memory/types.ts:37-45` maps each segment to tier/importance/decayRate in
  one place (identity → permanent/0.85/0.01 … context → short/0.40/0.08).

### What's questionable

- **Embedding inline on the row** (`schema.ts:47`): every memory read drags a
  1024-float array along. Convex's vectorIndex makes this workable there; in a
  browser store you'd separate hot metadata from vectors (see §4).
- **`metadata` and event `data` as JSON strings** (`schema.ts:52`, `:153`,
  `:215-217`): schema-less blobs the DB can't index or validate. The comment at
  `schema.ts:48-52` admits it's deliberate looseness; acceptable for a sidecar,
  but it leaks into `consolidationRuns.details` where structure would pay.
- **Single-user assumption everywhere.** No user id on any table; `settings` is a
  global kv; `memoryRecords` has no owner. Fine for boop's one-person deployment —
  and conveniently, a browser origin is *also* single-user, so this "flaw" costs a
  browser port nothing (multi-device is 03's problem, not a schema problem).
- **1024-dim everywhere as a compatibility contract**: Voyage, OpenAI, and local
  BGE-large are all forced to 1024 dims so the vector index never changes
  (`server/embeddings.ts:1-18`). Pragmatic, but it means the *largest* local model
  (~1.3GB) was chosen to match the hosted dimension, not because recall needs it.

## 3. Browser mapping per table

Target: everything below runs on one origin using **IndexedDB** (structured rows,
compound indexes via composite keys), **OPFS** (`navigator.storage.getDirectory()`,
byte-level blob files), and the **Cache API** (`caches.open()`, request/response
pairs). All three share one origin-scoped quota; `navigator.storage.persist()`
requests exemption from eviction and `navigator.storage.estimate()` reports usage.

| Boop table | Browser home | Notes |
|---|---|---|
| `messages`, `conversations` | IndexedDB | Compound index `[conversationId, createdAt]` reproduces `by_conversation_turn`. |
| `memoryRecords` (metadata) | IndexedDB | Indexes on tier/segment/lifecycle are plain IDB indexes. |
| `memoryRecords.embedding` | IndexedDB, **separate object store** keyed by memoryId, value = `Float32Array` | IDB structured-clones typed arrays natively. Splitting vectors from metadata keeps list/decay scans cheap — the browser answer to the inline-embedding smell. |
| images (`_storage` refs) | OPFS | One file per content hash; IDB rows store the hash. Blobs don't belong in IDB rows. |
| embedding model weights | Cache API (or OPFS) | transformers.js already caches model fetches in the Cache API by default in browsers — the browser-native replacement for boop's `data/huggingface-cache` dir (`server/embeddings.ts:19-24`). |
| `executionAgents`, `agentLogs`, `usageRecords`, `memoryEvents` | IndexedDB | Append-only stores; `usageRecords.by_source` → IDB index on `source`. |
| `automations`, `automationRuns`, `drafts`, `consolidationRuns` | IndexedDB | Row-shaped, low volume. |
| `settings` | IndexedDB | Becomes the only config source (no env). Do **not** use localStorage — it's synchronous and invisible to workers. |
| `sendblueDedup` | dropped | Webhook-ingress artifact; no server, no webhook (04). |

Scale check: years of personal use is tens of MB of rows plus images. The only
heavyweight item is model weights (§4). Chromium origins get a generous share of
disk; the real risks are (a) eviction of a non-persisted origin under pressure —
call `navigator.storage.persist()` at first run — and (b) **ASKK's observed trap**:
OPFS throwing "quota exceeded" at KB scale in some embedded preview/webview
contexts despite free disk. Mitigation ASKK already uses: feature-probe OPFS at
boot and fall back to in-memory blobs; keep everything row-shaped in IndexedDB so
OPFS flakiness only degrades images/weights, never the memory store.

## 4. In-browser vector recall

Boop's recall path is embed-the-query → Convex `vectorSearch` over the
`by_embedding` index filtered to `lifecycle: active`
(`server/memory/tools.ts:79-83`, `convex/memoryRecords.ts:115-127`).

The browser replacement needs **no vector database**:

- **Embeddings in-browser.** transformers.js runs feature-extraction pipelines on
  WASM or WebGPU in the page/worker — the exact library boop already uses for its
  local fallback (`server/embeddings.ts:85-92`), and the pattern ASKK's features
  lab already ships for Gemma/Whisper. Same `pipeline("feature-extraction", …,
  { pooling: "mean", normalize: true })` call, different runtime.
- **Brute-force cosine is enough.** At personal scale (thousands of memories),
  a dot product over normalized `Float32Array`s is ~1k floats × ~5k vectors ≈ 5M
  multiply-adds — single-digit milliseconds in a worker. HNSW/voy-class libraries
  are justified only past ~10^5 vectors; adopting one now is speculative.
- **Pick a smaller model.** BGE-large's 1024 dims exist to match the hosted
  providers' dimension contract (§2), not for recall quality at this corpus size.
  A bge-small-class model (384-dim, ~130MB fp32, ~35MB q8) cuts weights ~10× and vector
  storage ~2.7×, with negligible recall loss over a few thousand short personal
  facts. Dimension becomes a local constant — there is no shared index to keep
  compatible. Optionally keep boop's provider ladder (Voyage/OpenAI over fetch →
  local) as a quality upgrade path, but then the *local* model's dimension is the
  contract and hosted results get truncated/normalized to it, inverting
  `server/embeddings.ts`'s priority.
- **`embed()` returning null on failure** (`server/embeddings.ts:134-143`) — keep
  that contract: memories without embeddings still exist, they're just invisible
  to vector recall until backfilled.

## 5. Memory jobs in the browser

Boop's pipeline is three loops on a resident server:

1. **Extraction** — post-turn, fire-and-forget: `extractAndStore(...).catch(...)`
   after the reply is sent (`server/interaction-agent.ts:635-650`); one background
   LLM call parses facts, applies `SEGMENT_DEFAULTS`, embeds, upserts, and logs
   its own cost to `usageRecords` (`server/memory/extract.ts:48-144`).
2. **Decay/clean** — every 6h (`server/memory/clean.ts:84-89`): adaptive
   exponential decay where half-life stretches with importance, times an
   `1 + log1p(accessCount) × 0.1` reinforcement (`clean.ts:28-43`); score < 0.15 →
   archive, < 0.05 → prune (`clean.ts:5-6`); `permanent` tier exempt (`clean.ts:59`).
3. **Consolidation** — every 24h (`server/consolidation.ts:481-486`): adversarial
   proposer → adversary → judge LLM trio producing merge/supersede/prune decisions,
   fully logged to `consolidationRuns`.

Browser translation:

- **Extraction** ports directly: after rendering the reply, queue the extraction
  job (same fire-and-forget shape). Post it to a Web Worker so embedding doesn't
  jank the UI; `requestIdleCallback` is fine for the scheduling nudge but the work
  itself belongs in a worker.
- **Decay is pure math over stored timestamps** — this is the key insight. Nothing
  breaks if the 6h loop doesn't run; `effectiveScore` recomputes correctly from
  `lastAccessedAt` whenever it *does* run. So: run a catch-up sweep on app open
  plus opportunistic idle-time sweeps. No resident process needed.
- **Consolidation** is the same catch-up shape (compare `consolidationRuns` last
  `startedAt` against a 24h threshold on app open) but it burns real LLM tokens and
  takes minutes, so gate it on idle + explicit or remembered consent. The deeper
  issue — a browser tab has no guaranteed 24h heartbeat (`setInterval` dies with
  the tab; there is no general-purpose long-interval timer a page can rely on) —
  is `01-runtime-lifecycle.md`'s problem. The state-side requirement is only that
  every job is **resumable and idempotent from stored state**, which boop's design
  already satisfies (runs recorded in `consolidationRuns`, decay stateless).
- **Single-writer**: boop gets serialization for free from one Node process +
  Convex. Two open tabs or two devices running decay/consolidation concurrently
  need a writer lock — in-origin the Web Locks API (`navigator.locks.request`)
  solves tabs; cross-device is `03-sync-devices.md`.

## 6. Verdict

**Keep verbatim (concepts and field shapes):**

- `memoryRecords` core: tier + segment + importance + decayRate + accessCount +
  lifecycle + supersedes (`schema.ts:27-64`) and `SEGMENT_DEFAULTS`
  (`types.ts:37-45`).
- The decay formula and thresholds (`clean.ts:5-43`) — pure functions, port as-is.
- The proposer/adversary/judge consolidation protocol and its full-provenance run
  log (`consolidation.ts`).
- `drafts` as the human-approval gate (`schema.ts:185-201`).
- `usageRecords` append-only cost accounting (`schema.ts:101-128`).
- `settings` kv override pattern (`schema.ts:227-231`), promoted to sole config.

**Re-shape for the browser:**

- Convex tables → IndexedDB object stores; compound indexes replace Convex
  indexes; embeddings split into a sibling `Float32Array` store.
- Convex `_storage` → OPFS content-addressed files, with the ASKK-proven
  in-memory fallback for flaky OPFS contexts.
- Convex `vectorSearch` → brute-force cosine in a worker; BGE-large (1024-dim,
  ~1.3GB) → bge-small-class (384-dim, ~35MB q8) with weights in the Cache API.
- Interval loops → idempotent catch-up jobs on app open + idle time, guarded by
  Web Locks (scheduling guarantees: 01; multi-device writer: 03).

**Drop:** `sendblueDedup` and anything else that exists only because a server
receives webhooks (04).
