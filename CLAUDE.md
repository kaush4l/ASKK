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
(`detectHost()` mode `offline`).

## Run

- `bun run dev` (`scripts/dev.js`): the Next dev server (hot reload) as a custom server that also hosts the desks
  (`companion/server/desks.js`) and their host API same-origin under `/__askk/`. `--desks custom` (default)
  hosts every desk in one process; `--desk <name>` the one a tab opens; `--only a,b`; `--agents custom/<desk>`
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
  callbacks `on(start | think | step | call | result | gate | format | guide | answer | error)`. `step` carries the
  model call (`ms`, `prompt_chars`, `reply_chars`). `call {tool, input, index}`, `result {tool, ok, output, input,
  index}`: `index` = the call's place in its step, `tool` = what ran (a prefixed member resolved); the host pairs a
  result with its call by `index`, never by tool name. `gate` = an answer refused (open checklist, report missing
  fields, `minCalls` not met; `held`: guidance arrived while it answered), `format` = a reply with neither calls nor
  an answer; the agent goes on. `guide(text, from)` (running only, else false): a note the next step's prompt shows
  under `# OWNER GUIDANCE` right after the request, once. The prompt's order (2026-10-17 owner): soul → `# YOU ARE` +
  role → artifacts → `# REQUEST` (+ `# OWNER GUIDANCE`) → `# EARLIER RUNS` → `# WORK DONE ON THIS REQUEST` →
  `# TOOLS` → `# RESPONSE` (map: `backend/kernel/README.md` (d)). Every prompt part carries its own instructions: `# RESPONSE`
  (`agent/reply.js` `RESPONSE_FORMAT` + `agent/report.js` `REPORT_FORMAT`, unless `config.system` replaces it), a
  tool its description, an artifact its head line, the run's state its header — a role (`config.role`) says only what
  the agent is for and how it works. `context` (`new Agent(config, {infer, tools, artifacts, context})`): spread into
  every tool call's ctx as `{...context, agent, signal}`, so a tool reaches the host (`ctx.host`) without globals.
  Before each step's render it awaits every artifact's `refresh(agent)` (`refreshArtifacts`; a failure or a hang past
  `config.refreshMs` ?? 15 s is one line in that artifact's block, never fatal). `addArtifact(artifact, {commands,
  gate})`: `commands` keeps only those commands (the part after `<id>.`; an unknown one throws), `gate` goes to
  `attach(agent, options)`. `twin().spawned`: `{by, goal, at, keep}` for an agent spawned at run time, else null.
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
  `detach(agent)`; a refreshed artifact calls `changed()` only when its twin state differs); `artifact/board.js`
  `SharedBoard`; `artifact/checklist.js` (`requiredWhen(id)`: a "!" item may be skipped when it does not apply now),
  `artifact/quality.js` (`QualityMatrix`), `artifact/schedule.js` (the desk's next run).
- `builtin/index.js` the inbuilt kit, attached by name (2026-10-17): `BUILTIN = {tools: {name: (deskOptions) =>
  Tool}, artifacts: {type: (deskOptions) => (agent, spec) => Artifact}}` — tools `web.search`, `web.read`,
  `agent.spawn`, `agent.dismiss`; artifacts `files`, `terminal`, `preview`, `plan` — and `builtinKit(deskOptions)` (the
  catalogue bound to one desk: one instance per desk and id, id = the type; `{type, id}` another, `{type, commands}` a
  subset, `{type: plan, gate: true}` gated). Plain JS over `ctx.host` (refresh: `agent.context.host`); commands of
  files/terminal/preview are type `dev` (never answered from the data cache); `changed()` only when the twin differs.
  `builtin/files.js` `Files` (view `files`, keep `always`; `files.list|read|write|edit|append|search|focus`; writes
  only in the holder's `writes:` globs (none: refused, the error names `writes:`), reads/list/search only in its
  `reads:` when set; never `.env*`/`.mcp.json`; adapter: `hostFiles` (fs/list, fs/read, fs/write) or a desk's own;
  state `{root, tree: [{path, size, mtime, dir}] ≤ 800, truncated, open ≤ 12, modified: [{path, by, at, op, added,
  removed, diff ≤ 80 lines}] ≤ 30, focus}`); `builtin/terminal.js` `Terminal` (view `terminal`, keep `file`;
  `terminal.run|start|wait|read|send|stop|list` over host term/*, with the holder's name and `writes` (none: []);
  two sessions per holder (2026-10-17): `run` in its `main` one (command after command, one at a time), `start` in
  its `long` one (kept running; the next start replaces it), ids `main`/`long`/`<agent>:main`; prompt: every running
  session's header + last 50 lines, a finished one in one line; state `{sessions ≤ 12}`);
  `builtin/preview.js` `Preview` (view `preview`, keep `file`; `preview.open|goto|click|type|press|scroll|text|eval|
  console|shot|close` over host browser/*, the page = the newest open one unless `id`; each action answers with the
  page's text outline; prompt text only: url, title, console errors, the last outline ≤ 40 lines; state `{pages}`);
  `builtin/web.js` (`web.search {q | query, limit?, source?}`: a 429/5xx from wikipedia/arxiv/hn retried once on web
  with a note, else the 2-minute advice; `web.read {url, find?, max_chars?}` narrowed with `narrowText`).
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
  `agent.dismiss {name}` (only its spawner; its helpers go with it).
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
  `AgentTool` "<name>: <goal>"; a failed build is undone) and emits `{event: "spawn", agent, by, goal, keep}`;
  `dismiss(name, by)` (refused while it or a helper of its runs, or when `by` did not spawn it) removes it everywhere
  and emits `dismiss`.
- `twin()`: every element as plain JSON for its UI twin — `Tool`/`AgentTool` (+ `agent`), `Artifact` (kind, view,
  owner, title, keep, brief, state; a board's `{goal, entries}`; a list's `items`), `Agent` (definition, tool twins,
  agents, artifacts, desk, spawned, status), `Desk` (lead, tree, agents, artifacts with holders).
  `companion/team/kernel-team.js` streams agent definitions and artifact views from them.
- `model/llm.js` (`complete`: OpenAI-compatible or Anthropic wire; local providers through the host's
  `/__askk/llm/<provider>/v1`, `model.host` says where), `util/text.js` (`narrowText`: passages around `find` terms).
  Tests in `test/`: `agent.test.js`, `kernel.test.js`, `prompt.test.js`, `text.test.js`, `twin.test.js`,
  `hold.test.js` (refresh, commands subset), `plan.test.js`, `spawn.test.js`, `builtin.test.js` (the catalogue, sharing,
  the twin states), `builtin-files.test.js`, `builtin-terminal.test.js`, `builtin-preview.test.js`,
  `builtin-web.test.js` (each over `test/fake-host.js`).

## Desks (`custom/<desk>/`)

A desk is `custom/<desk>/main.js` (loader `companion/team/desk.js`) default-exporting `({dir, env}) => ({ name,
title, description, port?, mcp?, integrations?, setup?, host?, start })`. `start({port, live, log, memory})` →
`{desk, ready?, run?}` builds its agents on the kernel; `run({wake, busy, log})` → stop is its background work
(watchers) on a continuous server. `host({call, env, state, dir, root, listen})` → `{wrap?, guard?, servers?}`
shapes `mcp/call`: `wrap`s layer around every MCP / integration call, `guard` is the outermost (the desk's own
checks, kept where agents cannot write), `servers` add tool servers. Folders: `agents/` (agents as folders,
nested by team: `agent.md` with `description`, tools, model; the body is the role; a spec `folder` puts each
agent's transcript beside its agent.md), `tools/`, `vendor/` (git-ignored), `data/` (the workspace), `state/`
(host state). Shared memory and reports: `custom/memory/<desk>/`. Desks are local workflows: each documents itself in its own
README, and none is ever added or committed (owner 2026-10-17). Desk tests: `bun test ./tests` in the desk folder (plain `bun test` walks vendor/).
Code more than one desk may use lives in `custom/shared/`. `custom/` is git-ignored (its own repo), never pushed.
- The standard (`docs/standard.md`): a convention desk's main.js is `export default conventionDesk({title,
  description})` (`companion/team/compose.js`): `agents/<lead>/agent.md` (members as subfolders; `desks: [name]`
  mounts that desk's lead under the agent, composed with its own tools and main.js `compose` options; its ctx `desk`
  and `memory` are its own, `host` and `log` the parent's) + `tools/<name>.js` each `export default
  defineTool({...})`, tool names resolved at compose time (`composeDesk`: unknown keys, tools, models, artifacts or
  a desks cycle are Errors); built-in artifacts `checklist:` and `artifacts: [report]` (`<agent>.report.write` →
  `custom/memory/<desk>/reports/`); the kernel's kit attached by name under the desk's own (the desk wins a clash;
  `builtinKit` bound once per composed desk, mounted desks share it; handed to `buildDesk` as `env.tools` /
  `env.artifacts` so `agent.spawn` resolves names at run time): `tools: [web.search, agent.spawn]`, `artifacts:
  [files, terminal, preview, {type: plan, gate: true}]` (entries `{type, id?, commands?, gate?}`), agent.md `writes:`
  / `reads:` (globs) and `board: false`; tools reach the host only through `ctx.host` (`hostClient`). Also
  `readAgentFolder`, `loadTools`, `MODELS`, `llmInfer` (`custom/shared/kernel-desk.js` re-exports two).
  `bun scripts/tool.js check|run <file>`, `bun scripts/desk.js check <desk folder>`; fixtures and tests in
  `companion/team/fixtures/` (`kit-desk/`: the kit by name), `compose.test.js`.

## The desk server (`companion/`)

- `server/desks.js` `hostDesks({folders, port, defaultDesk, readOnly, root?})`: per desk its team, host API and
  integrations (one Telegram listener per bot: a desk listens for the integrations no other hosted desk names);
  `handleApi` (`desks`, `desks/select`, `desks/load`), `announce` (each desk's `state/server.json`),
  `startTelegram`, `load(name)` (root: the hosted folders' parent; a reload ends the old team's streams so tabs
  reconnect, `forgetDesk` + `require.cache` under the folder; tested in `desks.test.js`). Used by `scripts/dev.js`
  and `server/server.js`. `findDeskServer(desk)` (desk.js) finds a running one.
- `team/kernel-team.js` `createKernelTeam({desk, port, log})`: the desk served as the team. `GET team/stream`
  (SSE: `snapshot {registry, states, kernel, log}`, then `state {id, patch}`, `kernel {artifact, boards?}`,
  `registry {registry, states}` and `kernel {tree, removed?}` when an agent is spawned or dismissed, `log {at,
  source, text}`), `POST team/call {target, method, args}` (`send`, `ask` [text, {from}], `stop`,
  `guide` [text, {from}] → `{delivered}` (a note for the run in progress; idle: false), `preview` (artifacts
  refreshed first), `clearMemory`;
  target `desk`: `schedule`, `unschedule`, `defaultGoal`; no target = the lead), `POST team/send {text, agent?,
  from?}`. Each agent: its definition (description, role, folder, tool specs, artifacts held, model, team) and its
  state from kernel events (status, activity, messages — user, step, tool results with `view` and `inputs`, `gate`
  rows, guidance rows `{role: user, kind: guidance}` (not a new run), answers — working, stats). Every artifact by id
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
  spawned <name>: <goal>`; a dismiss drops its state and sends `removed` ids. `work()` and `agents` (a getter: the
  desks/load counts) read the live list. One `kernel {artifact}` per artifact change (the lead's `state.live` copy
  is gone).
- `team/kernel-telegram.js` (owner only, `shared/telegram-owner.js`; `TELEGRAM_OWNER_ID`, else
  `TELEGRAM_CHAT_ID`): messages → the lead (idle: a new run, answered as a reply; while it runs: guidance for that
  run, team call `guide`, read at its next step), `/queue <text>` (new work after the run), `/status`, `/stop`, one
  live status message per run edited in place (`kernel-live.js`, text from `kernel-status.js`, agent look from
  `backend/live/visual.js`).
- `server/host-api.js` `createHostApi({root, desk, team, port, readOnly, listen, hostPorts})`: `whoami`, `wakes`,
  `fs.read`/`fs.write` (`fs/list`, `fs/read`, `fs/tree`, `POST fs/write` revision-checked and atomic,
  `POST fs/delete`: links unlinked, never followed; non-empty folders need `recursive`; `fs/watch` SSE `change
  {paths}` debounced 300 ms; a desk's main.js `mounts: {desks: {root, allow(name)}}` makes `desks/<name>/…` that
  folder when allowed, realpath-contained, links refused), `term` (`capabilities/terminal.js`, not when read-only: PTY
  sessions (`Bun.Terminal`) of one program or an `&&` chain, no shell, under sandbox-exec (`sandbox.js`: the caller's
  `writes` lane, no `.env*`/`.mcp.json`/PATH folders, no other desk read, no desk server port) with the desk's
  `terminal: {toolchains, programs, timeoutSeconds, backgroundMinutes}` (`toolchains.js`); `POST term/start|write|
  wait|stop` (wait's `until`: literal text or [texts], any one, found with includes — never a regex; ≤ 300 chars, ≤ 8;
  start's `slot`: the agent's session of that slot takes the command — same id, `$ <command>` appended, 409 while it
  runs unless `replace`), `term/list`, `term/read`, SSE `term/stream` (+ `run` when a slot session takes its next
  command); line view with `\r` and escapes handled; logs in
  `state/terminal/<id>.log` + `state/terminal.jsonl`; 6 running, 120 min each), `browser` (`capabilities/browser.js`,
  not when read-only: `Bun.WebView` pages on `localhost|127.0.0.1|[::1]:<port>` only, never a desk server port,
  closed when they navigate away; `POST browser/open|navigate|click|type|press|scroll|eval|text|shot|console|close`,
  `browser/list`, `GET browser/shot?id&n` → the PNG; a screenshot after every change in `state/browser/<id>/<n>.png`;
  3 pages per desk, 6 per process), `web`
  (`web/search?q=&limit=&source=` → `{engine, query, results: [{title, url, snippet, source}], note?}`: `source` web
  (default: SearXNG when `ASKK_SEARXNG_URL`, else DuckDuckGo; failed, rate-limited or empty → fallback wikipedia +
  arxiv + hn round-robin, engine `fallback`, `note` says why) | wikipedia | arxiv | hn (official keyless APIs only);
  per-engine process-wide queues (`HOST_LIMITS.web.engines`: DuckDuckGo one at a time, 1.5 s between starts, rate
  limit retried 3 s / 8 s then skipped 2 min; arXiv 3 s apart), 10 min cache; `web/read`: public addresses only at
  every redirect, 40K text), `mcp` (`mcp/tools`, `mcp/call`: `.mcp.json` in the folder ASKK starts in plus the
  desk's `mcp.json`, stdio or Streamable HTTP, servers start lazily and stay up; `oauth-file.js` reads a shared
  bearer token under flock), `models.local` (`llm/<provider>/v1`: the claude/codex/gemini CLIs as plain completions
  in an empty temp folder, prompt on stdin, and Apple's on-device model, `capabilities/local-models.js`), `apple`
  (macOS: fixed programs with argument lists, never a shell, `hardware/apple/`), `speech` (`hardware/speech/`),
  `team`. A GET handler may answer with its own `Response` (a stream, an image); `close()` (a desk reload) stops its
  tool servers, listeners, watches, pages and terminal sessions. Security: Host header must be localhost:port (DNS
  rebinding), cross-origin refused, POST needs same-origin Origin + JSON, realpath containment (no symlink escapes,
  also for new files); agents can never write or delete `.env*` (except `.env.example`) or `.mcp.json`.
- Layout: `server/` (host-api, desks, server), `team/` (desk loader, kernel-*), `capabilities/` (files, web, mcp,
  oauth-file, integrations, local-models), `hardware/`, `shared/` (http, jsonl, time, paths, args `DESK_OPTIONS`,
  config, wakes, telegram-owner) for helpers used in 2+ places.

## The live UI (`backend/live/`, `components/`, `app/`)

- `backend/live/`: `stream.js` (`connectTeam`, `teamCall`), `registry.js` (the one subscriber: opens the stream
  once per tab and feeds every store; `{status: connecting | ready | offline | error, agents, engines,
  requiredId, activeId}`, `select`), `agent.js` (`AgentView`: definition + immutable state replaced by patches;
  `send`, `ask`, `stop`, `preview`, `clearMemory`), `desk.js` (tree, boards, artifacts; `artifactsFor` — every
  artifact on its team's card, else its first holder's — `artifactsHeldBy`, `currentQuest`, schedule calls),
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
  follow), `/live` (`components/live/`: feed by tool view, Artifacts, Desk log, Schedule; `?tab=`), `/files`,
  `/sts`.
  `components/views/artifact.jsx`: one renderer per artifact view (list, checklist, quality, board, schedule,
  text, memory, table; unknown views show their state) used by the cards, Live and the agent page.
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
