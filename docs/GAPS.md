# Known gaps

Found by wave 3 while integrating; rows 1-8 were fixed by wave 5. What remains
below is accepted, not pending.

## Accepted deviations

9. Confirmations inside a delegated run degrade to denial observations (a nested call can't
   pause its parent's tool call). Accepted: revisit only if delegated mutating tools matter.
10. Engine runs execute on the main thread in `web` (async, network-bound) — ADR-010 worker
    hosting is a seam, not yet a worker. Accepted: flip when a compute-heavy tool or a local
    model lands.
15. Kiln-fidelity deviations in the web shell (wave 6): no Steer button (the runtime has no
    mid-run steering input); the Agents view is a flat newest-first forest, not a delegation
    tree (`RunStarted` carries no parent run id); phase/boot loaders are CSS pulse dots, not
    the ldrs web components; the Inspector's Skills/Supplies tabs are stubs that show the
    active run's raw messages (kiln's glass-box rendered-prompt inspector deferred); no model
    profiles UI (one BYOK provider profile).

## Wave-7 live-e2e findings (gemma-4-12B @ omlx, 2026-07-08)

16. Delegation authority narrowing (child = parent ∩ child) means an orchestrator must
    list every transitive tool or sub-agents run with empty allowlists; orchestrator.md
    now carries the superset. Revisit if the tool count grows.
17. CLOSED (wave 14): CancelToken races provider.infer; wasm fetch aborts via
    AbortController on stream drop (run/cancel.rs, host/fetch.rs).
18. Every LlmDelta notify refolds all runs in the UI; with a fast stream the main
    thread saturates (long evals time out mid-run). Fix = fold incrementally or
    throttle notify.
19. Chat renders both the raw TOON reply and the parsed answer as assistant bubbles
    (fold keeps both); cosmetic duplication.
20. Small local models sometimes re-delegate the same goal redundantly; max_tokens
    default (2048) bounds each turn, prompt diet for nested sheets would help more.

## Speech (wave 8, ADR-014) — accepted v1 bounds

21. Whisper q8 ONNX exports trip a DequantizeLinear bug in onnxruntime-web 1.26 (wasm);
    the STT default dtype is pinned `{encoder fp32, decoder q4}`. Retest q8 on the next
    transformers.js/ort bump.
22. Speech engines run on the main thread — long transcriptions/synthesis block the UI.
    Old ASKK proved the module-worker split; do it when it hurts.
23. Mic is push-to-talk only (no VAD/wake-word — RealtimeSTT's two-tier VAD is the
    reference when wanted); kokoro voice .bins fetch from a hardcoded HF URL, so TTS
    voices are online-first (weights themselves obey localModelPath).

## Known-minor (wave 4 findings, queue for next iteration)

11. `ProviderRegistry` caches instances per model id with no profile-update invalidation —
    web boot rebuilds the resolver per call as a workaround; add `replace_profile()`.
12. `RunSession.submit` emits `RunStarted` before a host is installed, so the web live buffer
    misses it mid-drive (fold tolerates; full stream appears once the run parks).
14. Contract `version` rides the wire but has no parse-time mismatch check (risk-register
    row 12 mitigation is aspirational until contracts actually evolve).

## Wave-9 (parallel + VM) — accepted v1 bounds

24. The chat busy pulse tracks the FOCUSED run only; parallel runs' progress lives in the
    Agents view. Per-run cancel is Stop-on-current only.
25. VM: no guest networking (apk add needs a relay) and no persistent rootfs (state
    save/restore exists in the bundle API, unwired). `vm_exec` tool = queue item #2 in
    docs/CAPABILITIES.md.
26. Small models (gemma-12B) re-delegate the same sub-goal redundantly inside the
    orchestrator's dispatch phase (GAPS 20 under phases); the per-phase turn clamp bounds
    it. The `calls` parallel list is proven by deterministic tests; live models use it
    opportunistically.

## Wave-10 — accepted v1 bounds

27. Live-fetch of the served agents folder is a no-op on the dev server (dioxus
    SPA-fallbacks unhashed `/assets/agents/*` to index.html); boot detects the
    non-JSON and falls back to the BAKED copy of the same files. True drop-in
    override needs a static host that serves the folder (gh-pages via a stage
    step, or any plain file server) — same shape as old ASKK's staged v86
    manifest. Baked path is identical, so no behavior is lost in dev.
28. `shell` runs on Buildroot by default (busybox; fast boot). Switch to Alpine
    in the VM picker for a fuller toolset; the executor targets whichever image
    is currently booted.
29. `shell` output capture is marker-delimited over a raw TTY: very chatty
    commands (>~30 s or huge output) can hit the exec timeout. Fine for typical
    one-shot commands; stream/pager support is deferred.

## Wave-11 (coding teams) — accepted v1 bounds

30. Offline VM = POSIX/busybox coding only (no python3/node/gcc without `apk add`, which
    needs guest networking — GAPS 25). The team builds/runs shell projects today.
31. gemma-4-12B sometimes loops re-issuing write_file instead of progressing to run it
    (weak agentic follow-through; GAPS 20/26). The tools/contract are correct on every call;
    clean exec output + an anti-loop prompt line + the phase clamp mitigate. A stronger model
    converges reliably (verified: full write->run->answer in one build).
32. edit_file uses busybox awk ENVIRON substring replace (first occurrence). No multi-file
    refactor / regex edit yet — write_file a fresh version for large changes.

## Wave-12 (brief v4: acceptance benchmark + fast lane) — open rows

The benchmark (bench/acceptance/ROWS.md, ADR-020) replaced "perfect" as the termination
condition; these are its named red rows, ranked in docs/findings/brief-v4-gap.md:

33. A5 resume: reopen fences non-terminal runs to Interrupted (state/log.rs epoch fence)
    and boot discards replayed signals — no RunState rebuild, no dedup consumer. Effect
    ids (`{run_id}-call-{seq}`) and deterministic replay are already green (pinned by
    `a5_foundation_replay_dedup_fence`).
34. A7 pause: BudgetExhausted is a TERMINAL status (ADR-008); the brief wants a resumable
    `Paused(BudgetExhausted)`. Terminal→paused is a semantics change = HUMAN GATE before
    building. Sibling isolation already green (pinned by a7 test). The confirmation park
    (awaiting/resolve_action) is the template.
35. A8 snapshot: `AskkV86.saveState()`/state-boot exist in the JS bundle, zero Rust
    callers; needs save→OPFS blob (sha-256 key = content-addressed) + restore boot +
    a picker entry (~100 lines glue).
36. A4/A10 toolchain: no compiler/python3/JVM in committed images + no guest NIC ⇒
    `apk add` can't fetch; needs a baked-apks image (asset pipeline work, zero Rust).
37. exec hardening: serial tap buffers output unboundedly (only the 30 s timer bounds
    it) and the Rust future has no independent timeout race — a wedged page-side exec
    hangs it. Cap + race timer are small, do together.
38. A6 lease: BLOCKED on a cross-device store (OPFS is device-local); do not build a
    lease type until a synced KvStore/BlobStore exists.
39. A9 size budget: favorable facts (vm/speech assets lazy) but unenforced — needs a
    release-build cold-payload assertion; no release step exists in this rebuild yet.
40. js_eval sandbox bounds (ADR-021): Worker isolation + shadowed fetch/XHR/WebSocket,
    terminate-on-timeout. Effect::Pure holds only while the worker has no real
    capabilities; gate it if that changes. Per-call Worker spawn (~ms) accepted.

## Wave-13 (modularity: managed loops, open search, OKF) — live-found rows

41. Spawned loops progress only inside `wait_run` (or a UI drive): between spawn and
    wait a parked run sits idle — single-threaded model, no background scheduler
    (ADR-022 states the bound). A cooperative "tick parked runs during idle awaits"
    is the upgrade path if steering-before-wait needs to observe progress.
42. SearXNG default (search.rhscz.eu) rate-limits under load; the chain absorbs it
    (falls back DDG→Wikipedia) but a per-instance cooldown/backoff would stop paying
    the timeout on every call in a burst. Self-hosting note is in Settings.
43. GDELT news fallback serves 200-with-error-text under rate limit; handled as a
    readable miss, but there is no third news source — Wikinews outage = no news.
44. `phase.N.fan_out` items are strings only (list-field artifacts); structured parts
    (objects with per-part context) would need a kind beyond `list`.
45. CLOSED (wave 15): `field.N.example` frontmatter key lands in `FieldSpec.example`;
    `Contract::instructions` renders one worked `Example (shape only):` block (TOON +
    JSON) from examples/placeholders, and the repair prompt names the first missing
    field with a shape hint. Built-in react/plan/critique carry curated examples.

## Wave-14 rows (live-found during the batch)

46. MCP client skips notifications (beyond `initialized`), resources and prompts; tools
    are listed once at boot (edit servers -> reload). Add per-call re-list when a live
    server needs it.
47. Local (transformers.js) provider allows ONE in-flight generate per page — a second
    concurrent local run gets RateLimited. Pool workers if parallel local runs matter.
48. Board UI is a live read view; cards move only through agent tools. Drag-and-drop
    editing is a deliberate omission until a human-editing story is wanted.
49. memory tools use a shared namespace (`notes/<slug>`) because ToolCtx does not carry
    the calling agent id; per-agent scoping when it does.

## Live e2e vs gemma-4-12B @8873 on the hosted page (2026-07-12, wave-14 build)

50. PROVEN live: seeded profile streams; plan contract obeyed; schema validation
    rejected a string `criteria` readably and the model self-corrected to an array
    next turn (repair loop works on a real weak model); action gate parked every
    Mutating board write (approve/deny both exercised); board persisted via OPFS;
    Board tab rendered all 5 columns + cards live.
51. gemma-12B LOOPS on multi-step kanban orchestration: re-planned and re-added the
    same card 3x (kanban-summary, -2, -3) instead of progressing — GAPS 20/26 shape.
    The deployed build predated wave-3 (few-shot example block + context window);
    retest after this publish. If it persists: per-card dedupe hint in board_add's
    error ("a card titled X already exists") is the cheap harness-side fix.
52. Board writes under the default Confirm policy make agent-driven kanban a
    click-per-write experience; a per-tool policy row in Settings (board_* = Auto)
    is the ergonomic fix (policy plumbing already exists — per_tool map).
53. Unhashed served config (assets/agents/*, manifest.json) rides HTTP cache
    (max-age~600): after a deploy that ADDS an agent, a returning browser can show
    the stale roster for up to 10 min (live-hit: tester missing until cache
    refresh). Harmless-but-confusing; cache-busting query param on the manifest
    fetch is the one-line fix if it bites again.
