# What is decided where

One source makes every build. That only stays true if each kind of decision has one place,
and nothing else makes it. This is the list: the place, what is decided there, what must
never be decided there, and whether the code follows it today. "Held by" names the test
that fails when it stops being true; a row marked "review" has no test yet.

Two facts steer most of it:

- **One person uses it.** There are no accounts and no permissions between users. The
  questions are "is this the owner's machine?" and "did the owner name this page?".
- **It runs for as long as the machine does.** Nothing may stop it but the owner. Whatever
  is known must be on disk before the next step, and a failure is a sentence, not a stop.

## 1. The layers

| place | decides | never decides | followed | held by |
| --- | --- | --- | --- | --- |
| `core/` | what an engine, a run, a tool and a store are; how the loop goes; the ports a host must fill; what a missing capability means | which machine, which runtime, which build, who draws | yes | `the_core_is_the_plain_language`, `the_core_names_no_runtime`, `the_core_does_not_know_the_build`, `the_core_does_not_know_who_draws_or_asks` |
| `elements/` | the kinds of thing an engine is made of (history, notes, tools...) | which engines exist | yes | `core_never_names_an_element_kind` |
| `defaults/` (data) | which engines exist, their goals and tools, the pages, the models, the theme | behaviour | yes | `defaults_boot_and_every_selected_tool_exists`, `the_program_alone_can_make_a_first_home` |
| `host/` | how a port is filled on a machine: folder, processes, `node`, model connectors | what a tool means; what a page shows | yes | `only_the_host_touches_the_machine`, `only_the_api_reaches_the_host` |
| `local/` | how a port is filled in a browser tab: IndexedDB, a sandboxed worker, `fetch` | the same as `host/` | partly: it also draws its own page (`local/page.rs`) with inline looks; that page belongs in `ui/web` | `the_tab_is_a_host_and_nothing_else_knows_it` |
| `api/` | what may be asked, the names and the shapes of the answers; one plain function each | how an answer is drawn; how the work is done | mostly: 5 answer files still reach the host directly, a debt that may only go down | `every_question_can_be_asked_by_any_ui`, `an_answer_is_a_plain_function`, `the_answers_ask_the_core_not_the_host` |
| `ui/features/` | what a person can do and what the words say: which answers a feature asks, how a run reads as lines | how it is drawn; which library | yes | `a_feature_draws_nothing` |
| `ui/web/` | how a feature looks as a page: kit, components, views | what the words say; anything about the engine | partly: only the talk feature has moved to `features/`; the other views still shape their own words | `the_kit_is_standard_parts_and_nothing_else`, `looks_live_in_the_stylesheet`, `every_view_a_page_may_name_is_drawn` |
| `ui/terminal/` | how a feature looks as lines; the commands a person types | the same as `ui/web/` | yes | `the_terminal_is_lines_only` |
| `shells/` | what holds the UI: browser page, Mac window, phone, terminal; reading the command line | anything else | yes | `each_mac_face_is_one_file`, review |
| `Cargo.toml` features | which host and which shell go into a program | behaviour (no `cfg(feature)` inside `core/`) | yes | `the_core_does_not_know_the_build`, the `local` compile error |
| the environment | where the home is, the port, which pages may ask (`ASKK_HOME`, `PORT`, `ASKK_ORIGINS`) | anything a person would edit while it runs | yes | `places_is_the_only_reader_of_the_environment` |
| the owner, while it runs | models, theme, layout, engines, goals (files in the home; pages in Settings) | — | yes | review |

## 2. Who is the host

| runtime | the host | store | a program runs in | the model is asked by |
| --- | --- | --- | --- | --- |
| a terminal process (`askk terminal`) | the process | the home folder | `node` | connectors in `models.json` |
| a hosted service (`./scripts/run.sh`) | the server | the home folder | `node` | connectors in `models.json` |
| a window on the service (browser, Mac app, phone; `askk terminal --to`) | the server; the window only asks | — | — | — |
| a browser tab (GitHub Pages) | the browser | IndexedDB | the browser's own sandbox | `fetch`: a model server, or an askk server's `/ask/infer` |

What each one can do is not written here: the build says it itself (`capabilities`,
`core/caps.rs`).

## 3. Decisions the two facts make

| because | decided | where | followed | held by |
| --- | --- | --- | --- | --- |
| one person | no login; the service listens on this machine only (`127.0.0.1`) | `scripts/run.sh` | yes | review |
| one person | a page at another address may ask only if the owner named its origin; none by default | `core/places.rs` (`origins`), `api/ask.rs` | yes | landmark 3 (the tab is named, and is answered); the refusal itself: review |
| one person | one writer per home: a second process or tab boots no engines and says so | `core/store.rs` (`lock`), `local/store.rs` | yes | review |
| one person | a key typed into a page stays in memory; a tab can ask a service's model instead of holding a key | `local/infer.rs` | yes | review |
| always running | state is written after every step, so a stop loses at most the step in hand | `core/engine.rs` (the `Save` stage) | yes | landmark 1 (a second process reads the history) |
| always running | a lock held during a failure is taken again, not fatal | `core/held.rs` | yes | `a_lock_never_stops_the_service`, `a_lock_is_still_usable_after_its_holder_panicked` |
| always running | an error is returned as a sentence a person can act on; panics may only go down | everywhere | yes | `errors_are_returned_not_thrown` |
| always running | a program an engine wrote has a time limit and is stopped | `core/code.rs`, `host/code.rs`, `local/code.js` | yes | `a_program_gives_its_last_value_and_what_it_printed_and_cannot_reach_the_machine` |
| always running | messages that arrived before a restart are handled after it | `host/world.rs` (`wake_pending`) | yes | review |
| always running | a first home is made from the defaults the program carries, anywhere | `core/store.rs` (`packed`) | yes | `the_program_alone_can_make_a_first_home`, `scripts/smoke.sh` |

## 4. The landmark of 0.1

One engine loop, whole, on each runtime: question → the model writes a program → `run_code`
runs it → the answer → the conversation is kept. `scripts/landmark.sh` proves it with a
scripted model (no network, no key), on an M-series Mac and on Linux, on every push:

| # | runtime | proved by |
| --- | --- | --- |
| 1 | a terminal process | the answer carries the program's value; a second process reads the kept history |
| 2 | a hosted service | the same over `/ask`; the engine's page answers; a terminal attached with `--to` reads the history |
| 3 | a browser tab | headless Chrome opens the tab build; the tab's own sandbox runs the program; the page shows answer, stages and history |

Beside the landmark, every push still builds the host for Windows and Intel Mac, and the
Mac app compiles; they are not part of 0.1.

## 5. Not followed yet

- `local/page.rs` draws the tab's page inside a host, with inline looks. It should be a
  `ui/web` page on the kit.
- Only "talk" is a feature in `ui/features/`. The other views decide their own words.
- `run_code` on the service needs `node` on the machine; the tab needs nothing.
- Safari and Firefox are not tested; the tab landmark runs in Chrome only.
- An existing home does not receive engines added to the defaults later.
- Rows marked "review" above have no test.
