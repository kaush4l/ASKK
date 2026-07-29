# Module: kernel

**One-sentence purpose:** The L0 leaf vocabulary — ids, typed errors, the seam types, Event + log,
capability grants, and the five port traits — that every other crate imports and that imports nothing.

**Invariants upheld:** I3 (defines ports so purity is possible), I4 (owns `Request`/`Response`),
I6 (owns the grant grammar), I7 (owns `Timestamp`/ports so time and randomness are injected),
I8 (owns `Event`/`EventLog`).

**Routes served / fragments rendered / sections provided:** None — vocabulary only.

**Capabilities required:** None. It *names* capabilities; it holds none.

**Public surface:**
- `ModuleId, SectionId, Version, EventId, AgentId, ToolId, EndpointName, Timestamp, PhaseId` — the
  join keys of the system; newtypes so ids cannot be confused (`PhaseId` here because `context` and
  `agent` both need it and neither may import the other — PROVISIONAL as a closed enum).
- `Request, Response` — the §3 seam shapes; the transport and every module speak them.
- `Event, EventKind, EventLog` — I8's material; `EventKind` closed with a `Custom` valve (PROVISIONAL).
- `CapabilityId, CapabilityGrant` — ADR-006 scoped-grant grammar, shared by manifest/binding/enforcement.
- `StoreError, ModelError, NetError` — typed port failures callers match on.
- `ClockPort, RngPort, KvStore, BlobStore, StorePort, ModelPort, NetPort` + DTOs (`ModelReply`,
  `Usage`, `BrokeredRequest/Response`) + `BoxFuture` — the abstract→concrete port pattern; boxed
  futures keep the traits dyn-compatible for entry-point injection (no `Send`: wasm is single-threaded, PROVISIONAL).

**Depends on / Depended on by:** std + serde only / every other crate in the workspace.

**Owns:** what things are called and what shapes cross boundaries.

**Explicitly does not own:** any behavior, routing dispatch, HTML, assembly, enforcement — a body in
this crate is a layering bug even when it compiles.

**Failure modes:** none at runtime (no logic); the failure mode is vocabulary creep — behavior
sneaking in because "it's just a helper." Reviewed at every addition.

**Test contract:** (1) serde round-trip per public type; (2) `EventLog::append` assigns dense `seq`;
(3) `CapabilityGrant::id` covers every variant (exhaustive-match test).

**Rejected alternatives:** separate `http`/`ports` crates (straw-man §11) — same layering row,
boundary enforced nothing (ARCHITECTURE §1a); `EventKind` as open strings — loses typed matching.

**Blast radius:** total — a rename here touches every crate. That is why it holds vocabulary only:
vocabulary changes are renames, not redesigns.
