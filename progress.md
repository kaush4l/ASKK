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
