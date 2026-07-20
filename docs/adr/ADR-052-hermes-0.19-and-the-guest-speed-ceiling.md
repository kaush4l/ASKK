# ADR-052 — hermes 0.19.0 + the guest-speed ceiling (why no CPU-core knob, why no WebGPU emulator)

- **Status:** accepted, 2026-07-20
- **Relates to:** ADR-051 (self-contained image — the bump rides the same
  bake), e46a26f (WebGL terminal renderer — the one GPU lever we *do* pull).

## Context

Two owner asks landed together: (1) a new hermes release is out — update it;
(2) "want speed — can it run on multiple CPU cores or on WebGPU? If more
cores can be allocated, give the user the option to pick it."

The first is a version bump. The second is an architecture question, and the
honest answer is a hard **no** for the emulator — worth writing down so it is
not re-litigated every few weeks.

## Decision 1 — hermes 0.18.2 → 0.19.0

Pin `hermes-agent[web,pty]==0.19.0` in `image/Dockerfile` (live path) and
`image/bundles.d/hermes.sh` (dormant shelf path, kept in lockstep). The
`[web,pty]` dependency closure is **byte-identical** across 0.18.2→0.19.0
(fastapi / uvicorn / ptyprocess / websockets all unchanged) — only the
`messaging`/`slack`/`matrix` extras moved, and we install none of them.
`requires_python <3.14,>=3.11` still fits the baked PBS musl python 3.11.15.
So the bump is structurally inert: same rebuild, same node-for-pty
requirement, no Dockerfile shape change. Rebuild picks it up; nothing else
moves.

## Decision 2 — no multi-core knob, no WebGPU emulator

**How the guest runs in the browser (measured, not assumed).** The c2w Bochs
image is one WebAssembly module. `docs/worker.js` instantiates it with a plain
`WebAssembly.instantiate` and calls `wasi.start` **once**, on a single
dedicated Web Worker, which then blocks inside the emulator loop forever
(`worker.js:143-147`). No `wasi_thread_spawn` import is wired; the module is
not pthread-compiled. The network stack (`stack-worker.js`) and the timer
(`timer-worker.js`) each already own a separate worker. So the real host cores
that this design can use, it already uses — one per worker.

**Why guest SMP gives no speedup.** The guest's vCPU count is a *build-time*
Bochs setting, not a browser knob. Bake `cpu: count=4` and Bochs simply
interleaves four emulated vCPUs on the same single host thread — throughput is
divided across them, plus SMP cache-coherency/lock overhead, for a workload
(a mostly-I/O-bound python agent) that is single-threaded anyway. Net effect:
**slower**, never faster. A "pick your cores" slider would be a dead control
that lies about what it does — so we don't ship one. Real parallelism would
require c2w's Bochs recompiled with emscripten pthreads *and* Bochs' internal
SMP threaded across `SharedArrayBuffer` — which upstream does not provide and
which is a research project, not a feature toggle (ADR-level; escalated, not
invented through).

**Why WebGPU can't run the emulator.** WebGPU executes data-parallel shaders.
An x86 interpreter is sequential control flow with self-modifying data
dependence between every instruction — the one workload shape a GPU cannot
accelerate. The only GPU lever that *does* apply is the **terminal
rendering**, and that already ships: the xterm WebGL addon (e46a26f) puts glyph
compositing on the GPU with a canvas fallback on context loss. That is the
whole of "runs on the GPU" that this stack can honestly offer.

## Consequence

The speed of the guest is the speed of one Bochs thread. The genuine levers
are (a) less work inside the guest (fewer cold imports, lighter boot — the
ADR-051 bake already cut the tmpfs-extraction tax) and (b) GPU-side terminal
rendering (already done). "More cores" and "run it on WebGPU" are not levers
here and asking for them again gets this same answer. If the owner wants the
guest to *feel* faster, the real conversation is the emulator backend / guest
weight, not core count.
