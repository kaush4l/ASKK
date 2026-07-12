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

## ADR-017 (A) — react contract v2: explore in lists, one switch, MCP-style call
Owner directive (wave 10): the turn schema had too many fields (thinking/plan/tool/args/
response). v2 keeps four: `observation` and `plan` are STRING LISTS (the model explores as
much as it needs), `action` is the sole control switch (`tool`|`answer`), and `answer`
carries EITHER the final text OR the tool call(s). When `action: tool`, `answer` is a
single-line MCP-shaped object `{"name": <tool>, "arguments": {...}}` (the exact shape MCP
`tools/call` uses, so MCP-standard tools drop in unchanged); several lines = parallel calls,
or a JSON array of them. Tool name and args are NOT split into separate fields — one line,
one call. Parse cascade unchanged (native → JSON → TOON → repair); a failed JSON rung still
falls through to TOON so an embedded call object never shadows surrounding TOON.

## ADR-018 (A) — the `shell` tool + VM-as-substrate: agents run real command lines
The in-browser v86 guest (ADR-016) is now the agent's command line. entry.js gained
`exec(hostId, cmd, timeout)` — marker-delimited serial capture — and auto-login (sends
`root\n` on a `login:` prompt), so the guest reaches a shell with no user input. The VM boots
ONCE at app load into a persistent console mounted at app root (parked off-screen when not on
the VM stage, still running), so `shell` works from any stage. A runtime `ShellTool` (injected
`ShellExec` seam, mirroring web_search's transport injection) wraps it; the web executor calls
`window.AskkV86.exec` and waits (bounded) for `shellReady`. `Effect::Pure` (auto-runs, no
gate): the guest is a sandbox — no host FS, no network, no persistence — so a bad command only
touches the throwaway VM. Buildroot is the default image (boots in seconds → shell ready fast);
Alpine is one pick away.

## ADR-020 (A) — the acceptance benchmark is the termination condition
Brief v4 (2026-07-11): "perfect" is not machine-evaluable; v0 ends when every row of
`bench/acceptance/ROWS.md` is green + the gate is green + the manual phone/laptop checklist
passes — and "all green" is not license for scope. Rows drive the REAL agent loop against the
scripted provider (`MockProvider::from_script`, fixture files under `runtime/tests/fixtures/`);
one `#[test]` per native row in `runtime/tests/acceptance.rs`, each asserting the pass condition
AND its budget; `rows_md_test_names_exist` pins the table to real fns (docs may not outrun code).
`bench/acceptance/STATUS.md` is GENERATED by `scripts/bench-status.sh` inside the gate — hand
edits get overwritten. Lanes: native (CI) / browser (manual-nightly, real v86) / blocked (named
prerequisite). CI gates on the scripted lane ONLY; the live local model is a smoke layer, never
gating. The gate also gained `cargo check -p askk-web --target wasm32-unknown-unknown` (nothing
compiled wasm32 before — a web-only breakage passed the gate). Budgets are proposals until
frozen with the human at GATE time.

## ADR-021 (A) — fast lane = js_eval in a Web Worker; ShellExec IS the execution seam
Brief v4 asks for an `ExecutionBackend` trait with a ~1 MB QuickJS fast lane. Code truth: the
seam already exists as `trait ShellExec` (shell.rs:19 — injected, three impls, nothing above it
knows v86), so no rename, no second seam; revisit naming only if a second live backend (native
connector) lands. And the browser IS a JS engine: the fast lane is `js_eval` — a custom JS tool
(ADR-019 pattern) that evals the agent's snippet in a throwaway Web Worker with console capture,
completion value, async support, and `worker.terminate()` on timeout (the only real preemption
browser JS allows; default 2 s). Worker isolation is the sandbox: no DOM, no app state;
fetch/XHR/WebSocket/importScripts shadowed. Live-verified: 6 ms round-trip, loop killed at
timeout, network blocked. QuickJS wasm rejected: duplicates the platform for zero benefit until
determinism/gas-metering is a requirement. Effect stays Pure; raise to gated if the worker ever
gains real capabilities (same ceiling note as shell). The VM must never be on this path (A1
budget < 2 s vs a 30 s serial cap).

## ADR-019 (A) — agents + custom tools are real served files, not hardcoded
The `agents/` folder moved UNDER `crates/web/assets/agents/` so the SAME files are both baked
(build.rs fallback) AND served verbatim at `/assets/agents/*`. Boot fetches the served
`manifest.json` at runtime and loads every agent/skill/tool it lists — drop a file in the
deployed folder, reload, no rebuild. Custom tools are plain browser JS beside the agent.md
files (`fetch_url.js`): each self-registers on `window.askkTools[name]` with an MCP-shaped card
(`description` / `inputSchema` / `async call(args)`); Rust evals the file, reads the card, and
wraps it as a `dyn Tool` the agent calls like any native tool. build.rs emits `TOOL_FILES` so
host builds register inert name-stubs (config validation + smoke stay green without a DOM).
Nothing about the roster is hardcoded — the folder is the whole configuration surface.
