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
- **headless** — `askk ask "query"` / `bun run ask -- "query"`
  (`companion/ask.js`): one query to an agent, answer on stdout, exit code
  (0/1/2/124), for scripts and cron. Same agents and engines in Bun,
  in-process (no workers); browser shims (`location`, same-origin `fetch`
  answered in-process by the host API + public files, `localStorage` per
  run), so no port is opened. Changes declined unless `--yes`. Memory is per
  run. App code must keep working there: use `globalThis.location`, not
  `window`.
- **demo** — the static build on any host (or `bun run dev:browser`):
  browser-only, the ~80%. Host capabilities are shown as missing in the
  header (`components/host-status.jsx`, `HOST_CAPABILITIES`) and fall back
  where they can (files → OPFS workspace).

Host API capabilities: `fs.read` (`whoami`, `fs/list`, `fs/tree`, `fs/read`) and
`fs.write` (`POST fs/write`, revision-checked, atomic; `POST fs/delete`,
links unlinked never followed, non-empty folders need `recursive`).
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
  into the prompt (`template.js` order: soul → instructions → context →
  history → artifacts → tools → structured response → current request;
  complete prompt every request). History holds finished turns only; the
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
  list (`createTools`, `createArtifacts`, `TOOL_NAMES`). `web.read`,
  `notes.*` are contract-only here. Add a feature = a folder + list it here.
- `filesystem/` — the workspace and everything built on it:
  - `workspace.js` — the files agents work on, one contract, two backends:
    OPFS `workspace/` (browser-only / static) or the companion's folder
    (local mode). `list/tree/read/write/remove`, content-hash `revision` for
    conflict checks.
  - `tools.js` — `fs.list`, `fs.read`, `fs.write`, `fs.edit`, `fs.delete`.
    `fs.write` over an existing file must be based on a revision the engine
    read (`markSeen`).
  - `artifact.js` — `FilesystemArtifact`: the workspace tree (names only,
    every level; heavy folders like node_modules listed, not expanded) plus
    the engine's open files with current content. `fs.open` / `fs.close`;
    open files count as seen for `fs.write`'s revision check. Files are
    shared; only the open list is per engine.

- `skills/` — procedures kept out of the prompt until needed. Skills live
  in `public/skills/<name>/SKILL.md` (frontmatter `name`, `description` +
  Markdown body), listed in `public/skills/index.json` (a static export
  can't list folders; add a skill = folder + manifest entry).
  - `catalog.js` — `listSkills()` (name + description of every skill),
    `loadSkill(name)` (full text); cached per thread, works in workers.
  - `artifact.js` — `SkillsArtifact` (`artifacts: [skills]`): renders the
    catalogue plus the engine's loaded skills in full. `skills.load` /
    `skills.unload` (each takes `{"names": [...]}`); max 6 loaded. Only the loaded list is per engine.
    (agent.md `skills: {name: file}` is the older always-inlined form.)

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
  character; `## WHO YOU ARE`), never the job; the agent.md body = the role,
  the hat for this work (`## YOUR ROLE`: the work, rules, learned). How to
  write each, and the research behind the split: `docs/soul-and-role.md`. `agent-store.js` — owner edits
  (localStorage).

**`models/` — inference**

- `llm.js` — inference over two wire protocols: `openai` (`/chat/completions`)
  and `anthropic` (`/messages`), streaming `fetch`, plus `listModels()` and
  `contextWindow()`. Thinking arrives as `reasoning_content` / `thinking_delta`.
- `catalog.js` — model catalogue: named connections (`key` → provider,
  base_url, id, …). `public/models.json` ships entries (public — never API
  keys); Settings adds/edits more in localStorage `askk.models`. One is the
  default; every agent uses it unless agent.md names a key (`model: <key>`).
  `engine.model` = `resolveModel(agent.model)` (null if the key is unknown).
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
(`public/agents/lead/agent.md`); planner and critic are its team.

Memory: each engine's messages live in a readable Markdown file,
`agents/<engine>/memory.md`, in the browser's Origin Private File System
(`platform/storage.js`, localStorage fallback). Saved before every render and at the
end of each turn; restored at startup (`engine.restore()`, memory.md only). `clearMemory()`
empties it; `summarizeMemory()` replaces the log with one `summary` message.
Every summarize (manual, or automatic before an LLM step once the prompt
reaches 92% of the context window) first moves the log to a new
`agents/<engine>/history-<time>.md`. The prompt carries the full memory; the
token estimate is calibrated from server usage counts.

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
