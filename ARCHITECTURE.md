# ARCHITECTURE.md

> **Status: SHIPPED as of 2026-08-19 — G4 walking skeleton and the increments after it are on
> `main`.** §1–§5 are the G2 decision record, kept as written so the reasoning survives; where the
> ship answered a question differently, the row says so inline (`SUPERSEDED`) rather than being
> quietly rewritten. §6 is the current tree, re-derived hop by hop and cited by file and line —
> it is the section to trust when the two disagree. Spike A = seam/transport, B = Rhai module
> round-trip, C = context assembly, spike-idb = IndexedDB from Rust. Anything still marked
> `PROVISIONAL` or `TBD(spike-…)` is unshipped or unproven.
>
> Decisions are recorded in `DECISIONS/ADR-NNN` (owned elsewhere); this document references
> them and does not restate them. Vocabulary (Module, Section, Document, Phase, Event, Effect,
> Capability, Affordance, Forge) is the `GLOSSARY.md` term set — PROMPT §14 G1.

---

## 1. The attack on §11

Four boundaries in the straw-man are contentious. Per the operating contract, each gets two viable
designs, the strongest argument *against* the preferred one, then a recommendation.

### 1a. Thirteen crates for a solo project

**Design 1 — keep the 13-crate straw-man.** Every boundary is compiler-enforced; a layering
violation cannot compile, let alone pass CI.

**Design 2 — merge to 8 crates**, collapsing only boundaries that carry no enforcement weight:

- `http` + `ports` → `kernel`. The straw-man's own layering table puts `kernel`, `http`, `ports`
  in **one row with identical import rules**. Same row = same layer = the crate boundary between
  them enforces nothing. `Request`/`Response` and the port traits are leaf vocabulary exactly like
  ids and errors. Routing *dispatch* (path → module) needs the registry and was never really
  "pure http" — it moves to `core`.
- `phase` → `agent`. §9's phase machine *is* the agent's control flow: the phase selects the
  Document, `step()` walks the phases. Two crates for one state machine is ceremony; the boundary
  between them would be crossed by nearly every type either one defines.
- `forge` → a built-in module (see 1a-forge below).
- `view` → merged into `module` (see 1b).
- `script` **stays its own crate.** Not for layering — to quarantine the one heavy external
  dependency (Rhai, per ADR-003) so the pure domain's compile graph and dependency audit stay
  clean. A dependency-isolation boundary is a real boundary.

**Against my preferred option (Design 2):** merging crates deletes compile-time walls, and a solo
engineer has no reviewer to catch a casual `use` that welds `context` to the registry. In-crate
module boundaries (`mod`) are advisory; crate boundaries are not. Thirteen crates cost only
Cargo.toml boilerplate — cheap insurance.

**Counter and recommendation:** the walls worth having are *between layers*, and the straw-man's
own table defines only four layers — the intra-row crate splits were never enforced by it. Every
merge above stays within one row, so the CI-checkable property is byte-identical before and after.
Thirteen crates is legibility debt (13 manifests, 13 versions, cross-crate churn on every type
move) purchasing walls the table never demanded. **Recommendation: Design 2, 8 crates.**
`PROVISIONAL` — if a merged seam is repeatedly violated in review, promote it back to a crate;
reversal is `cargo new` plus moving files.

**Forge: crate vs module.** §7's own text: "the pipeline is itself a module." A dedicated `forge`
crate makes the forge structurally privileged — exactly what I9 (uniform modules) forbids the
*system* from doing, and a standing temptation to let it cheat. As a built-in module in `agent`
(it is agent behavior: Scout proposes, Forge builds) it exercises the same Module contract it
installs others through. **Against:** the forge is the flagship subsystem and will grow; burying
it risks `agent` blowing the I12 size limits. Accepted: promote to a crate the day it outgrows its
directory — same one-row reversal as above.

### 1b. `view` as a crate vs HTML-in-module templates

**Design 1 — central `view` crate** owning all fragment templates. One place to audit escaping,
one visual grammar, templates reviewable together.

**Design 2 — modules own their templates.** A module ships manifest + logic + view (§6). Forged
modules *must* carry their view as data — they cannot add to a compiled crate. If built-in
modules' HTML lives in a central crate while forged modules carry their own, built-ins and forged
modules render through different mechanisms, and I9 dies at the rendering seam — the exact place
§6 says the dashboard is composed.

**Against Design 2:** scattered templates invite inconsistent escaping and drifting markup; a
central crate is the natural audit point for XSS in an app that renders agent-authored HTML.

**Counter and recommendation:** centralize the *primitives*, not the templates: one small `view`
module inside the `module` crate — HTML escaping, the page shell, `hx-*` attribute builders,
the fragment type. Every template, built-in or forged, is composed from those primitives; the
audit surface is the primitives, which is smaller than a template crate. **Recommendation:
Design 2 with shared primitives.** Escaping-by-construction (fragments built only through the
escaping builder) is the enforcement, not code review.

### 1c. `step(state, event) -> (state, effects)` vs plain async fns with injected ports

**Design 1 — async fns.** `async fn run_turn(state, ports) -> Outcome`; ports injected as traits.
The honest case *for* it: this is the most legible possible shape — a turn reads top-to-bottom as
straight-line Rust, and legibility is the judging criterion. Injected fake ports give fast unit
tests; injected clock/rng gives determinism of *outputs*. No effect enum, no runtime loop, no
non-local control flow to chase.

**Design 2 — the pure step function** with an `Effect` enum executed by a small runtime loop.

§11 demands any alternative beat `step()` on six properties. Scored honestly:

| Property | async fns + ports | `step()` |
|---|---|---|
| Determinism | yes (inject clock/rng) | yes |
| Trivial unit tests | yes (fake ports) | yes (assert on returned effects, no fakes at all) |
| Replay / time-travel | partial — port calls loggable, but state *between* awaits is implicit in the future | yes — the event log replays through a pure fn |
| Snapshot / restore | **no** — a suspended future is not serializable | yes — `AgentState` is data |
| Pause/resume across refresh | **no** — refresh kills the Wasm instance mid-await; the turn is lost | yes — reload state + pending effects from the log |
| Wall between thinking and doing | advisory (a turn *can* await anything) | structural (`step` cannot do I/O; it can only describe it) |

Async fns lose outright on the two properties a browser host makes non-negotiable: the user *will*
refresh mid-turn (I11 makes refresh the update channel), and I8 already mandates the event log
that `step()` needs — the effect system is event sourcing's natural other half, not an extra
system. **Against Design 2 (the real cost):** effect systems smear one logical action across
`step` → runtime → `step`, and debugging becomes archaeology through a loop. Mitigation, adopted
as a rule: effects stay **coarse** (one `CallModel`, one `InvokeTool` — never micro-effects), so
one Work-phase turn is one step in, one effect out, one event back (§9's "one step per call"
already guarantees this granularity), and the runtime loop lives in `core` at under 40 lines.
**Recommendation: `step()`.** Streaming is the one open threat — token deltas as Events could
flood the log or force fine-grained effects. RESOLVED(spike-A → ADR-002),
SUPERSEDED in form by the Dioxus ship: there is no streaming transport at all. The pane polls
`GET /chat` every 400 ms (`crates/ui/src/chat/poller.rs:94`) and each poll is an ordinary
`Request → Response` cycle. Deltas never enter the event log; only the completed message becomes
an Event. Replay granularity holds — by a simpler mechanism than the one argued for here.

### 1d. Where the Worker boundary sits

**Design 1 — core Wasm on the main thread.** The page's view layer calls the Wasm export
directly. No postMessage, no structured-clone, trivially debuggable, one less moving part.

**Design 2 — core in one long-lived dedicated Worker.** Main thread holds the view layer plus a
~50-line shim that postMessages `Request`/`Response` (§5 option B); the Wasm instance and all
port adapters live in the Worker.

**Against Design 2:** the Worker adds postMessage serialization on every interaction and makes
DevTools debugging two-context. Model calls are async `fetch` either way — the main thread never
blocks on network, so the common case gains nothing.

**Counter and recommendation:** the jank risk is not network, it is **compute we don't control**:
forged Rhai modules (unbounded agent-authored loops) and large Document assembly run inside the
core. On the main thread a runaway forged module freezes the page *including the abort button* —
killing the observability and abortability the forge pipeline promises (§7). Script timeouts
mitigate but only the Worker makes the UI's liveness independent of the core's worst module.
Tier 2 (§10) already commits to Workers for multi-agent; one Worker from day one is the same
mental model, not a new one. **Recommendation: Design 2 — core in a Worker from the start.**
**SUPERSEDED by the ship — Design 1 is what runs.** The core is on the main thread and the
`ui` crate's Dioxus handlers call it in-process; there is no serialization boundary in front of
the seam at all (`crates/adapters_web/src/seam.rs:23`, §6 row 8). The jank argument was answered
a different way than either design imagined: Workers do exist, but they hold **sub-agents** — one
Worker per delegated agent (`Effect::Delegate`, `crates/agent/src/effect.rs:54`; `web/agent-worker.js`)
— and their facts re-enter the log through the same one door on the way past
(`seam.rs:27-47`). So the unbounded-compute risk sits off the main thread without the seam ever
being remote. The service worker remains caching and updates only (ADR-002, ADR-007) — never a
state holder.

---

## 2. Module map (recommended, 8 crates)

| Crate | Purpose (one line) | Must NOT absorb |
|---|---|---|
| `kernel` | Leaf vocabulary: ids, typed errors, Event + event log types, `Request`/`Response`, port traits (`ModelPort`, `StorePort`, `NetPort`, `ClockPort`, `RngPort`) | Any behavior; routing dispatch; HTML; anything importing another workspace crate |
| `context` | `Document`, `Section`, stability classes, budget/compaction, pure `assemble` + `render` (§8) | The module registry; model transport; any I/O. RESOLVED(spike-C): Part = Text/Image/Audio/File/Fragment carrying bytes not URLs (R2), proven under golden + prefix-identity tests |
| `script` | Embedded interpreter (Rhai per ADR-003) + capability binding table | Knowledge of agents, phases, or the registry; any ambient capability. RESOLVED(spike-B): binding = per-module Engine with capability closures, effective grants = manifest ∩ host-granted |
| `module` | Module trait + manifest + registry + generated Affordance document (§6, ADR-004); `view` submodule: escaping, page shell, `hx-*` builders, Fragment type | Business logic of any specific module; the interpreter itself (it *invokes* `script`) |
| `agent` | Pure `step()`, `AgentState`, the phase machine (§9, ADR-010), Scout + Forge roles; forge pipeline as a built-in module (§7) | I/O of any kind; port implementations; rendering beyond its own fragments |
| `core` | The seam: `handle(Request) -> Response` (§3); routing dispatch; effect-runtime loop (≤40 lines); wiring + built-in module registration | Domain logic; direct Web APIs; anything an adapter should own |
| `adapters_web` | wasm-bindgen port impls: fetch, IndexedDB (ADR-005; RESOLVED(spike-idb): hand-rolled web-sys, no wrapper crate — 52-crate tree + pin conflict), OPFS, WebCrypto, Worker glue; the composition root that owns the Wasm entry | Domain types beyond `kernel`'s; any logic that could run on the host |
| `adapters_test` | In-memory port impls for `cargo test` (dev-dependency of the pure crates) | Anything shipped to production |
| `ui` | The Dioxus app (increment 01): layout, theme, and the event handlers that call `core::handle` via `adapters_web::WebApp` | Any application logic; direct port construction; content it did not get back from the seam |

`web/` is the trunk source dir: `index.html` (the `ui` bin + relative asset links), `theme.css`,
`sw.js` (caching/updates only, ADR-007) which `importScripts("coi-sw.js")` for the cross-origin
isolation headers, plus `agent-worker.js` (one Worker per sub-agent) and the stylesheets. There
is no JS transport file and no vendored view library: Dioxus supersedes ADR-002's transport half,
and the `hx-*` builders in `module::view` are the fragment vocabulary the forge will emit, not a
runtime dependency of the shipped app.

---

## 3. Dependency graph

```mermaid
graph TD
  subgraph browser["web/ (no logic — I5)"]
    T[index.html + sw.js + coi-sw.js + agent-worker.js]
  end
  subgraph L3["L3 — composition root + app"]
    UI[ui]
    AW[adapters_web]
    AT[adapters_test]
  end
  subgraph L2["L2 — wiring"]
    CORE[core]
  end
  subgraph L1["L1 — pure domain"]
    AG[agent] --> MO[module]
    AG --> CX[context]
    MO --> CX
    MO --> SC[script]
  end
  subgraph L0["L0 — vocabulary"]
    K[kernel]
  end
  T -->|loads the Wasm bundle| UI
  UI --> AW
  UI --> K
  AW --> CORE
  CORE -. dev-dep .-> AT
  CORE --> AG
  CORE --> MO
  CORE --> CX
  CORE --> SC
  CX --> K
  SC --> K
  MO --> K
  AG --> K
  CORE --> K
  AW --> K
  AT --> K
```

Intra-domain direction is `agent → module → {context, script}` and is **declared here, which the
straw-man's table never did** — its four rows left the seven domain crates free to import each
other arbitrarily; the split was partly ceremonial for exactly that reason. `module → context`
(a module can provide a Section, so it needs the Section type) is the assumed direction —
RESOLVED(spike-C): assembly ergonomics raised no pressure for the reverse direction;
`module → context` stands.

---

## 4. Layering table (CI-enforced)

| Layer | Crates | May import (workspace) | Must NOT import |
|---|---|---|---|
| L0 | `kernel` | — (std, serde only) | any workspace crate |
| L1 | `context`, `script` | `kernel` | each other; `module`; `agent`; `core`; `adapters_*` |
| L1 | `module` | `kernel`, `context`, `script` | `agent`, `core`, `adapters_*` |
| L1 | `agent` | `kernel`, `context`, `module` | `script` (only via `module`), `core`, `adapters_*` |
| L2 | `core` | all L0–L1 | `adapters_*` |
| L3 | `adapters_web` | `kernel`, `core` | `agent`, `module`, `context`, `script` directly |
| L3 | `adapters_test` | `kernel` | everything else (pure crates take it as a dev-dependency) |
| L3 | `ui` | `kernel`, `adapters_web` | `core`, `agent`, `module`, `context`, `script` directly |

**Straw-man bug, fixed here:** §11 forbade `adapters_*` from importing `core` *and* `core` from
importing adapters — leaving no crate able to wire the application without a fourteenth it never
listed. Resolution: `adapters_web` is the driving adapter *and* composition root (standard ports
& adapters), so `adapters_web → core` is legal; `core → adapters_*` stays forbidden and port
impls are injected as `dyn` trait objects at the entry point.

**Enforcement (check-script logic in prose; lives in CI, fails the build):**

1. Run `cargo metadata --format-version 1`; keep only workspace members.
2. Build the member-to-member dependency edge set (normal + build deps; dev-deps exempt only for
   `adapters_test` consumers).
3. Encode the table above as an allowlist map `crate → {allowed workspace deps}`; any edge not in
   the map fails with the offending `from → to` pair printed.
4. Assert `wasm-bindgen`, `web-sys`, `js-sys` appear in the transitive normal-dependency closure
   of `adapters_web` **only** — this is I3 as a mechanical check, not a convention.
5. Separately, CI runs `cargo test --workspace --exclude adapters_web` on a plain Linux host with
   no browser: if it compiles and passes, the pure-core property held this commit.

---

## 5. The property defended: host-testable everything (I3)

Every crate except `adapters_web` compiles and tests on the host — routing, rendering, assembly,
the phase machine, the forge pipeline, the registry, the script engine. Effect of each §1 change:

- **http/ports/phase/forge/view merges (1a, 1b):** no effect — every merge stays inside the pure
  set; the excluded-crate list is still exactly `adapters_web`.
- **Forge as a module (1a):** no effect — it tests on the host like any module, which is itself
  a live demonstration of I9.
- **`step()` retained (1c):** strengthens it — the whole orchestration cycle (§9's diagram) runs
  under `cargo test` with no model, no fakes even, by asserting on returned effects. The async
  alternative would have *kept* host-testability but surrendered replay and resume (I7's point).
- **Core in a Worker (1d):** no effect — the Worker is an `adapters_web`/`web/` runtime concern;
  no pure crate knows it exists.
- **Rhai in `script` (ADR-003):** Rhai is pure Rust, so forged-module logic itself is exercised
  by host tests — RESOLVED(spike-B): the capability-denied dry run runs under plain
  `cargo test` (6/6 green, typed denial errors, no browser).

---

## 6. The turn, traced

This is the flow this document owes a reader, derived hop by hop from the tree on `main` and
verified file by file. **There is no JS transport and no second wire format.** A Dioxus event
handler calls `WebApp::handle`, which calls `core::handle`, in-process (I4) —
`crates/adapters_web/src/seam.rs:1-3` says exactly that in its own words. The §1d Worker
question was answered by the ship: the core runs on the main thread, and Workers hold
*sub-agents*, not the seam.

One turn has two halves that meet in the log. The **sync half** (rows 1–16) runs inside the
event handler and returns a fragment immediately. The **async half** (rows 17–35) is a `drive`
loop the same call spawns; the pane learns what it did by polling (rows 36–37). Nothing is
pushed to the page — every repaint is another trip through the same seam.

### 6a. The sync half — the message lands, the pane repaints

| # | File:line | What happens |
|---|---|---|
| 1 | `crates/ui/src/composer/mod.rs:101` | `onsubmit` → `send(…)` |
| 2 | `crates/ui/src/composer/mod.rs:76` | `send` ends in `on_send.call(text)` |
| 3 | `crates/ui/src/chat/log.rs:68` | the handler bound to `on_send` is `say(pane, text)` |
| 4 | `crates/ui/src/chat/mod.rs:97` | `say` — the one path a message takes out of this pane |
| 5 | `crates/ui/src/chat/mod.rs:103` | builds `Request::post_form("/chat", &[("message", &text)])` |
| 6 | `crates/ui/src/chat/state.rs:61` | `to()` stamps the `x-agent` header — which agent is being addressed |
| 7 | `crates/ui/src/chat/mod.rs:104` | `app.handle(req)` — the Rust side of the seam, called directly |
| 8 | `crates/adapters_web/src/seam.rs:23` | `WebApp::handle` — drains every Worker's queued reports first (`seam.rs:27-47`), so a sub-agent's facts land through the one door (I8) |
| 9 | `crates/adapters_web/src/seam.rs:48` | `core::handle(&mut app, req)` |
| 10 | `crates/core/src/lib.rs:126` | **the one seam** — `handle(&mut App, Request) -> Response` |
| 11 | `crates/core/src/lib.rs:131` | `agents::roster::reconcile` — the page can never show an agent the core has not loaded |
| 12 | `crates/core/src/dispatch.rs:62` | `dispatch`: route → registry → tier |
| 13 | `crates/core/src/dispatch.rs:42` | `builtin_entry`, the module dispatch table; `"chat"` → `chat::pane::chat` (`dispatch.rs:45`) |
| 14 | `crates/core/src/chat/pane.rs:56` | chat's own router; `("POST", "/chat") => submit` (`pane.rs:66`) |
| 15 | `crates/core/src/chat/pane.rs:153` | `submit` pushes `EventKind::UserMessage` into `ctx.emit` (`pane.rs:164`) — the dispatcher drains it |
| 16 | `crates/core/src/chat/transcript.rs:63` | `transcript` folds the log into the response fragment, with the new message already in place |

### 6b. The async half — `drive`, the model, the tools

| # | File:line | What happens |
|---|---|---|
| 17 | `crates/adapters_web/src/seam.rs:54` | `spawn_local(core::drive(app))` — the same seam call starts the async half |
| 18 | `crates/core/src/runtime/mod.rs:44` | `drive` — the loop, 28 lines (`44-71`): refresh the space, take one pending event, run its effects, repeat; then persist through `StorePort` |
| 19 | `crates/core/src/runtime/mod.rs:86` | `think` takes the one borrow that does not cross an await, and calls `pump` (`mod.rs:88`) |
| 20 | `crates/core/src/runtime/mod.rs:25` | `pump` — sync, the ONLY runtime caller of `step`. This is the thinking/doing wall, and it has one door |
| 21 | `crates/agent/src/step.rs:24` | `step` → `advance` (`step.rs:34`) → the `UserMessage` arm (`step.rs:45`) → `on_task` (`step.rs:93`) |
| 22 | `crates/agent/src/ask.rs:60` | `call_model` picks the provider form and rebuilds the per-call components |
| 23 | `crates/context/src/assemble.rs:127` | `assemble` builds the `Document` under the phase's budget (I13/I14) |
| 24 | `crates/agent/src/effect.rs:20` | the returned `Effect::CallModel { document, format, endpoint, model, temperature, speaker }` |
| 25 | `crates/core/src/batch.rs:106` | `run_effects` — a line of `Delegate`s is awaited as a group; everything else goes one at a time through `single` (`batch.rs:135`) |
| 26 | `crates/core/src/effects.rs:25` | `execute_port_effect`: `context::render` (`:41`), `openai_request_body` (`:44`), `model.call` (`:46`) |
| 27 | `crates/adapters_web/src/model.rs:87` | `ModelPort::call` — resolves the catalogue key against `models.json`, attaches the credential (the agent never saw it, I6), `global_fetch` (`model.rs:120`) |
| 28 | `crates/core/src/effects.rs:74` + `:81` | the reply becomes two facts: `ModelCalled` (what it cost) then `ModelReplied` (what it said) |
| 29 | back to 18 | `crates/core/src/batch.rs:152-153` appends each fact and pushes it back onto `pending`; `drive` loops |
| 30 | `crates/agent/src/step.rs:128` | `on_reply` — one reply against the phase's contract, via `parse_reply` (`crates/agent/src/reply.rs:30`) |
| 31 | `crates/agent/src/calls.rs:19` | `parse_batches`; each call becomes `Effect::InvokeTool` through `subagent::invoke_or_refuse` (`step.rs:148`). No calls → `answer::answered`, the turn's exit |
| 32 | `crates/core/src/batch.rs:170` | `invoke` — one tool call, run and recorded, with the append-and-push written once |
| 33 | `crates/core/src/tools.rs:107` | `tool_entry` — **the one tool dispatch table**: workspace / websearch / space handlers are awaited outside any borrow; a name it does not claim falls to `tools::run` (`tools.rs:125`) inside the borrow, which refuses an unknown tool in words |
| 34 | back to 18 | the tool's fact goes round again — next model call, or a reply with no calls, which ends the turn |
| 35 | `crates/core/src/lib.rs:76` | `answer` — a fold over the log for the last reply that called no tools; this is what a sub-agent hands back to its caller |

### 6c. Back on screen

| # | File:line | What happens |
|---|---|---|
| 36 | `crates/ui/src/chat/poller.rs:94` | while the turn is pending the pane polls `GET /chat` every `TICK_MS` = 400 ms (`poller.rs:14`) — each poll is rows 7–16 again |
| 37 | `crates/ui/src/chat/state.rs:68` | `show` applies one seam response as a single value, reading `x-agent`, `x-turn` and `x-tokens` off the headers |

Thirty-seven hops, five crates. Every read view in the product is the same shape: a `Request`
through `WebApp::handle` into `core::handle`, a fold over the log, an HTML fragment back. The
board, the trace, the files pane and the terminal differ from the transcript only in which
`builtin_entry` row (row 13) they land on.

### 6d. What is NOT yet in the tree

The forge pipeline (§7) is typed but not wired: `crates/agent/src/forge.rs` defines
`ForgeStage` and the stage events, and nothing in `builtin_entry` (`crates/core/src/dispatch.rs:42`)
routes to it. When it lands, the install write goes through `StorePort` the same way the log
does — in `drive`'s tail (`crates/core/src/runtime/mod.rs:67-68`), not through a dedicated effect.
`Effect` has exactly four variants today (`crates/agent/src/effect.rs:16`): `CallModel`,
`InvokeTool`, `Emit`, `Delegate`. The `Persist` and `Sleep` variants this document once
described were speculative and have been deleted (CRITIQUE-01 F10).
