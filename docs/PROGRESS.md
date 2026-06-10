# Progress log

Dated, newest-first record of what each batch or milestone delivered, the
decisions made along the way, and the verification gate used. Architecture depth
lives in [`EXECUTION_MODEL.md`](./EXECUTION_MODEL.md) and
[`extensibility.md`](./extensibility.md); this file is the chronological record.

## 2026-06-10 — Workspace IDE batch (9 parallel units)

A nine-unit parallel batch extending the Workspace page into a bolt.DIY-style
in-browser IDE. All implementation work below is **shipping in the current
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
