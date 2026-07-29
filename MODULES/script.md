# Module: script

**One-sentence purpose:** Runs forged-module logic (Rhai source) in a per-module engine whose
capability world is exactly its effective grants — and quarantines the one heavy dependency.

**Invariants upheld:** I3 (Rhai is pure Rust; forged logic tests under host `cargo test`),
I6 (default deny falls out: nothing ungranted exists in the script's world), I12 (limits cap
runaway scripts).

**Routes served / fragments rendered / sections provided:** None — it executes other modules'
logic; it has none of its own.

**Capabilities required:** None held; it *binds* pre-scoped host functions handed in by `core`.

**Public surface:**
- `Limits` + `Limits::spike_proven()` — the Spike B runaway ceilings, one definition for dry run
  and production.
- `HostFns` + `HostFns::deny_all()` — the binding table (sync closures — PROVISIONAL: the async
  bridge is core's G4 decision); `deny_all` is the forge dry-run context as a named thing.
- `effective_grants(declared, granted)` — declared ∩ granted (Spike B: manifest is an upper bound);
  public because capability review renders exactly this.
- `ScriptModule` (opaque — Rhai types must not leak or the quarantine is fiction) + `module_id()`.
- `compile(module_id, source, host, limits)` — grants sealed at compile; revocation = recompile-less
  absence next invocation (I10).
- `call_handle(module, req)` — the §6 logic contract in kernel shapes, same as built-ins (I9).
- `ScriptError` — typed compile/denial/limit/runtime/return-type failures the forge branches on.

**Depends on / Depended on by:** `kernel`, rhai / `module` (invokes it for T1 logic), `core`
(constructs `HostFns` from grants).

**Owns:** the interpreter, the binding surface, execution limits, typed denial recovery.

**Explicitly does not own:** agents, phases, the registry, any ambient capability, grant *policy*
(core decides what to hand in; this crate only seals it).

**Failure modes:** script loops → `LimitExceeded` (only the script dies, not the UI — Worker
placement, ARCHITECTURE §1d); ungranted call → typed `CapabilityDenied` surfaced to the host;
model-authored Rhai that won't compile → `Compile`, feeding ADR-003's named reversal trigger.

**Test contract:** (1) module-from-string serves a route (Spike B round-trip); (2) deny-all dry
run yields typed denials, never panics; (3) declared-but-ungranted is denied;
(4) granted-but-undeclared is denied; (5) each limit fires as `LimitExceeded`.

**Rejected alternatives:** QuickJS/mlua in-core (fail the wasm target; C-engine CVE surface —
ADR-003); merging into `module` — would put rhai in the pure domain's dependency audit.

**Blast radius:** every forged module's execution semantics; swapping engines re-implements this
crate's internals but no signature above changes (that containment is the crate's purpose).
