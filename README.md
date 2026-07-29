# HARNESS (working name — ADR-001)

A hosted, browser-only environment that an agent lives inside and can extend.
Rust core compiled to WebAssembly. htmx frontend. Self-authored modules. No install, ever.

The metaphor: **a person carrying a phone.** The phone has no task — it has a screen, storage,
a network, a clock, apps, and a coherent story about what it can do. HARNESS is the phone.
The agent is the person.

## Documents

- `docs/PROMPT.md` — the master prompt: goals, architecture, gates, invariants. Read first.
- `INVARIANTS.md` — hard invariants I1–I15.
- `RESEARCH.md`, `GLOSSARY.md`, `DOMAIN.md`, `ARCHITECTURE.md` — gate artifacts (G0–G2).
- `DECISIONS/` — ADRs. `MODULES/` — module specs.
- `docs/prior-art/three-layer.md` — the predecessor review that shaped this project.
- `docs/research/` — G0 research findings.
- `spikes/` — G0 running-code spikes (throwaway probes; the real workspace is `crates/`, G3+).

## History

This repository previously hosted ASKK (a container2wasm browser VM experiment). Its full
history is preserved — the Rust agent core lives at tag `pre-rewrite-rust`, the c2w project
at commit `80564a2`. The deployed ASKK page on `gh-pages` is untouched.
