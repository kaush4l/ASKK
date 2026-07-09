# Capabilities — what this workspace can do, and what it grows next

The harness is a browser-only agent workspace: everything below runs client-side
(wasm + vendored JS), talking to whatever LLM the active provider profile names.
This file is the working inventory — features land here when live-verified, the
queue names what makes it more of a *workspace* (old ASKK is the feature
reference; kiln is the structure reference).

## Live (verified against a local model)

| Capability | Where | Proof |
|---|---|---|
| Chat + ReAct loop (TOON/JSON contracts, repair cascade) | `crates/core` contracts, `crates/runtime` turn loop | wave 7 e2e |
| True streaming (SSE, chunk-safe, UTF-8-safe) | `crates/inference/transport.rs`, `web/host/fetch.rs` | wave 7 e2e |
| Named provider profiles (BYOK, per-profile model/max_tokens) | `web/host/profile.rs`, settings UI | wave 7 e2e |
| web_search (DDG → Wikipedia fallback) | `runtime/tools/search.rs` | wave 7 e2e |
| Delegation: every enabled agent is a tool; authority narrows | `runtime/delegate.rs` | wave 7 e2e |
| **Parallel agents**: multi-call turns (`calls` list) join concurrently; UI drives N runs at once | `runtime/run/dispatch.rs`, `web/host/boot.rs` | wave 9 |
| **Folder-is-config agents**: `agents/` decides set + order (build.rs bake, manifest.json runtime override on static hosts) | `crates/web/build.rs`, `web/host/boot.rs` | wave 9 |
| **Orchestrator-managed loops**: plan → dispatch (loop) → verify (gate) declared phases | `agents/orchestrator.md` | wave 9 |
| Speech: STT (whisper) + TTS (kokoro) behind HF-model-id seam | `web/host/speech.rs`, `scripts/speech/` | wave 8 round-trip |
| **VM: real x86 Linux in the browser (v86)** — serial console, manifest-driven images | `web/ui/vm.rs`, `assets/vm/` | wave 9 |
| Signal-log persistence (OPFS, in-memory degrade), replay = projection | `runtime/state/log.rs` | workflows tests |
| Action gate: mutating tools park for confirmation | `runtime/actions/` | workflows tests |

## Queue (what would make it more of a workspace)

Ordered by leverage; each is one increment.

1. **Workspace FS tools** — agent-visible OPFS folder (list/read/write/edit) as
   gated tools; the VM and the agents share artifacts. (Old ASKK: workspace-builtin.)
2. **VM as a tool** — `vm_exec(cmd)`: run a command in the booted guest over the
   serial line, return output. Turns the alpine VM into the exec substrate.
3. **Cancel = fetch abort** — AbortController through `send_stream` (GAPS 17).
4. **Worker offload** — engine + speech off the main thread (GAPS 18/22 refold
   saturation is the symptom).
5. **Memory tools** — `remember`/`recall` over the per-agent MemoryStore, so
   agents curate their own memory instead of only receiving it.
6. **MCP client** — browser-direct MCP servers as ToolRegistry entries.
7. **Skills folder auto-discovery UI** — settings surface for enabling/ordering
   what the folder provides.

## Configuration surface

- `agents/*.md` — one file per agent: frontmatter (id, tools, skills, provider,
  contract, format, `phase.N.*` strategy) + body directive. The folder IS the
  roster; `agents/manifest.json` fixes order and (on static hosts) overrides at
  runtime without a rebuild.
- `agents/soul.md` — shared identity prelude.
- `agents/skills/*.md` — reusable prompt fragments agents opt into.
- Provider profiles — saved in the browser (OPFS), switchable per run.
