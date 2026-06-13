# Navigable Reorg + Safari Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `src/` so the folder layout physically mirrors the engine-by-composition abstraction (each "grade" is a folder you can navigate to in one hop), then add graceful Safari support — all in the existing single `askk` crate.

**Architecture:** ASKK is a browser agentic runtime (Rust→WASM via Dioxus). The backend is an `Engine` built by composition from pillar blocks — `Engine`/`Tool` (`core/`), `InferenceProvider` (`inference/`), `StructuredResponse` (`responses/`, the object→instruction-set converter), `Strategy` (`strategy/`) — each a trait whose base supplies the defaults and whose impls override only their one extension. The pure core runs in a Web Worker; the main thread only dispatches goals and observes streamed state; page-only browser APIs are proxied back. This refactor keeps every architectural seam intact and changes only *where files live* (plus opportunistic cleanup) and *which browsers degrade gracefully*. The headline navigability fix: today `src/engine/` is the platform **session shell** while the real `Engine` trait lives in `src/core/` — that name collision is renamed away (`engine/`→`runtime/`), and the UI moves to `ui/`.

**Tech Stack:** Rust 2024 (single crate, edition 2024), Dioxus 0.7 (web renderer), `wasm-bindgen`/`web-sys`/`gloo-net`, `dx` CLI for WASM builds, `wasm-bindgen-test` for headless browser tests, `bun` for the vendored local-AI JS bundle, `transformers.js` (WebGPU + WASM backends), OPFS + IndexedDB for the virtual filesystem.

**Two shippable halves (per the combined-plan decision):**
- **Part A — Navigable reorg (Tasks 1–7).** Behavior-preserving moves + opportunistic cleanup. Chrome stays green throughout. Ships on its own.
- **Part B — Safari support (Tasks 8–14).** Feature-detection + graceful fallbacks (OPFS write, agent worker, WebGPU). Ships after Part A.

Each task ends green against the verification gate:
```
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```

**Naming rule for this codebase (preserve it):** states are nouns (`AwaitingModel`), events are past-tense facts (`ModelResponded`), effects are imperative (`CallModel`). New types must follow suit.

---

## File Structure

### Before → After (top level of `src/`)

```
BEFORE                      AFTER                  Responsibility ("grade")
────────────────────────    ──────────────────     ─────────────────────────────────────────
src/core/                   src/core/              PURE loop spine: Engine + Tool traits (no web-sys)
src/inference/              src/inference/         InferenceProvider pillar: providers + registry
src/responses/              src/responses/         StructuredResponse pillar: object → JSON/TOON instructions
src/strategy/               src/strategy/          Strategy/Phase pillar: phase graphs
src/state/                  src/state/             Serializable domain types (shared vocabulary)
src/engine/      ───────▶   src/runtime/           PLATFORM session shell (the collision fix)
  (browser_exec, wasi_exec,   src/runtime/exec/    └─ code-execution substrate (grouped)
   python_runtime,
   exec_capability,
   process_registry,
   runtime_status)
src/tools/                  src/tools/             Tool implementations (connectivity)
src/mcp/                    src/mcp/               MCP transport + registry
src/shell/                  src/shell/             In-browser POSIX shell
src/capabilities/           src/capabilities/      Browser senses + page-op proxy (+ new browser.rs)
src/storage/                src/storage/           OPFS + IndexedDB VFS (+ new Vfs trait)
src/worker/                 src/worker/            Web Worker client/runtime/transport/page_proxy
src/scheduler/              src/scheduler/         PWA scheduler
src/components/   ───────▶   src/ui/               Dioxus components, VISUAL ONLY
src/main.rs                 src/main.rs            WASM entry; mounts ui::AppShell
src/agent_prompt.rs         src/agent_prompt.rs    Prompt assembly
src/workflow.rs             src/workflow.rs        Workflow gate
```

### Files created in this plan
- `docs/NAVIGATION.md` — the "where does X live" map + the worker/main-thread boundary (Task 6).
- `docs/SAFARI.md` — the Safari support matrix + known degradations (Task 13).
- `src/runtime/exec/mod.rs` — declares the grouped execution submodules (Task 5).
- `src/capabilities/browser.rs` — feature-detection + pure decision functions (Task 8).
- `src/storage/vfs_select.rs` — the `Vfs` trait + `WorkspaceVfs` enum selector (Task 9).

### Files renamed (git mv, history-preserving)
- `src/engine/` → `src/runtime/` (Task 3)
- `src/components/` → `src/ui/` (Task 4)
- `src/runtime/{browser_exec,wasi_exec,python_runtime,exec_capability,process_registry,runtime_status}.rs` → `src/runtime/exec/` (Task 5)

### The coupling facts that make this safe (verified during planning)
- `crate::components::` is referenced **0 times** — the UI is a leaf mounted only by `main.rs` (`use components::{AppShell, set_status};`). Renaming `components`→`ui` touches `main.rs` + a handful of doc comments only.
- `crate::engine::` is referenced across **18 files**. The substring `crate::engine` does **not** occur inside `crate::core::engine` (the pure-loop submodule), so a substring replace `crate::engine`→`crate::runtime` is safe and leaves the core untouched.
- The UI imports `state`, `engine` (now `runtime`), `worker`, `storage`, `shell`, `tools`, `responses`, `strategy`, `inference` — it never imports `core`. That boundary is preserved.

---

# PART A — NAVIGABLE REORG

### Task 1: Establish a green baseline and a safety tag

**Files:** none (verification only)

- [ ] **Step 1: Confirm a clean tree and a green gate**

Run:
```bash
git status --short
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: `git status` prints nothing; fmt prints nothing; clippy finishes with no warnings; tests pass; `dx build` ends with a success line. If any step is red, STOP — fix the pre-existing failure before reorganizing (a reorg on a red baseline is unreviewable).

- [ ] **Step 2: Tag the pre-reorg commit for easy rollback**

Run:
```bash
git tag pre-reorg
git rev-parse pre-reorg
```
Expected: prints the current commit SHA. (Rollback during the reorg is `git reset --hard pre-reorg`.)

---

### Task 2: Lock the core-purity invariant with a host test

This test makes "`core/` has zero platform dependencies" a CI-enforced fact *before* moving files, so no later move can silently leak `web_sys` into the pure loop. It passes immediately (core is already pure) — that is the point.

**Files:**
- Modify: `src/core/tests.rs` (append a test)

- [ ] **Step 1: Write the test (it will actually pass — purity already holds)**

Append to `src/core/tests.rs`:
```rust
/// The pure loop spine must never gain a platform dependency. `core/` is the
/// language-agnostic engine framework that runs in a Web Worker; if any of these
/// tokens appear here, the worker boundary has been violated. See docs/NAVIGATION.md.
#[test]
fn core_stays_platform_free() {
    use std::fs;
    use std::path::Path;

    const FORBIDDEN: &[&str] = &["web_sys", "wasm_bindgen", "js_sys", "gloo"];

    fn walk(dir: &Path, offenders: &mut Vec<String>) {
        for entry in fs::read_dir(dir).expect("read core dir") {
            let path = entry.expect("dir entry").path();
            if path.is_dir() {
                walk(&path, offenders);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                let src = fs::read_to_string(&path).expect("read rs file");
                for token in FORBIDDEN {
                    if src.contains(token) {
                        offenders.push(format!("{} contains `{token}`", path.display()));
                    }
                }
            }
        }
    }

    let core_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/core");
    let mut offenders = Vec::new();
    walk(&core_dir, &mut offenders);
    assert!(
        offenders.is_empty(),
        "core/ must stay platform-free (move platform code to runtime/): {offenders:#?}"
    );
}
```

- [ ] **Step 2: Run it and confirm it passes**

Run: `cargo test --workspace core_stays_platform_free`
Expected: PASS. If it FAILS, the named file genuinely couples `core/` to the platform — that is a real bug to fix (move the offending code to `runtime/`), or, if the only hit is inside a `//!`/`//` doc comment, reword the comment to not contain the token.

- [ ] **Step 3: Commit**

```bash
git add src/core/tests.rs
git commit -m "test(core): lock the platform-free invariant before the reorg"
```

---

### Task 3: Rename `src/engine/` → `src/runtime/` (the collision fix)

`src/engine/` is the platform session shell, not the engine. Renaming it to `runtime/` removes the daily "which engine?" confusion. The core's pure-loop submodule `src/core/engine.rs` is untouched.

**Files:**
- Rename: `src/engine/` → `src/runtime/` (all files within)
- Modify: `src/main.rs:13` (`mod engine;` → `mod runtime;`)
- Modify: every file containing `crate::engine` (18 files; mechanical replace)

- [ ] **Step 1: Move the directory (history-preserving)**

Run:
```bash
git mv src/engine src/runtime
```
Expected: no output; `git status` shows the renames staged.

- [ ] **Step 2: Update the module declaration in main.rs**

In `src/main.rs`, change line 13 from:
```rust
mod engine;
```
to:
```rust
mod runtime;
```

- [ ] **Step 3: Rewrite every `crate::engine` reference to `crate::runtime`**

This substring is safe — it never appears inside `crate::core::engine`. Run from the repo root:
```bash
grep -rl 'crate::engine' src/ | while read -r f; do
  perl -pi -e 's/crate::engine\b/crate::runtime/g' "$f"
done
```

- [ ] **Step 4: Verify no stale references remain**

Run:
```bash
grep -rn 'crate::engine\b' src/ ; echo "exit: $?"
grep -rn 'mod engine;' src/main.rs ; echo "exit: $?"
grep -rcn 'crate::core::engine' src/ | head   # must STILL show the core submodule refs intact
```
Expected: the first two greps print **no match lines** (grep exit `1`); the third still shows the `crate::core::engine` references (they must NOT have changed).

- [ ] **Step 5: Build green**

Run:
```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: all pass. If clippy reports a path error, it will name the file/line — fix that single import and re-run.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename src/engine -> src/runtime (the shell is not the Engine)"
```

---

### Task 4: Rename `src/components/` → `src/ui/`

Makes "where is the visual layer" answerable in one hop and matches the "UI as its own grade" model.

**Files:**
- Rename: `src/components/` → `src/ui/`
- Modify: `src/main.rs` (`mod components;` → `mod ui;`, `use components::{...}` → `use ui::{...}`)
- Modify: doc comments referencing `components::`

- [ ] **Step 1: Move the directory**

Run:
```bash
git mv src/components src/ui
```

- [ ] **Step 2: Update main.rs**

In `src/main.rs`:
- Change `mod components;` (line ~6) to `mod ui;`
- Change `use components::{AppShell, set_status};` (line ~26) to `use ui::{AppShell, set_status};`

- [ ] **Step 3: Rewrite remaining `components::` references (doc comments + any code)**

Run:
```bash
grep -rl 'components::' src/ | while read -r f; do
  perl -pi -e 's/\bcomponents::/ui::/g' "$f"
done
```

- [ ] **Step 4: Verify**

Run:
```bash
grep -rn '\bcomponents::' src/ ; echo "exit: $?"
grep -rn 'mod components;' src/main.rs ; echo "exit: $?"
```
Expected: no match lines (grep exit `1`).

- [ ] **Step 5: Build green**

Run:
```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename src/components -> src/ui (UI is its own grade)"
```

---

### Task 5: Group the code-execution substrate under `src/runtime/exec/`

Six runtime files are all "code execution substrate." Grouping them under `runtime/exec/` makes "where does sandboxed execution live" one folder, not six scattered siblings.

**Files:**
- Rename: `src/runtime/{browser_exec,wasi_exec,python_runtime,exec_capability,process_registry,runtime_status}.rs` → `src/runtime/exec/`
- Create: `src/runtime/exec/mod.rs`
- Modify: `src/runtime/mod.rs` (declare `pub mod exec;`, drop the six old `pub mod` lines)
- Modify: call sites using `crate::runtime::{browser_exec,...}` → `crate::runtime::exec::{...}`

- [ ] **Step 1: Create the exec subdirectory and move the files**

Run:
```bash
mkdir -p src/runtime/exec
git mv src/runtime/browser_exec.rs     src/runtime/exec/browser_exec.rs
git mv src/runtime/wasi_exec.rs         src/runtime/exec/wasi_exec.rs
git mv src/runtime/python_runtime.rs    src/runtime/exec/python_runtime.rs
git mv src/runtime/exec_capability.rs   src/runtime/exec/exec_capability.rs
git mv src/runtime/process_registry.rs  src/runtime/exec/process_registry.rs
git mv src/runtime/runtime_status.rs    src/runtime/exec/runtime_status.rs
```

- [ ] **Step 2: Write the exec module index**

Create `src/runtime/exec/mod.rs`:
```rust
//! Code-execution substrate: the in-browser sandboxes the agent runs programs
//! in, plus their lifecycle bookkeeping. Each backend reuses the same worker
//! lifecycle (spawn → postMessage → timeout-terminate → drop). See
//! docs/EXECUTION_MODEL.md §1 and docs/NAVIGATION.md.

pub mod browser_exec; // JS execution in a disposable Web Worker (run_js)
pub mod exec_capability; // the CodeExecutor trait + request/response contract
pub mod process_registry; // live process list for kill/monitor
pub mod python_runtime; // CPython on the WASI tiny-shim
pub mod runtime_status; // asset-loading state (Idle/Loading/Ready/Failed)
pub mod wasi_exec; // single wasm32-wasi binary on the tiny-shim
```

- [ ] **Step 3: Update `src/runtime/mod.rs`**

In `src/runtime/mod.rs`, remove the six now-moved module declarations:
```rust
pub mod browser_exec;
pub mod process_registry;
pub mod exec_capability;
pub mod runtime_status;
pub mod wasi_exec;
pub mod python_runtime;
```
and replace them with the single line:
```rust
pub mod exec;
```
Keep `pub mod session;`, `pub mod execution;`, `pub mod validators;`, `pub mod memory;` and the existing `SessionRunner`/`pick_agent`/etc. re-exports exactly as they are.

- [ ] **Step 4: Rewrite call sites to the `exec::` path**

Run:
```bash
for m in browser_exec wasi_exec python_runtime exec_capability process_registry runtime_status; do
  grep -rl "crate::runtime::$m" src/ | while read -r f; do
    perl -pi -e "s/crate::runtime::$m\\b/crate::runtime::exec::$m/g" "$f"
  done
done
```
Relative `self::`/`super::` references inside the moved files resolve within `exec/`; if any moved file referenced a sibling as `super::<name>`, that now points at the wrong level — Step 5's build will name it; change such refs to `crate::runtime::exec::<name>` or `super::<name>` as appropriate.

- [ ] **Step 5: Verify and build green**

Run:
```bash
grep -rn 'crate::runtime::\(browser_exec\|wasi_exec\|python_runtime\|exec_capability\|process_registry\|runtime_status\)\b' src/ ; echo "exit: $?"
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: the grep prints no match lines (exit `1`); all gate steps pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(runtime): group the code-execution substrate under runtime/exec"
```

---

### Task 6: Add module-responsibility docs + `docs/NAVIGATION.md`

Navigability is only real if "where do I go" is written down. Every top-level module gets a one-line `//!` stating its single responsibility, plus a map doc.

**Files:**
- Modify: `src/core/mod.rs`, `src/inference/mod.rs`, `src/responses/mod.rs`, `src/strategy/mod.rs`, `src/state/mod.rs`, `src/runtime/mod.rs`, `src/tools/mod.rs`, `src/mcp/mod.rs`, `src/shell/mod.rs`, `src/capabilities/mod.rs`, `src/storage/mod.rs`, `src/worker/mod.rs`, `src/scheduler/mod.rs`, `src/ui/mod.rs` (add/normalize the top `//!` line)
- Create: `docs/NAVIGATION.md`
- Modify: `src/main.rs` (add a module-map block comment at the top)

- [ ] **Step 1: Ensure each top-level module begins with a one-line responsibility doc**

For each `mod.rs` above, confirm the file starts with a `//!` line. Where missing or vague, set the first line to exactly these (the module's single job):

```text
core/mod.rs        //! The pure loop spine: the Engine and Tool traits + ReactEngine. Zero platform deps; runs in a Web Worker.
inference/mod.rs   //! Provider pillar: the InferenceProvider trait, per-vendor impls, and the cached provider registry.
responses/mod.rs   //! Response pillar: StructuredResponse turns the model's reply object into a provider instruction-set (JSON/TOON). Formatting lives here.
strategy/mod.rs    //! Strategy pillar: ordered Phase graphs with routing. `react` is the single-phase default.
state/mod.rs       //! Serializable domain types — the shared vocabulary every grade speaks (AppSnapshot, Agent, AgentRun, ...).
runtime/mod.rs     //! Platform session shell: SessionRunner/RunSession drive the core loop, finalize the allowlist, run strategy phases, and proxy execution. Browser-bound.
tools/mod.rs       //! Tool implementations — the agent's connectivity to the world (files, web, exec, MCP, peer agents).
mcp/mod.rs         //! MCP transport + registry: JSON-RPC over Web Workers; shellized and reference servers.
shell/mod.rs       //! In-browser POSIX shell over the virtual filesystem.
capabilities/mod.rs //! Browser senses + the page-op proxy: window-only APIs reached from worker code.
storage/mod.rs     //! Persistence: IndexedDB snapshot store + the OPFS/IndexedDB virtual filesystem.
worker/mod.rs      //! Web Worker client/runtime/transport: the agent loop runs here, off the UI thread.
scheduler/mod.rs   //! PWA scheduler: time/interval-triggered agent runs.
ui/mod.rs          //! Dioxus components — the visual grade. Renders backend state; never owns loop logic.
```
Leave existing longer `//!` blocks in place; just make the first line match the intent above.

- [ ] **Step 2: Write `docs/NAVIGATION.md`**

Create `docs/NAVIGATION.md`:
````markdown
# NAVIGATION — where does X live?

ASKK's backend is one `Engine` composed of pillar **blocks**, each a trait whose
base supplies the defaults and whose impls override only their one extension.
The folder layout mirrors that. To change behavior, go straight to the grade:

| If you need to change…                                    | Go to                |
|-----------------------------------------------------------|----------------------|
| Response formatting / the instruction-set the model reads | `src/responses/`     |
| The agent loop itself (the spine)                         | `src/core/`          |
| A model provider (Anthropic/OpenAI/Google/local)          | `src/inference/`     |
| Multi-phase behavior (plan→act→review, orchestrate)       | `src/strategy/`      |
| A tool / the agent's connectivity                         | `src/tools/`         |
| The session driver, allowlist, validators, compaction     | `src/runtime/`       |
| Sandboxed code execution (JS/WASI/Python)                 | `src/runtime/exec/`  |
| Threading / what runs in the worker vs the page           | `src/worker/`        |
| Window-only senses (camera, mic, clipboard, geo)          | `src/capabilities/`  |
| The virtual filesystem / persistence                      | `src/storage/`       |
| Anything visual                                           | `src/ui/`            |
| The domain types everyone shares                          | `src/state/`         |

## The four pillars (traits with defaults)

| Pillar    | Trait                          | Base / defaults                       | Concrete (overrides only)            |
|-----------|--------------------------------|---------------------------------------|--------------------------------------|
| Engine    | `core::Engine`                 | `BaseEngine` + template methods       | `ReactEngine` overrides `invoke`     |
| Tool      | `core::Tool`                   | `name()` default                      | `RustTool`/`McpTool`/`AgentTool`     |
| Provider  | `inference::InferenceProvider` | `invoke_react_streaming` default      | `OpenAiCompatibleInference`, `LocalGemmaInference` |
| Response  | `responses::StructuredResponse`| `instructions`/`from_raw`/`parsed_format` defaults | per-schema `fields`/`from_fields` (macro) |

## The worker / main-thread boundary

```
main thread (src/ui, src/main.rs)
  └─ dispatches a goal, observes streamed AppSnapshot  ──postMessage──┐
                                                                       ▼
Web Worker (src/worker/runtime.rs)
  └─ runs src/runtime::SessionRunner → core::ReactEngine (THE PURE LOOP)
        page-only API needed? ──PageOp request──▶ main thread executes ──▶ result back
```

`src/core/` is platform-free (enforced by `core_stays_platform_free` in
`src/core/tests.rs`) so the loop can run in the worker. Anything touching
`web_sys`/`window` lives in `runtime/`, `worker/`, `capabilities/`, `storage/`,
or `ui/` — never in a pillar.
````

- [ ] **Step 3: Add a module-map comment at the top of main.rs**

In `src/main.rs`, immediately above the `mod` declarations, add:
```rust
// Module map (see docs/NAVIGATION.md for "where does X live"):
//   PILLARS (pure):   core  inference  responses  strategy  state
//   PLATFORM:         runtime (+ runtime::exec)  tools  mcp  shell  capabilities  storage  worker  scheduler
//   VISUAL:           ui
//   ENTRY:            main.rs  agent_prompt  workflow
```

- [ ] **Step 4: Verify docs build and gate is green**

Run:
```bash
cargo doc --no-deps --document-private-items 2>&1 | grep -i 'unresolved' ; echo "exit: $?"
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
```
Expected: no unresolved-doc-link warnings (grep exit `1`); gate green. (`cargo doc` surfaces stale intra-doc links left by the renames — fix any it reports.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: add NAVIGATION.md + per-grade module docs"
```

---

### Task 7: Opportunistic cleanup — stale doc links + tighten over-broad `pub`

Bounded cleanup the rename enabled. Scope is deliberately narrow: fix doc references the renames invalidated, and demote re-exports clippy flags as never-used-outside-their-module. Do **not** delete the WASI/Python execution code — per `docs/EXECUTION_MODEL.md §3` the WASI tiny-shim is the live default substrate, not dead.

**Files:**
- Modify: any file with a `crate::engine::`/`components::` reference inside an intra-doc `[...]` link the earlier passes missed
- Modify: `src/runtime/mod.rs`, pillar `mod.rs` files (only where clippy flags an unused `pub` re-export)

- [ ] **Step 1: Find stale intra-doc links the code-path replaces missed**

Run:
```bash
grep -rn '\[`*crate::engine' src/ ; echo "exit: $?"
grep -rn 'components::' src/ ; echo "exit: $?"
grep -rn 'src/engine/\|src/components/' src/ docs/ ; echo "exit: $?"
```
For each hit, update the path: `crate::engine::X` → `crate::runtime::X` (or `crate::runtime::exec::X` for the six moved modules), `components::` → `ui::`, `src/engine/` → `src/runtime/`, `src/components/` → `src/ui/`.

- [ ] **Step 2: Surface dead/over-broad public items**

Run:
```bash
cargo clippy --all-targets --all-features -- -W unreachable_pub 2>&1 | grep -B1 -A2 'unreachable_pub' | head -60
```
For each item clippy reports as `unreachable_pub` (a `pub` never reachable from outside the crate and never re-exported), change `pub` → `pub(crate)`. Do **not** touch items that are part of a documented trait/pillar API or used by `ui/`. If clippy reports none, this step is a no-op — record that and move on.

- [ ] **Step 3: Build green**

Run:
```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
cargo doc --no-deps --document-private-items 2>&1 | grep -i 'warning' ; echo "exit: $?"
```
Expected: gate green; no doc warnings (grep exit `1`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: fix stale doc links and tighten unreachable pub after the reorg"
```

- [ ] **Step 5: SHIP Part A**

Part A is a complete, shippable unit. Per `CLAUDE.md` "Shipping":
```bash
git fetch origin && git status        # the owner deploys in parallel — never force-push
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
git push origin main
scripts/publish.sh
git branch -a
```
Expected: gate green; push succeeds; `publish.sh` deploys gh-pages; `git branch -a` shows only `main` and `gh-pages`. Load https://kaush4l.github.io/ASKK/ and confirm a chat run still works in Chrome (the reorg is behavior-preserving).

---

# PART B — SAFARI SUPPORT

Safari's three known fault lines, each with a graceful fallback:
1. **OPFS writes** — `FileSystemFileHandle.createWritable()` is absent on older Safari; fall back to the IndexedDB `ProjectVfs`.
2. **WebGPU** — absent before Safari 18; transformers.js falls back to its WASM backend (slower, still works).
3. **Agent module worker** — modern Safari supports it, but a spawn failure must degrade to running the loop inline on the main thread rather than dying.

All three are surfaced to the user in the capabilities page ("cleanly show backend state").

### Task 8: Browser capability probe + pure decision functions

**Files:**
- Create: `src/capabilities/browser.rs`
- Modify: `src/capabilities/mod.rs` (add `pub mod browser;`)

- [ ] **Step 1: Write the failing tests for the pure decision functions**

Create `src/capabilities/browser.rs` with the types and host-testable logic:
```rust
//! Browser capability probe. Detects the cheap, reliable feature flags that
//! decide which fallbacks the runtime takes on Safari, and exposes pure
//! decision functions over them (host-tested). The live `detect()` probe is
//! wasm-only; the decisions are platform-free so they unit-test on the host.

/// What this browser can do, as far as ASKK's fallbacks care.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct BrowserCapabilities {
    /// `FileSystemFileHandle.prototype.createWritable` exists (absent on older Safari).
    pub opfs_writable: bool,
    /// `navigator.gpu` exists (WebGPU; absent before Safari 18).
    pub webgpu: bool,
    /// `Notification` exists on the global.
    pub notifications: bool,
    /// `SharedArrayBuffer` exists (cross-origin isolated).
    pub shared_array_buffer: bool,
}

/// Which virtual-filesystem backend to use given the browser's abilities.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VfsKind {
    /// OPFS: real directories, `createWritable` streaming. The default.
    Opfs,
    /// IndexedDB fallback: flat key→content store for browsers without OPFS writes.
    IndexedDb,
}

/// Pick the workspace filesystem backend. OPFS unless the browser cannot write to it.
pub fn recommended_vfs(caps: BrowserCapabilities) -> VfsKind {
    if caps.opfs_writable {
        VfsKind::Opfs
    } else {
        VfsKind::IndexedDb
    }
}

/// Whether the local-AI runtime should request the WASM backend instead of WebGPU.
pub fn local_ai_uses_wasm_backend(caps: BrowserCapabilities) -> bool {
    !caps.webgpu
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opfs_capable_browser_uses_opfs() {
        let caps = BrowserCapabilities { opfs_writable: true, ..Default::default() };
        assert_eq!(recommended_vfs(caps), VfsKind::Opfs);
    }

    #[test]
    fn safari_without_opfs_writes_falls_back_to_indexeddb() {
        let caps = BrowserCapabilities { opfs_writable: false, ..Default::default() };
        assert_eq!(recommended_vfs(caps), VfsKind::IndexedDb);
    }

    #[test]
    fn no_webgpu_means_wasm_backend() {
        let no_gpu = BrowserCapabilities { webgpu: false, ..Default::default() };
        let gpu = BrowserCapabilities { webgpu: true, ..Default::default() };
        assert!(local_ai_uses_wasm_backend(no_gpu));
        assert!(!local_ai_uses_wasm_backend(gpu));
    }
}
```

- [ ] **Step 2: Wire the module and run the tests**

In `src/capabilities/mod.rs` add:
```rust
pub mod browser;
```
Run: `cargo test --workspace capabilities::browser`
Expected: 3 tests pass.

- [ ] **Step 3: Add the wasm-only live probe**

Append to `src/capabilities/browser.rs`:
```rust
/// Probe the live browser. Cached for the page's lifetime (capabilities don't
/// change mid-session). Page-thread only — call from `ui` or via a page-op.
#[cfg(target_arch = "wasm32")]
pub fn detect() -> BrowserCapabilities {
    use std::cell::Cell;
    thread_local! {
        static CACHE: Cell<Option<BrowserCapabilities>> = const { Cell::new(None) };
    }
    if let Some(caps) = CACHE.with(Cell::get) {
        return caps;
    }
    let caps = probe();
    CACHE.with(|cell| cell.set(Some(caps)));
    caps
}

#[cfg(target_arch = "wasm32")]
fn probe() -> BrowserCapabilities {
    use wasm_bindgen::JsValue;
    let global = js_sys::global();

    let has = |name: &str| {
        js_sys::Reflect::get(&global, &JsValue::from_str(name))
            .map(|v| !v.is_undefined() && !v.is_null())
            .unwrap_or(false)
    };

    // `'createWritable' in FileSystemFileHandle.prototype` — reliable on the
    // prototype without needing a real handle.
    let opfs_writable = js_sys::Reflect::get(&global, &JsValue::from_str("FileSystemFileHandle"))
        .ok()
        .and_then(|ctor| js_sys::Reflect::get(&ctor, &JsValue::from_str("prototype")).ok())
        .map(|proto| {
            js_sys::Reflect::has(&proto, &JsValue::from_str("createWritable")).unwrap_or(false)
        })
        .unwrap_or(false);

    let webgpu = web_sys::window()
        .and_then(|w| {
            js_sys::Reflect::get(w.navigator().as_ref(), &JsValue::from_str("gpu")).ok()
        })
        .map(|gpu| !gpu.is_undefined() && !gpu.is_null())
        .unwrap_or(false);

    BrowserCapabilities {
        opfs_writable,
        webgpu,
        notifications: has("Notification"),
        shared_array_buffer: has("SharedArrayBuffer"),
    }
}
```
(`js_sys`/`web_sys`/`wasm_bindgen` here are fine — `capabilities/` is a platform module, not a pillar. They are already enabled web-sys features in `Cargo.toml`: `Navigator`, `Window`.)

- [ ] **Step 4: Build green**

Run:
```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/browser.rs src/capabilities/mod.rs
git commit -m "feat(capabilities): browser feature probe + pure fallback decisions"
```

---

### Task 9: `Vfs` trait + `WorkspaceVfs` selector with the Safari OPFS fallback

Unify `OpfsVfs` and `ProjectVfs` behind one trait, then select between them by capability. This both fixes Safari writes *and* improves composition (a third backend becomes one more `impl`).

**Files:**
- Create: `src/storage/vfs_select.rs` (the `Vfs` trait + `WorkspaceVfs` enum + `active()`)
- Modify: `src/storage/mod.rs` (`pub mod vfs_select;` + re-export `Vfs`, `WorkspaceVfs`, `VfsKind`)
- Modify: `src/storage/vfs.rs` (`impl Vfs for ProjectVfs` — fill the gap methods, add `delete_key` helper if absent)
- Modify: `src/storage/opfs_vfs.rs` (`impl Vfs for OpfsVfs` — delegate; drop `#[allow(dead_code)]` on `read_bytes`/`write_bytes`)
- Modify: call sites that construct `OpfsVfs::new()` for workspace I/O → `WorkspaceVfs::active()`

- [ ] **Step 1: Read the exact surfaces so the trait matches reality**

Read these to confirm signatures before writing the trait:
- `src/storage/opfs_vfs.rs:42-170` — the `FsEntry` struct (`{ path: String, is_dir: bool }`) and the `OpfsVfs` methods: `read_file`, `write_file`, `read_bytes`, `write_bytes`, `delete`, `rename`, `mkdir`, `list_all`.
- `src/storage/vfs.rs:14-110` — the `ProjectVfs` methods: `write_file`, `read_file`, `list_files`.

The trait below mirrors the `OpfsVfs` surface verbatim. If any signature differs from what you read, match the read source.

- [ ] **Step 2: Write the trait + selector with host tests for the selection**

Create `src/storage/vfs_select.rs`:
```rust
//! One workspace-filesystem contract, two backends, capability-driven choice.
//! OPFS is the default; Safari builds without `createWritable` fall back to the
//! IndexedDB-backed `ProjectVfs`. Adding a third backend is one more `impl Vfs`.

pub use crate::capabilities::browser::VfsKind;
use crate::capabilities::browser;
use crate::state::AppResult;
use crate::storage::opfs_vfs::{FsEntry, OpfsVfs};
use crate::storage::vfs::ProjectVfs;

/// The workspace virtual filesystem contract. Single-threaded WASM, so `?Send`.
#[async_trait::async_trait(?Send)]
pub trait Vfs {
    async fn read_file(&self, path: &str) -> AppResult<Option<String>>;
    async fn write_file(&self, path: &str, content: &str) -> AppResult<()>;
    async fn read_bytes(&self, path: &str) -> AppResult<Option<Vec<u8>>>;
    async fn write_bytes(&self, path: &str, content: &[u8]) -> AppResult<()>;
    async fn delete(&self, path: &str) -> AppResult<()>;
    async fn rename(&self, from: &str, to: &str) -> AppResult<()>;
    async fn mkdir(&self, path: &str) -> AppResult<()>;
    async fn list_all(&self) -> AppResult<Vec<FsEntry>>;
}

/// The active workspace filesystem, chosen by browser capability. Enum dispatch
/// (not `Box<dyn>`) matches the codebase's `ProviderImpl` idiom.
#[derive(Clone, Debug)]
pub enum WorkspaceVfs {
    Opfs(OpfsVfs),
    IndexedDb(ProjectVfs),
}

impl WorkspaceVfs {
    /// Build the backend the current browser can actually use.
    #[cfg(target_arch = "wasm32")]
    pub fn active() -> Self {
        Self::for_kind(browser::recommended_vfs(browser::detect()))
    }

    /// On the host (tests), default to OPFS — the selection logic is tested below.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn active() -> Self {
        Self::Opfs(OpfsVfs::new())
    }

    pub fn for_kind(kind: VfsKind) -> Self {
        match kind {
            VfsKind::Opfs => Self::Opfs(OpfsVfs::new()),
            VfsKind::IndexedDb => Self::IndexedDb(ProjectVfs::new()),
        }
    }
}

#[async_trait::async_trait(?Send)]
impl Vfs for WorkspaceVfs {
    async fn read_file(&self, path: &str) -> AppResult<Option<String>> {
        match self {
            Self::Opfs(v) => Vfs::read_file(v, path).await,
            Self::IndexedDb(v) => Vfs::read_file(v, path).await,
        }
    }
    async fn write_file(&self, path: &str, content: &str) -> AppResult<()> {
        match self {
            Self::Opfs(v) => Vfs::write_file(v, path, content).await,
            Self::IndexedDb(v) => Vfs::write_file(v, path, content).await,
        }
    }
    async fn read_bytes(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        match self {
            Self::Opfs(v) => Vfs::read_bytes(v, path).await,
            Self::IndexedDb(v) => Vfs::read_bytes(v, path).await,
        }
    }
    async fn write_bytes(&self, path: &str, content: &[u8]) -> AppResult<()> {
        match self {
            Self::Opfs(v) => Vfs::write_bytes(v, path, content).await,
            Self::IndexedDb(v) => Vfs::write_bytes(v, path, content).await,
        }
    }
    async fn delete(&self, path: &str) -> AppResult<()> {
        match self {
            Self::Opfs(v) => Vfs::delete(v, path).await,
            Self::IndexedDb(v) => Vfs::delete(v, path).await,
        }
    }
    async fn rename(&self, from: &str, to: &str) -> AppResult<()> {
        match self {
            Self::Opfs(v) => Vfs::rename(v, from, to).await,
            Self::IndexedDb(v) => Vfs::rename(v, from, to).await,
        }
    }
    async fn mkdir(&self, path: &str) -> AppResult<()> {
        match self {
            Self::Opfs(v) => Vfs::mkdir(v, path).await,
            Self::IndexedDb(v) => Vfs::mkdir(v, path).await,
        }
    }
    async fn list_all(&self) -> AppResult<Vec<FsEntry>> {
        match self {
            Self::Opfs(v) => Vfs::list_all(v).await,
            Self::IndexedDb(v) => Vfs::list_all(v).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_opfs_when_writable() {
        assert!(matches!(WorkspaceVfs::for_kind(VfsKind::Opfs), WorkspaceVfs::Opfs(_)));
    }

    #[test]
    fn selects_indexeddb_fallback() {
        assert!(matches!(
            WorkspaceVfs::for_kind(VfsKind::IndexedDb),
            WorkspaceVfs::IndexedDb(_)
        ));
    }
}
```

- [ ] **Step 3: Run the selection test (it will fail to compile until the impls exist)**

In `src/storage/mod.rs` add:
```rust
pub mod vfs_select;
pub use vfs_select::{Vfs, VfsKind, WorkspaceVfs};
```
Run: `cargo test --workspace vfs_select`
Expected: FAIL to compile — `Vfs` is not implemented for `OpfsVfs`/`ProjectVfs` yet. That is the next step.

- [ ] **Step 4: Implement `Vfs` for `OpfsVfs` (pure delegation)**

In `src/storage/opfs_vfs.rs`, remove the `#[allow(dead_code)]` attributes on `read_bytes` and `write_bytes` (they are now reachable through the trait), then add at the end of the file:
```rust
#[async_trait::async_trait(?Send)]
impl crate::storage::vfs_select::Vfs for OpfsVfs {
    async fn read_file(&self, path: &str) -> AppResult<Option<String>> {
        OpfsVfs::read_file(self, path).await
    }
    async fn write_file(&self, path: &str, content: &str) -> AppResult<()> {
        OpfsVfs::write_file(self, path, content).await
    }
    async fn read_bytes(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        OpfsVfs::read_bytes(self, path).await
    }
    async fn write_bytes(&self, path: &str, content: &[u8]) -> AppResult<()> {
        OpfsVfs::write_bytes(self, path, content).await
    }
    async fn delete(&self, path: &str) -> AppResult<()> {
        OpfsVfs::delete(self, path).await
    }
    async fn rename(&self, from: &str, to: &str) -> AppResult<()> {
        OpfsVfs::rename(self, from, to).await
    }
    async fn mkdir(&self, path: &str) -> AppResult<()> {
        OpfsVfs::mkdir(self, path).await
    }
    async fn list_all(&self) -> AppResult<Vec<FsEntry>> {
        OpfsVfs::list_all(self).await
    }
}
```

- [ ] **Step 5: Implement `Vfs` for `ProjectVfs` (adapt the flat IDB store)**

`ProjectVfs` is a flat key→UTF-8 store with no real directories. Implement the gap methods over its existing `read_file`/`write_file`/`list_files`. In `src/storage/vfs.rs`, add:
```rust
use crate::storage::opfs_vfs::FsEntry;

#[async_trait::async_trait(?Send)]
impl crate::storage::vfs_select::Vfs for ProjectVfs {
    async fn read_file(&self, path: &str) -> AppResult<Option<String>> {
        ProjectVfs::read_file(self, path).await
    }
    async fn write_file(&self, path: &str, content: &str) -> AppResult<()> {
        ProjectVfs::write_file(self, path, content).await
    }
    /// Bytes are stored as a UTF-8 string in the IDB fallback. Lossless for text,
    /// which is the only workspace content the fallback path serves.
    async fn read_bytes(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        Ok(self.read_file(path).await?.map(String::into_bytes))
    }
    async fn write_bytes(&self, path: &str, content: &[u8]) -> AppResult<()> {
        let text = String::from_utf8_lossy(content).into_owned();
        self.write_file(path, &text).await
    }
    /// The flat store has no directory entries; deleting a "directory" deletes
    /// every key under that prefix.
    async fn delete(&self, path: &str) -> AppResult<()> {
        let prefix = format!("{}/", path.trim_end_matches('/'));
        for key in self.list_files().await? {
            if key == path || key.starts_with(&prefix) {
                self.delete_key(&key).await?;
            }
        }
        Ok(())
    }
    async fn rename(&self, from: &str, to: &str) -> AppResult<()> {
        if let Some(content) = self.read_file(from).await? {
            self.write_file(to, &content).await?;
        }
        Vfs::delete(self, from).await
    }
    /// Directories are implicit in a flat store — nothing to create.
    async fn mkdir(&self, _path: &str) -> AppResult<()> {
        Ok(())
    }
    async fn list_all(&self) -> AppResult<Vec<FsEntry>> {
        Ok(self
            .list_files()
            .await?
            .into_iter()
            .map(|path| FsEntry { path, is_dir: false })
            .collect())
    }
}
```
If `ProjectVfs` has no `delete_key` helper, add one next to its existing IDB methods, mirroring the `write_file` transaction code at `src/storage/vfs.rs:37-58` but calling `store.delete(&JsValue::from_str(key))` instead of `put`:
```rust
/// Remove one key from the legacy IDB VFS store.
pub async fn delete_key(&self, key: &str) -> AppResult<()> {
    // Mirror write_file's open-db + Readwrite-transaction setup, then:
    //   store.delete(&JsValue::from_str(key)) and await the transaction.
    // Return Ok(()) on success; map JS errors to a String as the sibling methods do.
    todo!("mirror write_file's transaction, calling delete instead of put")
}
```
Replace the `todo!` body by copying `write_file`'s exact transaction scaffolding and swapping the `put` call for `delete` — do not leave the `todo!` in the committed code.

- [ ] **Step 6: Run the tests**

Run: `cargo test --workspace vfs_select`
Expected: `selects_opfs_when_writable` and `selects_indexeddb_fallback` PASS.

- [ ] **Step 7: Route workspace call sites through the selector**

The `OpfsVfs::new()` call sites that serve the *user workspace* must go through `WorkspaceVfs::active()` so Safari gets the fallback. Update these (verified during planning):
- `src/tools/file_vfs.rs:104,116,126`
- `src/capabilities/page_ops.rs:77,93,114`
- `src/ui/workspace_page.rs:197,411` (path is post-Task-4)
- `src/capabilities/local_ai.rs:107`

For each, replace `OpfsVfs::new()` with `crate::storage::WorkspaceVfs::active()` and add `use crate::storage::Vfs;` to the file's imports so the trait methods resolve (the method names are identical, so call sites usually compile unchanged). Leave `src/tools/file_edit.rs:109` (`ProjectVfs::new()`) as-is unless its surrounding context shows it serves the same user workspace — if it reads/writes workspace files, route it too; otherwise leave it.

- [ ] **Step 8: Build green**

Run:
```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(storage): Vfs trait + capability-selected WorkspaceVfs (Safari OPFS fallback)"
```

---

### Task 10: Agent-worker spawn fallback to inline execution

If the module worker cannot spawn (or errors on first load), run the loop inline on the main thread instead of failing the run. Degraded (the UI thread does the work) but functional.

**Files:**
- Modify: `src/worker/client.rs` (catch spawn failure → inline)
- Modify: `src/worker/mod.rs` if `run_goal_in_worker_or_inline` lives there

- [ ] **Step 1: Read the current dispatcher**

Read `src/worker/mod.rs` and `src/worker/client.rs:100-205` to locate `run_goal_in_worker_or_inline` and `spawn_agent_worker` (the latter is at `src/worker/client.rs:166-180`). Note the existing host-only inline branch (`#[cfg(not(target_arch = "wasm32"))]`) and the exact signature it calls (`SessionRunner::...run_with_params_and_observer`).

- [ ] **Step 2: Extract the inline path into a shared function**

Factor the host build's inline body into a function callable from both targets:
```rust
/// Run the goal on the current thread via SessionRunner — the host path, and the
/// Safari fallback when the agent Web Worker can't spawn.
async fn run_goal_inline<F>(start: AppSnapshot, goal_text: String, observer: F) -> AppResult<AppSnapshot>
where
    F: /* same observer bound the existing inline branch uses */,
{
    // Move the existing `#[cfg(not(target_arch = "wasm32"))]` body here verbatim:
    // build SessionRunner + LoopParams and call run_with_params_and_observer.
}
```
Match the exact generic bound and parameter types the current inline branch already uses — copy them, do not invent a new signature.

- [ ] **Step 3: Make the wasm worker path fall back to inline on spawn failure**

In the wasm branch of `run_goal_in_worker_or_inline`, wrap the spawn:
```rust
#[cfg(target_arch = "wasm32")]
{
    match spawn_agent_worker() {
        Ok(worker) => {
            // ... existing worker dispatch (post Dispatch, await result, terminate) ...
        }
        Err(err) => {
            web_sys::console::warn_1(
                &format!("Agent Web Worker unavailable ({err}); running inline on the UI thread.").into(),
            );
            return run_goal_inline(start, goal_text, observer).await;
        }
    }
}
```

- [ ] **Step 4: Verify host build + wasm build**

Run:
```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: all pass. (The inline fallback is exercised live in Task 13 on Safari; here we only prove both targets compile and the host inline path still runs.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(worker): fall back to inline loop when the agent worker can't spawn"
```

---

### Task 11: Local-AI WASM-backend fallback for browsers without WebGPU

The vendored local-AI worker already probes WebGPU (`scripts/local-ai/entry.js:175`). Ensure the worker selects the transformers.js **wasm** backend when WebGPU is unavailable, and surface that state.

**Files:**
- Modify: `scripts/local-ai/worker.js` (pass `device` to the pipeline based on WebGPU availability)
- Rebuild: `assets/local_ai_worker.js` (the vendored bundle — never hand-edit)
- Read: `src/capabilities/local_ai.rs` (confirm `status()` returns `webgpu`)

- [ ] **Step 1: Read the worker's pipeline construction**

Read `scripts/local-ai/worker.js` and find where it constructs the transformers.js pipeline (`pipeline(...)` / `*.from_pretrained(...)`). Identify whether it currently hardcodes `device: 'webgpu'` or a WebGPU-only `dtype` like `q4f16`.

- [ ] **Step 2: Select the backend by capability**

In `scripts/local-ai/worker.js`, compute the device once near the top of the worker scope:
```js
// WebGPU when available (Safari <18 and some Linux lack it); else the WASM backend.
const device = (typeof navigator !== "undefined" && navigator.gpu) ? "webgpu" : "wasm";
```
Pass `{ device }` to every `from_pretrained` / `pipeline` call that currently omits it or hardcodes `"webgpu"`. Where a `dtype` is set, make it backend-aware (`q4f16` is WebGPU-only):
```js
dtype: device === "webgpu" ? "q4f16" : "q4",
```
Mirror the existing option-object shape exactly — do not restructure the call.

- [ ] **Step 3: Rebuild the vendored bundle**

Run (confirm the exact script name in `scripts/local-ai/package.json` first):
```bash
cd scripts/local-ai
bun install
bun run build:worker   # writes ../../assets/local_ai_worker.js
cd ../..
git status --short assets/local_ai_worker.js
```
Expected: `assets/local_ai_worker.js` shows as modified. (Per project policy, the bundle is committed; only the rebuilt output may change.)

- [ ] **Step 4: Confirm status surfaces the backend**

Read `src/capabilities/local_ai.rs` for the `status()` bridge call; confirm it returns `webgpu`. No Rust logic change is expected here — the UI surfacing happens in Task 12.

- [ ] **Step 5: Build green**

Run:
```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/local-ai/worker.js assets/local_ai_worker.js
git commit -m "feat(local-ai): use the WASM backend when WebGPU is absent (Safari <18)"
```

---

### Task 12: Surface browser capabilities + active fallbacks in the UI

"Cleanly show the backend state to the user" — the capabilities page should show what this browser supports and which fallbacks are active, so Safari degradation is transparent, not silent.

**Files:**
- Modify: `src/ui/capabilities_page.rs`

- [ ] **Step 1: Read the current page**

Read `src/ui/capabilities_page.rs` to match its existing badge/row rendering style (it already shows audio/video/geolocation status — reuse that component pattern).

- [ ] **Step 2: Add a "Browser support" section**

In `src/ui/capabilities_page.rs`, add a section that reads `crate::capabilities::browser::detect()` and renders one row per flag, plus the active VFS backend, following the file's existing row style:
```rust
let caps = crate::capabilities::browser::detect();
let vfs = crate::capabilities::browser::recommended_vfs(caps);
// Render rows (reuse the existing status-row element in this file):
//   "OPFS streaming writes"  -> caps.opfs_writable  (false => amber "falling back to IndexedDB")
//   "WebGPU (local AI)"      -> caps.webgpu          (false => amber "using WASM backend, slower")
//   "Notifications"          -> caps.notifications
//   "SharedArrayBuffer"      -> caps.shared_array_buffer
//   "Workspace filesystem"   -> match vfs { VfsKind::Opfs => "OPFS", VfsKind::IndexedDb => "IndexedDB (fallback)" }
```
Use the file's established green/amber styling: green when present, amber with the fallback note when absent. Do not invent a new component — extend the existing one.

- [ ] **Step 3: Build green and confirm render**

Run:
```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: all pass. Then load the app, open the Capabilities tab, and confirm the new "Browser support" rows render (Chrome shows all green; Safari shows the amber fallbacks).

- [ ] **Step 4: Commit**

```bash
git add src/ui/capabilities_page.rs
git commit -m "feat(ui): show browser support + active fallbacks on the capabilities page"
```

---

### Task 13: Safari verification + support matrix

**Files:**
- Create: `docs/SAFARI.md`

- [ ] **Step 1: Run the headless wasm tests under Safari**

Per the project's headless-wasm test setup, run:
```bash
wasm-pack test --headless --safari
```
Expected: the `wasm-bindgen-test` browser tests (e.g. the MCP worker round-trip in `src/mcp/worker_transport.rs` `browser_tests`) pass under Safari's WebDriver. If the local `wasm-bindgen`/`safaridriver` versions skew, follow the workaround in the project's headless-wasm-tests memory note. If `--safari` cannot run in this environment, record that and rely on the manual Step 2.

- [ ] **Step 2: Manual Safari smoke test**

Build and open in Safari:
```bash
dx build --platform web
# serve target/dx/askk/debug/web/public/ (or use `dx serve`) and open in Safari
```
Verify, in Safari:
1. A chat run completes (worker path, or the inline fallback from Task 10 if module workers fail).
2. Creating/editing a file in the Workspace tab persists (OPFS, or the IndexedDB fallback from Task 9).
3. The Capabilities tab shows the correct support matrix (Task 12).
4. If local AI is enabled, it loads on the WASM backend without crashing (Task 11) — slower is acceptable.

- [ ] **Step 3: Write the support matrix**

Create `docs/SAFARI.md`:
```markdown
# Safari support matrix

ASKK targets Chrome first; Safari is supported with graceful fallbacks.

| Capability            | Chrome | Safari (modern) | Safari (older) | Fallback                               |
|-----------------------|--------|-----------------|----------------|----------------------------------------|
| Agent module worker   | yes    | yes             | spawn may fail | inline loop on the UI thread (Task 10) |
| OPFS streaming writes | yes    | yes (18.x+)     | no             | IndexedDB ProjectVfs (Task 9)          |
| WebGPU (local AI)     | yes    | yes (18+)       | no             | transformers.js WASM backend (Task 11) |
| Notifications         | yes    | varies          | varies         | feature-gated; no-op when absent       |
| SharedArrayBuffer     | no (no COOP/COEP on gh-pages) | no | no | tiny-shim substrate needs none         |

Detection lives in `src/capabilities/browser.rs`; the UI shows the live matrix on
the Capabilities tab. None of the fallbacks change the agent loop — they swap an
`impl` behind a seam, the project's standard extensibility move.
```

- [ ] **Step 4: Commit**

```bash
git add docs/SAFARI.md
git commit -m "docs: Safari support matrix + verification notes"
```

---

### Task 14: Final gate + ship Part B

**Files:** none (verification + deploy)

- [ ] **Step 1: Full verification gate**

Run:
```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
dx build --platform web
```
Expected: all green.

- [ ] **Step 2: Ship**

Per `CLAUDE.md` "Shipping":
```bash
git fetch origin && git status        # the owner deploys in parallel — never force-push
git push origin main
scripts/publish.sh
git branch -a
```
Expected: push succeeds; `publish.sh` re-runs the gate, builds with `--base-path /ASKK/`, deploys gh-pages with `.nojekyll`, and prunes branches; `git branch -a` shows only `main` and `gh-pages`.

- [ ] **Step 3: Confirm live**

Open https://kaush4l.github.io/ASKK/ in both Chrome and Safari. Confirm a chat run works in both. Done.

---

## Notes for the executor

- **Run the gate after every task**, not just at ship points. A reorg accumulates small import errors; catching them per-task keeps each commit reviewable.
- **The PostToolUse hook auto-runs `cargo fmt`** after Rust edits, but the gate's `cargo fmt --all -- --check` is the authority — run it explicitly before committing.
- **Do not delete WASI/Python execution code** (`runtime/exec/wasi_exec.rs`, `python_runtime.rs`). Per `docs/EXECUTION_MODEL.md §3`, the WASI tiny-shim is the live default substrate, not dead scaffolding.
- **Never force-push `gh-pages`** and always `git fetch` before pushing `main` — the owner commits/deploys in parallel.
- **The reorg is behavior-preserving by contract.** If a move changes runtime behavior, you've made a mistake — revert to `pre-reorg` and redo the move mechanically.
- **No `todo!` ships.** Task 9 Step 5's `delete_key` skeleton must have a real body before its commit.
```