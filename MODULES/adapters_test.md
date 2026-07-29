# Module: adapters_test

**One-sentence purpose:** In-memory implementations of every kernel port so the pure crates test
on the host in milliseconds with no browser, no Wasm, no network.

**Invariants upheld:** I3 (it IS the mechanism), I7 (FixedClock/SeededRng make determinism a
fixture, not a hope), I6 (DenyAllNet makes accidental network reach a loud failure).

**Routes served / fragments rendered / sections provided:** None.

**Capabilities required:** None — that is the point.

**Public surface:**
- `MemKv`, `MemBlob`, `MemStore` — HashMap-backed `KvStore`/`BlobStore`/`StorePort`; `RefCell`
  because ports take `&self` and both wasm and tests are single-threaded.
- `FixedClock::at(ts)` — time pinned by the test (I7's proof).
- `SeededRng::seeded(seed)` — repeatable ids and goldens; deliberately not cryptographic.
- `ScriptedModel::with_replies(vec)` — the scripted model port ADR-010's transition tests demand;
  replays replies in order.
- `DenyAllNet` — default-deny as a fixture.

**Depends on / Depended on by:** `kernel` only / `core` (dev-dependency); any pure crate may take
it as a dev-dependency — the layering check exempts exactly that edge.

**Owns:** test-double behavior (ordering of scripted replies, seeded sequence stability).

**Explicitly does not own:** anything shipped to production; assertions (tests assert, doubles
record); fixture *data* (each test brings its own).

**Failure modes:** a double drifting from real port semantics (e.g. MemKv allowing what IdbStore
rejects) — mitigated by writing both against the same trait tests when adapters land in G4.

**Test contract:** (1) MemKv/MemBlob round-trip and prefix listing; (2) FixedClock returns what
was set; (3) SeededRng: same seed ⇒ same bytes; (4) ScriptedModel replays in order and errors
when exhausted; (5) DenyAllNet denies everything with `NetError::Denied`.

**Rejected alternatives:** mocking frameworks (a dependency for what five tiny structs do);
doubles defined ad hoc inside each crate's tests (five re-implementations that drift apart).

**Blast radius:** test suites only; production is untouched by anything here — the layering check
(`dev-deps exempt only for adapters_test consumers`) keeps it that way mechanically.
