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

## ADR-022 (A) — loop management = five tools over the existing run map; no scheduler
Wave-13 goal: an orchestrator that watches and manages parallel loops. Mechanism: `spawn_run`
(park a child run, return its id at once — the submit pattern reached from a tool),
`check_run` (list runs / digest one via fold of its own stream), `wait_run` (drive several
parked runs CONCURRENTLY via join_all inside the tool), `steer_run` (inject a user note into
a parked run's next turn — the final-turn-nudge pattern), `cancel_run` (token + Interrupted).
One new file `runtime/src/loops.rs`; registered beside the delegate tools, so the five names
are reserved words next to agent ids. Same seams as delegation: authority narrows, depth
capped, parent host serves children, no core/web changes. Honest bound (ADR-015 cooperative
single thread): a spawned loop progresses only inside `wait_run` or a UI drive — spawn-then-
wait is batched parallelism with a management window, not background threads. Deferred: a
spawner seam (wasm spawn_local / LocalPool) if "child progresses while parent thinks" ever
matters; additive `parent` field on RunStarted for spawn trees.

## ADR-023 (A) — search defaults: SearXNG primary via a live cell; news = Wikinews→GDELT
`web_search` gains an open-source primary: a SearXNG instance URL held in a shared
`Rc<RefCell<String>>` (settings save applies on the next call — the provider-resolver cell
idiom), tried first when non-empty; ANY failure falls through to the existing DDG→Wikipedia
chain with the error named in the combined hint, so a bad instance can never brick search.
Shipped default: `https://search.rhscz.eu` (live-probed: serves JSON with ACAO:* — the rare
public instance that does; it rate-limits, which the fallback absorbs; the Settings row says
self-host for reliability, blank disables). `news_search` is a separate tool: Wikinews
full-text (key-free, origin=*, newest-first) primary, GDELT DOC 2.0 fallback — GDELT is
broad+fresh but rate-limits/bans hard and serves 200-with-text errors (a parse failure is a
per-source miss, never a run failure); it is deliberately NEVER primary. Config lives in a
`searxng_url` pref (SessionStore), NOT the provider profile — switching LLM profiles must not
swap search engines.

## ADR-024 (A) — agent knowledge = an OKF v0.1 bundle in the KvStore
Persistent agent knowledge ("latest knowledge and news" that survives runs and reloads)
adopts Google's Open Knowledge Format v0.1 (June 2026): a bundle of markdown concept files
with YAML frontmatter, `type` the only required field; reserved log.md = newest-first date
groups. Storage: the existing KvStore seam under `okf/<concept-id>` (OPFS in the browser) —
no new storage type; `okf/log` mirrors log.md. Four tools in `runtime/tools/knowledge.rs`:
`knowledge_write` (composes a conformant concept, appends the log; Effect::Mutating — writes
persist, so they route through the action gate), `knowledge_read`, `knowledge_list` (index
view), `knowledge_search` (substring over ids+frontmatter+bodies). Ids are validated bundle
paths (no `.md`, no `..`, `log` reserved). The researcher's directive tells it to save
durable findings as concepts with `# Citations`. Rejected: a bespoke notes format (OKF is an
open spec agents may exchange later); files-in-VM storage (guest FS is RAM, lost on reload).

## ADR-025 (A) — modular contracts + multi-loop metadata live in agent frontmatter
The "modular response formats / modular agents.md" goal lands as three flat-key frontmatter
slices, all parsed at load time (never at run time): (1) `field.N.name|kind|required|desc`
builds a per-agent custom Contract (kinds: text | list | `enum: a|b|c`), activated by naming
the agent id in `contract:` / `phase.N.contract:` — validation is agent-local on purpose so
one agent cannot reference another's custom contract and blow up later in assemble (pinned by
`custom_contracts_do_not_leak_across_agents`); tool-bearing custom contracts must keep
`action`+`answer` fields, gate phases must keep `verdict`. (2) `phase.N.max_turns` overrides
the Loop clamp (alone it implies `loop: loop`; explicit `one_shot` + `max_turns` is a load
error). (3) `phase.N.fan_out: <delegate-tool>` + `phase.N.parts: <list-field>` queues one
concurrent `{"goal": item}` delegate call per item of the previous phase's list artifact
through the NORMAL dispatch batch (ADR-015 join_all) — deterministic parallelism that does not
depend on the model emitting a multi-call turn; an empty list degrades to an observation.
Loop-exhaustion routing reuses `on_fail` (bounded by MAX_BACK_EDGES). New code split into
`config/fields.rs` + `run/flow.rs` to hold the file-size cap. Rejected: a global
known-contracts registry extension (cross-agent leak), and a bespoke fan-out executor
(dispatch already batches).

## ADR-026 (A) — the kanban board is the work model: KvStore cards + four tools
The "software team" goal lands as a persistent kanban board: pure `Card`/`CardStage`/
`Criterion` in `core/board.rs` (one hard rule — Done requires every acceptance criterion met;
backward moves, the planning↔testing bounce, always allowed), `BoardStore` over the existing
KvStore seam under `board/<card-id>` (modeled on SessionStore; plain Results, no signals —
the mutating tools already emit ToolRequested/ToolCompleted, which is what the UI refolds
on), and four tools (`board_add`, `board_list`, `board_move`, `board_check`) registered like
the knowledge bundle. Writers are `Effect::Mutating` (gate + dry_run). Cards carry goal,
criteria+met, assignee, order, optional run link, and a note trail; ids are title slugs.
Rejected: board state in the signal log (cross-run persistent config-shaped state, not run
events, and replay must not replay card moves); a scheduler owning the board (agents move
cards through the same tool gate as everything else, so the board stays inspectable and
steerable).

## ADR-027 (A) — env presets: agents declare an environment, not a tool list
`env: vm|web|core|board` in agent frontmatter expands into the tools allowlist at LOAD time
(union with explicit `tools:`, dedup, env-first order; unknown preset = collected load
error; nothing stored on AgentConfig). The hermes-agent insight: a harness ships default
environment assumptions — here the compiled-in environment (VM, browser web, board) IS the
preset. Rejected: runtime expansion (validation must see final refs at load).

## ADR-028 (A) — MCP client is browser-direct JSON-RPC over the Transport seam
Remote Streamable-HTTP MCP servers register as ordinary `dyn Tool`s (`mcp_<slug>_<tool>`;
`readOnlyHint`→Pure else Mutating, so remote mutations hit the action gate). One handshake
per server at boot (initialize → initialized → tools/list); SSE-wrapped and plain-JSON
responses both parse; `Mcp-Session-Id` echoes on every later call; a dead server is a boot
warning, never a failure. Config = `mcp_servers` pref (newline URLs). Rejected: a separate
MCP subsystem (old-ASKK style registry/worker) — the one tool registry already is the
integration point; stdio/process servers need a bridge and wait for one.

## ADR-029 (A) — local inference = vendored transformers.js worker behind the profile seam
Profile `base_url: local` + a HF ONNX model id resolves to a wasm-only Provider that drives
a vendored bun-built Web Worker (transformers.js + pinned ort runtime committed as assets,
like speech): WebGPU q4f16, cpu-wasm q4 fallback, TextStreamer deltas into the existing
streaming plumbing, model weights streamed from the HF hub and cached by the browser —
never committed. Same-role messages merge (strict chat templates). One in-flight generate
per page (RateLimited otherwise; pool workers when needed). Rejected: WebLLM/MLC (second
runtime to vendor); committing weights (repo size, licensing).

## ADR-030 (A) — handoff is a dispatch short-circuit; cancel is a wake-aware token race
Two run-driver semantics: (1) `handoff {agent, goal}` = delegation through the single
drive_child seam, then absorb_result ends the parent run Answered with the child's answer
verbatim (same Result signal; no post-handoff turn — pinned by turns_used == 1). (2) Cancel
races `provider.infer` against a `CancelToken` (Cell flag + waker) at the one await site;
dropping the infer future drops the transport stream, and the wasm fetch aborts via
AbortController (AbortOnDrop, disarmed on completion). No new SignalKinds for either.

## ADR-031 (A) — cross-tab is signal MIRRORING over BroadcastChannel, not shared control
Every locally-stamped signal is also broadcast on channel `askk-signals` inside a `{tab,
signal}` JSON envelope (per-tab random id; echoes and malformed foreign envelopes dropped —
a newer build in another tab must not wedge this one). Received foreign signals join
`HarnessHandle.buffer` + notify, so the existing buffer-fold path renders foreign runs
exactly like delegate runs, and the refold re-reads the shared OPFS board/artifacts. A
"wall display" is just a tab parked on `#/Dashboard`. Ownership stays with the submitting
tab: steer/cancel/approve act only on local runs (foreign runs carry no controls in v1).
CAVEAT (documented, deferred): `SignalLog::open` bumps the persistence epoch and fences
prior non-terminal runs — the OPFS log assumes ONE writing tab; concurrent writers interleave
segments harmlessly for the mirror but leader election is the upgrade path before cross-tab
run CONTROL. Rejected: SharedWorker owner (Safari gaps, big rewire); leader election now
(complexity before need); storage-event polling (chatty, no payload).

## ADR-032 (A) — the story-shaped strategy: director thread, teams as micro-service boundaries
An agent project is ONE long-running thread progressing through declared scenes (phases)
toward the climax (the verify gate) — not a parallel loop farm. The strategy layer is pure
MD: the plan phase splits the goal into tasks (each a board card, criteria-gated); the
dispatch loop phase IS the task scheduler — it runs through the cards in order, choosing
per task an inline turn, a delegate expert, a TEAM, or a spawned loop (`phase.N.fan_out`/
`parts` declares one delegate loop per planned task; `spawn_run`/`wait_run` cover ad-hoc
parallelism WITHIN a scene). A broad task goes to a team: a folder with `team.md`
{id, lead, tools, body=shared principles} is a first-class delegation boundary — ONE tool;
delegating to it drives the LEAD, and the boundary RESETS authority to the team's declared
toolset (lead ∩ team, not caller ∩ lead) — the micro-service analogy: a module carries its
own complete requirements, and its principles (the DRY/SOLID of that module) are injected
into every member driven inside it. Load-validation walls the boundary: outsiders may not
name team members directly, lead must live in the folder, ids share one namespace,
team-in-team rejected. Long threads are declared per agent (`budget.max_turns`/
`deadline_s`/`depth` frontmatter overriding session defaults); goal continuity across
reloads = the board digest observation at run start (durable board is the story's state;
true run resume stays deferred behind the epoch fence). Rejected: a typed task-scheduler
FSM beside the engine (the phase engine + board already are the strategy; new code would
duplicate declared config); global budget bumps (punishes every agent for one director);
teams as mere name prefixes (no boundary, no principles seam).

## ADR-033 (A) — artifacts are live state: re-read before every call, never history
An artifact is task-scoped state whose LATEST version is all the model should see — the
mutation trail is noise (the user's framing: actions update the artifact; the prompt
carries the current state, not a message history of edits). New `Element::Artifacts` /
`SectionKind::Artifact`: `(name, content)` blocks rendered as
`ARTIFACT <name> (live state — latest version; earlier copies in history are stale)`.
The turn loop re-reads every source ONCE per turn, before assemble — repairs reuse the
same snapshot (no tool ran in between). Sources v1: the durable board for any
board-holding agent (replaces the wave-16 submit-time digest observation — closes
GAPS 60; the block is always current, so reload-reorientation AND mid-run drift are the
same mechanism), and the body of every artifact this run `artifact_publish`ed
(head-clamped at 4k chars, read back from the blob store — the agent iterating a
document sees what it actually published, not what it remembers writing). Slugs ride
`RunState.published`, fed by the same dispatch seam that emits `ArtifactAppended`.
Rejected: artifacts as history observations (stale by definition, invisible mid-drive —
the exact GAPS 60 failure); refreshing inside the repair loop (state cannot change
between repairs; extra reads buy nothing); a generic ArtifactSource trait (two concrete
sources today — the seam is one function, `live_artifacts`, extend it when a third
source exists).

## ADR-034 (A) — curated context per phase; sub-agents are specialized, not authored
A phase is a complete context recipe — {contract, tools, skills, header} — so a run
carries only what its CURRENT task needs: `phase.N.skills` joins the existing
`phase.N.tools` as a per-phase filter (None = the agent's full set; team principles
always render — they are the boundary contract, not an optional skill). Runtime
sub-agent generation is SPECIALIZATION of a roster base, never authoring from nothing
(the hybrid-registry pattern: Hermes delegate_task / Claude SDK AgentDefinition):
`spawn_agent {base?, goal, directive?, tools?, skills?, max_turns?}` synthesizes an
AgentConfig from an enabled base (default `worker`) — directive appends to the body,
tools must be ⊆ base.tools and are further clamped ∩ caller allowlist at drive time
(authority only narrows), skills must exist, max_turns clamps to 1..=64 — and drives
it through the same `drive_child` seam, depth cap, and untrusted-result wrapping as
any delegation. Spawned configs live in a run-scoped `Shared.spawned` map (id
`spawned-<base>-<n>`) resolved after the roster; they never persist. Two companions
close the loop the research demanded: the stall guard (the 3rd consecutive identical
Mutating call is refused with a structured observation instead of executed — the
Magentic-One re-plan rule, aimed at GAPS 50/61) and skill progressive disclosure
(`skill_list` index / `skill_read` body, opt-in tools, so an agent picks a technique
at runtime instead of carrying every skill in every prompt). Rejected: free-form
agent authoring (unguardable prompt surface; specialization keeps every knob
subset-validated); a Strategy trait (strategy stays data — `Vec<Phase>`); tool-RAG /
deferred tool search (loadout pruning via phase filters first — revisit if rosters
outgrow it).

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

## ADR-035 (A) — 64-bit guest via container2wasm beside v86, one console contract
The VM stage gained a second engine: `alpine:latest` (x86_64, 3.24.1) converted by
container2wasm into ONE WASI module (Bochs x86_64 emulator + kernel + rootfs,
105 MB, wizer pre-booted) run in a worker behind xterm-pty, exposed as
`window.AskkC2W` with the SAME wire contract as `AskkV86` (boot/exec/shellReady/
destroy) — `host/vm.rs` routes the `shell` tool to whichever engine's shell is
ready, and the picker swaps engines under one serial console. Readiness is
probe-based (inject a split-marker `printf` until it echoes back), not
prompt-regex, and two settle execs absorb the cursor-report garbage busybox's
ASK_TERMINAL leaves on the first line. Measured vs v86: boot 2.8 s vs 6.3 s,
exec roundtrip 6 ms vs 13 ms, sustained CPU ~5x SLOWER (Bochs interprets; the
JIT'd TinyEMU path is riscv64-only) — v86 buildroot stays the default image.
Costs accepted: SharedArrayBuffer required (dev: `dx serve
--cross-origin-policy`; pages: publish.sh injects coi-serviceworker at the site
root, COEP credentialless so cross-origin model fetches survive on Chromium/
Firefox — Safari degrades to v86-only), and the 105 MB image is gitignored
(GitHub's 100 MB cap) — staged locally per scripts/vm-c2w/README.md, split into
50 MB chunks at publish (worker re-concatenates on 404 of the whole file).
The 32-bit alpine bzimage+initrd+iso v86 path (~64 MB of assets) is deleted;
build recipe + benchmarks live in Dev/c2w-alpine (RESULTS.md).

## ADR-036 (A) — structured MCP config in the same pref, per-server statuses on the boot handle
The `mcp_servers` pref now parses as EITHER a JSON array of `{name, url, headers, enabled,
allow}` objects OR the legacy newline-URL list (defaults: name = URL slug, enabled, no
headers, all tools) — one textarea, two formats, no migration. `tools/mcp.rs` became the
feature folder `tools/mcp/` (config / client / registration) under the 400-line cap.
Configured headers ride every POST (Authorization for gated servers) but can never clobber
the protocol's own Content-Type / Accept / Mcp-Session-Id; empty `allow` = every remote
tool, otherwise only allowlisted remote names register. `register_mcp` returns one
`McpServerStatus` `{name, url, ok, tools, error}` per server: the boot handle exposes them
(`mcp_status`) and Settings renders a read-only status list under the textarea; error
statuses still fold into the single boot-warning channel (a dead server never fails boot;
disabled = noted, never contacted). Rejected: a form-per-server editor (modal state and
validation UI for a power-user surface the JSON textarea already covers legibly) and
persisting statuses (they are boot-time facts, not config). Still open per GAPS 46:
resources, prompts, stdio servers, live re-list.

## ADR-037 (A) — VM = container2wasm Alpine only; v86/Buildroot removed (supersedes ADR-016/035 dual-engine)
The VM shipped as a test with two engines under one console (ADR-016 v86, ADR-035
c2w). Alpine (c2w) proved solid, so v86 is deleted: assets (`v86.js`, `v86.wasm`,
`seabios.bin`, `vgabios.bin`, `buildroot.iso`), the `scripts/vm/` bundle source, the
`AskkV86` branch of `browser::vm`'s executor, and the frontend engine picker (one
image = no picker). c2w is now the sole `shell` backend. Costs accepted: c2w needs
cross-origin isolation (SharedArrayBuffer), so browsers without `COEP: credentialless`
— Safari — now have NO VM at all (v86 was the only fallback there), and sustained
guest CPU stays ~5x slower than v86's JIT. Reversible: v86 lives in git history; a
fast-JIT tier can return behind the same boot/exec/shellReady/destroy contract if a
non-isolated fallback is ever needed. The `askk-v86-serial` DOM id is kept verbatim
(cosmetic legacy name, shared across the eval boundary — not worth the churn).

## ADR-038 (A) — a delegation is an authority BOUNDARY: the child runs with its own toolset (supersedes the parent ∩ child narrowing)
The delegation seam narrowed a child's allowlist to `parent ∩ child` — a child
could use only tools its whole caller-chain also held. Combined with the lean
Orchestrator (ADR: sole chat agent holds only delegation + board tools, no leaf
tools), this stripped EVERY delegated specialist to the intersection: the
`researcher` (env `web` → web_search/fetch_url/knowledge_*/artifact_publish)
delegated by the Orchestrator ran with `[artifact_publish]` only, so its
`web_search` came back "unknown tool" and the run looped (or answered from
memory). The narrowing model and the "lean director + powerful specialists"
design are mutually exclusive — a specialist exists precisely for the
capability the director lacks.

Decision: a roster delegation (`DelegateTool`), a full transfer (`HandoffTool`),
and a background spawn (`spawn_run`) each cross an authority BOUNDARY — the
child runs with its OWN declared toolset, not `parent ∩ child`. What stays:
(1) the membership guard — you may only delegate to an agent listed in your
tools (`handoff`/`spawn_run` check it explicitly; `DelegateTool` exists only
because the caller listed the agent), so WHO you may call is still gated;
(2) the team boundary (ADR-032) still caps a member run at `child ∩ team.tools`;
(3) `spawn_agent`'s config-time clamp — replacement tools must be ⊆ the base —
still bounds a spawned agent; (4) phase filters still narrow within a run.
Only WHAT a delegated specialist may use changed: its own declared tools.

Rationale: least-privilege escalation is not a threat in a single-user,
author-declared, browser-sandboxed agent fleet — the narrowing was ceremony
guarding a threat model that does not apply here, at the cost of breaking the
product's flagship route-to-specialist flow. Reversible: the `parent ∩ child`
filter is one line in `drive_child`/`spawn_run`; `PARENT_TOOLS_SLICE` is still
plumbed (now feeding only the membership guard) so re-narrowing is a small
revert. Tests: `spawn_agent_clamps_child_to_caller_allowlist` became
`spawn_agent_child_runs_with_base_toolset` (asserts the child uses a base tool
the caller lacks); `spawn_agent_rejects_tools_outside_base` (base⊆ clamp) and
`team_toolset_is_the_ceiling_inside_the_boundary` (ADR-032) are unchanged.

## ADR-039 (A) — the openai_compat provider sends ONE assembled prompt string (single user message), not a role-tagged messages array
Chat requests split the sheet into a `system` message + role-tagged `history` +
trailing `user` message; the LLM server's chat template then stitched them into
the actual prompt. For a picky local model (gemma via omlx at 127.0.0.1:8873)
that hands prompt construction to the server and hides the exact context from
ASKK. Owner ask: "I am sending the string for the generation, not a list of
messages the API formats."

Decision: `openai_compat::build_body` now renders the WHOLE context —
system-side sections, the tool list AS TEXT, the running history as labelled
turns, then the user input — into one string via `build_prompt`, sent as a
single `{"role":"user"}` message. No native `tools` array (the react/toon
contract parses tool calls from the reply, so tools must appear in the prompt
text — they were previously conveyed ONLY through the native array, i.e. via
the server template). The react loop appends each observation into `history`,
so the growing context rides in this same string every turn. `response_format`
json_object is still set in JSON mode. Anthropic provider unchanged (native
system/messages/ tools are first-class there); the in-browser transformers.js
path (`browser/local_llm.rs`) still builds a worker messages array — both are
non-default here. Costs: a single user turn loses the model's system-vs-user
weighting (fine for a local model; the whole context is one deliberate blob),
and tools-as-text is more verbose than a native array. Reversible: `build_body`
is a pure function with a golden test; restoring the messages array is a local
revert. Not chosen: raw `/v1/completions` (endpoint may not expose it — a
single user message is the universal, non-breaking way to send one ASKK-owned
string). Pairs with single-agent chat (default `assistant`, no delegation) and
the UI fix (LlmResponse is transient; HistoryAppended is the one durable
assistant turn, so no double-render; tool-call turns + observations collapse).

## ADR-040 (A) — remove the kanban board component (unused under single-agent Jarvis; supersedes ADR-026)
ADR-026 shipped a kanban board as the multi-agent work model: `Card`/`CardStage`/
`Criterion` (`core/board.rs`), a `BoardStore` over KvStore (`state/board.rs`), four
tools (`board_add/list/move/check`), an `env: board` preset, a live-refreshed BOARD
artifact digest for board-holding agents (ADR-033), and a `tester` verifier that
recorded per-criterion verdicts. It only made sense as scaffolding for an
orchestrator decomposing a goal across a delegate team. The single-agent cutover
(ADR-039: chat = one `assistant`, no delegation/picker) left the board with no live
user: the Board UI tab was already removed, and no shipped default flow writes cards.

Decision: delete the board component whole. Gone — `core/board.rs`,
`state/board.rs`, `features/tools/board/`, the `env: board` preset, the
`Shared.board` field + `SessionInit.board` + `boot` wiring + `live_artifacts` BOARD
branch, and the two board-only agents (`orchestrator.md`, `tester.md`, the sole
consumers of the board tools). `Card`/`CardStage`/`Criterion` leave `askk-core`.
Consequences: `live_artifacts` now surfaces only published artifact bodies (the
other ADR-033 source is unaffected); the Dashboard's tool-activity matrix replaces
the old board mirror; the delegation seam, teams (ADR-032), spawn, and the coding
team stay — the board was orthogonal to them. Reversible: the board was a
self-contained feature behind the `dyn Tool` seam + a KvStore prefix; restoring it
is a git revert. Not chosen: keeping the board tools registered but hidden (dead
tools still validate into agent toolsets and bloat the prompt catalog small models
degrade on); half-gutting the two agents into boardless shells (their reason to
exist WAS the board). Aligns with the project goal: a Jarvis-standard single
personal agent, with the browser's own senses (mic/webcam/camera) as the next input
surface, not a kanban wall.

## ADR-041 — Features lab: a browser-capability test surface (engine untouched)

Context: the project targets a Jarvis-standard single personal agent that leverages
the browser's own senses. Before wiring any of that into the agent loop, the owner
wants a bench to test every browser-provided capability (camera/mic/screen,
geolocation, clipboard, notifications, sensors, WebGPU, storage, connectivity) and
the in-browser models (transformers.js WebGPU LLMs, Whisper STT, Kokoro TTS), and to
tune each one's parameters — explicitly WITHOUT adding features to the engine yet.
The prior "capabilities" probe + capture helpers existed only on `origin/legacy`
(the pre-crate-split monolith), never ported into the 7-crate layout.

Decision: add a 7th frontend stage, `Stage::Features`, as a pure test/inspection
surface. Port `capabilities/{mod,media,system}.rs` from legacy into `crates/browser`
(the only web-sys crate) — probe() sweeps ~45 surfaces into a `CapabilityReport`;
media/system expose one-shot camera/mic/screen capture + geolocation/clipboard/
notify/browser-TTS, plus new `vibrate`/`web_share` (Safari/iOS OS reach, via
`Reflect` so no extra web-sys feature). Add `local_llm::generate_once` — a one-shot
over the existing `LocalLlm` `Provider` so the lab can run in-browser inference
without building an `InferenceRequest`. The frontend stage is a tab strip over five
leaf panel modules (probe, sensors, llm_lab, speech_lab, platform); each panel calls
those free functions and holds its own param signals. The in-browser LLM is exposed
as an ADDITIONAL provider (an "Add as provider" button upserts a dedicated
`in-browser` profile WITHOUT activating it) — it augments the provider set, it does
not replace the external default.

Consequences: NOTHING is registered as an agent tool and no engine/state/features/
inference code changes — the page-op proxy + the 10 legacy sense *tools* are
deliberately NOT ported (that is the engine wiring this ADR defers). Blast radius is
additive: a new browser module + a new frontend stage; among existing files only
`browser/{lib.rs,Cargo.toml,local_llm.rs}` and `frontend/ui/{manifest,mod,app}.rs` +
`main.css`. Reversible: delete the `capabilities` module + `features/` stage + the
stage enum variant. Not chosen: porting the sense tools now (the owner said "do not
add features to the engine yet"); reseeding the shipped default profile to a local
model (would force a large first-run download on every new user — the lab's opt-in
"add as provider" is the additive alternative); native `<select>`/`<range>` controls
(no precedent in the codebase — chip buttons + text fields match settings.rs).
Built as a foundation-then-fan-out batch: one shared substrate commit, then five
independent worktree panels (one file each, zero shared-file edits).

## ADR-042 — Workflow-path step, orchestrator-by-default, and a Fleet surface

Context: the owner wants three things legible in code — (1) "the LLM does not have to
drive everything; repeated deterministic paths are written as workflow-path code", (2)
the default experience to be "Jarvis": a director that delegates to sub-agents, and (3)
multi-agent loops that run individually. Research against the code (code-is-truth) found
that most of the machinery ALREADY exists: each run carries its own history/toolset/
agent.md (`RunState`), any enabled agent already launches as its own parallel top-level
loop (`submit` + per-run `drive_run`), delegation already runs a child through the same
loop at `depth+1` (`drive_child`), and the error-swallowing "structural" layer already
exists (`dispatch` tool-errors→observations, `log` degrade-don't-die). So this ADR is
four narrow deltas, not a rewrite.

Decision A — the workflow-path primitive is a deterministic `Phase` STEP, not a new
type. `core::Phase` gains `step: PhaseStep` where `PhaseStep::{Llm (default), Tool{tool,
args}}` (`#[serde(default)]`, so all existing phases/snapshots are unaffected). A `Tool`
step runs the named tool once with fixed args (`{goal}` substituted) and advances — NO
`infer` call — reusing dispatch's error-swallowing. An agent's `phases:` frontmatter is
therefore already "workflow-path code": the author scripts the deterministic steps as
phases (`phase.N.tool`/`phase.N.args`), the LLM only fills the judgment phases. Scripted
steps run PURE (read-only) tools only — a mutating tool is refused as an observation
(no unconfirmed mutation from author-scripted code); a scripted step cannot be a gate.
Rejected: a separate `Workflow{steps}` object — it would duplicate phase routing/budget/
gate/error-swallowing.

Decision B — orchestrator by default, REVERSING ADR-039's single-agent default. A new
enabled `orchestrator.md` (listed first, the boot default) is a lean SINGLE-PHASE react
agent with the delegation toolset (`researcher`/`worker`/`builder` + the loop tools +
`handoff`) and `budget.*` caps (max_turns 24, depth 3). Deliberately NOT a plan→execute→
verify phase machine: ADR-039/the lean-react finding showed that machine looped weak/
local models on `MAX_REPAIRS` — the proven orchestrator is "single-phase react +
delegation tools". Known limitation (documented, not silent): a weak/local active
provider may still loop; the single-agent `assistant` stays one click away in the
now-unfiltered picker.

Decision C — a Fleet stage (`Stage::Fleet`) to launch/monitor/cancel N agents as
individual parallel loops. The engine already backgrounds each `submit`+`drive_run`; the
only new surface code is a stage + a per-run `cancel_run` facade. v1 = launch + monitor +
cancel. No scheduler (per-run drive already backgrounds each loop); no mid-loop steer
(deferred). Launch reuses the chat submit path (set agent, then send).

Decision D — structural hardening: the residual `expect()`/`panic!` sites in the run hot
path degrade to a terminal instead of panicking, so "keep the application moving" is
literally true. This ADR does the two `turn.rs` sites (validated-agent/contract invariant,
and the retry failure path); the rest (`assemble`/`flow`/`session`/`transport`) follow in
the same batch.

Consequences: `core::Phase` grew one defaulted field; `turn.rs` split into `run/infer.rs`
(LLM call + retry) and `run/scripted.rs` (workflow-path step) to stay under the size cap;
`config/agent.rs` split its phase parsing into `config/phases.rs`; `app.rs` flipped the
default agent, dropped the assistant-only picker filter, mounted the Fleet stage, and
moved its font/favicon block into `ui/fonts.rs` (cap headroom). Blast radius: the phase
machine (every declared agent), the boot default agent, and one new UI stage. Reversible:
`PhaseStep` defaults to `Llm` (drop it and every phase is unchanged); re-list `assistant`
first to restore the ADR-039 default; delete the Fleet stage variant. Built
foundation-then-fan-out: the interconnected core (PhaseStep, turn hardening, orchestrator/
default flip, Fleet shell) inline, then worktree workers for the Fleet UI body, the rest
of the hardening, the orchestrator/example refinement, and the navigation docs.

## ADR-043 — Eliza-style 3-package formalization (grouping, UI split, app-core seam)

Context: the owner's reference architecture is elizaOS — a core-elements package (agent
loop, tools, structured response, memory), a UI package (components + features), and an
app-core package (import/initialize/start + observe the state), with "every component
pertaining to its duty". Research against the code (3 explore + 2 plan agents) found the
7-crate DAG already realizes the shape with ZERO import violations: core+inference+state+
features+engine = the core-elements package, browser = app-core, frontend = UI.

Decision A — keep the 7 crates; the 3 packages are the DOCUMENTED grouping over them, not
a physical merge. Rejected: merging into 3 Cargo crates — ~27k LOC re-pathed, loses the
finer structure-tested DAG and per-crate compile boundaries, gains no behavior. Eliza
itself nests many packages under its umbrella groups.

Decision B — the UI package gets its literal components/features split: `ui/components/`
(shell chrome, stage manifest, fonts, markdown, pending-actions bar, run-card helpers) and
`ui/features/` (one module per Stage: chat, dashboard, fleet, agents, artifacts, vm,
settings, and `lab/` — the ADR-041 capability lab, renamed from the colliding
`ui/features/` path). `app.rs` stays at the root as the composition root. The former
triplicated run-card helpers (`run_phase`/`draft_tail` in dashboard + fleet,
status/agent_and_goal in agents) collapse into ONE `components/runcard.rs`. A new
structure test pins the layout: the ui/ top level may only contain app.rs, mod.rs,
main.css, components/, features/.

Decision C — app-core (browser crate) owns boot AND observation. `boot.rs` splits its
`HarnessHandle` impl + `build_handle` into a `#[path]` child `boot_handle.rs` (cap
headroom for the observe surface); follow-up units add `signals(run_id)`/`log_health()`
accessors + replay seeding (GAPS A5), move the remaining boot logic out of the UI
(default-agent rule, local-provider profile form, VM glue), and scope memory notes
per-agent (GAPS 49) — each recorded in its own ADR/GAPS entry.

Consequences: 18 file moves inside `crates/frontend/src/ui/` (git-mv, behavior
identical), MAP.md rows re-pathed, one new structure test, boot.rs 512→~240 lines.
Blast radius: frontend module paths + the browser boot file layout; no engine/state
change. Reversible: git mv back and delete the structure test.

## ADR-044 — App-core observe surface + resume (GAPS A5)

Context: ADR-043 named the browser crate the app-core package — import, initialize,
start, and OBSERVE the application. The facade could start and fold runs but exposed no
raw view: no per-run signal stream, no log health, and `SignalLog::open`'s replayed
signals were discarded at boot (GAPS A5) — prior sessions' runs vanished on reload even
though the log kept and fenced them.

Decision A — observe = two facade reads, plain structs only (the boot.rs banner rule):
`signals(&run_id) -> Vec<Signal>` (raw stamped signals of one run, in arrival order — a
clone of the live buffer slice, mirroring `draft`) and `log_health() -> LogHealth`
(`{epoch, degraded, quarantined}`). Backing it, `state::SignalLog` grew a cloneable
`HealthProbe` (`Rc<Cell<bool>>` share of the degrade flag; epoch/quarantined fixed at
open) taken by `build_handle` before the log moves into the session. The inspector rail
renders both: Messages/Signals tabs plus an `epoch N` health chip that warns when
degraded or quarantined.

Decision B — resume = seed everything. `build_handle` gains the `replayed` vector:
prior-epoch run ids land in `known_runs` (first-seen order, BEFORE any fresh submit, so
`runs()`'s reverse keeps newest-first) and the signals extend the live buffer, where the
existing buffer-fold projection path picks them up unchanged. Prior-epoch runs are
read-only exhibits: the epoch fence already appended Error + Interrupted terminals for
zombies, so every replayed run folds terminal and cancel is a no-op. Safety facts that
make seeding sound: the cross-tab bus tap fires only in the host sink (seeding never
rebroadcasts), and LlmDelta is never persisted (no stale drafts replay). Rejected:
rebuilding RunState objects per replayed run — the projection IS the view state; nothing
needs the mutable run machinery for a terminal exhibit. No compaction yet: the seed
grows with the log (which never compacts either); add segment compaction or a
last-N-runs cap when history growth hurts. `host_session_with(blobs)` is the host-side
injection seam that lets tests pre-write segments and boot over them.

Known limitation, documented not fixed: two LIVE tabs already violate the log's
single-writer contract — tab B's boot fences tab A's in-flight runs as stale. That is
pre-existing epoch-fence behavior, now merely VISIBLE through the resumed run list.

Consequences: `HarnessHandle` carries a `HealthProbe`; `build_handle` takes `replayed`;
the inspector rail's stub tabs (Skills/Supplies) became Messages/Signals (stale persisted
tab prefs normalize to Messages). Blast radius: boot assembly (both targets), the state
log's degrade flag representation (`bool` → `Rc<Cell<bool>>`, getters unchanged), and the
right rail. Reversible: drop the two facade reads and pass an empty `replayed`.
