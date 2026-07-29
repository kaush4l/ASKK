# Spike C — the Context Document ("the paper", PROMPT.md §8)

Standalone crate proving §8 end to end: `assemble` (pure, what is said) →
`render` (pure, how OpenAI-chat hears it), eleven starter sections, stability
ordering, budget degradation, golden + prefix + determinism tests.

Run: `cd spikes/paper && cargo test`. Regenerate the snapshot after an
intentional prompt change: `UPDATE_GOLDEN=1 cargo test`.

## Verdict: WORKED

| §8 claim | Result | Evidence |
|---|---|---|
| Two pure stages, no I/O (§8.1) | worked | `assemble`/`render` take only value args; no clock, no fs, no rand anywhere in `src/` |
| Section anatomy, intent mandatory, nothing empty (§8.2) | worked | `sections.rs::sec` asserts both at construction; all eleven sections populated (`tests/paper.rs::sections_ordered_most_stable_first`) |
| Stable-first ordering makes a cacheable prefix (§8.3) | worked | `static_prefix_byte_identity_under_volatile_change`: changing only `observations` leaves the serialized output byte-identical through the last Dynamic section — stronger than the required "through the last stable section" |
| Multimodal parts survive to the wire (§8.6) | worked | golden snapshot carries an `image_url` part mid-document and an htmx `Fragment` rendered inline; text either side keeps position |
| Budget degradation Full→Summarized→Pointer→Elided, deterministic, recorded (§8.5) | worked | `budget_degradation_deterministic_and_recorded`: identical documents on repeat, lowest priority (`history`) gives first, every step in `Document::degradations`, and a `compaction_notice` rendered at the tail so the agent is told |
| Golden-file test (§8.7) | worked | `tests/golden/openai_chat.json`, compared byte-for-byte |
| Determinism (§8.7) | worked | `determinism_same_inputs_same_document` — document equality AND rendered-byte equality |

## Partial / simplified (honest ceilings)

- **`Summarized` is mechanical truncation** (first 200 chars + marker), not a
  summary. A pure `assemble` cannot summon a summarizer; real summaries must
  be *precomputed artifacts carried in `State`*, chosen — not produced — at
  assembly time. §8.5 never says who writes the summary. **Feeds ADR-009.**
- **`budget_hint` is bytes/4**, not a tokenizer. Fine for deterministic
  binding; a real budget needs a per-provider token estimator, which pulls
  provider knowledge into `assemble`'s input (as data — keep it pure).
- **History renders as text lines inside the one system message** (prior-art
  ASKK style: one assembled string). OpenAI-native alternation
  (user/assistant messages) would split the paper across messages and
  complicate the prefix guarantee; a G1 question, not a spike blocker.
- **Degenerate budget**: when everything is Elided and the budget still
  binds, the document records the overrun and returns; policy belongs to the
  caller (tested: `budget_of_one_elides_everything_but_records_it`).

## Where §8's design fought back (for ADR-009)

1. **`response_contract` — "Static per phase" vs. stable-first ordering.**
   §8.3 forces it into the static prefix (this spike sorts it 4th), but the
   previous life of this repo (`pre-rewrite-rust` assemble.rs) rendered
   format instructions LAST on purpose — trailing instructions are followed
   better. §8 as written trades instruction-following recency for cache
   hits. Both can't win; the spike follows §8 and flags the tension. Also:
   any phase flip invalidates the whole cached prefix because the contract
   sits early — arguably it belongs at the END of the static block at least
   (it is here, by priority order — but only by choice, nothing in §8
   enforces it).
2. **`compaction` field doubles as declared strategy and current level.**
   §8.2 lists `compaction: Full → Summarized → Pointer → Elided` as a
   per-section *declaration*, but degradation needs a *current level* too.
   This spike uses one field (starts `Full`, degradation steps it, the
   document records transitions). If §8 meant "declared floor" (e.g. "soul
   may never be Summarized"), the type needs a second field. Ambiguity worth
   settling in the glossary.
3. **Who authors the summary** (see Partial above) — §8.5's `Summarized` is
   underspecified for a pure function.
4. **The degradation *notice* is itself content.** It must render after the
   volatile tail or it would break the very prefix §8.3 protects; §8 doesn't
   say where the notice lives. This spike appends it last.
5. **Minor:** `priority` (u8, higher survives) needed a tie-break rule to
   stay deterministic; this spike uses "later in document degrades first".

## Layout

- `src/types.rs` — Part/Stability/Compaction/Section/Document/Budget/Phase + cost model
- `src/sections.rs` — the eleven §8.2 starter sections (intents, priorities)
- `src/assemble.rs` — ordering + deterministic degradation
- `src/render.rs` — OpenAI-chat rendering (one system message + fixed user turn)
- `src/state.rs` — `State` input + the representative fixture
- `tests/` — golden (byte-for-byte), prefix, determinism, degradation
