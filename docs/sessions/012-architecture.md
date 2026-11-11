# 012 Architecture: the application, how it is built, what is missing, and the order

The whole design in one place, drawn from `000`–`011` and three readings of the code taken on
2026-11-10 (the build, the code against the design, the features). Each section ends with what
you are asked to judge: **too heavy** or **too light**. An alternative is argued only when it
would change the reason behind the other choices.

## 1. The reason behind every choice

> **One person's work, done by many agents, on one machine, in a form anyone can be handed
> without being handed the person.**

| part of it | what it forces |
| --- | --- |
| one person | one host, one writer, one home; no tenants, roles or many-user machinery |
| many agents | engines (askk's own loop) and sessions (other harnesses) are peers, related by envelopes |
| one machine | client and server in one app; nothing listens on the network unasked |
| handed to anyone | kinds are code, recipes are craft, bindings and state are personal; packs carry recipes only |
| without the person | a personal value cannot sit in a recipe; the check is structural, not a scan |

## 2. The shape

```text
┌──────────────────────────── one process (the Mac app) ────────────────────────────┐
│ shells/    window · tray · dock · notch · companion                (Dioxus desktop) │
│ ui/        pages drawn from Nodes; never imports host                               │
│            api::port (Host trait) ── api::local  (in-process call)                  │
│                                   └─ api::remote (HTTP / Unix socket: browser, CLI) │
│ api/       one method registry: schema in, schema out, an example each              │
│ host/      the machine: store · bindings · layers · infer · harness/<kind> · media  │
│            · workspace · audit                                                      │
│ elements/  the kinds an engine is made of (Kind = name, new, params)                │
│ core/      what things are: Recipe + State, Param, Envelope, Board, Engine loop,    │
│            Flow, Session, Harness port, Run, Changes                                │
└─────────────────────────────────────────────────────────────────────────────────────┘
      dependencies point inward only; src/structure.rs enforces it
```

| object | is | lives |
| --- | --- | --- |
| **kind** | code with typed params (`core::KINDS`) | the binary |
| **recipe** | kinds + craft values + holes + flow | `engines/<path>/`, in a layer |
| **bindings** | the value of each hole; roles → models | `<home>/personal/bindings.json` |
| **state** | what happened | `<engine>/state/`, runs, the board |
| **member** | anything with an address and an inbox: engine, session, `user` | the board |
| **envelope** | `{id, from, to, kind, about, cause, body}`; kinds `say · ask · answer · report` | `board.json` |
| **harness** | a program that runs another agent's loop | `host/harness/<kind>.rs` |

## 3. How it is built (measured)

| fact | value | so |
| --- | --- | --- |
| layout | one crate, one binary, features `web · desktop · mobile · server` | keep it |
| `cargo check --features server`, warm | 11 s | no compile-time reason to split |
| `cargo test --features server` | 0.5 s, 165 tests | tests stay the proof of every step |
| debug wasm | 94 MB (135 MB raw) | the weight is debug info and dioxus, not our code |
| `core`, `elements` | serde only, no dioxus, 7.9k LOC | already a clean inner layer |
| `host` | tokio + reqwest, behind `server` | nothing server-only reaches the client |
| `[profile.*]` | none | the cheapest win is here |

**Decision: one crate; profiles now; split only on a trigger.**

```toml
[profile.release]
lto = "thin"
codegen-units = 1
strip = true

[profile.wasm-release]          # dx bundle --platform web --release
inherits = "release"
opt-level = "z"
lto = true
panic = "abort"

[profile.dev.package."*"]       # dependencies optimised once; our code stays quick to build
opt-level = 2
```

Split into `askk-core` (core + elements) / `askk-host` / `askk` (ui, api, shells) when **any**
of these is true: `cargo check` passes 45 s; a second binary needs `core` without dioxus; a
structure test cannot hold a wall. The walls already match those crates, so a split is a move,
not a rewrite.

`target/` is 30 GB, with stale `powerhouse*` artifacts from before the rename; `cargo clean`
only removes build output.

**Judge:** profiles too light? Splitting now too heavy (I think so)?

## 4. The sub-agent protocol

One **lead** session and narrow **workers**; the docs are the memory between them.

| role | model | may | may not | returns |
| --- | --- | --- | --- | --- |
| **lead** | Opus | plan a step, write its goal, merge, run tests, commit on your yes | skip a wall test | the step's proof |
| **reader** | Sonnet / Haiku (Explore) | read code, docs, other repos; measure | edit | a table with file:line |
| **builder**, one per step | Opus for contract steps, Sonnet for mapping steps | edit the files the step names | touch other files; change a port quietly | diff stat and the passing test names |
| **reviewer** | Sonnet (rust-reviewer) | read the diff fresh, given no hypothesis | edit | findings, worst first |
| **you** | — | judge heavy or light; answer "Yours"; approve commits and live runs | — | — |

1. **One step = one goal = one fresh session** (`006`): end state, proving tests, paths that must
   not change, a turn bound.
2. **Readers fan out; builders do not.** Two builders never share a file.
3. **A port change stops the builder.** `Component`, `Host`, `Harness`, `Envelope` changes go to
   the lead with the reason; never worked around.
4. **Proof is shown:** the last lines of `cargo test`, `git diff --stat`, and for a live step the
   page text.
5. **The reviewer gets code, not conclusions.**
6. **Commit at the end of each step**, so the next step's "must not change" is a clean diff.

## 5. Gap analysis

### 5.1 The design against the code

| concept | now | gap | step |
| --- | --- | --- | --- |
| typed params per kind; unknown key refused | **done** (`core/param.rs`, `KINDS`) | `share` declared, not yet enforced | 1 ✔ |
| recipe apart from state | **done**: recipe in `elements/`, state in `memory/` | `Spec` still carries both in memory (one type until step 3 needs two) | 2 ✔ |
| holes, bindings | **done**: `{"$": name}` filled at `boot::init` from `personal/bindings.json` (`host/data.rs::bindings`); the recipe is what is saved (`Engine::recipes`); an unbound hole stops only its engine | `role:` for models, and refusing a personal literal in a recipe: the live recipes still hold literals, so that refusal belongs to `pack export` (step 4), not boot | 3 ✔ (part) |
| packs, layers | **export and import done** (`core/pack.rs`; server fns `pack_export`, `pack_import`: import writes nothing unless every file is accepted): recipe files plus `needs`; refuses a personal or secret literal and personal-looking shared text, naming the file and line; notes text leaves only with `share: true`; every shipped engine exports | layers replacing seeding (built-in → packs → mine) | 4 (part) |
| envelope | **done**: `Message {id, from, to, kind, about, cause, text, seen}`; `Act` say/ask/answer/report; `Cause` person/wake(id)/engine; `post_wake` for schedules; old board files read as says by a person | states `taken · gone` wait for sessions (an engine marks seen = settled) | 5 ✔ |
| member ids | the engine path is the address | `kind:<id>` + labels + resolver | 5 |
| board | a global `OnceLock` | owned by the host world and passed in | 5 |
| one turn per member | **already true for engines**: `Engine::wake` runs one loop at a time (`busy` + `pending`) | sessions get the same rule in step 7 | 5 ✔ |
| Host trait, local and remote | `#[server]` functions reach the host directly | `api::port`, `api::local` | 6 |
| method registry | hand-written server functions | one table that generates routes, CLI, MCP | 6 |
| session, Harness port | none | `core/session.rs`, `host/harness/claude.rs` | 7 |
| permission wire | none | `PermissionRequest` hook (Terax's shape, 900 s) | 7 |
| audit | an in-memory change log | `audit.jsonl`, additive-only | 7 |
| answer scope, protected kinds | one answer per ask | `once · thread · always`; order placement never opened by a rule | 8 |
| order gate | script and rails exist, unhooked | the hook calls `order-gate.sh` | 8 |

### 5.2 Built but not installed (no code needed)

| feature | what is missing |
| --- | --- |
| guru mode, talk route, vision model, whiteboard figures | not in the live home: seeding adds only missing keys (layers in step 4 end this) |
| tray, dock, notch, companion | the desktop build has not been checked end to end |
| order gate and rails | no hook references them; both desks are dry-run |

### 5.3 Too heavy today (your call)

| item | weight | suggestion |
| --- | --- | --- |
| `core/engine.rs` | 1,090 LOC: loop, prompt, tools and save together | split along `flow.rs` stages when step 7 touches it, not before |
| figures (`core/figure.rs`, `ui/figure.rs`, `canvas_math.rs`) | ~1.2k LOC | keep (it is guru's reason); no new figure kinds until sessions land |
| `allow(dead_code)` on core and elements in client builds | hides dead code | gate what the client never calls, then drop the allow |
| `inbox` element | holds config it never reads | becomes the member's view of the board in step 5 |

### 5.4 The features you want, placed

| feature | needs first | step |
| --- | --- | --- |
| talk to Claude Code / Codex inside askk | 5, 6 | 7 |
| askk turns a wish into a brief and watches the session | 7 | 8 |
| trading desks live, not dry-run | answer scope, the order gate, your rails | 8, then your yes |
| shareable engines and desks | 2, 3, 4 | 4 |
| companion character and pet packs | packs (a look is a pack) | after 4, with your answers |
| iPhone | `api::remote`, a way to reach the host | after 6 |
| self-changing app (ask → PR → restart) | a developer session does the change | after 8 |
| seed and scan in SQLite | a measured need | not planned |

## 6. The progression, from the skeleton

Each step is one commit, one goal and one test list, and changes only what it names.

| # | step | end state | proof | must not change |
| --- | --- | --- | --- | --- |
| 0 | **profiles** ✔ (clean is yours) | `[profile.release]` thin LTO, one codegen unit, strip; dependencies at opt-level 2 in dev. A `wasm-release` profile is left out: `dx` names its own profiles, so it waits for a measured release build | release wasm size written in `docs/build.md` | `src/` |
| 1 | **typed params** ✔ | every kind declares its keys; an unknown one is refused | `every_kind_declares_its_keys_and_refuses_others`, `every_shipped_element_uses_declared_keys`, `an_unknown_key_is_refused_with_its_name` | — |
| 2 | **state apart** ✔ | element files hold recipes; state in `<engine>/memory/<name>.json` (`boot::STATE`; "state" is a kind name); an element with `config.file` keeps its text in that file as before; old files are read as they are and split on the next save | `an_old_element_file_is_read_and_split`, the recipe assertions in `store_scan_initialises_engines_and_state_survives_restart` | `src/ui`, `src/api` |
| 3 | **holes, bindings** ✔ (roles and the literal refusal move to 4) | `{"$": …}` and `role:` resolve from `bindings.json`; a personal literal in a recipe is refused; an unbound hole stops only its engine | `a_personal_slot_refuses_a_literal`, `an_unbound_hole_stops_only_its_engine`, `config_never_returns_a_bound_value` | `src/ui` |
| 4 | **layers, packs** (export ✔, import ✔, `role:` models ✔; layers remain) | built-in → packs → mine → personal; an edit copies into mine; `pack export / check / import` | `an_edit_to_a_pack_recipe_lands_in_mine`, `an_export_holds_no_bound_value` | `src/ui` |
| 5 | **envelope** ✔ (ids and the board owned by the world remain) | `Envelope` replaces `Message`; ids; the world owns the board; one turn per member | `an_envelope_carries_its_cause_set_in_code`, `two_envelopes_at_once_make_one_turn`, `a_report_goes_to_whoever_asked` | `src/host/infer`, `src/ui` except the inbox view |
| 6 | **one app** | `Host` trait; `api::local` inside the Mac app; the registry generates routes | `ui_reaches_the_host_only_through_the_port`, `two_windows_one_writer`, `every_api_method_has_a_schema_and_an_example` | `src/core`, `src/elements` |
| 7 | **first session** | Claude Code via stream-json + `PermissionRequest` hook; asks on the Asks page; audit written; resumes after a restart | the stage 1 list in `006` | `src/core/flow.rs` |
| 8 | **askk drives** | askk opens a session, briefs it, hears its report; answer scope; the order gate on the hook | the stage 2 list in `006` | `src/host/harness` |
| 9 | **second harness** | Codex (`app-server`) behind the same port | the contract test for both kinds | `src/core/session.rs` |

Steps 2–4 and 5–6 are separate lines; 7 needs 5 and 6. Steps 0–4 leave the session layer
alone, so the desks keep running throughout.

## 6.1 Step 6 is likely too heavy as drawn: a lighter alternative

There are 43 `#[server]` functions (`src/api/*.rs`), and they already are the method list. A
`Host` trait with a `local` and a `remote` implementation would restate every one of them, and
each change would then be written three times.

**Alternative, which still serves the reason in §1 ("one machine, one app"):** the Mac app
starts the host inside its own process on a loopback socket, and its window calls the same
server functions the browser calls. That is one process, one writer and one copy of each
method. The cost is a loopback HTTP hop of microseconds per call, which matters only for the
change feed, and the feed is one long poll.

- What step 6 keeps: one host per home, enforced by the pid lock; the app starts the host when
  none is running, and otherwise attaches to it; a test that `ui` reaches `host` only through
  `api`, which `only_the_api_reaches_the_host` already enforces.
- What it drops: `api::port`, `api::local`, `api::remote`.
- What waits: a generated method registry. It is worth building when a second client, the CLI
  or the agents' MCP tool, needs the list without dioxus. Until then the server functions are
  the registry.

**Judge:** the trait (as in 011), or the in-process loopback host (proposed)?

## 7. Yours

1. **Step 0 now?** It changes `Cargo.toml` and deletes build output only.
2. **Order:** shareability first (2 → 4) or sessions first (5 → 7)? I would do 2, then 5, 6, 7,
   then 3–4: sessions are what you use daily, and recipes do not block them.
3. The open answers in `007` (member, adapt, brief shown, goal as a thread, reuse, tell askk)
   and `011` §9 (where bindings live, goal.md is craft, no code in packs).
