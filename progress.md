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
| 08 | Per-agent logs, the rolling window and the built-in summarizer — plus the three 07b walk findings | 93 green (83 + 6 window/compaction + 4 per-agent log) | fresh install, real omlx on 8873: four turns drove `main` past `compact_at: 8` and the SUMMARIZER AGENT compacted it live — the window went 7 → 5 with `data-compacted="true"`, and the stored `log/main/*` in IndexedDB is exactly that window (summary + `keep_recent: 3` tail); a reload rebuilt the same 5; `researcher` did the same INSIDE ITS OWN WORKER against its own database (`harness-agent-researcher`, `log/researcher/*`), compacted at 6, and after a page reload its next turn continued from the restored window rather than an empty paper; the ARIA tablist answers ArrowLeft/Right (wrapping), Home and End with a roving tabindex | ⬜ pending `ux-walker` | `87780ee` | Live at https://kaush4l.github.io/ASKK/. HOSTED (bundle hash in `index.html` checked against `dist/` — `ui-5f603ad7507e1067.js`, matched on the third poll): `crossOriginIsolated: true`, three tabs read `tab, main, selected` to a screen reader, the memory line renders, and BOTH failures at the loopback boundary now render as the SAME card — `main`'s and `researcher`'s are byte-identical sentences with the identical `Technical detail for failure 1 — the endpoint was unreachable` disclosure, the sub-agent's carrying the typed payload its Worker sent across `postMessage`. With every stylesheet removed the current tab reads `▸ **researcher**` while the others are plain. NOT demonstrated hosted: a live compaction — it needs a reachable model, and the hosted page still dies on Chrome's Local Network Access gate (02's row). **CORRECTED by 09:** the hosted bundle for this row was `ui-879974ab6513cd49.js` (gh-pages `deploy 87780ee`); `ui-5f603ad7507e1067.js` above is 07b's bundle, written into the 08 row by mistake — the row's verdict stands, the hash did not. |
| 09 | Shared spaces: facts, an attributed noticeboard and a named workspace, one space across Workers — plus the six memory findings from the 08 walk and the ledger correction | 109 green (93 + 9 space rules on the host + 5 through the whole seam with two Apps on one store + 2 memory line) | fresh install, real omlx on 8873 (127.0.0.1:8901 → dist): `main` delegated to `researcher` with the goal 'record omlx port = 8873 with remember, then post_note', and the Shared space panel went `0f/0n → 1f/1n` WHILE `researcher` was still `working` — a write from another Wasm instance, seen with nobody told to look; `researcher`'s turn count moved 0 → 1, so the fact was recorded by the sub-agent and not by the lead. The next turn — "what port is omlx on, and what note did the researcher leave? Both are in the CONTEXT block" — answered `The omlx port is 8873, and the researcher left the note "checked the models endpoint."` with `researcher` still at 1 turn and the tool-call count still at 1: answered from CONTEXT, delegating to nobody. The note renders `[researcher] checked the models endpoint.` — attributed by the tool, never by the model. Four turns on `researcher` then crossed its `compact_at: 6`: its pane read `Working memory: 4 of 6 entries — the oldest turns are now a summary the summarizer wrote; compaction runs at 6 entries and keeps the newest 2. Nothing was lost: the transcript below still holds every turn.`, with the summary itself readable behind `The summary that replaced the oldest turns for researcher`. | ⬜ pending `ux-walker` | `9bd5523` | Live at https://kaush4l.github.io/ASKK/ — hosted bundle `ui-8b9480ef9f17ddd4.js`, matching `dist/` and `gh-pages deploy 7a21cbf`. HOSTED, after wiping IndexedDB, caches and the service worker: `crossOriginIsolated: true`, no console errors, six panels including **Shared space**, and the four databases the design implies (`harness`, `harness-agent-researcher`, `harness-agent-summarizer`, `harness-spaces`). A model is still unreachable from the hosted origin (02's row), so the hosted walk goes up to the loopback boundary: a fact and a note written into `harness-spaces` FROM PAGE JS — outside the Wasm instance entirely, which is exactly what another Worker is — appeared in the inspector within one pass (`1f/1n`, `[researcher] wrote this from another context`) and survived a reload. The Agents card lists `remember, forget, post_note` in both agents' resolved toolboxes, so it cannot disagree with what the model is told. |
| 10 | The Alpine workspace: CheerpX behind `WorkspacePort`, an `exec` toolbox gated on the agent's space, a Terminal pane, and the five findings from the 09 walk | 122 green (109 + 6 workspace rules on the host against a fake shell + 3 walk findings + 3 pure unit tests, +1 in-place: a typed command must not read as a turn) | LOCAL (127.0.0.1:8901 → dist, COI on): first command in a fresh page with an empty overlay boots the Linux and returns in **2.2–4.2 s** — `uname -a` → `Linux 4.15.0-54-cheerpx i386 Linux`; after a reload, with the overlay already in IndexedDB, boot **and** the command take **1.2 s**. `awk 'BEGIN{s=0;for(i=0;i<3000000;i++)s+=i;print s}'` runs in **6.1 s** in the VM (twice, warm, ±0.05 s) against **0.073 s** natively — **≈84×**. With the real omlx on 8873 the AGENT wrote a file: `write_file({"path": "agent-note.md", "contents": "increment 10 works."})` → `wrote agent-note.md`, and after a reload `ls -l; cat agent-note.md` showed it still there beside the `proof.txt` written from the terminal. | ✅ HOSTED, walked here: boot + `uname -a` + `echo hosted-proof > hosted.txt` in **2.2 s** on the deployed page, then a full reload and `cat hosted.txt` → `hosted-proof` in **1.2 s**. `crossOriginIsolated: true`, no console errors, the CheerpX credit visible in the pane. | `68b5fd1` | Live at https://kaush4l.github.io/ASKK/ — hosted bundle `ui-b8f5f684d2845a26_bg.wasm`, sha256 `03c67b83…6ea13b`, byte-identical to `dist/`. The VM has nothing to do with the model endpoint, so unlike every row since 02 the hosted journey is the WHOLE journey. **The engine is 1.3.1, not the 1.2.8 the research quoted**: with 1.2.8 `CheerpX.Linux.create` never resolved on this Alpine image — measured twice at a 120 s timeout, no error, no console output; 1.3.1 mounts the same image in 2.2 s. A sub-agent's Worker has no workspace and says so (see Decisions). |
| 11 | Agents authored in the browser: written, live-edited, exported and deleted — plus the create-agent superagent, and the four findings from the 10 walk | 140 green (122 + 5 export/round-trip/native-tool-calls + 10 authoring through the seam + 3 walk findings) | LOCAL (127.0.0.1:8901 -> dist, COI on), real omlx on 8873: an agent.md TYPED IN THE PAGE became `note-taker` with its own tab and its own Worker with no reload; it answered `I have noted that the deploy is scheduled for Tuesday.`, survived a reload, and answered `You said the deploy is on Tuesday.` from its restored window; its prompt was then EDITED in place and the very next turn obeyed the new one (`MEMO: I am tracking the deployment schedule.`) with all three earlier turns still in the transcript; the `author` superagent was given "write me an agent called haiku-writer" in plain English, wrote the folder, installed it live (`haiku-writer:authored` appeared in the list on the third poll with no reload), and the agent it made then answered `Steel limbs move through ferns, / Silent gears in ancient woods, / One spark in the deep.`; deleting an authored agent removed it and refusing to delete a shipped one named the reason; the VM booted and ran, the scrollback ended pinned at `scrollTop=4714, scrollHeight=5066, clientHeight=352` with `200` the last line on screen, and the fourth command in a booted VM said `running…` and not `boots the Linux` | ✅ HOSTED, walked here on `ui-5486c3e1ee3ac16b_bg.wasm`: `crossOriginIsolated: true`, no console errors, five panels plus **Write an agent**. Wrote `hosted-scribe` from the textarea — appeared as `hosted-scribe:authored` beside four `:shipped` agents with no reload, survived a full reload, loaded back into the editor as the same `agent.md`, gained a real shell the moment `space: research` was added to it (the card said so in words), and was deleted back out again; `main` refused deletion with "it comes from this deploy's public/agents/ folder". The VM booted and ran `uname -a` in **3 s** and `seq 1 200` left the pane scrolled to `200`. Creating, editing, exporting and deleting are pure browser work, so the whole of that is hosted; only the superagent needs a model, and it was driven locally against omlx | `47ef002` | **`ux-walker` FAILED this row (10 findings); 11b is the answer to it and 11 does not close until 11b is walked.** Live at https://kaush4l.github.io/ASKK/ — hosted bundle `ui-5486c3e1ee3ac16b_bg.wasm`, sha256 `a6c7a411…`, byte-identical to `dist/`. **This closes the parity table.** An authored agent is not a second kind of agent: it is the same `agent.md`, held as a fact in the event log instead of as a file on a static host, so it replays at boot, deletes as another fact, and exports to bytes that drop straight into `public/agents/` (round-tripped against all four shipped files on the host). **A bug found by the walk and fixed here:** omlx answers a prompt whose affordances mention tools with a NATIVE `tool_calls` message and no `content`, which this build read as "unrecognizable completion body" and threw away — the superagent could not take a single turn. `openai_reply_text` now renders `tool_calls` into the one text call syntax the parser reads, so a call the model really made is not discarded. |
| 11b | `ux-walker` FAILED 11: the authoring pane was a 24-px sliver and the page's only source of horizontal overflow; `tools: now` silently granted every built-in; the identity line went stale across a swap; `Stop waiting` did not release one — plus six lower-severity findings from the same walk | 148 green (140 + 6 findings-11b through the seam + 2 spec: a tools line that is not a list is refused, an empty frontmatter name falls back to the folder) | LOCAL (127.0.0.1:8899 -> dist, COI on): the authoring textarea measures **670 x 282 px at 1440** (was `{"s":"#agent-md","w":24,"h":282}`) and `document.scrollWidth` is **390 at 390 px** with **0 controls past the right edge** (was 635); `tools: now` is refused in the pane with the repair in the message; authoring an override of `main` moved the chat header to the new description with no turn in flight and no reload, and deleting it moved it back; against a genuinely hanging endpoint (a socket that accepts and never answers, proxied same-origin) a prompt saved mid-flight stayed deferred, and `Stop waiting` ended the turn — board `working` -> `waiting for you`, composer re-enabled, and the deferred swap installed within one 400 ms poll; with `shellguy` or `summarizer` selected the Run box and its input are disabled and the pane says the box is `main`'s shell | ✅ HOSTED, walked here on `ui-fec6d1f59299cdbb_bg.wasm`: `crossOriginIsolated: true`, no console errors, textarea **670 x 282 at 1440**, `scrollWidth` **390 at 390** with 0 off-screen controls; `tools: now` refused; a folder name that disagrees with the frontmatter refused by name; an EMPTY frontmatter `name:` saved as the folder (`hosted-11b`), its card read "Written by you in this browser" and its board row "written in this browser" (not "from public/agents/"), Delete was live for it the moment it saved and dead again after it was removed; with `shellguy` selected the Run box is disabled and the note names whose shell it is | `4656a85` | Live at https://kaush4l.github.io/ASKK/ — hosted bundle `ui-fec6d1f59299cdbb_bg.wasm`, sha256 `fcb32b42…89d59f`, byte-identical to `dist/`. **11's row was a FAIL — this row is the answer to it, and 11 does not close until this one is walked.** WHAT CHANGED: (1) a `form` now STACKS by default and the two one-row forms say `class="oneline"` — the base layer had `display:flex` with column as an opt-in the authoring form never took, which is why the sliver appeared in the plain skin too. (2) `spec.rs` REFUSES a `tools:` value that is not a list, exactly as it already refused `compact_at: lots`: a dropped tools line left the list empty, and empty means every built-in including `write_agent` — the one direction a silent default must never fail in. The blank template's `tools: []` now carries a comment saying it is the maximal grant. (3) The chat header is part of the transcript projection, and `ChatPane` re-projects on a memo of the roster listing, so an installed swap moves the header the same tick it moves the card. (4) `POST /chat/stop` records `core.turn_stopped`; `drive` clears the task on it exactly as a failed turn does, so the swap `reconcile` was deferring lands — and `reconcile` now also defers while an utterance is ACCEPTED but not yet pumped, a window the browser hits at ~100 ms and the host tests missed. (5) The board's origin is one rule with three answers (`built in to this build` / `from public/agents/` / `written in this browser [by <agent>]`). (6) The "Folder name" field decides the folder: an empty frontmatter `name:` falls back to it, and a field that disagrees is refused rather than ignored. (7) Delete is enabled exactly when the name is in this browser's authored set — live the moment you save, dead for a shipped agent. (8) The pane says committing an export takes two steps, the second being `public/agents/index.json`. (9) A typed command for another agent is refused at the route and the box is disabled, off an `x-typeable` header — it was `main`'s shell wearing another agent's label. (10) WHO wrote an agent is on the record (`[name, text, author]`, older two-element records replay as the person's), so a card reads "Written by you" or "Written by the main agent" — the walker's decision: a model-authored agent carrying a `space:` must not be indistinguishable from your own work. |
| 12 | The AAA layer — "make the machinery visible": a machine skin driven entirely by state the core already projects, behind a permanent plain-skin toggle; plus the four honesty findings the walk raised first | 151 green (148 + 3 `findings12`: a turn on an UNSELECTED agent is visible and says keep-asking; `starting` is watchable but not busy; the conversation names who wrote this agent and what its space granted) | LOCAL (127.0.0.1:8931 -> dist, COI off, real omlx on 8873): a turn sent on `summarizer` then abandoned for `main` moved `working` -> `waiting` **unattended**, no click, in the first 2 s poll after the model answered — the 120 s lie is gone; one message to `main` drove the whole machine on screen as it happened — `researcher` went `idle -> working -> idle` in its own Worker, two `.tool-call` blocks appeared with their arguments and results (`researcher(name one fact about the printing press)` and `exec({"command": "uname -a"})` -> `Linux 4.15.0-54-cheerpx i386 Linux`), and the Terminal streamed the same command from the real CheerpX VM; a prompt override of `main` saved MID-FLIGHT installed while sitting on `summarizer`'s tab, first poll after the turn ended, card and tab both moved with no interaction | ✅ HOSTED on `ui-2f2fb130a1ea5577_bg.wasm`, `crossOriginIsolated: true`, no console errors (one pre-existing trunk `integrity` preload warning) — measured on the deployed page: `scrollWidth == clientWidth` at **360 / 390 / 768 / 1440** in BOTH skins; contrast on the machine skin body ink **16.61:1**, accent headings **7.59:1**, dim notes **9.76:1**, button ink on accent **7.20:1**; on the plain skin **16.00 / 7.31 / 9.40 / 7.20**; the toggle survives a reload in both directions (`localStorage askk.skin` = `plain`, then cleared, and `aria-pressed` follows); tablist arrows/Home/End and the roving tabindex intact (`-1,0,-1,-1`), focus ring `3px rgb(185,140,255)`, the busy line carries `role="status"`; every control >= 44 px at 390 px except the inline CheerpX credit link inside a sentence (16 px, pre-existing, WCAG 2.2 2.5.8 inline exemption); the VM booted and streamed on the hosted page in **5 s** (`uname -a && echo hosted-12-proof` -> `Linux 4.15.0-54-cheerpx i386 Linux` / `hosted-12-proof`) | `3418415` | Live at https://kaush4l.github.io/ASKK/ — hosted bundle `ui-2f2fb130a1ea5577_bg.wasm`, sha256 `a3cd67dc…a60850`, byte-identical to `dist/` along with `aaa-d6b138428bf39523.css`, `board-52c13ce23e1a4cda.css`, `theme-11a182d959b81353.css`, the glue JS and `index.html`. GitHub Pages took **~4 minutes** to serve the new build after the push, which is longer than any earlier row; the hashes above were checked only once it had. **Nothing in the layer is decoration over a form: every selector hangs off an attribute the core already wrote** — `data-status` from the fold of `AgentStatus` facts, `data-origin` from the authored set, `:empty` on the busy live region — so the one row that sweeps is the one agent really inside a turn, and there is no state in CSS the log does not have. `prefers-reduced-motion: reduce` stops the sweep and the pulse and KEEPS both gradients, verified live in the CSSOM of the deployed stylesheet. **The two board bugs were one bug** and it is fixed on the host: see Decisions. |
| 12b | `ux-walker` FAILED 12: a mid-turn reload killed that agent's chat pane permanently, and `Stop waiting` froze the counter without ending the turn — plus the increment-01 placeholder panel, a dangling em dash, and the `starting` sweep; then the five design changes the walk asked for by name ("make the machinery visible" → make it an instrument) | 155 green (151 + 4 `findings12b`: a turn replayed with nothing driving it is over; a turn something IS driving is still pending; Stop ends the turn on a Worker's pane too and in ONE conversation; an agent with no description has no dangling dash) — plus two rewritten `skeleton` assertions: the root page now has no placeholder at all | LOCAL (127.0.0.1:8941 -> dist, COI on): the walker's own repro, from wiped storage, against a socket that accepts and never answers (proxied same-origin so it hangs rather than failing at CORS) — send on `researcher`, reload at 3 s, select `researcher`: composer **live** (`Send`, `disabled:false`), **no clock**, and the transcript says `That turn is not running any more — the page was reloaded while it was in flight, so nothing is driving it. Nothing was lost; ask again.`; `Stop waiting` pressed at 4 s on that same Worker's pane released instantly and was still released 6 s later; a REAL turn against omlx 8873 drove the whole machine on screen — `main:working` + `researcher:working` at once, the live row reading `in this turn for 12s · last tool: exec`, two `.tool-call` blocks and the CheerpX `uname -a` in the rail beside the conversation that caused them | ✅ HOSTED on `ui-a2a764acc16fec94_bg.wasm`, `crossOriginIsolated: true`, **zero console errors** (one pre-existing trunk `integrity` preload warning): the same repro from wiped storage against `https://10.255.255.1/v1` — mid-turn the pane read `waiting for the model — 2s` with the board's live row at `in this turn for 2s`, and after a reload the composer was live with the abandoned-turn sentence, unchanged 20 s later; `Stop waiting` at 4 s released instantly; the UNATTENDED path still ends itself — a turn left alone re-enabled the composer at ~30 s with no click; `scrollWidth == clientWidth` at **360 / 390 / 768 / 1440** in BOTH skins with 0 controls off-screen; contrast machine skin body **16.61:1**, accent headings (h1 and h2) **7.59:1**, dim/status **9.76:1**, tab ink **16.61:1**, button ink on accent **7.20:1**; plain skin **16.00 / 14.61 / 8.58 / 16.00 / 7.20**; roving tabindex `-1,0,-1,-1` with arrows/Home/End; focus ring `3px rgb(185,140,255)` on the new disclosure, reached by Tab from the tablist; two `role="status"` regions and `aria-live="polite"` on the log; every control >= 44 px at 390 px except the inline CheerpX credit (16 px, pre-existing, WCAG 2.2 2.5.8 inline exemption); the VM booted and ran `uname -a && echo hosted-12b-proof` -> `Linux 4.15.0-54-cheerpx i386 Linux` / `hosted-12b-proof` | `44cde85`, `2b5f6ea` | Live at https://kaush4l.github.io/ASKK/ — hosted bundle `ui-e561b90b799265ea_bg.wasm`, sha256 `7f9baea3…`, byte-identical to `dist/`; the walk above was run twice, once on `ui-a2a764acc16fec94_bg.wasm` (`552fbea0…df3cfde1`) and again on the final build after `2b5f6ea` split `identity.rs` out to hold the 200-line and 40-line rules the fix had broken — same result, zero console errors. **12's row was a FAIL — this row is the answer to it, and 12 does not close until this one is walked.** Pages served the new bundle in **under 4 minutes** this time (first poll after a 200 s wait already had it). WHAT CHANGED: see Decisions. |
| 12c | The 12b walk's verdict was "organised, which it was not — and organisation is the prerequisite. Not yet beautiful." Its five design moves (D1 fill the primary column, D2 the density fix in the three rail panes that missed it, D3 make the rail say it scrolls, D4 three type sizes instead of five inside a 1.6px band, D5 measure instead of cards) plus the three correctness findings from the same walk (F1 two sentences pointing the wrong way, F2 the stop said twice, F3 `role="status"` on twenty words to report one number) | 155 green (152 + 3 in place: the live region is the COUNT alone and the rule is outside it; the workspace sentence names the panel and not a direction; the note is UNDER the scrollback, not six lines in front of it) | LOCAL (127.0.0.1:8902 -> dist, real omlx on 8873): `.primary` **772px** and `.rail` **772px** at 1440 — the same two lines, where the walk measured 387 against 868 — page height **2338px** (5413 before 12, 2682 after 12b); a real turn against gemma-4-12B drove the console: the log scrolled INSIDE the region with the composer pinned to the bottom of it, the newest message put in view on every projection (`scrollHeight - clientHeight - scrollTop < 4`), the board's live row at 16px against every idle name at 11px, and `waiting for the model — 0s` at **30.4px** as the one readout on the page; `scrollWidth == clientWidth` at **360 / 390 / 768 / 1440** in BOTH skins, including at 360 with a turn in flight (the readout clamps to 20.8px there); every visible target >= 44px at 390 (7 disclosure summaries were 17px until `summary` got the same 44px rule every button has); roving tabindex `-1,0,-1,-1` with arrows and Home/End, focus ring **3px** on the new disclosures | ✅ HOSTED on `ui-e449778a113d806b_bg.wasm`: `.primary` **772** / `.rail` **772** / page **2317** at 1440, no overflow at 360/390/768/1440 in either skin (plain skin pages 6433/6177/4573/4376, one column, every disclosure reachable), contrast UNMOVED from the 12b walk — body **16.61:1**, accent headings **7.59:1**, dim/status **9.76:1**, button ink on accent **7.20:1** — and exactly **two** type sizes on a settled page (11px labels ×66, 16px conversation ×32) with the 30.4px readout appearing only while a turn runs; the Workspace pane on the hosted page shows the real `$ uname -a` -> `Linux 4.15.0-54-cheerpx i386 Linux` FIRST with `▸ Workspace: /root/spaces/research` beneath it, which is the density fix on live state | `2ca063c` | Live at https://kaush4l.github.io/ASKK/ — hosted bundle `ui-e449778a113d806b_bg.wasm`, sha256 `390ab994…`, byte-identical to `dist/` along with `console-bb5925fef3dc0432.css`, `instrument-ef0b5201fb429bb.css`, `board-9e696fb44eaaa323.css` and `index.html`. **`prefers-reduced-motion` was OBSERVED this time, not read back from the CSSOM** — two walks said it could not be: `browse` has no `setEmulatedMedia` (the CDP allowlist denies it, deny-default, and the browser is launched with `--remote-debugging-pipe` so there is no port), and the Playwright MCP here needs a Chrome extension that is not installed. The route that worked: `chrome-headless-shell --force-prefers-reduced-motion --dump-dom` on a probe page linking the BUILT stylesheets out of `dist/` with the core's own working-row markup. Forced: `matchMedia(...).matches true`, sweep `animation-name: none`, `.msg.pending` `none`, the board dot `none`, while the accent edge `rgb(185,140,255)`, the inner glow, the dot's colour and every word (`in this turn for 4s · last tool: exec`) stayed. Control run, same command without the flag: `askk-scan`, `askk-breathe`, `askk-pulse`. WHAT CHANGED: see Decisions. |

| 12d | `ux-walker` FAILED 12c: the sticky rail **overprinted the entire deck** at every width >= 1100px — rail text over the Agents column, both illegible, and hit-testing showed the rail swallowing the clicks for ~416px of it, shipped in 12b and missed by three walks. Then the walk's design order: the console was one screen sitting on a 1400px manual (route the deck), nothing moved, one ink and one ground, 12c was desktop-only (5668px of rounded cards at 390), two extra type sizes on a FAILED turn, and the 77px header holding two words | 155 green, unchanged — no core behaviour moved; the increment is layout, type and one routed region. The NEW check is `scripts/check-layout.sh` + `layout-probe.{html,js}`: the shell's own markup against the BUILT `dist/` stylesheets under `chrome-headless-shell`, at 360/390/768/1100/1280/1440 x both skins x both routes = 24 runs, asserting **OVERLAP** (region rects may not intersect) and **HITTEST** (`elementFromPoint` on a 5x5 grid over the routed region, at rest AND at max scroll, must land inside it), plus ONESCREEN, XOVERFLOW and REDUCEDMOTION. It reproduces the bug on the 12c CSS — `FAIL HITTEST scrollY=870: (838,151) hits rail "Agents running"` — and is green on 12d | LOCAL (127.0.0.1:8901 -> dist, real omlx on 8873): at 1100/1280/1440, both routes, **25 of 25 sampled points inside the routed region, 0 outside**, and `scrollHeight == innerHeight == 900` — the page is one screen and does not scroll; a real turn against gemma-4-12B held that (900 in flight, 900 settled) with three sizes in flight (11 / 16 / 30.4px) and two settled; a FAILED turn against a dead port is now **two** sizes, not four — the `Technical detail for failure 1` summary 11px in the machine tone `rgb(169,198,224)` and the JSON 11px in `--danger`; the tablist's roving tabindex survives the fourth tab (exactly one `tabindex=0` at all times, arrows wrap, Home -> first, End -> Setup, ArrowLeft from first -> Setup) and routing follows selection; focus ring `3px rgb(185,140,255)` offset 2px on `deck-tab` | ✅ HOSTED on `ui-2fcbbde32b229d77_bg.wasm`: at 1100/1280/1440, both routes, **0 points outside the region and page height == viewport (900)**; header **55px** at 1440 holding the wordmark, the endpoint sentence and the toggle (77px holding two words before); `scrollWidth == clientWidth` at **360 / 390 / 768 / 1440** in BOTH skins; the phone got the vocabulary — machine skin at 390 is **1639px** where the walk measured **5668px**, with two type sizes and no cards; contrast UNMOVED and one token added: body **16.61:1**, dim **9.76:1**, accent **7.59:1**, danger **11.35:1**, button ink on accent **7.20:1**, and the new machine tone `--machine #a9c6e0` at **10.88:1**, above the 9.76 it replaces | `f9352f2` | Live at https://kaush4l.github.io/ASKK/ — hosted bundle `ui-2fcbbde32b229d77_bg.wasm`, sha256 `e57efdcb…`, byte-identical to `dist/` along with `screen-796fd0d3e7697eca.css`, `instrument-adaad9a3622c2a30.css`, `theme-11a182d959b81353.css`, `console-69dcd638f72b1fd4.css`, `aaa-2766a9dc99894677.css`, `board-9e696fb44eaaa323.css` and `index.html`. `prefers-reduced-motion` observed the same way 12c found: `chrome-headless-shell --force-prefers-reduced-motion` over the whole probe matrix — every `animation-name: none`, and the working row keeps its dot, its accent edge and every word. WHAT CHANGED: see Decisions. |

| 13 | "Both skins are equally bad. The simple skin is just a scrolling everything. Have a nice dashboard UI with right collapsible panel, left collapsible panel, a main view center panel that shows the proper UI at hand." Three regions — `nav#nav` (the roster as a vertical tablist, then Setup), `.stage` (the conversation or the routed deck), `aside#rail` (board, tools, terminal, space) — and the outer two fold. Collapse is the `hidden` attribute, not a class, so the PLAIN SKIN gets it too: screen.css already makes `[hidden]` absolute, and a fallback that cannot put the rail away is the complaint itself | 44 suites green, unchanged — no core behaviour moved. The increment is layout and one new module (`dash.rs`: `wide()`, `PanelToggle`, and the boot plumbing main.rs no longer had room for). `check-layering.py` green; files 177 / 94 / 173 lines | `scripts/check-layout.sh`, rewritten — see the FAILS below for what the old one certified. 24 runs (6 widths x 2 skins x 2 routes). NEW: **FOLD** asserts the EXACT width transfer across all four fold states by PRESSING the switches, **STACKED** asserts a vertical tablist stacks in both skins, **ONESCREEN** now covers the plain skin and every width, and the hit-test clip follows computed `overflow` rather than a list of element names, because which box scrolls moves with the breakpoint | ✅ HOSTED, three walks, two of them FAIL — the third: fold matrix identical in both skins, both routes — **1100** stage 492 / 700 / 828 / 1036, **1280** 672 / 880 / 1008 / 1216, **1440** 793.6 / 1001.6 / 1168 / 1376, the gain equal to the folded region's width TO THE PIXEL and the folded track collapsing to `0px`; stage widest in all 12 states; phone with both folded **780/780 and 844/844 exact** (machine); no horizontal overflow at 360/390/768/1440 in either skin; contrast nav entries **16.61** machine / **16.00** plain, panel toggles **16.61 / 7.20**, rail attribution **10.88 / 16.00**; roving tabindex with arrows wrapping both ways, Home/End, ring `3px rgb(185,140,255)` offset 2px, not trapped; per-agent transcripts stay separate across a switch | `212aa2d`, `c13c9f0`, `a83c0aa`, `a1d6390` | Live at https://kaush4l.github.io/ASKK/. **THE INCREMENT SHIPPED BROKEN TWICE BEHIND A GREEN CHECK, and that is the row's real content.** 13: `grid-template-columns: auto minmax(0,1fr) auto` with no `grid-column` on the regions — hiding the nav let auto-placement drop `.stage` into track 1 (`auto`, so content-sized) and the rail into the `1fr`, where its own clamp left the rest empty: the stage SHRANK 794 -> 599 with 435px of dead viewport. 13b: the pins landed in the WRONG TEMPLATE — instrument.css still carried 12d's two-column rule at `html:not([data-skin="plain"]) main`, specificity (0,1,2), against dash.css's (0,0,1), so the machine skin kept the old template and `.stage` sat in its rail track capped at 26rem = **416px in all twelve fold states**; and theme.css's 46rem reading measure squeezed three regions into 704px, leaving the plain skin a **90px conversation**. Both were invisible to `check-layout.sh`, which printed OK over both deploys for two reasons: its probe still modelled the 12d two-region page, and its stylesheet list was HARDCODED and never learned `dash.css` existed — it was measuring a page with no dashboard in it. The list is read off `index.html` now. WHAT CHANGED: see Decisions. |
| 13d | The third walk PASSED with findings, two of which were 13c's mistake one selector further down: a promise made for both skins, implemented for one | 44 green, unchanged | `check-layout.sh` green, and green again under `--reduced-motion`. Both new assertions were proven by REINSTATING the bug: the 12d template reproduces `FAIL FOLD nav: stage 416 -> 416 (UNCHANGED)` across the matrix, and machine-only scoping on the nav reproduces `FAIL STACKED: "▸ main" and "author · wri" share a row` — the exact pair the walk measured hosted | ✅ HOSTED (walk 4, gh-pages `e2abfe2` = `deploy a1d6390`, hashes verified against `dist/`): COI true, 0 console errors, 0 failed requests, `check-layout.sh` 24 runs 0 FAIL. Nav one entry per row in BOTH skins — plain @1440 `x=16`, `y 106/150/194/238/282`, a 44px step; ArrowDown walks `115 -> 159 -> 203 -> 247 -> 71` and wraps. **One screen in both skins at 360 (780/780) and 390 (844/844), open AND folded**, `main` scrolling below 1100; the composer is reachable and typeable at 390 with both panels open. Fold transfer EXACT with `gap: 0` — machine @1440 **794 -> 1002 -> 1376 -> 1168 -> 794**, gutters symmetric at 32px; plain **826 -> 1034 -> 1408 -> 1200 -> 826** at 16px; every folded track `0px`. Hit-test 25/25 inside the routed region in both skins on both routes, no rail overlap, no horizontal overflow | `a1d6390` | FOUR fixes and two lessons. (1) The nav's column rule was machine-only, so the fallback kept `flex-wrap: wrap` and laid five entries out as a **2-across chip grid** under `aria-orientation="vertical"` — ArrowDown moving focus RIGHT. (2) The one-screen chain was 1100-and-up, so the phone had it by luck: at 390 with both folded the machine skin was 844/844 and the plain skin **1015**; it holds at every width now, with `main` as the scroll container below 1100 where the regions stack. (3) A folded track collapsed to zero but its 16px gap did not — the grid has no gap and the stage carries the gutter. (4) A folded toggle's border was **1.54:1**, under the 3:1 non-text bar. LESSON ONE: the first FOLD assertion was `after >= open` and it **PASSED the bugged build**, because 416 -> 416 is not narrower; it is `>` and then an exact-transfer check now, and a check that has never been shown to fail is not a check. LESSON TWO: the fixture carried three agents and three cannot WRAP, so STACKED could not reproduce the failure even with the bug restored — **a fixture smaller than the failure certifies it**. It carries the shipped five. |
| 13e | Walk 4's four findings, three of them mine and one a real bug it found on the way past | 44 green; `ui` builds clean on wasm; `check-layering.py` green | `check-layout.sh` green and green under `--reduced-motion`. **CONTRAST is now an ASSERTION over rendered elements** against their painted grounds — text < 4.5:1 and a fill-less control's outline < 3:1 both FAIL — proven by restoring the 1.49:1 border, which gives `FAIL BOUNDARY panel-toggle[0] folded: rgb(59, 45, 82) 1.49:1 on rgb(23, 16, 31)`. ONESCREEN asserts at EVERY width now | ✅ HOSTED (walk 5, gh-pages `b4a2a9e` = `deploy 8d2c5d2`, hashes verified, SW and caches cleared): COI true, no console errors, no failed requests. All four of walk 4's fixes hold. Toggle contrast, four states: machine open **16.61** text / **7.59** outline, machine folded **10.88 / 10.88**, plain open **7.20** on accent fill, plain folded **16.00 / 9.40**. ONESCREEN and XOVERFLOW clean in **36 live states** (6 widths x 2 skins x open/folded on chat, plus 360/390/1440 x 2 skins x open/folded on Setup) — `scrollHeight === innerHeight` EXACTLY at every one. Fold transfer exact in all four states, both skins. **Per-agent drafts confirmed on the hosted page**: three drafts held at once, none followed a switch, Send cleared only the sending agent's and delivered to its own transcript. Walk 5's verdict on the shell itself: *"the dashboard shell works… I'd close the behaviour of increment 13"* | `8d2c5d2` | (1) The plain skin's folded switch had a transparent fill and a **1.49:1** outline — 13d fixed exactly this in the machine skin and left the fallback on the token that failed. **Fourth time in one increment that a rule meant for both skins reached one.** (2) ONESCREEN was gated `W >= 1100`, which is precisely where the failure it exists to catch did NOT live — the plain skin's 1015px in an 844px viewport printed as INFO, and `check-layout.sh` counts only `^FAIL`. (3) CONTRAST resolved TOKENS off a scratch `<span>`, so it could not see a defect that IS which token a rule reached for: the number reads identically in both skins. (4) **The composer's draft was shared across agents** — type to `author`, switch to `main`, press Send, and author's sentence went to main; the transcripts were correctly separate and the draft was not. One draft per agent, keyed the way the transcript already is. dash.css and layout-probe.js had both passed 200 lines, so the furniture's ink is `panel.css` and the audit checks are `layout-audit.js`. TARGETS prints anything under 24px rather than asserting it — at 390 everything clears 44 and the one sub-24 control is an inline link in prose (WCAG 2.5.8 exempts it) |
| 13f | Walk 5 closed the shell's BEHAVIOUR (*"the dashboard shell works"*) and refused to close the contrast story: the guard's own `check()` FAILED on the shipped page while `check-layout.sh` printed OK | 44 green | `check-layout.sh` green, and green under `--reduced-motion`. Proven by restoring `--line` on controls, which produces **1.49:1** on the tabs and skin-toggle and **1.55:1 / 1.36:1** on the composer and the `agent-md` editor — every number walk 5 measured BY HAND, including the two the alpha test was blind to | ✅ HOSTED (walk 6, gh-pages `3564069` = `deploy ee74ee0`, all eight stylesheet hashes verified against `dist/`, SW unregistered and caches cleared): COI true, 0 console errors, 0 failed requests. **`check-layout.sh` 24 runs 0 FAIL, and the verbatim `check()` re-run on the LIVE DOM is 0 FAIL in BOTH skins — producing numbers identical to the guard's, element for element.** That is what walk 5 refused to sign off, and it is the first time in this increment the check and the shipped page have been shown to agree. `--control` measured hosted: unselected tabs **3.82:1** plain (was 1.49), selected **7.31**; skin-toggle **3.97** machine / **7.31** plain; composer and `agent-md` **3.97 / 3.49** (was 1.55 / 1.36); toggles folded **10.88 / 9.40**, open **7.59 / 7.20**. The 3.83:1 claim is the CONSERVATIVE figure — 3.82 on the plain `--bg`, 3.97 on the machine `--bg`, 3.49 on `--surface`, the lowest ground any control sits on. No regression: selection and focus still outrank the resting boundary, and the `--control` rim on a filled accent button is 1.9:1 against the fill — invisible, no page of bright boxes. The restore-`--line` experiment **reproduced independently on the hosted page** (plain 12 FAILs: 1.49 tabs, 1.36 composer/`agent-md`; machine 9: 1.55), and `opaque()`->`filled()` was isolated as load-bearing: same restored token, old alpha test, **12 FAILs drop to 4** — all eight input failures vanish. Regression sweep clean: **844/844** at 390 in both skins, fold transfer exact at 1440 in both, three per-agent drafts held at once with none following a switch. **TWO CORRECTIONS TO THIS INCREMENT'S OWN CLAIMS, from the walk:** (a) "the two the alpha test was blind to" MISASSIGNS THE BLAME — `b9db7f9`'s audit queried only `.panel-toggle` and one `.nav .tab`, and never looked at an input, a textarea or the skin-toggle at all; the alpha bug is real and would have hidden them the moment the control set widened, which is what 13f did, so both fixes were needed, but the alpha test is not what hid them in 13e. (b) The experiment does NOT isolate "iterate every control" from the fixture reorder — with the fixture leading unselected, `querySelector` alone would also give 1.49:1; iterating is still the right fix, because it is the one that does not depend on the fixture agreeing with the app, but that is not what the experiment proves. **Two guard limits carried forward, neither a defect on the page:** the audit measures `border-top` only, so the machine skin's tab LEFT edge (accent, 7.59:1) is unwatched; and its click-then-measure is synchronous, so pointing it at the live Wasm shell would silently certify the pre-click state. **Verdict: PASS — increment 13 is closed.** | `ee74ee0` | `--line` was doing two jobs: **1.49:1**, right for a panel's decorative edge and wrong for the outline of something you press, which WCAG 1.4.11 puts at 3:1. A `--control` token (**3.83:1** on `--bg`) draws every interactive boundary in BOTH skins now, with selection and focus still outranking it. **Fifth location in this increment for the same token in the same wrong role.** Two defects in the check written in 13e, both walk 5's: (a) `opaque()` tested ALPHA, not visibility — the composer's fill is `rgb(18,11,26)`, its ground exactly at 1.00:1, so `alpha != 0` counted it as filled and skipped the outline check, letting `--line` hide behind any background matching its parent; a control is fill-less when its fill does not SEPARATE from what is behind it. (b) It measured **the first tab** — the fixture led with the selected one (accent, 7.31:1) and the app leads with an unselected one (1.49:1), so the guard was green over a page its own code failed. It iterates every control now, and the fixture no longer disagrees with the app about ordering. **The recurring lesson of this increment, in one line: a check that reads "the first" of something is only as good as the fixture agreeing with the app, and a rule written for both skins must be verified in both.** |
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
| `core/space.py` | One space object per name, shared across threads | ✅ |
| `core/space.py` | Attributed notes, 20-note cap, atomic persistence | ✅ |
| `core/space.py` | Facts render into CONTEXT; a stale value never lingers | ✅ |
| `core/inference.py` | Model catalogue keyed by name, not a provider table | ✅ |
| `core/utils.py` | `agent.md` frontmatter: model, temperature, engine, tools, space | ✅ |
| `core/agents/summarizer` | Built-in summarizer compresses history | ✅ |
| — | Chat with the main agent in the UI | ✅ |
| — | Chat with any agent individually | ✅ |
| — | Agents hot-reloaded from `public/agents/` | ✅ |
| — | New agents added in the browser, persisted, exportable | ✅ |
| — | Alpine workspace: run a command, write a file, survive a refresh | ✅ |

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

### Increment 09

- **A space cannot be an object here, so it is a KEYSPACE.** The Python's `get_space` hands every
  agent naming `research` the same `Space` and takes a lock around each mutation. A Worker has its
  own Wasm instance and no shared memory (ADR-008), so "the same object" has to become "the same
  place both can see": ONE IndexedDB database (`harness-spaces`), injected as `Ports::spaces`,
  opened by the page and by every Worker. Two `App`s over one injected store is what the host tests
  drive, which is why increment 09 tests on the host at all (I3).
- **One key per fact and one key per note, not one document per space.** A document would have made
  every write a read-modify-write, and two Workers writing at once would silently lose one of them.
  One entry per key makes each mutation exactly ONE store operation — and there is no half of one
  put, which is the property the Python's tmp-then-`replace` buys. `remember` is a put (so writing a
  key twice replaces it by construction), `forget` is a delete, `post_note` is a put under a
  time-ordered key plus a delete of anything past the cap.
- **The note key carries the author, and the racing test is what found that.** With the key as
  `<ms>-<nonce>` two agents posting in the same millisecond from the same seeded RNG wrote the same
  key and one note vanished with nobody told. It is `<ms>-<author>-<nonce>` now. The same test also
  needed a clock that MOVES: under a frozen one every note shared a timestamp, the cap fell back to
  tie-breaking by author, and it dropped one agent's notes wholesale — an artifact of the fixture,
  but only a moving clock proves it was one.
- **The cap is applied on READ as well as on write.** A reader arriving between a post and its trim
  would otherwise see 21 notes. Trimming is a delete of keys that are already surplus, so two agents
  trimming at once cannot remove a note either of them still needed.
- **The space is re-read at the top of every `drive` pass** — the reason the clock is not cached,
  twice over (Python `Engine.context`). That is what makes "every agent observes changes without
  being told to look" true rather than aspirational: it was watched happening in the page, the
  inspector going `0f/0n → 1f/1n` while the sub-agent that wrote them was still working.
- **The space renders into the ENVIRONMENT section**, beside the clock, because that is the Python's
  CONTEXT block: `Engine.context` returns the time facts merged with `space.context()`. No new
  seeded section, so the §8.2 starter set and its goldens are untouched. The SUMMARIZER's paper gets
  `None`: it reads the transcript and nothing else, and the group's facts are not part of the
  conversation it is compressing.
- **The workspace path is NAMED, not promised.** `workspace: spaces/research (named; not writable
  from this browser yet)` — the physical half is increment 10's Alpine workspace, and a prompt that
  told the model it had a folder it cannot write to would be the same lie the transcript/board split
  was in 07. Both shipped agent files say the same thing in their own words.
- **Naming the space IS asking for its tools** (Python `utils.load_agent`): `remember`, `forget` and
  `post_note` are appended to whatever the file's `tools:` list declared, rather than having to be
  listed under it — a second place to keep in step. A name that could walk out of `spaces/`
  (`../etc`, `a/b`, empty) attaches nothing at all and gets no space.
- **The AUTHOR is bound where the tool runs, not where the model writes.** The Python closes over
  the agent's name in `tools_for`; here it is taken from `App::me()` at execution. A model asked to
  write its own name into a note could write anyone's.
- **The summary the summarizer wrote is now readable** (08 walk, finding 1), behind the same
  disclosure pattern the failure card ships, named per agent. For a sub-agent too: its Worker
  reports the summary text with its window, so one compaction has one presentation wherever it
  happened.
- **A sub-agent's memory is a fact it REPORTED, never a number this side guessed** (finding 2). The
  Worker sends `{window, summary}` with its `ready` and with every answer; the page drains it
  through `core::report_memory` into an event, exactly as `report_agent` drains a status, so the
  pane stays a projection (I8). Until a Worker has said anything, the pane says so in words.
- **The count has a denominator and a rule** (finding 3) and says nothing was lost (finding 4):
  "Working memory: 4 of 6 entries — the oldest turns are now a summary the summarizer wrote;
  compaction runs at 6 entries and keeps the newest 2. Nothing was lost: the transcript below still
  holds every turn." The denominator is that agent's OWN `compact_at`, read from its file.
- **A compaction is announced** (finding 5): `.agent-memory` sits outside the transcript's
  `role="log" aria-live="polite"` region, so it carries `role="status"` and the one number it moves
  is spoken when it moves.
- **A sub-agent's technical payload is no longer double-encoded** (finding 6): the disclosure shows
  the Worker's own typed payload (`{"Model":…}`) when it sent one, not the envelope it travelled in.
- **Ledger accuracy** (finding 7): the `08` row's bundle hash was 07b's. The row now carries the
  correction beside the original claim rather than a quiet edit.
- **Not done here:** the space is per-ORIGIN, not per-tab — two tabs share one `harness-spaces`, and
  nothing yet tells a tab that another tab wrote (the 2 s poll and the per-turn read are what carry
  it, which is enough for one page and its Workers). A hosted LIVE space test still needs a
  reachable model, which the hosted origin does not have (02's row); the hosted walk goes to the
  loopback boundary and proves the sharing with a write made from outside the Wasm instance. The
  space's files (`spaces/<name>/`) are still only a path in a prompt.

### Increment 10

- **`WorkspacePort` is a port, so the agent core never learns that Linux exists.** `exec` is the
  only method an adapter must write; `read`, `write` and `list` are DEFAULTS built on it (`cat`,
  a base64 `printf | base64 -d`, `ls -1A`), because reading a file in a Unix is a command and three
  more adapter methods would be three more things to get right. `FakeShell` overrides those three —
  there is no shell on the host — so the exec tool, its gate, its path rule and its degradation all
  test with `cargo test` and no browser (I3).
- **The capability gate is the SPACE.** Increment 09 shipped `spaces/<name>` as a path "named; not
  writable from this browser yet"; naming a space now attaches `exec`, `read_file`, `write_file` and
  `list_files` on top of the space's own three, and the grant (`CapabilityGrant::Workspace { root }`)
  carries the folder. An agent with no space is never handed the tools at all — default deny is
  structural, not a runtime check — and a person typing into the Terminal meets the same gate in
  `core::workspace::grant`, which is the one definition of who may run a command (ADR-006, I6).
- **The model never names the root.** It writes paths relative to the workspace and `relative_path`
  REFUSES one that starts with `/` or contains `..` rather than clamping it: a silently rewritten
  path writes a file the agent cannot find, and the refusal is what lets it correct itself.
- **CheerpX 1.3.1, and the version is load-bearing.** The plan quoted `1.2.8/cx.js` from WebVM's
  own page. With 1.2.8 and `alpine_20251007.ext2`, `CloudDevice`, `IDBDevice` and `OverlayDevice`
  all resolve in ~350 ms and `Linux.create` then hangs forever — twice, at a 120 s timeout, with no
  error and nothing on the console. 1.3.1 mounts the identical image in 2.2 s. The engine and the
  disk are published separately, so the PAIR is pinned; neither is pinned to "latest".
- **No `/sbin/init`, no display, no login.** WebVM's Alpine config boots init and wants a terminal;
  nothing here does. Every command is a direct `cx.run("/bin/sh", ["-c", …])` with `cwd`, `uid` and
  `gid` supplied, which is why the first shell is 2 s and not a boot sequence. Alpine over their
  Debian for the same reason: busybox is one binary, so fewer disk blocks have to stream before
  `sh` can run.
- **The overlay IS the workspace.** `CloudDevice` (read-only base image, streamed over `wss://` —
  never downloaded, the 1.5 GB image is why that matters) under an `IDBDevice`, in an
  `OverlayDevice`. Every write lands in IndexedDB under `cjFS_/askk-workspace/`, which is what makes
  "the file is still there after a reload" true, hosted, on a static page with no server.
- **It boots on the first command and not before.** Nothing — engine, disk, worker — is fetched on
  a page load that never runs anything; `cx.js` is injected by the adapter, not by a `<script>` tag
  in `index.html`. The pane says a boot is happening in words rather than leaving a person watching
  an unchanged panel.
- **The credit is a feature, not a footnote.** The CheerpX Community Licence covers this use
  ("individuals … any personal projects") with the action point "give appropriate credits", and
  self-hosting the RUNTIME would need a commercial licence — so the engine loads from
  `cxrtnc.leaningtech.com` (which sends `cross-origin-resource-policy: cross-origin`, satisfying
  COEP) and the Terminal pane carries a visible credit to CheerpX / Leaning Tech and to WebVM for
  the disk image.
- **A sub-agent's Worker has no workspace, and says so.** A Worker has no `document` to load the
  engine into, and two `OverlayDevice`s over one IndexedDB cache would be two writers on one disk.
  The same adapter is injected there and refuses in words — "No workspace is available here: the
  workspace runs in the page, not in an agent's Worker" — rather than quietly corrupting the page's.
  Routing a Worker's exec back to the page is not done; `researcher`'s file says so in its own words.
- **The Terminal is a projection, not a widget** (I8). One scrollback holds the agent's `exec` calls
  and the commands a person typed, in log order, read back from the stored log — which is why it is
  still there after a reload even when the VM is not. A typed command emits `core.exec_request` and
  runs in the async half, exactly as a model call does, because the seam is synchronous by design.
- **Found by walking this increment: a typed command read as a TURN.** `ToolInvoked` set the chat
  pane's `awaiting` flag unconditionally, so running a command yourself left the composer disabled
  and "thinking…" under the transcript for the rest of the session, over a turn nobody had started.
  Inside a turn that flag is already true, so the arm had nothing to set; it now sets nothing.
- **Finding 1 (09), closed at the root.** A failed compaction is not a failed turn. `failure::record`
  is the one place a failed effect lands, and when the agent is compacting it records
  `core.compaction_failed` and FEEDS IT BACK instead of `core.error`; `step` clears `compacting` and
  takes the turn that was actually asked for. Before: exactly one request went out — the
  summarisation — the user's question was never put to the agent, and its failure was shown as the
  user's own turn failing. Pinned by asserting on the model calls themselves: three calls, the third
  one carrying the question, the answer in the transcript, the window untouched (so the next turn
  retries), and a `role="status"` line naming the background summarisation.
- **Finding 2, closed.** The denominator is the TRIGGER (`spec.compact_at`), never `max(entries)` —
  "10 of 10 entries … compaction runs at 8" was two numbers contradicting each other in one
  sentence, always reading full. An agent that never compacts gets no denominator at all.
- **Findings 3 and 5, closed.** `/space` and `/tools` take the same `x-agent` header `/chat` has
  taken since 07. The space pane reads the SELECTED agent's own `space:` key, so `summarizer` is
  told it works alone instead of being shown `research`; an agent in a different space is named
  without its facts being guessed. The tool trace says a peer's calls are recorded in its own Worker
  rather than showing it five calls it never made.
- **Finding 4, closed twice over.** `post_note` refuses an identical line in words ("That note is
  already on the research board") rather than putting the same sentence in every agent's prompt
  twice, and the inspector renders the author as an element with `data-author`, not as four
  characters inside the sentence. The stored line keeps its `[main] ` prefix, because that is what
  the model reads.
- **`spikes/vm/index.html` did not exist** — only `spikes/vm/sw.js`, already promoted to `web/` in
  01. Nothing was left dangling.
- **Not done here:** a sub-agent cannot run a command (above). The VM is one per PAGE, so two tabs
  would be two overlays over one IndexedDB cache — the same hazard, unguarded. `read_file` on a
  binary file returns whatever `cat` writes to the console. Every seam request appends a
  `RequestHandled` fact, and the Terminal's 700 ms watch makes that visible: a long boot writes
  hundreds of them. That is pre-existing (the chat and space panes poll too) and is a log-retention
  question, not this increment's.

### Increment 11

- **An authored agent is a FACT, not a second store.** `core.agent_authored {name, agent.md}` in the
  event log, folded by `roster::authored`. That is why it survives a refresh (the log replays at
  boot), why deleting one is `core.agent_deleted` and therefore undoable (I10), and why there is one
  record rather than a kv table beside the log that could disagree with it (I8).
- **PRECEDENCE, one rule:** compiled-in built-ins, then `public/agents/`, then what this browser
  authored. Last wins — the Python `registry._agent_dirs` order with one step added. So writing an
  agent called `main` REPLACES the shipped `main`, and deleting that record reverts to the file.
  Editing a running agent's prompt is exactly this and nothing else; there is no separate edit path.
- **The swap happens at a TURN BOUNDARY.** `roster::reconcile` refuses while `app.agent.task` is
  `Some` — which is exactly from the utterance that starts a turn to the answer that ends it.
  Swapping between the model call and the reply it is waiting for would finish the turn out of one
  agent's file and another's history, which is the crossed-projection class 07b already cost a walk.
  The paper's HISTORY is untouched by `adopt_spec`, so the conversation survives the swap.
- **Export is `render_agent_file`, the stated inverse of `parse_agent_file`,** and the stored record
  is the CANONICAL render — so what is kept, what is exported and what would round-trip are one
  string. `GET /agents/file` answers with `content-type: text/markdown` and the file as the body,
  not a fragment: the editor and the download need the text, and reading it back out of rendered
  HTML would be the view-scraping this codebase refuses everywhere else.
- **`write_agent` is an ORDINARY built-in tool** and the create-agent superagent is an ordinary
  `public/agents/author/agent.md`. I9 says built-in and authored agents are indistinguishable to the
  system, so the model's route and the person's route append the same fact. The consequence, taken
  deliberately: "empty `tools:` means every built-in" is the Python rule, so an agent with an empty
  list can author agents. Carving `write_agent` out would make it the one capability the toolbox
  resolves differently. The Agents card prints the RESOLVED toolbox, so it is stated rather than
  hidden.
- **A Worker reports what it authored.** The superagent runs in its own Wasm instance with its own
  event log, so `write_agent` there records the fact THERE and the page would never see it — it
  reported success and installed nothing. `AgentWorker::authored()` rides back on the same message
  as `memory`, and `core::report_authored` lands it on the page through the one status door, exactly
  as `report_agent` and `report_memory` do.
- **Workers are respawned when the FILES change, not when the names do.** Editing a prompt changes
  no name, and a Worker is handed its file once at boot; without this the page adopted the new prompt
  while the sub-agent kept answering from the old one. Coarse — every Worker is replaced — because a
  Worker cannot learn one new agent, and `main` must be able to delegate to one written a moment ago.
- **A model's `tool_calls` reply is read as the calls it made.** omlx answers a prompt whose
  affordances mention tools with a native `tool_calls` message and no `content`; this build asked for
  calls as text and read that as no reply at all, failing the turn on "unrecognizable completion
  body". `openai_reply_text` now renders them into the one call syntax the parser reads (one per
  line, which is also the layout rule's "in order"), stripping any `tools:` namespace prefix.
  Discarding a call the model really made is not a defensible reading of a 200.
- **What a small model actually sends is cleaned up, narrowly.** A `space` that could never be a
  space is dropped (it grants nothing, and keeping it would put a capability line on the card that
  means nothing), and a prompt whose newlines arrived still escaped is unescaped — only when there
  is no real newline to lose.
- **The four findings from the 10 walk.** (1) `#terminal` is scrolled to `scrollHeight` after a
  command lands, so the answer is on screen instead of 1300 px below the fold; the pane's NOTE moved
  outside the scroller so it is not what scrolls away. (2) The boot sentence is told once, on the
  command that actually boots the Linux. (3) `/terminal` takes `x-agent` like `/space` and `/tools`,
  so with `summarizer` selected the pane says summarizer has no workspace and names whose commands
  the scrollback below actually is. (4) The path rule is stated honestly wherever it is summarised:
  `exec` is a real shell that can read anything in the VM, so the path check on the other three tools
  is legibility rather than containment, and the Linux in the tab is the sandbox. The same sentence
  is on every Agents card that has a space, because a space IS the grant.
- **Legibility, not a permission dialog.** No dialog was added. Each card states who wrote the agent
  (`data-origin="authored" | "shipped"`), what its space granted it in words, and its resolved
  toolbox; an authored card carries an accent rule down its left edge. Delete is a button beside the
  editor, and deleting an authored override of a shipped agent puts the shipped file back.

### Increment 12

- **The two board bugs were ONE bug, and the fix is on the host.** A turn's poller belongs to the
  agent it started on (07b's rule, which stopped one agent's transcript appearing under another's
  name). The consequence nobody had priced: switch tabs and *nothing on the page calls the seam at
  all* — and a Worker's status only reaches the log when something does. So the board read
  `working — inside a turn` two minutes after that turn had failed, and a prompt swap
  `roster::reconcile` defers until the turn ends installed into a core nobody was reading. `/board`
  now says **`x-watch`** when any row is `Starting` *or* busy — "this board is not final, ask again"
  — replacing `x-settling`, which only ever covered boot. `AgentBoard` is the page's one observer of
  every agent: one clock, guarded by a flag it `peek`s rather than reads, a 3-minute ceiling so a
  wedged agent cannot poll the tab forever, and one `tick` bump when the board goes final so the
  panes that read from that counter re-project the moment the turn's effects have landed. `watch`
  hands the observation over before letting go, because the board only starts its clock once `drive`
  has entered the turn — a beat *after* the send.
- **`x-busy` and `x-watch` are not the same question.** Busy is the sentence under the board; watch
  is the instruction to keep asking. A Worker still coming up is not working, and the board is still
  not final. Two headers, one test each.
- **Provenance moved to the point of use.** The record has distinguished "written by you" from
  "written by the `<name>` agent" since 11b, and an agent holding a `space:` has a real root shell —
  but the sentence lived only in the Agents panel, at y≈4372 of a 5413 px page. The chat projection
  now renders **the same `authoring::origin_line`**, so the two cannot disagree, and the tab carries
  `· written here` **in words** (a coloured edge says nothing to a screen reader or a stylesheet-off
  reader). `data-origin` rides beside it so a skin can mark it without inventing the fact.
- **The plain-skin editor is an editor.** `#agent-md` had `rows="14"` and no `cols`, so with
  stylesheets off it fell back to the UA's 20 columns — a comment box. `cols="72"` is a floor; CSS
  still wins.
- **The machine layer is CSS over a projection, and that is the whole design.** One file, `aaa.css`,
  under `html:not([data-skin="plain"])` — ON by absence, so it is what the page already shows before
  any script runs and the plain skin never flashes over it. It defines no colour of its own: every
  value is `color-mix` over `--accent`, and the only tokens it moves are `--bg`/`--surface`, both
  *darker*, so every contrast the walks measured could only go up. Nothing animates that is not a
  change that happened: the sweep runs on `[data-status="working"]`, the slower dimmer one on
  `starting`, the arrival on `:last-child` only — the whole log is re-rendered from the core's
  fragment, and animating every message would restage the conversation each time one fact landed.
- **Reduced motion loses the motion, not the information.** Under
  `prefers-reduced-motion: reduce` the sweep becomes a static gradient in the same place and the
  busy dot keeps its shape and colour; only the movement stops.
- **The toggle is one bit and stores nothing else.** `skin.rs` owns `data-skin` on the root element
  and `localStorage["askk.skin"]`; a preference about this device's screen is not app data, so it
  does not go near the event log. Storage denied, unreadable, or absent all mean the machine layer,
  because that is what the page is already showing.
- **A live region has to exist before it changes.** "an agent is working…" is now always in the tree
  with `role="status"`, empty when nothing is running — a region inserted at the same moment as its
  text is a status a screen reader may never announce, whatever it looks like.

### Increment 12b

- **The two correctness failures were one question asked wrong.** `transcript` decided a turn was
  in flight from the SHAPE of the log — the last conversational fact is a `UserMessage`, so
  somebody is thinking. A replayed log has that shape with nothing behind it: reload mid-turn and
  the pane was pending forever, composer disabled, "thinking…" on screen, the clock frozen at the
  second `Stop waiting` was pressed, and only wiping storage recovered it — while the board three
  inches away, which increment 12 had just taught to reach the page unattended, correctly read
  `idle`. Two projections of one fact contradicting each other on one screen is worse than the one
  stale reading it replaced. `driven` now asks three things this process really holds, none of
  which survives a reload: the utterance THIS request accepted, the pump queue (`Ctx::queued`, the
  window `roster::accepted` already knew about, which the browser hits at ~100 ms), and the board —
  itself a fold of `AgentStatus` facts, so this is the log asking the log. `x-turn: pending` and
  the "thinking…" line both hang off that one value, and an abandoned turn says so in words.
- **`Stop waiting` ends the WAIT, which is the only thing it ever promised.** It used to refuse for
  any agent but this process's own, reasoning that a Worker's turn cannot be reached from here —
  true, and not the point: the button is on the pane, the pane projects one log, and the wait lives
  in that log. Refusing left the composer disabled for the whole 30 s timeout with a wrong number
  frozen on screen for 26 s of it. `core.turn_stopped` now carries the agent's name (empty is this
  process's own agent, which is every record written before today), `belongs_to` routes it to that
  one conversation, and `drive` clears the task only when the turn that ended is its own — stopping
  a sub-agent's pane must not abandon the lead's turn. The pane stopped overriding `pending`
  locally: that override was set false at the press and set true again one tick later by the
  watcher's last projection, which is what froze the clock.
- **The placeholder is gone, twelve increments late.** `This panel arrives in a later update.` sat
  directly under the H1, framed like a real panel, in the best position on the page. The plan has
  ended; the update is not coming. The `status` module keeps its route and loses its slot, and
  `root()` renders the page's one `<h1>` and nothing else. `Ctx::panels` and the slot composition
  went with it — a projection with no consumer is not a seam, it is dead code.
- **Two absences, one rule.** An agent file with no `description:` rendered `note-taker — ` with
  nothing after the dash. The separator belongs to the second half; with no second half there is no
  separator, in the chat header and on the Agents card alike.
- **The instrument, in the walk's own order of payoff.** (1) `main` was `max-width: 736px;
  display: block`, so a 1440 monitor showed a strip with ~700 px of dead background either side and
  nine panels stacked top to bottom — watching an agent work meant scrolling away from the terminal
  it was driving. Three regions now, wrappers only, same components in the same order: `.primary`
  (masthead, tabs, conversation), `.rail` (board, tool trace, workspace, shared space — sticky,
  scrolling inside itself, never scrolling away), `.deck` (editor, agents, settings; two columns at
  1400). (2) The row inside a turn earns the space: it grows, and it says `in this turn for 12s ·
  last tool: exec` — `since` is the timestamp of the status fact and the tool is the last
  `ToolInvoked`, both folds of the log, and the tool only for the agent whose loop this process IS,
  because another agent's calls are recorded in its own Worker. Every other row compresses to one
  dense line with the same words at the same contrast. (3) `HARNESS` and `A S K K` were two naming
  systems, neither winning; they are one now — the mono face, tracked and uppercased, which also
  costs no font file on a static host that must work offline — and every machine-produced value
  (statuses, turn counts, model ids, paths, agent names, elapsed seconds) is monospace, while a
  person's words stay in the body face. (4) Six statuses, six treatments: idle flat, starting
  dashed, waiting in bright ink, working accent + the one sweep, failed danger, closed dotted.
  `starting`'s sweep was 3.2 s over a state that lasts ~400 ms, so it read as a static flash; it
  does not sweep at all now, it is dashed, which is what "not settled yet" looks like without
  motion. (5) Provenance and the space grant moved behind the agent's name as a disclosure — the
  same sentences, word for word, one click away — and the one live line, `This turn calls local —
  … at …`, stays in front of the conversation because it changes with Settings and decides whether
  the next message can be sent.
- **Nothing that was measured moved.** No ink colour changed, so every contrast is the walks' own
  or better; the layout is machine-skin only, so the plain skin is still the complete one-column
  fallback that answers every question; and `prefers-reduced-motion` still stops the sweep and
  keeps the accent edge, the inner glow and every word.

### Increment 12c

- **The primary column was more than half empty, and that was the loudest thing in the frame.**
  `.primary` measured 387px against a rail of 868px: the biggest, best-positioned region on the
  page held the least, while the rail beside it was overfull and scrolling internally. It is the
  height of the viewport now, the conversation is the flex child that grows and scrolls inside it,
  and the composer is pinned to the bottom — the difference between cards in columns and a
  console. Two consequences the change brought with it: the log is a scroller, so it has the
  terminal's old problem (the answer LESS visible after it lands than while it ran) and gets the
  terminal's fix, `show_newest`, now taking the element rather than hard-coding one; and the
  transcript sits ON the composer via `margin-top: auto` on `#chat-log` rather than
  `justify-content: flex-end`, because an auto margin collapses to zero the moment the content
  overflows while flex-end leaves the oldest message clipped above the scroll origin, unreachable.
  That rule was written FLAT rather than nested: the build's CSS pass silently dropped
  `& .primary .chat-log > #chat-log` and the void came straight back, which a nested rule that
  compiles to nothing is very good at hiding.
- **The density fix had been applied to one pane out of four.** Workspace spent six lines of
  explanation in front of two lines of shell output, Shared space five in front of "No shared facts
  yet.", Tools four in front of "No tool has been called yet." — the footnote outnumbering the
  signal 3:1 in the region that is supposed to be the live instrument face. Every one of those
  paragraphs is still there, word for word, behind a `<details class="panel-note">` with the live
  read in front of it. The Workspace one lives in the CORE's projection, not the pane, so its
  summary is the machine value a person actually scans for — `Workspace: /root/spaces/research` —
  and the note moved BELOW the scrollback, which is what a footnote is.
- **The rail scrolls, and now says so three ways.** It was clipped mid-line at the top edge with no
  fade, no rule and no scrollbar. A 1.5rem mask at both ends, a thin persistent scrollbar rather
  than an overlay one that appears only while moving, and a tick strip down the left edge —
  `background-attachment` defaults to `scroll`, which pins it to the element and not to the
  content, which is what makes it a ruler instead of wallpaper.
- **One type size pretending to be a hierarchy is noise.** The walk measured 12.8 / 13.12 / 13.6 /
  14.4 / 22.4 — five sizes inside a 1.6px band. Three now, and only three: ~11px tracked mono for
  every label and every value the machine produced (statuses, paths, model ids, the `h1`, the `h2`s,
  form labels), 16px for the conversation and for the one agent inside a turn, and one readout. The
  readout is the clock on a turn in flight at `clamp(1.3rem, 5vw, 1.9rem)` — the only number on the
  page a person is actually waiting on, and the clamp is why it does not overflow 360px. A settled
  page measures exactly two sizes; the third exists only while something is running.
- **Hairlines, not cards.** Inside the console a panel is a region of one surface: the rounded
  border, the gradient and the drop shadow were the last of the styled-document vocabulary, and the
  deck got the same treatment so the page speaks one language. The masthead is a strip with a rule
  under it rather than 78px holding two words. What is NOT built: the corner readout of turn count
  and elapsed and model id as a readout rather than a sentence. The values exist as prose in the
  endpoint line and the memory line, and typesetting them as a readout means either duplicating
  state on screen or cutting copy thirteen walks were built on — neither is worth it for the
  furniture, and the wait clock already carries the one number that matters.
- **The three correctness findings.** (1) Two sentences pointed the wrong way after the layout
  moved: "a real folder in the Linux BELOW" while Workspace is ABOVE Shared space in the rail, and
  "on its card in the Agents panel BELOW" while Agents is BESIDE the editor at 1400. Both name the
  thing instead of a direction now, as does "the transcript below" in the memory line and "the
  commands below are main's" in the workspace note — a sentence that depends on the viewport is a
  sentence that will be wrong at some width. (2) `Stop waiting` said the same thing twice, in the
  transcript and in the pane's own note, nearly word for word. The transcript is the projection of
  the fact; the pane's note is gone, and one event is reported once. (3) `role="status"` sat on the
  whole working-memory sentence, so twenty words were re-announced every turn to report that one
  number had moved. The live region is the count alone — `Working memory: 3 of 8 entries` — and the
  rule that does not change while the page is open is outside it.
- **`prefers-reduced-motion` was finally observed rather than inferred.** Two walks recorded that it
  could not be: `browse` has no `setEmulatedMedia` (deny-default CDP allowlist, and the browser
  runs on `--remote-debugging-pipe` so there is no port to reach), and the Playwright MCP on this
  machine needs an extension that is not installed. `chrome-headless-shell
  --force-prefers-reduced-motion --dump-dom`, pointed at a probe page that links the BUILT
  stylesheets out of `dist/` and carries the core's own working-row markup, answers the question
  directly: with the flag, `matchMedia` true and every `animation-name` `none`, with the accent
  edge, the inner glow, the dot's colour and every word unchanged; without it, `askk-scan`,
  `askk-breathe` and `askk-pulse` all running. Less motion, not less information — measured.

### 12d — the overprint, and one screen

- **The overprint was a sticky item in a grid, and the fix was to delete the sticky.** `.rail` carried
  `position: sticky; top: var(--gap)` from 12b inside a grid whose areas were `"primary rail" / "deck deck"`.
  A sticky box is constrained by its CONTAINING BLOCK, and Chrome takes that as the grid CONTAINER, not the
  grid area — so the rail escaped its own row and painted over the whole second row. Since 12c the rail has
  been a full-height column that scrolls inside itself; the sticky had been doing nothing but the damage.
- **The check that would have caught it did not exist, and now does.** Every walk read the page; none asked
  what a click at a point lands on. `scripts/check-layout.sh` runs the shell's markup against the BUILT
  stylesheets under `chrome-headless-shell` and asserts `elementFromPoint` over a grid of points on the
  routed region, at rest and at max scroll. It reproduces the 12c bug and passes on 12d. It also caught a
  bug in ITSELF: the first probe omitted `<div id="main">`, the div Dioxus mounts into, so its one-screen
  flex chain measured green while the real app was 1631px at 1440. The probe's markup now carries the
  wrapper, because a probe that diverges from the DOM is a check that lies.
- **The deck is a fourth region you route to.** Write an agent, Agents and Settings were a row UNDER the
  console — "one screen sitting on a 1400px manual". They are a tabpanel behind a fifth tab in the same
  tablist, with the same roving tabindex and the same arrows, and BOTH regions stay mounted with one
  `hidden` attribute between them: unmounting the chat pane would drop the poller following a turn.
  With the second grid row gone the desktop page is exactly one screen and there is nothing left to
  overprint. It is also most of the phone fix: at 390 the machine skin went 5668px -> 1639px.
- **`#main` is in the flex chain because it is real.** Dioxus mounts into `<div id="main">`, so `header`
  and `main` are its children, not the body's. `--console: calc(100vh - 8rem)` is gone with it — that
  number encoded a 78px header and main's padding, and 12d moves both.
- **The endpoint sentence moved rather than being duplicated or cut.** 12c declined to build a corner
  readout because it meant either duplicating state or cutting copy thirteen walks were built on. The
  third door was "move it": the sentence is typeset into the header strip, word for word, and deleted from
  the chat pane. The header holds information now instead of two words.
- **One tone, not a second accent.** `--machine: #a9c6e0` at 10.88:1 on `--bg`, above the 9.76 of the
  `--ink-dim` it replaces, on statuses, paths, tool arguments, shell commands and speakers. Purple stays
  the single accent; no measured contrast went down.
- **Motion that corresponds to something.** A pulsing dot on the row whose `data-status` is `working`, and
  one 1px mark travelling the rail's tick strip while `.board-busy` has something to say — the core's own
  live region, selected with `:has()`, so no new state exists to drive it. Both stop under
  `prefers-reduced-motion` and take neither a word nor a colour with them.

---

# The glass run — liquid glass facelift

Goal: translucent surfaces over a blurred, softly lit ground, with real depth
from light and shadow, judged against real reference pixels rather than against
a description of them. Application behaviour does not change; a functional
regression fails the whole run.

State lives in three files: `DESIGN.md` (the source of truth, upstream of all
code), `checklist.md` (parts, criteria, status), and this ledger, append-only.

## Cycle 1 — the token layer, the material, the file split (part A)

**Dispatched:** a reference-gatherer (real screenshots + measured
`getComputedStyle` from Apple, Reflect, Linear, visionOS), then part A to the
orchestrator directly — the token layer, the material and the file split are the
same edit seen three ways, and splitting them across agents would have produced
three of them racing on `:root`.

**What the inventory found** (`audit.md`): eight stylesheets, 1,319 lines, 161
selectors in 208 blocks. **Four of the eight — 706 lines, 54% of all CSS —
existed only to override the other four behind `html:not([data-skin="plain"])`.**
Thirteen font sizes; three tokens existed and twenty of thirty-seven declarations
ignored them. Forty-three spacing values against one `--gap` token, including
`0.4rem` and `.4rem` in two files. `--bg` and `--surface` each held two different
values. Six colours bypassed the token layer entirely, one of them a hardcoded
accent fallback that no longer matched the accent. Zero `backdrop-filter`, zero
`z-index`, zero `transition` in the entire product. Six surfaces were styled from
three or more files; `.rail` from four files across nine rule blocks.

**What the reference measurement changed.** The captures came back with verbatim
computed values, and **six numbers I had written into DESIGN.md were wrong in the
same direction — too much material**:

| | guessed | measured reference | shipped |
|---|---|---|---|
| E1 blur | 28px | Apple curtain 20px, Linear header 20px | **20px** |
| E3 blur | 40px | Reflect popover 22px — nothing in the set exceeds 22 | **22px** |
| saturation | 170% / 185% | `saturate(1.8)` appears **only on Apple's light chrome**; every dark surface has none | **110% / 115%** |
| E1/E2 outer shadow | real shadows | three of four references are `box-shadow: none` and carry the effect on blur + hairline alone | **none** |
| hairline alpha | .075 / .14 | measured band is .08–.10 (Reflect .1, Linear .08) | **.08 / .10** |
| card padding | 16px | Reflect's card is `24px 32px` | **24 / 32** |

The pattern is worth naming because it will recur: **guessing this aesthetic
produces too much of it.** Every correction was downward. The one thing the
reference does *more* of than I had is the top edge — Linear paints a second
inset white at 4%, Apple a specular arc, and Reflect skips it and reads flatter
for it. That treatment stayed, retuned.

Also corrected: Apple's published number for clear glass over bright content is a
dark dimming layer at **35%**, which is now `--e3-dim`, because our lit lobe *is*
bright content.

**What shipped.** Seven files, one concern each, none of them gated on the skin:
`tokens` (199) · `base` (104) · `glass` (124) · `layout` (105) · `chrome` (108) ·
`surfaces` (184) · `controls` (136).

The load-bearing idea is that **the skin is a token swap, not a stylesheet.**
`[data-skin="plain"]`, `@supports not (backdrop-filter)`, and
`prefers-reduced-transparency` all re-point the same tokens in `tokens.css`. So
the opaque fallback is not a separate path that nobody exercises — it is the path
the plain skin uses, every time anyone switches skins. And the repo's
most-repeated defect, a both-skins rule written machine-skin-only (five
occurrences across increments 12 and 13), stops being expressible at all.

**Two real defects, each proven by reinstating it.**

1. **The three regions were shrinkable flex items in a height-constrained
   column.** `.stage` measured 318px around a 513px chat panel; with
   `overflow: visible` the panel spilled 255px past its own parent and painted
   on top of the rail. Twenty-four OVERLAP and HITTEST failures at 768 and 1024.
   `flex: 0 0 auto` in the stacked path; `min-height: 0` kept only in the grid
   path, where a region genuinely scrolls inside itself. Reinstating it
   reproduces all 24.

2. **The contrast audit read any non-zero alpha as opaque.** So the glass fill
   `rgba(255,255,255,0.055)` was measured *as if it were the ground*, and every
   ink on chrome scored 1.12:1 against near-white — 108 failures against a page
   that was fine. The page was right and the model was wrong, which is the more
   dangerous shape of that bug. `ground()` now composites src-over to the root
   and measures against the **lit lobe**, the lightest region of the ground and
   the only place light-on-glass fails. Restoring the decorative hairline as a
   control border reproduces `FAIL BOUNDARY ... 1.29:1 on lit-lobe backdrop`.

**Honest limitation on that second fix:** the lit-lobe backdrop is *modelled*
(the accent lobe composited over `--ground` in JS), not sampled from a rendered
screenshot. DESIGN.md §10.1 asks for rendered pixels. The model matches the
arithmetic in §3 exactly, and it caught a real 4.49:1 failure that a fill-colour
check would have passed, but it is not the same thing as reading the framebuffer
and should not be described as if it were. Carried forward.

**New guard.** `scripts/check-selectors.py` enforces G1 (no *(selector,
property)* pair in two files), G2 (no skin-gated rules), five font sizes, zero
raw spacing literals, and the 200-line ceiling. G1's unit is the pair and not the
selector, and getting that wrong was the first mistake in DESIGN.md: "no selector
in two files" sounds stricter and is useless, because it forbids `glass.css`
giving `header` its fill while `chrome.css` gives it its position — the exact
separation the split exists to create. What actually shipped broken twice in
increments 12 and 13 was **one property declared twice**, where the loser was the
newer rule. All three assertions verified to fail on demand.

**Result:** `check-layout.sh` 24 runs, 0 FAIL. Commit `ab6d7dd`.

| Metric | Before | After |
|---|---|---|
| Stylesheets | 8 | 7 |
| Lines of CSS | 1,319 | 960 |
| Skin-gated rule blocks | ~90 | **0** |
| Distinct font sizes | 13 | **5** |
| Raw spacing literals | 43 | **0** |
| Roles holding two values | 2 | 0 |
| `backdrop-filter` declarations | 0 | 12 |
| `transition` declarations | 0 | 4 (part G in flight) |

## Cycle 2 — dispatched, in flight

- **B + C + F** (component library, `/design-system` route, empty states) to one
  owner: all three touch `crates/ui/src`, and the brief's own rule is to fan out
  only where the work is genuinely independent.
- **D + I** (the glass guard: N1–N4, G3, and 320/1920 coverage) — owns `scripts/`.
- **G** (interaction states: all five on every control, the two-tone focus ring)
  — owns `controls.css` and `base.css`.

File ownership is disjoint by construction, and `check-selectors.py`'s G1 will
catch it if it is not.

## Cycle 3 — the critique, and what it cost to answer

**The blind critic said ours loses, and not narrowly.** Its single largest gap
was a number: the brightest pixel in the rendered ground was **55/255**, and
under the glass the backdrop never passed **32**. The material was implemented
correctly and had nothing to work on — at thumbnail scale the page read as a
wireframe.

The instructive comparison, and the reason this was not "our page is too dark":
Reflect is globally *darker* than us — 91% of its pixels under sRGB 52 against
our 87% — and still reads as lit, because it puts 3.1% of its pixels above 208
and puts **all of them directly behind one card**. Ours was three faint lobes
spread over 1440px. Light that is spread is not light.

Answering it broke two things, and both were right to break:

- **Fill and dim were two layers** — a white-alpha fill over a dark `::before` at
  55%. Wrong twice: a pseudo-element with `inset: 0` does not cover the scrolled
  area of a scrolling panel, and nothing that measures a page by walking
  `backgroundColor` up the tree can see it, so the guard read the raw beam and
  failed a page that was fine. Composited into one rgba — which is also the
  shape the reference uses. Apple's localnav pill is `rgba(42,42,45,0.843)`,
  Reflect's card `rgba(4,1,21,0.1)`: a **dark** tint on a bright ground. The
  original had the polarity backwards.
- **`--control` measured 1.81:1** the moment there was light behind it. 3:1 is
  measured against the brightest backdrop a boundary sits on, and that backdrop
  moved. `#8b7aa8` → `#c0b3d4`.

Three further findings from the same critique, all of them defects in this
document rather than in the code:

- **The centre column was blurred.** §4 listed "the stage's own container" under
  chrome while §1 says "if the mockup's centre column is translucent, reject it".
  The document argued with itself and the code took the losing side.
- **N3's selector list was incomplete** — it named the nestings that sounded
  likely and missed the two that occur. Three translucent layers stacked on a
  content area for a cycle. The guard did not catch it because N3 was the one
  nesting rule nobody wrote an assertion for.
- **G3 had 37 violations, not the two already fixed.** The chat log obeyed it
  from the start; every other body-text region had been skipped.

And the "one code path, three triggers" claim was **false**: `--e*-lit` was
zeroed in the plain skin only, so a `prefers-reduced-transparency` user kept a
specular top-edge highlight on a surface with no material under it. A critic
reading the built CSS caught it while the rendered page looked fine.

## Cycle 4 — components, and the gallery earning its keep

Thirty-nine hand-rolled elements across the screens went to zero: 8
`section.panel`, 15 raw `button`, 4 `details`, 4 `form`, 6 `input`, 1 `textarea`,
1 `select`. They had already drifted — some panels carried `aria-label`, some
`aria-labelledby`, one both.

The mechanism is `#[props(extends = global_attributes, extends = <element>)]` on
every component, so `role`, `aria-*`, `tabindex` and `hidden` pass through
untouched. That makes losing an accessibility affordance take an edit rather
than an omission. `Form` earns its existence on one line — `e.prevent_default()`
— which four call sites each remembered and a fifth would not have.

`/design-system` immediately paid for itself: **`.btn-secondary` and `.btn-ghost`
were the same declaration**, both `transparent`, which is §8's definition of
ghost. Two variants rendering identically, put side by side and caught.

**Not built, and not hidden: Toast and Modal.** No call site exists for either,
and a focus-trapped modal built only to appear in a gallery is speculative. The
gallery shows the E3 material and says so. This is a gap against part C's
criterion and is recorded as one, not marked passed.

## Cycle 4 — performance, which refuted part of this spec

Measured on Chrome 145 `--headless=new` over CDP with a `Tracing` capture, real
Metal GPU, 1440×900 at DPR 2, 200 messages injected as the markup the core
actually emits, scroll driven by `Input.synthesizeScrollGesture`. Three reps per
configuration, freshly launched.

**The method note matters more than the numbers.** `requestAnimationFrame`
deltas are useless here: headless drives a synthetic 60 Hz vsync and returned
exactly 16.66–16.67 ms for *every* configuration including a deliberately broken
one. A rAF-based measurement would have reported "perfect" for all four. Frame
*work* — top-level `RunTask` slices across four threads binned into vsync
windows — is the signal. Dropped-frame counts are likewise not a valid budget
signal in headless, because the display never falls behind.

| Run | median | p95 | frames >16.7ms | GPU compositor |
|---|---|---|---|---|
| Scroll 200 msgs, glass | **2.06 ms** | 3.49 | 0/0/0 | 0.83 |
| Scroll 200 msgs, plain skin (control) | 2.43 ms | 3.49 | 0/0/0 | 0.82 |
| Open/close E3 over scrim, glass | 3.06 ms | **7.24** | 1/0/0 | 1.64 |
| Same, plain skin | 2.98 ms | 5.54 | 0/0/0 | 1.30 |
| Scroll, N2 rule deleted | 3.38 ms | 4.70 | 1/0/0 | 1.09 |

**The material costs nothing measurable on the scroll path** — the glass reps
straddle the plain reps and the delta points the wrong way. The worst case
anywhere is the E3 open at p95 7.24 ms of a 16.7 ms budget. The reason is
structural: no blurred surface sits over a scrolling region. The grid puts E1
chrome *beside* the stage, and G3 already made the chat log opaque, so scrolling
200 messages never dirties a backdrop.

**N2 reproduces, but not for the reason DESIGN.md gave.** Deleting it costs
+1.3 ms median frame work and exactly one extra vsync of latency — real,
reproducible, and a ~40% increase on a number at 12% of budget. It is not what
stands between this UI and 20fps. §4 called it "the performance rule" and that
over-claimed; the anti-mud argument alone justifies it. Worse for the spec:
**most of the benefit comes from the `.stage .panel` selectors, not the `.e1 .e2`
selector §4 quotes** — and since `.stage` left the E1 group those selectors are
no longer preventing a blur-inside-a-blur at all. They keep the centre column's
cards calm, which is §1's rule under N2's name. §4 now says so.
| 15A–15F | The uplift toward a better Hermes: the workspace boots on page load, the nav navigates between six views and lands on a Dashboard, a turn runs to a per-agent `max_rounds` instead of four, you can steer a run while it runs, and the frame says what the page has spent | 44+ green (`meter.rs` +2, `rounds.rs` +2), `check-layering.py` green | Local COI server: `workspace ready` and `crossOriginIsolated: true` within 3s of navigation with NO command run; nav routes all six views with one `.view-panel` visible at a time; 0 console errors | ✅ LOCAL, against the real model (omlx `gemma-4-12B-it-qat-mxfp8` @8873): a `now()` turn answered with a tool call and the meter read **3025 tokens**; then two `exec` calls into the prewarmed CheerpX Alpine returned `Linux 4.15.0-54-cheerpx i386` and `apk-tools 2.12.14`, meter **6353**. Not yet walked on the hosted page | `d60d681` `46026a3` `7be097c` `3e4fbf9` `95c535c` `a1b0cfb` | The bar-raiser's audit (BARRAISER.md) named `MAX_TOOL_ROUNDS = 4` as the single thing standing between this repo and Hermes: "everything architecturally hard is already done … and it is all wired to a loop that quits after four tool calls." Raising it exposed the next two: a 36-second WALL-CLOCK patience in `turn::watch` would have declared a working 64-round agent dead, and a composer disabled for the duration of a turn cannot be half of "human in the loop". `ModelCalled` and `ModelReply.usage` had both been in the closed set since G2 with nothing emitting or filling them. |
| 15G–15L | The machine made visible and the loop made real: a Files pane over the CheerpX Alpine, the bar-raiser's three defects fixed, the layout gate repointed (and catching a regression), mid-turn compaction, and a task launcher that needs no conversation | 159+ green (`files.rs` +3, `rounds.rs` +3, `compact_mid_turn.rs` +1, `meter.rs` +1); `check-layering.py`, `check-selectors.py` (8 files) green | `check-layout.sh` OK in both skins after being repointed at the post-15B shell — and it FAILED first, on a real 15B regression: the agent strip at 1.99:1 text / 1.17:1 outline once it moved off the left panel onto the bare stage. Zero duplicate ids on all seven views, one `<h1>` | ✅ LOCAL, against omlx `gemma-4-12B-it-qat-mxfp8`: browsed to `notes/today.md` in the real Alpine and read "hello from alpine." out of it; steered a live run ("count to 5" → two seconds later "stop at 3 and say DONE" → **"1. 2. 3. DONE."**, one turn, nothing re-sent); launched an autonomous task from the Dashboard with no chat at any point and found `proof.txt` in the workspace afterwards | `ff6ff72` `55f6c6d` `5990e87` `f8e01e4` `20cb609` `2c2f237` | The audit earned its keep four times. 15D's steer was DROPPED whenever the reply that followed it was the final answer — the sentence sat unanswered under the answer to the previous question, and it read as an answer to the steer. The stall detector killed working runs, because the transcript renders nothing for a tool call and 36s of a long `apk add` is silence. `TIMEOUT_MS` was 30s — tighter than the work. 15H's fix (mount one view at a time) then broke the composer until you opened Settings, which is the same class of bug: a signal published by a component nobody has mounted. And 15J: a 64-round ceiling is worth nothing if round thirty cannot see round one, because compaction only ever ran at the top of a turn. |
| 15M–15P | Artifacts, the pulse that keeps a launched run observed, a sub-agent that is no longer a black box, and an editable workspace | 172 green (`files.rs` +4, `meter.rs` +4, `rounds.rs` +3, `compact_mid_turn.rs`); all four gates green together for the first time in the series | `check-layout.sh` OK in both skins, now measuring the dash grid, the launcher field and the Files rows too; `check-selectors.py` 8 files; zero duplicate ids | ✅ LOCAL: an agent-written `artifacts/hello.html` renders as a lime page in a sandboxed pane; `researcher`'s own `now()` call reaches the page under `data-agent="researcher"`; a person edits `proof.txt` in the browser and the agent reads back "ok, and edited by a person" from the real Alpine. **Measured: the store went 39,237 → 336 events and stopped growing while idle** | `8e9461b` `2d7f9b6` `4460d14` `47072d1` | The third audit found the page was the database's own worst client. Every seam GET appended a `RequestHandled` fact, which the NEXT request cloned into `Ctx` — so polling made polling dearer, forever — and `SpaceInspector` spawned an immortal poller on every `tick`, on the view the page lands on. Both fixed, plus schema v2 to clear what was already there. The other half: whether anything observed a run at all depended on which view happened to mount a polling panel, so the shell keeps its own heartbeat now; and a Worker's tool calls and spend cross the boundary as `core.agent_activity` facts carrying the name that `ToolInvoked` does not have. Eight files had crossed the 200-line rule — six of them mine — and each was split on a real seam. |

---

# UX loop — critique rounds

A fresh-context critic walks the running app with no source access, no docs, no
memory of this repo. Its findings land here verbatim-enough to be actionable,
then UI-only fix agents (also fresh) close them. The bar is Hermes; the goal is
past it. Functionality does not change in this loop — only what the screen says,
where it sits, and what it looks like.

## Round 1 — critic report (local, http://127.0.0.1:8901)

**Time to first understanding: ~40s, partial.** Tab says `ASKK`, `<h1>` says
`HARNESS`, and no line anywhere says what the product IS or who it is for.

25 findings. The three P0s:

1. **The product never says what it is.** No tagline. First body text is "Give
   main something to do and leave it." A first-timer concludes it is an internal
   dev tool they were not meant to see.
2. **"Run a task" silently retargets** to whichever agent was last selected in
   Chat. The panel title, the `Run` button and the agents list all stay
   unchanged; only line 1 of a seven-line paragraph names the new target. You
   fire work at the wrong agent and never know.
3. **The only CTA in the Shared-space empty state is inert.** `Ask main to
   remember something` does not navigate, prefill, or even move focus — while
   its sibling `Write the first message` on Chat does focus the composer.

The P1s, compressed: `▾ Views` deletes the navigation and is named like a menu;
`▾ Instruments` is silently inert on four of seven views while still rendering
an expanded chevron; nav labels do not match their own page headings (Memory →
`SHARED SPACE`, Trace → `TOOLS`); repo-internal identifiers are the default
user-facing vocabulary (`max_rounds`, `Worker`, `public/agents/`, `DESIGN.md
§8`, `shelf`); six abstract glyphs with no shared logic and no tooltips;
explanation outweighs signal everywhere (7 lines of prose to introduce one text
field, at 13px, 46 nodes at that size); Workspace inverts its own hierarchy —
the live Linux sits in the 280px rail wrapping every `ls` row while two nearly
empty cards hold the 700px column; the model-failure paragraph prints twice on
one screen with no Retry and no link to the Settings it tells you to open; the
header's only health dot is green while the model is unreachable; no URLs, no
deep links, reload always dumps you on Dashboard; Trace cannot tell an agent's
call from one the human typed.

**Credit, unprompted:** the settings save confirmation, the mid-run composer
swap (`Send` → `Send to the run`) with its `waiting for the model — 4s` clock,
surviving reload, and `aria-current="page"` on the nav.

## Round 2 — critic report (a different stranger, same cold start)

**Time to first understanding: 9 seconds, down from ~40.** The tagline did the
work — the critic named it unprompted as "the single reason I understood this at
all" — and the nine seconds were spent triaging the header, not the product: a
red failure pill, an amber `workspace starting…` dot and a greyed
`No instruments here` button all sit ABOVE the sentence that explains what this
is. We fixed the explanation and then buried it under our own alarms.

20 findings. The three P0s are all about a promise the UI makes and does not keep:

1. **`Watch it` lands you at the TOP of the transcript.** `stage.scrollTop = 0`,
   newest turn ~1000px below the fold. The critic concluded the task had been
   LOST and only disproved it by reading the DOM.
2. **The launch confirmation never resolves.** `main is on it: "…"` sits 40px
   from a card reading `main · failed · the endpoint was unreachable`, and the
   confirmation is a static string with no terminal state. Two authoritative
   statuses for one object, one of them permanently wrong.
3. **840px of chrome before any content at 390×844.** The header stacks to
   ~300px and the seven-item sidebar to ~660px; the task input is at y=986 and
   the composer at y=1204, both below the fold, with the `Hide sidebar` control
   itself buried inside the stacked header.

The P1s: the header failure pill is global but sits inside the per-agent
`Agent: author` cluster (author has had zero turns) and does not clear after the
endpoint is corrected; five byte-identical error walls stack with no dedupe;
Settings has no way to test the endpoint on an app whose only failure mode IS
the endpoint; the API-key label mutates mid-typing into `(the Python reads it
from OMLX_API_KEY)`; navigating away mid-command silently discards the running
command and its output, contradicting our own copy — "Nothing on this page waits
for it — switch views… without restarting anything"; `Run` with an empty field
is enabled and does nothing, while `Save agent` next door gets this right; and
two buttons labelled `Run`, identically styled, mean "dispatch an autonomous
agent" and "execute one shell command".

**Kept, on the record, so nobody sands it off:** the tagline; the endpoint error
body ("three causes, ranked, actionable, no stack trace — best error copy I have
read in an internal tool"); the save confirmation that restates the resulting
behaviour; the shell's echoed `$ command` + `(exit status 127)`; the
`running…` in-progress state; state-aware helper text; and the keyboard basics.

## Round 3 — critic report (third stranger; verdict: NOT at the bar)

**Time to understanding: 11 seconds — worse than round 2's 9.** Not because the
words got worse: the tagline is still "the best sentence in the product". It is
because the boot screen shows nine seconds of `booting the core…` under a header
full of `HARNESS`, `Agent: main`, `workspace idle` — every one of them jargon to
a stranger — and the sentence that explains the product is not on screen until
the Dashboard paints. We wrote the explanation and then put a loading spinner in
front of it.

23 findings. The verdict, verbatim: *"a very well-written prototype, not a
product at the top-tier bar"* — and the defence is that **the screen contradicts
itself at the two moments that matter most**:

1. **P0 — `Read the reply` opens "No messages yet."** Launch, press the button
   the product itself offers, and land on the empty state — while the side panel
   shows the `write_file` call and the board says `1 reply`. A reload makes all
   three messages appear. A first-timer's single SUCCESSFUL run reads as a
   failure at the exact moment it worked.
2. **P0 — the board contradicts the launcher at the instant of launch.** One
   second after Start agent: left card `main is on it: "Write a haiku…"`, right
   card `main — ready — your turn whenever you like · no replies yet`. Two
   adjacent panels, opposite claims, same instant — and our own copy promises
   "'Agents running' below says how far it has got".

The P1s: `Dismiss` silences the CLASS, not the instance — two further failures
raised nothing, leaving a green `● workspace ready` (the sandbox, not the model)
reassuring you while every turn fails. `Retry` re-ENTERS instead of re-running:
one press appended a second `YOU: hello` and a second full error block, while the
ordinary path correctly collapses to `Same error (×2)`. The common transient
failure (server not up) is the one with NO Retry; the permanent one has it. There
is no way to stop an agent — `Stop waiting` stops looking, and the `sleep 45`
kept running. Below 1000px the nav is a 380px wall you scroll past, then it sits
at `y = -452` while its toggle still says `Hide sidebar`. Status pills truncate to
`● workspac…` at 800px, and at 390px the status pills are dropped while
`Tokens, all time` survives — the vanity metric outliving the state indicator.
One lifecycle state is worded three ways in one list (`ready to start`,
`ready — your turn whenever you like`, `starting up`). `3 replies` counts three
failures. And every transcript opens with `Working memory: 5 of 8 entries,
compaction runs at 8` — which on an older session read **`11 of 8`**.

**Named as genuinely good, do not sand off:** the tagline; the in-progress state
(`in this turn for 2s · last tool: write_file`, the composer morphing to
`Send to the run`); the unsaved-settings warning; the reload-mid-run message
("Nothing was lost; ask again"); the three-cause endpoint explanation; roving
tabindex on the agent tabs; the working skip link; `Same error (×N)`.

## Round 4 — critic report (fourth stranger; verdict: NO, but the gap changed)

**Time to understanding: 7 seconds** — 40 → 9 → 11 → 7. The critic completed a
REAL end-to-end task unaided (asked main to write `fruit.md`, then verified the
file existed) in about four minutes, with three moments of doubt and one dead
end. The verdict is still No, but for a different reason than round 3's: *"the
gap is now about trust rather than comprehension… an agent product's contract is
'I will tell you truthfully what I did on your behalf', and this one attributes
one agent's shell history to whichever agent you happen to have selected."*

18 findings. The one P0 is ours, not a matter of taste:

- **F1 — the Workspace terminal renders the actor from the SELECTED AGENT, not
  from the record.** The same row reads `main ran $ sleep 20 — ok` or
  `researcher ran $ sleep 20 — ok` depending on who is selected. Proof it is
  fabricated: with researcher selected, Tool trace says "No tool has run yet"
  for researcher while Workspace shows researcher running five shell commands.
  Two agent-scoped views, same agent, flatly contradictory. We shipped this in
  round 2 while fixing attribution.

The P1s: the artifacts empty state's ONLY action is guaranteed to fail on a
fresh workspace (`ls: artifacts: No such file or directory (exit status 1)`) and
it renders that failure into the WORKSPACE FILES panel, wiping the file list —
one CTA, three faults; no way to stop a running agent (the copy is honest, and
honesty is not a control); the task field is a single-line input that scrolls to
21,598px in a 958px window, so you cannot read back your own instruction;
disabled `Delete` renders in full danger red while its disabled neighbours are
muted, making it the only button on an empty form that looks live; a rejected
save prints its rejection and `Saving writes my agent!! into this browser.` at
the same time; and invalid fields are marked by colour alone, with no
`aria-invalid`, no `aria-describedby`, and the message two fields away — the
product's own design system says "a dot AND a label, never a dot alone".

The P2s worth naming: the header grows 70px → 126px the instant you press Start
agent, shifting everything below by 56px at the moment of highest attention;
markdown is not rendered, so every reply prints its own backticks; the trace rail
sits at `scrollTop 0` of 2363 while a message three inches away points at it;
prose runs 149 characters at 14px while `h2` is 11px — headings smaller than
body; empty states are written as prophecies ("it fills up once main has run a
task") that were false minutes later; and one intent has five names — `Start
agent`, `Give main a task in Chat`, `Ask researcher something`, `Send`, `Send to
the run`.

**Named as genuinely good:** the tagline; the reload-mid-run note ("the best
sentence in the product"); the in-progress state and mid-run steering; the CTA
that changes with state (`Watch it` → `Read the reply`); the roving-tabindex
tablist ("correctly built"); measured contrast (body 10.2:1) and ≥44px targets;
and spacing discipline — "every panel 24px 32px, 12px radius, 12px gap. Zero
drift."

## Round 5 — critic report (fifth stranger; NO, but the blocker is now a single sentence)

**Time to understanding: 4 seconds** (40 → 9 → 11 → 7 → 4), and the critic
completed a task of their OWN invention — "create colors.md listing three
colors, then tell me the contents" — **first try, unaided, in about 90 seconds,
correct**. The happy path is at the bar. Everything one step off it is not.

22 findings. The verdict names one blocker: *"status truthfulness across agent
switches… once a user stops believing an agent product's status display, nothing
else you built matters."* Concretely:

- **F1 — the side panel shows one agent's files under another agent's name.**
  With `author` selected: `SIDE PANEL · AUTHOR` → `WORKSPACE FILES` →
  `colors.md`, `notes.md`, plus a live editor — while the main pane on the SAME
  SCREEN reads `No workspace for author` and the Agents view says "No space, so
  no workspace: it cannot run commands." Per-agent panes carry over instead of
  clearing.
- **F2 — `● workspace ready` stays green for an agent that has no workspace.**

The other trust failures: **three buttons labelled `Start agent` do not start an
agent** — the ones in the Shared-space tile, the Shared-space view and the Tool
trace empty state all navigate to Chat, and the critic pressed one by mistake
within the first minute and "distrusted every button on the page thereafter";
the same call is logged twice under two different actors (`you ran read_file` at
09:59:02 followed by `main ran read_file` at 09:59:02, identical output), which
destroys the you/main distinction the critic separately called "one of the
smartest ideas in this product"; the Artifacts pane's own polling manufactures a
red `list_files path=artifacts — failed` row and shows it to the user; the file
editor never names the file it is editing (no selected state, contents rendered
twice, identity only in an invisible `aria-label`) — the critic overwrote
`notes.md` and only learned which file it was afterwards; and the composer is
left pre-filled with the just-completed task, `Send` armed, a duplicate-submit
trap. Enter submits with nothing saying so — the critic launched a real run by
accident, and there is still no Stop.

**The aesthetic judgement is the most useful thing in this report**, and it is
diagnosable rather than vague: *"restrained, coherent, and slightly
under-designed… the type system stops after three sizes."* Counted over every
rendered leaf: **42 elements at 14px, 5 at 18px, 2 at 32px, 1 at 11px.** Prose,
button labels, nav items, status strings, file names and code results are all
14px, so every panel reads as one undifferentiated slab. Body leading is 1.40 —
a UI-label leading applied to seven-line teaching prose. The typeface is
`ui-sans-serif`: "zero typographic identity… a product with a palette this
specific and copy this carefully written has clearly had someone's attention,
and then shipped in the OS default font." And the two gradient blobs are the
only ornament in the product — "tellingly, `Plain background: on` looks better:
cleaner, more expensive, more focused. The default should probably be the plain
one."

Praised, measured, keep: panel geometry with zero drift across seven views
(`24px 32px`, `12px`, one fill, one hairline); the focus ring; triple-clicking
Start agent produced exactly one run and 40 rapid nav clicks produced no desync;
`working · 8 turns / in this turn for 2s / last tool: read_file`; the
reload-interruption copy ("best-in-class error writing"); the compaction
disclosure — "something almost nobody does".

## Round 6 — critic report (sixth stranger; NO, and the blocker is one sentence again)

**~6 seconds to understanding, task completed unaided on the first attempt.** The
critic invented their own: write `tea.md` with three numbered steps, then run
`wc -l` and report the line count. The model answered "3 lines" and the trace
showed `exec: 2 tea.md` — *"the UI faithfully showed me the receipt that proved
it wrong… the trace made the model's error legible in about two seconds. That is
the product working."*

**Both round-5 aesthetic bets were validated.** The serif: *"the right call,
applied with real discipline — exactly three elements carry it… the 18px serif
lede at a 544px measure is the single most confident thing on the page. Ship
it."* The plain default: *"Off is better, and putting it behind a toggle with
the honest caption is the correct amount of respect for the user."*

15 findings. The verdict names one blocker: **"the interface does not reshape
itself around the selected agent or the current run state. It renders one
canonical layout — main's capabilities, the idle invitation — and then patches
contradictions in below the fold or in a corner of the header."** Three
instances, in the critic's order of damage:

1. **Press Start agent and the card resets to pristine.** Composer empties,
   `Start agent` greys out, the three example prompts come back, and the line
   `Start agent turns on once you have typed a task.` returns — while 300px
   lower, below three CTAs and below the fold, the same card says `main is on
   it`. The critic's literal note: *"did that do nothing?"*
2. **The starter prompts never change with the selected agent, and they lead to
   a fabricated success.** With `summarizer` selected — which the card beside it
   correctly says works alone — all three offered prompts require a workspace.
   The critic ran one; it "finished" and asserted *"The file notes.md was
   successfully created"*. It was not.
3. **The header still asserts `● Linux sandbox ready` under `Agent: summarizer`.**
   Round 5 reworded this rather than scoping it. The wording is defensible and
   the reading is not.

Also: the selected agent is not in the URL and silently resets to `main` on
reload while the VIEW is preserved — two adjacent selections persisting by
different rules; the header still shears mid-word (`Agent: summari`, `Tokens,
tin`, the model line reduced to `This`); `Reset every endpoint to the shipped
list` is styled as a peer of Save with no confirm, in a product that already
ships `btn-danger`; the in-flight strip wraps `waiting for the model — 0s` across
four lines and its button across five, and its timer says `0s` while the board
says `in this turn for 17s`; and agent-card prose runs 1044px while every other
paragraph in the same view is 544px.

**The aesthetic verdict is now about LAYOUT, not type:** *"Inside a single card
there are three content widths: prose 544, textarea 960, panel 1136. Roughly 40%
of every panel is dead space, on the right, on every view… and the right-hand
void is exactly where the running state should have gone. The layout has the room
and refuses to use it."* And: *"The typography says 'product'. The layout rhythm
and the self-shredding header say 'internal'."*

## Round 7 — critic report (seventh stranger; NO, "closer than the finding count suggests")

**4 seconds to understanding; an invented three-step task done unaided, first
try, in about 60 seconds** — `df` the workspace, write the number into
`disk.md`, read it back. The model fumbled `write_file` into a shell (exit 127),
recovered, and succeeded, and the critic watched the whole recovery in the live
trace beside the conversation: *"the model fumbled twice and recovered, and I
could see exactly how. Nothing was hidden."*

**The layout system was judged half-landed.** Where it applies: *"Chat with a
live tool trace pinned beside the conversation is a genuinely superior reading
experience to the vertical scroll every competitor ships."* Where it does not:
Agents ships 592px of dead space per card down a long page, Appearance opts out,
and — the real defect — **hiding the sidebar gives every reclaimed pixel to the
COMPANION** (reading column stays 608px, companion grows 496 → 704), so the
secondary panel out-weighs the primary action. *"The container query is real and
it fires; it just isn't applied everywhere, and its proportions aren't clamped."*

17 findings. The verdict names the blocker: **"the product does not consistently
tell the truth about its own internal activity."** Four instances:

1. **Tool trace is 78% the app talking to itself, most of it rendered as
   errors** — 70 `the file pane ran list_files path=artifacts — not there yet`
   rows against 20 real `main ran` rows, growing by ~10 per visit to Workspace.
   Round 6 fixed the ATTRIBUTION and left the noise.
2. **The Dashboard reports a reload-killed run as a completed one** —
   `main ready · 26 turns` — while Chat is honest about the same turn. And the
   board is the surface our own copy nominates: "'Agents and what they are
   doing' below says how far it has got."
3. **The failure text rides on a row that is actively working**: the first frame
   after the critic's first action read `main working · 23 turns · the endpoint
   was unreachable`.
4. **A normal configuration prints in error red** — "author is in no shared
   space…" in red in one card and in ordinary grey in the card directly below.

Plus a dead primary CTA (`Write the first message` moves nothing — the one
button a new user presses on an empty agent), and an instruction the product
cannot carry out (`Open its agent file` lands on the agent list, scrolled to the
top, with no editor).

**Aesthetics, third judgement running:** *"This is the work of someone with an
actual point of view… The measure is disciplined: 541px at 16px is about 66
characters, and it holds at 544px even in the stacked layout. Someone counted.
I went looking for drift and found exactly one violation."* And: *"Would someone
pay for this? For the Chat-plus-trace view, the Workspace file editor, and the
copy — yes, without hesitation… What stops it looking paid-for is not taste, it
is finish."*

Singled out as the hardest thing in the audit and now right: **agent switching
is completely truthful** — pill, examples, shared-space card and board all
change together, nothing goes stale.

## Round 8 — critic report (eighth stranger; the AESTHETIC verdict flipped to yes)

**7 seconds to understanding; an invented task — "create primes.txt with the
first 15 primes, then tell me their sum" — completed first try, unaided, correct
(328), in about 90 seconds.** The critic watched `awk` fail with a shell syntax
error and the agent silently retry, and rated the trace *"the most trustworthy
view in the product… It does not hide the agent's mistakes."*

**The aesthetic question is settled: "Yes, this now looks like something someone
would pay for. That is a real change and I want to be clear about it before the
criticism."** The evidence is measured, not tasted: every button in the product
shares 44px height, 8px radius, 8/12 padding and 14px, in three tiers with no
exceptions; gaps run 4/8/12/16/32 with no strays; and in a 900px screenshot
there is exactly **one** off-palette colour in the whole product — the CheerpX
credit link, used once. *"Palette discipline at that level is unusual and it is
the single biggest reason the page reads as designed rather than assembled."*
And on the serif: *"letting the marketing sentence be the serif while the
machinery is all Inter is a real point of view: this thing believes the
explanation matters as much as the controls."*

19 findings. The verdict names the blocker: **"the header and side panel are
laid out for the success case only. Every P1 above is one composition breaking
under a state its author didn't lay out for — an error, a narrow screen, a long
tool argument, a return visit."**

1. **At 390px the agent name and the side-panel button overlap** — the name
   occupies x=210–243 and the button starts at x=232, so it renders `Agent: m`
   with a control sitting on top of it.
2. **The error banner evicts the two facts you need to fix the error.** Told
   "the endpoint was unreachable", the header drops the token meter AND the line
   naming which endpoint. *"Error states must add information, never subtract
   it."*
3. **On mobile that banner reduces the conversation to 24 pixels** — header
   297px of an 844px screen, chat log `client=24, scroll=1306`.
4. **The banner is stale and Dismiss does not survive a reload** — it returns
   after the endpoint has been corrected and saved.
5. **The rail scrolls sideways and cards escape their borders** —
   `client=372 → scroll=642`, because tool arguments never wrap — and it arrives
   pre-scrolled to 107, decapitating its first heading.
6. **The run receipt is ephemeral and there is no run history.** Navigate away
   and back and "main finished / Read the reply" is gone — in a product whose
   own copy says *"Give main a job and walk away."*

Also named: four names for one place (nav `Workspace`, card `COMMANDS`, rail
card `FILES`, rail header `SIDE PANEL`); three names for one event; two
different claims about the same browser behaviour (Chrome "blocks" vs "asks
permission"); `Tokens, all time` sitting beside `Agent: author` who has spent
none; and `.".` — a double full stop in every run-status string.

Also honest about the aesthetics that are still short: *"the empty states are
essays"* (60 words to say nothing is here, repeated verbatim in the disclosure
beneath), the 32px Unicode glyphs *"are the weakest visual element and they sit
exactly where the eye lands"*, and glow mode *"is worse than plain — I'd
question shipping it at all."*

## Round 9 — critic report (ninth stranger; NO, on a NEW axis: concurrency and evidence)

**6 seconds; task invented, run, and — for the first time in this loop — the
critic caught the PRODUCT lying about a real failure.** Their task: "create
primes.txt containing every prime below 50, one per line, then tell me how many
lines the file has." Chat said *"The file primes.txt has 15 lines."*, the
Dashboard said `main finished`, the board said `main ready · 1 turn`. The Tool
trace, in red, said:

    15:20:11 main ran $ "wc -l primes.txt"}) — failed
      /bin/sh: syntax error: unexpected ")" (exit status 2)
    15:20:15 main ran $ wc -l primes.txt — ok
      exec: 0 primes.txt

**The app's own evidence said 0. The app's answer said 15.** The file was one
line of the model's malformed JSON. The critic could only prove it by typing
`cat -A` into the command box themselves — because **the pane called FILES
cannot open a file**: the filename is an inert `<code>`, `cursor: auto`, with no
button or link around it. *"A first-timer would have walked away believing they
had a file of 15 primes."*

The previous blocker is confirmed fixed: *"I attacked error states, 390px,
800px, unbounded input, unbounded output, and return visits, and the
compositions held every time."* What broke instead is **concurrency**:

1. **Reload mid-run: the card says `main finished` and the board 40px away says
   `stopped mid-turn — the page was reloaded while that turn was in flight`.**
   Reproduced deterministically twice. The board's sentence is right; the card
   beside it is false, and its button says `Read the reply`.
2. **Switching agent mid-run leaves the other agent's run in the new agent's
   card** — header `RUN A TASK · RESEARCHER`, body `main is on it…`, no
   composer, while the board below says `researcher ready · no turns yet`. Its
   `Watch it` lands on researcher's empty chat.

The verdict: *"the product's summaries do not inherit the truth its own evidence
already holds. It knew the exec failed, it knew wc -l returned 0 against an
answer of 15, it knew the page had been reloaded mid-flight — and in all three
cases the headline still said finished / ready. Fix the propagation from
evidence to summary, and make FILES clickable so a user can check, and my
honest answer flips to yes."*

**Aesthetics, fifth judgement: "a beautiful, disciplined interface, and I'd
believe it was a paid product… the lowest contrast ratio in the product is
5.18:1, on a disabled button; everything else sits between 7 and 16.8:1."** The
glow, re-tuned last round, is now called *"depth without noise, and honestly
better than off"*. Three things still named: prose set at 14px/1.4 (*"punishing
for copy this good"*), compositions that deflate (the primary column shrinks to
a 250px card mid-run beside 270px of dead space), and one lowercase fragment,
`an agent is working…`, that *"reads like a leftover"*.

## Round 10 — critic report (tenth stranger; first walk of the NEW surface)

**8 seconds to understanding; an invented five-step task — start a `heartbeat`
process, list, read, stop, and identify the machine — completed unaided, first
try, in under two minutes.** The critic watched `last tool:` walk
`start_process → read_process → observe → stop_process` and wrote: *"the single
best in-progress state I have seen in this class of product. I never once
wondered whether it had hung."* And the tool error copy earned its keep live —
the model emitted malformed JSON, `start_process` answered *"'\"heartbeat\"})'
is not a usable process name: use letters, digits, '-' and '_', up to 32
characters — like web, or build."*, and the model self-corrected off it.

**The new surface is the weakest thing in the product.** 13 findings, and the
verdict names the pattern: **"the app tells the truth beautifully right up until
something is lost, and then it goes quiet. Every loss path in the new surface
ends in an empty state that claims nothing happened rather than a state that
says what went."**

The Processes panel:
- **It is a `<pre>` in a 254px rail** — measured `scrollWidth 1770` against
  `clientWidth 254`, so 86% is off-screen and the `command` column, the only
  thing identifying WHICH process a row is, is never visible. The caption
  truncates mid-word. *"It reads as a debug view someone forgot to promote"* —
  the one place in the app that abandons the design system.
- **It is read-only.** You can watch a process run and cannot stop it, and the
  panel names a log path (`.harness/proc/<name>/log`) it gives you no way to
  open. The only way to stop something is to ask an LLM in English.
- **`for` is not the run time.** A process that ran 46s and stopped seventeen
  minutes ago showed `for 16m56s`, climbing, on successive visits — and it
  refreshes every ~40s while the agent card beside it ticks every second.
- **After a reload on the forgetting engine it says `Nothing has been started`**
  — while Chat one click away still shows `ticker is running (pid 24)`, and the
  panel's OWN caption documents the state that should appear: *"gone was started
  before this page's Linux was rebuilt, so its record survived and it did not."*

The engine setting: the copy was called *"the best thing here"* and the safety
*"the worst"*. The dropdown offers two bare product names a first-timer has never
heard. `Reload the page` is a plain `btn-secondary` with no confirm and no
`beforeunload` — the critic lost a run in flight AND every file on one unmarked
click, while the app's header still read `main is working…`. Meanwhile
`btn-danger` red is spent on `Reset every endpoint`, which is recoverable. And
the Commands history survives an engine switch unlabelled: one screen showed
`Linux localhost 6.1.0 … x86_64` above the CheerpX credit paragraph, on a
machine that is `4.15.0-54-cheerpx i386`.

Also: `observe()` reports `uptime 0s` on a minutes-old machine and `memory 0 kB
free of 700 MB`; `Nothing has been run yet` appears after the agent ran six
tools in that workspace; and the agent's answer contradicted its own trace (it
claimed a timestamp `read_process` had returned `(nothing yet)` for) with the
fabrication rendered at the same weight as a backed answer.

**Aesthetics: "a designed product, not a themed one… Would someone pay for how
this looks? Yes — everywhere except the right rail of the Workspace view."**

## Round 11 — critic report (eleventh stranger; a P0, and it is the Stop we kept deferring)

**8 seconds to comprehension — "the fastest I have measured on this product
class" — and boot rated "a straight A. It is the best part of the product."**

Then the critic's own first task wedged the product permanently. They wrote
*"Start a background process that appends the date to pulse.log every second and
keeps running"* — ordinary phrasing — and the agent rendered "keeps running" as a
FOREGROUND `while true` loop. The shell never returned, and for the next seven
minutes six surfaces each said something false and cheerful:

    header      ● main's Linux workspace · ready      (green)
    Files       Nothing listed yet — the workspace is being asked…
    Processes   Nothing has been asked yet — …
    Commands    Running…                              (no elapsed, no cancel)
    Chat        waiting for the model — 285s
    Tool trace  No tool has run yet

**There is no control anywhere on the page that ends a running command.** The
only exit is the browser's reload button, which the product never suggests.
*"A product whose stated ambition is that nothing is lost silently cannot ship a
state in which everything is stuck loudly and the header still says ready."*

Three more, all from that one wedge:
- **The stall banner's clock is dead.** `Nothing has changed for 36 seconds`
  held at 36 for four minutes while two clocks beside it read 240s. *"Once one
  number on screen is provably false, none of them are trusted."*
- **`waiting for the model` was shown when we were not waiting for the model.**
  The wire showed ONE `POST /v1/chat/completions → 200 (20ms)`; the model had
  answered four minutes earlier. The stall copy then sent them to Settings to
  debug a healthy endpoint.
- **In-flight tool calls are invisible.** Chat said "calling exec, observe,
  find_files" while Tool trace said "No tool has run yet" — and after the reload
  Files listed `pulse.log`, written by that exec, while the trace still said
  nothing had run.

And attribution regressed: commands the critic typed themselves were filed as
`main ran $ id; echo marker-from-user` in the permanent record, under agent
activity rather than the app's-own-activity toggle that exists for exactly this.
The same pane had said `you ran` earlier.

**Everything after the wedge worked and was praised.** The Processes panel with
its Stop and log-open, the third `GONE` state, the retro-annotation
`— ok, on an earlier page's Linux`, and above all the lost-process copy, called
*"the single best piece of copy in the product"*: *"pulse_logger and ticker were
started here, and nothing is left of them. This page's Linux keeps its
filesystem in memory, so the reload that rebuilt it took .harness/proc with it."*
The engine card: *"a first-timer can make this choice correctly with no
background."*

**Aesthetics: "a designed product, not a styled one, and the difference shows
immediately."** Three voices used with discipline — serif for prose, sans for
chrome, mono for anything the machine said — *"you can tell what kind of thing
you are reading before you read it."* Still short: uppercase letterspaced
headings stacked three deep in the rail *"shout in unison and flatten
hierarchy"*, ~700px of the cold rail spent saying "nothing yet" three ways, and
`GONE` looks quieter than `STOPPED` when it is the more alarming state.

### Round 12 — fixed (16M, `c01011d`)

All seven dispatched as one wave. Root causes, not symptoms:

- **R12-2** `adapters_web/src/model.rs` mapped *every* `fetch` rejection to
  `Transport`. `AbortSignal::timeout` rejects exactly as a refused connection
  does — so our own 300s budget wore the unreachability remedy about a server
  that had answered 204 and taken the POST. `ModelError::Timeout` +
  `core/src/remedy.rs`; the wait row states the budget it is waiting out.
- **R12-1** `cx_stop()` cleared `giveup` and nothing else, so abandoning erased
  the only evidence a command was still in there. `Warmth::Occupied`.
- **R12-3** `filelist::newest` folded the newest read out of the whole log with
  no boot boundary — `filegone` and `scrollrows` already apply
  `!durable && i < booted` to the same log; this one did not.
- **R12-7** root cause found in the browser, not in the code: `prewarm` records
  `booting` a microtask after it spawns, and the pill polls at 500ms, so a warm
  boot falls *between two reads*. Amber was never observable.

R12-4/5/6 as specified. Gates green including `--release`; the layout gate
caught the new budget text overflowing 320px before it shipped.

Open, deliberately: the trouble banner still offers **Open Settings** on a
timeout — the one place a timeout borrows the endpoint failure's furniture.

### Round 13 — critique (fresh context, no source)

Time to correctly state what this is and what to do first: **~12 seconds**, 11
of them reading. *"That is a genuinely excellent cold open… this beats most
hosted agent products at the 10-second mark."* Zero configuration: the header's
claim about the default endpoint was checked against `/v1/models` and was true.

Then it invented its own task — a CSV, a shell sum, a number — and the product
failed it in the one way that matters.

**P0-1 — "Stop waiting — main keeps working" makes two other panes say the run
finished.** Clicked at 02:40:40 on a `sleep 90`. At 02:40:40 the Dashboard card
said `main finished "…MARKER_B…"` and offered **Read the reply**; the board said
`main ready · 5 turns`. The command actually landed at 02:41:51 — the card said
*finished* 71 seconds early, for a reply that did not exist, and never corrected
itself over the following two minutes. Reproduced twice. The button's own copy
is the best-written control in the app; the dashboard contradicts it.

**P0-2 — a corrupt write and a fabricated number, both stamped `ok`.**
`od -c` on the file the agent "wrote": 50 bytes on ONE line — a leading `"`,
literal backslash-n instead of newlines, and a trailing `"})`. `wc -l` = 0, so
the `NR>1` awk never fired and `exec:` was `(no output)`. The trace renders the
argument as `contents="…internet,60"}) path=budget.csv` — **the `"})` is
visible in the UI** — and still says `— ok` and `write_file: wrote budget.csv`.
The next line of chat is `The total cost is 1864.50.` with no hedge. *"A
plausible wrong answer with a green checkmark."*

**P0-3 — raw JavaScript rendered as agent status.** With a stale service worker
(a returning user after any redeploy): `⚠ author's last turn failed: Failed to
fetch dynamically imported module: http://127.0.0.1:8901/ui-<hash>.js`, and
three of four agent cards wore that string as their status. The app HAS
hand-written prose for exactly this ("almost always an old service worker…"),
but it only fires when the shell fails; here the shell loaded and only the
agents broke.

P1-4 trace timestamps are COMPLETION times reading as start times (`sleep 90`
started 02:40:21, logged 02:41:51) — a silent off-by-duration on every row.
P1-5 the legend promises a running token total in the header; at 390px both
token elements are in the DOM with `offsetParent: null`, and the legend that
would explain the absence is itself inside the collapsed drawer. P1-6 the Base
URL field empties after a successful save.

**What held under attack, measured:** the glow toggle's claim `nothing else
changes: every control, word and number is the same either way` verified by
diffing `body.innerText` — identical. Contrast sweep over every rendered leaf
text node: zero failures. Zero interactive elements under 24px. Roving tabindex
correct on the agent tablist. Inactive panels genuinely `hidden` from a screen
reader. At 390px `scrollWidth === clientWidth === 390`, zero overflow. The two
error messages *corroborate each other* — the unreachable one fails instantly,
which is what the timeout copy claims it would do. And the app volunteered a
failure nobody asked about: *"The older messages could not be shortened to make
room, so this turn was sent with the whole conversation instead."*

Verdict: *"Not yet — the surfaces are more honest than any agent product I have
used, but the dashboard's summary of a run is not derived from the run."*

### Round 13 — fixed (16N, `dd7852c`)

Three agents, split so they could not collide on files. Root causes, not
symptoms — and the fourth round running where the root cause was **a projection
reading the log without a boundary its neighbour already applies.**

- **P0-1** `runtime.rs` decided a turn was over with `task.is_none() && board[me]
  == Working`. `task` was standing in for "nothing is outstanding", and Stop
  waiting deliberately clears it — so the press wrote a status fact saying the
  turn had ended while the `exec` was still in `App::calling`, the list the
  trace reads to draw a running row. The test now also requires
  `calling.is_empty()`. The card corrects itself now, four seconds after the
  trace logs the marker.
- **P0-2 the parser was INNOCENT**, and proving it was the work. The model
  escaped one argument one level too deep and swallowed its own terminator into
  the value; `scan_object` correctly ignored the `})` inside the string and
  `from_str` correctly succeeded. Same signature already on record for `exec` in
  `failed.rs` — a tic of this model, not a one-off. So the fix is honesty:
  `vouch.rs`, one predicate feeding the trace word AND the chat clause so they
  cannot disagree. `ok, but the arguments end with this call's own "})`, and
  `ok, and it printed nothing` — never a failure, because `mkdir` legitimately
  prints nothing.
- **P0-3** the Worker's exception string travelled from `agent-worker.js` to the
  board card, `x-failed` and the trouble pill untouched. There was no typed
  variant, so `remedy.rs` could not have had a remedy. `CoreError::StaleAssets`
  now, recognised in one place from Chrome's and Safari's wordings, wearing the
  boot fallback's own prose — and claiming only what `sw.js` actually does.
  Manufactured for real: two builds, a live SW, an activated update.

P1-4 timestamps read from the request's log index, `ended ` where the log holds
only the return; `adapters_test` gains a `TickingClock` because `FixedClock`
cannot tell a call's start from its end. P1-5 the token pill costs a row of
height, not a fact — visible at 390, 320, and 320×256.

**P1-6 could not be reproduced across ten flows and the agent said so** instead
of inventing a fix. It found the divergence the report's shape describes:
`endpoint_summary()` swallows a resolve-miss as an empty Entry via
`unwrap_or_default()`, while the picker reads `entry_fields(name)`. Two reads of
one fact, one of which can come back silently empty.

Every fix verified to fail before and pass after — `findings13c` by reverting one
`install.rs` line, `findings13b` by neutering `vouch::doubt` and `tracerow::when`.
243 passed, 0 failed, all gates green on the combined tree.

Operational: the browse daemon is SHARED between fix agents. One switched tabs
under another mid-run and a sibling held port 8903, producing a bogus "before"
reading until it was caught. Future waves get per-agent ports.

### Round 14 — critique (fresh context, no source)

Understood on the first painted frame — *"Zero seconds of confusion."* Interactive
under 1s. No guessing, no backtracking, Settings never opened.

Then it invented a task (every prime below 200, one per line, then count the
lines), got `The file primes.txt contains 46 lines.`, and checked:

```
you ran $ pwd; ls -la; wc -l primes.txt — failed
/root/spaces/research
total 0
wc: primes.txt: No such file or directory
```

**46 is the correct prime count and the file is fiction.** It then closed the
cwd hole itself — the agent's `exec` runs in the same `/root/spaces/research`
the pane reads, proven by writing from both sides and matching md5s against the
host.

**P0-1** the trace corroborated the fiction: entry 10 `— ok` / `exec: 46` on a
displayed command that is *not valid Python on one line*, so the trace is not
showing the bytes that ran.

**P0-2 is round 13's defect, one layer deeper.** The product's OWN suggested
prompt wrote 179 bytes of un-parsed tool-argument fragment to disk —
`"- I can perform research…"})`, one line, literal `\n`, leading `"`, trailing
`"})` — and counted it a clean call. **We now detect this and write it anyway:**
chat printed `calling write_file — Tool trace cannot vouch for 1 of them` and
the file was written regardless, with the model's success claim passed through.
A well-formed call was byte-perfect, so it is specifically the un-parseable-args
path.

**P0-3** two panes, same command, same timestamp: Commands says `— failed, on an
earlier page's Linux` with the true stdout and `(exit status 1)`; the trace says
`— not there yet / There is no . folder yet — nothing has written to it.` The
file-listing empty state leaking onto a shell command — it parsed `ls -la`'s `.`
as a folder.

**P0-4, observed once, NOT reproduced in ~15 attempts:** a completed turn
vanished from every pane with no reload (`performance.now()` 362s, no
navigation) — `ready · no turns yet`, `No messages yet`, `No tool has run yet`,
token pill gone. A reload restored all of it, so the durable store was intact
and only the live signals had emptied.

P1-1 **there is no way to stop a run** — 132s burned on nine identical failing
quoting attempts, and nothing says reload is the kill switch. P1-2 the board
read `ready · 5 turns` beside the stop-waiting note — must be checked against
16N, which fixed exactly that. P1-3 the Files pane asserted *"nothing has
written to it"* 400px below a `probe.txt` visible in Commands. P1-4 the credit
link has no `target`, so it navigates away in place and kills a running agent.
P1-5 the two traces sort in opposite directions.

**What held, tried and failed to break:** reload mid-run agrees in three
registers and the orphans return as `— ok, on an earlier page's Linux`, called
*"the most honest string I have seen in an agent UI."* Stop-waiting kept its
promise — the critic assumed the late reply would be dropped, checked, and
**retracted its own finding**. File persistence verified by md5 against the host.
Dead endpoint: every pane agreed. Zero contrast failures at both widths in both
skins (its first pass flagged three; it caught its own compositing error and
withdrew them). Zero targets under 24px bar an inline link exempt under 2.5.8.
20 tab stops, DOM order matching visual order, real roving tabindex with
manual activation. 390px *"a real layout, not a squeeze"* — the endpoint pill
rewrites rather than truncates.

Verdict: *"the writing, the honesty vocabulary, the reload semantics and the
measured craft are already better than most of them, but the tool layer will
report `ok` for a call that produced nothing and write unparsed argument text to
disk as a success, so the one surface a user must be able to trust — did it
actually do the thing — is the one surface that lies."*

### Round 14 — fixed (`8f811bd`, amended)

Three agents. **Three of the round's findings turned out to be wrong, and
saying so was worth more than three fixes.**

- **P0-2 REVERSES ROUND 13.** Thirteen concluded "refusing the call on a
  heuristic would be worse than writing what the model asked for", so we built
  detection and let the write through; fourteen wrote 179 bytes of raw
  tool-argument fragment to disk using the product's OWN suggested prompt. The
  bytes are garbage either way, so a refusal the model can see beats a corrupt
  file plus a false success. `Toolbox::check` — the single gate every
  model-issued call passes — now refuses on `swallowed_close`, nothing reaches
  `WorkspacePort`, and the refusal names what was wrong with the arguments.
  **The model read it and rewrote the call correctly on the next round, first
  try:** 179 bytes/one line/`"})` → 205 bytes/three real lines. `exec` refuses
  on the same predicate; the neutered run proved the corruption really did reach
  the shell (`FakeShell::ran()` recorded `"wc -l primes.txt"})`).
  Two existing tests were premise-reversed and updated with the reason.
  `vouch::Doubt::Malformed` STAYS — the durable log replays events written
  before this fix, so the qualified `ok` still has to render for them.
- **P0-1 was a display bug.** `.tool-args` had `white-space: normal`, so a
  three-line `python3 -c` collapsed into one line of invalid Python while the
  shell got the real program. One property on the two elements that render a
  command. The missing `primes.txt` was the model's own doing.
- **P0-3** `filelist::missing` was a substring test over ANY tool's output with
  no idea which call produced it, and `path_of` defaults to `"."` — hence "There
  is no . folder yet" on a shell command. The neighbour with the boundary was in
  the same file: `newest` only ever collects `list_files` and `read_file`. Two
  sibling callers were latently wrong the same way, including `is_failure`,
  which was EXCUSING a failed command from the turn's failure clause.
- **P1-3** the Files pane gated asking for a listing on the agent's board status
  stamp, which a person typing a command never moves; it now follows the log via
  `x-workspace-at` on the listing it already reads — one fewer `/board` request
  per tick. And the copy stopped asserting the present tense of a disk:
  `Nothing was in the workspace folder when this listing ran.`
- **P1-5 was measured and refuted** — both traces are oldest-first and identical
  in the DOM. What differed was which end was scrolled into view.

**P0-4 was OUR TOOLING, not the product**, and the agent reproduced it by
accident: a read came back `No messages yet` with `"url":"…:8907/"` in the same
payload — a sibling agent's page. That one event produces every symptom at once,
including the token pill being absent rather than zero and a reload "restoring"
it. Backed by the code argument: all four surfaces fold one `App.log`,
`app.rs:148-169` is the sole mutation and only ever appends, and an in-place
emptying would need a second App booted against an empty store — which the
restoring reload disproves. Both leads were already closed; `space.rs` got its
`watching` guard in 15M.

**P1-2 does not reproduce at HEAD** — `dd7852c` holds; the critic measured a
`dist` a sibling had rebuilt. **Both P2 items were wrong**: the endpoint pill
does carry a `title` and shows an ellipsis, and the `uname -a` button's
accessible name is intact — it vanishes only from the snapshot tool's YAML
parser, which drops values quoted because the name contains a backtick.

P1-4 fixed and generalised: the app has exactly two outbound anchors, both now
`target="_blank" rel="noopener noreferrer"`, with a test that walks
`crates/ui/src` and fails on any bare `http` href.

**Open, and the owner's call: there is still no way to stop a run.** The critic
burned 132s on nine identical failing quoting attempts with no exit but
reloading, and nothing says reload is the kill switch.

**Harness lesson, twice now:** the shared browse daemon switches tabs under an
agent. Per-agent ports were not enough — a wave needs `location.href` asserted
in the same read as the finding, and a throwaway worktree per agent, since the
shared tree went transiently uncompilable mid-run.

### I12 was law and nothing enforced it (`scripts/check-size.py`)

`CLAUDE.md`: "files ≤ 200 lines, functions ≤ 40 … Violations are bugs."
`check-selectors.py` has `MAX_LINES = 200  # I12` and applies it to **CSS
only**. Nothing had ever checked Rust, so five source files had drifted over
during this session's work — `procwatch.rs` 294, `process.rs` 231,
`dispatch.rs` 227 (192 at origin), `adapters_test/src/lib.rs` 212 (162),
`authoring.rs` 208 (187). Every "all gates green" in this ledger was true of
the gates that existed.

`scripts/check-size.py` now walks `crates/*/src` — tests are out of scope by
established practice (`core/tests/skeleton.rs` has been 296 since G4). It
counts as `wc -l` does, not `splitlines()`: `transcript.rs` has no trailing
newline and commit `2d7f9b6` landed it at exactly 200, so `wc -l` is what I12
has always meant here.

All five split by responsibility, not by line count: `model.rs` (the only fake
that speaks a provider's wire format), `ctx.rs` (the SHAPE of a capability
context vs the routing that constructs one — ADR-006's line), `origin.rs`
(belongs to neither of its two callers, and its point is that they cannot
disagree), `proctable.rs` (all processes vs one named one), `procstart.rs`
(the only tool that WRITES the `.harness/proc` convention; the other three
read it). 253 tests before, 253 after.

**And the function half is the bigger finding.** The brace-depth scan works
with zero false positives — and the tree holds **69 genuine violations** of the
40-line rule across 8 crates: `runtime.rs:drive` at 151, `transcript.rs:
transcript` at 157, `ui/src/chat.rs:ChatPane` at 171, mostly single `rsx!` or
`FragmentBuilder` chains. It ships behind `--functions`, OFF, because a gate
that fails on the tree it ships with is not a gate. The number is now on
record instead of unknown.

### Round 15 — critique (fresh context, no source) — USABILITY, not correctness

Brief corrected: previous rounds had drifted into bug-hunting. This one maps
the app, audits its vocabulary, and judges its information architecture.
Functional bugs were capped at one line under "incidental".

**~6 seconds to a correct mental model** — *"the best part of the product"*, and
rated above Hermes' landing, which *"drops you into a terminal and lets you
infer."*

**THE VERDICT IS STRUCTURAL:** *"six nav entries hide only about four real
panels, re-shuffled and re-named per view (Workspace shows 'Commands', Chat
carries the agent board and the tool trace, Agents hides an editor), so a
newcomer never stops asking 'wait, where does this actually live?'"* Chat
appears on 3 views, the agent board on 2, the tool trace on 2. *"Hermes' side
nav has a strict one-view-one-panel rule and that is why you never wonder where
something lives."*

**The view map, believed-vs-actual:** Dashboard contains a full Chat card, so
Chat-in-nav is a subset of Dashboard. Agents is a catalogue **plus** a raw YAML
editor, a task launcher and a Chat card, the editor 2168px down under six long
cards. Workspace is titled **"Commands · main"** — the view name and the panel
name disagree. Only Tool trace had no gap.

**The vocabulary audit is the finding no round had looked for:**
- **task / job / message** — three words, one thing. "Give main a job",
  `aria-label="Task for main"`, `aria-label="Message to main"`, all landing in
  the same thread as `YOU:`.
- **workspace** — three meanings: the nav view, the Linux VM, and the folder.
  Plus "workspace root", "workspace folder", "Workspace artifacts".
- **space** overlaps it: an agent is in the "research" shared space *and* has a
  workspace folder which *is* that space.
- **turn** is used in the header before anything defines it.
- **artifact** is given an invented meaning (a directory name) against the
  universal one (the output document).
- **view / pane / panel / board / card** — five words for containers.
- And the Workspace pane's stated rule — shell here, file and process work in
  the Tool trace — **is false**: both exec calls appear verbatim in both.

**P0-1** the Workspace view runs `list_files` on mount and then reports its own
housekeeping as contention: *"Waiting on the command the workspace is already
running — list_files path=artifacts, for 0s."* A first-time user's first act
produces a busy machine and instructions to go stop something in a pane they
have not found. **P0-2** `author`'s empty state points at "your agent file on the
Agents view" — which is 2168px down, called "Write an agent", and requires
hand-typing a YAML key.

P1: "No tool has run yet" sits directly above "Show the app's own activity (3
calls by the file panes)", and the count never updated past 3 while the trace
held 14. The malformed-argument refusal renders as a **4973px single line** of
model-repair instructions plus the tool's whole docstring — and wraps in Tool
trace but not in Commands. A system telemetry line wears the agent's name
(`MAIN: calling exec — 1 call failed`) identically to the agent speaking. Three
labels for one drawer control. Three redundant primary CTAs sitting above the
control they duplicate. The Agents view offers no way to ACT on an agent.
No light theme, and no `prefers-color-scheme` response.

**Good, held to the same standard:** the outcome card with two exit routes
(*"better than any hosted product I know"*), three-actor attribution in the
trace (*"the app's best original idea"*), agent-aware suggestions that reason
about whether the agent has a shell, teaching empty states, measured
progressive disclosure (328 visible words, 2,338 characters folded), a real
six-step type scale, worst contrast 5.18:1 on a disabled control with body text
at 9.7–10.6:1, zero overflow at 390px, and a visible working-memory budget —
*"something Hermes and the hosted assistants all hide."*

### Round 15 — fixed (`a038138`, amended)

Two UI-only agents. **No functionality changed** — panels moved, rows filtered,
copy rewritten.

**The rule, now stated in `views.rs` as R15-IA:** *one panel, one home — every
panel appears on exactly one view; the centre column is what the nav entry
names, the rail beside it is the live state of that same thing, and every other
mention of a panel is a link to its home, never a second copy.*

Six nav entries kept, each now owning something. Agent board and tool trace out
of the Chat rail (Chat has no rail now); task launcher out of Agents. Nav
`Workspace` → **Commands**, slug too — so the nav entry and the panel under it
finally agree, and "workspace" now means only the Linux folder. `#/workspace`
stays a legacy alias. Bare load writes `#/dashboard/main` via `replaceState`, so
the URL you land on is copyable.

**Commands vs Tool trace: `exec` filtered OUT of the trace, not Commands
deleted** — *"Commands is not only a log, it is the box you TYPE into and the
stop control for a command in flight, so deleting it deletes a control where
deleting the rows deletes only the duplication."* The trace says how many it
left out and where they went (`x-shell-calls`, mirroring `x-app-calls`), with a
door. `start_process` is NOT filtered — it is not in Commands, so filtering it
would hide it, and that finally makes `terminal.rs`'s long-standing claim true.

The reviewer was corrected on one point: the Chat card on Dashboard and Agents
is always-mounted but `hidden` — a DOM artifact, not a rendered panel.

Three redundant CTAs deleted. Per-agent doors added to every roster card
(`Talk to X` / `Give X a task`), and a `Write a new agent` link that focuses the
editor rather than leaving you to scroll 2168px.

**P0-1 fixed with the boundary that already existed:** `inflight::waiting_on`
asks `asked::Asked` who the blocking call belongs to and returns `None` for
`PANE`. One guard, both panes, so the trace and the pane cannot disagree. A cold
first click now reads `Nothing listed yet — the workspace is being asked for
this folder`; a command genuinely in the way still says so. **The amber pill was
left alone with a reason** — `Warmth::Busy` is the engine's own state string, a
true fact about a Linux that really is executing, carrying no actor to filter
on.

**P0-2** the empty state now names the panel by its printed title (`Write an
agent`) and the YAML key is gone from user-facing prose; the button beside it
was relabelled to name the same destination.

P1-5: the refusal went from `scrollWidth` **4973 → 644**, folded behind a 45px
summary, wrapped identically in both panes — and **the recovery is marked**:
`ok, and this is the retry after the refused call`, once, on the call that
recovered. P1-6: `MAIN: calling exec…` → `main is calling exec…`, un-bubbled and
dimmed, while the agent's own speech keeps the bubble.

**P1-3 was half wrong.** The contradiction was real and is fixed (`main has not
used a tool yet`), but the count was never stale — measured 3 → 12 across three
round trips. A projection that had not re-run, not a frozen number.

263 passed, 0 failed; all eight gates green.

**Harness: `isolation: worktree` from now on.** One agent ran `git stash`
mid-session and BOTH agents' uncommitted diffs went into `stash@{0}` for about
two minutes. It came back intact on their `pop`, but that is the third distinct
way the shared tree has bitten a wave — after the tab-switching daemon and the
transiently uncompilable tree.

### Round 15's deferred finding — the vocabulary, fixed

Glossary decided BEFORE any edit, then applied. One word per concept.

**`task` vs `message` are genuinely two concepts and stay two.** Both start a
turn, but *a task is dispatched and a message is said*. `job` was a third word
for the first one and is gone: the launcher now reads `Run a task · main` /
"Give main a task and walk away" / `aria-label="Task for main"` / "Describe the
whole task…" — one word from title to placeholder to aria. Chat is
message-only. **One view says task, the other says message, and nothing says
both.**

**`shared space` and `workspace folder` were one directory wearing two nouns.**
`browsable.rs` even held a written rule (R5-13) that "a SHARED SPACE is what an
agent is a member of, a WORKSPACE FOLDER is what that membership grants it" — a
distinction *a reader cannot make, because the two name the same path*.
Membership is now a clause, not a second noun: "main works in the research
workspace, with every other agent whose file names it."

**The workspace stopped being an actor.** "The workspace is busy running $ while
true" gave a folder agency; it is "Linux is busy running…" now, and the header
pill is `main's workspace · ready`.

**`turn` is defined where it is first read** — a visible note under the agent
rows, not inside the closed fold it used to hide in, and the fold's copy was
removed rather than duplicated. **`working memory`** likewise carries its
definition at the point of use.

**`artifact` → `finished file`.** The app's meaning fought the industry one.
`Finished files · main`, explained in the one sentence that still names the
`artifacts/` folder — which stays, because agents write there.

**`the file pane` → `this page`.** The three-actor attribution is untouched —
two reviewers called it the app's best original idea — but the old name was
printed on no panel in the product and was wrong for the Processes panel's own
polling. Rows read `this page ran list_files path=.`; the toggle reads "Show
what this page did on its own (12 calls)".

`pane`/`card`/`board` collapse into **panel**; `view` unchanged.

**Sweep, all `<details>` forced open, every view, text + aria + placeholder +
title:** clean on five views. The four hits on Agents are `public/agents/*/
agent.md` rendered verbatim in the editor — **model-facing prompt text,
deliberately not touched**: rewording an agent's instructions changes what the
model reads, which is a behavioural change, not a copy change. That is the one
remaining place a reader can meet "shared space", and it wants its own pass with
the model in the loop.

18 assertions across 12 files updated — each now a place the wording is pinned.
263 passed, 0 failed, all eight gates green.

### Round 16 — critique (fresh context, no source)

Measured the PRE-vocabulary build, so its naming section is an independent read
of the old wording — it confirms most of what the audit caught and finds four it
missed.

**~6 seconds** — *"the best number I have measured on an agent product."* Map
predicted correctly for five of six views before clicking; **Commands ✗** —
*"reads as a command palette or slash-commands; it is a shell terminal plus a
workspace file browser."*

**P0-2, and it is now named as THE blocker for the second round running:**
*"you cannot stop a running agent — the only two buttons that say 'Stop' both
mean 'stop looking'."* Enumerated every button on Chat and Commands during a
run; `/stop|cancel|abort|halt|kill/i` matched only the two stop-waiting
controls. With `max_rounds: 64` the options are waiting out a 5-minute timeout
64 times, or reloading the tab.

**P1-1 — a RECOVERED failure is reported as a failure, and the recovery is never
mentioned.** Three surfaces raise an alarm the detail view retracts: Dashboard
*"…and a tool call in that turn failed"*, the board the same, Chat *"main is
calling write_file — 1 call failed"* — while the reply says it wrote the file
and the file is there. The trace knows: it labels the second call *"ok, and this
is the retry after the refused call"*. **The summary already has the fact and
does not use it.** Also the tense: "main **is** calling" on a finished turn.

**P1-2** *"Tool trace cannot vouch for 2 of them"* is undecodable — two of what,
why, do what? — and it was **the one warning that was right**: the agent claimed
a word count across three files having created one. Its value is destroyed by
its phrasing.

**P1-3** switching the agent tab on Commands leaves the rail headed
`WORKSPACE FILES · ASK` over three panes each printing the **byte-identical**
60-word paragraph about **main**, ending *"Select main to browse it"* —
contradicting the action just taken. The shell input also vanishes for a
shell-less agent with no sentence saying why.

P1-4 descending into a folder shows no breadcrumb — nothing on screen says which
folder you are in. P1-5 the file editor has `white-space: pre` at 280px wide
against 712px of text. P1-6 the agent editor drops into raw YAML with `engine`,
`compact_at`, `keep_recent`, `max_rounds` defined nowhere in the app — and the
one disclosure that looks like help pivots to *"put it at
`public/agents/<name>/agent.md`"*, instructions for the repo owner shown to the
browser user.

**Four naming findings the round-15 audit missed:**
- **Worker** — used three times, capitalised like a proper noun, defined
  nowhere. *"A newcomer cannot distinguish a Worker from a workspace from a
  space."*
- **round** — `max_rounds: 64` is in the agent file and the word appears nowhere
  in the UI, while the counter the user DOES see ("2 turns") is a lifetime
  total, not a per-task one. The critic misread it as "this task has taken 2".
- **engine** is overloaded: the Linux VM in Settings, and the agent loop in
  `engine: react`.
- **space** — and this **contradicts the vocabulary pass, which collapsed
  `shared space` into `workspace`**: the critic argues they are two mechanisms,
  a memory store (`remember`/`forget`/`post_note`) and a filesystem scope, and
  that describing them as one thing is *"the worst blur"*. Must be resolved.

P2: three paragraphs in three registers for one root cause; chat auto-scroll
lands 84px short; the endpoint pill hides 39% of its text at 1440px; `⏎`/`⇧⏎`
render as boxes at ~11px; **definitions live only in EMPTY states and vanish
once the pane has content**; Settings' lower cards use 40% width.

**What held:** a WCAG AA sweep over every leaf text node with a computed
background walk, all six views, both glow states — **zero failures out of
hundreds, run twice because the reviewer expected a bug in its own script.**
Zero sub-44px targets at 390px. Correct roving-tabindex tablist. The glow
claim diffed and true. And filenames in agent replies are deep links that open
the file in the editor — *"Hermes does not do this. Neither does most of the
hosted field."*

### Round 16 — fixed

**P1-1, and the split WAS the bug.** Dashboard and the board shared one source
(`boardrow.rs` → `data-line`, rendered verbatim by `runstatus.rs`); Chat kept a
**second tally and a second wording**. Neither read `vouch::Retries` — which the
Tool trace was already using to label the recovery. Now `failed::note(failed,
recovered)` is the single clause for all three, folding `Retries` in the same
order `trace.rs` does.

`…and a tool call in that turn failed — the Tool trace has it`
→ `…and a tool call was refused and the retry after it worked — the Tool trace
has both`.

**Suppress vs say: SAY.** Suppressing would leave a red `failed` row in the trace
that no summary accounts for — the same one-click-apart disagreement, inverted,
and it drops a true fact. Where some failures recovered and some did not, the
clause reports the **unrecovered** ones, because that is what is still owed.
Tense fixed at the source: `Calls::take` emits `called`, which is right on an
open run and a finished one; `is calling` was only ever right on the former.

**P1-2 — the agent DID NOT use the reviewer's draft, and was right not to.**
"2 of them are not in the Tool trace, so they may not have happened" is stronger
than `vouch::doubt` supports: the calls *are* in the trace. What the predicate
checks is that a call reported success while its own record shows nothing behind
it. New wording gives subject, reason and action — *"1 call came back ok, but
its own record does not back it: an argument arrived mangled, or a command
printed nothing. Check the Tool trace before you trust the answer below"* — and
the test asserts the page never says "not in the Tool trace" or "may not have
happened".

**P1-3** one refusal string was rendered independently by all three rail panes;
`rail.rs` now reads it once and renders one fragment. The sentence stopped
telling the user to undo the selection they just made, and a shell-less agent
gets a reason where the box would be (`x-typeable-why`, asking the same
`toolbox_for` that `origin_line` asks — not a second definition).

P1-4 a breadcrumb (`the workspace / report`), segments clickable through the
same handler the rows use, root named with `filegone::named`'s own word. P1-5
**always wrap**: `is_prose` was rejected as a classifier because it tests three
prefixes *we* write onto a tool RESULT — a rule about output origin, not about
files — and unwrapped code in a 242px box is not readable either, just
differently unreadable. `scrollWidth 1816 → 242`.

**`space`: BOTH sides were right, about different questions.** The vocabulary
pass compared `shared space` against `workspace folder` — two names for one
directory, correctly collapsed. The reviewer compared the folder against the
shared-memory store — genuinely two mechanisms behind one `space:` line. The
code settles it: facts and notes live in one IndexedDB keyspace every sub-agent
Worker opens, **but only the page's own agent has a Linux at all**
(`worker.rs:86` hands sub-agents a workspace whose exec answers "no workspace is
available here"). So `workspace.rs`'s claim — "the same folder for every agent
whose file names that space" — is an aspiration the runtime does not keep, and
the terminal note **printed it to the user as fact**. One noun kept; two
sentences now say the folder is this page's own and the sharing is the facts and
notes.

**`Worker` deleted, not defined** — all seven user-facing uses replaced with the
consequence ("runs on its own"). Nothing the user does depended on it; it was
implementation jargon leaking into copy. `round` deliberately NOT surfaced: it
is a per-turn ceiling no shipped agent sets, and a third visible counter buys
nothing. The counter's ambiguity fixed instead — `1 turn` → **`1 turn in all`**,
beside the existing "in this turn for Ns".

`engine` now means the Linux and only the Linux. The agent editor gained a
`<dl>` glossing all ten frontmatter keys, and the repo-owner paragraph moved
behind a disclosure that opens *"This part is for whoever builds the site, not
for using it here."* Definitions for finished files and processes moved out of
the empty states, which is where they used to vanish once a panel had content.

273 passed, 0 failed; all eight gates green.

**Owner decision taken: BUILD THE STOP.** Named as the single blocker by two
consecutive critics.

### The stop — built, owner-approved (round 16)

Named as THE blocker by two consecutive critics. `core.stop_requested` (press)
→ `core.stopped` (boundary), both handled inside `agent::step`.

**The press arm is a copy of the `steered` arm one line below it** — record the
fact, emit nothing, let the round in flight finish:
`state.stopping = state.task.is_some()` (an idle agent is already stopped).

**The boundary is ONE FUNNEL, not four guards.** Every arm of the machine starts
work by *returning an effect*, so `step` became a two-line wrapper:
`advance(...)` then `stop::boundary(state, effects)`. That covers the model call
at the top of a turn, the retry after a failed compaction, the tool batch a reply
asked for, and the next round after the last result. *"Guarding them one at a
time is four chances to miss the fifth."* An empty effect list is deliberately
NOT a boundary — results still landing, and the last one produces the effect that
gets caught.

One correctness change fell out: `tool_rounds += 1` moved from `on_reply` to
`on_tool_result`, so it counts rounds **completed** rather than requested and the
stop's number means the same thing as the ceiling's. Behaviour-identical for the
ceiling, proved by the untouched `rounds.rs`.

`core/src/halted.rs` owns BOTH wordings off the same payload — chat sentence and
trace row — so round 16's split cannot regrow here.

**A delegation in flight is exactly a tool call in flight.** A sub-agent runs in
its own Worker with its own state; nothing in this log reaches it. So the child
finishes and hands back — that IS the boundary — and the copy says so rather
than promising a kill: *"Anything already running finishes — a command in the
Linux, or an agent it handed work to — and nothing new is started."* The control
is offered only where it works: `x-stoppable` only for this page's own agent,
with a 409 backstop that writes no fact.

**"Stop waiting" lost its qualifier** — the pair is now what makes each legible.
The pressed state changes the sentence, because the press can sit up to five
minutes behind a model call and silence there gets pressed twice.

**Proof, sampled in-page at 250ms on a 30-step counting task:** a tool call had
been landing every 4–9s through `tools=17`. Pressed at 09:19:56.662. At
**09:21:30 — 94 seconds later — exactly one projection change had occurred**
(the stop line), `data-tools` frozen at 17, wait row gone, composer re-enabled.
It never reached 18; the model's 18th call was refused at the boundary rather
than run. Control run immediately after completed untouched, and the flag does
not survive into the next turn.

Neutering `stop::boundary` to a pass-through: 3 of 4 agent tests and 2 of 4 core
tests fail. The core tests count `ModelReplied`/`ToolInvoked` off the log itself,
so "nothing ran after the boundary" is asserted on the record, not the UI.

282 passed, 0 failed; all eight gates green.

### Round 17 — critique (fresh context, no source)

~10s to correct orientation. Map predicted 5 of 6; **Commands ✗ again** — it
holds shell + Files + Processes + Finished files. *"Panels do not repeat. Each
entry owns something distinct — that is genuinely rare."* R15-IA held.

**P0-2 — THE BLOCKER MOVED. A run that abandoned its task reports "finished".**
Six-part task, walked away, came back to `main finished "…"` + **Read the
reply** + `main ready · 2 turns in all`. `index.md` was never written (confirmed
in Files), and **Read the reply lands on a final assistant message that is a raw
malformed tool call**: `exec({"command": "cat a.md"}, {"command": "cat b.md"},
…)`. *"The walk-away report was wrong in both directions: it claimed completion,
and it offered prose that was machine output."*

**P0-1 — two views state opposite facts about the same capability.** On a
workspace-less agent: *"author runs on its own and this page cannot stop it from
here; a command already running in Linux is stopped on the Commands view."*
Commands says: *"This Linux gives the page no way to signal a command once it
has started, so this stops the WAIT."* **The one a stuck user reads first is the
false one.** And the genuine gap behind it: the stop we just built covers this
page's own agent; there is no way to stop another agent running in its own
Worker. Hermes stops any agent, always.

P1-3 the Chat status line says *"the Tool trace has both"* for a refusal that is
in **Commands** — correct mechanism, wrong pointer, and it is wrong precisely
because R15 moved shell rows out of the trace. P1-4 the composer's button
silently changes from `Send to the run` to `Send` when a run ends under the
user's fingers — text preserved, semantics not. P1-5 three labels for the
stop-waiting control (`Stop waiting`, `Stop waiting — author keeps working`,
`Stop waiting for it`), and **`Stop waiting` vs `Stop main` are not
distinguishable by label alone** — what rescues them is a paragraph below both.
P1-6 a stop the user asked for reports **`— failed`** in red. P1-7 *"Write a new
agent"* opens prefilled with the shipped `main`, so a newcomer who edits and
saves **overwrites it** — while the plain-English path that works beautifully
(*"I want an agent that reads a recipe and tells me the shopping list. Call it
shopper."* → installed, chip reads `shopper · written here`) is not mentioned on
that panel at all. P1-8 every word of UI says **workspace**; the file you must
edit says `space:`. P1-9 argues the view should be named **Workspace**, which
reverses R15 — must be resolved, not just applied.

**What held:** contrast computed per leaf node against resolved backgrounds —
nothing fails, the dimmest thing on screen is ~10:1. Zero controls under 24px of
26. Skip link verified to actually move focus. `scrollWidth === clientWidth ===
390` on the three-column view. Inactive panels genuinely `display: none`.

**Named better than the hosted field:** the live run line — *"working · 2 turns
in all · in this turn for 8s · last tool: exec · a tool call in that turn failed"*
plus *"waiting for the model — 27s of a 5-minute limit"* — against *"Claude,
ChatGPT and Hermes all show you a spinner"*. The compaction disclosure, *"the
best I have seen anywhere"*, which names the summarizer and shows the literal
replacement text. The model-facing repair instruction shown verbatim under *"This
is what was sent back to the model, in full"* — *"Nobody does this."* And
shipped-vs-written provenance on every chip.

### Round 17 — fixed

**P0-2 — an ending is now a FACT WITH A KIND, not the absence of a task.**
`core.ended` carries `{"why":…,"rounds":N}`, emitted by the one function that
clears a turn's state. Five endings, and the rule for the list is the good part:
*an ending only earns a name if a surface can offer a different act for it.*

| ending | row word | the act |
|---|---|---|
| Answered | (status: ready) | read the reply |
| NoAnswer | `stopped without answering` | ask again |
| RoundCeiling | `stopped at its round ceiling` | raise `max_rounds:` |
| StoppedByYou | `stopped by you` | ask again to carry on |
| Failed | (status: failed) | the conversation says why |

Not Hermes' fourteen. `Failed` and `Answered` carry no word — the status fact
already says it — but they are IN the enum so a failure cannot be misread as the
ending before it. The ceiling previously emitted an anonymous `core.note`, so
that ending was only ever legible as prose.

`main finished "…"` + **Read the reply** →
`main stopped without answering · 1 turn in all · its last reply was a tool call
this page could not read, so nothing ran — the conversation has it, word for
word; ask again` + **Ask again**. And the raw `exec({…},{…})` blob is no longer
dressed as the agent speaking: it renders as a NOTE that says nothing ran and
there is no tool row for it anywhere, with the text in a code block.
**Read the reply appears only when a reply exists.**

`malformed_call` is narrowed to text that OPENS with `ident ( {`, so prose that
merely mentions a call is still prose. And `stop::boundary` had to exempt ending
facts — endings are effects now, and the boundary catches effects on the way
out, so a turn that answered under a pressed stop would have been reported as
stopped.

**The agent overruled `docs/ALIGNMENT.md` §5 and was right:** it proposed
`ExitReason` as an `AgentState` field; a serialized state field is not reachable
by the board, card and chat projections. I8 says every view is a projection of
the log, so the ending is a log fact.

**P0-1 — the copy was false twice over, and the engine finding is the reason.**
`c2w_stop()` types `\x03` into the one PTY so SIGINT reaches the foreground
process group and the command dies (`Interrupt::Kill`). `cx_stop()` writes to
the CONSOLE — `cx.run` returns no handle and takes no AbortSignal — and the
queue is chained on the real process, so the next command still waits
(`Interrupt::Abandon`). So the sentence sent a workspace-less agent to a view it
has no rows in AND promised a kill the engine this build runs cannot perform.
Now: *"Nothing on this page can stop author once it has started — it runs until
it answers or reaches its limit of 64 steps"*, with the ceiling read from that
agent's own file via `x-max-rounds`.

**P1-5 overturns R16's reasoning, correctly:** *"R16's argument was that the pair
makes each legible; that only holds if you read both buttons AND the paragraph,
which means the label alone never said its own job."* One form everywhere —
`Stop waiting — main keeps working` / `Stop main — end the run` — verified at
320px. P1-6 a stop you asked for reads `— stopped` in neutral, off one
`workspace::was_stopped` predicate, not `— failed` in red. P1-3 the pointer now
names where the failing call actually landed, computed from `trace::is_shell` —
the same predicate R15 used to move the rows.

**P1-9 resolved by NOT renaming.** R17-IA amends R15-IA: *a view is named after
the panel you act in, and its rail is the live state of what that panel did.*
Naming a view Workspace would put the word back on two things one round after
R16 cut it to one, and the panel would disagree with its nav entry again — the
exact bug R15 fixed. What the critic measured is that `Commands` does not
PREDICT the other three panels, so a lede on that view names them. The header
rail toggle was kept with R12-6's measurement as the justification: the
alternative was a permanent toggle with `aria-expanded="true"` over a rail at
0×0, a dead control lying about its own state.

**P1-8 gloss, not rename**, with the migration cost stated: `space:` is stored
canonically through `render_agent_file`, so a rename means the writer emits a
key the old parser cannot read, every browser holding an old record needs a
silent alias forever, exports split into two dialects, and `write_agent`'s tool
argument becomes a third name. Not worth it for one word.

**P1-7 — the trap is closed.** "Write a new agent" blanks the form; the
prefilled state stays behind the explicit `Load main`. Saving over a shipped
agent warns first, and the warning is correctly ABSENT on the second save
because by then it is your own copy being replaced. The plain-English path now
leads the panel with a door to `#/chat/author` — the path that actually works
for a non-programmer, which the critic had to discover alone.

294 passed, 0 failed; all eight gates green. `transcript.rs` carries both
agents' changes (`ending::reply` and `x-max-rounds`) — checked by hand after one
agent reported briefly clobbering the other's edit and restoring it.

### Round 18 — critique (fresh context, no source)

~10s cold. Warm reload to interactive: **~750ms**, measured. Map predicted 5 of
6; **Commands ✗ a third time** — *"it is the file manager and the terminal, the
two things a first-timer most wants to find."* R17's lede did not fix the
prediction.

**P0-1 — THE APP NARRATED A HISTORY ITS OWN RECORDS DISPROVE.** Typed into the
box labelled `Steer the run — the agent reads this on its next step…`, pressed
**Send to the run**, and the running turn was KILLED, with: *"That turn is not
running any more — the page was reloaded while it was in flight, so nothing is
driving it."* **No reload occurred.** Deliberately reloading later produced the
identical string, so the reload-orphan message is being emitted for a cause that
is not a reload. Two bugs in one: the steer does not steer, and the ending lies
about why.

**P1-3, same class:** the pill read `in this turn for 4s · last tool:
list_processes` while the trace shows main never called it —
`Show what this page did on its own (13 calls)` reveals `this page ran
list_processes()`, the Files pane's own polling. **The pill borrowed the page's
housekeeping and put the agent's name on it.** The app handed the reviewer the
evidence against itself.

**P1-2 — `workspace` now means THREE things, and this is partly R16's doing.**
The header pill = the Linux VM; the Commands rail = the folder; and the
Dashboard panel titled `Workspace · main` = the shared MEMORY store
(`remember`/`forget`/`post_note`). R16 collapsed `shared space` into `workspace`
to kill one blur and created another. The concrete break: main said *"I wrote a
file called notes.md"* while the panel headed **Workspace · main** said
**"Nothing has been recorded here yet"** — *"both true; the reader is entitled to
conclude the agent lied."* Also `main's workspace` in the header vs *"works in
the 'research' workspace"* shared with three other agents on the card. Proposal:
three nouns — **Machine**, **Files**, **Memory** — and delete "workspace" from
the UI.

P1-5 `main finished "…"` for a task the agent REFUSED (no web access), with
`Finished files` still empty — answered is not did-what-you-asked. P1-6 the
Files pane showed `Nothing was in the workspace when this listing ran` after a
write, and **the trace proves the app re-listed and saw `notes.md`** — the pane
did not adopt it. P1-7 an agent file with `model: locl`, `engine: reakt`,
`tools: [nope_tool]` **saved with no validation**; the card reported the garbage
back as fact and silently dropped the unknown tool; the failure then pointed at
**Settings**, with the truth (`Model 'locl' not found`) triple-JSON-nested behind
`Technical detail`. P1-8 `Delete haiku` is one unconfirmed click. P1-9 at 390px
chrome eats ~600px and the transcript gets **~180px**.

**What held, tried and failed to break:** *"Endings agree across surfaces. I
tried to break this and could not"* — stop, card, trace and list all matched,
turn counts matched. R17's work held. The stop controls are called
**best-in-class**, with the promise verified: the in-flight `sleep` finished,
nothing new started, and the helper text switched tense mid-press. And the
self-doubt warning was **right** — it fired on `write_file contents= path=
content.html`, an empty write the agent believed had content.

Named as portable to Hermes tomorrow: the `its own record does not back it`
warning, and the compaction disclosure.

### Round 18 — fixed

**P0-1 WAS NOT A BUG IN THE MACHINE.** Reproduced on the host with a model that
never answers: the steer arm, `stop::boundary` and the runtime were all correct,
and `x-turn: pending` was still in the same fragment. Nothing killed the turn.

`transcript.rs` drew the orphan sentence for **any** `UserMessage` landing while
awaiting — in two copies — and a steer has exactly that shape: an utterance with
no answer beneath it. The log could not tell them apart because the steer lived
in `state.steered`, **a serialized state field — the same thing R17 rejected for
`ExitReason`**. So the steer became a log fact, the R17 shape one act earlier.

*"That turn is not running any more — the page was reloaded…"* → *"main was
already working when you sent this, so it went to the run in flight — main reads
it on its next step. No new turn was started, and nothing was interrupted."*
A deliberate reload still says reloaded, and a replay holding both shows one of
each on the right message. **No new ending: a steer does not end a turn, so
under R17's rule it earns no name.**

**Why eighteen rounds of tests missed it:** *"They assert on `step`'s returned
effects — that's the whole discipline of a pure step function, and it is exactly
why they could not see this: the defect was never in what the machine DID, only
in what a projection SAID about it."* There was no core test that submitted a
message into a running turn and read the transcript back. That is the standing
limit of the pure-step discipline, and every P0 for five rounds has been
narration.

**P1-6 was a real race in `cheerpx.js`.** The file's own comment states the rule
— *"One command at a time: a second `cx.run` while the first is live would
interleave two commands' output"* — and the code broke it: `queue = real.catch()`
was assigned INSIDE the `.then`, so two calls in one tick both chained on an
already-settled queue and the second `out = []` wiped the first's console. The
Files pane, artifacts shelf and Processes pane all list on the same tick. So the
pane was never stale — it faithfully rendered a projection that was itself
wrong, holding another call's stderr or nothing at all. `c2w.js` had it right,
which confirmed the pattern.

**P1-9 measured:** chrome above the conversation **597px → 370px** at 390×844,
`#chat-view` **219px → 446px**, composer from y=863 (below the fold) to y=674.
CSS only. New gate assertion `CHROME` in `fold-probe.js`: the routed region must
keep at least a third of the viewport — verified by neutering (fails at three
sizes, passes 32/32 restored).

P1-7 unknown tool names are **reported, not refused** — a name may be a peer
agent you have not written yet, and refusing would enforce typing order as if it
were capability; also the direction is opposite to `spec.rs`'s guard, since a
dropped NAME grants less than the file asked for. New `ModelError::ModelMissing`
discriminates a 404 naming our model id from an auth failure — *"Nothing here
says the address or the key is wrong — the endpoint answered"* — and the door
becomes **Open haiku's file**, not Settings. Save-time model validation was
**declined with the decisive reason**: the local catalogue is the wrong list, so
validating against it would refuse correct files. P1-8 delete is a two-click arm.
P1-5 the card says what the turn DID — `main answered "…"`, plus, only when the
count is zero, *"It called no tool while it did"* — and never whether it worked.

P1-2's four nouns applied; the two held files took the drop-in text and
`wait.rs` stopped saying one fact in two spellings.

305 passed, 0 failed; all eight gates green.

**Third shared-tree incident: an agent `git checkout --`'d shared files to
isolate a test and reverted two siblings' work.** It restored them and said
*"that was a bad move in a shared tree and I would not repeat it."* Worktree
isolation is no longer optional.

## The new goal — first increment (agents as data, verify, threads)

Four studies landed first: `reference/agents/deepseek-harness.md`,
`docs/AGENT-BOUNDARY.md`, `docs/GOAL-AND-LOOP.md`, `docs/THREADS.md`.

**deepseek-harness does not have what it was named for.** Confirmed at the real
URL, HEAD `47f9438` (2026-08-13), 7,404 files. Plan is a logged boolean plus a
prompt section; work exists twice, unrelated; **verify is prompt prose only and
critique does not exist** — four of its own READMEs say *"no independent
evaluator … deferred."* Its agents ARE data files, but the file declares DI
plugin rows, not agent properties: no `model:`, no `engine:`, and **a declared
agent cannot choose its loop**, only which policy plugins mount. Nobody in the
field has shipped the thing. One steal, sized S: Ralph's
`{status, summary, evidence[], nextSteps[], blocker}` handoff with cross-field
validation.

**Two frontmatter keys were inert — the failure this project refuses.**
`engine:` parsed, defaulted, rendered back out and printed on the card, with
**zero behavioural readers**; `temperature:` was parsed, displayed, and absent
from `Effect::CallModel`. Both now real:
- `temperature` rides the call. **Widened `f32`→`f64`** because `json!(0.7f32)`
  serialises as `0.699999988079071` — a number on the wire the file does not
  say. Absent key sends no field at all, not an invented default.
- `base` genuinely means "answer in one reply, call no tools". Before this, the
  shipped `summarizer` (`engine: base, tools: []`) read as EVERY built-in — **the
  one `base` agent in the tree was the most capable one in it.**
- Any other value is refused at parse. R18's critic saved `engine: reakt` clean
  and the card printed `How it works: reakt` — the file's typo dressed as a fact
  about the machine. That arm is deleted.
- The default moved `base` → `react`, deliberately: with `base` made real,
  defaulting to it would silently disarm every file that omits the line.
- R18's "reported, not refused" survives intact — that ruling is about **names
  that may resolve later** (a peer agent not yet written, a model another
  endpoint has). An engine value never will.

**The verify gate ships for every agent, no flag, and needs no ledger.** Hermes
keeps an evidence store with a freshness clock; here **log order IS the freshness
rule**. A successful write sets `mutated` and clears `green`; a later successful
command with real output sets `green`; a prose answer with `mutated && !green`
does not end the turn — one nudge, twice, then `answered, unchecked`.
`says_nothing` MOVED rather than being imported, because `agent` sits below
`core` in the layering table — one copy, four readers.

**§12's ban is asserted mechanically:** `verify19.rs` scans rendered `/chat` and
`/board` for `verified`, `unverified`, `proven` and fails on any. The row reads
*"it changed a file and no command ran afterwards, so this page cannot say
whether it worked"* — observation, no verdict.

**And the loop worked in the browser:** told to write and answer without
checking, the model got the nudge, ran `exec`, and corrected itself. Its own
reply then said "verified" — inside speech, which the page does not vouch for.

**Threads: one row per agent, the routed one expanded in place.** Cost rules
MEASURED by instrumenting `handle` (then reverted): `/board` reads in 10s = 12
on Chat with six rows, **5 on another view — the list adds zero**. One-per-row
would be 30. Openness is `name == selected()`, not a signal or a fact, so every
added request is a GET that appends nothing.

`chat-panel`/`chat-scroll`/`chat-log` were fixed ids, so two panes made
`newest_turn` scroll the wrong conversation — now per-agent, and since
`#chat-panel` was also a CSS selector, the panel carries `data-chat` instead:
**an id that moves cannot be a selector.** No nested cards (`ChatPane` takes a
`head` and drops its own `<h2>`), and a collapsed thread is a row not a card —
78→54px at 390, because six panels left the conversation 194px of 844, *the
furniture beating its subject*.

**R19-IA**, amending R15-IA: *a view has one control for its own subject* —
where the panel a view is named after already lists the agents, that list IS the
picker and no strip renders beside it.

324 passed, 0 failed; all eight gates green.

**Fourth `git checkout --` incident**, this one self-inflicted by the agent on
its own file: *"it was a bad move and `cp` from a backup — which I had already
made for four other files — was the tool I should have reached for."*

---

## Increment 20 — the agents folder gets the loop, and the core stops naming names

The goal: *"no matter how complex the loop sounds, I want the agents details to
be fully present in the agents folder with data and metadata. The core or other
parts of the project should only be taking the agents, setting them up and
keeping them running."* Plus a plan/work/verify/critique loop, and one LLM call
ahead of the work that fills in the technical detail a typed goal never carries.

### Two jobs the core used to hardcode

`ENTRY_AGENT = "main"` (`core/src/app.rs:15`) and `SUMMARIZER = "summarizer"`
(`agent/src/paper.rs:12`) were string literals. Renaming `public/agents/main/`
changed nothing; **deleting `public/agents/summarizer/` stopped compaction
everywhere with no word on any surface.** Both are now `role:` declarations in
the file — `role: entry`, `role: summarizer` — looked up by
`loader::role_holder`. A misspelt role is refused at parse, on `engine: reakt`'s
rule. The literals survive as fallbacks, and that is not decoration: an agent
file installed in *this browser* can replace `summarizer` without carrying the
role line, and dropping compaction silently is the exact failure the key exists
to end.

### `stages:` — the loop, in the file

```yaml
stages: [plan, work, verify]
```

Four names and no more. Absent means the react loop alone, which is every agent
written before the key — the whole compatibility rule, asserted in one test.

**A stage is not a new machine.** It is one instruction pushed into the paper
and one more call, taken by the same `step` against the same window: prose from
a stage that is not the last one *moves the cursor on* instead of ending the
turn. So a stage cannot invent a transition the loop did not already have, and
there is no second state machine to keep in agreement with the first. The whole
of it is `stages.rs` — under 200 lines including the briefs.

`plan` and `critique` are told to call nothing, and `ask::scoped_tools`
**enforces** it rather than trusting the sentence. That is increment 19's
lesson applied on the day it was learned: a capability described and not
enforced is a setting that looks applied.

Refused at parse, not defaulted: an unknown stage name (both YAML forms), a
list with no `work` in it (it could never act, whatever `tools:` said), and
`engine: base` beside a stage list (one reply cannot walk a sequence).

### The goal→plan pre-pass, as one stage

`docs/GOAL-AND-LOOP.md` designed this as the shipped read-only `plan` agent run
as the first stage — a delegation, a second Worker and a handoff, for one
toolless model call. Dropped. The brief is five named lines — OUTCOME, PATHS,
CHECK, DONE WHEN, ASSUMED — with an escape hatch in the last sentence so a
greeting does not cost a plan. Against gemma-4-12B it produced, unprompted:

> OUTCOME — A file named ok.txt exists in the workspace containing the text "fine".
> PATHS — /root/spaces/research/ok.txt
> CHECK — cat /root/spaces/research/ok.txt

…and the verify stage then ran that exact command and quoted `fine` back.

### What the browser walk caught that the tests could not

The first walk was correct and **wasteful**: the mechanical verify gate (19) and
the declared `verify` stage both fired, so the model was asked twice and the
conversation printed two notices saying the same thing. `stages::verify_ahead` —
the declaration wins, because it is the loop the agent's own file asked for.
Four model calls per task-with-a-write now, not five.

### Shipped configuration

`main` declares `role: entry` and `stages: [plan, work, verify]`. `critique` is
deliberately NOT on it — it is a whole extra call and `main` is where a greeting
arrives; `plan` carries `[plan, work, critique]` instead, so the fourth stage
ships exercised rather than theoretical.

**331 passed, 0 failed**, all eight gates green, and the loop walked end to end
in a browser against the local model.

---

## Increment 21 — the first tool that leaves the browser

The goal names websearch among the capabilities a person should expect. The
build had `NetPort` — brokered, allowlisted HTTP, distinct from the model path —
and **zero consumers**: `FetchNet::new(Vec::new())` at both composition roots,
an allowlist that was empty everywhere, so nothing in this application could
reach the network for any reason other than the model. `web_search` is the
first, and it is the increment that makes that port real.

### Where it goes is a setting, not a constant

CLAUDE.md §17 makes a network allowlist a user gate. So the capability ships and
the destination does not: the search endpoint is configured in Settings, the
allowlist is **built from that setting**, and `FetchNet::new()` now takes
nothing and denies everything until `allow(name, url)` is called. A blank URL
*removes* the entry rather than leaving an empty base.

With none configured, the tool comes back refused — in words that say where to
choose one and that retrying will not help:

> No search endpoint is configured in this browser, so nothing was searched. A
> person sets one under Settings → Web search; nothing on this page can turn it
> on for you, and retrying will refuse again.

That is deliberate. An empty result reads to a model like a web with nothing on
it, and it will answer from memory and call that research.

### Five rows, because the sixth costs the window

A SearXNG `format=json` reply is routinely 200 KB of engine metadata, positions
and categories. Handing that to a model is not a search result, it is the window
spent. `agent::search` — pure, host-tested against malformed, empty, missing-field
and oversized fixtures — cuts it to at most five rows of title, URL and one line,
with hard caps per field because both arrive from a stranger's server.

The core names the endpoint symbolically (`search`) and holds **no URL
anywhere**, so `core::websearch` cannot reach anywhere the user did not put on
the list and does not have to be trusted not to (ADR-006, I6).

### A comment that had gone false

`core/src/tools.rs` said the first network tool would go through
`execute_effect`'s async path. `Effect::InvokeTool` has been `unreachable!()`
there since the workspace shipped; the async tool path is `batch::single`, where
the search now sits beside the Linux and the space tools. Corrected in place —
a comment that tells the next reader to build in a dead branch is a bug with a
long fuse.

### Not built

Registering the search in `app.calling`, so a slow search shows as nothing until
it returns — worth adding when the wait is felt. No page fetching, no second
argument, no request bodies (the broker refuses one in words rather than
dropping it silently). No default endpoint value: the SearXNG address in
Settings is placeholder text, and the copy says most instances serve HTML only
and self-hosting is the reliable route.

**343 passed, 0 failed** (+12), longest file 200, layering, stylesheet and both
trunk builds green. The response shape is read from this project's prior
`web_search` work and not from a live call — a field-name mismatch produces the
"not a search answer" refusal rather than a silent blank, and
`agent::search::line` is the one line to change.

---

## Increment 22 — what the cold walk found, and one thing it was wrong about

A critic that had never seen this application walked the deployed page. Verdict:
nothing broken — `crossOriginIsolated` true, 160 requests all 200, no console
errors, the Linux real (`Linux 4.15.0-54-cheerpx`, a file written and the panel
updating), state surviving a reload. The failure path it called the strongest
part of the build. Then it found these.

### The page stated the wrong model

With openrouter selected and a real 401 returned from openrouter.ai, the header
read `openrouter — openai/gpt-4o-mini` and **every agent card read `Model:
local`**, in one screenshot. A person who changed the endpoint and got refused
would read that card and go hunting in the wrong place.

The card was printing the agent file's literal `model:` field, which is a
CATALOGUE KEY, not a model id — so the old label was wrong twice over. It now
prints what the next turn will really call, resolved through a new
`ModelPort::resolves` (defaulted, adapter overrides — `WorkspacePort::durable`'s
precedent) and says which way the tie went:

> Next turn: openai/gpt-4o-mini, at the openrouter endpoint — its file asks for
> local, and the choice in Settings overrides it.

…and when the port cannot say, it says that rather than inventing a model name.

### The loop shipped in 20 and the interface never mentioned it

The critic searched all six views: `verify` 0 occurrences, `stage` 0, `loop` 0,
`delegat` 0. The plan stage rendered as an unlabelled `NOTE:`. **A capability
nobody can name is not a feature — it is overhead the user pays for and cannot
see.** Stage blocks now carry the stage as the speaker (`Plan stage:`, `Work
stage:`, `Verify stage:`, `Critique stage:`), read off the `core.stage_entered`
fact already in the log — a projection, not a second copy of the state (I8).
Each agent card says its loop on its face (`Runs in stages: plan → work →
verify.`), an agent with none says what that means instead of staying silent,
and the four words are defined where a newcomer lands rather than three folds
deep.

### The agent named `plan` collided with the stage named `plan`

That was increment 20's mistake. The AGENT is renamed `scout` — it goes and
looks first — because the stage name is in shipped files and in `agent::stages`.
A test now asserts **no shipped agent is named after a stage**, so the collision
cannot come back. `ask`, `scout` and `researcher` also had near-identical
descriptions in one space, so nobody could choose between them; each now says
what it is for, and `researcher` says plainly that it is not for you — another
agent hands it a question and it cannot see your conversation.

### The glow was failing WCAG AA and Settings said it changed nothing

Measured, not eyeballed: the lobes are POSITIONED in percent and SIZED in rem,
so `--lobe-accent` at `6% 46%` with a 480px radius sits beside the reading
column at desktop width and directly on top of it at 390px. Tagline contrast
was **1.31:1 at every width below 1100px and fine above it** — 1100px being the
layout's own nav-drawer breakpoint, so the bug had a seam and the clamp lands on
it. Now 5.87:1. The Settings sentence claiming "every control, word and number
is the same either way" was left alone, because it is now true — hedging the
sentence would have been fixing the wrong thing.

### A refusal of nothing is not a wrong credential

Saving an endpoint with an empty key field and sending a message printed "check
the base URL and API key in Settings" beside a header that already said "with no
key". My brief for that fix asserted the app already held the fact. **It did
not** — key state lives only in `adapters_web`, `ModelError::Provider` carries
`{status, message}`, and no event in the log carries it either, so the sentence
could not be made specific without threading the fact through four files. The
agent refused at its file boundary and reported that instead of guessing, which
is the right call and the more useful finding.

Done here, on R18-P1-7's precedent (which folded `ModelMissing` out of
`Provider`): a `NoKey` variant, discriminated on whether an `authorization`
header ACTUALLY WENT OUT — a fact this application holds — and never on the
provider's prose, which says whatever that provider likes. 401 and 403 both,
because providers disagree about which one an absent credential earns.

> This endpoint needs an API key and none is set, so the request went out
> without one and was refused. Add the key in Settings.

### Left standing

The endpoint pill at 390px is no longer truncated to `call...`, but ~85px of it
still starts past the scrollport edge, so reading it takes a sideways swipe.
Wrapping it costs ~75px of header and breaks the ONESCREEN assertion
`layout-probe.js` makes at 390×844 — a real trade, taken deliberately, and
reversible in one line if the swipe proves worse than the height.

**351 passed, 0 failed**, size, layering, stylesheet and both trunk builds green.

## Increment 23 — a turn that goes round again

The goal asked for a core "that can keep running for a goal" without the user
babysitting it. Everything needed for that was already here except the lap: the
`stages: [plan, work, verify, critique]` list from increment 20 walked exactly
once and then the turn ended, so a goal larger than one walk needed a person to
type "carry on".

`passes:` is that lap, and it is deliberately **not** a second state machine —
when the stage cursor runs out it resets to the `work` index rather than to 0,
so a pass is a cursor reset inside the same `step`. One new file,
`crates/agent/src/passes.rs` (89 lines), holds the whole of it.

### The continue condition is mechanical

The rule that shaped the increment: **nothing asks the model whether it is
finished.** A model that says "I have completed the task" while having changed
nothing gets no further pass, and a model that says nothing while writing files
gets one. `state.acted` is set by `verify::observe` under exactly the two
conditions that already set `mutated`/`green` — a mutating tool ran, or a
command produced output — and is cleared at every lap. A pass that touched
nothing ends the turn with the ordinary `answered` ending.

The budget spans the goal rather than resetting per lap: `tool_rounds` is not
cleared by a pass, so 3 passes × `max_rounds: 2` stops at round 2, not round 6.
Passes and rounds are two ceilings on the same run, and `Ending::PassCeiling` is
its own ending with its own board word — "stopped when its passes ran out" —
because "it ran out of rounds" and "it ran out of laps" send a person to
different lines of the same file.

The goal survives compaction: the plan brief now tells the work stage to
`remember` the `outcome` and `done_when` as its first action, when the agent has
a space. Compaction eats the transcript; it does not eat the space.

One agent loops. `builder` — `stages: [plan, work, verify]`, `passes: 4`,
`max_rounds: 64`. `main` stays at one pass, because a greeting must not cost
five model calls; `scout` and `ask` are read-only and could never satisfy the
continue condition, so giving them a budget would ship a dead feature.

### Where it can still be fooled, written down rather than hidden

`echo .` in a loop buys every remaining pass — `exec` with any non-empty output
counts as evidence, and narrowing that to *new* output needs a ledger
`verify.rs` deliberately does not have. `write_file` with identical contents
counts, because `is_mutating` is a list of tool names, not a diff. And work done
only through `start_process`, `remember`, or a delegated sub-agent is invisible
to the fold, so that run ends after one pass — a failure in the safe direction,
but a failure. The pass ceiling is the backstop for all three.

**364 passed, 0 failed** (+13), size, layering, stylesheet and both trunk builds
green.

## Increment 24 — the page can listen, and it can speak

The goal asked for STT and TTS in the browser. Both are already in the browser —
`SpeechRecognition` and `speechSynthesis` ship with it — so the increment is
about two buttons and one paragraph of honesty, not about a model.

`Dictate` writes into the composer draft as you speak, showing the interim
transcript in a `role="status"` line so you can see it hearing you. `Read the
answer aloud` speaks the last assistant reply. Both are pure UI: nothing under
`crates/agent`, `core`, `kernel` or `adapters_web` moved, and no new crate was
added — the whole feature is `crates/ui/src/composer/voice.rs` (195) plus
`voice/mic.rs` (83) and 39 lines in `composer.rs`.

### Dictation is not local, and the page says so

This matters more than the feature. Chrome's `SpeechRecognition` sends
microphone audio to Google's servers and sends words back. For an application
whose whole claim is that it runs in your browser, that is the second thing in
the product that leaves it — the first being the model endpoint the user
configured themselves. So the sentence sits under the button in prose weight,
inside no disclosure and behind no fold:

> **Dictation is not local.** Press Dictate and this page hands your microphone
> audio to your browser's own speech service — in Chrome, that is Google's
> servers — which sends words back. … Some browsers can now do this on the
> device instead; this page cannot tell which yours does, so assume it leaves.
> Nothing is sent until you press the button, and nothing is sent to us.

The same claim, weaker, is made about the voices: some speak on-device and some
are fetched, and this page cannot tell them apart, so it assumes the worse one.
Nothing is sent before the button is pressed — constructing a recogniser asks no
permission and opens no microphone, which is also the feature test.

### Two invariant exceptions, both written down

I5 gains an exception for one line of JS in `index.html`: Chrome and Safari
still spell the constructor `webkitSpeechRecognition`, so the alias is declared
there and the Rust names the standard type once. I2 gains a note, because
`crates/ui` now reaches a browser capability directly rather than through a
port. `ALIGNMENT.md` §7.2 records the upgrade path that retires both: speech as
`ModelPort` roles, at which point transformers.js/Whisper becomes a provider
behind that port rather than a new dependency — and behind a sized download
gate, because tens of megabytes of weights on a page whose value is that it
loads fast is a product decision, not a feature flag.

Absent, not broken (I15): on Firefox, `SpeechRecognition::new()` returns `Err`,
`build()` returns `None`, and the button is never drawn.

Dictation stops when the turn does — `hush()` runs in `send()`, in an effect on
`busy`, and in `use_drop`. Both handlers are cleared before `abort()` and the
utterance's `end` uses `try_write`, so no JS callback can write into a dropped
scope.

**364 passed, 0 failed**, size, layering, stylesheet and both trunk builds
green. The behaviour is unverified without a browser — a walk in Chrome and one
in Firefox is the missing proof.

### What the walk of 21–24 found on the deployed page

Zero console errors, zero non-200s across 228 requests, `crossOriginIsolated`
true, correct build hash. Voice, the roster and the search panel all work as
built. Three defects, two of them mine to have caught before deploying.

**The endpoint pill at 390 was worse than the last increment recorded.** The
note left standing after 22 said it took a sideways swipe to read. It did not:
the swipe never paid out. `.pill-tail` — which holds the ADDRESS and the
with-or-without-a-key fact — is hidden below 75rem, so the full 188px scroll
range bought `calls <model id>` and stopped. The two things that pill exists to
say were unreachable at every scroll position on a phone. Worse, the strip had
no scroll affordance at all (scrollbar hidden, no mask, no shadow) and nothing
inside it was focusable, so a keyboard user had no route to the hidden part.

Fixed as three lines rather than the ~75px of header height wrapping would have
cost: the tail comes back inside the 30rem block only (at 30–75rem the strip
does not scroll, so there it would clip rather than move), a mask fades the last
2rem as the sole cue that the row moves, and the strip itself takes `tabindex`
so arrow keys have somewhere to land, with a focus ring to say where they are.

That fix needed nine lines in a file already at its 200-line ceiling, so the
status strip took its own stylesheet — `strip.css`, the ninth, registered in
DESIGN.md §2 and in the guard. `header`'s own properties stayed in `chrome.css`;
splitting on the element rather than trimming the reasons is the rule that table
already keeps.

**The search field refused addresses in the model field's words.** Typing
`not-a-url` into the search endpoint produced the model endpoint's message
verbatim — offering `http://127.0.0.1:8873/v1` as the example, complete with the
`/v1` path the panel's own copy says to leave off, and promising that blank
means "use this entry's own", which is entry inheritance that does not exist for
search, where blank means the agent cannot search. Somebody following the error
would have pasted a path into a SearXNG field. The check is one rule and stays
one function; the example and what blank means are now the calling field's, with
a test asserting neither field can borrow the other's.

**A stale `role="status"`.** "There is no answer in this conversation yet" sat
under the button after it stopped being true. Cleared when a turn starts. It can
still outlive a view change — the composer stays mounted and nothing here can
see the view — so that half is unfixed and written down rather than claimed.

**Not verified by the walk:** the `web_search` refusal an agent actually emits.
With no model endpoint reachable from the deployed page there is no way to make
an agent call the tool, and there is no manual tool-invocation surface. The
settings contract says it refuses and says so; the sentence itself is covered by
`crates/core/tests/websearch.rs` on the host and by nothing in a browser.

**365 passed, 0 failed**, size, layering, stylesheet (9 files), the browser
layout probe, and both trunk builds green.

## Increment 25 — a critic that did not do the work

The `critique` stage has been here since 20, and it is the same model, in the
same window, marking its own homework. In Hermes, AutoGPT, Claude Code and the
DeepSeek harness, review that means anything is a SEPARATE call with a separate
prompt that is not invested in the answer. So: `public/agents/critic/agent.md`,
an agent rather than a stage.

It is read-only, and that is the grant rather than an instruction: `tools:` is
`read_file`, `list_files`, `find_files` and nothing else. No `exec`, no
`write_file`, no `start_process`, no `remember` — a reviewer that can write the
shared space can change what it is reviewing — and no peer agent name, so it
cannot delegate around any of it. A test asserts the shipped file can read and
change nothing, rather than a sentence claiming so.

The verdict is prose, not a protocol: first line `PASS` or `FAULT`, then at most
five lines of why. A person reads the reply; the machine reads one line of it.
That is the convention `PLAN_BRIEF` already set with `OUTCOME —` and `CHECK —`.

### The caller cannot launder the verdict

`delegate` returns the critic's answer as an ordinary `ToolInvoked`, so
`verify::observe` folds it in log order like every other result:
`reviewed = Some(ok && critic::passed(output))`. A successful mutation afterwards
resets it to `None`, because a review of what the file used to say is not a
review of what it says now. `answer.rs` then cannot choose `ANSWERED`, and the
run ends `answered, and the critic disagreed`. The caller's own prose is never
read — a core test scripts the caller saying "the critic reviewed it and was
happy" over a `FAULT` and asserts the board says otherwise.

### Where it can be fooled, at length, because this is the part that matters

**Nobody is forced to call it.** The mechanism fires only when a critic result
arrives. `builder` calls it because its prompt says to, which is prose; a
builder that skips the call ends `answered` exactly as before. No must-be-
reviewed gate was built, because that would put the machine in charge of when
work is finished, which nothing in this codebase does.

**The caller writes the exhibit.** Delegation is one string, and a delegated
agent's `read_file` refuses in its own Worker, so the critic reviews the
caller's account plus the shared space. A flattering account gets a flattering
review, and nothing checks that quoted command output was ever produced by a
command.

**Two calls, one good verdict.** The fold keeps the last one, so `FAULT` on the
real work followed by a `PASS` on something trivial ends `answered`. Closing
that needs a per-call ledger `verify.rs` deliberately refuses to have.

**One word decides.** Only a first line equal to `PASS` clears — `Verdict: PASS`
reads as a fault, which is noisy in the safe direction; `PASS` over five
paragraphs of objections is a pass, which is not. And the critic is a model: it
can be sycophantic or wrong, so nothing on the page ever says the work was
verified, proven or approved. A test greps three views for all four words.

**`critic` and `critique` are one word apart**, on the same screens. Increment 22
renamed `plan`→`scout` for exactly this collision class. Whether the `critique`
stage still earns its keep now that a separate reviewer exists is an open
question — `scout` is its only user.

## Increment 26 — the model that is already here

Every turn until now needed an endpoint somebody configured. Chrome and Edge
ship a model inside the browser, reachable with no address, no key and no
network the page makes — which is the project's own claim, finally true of the
cognition and not only of the capability.

It arrives as a catalogue entry called `on-device`, behind the same `ModelPort`.
`core` and `agent` were not touched and do not know it exists: they ask for a
symbolic name, and the adapter takes a branch before a URL or an `Authorization`
header is assembled. The reply comes back shaped like the OpenAI-compatible one,
so nothing downstream can tell the difference. There is no JS shim and so no I5
exception — `js_sys::Reflect` off `globalThis` reaches it from Rust.

The API was confirmed against developer.chrome.com's Prompt API page rather than
assumed: `LanguageModel.availability()`, `create({initialPrompts})`,
`session.prompt()`. Two facts from it shaped the code. A system turn is accepted
only at session creation and is never evicted under context pressure, which is
exactly the guarantee the Document's system section wants — so the request body
is split, system into `initialPrompts` and the rest into `prompt()`. And **the
Prompt API is not available in Workers**, which is where every sub-agent's turn
runs; that is a stated limit with a sentence of its own rather than a mystery
failure.

I15, as in 24: `unavailable` means the entry does not exist at all — not present
and broken. Firefox and Safari have no `LanguageModel`, so they see nothing to
pick and nothing to fail. `downloadable` and `downloading` DO advertise, because
the model is real and the browser will fetch it; what differs is the price, and
the price is copy:

> Your browser has not downloaded this model yet. The first turn you send starts
> a download your browser performs and stores itself, measured in gigabytes —
> this page does not manage it, cannot show its progress, and the turn does not
> answer until it finishes.

`ModelError::OnDevice` is its own variant because every existing one names
something that does not exist here: `Transport` and `Timeout` carry a URL,
`NoKey` and `Provider` send you to a key field, `Unsupported` claims a wire
protocol. Its remedy says the one true thing — nothing was sent, and there is
nothing in Settings to correct about this entry.

### The trap the builder found, and the one I found after

`Catalogue::resolve` treats an unlisted name as *a model id served by the
default entry*. So a saved pick of `on-device`, reopened in a Worker or on a
browser without it, would have POSTed `model: on-device` to somebody else's
server. `Endpoint::resolve` now refuses that by name, with a test.

And the entry shipped carrying `base_url: "this device"` — a stand-in so that
the composer's gate and the header pill, both of which require a non-empty URL,
kept working. That put a sentence in the one field that means an address, and
the header pill read `… at this device`. The gate and the pill branch on the
entry instead now, `base_url` is empty because there is no address, and the pill
says `The next turn runs on your browser's own model, on this machine — no
address, no key.`

**Unverified without a capable browser:** that `create()`/`prompt()` accept the
shapes built here, and whether a first turn on `downloadable` blocks for the
download or throws. The headless Chromium on this machine reports `LanguageModel`
undefined, which exercises only the absent path — the one that matters most for
everybody else, and the one that is proven.

**383 passed, 0 failed**, size, layering, stylesheet, the browser layout probe
and both trunk builds green.

### What the walk of 25–26 found on the deployed page

Walked `f4391d3` (wasm `ui-55330f2e15e90208`) at 1440 and 390. Two findings, both
in what increment 25 shipped; nothing wrong in 26.

**F1 — the critic's card contradicts itself.** It opens "Not for you — another
agent hands it finished work", states it cannot change, run or start anything,
and then offers `Talk to critic` and `Give critic a task`. Every card gets those
two doors, and on this one the second is an offer the agent cannot honour: no
shell, no write tools, so an autonomous task handed to it can only end in a
report about nothing.

**F2 — `critic` the agent and `critique` the stage, one word apart on one
screen.** The Agents view explains the four stages three sentences above a card
for an agent named `critic`. This was noted as a possible collision when 25
landed; the walk confirms it reads as one.

**What 26 proved, and what it could not.** `typeof globalThis.LanguageModel` is
`undefined` on this Chromium, and the Settings entry picker lists six entries
with no on-device one among them — the phrase "browser's own model" appears
nowhere in Settings. That is I15 doing its job: no entry that would fail on
every turn. The present path still needs a browser that has the model.

**The 24 fixes, re-confirmed live at 390.** `.pill-tail` renders `inline` and
carries the address and the key clause; `.pill-label` is `none` and `.pill-short`
carries `calls`; the model id never hides. The status strip has `tabindex="0"`,
`role="group"`, the mask gradient, and scrolls inside itself — 780px of content
in 340px — while `body.scrollWidth` stays at 390. Header is 70px at 1440, so
ONESCREEN survived. No console errors.

---

## 27 — Mission Control, and a card that stopped offering what it cannot do

Two things landed together: the Dashboard grew the fleet strip the reference
screenshot asked for, and the two defects the 25/26 walk found were closed.

### The tile strip

Four tiles above the existing grid — agents working, turns taken, tokens spent,
last failure — served as `GET /tiles`, a second subroute on the **board**
module. Not a module of its own: the fleet's status is one fold, and a second
module would have had to be handed the same projection to answer the same
question, which is how two regions on one screen come to disagree.

The predicate for "who is working" moved out of `board.rs` into
`tiles::busy_names`, and `board.rs` now calls it for its own `x-busy` header.
A test asserts the tile's count against that header, in both the idle case and
the accepted-but-not-yet-pumped case, so the number and the names cannot drift.

**Three things from the reference were deliberately not copied**, and the
reasons are tests rather than comments:

- No `LIVE` badge over a value the tile does not have. The reference shows five
  tiles badged `LIVE`, three of them reading `…` and `checking…`. A tile with
  nothing to report says so in words — `no turns yet`, `nothing spent yet`,
  `no agents are loaded` — and a test greps this crate for `…`, `—`, `LIVE`
  and `N/A` in the value slot. A placeholder is a promise something is coming;
  for a log with no facts in it, nothing is.
- No green summary. There is no `ALL SYSTEMS` tile and no rule that could make
  one, because this product reports a failure and never infers a success from
  the absence of one. A second test greps for that vocabulary.
- No per-card colour wash. `--danger`, `--warning` and `--success` already
  carry meaning here, and a decorative orange/violet/teal gradient beside them
  is how a red state stops reading as red. The only tinted tile is
  `[data-status="failed"]`, and it tints by re-pointing `--tone` (G2), not by
  restyling the element.

The workspace/Linux tile the brief suggested was dropped by the agent building
it, correctly: the header carries that state at every width already (R7-12),
it is a `WorkspacePort` read rather than a fold, and a second home for one fact
is what §11 forbids. Four tiles, all counted from the log.

### The board's rows became doors

Each row ends in two `btn-secondary` buttons carrying `data-open="chat"` and
`data-open="trace"` — `Talk to main`, `What main has run`. Named for the
destination, never `Start`: a door on a row already inside a turn must not read
as an offer to begin another. One delegated handler on the deck, mirroring the
roster's, not shared with it — `roster.rs::pressed` closes on `.agent-card` and
that file belonged to the other change in flight.

`web/mission.css` is the tenth stylesheet. Under G1 the `.board` rules moved
out of `surfaces.css` whole, because the Dashboard's copy is now a reflowing
grid and the rail's is still a list; `.board.compact .editor-picks` is
`display: none`, which takes the buttons out of the tab order along with the
pixels.

### F1 — the critic no longer offers a task it cannot take

The card said `Give critic a task` four lines under its own description saying
it cannot change, run or start anything. Its file names only the three reading
tools, so a task handed to it could only end in a report about nothing.

`doors` now branches on `spec.role != ROLE_CRITIC` — the role, not the name,
and a test named `an_agent_named_critic_without_the_role_keeps_both_doors`
pins that. The task door is replaced by a sentence naming who does call it,
read off the peers' own `tools:` lists so renaming `builder` cannot make the
card lie. `Talk to` stays: handing it finished work in chat is real.

The critic's `description:` was rewritten to agree with the buttons beside it,
and a test `include_str!`s both shipped agent files to assert the old copy is
gone — the card and its file cannot drift apart silently.

### F2 — the stage and the agent share a word

One clause, mid-paragraph: `critique` "is one agent rereading its own turn, and
it is not the separate critic agent on a card below".

### What the gate did not measure until it was told to

`check-layout.sh` printed OK over a fixture with no tile strip in it, and with
only the rail's compact board — the Dashboard's copy, the half that changed,
was absent. That is the same defect the script's own header records from
increment 13. `layout-probe.html` now carries both new regions, including the
failed tile.

That was not enough, and the deployed page said so. The card grid was laid on
`.board`, and TWO boxes stand between it and the cards: `.board-rows`, the
shell's delegation host, and `#agent-board`, what the seam returns. So the grid
had exactly one child. Every card stacked in a single 910px column and
`grid-template-columns` computed to `910px 0px 0px` on the live page — while
OVERFLOW, ONESCREEN and every contrast check passed, because one column is a
perfectly valid layout. It is just not the one that was written.

`display: contents` on both wrappers lifts the rows to be the grid's own items,
which is the fix `layout.css` already makes for `.card-deck > #agent-list` —
same seam boundary, same shape. The delegation host got a name to be reachable.

And the probe learned to check it: **DECKCELLS** asserts that where the deck is
wide enough for two 18rem tracks, two cards share a row. Not on the DOM tree —
`display: contents` is precisely the mechanism that makes a descendant a grid
item without moving it, so a `parentElement` check reads orphan while the
layout is right. The first version of this assertion made that mistake and
failed 54 times on a correct page. It measures the outcome now: `2 cards share
a row in 678px`, at every width with room for two.

The gate is green on the markup that actually shipped: no overflow at
320/360/390/768/1100/1280, no target under 24px, DECKCELLS passing.

`cargo test --workspace` 0 failed. Size OK, 232 files, longest 200. Layering
OK. Stylesheets OK — 10 files, 6 font sizes, 0 raw spacing literals.
`agentcard.rs` is now at exactly 200 lines, so the next edit to it pays first.

### Open, and not fixed here

`cargo fmt --check` reports diffs across ~40 files in crates this increment
never touched. The tree was already fmt-divergent; it is not in the gate set,
which is why nobody noticed. Reformatting the tree inside a reviewable
increment would bury it, so it is recorded and left.

---

## 28 — which part of the turn is running

The board said `in this turn for 12s · last tool: read_file`. "It is working"
without "on what part" is the weakest form of the promise this product makes,
and the fact was already in the log: `STAGE_ENTERED` has been written since 20
and `fold.rs` has read it since then to decide a turn is still up. No surface
ever showed it.

`crates/core/src/stage.rs` (new — `fold.rs`, `boardrow.rs` and `lib.rs` were
all at exactly 200 lines) folds the agent's own facts to the current stage, and
the live row opens with `stage 2 of 4: work`.

- The stage is read from `STAGE_ENTERED` in the CURRENT turn only, never from
  the `stages:` list the file declares — that list says what a turn WOULD do.
  The list is used for one thing: counting a stage the log already named.
- A turn with no stage fact yet gets no word. An agent whose file declares no
  stages says nothing about stages at all — there is no `stage 1 of 1` (I15).
- A stage never survives its turn: this asks `fold::awaits` where a turn ends
  rather than keeping a second opinion about it.
- The count leads and the name follows because the row already opens with a
  status word, and `working · … · work` read as one word stuttering. The name
  is still the roster's; a collision is not fixed by renaming either side, and
  a test `include_str!`s `roster.rs` to keep the two vocabularies identical.

Known limits: a delegate's card shows no stage (its facts are in its own
Worker's log — the boundary `last_tool` already has), and a second pass says
nothing about which lap.

### What the critique agent found on the deployed build of 27

Verdict FAIL. Nine defects; the walk also confirmed the doors land on the right
view AND the right agent, the tile empty states are all words, and no green
summary exists anywhere on the page.

**The one that matters: 27 fixed the critic's contradiction in exactly one
place.** The Agents view card no longer offers `Give critic a task`. The
Dashboard — the DEFAULT view — still does, one click away, and the walker
pressed it and watched the turn fail. Worse, the launcher's example tasks read
"critic has a folder in Linux, so all three of these work" over three tasks
that write a file and run `uname -a`, for an agent whose only tools are
`read_file`, `list_files`, `find_files`. The same is live for `ask` and
`scout`. The branch keys on WHETHER THE AGENT HAS A SPACE, not on whether it
has anything that can act — and the Commands view already gets it right for
the same agent ("critic has no shell — it can read this Linux but not change
it"), so the correct fact is on the page twice, contradicting itself.

That is the lesson of 27 restated: `ROLE_CRITIC` was the wrong axis. The
question is not what an agent is CALLED, it is what its tools let it DO.
`researcher` and `scout` carry the identical contradiction on the Agents view
for the same reason — both say "Not for you" or "It never carries the plan
out" beside a task button.

Also found: at 1440 the "reflowing" board collapses to ONE 430px column beside
1313px of empty space, so the widest viewport gets the narrowest board (768
gets two columns, 1100 gets two, 1440 gets one) — the DECKCELLS assertion added
in 27 does not catch it, because the probe's deck is wide and the shipped one
is squeezed into `.dash-side`. The failure banner clips its own recovery
sentence at 390 (48px shown of 179px) with no cue that there is more. The agent
strip ends flush after five of eight chips at 390 while a tile on the same
screen says "8 agents". The header's endpoint pill renders as "calls ge".

---

## 29 — what an agent can DO, asked once

The critique agent's worst finding was that 27 fixed the critic's
contradiction in exactly ONE place. The Agents view stopped offering `Give
critic a task`; the Dashboard, which is the default view, still did — one
click away through the agent strip — and the walker pressed it and watched
the turn fail. The launcher's examples read "critic has a folder in Linux, so
all three of these work" over three tasks that write a file and run `uname
-a`, for an agent whose tools are `read_file, list_files, find_files`.

Two wrong axes, same shape. `examples.rs` branched on WHETHER THE AGENT HAS A
SPACE — a folder is not permission to write in it. `agentcard::doors` branched
on `ROLE_CRITIC` — which is what an agent is CALLED. Neither asks the only
question that matters: what do its tools let it do.

`origin::can(spec, peers)` returns `run` / `change` / `read`, derived from
`agent::toolbox_for` — the same resolved list the card prints and dispatch
checks calls against. Four callers now share it, and the card carries the
answer as `data-can` because `crates/ui` may depend on neither `agent` nor
`core`.

The subtle arm: **any peer-agent tool counts as `change`.** A delegation call
is another agent's whole turn, so an agent that can only read but can call
`builder` is not read-only. A name-based branch cannot see that.

`ask`, `critic`, `scout` and `summarizer` now get no task field and no Start
at all — the sentence naming who hands them work, and a door to chat. The
`What happens when you press Start agent` disclosure is not rendered when
there is no Start, and no longer claims the agent "can run commands in its own
folder", which was false for `author`. `recover.rs` says `Start the task
again` under a failed task and keeps `Send the message again` in chat. The
Commands pane no longer promises a first shell command to an agent that has
no shell.

### Where the expert agent corrected the brief

I told it `researcher` carried the same contradiction. It does not:
`researcher` is `tools: []`, which resolves to every built-in PLUS the
workspace set including `exec` — the most capable agent in the tree after
`main`. Its "Not for you" is a claim about AUDIENCE, not capability, and I had
conflated the two; an audience axis would have been the third name-shaped
hardcode this increment deletes. The defect was upstream, in
`public/agents/researcher/agent.md`, and is fixed there: the description now
says another agent usually hands it a question AND that you can give it a task
directly, keeping the true half — it works only from what it is handed.

`what_the_tools_do_decides_the_door_not_the_name_and_not_the_role` stands up
two agents both named `critic`: one with `tools: []` keeps both doors, one
with two read tools and no role at all loses one. Between them they rule out
the name, the role and the folder, leaving only the toolbox.

## 30 — the widest screen gets the widest board

At 1440 the board collapsed to ONE 430px column beside 1313px of nothing: 390
gave 1, 768 gave 2, 1100 gave 2, 1440 gave 1. The cause was the two-track
`.dash-grid` at `@container stage (min-width: 66rem)` — a companion track is by
construction narrower than the row it was cut from, so the count MUST fall when
that rule fires. The stage tops out near 1264px, so a 608px reading column plus
a gutter leaves ~560px of board and two 18rem tracks need 588: **there is no
width at which the split pays for itself.** The deck takes the row; the
launcher caps itself at `--column`; the surplus goes to the margins (VIEWS.md
§4). Measured after: 390:1, 768:2, 1100:2, 1440:3, 1920:3.

**Why the gate could not see it.** The fixture gave the Dashboard a rail.
`views.rs::rail()` is Workspace alone, so the shipped Dashboard renders neither
the rail nor its switch — the probe rendered both, and every dash measurement
was taken in a 762px stage against a shipped 1136. The container query never
fired in the fixture at all. A fixture narrower than the page cannot see a rule
that only fires when it is wide.

The banner's clip was `.problem-line { max-height: 3rem }` — a cap on a CHILD,
inside a box that already had one, so the parent measured fine. Deleted; the
banner's own cap now applies only below 30rem of width and above 30rem of
height, which is arithmetic and not taste: at 320 the longest remedy is 401px
and the CHROME floor leaves it 270. At 768 and up the whole remedy is on
screen. `.agent-tabs` gets the mask `.status-strip` has carried since 24.

### Three assertions, and the proof they bite

The three CSS fixes were reverted and the gate re-run: 30 FAIL CLIPPED, 18 FAIL
DECKMONO, 16 FAIL SWIPECUE — and **0 FAIL DECKCELLS**, the assertion added in
27, green over all of it. That is the gap: DECKCELLS asks at ONE width, and
this defect is a comparison BETWEEN widths. DECKMONO drives the container
through seven steps directly, reading inside the routed region only — a
`display: none` grid answers `gridTemplateColumns` with the unresolved
`repeat(auto-fit, …)` it was given, four tokens, a monotone PASS over a board
nobody was shown.

`scripts/deck-probe.js` is a fifth probe script, and `check-layout.sh` copies
it: `layout-probe.js` had reached 306 lines carrying all four deck assertions.
It is 205 now — five over I12, recorded rather than shaved further, and
`scripts/` has never been in `check-size.py`'s scope.

One thing this gate cannot assert: `chrome-headless-shell` uses overlay
scrollbars whatever `scrollbar-color` says, so "the cut is VISIBLE" is not
measurable here. CLIPPED asserts the narrower thing it can see — no child of
the banner may cap itself, and the banner may hide prose only in the one band
the CHROME floor forces.

---

## 31 — the loop you can see, and can find

`passes.rs` has walked the `stages:` list more than once per turn since 22,
with a MECHANICAL continue condition — a pass that mutated nothing and ran
nothing does not earn another — precisely because asking a local 12B "are you
done?" answers "not yet" forever. Its own comment says `PASS_SPENT` exists so
the passes are visible, "a loop nobody can see is a token meter running behind
a spinner". The live row never showed it, and of eight shipped agents exactly
one declares `passes:` at all.

The row now reads `stage 2 of 3: work · pass 2 of up to 4`, and the roster
defines the second number beside the first: "A stage is one step of a lap, and
a pass is another lap of the same steps — an agent takes one only if its file
allows another and the last lap changed something." `loop_line` was
byte-identical for `builder` and `main` (both declare the same three stages),
so the one agent that laps was indistinguishable from the one that does not; it
now says `Runs in stages, up to 4 laps a turn`.

**`up to`, and pass 1 says nothing.** Two corrections the expert agent made to
this brief, both right. `passes:` is a ceiling the mechanical condition can
undercut, so a flat `pass 2 of 4` would read as a promise the engine never
made — `the_row_names_the_budget_as_a_ceiling_and_not_a_plan`. And I asked for
`pass 1 of 4`; there is no such fact, because `PASS_SPENT` is emitted when the
SECOND lap opens, so printing it would mean reading the declared budget, which
28's rule forbids.

Also corrected: "nothing shows it" was too strong. The conversation has printed
a pass notice since 22 and a passes-exhausted ending already reaches the board.
What was missing was the live row mid-turn, and the catalogue.

**`cargo fmt` is a trap in this tree.** The agent ran it, 152 files
reformatted, and restored every one from HEAD by hand before reporting it
against its own interest. Verified: the working tree was exactly its three
files plus one test. The tree is not rustfmt-clean and the gate set does not
check it — until someone reformats deliberately, do not run it here.

### What the second critique walk found on ec86ff3

All seven claimed fixes VERIFIED on the deployed page, with measurements: the
four read-only agents show no task field and no Start; the board is 3 columns
at 1440, 2 at 1100, 2 at 768, 1 at 390; the banner's `scrollHeight ==
clientHeight` at every width; `.agent-tabs` carries the mask at 390; the
Commands pane no longer offers a command to an agent with no shell; the retry
says `Start the task again` under a task and `Send the message again` in chat.
A real `uname -a` returned `Linux 4.15.0-54-cheerpx i386`, so the VM works.

Ten new defects, and the top four are ONE defect: **the capability predicate
from 29 has not reached the chrome.**

- The header pill reads `critic's folder · Linux ready` with a green dot, for
  an agent the launcher two inches below says "cannot run anything". The
  legend on the same page defines green as "booted and free to take the next
  command". Three surfaces, two answers.
- The Commands pane tells `summarizer` — which has no space AND no tools —
  that it "can read this Linux but not change it". It cannot read it by any
  route. `author`, with more capability, gets the correct sentence, so the
  wrong branch is picked for the agent with less.
- `author`'s launcher says it "answers rather than builds" over three examples,
  none of which asks it to write an agent — which is its only job, and
  `write_agent` is in its tool list. The honest-examples pass of 29 demoted a
  builder to a talker.
- The board's eight cards are identical in shape, so nothing distinguishes the
  four agents you can task from the four you cannot until you select one.

The rest: `main`, `builder` and `researcher` ship byte-identical example
prompts, teaching a reader that three different agents are the same agent;
`web_search` is advertised on researcher's card while Settings holds a blank
search endpoint whose own help text says blank means it cannot search; a
first-time reader is steered into a failure with no forewarning, and the
excellent explanation of what to do arrives 100% of the way down the funnel;
the chip-strip fade never turns off, so it says "keep going" where going is
impossible; an unknown hash silently rewrites to the Dashboard.

---

## 32 — the predicate reaches the chrome

Each of 27, 29 and 31 fixed a contradiction where I was looking and left it
standing where I was not. The second critique walk found four more sites of
the SAME defect, so this increment is not a new idea: it is `origin::can`
asked at every remaining surface.

- The board card now says whether there is a task to give — `you can give it a
  task, and it runs commands` / `you can give it a task; it runs no commands` /
  `no task to give it — every tool it has reads`. The board is where a reader
  compares eight agents, and it was eight identical shapes.
- `builder` alone carries `it works one task over up to 4 passes`. `stages:`
  distinguishes nothing (main and scout declare the same list); `passes:` is
  the fact that separates them.
- The Commands pane says `summarizer has no tools at all — no shell, and
  nothing that reads this Linux either`. It had been told it "can read this
  Linux but not change it", which was a sentence about an empty set — and
  `author`, with MORE capability, got the correct one. The empty toolbox is the
  bottom of the same axis, asked at each site.
- `author`'s examples lead with writing an agent, which is its only job.
  29's honest-examples pass had demoted it to a talker.
- The three agents that shipped byte-identical examples no longer do: the sets
  follow from the resolved toolbox and the lap count, never from a name.

**The fifth site, and a test that caught my wording.** `agentcard.rs` was still
telling `summarizer` "every tool it has reads". I wrote the replacement as "its
file names none at all" and `critic27` failed: its fixture agent NAMES
`read_file` while this build installs none, so the toolbox is empty and the
file is not. The sentence is about what an agent can USE — "nothing to read
with either — no tool it can use here" — which is true in both cases. That
test was written to pin a different claim two increments ago and caught a false
one today.

The expert agent could not put its fold in `origin.rs`: every function there
has a caller in a file it did not own, so nothing could move out to make room.
It moved `last_tool` into `stage.rs` instead, where the module doc already
claims to be the home of the board's folds.

## 33 — before the first failure

A first-time reader was steered into a failure with no forewarning: the header
states the endpoint as fact, the intro never mentioned needing a model server,
and the walker typed the page's OWN suggested example and got a failure ten
seconds later. The explanation that follows is good; it arrived at the bottom
of the funnel.

The intro now opens with the requirement: "…it has no model of its own: every
turn is sent to a model endpoint you choose, and **nothing here has called that
endpoint yet**." A sentence, not a probe — nothing on this page can know
whether a server is listening without calling it, and what IS knowable is that
it has not called. `EndpointHealth` and `last_failure` were the brief's
suggested source and they report only a failure that ALREADY happened, so
before the first turn there is nothing in them to read.

An unknown hash still lands on the Dashboard and still corrects the address
bar — and now says so once, in a `pending` banner: a wrong address is not a
lost turn. It yields to the failure banner, and that is arithmetic: at 320×780
the chrome already stands at 484px against a 260px floor, and two banners
measured 696px, leaving 84 — the gate went red. One row of news, not two.

At 1440 the Dashboard's three cards were 608 / 1136 / 608 with two ragged
edges, and the task field was 476px of a card you are meant to type a whole
task into. The cap moved off the PANEL onto what it holds: every sentence
already carries `--measure`, so no prose got wider, and the field takes the
gutter ceiling. 1136 ×3, field 984. `DASHEDGE` asserts one column has one edge.

**Three things about the fade the brief did not anticipate**, all measured by
the agent rather than assumed:

1. `@supports` alone was not enough. Chrome for Testing 145 — the gate's own
   browser — does not honour the `@property` registration, so with no animation
   supplying a value the `calc()` is invalid at computed-value time and
   `mask-image` falls back to `none`. The static mask would have been LOST, not
   kept. `var(--swipe-fade, 2rem)` is what actually holds the degradation.
2. Reduced motion keeps the static mask. The repo's REDUCEDMOTION assertion is
   that nothing animates when asked, and the first attempt failed it 30 times.
3. The gate cannot see the pixels: `--dump-dom` produces no frames, so a scroll
   timeline is never sampled. `SWIPEEND` asserts the WIRING off the CSSOM —
   each masked port drives an animation from its own scroll position whose last
   keyframe takes the fade to zero. **The interpolation itself is unverified by
   any gate and needs a walker on the hosted page.**

Both new assertions were proven to bite by restoring the old CSS in `dist/`:
`FAIL DASHEDGE` on 10 configs, `FAIL SWIPEEND` on 24.

### Open, and why

`web_search` is still advertised on researcher's card with no note that it
needs an address. The tool list is written by `origin::tool_lines` in `core`,
and the search endpoint lives in `adapters_web::settings` — `crates/ui` may
depend on neither `agent` nor `core`, so an honest qualification means
threading the setting into the projection. The agent stopped at the boundary
and reported rather than reaching across it, which is right. It is a real
defect and it is deferred with its reason.

---

## 34 — skills, and a voice that finishes the sentence

Two features the goal names. One did not exist; the other shipped in 24 and
was quietly broken in two ways.

### Skills

A skill is written instruction an agent pulls in when a job calls for it,
rather than carrying forever in a system prompt. That is context economy, and
it is why this belongs in THIS product: the window is small, `crates/context`
exists because of it, and a skill costs nothing until it is read.

Two tools, named to match the pair that already exists (`list_agents` /
`read_agent`):

- `list_skills` — every installed skill's name and description, and nothing
  else. Bodies never appear in the listing, and a test asserts it: listing is
  the cheap call the model is told to make first.
- `read_skill` — one skill's instruction into the conversation. It runs
  nothing and changes nothing; the result is text.

Shipped skills, both written off the code rather than invented: `agent-file`
(every frontmatter key and the SIX refusals `spec.rs`/`yaml.rs` actually make,
including that `tools: []` grants every built-in including `write_agent`) and
`tool-calls` (the layout rule, the escaping rules, and the four refusals
verbatim from `toolbox.rs` — including `NOTHING_RAN`, which this repo's own
notes call the #1 model failure). A test asserts each body still describes THIS
product, so a skill cannot drift into describing a different one.

Honesty, as tests: with nothing installed `list_skills` says exactly "No skills
are installed in this browser" and never an empty list (I15); a skill that is
not installed is refused BY NAME with the installed ones listed, and the turn
carries on rather than failing; a `skill.md` that cannot say what it is for is
refused at parse and costs that skill only. A load is `ToolInvoked`, so `/tools`
projects it unchanged and a reader can see which skill entered the context and
when (I8).

**Where the brief was wrong.** Skills cannot be FETCHED data yet: the agents
tree reaches the browser through `assets.rs::fetch_agents` and a `copy-dir` in
`web/index.html`, all outside the agent's file boundary. So `public/skills/**`
is real data in the repo, compiled in with `include_str!` — the precedent is
`install.rs`, which does exactly this. The manifest is honoured BY TEST:
`the_manifest_names_exactly_the_installed_skills` asserts `index.json` and the
include list name the same skills, so wiring the fetch later cannot silently
disagree. Upgrade path is three edits, named in the report.

Also refused, with an argument I accept: a `skills:` frontmatter key. `tools:`
is already an allowlist with a refusal path, an unresolved-name report and a
card that prints the resolved set; a second key would be a second allowlist to
keep in step, and would have to choose between preloading bodies (which
destroys the point) or duplicating `read_skill`.

`author` — the agent that most wants `agent-file` — could not be opted in by
the agent that built this, because `capability32.rs` pins its resolved toolset
as an exact string and that file was outside its boundary. It reported the
one-line unblock and left a comment at the exact line of the agent file. Both
halves are in this commit.

### The voice that stopped mid-sentence

The brief for this said "TTS does not exist — `grep -r speechSynthesis`
returns nothing". **Wrong, and the agent checked before building.** This
codebase calls it from Rust as `w.speech_synthesis()`; TTS shipped in 24,
`INVARIANTS.md` names it as one of I5's two written exceptions, and the string
is in the deployed wasm. It checked the SHIPPED code against the brief's
requirements instead of writing a duplicate, and found two real defects:

1. **`has_voice` tested for the object, not the capability.**
   `speechSynthesis` exists on a bare Linux with no speech-dispatcher and on
   Android WebViews with the engine stripped — `speak()` there returns
   silently, so the control promised speech and delivered none. It now counts
   `getVoices()` and follows `voiceschanged`, which matters because Chrome
   fills that list AFTER load: a one-shot check at mount would have hidden a
   control that works.
2. **A long answer stopped part-way.** Chrome cuts a single utterance off after
   ~15s, mid-sentence, with no error. The browser now gets a queue of ≤180-char
   pieces broken at sentence ends, with six tests on the chunking — no word
   dropped or repeated, breaks at sentence ends, a word longer than the budget
   survives whole.

`voice.rs` went 200 → 172 by moving the machinery to `speaker.rs`. No new
dependency and no new web-sys feature, so `Cargo.toml` — unowned — stayed shut.

**What no gate here can prove:** that sound comes out. A headless browser
cannot verify audio. A person with speakers still has to confirm that a
1500-character answer reads to the end, that pauses land at sentence ends, and
that `Stop reading` silences immediately. The zero-voice path needs a machine
with no TTS engine to observe, which could not be produced here.

### The inventory that prompted this

Checked against the goal rather than assumed: the multiagent loop, the critique
agent, websearch, spaces, artifacts, agent-spawning, the loop/phase UI and STT
all already ship. Skills did not exist at all. transformers.js remains
UNBUILT and is not a decision to make unattended: it means loading model
weights from a CDN, which is a network-allowlist call, and CLAUDE.md §17 says
those always stop for the owner. The browser's own speech APIs cover the STT
and TTS the goal asks for at zero network cost, so what transformers.js would
actually add is a local LANGUAGE model — a much larger piece.
