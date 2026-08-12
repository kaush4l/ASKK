# BARRAISER.md — where this stands against the field

Written 2026-08-12 against `main` @ `0bc51e7`; §2, §3 and §6 revised the same day against
`main` @ `c6e909c` (through 15L). Every competitor claim below comes from a page I opened;
the URL is on the line. Every repo claim comes from a file I read; the path is on the line.

**The one-sentence verdict, revised.** The first pass said the best substrate in the category
was wired to the weakest agent — a four-round ceiling. That ceiling is gone and so are three of
the four things behind it: the agent now runs sixty-four rounds, compacts while it runs, answers
a sentence typed into a live turn, and can be handed a task without a conversation. The verdict
is now one layer up: **the agent got good enough to expose that the page is the bottleneck.**
Every seam call clones the whole event log and appends a fact to it, and one pane spawns a fresh
immortal poller on every projection — so the longer a run works, the faster the tab dies. And a
run launched at anything but `main` executes in a Worker whose facts never reach the page, so
the product's newest feature is one you can start and cannot watch.

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

Revised 2026-08-12 (second pass) after 15F–15L. `Sev` is the severity of the GAP, not of the
work: a row can be closed and still say what it cost.

| Capability | Who does it best | What they do, exactly | What we have | Sev |
|---|---|---|---|---|
| The page survives the run it can now start | nobody has this problem | Everyone else polls a server. Hermes' dashboard refreshes every 5 s against SQLite; the browser is a client | **NEW, and the worst thing in the document.** Every `handle()` clones the WHOLE event log into `Ctx` (`dispatch.rs:163`) and appends a `RequestHandled` fact to it (`app.rs:148`, `lib.rs:174`) — so each poll makes the next poll more expensive. `SpaceInspector` spawns a NEW never-terminating poll loop on every `tick` with no guard (`space.rs:56-70`) while `tick` fires 2.5×/s all through a turn (`turn.rs:95`). On the LANDING view. A ten-minute run leaves ~1 500 concurrent pollers cloning a ~100 k-event log | **P0** |
| Long autonomous run | Open SWE | Runs for hours in a Daytona sandbox, opens a PR at the end | 15C `max_rounds` 64 (`state.rs:109`); 15H raised the per-call abort to 300 s (`model.rs:22`); 15J compacts before every round, not only at the top of a turn (`step.rs:236`) and the resume is correct — `task` survives, the summarizer's reply is routed by `state.compacting` (`step.rs:58`) and never reaches `on_reply`. One bound left: the 4096-token Work budget (`phase.rs:127`) degraded silently in `assemble.rs` | **P2** |
| Watch work happen live | Devika / Mission Control | Step, monologue, terminal output, screenshot, tokens-so-far, streamed | 15H closed the two self-inflicted halves: `data-tools` makes a tool call change the projection (`transcript.rs:216`) and the stall note is a warning that no longer returns (`turn.rs:172`). Still no streaming. NEW and worse: a run started by 15L's launcher on any agent but `main` executes in a Worker with its own log (`worker.rs:21`), and NOTHING it does reaches the page — `belongs_to` gates `ToolInvoked` on `who == me` (`transcript.rs:56`), the Files pane folds the page's `recent` (`filelist.rs:37`), the meter folds the page's `recent` (`transcript.rs:110`). You can launch it and you cannot watch it | **P0** |
| Mid-run steering | Open SWE | Double-texting into a live session; plan interrupt with accept/edit/delete | **CLOSED.** 15H: the terminal arm of `on_reply` consumes `state.steered` and calls the model again instead of clearing `task` (`step.rs:161-165`), and `rounds.rs:147` drives the racing path that was previously green over a hole | — |
| Cost / token accounting | Hermes Analytics | Daily stacked token chart, cache-hit rate, per-model cost | Unchanged, and materially worse: `spent()` still folds the PAGE's log alone (`transcript.rs:109`) and no Worker reports spend — `workers.rs` has `take_reports`/`take_memory`/`take_authored` and no fourth channel. 15L made the uncounted path the headline feature, so the meter now reads a confident `0` over the run a person just launched | **P1** |
| Dashboard as landing surface | Mission Control | Launcher cards each carrying a live number ("2 running · 6 queued") | 15L put a real launcher on it (`launch.rs`), which is the half that mattered. No card still carries a number | **P2** |
| Artifacts | Claude.ai | Live page at a URL, versioned, updates in place, shareable | None | **P1** |
| Code editor + file tree + diff | bolt.diy | Editor, tree, AI diff view, revert to earlier version, file locking | 15G shipped the tree and the read (`core/src/files.rs`, `filelist.rs`, `ui/src/files.rs`) through the agent's own `list_files`/`read_file` gate — genuinely half of it. No editor, no write, no diff, no revert | **P1** |
| Preview / dev server | bolt.diy + WebContainers | Live preview pane on a container port | None. CheerpX has no port forwarding wired | **P1** |
| Session history + search | Hermes Sessions | FTS5 full-text across all sessions, expand, inspect tool calls, export JSON | Per-agent log in IDB; no browse, no search, no export UI | **P1** |
| Time travel / fork | LangGraph | Checkpoint list, replay, `update_state` fork with history intact | The log exists (I8); no history list, replay, or fork | **P1** |
| Native runtime breadth | **us** | WebContainers is JS/Wasm only, `--no-addons` | Real x86 Alpine, `apk add` anything — and since 15G a person can finally SEE it | — (our win, half-sold) |
| Deploy / export the work | bolt.diy | Netlify, Vercel, GH Pages, ZIP, git push | None | **P1** |
| Web access for the agent | all of them | fetch, search, browser automation | Zero network tools. Toolbox is `now`, `list_agents`, `read_agent`, `write_agent` (`tools.rs:107`) | **P1** |
| Start work without conversing | Open SWE | "Assign it a list of tasks in the morning and come back to a set of PRs in the afternoon" | 15L: `TaskLauncher` on the Dashboard and Agents views (`launch.rs`) — the same `POST /chat` the composer makes, addressed with `x-agent`, returning immediately. The morning half EXISTS. The afternoon half does not: see the two P0 rows above. Also, `launch.rs:12` claims the turn runs "in that agent's own Worker", which is false for the default `main` — `runtime.rs:153` routes an unaddressed or self-addressed message to the page's own engine | **P1** |
| Runs while you are away | OpenClaw | Heartbeat scheduler, messaging channels | Tab-lifetime only | **P2** (see §5) |
| Agent creation flow | Hermes Profile Builder | Guided identity → model → skills → MCP | In-browser `agent.md` authoring (increment 11) — genuinely competitive | — |
| Module/plugin extension | Hermes | UI plugins with `manifest.json` + JS bundle; backend FastAPI routers | Tier-1 returns `501` (`dispatch.rs:182`); `KvHandle` is `todo!()` (`dispatch.rs:47,53`) | **P2** |

---

## §3 The ranked backlog (re-ranked 2026-08-12, second pass, after 15F–15L; see §6)

The shape of this list changed. The last audit ranked the run loop first because the agent could
not run. It runs now — 64 rounds, 300 s per call, compaction mid-turn, steering that is answered,
and a launcher that starts a run without a conversation. Every one of those is real in the code.
What none of them came with is a page that survives them, or a way to see a run you did not type
into. So the top of the list is no longer the agent. It is the tab, and then the projection.

**1. Survive the run you can now start.**
(a) Done when: a ten-minute launched run, watched from the Dashboard, holds a CONSTANT number of
seam calls per second from the first minute to the last, and the event log at the end contains
the turn's facts and not one entry per poll. Observable without a profiler: `app.log.len()` after
ten idle minutes on the Dashboard must be within a hundred of what it was at the start.
(b) Bar: none of the competitors has this problem, because none of them is the database. Hermes
polls a server every 5 s; we poll ourselves, and the thing we poll is the thing that grows.
(c) `crates/ui/src/space.rs:56-70` — the only poll loop in the crate with no ceiling and no
`watching` guard, when `board.rs:83` documents in prose exactly why one is needed and has one;
`crates/core/src/dispatch.rs:163` — `recent: app.log.iter().map(|e| e.kind.clone()).collect()`
clones the entire log on every request, alongside `agents`, `board`, `authored` and `window`;
`crates/core/src/lib.rs:139` + `app.rs:148` — a `RequestHandled` fact is appended and PERSISTED
for every poll, which is what makes the clone grow.
(d) Rank 1 because it is the only defect on the list that gets worse the better the product
works. Nothing else here matters if the tab dies at minute nine of a ten-minute run, and the two
changes that let a turn last that long — 15C's ceiling and 15L's launcher — are what turned a
wasteful design into a fatal one.

**2. One clock, and a Worker's facts on the page.**
(a) Done when: a task launched at a non-`main` agent shows its tool calls in the Trace view, its
files in the Workspace view and its tokens in the meter, from any view, without the person
navigating back to a view that happens to mount the board.
(b) Bar: Open SWE — "assign it a list of tasks in the morning and come back to a set of PRs in
the afternoon." We can now assign. Coming back shows nothing.
(c) `crates/ui/src/stage.rs:62,148,151` — `AgentBoard`, which its own header calls "THE PAGE'S
OBSERVER", is mounted on three views of seven and inside `Rail`, which `main.rs:173` unmounts
whenever the rail is folded — the DEFAULT below 1100 px (`dash::wide`). With it unmounted there
are no clocks left but `ChatPane`'s, which only runs for the SELECTED agent's own pending turn
(`chat.rs:137`, `turn.rs:111`), so on Workspace, Trace, Memory and Settings a launched run is
unobserved and `WebApp::handle`'s `take_reports()` drain never runs. `crates/adapters_web/
src/workers.rs:58-70` — three report channels and no channel for `ToolInvoked` or `ModelCalled`.
(d) Rank 2: 15L shipped the half of autonomy a person does once and 15G shipped the pane that
would show it, and the two do not compose. This is one clock and one `postMessage` payload.

**3. Finish the workspace into an editor.**
(a) Done when: a person can open a file the agent wrote, change it, save it, and see what the
agent changed since they last looked — without typing `cat` or `vi`.
(b) Bar: bolt.diy's tree + editor + "diff view to see changes made by the AI" + "revert code to
earlier versions". This is the comparison we lose on first screen, and 15G closed half of it.
(c) `crates/core/src/files.rs` (a `write_file` route through the same `core::workspace` gate),
`crates/core/src/filelist.rs`, `crates/ui/src/files.rs`, `crates/kernel/src/workspace.rs`.
The diff is nearly free: I8 means every prior `read_file` output is already in the log, so "what
changed since last look" is a fold, not a stored snapshot.
(d) Rank 3, and it is the answer to "which of artifacts / editor / autonomous launch / agent
creation is the highest-value NEXT piece": launch shipped in 15L, agent creation shipped in
increment 11 and §2 already calls it competitive, and artifacts need an editor and a preview
underneath them. The editor is the only one of the four whose foundation is already in the repo.

**4. Account for every token, including the ones spent in Workers.**
(a) Done when: the meter equals the sum of every model call the page caused, delegations and
launched runs included, and clicking it breaks the number down by agent.
(b) Bar: Hermes' context-usage meter with per-category breakdown; Mission Control's
"136K tokens · $0.79 spent."
(c) `crates/adapters_web/src/worker.rs`, `workers.rs` (a fourth report channel beside
`take_memory`), `crates/core/src/batch.rs` `run_on` (the cost belongs beside the answer it
already appends), `crates/core/src/transcript.rs:109`.
(d) Rank 4, unchanged in substance from the last audit and raised in severity: it was a leak on
the delegation path, and 15L made it the default path.

**5. Streaming, so a long run is legible while it runs.**
(a) Done when: a single tool that runs for two minutes keeps the transcript changing, and tokens
appear as they are produced rather than when the completion closes.
(b) Bar: Hermes' Logs page live-tailing every 5 s — and beat it, since SSE is a push.
(c) `crates/adapters_web/src/model.rs`, ADR-002 (named transport-streaming, still unimplemented),
`crates/core/src/transcript.rs`.
(d) Rank 5, down from rank 2: 15H bought the honesty (the note is a warning, the projection
changes on a tool call) that made the absence survivable. It is now a quality gap, not a bug.

**6. Network tools: `fetch_url` and `web_search`.**
(a) Done when: an agent answers a question about a page it was given the URL to.
(b) Bar: every competitor in §1; Devika treats browsing as a core component.
(c) `crates/agent/src/tools.rs`, `crates/core/src/tools.rs`, `crates/kernel/src/capability.rs`
(a `Net` capability, default-deny per I6), `crates/adapters_web/`.
(d) Rank 6: an agent with no web access is a toy — but it is now a toy that runs for an hour, and
the hour is the part that had to work first.

**7. Cards that carry numbers: the Dashboard as instruments, not a grid.**
(a) Done when: the landing view's cards each carry a live number — runs in flight, tokens today,
agents idle — and clicking one navigates to the view that owns it.
(b) Bar: Mission Control's launcher cards ("Task Board — 2 running · 6 queued").
(c) `crates/ui/src/stage.rs:60`, a `GET /dashboard` projection in `crates/core/src/builtins.rs`.
(d) Rank 7, down from 5: 15L put the one card that DOES something on it. The rest is furniture,
and furniture ranks below the two P0s and the editor.

**8. Run history: list, search, replay, fork.**
(a) Done when: past runs are listed with their result, searchable, and any one can be re-opened
at any step and continued down a different branch.
(b) Bar: Hermes Sessions (FTS5, tool-call inspection, export) plus LangGraph's `update_state`
fork, "the original execution history remains intact."
(c) `crates/core/src/logbook.rs`, `scrollback.rs`, `crates/ui/` Trace view.
(d) Rank 8: projection work, not architecture — but note that backlog 1 must land first, or the
log this projects is nine parts `RequestHandled` by volume.

**9. Artifacts.**
(a) Done when: an agent producing a document, chart or page renders it beside the chat with a
version history, not as a code fence.
(b) Bar: Claude.ai artifacts — versioned, updates in place, one self-contained page.
(c) New module in `crates/core/`, `crates/module/src/manifest.rs` slots, `crates/ui/`.
(d) Rank 9: real differentiation, and it needs the editor (3) underneath it.

**10. Export the work.**
(a) Done when: one button produces a ZIP of the workspace, and one produces a git push.
(b) Bar: bolt.diy's ZIP download + Netlify/Vercel/GH Pages deploy.
(c) `crates/adapters_web/src/cheerpx.rs`, `crates/ui/`.
(d) Rank 10: cheap, and without it every hour of agent work is trapped in an IndexedDB overlay
a browser can evict.

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

### 2026-08-12 (second pass) — 15F…15L, read against the code and not the commit messages

`cargo test --workspace`: **165 pass, 0 fail** (was 159). `scripts/check-layout.sh` **OK — 1 696
assertions, 36 STACKED among them** (was 36 failures). `scripts/check-selectors.py` OK — 8 files,
5 font sizes, 0 raw spacing literals. `scripts/check-layering.py` OK. All four gates green for
the first time in this series.

Note the brief I was handed named five commits ending at `20cb609`. `HEAD` is `c6e909c`, and
there are two more: **15L** (`2c2f237`, the task launcher) and the ledger row. 15L is not a
footnote — it is the increment that closes one of the four "does not exist at all" items and it
is the one that makes two open defects fatal, so it is audited here.

**Closed, verified in the code.**

- **15H closed defect 1 of the last audit, properly.** `step.rs:161-165`: the terminal arm of
  `on_reply` now checks `state.steered`, clears it, and calls the model again instead of clearing
  `task` and emitting nothing. `rounds.rs:147` drives the racing path the previous test could not
  see. This is the fix I asked for, at the line I named.
- **15H closed defect 2.** `transcript.rs:163` counts `ToolInvoked` and `:216` publishes it as
  `data-tools` on the chat log, so a tool result changes the projection; `turn.rs:172` sets the
  note and does NOT return, so the poll continues. The 30 s abort is 300 s (`model.rs:22`) with an
  honest comment about why. Three named things, three real fixes.
- **15J is real, and the resume is correct.** I traced `state.compacting` end to end.
  `on_tool_result` calls `window::compaction` before every round (`step.rs:236`); the summarizer's
  reply cannot be mistaken for the agent's answer twice over — `step.rs:58` matches
  `ModelReplied … if state.compacting` BEFORE the generic arm at `:79`, so `on_reply` never sees
  it, and the fact is logged with `agent: "summarizer"` (`runtime.rs:101` from `window.rs:118`),
  which `transcript::belongs_to` routes away from the calling agent's conversation. `task` is
  untouched, so the same turn resumes. The claim holds.
- **15K is real and is the right fix.** `main.rs:121-128` derives `endpoint_set` from the broker
  every tick; because `chat::endpoint_configured` reads `web`, the effect also re-runs the moment
  boot lands. The signal no longer depends on a component nobody opened.
- **15I is real.** The probe was repointed and the gate is green with 1 696 assertions, including
  the 36 STACKED that were failing. It did catch a genuine 15B regression. Caveat below.
- **15G is real and it is the first thing in this repo that SELLS the substrate.** The listing and
  the read are the agent's own `list_files`/`read_file` through `core::workspace`, recorded as the
  same `ToolInvoked` facts, so the pane is a projection and not a second door to the disk. The
  `x-entries` header and the caller-supplied folder/file bit are both correct workarounds for real
  constraints, and the commit says why. Caveats below.
- **15L closes "launch an agent on a task without chatting to it."** `launch.rs` is 92 lines and
  makes the same `POST /chat` the composer makes. Of the four things §1 said do not exist at all,
  this one now does.

**Open, in severity order.**

1. **`SpaceInspector` spawns an immortal poll loop on every projection** — `crates/ui/src/
   space.rs:56-70`. The `use_effect` subscribes to `tick()` and `agent()` and, on every run,
   `spawn`s a bare `loop { sleep(2000); panel.set(read()) }` with no ceiling and no re-entry
   guard. Dioxus does not cancel a scope's tasks when an effect re-runs — `board.rs:83` says so in
   prose and carries the `watching` guard for exactly this reason; this pane carries neither.
   `turn::show` bumps `tick` every 400 ms for the whole of a turn (`turn.rs:95`, `:155`), so a
   ten-minute run accumulates ~1 500 concurrent pollers, and they are additive forever: they never
   exit, and `panel.set` on unchanged content does not stop them. It is mounted on the DASHBOARD
   (`stage.rs:63`) — the landing view, and the view 15L put the launcher on. The documented happy
   path is the one that detonates.
2. **The seam pays for its own polling, quadratically.** `dispatch.rs:163` builds `Ctx.recent` as
   `app.log.iter().map(|e| e.kind.clone()).collect()` — a full clone of every event kind, with
   every message string, on EVERY request — plus `agents`, `authored`, `board.snapshot().to_vec()`
   and `logs::window()`. And `core::handle` (`lib.rs:139`) appends a `RequestHandled` fact per
   request, which `app.rs:148` stages for persistence, so each poll enlarges what the next poll
   clones and writes one more IDB key. This is pre-existing and it was survivable when a turn was
   four rounds; with 15C's sixty-four, 15H's five-minute calls and defect 1 above, it is the
   amplifier that turns a leak into a dead tab. `filelist.rs:37` and `transcript.rs:130` then scan
   the clone linearly, per pane, per tick.
3. **A launched run is invisible from four of seven views, and a Worker run is invisible from all
   of them.** Two separate causes with one symptom.
   (a) `AgentBoard` calls itself "THE PAGE'S OBSERVER" (`board.rs:6-12`) and is mounted only on
   Dashboard (`stage.rs:62`) and inside `Rail` on Chat/Agents (`:148,:151`) — and `main.rs:173`
   unmounts `Rail` entirely when the rail is folded, which is the DEFAULT below 1100 px
   (`dash::wide`). Unmounting drops its spawned clock. The only other clock is `ChatPane`'s
   `watch`, which runs only for the SELECTED agent's own pending turn. So: launch a task, navigate
   to Workspace to watch the files, and nothing on the page calls the seam — which means
   `WebApp::handle`'s `take_reports()` never drains, so Worker status never enters the log, and
   `roster::reconcile`'s deferred agent swap never installs. The run keeps going (`drive` is
   `spawn_local`, not scope-bound); only the watching stops. This is the same class as 15K: a
   signal that depended on a component being mounted. 15K fixed one instance; this is the other.
   (b) A sub-agent's Worker has its own log by design (ADR-008, `worker.rs:21`) and
   `workers.rs:58-70` has exactly three report channels — status, memory, authored. No
   `ToolInvoked`, no `ModelCalled`. So for any agent but `main`: the Trace view is empty
   (`transcript.rs:56` gates tool facts on `who == me`), the Files pane is empty
   (`filelist.rs:37` folds the page's `recent`), and the meter reads zero.
4. **`spent()` still counts one agent — flagged last audit, not fixed, and now worse.**
   `transcript.rs:109`. 15L made the uncounted path the headline feature: the tooltip says "Every
   token this page has spent" over a `0` while a launched agent burns a context window. A meter
   that is confidently wrong is worse than no meter, and this one is wrong exactly when the
   product is doing the thing it is for.
5. **15G's Files pane: 240 polls per click, uncancelled, and a stale pane between them.**
   `files.rs:101-112` spawns a fresh 240-tick 500 ms watcher on EVERY click with no cancellation
   of the previous one, and each tick is a `handle()` — a full `Ctx` clone, a `RequestHandled`
   append and a spawned `core::drive` (`adapters_web/lib.rs:189`). Click five folders and five
   watchers run. It is bounded, unlike defect 1, and each exits on the first change it sees, so it
   is a burst and not a leak — but it is 240 log entries and 240 drives per unanswered click, on
   top of defect 2. The other half: the idle refresh is `tick`-driven only (`files.rs:78`) and on
   the Workspace view nothing bumps `tick` (defect 3a), so between clicks the pane can show a
   listing minutes old with nothing saying so.
6. **The layout gate is green over a page missing its three newest surfaces.**
   `scripts/layout-probe.html` is 155 lines and contains no `dash-grid`, no `view-panel`, no
   `file-list`/`file-entry` and no `task-field` — so `.dash-grid`, the seven view panels, the whole
   of 15G's Files pane and the whole of 15L's launcher are measured by zero of the 1 696
   assertions. This is the same failure the script's own header warns about, one turn later and
   inverted: it was red about markup nobody ships, and it is now green about a page that is
   missing the three things shipped since it was written.
7. **Two small honesty defects.** `launch.rs:12` and its commit both say the launched turn runs
   "in that agent's own Worker" — false for the default `main`, which `runtime.rs:153` routes to
   the page's own engine; the commit's live verification was almost certainly of that path, which
   is the one where the Files pane can see anything. And `window::compacted` (`window.rs:78`)
   recomputes `cut = lines.len() - keep` against the CURRENT history, while the summary it applies
   was produced from the history as it stood when compaction started — so a steer that arrives
   during a compaction pushes one un-summarised entry off the end. Narrow race, and it drops
   exactly the sentence 15D/15H exist to preserve.

**On test coverage.** 165 green, and the two tests I called green-over-broken last time are fixed
(`rounds.rs:147` drives the racing steer). One new test is half-vacuous: `compact_mid_turn.rs`
asserts `state.compacting` becomes true and `break`s — it never feeds the summary back, so the
resume path it exists to protect is untested, and the file's own doc comment ("round thirty can
still see round one") claims more than the assertion. Backlog item 3 of the last audit asked for
"a host test that drives thirty rounds and asserts on the last `CallModel` document"; this is not
that. `crates/ui` still has zero tests, which is where four of the seven defects above live, and
the layout gate — the only automated check on that crate — does not see the newest three panes.
