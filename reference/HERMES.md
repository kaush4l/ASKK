# HERMES.md — what "Hermes agent" is, what the category ships, and what ASKK should have

Research date: 2026-08-12. Every claim below is either quoted from a source or
marked as an inference. Where something was not findable, it says so.

---

## 1. Which "Hermes" is the relevant one

Three distinct things carry the name. Only one is an agent framework.

| Thing | What it is | Relevant? |
|---|---|---|
| **Hermes Agent** — `github.com/NousResearch/hermes-agent`, docs at `hermes-agent.nousresearch.com` | Open-source, model-agnostic **agent harness**. CLI + TUI + desktop app + **web dashboard** + messaging gateway. Tagline: "The agent that grows with you". | **Yes. This is the target.** |
| **Hermes 3 / Hermes 4** — `NousResearch/Hermes-4-70B` etc. | Open-**weight LLM family** from the same lab (14B/70B/405B on Llama 3.1, released 2025-08-30), hybrid reasoning via `<think>` tags, trained for function calling and structured output. A *model*, not a harness. | Only as the default model Hermes Agent can run. Not a UI. |
| **`schnetzlerjoe/hermes`** | An unrelated LlamaIndex-based investment-research agent framework. Name collision. | No. |
| Meta's **Hermes** JS engine (React Native) | Unrelated JavaScript engine. Pure name collision — note it, since a repo search for "hermes" is polluted by it. | No. |

Sources:
- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/docs/
- https://huggingface.co/NousResearch/Hermes-4-70B
- https://github.com/schnetzlerjoe/hermes

### Is it a ReAct loop?

Yes, and it says so. `developer-guide/agent-loop.md` describes the core class
`AIAgent` in `run_agent.py`, whose responsibilities are quoted verbatim:

> - Assembling the effective system prompt and tool schemas via `prompt_builder.py`
> - Selecting the correct provider/API mode (chat_completions, codex_responses, anthropic_messages)
> - Making interruptible model calls with cancellation support
> - Executing tool calls (sequentially or concurrently via thread pool)
> - Maintaining conversation history in OpenAI message format
> - Handling compression, retries, and fallback model switching
> - Tracking iteration budgets across parent and child agents
> - Flushing persistent memory before context is lost

— https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/agent-loop.md

That list is a spec for a UI: prompt, model/provider, tools, transcript,
compression, fallback, budget, memory. Every one of those is something a user
would want to see.

---

## 2. Hermes Agent's nouns

From `docs/user-guide/features/overview.md` (verbatim headings and gloss):

**Core**
- **Tools & Toolsets** — "Tools are functions that extend the agent's capabilities. They're organized into logical toolsets that can be enabled or disabled per platform."
- **Skills System** — "On-demand knowledge documents the agent can load when needed… compatible with the [agentskills.io] open standard." Markdown files. This is Hermes' equivalent of ASKK's agent markdown.
- **Persistent Memory** — "Bounded, curated memory that persists across sessions… via `MEMORY.md` and `USER.md`."
- **Context Files** — auto-discovered `.hermes.md`, `AGENTS.md`, `CLAUDE.md`, `SOUL.md`, `.cursorrules`.
- **Context References** — `@`-expansion of files, folders, git diffs, URLs into the message.
- **Checkpoints** — working-directory snapshots, `/rollback`.

**Automation**
- **Scheduled Tasks (Cron)**, **Subagent Delegation** (`delegate_task`, isolated context, restricted toolsets, 3 concurrent by default), **Code Execution** (`execute_code` — Python calling Hermes tools over sandboxed RPC), **Event Hooks**, **Batch Processing** (ShareGPT trajectory generation).

**Media & Web**: Voice Mode, Wake Word, Browser Automation, Vision, Image Generation, TTS.

**Integrations**: MCP, Provider Routing, Fallback Providers, Credential Pools, prompt caching, Memory Providers (Honcho, Mem0, Supermemory, …), API Server (OpenAI-compatible), IDE/ACP.

**Customization**: **Personality & SOUL.md** ("`SOUL.md` is the primary identity file — the first thing in the system prompt"), Skins & Themes, Plugins.

Other first-class nouns from the rest of the docs: **Sessions**, **Profiles**
("isolated Hermes instances with their own config, skills, and sessions"),
**Channels / messaging gateway**, **Webhooks**, **Pairing**, **Models**,
**Config (`config.yaml`)**, **API keys (`.env`)**, **Logs**, **Analytics/usage**,
**Kanban**, **Goals**, **Curator** (background skill maintenance), **Artifacts**,
**Memory Graph**.

Shared slash commands, from the README:
`/new`, `/reset`, `/model`, `/personality`, `/retry`, `/undo`, `/compress`,
`/usage`, `/insights`, `/skills`, `/platforms`, `/stop`.

### 2a. What Hermes actually puts in a browser: the Web Dashboard

`hermes dashboard` is a browser admin panel. This is the single most directly
relevant artifact for ASKK. Its sidebar, **read off the real screenshot**
(`nav-hermes-admin-config.png`, `nav-hermes-admin-system-top.png`, v0.15.1/0.16.0):

```
CHAT · SESSIONS · MODELS · LOGS · CRON · SKILLS · PLUGINS · MCP ·
CHANNELS · WEBHOOKS · PAIRING · PROFILES · CONFIG · KEYS
```

plus a pinned footer block that is *always visible*, not a page:

```
System
  Gateway Status: Off
  Active Sessions: 0
  ⟳ Restart Gateway
  ⇩ Update Hermes
—————————————
HERMES TEAL (skin)   EN (language)
v0.16.0              Nous Research
```

The docs page (`features/web-dashboard.md`) lists the pages as **Status, Chat,
Config, API Keys, Sessions, Logs, Analytics, Cron, Profiles, Skills, MCP,
Webhooks, Pairing, Channels, System** — slightly different from the screenshot
(screenshot adds Models/Plugins, folds Status/Analytics elsewhere). Treat the
screenshot as current, the docs list as the superset.

Notable details worth stealing:
- **Config is one page with a section filter list**, not fifteen settings pages.
  150+ fields auto-discovered from `DEFAULT_CONFIG`, grouped: General 15, Agent 35,
  Terminal 21, Display 50, Delegation 13, Memory 5, Compression 7, Security 17,
  Browser 15, Voice 6, TTS 17, STT 10, Logging 3, Discord 22, Auxiliary 56,
  Bedrock 8, Curator 8, Gateway 4, Kanban 11, LSP… Each field is a form control;
  actions are Save / Reset to defaults / Export / Import / view raw YAML.
- **Chat is the real TUI** piped through xterm.js over a PTY WebSocket — they
  refused to build a second chat client.
- **System** is the junk-drawer page done deliberately: host stats, Portal status,
  skill curator, gateway lifecycle, memory provider, credential pool, operations
  (doctor/audit/backup/restore), checkpoints, shell hooks.

Source: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/web-dashboard.md

### 2b. The desktop app sidebar

From `docs/user-guide/desktop.md`, "What's in the app" — "chat-first window with
a left sidebar for navigation":

**Chat** (center), **Projects**, **Artifacts**, **Skills**, **Memory Graph**,
**Cron**, **Profiles**, **Messaging**, **Agents**, **Command Center**.
Right sidebar holds **File browser** and **Terminal**; **Git review** is a
Cmd/Ctrl+G pane; **Settings** is a modal (Providers, Model, Toolsets, MCP,
Gateway, Appearance, Keyboard Shortcuts, Advanced, Workspace).

Two things are explicitly *not* sections:
- **Model picking lives in the composer**, "just left of the microphone" — not a
  Models page. The Models page exists only to set the per-profile default.
- **Memory Graph** is reachable from the command palette and the status bar
  (`/journey`), i.e. it's a view over memory, not a CRUD screen.

### 2c. What is permanently on screen

The TUI status line (`docs/user-guide/tui.md`) is a good inventory of "always
visible" state, and the desktop status bar mirrors it:

- Agent state: `starting agent… / ready / thinking… / running… / interrupted / forging session… / resuming…`
- Working directory **with git branch**
- Per-prompt elapsed time + total session duration (`⏱ 12s/3m 45s`)
- `🗜️ N` — number of auto-compressions this session
- `▶ N` — background tasks in flight
- `⚠ YOLO` — approval bypass warning
- Session title badge, model, workspace, approvals mode, backend version
- Desktop adds a **context-usage % meter**, clickable into a token breakdown by
  category (system prompt, tool definitions, skills, memory, rules, MCP,
  subagent definitions, conversation)

The status bar is **user-customizable** (right-click → "Show in status bar").
That is the correct answer to "what goes permanently on screen": pick a default,
let the operator edit it.

---

## 3. What comparable products actually put in their nav

Literal top-level labels. Where the app is login-gated, the source is the repo's
own nav definition file — which is better evidence than a marketing screenshot.

### 3.1 The literal lists

**LangGraph Studio / LangSmith.** Studio itself **has no sidebar** — it is a
canvas reached from the **Deployments** nav item, with two modes (`Graph`,
`Chat`) and controls `Input · View Raw · Submit · Cancel · Interrupt · Continue ·
Manage Assistants · + New Thread · Edit node state · Fork · Re-run from here ·
Pretty/JSON · Show tool calls`. The surrounding LangSmith sidebar:
`Tracing · Datasets & Experiments · Evaluators · Annotation Queues · Prompts ·
Playground · Deployments · Monitor`.
Docs-derived (`smith.langchain.com` is behind a login wall), not screenshot-verified.
https://docs.langchain.com/langsmith/use-studio

**Dify.** `main` branch, from `web/app/components/main-nav/routes.ts`:
`Home · Studio · Agents · Knowledge · Integrations · Marketplace`.
Stable 1.9.1 (`web/app/components/header/index.tsx`) was:
`Explore · Studio · Knowledge · Tools · Plugins`.
Per-app sidebar: `overview · configuration · workflow · logs · annotations ·
deploy · develop · access-config`.
https://github.com/langgenius/dify/blob/main/web/app/components/main-nav/routes.ts

**Flowise.** From `packages/ui/src/menu-items/dashboard.js`, in order:
`Chatflows · Agentflows · Executions · Assistants · Marketplaces · Tools ·
Credentials · Variables · API Keys · Document Stores`; group **Evaluations**:
`Datasets · Evaluators · Evaluations`; group **User & Workspace Management**:
`SSO Config · Roles · Users · Workspaces · Login Activity`; group **Others**:
`Logs · Account Settings`. (A `Files` item exists but is commented out.)
https://github.com/FlowiseAI/Flowise/blob/main/packages/ui/src/menu-items/dashboard.js

**AutoGen Studio.** From `frontend/src/components/sidebar.tsx`:
`Team Builder · Playground · MCP (Experimental) · Gallery · Deploy`, with
`Settings` pinned at the bottom. Team Builder has a `JSON Editor` toggle.
https://github.com/microsoft/autogen/blob/main/python/packages/autogen-studio/frontend/src/components/sidebar.tsx

**CrewAI Enterprise / AMP.** Read off the official dashboard screenshot
(`nav-crewai.png`), top to bottom:
`Crews · Templates · Integrations · Environment Variables · LLM Connections ·
Tools · Management UI · Crew Studio · Traces · Usage · Resources · Settings`.
Current AMP docs suggest a rename in progress — **Build**: `Automations, Studio,
Marketplace, Agent Repositories, Tools & Integrations`; **Operate**: `Traces,
Webhook Streaming`; **Manage**: `SSO, RBAC, Secrets Manager` — docs strings, not
verified in-app.
https://docs-platform.crewai.com/platform/en/introduction

**OpenAI Agent Builder / Assistants playground.** **Not found.**
`platform.openai.com` never rendered for headless browsing (Cloudflare + login)
and OpenAI's docs do not enumerate the platform sidebar. Only the canvas top nav
is documented: `Preview · Evaluate · Code`.
Also: **Agent Builder is deprecated, shutting down 2026-11-30**
(https://developers.openai.com/api/docs/deprecations#2026-06-03-agent-builder).
Do not model a nav on it.

**LM Studio** 0.4.20, label props read out of the installed app bundle
(`AppTopBarNavButton` in `main_window.js`):
`Chat` (⌘1) · `Developer` (⌘2) · `My Models` (⌘3) · `LM Link` · `Transcribe` ·
`Model Search` · `App Settings`. Some are build/flag-conditional. Older docs still
say "Discover tab"; in 0.4.x Discover became a modal with `Search` / `My Models`
modes and the rail button reads `Model Search`. Screenshot not captured — the
shell lacked macOS Screen Recording permission.

**Open WebUI**, from source on `main` (i18n key = display string):
Sidebar: `New Chat · Search · Notes · Workspace · Automations · Calendar ·
Playground` (admin only), then grouped headers `Models · Channels · Folders · Chats`.
Workspace tabs: `Models · Knowledge · Prompts · Skills · Tools`.
Admin Panel tabs: `Users · Evaluations · Functions · Settings`.
Admin settings: `General · Authentication · Connections · Models · Sub-agents ·
Evaluations · Analytics · Integrations · Documents · Web Search · Code Execution ·
Interface · Audio · Images · Pipelines · Database`.
https://github.com/open-webui/open-webui/blob/main/src/lib/components/layout/Sidebar.svelte

**Hermes Agent web dashboard** (for comparison, from §2a):
`Chat · Sessions · Models · Logs · Cron · Skills · Plugins · MCP · Channels ·
Webhooks · Pairing · Profiles · Config · Keys` (+ pinned System block).

### 3.2 Frequency table

`Y` = its own top-level nav item. `~` = present but nested, contextual, or admin-only.
`—` = absent. `?` = not verifiable.

| Section | LangSmith | Dify | Flowise | AutoGen | CrewAI | OpenAI AB | LM Studio | Open WebUI | Hermes | **Y count** |
|---|---|---|---|---|---|---|---|---|---|---|
| **Settings** | Y | ~ | Y | Y | Y | ? | Y | Y | Y (Config) | **7/9** |
| **Workflows / Flows / Studio** | Y (Deployments) | Y (Studio) | Y | Y (Team Builder) | Y (Crew Studio) | Y | — | Y (Automations) | ~ (Kanban) | **7/9** |
| **Tools / Integrations** | — | Y | Y | Y (MCP) | Y | ~ | — | Y | Y (MCP, Plugins) | **6/9** |
| **Logs / Traces / Observability** | Y (Tracing, Monitor) | Y (Logs) | Y (Logs, Executions) | — | Y (Traces) | ~ | Y (Developer) | ~ (Analytics) | Y (Logs) | **6/9** |
| **Agents / Crews / Assistants** | ~ (Assistants) | Y | Y (Agentflows) | Y | Y (Crews) | Y | — | ~ (Sub-agents) | ~ (desktop only) | **5/9** |
| **Chat / Playground** | Y | ~ | ~ | Y | — | Y (Preview) | Y | Y | Y | **6/9** |
| **Marketplace / Templates / Gallery** | — | Y | Y | Y (Gallery) | Y (Templates) | Y | Y (Model Search) | — | ~ (Skills hub) | **6/9** |
| **Models** | — | ~ | — | ~ (Gallery) | Y (LLM Connections) | ? | Y (My Models) | Y | Y | **4/9** |
| **Evals / Datasets** | Y | — | Y | — | — | Y | — | Y | — | **4/9** |
| **Memory / Knowledge** | — | Y | Y (Doc Stores) | — | — | ~ | — | Y | ~ (in System) | **3/9** |
| **Sessions / Threads / History** | ~ | — | Y (Executions) | — | — | — | ~ | Y (Chats) | Y | **3/9** |
| **Credentials / API Keys** | ~ | — | Y | — | Y (Env Vars) | ~ | — | ~ | Y (Keys) | **3/9** |
| **Skills / Prompts** | Y (Prompts) | — | — | — | — | — | — | Y | Y | **3/9** |
| **Users / Workspace admin** | ~ | ~ | Y | — | Y (SSO/RBAC) | ? | — | Y (Users) | ~ (Pairing) | **3/9** |
| **Scheduling / Automations** | — | — | — | — | ~ | — | — | Y | Y (Cron) | **2/9** |
| **Files / Documents** | — | ~ | — (disabled) | — | — | ~ | — | Y (admin) | — | **1/9** |

### 3.3 What the table says

- **Nobody has a Files section.** 1 out of 9. Files ride along with chat or live
  inside Knowledge. Do not build one.
- **Memory is not a section anywhere** — it is filed under Knowledge / Document
  Stores, and even Hermes buries it in System + a command-palette graph. If ASKK
  makes Memory a first-class view it is taking a *position*, not following the
  category. (I think that position is correct — see §5 — but be aware it's a bet.)
- **Models is a section only where models are the product** (LM Studio, Open WebUI,
  Hermes, CrewAI's LLM Connections). In the builders (Flowise, AutoGen, LangGraph)
  the model is per-node config and there is deliberately no Models page.
- **Settings and the flow canvas are the only near-universals**, and the canvas is
  named after whatever the product thinks it makes: `Chatflows`/`Agentflows`,
  `Studio`, `Team Builder`, `Crew Studio`, `Deployments`, `Automations`.
- **`Marketplace` / `Templates` / `Gallery` / `Explore` / `Marketplaces` are one
  drawer with five names.** So are `Logs` / `Traces` / `Executions` / `Monitor` /
  `Analytics` — products routinely ship two or three of those as separate nav
  items, which is a defect, not a feature.
- **Evals appear only in team/production tools.** They are a regression-suite
  feature and belong nowhere near a single-operator browser app.

---

## 4. "Jarvis"-style single-operator consoles

Screenshots in this directory. Honest assessment of each — several things that
look like agent consoles are themed CSS with no agent behind them.

### 4a. `nav-jarvis-hermes-hud.png` — a Jarvis HUD built **on Hermes Agent**

`github.com/imthefounder/jarvis_hermes_dashboard` (demo: `youtu.be/YNI9pm3h6x8`).
Real code with a real agent behind it — FastAPI voice pipeline, local Whisper STT,
ElevenLabs TTS, Hermes agent + tool calls, approval gates for dangerous commands.
Caveat: 0 stars, single author, `server/hud/` is single-file vanilla JS. A personal
build, not a product — cite it for shape, not for validation.

The most directly relevant artifact found. Header reads
`J.A.R.V.I.S` · `HERMES AGENT INTERFACE // LINK ACTIVE` · clock; footer reads
`VOICE SERVER CONNECTED` · `NOUS HERMES AGENT v0.16`. Served at `jarvis.local/hud/`.

Layout is **exactly ASKK's nav / stage / rail**: numbered panels down both edges,
a stage in the middle, one composer along the bottom. **Zero navigation** — no
sidebar of pages, no tabs. Panels are numbered 01–10:

| | Left rail | | Right rail |
|---|---|---|---|
| 01 | **Voice Link** — socket `online`, microphone `ready`, input level, `ENGAGE VOICE` | 06 | **Models Loadout** — Brain `hermes-agent`, STT `whisper base.en`, TTS `11L Flash v2.5 · Hayes`, Fallback `claude-haiku-4-5`; Tokens today `3.1M in / 6.7k out`; Turns today `34`; 11Labs quota `6.7k / 300.0k (98% left)` |
| 02 | **Agent Activity** — live line items (`holograms arc reactor explained`, `tool hud_display`) | 07 | **Machines** — `MAC MINI · HERMES  CPU 0% · MEM 56%`, `RTX 5090 WORKER  GPU 10% · VRAM 5.6/23.9 GB · 59°` |
| 03 | **Turn Metrics** — Turns 2, Last speech→audio 9.54s, Last total 9.84s, Brain `hermes` | 08 | **Skills** — `Loaded skills 68`, expandable list (dogfood, jarvis-voice-hud, findmy, imessage, macos-computer-use, claude-code, codex…) |
| 04 | **Views** — the *only* navigation, three buttons: `KANBAN BOARD`, `HERMES DASHBOARD`, `DASHBOARD CHAT` | 09 | **Diagnostics** — Hermes API `online`, CPU, Memory, Refreshed `11:09:16` |
| 05 | **Session** — Conversation `jarvis-main`, Memory scope `jarvis:chris:main`, Active sessions `ok`, Running agents `0` | 10 | **Automations** — `— none —` |

Composer: `Type to Hermes… (/new resets · voice: click the ring)` with `SEND` / `CLR`.

The lesson: **navigation shrank to a three-item "Views" panel.** Everything else
that a dashboard would make a page out of (skills, models, sessions, diagnostics,
automations) is a *permanently visible read-only meter*, and the deep management
UI is one of the three things you can navigate to.

### 4b. `nav-mission-control.png` — multi-agent "mission control"

`github.com/builderz-labs/mission-control` (~6.0k stars, actively developed; live
at `mc.builderz.dev`). A self-hosted control plane for agent fleets with adapters
for Claude Code, Codex, Hermes, OpenClaw, CrewAI, LangGraph. Deliberately **not**
sci-fi styled — dark, restrained, monospace accents. The useful anti-Jarvis
comparison: same job, no HUD chrome.

Icon-only left rail (~6 unlabelled icons). Top bar is permanent and carries:
a `⌘K` command palette reading **"Jump to page, task, agent…"**, a `Local`
badge, and live counters `Sessions 2/4`, `Events ● Live`, a clock.

Permanently on screen below it:
- A hero status strip: `2 active sessions · 2 tasks running · 1 needs review`
  and beneath it `4 sessions today · 136K tokens · $0.79 spent · Memory 79% ▬▬▬`
- **Activity** panel with a `● Live` badge — a stream of prompts as they land
- **Fleet Status** — per-backend rows (Claude / Codex / Hermes) with active count,
  sparkline, total, and spend
- **Task Pipeline** — `Inbox 1 › Assigned 4 › Running 2 › Review 1 › Done 2`
- **System** — `Mem 79% · Disk 3% · Uptime 27d 3h · MC ● OK`
- Five quick-launch cards, each with a live subtitle: **Review Pending Tasks**
  (1 task awaiting review), **Sessions** (Claude + Codex + Hermes), **Task Board**
  (2 running · 6 queued), **View Logs** (Realtime viewer), **Memory**
  (Knowledge + recall) — plus a **Customize** button.

The cards *are* the navigation, and each one carries its own live number. That is
a better pattern than a nav list: a nav item that tells you why to click it.

Behind its icon rail: Tasks board, Agents (registration / heartbeats / config /
workspace files), Memory browser + relationship graph, Skills Hub, Schedules
(cron calendar), Logs viewer, Settings.

### 4c. `nav-jarvis-8agent.png` — the classic single-file HUD

`github.com/anuragnepal1999/JARVIS` — real Python (8-agent voice assistant) plus a
standalone `jarvis-dashboard.html`. 4 commits, 0 stars.
"JUST A RATHER VERY INTELLIGENT SYSTEM · v4.0". One
screen, no navigation at all, no scroll. Permanent: big clock + date,
`● ONLINE ● LIVE ● AI` state dots, Atmospheric Conditions, Live Markets, **System
Diagnostics** (CPU / Memory / Network / Storage bars), World Time, **System
Status** (AI Core ONLINE, Voice Engine ACTIVE, News Feed LIVE, Market Data LIVE,
Security NOMINAL, Threat meter), a scrolling World Intelligence Feed, a rotating
globe, a voice waveform, and a bottom row of *source toggle chips* (`CLAUDE`,
`YOUTUBE`, `BBC`, `MARKETS`, `GMAIL`, `SPOTIFY`, `WEATHER`, `TWITTER`). Footer:
uptime + version + ticker.

Honest note: it is a **data dashboard, not an agent console** — there is no
transcript, no tool log, no composer. Useful only as a density/aesthetic
reference and as a warning: most of that screen is weather and football.

### 4d. `nav-microsoft-jarvis.png` — Microsoft JARVIS / HuggingGPT

`github.com/microsoft/JARVIS`. Real, well-known, and its UI is **a plain Gradio
chat column with a settings gear and a `Submit` button**. No navigation, no
panels, no tool inspector — the task graph it builds is described in prose inside
the assistant's own message. Included as a negative result: name recognition ≠
UI to learn from.

### 4e. `nav-arwes.png` — Arwes

`github.com/arwes/arwes` (~7.5k stars) — a sci-fi/cyberpunk **UI framework**
(React primitives: `Animator`, `Frame*`, `BleepsProvider`, text reveal, background
grids), not an agent product. README says currently unmaintained but functional.
`arwes.dev` was unreachable during this research — docs site unverified. The
screenshot is Starwards, a community app built on it. Cite for motion/frame/bleep
aesthetics only; it is not an information-architecture reference.

### 4f. Checked and discarded

- **Open Interpreter `01`** (`github.com/openinterpreter/01`, ~5.1k stars, last
  pushed 2024-11) — voice interface, **no GUI/HUD**, no UI screenshots in the
  README. Nothing to learn from.
- **"hud.js"** — no project worth citing turned up.

### What these five agree on

1. **Almost nothing is behind navigation.** The two real agent consoles have
   3 and ~6 destinations respectively.
2. **State is ambient, not a page.** Models, skills, memory pressure, machine
   health, spend, and session counts are all read-only meters on the frame.
3. **Every permanent number is a live number.** No static labels.
4. **One composer, always in the same place**, on every screen.
5. **A command palette replaces the nav list** for anything rare.

The five things that appear in the permanent chrome of *every* console with a
real agent behind it (Hermes HUD and Mission Control converge on all five despite
opposite aesthetics):

1. Live clock / uptime
2. Connection or link state
3. Resource meters — CPU / GPU / memory, local and remote
4. **A cost or quota counter** — tokens today, $ spent, TTS quota
5. A running tool-call / event stream with a `Live` badge

Item 4 is the tell. A permanent cost meter is the strongest signal that a console
was built by someone who actually runs agents; the themed dashboards spend that
real estate on weather, stocks, and football instead.

---

## 5. Recommendation for ASKK

### 5.0 A naming landmine, first

**Do not call these "sections."** In ASKK, `Section` is already a normative
domain term — a part of the context Document, with a stability class and a
compaction rule (`GLOSSARY.md`, `DOMAIN.md` §2, ADR-009). A UI nav item is a
different thing. Call them **views** or **routes**. `MODULES/context.md` and
`MODULES/module.md` will fight you otherwise.

Second: `DOMAIN.md` says modules "serve routes + dashboard fragments" and the
registry generates Affordances. So the nav is **not a hardcoded list** — it is a
small fixed core plus whatever installed modules contribute. Design the core; let
the rest be generated.

### 5.1 The shape

ASKK already has the right frame (`DESIGN.md` §8: header · nav · stage · rail),
and it is the same frame both real agent consoles converged on. Don't add a
second navigation layer inside it.

**Five top-level views. That is the whole list.**

| # | View | Why it earns a slot |
|---|---|---|
| 1 | **Chat** (default route) | The product. Agent tabs live *in* this view, not as their own nav entries — `DESIGN.md` §9 already names "switch agents" as one of the two interactions that must feel good, and it is a tab strip, not a route change. |
| 2 | **Agents** | Where you read and edit the agent markdown — `soul` / `identity` / persona files. This is ASKK's equivalent of Hermes' Skills page, and it's the only screen that is a real editor. 5/9 of the surveyed products give agents a top-level slot (Dify, Flowise, AutoGen, CrewAI, OpenAI), and it's the one ASKK-specific artifact a user hand-edits. |
| 3 | **Memory** | Bounded, inspectable, prunable. Hermes proves a memory screen is worth having *and* that its job is pruning, not browsing (`journey list / edit / delete`; skills archive, memories delete). Include a capacity meter — Hermes ships one because bounded memory that silently overflows is a bug you can't see. |
| 4 | **Trace** | The event log projected. ASKK's I8 says every view is a projection of the log; this is the view that admits it. Tool runs, effects, phases, forge steps, replay/time-travel. Merge "logs", "traces", "runs", and "events" here — the category splits these into 2–3 nav items and it is a mistake for a single-operator tool. |
| 5 | **Settings** | One page, section-filtered like Hermes' Config (150+ fields, one page, a filter column). Sub-tabs: Models & providers · Capabilities & policy · Modules · Appearance · Storage & export. Not five nav entries. |

Plus **Forge**, conditionally: it is ASKK's most distinctive noun and it is a
gated multi-phase pipeline with per-phase approval — that genuinely needs a
screen. But it should appear in the nav **only while a forge run exists or is
proposed**, the way Hermes' `▶ N` badge appears only when background tasks are
in flight. A permanently visible nav entry for something you use once a week is
dead pixels five days out of seven.

### 5.2 What must be permanently on screen (the frame, not a view)

From the convergence in §4 and Hermes' status line in §2c. All of it belongs in
the existing header and rail — none of it is a view.

**Header:** agent state word (`ready` / `thinking…` / `running…` / `interrupted`),
active agent + model, **context-usage % meter** (click → token breakdown by
Section — you already have the section schema to break it down by, which is a
gift), **capability/policy state** (a `⚠` when anything dangerous is granted —
Hermes ships `⚠ YOLO` for exactly this reason), and the existing endpoint
sentence.

**Rail (right):** the live tool/effect stream with a `Live` badge. This is item 5
of the universal five and it is the single most important thing a multi-agent
console shows. It should never be a page.

**Footer strip** (`DESIGN.md` §8 already plans one): build id, deploy sha,
isolation state, source link. Add **turn elapsed / session elapsed** and a
**cost or token counter** — item 4 of the universal five, and the thing the
serious consoles have that the pretty ones don't.

Make the header items **user-toggleable**, as Hermes does ("Show in status bar").
It's the honest way to settle an argument about what deserves permanent space.

### 5.3 What must NOT be a top-level view

| Not a view | Where it goes instead | Evidence |
|---|---|---|
| **Models** | The **composer**, next to send. Hermes desktop explicitly puts the picker there and keeps the Models *page* only for setting the per-profile default. Model choice is a per-turn decision, not a destination. | `docs/user-guide/desktop.md` — "The model picker lives in the composer, just left of the microphone." |
| **Tools / Capabilities** | A Settings tab, plus per-tool cards inline in the trace. You inspect a tool when it runs, not by browsing a catalog. | Hermes has no Tools nav item; toolsets are a filter inside Skills and a Config category. |
| **Sessions / History** | A dropdown or right-rail list on the Chat view. Hermes' dashboard has a Sessions page *and* a session rail on Chat, and admits the rail is "read-only for switching — delete, rename, export… still live on the Sessions tab." For a solo browser tool, ship only the rail; fold destructive session ops into Settings → Storage. | `features/web-dashboard.md` |
| **Modules / Marketplace** | Settings → Modules, and the Forge view for anything you're building. A registry browser is a v2 problem. | — |
| **Analytics / Usage** | One number in the footer. A whole analytics page is a team-billing feature; ASKK has no accounts and no server (`GLOSSARY.md`: "no accounts, no sync"). | — |
| **Cron / Schedules, Channels, Webhooks, Pairing, Profiles, MCP, Plugins, Keys, API Keys** | Nothing. **ASKK has no server and no messaging gateway.** Hermes needs nine of its fourteen nav items purely because it is a long-running daemon with 20+ chat platforms attached. Copying that nav into a browser-only, single-operator tool would be cargo-culting a deployment model you deliberately don't have. | `GLOSSARY.md` Session/Memory: "no accounts, no sync… no server holds context." |
| **Docs / Templates / Resources** | A link in the footer. | — |

### 5.4 The three patterns worth stealing verbatim

1. **Hermes' Config page**: one route, a left filter column listing categories
   with live field counts (`General 15 · Agent 35 · Terminal 21 · Display 50…`),
   form controls on the right, and Save / Reset / Export / Import / raw-YAML
   toggle. It replaces an entire settings *tree* with one screen, and the
   export/import is what makes a browser-only tool's config portable.
2. **Mission Control's launcher cards**: each destination is a card carrying its
   own live number ("Task Board — 2 running · 6 queued"). If ASKK's Chat view
   wants a landing state, this is it — not an empty transcript.
3. **Hermes' page header**: title + inline live stat ("Skills — 0/0 enabled",
   "Sessions — 4 Total · 4 Active · 0 Archived · 8 Messages") + one primary
   action top-right. Cheap, and it means every page answers "how much is here?"
   before you scroll.

### 5.5 The one-line version

Five views — **Chat, Agents, Memory, Trace, Settings** — plus **Forge** when a
run exists; agents are tabs inside Chat, models live in the composer, tools and
sessions are contextual, and everything the operator needs to trust the agent
(state, context %, capability warning, live tool stream, elapsed, cost) lives in
the frame where it can never scroll away.


---

## 6. Screenshot inventory & gaps

Saved in this directory:

| File | What it shows |
|---|---|
| `nav-hermes-admin-config.png` | Hermes web dashboard — full left sidebar + the one-page Config with its section filter list |
| `nav-hermes-admin-system-top.png` | Hermes dashboard — sidebar scrolled to show CONFIG/KEYS; the System page |
| `nav-hermes-admin-sessions.png` | Hermes Sessions page — stats bar, channel-origin chips, per-row live/source badges |
| `nav-hermes-admin-skills-hub.png` | Hermes Skills page — "0/0 enabled" inline stat, ALL / TOOLSETS (27) / BROWSE HUB filters |
| `nav-crewai.png` | CrewAI Enterprise dashboard, full sidebar |
| `nav-jarvis-hermes-hud.png` | Jarvis HUD built on Hermes Agent — the numbered dual-rail layout |
| `nav-mission-control.png` | builderz-labs Mission Control — icon rail, live status strip, launcher cards |
| `nav-jarvis-8agent.png` | anuragnepal1999/JARVIS single-page HUD |
| `nav-microsoft-jarvis.png` | microsoft/JARVIS (HuggingGPT) Gradio UI — the negative example |
| `nav-arwes.png` | Arwes aesthetic reference (Starwards) |

### Not obtainable, stated plainly

- **OpenAI Agent Builder / Assistants playground sidebar** — `platform.openai.com`
  is behind Cloudflare + login and would not render headless. Only the canvas top
  nav (`Preview · Evaluate · Code`) is documented. Also deprecated, shutting down
  2026-11-30 — not worth chasing.
- **LM Studio screenshot** — the shell lacked macOS Screen Recording permission.
  Nav labels were read out of the installed app bundle instead, which is stronger
  evidence than a screenshot anyway.
- **LangSmith / CrewAI in-app screenshots** — both login-gated. LangSmith's nav is
  docs-derived; CrewAI's is from the official docs screenshot.
- **`arwes.dev`** — unreachable during this session (connection timeout on
  `arwes.dev`, `next.arwes.dev`, `play.arwes.dev`). Could be transient.
- **Hermes desktop app screenshots** — the docs describe the sidebar in prose but
  ship no sidebar screenshot in the repo. The dashboard screenshots above are the
  real visual evidence; §2b is text-only.
