@AGENTS.md

# Philosophy

Every engine is a live object: its own thread (Web Worker), its own inbox,
its own tools, artifacts, memory and status, and a UI attached to its state.
Engines never block on each other; they exchange letters (quests and
reports). State is one immutable snapshot per engine, streamed to the UI as
patches: if the engine knows it, it is in the state, and the UI shows it.
Behaviour lives on engines and features, never in components. Core defines
the flow; features implement it. The owner approves every change and can
stop anything. The same code runs in the browser, beside a folder, and
headless. Full text and a checklist for changes: `docs/philosophy.md`.

# Project rules

## Client-side only

There is no server. The app is a static export (`output: "export"` in
`next.config.mjs`), served as plain files from `out/`.

- All functionality must run in the browser. No API routes, route handlers,
  server actions, middleware, `cookies()`/`headers()`, ISR, or runtime
  `next/image` optimization.
- Interactive components are `"use client"`. Server components are fine only
  for static markup rendered at build time.
- Data and state live in the browser (React state, localStorage/IndexedDB).
  External services are called directly from the client.

## Modes: dev (default) and browser-only

The same app runs in two modes (`backend/platform/host.js` `detectHost()`):

- **local** — `bun run dev` (`scripts/dev.js`), the default way to run ASKK:
  the Next dev server (hot reload, debugging) as a custom server that also
  serves the host API (`companion/host-api.js`) same-origin under `/__askk/`.
  Workspace = `--root` (default: the folder dev starts in); `--read-only`,
  `--port`, `--hostname`. The compiled companion (`bun run build:companion`
  → `dist/askk`, `companion/server.js`) serves the built app with the same API.
- **one team per local server** — in local mode (dev, `askk`) the engines run
  once, in the server process (`companion/team.js` starts `team-worker.js`, a
  Bun Worker: the same registry and engines as the app, browser shims from
  `companion/shims.js`). Its data is the workspace's **runtime folder**
  (`teamStorageDir` / `teamMemoryDir`: a desk keeps host state in
  `custom/<desk>/state/` and engine files in `custom/<desk>/memory/`; a team
  folder without desk.js uses `custom/<team>/runtime/`, any other workspace
  `~/.askk/team/<root hash>/`; never inside the workspace): engine files as
  real files (`agents/<engine>/memory.md`, history, artifacts.json —
  `platform/storage.js` uses `globalThis.askkRuntimeFiles`) and settings
  (one file per localStorage key). `server.json` there tells headless runs
  where the server is. Every tab mirrors it (`backend/runtime/remote-team.js`,
  capability `team`): `GET team/stream` (SSE: snapshot, then registry / state
  / models changes), `POST team/call {target, method, args}` (a message, an
  approval, stop, model switch, agent edit), `POST team/send {text, agent?,
  from?}` (work into an agent's inbox without waiting; default the lead).
  The server is the team's home and runs until stopped: it runs its own wake
  book (`companion/wakes.js`, every 30 s) and outside sources only send it
  inputs (`bun run send -- --agents <team> [--agent] [--from] [--start]
  [--unless-booked <min>] "text"`, `scripts/send.js`; cron lines call that):
  server up → the text goes to the desk's lead (x-askk-desk); down with
  `--start` → it starts launchd `askk.desks` (kickstart/bootstrap, else a
  detached `bun run dev --desks`), waits for it, then sends; still down → the
  text is booked as a wake due now in `state/wakes.jsonl`, run when the server
  comes up (within 60 min). One server per team folder, each on its own port: several desks run
  side by side. Always on: a launchd agent per desk (`custom/<team>/launchd/
  *.plist`, KeepAlive; it runs `bun run dev`, not `bun --bun scripts/dev.js`,
  whose Turbopack PostCSS worker cannot spawn node under launchd). Next allows
  ONE `next dev` per project folder, so a second desk runs the compiled
  companion (`bun run build:companion` → `dist/askk --agents custom/<desk>
  --port <n>`), and only one server should run the Telegram listener per bot. The registry picks the mode in
  `start()`. Integration listeners run in the team. `--browser-engines`
  restores per-tab engines; the static build always runs them in the tab.
- **headless** — `askk ask "query"` / `bun run ask -- "query"`
  (`companion/ask.js`): one query to an agent, answer on stdout, exit code
  (0/1/2/124), for scripts and cron. Same agents and engines in Bun,
  in-process (no workers); browser shims (`location`, same-origin `fetch`
  answered in-process by the host API + public files), so no port is opened.
  When a server runs the workspace's team, the query goes to it instead
  (live in every tab; approvals without `--yes` wait in the app). Otherwise
  it uses the same runtime folder, so memory and research carry over between
  runs. `--local` forces in-process (memory per run if a server is up).
  Changes declined unless `--yes`. App code must keep working there: use `globalThis.location`, not
  `window`.
- **demo** — the static build on any host (or `bun run dev:browser`):
  browser-only, the ~80%. Engines run in the tab and their memory lives in
  that browser (OPFS); nothing is shared with other tabs or devices. Host capabilities are shown as missing in the
  header (`components/host-status.jsx`, `HOST_CAPABILITIES`) and fall back
  where they can (files → OPFS workspace).

Host API capabilities: `fs.read` (`whoami`, `fs/list`, `fs/tree`, `fs/read`) and
`fs.write` (`POST fs/write`, revision-checked, atomic; `POST fs/delete`,
links unlinked never followed, non-empty folders need `recursive`),
`models` (`.env`) and `apple` (macOS only: `GET apple/actions`,
`POST apple/run {action, inputs}`, `companion/apple.js` — fixed system
programs with argument lists, never a shell; agent text is data) and `mcp`
(`.mcp.json` in the folder ASKK starts in, `mcpServers` format, stdio or
Streamable HTTP; `GET mcp/tools`, `POST mcp/call {server, tool, arguments}`;
`companion/mcp.js` is the MCP client, servers start lazily and stay up).
Agents can never write or delete `.env*` (except `.env.example`) or
`.mcp.json` through the API.
Real-money orders (`robinhood.place_option_order`) pass `companion/order-guard.js`
inside `mcp/call` first: limits from `.env` (`ASKK_ORDERS=live` or every order is
refused; account, contracts, debit per order and per day, opens per day, ET
window; opening = limit debit buys only, closing always passes), every attempt
logged to `<runtime>/orders.jsonl`. The limits live where agents cannot write.
`ASKK_ORDERS=paper`: same guard, the trade desk's `tools/paper-broker.js` answers the order account's
option tools (place/cancel/review/orders/positions/portfolio) from `<runtime>/paper.json`,
filling against live quotes — a desk runs end to end without real money. `openalice.lensReplay` (the trade desk's `tools/lens.js`: past sessions' 5m bars replayed
through its entry lenses — breakout, fade, orb-fail, pullback — and exit plans, ATM options priced
with Black-Scholes, IV from VIX × 0.55 calls / 0.75 puts calibrated on the desk's fills, index ETFs
only; modes map (pre-open regime + each entry's record in that regime, 90% CI), replay (held-out
half), audit (a session: offered vs taken); the grader audits every session, the retro attributes
every row to thinking/timing/execution/market in `state/attribution.jsonl`). `openalice.moversBoard` (the trade desk's `tools/movers.js`): 16 trackers (index, metals, rates, energy,
sectors) ranked by gap and move in ATR14 units, gap fill, VWAP side, the multi-day leg and a setup label; the
desk and momentum measure its top 3 every plan and refresh (`quotes` for pre-market prints). `book.read`
(the trade desk's `tools/book.js`, wired by its desk.js `host()` hook): the account's money variables
computed in code — equity, start-of-day equity (`<runtime>/book.json`, 30 days), day P&L,
goal (`ASKK_DAY_TARGET_PCT`) and pace, upkeep, the guard's budget left, sizing tier
(`TIERS`) and per-order debit, positions, orders, fills, round trips; the guard's day stop
(`ASKK_ORDER_DAY_STOP_PCT`, default 25) refuses openings from it. A desk's `host()` also gets
`root` (the workspace) and `listen` (true only on the continuous server, one per team): the trade
desk starts its tripwire there (`tools/tripwire.js`, off with `ASKK_TRIPWIRE=off`): code, no model,
quotes the watch list every 30 s in market hours (base ETFs + `state/tripwires.json` `watch`/`levels`/
`flushPct`, which the lead rewrites every run) and books one wake due now in `state/wakes.jsonl` on a
flush, the reclaim after it, a ±1%/±3% day-move cross or an armed level (cooldown 20 min, ≤ 6/hour;
fires logged in `<runtime>/tripwire.jsonl`) — the lead rests between runs and never polls a price.
Security: Host header must be localhost:port (DNS rebinding; LAN devices get
demo mode), cross-origin refused, POST needs same-origin Origin + JSON,
realpath containment (no symlink escapes, also for new files).
The host API only provides capabilities; agents, state, and logic stay in
the browser. App code must still work without it. A new host capability
goes in `host-api.js` + `HOST_CAPABILITIES`.

## Mobile-friendly

Design every screen for phones first, then scale up.

- No horizontal page scroll at 375px wide.
- Touch targets at least 40px on touch devices (`pointer-coarse:size-10`).
- Form inputs at least 16px font on mobile so iOS doesn't zoom.
- Use `svh`/`dvh` for full-height layouts, not `vh`.
- On mobile the sidebar is an overlay; navigation from it must close it
  (`setOpenMobile(false)`).
- Verify at a phone viewport (e.g. 390x844) as well as desktop.

## Bun built-ins first

Before adding a library or hand-writing a utility, check what Bun ships
(`bun -e 'console.log(Object.keys(Bun))'`; docs at bun.com/docs). Bun 1.4 has
`Bun.markdown` (html/render/react), `Bun.YAML`, `Bun.TOML`, `Bun.JSON5`,
`Bun.Image`, and more. These run only in the Bun runtime (build scripts,
tooling), never in the browser — the app is a static export. Use them in
build-time scripts; browser code needs a browser-compatible implementation.

## Stack

Bun + Next.js (App Router), plain JavaScript (`.js`/`.jsx`, no TypeScript),
Tailwind v4, shadcn/ui (`base-nova`, `tsx: false`). Run scripts with
`bun --bun`. Add components with `bunx --bun shadcn@latest add <name>`.

## Engines

`backend/` holds the browser-side "backend" objects (no server involved),
by layer. `core/` defines the contracts and the flow; `features/` implement
them; the rest wires engines to threads, definitions, models and storage.
Core never imports a feature folder directly, only the catalogue
(`features/index.js`).

**`core/` — abstractions and the flow**

- `base-engine.js` — `BaseEngine`, the abstract agent: elements that render
  into the prompt (`template.js` order, least-changing first for prompt
  caching: soul → instructions → tools → structured response → history →
  artifacts → context (current time, open quests) → current request; complete
  prompt every request; `renderPrompt()` also returns the cache breakpoints,
  sent as Anthropic `cache_control` blocks). History holds finished turns only; the
  current request's own steps and tool results render after it ("WORK DONE
  ON THE CURRENT REQUEST", then the request restated) so the model continues
  instead of restarting. CONTEXT holds the lines tools contribute
  (`Tool.context()`, e.g. the workspace for fs.*). Model, inference + metrics
  (`step()`), tools, memory, summarizing, lifecycle
  `created → idle ⇄ running → disposed` (+ `error`). `ask()` wraps the
  abstract `run(text, request, signal)`.
- `artifact.js` — `Artifact` base: an object an engine keeps beside its
  conversation, rendered into the prompt (ARTIFACTS slot, after history) as
  its latest state only. `state` (per engine, saved to
  `agents/<engine>/artifacts.json`, reset by clear memory), `refresh()`
  (before every LLM step), `render()`, `commands()` (tools that change the
  state). agent.md lists them under `artifacts:`. Purpose, planned types
  (document, image, video) and undo/rollback: `docs/artifacts.md`.
- `tool.js` — `Tool` contract (`run(inputs, {engine, signal})`, `effect`,
  `approval`, optional `context()`) and `AgentTool` (another agent as a
  tool). Tools with `approval: true` pause the engine (`state.approvals`)
  until the owner answers in chat (`resolveApproval`); a declined call is
  auto-declined if repeated in the same request.
  Autopilot (`BaseEngine.autopilot`, a static flag: on = approval tools run
  without asking; `registry.setAutopilot`, status-bar toggle, saved as setting
  `askk.autopilot`, default `ASKK_AUTOPILOT` in .env): scheduled runs work
  unattended. Engines in Web Workers (per-tab mode) have their own static, so
  there the registry approves pending approvals instead.
- `template.js` — prompt slots and their order.
- `responses.js` — structured response models (`ReActResponse`, …) with
  JSON / TOON / fallback parsing. Port of LocalAgents `core/responses.py`.
- `tool-plan.js` — `parseToolPlan(response)`: every call in one response as
  ordered stages. One call per line = sequential; `parallel[a(…), b(…)]` = one
  stage started together (`Promise.all`) and joined. `BaseEngine.runTools()`
  runs a plan as written; after a failed stage the rest are skipped. Max 16
  calls per response; an agent may appear once per parallel group.
- `memory.js` — `Memory` (memory.md read/write, see Memory below).
- `single-call.js` — one-shot agents (see below).
- `activity.js` — `describeActivity`, the live-work labels.

**`engines/` — strategies (BaseEngine subclasses)**

- `react-engine.js` — `ReActEngine.run()`: the ReAct loop (LocalAgents
  `core/engine.py`). `index.js` maps `strategy:` (agent.md, default react)
  to a class: add a strategy = subclass BaseEngine + register in `ENGINES`.

**`features/` — implementations, one folder per feature**

- `index.js` — the catalogue: every tool and artifact type an agent.md may
  list (`createTools`, `createArtifacts`, `TOOL_NAMES`). `notes.*` are
  contract-only here. Add a feature = a folder + list it here.
- `filesystem/` — the workspace and everything built on it:
  - `workspace.js` — the files agents work on, one contract, two backends:
    OPFS `workspace/` (browser-only / static) or the companion's folder
    (local mode). `list/tree/read/write/remove`, content-hash `revision` for
    conflict checks.
  - `tools.js` — `fs.list`, `fs.read`, `fs.write`, `fs.edit`, `fs.delete`.
    `fs.write` over an existing file must be based on a revision the engine
    read (`markSeen`). No content twice in the prompt: an agent with the
    `filesystem` artifact gets no `fs.read`/`fs.list` (the tree lists every
    file, `fs.open` shows one; its result is a status line), and `fs.read`
    of a shared/ file shown in SHARED returns only a status line.
  - `artifact.js` — `FilesystemArtifact` (`filesystem`): the workspace tree
    (names only, every level; heavy folders like node_modules listed, not
    expanded) plus the files the engine opened (`fs.open` / `fs.close`
    expand / collapse, max 12), re-read each step. `SharedArtifact`
    (`shared`): the workspace's `shared/` folder (git-ignored), EVERY file
    always expanded, re-read before every step, so parallel agents see each
    other's writes at their next step; agents write it with fs.write /
    fs.append. Budgets: 40K/file, 120K total, 200 files; newest-dated paths
    first; .jsonl/.log show their tail; .env* never. Every shown file counts
    as seen for `fs.write`'s revision check.

- `checklist/` — `ChecklistArtifact` (`checklist`): agent.md `checklist:` (THIS
  RUN: fresh per origin, the final answer is refused up to twice while items
  are open — `BaseEngine.pendingChecks()` in the ReAct loop) and `daily:`
  (TODAY: fresh per America/New_York day, kept across runs: the day's
  script), items `"id: what done means"`. `checklist.tick {id, evidence}`,
  `checklist.skip {id, reason}`. Status turns are never blocked.
  `checklist_file: <path>` keeps TODAY in a workspace Markdown file instead
  (`- [ ] id: text`, `[x]`/`[-]`, `  ↳ note`; the owner can edit it, re-read every
  step): the first run of a new ET day archives it to `days/<date>/checklist.md` and
  writes a clean one from `daily:`; `checklist.add {text, id?}` adds items; an open
  item whose leading `HH:MM` ET has passed (or has no time) blocks the answer too.

- `web/` — `tools.js`: `web.search {query, limit?}` and `web.read {url}`.
  Local mode: the host does both (`companion/web.js`, capability `web`,
  `GET web/search?q=`, `GET web/read?url=`): SearXNG (free, open-source
  metasearch) when `ASKK_SEARXNG_URL` names an instance with JSON on, else
  DuckDuckGo's keyless HTML page; pages fetched host-side, public addresses
  only (loopback/private/link-local refused at every redirect), as text,
  40K cap. Browser-only: search = Wikipedia's CORS API, read = direct fetch.

- `skills/` — procedures kept out of the prompt until needed. Skills live
  in `public/skills/<name>/SKILL.md` (frontmatter `name`, `description` +
  Markdown body), listed in `public/skills/index.json` (a static export
  can't list folders; add a skill = folder + manifest entry).
  - `catalog.js` — `listSkills()` (name + description of every skill),
    `loadSkill(name)` (full text); cached per thread, works in workers.
  - `artifact.js` — `SkillsArtifact` (`artifacts: [skills]`): renders the
    catalogue plus the engine's loaded skills in full. `skills.load` /
    `skills.unload` (each takes `{"names": [...]}`); max 6 loaded. Only the loaded list is per engine.
    agent.md `skillset: [a, b]` limits the catalogue and what can be loaded to those skills.
    (agent.md `skills: {name: file}` is the older always-inlined form.)

- `schedule/` — `tools.js`: `schedule.wake {in_minutes|at, reason, message}`
  books the team's next run as a row in the workspace's `state/wakes.jsonl`
  (`at` UTC); `replaces: [id]` cancels the open wakes it supersedes (`cancelled` rows). A running server runs due wakes itself;
  `scripts/wake.js --agents <team>` (only when no server runs) runs each
  due wake once through headless ASKK (claims it with a `done` row first;
  over `--stale` minutes late = `missed`; one runner per root via `state/wake.lock`).
- `mcp/` — `tools.js`: `McpTool extends Tool`, one per tool of an MCP
  server, named `<server>.<tool>`. agent.md `mcp: [server]` (all its tools),
  `[server.tool]` (one) or `["*"]` (every configured server, silent when
  none). `loadMcpTools()` fetches the host's list once per thread; the
  engine adds them in `#describeTools()` before its first letter (they are
  async, unlike catalogue tools) and lists each server in CONTEXT. Approval
  per server (`approval: auto|always|never`; auto = all but `readOnlyHint`
  tools), with a `describe()` sentence on the card.
- `team/` — `TeamArtifact` (`team`): sub-agents an agent creates while it
  works (Claude Code Task subagents / VS Code custom agents). `agent.spawn
  {name, role, goal, tools?, mcp?, artifacts?, keep?, idle_minutes?, max_steps?}`
  makes a new engine from `role` (the caller's soul, model and response
  format; tools/MCP/artifacts ⊆ the caller's; no `team`, so no nesting) and
  hands it `goal` as a quest at once — the report wakes the caller like any
  quest. Then the caller decides: `agent.kill` (done; open quests called back),
  `agent.task {name, quest}` (more work, same context), `agent.keep` (a lasting
  member: saved as setting `askk.spawned`, restarted with its memory). The
  artifact lists them live (kept/task, working/idle, tools, ended lately);
  task agents idle `spawn_idle_minutes` (30) are ended by the reaper; at most
  `spawn_max` (6) per caller. Work lives in `runtime/spawner.js`
  (`createSpawner`), used by the registry (server team, per-tab workers via
  the `host` worker message) and headless ask; engines reach it through their
  directory (`spawn/kill/keep/roster`). Spawned definitions carry `spawned:
  {by, keep, idle_minutes, role, at}`; they join `agents`, so every tab,
  the status bar and Live follow show them.
- `apple/` — `tools.js`: `apple.*` tools on the owner's Mac through the host
  API (Shortcuts list/run, say, notify, clipboard read/write, Spotlight,
  Reminders list/add, open a link). Every call that acts or reads personal
  data has `approval: true` and a `describe(inputs)` sentence for the
  approval card (`Tool.describe`); macOS adds its own permission prompt per
  area. Elsewhere they fail with "not available here". Plan and inventory:
  `docs/apple.md`.

**`runtime/` — engines running live**

- `engine-worker.js` / `engine-proxy.js` — every engine runs in its own Web
  Worker. The main thread holds an `EngineProxy` (same surface: snapshot,
  subscribe, ask/send/stop, memory actions, reconfigure, dispose) fed by
  batched state patches (~30/s, only changed messages). Letters between
  inboxes (quests, reports, cancels) are routed through the registry. Workers can't use
  localStorage: models are resolved on the main thread and sent in.
- `registry.js` — on startup, one engine per agent in
  `public/agents/index.json`. Engines come only from agent definitions.
  Retired agent definitions are kept in `backup/agents/` (not served).
  The first agent in `index.json` is the default: its engine (`requiredId`)
  is required and has no close button; extra engines can be closed.

**`agents/` — definitions**

- `definitions.js` + `frontmatter.js` — load `public/agents/` (askk-style
  `agent.md` frontmatter, shared `soul.md`). Soul = identity (values,
  character; opens the prompt with no header), never the job; the agent.md body = the role,
  the hat for this work (`## YOUR ROLE`: the work, rules, learned). How to
  write each, and the research behind the split: `docs/soul-and-role.md`. `agent-store.js` — owner edits
  (localStorage).

**`models/` — inference**

- `llm.js` — inference over two wire protocols: `openai` (`/chat/completions`)
  and `anthropic` (`/messages`), streaming `fetch`, plus `listModels()` and
  `contextWindow()`. Thinking arrives as `reasoning_content` / `thinking_delta`.
- `catalog.js` — model catalogue: named connections (`key` → provider,
  base_url, id, …). `public/models.json` is shipped empty (public: never an
  endpoint or key). Local mode adds the `.env` model (`ASKK_MODEL_*`,
  `.env.example`) from the host API `GET /__askk/models` (`modelsFromEnv()`
  in `companion/host-api.js`, capability `models`; headless reads it too).
  Settings adds/edits more in localStorage `askk.models` (wins over both). One is the
  default; every agent uses it unless agent.md names a key (`model: <key>`).
  `engine.model` = `resolveModel(agent.model)` (null if the key is unknown).
- Models this Mac runs (local mode): providers `claude-cli`, `codex-cli`,
  `gemini-cli` (the owner's signed-in CLIs, run as plain completions: own
  tools, MCP, plugins and project files off, empty temp folder, prompt on
  stdin) and `apple` (on-device Foundation Models via Apple's Python SDK,
  `vendor/apple-fm/bridge.py`, 8k context). `companion/local-models.js`; the
  host serves each OpenAI-compatible at `/__askk/llm/<provider>/v1`
  (capability `models.local`, SSE with keep-alive pings), and `llm.js` maps
  the provider to that endpoint, so no URL or key is stored.
- MCP url servers may name `"oauth": "<token file>"` (`${VAR}` from `.env`):
  `companion/oauth-file.js` reads the bearer token from a file another program
  shares, refreshing it under an exclusive flock (one copy, never
  duplicated: refresh tokens rotate).
- `metrics.js` — `TokenMeter`: tokens/s and context use per LLM call (server
  `usage` when reported, else ~4 chars/token). Engine state `stats` +
  `contextWindow`; shown on the chat page (`model-stats.jsx`).

**`platform/` — where the app runs**

- `host.js` — `detectHost()`, `HOST_CAPABILITIES` (local vs demo).
- `storage.js` — OPFS files (`createWritable`, or `createSyncAccessHandle`
  in workers), localStorage fallback.

Engines run a ReAct loop (step → answer, or tool calls → results → step).
Live work is `state.activity` (`idle | llm waiting/thinking/responding |
parsing | tool | agent | tools | approval | summarizing | waiting`, see
`describeActivity`); each tool result is one `role: "tool"` message with
`ok: true/false`.

Inbox and quests (`core/base-engine.js`): every engine runs in its own
thread and owns an inbox. All work arrives as a letter (`deposit()`): the
owner's message (`request`), another agent's `quest`, a `report` on a quest
this engine handed out, or a `cancel`. Letters are worked one at a time; a
deposit while idle starts the work. Delivery between threads is postMessage
(worker → main `send` → registry → target proxy → worker `deposit`); nothing
ever blocks on another agent. Agents under `agents:` in agent.md are
`AgentTool`s (`{"quest": …}`): calling one deposits a quest in that agent's
inbox and returns at once; the step ends the turn ("Waiting for reports…",
activity `waiting`). The sub-agent's final answer goes back as a report
letter (the callback); when every quest handed out by that letter is back,
the reports arrive together as one letter that continues the same origin
(the owner's request, or the quest that started it — nesting works). Open
quests are listed in CONTEXT; `stop()` (chat: "Call back") recalls them and
the agents drop or abort them.

Supervision: steps (`max_steps`) and quest rounds (`max_rounds`) are
unlimited unless agent.md sets them. The guard is `runtime/supervisor.js`:
it reads every engine's state (`working`: the letter in progress) and, while
one works on a quest, deposits a `status` letter in the quest owner's inbox
with a digest of its new steps (`core/log.js`) — every `check_minutes` (5) or
`check_steps` (10) new steps, whichever first (owner's agent.md). Only the
newest status per quest waits. The owner reviews it in a side turn that
never settles the request: on track (one line), `quest.steer` (a `guidance`
letter, added to the agent's work at its next step), or `quest.recall` (the
quest comes back as a failed report, so its batch still joins). Agents with
`agents:` get both tools. Runs on the main thread (registry) and in
headless. Quests are not persisted across reloads. The
lead is the manager: it turns the owner's goal into complete quests
(`public/agents/lead/agent.md`); searcher (web search) and humaniser (the human/poetic reply) are its team;
planner and critic are retired to `backup/agents/`.

Memory: each engine's messages live in a readable Markdown file,
`agents/<engine>/memory.md`, in the browser's Origin Private File System
(`platform/storage.js`, localStorage fallback). Saved before every render and at the
end of each turn; restored at startup (`engine.restore()`, memory.md only). `clearMemory()`
empties it; `summarizeMemory()` replaces the log with one `summary` message.
Every summarize (manual, or automatic before an LLM step once the prompt
reaches 92% of the context window) first moves the log to a new
`agents/<engine>/history-<time>.md`. The prompt carries the full memory; the
token estimate is calibrated from server usage counts. Context per agent: min(the model's window, 262144 tokens;
`ASKK_CONTEXT_CAP` or agent.md `context_window` override), also when the
model's window is unknown.
agent.md `memory: run` (default `keep`): every run (a request or a quest) starts from an empty
log, the old one moved to a history file — for agents whose work lives in shared files.
Letter ids carry a per-boot prefix, so a run's origin id never repeats after a restart.
History files are capped: `Memory.archive` keeps the newest `ASKK_HISTORY_KEEP` (6) per engine.

Compaction (`features/compact/`, artifact `compact`) is not summarization: agent.md
`compact:` lines `"<path>: <max chars>"` (and `"<dir>/<date>/ -> <dest>/<date>/...: <keep>"`
to move older dated folders out) cap working files. Checked before a step (once a minute);
over its cap a file is compacted to 60%: `.jsonl` rows sharing an id fold, long fields cut,
oldest rows dropped; other files get one `createCompactor()` pass (same format; repeats,
common knowledge and superseded lines go; dated numbers, open items, evidenced lessons stay).
The original is archived in the engine's storage (`compacted/`, 3 kept). `intel.compact`.

Single-call agents (`core/single-call.js`): one render → infer → parse, no loop,
tools, or memory (e.g. `createSummarizer()`). Engine and single-call agents
share `core/template.js` and `models/llm.complete()`.

React reads the registry and engines via `hooks/use-engines.js`
(`useSyncExternalStore`). Put behaviour on the engine classes, not in components.
Reference projects: `/Users/kaush/Downloads/LocalAgents` (engine/responses),
`/Users/kaush/Downloads/Dev/askk` (agent format, soul, template order).

Status bar (`components/status-bar.jsx`, in `app/layout.jsx`): pinned to the
bottom of every page; reads registry + engine state only. Left: host, one
dot per engine (click → its chat). Right: the selected engine's activity and
model. New items are `<StatusItem>` components.

Chat page debug (temporary): the `<>` button next to the model stats opens
`components/chat/prompt-panel.jsx` beside the chat — "Sent" is the exact
prompt of each LLM call (`message.prompt`), "Next" is `engine.preview(input)`.

## Agent teams: public and custom (desks)

No `--agents`: the public team (`public/agents/`, pushed) runs. To customise,
point the start at a custom team folder (`custom/<team>/`, git-ignored,
never pushed): `--agents custom/<team>` (dev, `askk`, `askk ask`; or
`ASKK_AGENTS` in `.env`).

```
custom/<team>/
  agents/   index.json, soul.md, <name>/agent.md, skills/, mcp.json (its tools)
  data/     the team's shared folder: the workspace unless --root is given
```

A desk is the full format (`custom/README.md`, loader `companion/desk.js`):
`desk.js` (init script: `export default ({dir, env}) => ({ name, description,
port, terminal: {programs, timeoutSeconds} | null, host({call, env, state,
dir}) => ({ wrap, servers, beforeOpen }) })`), `agents/`, `tools/` (host code
only this desk uses), `vendor/`, `data/` (workspace), `memory/`, `state/`,
`launchd/`. The host applies each desk's `host()` hook in `mcp/call` (wrap
below the order guard, extra tool servers, opening checks). Desks:
`trade-desk`, `dev-desk` (lead/programmer/tester, Python products,
terminal, local oMLX model) and `single-desk` (one lead that builds its own
team with the `team` artifact, local oMLX model, port 1113 alone). ONE process hosts every desk: `bun run dev --
--desks custom [--desk trade-desk] --port 1111` (launchd `askk.desks`,
`custom/launchd/askk.desks.plist`, log `custom/server.log`): each desk its own
team, host API, wakes, MCP servers and integrations (desk.js `integrations`
allow-list: one Telegram listener per bot); a request reaches a desk by the
`x-askk-desk` header (scripts: server.json names the desk) or the
`askk_desk` cookie (the header's desk switcher, `components/host-status.jsx`:
`GET desks`, `POST desks/select`), else the default. A desk's `model`
(desk.js) is its team's default. Alone (`--agents custom/<desk>`) a desk
runs on its own port with its own `.next-desks/<name>` build.

Parallel dev team guards (agent.md, enforced in code; findings and plan: `docs/parallel-dev-team.md`):
`writes: [globs, "!exclude"]` — the agent's file lane, fs.write/edit/append/delete refuse other paths
(`features/filesystem/guard.js`); `preserve: true` — a write that drops a def/class/function/test or
guts a code file, and deleting code/test files or folders, is refused (the way out is a blocked
report); `strict: true` — the final answer is refused while any checklist item is open (default:
twice, then through); `agent.spawn {writes, checklist}` gives a helper a lane inside the caller's
(exclusions, preserve, strict carried over); the supervisor sends a STALLED status when a quest's
agent sits idle without it for `stall_minutes` (10); the terminal refuses destructive git (reset
--hard, clean, rm, restore, checkout --, push --force, branch -D, …) and `python -c` file deletes on
every desk (`refuseDestructive`).

Terminal (`features/terminal/`, capability `term`, only when a desk declares
`terminal`): `term.run {command, cwd?, timeout?}` → `POST term/run`
(`companion/terminal.js`): the desk's programs only, `&&` chains and `cd`, no
shell syntax, under macOS `sandbox-exec` (writes only in the workspace, temp
and caches; no ~/.ssh, .env, other desks), minimal environment, output kept
to 20 000 chars, every run logged in `state/terminal.jsonl`. The `terminal`
artifact shows the team's last 5 runs (agent, command, exit, output tail).
`term.run` streams its output into the call's progress (`POST term/run
{stream: true}` → NDJSON start / out / result). Long-running programs (a dev
server) go to `term.start {command, cwd?, name?, port?}`: one program, same
allow-list and sandbox, its own process group, output kept (40K), printed
local URLs collected, at most 4 at once, stopped after the desk's
`backgroundMinutes` (120) and when the server exits; any agent checks it with
`term.ps` / `term.logs {id, tail?}` and ends it with `term.stop {id}` (host:
`POST term/start`, `GET term/ps`, `GET term/logs`, `POST term/stop`). The
terminal artifact lists them. `GET term/stream` (SSE): a snapshot (runs in
progress, procs), then `start` / `out` / `end` and `proc` / `proc-out` events.
One terminal per server: the team worker's `term/*` fetches go to the
server's own host API over HTTP (`createTeam({ port, desk })` → shims
`forward`, with `x-askk-desk`), so agents' runs and processes are the ones
`term/stream` shows every tab. The dev desk's tester has a headless Chrome (`browser.*`,
`custom/dev-desk/agents/mcp.json`: chrome-devtools-mcp, isolated profile,
only http://127.0.0.1|localhost:80* — start apps for it on ports 8000–8099).

Live follow (`/live`, `components/live/live-page.jsx`; model in
`backend/features/live/follow.js`): every tool call of every engine in one
feed, newest first, beside the chat instead of in it, so the owner can guide
while it happens. The standard (`backend/core/tool.js`): a tool declares
`view` — how its calls render: `terminal | file | browser | web | quest |
checklist | schedule | data | text`, null = log-only (hidden unless "All
calls") — and `streams: true` when it reports progress while it runs: `run()`
gets `progress({ append | text | data })`, kept on `activity.calls[i].progress`
(throttled to 10/s, 4K tail) and shown before the result lands (term.run
streams its output this way, NDJSON from `POST term/run {stream: true}`). MCP
servers declare `"view"` in mcp.json (forwarded by `mcp/tools`); agents are
`quest`. Tool messages carry `view`. Artifacts publish UI snapshots:
`Artifact.live()` → `{ view, data }`, the engine puts it in `state.live[type]`
(`{ title, view, data, version, at }`) only when it changed — after
refresh, after every tool stage and on every artifact change (an update
event, not a poll). Tabs: Call (the followed call by its view: live terminal,
file diff in the touched-files tree, quest/inputs → result), Files (the
filesystem artifact's tree, changed files marked, a file read fresh), Terminal
(runs in progress, background processes from term.start with their URLs,
recent runs), Checklist. Guide box: `engine.guide(text)` (team call `guide`)
adds owner guidance to the running work at its next step without stopping
it; an idle agent gets a message instead. "Following" keeps the newest call in
progress selected; a click pauses it. Restored tool messages take their inputs
from the step's tool plan; `viewOf()` fills `view` for older messages.

The host serves `agents/` read-only (`GET sources/<id>/<path>`). Only that
team loads (its first agent is the default lead) unless `--with-public`. Its
skills join the catalogue; its mcp.json merges into the MCP servers (paths
relative to `agents/`). A team keeps the applications only it uses in its
own `vendor/` (git-ignored with `custom/`); app-wide ones stay in `vendor/`.

## Integrations

`integrations/<name>/index.js` (git-ignored, private): connections to outside
services, configured from `.env`. `companion/integrations.js` loads them;
each default-exports `createIntegration({ env, log })` → null (not
configured) or `{ name, approval, tools: [{ name, description, inputSchema,
annotations, run }], listen?({ emit, signal }) }`. Tools reach agents through
the same host endpoints as MCP (`mcp/tools`, `mcp/call`), so `McpTool` serves
them (`telegram.send_message`). Listeners run only on continuous servers
(dev, `askk`: `createHostApi({ listen: true })`); events queue in the host
(`GET integrations/events`, long poll, `{ boot, next, events }`, capability
`integrations.events`). `backend/runtime/integration-bridge.js` (started by
the registry, one tab via Web Lock, cursor in localStorage) deposits each
message in the default agent (`EngineProxy.ask`) and sends the answer with
the event's `reply` tool. First: `integrations/telegram/` (TELEGRAM_BOT_TOKEN,
TELEGRAM_CHAT_ID; owner's chats only).

## Vendor applications

`vendor/` holds other applications ASKK borrows from, each a clean clone
(git-ignored; never edit or patch it) beside a script that starts the part
ASKK uses (`vendor/apple-fm/`). A team's own vendor apps live in the team
folder (`custom/<team>/vendor/`), reached through its mcp.json.

## Hardware features (optional, per machine)

Features that depend on the machine, not on an agent: each detects itself and is
left out (with a fallback) when the hardware or OS is missing. Browser side
`backend/hardware/` (catalogue `index.js`), host side `companion/hardware/`
(`loadHardware()`, once per process, used by `host-api.js`).

- `speech/` — capability `speech` (macOS; off with `ASKK_SPEECH=off`):
  on-device recognition with Apple's SpeechAnalyzer (macOS 26+) through the
  `askk-speech` helper (`companion/hardware/speech/asr.swift`, compiled with swiftc
  on first use into `~/.askk/bin/`, kept running, JSON lines), so any browser gets
  local ASR (`POST speech/transcribe {audio: base64 16 kHz mono PCM, locale}`,
  ~0.1 s per utterance); voices with `say` (`GET speech/voices`, `POST speech/say`
  → WAV; text on stdin). Browser: `microphone.js` (AudioWorklet → 16 kHz,
  adaptive-noise voice detector, pre-roll, hands-free or push to talk, barge-in
  guard), `recognizers.js` (mac, or Safari dictation via `lib/speech.js`),
  `voices.js` (Mac voices or speechSynthesis, sentence by sentence, `speakable()`),
  `narrator.js` (engine state diff → spoken lines: 1 answer/approval/error,
  2 quests/reports/failures, 3 every step), `pipeline.js` (`SpeechToSpeech`: mic →
  ASR → the desk lead's inbox; lead's state → narrator → voice; echo filter,
  "stop", yes/no approvals by voice; settings in localStorage `askk.sts`).
  Listen modes: `wake` (default) transcribes everything live but sends only what
  follows the wake word (`wakeWord`, "computer"; `splitWake()`), after a
  `commandPauseMs` (2 s) silence, so short pauses never cut a command; the wake
  word alone waits 8 s for the command; saying it interrupts the voice; a bare
  yes/no answers a pending approval. `direct`: every utterance is a command
  (hands-free after `endSilenceMs`, or push to talk), louder speech interrupts.
  Page `/sts` (`components/sts/`): the live orb (canvas: level, spectrum, phase),
  live caption, conversation timeline, team strip, settings sheet.

## Speech input

Dictation is Safari-only for now (WebKit: macOS Safari, every iOS browser),
using Apple's dictation; Chrome is off (audio goes to Google), Firefox has none.
`lib/speech.js` — `speechSupport()` (secure context, recognition, microphone +
permission) and `LiveTranscriber` (live text, restarts sessions that end on
silence). `lib/dictation.js` — `Dictation`: after each 1.2s pause the final
transcript is punctuated/grammar-corrected by the default model
(`createPunctuator()` in `backend/core/single-call.js`); corrections that change too many
words are ignored. `hooks/use-speech.js` wraps it for the chat composer's mic.

## Theme

- Dark mode is OLED black: surfaces (`--background`, `--card`, `--popover`,
  `--sidebar`) are pure `oklch(0 0 0)`. Separate areas with borders, not
  grey fills. Avoid large `bg-muted` areas in dark mode.
- Font is Amarante (one weight, 400). Faux bold is disabled
  (`font-synthesis-weight: none`), so build hierarchy with size, not weight.
