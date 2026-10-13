# ASKK profiling and port comparison (2026-10-08)

Machine: Apple M4 Max, 16 cores, 128 GB, macOS (Darwin 27.2), Bun 1.4.2, Next 16.3.8.
Code: ~22.7K lines JS/JSX (backend, companion, components, app, lib, hooks).

## 1. Measured (this repo, this machine)

| Metric | Value | How |
|---|---|---|
| Dev server (`bun run dev --desks`, Next dev + Turbopack + team worker) RSS | **~1.0 GB** (top footprint 330 MB), 51 threads, 0.2–0.5% CPU idle | `ps`, `top` PID 53177 |
| Turbopack PostCSS node child | 103 MB | `ps` |
| A vendor MCP server (bun) | 249 MB | `ps` |
| Compiled companion `dist/askk` idle | **55 MB RSS, 18 threads, 0% CPU** | started on :1199 |
| `dist/askk` binary | 64 MB single file (arm64) | `ls` |
| Static build `out/` | 2.0 MB (1.3 MB JS, 23 chunks) | `du` |
| `node_modules` / `.next` dev cache | 527 MB / 722 MB | `du` |
| Host API latency, dev (`whoami`, `fs/list`) | 0.5–2.2 ms | curl ×5 |
| Host API latency, compiled | **0.33–0.83 ms** | curl ×5 |
| Page HTML dev warm / cold | 9 ms / 39 ms | curl |
| Page HTML compiled static | 0.6 ms | curl |
| `mcp/tools` first list (spawns MCP servers) | 1.6 s, 234 KB | curl |
| Bun bare runtime | 12 MB RSS, 10 ms start | `/usr/bin/time` |
| Bun Worker spawn | **0.53 ms**, ~3 MB each | bench |
| Worker postMessage roundtrip | 13 µs | bench 2000× |
| structuredClone / JSON roundtrip of 200 KB state | 0.04 / 0.055 ms | bench |
| `parseToolPlan` | 0.56 µs | bench |

Per-step overhead (clone + parse + patch) < 0.1 ms; LLM step 0.3–30 s; remote
MCP call 50–500 ms. Latency budget is >99.9% network + model. Memory is
dominated by Next dev (~1 GB) and vendor MCP runtimes, not engines (~3–8 MB each).

## 2. 1:1 port estimates (not measured; typical arm64 baselines)

| Resource | Bun + Next (now) | Java Spring Boot (React UI kept) | Rust + Dioxus | Python (FastAPI/asyncio, React UI kept) |
|---|---|---|---|---|
| Idle RSS server | 55 MB compiled / 1 GB dev | 180–350 MB JVM; GraalVM native 50–90 MB | **10–25 MB** (+60–120 MB WebView for desktop UI) | 45–90 MB |
| Per engine | ~3 MB Worker | ~1 MB thread / KB virtual thread | ~100 KB tokio task | MB per process (GIL forces processes) |
| 20-agent desk busy | 150–250 MB | 400–800 MB | 30–80 MB | 150–400 MB |
| Cold start | ~0.3 s companion | 2–6 s; native 0.05–0.1 s | **< 20 ms** | 0.3–1.5 s |
| Host API p50 | 0.4 ms | 0.3–1 ms warm, 10–50 ms pre-JIT | 0.05–0.2 ms | 0.5–2 ms |
| CPU per non-LLM step | < 0.1 ms | < 0.1 ms post-JIT | < 0.02 ms | 0.2–1 ms |
| Parallel CPU across agents | yes (Workers) | yes | yes | no in-proc (3.13t free-threaded experimental) |
| GC pauses | JSC, sub-ms–few ms | G1 1–10 ms, ZGC sub-ms | none | refcount + cycle GC, ms |
| Deploy size | 64 MB single file | jar + JRE 80–280 MB; native 60–120 MB | **5–20 MB** | 50–500 MB |
| Clean build | 30–60 s | 30–90 s; native 2–5 min | 1–5 min release | none |
| Idle energy | low (compiled) | medium (JIT/GC threads) | lowest | low |
| Rewrite cost | 0 | ~80% backend | ~100% backend + UI | ~70% backend |

Input → decision → action latency is equal across columns within ~1 ms: remote
services (50–300 ms) and LLM (0.3–30 s) dominate. A 30 s polling loop has 1000× headroom
in any stack.

## 3. Architecture / OS reach

| Target | Bun + Next | Spring Boot | Rust + Dioxus | Python |
|---|---|---|---|---|
| macOS arm64 / x64 | ✅ | ✅ | ✅ | ✅ |
| Linux x64 / arm64 (glibc + musl) | ✅ `bun build --compile --target` | ✅ | ✅ | ✅ |
| Windows x64 / arm64 | ✅ x64, arm64 partial | ✅ | ✅ | ✅ |
| Browser-only demo (engines in tab) | ✅ native (OPFS, Workers) | UI only | ✅ WASM | ❌ (Pyodide slow, no threads) |
| iOS / Android | PWA only | ❌ | Dioxus mobile (beta) | ❌ |
| Pi / ARM SBC | ✅ | ✅ heavy | ✅ best | ✅ |
| Cross-compile from one Mac | ✅ one command | jar + JRE anywhere | ✅ targets/cross | per-OS wheels |

## 4. Feature reachability

| Feature | Bun + Next (now) | Spring Boot | Rust + Dioxus | Python |
|---|---|---|---|---|
| Sandboxed terminal (sandbox-exec, allow-list) | ✅ in use | ✅ | ✅ + landlock/seccomp native | ✅ |
| Mini sandboxed OS per agent (WASM / microVM) | partial (Workers + sandbox-exec) | via Docker | **best**: wasmtime in-proc, Virtualization.framework (objc2), firecracker | Docker SDK, e2b, wasmtime-py |
| Containers (Docker / Apple `container`) | HTTP to socket / CLI | docker-java | bollard | docker-py (most mature) |
| Speech (SpeechAnalyzer) | ✅ Swift helper, JSON lines | same helper | helper or direct FFI | helper or PyObjC |
| Apple Foundation Models | ✅ via Python bridge | bridge | Swift bridge | **native SDK** |
| Shortcuts / Reminders / say | ✅ fixed programs | same | same + objc2 | same + PyObjC |
| MCP | ✅ TS SDK (reference) | Java SDK | rmcp | ✅ reference SDK |
| TypeScript MCP servers | ✅ same runtime | IPC | IPC | IPC |
| Numerics (numpy/pandas/scipy) | ❌ hand-written | partial | polars/ndarray | **best** |
| Local LLM (MLX, llama.cpp) | HTTP to a local server | HTTP/JNI | candle, mlx-rs, llama-cpp-rs | **MLX native** |
| Reuse React/shadcn UI | ✅ | ✅ | ❌ RSX rewrite | ✅ |

## 5. Path of resistance to a shipped application

| Step | Bun + Next | Spring Boot | Rust + Dioxus | Python |
|---|---|---|---|---|
| Single executable | **done** (`dist/askk`) | jpackage / native-image (reflection config) | `cargo build` | PyInstaller/Nuitka, fragile |
| Desktop .app window | wrap companion in Electrobun/Tauri shell or PWA | jpackage + browser | **native** `dx bundle` | pywebview |
| Sign / notarize macOS | codesign bun binary (JIT entitlement) | JRE signing pain | standard | painful (many dylibs) |
| Auto-update | build it | build it | cargo-packager updater | build it |

## 6. Recommendation (hardware first, run everywhere second)

1. Stay on Bun + JS: per-step overhead < 0.1 ms, a port gains nothing on decision latency.
2. Run the compiled companion for always-on desks, not `next dev`: ~1 GB → ~55 MB idle, API 2 ms → 0.4 ms, no Turbopack child. Biggest hardware win available today (note: with several desks, an integration listener still needs one owner per bot).
3. Hot paths to Rust only if profiled (heavy numeric sweeps, tight polling loops): small binary/MCP server or Bun FFI lib, same pattern as `askk-speech`.
4. Python only as sidecar (numerics, MLX, Foundation Models) — the existing `apple-fm` bridge pattern.
5. Sandbox next: Apple `container` / Virtualization.framework on macOS, landlock+seccomp on Linux, behind the same `term.*` capability.
6. Reach: `bun build --compile --target=bun-{darwin,linux,windows}-{arm64,x64}` + static `out/` for browsers; Apple features stay capability-gated (`HOST_CAPABILITIES`) so other hosts degrade, not break.
