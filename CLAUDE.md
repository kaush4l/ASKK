@AGENTS.md

# Philosophy

ASKK is a team of agents you can watch work. The repo holds the core (`backend/kernel/`: agents, tools,
artifacts, teams — plain code) and the live UI; a desk (`custom/<desk>/`) holds a team's agents and tools; when
the server starts a desk, the host provides the infrastructure and every tab follows it. Nothing runs in the
background unseen: every kernel element has a UI twin, fed by the team stream — an agent its page, a tool call
its row in the Live feed drawn by the tool's view, an artifact its view, a refused answer its row, a model call
its stats, the desk's background work its log line. A change that adds a kernel event or field adds its view in
the same change. Behaviour lives in the kernel, the desk and `backend/live` stores, never in components. The
owner can stop anything. Full text and a checklist for changes: `docs/philosophy.md`.

# Project rules

## Where things run

The UI is a static export (`output: "export"` in `next.config.mjs`): no API routes, route handlers, server
actions, middleware, `cookies()`/`headers()`, ISR or runtime `next/image`. Interactive components are
`"use client"`; read query strings in the browser (`useSearchParams` under `<Suspense>`). The agents run in the
desk server (Bun), never in the tab: the page reads their state from `GET /__askk/team/stream` and acts through
`POST /__askk/team/call`. Without a desk server (a static copy, another device) every page says how to start one
(`detectHost()` mode `offline`) — or, 2026-10-20 owner ("the hosted version can use API calls to local host or OpenAI
compatible endpoints … a single long running agent"), runs one agent in the tab (mode `browser`, below: the hosted
version), the only agent that ever runs in a tab. Verify every mode on the live server (owner 2026-10-20: "Do not ever
run things outside the live view"): no side builds, static servers or preview ports — the live server's header menu
switches a tab to the in-browser agent and back.

## Run

- `bun run dev` (`scripts/dev.js`): the Next dev server (hot reload) as a custom server that also hosts the desks
  (`companion/server/desks.js`) and their host API same-origin under `/__askk/`. The core desks (`desks/`, tracked:
  `desks/agent`) are hosted beside `--desks custom` (default; a local desk named like a core one wins) — every desk in
  one process; `--desk <name>` the one a tab opens; `--only a,b`; `--agents custom/<desk>`
  (or `ASKK_AGENTS`) hosts one desk alone on its own port and `.next-desks/<name>` build (Next allows one
  `next dev` per build folder); `--port`, `--hostname`, `--read-only`. A request reaches a desk by the
  `x-askk-desk` header (scripts: server.json names it) or the `askk_desk` cookie (the header's desk switcher,
  `components/shell/host-status.jsx`: `GET desks`, `POST desks/select`), else the default desk. `POST desks/load
  {name}` hosts `<desks folder>/<name>/` without a restart, or reloads a hosted desk with fresh modules (409 while
  it works or a run it accepted waits to start; a failed reload keeps the previous version; 403 for a linked
  folder or a `--read-only` server) → `{name, agents, reloaded}`.
- Always on: the launchd agent `askk.desks` (`custom/launchd/askk.desks.plist`, KeepAlive, port 1111, log
  `custom/server.log`; it runs `bun run dev -- --desks custom …`, not `bun --bun scripts/dev.js`, whose
  Turbopack PostCSS worker cannot spawn node under launchd). Restart it only when `GET /__askk/desks` shows
  `"work":[]` for every desk (`launchctl kickstart -k gui/$(id -u)/askk.desks`). Never run `next build` while a
  dev server runs.
- `bun run build:companion` → `dist/askk` (`companion/server/server.js`): the same desks with the built UI.
- `bun run send -- --agents custom/<desk> [--agent <name>] [--from <source>] [--start] [--unless-booked <min>]
  [--wait] "text"` (`scripts/send.js`): work for an agent (default: the lead). Server up → `team/send` (with
  `--wait`: `team/call ask`, the answer on stdout; exits 0/1/2/3/124); down with `--start` → it starts
  `askk.desks` (kickstart/bootstrap, else a detached `bun run dev --desks`), waits, sends; still down → the text
  is booked in the desk's wake book and runs when the server comes up. Cron lines call this.

## Mobile-friendly

Design every screen for phones first, then scale up.

- No horizontal page scroll at 375px wide.
- Touch targets at least 40px on touch devices (`pointer-coarse:size-10`).
- Form inputs at least 16px font on mobile so iOS doesn't zoom.
- Use `svh`/`dvh` for full-height layouts, not `vh`.
- On mobile the sidebar is an overlay; navigation from it must close it (`setOpenMobile(false)`).
- Verify at a phone viewport (e.g. 390x844) as well as desktop.

## Bun built-ins first

Before adding a library or hand-writing a utility, check what Bun ships
(`bun -e 'console.log(Object.keys(Bun))'`; docs at bun.com/docs). Bun 1.4 has
`Bun.markdown` (html/render/react), `Bun.YAML`, `Bun.TOML`, `Bun.JSON5`,
`Bun.Image`, and more. These run only in the Bun runtime (the server, build scripts, tooling), never in the
browser: browser code needs a browser-compatible implementation.

## Stack

Bun + Next.js (App Router), plain JavaScript (`.js`/`.jsx`, no TypeScript), Tailwind v4, shadcn/ui
(`base-nova`, `tsx: false`). Run scripts with `bun --bun`. Add components with
`bunx --bun shadcn@latest add <name>`.

## The core (`backend/kernel/`)

Plain JS, no host or worker dependency (runs in the server, a tab, a test). `index.js` exports it all and is the only
import from outside the kernel. `README.md` is the map: every file, the lifecycle (host start → desk build → run →
what is saved where), the twin contract.

- `agent/agent.js` `Agent`: one ReAct loop (render → infer → parse → answer or run the step's calls together),
  callbacks `on(start | think | step | call | result | gate | format | guide | answer | error | chat)`. `step` carries the
  model call (`ms`, `prompt_chars`, `reply_chars`). `call {tool, input, index}`, `result {tool, ok, output, input,
  index}`: `index` = the call's place in its step, `tool` = what ran (a prefixed member resolved); the host pairs a
  result with its call by `index`, never by tool name. `gate` = an answer refused (open checklist, report missing
  fields, `minCalls` not met; `held`: guidance arrived while it answered), `format` = a reply with neither calls nor
  an answer; the agent goes on. An artifact's `gate()` returns a reason (text) or `{reason, hard: true}` (2026-10-17
  critic): a hard one refuses however often the answer comes and never counts toward `gateRetries` (the others do:
  after `gateRetries` refusals the answer goes through flagged); the run still ends at `maxSteps`. `guide(text, from)` (running only, else false): a note the next step's prompt shows
  under `# OWNER GUIDANCE` right after the request, once. The prompt's order (2026-10-17 owner): soul → `# YOU ARE` +
  role → artifacts → `# REQUEST` (+ `# OWNER GUIDANCE`) → `# EARLIER RUNS` → `# WORK DONE ON THIS REQUEST` →
  `# TOOLS` → `# RESPONSE` (map: `backend/kernel/README.md` (d)). Every prompt part carries its own instructions: `# RESPONSE`
  (`agent/reply.js` `RESPONSE_FORMAT` + `agent/report.js` `REPORT_FORMAT`, unless `config.system` replaces it), a
  tool its description, an artifact its head line, the run's state its header — a role (`config.role`) says only what
  the agent is for and how it works. `context` (`new Agent(config, {infer, tools, artifacts, context})`): spread into
  every tool call's ctx as `{...context, agent, signal}`, so a tool reaches the host (`ctx.host`) without globals.
  Before each step's render it awaits every artifact's `refresh(agent)` (`refreshArtifacts`; a failure or a hang past
  `config.refreshMs` ?? 15 s is one line in that artifact's block, never fatal). Images (2026-10-18 owner: "the
  screenshot will be included along with the next request and the agent can iterate over in order to complete a live
  artifact and I can also observe it"): after the render, `collectImages()` awaits every artifact's optional
  `images(agent)` → `[{media_type, data (base64), caption, ref}]` (≤ 3 per call, each ≤ 3.5 MB, png/jpeg/webp/gif; a
  throw or a hang drops that artifact's images, never the step) and the model call is `infer(prompt, agent, {images})`
  (no images: `infer(prompt, agent)` as before; every infer wrapper forwards the third argument); the `step` event
  carries `images: [{caption, ...ref}]` — refs only, never the data. `model/llm.js` `complete({…, images})`: OpenAI
  `image_url` data: URL parts / Anthropic base64 image blocks, each after a `(caption)` text part. `addArtifact(artifact, {commands,
  gate})`: `commands` keeps only those commands (the part after `<id>.`; an unknown one throws), `gate` goes to
  `attach(agent, options)`. `twin().spawned`: `{by, goal, at, keep, team}` for an agent spawned at run time, else null.
  2026-10-17 owner ("talk with the lead to understand what is currently already there and what I want to check"):
  `chat(text, {from})` → `{answer, guided, proposed, ms, prompt_chars, reply_chars}`, one model call outside the run
  queue (it never waits for, blocks or changes a run); prompt `render(request, steps, {chat})` = a step's sections
  (`# REQUEST` "(idle: no run in progress)" when idle) with `# OWNER CHAT` (the last 6 exchanges, each side ≤ 800
  chars) and `CHAT_FORMAT` as `# RESPONSE` (without options the prompt is unchanged). Only the reply's final non-empty
  line acts (`parseChat`, 2026-10-17 critic: a QUEUE: line quoted from a file started a run as the owner's), and only
  outside a ``` fence and not a blockquote or list item: `GUIDE: <note>` → `guide()` while running (`guided`);
  `QUEUE: <request>`, or a GUIDE with no run to guide → `proposed` (the text, else null) — neither the kernel nor the
  host ever starts a run from a chat, the owner does with one click; every other line stays in the answer. Each chat
  its own `AbortController` (`chatting`: the ones in flight); kept in `chats` (≤ 12, never in a run's prompt); event
  `chat`; a throwing infer rejects without it. `current` → `{request, steps}` of the run in progress (null idle).
  `stop(reason)`: every run of the agent — in progress or queued, whoever started it (the host, a quest, a dispatch:
  each run its own `AbortController` linked to `ask`'s signal) — ends "stopped" at its next step boundary, and every
  chat in flight rejects "stopped" at once (its GUIDE never delivered) → how many runs and chats; `busy`: a run
  accepted and not ended.
- `tool/tool.js` `Tool` (`name, type, view, description, input, run`; `spec()` for the UI) / `AgentTool` (another
  agent; view `quest`): a function, an MCP tool, another agent, an artifact command — one TOOLS list. `view` says
  how the live UI draws a call (quest | checklist | schedule | web | board | list | data | text …); an artifact's
  commands take the artifact's view. A call to another agent is a brief `{requirement, ask, outcome}`
  (`QUEST_INPUT`, `questText`, refused without them). The same data call twice in a run within 3 min answers from
  the first; an artifact called by name returns its view; old step results keep head and tail. `defineTool({name,
  description, input, run, view?, type?})`: the shape a desk's `tools/<name>.js` default-exports, checked at load
  (name `TOOL_NAME`, description, run, input `{field: "text"}`).
- `artifact/artifact.js` `Artifact` (latest state in every prompt, `commands()`, `gate()`, `live()` → `{view, data}`,
  `snapshot()`/`restore()`, `keep`: day | always | run | file; optional `refresh(agent)`, `attach(agent, options)`,
  `detach(agent)`; a refreshed artifact calls `changed()` only when its twin state differs; optional `poll` (ms,
  2026-10-17 critic: a live view froze while every holder waited): the host calls `refresh(<a holder>)` that often while
  a tab is on the stream; `gate()` → a reason or `{reason, hard: true}`); `artifact/board.js`
  `SharedBoard` (`detach()`, 2026-10-17: a dismissed team's board leaves its parent's children); `artifact/checklist.js` (`requiredWhen(id)`: a "!" item may be skipped when it does not apply now),
  `artifact/quality.js` (`QualityMatrix`), `artifact/schedule.js` (the desk's next run).
- `builtin/index.js` the inbuilt kit, attached by name (2026-10-17): `BUILTIN = {tools: {name: (deskOptions) =>
  Tool}, artifacts: {type: (deskOptions) => (agent, spec) => Artifact}}` — tools `web.search`, `web.read`,
  `agent.spawn`, `agent.dismiss`, `agent.catalog`, `agent.update`, `desk.list|create|check|load|ask|read|propose` (2026-10-20);
  artifacts `files`, `terminal`, `preview`, `plan`, `dispatch`, `browse`, `talk`, `practice` (2026-10-20) (2026-10-17:
  no `stage` — folded into the preview; 2026-10-18 owner: no `charts` — a live dashboard is a page in the preview) — and `builtinKit(deskOptions)` (the catalogue bound to one desk: one
  instance per desk and id, id = the type; `{type, id}` another, `{type, commands}` a subset, `{type: plan, gate:
  true}` gated). Plain JS over `ctx.host` (refresh: `agent.context.host`); commands of
  files/terminal/preview/dispatch are type `dev` (never answered from the data cache); `changed()` only when
  the twin differs.
  `builtin/files.js` `Files` (view `files`, keep `always`; `files.list|read|write|edit|append|search|focus`; writes
  only in the holder's `writes:` globs (none: refused, the error names `writes:`), reads/list/search only in its
  `reads:` when set; never `.env*`/`.mcp.json`, and never what git runs as code (`gitExec`, 2026-10-17 critic: a
  member's `.git/**` lane planted a core.fsmonitor command that a wider lane's `git status` ran): a `.git` folder's
  `config` (`.lock`, `.worktree`), anything under its `hooks/`, a `.git` file — whatever the lane; adapter:
  `hostFiles` (fs/list, fs/read, fs/write) or a desk's own; state `{root, tree: [{path, size, mtime, dir}] ≤ 800,
  truncated, open ≤ 12, modified: [{path, by, at, op, added, removed, diff ≤ 80 lines}] ≤ 30, focus}`;
  `globCovers(outer, inner)`: whether a lane glob holds another, segment-wise, conservative — when unsure, false; a
  trailing `**` needs at least one more segment: `projects/**` never covers the bare folder `projects`, as `inLane`
  and the sandbox read it); `builtin/terminal.js` `Terminal` (view `terminal`, keep `file`;
  `terminal.run|start|wait|read|send|stop|list` over host term/*, with the holder's name and `writes` (none: []);
  two sessions per holder (2026-10-17): `run` in its `main` one (command after command, one at a time), `start` in
  its `long` one (kept running; the next start replaces it), ids `main`/`long`/`<agent>:main`; `run`/`start` take
  `lease` (2026-10-17, one GPU: `"gpu"` or a short name `/^[a-z][a-z0-9-]{0,19}$/`; the host's 409 reason — who holds
  it, what to wait on — passed on); prompt: every running session's header (`[gpu]` when leased) + last 50 lines, a
  finished one in one line; state `{sessions ≤ 12}`, each with `lease` (null when none));
  `builtin/dispatch.js` `Dispatch` (2026-10-17 owner: teams in parallel; id `dispatch`, view and kind `dispatch`, keep
  `file`): `dispatch.start {to, requirement, ask, outcome}` hands a quest's brief to one of the holder's agents
  (`target.ask` with the job's signal) and returns at once (≤ 6 running per holder), `dispatch.wait {ids?, seconds?}`
  (until one ends, `seconds` (300, 5..1800), owner guidance for the holder, or its run stops: the new reports ≤ 3000
  chars), `dispatch.read {id}` (≤ 20000), `dispatch.stop {id}` (only its starter), `dispatch.list`; the owner stops
  one job: `ownerCall("stop", [{id, job}])` → `{stopped: job}` (the host's team call target `artifact`; any other
  method throws); `gate()` refuses the holder's answer while one runs, a hard reason (never let through after
  `gateRetries`); no job outlives its holder's run (2026-10-17 critic): when that run ends for any reason (an answer,
  flagged or at `maxSteps`, an error, a stop) the jobs it left running stop with "<holder>'s run ended while it ran"
  (`attach` listens to the holder's `answer` and `error`, `detach` drops the listeners); prompt: the
  holder's own jobs (running with the target's status, undelivered report heads ≤ 600, ≤ 12 finished lines); state
  `{jobs: [{id, to, by, ask ≤ 300, status: running | done | failed | stopped, startedAt, endedAt, report ≤ 4000,
  error}] ≤ 40}`, brief "2 running · 5 done");
  `builtin/preview.js` `Preview` (2026-10-17 owner: "There will be need for only one preview pane" — the one pane the
  owner and the agents both watch, the stage folded in; id `preview`, view and kind `preview`, keep `always`, `poll`
  3 s). Two uses: LIVE — pages over host browser/* (`preview.open|goto|click|type|press|scroll|text|eval|console|shot|
  close`, the page = the newest open one unless `id`; each action answers with the page's text outline; `open` also
  puts the page in the pane, a `#view` in its URL its view): the running app, a training dashboard, a build; EXPLAIN —
  visuals: `preview.show {id, title, says?, visual}` draws or redraws (same id) and puts it in the pane; `visual` = a
  `builtin/visual.js` `checkVisual` spec (flow, steps, matrix, line, bars, tokens, scatter, compare; inline ≤ 24 KB, a
  bad one refused with its kind's shape), `{file: "<workspace>.json"}` (re-read ≤ every 3 s, coalesced, the last good
  kept with an error line, only in the holder's `reads:`, saved as its path), or `{terminal: "<session>"}`
  (streamed; an old `{chart}` is refused, and dropped on restore); `preview.focus {id, view?}`, `preview.drop {id}`. The
  owner asks about what is in the pane: `ownerCall("ask", [{id, text, on?, context?}])` (team call target `artifact`)
  records the question (≤ 40, answered dropped first) with `on` (the item shown) and `context` (what the owner pointed
  at) → `{ask, deliver, keeper}` (keeper: the first holder of `preview.answer`; any other method throws); the keeper
  redraws or draws the visual that answers and replies with `preview.answer {ask, text, show?}` (show: the item it
  points to, put in the pane); `gate` holds its answer while a question is open. Prompt text only, ≤ 60 lines: open
  pages (url, title, console errors, the last outline), each visual one line, what is in the pane, the open questions,
  the last 3 answered. The agent sees its pages (2026-10-18): each page action (open, goto, click, type, press, scroll,
  shot) marks the page that holder acted on; `images(agent)` gives the newest shot of it once per shot (host `GET
  browser/image`), so the next step's model call carries it — write a page, look, fix, look again, while the owner
  watches the same page; the step row in the agent's thread shows each screenshot the model saw (`SeenShots`,
  `components/agents/thread.jsx`; kernel-team step rows carry `images`). State `{pages ≤ 12, visuals: [{id, title, says, visual, by, at, error?, read_at?}] ≤ 16,
  current: {kind: page | visual, id, view?} | null, asks: [{id, text, on, context, from, at, answer: {text, on, by,
  at} | null}] ≤ 40, revision}`; `snapshot`/`restore` keep visuals, asks and current, the pages are the host's).
  2026-10-17 owner ("see every step and … zoom into granular token level … the script attached with view elements
  such that on changing the architecture, the visuals can also be updated"): DRILL-DOWN — `open: "<id>" | {id, params
  ≤ 8}` on flow nodes, steps, bars, tokens, scatter points, line series (`"{x}"` = the clicked point's x) and matrix
  `open_rows`/`open_cols`; a file visual may be `{file: "…/{run}/{t}.json", params}` (values `[A-Za-z0-9_.-]{1,40}`,
  never only dots or a leading `-`; the resolved path under the drawer's `reads:`); `preview.focus {id, view?,
  params?}`; twin `current.params` and `trail` ≤ 8; owner calls `open [{id, visual, params?}]`, `back [{id}]`,
  `rerun [{id, visual}]` (team call target `artifact`, awaited, never a run). TOKEN DETAIL — tokens `id?`,
  `surprisal?` (bits, else −log2 p), `target?`, `open?`, visual `color: surprisal | p | entropy`, `range`; matrix
  `cells` (≤ 12 chars, or per frame `frames[i].cells`); any visual `meta` (≤ 12 scalars, one line). BOUND SCRIPTS —
  `preview.show … bind: {command, watch ≤ 8, cwd?, lease?, timeout? ≤ 600}` on a `{file}` visual: the file in the
  binder's `writes:`, each watch glob starting at a folder and covered by its `reads:` (`globCovers`), never matching
  its own file or another bind's file (nor a new bind's file under another's watch); when a watched file is newer than
  the last run (or the file is missing) one host terminal session runs it (slot `viz`, name `viz:<id>`, the binder's
  writes; one at a time; the same bind at most every 10 s on input changes); exit 0 re-reads, else the last good
  visual stays with the error; twin `bind {command, watch, cwd, lease, timeout, by, writes, reads, running, session,
  ran_at, ran, inputs_at, exit, ms, error, waiting}`. UI: clickable elements (zoom-in cursor, ≥ 40 px on touch via
  `hitStroke`), a breadcrumb + Back, the bound line + Re-run, the meta line, token heat with top-k;
  `builtin/browse.js` `Browse` (2026-10-18 owner: "not just get but also be able to navigate the web"; id `browse`, view
  and kind `browse`, keep `day`): a text web browser on the host, a tab per holder — `browse.open {url}` (host
  `web/page`: the text in 4000-char parts, each link "text [n]", each form "[form Fn: …]"), `browse.search {q,
  source?, limit?}` (a results page to click through), `browse.click {link: n | words}` (equal word matches → asks for
  the number), `browse.back` (from memory, ≤ 6 pages kept per tab), `browse.more {part?}`, `browse.find {text}`
  (narrowText over the whole page), `browse.links {filter?}`, `browse.submit {form, fields}` (GET forms only — a POST
  form is never sent: it would change something on another site); type `dev`; prompt: the holder's tab (where, part,
  links, forms, the back list); state `{tabs: [{agent, url, title, part, parts, links, forms, at, history ≤ 12}],
  visits ≤ 40}`; snapshot keeps no text (a restored tab is fetched again when read); UI `BrowseView` (each tab's page
  a link the owner opens, the back list, recent visits); the Live feed draws its calls with the web look.
  `builtin/talk.js` `Talk` (2026-10-18 owner: "I want to talk with the desk to understand and guide the build. The desk
  should be able to talk with me too. The work and build can run in the background."; id `talk`, view and kind `talk`,
  keep `always`): the desk's side of the conversation — `talk.say {text}` (≤ 1500 chars: a result with its numbers, a
  finding, what runs now; the same note twice refused), `talk.ask {question, options?}` (≤ 4 options `|`-separated, each ≤ 160 chars or refused, ≤ 3
  open per agent; no gate — the work goes on), `talk.drop {ask, reason}` (its asker only); type `dev`; the owner:
  `ownerCall("reply", [{id, ask, text}])` → `{reply, deliver, keeper}` (keeper = the asker: the host's artifact call
  hands `deliver` to it — guidance while it runs, else a run), `ownerCall("seen", [{id, upto}])` (read up to a message,
  shared by every device); prompt: the last 8 messages and the holder's open questions; state `{messages: [{id (m/q/r<n>),
  kind: say | ask | reply, from, text, options, re, status: open | answered | dropped, reason, at}] ≤ 80, seen,
  revision}`; UI: the home page's "Talk with the desk" (`components/talk/desk-talk.jsx` `DeskTalk`, pure
  `backend/live/talk.js`: `talkTimeline` merges it with the lead's chat rows, oldest first; `openQuestions`,
  `unreadCount`; `replyTalk`, `seenTalk`) under the lead's box — an open question's options as buttons and a reply box —
  and the artifact view `TalkView`; the Live feed draws its calls with the `talk` look.
  `builtin/web.js` (`web.search {q | query, limit?, source?}`: a 429/5xx from wikipedia/arxiv/hn retried once on web
  with a note, else the 2-minute advice; `web.read {url, find?, max_chars?}` narrowed with `narrowText`).
- 2026-10-20 owner ("most workflow where special agents are created can actually be substituted by understanding the
  agent capability … the multi-agent setup now becomes a checklist"; "give the agent the capability to self-reflect"):
  `builtin/practice.js` `Practice` (type `practice`, one per agent `<agent>.practice`, view `practice`, keep `file`): the
  agent's standing orders in `memory/<desk>/practice/<agent>.md` (seeded from `practice.md` beside its agent.md) —
  Checklist / Quality / Instructions / Lessons / Tools / Changelog; each run its Checklist items + `!reflect` (gate),
  `.tick`, `.skip`, `.edit {section, old?, new?, why}` (logged, from the next run), `.reflect {worked, missed, changes}`
  (retro → `memory/<desk>/retros/<agent>.md`; refused when it names a change none was made); store: compose.js
  `practiceStore`. `builtin/spawn.js` also `agent.catalog {find?}` (what a helper can be given, the helpers now),
  `agent.update {name, …, keep?}` (rebuild from `config.spawned.input`, the spawn record; dismiss `reason: "update"`),
  `respawn(desk, records)`. Kept helpers (`keep: desk`, spawner in `agents/`): `companion/team/kept.js` writes
  `agents/<spawner>/<name>/agent.md` (+ `keep: desk`, `by`, `at`; members as subfolders), kernel-team respawns them at
  start with their runs, dismissed → `memory/<desk>/archive/agents/<day>-<name>/`. `builtin/desks.js` `deskTools()`:
  `desk.create {name, spec, update?}` → host `desks/create` (`companion/team/scaffold.js`: config only — main.js from one
  template headed `// made by desk.create`, agents/ with practice.md, teams/, init folders — composed in a draft first;
  `update` only while the mark heads main.js, never through a link, never orphaning a folder of kept helpers; a spec's
  text never leaves main.js's one comment line), `desk.check`, `desk.load`, `desk.ask {name, text, wait?}` (host
  `desks/ask`: wait → an id, polled with GET `desks/ask?id=`; desk to desk: never asked back with a wait while it waits on
  the asker (409), ≤ 6 asks per pair in 10 min (429)), `desk.read {name, path}` (host `desks/read`: another desk's
  workspace through its own fs/*; a reader with `reads:` only where its lane names `desks/<name>/…`), `desk.list`, `desk.propose` (tool code → `custom/<desk>/proposed/tools/`, never loaded; the owner moves it
  into tools/). `conventionDesk({init})`: `async ({dir, memory, log, host, port})` before the agents are built.
  The core desk `desks/agent/` (tracked, hosted beside the local `custom/` desks: `companion/team/desk.js`
  `hostedDeskFolders`, `CORE_DESKS`; a local desk named like a core one wins; desks/load finds either; desks/create writes
  into the local folder): one agent with the kit — routes itself / helpers / a new desk — and its practice.md seed.
- `builtin/plan.js` `Plan` (extends `Checklist`): the desk's checklist written at run time (the planner's): id
  `plan`, view `checklist`, keep `always`, no reset on run start; `plan.write {goal, items}` ("id: text" lines, "!" =
  required; replaces the open items, keeps a ticked/skipped item still listed, bumps `revision`, records `by`),
  `plan.tick {id, evidence}`, `plan.skip {id, reason}`; `gate()` only for holders attached with `{gate: true}`
  (while an item is open, or no plan yet). State `{goal, revision, by, at, items: [{id, text, required, status: open
  | ticked | skipped, note, by, at}]}`.
- `builtin/spawn.js` `spawnTool()` / `dismissTool()` (`SPAWN_TOOLS`; type and view `spawn`): `agent.spawn {name, role,
  goal, tools?, artifacts?, keep?: run | desk}` → a helper for a stated goal (name `SPAWN_NAME`; tools ⊆ the caller's
  own or the desk catalogue `env.tools`, never its agents or artifact commands; artifacts = ids the caller holds or
  `env.artifacts` types, `{type | id, commands?}`, never another agent's run checklist; keep `run` (default): dismissed
  when the caller's run ends) → "spawned <name> — quest it with <name> {requirement, ask, outcome}";
  `agent.dismiss {name}` (only its spawner; its helpers go with it). 2026-10-17 owner ("let the lead, when required,
  create a sub team to focus on special critical observation and in control on a layer"): `members: [{name, role,
  tools?, artifacts?, writes?, reads?, model?, max_steps?, board?}]` → the helper leads a TEAM on its own
  `<name>.board` under the caller's, every member bounded by the CALLER as the helper is (one failing builds nothing);
  `template: "<team>"` → a team from `env.templates` (a desk's `teams/`: role, goal, tools, artifacts, lanes, model,
  max_steps, members; the input's own fields win; members named `<team>-<member>`; unknown → the error lists them);
  `writes`/`reads` NARROW the lanes (default the caller's): each positive glob covered by one of the caller's
  (`globCovers`), else "outside your lane", the caller's `!` exclusions appended (a caller without `reads` reads
  everywhere, so any `reads` is narrower); `model` one of `env.models` when listed; `max_steps` 1–300;
  `description` (its twin, its card, a member's line in its lead's TOOLS) and `title` (its board's) from the input or
  the template, else the role's first line that is not a section header (`roleLine`: not SPEC, RUNBOOK, …; 2026-10-17
  critic: every station showed "SPEC"). A team → "spawned team <name> (lead <name>; members a, b; board <name>.board)
  — quest or dispatch <name> {…}"; keep `run` dismisses it whole; dismissing a member alone is refused (dismiss the
  team). A member holds only what it lists (no default to its lead's holdings).
- `desk/desk.js` `buildDesk(spec, env)`: nested agent specs → live agents; an agent holding agents leads a team with a
  `<team>.board`; a spec's `tools` take names, typed specs, instances and `(agent) => Tool` factories; `env.context`
  (default `{}`) is every agent's `context`; a spec's `desk: "<name>"` marks a desk mounted under that agent
  (`agent.desk`, in `tree()` and `twin()`); a spec's artifact `{type, commands?, gate?}` (or `{artifact: instance |
  factory, commands?, gate?}`) says how it is held; `board: false` keeps an agent off its team's board (the critic;
  a team lead keeps its own). `Desk`:
  `agents()`, `boards()`, `artifacts()` (id → `{artifact, holders}`), `tree()` (nodes with `spawned`), `twin()`,
  `on()` (taps: they hear agents added later, and the desk's `spawn` / `dismiss` events). The agent set is not fixed:
  `desk.ctx` keeps the build context, every agent has `home` (its Desk), `depth`, `parentBoard`;
  `spawn(spec, caller)` builds a helper through `buildAgent` (unique name, maxDepth; soul, model, models, fallbacks,
  maxSteps, report, system, `writes`/`reads`/`board` copied from the caller; the caller's team and context; the caller's
  `AgentTool` "<name>: <goal>"; a failed build is undone; a team name whose `<name>.board` id is already in the desk
  — the desk's own team, another spawned one — is refused "<name>.board exists: pick another team name", 2026-10-17
  critic: the second board had no UI twin) and emits `{event: "spawn", agent, by, goal, keep, team}`;
  a spec whose tools hold members (`{type: "agent"}`, any depth) wires EVERY agent built (home, context, taps, the
  caller's config unless its own spec sets it, `config.spawned {by: its builder, goal, at, keep, team: the top's
  name}`, the holdings bound) and emits one `spawn` per agent, the top first;
  `dismiss(name, by)` (refused while it or a helper of its runs, or when `by` did not spawn it; a team member alone
  refused) removes it everywhere — a team whole, members first, each team board `detach()`ed — and emits `dismiss`.
- `twin()`: every element as plain JSON for its UI twin — `Tool`/`AgentTool` (+ `agent`), `Artifact` (kind, view,
  owner, title, keep, brief, state; a board's `{goal, entries}`; a list's `items`), `Agent` (definition, tool twins,
  agents, artifacts, desk, spawned, status), `Desk` (lead, tree, agents, artifacts with holders).
  `companion/team/kernel-team.js` streams agent definitions and artifact views from them.
- `model/llm.js` (`complete`: OpenAI-compatible or Anthropic wire; local providers through the host's
  `/__askk/llm/<provider>/v1`, `model.host` says where), `util/text.js` (`narrowText`: passages around `find` terms), `util/yamlish.js` (2026-10-18: `parseYamlish`, an indentation-aware YAML subset — maps, lists of maps, nesting, the reply format's scalars; null when a line does not fit — for a structure an agent wrote as text: preview.show reads a `visual` written as indented `key: value` lines with it, and folds the reply format's list reading of one back into the spec).
  Tests in `test/`: `agent.test.js`, `kernel.test.js`, `prompt.test.js`, `text.test.js`, `twin.test.js`,
  `hold.test.js` (refresh, commands subset), `plan.test.js`, `spawn.test.js`, `builtin.test.js` (the catalogue, sharing,
  the twin states), `builtin-files.test.js`, `builtin-terminal.test.js`, `builtin-preview.test.js` (pages, visuals,
  the owner's asks: the stage's tests moved in), `builtin-web.test.js`, `builtin-browse.test.js`, `builtin-talk.test.js` (each over
  `test/fake-host.js`), `builtin-visual.test.js` (`checkVisual`), `builtin-dispatch.test.js`,
  `team.test.js` (spawned teams, templates, lanes, `globCovers`), `chat.test.js` (`Agent.chat`); `agent.test.js` also
  `Agent.stop` (queued runs, a quested member).

## Desks (`custom/<desk>/`)

A desk is `custom/<desk>/main.js` (loader `companion/team/desk.js`) default-exporting `({dir, env}) => ({ name,
title, description, port?, mcp?, integrations?, setup?, host?, start })`. `start({port, live, log, memory})` →
`{desk, ready?, run?}` builds its agents on the kernel; `run({wake, busy, log})` → stop is its background work
(watchers) on a continuous server. `host({call, env, state, dir, root, listen})` → `{wrap?, guard?, servers?}`
shapes `mcp/call`: `wrap`s layer around every MCP / integration call, `guard` is the outermost (the desk's own
checks, kept where agents cannot write), `servers` add tool servers. Folders: `agents/` (agents as folders,
nested by team: `agent.md` with `description`, tools, model; the body is the role; a spec `folder` puts each
agent's transcript beside its agent.md), `tools/`, `vendor/` (git-ignored), `data/` (the workspace), `state/`
(host state). Memory and reports: `memory/<desk>/` at the repo root (2026-10-17 owner; git-ignored, never pushed;
`companion/shared/paths.js` `memoryFolder`, `ASKK_MEMORY` moves it; programs in the terminal never read it). Projects
outside ASKK (2026-10-17 owner: "load a new project location and the agent can work on the project"): main.js
`projects: true | {name: path}` (paths relative to the desk folder, loaded at start) lets the owner load folders on the
`/projects` page (`POST projects/load`, kept in `memory/<desk>/projects.json`); each is `projects/<name>/` in the desk's
workspace and gets a `.agents/` folder that ignores itself (`.agents/.gitignore` = `*`) for what the agents set up
there. Desks are local workflows: each documents itself in its own
README, and none is ever added or committed (owner 2026-10-17). Desk tests: `bun test ./tests` in the desk folder (plain `bun test` walks vendor/).
Code more than one desk may use lives in `custom/shared/`. `custom/` is git-ignored (its own repo), never pushed.
- The standard (`docs/standard.md`): a convention desk's main.js is `export default conventionDesk({title,
  description})` (`companion/team/compose.js`): `agents/<lead>/agent.md` (members as subfolders; `desks: [name]`
  mounts that desk's lead under the agent, composed with its own tools and main.js `compose` options; its ctx `desk`
  and `memory` are its own, `host` and `log` the parent's) + `tools/<name>.js` each `export default
  defineTool({...})`, tool names resolved at compose time (`composeDesk`: unknown keys, tools, models, artifacts or
  a desks cycle are Errors); built-in artifacts `checklist:` and `artifacts: [report]` (`<agent>.report.write` →
  `memory/<desk>/reports/`); the kernel's kit attached by name under the desk's own (the desk wins a clash;
  `builtinKit` bound once per composed desk, mounted desks share it; handed to `buildDesk` as `env.tools` /
  `env.artifacts` so `agent.spawn` resolves names at run time): `tools: [web.search, agent.spawn]`, `artifacts:
  [files, terminal, preview, {type: plan, gate: true}]` (entries `{type, id?, commands?, gate?}`), agent.md `writes:`
  / `reads:` (globs) and `board: false`; tools reach the host only through `ctx.host` (`hostClient`). Team templates
  (2026-10-17): `teams/<team>/agent.md` (members as subfolders, the same format) are checked like agents at compose
  time (an unknown key, tool, artifact or model fails naming the file; `desks`, `checklist`, `min_calls`, `after`,
  `team` refused; named after its folder), never built at start, and handed to `buildDesk` as `env.templates`
  (`{<team>: spawn input {name, role, goal, tools, artifacts, writes, reads, model, max_steps, board, members}}`, what
  `agent.spawn {template}` builds) with `env.models` (the model names). Also
  `readAgentFolder`, `loadTools`, `MODELS`, `llmInfer` (`custom/shared/kernel-desk.js` re-exports two).
  `bun scripts/tool.js check|run <file>`, `bun scripts/desk.js check <desk folder>` (the tree, tools and `templates`);
  fixtures and tests in `companion/team/fixtures/` (`kit-desk/`: the kit by name, `teams/probe` a template),
  `compose.test.js`.

## The desk server (`companion/`)

- `server/desks.js` `hostDesks({folders, port, defaultDesk, readOnly, root?})`: per desk its team, host API and
  integrations (one Telegram listener per bot: a desk listens for the integrations no other hosted desk names);
  `handleApi` (`desks`, `desks/select`, `desks/load`; 2026-10-20 `desks/create`, `desks/check`, `desks/propose`,
  `desks/ask` (+ GET `desks/ask?id=`), `desks/read` — the kit's desk.* tools; `--read-only`: no create, propose or
  check — a check runs the desk's code), `announce` (each desk's `state/server.json`),
  `startTelegram`, `load(name)` (root: the hosted folders' parent; a reload ends the old team's streams so tabs
  reconnect, `forgetDesk` + `require.cache` under the folder; tested in `desks.test.js`). Used by `scripts/dev.js`
  and `server/server.js`. `findDeskServer(desk)` (desk.js) finds a running one.
- `team/kernel-team.js` `createKernelTeam({desk, port, log})`: the desk served as the team. `GET team/stream`
  (SSE: `snapshot {registry, states, kernel, log}`, then `state {id, patch}`, `kernel {artifact, boards?}`,
  `registry {registry, states}` and `kernel {tree, removed?}` when an agent is spawned or dismissed, `log {at,
  source, text}`), `POST team/call {target, method, args}` (`send`, `ask` [text, {from}], `stop` → `{stopped}`
  (2026-10-17: kernel `agent.stop()` too, so a member running a lead's quest or a dispatched job stops; the log says
  how many — its owner chats in flight counted too), `guide` [text, {from}] → `{delivered}` (a note for the run in
  progress; idle: false), `chat` [text, {from}] → `{answer, guided, proposed}` (2026-10-17 owner: talk with the lead;
  kernel `Agent.chat`, idle or running, never a run: the host never starts a run from a chat — `proposed` waits for
  the owner's one click, log `<agent> proposes to <from> (not started): …`; a chat in flight is in `work()` as
  `{agent, lead, run: "(owner chat) <question>", step: "answering the owner", since}`, so `stop` and desks/load's 409
  see it; log `<from> asks <agent>: …`; a throw or a stop → fail), `preview` (artifacts refreshed first),
  `clearMemory`; target `desk`: `schedule`, `unschedule`, `defaultGoal`; target `artifact`: `[{id, …}]` → its
  `ownerCall` (the preview's `ask` `[{id: "preview", text, on, context}]`: its `deliver` goes to its keeper —
  guidance while it runs, else a run → `{ask, keeper, delivered: guided | run}`; the dispatch's `stop` `[{id:
  "dispatch", job}]` → `{stopped: job}`: that one job, 2026-10-17); no target = the lead). An artifact with a numeric
  `poll` (ms, at least 1 s) is refreshed with a holder that often while at least one tab is on the stream, one
  refresh at a time (a failure: one log line a minute; no tab, or `terminate`: no polls). `POST team/send {text, agent?,
  from?}`. Each agent: its definition (description, role, folder, tool specs, artifacts held, model, team) and its
  state from kernel events (status, activity, messages — user, step, tool results with `view` and `inputs`, `gate`
  rows, guidance rows `{role: user, kind: guidance}` (not a new run), chat rows (the kernel `chat` event: `{role:
  user, kind: chat, from, content}` + `{role: assistant, kind: chat, content, guided, proposed}`, its model call in
  the stats, never the `working` request), answers — working, stats). Every artifact by id
  (`{id, kind, view, owner, title, holders, brief, state, items?}`), saved to `state/artifacts/<id>.json` and
  `state/days/<ET day>/<id>.json`, restored by `keep`. The desk's `log` (watchers, schedule, wakes, Telegram) is
  a ring of 300 lines streamed to every tab. Events also go to `state/kernel-team.jsonl`; each agent's runs to
  `<folder>/transcript.jsonl` (`kernel-transcripts.js`: restored at start, compacted past 512 KB). It runs the
  desk's `Schedule` and its wake book (`shared/wakes.js` `startWakes`, every 30 s: a due wake → its agent, else
  the lead; an error books one retry) on the desk's `data/state/wakes.jsonl`. No agent set is fixed at start
  (2026-10-17): on a spawn (kernel `Desk.spawn`) the new agent gets a fresh state and `config.folder =
  <desk state>/spawned/<name>/` with an `agent.md` record (by, goal, keep, tools, artifacts; body = role) so its
  transcript records; the registry is rebuilt and broadcast with its state, the artifacts scanned again (new ones
  restored by keep and watched, ones whose holders changed re-sent), `kernel.tree` re-sent, and the log says `<by>
  spawned <name>: <goal>`; a dismiss drops its state and sends `removed` ids. A spawned team (one `spawn` per agent,
  its lead first) is set up whole at its lead's event — every member's state and folder (`agent.md` with `team:`, the
  lead's with `members:`) in one registry event, the log `<by> spawned team <name> (a, b): <goal>`; dismissed, it
  leaves one agent per event, members first. `work()` and `agents` (a getter: the
  desks/load counts) read the live list. One `kernel {artifact}` per artifact change (the lead's `state.live` copy
  is gone).
- `team/kernel-telegram.js` (owner only, `shared/telegram-owner.js`; `TELEGRAM_OWNER_ID`, else
  `TELEGRAM_CHAT_ID`): messages → the lead (idle: a new run, answered as a reply; while it runs: guidance for that
  run, team call `guide`, read at its next step), `/queue <text>` (new work after the run), `/status`, `/stop`, one
  live status message per run edited in place (`kernel-live.js`, text from `kernel-status.js`, agent look from
  `backend/live/visual.js`). A chat row is a run nowhere on the server (2026-10-17 critic: a web Ask during a
  Telegram-started run lost that run's reply; /status showed the chat's question as the last run): one predicate,
  `kernel-status.js` `isRunRequest(m)` = role user and kind neither guidance nor chat (the tab's `backend/live/agent.js`
  twin), used by `followLead`, `leadRun`, `agentNow` and kernel-live's `lastRun` / `due` (its `slim()` keeps `kind`);
  `isRunWork(w)`: an owner chat in `work()` is no run the lead is busy with (a message meanwhile is new work).
- `server/host-api.js` `createHostApi({root, desk, team, port, readOnly, listen, hostPorts})`: `whoami`, `wakes`,
  `fs.read`/`fs.write` (`fs/list`, `fs/read`, `fs/tree`, `POST fs/write` revision-checked and atomic,
  `POST fs/delete`: links unlinked, never followed; non-empty folders need `recursive`; `fs/watch` SSE `change
  {paths}` debounced 300 ms; a desk's main.js `mounts: {desks: {root, allow(name)}}` makes `desks/<name>/…` that
  folder when allowed, realpath-contained, links refused; `files.js` `workspaceMounts`: `desks/` virtual, `projects/`
  an overlay — a loaded project is `projects/<name>/` beside the desk's own, in fs/* and term/* cwd, lanes and
  sandbox alike), `projects` (2026-10-17 owner, a desk with main.js `projects`: `capabilities/projects.js`
  `projectRegistry` — `GET projects` → `{projects: [{name, path, source: config | owner, at, missing, setup,
  workspace}], file}`, `POST projects/load {path, name?, setup?}` (absolute or `~/…`; never the home folder or above,
  a system folder (/private, so /tmp), `~/.<dot>`, `~/Library` or ASKK itself; `.agents/` made; `setup` — default when
  it has no `.agents/project.md` — gives the lead its first-setup run, from the owner), `POST projects/unload {name}`
  (the folder untouched); not when read-only), `term` (`capabilities/terminal.js`, not when read-only: PTY
  sessions (`Bun.Terminal`) of one program or an `&&` chain, no shell, under sandbox-exec (`sandbox.js`: the caller's
  `writes` lane, no `.env*`/`.mcp.json`/PATH folders, no other desk read, no desk server port; in every lane never
  what git runs as code or finds it from, `GIT_NEVER_WRITE` (2026-10-17 critic): a `.git` entry itself, its `config*`,
  `commondir`, `hooks/`, `modules/`, `worktrees/` — commits still write objects, the index and refs; a new repository
  is made host-side, outside the sandbox (the dev desk's `project.init` runs `git init`)) with the desk's
  `terminal: {toolchains, programs, timeoutSeconds, backgroundMinutes}` (`toolchains.js`); `POST term/start|write|
  wait|stop` (wait's `until`: literal text or [texts], any one, found with includes — never a regex; ≤ 300 chars, ≤ 8;
  start's `slot`: the agent's session of that slot takes the command — same id, `$ <command>` appended, 409 while it
  runs unless `replace`; start's `lease` (2026-10-17, one GPU: `"gpu"` or a short name): 409 `<lease> is held by <id>
  (<agent>: <command>) since <at> — terminal.wait it, then start again` while another running session of the desk
  holds it, checked again when a slot session takes its next command; the session summary carries `lease`, null when
  none), `term/list`, `term/read`, SSE `term/stream` (+ `run` when a slot session takes its next
  command); line view with `\r` and escapes handled; logs in
  `state/terminal/<id>.log` + `state/terminal.jsonl`; 6 running, 120 min each), `browser` (`capabilities/browser.js`,
  not when read-only: `Bun.WebView` pages on `localhost|127.0.0.1|[::1]:<port>` only, never a desk server port,
  closed when they navigate away; `POST browser/open|navigate|click|type|press|scroll|eval|text|shot|console|close` (2026-10-18: a navigate to
  the page's own URL at another #hash moves the hash, the same URL reloads — never a load wait that cannot end, `sameDocument`),
  `browser/list`, `GET browser/shot?id&n` → the PNG; `GET browser/image?id&n&max` → the same shot for a model (2026-10-18:
  `Bun.Image` JPEG ≤ max px wide, default 1280, 320–1568; base64 JSON); a screenshot after every change in `state/browser/<id>/<n>.png`;
  3 pages per desk, 6 per process), `web`
  (`web/search?q=&limit=&source=` → `{engine, query, results: [{title, url, snippet, source}], note?}`: `source` web
  (default: SearXNG when `ASKK_SEARXNG_URL`, else DuckDuckGo; failed, rate-limited or empty → fallback wikipedia +
  arxiv + hn round-robin, engine `fallback`, `note` says why) | wikipedia | arxiv | hn (official keyless APIs only);
  per-engine process-wide queues (`HOST_LIMITS.web.engines`: DuckDuckGo one at a time, 1.5 s between starts, rate
  limit retried 3 s / 8 s then skipped 2 min; arXiv 3 s apart), 10 min cache; `web/read`: public addresses only at
  every redirect, 40K text; `web/page?url=` (2026-10-18, for `browse`): the same checks, → `{url, title, type, text,
  truncated, links: [{n, text, url}] ≤ 400, forms: [{n, method, action, fields}] ≤ 20}` — links resolved against
  `<base>` and the address the redirects landed on, javascript:/mailto:/# dropped, password fields never listed, no
  script ever runs), `mcp` (`mcp/tools`, `mcp/call`: `.mcp.json` in the folder ASKK starts in plus the
  desk's `mcp.json`, stdio or Streamable HTTP, servers start lazily and stay up; `oauth-file.js` reads a shared
  bearer token under flock), `models.local` (`llm/<provider>/v1`: the claude/codex/gemini CLIs as plain completions
  in an empty temp folder, prompt on stdin, and Apple's on-device model, `capabilities/local-models.js`; images
  (2026-10-18): a message's `image_url` parts with data: URLs only (`chatBlocks`; a remote address is dropped, never
  fetched) reach the Claude CLI as stream-json image blocks (`--input-format stream-json`, the answer its result
  event); the other CLIs and Apple's model read text only — the prompt says how many were left out), `apple`
  (macOS: fixed programs with argument lists, never a shell, `hardware/apple/`), `speech` (`hardware/speech/`),
  `team`. A GET handler may answer with its own `Response` (a stream, an image); `close()` (a desk reload) stops its
  tool servers, listeners, watches, pages and terminal sessions. Security: Host header must be localhost:port (DNS
  rebinding), cross-origin refused, POST needs same-origin Origin + JSON, realpath containment (no symlink escapes,
  also for new files); agents can never write or delete `.env*` (except `.env.example`) or `.mcp.json`.
- Layout: `server/` (host-api, desks, server), `team/` (desk loader, kernel-*), `capabilities/` (files, web, mcp,
  oauth-file, integrations, local-models), `hardware/`, `shared/` (http, jsonl, time, paths, args `DESK_OPTIONS`,
  config, wakes, telegram-owner) for helpers used in 2+ places.

## The live UI (`backend/live/`, `components/`, `app/`)

- The hosted version (2026-10-20), `backend/browser/`: `desk.js` `buildBrowserDesk({store, connection})` — the kernel
  with one lead `agent` (role, practice seed: `LEAD`), tools `web.search`, `web.read`, `agent.spawn|catalog|update|
  dismiss`, artifacts `practice`, `dispatch`, `files`, `plan`, `talk`; `browserInfer` (the kernel's `complete` over the
  owner's OpenAI-compatible endpoint, from the tab); `host.js` `browserHost` — the host routes the kit calls, answered in
  the tab (`fs/list|read|write|tree|delete` over the store — the Files page's too: `backend/live/workspace.js` reads this
  browser's store in browser mode, the workbench's tree its files twin; `web/search` = wikipedia + hn, `web/read` = a
  public page that allows browser reads (never this computer or the local network, `privateHost`), a Wikipedia article
  through its API; anything else 501 "not in the browser"); `team.js` `createBrowserTeam` —
  the desk server's team protocol (snapshot, state, kernel, registry, log; calls send/ask/stop/chat/guide/preview/
  clearMemory, target artifact) from the same row builders (`backend/live/team-rows.js`, shared with kernel-team.js),
  kept in the store (runs ≤ 20, thread ≤ 200, artifacts by keep, kept helpers respawned; a run the tab closed on is
  marked interrupted); `storage.js` (`browserStore`: localStorage `askk.browser.*`, guarded; `memoryStore` for tests);
  `settings.js` (`PRESETS` Ollama / LM Studio / llama.cpp / OpenAI / OpenRouter / custom, `readConnection`,
  `saveConnection` (also switches the tab's agent on; `baseUrlProblem`: plain http only to this computer or the local
  network), `setBrowserAgent`, `wantsBrowserAgent`, `fetchModels`); `start.js` (one instance per tab, `setLocalTeam` in
  `stream.js`; a start a stop overtook ends its own team). `host.js` `detectHost`: a server answers → `local`,
  unless the owner switched this tab to its own agent (`browser`, with `server`); none → `browser` when switched on,
  else `offline`; `resetHost`; `registry.restart()`. UI: `components/browser/browser-agent.jsx` (`BrowserAgentSetup`
  on the offline home and in the header's dialog, `BrowserAgentBar` — model, Change, Stop), the header menu's "Run an
  agent in this browser…" / "Back to the desk server", the status bar's "This browser". Tests: `backend/browser/
  browser.test.js`.
- `backend/live/`: `stream.js` (`connectTeam`, `teamCall`; 2026-10-20 `setLocalTeam`: a tab's own desk instead of the server), `registry.js` (the one subscriber: opens the stream
  once per tab and feeds every store; `{status: connecting | ready | offline | error, agents, engines,
  requiredId, activeId}`, `select`), `agent.js` (`AgentView`: definition + immutable state replaced by patches;
  `send`, `ask`, `stop`, `preview`, `clearMemory`, `chat` (2026-10-17: team call `chat` → `{answer, guided,
  proposed}`; `askChat` never throws); `threadItems` folds each `kind: chat` question with its answer (`taken`: its
  proposed work already sent), `chatNote` "→ added to the run as guidance", `queueProposal(engine, proposed)` (the
  owner's "Queue it": `send`, never automatic), `isRunRequest` (a chat or guidance row is never the run's request)),
  `desk.js` (tree, boards, artifacts; `stopDispatchJob(id, job)` (the owner's Stop on one dispatched job: team call
  target `artifact`, method `stop`);
  `artifactsFor` — every artifact on its team's card, else its first holder's — `artifactsHeldBy`, `currentQuest`,
  `cardRows` / `cardArtifacts` (a spawned team's members indented under its lead on its card, every nested board
  there), `dispatchRows` (running first), `heldTiles` (2026-10-17: the live tiles under an agent's row on its card —
  what it holds, less the desk-wide ones every agent holds, which sit on the desk card), schedule calls; `holdings(engine)` (2026-10-18 owner: a small count of each agent's tools and artifacts) → `{tools, artifacts, agents}`, drawn at the end of every agent row on the home cards — artifact commands and quests not counted as tools), `preview.js` (2026-10-17: the preview's twin for the one pane, pure: `previewOf`, `previewItems`
  (pages + visuals), `currentRef`, `shownItem` (follows `current`; the owner's pick pauses it), `sessionOf`
  (a `{terminal}` visual's source twin), `pageMode` (a page live wherever it can be framed), `enlargeOf` (2026-10-18), `askThread`, `openAsks`, `askable` (an old twin
  without asks takes none), `askPreview(id, {text, on, context})` (team call target `artifact`, method `ask`), the
  page bridge in a frame: `frameCheck` (loopback only, never this UI), `frameSrc`, `viewMessage` (`{askk: "scene"}`:
  the wire word pages already speak), `frameStep`, `bridgeMessage` (`{askk: at | ask}` from the frame's own window
  and origin)), `visual-layout.js` (the visuals' geometry, pure: `flowLayout`, `linePaths`, `scatterScales`,
  `cellColor`, …),
  `log.js` (the desk log), `visual.js` (an agent's look, shared with the Telegram status; `callLook`: one colour +
  one icon per call kind — quest, web, terminal, mcp, artifact views, data, function, gate, guidance — the same on
  the canvas and the Live feed), `activity.js` (`describeActivity`), `team-tree.js`, `follow.js` (the Live feed:
  tool calls and gate rows), `wakes.js`, `workspace.js` (fs/* client), `host.js` (`detectHost`,
  `HOST_CAPABILITIES`), `base-path.js`. The canvas's pure geometry (no React, tested): `canvas-layout.js`
  (`layoutDesk`, `layoutToFit`, `placeAt`, `nodeRect`: agents from the tree, artifacts under their keeper, team and
  desk frames, edges), `camera.js` (`{x, y, z}`, `zoomLevel` far | mid | near, `fit`, `focus`, `glide`),
  `follow-target.js` (`followTarget`: the deepest agent at work, for follow; `questsOut`).
  `hooks/use-engines.js`: `useEngines`, `useEngineState(s)`, `useDesk`, `useDeskLog`.
- Pages: `/` home (`components/home/`: constellation, ask the lead, `components/kernel/desk-levels.jsx` team
  cards, activity, workspace), `/agents?name=` the agent page (`components/agents/agent-page.jsx`: role, tools by
  type and view, artifacts held, runs thread, next prompt, model calls; `/chat` redirects here), `/canvas`
  (`components/canvas/`: the free-form canvas of the desk — agents, their calls and artifacts, nested desk frames,
  follow), `/live` (`components/live/`: feed by tool view, Artifacts, Desk log, Schedule; `?tab=`), `/files` (`?path=`
  opens a folder), `/projects` (`components/projects/`, `backend/live/projects.js`: load a folder outside ASKK, the
  loaded ones set up or not, set up again, unload), `/sts`.
  2026-10-17 owner ("remove the stage view"): no `/stage` — its visuals and the owner's questions are the preview's.
  Home cards (2026-10-17 owner: "the agent card will show the live artifacts which on click will expand to bigger
  view"): under each agent's row the artifacts it holds as small live tiles (`heldTiles`; id, brief, the compact view
  as it changes; the desk-wide ones on the desk card); a click opens it big — a `Dialog` on a wide screen, a bottom
  `Sheet` (92svh) on a phone — with the artifact's whole view (the preview: the one pane with its Ask box).
  The one preview pane (`components/live/workbench/preview-pane.jsx` `PreviewPane`: the Live workbench's one Preview
  tab — a phone's Preview window — and the preview card opened big): a strip of the preview's items (pages and
  visuals, the current one marked), the item — a page (`PreviewView`: shot, live frame over the page bridge, console),
  a visual (`components/preview/visual.jsx` `PreviewVisual`: every kind drawn and animated with anime.js, one clock
  per visual, a click on an element → its context chip), a
  `{terminal}` (the terminal pane's `SessionView` stream) — the agent's `says`, and `components/preview/ask.jsx`
  (`PreviewQuestions`: open questions and recent answers, a click shows an answer's item; `PreviewAsk`: the owner's
  question on the item shown, with what was pointed at); it follows `current`, the owner's pick pauses it. Closed on a
  card (`components/preview/card.jsx` `PreviewCard`): the current item small + "N questions open".
  Enlarge (2026-10-18 owner: "preview can enlarge to a web page"; a training run's live dashboard is a page there): a
  page item (the pane's url bar, the closed card) opens `EnlargedPage` — the live page over the whole viewport (h-dvh,
  a nested `Dialog`), close and open-in-new-tab, its shot and why where it cannot be framed (`enlargeOf`).
  `components/views/artifact.jsx`: one renderer per artifact view (list, checklist, quality, board, schedule,
  text, memory, table, files, terminal, preview and `dispatch`: a row per job, status dot, `j2 → data`, the ask, elapsed, the report expandable, a Stop on
  each running row (`stopDispatchJob`); `runners` (2026-10-19, `components/views/runners.jsx`, pure `backend/live/runners.js`:
  a desk's live formulas — each runner's chart (price, the plots on its scale, the others in a lower panel, the bars its
  condition turned true), its state in a word (`runnerStatus`: holds | near | watching | warming …, how far and how many bars),
  the owner's pause / resume / compute now / stop / remove (`runnerCall`) and a start-or-test form (`startRunner`,
  `testRunner`), all team calls target `artifact`); unknown
  views show their state) used by the cards, Live and the agent page; a leased terminal session shows `LeaseBadge`
  (`gpu`) on the card and on the Live workbench's terminal tabs (`components/live/workbench/terminal-pane.jsx`).
  Ask (2026-10-17 owner: talk with the lead, idle or running): the composer (`components/chat/composer.jsx` `onAsk`),
  the home QuickAsk (`components/home/dashboard.jsx`) and the Live GuideBox (`components/live/guide-box.jsx`) call
  `chat` and show the answer (`ChatPair`, `components/agents/thread.jsx`; the thread draws chat rows as a compact
  Q/A pair, never a run; work an answer proposes shows "Proposed work: …" with a "Queue it" button — nothing starts
  until the owner clicks). Running (2026-10-18 owner: "I want to be able talk with the lead to understand the goal and direction" — a question
  typed while it ran went in as a Guide note, unanswered): Enter ASKS and Ask is the primary button (the answer here, the
  run goes on; its GUIDE: line may pass a note to the run), Guide and Queue are buttons; idle: Send stays the primary action.
- Status bar (`components/shell/status-bar.jsx`, in `app/layout.jsx`): host, one dot per agent (click → its
  page), the desk's newest log line, the selected agent's activity, model and model calls.

## Integrations

`integrations/<name>/index.js` (git-ignored, private): connections to outside services, configured from `.env`.
`companion/capabilities/integrations.js` loads them; each default-exports `createIntegration({ env, log })` → null
(not configured) or `{ name, approval, tools: [{ name, description, inputSchema, annotations, run }],
listen?({ emit, signal }) }`. Tools reach the desk through `mcp/call`; listeners run only on the continuous
server, and their events are read in-process (the desk's Telegram bridge). First: `integrations/telegram/`
(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID; owner's chats only).

## Vendor applications

`vendor/` holds other applications ASKK borrows from, each a clean clone (git-ignored; never edit or patch it)
beside a script that starts the part ASKK uses (`vendor/apple-fm/`). A desk's own vendor apps live in the desk
folder (`custom/<desk>/vendor/`), reached through its mcp.json.

## Hardware features (optional, per machine)

Features that depend on the machine, not on an agent: each detects itself and is left out when the hardware or
OS is missing. Browser side `backend/hardware/` (catalogue `index.js`), host side `companion/hardware/`
(`loadHardware()`, once per process, used by `host-api.js`).

- `speech/` — capability `speech` (macOS 26+; off with `ASKK_SPEECH=off`): on-device recognition with Apple's
  SpeechAnalyzer through the `askk-speech` helper (`companion/hardware/speech/asr.swift`, compiled with swiftc on
  first use into `~/.askk/bin/`, kept running, JSON lines), so any browser gets local ASR
  (`POST speech/transcribe {audio: base64 16 kHz mono PCM, locale}`); voices with `say` (`GET speech/voices`,
  `POST speech/say` → WAV). Browser: `microphone.js`, `recognizers.js`, `voices.js`, `narrator.js` (the lead's
  state diff → spoken lines), `pipeline.js` (`SpeechToSpeech`: mic → ASR → the lead; the lead's state → narrator
  → voice; "stop"; settings in localStorage `askk.sts`). Listen modes: `wake` (default: what follows the wake
  word "computer", after a 2 s pause) and `direct`. Page `/sts` (`components/sts/`).
- `apple` — host only (`companion/hardware/apple/`, `GET apple/actions`, `POST apple/run {action, inputs}`):
  Shortcuts, say, notify, clipboard, Spotlight, Reminders, open a link, for a desk's own tools. `docs/apple.md`.

## Speech input

Dictation is Safari-only for now (WebKit: macOS Safari, every iOS browser), using Apple's dictation; Chrome is
off (audio goes to Google), Firefox has none. `lib/speech/recognition.js` — `speechSupport()` and
`LiveTranscriber`; `lib/speech/dictation.js` — `Dictation` (live text into the message box);
`hooks/use-speech.js` wraps it for the composer's mic.

## Theme

- Dark mode is OLED black: surfaces (`--background`, `--card`, `--popover`, `--sidebar`) are pure
  `oklch(0 0 0)`. Separate areas with borders, not grey fills. Avoid large `bg-muted` areas in dark mode.
- Font is Amarante (one weight, 400). Faux bold is disabled (`font-synthesis-weight: none`), so build hierarchy
  with size, not weight.
