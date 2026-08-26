# PORT-MAP — CLOSED

> **The tree this file inventories no longer exists.** `crates/` — 468 files,
> 67,476 lines — was deleted on 2026-08-25 once the port was done and measured.
> The whole of it is at tag `pre-rewrite-js`, which is the only place it now is,
> and every `crates/...` path below is a path into that tag.
>
> **What this file is now.** Not a work order: a record of what the Rust was,
> what each part became, and — in "Files that should NOT be ported" at the
> bottom — the only section still making a live claim, which is why four
> surfaces have no JS counterpart and never will.
>
> **Two honest corrections to the table below, both measured.**
>
> 1. The `target JS file` column is where a lane was ASKED to put something, not
>    where it is. Of the 161 rows, 50 targets exist at exactly the named path;
>    the rest landed under names the lane chose while building — the block
>    vocabulary is one directory rather than fourteen files, the view
>    projections are `packages/core/src/<view>.js` rather than
>    `views/<view>/routes.js`, and the phase machine's row (B6) has no target at
>    all because the thing was retired. Read the tree, not this column.
>
> 2. **Four rows were REFUSED, not landed, and the reason is one fact.** This
>    build's `WorkspacePort` is OPFS, which stores files and runs nothing: there
>    is no Linux in the page, because the only one was a 47 MB emulator whose
>    own `durable()` returned false (docs/RULINGS.md). So C20's exec half, C21
>    (a gesture translated into a command), C22 (long-running processes) and C23
>    (asking the machine what it is) have no runner behind them, C67 (the
>    emulator itself) is refused on the record, and the shipped
>    `apps/web/public/agents/main/agent.md` does not name the tools they would
>    have provided. `packages/adapters-web/test/tools.test.js` executes that:
>    every tool the shipped agent file names resolves to a descriptor with a
>    runner behind it, and the list of names owed to the model is empty.

---

Work order for the rewrite. Every `lines` is `wc -l` of the named Rust file(s) on `main`
at 2026-08-25. Lanes: `A-PAPER` = `packages/context`, `B-LOOP` = `packages/agent`,
`C-SPINE` = `packages/core` + `packages/adapters-web`, `D-FACE` = `apps/web`.
`packages/kernel` and `packages/adapters-test` are DONE and carry no rows.

Rows group tightly-related files; a `+` in the source cell means the lines are the sum.
`depends on` names other rows by their TARGET file.

**One decision this map encodes.** In Rust the seam returns HTML fragments and the UI
scrapes attributes back off them (`ui/board/read_attrs.rs`). In JS, view projections
return plain data and React renders it. That kills `module::view` and every attribute
scraper (see "Files that should NOT be ported").

---

## A-PAPER — `packages/context` (14 + 13 Rust files → 21 rows)

| # | Rust source | lines | what it does | target JS file | lane | depends on |
|---|---|---|---|---|---|---|
| A1 | `crates/context/src/types.rs` | 163 | `Section`/`Part`/`Document`/`Fidelity`/`Budget` shapes; the fidelity ladder Full→Summarized→Pointer→Elided | `packages/context/src/types.js` | A-PAPER | `kernel/src/index.js` |
| A2 | `crates/context/src/slot.rs` | 90 | `Slot` whose derived `Ord` IS prompt order — soul pinned 0, response_contract pinned 99 | `packages/context/src/slot.js` | A-PAPER | `context/src/types.js` |
| A3 | `crates/context/src/component.rs` | 199 | the Component contract: `render`/`slot`/`stability`/`id`/`intent`, each rendered inside an inherited `## id (intent)` frame | `packages/context/src/component.js` | A-PAPER | `context/src/slot.js` |
| A4 | `crates/context/src/form.rs` | 59 | the notations one component may write itself in (`render_in`) — the reader picks, not the object | `packages/context/src/form.js` | A-PAPER | `context/src/component.js` |
| A5 | `crates/context/src/state.rs` + `error.rs` + `lib.rs` | 40+34+38 | everything `assemble` reads, the install-time contract violations, the barrel | `packages/context/src/state.js`, `errors.js`, `index.js` | A-PAPER | `context/src/types.js` |
| A6 | `crates/context/src/assemble.rs` | 153 | stage 1 — decides WHAT the paper says; pure, same inputs ⇒ same document bit for bit | `packages/context/src/assemble.js` | A-PAPER | `context/src/component.js`, `context/src/state.js` |
| A7 | `crates/context/src/degrade.rs` | 85 | what a budget does when it bites: drop binary parts, then walk sections down the ladder until the arithmetic closes | `packages/context/src/degrade.js` | A-PAPER | `context/src/assemble.js` |
| A8 | `crates/context/src/render.rs` | 200 | stage 2 — how THIS provider hears the paper; three targets, provider quirks live only here | `packages/context/src/render.js` | A-PAPER | `context/src/assemble.js` |
| A9 | `crates/context/src/openai.rs` | 168 | OpenAI chat-completions request-body writer and reply reader | `packages/context/src/openai.js` | A-PAPER | `context/src/render.js` |
| A10 | `crates/context/src/hash.rs` | 22 | content address of a rendered document — the `document_hash` on `ModelCalled` | `packages/context/src/hash.js` | A-PAPER | `context/src/render.js` |
| A11 | `crates/context/src/law.rs` | 85 | the paper's laws as checkable predicates; `assemble` is total, judging it is separate | `packages/context/src/law.js` | A-PAPER | `context/src/assemble.js` |
| A12 | `crates/context/src/args.rs` | 167 | THE one reader for the JSON a model wrote — replaced sixteen copied field reads | `packages/context/src/args.js` | A-PAPER | `context/src/errors.js` |
| A13 | `crates/agent/src/components/mod.rs` | 135 | the block vocabulary: every part of the prompt as a type that knows where it belongs | `packages/context/src/blocks/index.js` | A-PAPER | `context/src/component.js` |
| A14 | `.../components/soul.rs` | 148 | the pinned head — who this agent is before it is told anything | `packages/context/src/blocks/soul.js` | A-PAPER | `context/src/blocks/index.js` |
| A15 | `.../components/history.rs` + `memory.rs` | 72+35 | the conversation so far; the lines this agent chose to keep | `packages/context/src/blocks/history.js`, `memory.js` | A-PAPER | `context/src/blocks/index.js` |
| A16 | `.../components/world.rs` | 144 | what is true right now: clock, space, task, last results | `packages/context/src/blocks/world.js` | A-PAPER | `context/src/blocks/index.js` |
| A17 | `.../components/affordances.rs` | 84 | the toolbox as the model is told about it — pre-rendered usage lines, not `Tool` values | `packages/context/src/blocks/affordances.js` | A-PAPER | `context/src/blocks/index.js` |
| A18 | `.../components/contract.rs` + `respond.rs` | 123+176 | the pinned last word: the reply shape demanded, stated as fields when prose will not do | `packages/context/src/blocks/contract.js` | A-PAPER | `context/src/blocks/index.js`, `context/src/form.js` |
| A19 | `.../components/directive.rs` + `goal.rs` | 63+71 | what THIS turn is asked to do (a stage brief, not a forged `user:` turn); the standing goal as the model reads it | `packages/context/src/blocks/directive.js`, `goal.js` | A-PAPER | `context/src/blocks/index.js` |
| A20 | `.../components/sensed.rs` | 198 | the one GENERIC block — a host fills it, a pure component renders it; how every faculty gets prompt text | `packages/context/src/blocks/sensed.js` | A-PAPER | `context/src/blocks/index.js` |
| A21 | `.../components/space.rs` + `artifacts.rs` | 141+95 | the words the shared space and the artifact shelf are written in (both are `Sensed` fillers, not components) | `packages/context/src/blocks/space.js`, `artifacts.js` | A-PAPER | `context/src/blocks/sensed.js` |

---

## B-LOOP — `packages/agent` (53 Rust files → 32 rows)

| # | Rust source | lines | what it does | target JS file | lane | depends on |
|---|---|---|---|---|---|---|
| B1 | `crates/agent/src/lib.rs` + `error.rs` + `effect.rs` | 114+35+59 | the crate barrel, the typed failure vocabulary, and `Effect` — serializable descriptions of something to be done | `packages/agent/src/index.js`, `errors.js`, `effect.js` | B-LOOP | `kernel/src/index.js` |
| B2 | `crates/agent/src/state.rs` + `state/opening.rs` | 170+63 | `AgentState` as plain serializable data, and what a fresh agent HAS | `packages/agent/src/state.js` | B-LOOP | `agent/src/effect.js`, `context/src/types.js` |
| B3 | `crates/agent/src/spec/mod.rs` + `yaml.rs` + `value.rs` + `defaults.rs` + `loader.rs` | 181+122+107+71+90 | `agent.md` → `AgentSpec`: block shape, per-value refusals, absent-key defaults, and which of many files wins a name | `packages/agent/src/spec/*.js` | B-LOOP | `agent/src/errors.js` |
| B4 | `crates/agent/src/author.rs` | 113 | a spec rendered back out as the `agent.md` a folder holds, and a new spec from what an author actually chooses | `packages/agent/src/author.js` | B-LOOP | `agent/src/spec/index.js` |
| B5 | `crates/agent/src/paper/mod.rs` + `adopt.rs` | 143+117 | rebuilding one section from its component; writing one spec onto one state | `packages/agent/src/paper.js` | B-LOOP | `agent/src/state.js`, `context/src/blocks/index.js` |
| B6 | `crates/agent/src/phase.rs` | 160 | phases as data — `ToolScope`, `ResponseContract`, and the ONE surviving `Work` config | `packages/agent/src/phase.js` | B-LOOP | `context/src/types.js` |
| B7 | `crates/agent/src/tools.rs` | 200 | tool DESCRIPTORS and the usage lines the model reads; running one is `core`'s job | `packages/agent/src/tools.js` | B-LOOP | `agent/src/index.js` |
| B8 | `crates/agent/src/toolbox.rs` | 147 | the set one agent may call, narrowed by a phase's grant, plus the refusals a call earns before it runs | `packages/agent/src/toolbox.js` | B-LOOP | `agent/src/tools.js`, `agent/src/phase.js` |
| B9 | `crates/agent/src/calls.rs` | 183 | parsing model text into tool calls — layout carries the schedule: one line = one batch | `packages/agent/src/calls.js` | B-LOOP | `agent/src/tools.js` |
| B10 | `crates/agent/src/reply.rs` | 86 | one raw model reply read into the typed `ParsedReply` the exit table is exhaustive over | `packages/agent/src/reply.js` | B-LOOP | `agent/src/calls.js` |
| B11 | `crates/agent/src/ask.rs` | 154 | everything that decides what ONE model call contains: phase config, granted toolbox, assembled Document, contract demanded back | `packages/agent/src/ask.js` | B-LOOP | `agent/src/paper.js`, `context/src/assemble.js` |
| B12 | `crates/agent/src/step.rs` + `step/line.rs` + `step/compaction.rs` | 195+66+40 | the pure step function — the wall between thinking and doing; the whole-line rule; the two arms where the reply is not this agent's | `packages/agent/src/step.js` | B-LOOP | `agent/src/reply.js`, `agent/src/ask.js`, `agent/src/state.js` |
| B13 | `crates/agent/src/answer.rs` | 125 | the arm where a turn tries to END, and the run of questions that decides whether it may | `packages/agent/src/answer.js` | B-LOOP | `agent/src/step.js` |
| B14 | `crates/agent/src/stages/mod.rs` + `stages/facts.rs` | 153+104 | the loop a turn runs, the cursor through it, and what a staged turn leaves in the log | `packages/agent/src/stages.js` | B-LOOP | `agent/src/step.js` |
| B15 | `crates/agent/src/strategy.rs` | 200 | one cheap call that VOTES the route — how much turn this message deserves | `packages/agent/src/strategy.js` | B-LOOP | `agent/src/stages.js` |
| B16 | `crates/agent/src/brief.rs` | 196 | what each stage is told — words fetched from `public/stages/<key>.md`, not compiled in | `packages/agent/src/brief.js` | B-LOOP | `agent/src/stages.js` |
| B17 | `crates/agent/src/passes.rs` | 110 | the loop around the loop: one turn walking its stage list more than once | `packages/agent/src/passes.js` | B-LOOP | `agent/src/stages.js` |
| B18 | `crates/agent/src/goal/mod.rs` + `declare.rs` + `fact.rs` | 175+124+70 | the standing goal as an OBSERVED exit code: three frontmatter keys, four refusals, and the record of one check | `packages/agent/src/goal/*.js` | B-LOOP | `agent/src/spec/index.js`, `agent/src/passes.js` |
| B19 | `crates/agent/src/verify.rs` | 165 | the verify gate — a fold over what the turn already recorded; nudges a turn that wrote a file and ran nothing | `packages/agent/src/verify.js` | B-LOOP | `agent/src/stages.js` |
| B20 | `crates/agent/src/critic.rs` | 79 | the verdict of a separate agent read mechanically: PASS / FAULT | `packages/agent/src/critic.js` | B-LOOP | `agent/src/stages.js` |
| B21 | `crates/agent/src/ending.rs` | 166 | HOW a turn ended, as a fact — eight named endings replacing `task = None` | `packages/agent/src/ending.js` | B-LOOP | `agent/src/step.js` |
| B22 | `crates/agent/src/stop.rs` + `steer.rs` | 80+48 | stop working (not stop looking); a sentence typed into a running turn, as a fact | `packages/agent/src/stop.js`, `steer.js` | B-LOOP | `agent/src/step.js` |
| B23 | `crates/agent/src/window.rs` | 165 | the rolling window: at `compact_at` entries everything but `keep_recent` goes to the summarizer | `packages/agent/src/window.js` | B-LOOP | `agent/src/state.js` |
| B24 | `crates/agent/src/supervisor.rs` | 142 | the status table — one row per loaded agent, written by whoever changed something | `packages/agent/src/supervisor.js` | B-LOOP | `agent/src/state.js` |
| B25 | `crates/agent/src/subagent.rs` | 188 | a sub-agent as an ordinary tool: which tools it gets, and how the goal is read out of the call | `packages/agent/src/subagent.js` | B-LOOP | `agent/src/toolbox.js` |
| B26 | `crates/agent/src/faculty/mod.rs` + `space.rs` + `memory.rs` + `artifact.rs` | 146+42+52+49 | a FACULTY: a named bundle of tools + prompt blocks, selected by an agent file writing its name — a table, not a plugin loader | `packages/agent/src/faculty/*.js` | B-LOOP | `agent/src/tools.js`, `context/src/blocks/sensed.js` |
| B27 | `crates/agent/src/space.rs` | 174 | spaces: the folder agents build in and the state they share; decisions only, bytes move in `core` | `packages/agent/src/space.js` | B-LOOP | `agent/src/faculty/index.js` |
| B28 | `crates/agent/src/memory.rs` | 142 | one agent's own durable lines — `keep` / `discard`, read back before every call | `packages/agent/src/memory.js` | B-LOOP | `agent/src/faculty/index.js` |
| B29 | `crates/agent/src/artifact/mod.rs` + `artifact/tools.rs` | 200+47 | a named, described, addressed thing the group produced; `record_artifact` / `read_artifact` and nothing else | `packages/agent/src/artifact.js` | B-LOOP | `agent/src/faculty/index.js` |
| B30 | `crates/agent/src/workspace.rs` | 200 | the workspace as the MODEL sees it: the eleven tool descriptors and the one path rule | `packages/agent/src/workspace.js` | B-LOOP | `agent/src/tools.js` |
| B31 | `crates/agent/src/environment/mod.rs` + `deadline.rs` | 200+50 | the guest image declared as data the machine can read; how long a command gets and what a truncated answer looks like | `packages/agent/src/environment.js` | B-LOOP | `agent/src/workspace.js` |
| B32 | `crates/agent/src/skills.rs` + `search.rs` + `now.rs` | 199+100+66 | skills (two pure tools over compiled-in instruction), the search query writer/reader, and the injected context clock | `packages/agent/src/skills.js`, `search.js`, `now.js` | B-LOOP | `agent/src/tools.js` |

---

## C-SPINE — `packages/core` + `packages/adapters-web` (156 Rust files → 57 rows)

### The spine itself

| # | Rust source | lines | what it does | target JS file | lane | depends on |
|---|---|---|---|---|---|---|
| C1 | `crates/module/src/lib.rs` + `manifest.rs` + `error.rs` | 26+121+29 | a module IS a manifest record plus a logic reference — routes, capabilities, schema, tier; deliberately no `trait Module` | `packages/core/src/module/manifest.js` | C-SPINE | `kernel/src/manifest.js` |
| C2 | `crates/module/src/registry.rs` | 198 | the registry as a fold of the append-only log; every version kept, rollback appends | `packages/core/src/module/registry.js` | C-SPINE | `packages/core/src/module/manifest.js` |
| C3 | `crates/core/src/lib.rs` + `app.rs` | 196+196 | the App aggregate and the injected ports bundle the composition root builds once | `packages/core/src/app.js` | C-SPINE | `packages/core/src/module/registry.js`, `agent/src/state.js` |
| C4 | `crates/core/src/ctx.rs` | 136 | what a module's logic is handed — the effective-grant context, one per invocation | `packages/core/src/ctx.js` | C-SPINE | `packages/core/src/app.js` |
| C5 | `crates/core/src/dispatch.rs` | 151 | THE one dispatch point: route → registry → manifest → invoke by tier; no code outside it may call module logic | `packages/core/src/dispatch.js` | C-SPINE | `packages/core/src/ctx.js` |
| C6 | `crates/core/src/builtins.rs` | 177 | the eleven built-in manifests and the `builtin_entry` table they resolve through | `packages/core/src/builtins.js` | C-SPINE | `packages/core/src/dispatch.js` |
| C7 | `crates/core/src/boot.rs` | 189 | migration gate, event replay, built-in registration through the same install path as a forged module | `packages/core/src/boot.js` | C-SPINE | `packages/core/src/builtins.js`, `packages/core/src/log/store.js` |
| C8 | `crates/core/src/error.rs` | 108 | core's typed error wrapping each pure crate's own, no flattening | `packages/core/src/errors.js` | C-SPINE | `kernel/src/errors.js` |
| C9 | `crates/core/src/effects.rs` | 186 | the one place a PORT is called for a model turn — the HOW, not the when | `packages/core/src/effects.js` | C-SPINE | `packages/core/src/app.js`, `context/src/openai.js` |
| C10 | `crates/core/src/runtime/mod.rs` + `runtime/requests.rs` | 132+107 | the effect drive loop (`step` describes, this executes, results return as Events), and the effects a person's click produced | `packages/core/src/runtime.js` | C-SPINE | `packages/core/src/effects.js`, `agent/src/step.js` |
| C11 | `crates/core/src/batch.rs` | 200 | one LINE of tool calls executed together; the layout rule made true | `packages/core/src/batch.js` | C-SPINE | `packages/core/src/runtime.js`, `agent/src/calls.js` |
| C12 | `crates/core/src/tools.rs` | 200 | the tool executor: the sync local table and the `tool_entry` awaiting twin, plus the `/tools` module | `packages/core/src/tools.js` | C-SPINE | `packages/core/src/batch.js`, `agent/src/tools.js` |
| C13 | `crates/core/src/log/store.rs` + `log/mod.rs` | 196+11 | the log's I/O halves — queued ops out, window back at boot | `packages/core/src/log/store.js` | C-SPINE | `kernel/src/ports.js` |
| C14 | `crates/core/src/log/decisions.rs` | 77 | the pure half: what to append, what to keep, what a compaction must leave behind | `packages/core/src/log/decisions.js` | C-SPINE | `agent/src/window.js` |
| C15 | `crates/core/src/log/writership.rs` | 174 | who may WRITE this agent's log when two tabs run the same agent | `packages/core/src/log/writership.js` | C-SPINE | `packages/core/src/log/store.js` |
| C16 | `crates/core/src/faculty/mod.rs` + `faculty/run.rs` | 109+134 | the HOST half of a faculty as a seam: which hosts an app starts with, the refresh walk, and dispatch of one call | `packages/core/src/faculty.js` | C-SPINE | `agent/src/faculty/index.js` |
| C17 | `crates/core/src/memory/mod.rs` + `host.rs` + `sense.rs` | 53+141+55 | memory hosted: the store op behind `keep`/`discard`, and the kept lines read back before every call | `packages/core/src/memory.js` | C-SPINE | `packages/core/src/faculty.js`, `agent/src/memory.js` |
| C18 | `crates/core/src/space/mod.rs` + `shared.rs` + `sense.rs` | 36+188+53 | the shared space's bytes and its three writing tools; the first user of the faculty port | `packages/core/src/space/shared.js` | C-SPINE | `packages/core/src/faculty.js`, `agent/src/space.js` |
| C19 | `crates/core/src/space/artifact/mod.rs` + `host.rs` + `sense.rs` | 74+178+56 | where a space's shelf lives, the one store op per call, and the shelf read back to every agent in the space | `packages/core/src/space/artifacts.js` | C-SPINE | `packages/core/src/space/shared.js`, `agent/src/artifact.js` |
| C20 | `crates/core/src/workspace/mod.rs` + `gate.rs` + `gate/cap.rs` + `gate/edit.rs` + `gate/files.rs` | 9+190+61+154+138 | the single place a command actually runs: capability check, in-flight record, output ceiling, the exactly-once `edit_file` rule, four one-shot tools | `packages/core/src/workspace/gate.js` | C-SPINE | `packages/core/src/tools.js`, `agent/src/workspace.js` |
| C21 | `crates/core/src/workspace/gesture.rs` | 109 | translating a person's press into a command — no second capability path | `packages/core/src/workspace/gesture.js` | C-SPINE | `packages/core/src/workspace/gate.js` |
| C22 | `crates/core/src/proc/mod.rs` + `convention.rs` + `start.rs` + `table.rs` + `watch.rs` | 14+146+118+164+151 | long-running processes: the on-disk convention, the supervisable wrapper, the listing script, read-output and stop | `packages/core/src/proc/tools.js` | C-SPINE | `packages/core/src/workspace/gate.js` |
| C23 | `crates/core/src/observe.rs` | 164 | asking the machine what it is, rather than guessing with commands whose output differs by userland | `packages/core/src/observe.js` | C-SPINE | `packages/core/src/workspace/gate.js` |
| C24 | `crates/core/src/websearch.rs` | 96 | `web_search` run — the single place `NetPort` is called for it | `packages/core/src/websearch.js` | C-SPINE | `packages/core/src/tools.js`, `agent/src/search.js` |
| C25 | `crates/core/src/words.rs` | 118 | the sentence fragments every pane shares — a run of names, a length of time; spelling, not opinion | `packages/core/src/words.js` | C-SPINE | — |

### View projections (11 built-in modules, 23 routes)

| # | Rust source | lines | what it does | target JS file | lane | depends on |
|---|---|---|---|---|---|---|
| C26 | `crates/core/src/chat/pane.rs` + `mod.rs` + `clear.rs` | 181+18+106 | the chat module: `GET /chat`, `POST /chat`, `/chat/stop`, `/chat/halt`, `/chat/clear` (drop the archive, two-click arm) | `packages/core/src/views/chat/routes.js` | C-SPINE | `packages/core/src/dispatch.js` |
| C27 | `crates/core/src/chat/transcript.rs` + `transcript/headers.rs` + `noted.rs` + `spoken.rs` | 146+57+75+103 | one agent's conversation folded out of the log, scoped so nothing else is projected: what was said, what the machine wrote about it, what the pane learns without parsing | `packages/core/src/views/chat/transcript.js` | C-SPINE | `packages/core/src/views/chat/routes.js` |
| C28 | `crates/core/src/chat/fold.rs` + `heading.rs` | 199+88 | which facts a conversation is made of and what the log says about itself; who you are talking to and what their space granted | `packages/core/src/views/chat/fold.js` | C-SPINE | `packages/core/src/views/chat/transcript.js` |
| C29 | `crates/core/src/chat/markdown.rs` | 197 | the small markdown subset a reply may carry | `packages/core/src/views/chat/markdown.js` | C-SPINE | — |
| C30 | `crates/core/src/chat/memory_line.rs` + `steer_notice.rs` + `call_announcement.rs` | 183+82+196 | what the agent still HOLDS after a compaction; which messages were steers; one announcement per run of tool calls | `packages/core/src/views/chat/notices.js` | C-SPINE | `packages/core/src/views/chat/fold.js`, `packages/core/src/words.js` |
| C31 | `crates/core/src/board/pane.rs` + `mod.rs` | 167+18 | the status board module: `GET /board`, `GET /tiles` | `packages/core/src/views/board/routes.js` | C-SPINE | `packages/core/src/dispatch.js` |
| C32 | `crates/core/src/board/row.rs` + `row/live.rs` + `row/reading.rs` + `stage.rs` + `flow.rs` | 95+77+181+127+90 | one card per agent: status word, the sentence under the name, what is happening inside the turn right now, which part of the turn, and which loop it is running | `packages/core/src/views/board/row.js` | C-SPINE | `packages/core/src/views/board/routes.js`, `agent/src/supervisor.js` |
| C33 | `crates/core/src/board/tiles.rs` + `offer.rs` + `errand.rs` | 197+72+104 | four at-a-glance fleet facts; what you can DO with an agent before any run of it; the goal it was given and what it answered | `packages/core/src/views/board/tiles.js` | C-SPINE | `packages/core/src/views/board/row.js` |
| C34 | `crates/core/src/agents/pane.rs` + `mod.rs` + `authored.rs` | 89+18+89 | the agents module (`GET /agents`) and the fold of which agents THIS browser holds | `packages/core/src/views/agents/routes.js` | C-SPINE | `packages/core/src/dispatch.js` |
| C35 | `crates/core/src/agents/install.rs` + `briefs.rs` | 200+45 | putting an agent onto the running app (agents are DATA), and installing every stage brief | `packages/core/src/views/agents/install.js` | C-SPINE | `agent/src/spec/index.js`, `agent/src/brief.js` |
| C36 | `crates/core/src/agents/roster.rs` + `authoring.rs` | 156+200 | making the running app agree with the authored set; the three routes (`/agents`, `/agents/file`, `/agents/delete`) and the `write_agent` tool | `packages/core/src/views/agents/roster.js` | C-SPINE | `packages/core/src/views/agents/install.js`, `agent/src/author.js` |
| C37 | `crates/core/src/agents/card.rs` + `card_sentences.rs` | 199+199 | one agent as a card, and every sentence it prints: provenance, real toolbox, names that resolved to nothing, who reviews it | `packages/core/src/views/agents/card.js` | C-SPINE | `packages/core/src/views/agents/routes.js`, `agent/src/toolbox.js` |
| C38 | `crates/core/src/files/pane.rs` + `mod.rs` | 166+14 | the files module: `GET /files`, `POST /files` — no capability of its own, the listing is `list_files` going through the gate | `packages/core/src/views/files/routes.js` | C-SPINE | `packages/core/src/workspace/gate.js` |
| C39 | `crates/core/src/files/listing.rs` + `rows.rs` + `find.rs` | 195+70+87 | the newest folder listing folded out of `ToolInvoked`, one line per entry, and `find_files` with its one script | `packages/core/src/views/files/listing.js` | C-SPINE | `packages/core/src/views/files/routes.js` |
| C40 | `crates/core/src/files/empty_states.rs` + `permitted.rs` | 190+143 | the four states a folder can be in and what an empty one says; whether this pane may show a folder at all | `packages/core/src/views/files/states.js` | C-SPINE | `packages/core/src/views/files/listing.js` |
| C41 | `crates/core/src/terminal/pane.rs` + `mod.rs` | 174+13 | the terminal module: `GET /terminal`, `POST /terminal`, `POST /terminal/stop` | `packages/core/src/views/terminal/routes.js` | C-SPINE | `packages/core/src/workspace/gesture.js` |
| C42 | `crates/core/src/terminal/panel.rs` + `row_selection.rs` | 166+156 | the scroller and what it says before anything happens; WHICH commands the scrollback shows and whose they are | `packages/core/src/views/terminal/panel.js` | C-SPINE | `packages/core/src/views/terminal/routes.js` |
| C43 | `crates/core/src/terminal/row.rs` + `footnote.rs` | 179+92 | one finished command, one still running, and the note saying whose folder they ran in | `packages/core/src/views/terminal/row.js` | C-SPINE | `packages/core/src/views/terminal/panel.js` |
| C44 | `crates/core/src/trace/pane.rs` + `mod.rs` | 156+16 | the tool trace: which calls it holds and in what order | `packages/core/src/views/trace/routes.js` | C-SPINE | `packages/core/src/dispatch.js` |
| C45 | `crates/core/src/trace/row.rs` + `row/args.rs` | 139+81 | one row — time, outcome word, output block — and what the call was ASKED to do | `packages/core/src/views/trace/row.js` | C-SPINE | `packages/core/src/views/trace/routes.js` |
| C46 | `crates/core/src/trace/requested_by.rs` + `row_location.rs` | 195+75 | who asked for a call (page, agent, sub-agent); which view a call's row is in | `packages/core/src/views/trace/attribution.js` | C-SPINE | `packages/core/src/views/trace/row.js` |
| C47 | `crates/core/src/trace/inflight.rs` + `from_worker.rs` | 150+115 | what the workspace is doing RIGHT NOW (a call is a fact only when it comes back); a sub-agent's trace and the clock its rows read | `packages/core/src/views/trace/inflight.js` | C-SPINE | `packages/core/src/views/trace/row.js` |
| C48 | `crates/core/src/trace/trustworthy.rs` | 200 | what a row may vouch for — the rule that stops the trace asserting a result it did not observe | `packages/core/src/views/trace/trustworthy.js` | C-SPINE | `packages/core/src/views/trace/row.js` |
| C49 | `crates/core/src/debug/pane.rs` + `mod.rs` | 68+36 | the debug module (`GET /debug`) — five already-emitted facts that had zero readers | `packages/core/src/views/debug/routes.js` | C-SPINE | `packages/core/src/dispatch.js` |
| C50 | `crates/core/src/debug/turns.rs` + `projected.rs` | 183+132 | what ONE turn did, folded out of the log, and the fold's own tests | `packages/core/src/views/debug/turns.js` | C-SPINE | `packages/core/src/views/debug/routes.js` |
| C51 | `crates/core/src/debug/render.rs` + `round.rs` + `route.rs` + `spine.rs` + `store.rs` | 113+118+130+105+52 | the projection organised by QUESTION: one round with its cost and Document, the route the strategy voted, the three spine lines, the writes that failed | `packages/core/src/views/debug/render.js` | C-SPINE | `packages/core/src/views/debug/turns.js` |
| C52 | `crates/core/src/space/pane.rs` | 188 | the space inspector: folder path, settled facts, noticeboard (`GET /space`) | `packages/core/src/views/space.js` | C-SPINE | `packages/core/src/space/shared.js` |
| C53 | `crates/core/src/proc/pane.rs` + `rows.rs` | 111+173 | what is running, on screen: `GET /processes`, `POST /processes`, and the newest listing as rows | `packages/core/src/views/processes.js` | C-SPINE | `packages/core/src/proc/tools.js` |
| C54 | `crates/core/src/failure/ending.rs` + `ending_kind.rs` + `mod.rs` | 198+156+25 | ONE fold deciding how the last turn ended, and the vocabulary it reaches for — three surfaces, one answer | `packages/core/src/views/failure/ending.js` | C-SPINE | `agent/src/ending.js` |
| C55 | `crates/core/src/failure/card.rs` + `what_to_do.rs` + `local_network.rs` | 176+189+48 | the disclosure a failure is shown in, the actionable sentence chosen for it, and what a local address costs a page that is not local | `packages/core/src/views/failure/card.js` | C-SPINE | `packages/core/src/views/failure/ending.js` |
| C56 | `crates/core/src/failure/within_turn.rs` + `dedupe.rs` | 200+105 | what went wrong INSIDE a turn that ended well; which failures count as the same one | `packages/core/src/views/failure/within_turn.js` | C-SPINE | `packages/core/src/views/failure/card.js` |
| C57 | `crates/core/src/failure/from_worker.rs` + `stopped_notice.rs` + `second_tab.rs` + `loop_note.rs` | 179+82+49+103 | a failure that happened somewhere else; what a stopped run leaves behind; what a second tab is told; the notices the loop itself puts on screen | `packages/core/src/views/failure/notices.js` | C-SPINE | `packages/core/src/views/failure/card.js`, `packages/core/src/log/writership.js` |

### `packages/adapters-web`

| # | Rust source | lines | what it does | target JS file | lane | depends on |
|---|---|---|---|---|---|---|
| C58 | `crates/adapters_web/src/idb.rs` + `idb/kv.rs` | 153+97 | `StorePort` over IndexedDB, hand-rolled; `replace_prefix` swaps a whole prefix in ONE transaction | `packages/adapters-web/src/idb.js` | C-SPINE | `kernel/src/ports.js` |
| C59 | `crates/adapters_web/src/ports.rs` | 185 | the four small ports: brokered net (allowlist and nothing else reachable), clock, RNG, timer | `packages/adapters-web/src/ports.js` | C-SPINE | `kernel/src/ports.js` |
| C60 | `crates/adapters_web/src/wire.rs` | 156 | fetch off whatever global we are in; the body's model field read/written; status → typed error; exception → one readable sentence | `packages/adapters-web/src/wire.js` | C-SPINE | `packages/adapters-web/src/ports.js` |
| C61 | `crates/adapters_web/src/model.rs` + `model/choice.rs` | 152+125 | `ModelPort` over fetch and the ADR-006 credential broker — the ONE file that knows a base URL and attaches a key | `packages/adapters-web/src/model.js` | C-SPINE | `packages/adapters-web/src/wire.js` |
| C62 | `crates/adapters_web/src/catalogue.rs` | 189 | `public/models.json` read as data, keyed by name — no provider table | `packages/adapters-web/src/catalogue.js` | C-SPINE | `packages/adapters-web/src/model.js` |
| C63 | `crates/adapters_web/src/endpoint.rs` + `endpoint/overrides.rs` + `endpoint/profile.rs` | 199+44+58 | the user's layer over the catalogue: selection, per-entry overrides merged entry-by-entry, one API key per entry, and every migration of the stored record | `packages/adapters-web/src/endpoint/*.js` | C-SPINE | `packages/adapters-web/src/catalogue.js` |
| C64 | `crates/adapters_web/src/ondevice.rs` + `ondevice/pure.rs` | 166+148 | Chrome's Prompt API as one more catalogue entry behind the same port; the pure request/reply halves | `packages/adapters-web/src/ondevice.js` | C-SPINE | `packages/adapters-web/src/model.js` |
| C65 | `crates/adapters_web/src/settings.rs` | 111 | Settings' door to the broker — deliberately NOT on the seam, because the seam logs every request | `packages/adapters-web/src/settings.js` | C-SPINE | `packages/adapters-web/src/endpoint/index.js` |
| C66 | `crates/adapters_web/src/assets.rs` | 93 | same-origin static assets: the `public/agents/` tree and `public/stages/` briefs, fetched at boot | `packages/adapters-web/src/assets.js` | C-SPINE | `packages/adapters-web/src/wire.js` |
| C67 | `crates/adapters_web/src/c2w.rs` | 200 | `WorkspacePort` over container2wasm — the only Linux, served from our own origin | `packages/adapters-web/src/c2w.js` | C-SPINE | `kernel/src/ports.js` |
| C68 | `crates/adapters_web/src/locks/mod.rs` + `locks/awake.rs` | 144+99 | who may write this agent's log (`navigator.locks`), and the lock held from boot that exists only to be waited on | `packages/adapters-web/src/locks.js` | C-SPINE | `packages/core/src/log/writership.js` |
| C69 | `crates/adapters_web/src/workers.rs` + `workers/spawn/mod.rs` | 197+76 | the `AgentPort`: one Worker per loaded agent, spawned at boot, handed a goal by `postMessage` | `packages/adapters-web/src/workers/index.js` | C-SPINE | `packages/adapters-web/src/ports.js` |
| C70 | `crates/adapters_web/src/workers/spawn/reply/mod.rs` + `turn.rs` + `channels.rs` | 151+161+76 | what a Worker says back: the running handle, the one-turn-in-flight slot, the ways a turn ends without an answer, the three side channels | `packages/adapters-web/src/workers/reply.js` | C-SPINE | `packages/adapters-web/src/workers/index.js` |
| C71 | `crates/adapters_web/src/worker/mod.rs` + `worker/world.rs` | 153+78 | the inside of one Worker: its own core instance, and the exact ports/capabilities a sub-agent's world grants | `packages/adapters-web/src/worker/entry.js` | C-SPINE | `packages/adapters-web/src/workers/index.js`, `packages/core/src/app.js` |
| C72 | `crates/adapters_web/src/roster.rs` | 78 | keeping the Workers level with the roster — an authored agent gets a Worker with no reload | `packages/adapters-web/src/roster.js` | C-SPINE | `packages/adapters-web/src/workers/index.js` |
| C73 | `crates/adapters_web/src/lib.rs` + `bringup.rs` | 145+83 | the composition root: build the real ports, boot `core`, and the three multi-step preparations before the page can take a turn | `packages/adapters-web/src/index.js` | C-SPINE | every C58–C72 row |
| C74 | `crates/adapters_web/src/leftovers.rs` | 165 | what a deleted engine left in a returning visitor's origin, and the one place it is cleared | `packages/adapters-web/src/leftovers.js` | C-SPINE | `packages/adapters-web/src/idb.js` |

---

## D-FACE — `apps/web` (95 Rust files + 17 stylesheets → 34 rows)

| # | Rust source | lines | what it does | target JS file | lane | depends on |
|---|---|---|---|---|---|---|
| D1 | `crates/ui/src/main.rs` | 173 | the app root: builds the app handle, mounts the shell, every handler calls the seam | `apps/web/app/layout.jsx` + `providers/AppProvider.jsx` | D-FACE | `packages/adapters-web/src/index.js` |
| D2 | `crates/ui/src/shell/views.rs` + `views/nav.rs` + `views/misroute.rs` + `mod.rs` | 169+52+118+28 | THREE destinations (Work / Agents / Setup) plus `DesignSystem`; slug↔view both ways so every URL this product ever shipped resolves; an address naming no view says so | `apps/web/lib/views.js`, `components/shell/Nav.jsx` | D-FACE | — |
| D3 | `crates/ui/src/shell/route.rs` | 196 | the location hash IS the view, and WHO it is about (`#/work/researcher`); plus where the eye lands on arrival | `apps/web/lib/route.js` | D-FACE | `apps/web/lib/views.js` |
| D4 | `crates/ui/src/shell/dash.rs` + `boot_reads.rs` | 173+63 | the two panel switches, the viewport/keyboard responses, the first trip through the seam and the re-read after every change | `apps/web/components/shell/Shell.jsx` | D-FACE | `apps/web/lib/route.js` |
| D5 | `crates/ui/src/shell/statusbar.rs` + `status_pills.rs` + `token_meter.rs` | 170+199+72 | the header's strip of facts: the last turn that failed, whether anything is running, what this page has spent | `apps/web/components/shell/StatusBar.jsx` | D-FACE | `packages/core/src/views/board/tiles.js` |
| D6 | `crates/ui/src/shell/heartbeat.rs` + `warmth.rs` | 81+119 | one poll from the shell for the life of the page and the four header facts it carries; is the Linux ready, and for whom | `apps/web/components/shell/Heartbeat.jsx` | D-FACE | `apps/web/components/shell/Shell.jsx` |
| D7 | `crates/ui/src/shell/skin.rs` + `theme.rs` | 112+111 | the background switch and the four directions — which one this device draws | `apps/web/components/shell/Theme.jsx` | D-FACE | `apps/web/styles/theme-*.css` |
| D8 | `crates/ui/src/shell/rail.rs` | 135 | the instruments column, per view — what else you need while doing this | `apps/web/components/shell/Rail.jsx` | D-FACE | `apps/web/components/shell/Shell.jsx` |
| D9 | `crates/ui/src/centre/mod.rs` + `panels.rs` + `work.rs` + `shape.rs` + `plate.rs` | 186+161+66+95+43 | the centre column routed by view: WATCH (the whole run in one scroller) and SHAPE (where you change what the system is), each panel with its own id and accessible name | `apps/web/components/centre/*.jsx` | D-FACE | `apps/web/components/shell/Shell.jsx` |
| D10 | `crates/ui/src/chat/mod.rs` + `header.rs` | 145+81 | one agent's conversation — owns the draft and nothing else; what it is called and the control that ends it | `apps/web/components/chat/ChatPane.jsx` | D-FACE | `packages/core/src/views/chat/routes.js` |
| D11 | `crates/ui/src/chat/log.rs` + `thread.rs` | 148+155 | the scrolling log inside the card; every loaded agent's conversation on one view with the routed one open | `apps/web/components/chat/ChatLog.jsx`, `ThreadList.jsx` | D-FACE | `apps/web/components/chat/ChatPane.jsx` |
| D12 | `crates/ui/src/chat/state.rs` + `poller.rs` + `inflight_row.rs` | 106+121+200 | one turn in flight: what the pane shows, the poller that follows it to its end and its patience, the waiting row and the press that ends it | `apps/web/components/chat/useTurn.js` | D-FACE | `apps/web/components/chat/ChatPane.jsx` |
| D13 | `crates/ui/src/chat/retry_actions.rs` | 181 | the way OUT of a failed turn and the way IN to an empty one | `apps/web/components/chat/RetryActions.jsx` | D-FACE | `packages/core/src/views/failure/card.js` |
| D14 | `crates/ui/src/composer/mod.rs` | 174 | the one control that starts a turn | `apps/web/components/composer/Composer.jsx` | D-FACE | `apps/web/components/chat/ChatPane.jsx` |
| D15 | `crates/ui/src/composer/voice.rs` + `voice/mic.rs` + `voice/speaker.rs` | 172+82+181 | the only place a browser speech API is touched: dictation in, reading out | `apps/web/components/composer/voice/*.js` | D-FACE | `apps/web/components/composer/Composer.jsx` |
| D16 | `crates/ui/src/board/mod.rs` + `roster.rs` + `tiles.rs` | 197+130+53 | the status of every agent; who is loaded and where from; the at-a-glance strip | `apps/web/components/board/*.jsx` | D-FACE | `packages/core/src/views/board/routes.js` |
| D17 | `crates/ui/src/board/launch.rs` + `launch/form.rs` + `outcome.rs` + `receipt.rs` + `notes.rs` | 160+135+153+58+54 | hand an agent a task and walk away: the product's primary input, the one dispatching press, what happened to what you launched, and the receipt DERIVED rather than remembered | `apps/web/components/board/launch/*.jsx` | D-FACE | `apps/web/components/board/Board.jsx` |
| D18 | `crates/ui/src/board/examples.rs` | 200 | starter tasks as a property of what the agent can actually do | `apps/web/components/board/Examples.jsx` | D-FACE | `packages/core/src/views/board/tiles.js` |
| D19 | `crates/ui/src/authoring/mod.rs` + `agentfile.rs` + `controls.rs` + `notices.rs` + `key_help.rs` | 158+165+121+116+120 | writing an agent in the browser: the textarea, read/download/POST across the seam, save-take-delete with their three different costs, what the form says about itself, and what each frontmatter key means | `apps/web/components/authoring/*.jsx` | D-FACE | `packages/core/src/views/agents/roster.js` |
| D20 | `crates/ui/src/files/mod.rs` + `breadcrumbs.rs` + `rows.rs` | 137+88+66 | the workspace folder browsable — no capability of its own; where you are, and what is here | `apps/web/components/files/Files.jsx` | D-FACE | `packages/core/src/views/files/routes.js` |
| D21 | `crates/ui/src/files/listing.rs` + `openfile.rs` + `editor.rs` | 188+119+75 | one read of the `/files` projection; the open file; what is on disk vs what you typed over it, and the save | `apps/web/components/files/Editor.jsx` | D-FACE | `apps/web/components/files/Files.jsx` |
| D22 | `crates/ui/src/files/artifacts.rs` + `artifacts/shelf.rs` | 145+135 | what the agent MADE, beside the folder it made it in; what a finished file is and what to say when there are none | `apps/web/components/files/Shelf.jsx` | D-FACE | `packages/core/src/space/artifacts.js` |
| D23 | `crates/ui/src/terminal/mod.rs` + `stop.rs` + `attribution.rs` | 200+59+74 | the Alpine workspace: the command you are typing, the way out of one that will not end, and the engine credit | `apps/web/components/terminal/Terminal.jsx` | D-FACE | `packages/core/src/views/terminal/routes.js` |
| D24 | `crates/ui/src/trace/mod.rs` + `omitted.rs` | 166+102 | calls, args, results and errors; and the three things under the list that are about rows NOT in it | `apps/web/components/trace/Trace.jsx` | D-FACE | `packages/core/src/views/trace/routes.js` |
| D25 | `crates/ui/src/proc/mod.rs` + `row.rs` | 187+116 | what the agent has left running; one process with its log and a way to stop it | `apps/web/components/proc/Processes.jsx` | D-FACE | `packages/core/src/views/processes.js` |
| D26 | `crates/ui/src/debug/mod.rs` + `frame.rs` + `read.rs` | 89+75+47 | the Debug pane: the fetch, the three things it says in its own voice, and one read of the projection | `apps/web/components/debug/Debug.jsx` | D-FACE | `packages/core/src/views/debug/routes.js` |
| D27 | `crates/ui/src/space/mod.rs` + `empty_states.rs` | 130+117 | facts, notes and the workspace path; what the card says when there is nothing in it | `apps/web/components/space/Space.jsx` | D-FACE | `packages/core/src/views/space.js` |
| D28 | `crates/ui/src/settings/mod.rs` + `view.rs` + `endpoint.rs` | 197+170+124 | endpoints and keys, written to the broker and NOT through the seam; the markup and none of the decisions; the one header sentence saying what the next turn calls | `apps/web/components/settings/Settings.jsx` | D-FACE | `packages/adapters-web/src/settings.js` |
| D29 | `crates/ui/src/settings/endpoint_copy.rs` + `/ondevice.rs` + `/reset.rs` + `/search.rs` + `/trust.rs` | 173+72+55+122+47 | everything Settings SAYS: whether the address works, what a save did, why a base URL was refused, the built-in model, where a web search goes, the trust model stated where keys are entered, and the one control that destroys something | `apps/web/components/settings/copy/*.jsx` | D-FACE | `apps/web/components/settings/Settings.jsx` |
| D30 | `crates/ui/src/settings/linux_engine.rs` | 130 | which Linux this page runs — a statement, not a setting | `apps/web/components/settings/LinuxEngine.jsx` | D-FACE | `packages/adapters-web/src/leftovers.js` |
| D31 | `crates/ui/src/flow/mod.rs` + `rail.rs` + `read.rs` | 54+199+185 | which loop this turn is running and how far through it is — one component on every surface that shows an agent; a `Flow` in, markup out, no seam call | `apps/web/components/flow/FlowRail.jsx` | D-FACE | `packages/core/src/views/board/row.js` |
| D32 | `crates/ui/src/ui/mod.rs` + `button/field/select/form/card/badge/disclose/empty/skeleton.rs` | 197+67+67+28+35+40+25+32+47+33 | the component library: one implementation each, every variant and state the stylesheet paints; `StatusDot` is a dot AND a label, `Form` never forgets `preventDefault` | `apps/web/components/ui/*.jsx` | D-FACE | `apps/web/styles/controls.css` |
| D33 | `crates/ui/src/gallery/mod.rs` + `controls.rs` + `surfaces.rs` | 92+125+133 | `/design-system` — every component in every variant and state over the real ground | `apps/web/app/design-system/page.jsx` | D-FACE | `apps/web/components/ui/index.js` |
| D34 | `web/tokens.css` + `base.css` + `layout.css` + `surfaces.css` + `chrome.css` + `controls.css` + `editorial.css` + `strip.css` + `flow.css` + `mission.css` + `ade.css` + `workspace.css` + `glass.css` + `theme-atelier/console/gallery/halo.css` | 2829 total | the whole design system: tokens, reset, grid, surfaces, chrome, controls, editorial type, the strip, the flow rail, the mission band, ADE layout, workspace, glass, and the four themes | `apps/web/styles/*.css` | D-FACE | — |

---

## Ordering within each lane

### A-PAPER (7 increments)

1. **Shapes.** A1, A2, A5. *Done when* `types.js` round-trips a Document through `JSON.stringify`/`parse` unchanged and `Slot` sorted ascending puts `soul` first and `response_contract` last.
2. **The contract.** A3, A4. *Done when* a component with id `x` and intent `y` renders exactly `## x (y)\n<body>` and an empty body elides the whole block.
3. **Assembly.** A6, A11. *Done when* the same state+phase+budget assembles byte-identical documents twice and `law.js` passes every rule on the result.
4. **The budget.** A7. *Done when* a document over budget loses binary parts first, then walks the lowest-priority sections Full→Summarized→Pointer→Elided until the arithmetic closes, and reports which ids it ELIDED.
5. **The wire.** A8, A9, A10. *Done when* the golden fixture (ported from `crates/context/tests/paper.rs`, 368 lines) renders to the identical OpenAI request body the Rust test asserts, and the hash matches.
6. **The blocks.** A13–A17, A19. *Done when* a full prompt assembles with soul/history/world/affordances/directive/goal in slot order and the golden text matches.
7. **The generic block and the args reader.** A20, A21, A12, A18. *Done when* a host-supplied `Sensed` block renders identically to the space/memory/artifacts blocks it replaced, and `args.js` extracts one named field from malformed model JSON without throwing.

### B-LOOP (8 increments)

1. **Data and vocabulary.** B1, B2, B6. *Done when* a fresh `AgentState` serializes, restores, and the single `Work` phase config resolves by id.
2. **The agent file.** B3, B4, B5. *Done when* every fixture in `crates/agent/tests/frontmatter.rs` (172 lines) and `spec.rs` (257) parses to the same spec, each refusal names the same key, and `author.js` round-trips spec→markdown→spec.
3. **Tools and parsing.** B7, B8, B9, B10, B30, B32. *Done when* two calls on one line parse into one batch, a newline starts a second, and a tool outside the granted scope is refused with the message from `toolbox.js`.
4. **One step.** B11, B12, B13, B21. *Done when* `step(state, event)` returns effects only — asserting zero I/O — and every arm of `crates/agent/tests/stated.rs` (401 lines) passes.
5. **The loop.** B14, B15, B16, B17. *Done when* a message routes to a stage list by vote, the turn walks it, and a second pass runs without a person typing anything.
6. **The gates.** B18, B19, B20, B22. *Done when* a goal with an unmet `done_when` continues the turn, a turn that wrote a file and ran nothing gets the nudge, and a stop mid-turn ends it with `STOPPED` rather than an answer.
7. **Faculties.** B26, B27, B28, B29. *Done when* an agent file naming `memory` gets exactly the `keep`/`discard` tools and a `## memory` block, and one naming nothing gets neither.
8. **The rest of the loop's furniture.** B23, B24, B25, B31. *Done when* a history at `compact_at` produces a summarization effect, the supervisor table shows one row per loaded agent, and a sub-agent call resolves to a narrowed toolbox.

### C-SPINE (9 increments)

1. **Registry and dispatch.** C1, C2, C3, C4, C5, C8. *Done when* installing a manifest appends `ModuleInstalled`, `dispatch` resolves a route to its handler, and an unregistered id 404s.
2. **Boot and the log.** C6, C7, C13, C14, C15. *Done when* an event log persisted to a fake store replays to an identical App, and a record it cannot parse REFUSES boot loudly rather than dropping it.
3. **The drive loop.** C9, C10, C11, C12, C25. *Done when* a user message drives step→effect→port→event to a recorded `ModelReplied` against `adapters-test`.
4. **Chat, the first view.** C26–C30. *Done when* `GET /chat?agent=main` projects only `main`'s messages and a second agent's turn never appears in it.
5. **Ports over the browser.** C58–C63, C66. *Done when* a real IndexedDB round-trips a prefix replace in one transaction and a model call reaches a local server with the key attached and never logged.
6. **Workspace and the tools that act.** C20, C21, C22, C23, C24, C67. *Done when* `exec` runs in the guest, `edit_file` refuses text appearing twice, and a started process appears in the listing.
7. **Faculties hosted, spaces, artifacts.** C16, C17, C18, C19, C52. *Done when* agent A records an artifact and agent B's next assembled prompt carries its name and description.
8. **The remaining views.** C31–C51, C53–C57. *Done when* all 23 routes answer with structured data, and the failure fold gives ONE ending for a turn across board, chat and header.
9. **Workers and the composition root.** C64, C65, C68–C74. *Done when* two Workers run on one page, only one holds the write lock for a given agent, and a Worker's failed turn surfaces in the page's log.

### D-FACE (7 increments)

1. **Shell and routing.** D1, D2, D3, D4. *Done when* `#/work/researcher` renders the Work view with `researcher` selected, Back returns to the previous view, and `#/wharrgarbl` renders the misroute note.
2. **The component library and the stylesheets.** D32, D34, D33. *Done when* `/design-system` renders every variant and state, and the same page passes in all four themes plus light/dark.
3. **The run.** D9, D10, D11, D12, D14. *Done when* typing a sentence and pressing send shows an in-flight row, then the reply, without a reload.
4. **The rest of the run surface.** D23, D24, D20, D21, D31. *Done when* a turn that runs a command shows the command in the terminal, the call in the trace, the file in the folder, and the stage on the flow rail — in one scroller.
5. **Chrome and state.** D5, D6, D7, D8. *Done when* the header shows spend, running count and last failure, and the Linux pill flips to ready.
6. **Launch and agents.** D16, D17, D18, D19. *Done when* a task typed into the launcher dispatches an agent and the receipt is derived from the log rather than remembered.
7. **The remaining panes.** D13, D15, D22, D25, D26, D27, D28, D29, D30. *Done when* Setup saves an endpoint and key, the composer dictates, and every pane's empty state says what would fill it.

---

## Cross-lane contracts

Freeze these before the consuming lane starts. Signatures only — implementations are the lane's business.

> **CORRECTION (lead, 2026-08-25).** This section was drafted before the seam
> was frozen and restated the RUST shapes. `docs/SEAM.md` and
> `packages/kernel/src/` are the authority; where they disagree with anything
> below, they win. The kernel shapes as they actually are:

```js
// ── packages/kernel — FROZEN. Read the source, not this restatement. ──

/**
 * @typedef {{method: string, path: string, headers: Record<string,string>, body: Record<string,string>}} Request
 * @typedef {{status: number, view: string, data: Record<string,unknown>}} Response
 * @typedef {{id: number, seq: number, at: number, v: number, fact: Fact}} Event
 * @typedef {{type: string} & Record<string, unknown>} Fact  // 11 closed variants
 */
```

Three differences from the Rust, all deliberate: a response carries a NAMED
PROJECTION rather than an HTML body; a request's body is named fields rather
than a form-encoded string, so nothing needs escaping on the way in; and an
event carries an envelope version `v` beside a NESTED `fact`, so a new payload
key cannot collide with envelope metadata (I18). Eleven fact types, not twelve:
`module_deactivated` and `module_reactivated` were measured dead and one
survives as `module_removed`.

```js
// ── A-PAPER publishes BEFORE B-LOOP increment 4 ──

/**
 * Decide WHAT the paper says. Pure and total: same inputs ⇒ byte-identical output.
 * @param {ContextState} state
 * @param {Budget} budget
 * @returns {Document}
 */
export function assemble(state, budget) {}

/**
 * Decide HOW this provider hears it. Pure.
 * @param {Document} doc
 * @param {'openai'|'prose'|'fragments'} target
 * @param {{vision: boolean, audio: boolean}} caps
 * @returns {{messages: Array<{role: string, content: unknown}>}}
 */
export function render(doc, target, caps) {}

/**
 * @param {Document} doc
 * @returns {string}  content address; the `document_hash` on EventKind ModelCalled
 */
export function hash(doc) {}

/**
 * The ONE reader for JSON a model wrote. Never throws.
 * @param {string} raw
 * @param {string} name
 * @returns {string|undefined}
 */
export function arg(raw, name) {}

/**
 * A component. Every prompt block implements exactly this.
 * @typedef {{
 *   id: string,
 *   intent: string,
 *   slot: number,          // Slot ordinal; ascending IS prompt order
 *   stability: 'stable'|'warm'|'volatile',
 *   render: () => string,  // body only; the `## id (intent)` frame is inherited
 * }} Component
 */
```

```js
// ── B-LOOP publishes BEFORE C-SPINE increment 3 ──

/**
 * The pure step function. MUST NOT perform I/O.
 * @param {AgentState} state
 * @param {EventKind} event
 * @returns {{state: AgentState, effects: Effect[]}}
 */
export function step(state, event) {}

/**
 * @typedef {{type: 'CallModel', document: Document, budget: Budget}
 *          |{type: 'InvokeTool', tool: string, args: string}
 *          |{type: 'InvokeAgent', agent: string, goal: string}
 *          |{type: 'Store', key: string, value: string}
 *          |{type: 'Emit', kind: EventKind}} Effect
 */

/** @returns {Toolbox} every tool descriptor this build ships (26 today). */
export function builtinTools() {}

/**
 * @param {string} markdown  the contents of one agent.md
 * @returns {{ok: true, spec: AgentSpec} | {ok: false, error: AgentError}}
 */
export function parseAgentFile(markdown) {}

/**
 * @param {string} replyText
 * @returns {{kind: 'answer', text: string} | {kind: 'calls', batches: ToolCall[][]}}
 */
export function parseReply(replyText) {}
```

```js
// ── C-SPINE publishes BEFORE D-FACE increment 1 ──

/**
 * THE SEAM (I4). Every UI interaction goes through this and nothing else.
 * SYNCHRONOUS, and that is the design: a request either projects what the log
 * already holds, or RECORDS a fact and returns the projection that fact
 * produced. Work that takes time is queued as an effect and run by the driver,
 * so the interface can never hang on a model call.
 * @param {App} app
 * @param {Request} req
 * @returns {Response}
 */
export function handle(app, req) {}

/**
 * @param {Ports} ports
 * @returns {Promise<App>}  registry populated, log replayed, agents installed
 */
export async function boot(ports) {}

/**
 * Every projection has this shape: a NAMED view and its data.
 * @typedef {{status: number, view: string, data: Record<string,unknown>}} Response
 */

/** The routes the interface may call. THE FROZEN LIST IS docs/SEAM.md. */
```

```js
// ── C-SPINE (adapters-web) publishes BEFORE D-FACE increment 5 ──

/**
 * Settings' door to the credential broker. Deliberately NOT on the seam:
 * `handle` records an Event for every request and a key must never be in the log.
 * @param {string} entryId
 * @param {{baseUrl?: string, model?: string, apiKey?: string}} patch
 * @returns {Promise<void>}
 */
export async function saveEndpoint(entryId, patch) {}

/** @returns {Promise<{selected: string, entries: CatalogueEntry[], hasKey: Object<string,boolean>}>} */
export async function readEndpoints() {}
```

---

## Files that should NOT be ported

**Consequences of Rust, Dioxus or Wasm**

| Rust module | lines | why it dies |
|---|---|---|
| `crates/module/src/view.rs` | 137 | `Fragment`/`FragmentBuilder` exist so a Rust module cannot put unescaped text into HTML; React escapes children by construction and projections return data, so the whole escaping surface has no JS counterpart |
| `crates/ui/src/board/read_attrs.rs` | 114 | reads one-bit facts back off rendered HTML attributes — it exists only because the seam returned a fragment instead of a value |
| `crates/ui/src/posture/mod.rs` + `posture/css.rs` | 160+87 | a CSS parser compiled into the binary because `crates/ui` is bin-only and has no other way to assert on a stylesheet; in JS the same assertion is a test script reading the file |
| `crates/adapters_web/src/error.rs` | 18 | translates `JsValue`/DOM exceptions into typed Rust port errors — the boundary it spans does not exist in JS |
| `crates/adapters_web/src/idb/bridge.rs` | 54 | `IDBRequest` → `Future` plumbing; in JS this is a five-line promisify, not a module |
| `crates/adapters_web/src/seam.rs` | 61 | "the seam as a Rust caller sees it, with no JSON hop" — a `ui`→`core` call that exists to avoid a Wasm boundary; in JS it is a plain import |
| `crates/adapters_web/src/workers/spawn/mod.rs` (bundle-discovery half, ~40 of 76) | 76 | finding this build's wasm-bindgen bundle path so a Worker can boot it; a JS Worker takes a module URL |
| `crates/ui/src/ui/form.rs` | 35 | exists because Dioxus drops form submitters and every hand-rolled `<form>` forgot `prevent_default`; keep the rule, not the component |

**Dead code TODAY (measured, not quoted)**

| Thing | where | measurement |
|---|---|---|
| `module::affordance::affordances` | `crates/module/src/affordance.rs:16` | body is `todo!("G4")`; `rg 'affordances'` finds the definition and the `pub use` re-export and no call site |
| `Registry::reactivate` | `crates/module/src/registry.rs:170,176` | body is `todo!("G5: reactivate")`; the replay arm at `registry.rs:102` is a second `todo!` |
| `EventKind::ModuleDeactivated` / `ModuleReactivated` | `crates/kernel/src/event.rs:65,69` | declared in the closed vocabulary; `rg 'ModuleDeactivated\|ModuleReactivated' crates` returns ONLY those two declarations — zero construction sites, zero readers |
| `Tier::T1` (the forge tier) | `crates/module/src/manifest.rs:60` | `rg 'Tier::T1'` returns 0; `dispatch.rs:132` matches only `Logic::BuiltIn`, and `rg 'Logic::Forged'` returns 0 |
| `PhaseConfig.exits`, `ExitCondition`, `PhaseExit` | `crates/agent/src/phase.rs` | both surviving variants are CONSTRUCTED in `v1_phases` and neither is READ; the file states this itself and the grep still holds |
| `AgentState.phase` as a machine | `crates/agent/src/state.rs`, read at `ask.rs:26` | `rg '\.phase *='` returns zero assignments outside `state::opening`; `v1_phases()` has ONE entry, so only `Work` is reachable |
| `Manifest.slots` / `.section` / `.tests`, `SlotSpec`, `SectionSpec`, `Assertion`, `Case`, `run_install_tests` | `crates/module/src/manifest.rs` | every one of the 11 built-in manifests writes `tests: vec![]` and `slots: vec![]`; `run_install_tests` has no caller in `src` |

**Already fixed — do NOT repeat ROADMAP.md's list.** `docs/ROADMAP.md:69,97,105` records `Verdict::` at zero references, `struct Artifact` at zero, and `PhaseEntered` with no reader. All three are stale: `Verdict` and `PlanSteps` were DELETED (2026-08-23, see `phase.rs:28`), `struct Artifact` exists at `crates/agent/src/artifact/mod.rs:69`, and `PhaseEntered` is read at `crates/core/src/debug/turns.rs:130`. `StoreFailed` likewise gained a reader (`debug/turns.rs:175`).

---

## Measured counts

**Per crate** (`find crates/<c>/src -name '*.rs'`; test counts exclude the vendored `tests/browser/target/` build artifact)

| crate | src files | src lines | test files | test lines |
|---|---|---|---|---|
| `kernel` | 10 | 1155 | 0 | 0 |
| `context` | 14 | 1503 | 4 | 795 |
| `agent` | 66 | 8058 | 33 | 7897 |
| `core` | 119 | 14790 | 68 | 14440 |
| `module` | 6 | 530 | 1 | 93 |
| `adapters_web` | 31 | 3815 | 11 | 1376 |
| `adapters_test` | 6 | 855 | 0 | 0 |
| `ui` | 95 | 11213 | 0 | 0 |
| **total** | **347** | **41919** | **117** | **24601** |

`web/*.css`: 17 files, 2829 lines. Whole tree including tests and the vendored artifact: 67476 lines.

**EventKind variants: 12** — `RequestHandled`, `UserMessage`, `ModuleInstalled`, `ModuleDeactivated`, `ModuleReactivated`, `PhaseEntered`, `ModelCalled`, `ModelReplied`, `ToolInvoked`, `AgentStatus`, `StoreFailed`, `Custom` (`crates/kernel/src/event.rs`). Two of the twelve are dead (above).

**Routes registered: 23**, across **11 built-in modules** (`dispatch::builtin_entry`: dashboard, chat, agents, tools, board, space, terminal, files, processes, debug, status). 21 come from `RouteSpec { .. }` literals in pane files, 2 from the `route()` helper in `builtins.rs`. Method split: 13 GET, 10 POST. Zero DELETE, zero PUT. (`rg 'method: "' crates/core/src` returns 22 — one is the outbound SearXNG request in `websearch.rs`, not a route.)

**Tools the agent can call: 26** descriptors (`Tool::new` sites in `crates/agent/src`), assembled by `agent::builtin_tools()` plus the faculty tables:
- browser-local (3): `now`, `list_agents`, `read_agent`
- roster (2): `write_agent`, `spawn_agent`
- outside the tab (1): `web_search`
- skills (2): `list_skills`, `read_skill`
- workspace (11): `read_file`, `write_file`, `edit_file`, `list_files`, `find_files`, `exec`, `observe`, `start_process`, `stop_process`, `read_process`, `list_processes`
- space faculty (3): `remember`, `forget`, `post_note`
- memory faculty (2): `keep`, `discard`
- artifacts faculty (2): `record_artifact`, `read_artifact`

Sub-agents are additional tools synthesised per-roster at runtime (`agent::subagent`), so the callable set is 26 + the number of loaded peers.

**UI views: 4** `View` variants (`Work`, `Agents`, `Setup`, `DesignSystem`), of which **3** are in `NAV` — `DesignSystem` is reachable by URL only. This is down from 7 destinations before the ADE round (`docs/ADE-DESIGN.md` §3); the four absorbed slugs (`#/dashboard`, `#/chat`, `#/trace`, `#/debug`, plus `#/commands`, `#/settings`) still resolve through `View::from_slug`.
