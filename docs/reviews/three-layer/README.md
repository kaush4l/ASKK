# Three-layer core — assessment + ground-up build plan

> Status: **proposal, not a decision.** Every "gate" below is ADR-level per
> CLAUDE.md and belongs to the author. Nothing here has been built.
>
> Inputs: this repo at `80564a2`, `docs/reviews/boop-agent/` (2026-07-18),
> and https://github.com/AbuZar-Ansarii/PocketStrike-AI as the mobile
> reference.

## 0. The three asks, restated

1. **Abstract core** — distil openclaw / hermes / other agent prototypes into
   one core, written in a language + framework that fits the author's build
   flow.
2. **Runs on a phone** — like PocketStrike-AI, but with the OS- and
   hardware-specific dependencies eliminated by targeting wasm instead of a
   host OS.
3. **Three layers** — tools and state stay on the device; language models are
   externally hosted.

## 1. What has gone right

Everything in this list is proven in `main` and survives any rewrite.

| # | Asset | Where | Why it matters |
|---|-------|-------|----------------|
| 1 | **Sentinel-host capability map** | `CONTRACTS.md:16-23` | Guest code calls ordinary URLs (`llm.askk.internal`, `persist.`, `ingress.`, `bin.`); the page maps them to browser capabilities. The agent never learns it is in a browser. This *is* the layer-1↔layer-2 seam, already discovered. |
| 2 | **CONTRACTS.md as a seam registry** | root | One file names every cross-file boundary. Renames are renegotiated there, never unilaterally. Rare discipline; keep it verbatim. |
| 3 | **Boot markers + phase timings** | `CONTRACTS.md:51-66` | `@ASKK:BOOT@ … @ASKK:T:<phase>=<s>@`, printed with split literals so a command echo can't self-match. Observable bring-up, earned the hard way. |
| 4 | **Ingress relay + WS-over-relay tunnel** | `CONTRACTS.md:68-89`, `rootfs/askk-ingressd`, `docs/askk-ws.js` | Full-duplex WebSocket carried over HTTP long-poll through a Service Worker, no server. Reusable anywhere, and the single hardest thing shipped. |
| 5 | **Zero-build page + pure-core tests** | `docs/*.test.mjs` (6 files) | Plain ES2022, no bundler. Decision logic extracted to `AskkGateCore` / `AskkIngressCore` / etc. and tested with `node --test`. Correct testing shape; carry it forward unchanged. |
| 6 | **Content-versioned asset cache** | `manifest.json` + `?g=<gz_total>`, `docs/askk-sw.js` | Cache-first, stale-purge, hash-checked (`BUNDLES.json`). Solves "download heavy assets only when changed" — needed again for wasm tool modules. |
| 7 | **Honest capability gate** | `docs/index.html:334-369`, `docs/boot.js:71-78` | Tells the user *why* it can't run instead of spinning forever. `AskkGateCore.decide()` is pure and tested. |
| 8 | **ADR discipline** | `docs/adr/` | 6 ADRs since the rewrite, one clean documented reversal (048 ↔ 051). The archaeology is intact, so this document can be written at all. |
| 9 | **Self-contained image** | ADR-051 | Bake-into-ISO beat runtime extraction: tab 1315MB → ~794MB, one cached artifact, zero-download start. The *reasoning* (read from read-only store, never copy into RAM) transfers to any asset tier. |

Also right, and not code: the **LMs are remote** decision. That is what makes
a phone target arithmetically possible at all.

## 2. What has gone wrong — the ceiling, with evidence

| Fact | Evidence | Consequence |
|------|----------|-------------|
| The guest is **one single-threaded x86 interpreter** | `docs/worker.js:143-147` — one `WebAssembly.instantiate`, one `wasi.start`; `wasi_thread_spawn` appears nowhere in the repo | No core knob, no WebGPU path (ADR-052). Guest speed is fixed. |
| **~860MB tab**, 348MB raw wasm, 119MB gz | `image/build.sh` budget table | Phones are out by an order of magnitude. |
| **SharedArrayBuffer + COOP/COEP required** | `docs/boot.js:293-295`, `serve.py:40-41`, `docs/askk-sw.js:303` | Cross-origin isolation. iOS Safari will not deliver it under `credentialless`; `?coep=require-corp` is a desktop-only escape hatch. |
| Mobile is **explicitly refused** | `docs/index.html:353-355` — "1 GB of memory. A lightweight mobile companion is on the roadmap." | The code already admits ask #2 is unmet. |
| Python cold-import ~1-2 min in-guest | ADR-051 traps, ADR-052 | Bochs interprets; it does not JIT. |

### The structural mistake

**ASKK emulates a computer in order to run an agent. The agent does not need
a computer — it needs tools and state.**

To run what is fundamentally `fetch()` + tool dispatch + a state store, the
current stack pays for a page-table emulator, an ELF loader, a libc, a Linux
kernel, and CPython. That is where the 860MB and the desktop-only gate come
from.

The author's instinct — *target wasm, drop the OS dependency* — is exactly
right. It was applied at the **wrong layer**: a whole PC was compiled to wasm,
instead of compiling *the tools that actually need native code*.

### PocketStrike, for contrast

| | ASKK today | PocketStrike-AI |
|---|---|---|
| Runtime | x86 Alpine in wasm, in a tab | native Python 3 on Termux |
| Footprint | ~860MB tab, 119MB download | 30-50MB RAM, ~100MB storage |
| Phone | **no** | **yes**, Android 7 / 1GB RAM |
| Portability | any desktop browser, no install | Termux + Android only |
| Model | remote, BYOK | remote, BYOK |
| Tools | full POSIX shell | 58 tools: network, device, Android API, files, security |
| Loop | hermes (ReAct) | ReAct + persistent bash + scheduler daemon |

PocketStrike is light and mobile because it emulates nothing — and pays with
Termux/Android/nmap/ADB lock-in, which is precisely what ask #2 wants gone.
ASKK is portable and pays 860MB for it.

**Neither is wrong. They are the two ends of one axis, and the target sits in
between: portability without emulation.**

## 3. Target — the three layers, drawn properly

```
L3  MODEL          remote, OpenAI-compatible, BYOK. Never on device.
     ▲  fetch only
     │
L1  CORE           agent loop, planner, tool dispatch, memory policy,
     │             session state machine.  PURE — zero I/O, zero platform.
     │             Testable headless. This is ask #1.
     ▼  capability interface  (fetch · kv · blob · spawn · sense · clock)
L2  HOST           one small shim per platform:
                     browser  → JS: fetch, IndexedDB/OPFS, Web APIs, wasm tools
                     native   → same interface over the OS
                     VM       → today's c2w guest, for a real POSIX shell
```

Two consequences worth naming:

- **The sentinel-host map is already this interface**, expressed as URLs
  (`CONTRACTS.md:16-23`). It does not need inventing, only lifting out of the
  VM and re-typing.
- **A new platform is a new L2, never a core rewrite.** That is what makes
  PocketStrike-class capability additive later instead of a fork.

### Where wasm actually belongs

Not the core — the core is fetch-bound orchestration, where wasm buys nothing
and costs a toolchain. Wasm belongs in the **tool tier**, per module, lazily
loaded, cached by the existing content-versioned scheme:

| Tool class | Mechanism | Wasm? | Size |
|---|---|---|---|
| Web (fetch, search, scrape) | `fetch` | no | 0 |
| Device senses (camera, GPS, clipboard, notify, sensors) | Web APIs | no | 0 |
| Files | OPFS | no | 0 |
| Python execution | CPython-wasi / Pyodide | **yes** | ~10-30MB |
| JS sandbox | QuickJS-wasm | **yes** | ~1MB |
| grep / sqlite / etc. | prebuilt wasm | **yes** | 1-5MB each |
| Real POSIX shell | today's c2w guest, as an optional host | **yes** | 119MB, desktop only |

Total for a useful phone agent: **single-digit MB**, versus 119MB today. And
none of the non-shell tiers need `SharedArrayBuffer` — which removes the
cross-origin-isolation requirement, which is what unlocks iOS.

### The honest boundary

Browser-only cannot do, at any effort:

- **raw sockets** — port scans, ARP monitoring, nmap. PocketStrike's security
  tooling is genuinely not portable. It needs a native L2.
- **true background execution on iOS** — no daemon, no reliable periodic
  wake. The available answers are Web Push (needs a push service) and
  catch-up-on-open; both are already scoped in
  `docs/reviews/boop-agent/07-target-architecture.md`.
- **cross-device state sync** — IndexedDB is per-device. Syncing needs a
  BYO target (Git, S3, CouchDB) or accepting device silos. **Open gate.**

Say these out loud in the product, the way `index.html:353` already does.

## 4. Prior art in this repo

`docs/reviews/boop-agent/07-target-architecture.md` (2026-07-18) already
reached the same shape from the other direction: standalone zero-build PWA,
SW shell, OPFS state, BYOK fetch, Web Locks leader election, P0-P3 roadmap,
explicit proactivity-degradation table.

**The design was done and gated, not missing.** What is new here is merging
it with ASKK's proven seams (§1) and PocketStrike's tool catalogue, and
naming the language decision.

## 5. Language — recommendation, and the gate

Build flow observed: zero build step, plain ES2022, `node --test` on pure
cores, docker only for the image, no bundler. A Rust harness was already
built and scrapped (tag `pre-rewrite-rust`).

**Recommendation: TypeScript core, wasm tool modules.**

- The core is orchestration, not computation — wasm accelerates nothing there.
- It runs natively in every browser and in node, so the same core is testable
  headless and shippable to a phone with no build step.
- `node --test` on pure cores already works; it carries over unchanged.
- Types can be `tsc --noEmit`-only, keeping the zero-build page.

Alternative worth stating fairly: **Rust → wasm** gives one core that compiles
to browser wasm *and* a native binary, which suits "target assembly"
literally, and makes the native L2 free. Cost: the toolchain tax that was
already paid and abandoned once, plus wasm-bindgen/chromedriver skew.

**This is an ADR-level gate. Author's call.**

## 6. Ground-up build order

Smallest walking skeleton first; each phase independently testable and
revertible.

| Phase | Deliverable | Done when |
|---|---|---|
| **0 — the seam** | Capability interface typed; core loop + one tool (`fetch`) + BYOK model call; mock host | Runs headless under `node --test`. No UI, no browser. |
| **1 — browser host** | SW shell, OPFS/IndexedDB state, chat UI, installable PWA | **Opens on the author's phone from a home-screen bookmark.** This is the moment it beats ASKK at ASKK's own stated goal. |
| **2 — tool tiers** | Web tools, device senses, file tools | Each tool has a pure-core test; senses degrade honestly when denied. |
| **3 — wasm compute** | Python + JS sandbox modules, lazy-loaded, content-versioned cache | A python tool call runs on the phone; second load downloads zero bytes. |
| **4 — agent + memory** | Agent definitions, memory policy, scheduling (Web Locks leader, catch-up-on-open) | Two tabs, one leader; closing and reopening catches up. |
| **5 — native host (optional)** | Second L2 over the OS | Raw-socket tools work; **L1 untouched, zero diff.** |

Phase 5 is the payoff and the proof of the design: PocketStrike-class
capability arrives as a host swap, not a rewrite.

### What happens to the VM

It stops being the product and becomes **one optional L2 host** — the "real
POSIX shell" tier for desktop. That is a genuine capability nothing else
offers, and it keeps `image/`, `rootfs/`, and the relay alive as a tier
instead of a dead end.

## 7. Open gates (author only)

1. **Language for L1** — TypeScript (recommended) vs Rust→wasm.
2. **New repo, or a `core/` inside ASKK?** The VM tier argues for one repo;
   the clean-slate instinct argues for two.
3. **State sync** — BYO target, or accept per-device silos?
4. **Proactivity floor** — is catch-up-on-open enough, or is Web Push (and
   the small service it implies) in scope?
5. **Scope of the tool catalogue** — which of PocketStrike's 58 tools are
   actually wanted, given raw-socket tools need phase 5.
