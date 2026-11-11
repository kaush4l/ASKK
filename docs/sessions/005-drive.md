# 005 Drive: from idea to working, by the shortest road

Seven stages. After stage 1 askk is T3-like for Claude. After stage 2 it does what T3 Code
cannot. Everything after that widens what already works. Where things go is in
`004-architecture.md`; how to hand a stage to a model is in `006-goal-statements.md`.

> **To be redrawn after `007-workflow.md` is settled.** The envelope and the inbox now come
> before the port (stage 0), and there is no `sessions` element. The rules of the road and the
> order of harnesses stand.

## The rules of the road

1. **One thing runs end to end before anything is widened.** A session opened, answered and
   resumed in the real app, for one harness, comes before a second harness or a second screen.
2. **The contract is written against a recording, not a vendor.** Stage 0 has no `claude` in it.
3. **The contract may move until the third adapter, then it is frozen.** One harness shapes a
   contract like itself; two show the difference; three show what is common.
4. **One stage, one goal, one fresh session, one branch.** The app runs at the end of each.
5. **A stage ends in proof a machine can show:** tests named as sentences, and, where a real
   harness is involved, one live run whose output is pasted.
6. **An adapter has a budget of about 700 lines.** Past it, the adapter is doing the layer's
   job or the harness's. Drop the capability (a `false` in `can()`), do not grow the file.
   T3 Code's adapters are 8,000 to 12,500 lines each; that is the cost being refused.
7. **Wire recordings are captured from the real program, never typed.** A typed frame is a
   guess about the protocol (T3 Code's rule, learned the hard way).

## Where it starts

- 161 tests pass (`cargo test --features server`, 2026-11-10).
- The working tree holds a large uncommitted change over `90d853d`. Commit it before stage 0,
  so every stage has a diff that is only its own.
- REA is installed and its skill is in place, for when a harness's wire needs reading.

## The stages

### Stage 0. The contract and a recording

No real harness, no screen.

| build | where |
| --- | --- |
| card, item, turn, ask, `Can`, the `Harness` and `Live` ports | `src/core/session.rs` |
| `Event::Session` | `src/core/mod.rs` |
| the registry; a harness that plays a recording | `src/host/harness/mod.rs`, `replay.rs` |
| the `sessions` element: cards, `on`, its three views; no tools yet | `src/elements/sessions.rs` |
| the `harnesses` key and its file | `src/core/manifest.rs`, `defaults/askk.json`, `defaults/harnesses.json` |
| the walls | `src/structure.rs` |
| one recording in our own form (items and turns, one per line) | `tests/sessions/hello.jsonl` |

Done when these pass, with everything that passed before:
`a_recorded_session_replays_into_the_same_cards`,
`no_harness_is_named_outside_its_adapter`,
`a_card_holds_nothing_the_harness_can_give_back`,
`an_unknown_harness_kind_is_refused_with_the_reason`,
`every_kind_obeys_the_contract`, `the_shipped_manifest_names_every_part`.

### Stage 1. Claude, straight through

T3 mode: the person talks to a session.

| build | where |
| --- | --- |
| the Claude adapter: start, say, stop, answer, resume, read | `src/host/harness/claude.rs` |
| keeping sessions alive; the pump; the cache; `lost` at boot | `src/host/sessions.rs`, `src/core/places.rs` |
| list, open, say, stop, answer, read | `src/api/sessions.rs` |
| the session view; asks on the Asks page; the waiting count | `src/ui/views/session.rs`, `defaults/routes/sessions/` |
| a desk | `defaults/templates/desk/` |
| the harness's own folder, opened by name | `sandbox/server.sb` |
| a wire recording captured from the real `claude`, and the items it must become | `tests/sessions/claude/` |

Done when these pass: `the_claude_wire_becomes_the_recorded_items`,
`an_ask_whose_process_is_gone_says_so`, `a_lost_card_resumes_by_its_native_id`,
`a_control_shows_only_when_the_harness_can`.

And this runs in the real app, driven through the web UI, with what the pages showed pasted:
open a session in `projects/try`; say *create hello.txt containing hi*; the ask appears on the
Asks page and in the waiting count; allow it; `hello.txt` exists; stop the host and start it;
the card says `lost`; open it; the conversation is back; ask *what did you just make?* and it
answers.

To check at the start, against the installed `claude`, not from memory: the value that makes
it send permission requests to the host; whether a resumed session replays its history or it
must be read from disk; what the sandbox profile must open for it to write its own folder.

### Stage 2. The engine drives

dsh mode: the person talks to the engine, the engine uses sessions.

| build | where |
| --- | --- |
| `session_open`, `session_say`, `session_stop`, `session_read`; the prompt section; waking on a turn's end or an ask | `src/elements/sessions.rs` |
| stage, derived; those that need you listed first | `src/elements/sessions.rs`, the home page's `page.json` |

Done when these pass, all on the replay harness:
`an_engine_opens_a_session_and_hears_its_turn_end`,
`no_tool_answers_an_ask_without_a_rule`, `stage_is_derived_never_stored`,
`the_work_outlives_the_session` (the engine's phase is untouched when a card ends, and a second
session carries on).

And live: tell askk *have a session add a failing test to projects/try and tell me what it
did*. A session opens; its permission ask still comes to the person; askk reports in one
message when the turn ends.

**This is the point where the idea is working.** Three goals.

### Stage 3. Codex

The second harness. The contract is allowed to move here, and only here or in stage 4.

| build | where |
| --- | --- |
| the Codex adapter over `codex app-server` | `src/host/harness/codex.rs` |
| the generated schema, kept to notice drift | `tests/sessions/codex/schema/` |
| a captured wire recording and its items | `tests/sessions/codex/` |

Done when: the stage 1 live run passes with `codex` as the harness;
`git diff --stat -- src/ui src/api` for the stage prints nothing; every change to
`core/session.rs` is listed with its reason; the walls pass.

### Stage 4. ACP, find, and the freeze

| build | where |
| --- | --- |
| the ACP adapter | `src/host/harness/acp.rs` |
| entries for Gemini (installed here) and Grok Build | `defaults/harnesses.json` |
| `find` for the harnesses that can; an import control that shows only for them | `claude.rs`, `codex.rs`, `src/api/sessions.rs` |

Done when: the live run passes with `gemini`; controls a harness cannot honour are absent, not
disabled; a session started in a terminal is found, read and resumed as ours; the port's types
are added to the rigid table in `docs/architecture.md`.

### Stage 5. One face (your decision first)

An askk engine seen as a harness (`src/host/harness/own.rs`), so the engine's own loop and a
real session are drawn by one view and an engine can carry another engine as a session. It
changes what the chat page is, so it waits for a yes.

### Stage 6. Packs (your decision first)

`Layered` store, `pack.json`, export and import (`004-architecture.md`, last section). It changes
boot from copying defaults to reading through them, so it waits for a yes.

Done when: `a_pack_is_read_until_the_personal_layer_overrides_it`,
`an_override_knows_its_base_changed`, `export_refuses_what_is_personal`; and a desk exported
from this home appears in an empty one.

## Why this order

| instead of | this, because |
| --- | --- |
| the screen first | S8: the view would be shaped like Claude |
| Codex before the engine drives | the element is what is new; prove it while there is one adapter and a change is cheap |
| ACP first, to get many at once | S3: the contract would be shaped like the least capable |
| packs first, since sharing is the dream | there is nothing worth sharing until a desk works |
| everything in one goal | the judge of a goal reads only the conversation; a long goal ends when the summary sounds finished (`006`) |

## Not on the road yet

A `report` tool lent to sessions; worktrees; sources such as GitHub or a schedule; a socket for
per-token text; Muse Code. Each has a place (`004-architecture.md`, "What stays open") and none
is needed for the idea to work.
