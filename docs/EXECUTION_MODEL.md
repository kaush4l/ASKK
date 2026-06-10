# Execution model — general code execution in the browser tab

How ASKK runs code, and how it can run **arbitrary** code with **no bridge and no
gateway** — entirely inside the browser tab, served from a static origin (GitHub
Pages). This is the architecture target; the substrate that fills it is still being
chosen by the parallel spikes cross-linked at the end.

> Scope note. The parent `CLAUDE.md` says "no code execution"; that rule is
> intentionally overridden for ASKK (see the user memory note "ASKK exec
> divergence"). Code execution is a first-class capability here. This document does
> not propose reverting it, nor does it propose reshaping the ReAct loop into a typed
> FSM — the loop is intentional as-is.

## 0. Target loop architecture (being built across this batch)

> **Status: TARGET, not yet shipped.** This section describes the agentic flow this
> batch is porting in from the `LocalAgents` reference, implemented across sibling
> PRs. Where it says "today" it is accurate to the current code; everything labelled
> **TARGET** is the design those PRs converge on, not a description of `main`. The
> loop stays a ReAct harness (see the scope note above) — this is a refactor of *how*
> the loop is shaped and fed, not a rewrite into an FSM.

### The loop as an object (construct-prompt → call-LLM → decide-action)

Today the loop is the free function `run_react_session` in
[`src/engine/mod.rs`](../src/engine/mod.rs): each turn it assembles an
`InferenceRequest`, calls the model once for a single [`ReActResponse`], and either
finalizes an answer or runs the emitted tool call(s). The **TARGET** reshapes that
same control flow as a **loop-object** with three named phases per turn:

1. **construct-prompt** — build the turn's messages: the compiled-once static prefix
   (see §"init-time vs runtime split" in [`agent-prompting.md`](./agent-prompting.md))
   plus the rebuilt-per-turn dynamic context (history, goal, observations), with the
   **response-format instructions appended last** so the model reads them right before
   generating.
2. **call-LLM** — invoke the resolved provider (see the registry below) for one raw
   completion and parse it into the turn's typed response.
3. **decide-action** — branch on the parsed action: accept a final answer, or
   dispatch the turn's tool call(s) and feed each observation back as **untrusted
   data**, then loop.

The **orchestrator is itself a loop-object** of the same shape. The orchestrator is a
bundled agent running the `orchestrate` strategy: its phases are `decompose`
(one-shot `TaskBreakdown`), `delegate` (a ReAct loop with `call_agent` fan-out), and
`synthesize` (one-shot final answer). Its "construct-prompt" is task decomposition,
its "call-LLM" is dispatching each sub-agent via `call_agent`, and its
"decide-action" is the routing table in `OrchestrateStrategy::route`. A single agent
run and an orchestrated run are the same loop-object abstraction at two scales, so
**agent-as-a-tool** (a sub-agent invoked like any other tool) falls out cleanly
rather than being a special case.

### Interchangeable inference behind a short `provider/model` id (TARGET)

Today provider selection is `get_implementation()` in
[`src/inference/mod.rs`](../src/inference/mod.rs), which always returns the single
`OpenAiCompatibleInference` impl. The **TARGET** introduces an **inference registry
keyed by a short `provider/model` id** (e.g. `openai/gpt-4o`,
`local/gemma-4-12B-it-qat-mxfp8`): the loop names the model it wants by that one
string, the registry resolves it to a concrete `InferenceProvider` + model
parameters, and swapping models is changing the id, never the loop. This preserves
the existing `InferenceProvider` trait seam — a new vendor is still one `impl` — and
adds only the short-id lookup in front of it.

### Parallel dual tool-call dispatch (TARGET)

Today `parse_tool_calls` ([`src/responses/tool_calls.rs`](../src/responses/tool_calls.rs))
returns a `Vec<ParsedToolCall>`, and the engine already iterates it
(`for call in calls`), but in practice it extracts a **single** call and runs calls
**serially**. The **TARGET** is genuine **parallel dual tool-call dispatch**: a turn
may emit **two or more** tool calls, and they execute **concurrently** (via
`join_all` in [`src/engine/tool_dispatch.rs`](../src/engine/tool_dispatch.rs)), with
results collected **in call order** so the observations the model sees line up with
the calls it wrote. Each result is still untrusted data; concurrency changes only
*when* the calls run, not how their output is trusted. The orchestrator's sub-agent
fan-out uses this same mechanism: when the `delegate` phase emits several
`call_agent` calls in one turn, they run concurrently as ordinary parallel tool
dispatch.

## 1. Where execution sits in the spine

ASKK is a ReAct harness. The spine is `run_react_session` in
[`src/engine/mod.rs`](../src/engine/mod.rs): each turn asks the model for one
[`ReActResponse`], and either accepts a final answer or executes one tool call,
feeding the observation back as **untrusted data**. Execution is not a special path
in the loop — it is a tool like any other.

Tools are MCP-shaped descriptors (`{ name, description, input_schema }` + a handler)
registered in `register_builtin_tools()` at
[`src/tools/mod.rs:133`](../src/tools/mod.rs). The loop only ever asks the registry
for specs and runs a call by name; it contains no per-tool match. Adding an executor
is therefore one descriptor module plus one `registry.register(...)` line — the loop,
strategies, prompt assembly, and state store do not change. This is the
extensibility contract documented in [`extensibility.md`](./extensibility.md).

Two execution tools exist today, sitting at opposite ends of the capability/safety
trade:

- **`run_js`** ([`src/tools/run_js.rs`](../src/tools/run_js.rs)) — runs JavaScript
  **in-browser**, no bridge. The only general-purpose, zero-setup executor we ship.
  But it is JS-only: it cannot run a Python script, a Go binary, `bun test` against a
  real toolchain, or anything that is not JavaScript.
- **`run_command`** ([`src/tools/run_command.rs`](../src/tools/run_command.rs)) —
  runs an allow-listed shell command (`bun`, `node`, `npm`, `git`, `tsc`, `vitest`,
  …) on a **separate machine** via the optional local bridge. General-purpose, but
  requires the user to install and run Node and start the bridge with `--allow-exec`.
  That is exactly the gateway/bridge dependency the owner wants gone.

The goal of this document: collapse those two into one **in-browser general
executor** that runs *any* binary (not just JS, not just Python — Pyodide is
explicitly rejected as Python-only) with the simplicity of `run_js` and the
generality of `run_command`, with **no second machine in the loop**.

(A third tool, `run_in_sandbox`
([`src/tools/run_in_sandbox.rs`](../src/tools/run_in_sandbox.rs)), is that
executor's agent-facing entry point — see §5. It shipped as a stub-backed seam;
the current batch wires it to a real WASI substrate. See §3 "Current state".)

### The in-browser Web Worker pattern (the substrate seam already exists)

Both the JS executor and the MCP runtime already prove the pattern a general
executor will reuse: **spawn a disposable Web Worker, talk to it over
`postMessage`, enforce a hard timeout by terminating the worker.**

- **JS executor** — [`assets/exec_worker.js`](../assets/exec_worker.js) is a classic
  Web Worker. [`run_js_in_browser`](../src/engine/browser_exec.rs) spawns one worker
  per call, posts `{ code, input }`, races the reply against a
  `gloo_timers` timeout, and calls `worker.terminate()` on either outcome so a
  runaway script can never wedge the loop. Worker termination doubles as isolation:
  the executed code never shares scope with the agent.
- **Shellized MCP** — [`src/mcp/worker_transport.rs:63`](../src/mcp/worker_transport.rs)
  (`connect_shellized`) takes a server *definition*, prepends it to a bundled generic
  shell worker, publishes the result as a **same-origin Blob URL**, and spawns it as
  a classic worker — no bundler, no static asset, no network. A general executor can
  borrow this trick wholesale: a WASM substrate, its glue JS, and the user's program
  can all be assembled into a Blob and run in a worker the same way.

These are the load-bearing precedents. A new substrate slots into the *same* worker
lifecycle (spawn → `postMessage` → timeout-terminate → drop), so the plumbing in
`browser_exec.rs` and `worker_transport.rs` is the template, not a thing to redesign.

## 2. The contract the in-browser executor must replace

For an in-browser executor to be a **drop-in backend**, it must satisfy the exact
contract the bridge `run_command` already exposes, so the `run_command` tool (or a
new tool sharing its shape) keeps working with the bridge swapped out underneath. The
bridge is the reference implementation of "run a real command and report a real exit
code."

### Request

The browser sends a JSON `POST` to `…/askk/tools/run_command` (see
[`src/tools/bridge.rs`](../src/tools/bridge.rs) `bridge_tool_request` and
[`src/tools/run_command.rs`](../src/tools/run_command.rs) `handler`). The body is:

```jsonc
{
  "command": "bun test",     // required. Command line; first token must be allowed.
  "cwd": "subdir",           // optional. Subdirectory of the run root.
  "timeout_ms": 120000       // optional. Per-command hard limit (1_000–600_000).
}
```

### Response

The bridge `runCommand` handler
([`scripts/askk-local-bridge.mjs`](../scripts/askk-local-bridge.mjs), ~L386) returns
the standard ASKK tool envelope `{ success, data | error }`. On success:

```jsonc
{
  "success": true,
  "data": {
    "command": "bun test",
    "cwd": ".",            // path relative to the run root, "." for root
    "exit_code": 0,         // process exit code (or 1 if killed by signal)
    "ok": true,             // exit_code === 0 AND not timed out
    "timed_out": false,
    "stdout": "…",          // clamped to 60_000 chars
    "stderr": "…"           // clamped to 60_000 chars
  }
}
```

On a guardrail or runtime failure it returns `{ "success": false, "error": "…" }`
(disabled exec, disallowed binary, invalid cwd, spawn failure). The Rust side maps
`success: false` to a failed `ToolResult` and the `data` object to the agent's
observation text.

### Behavioral guarantees the executor must preserve

These are the parts the model and the loop depend on, independent of *where* the code
runs:

1. **A real exit code is the proof of success.** The `run_command` tool description
   tells the model to treat `exit_code 0` / `ok: true` as the *only* evidence a build
   or test step passed. An in-browser executor must surface a genuine process exit
   code, not a fabricated one — otherwise the loop's verification story breaks.
2. **Hard timeout, enforced by the harness.** The bridge arms a `setTimeout` and
   `SIGKILL`s the child; `run_js_in_browser` races a `gloo_timers` timeout and
   terminates the worker. The in-browser executor enforces the same `timeout_ms` by
   terminating the worker, sets `timed_out: true`, and never lets a runaway program
   hang the agent.
3. **Bounded output.** stdout/stderr are clamped (60_000 chars in the bridge) so a
   chatty program cannot blow the model's context or the snapshot size.
4. **A scoped working directory ("run root").** The bridge confines all paths to a
   run root and rejects `..` escapes (`runPath`). In-browser, the run root is an OPFS
   directory, mounted into the substrate's filesystem (see §5). Same confinement
   property, different backing store.
5. **A guardrail on what can run.** The bridge gates the first command token against
   `ALLOWED_EXEC_BINARIES`. In-browser the threat model is different (the sandbox
   *is* the safety boundary — code runs in a WASM/worker jail, not on the user's
   machine), so the binary allow-list becomes optional. But the approval-gate
   invariant from `CLAUDE.md` still applies: a destructive write or an outbound fetch
   from inside the sandbox should still pass the user's approval policy.

The crucial difference: the bridge runs **real processes on the user's machine** and
is dangerous-by-default (hence `--allow-exec` off by default, and the allow-list as a
"guardrail, not a sandbox"). An in-browser substrate inverts this — code runs in a
sandbox the browser already isolates, so execution can be **on by default** and the
guardrails relax. That inversion is the entire reason to do this.

## 3. Substrate decision matrix

The question is which substrate runs *inside the tab* under the contract above. Each
row is prototyped by a sibling spike. Ground-truth as of 2026:

| Substrate | What runs | OSS & self-hostable | Size | Perf | COOP/COEP needed | gh-pages deployable | Generality |
|---|---|---|---|---|---|---|---|
| **WASI tiny-shim** (`@bjorn3/browser_wasi_shim`, MIT) | A single self-contained `wasm32-wasi` binary (one program, one process) | Yes — MIT, pure static JS/WASM | Tiny (~tens of KB of shim) | Near-native for the WASM itself | **No** | **Yes**, trivially | Single WASM programs only — no threads, no `fork`/`exec`, no subprocesses |
| **WASIX / `@wasmer/sdk`** | WASIX binaries with threads, signals, subprocess (`fork`/`exec`), sockets | Yes — open SDK, self-hostable assets | Medium–large (MB-scale SDK + per-binary WASM) | Good; near-native compute, thread overhead | **Yes** — needs `SharedArrayBuffer` ⇒ cross-origin isolation | Only with the coi-serviceworker workaround | High for the WASIX ecosystem; still WASM-target binaries, not arbitrary OCI images |
| **container2wasm** (Apache-2.0) | **Any OCI image** (e.g. Alpine) via in-browser CPU emulation | Yes — Apache-2.0, fully self-hostable | Heavy (emulator + packed rootfs, many MB) | Slow — CPU emulation; ~16 s for a `node` hello-world | **Yes** — uses `SharedArrayBuffer` ⇒ needs coi-serviceworker | Only with the coi-serviceworker workaround | Highest — runs literally any Linux binary, including `bash`, `apt` packages, real toolchains |
| **CheerpX / CheerpJ** (proprietary) | x86 Linux (CheerpX) / JVM (CheerpJ) in-browser | **No** — proprietary; CheerpX's license **forbids self-hosting the engine on your own origin** | Large | Good (JIT) | Yes (CheerpX uses `SharedArrayBuffer`) | **No** — license + self-host restriction are incompatible with gh-pages | High, but disqualified on licensing |
| **Keep the bridge (fallback)** | Anything the host machine can run, allow-listed | N/A — it's a local Node process | N/A (external) | Native | No (it's a separate origin/process) | N/A — defeats the no-gateway goal | Highest, but **requires a second machine and install** |

### Reading the matrix

There is no single winner; there is a **simplicity gradient**, and the project's
stated value ("as simple as possible") points at the top of it:

- **WASI tiny-shim is the "simple path."** It is the only substrate that needs **no
  COOP/COEP**, deploys to GitHub Pages with zero header gymnastics, and adds only a
  few KB. The cost is generality: it runs *one* statically-linked WASM program with
  no subprocesses. For "compile this Rust/C/Zig/Go-via-WASI to a single binary and
  run it," it is ideal and should be the **default substrate**.
- **container2wasm is the "generality path."** It is the only OSS substrate that runs
  *arbitrary* binaries / a real Alpine userland, which is the literal ask ("every
  binary, not just Python"). The cost is steep: multi-megabyte payloads, ~16 s
  cold-start for trivial programs, and a hard dependency on cross-origin isolation
  (hence coi-serviceworker). It is the right backend for "I need a real shell and an
  apt package," accepted as a heavy, opt-in tier.
- **WASIX sits between them** — real subprocesses/threads without full CPU emulation,
  but still pays the cross-origin-isolation tax and is limited to WASM-target
  binaries.
- **CheerpX/CheerpJ are out.** Proprietary and, decisively, CheerpX's license forbids
  self-hosting the engine on our own origin — incompatible with a static gh-pages
  deploy. (GraalVM-in-browser is likewise not feasible.) Documented for completeness
  so the option is not revisited.
- **The bridge stays as an explicit fallback**, not the default. It remains the only
  way to run native, non-WASM toolchains at native speed, for users who *do* run a
  local helper. The in-browser executor is the no-install default; the bridge is the
  power-user escape hatch.

The likely shape: **tiny-shim as the default in-browser executor, container2wasm as
an opt-in "full environment" tier behind cross-origin isolation, bridge as fallback**
— all three behind one capability seam (§5) so the model sees one tool.

### Current state (this batch)

The matrix has been acted on. Status of each row, shipping in the current batch:

- **WASI tiny-shim is the live default substrate.** The §5 capability seam is
  being wired to `@bjorn3/browser_wasi_shim`: `run_in_sandbox` gains a real
  `WasiShimExecutor` backend (replacing the worker stub), running a single
  `wasm32-wasi` binary per call in a disposable worker with copy-in/copy-out of
  the `/workspace` run root and timeout-terminate semantics — the same worker
  lifecycle as §1. No COOP/COEP, so it deploys to gh-pages unchanged.
- **Python ships as a first-class runtime on that substrate.** A CPython
  `wasm32-wasi` build runs on the tiny-shim, exposed to the agent as a dedicated
  `run_python` tool. Runtime assets follow the project asset policy: committed
  in-repo when ≤45 MB per file, otherwise lazy-fetched from a pinned URL and
  cached in CacheStorage.
- **Rust and Java execution are DEFERRED.** No `rustc`/`javac` `wasm32-wasi`
  builds exist; true in-browser compilation for either language would require
  custom container2wasm images (a Docker build step, >100 MB of hosted assets,
  and COOP/COEP via coi-serviceworker). This batch ships **editor support only**
  (syntax highlighting; Java via `@codemirror/lang-java`); execution stays a
  documented future tier on the container2wasm row above.
- **Bun as an in-browser runner is rejected.** Bun has no WASM build (it is Zig
  + JavaScriptCore; a browser build is not feasible), so JavaScript execution
  stays on the existing `run_js` tool.
- **container2wasm remains documented, not shipped.** It stays the opt-in
  "full environment" tier behind cross-origin isolation, exactly as the matrix
  recommends; nothing in this batch depends on coi-serviceworker.

## 4. The COOP/COEP / SharedArrayBuffer constraint

Anything that needs threads or shared memory — WASIX and container2wasm both do —
requires `SharedArrayBuffer`, and the browser only exposes `SharedArrayBuffer` when
the page is **cross-origin isolated**. Cross-origin isolation requires two response
headers on the top-level document:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp   (or credentialless)
```

**GitHub Pages cannot set custom response headers.** This is the central deployment
constraint: a substrate that needs `SharedArrayBuffer` cannot be cross-origin
isolated by configuration on gh-pages.

The only viable workaround on a static, header-less host is
**[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)**: a small
service worker, served from our **own origin**, that intercepts responses and injects
the COOP/COEP headers client-side, retroactively enabling cross-origin isolation.
Its caveats are real and must be designed around:

- **First-load reload.** The service worker isn't controlling the page on the very
  first visit, so the page reloads itself once after the worker registers.
  `SharedArrayBuffer` is unavailable until after that reload — execution UI must
  account for a "still initializing" state.
- **Safari is the weak spot.** Safari's service-worker behavior around COEP is
  flakier than Chromium/Firefox; treat cross-origin-isolated execution as
  best-effort there and degrade gracefully (fall back to the tiny-shim tier, which
  needs none of this).
- **Own-origin only.** The worker file must be served from our origin (it is, on
  gh-pages) — it cannot be a third-party script.

This is why the matrix treats "no COOP/COEP needed" as a first-class column: the
**tiny-shim path sidesteps this entire problem**, which is a large part of why it is
the recommended default. The heavier tiers (WASIX, container2wasm) are gated behind
coi-serviceworker and its first-load/Safari caveats.

Full details and the spike result live in
[`spikes/coi-serviceworker.md`](./spikes/coi-serviceworker.md).

## 5. Proposed execution-capability seam

Execution is modeled as a **capability** (the fourth core pillar: Engine, Tool,
Provider, **Capability**), behind a trait that mirrors the bridge `run_command`
contract from §2. The winning substrate plugs in as one implementation; the loop and
the tool never learn which one is active.

```rust
/// One in-browser code execution. Mirrors the bridge `run_command` request/response
/// so any backend is a drop-in for the other. Implementors: tiny-shim, WASIX,
/// container2wasm, and the existing bridge (as a fallback impl).
pub struct ExecRequest {
    pub command: String,        // e.g. "python main.py" / "./a.out" / "bun test"
    pub cwd: Option<String>,    // subdir of the run root (OPFS)
    pub timeout_ms: u32,        // hard limit; backend must terminate on elapse
}

pub struct ExecOutcome {
    pub exit_code: i32,
    pub ok: bool,               // exit_code == 0 && !timed_out
    pub timed_out: bool,
    pub stdout: String,         // bounded
    pub stderr: String,         // bounded
}

#[async_trait(?Send)]          // single-threaded WASM
pub trait CodeExecutor {
    /// Run one program to completion (or timeout) in the sandboxed run root.
    async fn run(&self, req: ExecRequest) -> AppResult<ExecOutcome>;
}
```

Key properties of the seam:

- **Backend-agnostic loop.** The ReAct loop calls a `run_in_sandbox` tool; the tool
  calls `CodeExecutor::run`; the registered executor decides whether that means a
  tiny-shim worker, a container2wasm worker, or a POST to the bridge. Swapping
  substrates is changing which `impl` is registered, never editing the loop —
  identical to the existing `Tool` / `InferenceProvider` extensibility story.
- **Same worker lifecycle as today.** Each WASM-backed impl reuses the spawn →
  `postMessage` → timeout-terminate → drop pattern from
  [`browser_exec.rs`](../src/engine/browser_exec.rs) and the Blob-URL trick from
  [`worker_transport.rs`](../src/mcp/worker_transport.rs). The bridge impl reuses
  [`bridge.rs`](../src/tools/bridge.rs) `bridge_tool_request`.
- **OPFS as the shared run root.** All substrates mount the same OPFS run-root
  directory as the program's filesystem, so a file written by one tool is visible to
  the executor — preserving the bridge's "run root" semantics without a real disk.
- **Untrusted output.** Whatever the program prints is observation **data** fed back
  to the model, never instructions — the core invariant the loop already enforces for
  every tool result.

The Rust-side scaffold for this tool lives in
[`src/tools/run_in_sandbox.rs`](../src/tools/run_in_sandbox.rs) (a sibling unit is
building it). It is a normal descriptor module registered in
`register_builtin_tools()`, exposing the §2 request shape to the model and delegating
to the registered `CodeExecutor`. As substrates land, the tool's spec and behavior do
not change — only the backend wired behind the trait.

> **Status (current batch).** The seam is being wired to its first real
> substrate: a `WasiShimExecutor` backed by `@bjorn3/browser_wasi_shim` replaces
> the worker stub behind `run_in_sandbox` (copy-in/copy-out of the `/workspace`
> run root, hard timeout enforced by terminating the worker). Python ships as a
> first-class runtime on the same substrate via a dedicated `run_python` tool.
> The tool spec the model sees is unchanged — only the backend behind the trait
> changed, which is the property this section was designed to guarantee. See
> §3 "Current state (this batch)" for the Rust/Java deferral and the Bun verdict.

## 6. Open questions for the spikes

The matrix is a starting point; the parallel spikes resolve the empirics:

- Tiny-shim: which language toolchains realistically compile to a single
  `wasm32-wasi` binary that the shim runs, and how is the binary delivered (bundled
  vs. fetched vs. compiled in-tab)? *(Partially resolved this batch: CPython
  `wasm32-wasi` is the first delivered runtime — committed if ≤45 MB per file,
  else pinned-URL lazy fetch + CacheStorage; `rustc`/`javac` have no WASI builds
  and are deferred — see §3 "Current state".)*
- container2wasm: is the ~16 s cold-start amortizable (warm worker pool, cached
  rootfs in OPFS), or is it acceptable only as a deliberate "full environment" tier?
- WASIX: does it earn its cross-origin-isolation cost over tiny-shim for the cases we
  care about, or is it skipped in favor of "tiny-shim by default, container2wasm for
  everything else"?

## Cross-references

- [`spikes/wasi-shim.md`](./spikes/wasi-shim.md) — the simple, no-COOP/COEP default path.
- [`spikes/wasix.md`](./spikes/wasix.md) — threads/subprocess via `@wasmer/sdk`.
- [`spikes/container2wasm.md`](./spikes/container2wasm.md) — any OCI image via CPU emulation.
- [`spikes/proprietary-substrates.md`](./spikes/proprietary-substrates.md) — why CheerpX/CheerpJ/GraalVM are out.
- [`spikes/coi-serviceworker.md`](./spikes/coi-serviceworker.md) — enabling `SharedArrayBuffer` on gh-pages.
- [`extensibility.md`](./extensibility.md) — the Tool / Capability contracts the executor plugs into.
- [`agent-prompting.md`](./agent-prompting.md) — how a tool's spec reaches the model.

## Strategy layer

A `Strategy` is an ordered sequence of `Phase`s with routing (`Next`/`Back`/
`Done`, back-edges capped at 2). Each phase runs the same base turn with its own
response schema, prompt frame, tool policy, and loop mode. `react` is the
single-phase degenerate case and the default. The orchestrator is a normal agent
running the `orchestrate` strategy; sub-agents are reached through `call_agent`,
and parallel fan-out is the existing concurrent tool dispatch. Memory is owned
per loop object: working messages compact at 100 messages or 70% of the context
window; each agent identity keeps a rolling summary in the snapshot.
