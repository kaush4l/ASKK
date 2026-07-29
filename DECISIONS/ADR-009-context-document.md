# ADR-009 — Context Document schema and compaction

**Status:** Proposed (PROVISIONAL)

## Context

Nothing reaches a model except through one Context Document (PROMPT §8, I13). It must be a
structure, not a string (§8.1); sections declare themselves (§8.2); ordering serves provider
prompt caching (§8.3); sections are modules (§8.4, ADR-004); budget pressure degrades sections
deterministically and visibly (§8.5); content is multimodal parts (§8.6); assembly is pure and
golden-tested (§8.7, I14). This ADR fixes the schema and the compaction algorithm.

## Options

**Option A — string templates.** Each section renders text; the document is concatenation.
Simple, and every prior art in the lineage did it. Rejected on the master prompt's own argument:
it destroys multimodality (an image cannot live in a `String`), provider portability (one
provider's framing is baked into content), and testability of structure. Stated for the record
because it is the design's known failure mode, not a straw man.

**Option B — two-stage, compaction inside `assemble`.**
`assemble(state, phase, budget) -> Document` produces the already-degraded document;
`render(doc, target) -> Vec<Message>` maps it to a provider. One pure function owns "what is
said," including what was cut.

**Option C — three-stage** (`assemble` → `compact` → `render`), making degradation a separately
testable pass over a full-fidelity document. Cleaner separation, but the intermediate
full-fidelity document is a lie — it never existed for the model — and budget decisions need
assembly-time knowledge (per-section budget hints vs. real sizes) anyway. Two functions are
enough; a third public stage is speculative generality (PROMPT §13).

## Decision

**Option B**, with the schema below.

### Schema

```rust
struct Document { phase: Phase, sections: Vec<Section>, report: CompactionReport }
struct Section {
  id: SectionId,            // "soul", "history", … stable
  intent: String,           // mandatory, one sentence; empty = assembly error, not a blank
  stability: Stability,     // Static | SemiStatic | Dynamic | Volatile
  priority: u8,             // lower survives longer under budget
  fidelity: Fidelity,       // Full | Summarized | Pointer | Elided — what compaction chose
  floor: Fidelity,          // §8.2 `compaction`: the lowest level this section supports
  budget_hint: u32,         // declared expected tokens
  provenance: Provenance,   // producing module id + version + input hash + produced_at
  parts: Vec<Part>,         // Text | Image | Audio | File | Fragment
}
```

Sections come from **section providers implementing the ADR-004 module contract** — one
registry, one install path, one rollback story. The §8.2 starting set ships as built-in
providers. Self-authored providers touching `soul`, `operating_rules`, or `response_contract`
require full forge gates (§8.4 guard rail).

### Ordering — deterministic, cache-shaped

Sort key: **(stability class: Static < SemiStatic < Dynamic < Volatile, then per-phase declared
section order)**. The phase configuration (ADR-010) lists its sections in a fixed order; class
sorting is applied over it, so classes never interleave (§8.3) and the result is a pure function
of (phase, registry) — no map-iteration or timestamp order can leak in. A section provider's
declared stability is **enforced**: a golden test renders each Static/SemiStatic section twice
from identical inputs and requires byte identity.

### Compaction — deterministic, recorded

```
loop until fits(budget) or all at floor:
  pick the section with the HIGHEST priority number that is not at its floor
  (ties broken by document order, last first);
  degrade it ONE level: Full → Summarized → Pointer → Elided
```

- Same state + same budget ⇒ same document, bit for bit. No clocks, no randomness (I7).
- Floors: each section declares its own (`response_contract` floors at Full; `history` at
  Pointer); a phase may pin a section higher than its declared floor, never lower.
- `CompactionReport` lists every (section, from, to) and is itself rendered as a Volatile
  section — the agent is always told what it is not seeing (§8.5). "Pointer" fidelity renders
  as an actionable line: what exists, how much, and how to request it.
- Summaries are **precomputed by the owning provider** (e.g. history keeps a running summary),
  never produced by a model call during assembly — assembly does no I/O.

### Rendering, goldens, provenance

- `render` maps `Part`s onto the provider's content blocks; text-only providers get typed
  placeholders for non-text parts. Provider quirks live only here.
- **Golden tests:** snapshot rendered documents for representative (state, phase, budget)
  fixtures; plus the §8.3 prefix test — mutate a Volatile section, assert the byte range before
  the first Dynamic section is identical.
- **Event log per turn (I8):** section ids + fidelities, phase, budget outcome, and a content
  hash of the rendered document. Full text persisted only on explicit request — it contains
  everything personal.

## Consequences

- Every prompt regression is a `git diff` on a golden file; "why did it do that" is archaeology
  with receipts (provenance names the module that said it).
- Providers must maintain summaries incrementally — a real cost on `history`'s implementation,
  accepted to keep assembly pure.
- The static prefix is byte-stable across turns and phases, which is the entire prompt-caching
  payoff; one misdeclared section breaks it, and the enforcement test exists to catch exactly that.

## Reversal cost

Schema fields are additive-cheap. Collapsing to strings later is easy and catastrophic (the
§8.1 rewrite warning); going the other way is the rewrite. The compaction algorithm is one
function — swappable freely since its contract (deterministic, recorded) is what is invariant.

## Pending evidence

- **spikes/paper (Spike C):** must prove prefix byte-identity end to end; failures reshape the
  ordering rule.
- **docs/research/prompt-caching.md:** provider minimum cacheable prefix / TTL / invalidation
  may move the Static↔Dynamic boundary and where large binary parts sit (§8.6) — the one place
  measurement may overrule §8.3 (PROMPT §18).
- **docs/research/tokenizer findings:** how `fits(budget)` counts tokens (exact vs. estimate)
  affects only the budget arithmetic, not the schema.
