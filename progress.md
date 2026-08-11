# progress

The ledger for porting `PythonProject1` (Python) to this repo (Rust, browser, GitHub Pages).
One row per increment, appended and never rewritten — if something regresses, add a row saying so.

Plan: `~/.claude/plans/ancient-honking-biscuit.md`.
Built by `porter`, closed by `ux-walker` on the deployed page.

## Ledger

| # | Feature | Host tests | Headless | Hosted (ux-walker) | Commit | Notes |
|---|---|---|---|---|---|---|
| 01 | Dioxus shell, cross-origin isolation, deploy | 19 green | renders, `crossOriginIsolated: true`, no console errors | ⬜ pending `ux-walker` | `a650573` | Live at https://kaush4l.github.io/ASKK/. The dashboard fragment's `hx-*` panel loader is inert (htmx gone) — it shows "loading panel…" until fragments land in increment 02. |
| 02 | Chat with the main agent: `ChatPane`, endpoint settings, ux-walker fixes | 22 green | send → live reply in the DOM, URL unchanged, transcript survives reload; real turn against omlx same-origin AND cross-origin | ⬜ pending `ux-walker` | `0811afe` | Live model turn verified LOCALLY (127.0.0.1:8901 → omlx 8873, via the same-origin proxy and via a configured cross-origin endpoint under COEP). From the hosted origin Chrome refuses the localhost call outright: "Access to fetch at 'http://127.0.0.1:8873/v1/models' from origin 'https://kaush4l.github.io' has been blocked by CORS policy: Permission was denied for this request to access the `loopback` address space" — the Chrome 142+ Local Network Access gate `RESEARCH.md` predicted, with no prompt available in headless. The hosted page reports that failure in words instead of hanging; the hosted path to a model is a BYOK provider (untested — no key). |
| 02b | ux-walker fixes: first run, key preservation, error shape, a way out, dead `/v1/models`, panel wording | 28 green (22 + 5 pure endpoint-broker + 1 unconfigured-first-run) | cold start sends nothing and says why; save-with-blank-key preserves the stored key (read back from `kv/config/keys/model`); Stop waiting frees the composer at 4 s; the 30 s abort fires on a blackholed IP (error at <38 s); live turn against omlx replies | ⬜ pending `ux-walker` | `2da6890` | Live at https://kaush4l.github.io/ASKK/. Hosted checks: cold start posts nothing (network log empty), key survives a re-save, the failure message leads with the sentence and the raw error is a collapsed `<details>`. Live model turns are still local-only (Chrome's Local Network Access gate, 02 row). |

| 03 | Agents loaded from `public/agents/` | 35 green (28 + 7 agent-spec) | agents fetched at boot, `main`'s prompt comes from the file, a malformed `agent.md` is skipped and the page still works with zero console errors | ⬜ pending `ux-walker` | `dfe25b4` | Live at https://kaush4l.github.io/ASKK/. Hosted hot-reload proved BOTH ways: edited `description`/prompt in `public/agents/main/agent.md` → `./publish.sh` → load → header reads the edit; reverted → publish → load → header reads the clean text. No Rust change in either step. Cache note: agent files are fetched `cache: "no-cache"` and the service worker serves `/agents/` network-first, so the FILES track a deploy immediately; the Wasm bundle still rides GitHub Pages' 600 s `max-age` on `index.html`, so a same-URL reload inside that window can still run the previous build. |
| 04 | Model catalogue (`public/models.json`) + the four standing UX findings | 40 green (35 + 10 catalogue/endpoint − 5 replaced) | fresh install has a real default endpoint and answers live from omlx 8873 with NOTHING configured; an agent `model:` key that is not in the catalogue is sent as a model id to the default endpoint; a `kind: anthropic` entry refuses in words; a malformed agent.md is named on screen | ⬜ pending `ux-walker` | `83905e6` | Live at https://kaush4l.github.io/ASKK/. Hosted: the catalogue loads (4 entries), the pick persists across reload, and the `local` turn fails as recorded — "Permission was denied for this request to access the `loopback` address space" — with the plain sentence first and the raw error in a collapsed `<details>`. |

## Parity with the Python project

The stop condition. A line ticks when the behaviour matches and a test pins it — not when the
feature "exists".

| Python | Behaviour that must match | Done |
|---|---|---|
| `core/engine.py` | ReAct turn: answer / tool call / failure exits | ⬜ |
| `core/engine.py` | Rolling window compaction, summary + retained tail | ⬜ |
| `core/engine.py` | CONTEXT block assembled fresh every request | ⬜ |
| `core/engine.py` | Log mirrors the window exactly after compaction; writes drain first | ⬜ |
| `core/state.py` | Six statuses; `turns` increments only on entry to Working | ⬜ |
| `core/state.py` | `Waiting` (entry agent) distinct from `Idle` | ⬜ |
| `core/registry.py` | One private event loop per agent; failure records the message | ⬜ |
| `core/registry.py` | Built-in agents override-able by a project agent of the same name | ✅ |
| `core/tools.py` | Batch layout: same line concurrent, new line sequential | ⬜ |
| `core/tools.py` | Unreadable arguments refused with a repair message, never an empty call | ⬜ |
| `core/tools.py` | Sub-agent callable as an ordinary tool | ⬜ |
| `core/space.py` | One space object per name, shared across threads | ⬜ |
| `core/space.py` | Attributed notes, 20-note cap, atomic persistence | ⬜ |
| `core/space.py` | Facts render into CONTEXT; a stale value never lingers | ⬜ |
| `core/inference.py` | Model catalogue keyed by name, not a provider table | ✅ |
| `core/utils.py` | `agent.md` frontmatter: model, temperature, engine, tools, space | ✅ |
| `core/agents/summarizer` | Built-in summarizer compresses history | ⬜ |
| — | Chat with the main agent in the UI | ✅ |
| — | Chat with any agent individually | ⬜ |
| — | Agents hot-reloaded from `public/agents/` | ✅ |
| — | New agents added in the browser, persisted, exportable | ⬜ |
| — | Alpine workspace: run a command, write a file, survive a refresh | ⬜ |

Dropped deliberately (not parity failures): `core/cron.py` — no crontab in a tab. MCP subprocesses —
they are `node` inside the VM, priced after increment 10.

## Decisions

- **gh-pages root is replaced** with the new app; the old c2w page survives in history at
  `deploy 80564a2`.
- **Dioxus** replaces htmx, superseding ADR-002's transport half. The `handle(Request) -> Response`
  seam is unchanged (I4).
- **CheerpX** is the VM backend, not container2wasm — ADR-052 measured the Bochs guest at one
  interpreted thread, permanently. Amends ADR-008: cross-origin isolation is now required, via a
  header-injecting service worker.
- **One worker, two files.** A scope may have exactly one active service worker, so COI headers and
  caching cannot be two registered workers. `web/coi-sw.js` owns the header policy and installs no
  listener (it exports `withCoiHeaders`); `web/sw.js` stays the ADR-007 caching/updates worker, owns
  the single `fetch` handler, and calls it on the way out. Responsibilities stay split by file; the
  platform's one-handler limit is respected.
- **Navigations are network-first** in `sw.js` (assets stay cache-first). Trunk fingerprints the JS
  and Wasm, so a cache-first `index.html` would point at asset names that no longer exist — refresh
  is the update channel (I11), and this is what makes it actually refresh.
- **Trunk, not `dx`,** builds the app: `Trunk.toml` sets `public_url = "./"`, which keeps every
  emitted asset path relative for the `/ASKK/` subpath. `publish.sh` now builds and deploys `dist/`
  and gates on both absolute HTML URLs and an absolute service-worker registration path.
- **`ui` is a new L3 crate** (ARCHITECTURE §2/§4 updated, layering check extended): it may import
  `kernel` and `adapters_web` only, and `adapters_web::WebApp::handle` gives Dioxus the seam without
  the JSON hop. `core::handle(App, Request) -> Response` is untouched (I4).
- **gh-pages was replaced wholesale**, which also removed the unrelated `hermes/` demo that shared
  the branch. Recoverable by force-pushing `ff90b88` back to `gh-pages`.
- **Credits are owed.** CheerpX's Community License covers this use; its action point is "give
  appropriate credits", and the runtime is loaded from `cxrtnc.leaningtech.com` because self-hosting
  it requires a commercial licence.

### Increment 02

- **The chat form is a Dioxus component, not a core fragment.** The `hx-post` form the core emitted
  had no htmx behind it, so Send did a native GET and leaked the message into the URL. The core now
  renders only the transcript; `ChatPane` owns the composer and calls the seam from `onsubmit` with
  the default prevented. Verified in a browser: after Send and after Enter, the URL is unchanged.
- **`chat` is its own built-in module**, split out of `dashboard`. `GET /chat` is the whole
  conversation folded out of the event log (I8) and `POST /chat` emits the utterance; there is no
  UI-side message list, which is why a reload redraws the same conversation from replay.
- **`x-turn: pending` is a response header, not a marker in the HTML.** The pane must know whether a
  turn is running; parsing its own rendered fragment to find out would be application logic in the
  view. The header is the projection saying so.
- **Endpoint configuration does NOT cross the seam.** `handle` writes an Event for every request
  (I8), and a credential must never enter the log, a Document, or a module. `Settings` calls
  `WebApp::set_endpoint` on the composition root, which sets the broker and writes
  `config/keys/model`; the core is never told. PROVISIONAL under ADR-006: storage is Option A (plain
  IndexedDB record) — Option B (WebCrypto-wrapped at rest) stays a human gate and is one adapter
  file away. The browser-visible-key trust model is stated in the settings pane itself.
- **Every model call carries a 30 s abort signal.** A page that cannot reach its endpoint must say
  so, not hang; the pane gives up on the same budget and says the turn produced nothing.
- **Chrome's Local Network Access gate is real and hosted-fatal for localhost.** The deployed origin
  cannot call `http://127.0.0.1:8873` (evidence in the 02 row). The local server stays the local
  target; the hosted target is a BYOK provider that sends CORS headers.
- **`Request::post_form` lives in `kernel`,** so the encoder sits beside the seam type it builds and
  is the stated inverse of `core::form::form_value` — a message containing `&` cannot truncate
  itself on the way through.
### Increment 02b (closing the `ux-walker` findings)

- **There is no default endpoint any more.** `/v1` as a default was a promise the hosting cannot
  keep: on Pages it resolves to the origin root, drops `/ASKK/`, and answers a chat POST with a 405
  HTML page. An unconfigured install now has NO endpoint — `FetchModel` returns
  `ModelError::EndpointUnknown`, the pane refuses to send and says what to add, and the composer is
  disabled until a base URL exists. The empty-endpoint case cannot be hit blindly.
- **The key field is write-only, so blank means "unchanged".** The field is never repopulated (a
  secret must not go back into the DOM), which is exactly why Save used to wipe the stored key.
  `Endpoint::set` takes `api_key: Option<&str>`; `None` keeps what is stored, `Some("")` clears it,
  and the pane shows "a key is saved" plus an explicit **Clear key**. Pinned by a host test.
- **The sentence leads, the typed error follows.** The failure fragment is a `<p>` with the
  actionable sentence and a collapsed `<details>` holding the raw payload — chosen by matching the
  `CoreError` variant, not by grepping the payload string, so `Provider` and `EndpointUnknown` get
  their own advice instead of nothing.
- **A turn has a clock and an exit.** The pane shows elapsed seconds while waiting and a **Stop
  waiting** button that frees the composer; it says plainly that the request may still be in flight.
  The 30 s `AbortSignal` was verified to fire against a blackholed IP now that only ONE request per
  turn exists.
- **`GET /v1/models` is gone.** Nothing consumed it, it failed everywhere, and it doubled the CORS
  prompts and the worst-case wait. The model name it was guessing is now a settings field the adapter
  stamps into the body (blank = send what the core asked for, which a local server ignores).
- **`Endpoint` is its own file.** Splitting the pure broker state out of `model.rs` keeps both under
  200 lines and puts the secret-handling logic where `cargo test` can reach it with no browser (I3).
- **The panel placeholder stopped pretending to load.** With htmx gone, its `hx-get` was a dead
  attribute under a live-looking "loading panel…"; it is now `class="panel pending"` and says it is
  not mounted. The status board lands in increment 06.

### Increment 03

- **`public/agents/index.json` is the manifest, and it is the one place to register an agent.** A
  static host cannot list a directory, so the app cannot discover folders on its own. Adding an
  agent is two steps and no code: create `public/agents/<name>/agent.md`, add `"<name>"` to the
  `agents` array in `public/agents/index.json`. A folder that is not listed is never fetched. The
  alternative — generating the list at build time — was rejected because it puts the agents back
  behind a rebuild, which is the thing this increment exists to remove.
- **Built-ins are compiled in, the project files are fetched, and the fetched file wins.** The
  Python `_agent_dirs` walks built-ins first and then the project directory, so a project agent of
  the same name replaces the built-in. Here `agents::builtin_files()` (the summarizer, `include_str!`
  of the very same file) is chained BEFORE the fetched files and `agent::load_agents` lets the later
  name win. Pinned by `a_project_agent_replaces_the_builtin_of_the_same_name`.
- **A broken `agent.md` costs that agent, never the boot.** `load_agents` skips what will not parse
  and keeps the rest; a missing file or an unreadable manifest leaves the compiled-in built-ins and
  a page that still runs. Pinned by `a_malformed_file_costs_that_agent_and_nothing_else` and walked
  headless with a deliberately broken third agent.
- **The frontmatter reader is a deliberate subset, not YAML.** `key: value`, a block list under a
  bare `key:`, and the inline `[a, b]` form — every shape the shipped agents use. A YAML crate to
  read seven keys would be a dependency (and Wasm bytes) bought for nothing; unknown keys are
  ignored the way the Python loader forwards what it has no use for.
- **`main`'s system prompt is no longer a string in the binary.** `agent::adopt_spec` replaces the
  seeded `soul` and `identity` sections with the file's body and description, so the chat pane's
  header and the Document the model receives both come from `public/agents/main/agent.md`. That is
  the proof the loader is real rather than decorative.
- **Agent files are cache-hostile on purpose.** They are unhashed data whose whole point is to
  change without a rebuild, so the service worker serves `/agents/` network-first and the loader
  fetches with `cache: "no-cache"`. Without both, GitHub Pages' 600 s `max-age` and the SW's
  cache-first rule would serve yesterday's prompt after a deploy — which is exactly what happened on
  the first hosted attempt.
- **`publish.sh` gates on the agent files.** A deploy missing `agents/index.json` or
  `agents/main/agent.md` is a page with no main agent, which is a white-page-class failure with no
  console error; it now fails the gate instead.

### Increment 04

- **`public/models.json` is a catalogue keyed by NAME, not a provider table.** The Python decision
  ports whole: nearly every server speaks the OpenAI protocol and differs only in its `base_url`, so
  a provider name bought nothing but a place to hardcode a URL. An entry holds `model`, `base_url`,
  `api`, `kind`, `api_key_env`; `default` names one; and a key that is NOT in the catalogue is taken
  as a model id served by the default entry's endpoint — which is why `model: local` in an
  `agent.md` is a catalogue key while an arbitrary model id still works. Proven live both ways:
  `model: local` answered from omlx, and `model: qwen-does-not-exist` came back
  `Model 'qwen-does-not-exist' not found` FROM 127.0.0.1:8873, i.e. the key became the model id on
  the default endpoint.
- **The one API bug the Python fixed is not reintroduced.** `Catalogue::resolve(name)` and
  `Endpoint::resolve(asked)` take the catalogue KEY; the concrete model id is a field on the
  resolved `Entry`. There is no parameter called `model` shadowing the override.
- **There IS a default endpoint again, and it is honest.** 02b was right to delete `/v1` (it
  resolved to the origin root and 405'd); the fix is a real named endpoint, not no endpoint. A fresh
  install now resolves to `local` → `http://127.0.0.1:8873/v1` → `gemma-4-12B-it-qat-mxfp8` and
  answers with nothing configured — locally. From the hosted origin the same turn still dies on
  Chrome's Local Network Access gate, which is documented in the pane rather than hidden.
- **Per-user overrides are per ENTRY, layered on the file, and stored in IndexedDB.** The profile
  record is `{selected, api_key, overrides:{models:{…}}}`; the effective catalogue is recomputed as
  file + overrides on every read, so clearing a field REVERTS to the shipped value instead of
  leaving a hole. Editing `openai` never disturbs what was saved for `local`. A pre-catalogue
  profile carrying a bare `base_url` migrates to an override of the current entry, so no saved
  endpoint was lost by this increment.
- **Precedence is stated and pinned:** the user's explicit pick in Settings outranks the agent's
  `model:` key, which outranks the catalogue's `default`. A pick is an explicit act; a frontmatter
  key is a default.
- **The agent's `model:` key now actually travels.** `AgentState.model` (set by `adopt_spec`) rides
  out on `Effect::CallModel { model }` and becomes the body's `model` field — the symbolic name the
  core speaks. `runtime.rs` no longer hardcodes `"local"`. Nothing upstream of the broker knows a
  URL or a concrete model id (I6, I13).
- **`kind` and `api` are honoured by REFUSING what this build cannot speak.** A new
  `ModelError::Unsupported { detail }` names the entry and the protocol it asked for. The `sonnet`
  entry is shipped for parity and, when picked, says so in one sentence instead of POSTing
  chat-completions bytes at the Messages API. `claude-cli` from the Python catalogue is dropped
  deliberately: there is no subprocess in a browser.
- **`models.json` is cache-hostile like the agent files.** `sw.js` serves it network-first (VERSION
  bumped to `04-0.4.0`) and the loader fetches `cache: "no-cache"`; `publish.sh` gates on it,
  because a deploy without it is a page with no endpoint at all.
- **The four standing `ux-walker` findings, closed.** (1) Disabled controls now read as disabled —
  `opacity: .6`, `cursor: not-allowed`, no accent fill; measured in the hosted DOM against the live
  Save button beside it. (2) The chat pane titles itself `Chat with main` from an `x-agent` response
  header, so the interface owns that fact rather than borrowing an editable `description` line; the
  composer's accessible name follows it. (3) `agent::load_agents` returns `(specs, problems)` and
  the Agents card prints `Skipped — wrecked/agent.md could not be read: missing YAML frontmatter` —
  skipping stays correct, the silence is gone. (4) Each prompt disclosure is named for its own agent
  (`System prompt for summarizer (from public/agents/summarizer/agent.md)`), so two disclosures are
  no longer the same control to a screen reader.
