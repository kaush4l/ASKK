# GLOSSARY

G1 artifact. One entry per term; every later document uses exactly these words.
Source of truth: `docs/PROMPT.md` (cited by §). Invariants by ID: `INVARIANTS.md`.
Crate names refer to the §11 straw-man layout.

---

## Environment

**Is:** HARNESS itself — the hosted, static, browser-only place an agent lives inside and can
extend (§2). It provides exactly four things: Capabilities, a sandbox, legible Affordances, and
observation. In the load-bearing metaphor, the Environment is the phone; the Agent is the person.
**Is not:** a pipeline the agent runs through; not a framework for other developers (one user).
**Lives:** the whole workspace; entered only through `core::handle(Request) -> Response` (§3);
delivered as static assets, installed and cached on the device.
**Lifecycle:** shipped as static assets → cached on first load → works offline except configured
outbound calls → updated by refresh.
**Invariants:** I1, I2, I4, I11, I15.

## Capability

**Is:** a host-provided power a Module may be granted — storage, brokered network, model calls,
clock, randomness. Declared in the manifest, individually granted, enforced by the runtime,
default deny (§4.1, §10). The tier table (§10, Tiers 0–5) classifies the substrate that supplies it.
**Is not:** an Affordance — the Affordance is the *account* of what exists; the Capability is the
power itself. Never ambient: a module with no grant has no world outside itself.
**Lives:** bound in `script/` (capability binding), exercised through `ports/` (ModelPort,
StorePort, NetPort, ClockPort, RngPort); grants recorded in browser storage as Policy data.
**Lifecycle:** declared in manifest → forge capability review → granted at install → enforced per
call → revoked totally at uninstall. May be absent entirely; absence must not break anything (I15).
**Invariants:** I2, I6, I15.

## Affordance

**Is:** the generated, always-current, token-efficient account of what exists and how to use it —
rendered from the live module registry, never hand-written, so it cannot drift from reality (§2, §6).
Reaches the model as the `affordances` Section.
**Is not:** documentation (hand-written prose that rots); not the Capability itself; not a promise —
only what is actually available right now is advertised (I15).
**Lives:** generated in `module/` from the registry; injected into the Document by `context/`.
**Lifecycle:** regenerated from the registry; a module uninstalled or a capability gone stops being
advertised in the same instant. Records which self-improvement rung (§7) produced each entry.
**Invariants:** I8, I13, I15.

## Module

**Is:** the unit of everything the Environment can do: manifest (id, name, version, description,
required capabilities, routes, data schema, tier) + logic `handle(request, ctx) -> response` +
optional view + optional section renderer + declared tests (§6). Built-in and forged modules
implement the same contract and nothing in the system may distinguish them (I9).
**Is not:** a marketplace plugin; not a crate (crates are code layout, modules are runtime units);
not second-class when forged — refusing that convenience is what keeps extensions first-class.
**Lives:** contract and registry in `module/`; built-ins compiled in-core (Tier 0); forged logic is
data in browser storage, executed by `script/` (Tier 1).
**Lifecycle:** enters via the Forge pipeline; rollback is deletion, because a module is data; every
version kept, never destructively overwritten.
**Invariants:** I6, I9, I10, I12, I15.

## Section

**Is:** one declared unit of the Context Document, with the full anatomy of §8.2: `id`, `intent`
(one sentence, mandatory — the question it answers for the model), `stability`, `priority`,
`compaction`, `budget_hint`, `provenance`, `content` (parts: Text, Image, Audio, File, Fragment).
A section provider implements the same Module contract (§8.4).
**Is not:** a string fragment or a paragraph — it is a data structure with a contract. Not empty by
default: an empty `soul` is a bug, not a blank. A section that cannot state its intent in one
sentence should not be in the paper.
**Lives:** `context/`; provided by Modules; the normative starter set is in `DOMAIN.md`.
**Lifecycle:** provided at each assembly; degrades Full → Summarized → Pointer → Elided under
budget; self-authored sections pass full forge gates (editing `soul`/`operating_rules`/
`response_contract` is the highest-risk change in the system, §8.4).
**Invariants:** I13, I14.

## Document

**Is:** the Context Document — "the paper": one constructed, sectioned artifact carrying everything
the agent is being told, in a known order (most stable first), for a known reason. Nothing reaches
a model except through it (§8, I13). Built in two deliberate stages: `assemble` (pure — decides
what is said) then `render` (provider-specific — decides how this provider hears it).
**Is not:** a string — collapsing assemble and render into one `String` destroys multimodality,
portability, and testability (§8.1, §19). Not a chat transcript; `history` is one section of it.
**Lives:** `context/`; per turn the event log records the section set, phase, budget outcome, and a
hash of the rendered document (full text only on request — it contains everything personal).
**Lifecycle:** assembled fresh per model call from `(state, phase, budget)`; deterministic;
golden-tested; degradation is deterministic and recorded so the agent knows what it is missing.
**Invariants:** I7, I13, I14.

## Phase

**Is:** a named configuration of the paper — which sections at what fidelity, the exact response
contract, which capabilities are exposed (often none), the token budget, and the legal exits (§9).
Plan | Work | Verify, others as earned. The phase selects the Document; the Document carries the
contract; the response determines the legal next phase — a pure state machine over `step()`.
**Is not:** an Agent — a phase needing a different `soul` is a different agent, not a different
phase. Not a workflow engine. Deeper thinking is not a fourth phase; it is a budget and a contract.
**Lives:** `phase/`.
**Lifecycle:** Plan (no tools) → Work (one step per call) → Verify (no tools; judgment must not be
able to act) → next Work / replan / Answer. Only the tail of the paper swaps between phases; the
static prefix holds so the provider cache holds across a whole task.
**Invariants:** I3, I7, I13.

## Agent

**Is:** the person carrying the phone (§2): the entity that lives in the Environment. Concretely, a
pure step function `step(state: AgentState, input: Event) -> (AgentState, Vec<Effect>)` (§11) plus
its identity data (`soul`, `identity`, persona files). Two inherited roles: **Scout** (chat and
routing) and **Forge master** (drives the Forge) (§4).
**Is not:** the Environment; not the model — inference is external, something the agent calls; not
a thread or process — a Tier 2 Worker is the execution vehicle for an agent, not the agent itself.
**Lives:** `agent/` (pure); identity data and state in browser storage; multi-agent = one Worker
per agent, message-passing only (§10).
**Lifecycle:** stepped by Events; emits Effects; snapshot and restore; pauses and resumes across
refreshes; replayable from the event log.
**Invariants:** I3, I7, I8.

## Forge

**Is:** the gated pipeline by which the agent extends the Environment (§7): propose → plan approval
→ generate (logic + view + tests) → static validate → dry run with all capabilities denied →
contract test → sandboxed-iframe preview → capability review → user approval → install → verify →
announce in affordances. Each named phase emits an Event, individually inspectable and abortable.
The pipeline is itself a Module.
**Is not:** recompilation — Rust-in-Wasm cannot recompile itself; L3 improvements travel as pull
requests through CI and arrive by refresh (§7). Not ungated generation; momentum is not permission.
**Lives:** `forge/` (pure pipeline), driven by the Forge master role.
**Lifecycle:** one run per proposed module or section; rollback is deletion; every prior version
kept. Output lands on the honest three-rung ladder: L1 data, L2 scripted modules, L3 compiled
proposals — the rung used is stated in the UI and the affordance document.
**Invariants:** I6, I8, I9, I10.

## Session

**Is:** `PROVISIONAL` — one continuous run of the Environment in a browser context, from page load
(or refresh) to unload: the boundary at which Volatile state dies and across which Memory persists.
The PROMPT uses the word only in passing (§8.2 "across sessions", §16–17 unattended sessions), so
this is the lowest-reversal-cost reading. *Alternative rejected for now:* session = one
conversation/task thread — rejected because a task legitimately spans refreshes via
snapshot-and-restore, which would make that boundary false.
**Is not:** a task; not a login (no accounts, no sync); not server-side (no server holds context).
**Lives:** no crate owns it — it is a runtime boundary visible in the `kernel/` event log.
**Lifecycle:** begins at load, ends at unload; Agent state survives it via Persist + restore (I11).
**Invariants:** I2, I11.

## Event

**Is:** a recorded fact — something that happened. Every transition emits one; every view is a
projection of the log (I8). Events are the sole input to `step()` and the material of replay,
time-travel debugging, and the trace viewer.
**Is not:** an Effect — an Event is a fact about the past, an Effect is an intent about the future.
Not a DOM/UI event; not transient — the log persists and is exportable.
**Lives:** `kernel/` (events + event log); persisted through StorePort into browser storage.
**Lifecycle:** emitted → appended to the log → projected into views → replayed on demand.
**Invariants:** I2, I7, I8.

## Effect

**Is:** a serializable description of something to be done — `CallModel`, `InvokeTool`, `Emit`,
`Persist`, `Sleep`, `Spawn` (§11). The output of `step()`. The runtime executes effects through
ports and feeds results back as the next Event — the hard wall between thinking and doing.
**Is not:** an Event (a fact); not an action performed inside `step()` — the step function only
describes, the runtime does. Not a direct host call: execution always crosses a port.
**Lives:** declared beside the step function in `agent/`; executed in `core/` via `ports/` by
adapters.
**Lifecycle:** emitted by `step` → executed through a granted Capability → result returns as an
Event. This cycle buys determinism, replay, snapshot/restore, and pause-across-refresh (§11).
**Invariants:** I3, I6, I7.

## Policy

**Is:** `PROVISIONAL` — the recorded rules governing what is allowed: capability grants per module,
the outbound network allowlist, and which forge steps require user approval. Policy is data, not
code; the runtime consults it at enforcement points and enforces it whether or not the model
cooperates. The word does not appear in the PROMPT; this is the lowest-reversal-cost assignment.
*Alternative rejected for now:* policy = the agent's behavioral rules — rejected; that is the
`operating_rules` Section, which is advice to the model, not enforcement.
**Is not:** `operating_rules` (what the agent is told); not a security theater layer — grants and
the allowlist are real boundaries (§4.1), unlike Ada-SI's approval gates.
**Lives:** enforced in `core/` and `module/` (grants) and in adapters (allowlist); stored locally.
**Lifecycle:** default deny; grants added at install after capability review; changes touching
secrets, allowlists, or destructive storage always stop for the user — never provisional (§17).
**Invariants:** I2, I6.

## Memory

**Is:** the agent's retained knowledge across Sessions — durable distilled facts, learned
preferences, persona-adjacent notes. Reaches the model only as the `memory` Section (Semi-static).
Heartbeat consolidation (Ada-SI's pattern) is a G6 expansion, not v1.
**Is not:** the event log — the log is raw fact, Memory is what the agent distilled from it. Not
`history` (the current conversation, Dynamic). Not `user` (durable facts about the person — its
own section). Not held by the host: the server serves bytes to an anonymous client (§2).
**Lives:** browser storage (IndexedDB via StorePort); rendered into the paper by `context/`.
**Lifecycle:** written by the agent (L1 self-improvement — free and unprivileged), consolidated
later by heartbeat (G6), rendered per assembly, exportable and deletable by the user.
**Invariants:** I2, I10, I13.
