# BARRAISER.md — where this stands against the field

Written 2026-08-12 against `main` @ `0bc51e7`. Every competitor claim below comes from a page
I opened; the URL is on the line. Every repo claim comes from a file I read; the path is on
the line.

**The one-sentence verdict:** this repo has the single best *substrate* in the category
(real x86 Linux, real capability gating, a log-projected UI) wired to the single weakest
*agent* in the category — `MAX_TOOL_ROUNDS: u8 = 4` (`crates/agent/src/step.rs:20`) means it
physically cannot do the thing the product intent promises, which is watching an agent work
autonomously.

---

## §1 Verdict, one paragraph per competitor

**Hermes Agent (Nous Research)** — https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard
Hermes ships fifteen dashboard pages that each do a job: Status auto-refreshes the 20 most
recent sessions with "model, message count, token usage, and a preview" every 5 seconds;
Analytics renders "daily token stacked bar charts" and per-model cost; Sessions has FTS5
full-text search across every past run with tool-call inspection and JSON export; Logs does
"live tailing that polls for new log lines every 5 seconds." We have none of those four. We
beat Hermes on exactly one axis — Hermes needs a Python daemon on your machine and we are a
static page — and lose on every axis that involves *history, cost, or search*. Hermes also
refused to build a second chat client and piped its real TUI through xterm.js, which is a
sharper answer than our bespoke `ChatPane`. Standing: we are a better-architected v0.2 of
their v0.16.

**bolt.diy** — https://github.com/stackblitz-labs/bolt.diy
It ships the whole loop we do not: file tree, code editor, "diff view to see changes made by
the AI", "revert code to earlier versions", a live preview pane, "attach images to prompts",
and one-click "deploy directly to Netlify, Vercel, or GitHub Pages" plus ZIP download and git
clone/import. Nineteen model providers. We have `exec`, `read_file`, `write_file`, `list`
(`crates/agent/src/workspace.rs`) and a terminal pane, and no way to *see* a project or ship
one. Against bolt.diy we lose the comparison on first screen, and we lose it badly. The one
thing we hold: their runtime cannot run Python (below).

**OpenClaw / Clawdbot / Moltbot** — https://en.wikipedia.org/wiki/OpenClaw
"Uses messaging platforms as its main user interface" — Signal, Telegram, Discord, WhatsApp —
with skills as `SKILL.md` directories, local storage of history, and a heartbeat scheduler
that wakes it unprompted. It is not our competitor on UI at all; it is our competitor on
*presence*. It is with the user all day; we exist only while a tab is open. Its own maintainer
says "if you can't understand how to run a command line, this is far too dangerous of a
project for you to use safely" — that sentence is our entire market. We beat it on safety by
construction (I6 default-deny, `crates/core/src/workspace.rs` grant gate) and on install cost
(a URL vs a Mac Mini). We lose on the only metric its users care about: it does things while
you are asleep.

**StackBlitz WebContainers** — https://webcontainers.io/ and /guides/troubleshooting
The bar for browser execution, and the one place we are genuinely ahead. WebContainers "can
only execute languages that are natively supported on the Web, including JavaScript and
WebAssembly", native addons are disabled with `--no-addons`, and Python is out. Our CheerpX
Alpine (`crates/adapters_web/src/cheerpx.rs`) is a real x86 kernel with a real ext2 root, so
`apk add python3 gcc` works and a native binary runs. That is a categorical advantage over
the market leader in browser sandboxes — and **nothing in the product surfaces it**. Their
"native `npm` up to 10x faster than local" claim is the counterweight: they are faster at the
one thing most users want.

**Claude.ai artifacts** — https://code.claude.com/docs/en/artifacts
The bar for "the agent made me a thing." An artifact is a live page at a private URL that
"updates in place as the session continues", every publish is a version, the Share control
picks which version viewers see, and pages can call MCP connectors at view time so the board
is live rather than a snapshot. Constraints are honest and published (one page, no backend,
16 MiB, strict CSP). We have no artifact concept whatsoever — output is transcript text and
files inside a VM nobody can see. Against artifacts we do not lose the comparison, we are
absent from it.

**LangGraph Studio** — https://docs.langchain.com/oss/python/langgraph/use-time-travel
`get_state_history()` lists every checkpoint of a run; replaying from one re-executes ("LLM
calls, API requests, and interrupts fire again"); `update_state()` on an old checkpoint forks
a branch that "coexists with the original" with history intact. We have the rarest half of
this already and do not know it: I8 makes every view a projection of an append-only log, so
checkpoint identity is free. We ship zero of the user-visible half — no history list, no
replay, no fork. This is the cheapest high-value gap in the document.

**Devika** — https://github.com/stitionai/devika/blob/main/ARCHITECTURE.md
Mostly dormant, but its agent-state contract is the right one and it is quoted verbatim:
state includes "Current step or action being executed, Internal monologue reflecting the
agent's current 'thoughts', Browser interactions (URL visited, screenshot), Terminal
interactions (command executed, output), Token usage so far". Our `AgentRow`
(`crates/agent/src/supervisor.rs`) carries name/status/turns/since/detail. Devika's list has
three fields ours lacks: monologue, screenshot, token usage. A 2024-vintage abandoned project
specifies a richer "watch the agent work" view than we implement in 2026.

**Open SWE** — https://www.langchain.com/blog/introducing-open-swe-an-open-source-asynchronous-coding-agent
The bar for human-in-the-loop, and it is two specific behaviours. One: the agent interrupts
after analysis and you "accept, edit, delete, or request changes to the plan." Two:
double-texting — "simply send it a message, and it'll smoothly integrate that into its active
session." Ours is worse than absent: the composer *locks* during a turn (increment 07b, the
global-composer-lock finding). Their runs are also parallel and cloud-side: "assign it a list
of tasks in the morning and come back to a set of PRs in the afternoon." We have per-agent
Workers, which is the hard part, aimed at a 4-round ceiling.

---

## §2 The gap table

| Capability | Who does it best | What they do, exactly | What we have | Sev |
|---|---|---|---|---|
| Long autonomous run | Open SWE | Runs for hours in a Daytona sandbox, opens a PR at the end | 15C: `max_rounds:` per agent, default 64 (`state.rs:109`). PARTLY closed — three other things still bound a run: a 30 s per-call abort (`adapters_web/src/model.rs:15`), a 4096-token Work budget (`phase.rs:127`) and compaction that only runs at the TOP of a turn (`step.rs:50`) | **P1** |
| Watch work happen live | Devika / Mission Control | Step, monologue, terminal output, screenshot, tokens-so-far, streamed | Still no streaming, no SSE. WORSE than before in one place: the pane now abandons a run after 36 s of transcript silence (`turn.rs:164`) and the transcript ignores `ToolInvoked` (`transcript.rs:151`), so one slow tool freezes the pane | **P0** |
| Mid-run steering | Open SWE | Double-texting into a live session; plan interrupt with accept/edit/delete | 15D: composer unlocked, steer arm at `step.rs:35`. HALF closed — a steer that arrives while the model call is out is swallowed when that reply is the final answer (`step.rs:148`), with no feedback | **P0** |
| Cost / token accounting | Hermes Analytics | Daily stacked token chart, cache-hit rate, per-model cost | 15E: `x-tokens` on the chat projection + `dash::TokenMeter`. Counts the PAGE's log only — every sub-agent Worker keeps its own database (`worker.rs:21`), so delegated spend is invisible while its answers are not. No cost, no history, no breakdown | **P2** |
| Dashboard as landing surface | Mission Control | Launcher cards each carrying a live number ("2 running · 6 queued") | 15B: `View::Dashboard` is the landing view (`views.rs`, `stage.rs`). It is the four old rail panels in an `auto-fit` grid — no card carries a number, nothing is a launcher | **P1** |
| Artifacts | Claude.ai | Live page at a URL, versioned, updates in place, shareable | None | **P1** |
| Code editor + file tree + diff | bolt.diy | Editor, tree, AI diff view, revert to earlier version, file locking | Terminal pane only | **P1** |
| Preview / dev server | bolt.diy + WebContainers | Live preview pane on a container port | None. CheerpX has no port forwarding wired | **P1** |
| Session history + search | Hermes Sessions | FTS5 full-text across all sessions, expand, inspect tool calls, export JSON | Per-agent log in IDB; no browse, no search, no export UI | **P1** |
| Time travel / fork | LangGraph | Checkpoint list, replay, `update_state` fork with history intact | The log exists (I8); no history list, replay, or fork | **P1** |
| Native runtime breadth | **us** | WebContainers is JS/Wasm only, `--no-addons` | Real x86 Alpine, `apk add` anything | — (our win, unsold) |
| Deploy / export the work | bolt.diy | Netlify, Vercel, GH Pages, ZIP, git push | None | **P1** |
| Web access for the agent | all of them | fetch, search, browser automation | Zero network tools. Toolbox is `now`, `list_agents`, `read_agent`, `write_agent` (`tools.rs:107`) | **P1** |
| Runs while you are away | OpenClaw | Heartbeat scheduler, messaging channels | Tab-lifetime only | **P2** (see §5) |
| Agent creation flow | Hermes Profile Builder | Guided identity → model → skills → MCP | In-browser `agent.md` authoring (increment 11) — genuinely competitive | — |
| Module/plugin extension | Hermes | UI plugins with `manifest.json` + JS bundle; backend FastAPI routers | Tier-1 returns `501` (`dispatch.rs:182`); `KvHandle` is `todo!()` (`dispatch.rs:47,53`) | **P2** |

---

## §3 The ranked backlog (re-ranked 2026-08-12 after 15A–15E; see §6)

**1. Finish steering: no message a person types may be swallowed.**
(a) Done when: a sentence typed at ANY point in a run — between tool calls, while the model
call is out, or in the drain after the final answer — is answered in that conversation
without the person re-sending it, and the transcript never shows an answer to the previous
question directly under it.
(b) Bar: Open SWE's double-texting — "simply send it a message, and it'll smoothly integrate
that into its active session."
(c) `crates/agent/src/step.rs` (the steer arm at :35 must record that a steer is unanswered;
`on_reply`'s terminal arm at :148 must consume it and call the model again instead of
clearing `task`), `crates/core/src/transcript.rs`, `crates/agent/tests/rounds.rs` — whose
steering test today only exercises the mid-tool-batch path and is green over the broken one.
(d) Rank 1 because 15D shipped the half a user notices last (the unlocked field) and left the
half they notice first (an answer). A dropped sentence with no feedback is worse than a
locked composer, which at least told the truth.

**2. Make a working run legible: stream it, and stop abandoning it.**
(a) Done when: a single tool that runs for two minutes keeps the transcript changing while it
runs, the pane never prints the stall note over a working agent, and tokens appear as they
are produced.
(b) Bar: Hermes' Logs page live-tailing every 5 s — and beat it, since we can do SSE properly.
(c) `crates/core/src/transcript.rs:151` (the `ToolInvoked` arm renders nothing, which is what
makes 15D's silence detector wrong), `crates/ui/src/turn.rs:164`,
`crates/adapters_web/src/model.rs:15` (a 30 s abort on the whole completion), ADR-002 — named
transport-streaming, still unimplemented.
(d) Rank 2: 15C bought sixty-four rounds and 15D then taught the pane to give up on them.

**3. Make the 64 real: compact mid-turn, and stop degrading the document silently.**
(a) Done when: a thirty-round run finishes with the round-30 request still carrying the
original task and the previous round's observation — proven by a host test that drives thirty
rounds and asserts on the last `CallModel` document.
(b) Bar: Open SWE's hours-long Daytona runs; any agent that survives its own context.
(c) `crates/agent/src/step.rs:50` and `crates/agent/src/window.rs` (compaction fires only at
the top of a TURN, so a 64-round turn never compacts), `crates/agent/src/phase.rs:127` (4096
tokens), `crates/context/src/assemble.rs` (budget degradation drops the history the loop is
accumulating and says so only in a hint nobody renders).
(d) Rank 3: the ceiling is a counter, and a counter is not the thing that was stopping runs.

**4. Account for every token, including the ones spent in Workers.**
(a) Done when: the meter's number equals the sum of every model call the page caused,
delegations included, and clicking it breaks the number down by agent and by context Section.
(b) Bar: Hermes' context-usage meter with per-category breakdown; Mission Control's
"136K tokens · $0.79 spent."
(c) `crates/adapters_web/src/worker.rs` (a Worker must report its spend back across the
`postMessage` boundary — its log is its own by design, ADR-008), `crates/core/src/batch.rs`
(`run_on` already appends the sub-agent's answer; the cost belongs beside it),
`crates/core/src/transcript.rs:107`, `crates/context/src/assemble.rs`.
(d) Rank 4: 15E built the mechanism correctly and pointed it at one agent. Finishing it is
small; leaving it means the meter is confidently wrong exactly when delegation is used.

**5. Cards that carry numbers: the Dashboard as a launcher, not a grid of panels.**
(a) Done when: the landing view's cards each carry a live number — runs in flight, workspace
state, tokens today, agents idle — and clicking a card navigates to the view that owns it.
(b) Bar: Mission Control's launcher cards ("Task Board — 2 running · 6 queued").
(c) `crates/ui/src/stage.rs:44` (today `dash-grid` is the four old rail panels), a
`GET /dashboard` projection in `crates/core/src/builtins.rs`, `VIEWS.md`.
(d) Rank 5: 15B won the routing argument and shipped the slot. The slot is still furniture.

**6. Sell the substrate: a workspace view with a file tree, an editor, and a diff.**
(a) Done when: a user can see the files an agent created, open one, edit it, and see what the
agent changed since last look — without typing `cat`.
(b) Bar: bolt.diy's tree + editor + "diff view to see changes made by the AI".
(c) `crates/adapters_web/src/cheerpx.rs` (needs a real `list`/`read` path, not `sh -c`
scraping), a new `crates/core/src/files.rs`, `crates/ui/`.
(d) Rank 6: we already run a real Linux and the user cannot see one byte of it. This converts
our only categorical advantage into something visible.

**7. Network tools: `fetch_url` and `web_search`.**
(a) Done when: an agent answers a question about a page it was given the URL to.
(b) Bar: every competitor in §1 has this; Devika treats browsing as a core component.
(c) `crates/agent/src/tools.rs`, `crates/core/src/tools.rs`, `crates/kernel/src/capability.rs`
(a `Net` capability, default-deny per I6), `crates/adapters_web/`.
(d) Rank 7: an agent with no web access is a toy, but it ranks below the run loop because a
4-round agent with web access is still a toy.

**8. Run history: list, search, replay, fork.**
(a) Done when: past runs are listed with their result, searchable by text, and any one can be
re-opened at any step and continued down a different branch.
(b) Bar: Hermes Sessions (FTS5 search, tool-call inspection, export) plus LangGraph's
`update_state` fork "the original execution history remains intact."
(c) `crates/core/src/logbook.rs`, `crates/core/src/scrollback.rs`, `crates/ui/` Trace view.
(d) Rank 8: the log already exists, so this is projection work, not architecture — but it is
worthless until there are long runs (1) to look back at.

**9. Artifacts.**
(a) Done when: an agent producing a document, chart, or page renders it beside the chat with
a version history, not as a code fence.
(b) Bar: Claude.ai artifacts — versioned, updates in place, one self-contained page.
(c) New module in `crates/core/`, `crates/module/src/manifest.rs` slots, `crates/ui/`.
(d) Rank 9: this is the owner's "office-type artifact creation" and it is real product
differentiation — but it needs the editor (6) and the run loop (1) underneath it first.

**10. Export the work.**
(a) Done when: one button produces a ZIP of the workspace, and one produces a git push.
(b) Bar: bolt.diy's ZIP download + Netlify/Vercel/GH Pages deploy.
(c) `crates/adapters_web/src/cheerpx.rs`, `crates/ui/`.
(d) Rank 10: cheap, and without it every hour of agent work is trapped in an IndexedDB
overlay that a browser can evict.

---

## §4 Five ideas the owner has not had yet

**1. Ship the environment as the product: a shareable, forkable workspace image URL.**
The disk is already a streamed read-only base under an IDB overlay (`cheerpx.rs`), which
means a workspace is a base image plus a diff — the exact shape of a fork. Publish the diff
and a URL boots someone else's exact environment, packages installed, files present, agent
attached. Nobody in §1 can do this: bolt.diy forks a repo, we would fork a *machine*, and
"the environment is already packaged" stops being a tagline and becomes a link you send.

**2. The receipt: every run emits a signed, self-contained HTML page of what it did.**
I8 already guarantees every state is a projection of an append-only log, so a run has a
complete, ordered, tamper-evident record for free — no other product in §1 has that
guarantee, they have log files. Render it as one page: prompt, plan, every tool call with
arguments and output, files touched, tokens, cost. That is Claude's artifact idea pointed at
the thing agents are actually least trusted about, which is what they did while you were not
looking.

**3. Capability receipts at the moment of grant, not in a settings tree.**
I6 makes ungranted capabilities *absent* rather than refused, and `workspace.rs:24` already
returns a refusal that names the fix in English. Turn that into the flow: when an agent tries
something it was not granted, the UI shows a one-line "this agent asked to reach
`api.github.com` — grant once / grant always / deny" and the grant is recorded as an event.
OpenClaw's entire security crisis (Cisco found "third-party skills performing data
exfiltration without user awareness") is the absence of this, and we are the only entrant
whose architecture makes it a UI problem rather than a rewrite.

**4. Diff-the-agent: version agents like code, because they are.**
An agent is an `agent.md` (`crates/agent/src/spec.rs`) and agents are already authored in the
browser with attribution recorded (`Ctx.authored`). Add a history to that file: what changed,
who or which agent changed it, and a one-click A/B where the same prompt runs against two
versions side by side. Hermes' Profile Builder creates agents and then abandons them; nobody
in the field treats a prompt change as a diff with a measurable outcome, and for a product
whose creation story is "write the essentials only" the second question is always "did my
edit make it better."

**5. Background continuation without a daemon: a run that survives the tab.**
OpenClaw's real advantage is the heartbeat, and the assumption that a browser cannot have one
is stale — a Service Worker plus Web Locks leader election plus catch-up-on-open gets most of
it, and the honest version is "your run continued for as long as a tab was alive, and here is
exactly where it stopped and what it will do when you return." That reframes our worst
structural weakness into a *legibility* feature nobody else offers: OpenClaw users cannot tell
you what their agent did at 3am either, they just do not get told it stopped.

---

## §5 What to cut or refuse

**Refuse: messaging channels, webhooks, pairing, cron, gateway.** Nine of Hermes' fifteen
dashboard pages exist because it is a daemon with twenty chat platforms bolted on. We are a
static page (I1). `VIEWS.md:101` already refuses these; hold that line even when idea §4.5
makes background runs feel close to a daemon. If the answer becomes "we need a server," the
product has changed and that is a gate, not a feature.

**Cut: `KvHandle` (`dispatch.rs:38-55`).** Two `todo!()`s, no caller, no module granted `Kv`,
and the comment says the design "lands with the first one." That is a speculative interface
with zero implementations — the exact thing `docs/PROMPT.md` §13 forbids. Delete it and
write it when a module needs it.

**Cut or ship: `Logic::Script` / the forge.** `dispatch.rs:182` returns 501, `crates/script/`
is two files, and `crates/agent/src/forge.rs` defines nine pipeline stages nothing executes.
Nine competitor products in §1 and not one of them makes "the agent writes its own modules"
the wedge; users want the agent to do their work, not extend the harness. Either commit to
it as *the* differentiator or delete `crates/script` and the `Script` arm and reclaim the
sentence in every doc that promises it.

**Cut the Memory view as a top-level slot.** `VIEWS.md:76` calls it "a deliberate bet against
the category (3 of 9)" and it is the wrong bet at this stage: the field's evidence is
consistent, and the slot is worth more to the Dashboard (backlog 5) or a Workspace view
(backlog 6). Fold it into Settings as `VIEWS.md:169` already pre-authorises.

**Refuse: more design-system work before backlog 1–4 ship.** The last five commits and ~44k
of `DESIGN.md` are about glass, blur radii and fold assertions, measured to a p95 of 7.24 ms
against a 16.7 ms budget. The material is *done*. Nobody in §1 will lose a user to us because
of a backdrop filter, and every hour spent there is an hour the agent still stops after four
tool calls.

**Refuse: evals, multi-user, marketplace, RBAC.** Team and production features for a
single-operator browser tool with no accounts. Already refused in `VIEWS.md:102`; noted here
so it stays refused when the competitor set makes them look standard.

---

## §6 Audit log

### 2026-08-12 — 15A…15E, read against the code and not the commit messages

`cargo test --workspace`: 159 pass, 0 fail. `scripts/check-layering.py` OK,
`scripts/check-selectors.py` OK. **`scripts/check-layout.sh` FAILS: 36 assertions.**

**Closed.** 15C really did remove the four-round wall (`state.rs:109`, `spec.rs`,
`tests/rounds.rs` drives seven rounds and stops dead on the seventh). 15B really did wire the
six-view nav and the Dashboard landing (`views.rs`, `stage.rs`); `#design-system` at boot
survives. 15E's provider-usage read is honest — a missing block is `None`, never a zero
(`openai.rs`), and `tests/meter.rs` asserts the header accumulates.

**Open, in severity order.**

1. **A steer is silently dropped whenever the reply that follows it is the final answer**
   (`crates/agent/src/step.rs:35` with `:148`). The steer arm appends and emits nothing; the
   terminal arm of `on_reply` clears `task` and emits nothing. Between them, a sentence typed
   while a model call is out is never asked. The log order is question → steer → answer, so
   the transcript shows the person's steer with the answer to the PREVIOUS question directly
   beneath it, the composer un-busies, and nothing says the sentence was ignored. This is the
   most common timing there is, not a rare race.
2. **The stall detector abandons working runs.** `transcript.rs:151` renders nothing for
   `ToolInvoked` — by design, and correctly — so a tool that runs longer than 36 s produces no
   projection change, and `turn.rs:164` prints "Nothing has changed… check Settings" and
   RETURNS, which stops the poll: the transcript, the tool trace and the token meter all
   freeze for the rest of the run. The one workload the CheerpX substrate exists for
   (`apk add`, a build) is precisely the one that trips it. 15D's commit message asserts
   "every tool result… changes the projection"; the projection says otherwise.
3. **15C's ceiling is nominal.** Nothing else counts rounds (`retries`/`replans` are dead
   fields; `drive` is unbounded; `batch` has no cap), but three things still end a long run:
   a 30 s abort on every completion (`adapters_web/src/model.rs:15`), a 4096-token Work budget
   (`phase.rs:127`) enforced by silent degradation in `assemble.rs`, and compaction that fires
   only from the `UserMessage` arm (`step.rs:50`) and therefore never inside a 64-round turn.
4. **The meter counts one agent.** `transcript.rs:107` folds the PAGE's log; every sub-agent
   runs in a Worker with "its own log… a database per agent" (`worker.rs:21`), so a delegated
   turn contributes its answer to the page (`batch.rs` `run_on`) and none of its cost. The
   tooltip says "Every token this page has spent."
5. **15B's structural collateral.** The one `<h1>` moved inside `dashboard-view`
   (`stage.rs:44-50`), which is `hidden` on five of six views — the page has no heading
   anywhere else. `Terminal` is mounted in both `dashboard-view` and the Trace rail, so
   `id="workspace-command"` (`terminal.rs:25`) is duplicated and `focus(COMMAND_ID)` can land
   in a hidden region; `ToolTrace` mounts up to three times at once. The agent strip is now a
   row (`layout.css:73`) but still sends `aria_orientation: "vertical"` (`tabs.rs:67`), which
   the CSS comment beside it claims was fixed. `main.rs` unmounts the whole `Rail` on the
   collapse toggle, against the mounted-not-unmounted rule `stage.rs` opens with.
6. **The layout gate is red and measuring a page that no longer exists.**
   `scripts/layout-probe.html` still models the pre-15B shell — `deck-tab`, the agent tablist
   inside `.nav`, the masthead outside the stage — so its 36 STACKED failures are about markup
   nobody ships, and `.view-list`, `.view-panel`, `.dash-grid`, the warmth pill and the token
   meter are measured by nothing. This is the exact failure the script's own header warns
   about ("increment 13 added dash.css, the list did not know").
7. **15A prewarms unconditionally.** `cheerpx::prewarm` streams the engine and disk on every
   page load with no `crossOriginIsolated` check, no opt-out and no Save-Data path, for a
   visitor who may only want Settings; and `Warmth::Failed` is displayed permanently even
   though the next command retries (`dash.rs`).

**On test coverage.** Nothing here is green-and-vacuous in the strict sense, but two tests are
green over broken halves: `rounds.rs`'s steering test only drives the mid-tool-batch path (the
path that works), and `meter.rs` boots with `ScriptedAgents::none()`, so it cannot see the
delegation gap. `crates/ui` has zero tests, which means the user-visible half of 15A, 15B and
15D's watcher has no automated check at all except the layout gate — which is red.
