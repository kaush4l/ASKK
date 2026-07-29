# Module: context

**One-sentence purpose:** Owns the paper — `Section`/`Document` and the pure two-stage
`assemble` → `render` pipeline through which anything reaches a model.

**Invariants upheld:** I7 (no clocks, no randomness in assembly), I13 (the `Document` type makes
ad-hoc prompt strings unrepresentable), I14 (pure, golden-testable assembly).

**Routes served / fragments rendered / sections provided:** None itself — modules *provide*
sections; this crate defines what a section is and assembles them.

**Capabilities required:** None. Assembly does no I/O; summaries arrive precomputed in `State`
(Spike C friction 3).

**Public surface:**
- `Part, Stability, Fidelity, Provenance, Section, Budget, Document, CompactionReport,
  CompactionStep` — the ADR-009 schema; public because providers construct sections and the event
  log persists report + hash.
- `State, SectionSource` — assembly inputs; the caller narrows sources per phase config so this
  crate never learns the registry or the phase table.
- `assemble(&State, PhaseId, Budget) -> Document` — the frozen §8.1 first stage; total because
  malformed sections are rejected at install (ADR-004).
- `validate(&Document) -> Result<(), ContextError>` — the DOMAIN §2–3 laws as one shared judge.
- `render(&Document, ProviderFormat) -> Vec<Message>` + `ProviderFormat, Role, Message,
  ContentPart` — the second stage; three targets (RESEARCH multimodal); provider quirks live only here.
- `content_hash(&[Message]) -> String` — the per-turn log record (PROVISIONAL: hand-rolled hash, no dep).
- `ContextError` — typed law violations.

**Depends on / Depended on by:** `kernel` / `module` (Section type for providers), `agent`
(Document in effects), `core` (calls assemble/render).

**Owns:** section anatomy, stable-first ordering, deterministic compaction, provider rendering.

**Explicitly does not own:** the module registry, model transport, phase configuration, summary
authorship (providers precompute).

**Failure modes:** misdeclared stability breaks the cache prefix — caught by the byte-identity
golden; budget arithmetic drift — caught by determinism goldens; a provider quirk leaking upstream
of `render` — caught in review by the `Message` neutrality rule.

**Test contract:** (1) same inputs ⇒ bit-identical Document; (2) Volatile mutation leaves the
prefix byte-identical; (3) degradation ladder is deterministic, recorded, floor-respecting;
(4) `validate` rejects each law violation; (5) golden render per (state, phase, budget) fixture ×
3 providers.

**Rejected alternatives:** string templates (ADR-009 Option A — kills multimodality); a separate
`compact` stage (Option C — the full-fidelity intermediate is a lie).

**Blast radius:** every model call and every golden file; `Section` field changes ripple to
`module` manifests (`SectionSpec`) and stored provider definitions.
