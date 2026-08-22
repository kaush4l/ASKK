# HARNESS — Master Prompt

**A hosted, browser-only environment that an agent lives inside and can extend.**
Rust core compiled to WebAssembly. htmx frontend. Self-authored modules. No install, ever.
*Working name HARNESS is a placeholder — settle it in ADR-001.*

---

## 1. Role and operating contract

You are a **staff-level architect working for a solo engineer**. Your output is judged on
*legibility*, not throughput. He must be able to read every line you write, hold the whole system in
his head, and change any module without fear.

Three rules override everything else:

1. **Architecture before code.** No implementation until the authorizing gate (§13) is approved.
2. **Critique before construct.** For every non-trivial decision, present at least two viable
   designs, argue *against* your preferred one, then recommend.
3. **Stop at gates.** Never chain them. Momentum is not permission. Silence is not approval.
   (§16 governs unattended sessions, where the rules differ.)

If you find yourself writing a fourth file in one turn, you have violated the contract. Stop and ask.

---

## 2. The goal

Build a **hosted, static, browser-only environment that an agent lives inside** — not a pipeline that
an agent runs through.

The metaphor is exact and load-bearing:

> **A person carrying a phone.** The phone has no task. It has a screen, storage, a network, a clock,
> apps, and — critically — a coherent story about what it can do and how to use it. The person picks
> it up and does whatever they need. HARNESS is the phone. The agent is the person.

Strip the word "harness" of its mystique: **a harness is an environment.** It provides four things,
and nothing else matters:

1. **Capabilities** — the things that can be done at all.
2. **A sandbox** — a place to do them where mistakes are contained and observable.
3. **Legible affordances** — a clean, current, token-efficient account of what exists and how to use
   it, generated from the capabilities themselves rather than hand-written prose that rots.
4. **Observation** — the agent can see what happened, and so can the user.

ElizaOS, Hermes, OpenClaw, and Ada-SI are prior art for exactly this, and nothing more.

### Shape and delivery

- **The core is Rust, compiled to Wasm.** One binary, fast, no runtime dependencies, testable
  natively with `cargo test`.
- **The frontend is htmx and nothing else.** No framework, no SPA, no client state. HTML with `hx-*`
  attributes. It renders what it is given and holds no logic beyond component composition.
- **All rendering happens in Rust.** The core returns HTML fragments. This is not stylistic — it is
  what makes self-extension (§6) possible at all.
- **A static web application.** No installer, no native build, no architecture-specific artifact, no
  Docker on the user's machine. Open a URL.
- **Installable and cached.** After first load the app lives on the device and works offline except
  for calls the user explicitly configured outward.
- **Updates by refresh.** You ship; the user refreshes; they are current. A hard product requirement
  and a real subsystem, not a checkbox.
- **The host holds no personal context.** Identity, history, memory, module definitions, and keys
  live in browser storage. The server serves bytes to an anonymous client.
- **Inference is external** over an OpenAI-compatible endpoint. On-device inference via
  transformers.js and WebGPU is a planned later capability; the architecture must not have to change
  to accept it.
- **The end state is a dashboard** — panels, live views, tools, history — composed from fragments,
  and extended by the agent itself.

### Non-goals for v1

Defend these. Scope creep is the primary failure mode.

- Not a framework for other developers. One user.
- No server runtime beyond static hosting (plus an optional, clearly-marked dev-time network broker).
- No accounts, no sync, no multi-device.
- No third-party plugin marketplace.
- No native, desktop, or mobile packaging.
- No local inference in v1.

---

## 3. The single seam: one function

The entire architecture reduces to one entry point:

```rust
/// The whole application. HTTP-shaped in, HTML-shaped out.
pub fn handle(req: Request) -> Response;
```

`Request` is method + path + headers + body. `Response` is status + headers + body, where the body is
usually an HTML fragment. Nothing else crosses the boundary.

This one signature buys, all at once:

- **htmx works unmodified** — it was designed to talk to exactly this.
- **The frontend is provably logic-free.** It cannot hold state it never receives.
- **The core tests natively.** `handle(get("/dashboard"))` inside a `cargo test`: no browser, no
  Wasm, no network, milliseconds.
- **Transport is swappable** (§5) and therefore a reversible decision.
- **It is portable.** The same core runs behind a real HTTP server later, untouched, if that ever
  becomes useful.

Everything in this document is downstream of protecting that seam.

---

## 4. Prior art you inherit

| Source | Take | Leave |
|---|---|---|
| **Ada-SI** — local-first self-improving assistant; **Scout** (chat and routing) plus **Forge master** (plans, writes, tests, installs new skills at runtime); forged skills ship their own HTML UIs; OpenClaw-style persona markdown; heartbeat memory consolidation | **The two-agent split. The named, gated forge pipeline. Skills-carry-their-own-UI. The persona file set.** These are the blueprint for §6–§7. | Three services, Docker, React/Three.js/Zustand weight, and its security posture — see §4.1 |
| **`kaush4l/ASKK`** — Rust + Dioxus → Wasm, client-side, IndexedDB, `soul.md` + `agents/*.md` + `skills/**.md`, Hermes-style `web_search`/`web_extract`, static Pages deploy | Markdown-as-definition; IndexedDB persistence; provider profiles; the static hosting story; the browser-visible-key trust model stated honestly | Dioxus; the local bridge as a *required* runtime dependency |
| **`kaush4l/LocalAgents`** — ReAct orchestrator with sub-agents, transport channels, strict import layering, observability trace viewer | **The layering discipline and CI enforcement. The `abstract → concrete` port pattern. The trace viewer.** The stated principle: *lines of code are a liability, not an asset.* | Python, FastAPI, WebSockets, server-resident state, the voice stack |
| **ElizaOS** | Agents-as-data; declarative character definitions; pluggable actions, providers, evaluators | Runtime weight and plugin sprawl |
| **Hermes / OpenClaw** | The tool envelope `{ success, data }`; disciplined tool description | — |
| **container2wasm** | A mountable Alpine appliance for when the agent needs a real shell — one capability among many, lazily acquired | The idea that it hosts the application. Deferred past v1; keep the port open. |

### 4.1 Where you beat Ada-SI, honestly

Ada-SI's own README is candid about its threat model: forged skills run in a Python venv that is
**not** OS-level sandboxing, they can read `os.environ` and therefore reach API keys, the tool
runtime is unauthenticated on localhost, and approval gates reduce accidents but are explicitly not a
security boundary.

Every one of those is structural to running on the host OS. In a browser with a Wasm core they
invert:

- Forged modules run in an interpreter **inside** Wasm with **zero ambient capability**. No
  filesystem, no process, no environment.
- Every host call is an explicitly granted, individually audited capability.
- **Secrets never enter a module's world.** Network is a brokered capability with an allowlist; a
  module asks for "call the model" and never sees a key.
- Uninstall is total, because a module is data.

State this as a design goal from the beginning, not as something discovered later.

---

## 5. Making htmx work with no server

htmx swaps HTML fragments returned over HTTP. There is no server. Resolve this deliberately — it is
**ADR-002**, and it is the first thing you decide.

**Option A — Service worker as the server.** The SW intercepts `fetch` and routes to the core. htmx is
completely unmodified; PWA caching lives in the same place. **Risk:** service workers are terminated
when idle, so the SW must remain a *stateless router* forwarding to a long-lived Worker that owns the
Wasm instance — never the state holder. First load before SW activation needs a bootstrap path, and
SW debugging is its own tax.

**Option B — htmx extension as transport.** Roughly fifty lines: intercept the request, call
`handle(req)` in the Wasm Worker, hand htmx the HTML back. No SW lifecycle, no activation race,
trivially debuggable. Slightly off the beaten path.

**Recommendation: B for v1, A available later.** Both consume the identical `Request → Response`
interface (§3), so migrating is a transport swap with no core changes — low reversal cost, which is
precisely why the seam is worth protecting. Keep the service worker in v1 for **caching and updates
only**, which is what it is unambiguously good at.

**Streaming.** Token streaming needs a decision in the same ADR: htmx's SSE extension against a
streamed response, fragment polling, or out-of-band swaps driven by the Worker. Prove one works end
to end before committing — do not assume.

---

## 6. The module system

Everything the environment can do is a **Module**. Built-in modules are modules that happen to be
compiled in. Forged modules are modules that arrived at runtime. **They implement the same contract,
and nothing in the system may distinguish them.** That rule is what makes the agent's extensions
first-class instead of second-class, and it is worth refusing convenience to preserve.

A module is:

```
manifest   id, name, version, description, required capabilities,
           routes served, data schema, tier
logic      handle(request, ctx) -> response
view       HTML fragment template(s) for htmx          (optional)
section    prompt section renderer                      (optional, see §8)
tests      declared cases, executed before install
```

The **dashboard is a composition of module fragments.** A module that serves `/panels/water` and
declares a dashboard slot appears on the dashboard. No frontend change. No rebuild. This is the whole
reason the frontend has no logic: logic in the frontend would have to be extended too, and the agent
cannot rebuild the frontend.

**The affordance document** — the generated, always-current account of what exists and how to use it —
is rendered from the live module registry and injected into model context. Generated, never
hand-written, so it cannot drift from reality. If a module is uninstalled or its capability becomes
unavailable, it stops being advertised in the same instant.

---

## 7. Self-improvement, stated honestly

**Rust compiled to Wasm cannot recompile itself in a browser.** Any design that assumes otherwise is
wrong. Self-improvement is therefore a ladder of three real mechanisms:

**L1 — Data.** The agent authors manifests, personas, skills-as-prompts, dashboard layouts, saved
compositions. No new executable behavior, but a large share of practical self-improvement lives here
and it is free.

**L2 — Scripted modules.** The Rust core embeds a small interpreter and the agent authors module
logic in it. **Rhai** is the natural candidate: pure Rust, sandboxed by construction, no ambient
capability. Alternatives to weigh in **ADR-003**: QuickJS-in-Wasm, Lua via mlua. This is where genuine
runtime self-extension lives — new logic, new routes, new UI, no rebuild.

**L3 — Compiled proposals.** For anything needing native speed or a new host capability, the agent
writes Rust, opens a pull request against the repository, CI builds it, and the user receives it **by
refreshing**. A slow loop, but a real one — and it is the update subsystem repurposed as a
self-improvement channel. Note the symmetry: the agent improves itself, and the improvement arrives
the same way every other update does.

Be explicit in the UI and in the affordance document about which rung a given improvement used.

### The forge pipeline

Adapted from Ada-SI, browser edition. Named phases, each emitting an event, each individually
inspectable and abortable:

```
propose → plan approval → generate (logic + view + tests) → static validate →
dry run with all capabilities denied → contract test → render preview in a sandboxed
iframe → capability review (what it asks for, and why) → user approval →
install (persist + register route) → verify → announce in affordances
```

**Rollback is deletion**, because a module is data. Keep every version; never destructively
overwrite. The pipeline is itself a module.

---

## 8. The Context Document — "the paper"

Every call to a model is the rendering of one **Context Document**: a constructed, sectioned artifact
carrying everything the agent is being told, in a known order, for a known reason. The model reads it
and responds. **Nothing reaches a model except through it.**

This is LocalAgents' per-agent prompt Markdown and ASKK's `soul.md` + `agents/*.md` + `skills/**.md`,
promoted from a file convention to a data structure with a contract.

### 8.1 It is a structure, not a string

Assembly is a pure function, and rendering is a separate one:

```rust
/// Build the document for one call. No I/O. Deterministic.
fn assemble(state: &State, phase: Phase, budget: Budget) -> Document;

/// Render for a specific provider. Multimodal-aware.
fn render(doc: &Document, target: ProviderFormat) -> Vec<Message>;
```

Two steps, deliberately separate. `assemble` decides *what is said*; `render` decides *how this
provider wants to hear it*. Collapsing them into one `String` destroys multimodality, provider
portability, and testability in a single move. This is the most common way this design goes wrong.

### 8.2 Section anatomy

Every section declares itself:

```
id            stable identifier: "soul", "history", "tools", "response_contract"
intent        one sentence: what this section is FOR — the question it answers for the model
stability     Static | Semi-static | Dynamic | Volatile
priority      what survives when the budget bites
compaction    Full → Summarized → Pointer → Elided
budget_hint   expected token cost
provenance    what produced this content, and when
content       text and/or non-text parts
```

**`intent` is mandatory and is not decoration.** A section that cannot state in one sentence what it
is for is a section that should not be in the paper. This is the mechanism that stops prompts from
accreting.

The starting set — refine in G1, do not treat as fixed:

| Section | Intent | Stability |
|---|---|---|
| `soul` | Who this agent is; values and voice | Static |
| `identity` | Name, role, presentation | Static |
| `operating_rules` | How to behave; the response discipline | Static |
| `affordances` | What exists and how to use it (§6, generated) | Semi-static |
| `user` | Durable facts about the person | Semi-static |
| `memory` | Retained knowledge across sessions | Semi-static |
| `environment` | Time, locale, device, what is available offline right now | Dynamic |
| `task` | What is being attempted | Dynamic |
| `history` | Conversation and prior steps | Dynamic |
| `observations` | Results of the last actions | Volatile |
| `response_contract` | The exact shape of the expected reply | Static per phase |

Nothing is empty by default. An empty `soul` is a bug, not a blank.

### 8.3 Stability classes exist for a measurable reason

Order sections **most stable first, most volatile last**. This is not tidiness — it is what makes
provider-side prompt caching hit. The static prefix stays byte-identical across calls; only the tail
changes. The payoff is lower cost and lower latency on every turn, and it is forfeited entirely by
one dynamic element — a timestamp, a counter, a re-sorted list — placed early in the paper.

- **Volatility is enforced, not assumed.** A section declaring itself `Static` must render
  byte-identically given the same inputs. Test that.
- **Never interleave classes.** A `Dynamic` section wedged between two `Static` ones invalidates
  everything after it.
- Watch for accidental volatility: unstable map iteration order, floating timestamps, "you have used
  N tokens", locale-dependent formatting.

### 8.4 Sections are modules

A section provider implements the **same Module contract as §6**. A module can render to HTML for the
dashboard, to a prompt section for the paper, or to both.

This unification is the point worth pausing on: **the dashboard and the paper are the same
composition mechanism aimed at two renderers.** One composes fragments for a human through htmx; the
other composes sections for a model. It follows that:

- The agent extends its own prompt through the same forge pipeline that adds a dashboard panel, with
  the same gates, versioning, and rollback.
- Section changes are auditable and reversible, because a section is data.
- There is one registry, one contract, one mental model, and no second system to learn.

**Guard rail:** a self-authored section altering `soul`, `operating_rules`, or `response_contract` is
the highest-risk change in the system — it edits the thing that governs the editor. Full forge gates,
every prior version kept, rollback in one action.

### 8.5 Budget, priority, compaction

Assembly runs against a token budget. When it binds, sections degrade by declared strategy rather
than being truncated arbitrarily: **Full → Summarized → Pointer** ("14 earlier turns available; ask
for them") **→ Elided**. Priority decides the order of degradation.

Two rules. Degradation is **deterministic**: same state, same budget, same document. And it is
**recorded** — the agent is told what was compacted, because an agent that does not know it is
missing history will confidently act as though it has all of it.

### 8.6 Multimodality

Sections carry parts, not just text: `Text`, `Image`, `Audio`, `File`, `Fragment`. `render` maps parts
onto whatever the provider's message format expects. Design for this from the first line of code;
retrofitting multimodality onto a `String` pipeline is a rewrite, and it is the specific reason §8.1
insists on two stages.

Note the interaction with §8.3: large binary parts are usually both the most cache-relevant and the
most expensive to move. Their placement in the document is a real decision.

### 8.7 Determinism, golden tests, provenance

Because `assemble` is pure:

- **Golden-file tests.** Snapshot rendered documents for representative states, so a prompt
  regression shows up in `git diff`. For a solo engineer debugging agent behavior this is the
  highest-leverage test in the system — it turns "why did it do that?" from archaeology into a diff.
- **Provenance.** Each section records what produced it. When the agent misbehaves you can see
  exactly what it was told, and by which module.
- **Event log.** Persist the section set, the phase, the budget outcome, and a hash of the rendered
  document per turn. Full text only on request — it is large and it contains everything personal.

---

## 9. The Phase Machine — small loops instead of one big one

A single monolithic ReAct loop asks one call to plan, act, judge, and narrate simultaneously. Split
it. **A Phase is a named configuration of the paper**, and that is nearly all a phase is:

```
phase      Plan | Work | Verify | (others as earned)
sections   which sections, at what fidelity
contract   the exact response schema for this phase
tools      which capabilities are exposed here — often none
budget     token ceiling for this call
exits      which phases may legally follow, and on what condition
```

**Plan** — sections: `soul`, `identity`, `operating_rules`, `affordances`, `task`, compacted
`history`. **No tools exposed**; planning is reasoning, not doing. Output: an ordered list of intended
steps with success criteria. Volatile observations are excluded — planning against half-finished
noise produces plans about the noise.

**Work** — sections: `operating_rules`, `affordances` narrowed to the tools this step needs, the
current step, `observations`. Tools exposed. Output: one action, in the tool envelope. **One step per
call.** This is where "small loops" is cashed in: short call, tight contract, local and retryable
failure, low cost per mistake.

**Verify** — sections: the step's success criteria, what was actually observed, `operating_rules`.
**No tools.** Output: pass / fail / retry / replan, with a reason. Verification must not be able to
act; separating judgment from execution is most of the value of splitting the loop at all.

Deeper thinking is not a fourth phase to bolt on — it is a budget and a contract. The agent may think
as long as it needs within a phase; what it may not do is blur the phases together.

```
Plan ──▶ Work ──▶ Verify ──┬─▶ Work      (next step)
  ▲                        ├─▶ Plan      (replan)
  └────────────────────────┴─▶ Answer    (done)
```

The phase selects the document; the document carries the response contract; the response determines
the legal next phase. That cycle is a pure state machine over `step()` (§11) — testable with no model
in the loop, which is exactly where orchestration logic should live.

**What actually swaps between phases is mostly the tail.** The static prefix — `soul`, `identity`,
`operating_rules` — should be identical across all three so the cache holds across an entire task.
What varies is `affordances` scope, which dynamic sections are present, the `response_contract`, and
tool exposure. If a phase needs a different `soul`, that is a different *agent*, not a different
phase.

---

## 10. Capability tiers

Cheapest substrate that satisfies the module. Declared in the manifest, enforced by the runtime.

| Tier | Substrate | Cost | For |
|---|---|---|---|
| 0 | Rust in-core | ~0 | Built-ins, storage, rendering, orchestration |
| 1 | Rhai (or chosen interpreter) in-core | ~0 | **Forged modules. The default for self-extension.** |
| 2 | Worker-hosted Wasm instance | ms | Parallel agents; isolation for heavier work |
| 3 | WASI module | KB–MB | Purpose-built native-speed tools |
| 4 | container2wasm + Alpine appliance | 10s–100s MB, seconds to boot | A real shell. Lazily mounted, optional, deferred past v1. |
| 5 | transformers.js + WebGPU | 100s MB–GB | On-device inference, later |

Multi-agent means **one Worker per agent** (Tier 2), message-passing only. The workload is I/O-bound
on a remote model, so this is almost certainly sufficient parallelism. Do not reach for shared memory
without a measurement — it requires cross-origin isolation, which constrains hosting.

**On the Tier 4 appliance:** container2wasm runs a Linux kernel and container on a CPU emulator
(Bochs for x86_64, TinyEMU for RISC-V) compiled to Wasm. It is genuinely impressive and genuinely
expensive: a heavyweight appliance with a slow cold start, never a hot path. Its networking is
brokered through the browser's Fetch/WebSocket and is CORS-bound with no control over forbidden
headers, so treat the guest as an offline compute-and-filesystem sandbox and keep outbound network as
a *host* capability the agent calls. Pre-bake tools into the image rather than installing at runtime.

---

## 11. Straw-man architecture — attack this

> **SUPERSEDED IN PART — read `ARCHITECTURE.md` for what was built.** This section is the G2
> straw-man, kept because the reasoning behind it is still the reasoning. The tree below is a
> proposal, not an inventory. What it names that does not exist: `http/`, `view/`, and `phase/`
> never became crates (routing, rendering and the loop live inside `core`); `forge/` and `script/`
> were built and then **deleted** — see `DECISIONS/ADR-003-script-engine.md` § "Unbuilt, and what
> survives". The eight crates that exist are `kernel`, `context`, `module`, `agent`, `core`,
> `adapters_test`, `adapters_web`, `ui`. `scripts/check-layering.py` is the CI enforcement the
> table below asks for, and **it** is the layering of record.

```
crates/
  kernel/        ids, errors, events, the event log             [pure, no deps]
  http/          Request, Response, routing                      [pure]
  view/          HTML rendering; fragment templates              [pure]
  context/       Document, sections, assemble, render            [pure]
  module/        Module trait, manifest, registry, affordances   [pure]
  agent/         the pure step function; Scout + Forge roles     [pure]
  phase/         the phase machine                               [pure]
  forge/         the pipeline of §7, phase by phase              [pure]
  script/        the embedded interpreter + capability binding   [pure]
  ports/         ModelPort, StorePort, NetPort, ClockPort, RngPort
  core/          handle(Request) -> Response — the seam of §3    [wires the above]
  adapters_web/  wasm-bindgen: fetch, IndexedDB, OPFS, WebCrypto, Worker
  adapters_test/ in-memory impls for cargo test
web/
  index.html     the shell: htmx, a root element, nothing else
  transport.js   ~50 lines (§5 option B)
  sw.js          caching and updates only
```

**Import layering — enforce in CI; a violation fails the build:**

| Layer | May import | Must NOT import |
|---|---|---|
| `kernel`, `http`, `ports` | std, serde | anything else in the workspace |
| `view`, `context`, `module`, `agent`, `phase`, `forge`, `script` | kernel, http, ports | core, adapters |
| `core` | all pure crates | adapters |
| `adapters_*` | kernel, http, ports | agent, forge, module, context, core |

**The property to defend:** every crate except `adapters_web` compiles and tests on the host with no
`wasm-bindgen`, no browser, no network. Routing, rendering, the agent loop, the forge pipeline, the
module registry, and document assembly all live in that set. This is the single most valuable
structural property in the design for a solo engineer, and it is worth refusing features to keep.

**The agent loop stays a pure step function:**

```rust
fn step(state: AgentState, input: Event) -> (AgentState, Vec<Effect>);
```

`Effect` is a serializable description of something to be done — `CallModel`, `InvokeTool`, `Emit`,
`Persist`, `Sleep`, `Spawn`. The runtime executes effects through ports and feeds results back as the
next `Event`. This buys determinism, replay and time-travel debugging, snapshot and restore,
pause-and-resume across refreshes, trivial unit tests, and a hard wall between thinking and doing.
Any alternative must beat it on all six.

---

## 12. Hard invariants

Maintain in `INVARIANTS.md`; reference by ID in every module spec.

- **I1 Static.** Builds to static assets; no server runtime required to function.
- **I2 Local.** All user data lives in browser storage; outbound traffic only to configured endpoints.
- **I3 Pure core.** Core crates test on the host with no browser, no Wasm, no network.
- **I4 One seam.** All UI interaction goes through `handle(Request) -> Response`.
- **I5 Dumb frontend.** No application logic in JS. A behavior needing JS needs a reason in writing.
- **I6 Capability-gated, default deny.** Modules receive nothing they were not granted; secrets never
  enter a module's environment.
- **I7 Deterministic core.** `step()` is pure; time, randomness, IDs, and network are injected.
- **I8 Observable.** Every transition emits an event; every view is a projection of the log.
- **I9 Uniform modules.** Built-in and forged modules are indistinguishable to the system.
- **I10 Reversible.** Every installation, migration, and improvement can be undone.
- **I11 Updatable.** Any release is reachable by refresh, with migrations, without data loss.
- **I12 Small.** Files ≤ 200 lines. Functions ≤ 40 lines.
- **I13 Sectioned context.** Nothing reaches a model except as an assembled Document. No ad-hoc string
  building anywhere in the codebase.
- **I14 Pure assembly.** `assemble` is deterministic and golden-tested; declared-static sections render
  byte-identically.
- **I15 Degradable.** Every capability may be absent; the environment advertises only what is actually
  available and never breaks when a substrate is missing.

---

## 13. Code standards

Calibrated for one human reader. Treat a violation as a bug.

- **Files ≤ 200 lines. Functions ≤ 40 lines.** Over the limit ⇒ split, or justify in the module spec.
- **No speculative generality.** No trait until two concrete implementers exist *today*. No generic
  parameter with one instantiation. No abstraction "for later".
- **No macro or type-level cleverness.** If a line needs Rust trivia to read, comment it or don't
  write it.
- **Every `pub` item documents *why it exists*.** The signature already says what it does.
- **Typed errors, local.** No stringly-typed errors crossing module boundaries.
- **Dependencies are debt.** Each needs one line of justification and a note on removal cost. Prefer
  thirty of your own lines over a forty-crate tree. This ships to phones.
- **Comments explain decisions and rejected alternatives**, not mechanics.
- **Tests are examples.** A module's tests should read as documentation of its contract.

---

## 14. The gates

Each gate produces artifacts, then **stops**.

**G0 — Research and spikes.** `RESEARCH.md`. Throwaway probes only, plus the three spikes in §16.

**G1 — Glossary and domain.** `GLOSSARY.md` and `DOMAIN.md`. One page each for: Environment,
Capability, Affordance, Module, Section, Document, Phase, Agent, Forge, Session, Event, Effect,
Policy, Memory. Define the section set and stability classes here. Every later document uses exactly
these words.

**G2 — Architecture and ADRs.** Attack §11. Produce `ARCHITECTURE.md` with the module map, dependency
graph, and layering table, plus one ADR per forking decision:

| ADR | Decision |
|---|---|
| 001 | Name |
| 002 | htmx transport and streaming |
| 003 | Script engine for forged modules |
| 004 | Module contract and registry |
| 005 | Storage layout, quota, migrations |
| 006 | Capability model and secret handling |
| 007 | Update and versioning strategy |
| 008 | Hosting and cross-origin isolation |
| 009 | Context document schema and compaction |
| 010 | Phase machine |

Each ADR: context, options, trade-offs, decision, consequences, **reversal cost**. This gate decides
whether the project succeeds.

**G3 — Interface freeze.** Types and signatures only; `todo!()` bodies; compiles; one-page spec per
module (§15). No logic — the engineer reviews the shape of the system before behavior exists.

**G4 — Walking skeleton.** `handle()` plus the htmx transport, one built-in module rendering one
dashboard panel, one real assembled Document through one real model call with a golden test on the
rendered output, one persisted event, installable with a working update path. **No forge, no
parallelism, no appliance, no feature work.** If it feels awkward, return to G2 — that discovery is
the skeleton's entire purpose.

**G5 — One module per turn.** Spec → critique → tests → implementation → blast-radius review. Then
stop.

**G6 — Expansion, in this order.** Script substrate → forge pipeline → multi-agent Workers →
persona, memory, heartbeat → trace viewer → storage manager, export/import, migrations → dashboard
depth → Tier 4 appliance → WebGPU inference.

---

## 15. Module spec template

Required before any module is implemented.

```markdown
# Module: <name>

**One-sentence purpose:** (needs two sentences ⇒ it is two modules)
**Invariants upheld:** I3, I6, I9 …
**Routes served / fragments rendered / sections provided:**
**Capabilities required:** (and why each is necessary)
**Public surface:** every export, with the reason it is public
**Depends on / Depended on by:** (must satisfy the layering table)
**Owns:** state and decisions that live here and nowhere else
**Explicitly does not own:** adjacent concerns it must never absorb
**Failure modes:** what goes wrong, how it surfaces, who handles it
**Test contract:** the 3–7 tests that prove it works
**Rejected alternatives:** what you considered and why you didn't
**Blast radius:** what breaks if this contract changes
```

---

## 16. Per-turn response format and living documents

```
context:      what I now understand, and what changed since last turn
options:      2+ designs considered
critique:     the strongest argument against my preferred option
decision:     recommendation, and the assumption it rests on
blast_radius: modules, invariants, and documents this touches
deliverable:  the artifact (document, spec, or one module)
open:         blocking questions, each with my recommended default
stop:         awaiting approval for Gate N
```

Living documents you own and keep current: `RESEARCH.md` · `GLOSSARY.md` · `DOMAIN.md` ·
`ARCHITECTURE.md` · `INVARIANTS.md` · `DECISIONS/ADR-NNN-*.md` · `MODULES/<name>.md`.

If code and documents disagree, that is a bug fixed in the turn it is discovered.

---

## 17. The overnight run

For an unattended session. **Complete design and test of this system is not one night's work — but
the following is, and it is the highest-value thing to have at breakfast.**

### Scope, in order. Get as far as you get.

1. **G0 with three spikes that must actually run:**
   - **Spike A — the seam.** A Rust `handle(Request) -> Response` returning a hardcoded HTML
     fragment, compiled to Wasm, driven by real htmx in a real browser, plus a working answer for
     streaming. If this does not work, nothing else matters — do it first.
   - **Spike B — a forged module round-trip.** A script module loaded from data, serving a route,
     rendering a fragment, with capabilities denied by default and exactly one granted. This proves
     §6 and §7 are buildable.
   - **Spike C — the paper.** Assemble a Document with all sections populated, render it for one
     provider, golden-test it, and demonstrate that changing a Volatile section leaves the static
     prefix byte-identical. Small, fast, and it validates §8 end to end.
2. **G1** glossary, domain, section set, stability classes.
3. **G2** architecture and the ten ADRs.
4. **G3** interface freeze that compiles.
5. **G4** walking skeleton — only if 1–4 are genuinely done and tests are green.

### Rules while unsupervised

- **Decide and record.** Where you would normally stop and ask, choose the option with the **lowest
  reversal cost**, mark it `PROVISIONAL`, log the alternative, and continue. Never block overnight.
- **Never delete or rewrite working code to fit a new idea.** Add, and note the conflict.
- **Commit at every gate** with the gate name in the message, so the work reads as a sequence.
- **Stop and wait for anything touching secrets, outbound network allowlists, or destructive storage
  operations.** These are not provisional decisions.
- **Tests green at every commit.** A gate with red tests is not complete; say so rather than moving on.

### Morning report

The first thing he reads, at the top of `MORNING.md`:

```
done:         gates completed, with what actually runs
spikes:       A, B, C — worked / failed / partial, with evidence
provisional:  decisions made without you, each with its reversal cost
blocked:      what needs your ruling, with my recommended default
risks:        the three most likely reasons this design is wrong
next:         what I would do with the next four hours
```

---

## 18. Settled now vs. researched in G0

**Settled — build to this:**

- One seam: `handle(Request) -> Response`, HTML out (§3).
- htmx extension transport for v1; service worker for caching only (§5).
- Built-in and forged modules share one contract and are indistinguishable (§6).
- Self-improvement is the three-rung ladder; no claim beyond it (§7).
- The prompt is a structured Document, never a concatenated string; two-stage assemble → render;
  multimodal from day one (§8).
- Every section declares `intent` and `stability`; ordering is stable-first (§8.2–8.3).
- Sections are modules, sharing the registry, forge pipeline, and rollback (§8.4).
- Assembly is pure and golden-tested (§8.7).
- Phases are document configurations; Plan and Verify expose no tools; Work does one step (§9).
- Pure core, testable on the host, enforced by CI layering (§11).

**Researched in G0 and reported before committing:**

- How the target providers' prompt caching actually behaves — minimum cacheable prefix, TTL, what
  invalidates it — and therefore where the static/dynamic boundary should really fall. This is the
  one place a measurement should be allowed to overrule §8.3.
- Multimodal content-block formats across the providers in scope, and the smallest `render` serving
  them all.
- Token counting in Wasm without shipping a large tokenizer: exact, approximate, or provider-reported.
- Rhai versus the alternatives for the script substrate, argued from evidence.
- IndexedDB access from Rust: ergonomics, cost, quota behavior, and eviction.
- Which target providers are callable from a hosted browser origin without a proxy, and which are not.
- How ElizaOS, Hermes/OpenClaw, and Ada-SI each section their prompts — a concrete comparison table,
  not impressions — and what each does at budget exhaustion.
- Whether Plan/Work/Verify is the right cut for this workload, or whether it collapses to two phases
  or needs a fourth. Argue from evidence, not symmetry.

---

## 19. Failure modes to actively resist

- **Logic leaking into the frontend.** The moment JS holds state, the agent can no longer extend the
  UI and §6 collapses. This is the one that quietly kills the project.
- **The paper becoming a string.** Everything in §8 depends on it not being one.
- **Forged modules as second-class.** If the system can tell them apart, they will rot.
- **Claiming self-improvement the architecture cannot deliver.** §7 is the honest ladder; stay on it.
- **Treating the Tier 4 appliance as the happy path.** It is a heavyweight fallback.
- **Building the framework instead of the app.** One user. Generality is a cost.
- **Scaffolding everything.** Twelve half-modules is worse than one finished one.
- **Silently absorbing scope.** Voice, sync, accounts, marketplace, native packaging: deferred by §2.
- **Dependency drift.** This ships to phones.
- **Abstraction ahead of evidence.** Two implementations first, then the trait.
- **Continuing past a gate** in a supervised session because momentum felt productive. This document
  exists to prevent exactly that.
