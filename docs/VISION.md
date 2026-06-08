# ASKK Vision & Product Definition

The canonical product vision. It states what ASKK is, the three pillars it is built
on, what is in and out of scope for the MVP, and the phased path from where the code
is today to where it is going. Depth on individual decisions lives in the docs this
one links to.

> Companion docs: [`EXECUTION_MODEL.md`](EXECUTION_MODEL.md) (how general in-browser
> execution works), [`CURATION_STRATEGY.md`](CURATION_STRATEGY.md) (per-user
> curation), [`spikes/`](spikes/) (substrate experiments), and
> [`future/VOICE.md`](future/VOICE.md) (deferred voice scope). Architecture invariants
> and the trait contracts these pillars rest on are in
> [`extensibility.md`](extensibility.md) and [`definition-of-done.md`](definition-of-done.md).

## What ASKK is

ASKK is a **portable, self-contained, bring-your-own-key (BYOK) agent that runs
entirely inside a browser tab** — a "Hermes-style" harness. The user opens a static
page; the agent loop, its tools, and (increasingly) its code execution all run as
WebAssembly in that tab. It connects directly to an externally-hosted LLM over
`fetch` with the user's own key. There is no install, no account, no server it phones
home to, and — this is the direction — no gateway or companion process it depends on
to do its work.

Concretely, ASKK is a Rust agent compiled to WASM via Dioxus. The runtime spine is
the ReAct harness in [`src/engine/mod.rs`](../src/engine/mod.rs): each turn it asks
the model for a single action, runs one compiled tool, feeds the observation back as
**untrusted data**, and repeats until it produces a validated final answer. Tools are
MCP-shaped descriptors registered once in [`src/tools/mod.rs`](../src/tools/mod.rs);
adding a capability is one `register(...)` call, never an edit to the loop. State is
serializable and persisted to IndexedDB, so a run survives a reload and can be
resumed. The compute is "Hermes-style" in that it is a messenger that goes wherever
the user is: the harness itself is the deliverable, not a service the user logs into.

The agent does not just answer — it **does and shows**. It executes and tests code in
the tab to ground its work, and it communicates results through visual artifacts
(images, HTML, rendered output) on a surface built for the agent to "show me things,"
not only to print text.

## What ASKK is not

- **Not "Claude Code in a browser."** ASKK is not a coding assistant pinned to one
  vendor, and it is not trying to reproduce a terminal IDE. It is a general agent that
  happens to be able to run code, with code execution in service of the task — not the
  product itself.
- **Not a terminal harness.** There is no shell to drive, no PTY, no command line as
  the primary interface. The browser tab is the environment. Code execution is a
  sandboxed capability the agent invokes, not a terminal the user types into.
- **Not gateway-dependent.** The optional local bridge
  ([`scripts/askk-local-bridge.mjs`](../scripts/askk-local-bridge.mjs)) exists today
  as a development convenience for CORS, file access, and delegated execution. The
  product vision is to make it **unnecessary**: compute runs where the user is — ideally
  the tab itself. ASKK must work as a static page against any browser-reachable LLM
  with nothing else running.
- **Not a one-size-fits-all UX.** ASKK is curated per user type (see Pillar 3 and the
  curation strategy). It is not a single generic chat box trying to be everything to
  everyone.

## The three pillars

### Pillar 1 — Portable compute, no gateway

The agent loop runs anywhere the user can open a tab, talking directly to an
externally-hosted LLM. ASKK is already structured for this: model calls are
browser `fetch` against an OpenAI-compatible base URL, keys are the user's and stored
client-side, and the entire workspace state lives in IndexedDB. The loop is
auto-recoverable — a transient provider error retries with backoff, an unrecoverable
one *pauses* the run (resumable) rather than crashing the app.

The gateway is the thing to remove from the critical path, not add to. Today the local
bridge is the fallback when a hosted page cannot reach a local model (browser CORS /
mixed-content) and the adapter for reading workspace Markdown and delegating real
execution. The product goal is that none of those require a running process: the
substrate for execution moves *into* the tab (Pillar 2), and the harness degrades
gracefully — it stays useful even when the only thing present is the page and a model
endpoint.

### Pillar 2 — General in-browser code execution

Today the only execution that runs with zero setup is **JavaScript**, in a disposable
Web Worker: [`assets/exec_worker.js`](../assets/exec_worker.js) wraps the snippet in a
`Function()` body and the coordinator in
[`src/engine/browser_exec.rs`](../src/engine/browser_exec.rs) enforces a hard timeout
by terminating the worker. That is the proof that in-tab, bridge-free execution works
— but JavaScript-only is the floor, not the ceiling.

The goal is **general code execution — every binary, not just one language — inside the
browser**, replacing the Agent-Zero-style Docker sandbox and the bridge's
`run_command`. We want an Alpine-like / compile / sandboxed environment, packed into
the tab and kept **as simple as possible**. Pyodide was explicitly rejected: a single
pinned Python is not "general," and the weight is not worth a narrow win. The open
question is the substrate (a WASM-hosted micro-distro, per-language WASM runtimes, a
container-like layer compiled to WASM, or something simpler), and the current batch of
work exists to answer it. The detailed model and the criteria the substrate must meet
live in [`EXECUTION_MODEL.md`](EXECUTION_MODEL.md); the candidate experiments live in
[`spikes/`](spikes/).

This pillar slots cleanly into the existing tool contract. General execution arrives as
a compiled tool (the way `run_js` already is in [`src/tools/run_js.rs`](../src/tools/run_js.rs)),
registered once, with results fed back to the loop as evidence — no change to the spine.

### Pillar 3 — A communicating agent with visual artifacts

An agent that can only emit text is half-blind to the user. ASKK is built to **show**,
not just tell: a "screens to show me things" artifact surface where the agent can
display an image it generated, render HTML, or surface other rich output as part of
its answer. State already carries artifacts as serializable, persisted data, so an
artifact survives reload alongside the run that produced it. Pillar 2 makes this
real — code that generates an image or builds a page produces an artifact the agent
hands to the user through this surface.

Voice is part of this pillar's long-term shape — an agent that can also *speak* and
*listen* — but it is **explicitly future scope**, not MVP. See
[`future/VOICE.md`](future/VOICE.md).

## Goals and non-goals (MVP)

The primary user through MVP is the **owner**. The MVP question is narrow and concrete:
**prove the possibility of packing an environment / executing general code in the
browser.** Everything below serves that.

### MVP goals

- Prove a substrate can run **general** code (more than one language; ideally arbitrary
  binaries) in the browser tab, with no bridge and no gateway.
- Keep it **as simple as possible** — the smallest substrate that clears the bar wins;
  weight, complexity, and dependency count are costs we actively minimize.
- Integrate the winning substrate behind the existing compiled-tool contract so the
  ReAct loop and orchestrator are untouched.
- Land the artifact surface so the agent can show images / HTML, not only print text.
- Keep ASKK runnable as a static page against any browser-reachable LLM.

### MVP non-goals

- **Security hardening is explicitly out for MVP.** The current model relies on the
  browser's own sandbox and disposable workers; deeper hardening of the new execution
  substrate (resource caps beyond a timeout, untrusted-binary containment, supply-chain
  review of the packed environment) is deferred until after the capability is proven.
  The boundary that text retrieved by a tool is **data, never instructions** still holds
  throughout — that is correctness, not a hardening task.
- **One-size-fits-all UX is a non-goal.** ASKK is curated per user type; we do not build
  a single generic interface meant to satisfy everyone (see Curation below).
- **No native / desktop target for MVP.** The build and verification target is the
  browser/WASM page. The `platform` boundary stays clean so a native target remains
  cheap later, but it is not built now.
- **Voice is a non-goal for MVP** — deferred to a later phase.

## Per-user curation

ASKK is **curated per user type**: different users get a tailored set of agents,
tools, skills, and surfaces rather than one generic experience. The owner is the
primary user until MVP, so curation is shaped around that persona first, then
generalized. The mechanics — how personas map onto the existing agent manifests, tool
allowlists, skills, and model profiles, and how a curated bundle is selected — are
specified in [`CURATION_STRATEGY.md`](CURATION_STRATEGY.md).

Curation rides the same extensibility contracts ASKK already uses (see
[`extensibility.md`](extensibility.md)): an agent is a Markdown manifest with a tool
allowlist, a skill is a Markdown bundle, and tools are compiled descriptors. A persona
is therefore largely **data** — a selection over those — not new code paths.

## Roadmap

A phased path from today's code to the full vision. Each phase ends when its
capability is proven and integrated behind the existing contracts, not before.

### Phase 0 — Today: JS-only exec + bridge

Where the code is now. The agent runs JavaScript in-tab via the disposable Web Worker
([`assets/exec_worker.js`](../assets/exec_worker.js),
[`src/engine/browser_exec.rs`](../src/engine/browser_exec.rs)) and delegates real,
general code execution to the optional local bridge with `--allow-exec`
([`scripts/askk-local-bridge.mjs`](../scripts/askk-local-bridge.mjs)). This proves the
loop, the tool contract, persistence, and bridge-free JS — but general execution still
depends on a process outside the tab.

### Phase 1 — Prove general in-browser execution (current batch)

Answer the MVP question: can a simple, packable substrate run general code in the
browser tab with no gateway? This is exploratory — competing substrates are evaluated
as spikes against the criteria in [`EXECUTION_MODEL.md`](EXECUTION_MODEL.md), with each
candidate written up under [`spikes/`](spikes/). The deliverable of this phase is a
decision: the substrate to build on, with evidence.

### Phase 2 — Integrate the winning substrate + artifact comms

Bring the chosen substrate in behind the compiled-tool contract — general execution
becomes a registered tool the loop calls exactly like `run_js`, with results fed back
as evidence and no change to the spine. In parallel, land the artifact surface
(Pillar 3) so executed code can produce images / HTML the agent shows the user. At the
end of this phase, ASKK does general code execution and communicates visually, all in
the tab.

### Phase 3 — Curation / personas

Turn per-user curation from strategy into product: ship curated bundles (agents,
tools, skills, surfaces) per user type per [`CURATION_STRATEGY.md`](CURATION_STRATEGY.md),
beginning with the owner persona and generalizing outward.

### Phase 4 — Voice

Add the deferred voice capability — an agent that listens and speaks — per
[`future/VOICE.md`](future/VOICE.md). Out of scope until the phases above land.

## How this stays consistent with the rest of ASKK

This vision does not change the spine. The ReAct loop, the MCP-shaped tool registry,
the trait-based provider boundary, and serializable persisted state are the mechanisms
every pillar rides on — new execution and artifacts arrive as compiled tools and
state, registered once, never as edits to the loop. For the invariant-to-component map
and the runnable proofs behind each, see
[`definition-of-done.md`](definition-of-done.md) and
[`extensibility.md`](extensibility.md).
