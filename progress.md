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
| 05 | Toolbox: batch layout, refused arguments, generated usage lines, a tool trace — plus per-entry API keys and six walk findings | 52 green (40 + 6 toolbox + 3 tool turn + 3 keys/reset) | a real turn against omlx 8873: the model called `list_agents()`, then `read_agent({"name": "summarizer"})`, and answered from both results; the trace shows call, args and output; a key saved for `openrouter` is not offered for `openai`, `local` or `sonnet`; Reset returns to the catalogue default | ⬜ pending `ux-walker` | `98e3cf3` | Live at https://kaush4l.github.io/ASKK/. Hosted: the page loads with the tool trace panel, the chat sub-line reports the ENDPOINT (`This turn calls local — gemma-4-12B-it-qat-mxfp8 at http://127.0.0.1:8873/v1, with no key.`) rather than the agent file's `model:` key, selecting `sonnet` refuses at selection, Reset works, and the `local` turn still dies on Chrome's loopback gate with the disclosure now named `Technical detail — the endpoint was unreachable`. A live hosted tool turn needs a BYOK key (none available). |
| 06 | One Worker per agent + the supervisor board: six statuses, sub-agents as tools, and the nine walk findings | 67 green (52 + 7 supervisor/sub-agent + 7 delegation + 1 override-pinning) | fresh install, real omlx on 8873: the lead delegates and the board goes `main:working` → `researcher:working` → `researcher:idle` → `main:waiting` LIVE during the turn, three model calls (lead, sub-agent-in-its-Worker, lead again), and the lead answers with what the sub-agent returned; `researcher({})` is REFUSED and the sub-agent never runs; at 390px the document no longer scrolls sideways | ⬜ pending `ux-walker` | `6ea8c79` | Live at https://kaush4l.github.io/ASKK/. Hosted: `crossOriginIsolated: true`, two Workers boot (one per sub-agent), the board and the agent list are walkable, the Agents card now prints the REAL toolbox (`tools: now, list_agents, read_agent, researcher`) instead of "no tools yet", and the turn dies at the documented loopback boundary — the board then shows `main failed — 1 turn` WITH the endpoint message rather than a lead stuck in `working`. NOT demonstrated live: two sub-agents running at the same instant. The code path exists and its ordering is pinned on the host (`one_line_of_delegations_is_one_batch_and_the_next_line_follows_it`), but the local gemma would not emit two calls on one line after three attempts, so simultaneity is unproven in a browser. |
| 07 | Chat with any agent individually: per-agent conversations, observable Worker lifecycle, and the seven walk findings | 78 green (67 + 8 per-agent conversations + 3 lifecycle) | fresh install, real omlx on 8873: `researcher` answered a question typed straight to it while `main`'s transcript stayed untouched; delegating through `main` put the sub-agent's turn in the SUB-AGENT's history attributed to `main`; a reload rebuilt every conversation AND both turn counts (2 and 2); the board settles `starting` → `idle` as each Worker reports | ⬜ pending `ux-walker` | `23560d4` | Live at https://kaush4l.github.io/ASKK/. Hosted: `crossOriginIsolated: true`, the agent tabs switch, per-agent histories persist across reload and across a browser restart, the board reads `idle — it answered, and nobody is waiting on it — 4 turns`, and a turn dies at the documented loopback boundary — the sub-agent's failure now names ITS OWN cause (`The model endpoint could not be reached… Chrome 142+ asks permission…`) instead of "researcher produced no answer". |
| 07b | `ux-walker` FAILED 07: the crossed projection, the global composer lock, invisible tab labels — plus three lower-severity findings from the same walk | 83 green (78 + 5: one read names one agent, one agent's turn does not report another busy, two agents in flight at once, a rebooting Worker does not erase a failure, an old record does not replay Rust debug syntax) | fresh install, real omlx on 8873 (127.0.0.1:8901 → dist): started a turn on `main`, clicked `summarizer` mid-turn and polled 1 s × 10 — heading, pane `aria-label`, agent-header line and composer label all read `summarizer` and the transcript stayed empty every tick, never crossed; with `main` mid-turn `summarizer`'s composer was live (`inputDisabled:false`, Send reads "Send") and a second turn ran to a real gemma answer while `main`'s was still running; tab labels compute 16:1 on the body background (was 1.02:1); a sub-agent whose only turn failed still reads `failed` after a reload and after its Worker re-boots; an `agent_error` record injected in the OLD shape (`JsValue("researcher: …")`) renders as `researcher: The model endpoint could not be reached.` — one speaker, no wrapper; saving a new endpoint restarts every Worker with no `closed` row | ⬜ pending `ux-walker` | `304e1a4` | Live at https://kaush4l.github.io/ASKK/. 07's row was a FAIL — this row is the answer to it, and 07 does not close until this one is walked. HOSTED, after wiping the service worker, caches and IndexedDB (the walker was served a stale build ~4 min after the deploy; the bundle hash in `index.html` is the check — `ui-cc88c6ef827508a2.js` matches `dist/`): the same walk passes — `main` mid-turn against a black-holed endpoint, `summarizer` never crossed over 10 polls, both boards read `working` AT ONCE (`main:working`, `summarizer:working`), which is the "two at once" 06 and 07 could not demonstrate through the interface at all; after both turns failed a reload left `main:failed` AND `summarizer:failed` — a Worker agent and the page's own agent now mean the same thing on a fresh load. WHAT CHANGED: the pane renders from ONE value (`turn::Shown { who, html, pending }`) and shows a transcript only while `who` is the selected agent, so a heading and a body from different agents is not expressible; a turn's poller belongs to the agent it started on and returns the moment the selection moves; in-flight is per agent, read from that agent's own `x-turn`; `.agent-tabs .tab` re-states `color: var(--ink)` (it had inherited `button`'s ink for a background it no longer has); `core::report_agent` refuses to let a `Starting`/`Idle` reboot report overwrite a `Failed` row — a reboot is not an outcome; `failure::readable` strips an older build's `JsValue("…")` wrapper and the duplicated speaker name at RENDER time, so records already written stay readable; `close_all` no longer writes `Closed`, which was assigned and replaced in one tick and could never be seen (the variant stays in `kernel` because logs written by the 07 build carry it and a replay that cannot deserialize refuses boot). |
| 08 | Per-agent logs, the rolling window and the built-in summarizer — plus the three 07b walk findings | 93 green (83 + 6 window/compaction + 4 per-agent log) | fresh install, real omlx on 8873: four turns drove `main` past `compact_at: 8` and the SUMMARIZER AGENT compacted it live — the window went 7 → 5 with `data-compacted="true"`, and the stored `log/main/*` in IndexedDB is exactly that window (summary + `keep_recent: 3` tail); a reload rebuilt the same 5; `researcher` did the same INSIDE ITS OWN WORKER against its own database (`harness-agent-researcher`, `log/researcher/*`), compacted at 6, and after a page reload its next turn continued from the restored window rather than an empty paper; the ARIA tablist answers ArrowLeft/Right (wrapping), Home and End with a roving tabindex | ⬜ pending `ux-walker` | `87780ee` | Live at https://kaush4l.github.io/ASKK/. HOSTED (bundle hash in `index.html` checked against `dist/` — `ui-5f603ad7507e1067.js`, matched on the third poll): `crossOriginIsolated: true`, three tabs read `tab, main, selected` to a screen reader, the memory line renders, and BOTH failures at the loopback boundary now render as the SAME card — `main`'s and `researcher`'s are byte-identical sentences with the identical `Technical detail for failure 1 — the endpoint was unreachable` disclosure, the sub-agent's carrying the typed payload its Worker sent across `postMessage`. With every stylesheet removed the current tab reads `▸ **researcher**` while the others are plain. NOT demonstrated hosted: a live compaction — it needs a reachable model, and the hosted page still dies on Chrome's Local Network Access gate (02's row). |

## Parity with the Python project

The stop condition. A line ticks when the behaviour matches and a test pins it — not when the
feature "exists".

| Python | Behaviour that must match | Done |
|---|---|---|
| `core/engine.py` | ReAct turn: answer / tool call / failure exits | ✅ |
| `core/engine.py` | Rolling window compaction, summary + retained tail | ✅ |
| `core/engine.py` | CONTEXT block assembled fresh every request | ✅ |
| `core/engine.py` | Log mirrors the window exactly after compaction; writes drain first | ✅ |
| `core/state.py` | Six statuses; `turns` increments only on entry to Working | ✅ |
| `core/state.py` | `Waiting` (entry agent) distinct from `Idle` | ✅ |
| `core/registry.py` | One private event loop per agent; failure records the message | ✅ |
| `core/registry.py` | `aclose` stops the loop and records `CLOSED`; a load failure records `FAILED` with `str(e)` | ✅ |
| `core/registry.py` | Built-in agents override-able by a project agent of the same name | ✅ |
| `core/tools.py` | Batch layout: same line concurrent, new line sequential | ✅ |
| `core/tools.py` | Unreadable arguments refused with a repair message, never an empty call | ✅ |
| `core/tools.py` | Sub-agent callable as an ordinary tool | ✅ |
| `core/space.py` | One space object per name, shared across threads | ⬜ |
| `core/space.py` | Attributed notes, 20-note cap, atomic persistence | ⬜ |
| `core/space.py` | Facts render into CONTEXT; a stale value never lingers | ⬜ |
| `core/inference.py` | Model catalogue keyed by name, not a provider table | ✅ |
| `core/utils.py` | `agent.md` frontmatter: model, temperature, engine, tools, space | ✅ |
| `core/agents/summarizer` | Built-in summarizer compresses history | ✅ |
| — | Chat with the main agent in the UI | ✅ |
| — | Chat with any agent individually | ✅ |
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

### Increment 05

- **The credential leak is closed: one key per ENTRY.** `Endpoint` holds `keys: {entry -> key}`, the
  only reader is `api_key_for(entry)`, and `model.rs` looks the key up by the name of the entry it
  just resolved the URL from — so a key physically cannot ride a call to another entry's origin.
  Before this, entering a key under `openrouter` and switching entries sent that key to
  `api.openai.com`, `api.anthropic.com` and `127.0.0.1`. Pinned by
  `a_key_saved_for_one_entry_is_not_sent_to_another`, and walked in the page: `openrouter` reads
  "a key is saved for openrouter" while `openai`, `local` and `sonnet` each read "leave empty".
- **The single key already stored is migrated, not dropped.** A profile carrying the old
  `api_key` string lands on the entry it was last used with — the explicit pick, or the default it
  silently was. `a_single_stored_key_migrates_onto_the_entry_it_was_used_with`.
- **There is a way back.** `Reset to the catalogue default` clears the pick, the overrides and every
  saved key, and says so. The walker previously had to delete the IndexedDB database.
- **Layout is the schedule, and `parse_batches` is the reference.** Calls on one line are one batch;
  a newline starts the next. `step` emits the batches' effects IN ORDER and asks the model again
  only when the last result of the last batch has landed (`pending_tools` reaching zero). Within-
  batch concurrency is invisible on a single-threaded host — it becomes real with Workers (06), and
  the ordering guarantee this ships is the stronger one either way.
- **Unreadable arguments are refused, never delivered empty.** `Call.args_error` is a typed field
  rather than the Python's `__arg_error__` sentinel key, so "a call whose arguments could not be
  read" is unrepresentable as "a call with no arguments". The refusal quotes the tool's own
  `usage()`, which is what lets the model rewrite the call — proven end to end in
  `an_unreadable_call_is_refused_and_the_model_can_correct_it`: unescaped quotes, refusal, corrected
  call, answer.
- **One deliberate deviation from the Python parser:** the argument scan is brace- and string-aware,
  so a NESTED JSON object is read rather than refused. The Python regex (`\{.*?\}`) stopped at the
  first `}` and refused it — refusing an argument a real MCP tool would send is a bug, and the
  refusal machinery is unchanged for everything else.
- **A usage line is generated from name, description and argument names.** `Tool::new(name, desc,
  args)` builds it; nobody writes one by hand, so a sub-agent (`Tool::from_engine`), a built-in and
  a future script tool read identically to the model (I9).
- **Tools reach the model only through the phase and the Document.** `PhaseId::Work` now carries
  `ResponseContract::ToolEnvelope` and `ToolScope::Only([now, list_agents, read_agent])`; `step`
  rewrites the `affordances` and `response_contract` sections from exactly that scoped toolbox
  before assembling. There is no prompt string in the codebase that names a tool (I13), and a phase
  granting `None` renders no tool at all.
- **`parse_reply`'s `ToolEnvelope` contract is real, and total:** text with no call in it is the
  answer that ends the turn, which is what keeps "just answer me" a legal reply under a tool phase.
- **Declaration and execution are split the way modules are.** `agent::builtin_tools()` declares
  descriptors; `core::tools::run` is the ONE place a tool runs, matched by name like
  `dispatch::builtin_entry`. A declared tool with no executor refuses as an unknown tool instead of
  pretending to have run. Tools execute synchronously in `drive` because all three read local state;
  the first networked tool goes through `execute_effect`'s async path instead.
- **`ToolInvoked` carries `args`.** A trace without what the tool was asked is not a trace. The
  `/tools` route projects those events and the `ToolTrace` component renders them — refusals
  included, in the same `ToolResult::line` the model read.
- **A looping model terminates on a counter, not on prose.** `MAX_TOOL_ROUNDS = 4`; the fifth round
  ends the turn with a `core.note` fact the chat pane shows.
- **The four remaining walk findings, closed.** The chat sub-line now reports what will ACTUALLY be
  called (read from the broker, not from the agent file's `model:` key — `core/chat.rs` no longer
  prints a model at all). Selecting `sonnet` refuses at selection instead of promising a call that
  fails one send later. The pane three messages call "Settings" is now titled Settings. Placeholders
  and values come from the selected entry. Each failure disclosure is named for its own failure
  (`Technical detail — the endpoint was unreachable`).

### Increment 06

- **A Worker IS the private event loop.** The Python gives every agent its own thread with its own
  `asyncio` loop because an agent's resources belong to the loop that created them; the browser has
  exactly one equivalent, and `ARCHITECTURE §10` + ADR-008 already chose it. Each agent gets a
  dedicated Worker running its own Wasm instance of the SAME build (`AgentWorker::boot`), reached
  only by `postMessage`. There is no shared memory to be tempted by, and one agent's slow turn
  occupies only its own thread — verified in the page: the board repainted every 400 ms while
  `researcher` spent twelve seconds generating.
- **The `Send` bound stayed off, and this was the promised revisit.** `kernel::ports` marked
  `BoxFuture` PROVISIONAL — "revisit if a port is ever driven from a second host thread". It now is,
  and the bound is still not needed: a Worker is a separate JS context with its own Wasm instance,
  so nothing Rust-side is shared across threads; the only thing that crosses is a structured-cloned
  message. The comment says so instead of pretending nobody checked. `cargo check --target
  wasm32-unknown-unknown` compiling `AgentWorkers` (which holds a `!Send` `web_sys::Worker`) behind
  `dyn AgentPort` is the proof.
- **`AgentPort` is a sixth port, not a field of Worker handles.** The core names an agent and waits
  for an answer; it cannot reach into that agent's loop, its engine or its state even by accident —
  which is the property the Python gets from marshalling onto the owning loop. `ScriptedAgents` is
  its host fake, so every delegation rule tests with no browser (I3).
- **The board is a FOLD of `AgentStatus` facts, not a table somebody writes.** `App::append` is the
  single place a status moves, so what a person watched and what the log says happened cannot
  disagree (I8). Registration is deliberately NOT an event: a reload is a new process and starts
  everyone fresh, which is also why replaying an old log cannot leave a stale `working` on the board.
- **`turns` counts entries to Working and nothing else,** and `Waiting` is only ever the entry agent
  — a sub-agent goes back to `Idle` because its caller already has what it asked for. Both are the
  Python's rules, both have their own host test, and both are visible on the board in words.
- **A failed turn is `Failed` WITH the message.** The Python's `ThreadedAgent.invoke` records
  `str(e)`; here the entry agent does too, and the quiescence rule only moves an agent OUT of
  Working, so "waiting for you" can never erase a failure. Found by walking the hosted page: before
  this, the loopback refusal left `main` reading "working — inside a turn" for the whole session.
- **The seam spawns a `drive` per request, so `drive` must be re-entrant.** Two bugs came out of
  that and both are fixed with the reason written down: a `RefCell` guard held across an await
  (`execute_effect(&app.borrow().ports, e).await` keeps the borrow alive for the whole model call,
  and the chat pane's 400 ms poll starts a second `drive` inside that window — instant panic, page
  frozen), and a second `drive` finding nothing pending and reporting the agent as waiting in the
  middle of its own turn.
- **The frontmatter `tools:` list now decides the toolbox, which is the honest fix the Agents card
  demanded.** `ToolScope::Only([…])` hardcoded in the phase table meant the file said one thing and
  the model got another — the card read `tools:` and printed "no tools yet" about an agent with
  three. Work's scope is now `All`, meaning "this agent's own toolbox", and `subagent::toolbox_for`
  builds it by the Python's rule: an EMPTY list is every built-in, a named list is a filter over
  built-ins and peers together, and a peer is attached ONLY when named — the summarizer is nobody's
  tool by default. The card prints the resolved list, so it cannot be wrong without the model being
  wrong too.
- **A sub-agent is checked twice.** Once as any tool, and again for a goal it can work from.
  `goal_from` takes `query`, or whatever single string the caller did write (a model that says
  `{"task": …}` meant the same thing), and refuses when there is nothing usable — because a
  sub-agent cannot tell an empty goal from a hard one and will answer either way. Proven in the
  browser: `researcher({})` renders `REFUSED` and the Worker was never messaged.
- **One line of calls is one batch, and now that is true in both halves.** `Effect::Delegate`
  carries the line it was written on; `batch::run_effects` awaits a run of same-line delegations
  together and the next line only afterwards, with results appended in WRITTEN order so the
  transcript stays reproducible. Increment 05 shipped the ordering half; Workers are what make the
  concurrency half real. Pinned on the host; two sub-agents running at the same instant is not yet
  demonstrated in a browser (the local model would not write two calls on one line).
- **A sub-agent's store is in memory, not IndexedDB.** Sharing the page's database would replay the
  lead's whole history into every sub-agent and fight it for the `events/` keyspace. A sub-agent's
  own persistent log is increment 08, and this is the honest scope of what a delegation needs today.
- **The Worker is handed its world, it does not re-fetch it.** Agent files, catalogue and endpoint
  profile ride the boot message: one page, one download, and a sub-agent calls the endpoint the user
  configured on the page it was opened from. A same-origin Worker is inside the same trust boundary
  as the page that spawned it (ADR-006).
- **One build, two entry points.** `main()` returns immediately when there is no `window`, because
  the Worker imports this same bundle for its exported `AgentWorker` rather than to mount a UI. One
  `if` beats a second binary, a second wasm-bindgen target and a second thing to keep in sync.
  `FetchModel` reaches `fetch` off `globalThis` for the same reason — `web_sys::window()` is `None`
  in a Worker, so reaching for the window there would mean a sub-agent could never call a model.
- **`agent-worker.js` is the third fixed-name file whose content changes with a deploy,** so the
  service worker serves it network-first beside `/agents/` and `models.json`, and `publish.sh` gates
  on it: a deploy without it is a page with no sub-agents at all.
- **The nine walk findings, closed.** (1) The button row wraps and no control may exceed its row —
  at 390px `scrollWidth == innerWidth`, measured hosted. (2) A tool call says `RAN` or `REFUSED` in
  a word, with `data-outcome` beside it; colour is the second signal, never the only one. (3) The
  Agents card prints the resolved toolbox (above). (4) Saving the values the pane PRE-FILLED now
  pins nothing — a field equal to the file is agreement, not an override — so a later `models.json`
  edit reaches a user who pressed Save, pinned by `saving_the_prefilled_values_pins_nothing`. (5)
  "leave empty for a local server" is decided by the ADDRESS, not by `api_key_env` (every entry
  names one, including `local`). (6) Failures are numbered: "Technical detail for failure 3 — the
  endpoint was unreachable". (7) A refusal is styled as the blocking condition it is, with
  `role="status"`. (8) Long tool output is `tabindex="0"` with a `role`/`aria-label` naming which
  tool it came from. (9) The trace says what it is: read back from the stored log, still there after
  a reload.
- **Known overrun:** `crates/core/tests/delegation.rs` is 213 lines against the 200-line rule,
  alongside the pre-existing `core/tests/skeleton.rs` (290) and `context/tests/fixture/mod.rs`
  (210). Every source file is inside the rule.

### Increment 07

- **A conversation is a projection of the log SCOPED TO ONE AGENT.** `UserMessage` and
  `ModelReplied` carry the agent they belong to; `/chat` takes an `x-agent` request header and
  folds only that agent's facts. Histories cannot cross because the fold never reaches the other
  one — not because a filter was remembered in the UI. An empty `agent` means "this process's own
  agent", so every log written before this increment still reads correctly, and a sub-agent's
  Worker (which IS `researcher`) needs no special case.
- **`App` now knows WHICH agent it is** (`App::me`, set by `install_agents_as`). The page is
  `main`; a Worker is its own agent. `drive` and the failure path used the `ENTRY_AGENT` constant
  before, which meant a Worker was writing `main`'s status into its own log.
- **A message addressed to another agent is never pumped.** `drive` routes it to that agent's
  Worker instead, so nobody else's words can enter this agent's paper. That is the structural
  half of "histories must not cross"; the projection is only the visible half.
- **A delegated turn belongs to the sub-agent.** `batch::run_on` is the one place another agent
  takes a turn, and it records the goal and the answer in THAT agent's history whether a person
  typed it or the lead called it as a tool. `UserMessage.from` says which: empty is a person, a
  name is the agent that delegated — a transcript that labelled a lead's delegation "You" claimed
  the reader asked a question they never typed.
- **Who a person is talking to is a first-class fact, not a colour.** One `ChatPane` per agent
  (the same component, a `ReadSignal<String>` prop — never a mode flag), a tab strip carrying
  `aria-current`, the heading read from the PROP so it names the new agent before the transcript
  arrives, and the composer's accessible name already naming the agent.
- **`Waiting` vs `Idle` is about who speaks next, not about the name `main`.** Ask `researcher`
  yourself and it ends `Waiting` on YOU; let the lead ask it and it ends `Idle`, because its
  caller already has the answer. That is the Python's `entry` flag, which was never about a
  particular agent.
- **The status enum is now honest.** `Starting` is real and observable: `install_agents_as` leaves
  every peer there and only a Worker's own `{kind:"ready"}` message moves it to `Idle`. A Worker
  that cannot be constructed lands in `Failed` WITH the reason (before: a bare `console.warn` and
  no status write, so an agent with no Worker at all rendered "idle — nobody has called it").
  `Closed` is assigned by `close_all`, which has a real caller: saving a new endpoint stops every
  Worker and starts it again, because a Worker is handed its profile once and cannot learn a new
  one — without that, sub-agents kept calling the old endpoint while the page called the new.
- **Lifecycle facts are queued, not written from a JS callback.** `AgentWorkers` collects them and
  `WebApp::handle` drains them through `core::report_agent`, so a status still moves through the
  one append door (I8) and a callback can never re-enter a borrowed `App`.
- **The board owns one clock, and only for boot.** A Worker comes up on nobody's schedule; an idle
  page would have sat on "starting" until you typed something. `x-settling` says the board is not
  final yet and the pane re-asks every 400 ms for at most 12 s, then stops.
- **A sub-agent's failure carries its cause across `postMessage`.** `AgentWorker::run` reads
  `core::last_failure` — the same sentence the page would have shown for its own turn — instead of
  discarding the error and returning "<name> produced no answer". `js_message` also stopped
  wrapping a rejected string in `JsValue("…")`.
- **The turn counter is replayed, not reset.** `install_agents_as` counts entries to `Working` in
  the replayed log and restores them, and an agent whose last recorded status was `Failed` comes
  back failed with its message. A reload is still a new process — nobody is left `Working`.
  Known asymmetry, deliberate: a PEER's restored failure is overwritten the moment its new Worker
  reports ready, because a fresh Worker really is idle; the failure stays in its transcript, which
  is where a person reads it. `main` has no Worker, so its failure survives.
- **Selecting a model is not saving one.** The picker now says "Showing openrouter — NOT saved.
  The next turn still calls local until you press Save endpoint.", styled as the blocking
  condition it is, because the card relabelled itself around the pick while the chat pane above
  correctly still named the saved endpoint.
- **The Agents card separates peers from built-ins** ("tools: now, list_agents, read_agent, agents
  it can call: researcher"). One list is right for the MODEL, which is never told which is which;
  it is wrong for a person, for whom calling `researcher` means handing a goal to another Worker.
- **The transcript names the speaker in words** (`You: …`, `main: …`), so a page with no
  stylesheet is still a readable conversation rather than a stack of identical paragraphs.
- **Transport failures stop blaming a local address they did not call.** `ModelError::Transport`
  carries the URL it tried; the sentence names Chrome's Local Network Access prompt only for a
  loopback address and CORS/DNS for anything else. Calling `https://198.51.100.7/v1` hosted now
  reads "the host must resolve and answer from this browser, and it must send CORS headers
  allowing this page's origin."
- **Known overruns (unchanged in kind):** `crates/core/tests/skeleton.rs` (290),
  `crates/core/tests/delegation.rs` (217, +4 this increment),
  `crates/context/tests/fixture/mod.rs` (210). Every source file and every new test file is inside
  the 200-line rule; `chat.rs` was split into `chat.rs` + `transcript.rs` and `workers.rs` into
  `workers.rs` + `spawn.rs` to keep it that way.
- **Not done here:** a sub-agent's own PERSISTENT log is still increment 08. A Worker's store is
  in memory, so within one page session a sub-agent's engine DOES carry its own conversation from
  turn to turn — but a reload gives it a fresh Worker with an empty paper. What survives the
  reload is the PAGE's record of that conversation, which is what every pane projects and what a
  person reads; the agent itself starts the next turn without it. That is the same scope 06
  shipped, and 08 is where it changes.

### Increment 08

- **Compaction produces an artifact; assembly only reads it back.** I14 says `assemble` is pure and
  golden-tested, and `RESEARCH.md` says summaries must be precomputed artifacts in `State` — a pure
  assembler cannot author one. So `step` never summarises: when the window reaches `compact_at` it
  emits a model call whose reply IS the summary, and the summary is written into the window before
  the turn the person asked for is taken. `assemble` still never calls a model.
- **The summarizer is an ordinary agent, not machinery.** Its `public/agents/summarizer/agent.md`
  body is the system block of the compaction call and its `model:` key is what the call is made
  with, both read off the peer of that name at `adopt_spec` — the Python registry's rule exactly
  ("the summarizer is nobody's tool; it is what every other engine hands its history to"). The call
  carries a `speaker` (`Effect::CallModel.speaker`), so the reply is logged as `ModelReplied { agent:
  "summarizer" }` and can never be mistaken for this agent's answer: `core::answer` skips it, and it
  lands in the summarizer's own conversation, where it is readable.
- **It is a MODEL call, not a delegation.** A sub-agent's Worker has no `AgentPort` (one level deep,
  so a cycle cannot exist), so routing compaction through `delegate` would have meant no sub-agent
  could ever compact — and it would have written the whole transcript into the summarizer's visible
  history as a question somebody asked it. The summarizer's paper is built fresh, toolless and with
  an empty history: it reads the transcript and nothing else, so the calling agent's prompt and
  tools cannot steer it (Python `compact`).
- **The window arithmetic is pinned against the Python's OUTPUT, not against a reading of it.**
  `core/engine.py` was run with a stub summarizer at `compact_at=6, keep_recent=2`; the transcript it
  handed over, the window it kept (`[system "Summary of the conversation so far:\n…", m5, m6]`) and
  its `len(messages) <= keep` no-op are what `crates/agent/tests/window.rs` asserts.
- **One ordered queue is what makes "drain before the rewrite" true.** `App.unlogged` holds
  `Append`s and `Rewrite`s in the order they became due; a compaction's rewrite is pushed BEHIND the
  appends already waiting, and `drive` drains in order. That is the Python's `_rewrite_log` awaiting
  every in-flight append before replacing the file — "letting it land afterwards would put it below
  the summary that already covers it" — and it is asserted on the op sequence, not inferred.
- **`KvStore::replace_prefix` is the atomic tmp-then-replace.** IndexedDB does it in ONE readwrite
  transaction (delete the range, put the new entries); the trait's default body does the same writes
  separately, so a store that cannot be atomic still ends up with the right content (I15).
- **Each agent's log is keyed by the agent** (`log/<name>/<nnnnnnnn>`), the way the Python gives
  each agent its own folder, and a sub-agent's Worker now opens its OWN IndexedDB database
  (`harness-agent-<name>`) instead of a HashMap. Sharing the page's database would have replayed the
  lead's whole event log into every sub-agent and fought it for the `events/` keyspace; a database
  per agent is one string. `IdbStore` now takes its factory from `WorkerGlobalScope` as well as
  `Window`, which is what makes that possible at all.
- **A reload is a new process but not a new conversation.** `core::restore_log` reads the stored log
  back into the window at boot, for the page and for every Worker. This closes the item increment 07
  left open: a sub-agent's own history now survives a reload, verified by continuing a compacted
  conversation across one.
- **Preloading is the default here, not opt-in.** The Python's `preload_history` is opt-in because a
  new run usually wants a clean slate; a browser RELOAD is not a new run, and an agent that forgot
  everything on refresh while the screen still showed it would be the same lie the transcript/board
  split was in 07.
- **The pane says what the agent HOLDS, not just what is on screen.** After a compaction the
  transcript still shows every turn and the window does not, so the chat header carries one line —
  "Working memory: 5 entries — the oldest turns are now a summary the summarizer wrote" — with
  `data-window` and `data-compacted` on it. Only for this process's own agent: another agent's
  window lives in its Worker, and a guess would be a made-up number.
- **`compact_at`/`keep_recent` are frontmatter keys** (Python forwards any `Engine` field), refused
  rather than defaulted when they are not whole numbers. The shipped files are `main` 8/3 and
  `researcher` 6/2 rather than the Python's 75/24: a 75-entry window is far past what the local
  gemma this project is walked against will take, and a setting nobody can reach is a setting that
  is never tested. `summarizer` keeps its own `compact_at: 0` — it never summarises itself.
- **One failure, one presentation** (07b finding 1). `core.error` and `core.agent_error` now render
  through the same card with the same "Technical detail for failure N — <kind>" disclosure, and a
  sub-agent's Worker sends back the TYPED payload rather than the rendered sentence, so the cause is
  reachable from a sub-agent's turn exactly as it is from the page's. The board still gets the
  sentence, because a status row is one line read at a glance. Records written by older builds carry
  the sentence instead, and still render as that sentence.
- **The tab strip is a real ARIA tablist** (07b finding 2): `role="tablist"`/`role="tab"`,
  `aria-selected`, roving tabindex, ArrowLeft/ArrowRight with wrap-around, Home and End, automatic
  activation, `aria-controls` to a `role="tabpanel"` chat pane named by its tab. A screen reader now
  hears "tab, main, selected" where it heard "button, main".
- **The plain fallback answers "which tab am I in?" on its own** (07b finding 3): `aria-current` and
  `aria-selected` get no UA styling, so the current tab is now marked `▸` and its name is a
  `<strong>` — both visible with every stylesheet removed, which was checked by removing them.
- **Not done here:** the summarizer's `stateless: true` frontmatter key is still ignored — nothing
  routes a turn through its Worker, so it has no history to be stateless about. Compaction of a
  sub-agent's window was verified through its own pane; a compaction that fires DURING a delegation
  is the same code path and was not separately driven. A live hosted compaction needs a reachable
  model, which the hosted origin still does not have (02's row).
