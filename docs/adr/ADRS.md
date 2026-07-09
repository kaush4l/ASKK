# Architecture decision records

One file; one section per ADR. Status: A = accepted.

## ADR-001 (A) — Element is a closed enum, not trait objects
Serde on `dyn Trait` is painful on wasm; a closed enum gives exhaustive render, cheap clone,
serialization for free. Cost: new element kind = touch one enum + its render/absorb match arms.
Accepted: element kinds change rarely; agents/contracts/tools (the things that change often) are
data, not element kinds.

## ADR-002 (A) — Providers map, never compose; native tool-calling first
The sheet renders to a provider-agnostic `InferenceRequest`; adapters translate. Structured tool
calls / structured outputs use the provider-native mechanism when available; text contract
(TOON→JSON negotiation) is the fallback, not the primary. Kills the regex-parse subsystem being
the load-bearing path (ASKK pain #3, LocalAgents wart #2).

## ADR-003 (A) — Signal log is the sole run-state truth; UI = fold(signals)
Append-only JSONL, per-run monotonic seq, single writer, epoch segments, replay-from-0. One
stream from day one — no parallel legacy event stream (ASKK carried two; migration debt).
Unknown kinds skipped for forward-compat.

## ADR-004 (A) — One tool trait, one registry, ToolSet = allowlist
`dyn Tool` with MCP-shaped spec + structured JSON args; adapters for rust-fn/MCP/agent/JS.
No second fn-pointer registry (ASKK had two, bridged per run). Paradigm is an inert tag.
Effect (`Pure|Mutating`) on the spec routes mutating calls through the action gate.

## ADR-005 (A) — No shared mutable world; explicit state slices
Tools receive `ToolCtx` exposing only declared state slices; writes emit signals. Replaces
AppSnapshot-&mut-everywhere + clone/diff/lift-back (ASKK pain #2, its worst fragility).

## ADR-006 (A) — Actions = effect-tagged tool calls through one gate
No separate action vocabulary for the model: it calls tools; the harness classifies by declared
effect and applies policy (auto/confirm/deny), audits every verdict, parks confirmations as
pending futures (ada_v2's confirmation gate, typed). Dry-run supported via ctx flag.

## ADR-007 (A) — agent.md/soul.md/skills, load-time validation, fail loud
Config is markdown + frontmatter; flat `phase.N.*` keys declare strategies. Every ref resolved at
load; errors list all problems; CI constructs every agent. Silent pick-by-name drops forbidden
(kiln wart #2, LocalAgents wart #3).

## ADR-008 (A) — Gate phases; no false success
Only the gate (verifier) phase's pass terminates a run as success; every other stop is
`Unverified`, `BudgetExhausted`, `Interrupted`, or `Error`. Back-edges bounded. Final-turn nudge
injected. (ASKK behavioral gold, kept verbatim.)

## ADR-009 (A) — Crate layering core ← inference ← runtime ← web; injected seams
Transport (HTTP/SSE), Sleeper (retries), stores (KV/blob), and the delta sink are traits injected
at the edge. Everything below `web` host-tests. Only `web` touches DOM/OPFS/fetch/workers/JS.

## ADR-010 (A) — Dioxus for control surfaces; heavy widgets are vendored JS; runs live in workers
Three prior builds agree: editors/terminals/canvases fight wasm UI frameworks. Dioxus renders
state + controls; anything heavy is a vendored JS bundle behind a thin interop seam. Engine runs
execute in web workers (kiln coordinator/engine-worker split), UI thread stays free.

## ADR-011 (A) — Every wait has an owner and a terminal
Budgets: turns, wall-clock deadline, first-byte/idle timeouts on streams, tool timeouts. Each
maps to a named terminal signal. No unbounded await anywhere in runtime (kiln ADR-123 lineage).

## ADR-012 (A) — ~500-line file cap, structure-tested
God files killed navigability in two prior builds (2,900-line engine/mod.rs). A test walks the
tree and fails on oversize files, wrong-direction imports, and doc-listed-but-missing modules.

## ADR-013 (A) — kiln is the structure north star; MAP.md is the guarded navigation surface
Owner directive (2026-07-08): kiln's folder organization and navigation are the reference;
the ASKK GitHub prototype is the feature reference. Concretely: root `MAP.md` holds the
lifecycle→file table and import rules, guarded by structure tests (a listed non-⏳ path that
doesn't exist fails CI); single-concept file names (`sheet.rs`, `contract.rs`, `signal.rs` —
kiln's `engine.js`/`responses.js`/`fold.js` idiom); UI components import only the wire
(`askk-core`) — `runtime` is reachable solely from the worker/bootstrap glue in
`crates/web/src/host/`, mirroring kiln's "app imports only contracts" edge.

## ADR-014 (A) — Speech = HF-model-id-switched engine modules behind a one-call seam
Pattern lifted from RealtimeTTS/RealtimeSTT code (docs/findings/speech-recon.md): the engine
contract is one call per direction — `transcribe(f32 mono 16k) -> text`, `speak(text)` — and
the model id is an opaque string only the engine interprets; swapping whisper-tiny→small or
kokoro→any compatible ONNX id changes zero pipeline code. Engines are vendored bun bundles
(`assets/speech/askk-{stt,tts}.js`, sources in `scripts/speech/`) that lazy-load on first use,
download models from the HF hub via transformers.js (v4 for STT; kokoro-js's pinned v3 for
TTS — two ort runtimes, each with its own staged same-origin wasm pair, URLs passed explicitly
because dioxus hashes asset names). Defaults = smallest run-anywhere models: whisper-tiny.en +
Kokoro-82M q8. Alternatives rejected: one shared transformers version (kokoro pins v3 and
re-exports its env; driving Kokoro through v4 means hand-rolling phonemization + voices);
Rust-native inference (candle/ort-rs — heavier than the proven JS path, ADR-010 already blesses
vendored JS for heavy surfaces). Deferred: module-worker offload, VAD/wake-word, sentence-level
TTS streaming, webgpu (jsep wasm tier).

## ADR-015 (A) — Parallel agents = async concurrency on one thread, not workers
Wave 9 goal: parallel agents. Chosen mechanics: (1) the signal log's single-writer contract
is kept by an async mutex (`futures::lock::Mutex<SignalLog>`) — concurrent appends queue
instead of panicking; (2) a turn's consecutive Auto-verdict tool calls execute via
`join_all` (the react contract gained an optional `calls` list → `Action::ToolCalls[N]`),
so an orchestrator fans sub-agents out in ONE turn and absorbs results in call order;
(3) the UI drives each submitted run in its own task (`drive_run(run_id)`), so N top-level
runs progress at once. Alternatives rejected: worker-per-agent (old-ASKK phase-0 verdict —
LLM runs are I/O-bound, join_all already overlaps the waits; workers buy ~0 until local
in-browser inference dominates), buffered per-run signal queues merged post-hoc (breaks the
live stream fold + seq ordering). Failed-JSON-rung fallthrough to TOON rides along: a
`calls` item's `{"tool": ...}` fragment must not shadow surrounding TOON lines.

## ADR-016 (A) — VM = vendored v86; alpine boots bzimage+initrd with the ISO as cdrom
Real x86 Linux in the browser via vendored v86 (`assets/vm/`, sources `scripts/vm/` — the
bundle stages its own MATCHING v86.wasm from the installed npm package). Two committed
images: Buildroot (v86 stock serial CD, seconds) and Alpine 3.24.1 x86 virt (sha256-verified
from dl-cdn). Alpine's stock isolinux only talks to VGA, so the serial-console path boots the
ISO's OWN kernel+initramfs directly (`imageType: bzimage` + `initrdUrl`) with
`console=ttyS0` and attaches the full ISO as a SECOND drive (`cdromUrl`) — the initramfs
finds apks/modloop on the cdrom and OpenRC lands on a serial login. This cracked the old
repo's wall (docker-baked state images were thought required). Same-origin assets kill the
CORS wall; Cache Storage keeps multi-MB images one-download-per-deploy. Alternatives
rejected: WebVM/CheerpX (closed licensing, hosted-only constraints), copy.sh state images
(no CORS), in-emulator `setup-alpine` disk installs (no persistent hda writeback yet).
Deferred: guest networking (relay), `vm_exec` tool over serial, persistent rootfs.
