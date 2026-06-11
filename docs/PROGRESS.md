# Progress log

Dated, newest-first record of what each batch or milestone delivered, the
decisions made along the way, and the verification gate used. Architecture depth
lives in [`EXECUTION_MODEL.md`](./EXECUTION_MODEL.md) and
[`extensibility.md`](./extensibility.md); this file is the chronological record.

## 2026-06-11 — Portable assistant: browser senses + in-browser Gemma 4

Pivot toward the truly-portable-assistant goal: the tab's own hardware and a
locally-running model become first-class.

1. **Demo artifact removed** — the dev-only seeding button and
   `insert_demo_artifact()` are gone; the artifact gallery stays and now renders
   real captures.
2. **June-2026 stable refresh** — wasm-bindgen 0.2.123, web-sys/js-sys 0.3.100,
   gloo-net 0.7, rust-version 1.96 (edition 2024 already current); clippy-1.96
   fallout fixed. web-sys gains the media/geolocation/permissions/speech/
   clipboard feature set.
3. **Capabilities page** — live probe of ~45 browser surfaces (media & sensors,
   AI & compute incl. WebGPU adapter + WASM SIMD/threads + the vendored WASI
   shim, storage, connectivity, system UX) with one-click tests: webcam frame,
   3 s mic clip with playback, screen grab, geolocation fix, clipboard round
   trip, notification, TTS.
4. **Browser senses as tools** — `camera_capture`, `screen_capture`,
   `mic_record`, `geolocate`, `clipboard_read/write`, `notify_user`,
   `speak_text`, `device_info` (the same probe the page renders), and
   `transcribe_audio`. Captures land in OPFS `captures/`; image grabs attach to
   the run as artifacts. Browser permission prompts remain the user's approval
   gate for device access.
5. **Page-op proxy** — agent runs execute in a Web Worker where `window` APIs
   don't exist, so `worker::page_proxy` round-trips typed `PageOp`s
   (capture/probe/local-AI) to the page over the existing worker protocol
   (`PageOpRequested` → `PageOpResolved` → `PageOpAck`). Tools work identically
   inline and in worker runs.
6. **In-browser Gemma 4 + Whisper** — vendored transformers.js 4.2.0 worker
   (`scripts/local-ai/`); `local/e2b` / `local/e4b` model ids select
   `LocalGemmaInference` behind the unchanged `InferenceProvider` trait
   (registry now enum-dispatches). Whisper transcription/translation backs
   `transcribe_audio`. Details + decisions: [`LOCAL_MODELS.md`](./LOCAL_MODELS.md).
7. **Model cache** — gitignored `models/` + `scripts/models/fetch.sh`
   (HF download, resumable, dtype-filtered) and `stage.sh` (copy into the dx
   publish dir so weights serve same-origin; Hub fallback otherwise).

User decisions recorded this batch:

- **Gemma 4 12B stays off the browser path** (≈7 GB q4 exceeds practical
  WebGPU budgets); E2B/E4B are the browser targets, exactly as the goal allowed.
- **transformers.js over LiteRT-LM/MediaPipe/WebLLM** — the only runtime with
  Gemma 4 image+audio in-browser today; LiteRT-LM is the documented fast
  text-only upgrade path.
- **V1 cuts:** local generation non-streaming through the proxy; provider sends
  text-only transcripts (runtime already accepts image/audio parts).

## 2026-06-10 — Workspace IDE batch (9 parallel units)

A nine-unit parallel batch extending the Workspace page into a bolt.DIY-style
in-browser IDE. All implementation work below is **merged to main
batch** — built in parallel sibling worktrees and reconciled at integration, so
exact wording/shape may be adjusted by the coordinator:

1. **OPFS workspace filesystem** — workspace files migrate from IndexedDB to
   OPFS (Origin Private File System), with migration of existing files and full
   file management (create/rename/delete/move) in the explorer.
2. **WASI exec harness** — `@bjorn3/browser_wasi_shim` wired into the existing
   `run_in_sandbox` tool / `BrowserExecutor` seam: a real `WasiShimExecutor`
   backend with copy-in/copy-out of the `/workspace` run root and the
   spawn → `postMessage` → timeout-terminate worker lifecycle.
3. **In-browser Python** — a CPython `wasm32-wasi` runtime on that substrate,
   exposed to the agent as a `run_python` tool. Assets per the policy below.
4. **Terminal** — an xterm.js terminal driving a virtual shell: built-ins
   (`ls`, `cat`, `cd`, `pwd`, `mkdir`, `rm`, `mv`, `touch`, `echo`, `clear`,
   `help`) plus `python` / `run` / `js` runtime dispatch.
5. **CM6 bundle v2** — `@codemirror/lang-java`, lint gutter, autocompletion,
   and a generic `AskkCM.attachLanguageService` worker protocol for editor
   language services.
6. **TypeScript/JS language service** — a worker built on `typescript` +
   `@typescript/vfs`, attached via the protocol above.
7. **Python diagnostics** — Ruff compiled to WASM, run in a worker, feeding the
   lint gutter.
8. **Run/process management UI** — process registry with kill, runtime status
   chips, and storage usage via `navigator.storage.estimate()`.
9. **Docs sync** — this entry, the status notes in
   [`EXECUTION_MODEL.md`](./EXECUTION_MODEL.md) (§1/§3/§5/§6), and the README
   workspace section.

User decisions recorded this batch:

- **Rust and Java execution DEFERRED.** No `rustc`/`javac` WASM builds exist;
  true in-browser compilation would require custom container2wasm images (a
  Docker build step, >100 MB of hosted assets, COOP/COEP via coi-serviceworker).
  This batch ships editor support only (syntax highlighting; Java via
  `@codemirror/lang-java`); execution remains a documented future tier per the
  substrate matrix in `EXECUTION_MODEL.md` §3.
- **Bun runner skipped.** Bun has no WASM build (Zig + JavaScriptCore — a
  browser build is not feasible); JavaScript execution stays on the existing
  `run_js` tool.
- **Asset policy.** Commit runtime assets at ≤45 MB per file; anything bigger is
  lazy-fetched from a pinned URL and cached in CacheStorage.
- **Substrate.** WASI tiny-shim is the default (no COOP/COEP — gh-pages safe);
  container2wasm stays the documented opt-in heavy tier (not shipped).

The BYOK / static-hosting model is unchanged: no server, no install, no headers
GitHub Pages cannot set.

Verification gate (run per unit; docs-only units run it to confirm nothing
broke): `cargo fmt --all -- --check`,
`cargo clippy --all-targets --all-features -- -D warnings`,
`cargo test --workspace`, and `dx build --platform web`.
