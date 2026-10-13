# ASKK

A team of AI agents that runs in your browser. You talk to the **lead**; it
works out what you need, does small things itself, and hands larger parts
to its team as quests: the **searcher** looks things up on the internet and
the **humaniser** retells the findings in a human (or poetic) voice. Every agent runs on its own thread,
with its own inbox, tools, memory and status, and a UI attached to that
state. You see everything as it happens. See
[docs/philosophy.md](docs/philosophy.md).

## Two ways to run it

It is the same app either way. **Run it locally with Bun** to get every
capability. **Host the static build** anywhere to get the same app, with the
browser's restrictions.

| | Run locally with Bun | Hosted static site |
|---|---|---|
| Start | `bun run dev` (or the `askk` program) | `bun run build`, then upload `out/` |
| Agents work on | **a folder on your computer** (read, and change with your approval) | a workspace stored in the visitor's browser |
| Your model | from **`.env`**, or Settings | entered in **Settings** by each visitor |
| Calling the model | the page is on `localhost`, so any local server works | the model server must allow the site's origin (CORS), and `http://` models may be blocked from an `https://` page |
| Jobs and cron (`askk ask`) | yes | no |
| Chat, agents, team, skills, memory, dashboard | yes | yes |

The header shows which one you are on: "This computer" or "Browser only".
Its menu lists each capability, with the fallback used when it is missing.

## Requirements

- [Bun](https://bun.com) 1.4 or newer.
- An LLM the browser can reach: any OpenAI-compatible server or the
  Anthropic API. ASKK ships with **no model configured** (see
  [Models](#models)).

## Run locally with Bun (all capabilities)

```bash
bun install
cp .env.example .env     # set ASKK_MODEL_BASE_URL, ASKK_MODEL_ID, …
bun run dev              # http://127.0.0.1:3000 — agents work on this folder
```

This is the default way to run ASKK. The Next.js dev server, with hot
reload, also serves the local host API on the same origin (`/__askk/`). That
API gives the page what a browser can't have:

- your project folder: read it, and write or delete files with your
  approval;
- your model from `.env`;
- your MCP servers from `.mcp.json` (see [MCP tools](#mcp-tools));
- on a Mac, Apple's apps and services (Shortcuts, Reminders, Spotlight, …),
  each request approved by you.

Other options:

```bash
bun run dev -- --root ~/code/my-app  # work on another folder
bun run dev -- --read-only           # agents may read, never change
bun run dev -- --port 4000
bun run dev -- --hostname 0.0.0.0    # phones on your network can open it (browser-only for them)
```

### As one program: `askk`

```bash
bun run build:companion              # builds the app and compiles dist/askk
cd ~/code/my-app && /path/to/askk    # http://localhost:7717, workspace = this folder
askk --root ~/notes --port 7800 --read-only
```

`askk` is one executable with the app embedded. Copy it anywhere and run it
from the folder you want the agents to work in, with a `.env` there for your
model. It listens on `127.0.0.1` only.

To build for another platform, run
`bun --bun next build && bun scripts/build-companion.js --target bun-linux-x64`.
Any Bun `--target` works.

`bun run companion` is the same server without compiling: run `bun run build`
first, and it serves `out/` from this checkout.

| Option | Default | Meaning |
|---|---|---|
| `--root <dir>` | the folder you start in | The workspace agents read and write |
| `--port <n>` | 3000 (dev), 7717 (askk) | Port |
| `--read-only` | off | Agents can read, never write or delete |
| `--hostname <h>` | 127.0.0.1 | Dev only: interface to listen on |

### As a job: `askk ask` (scripts, cron)

```bash
askk ask "Summarize what changed in docs/ this week"       # compiled program
bun run ask -- "Summarize what changed in docs/ this week" # from this checkout
echo "Draft release notes from CHANGELOG.md" | askk ask --json
```

This sends one query to an agent (the lead, by default), prints the answer
on stdout and exits. The run uses the same agents, team, skills and prompts,
working on the current folder (or `--root`) with the model from `.env`. No
port is opened, and progress goes to stderr.

| Option | Meaning |
|---|---|
| `[query]` | The query; read from stdin when omitted |
| `--agent <name>` | Agent to ask (default: the lead) |
| `--root <dir>` | Workspace folder (default: the current folder) |
| `--read-only` | Agents may read, never change files |
| `--yes` | Approve every change the agents ask for (default: decline, and the answer says so) |
| `--model <key>` | Model to use (default: the one in `.env`) |
| `--models <file>` | Extra model connections in the `models.json` format |
| `--timeout <sec>` | Stop after this long (default 1800) |
| `--json` | Print `{ ok, agent, answer, error, seconds }` |
| `--quiet` | No progress on stderr (errors still print) |

Exit codes: `0` answered, `1` failed, `2` usage error, `124` timed out.

Each run starts with fresh memory. Here all the agents share one process
instead of one thread each; quests and reports work the same.

```cron
# Every weekday at 08:00
0 8 * * 1-5  cd ~/code/my-app && /usr/local/bin/askk ask --quiet --read-only "List TODOs added this week, by file" >> ~/askk-todos.log 2>&1
```

**Safety.** Every change an agent makes waits for your approval. The local
host API refuses:

- requests whose Host is not this machine (DNS rebinding);
- cross-origin pages, including reads of your `.env` model;
- paths that leave the root, including through symlinks.

## Host the static site (browser restrictions)

```bash
bun run build      # writes out/ (plain files)
bun run start      # preview it at http://localhost:3000
```

Upload `out/` to any static host: GitHub Pages, Netlify, Vercel, Cloudflare
Pages, S3 or nginx. It is the same app, limited to what a browser can do:

- **No access to anyone's computer.** Agents work in a workspace stored in
  each visitor's browser; the **Files** page shows it.
- **No `.env`.** The build ships with no model. Each visitor enters their
  own endpoint and key in **Settings**; these stay in their browser.
- **The browser calls the model directly.** The model server must allow
  the site's origin (CORS). An `http://` model, such as one on localhost,
  may be blocked from an `https://` page; Chrome and Firefox allow localhost,
  other browsers may not.
- **No jobs.** `askk ask` needs Bun on a machine.

Hosting notes:

- **Sub-path.** To serve under a sub-path, build with it:
  `NEXT_PUBLIC_BASE_PATH=/ASKK bun run build`. At the root of a domain, set
  nothing.
- **Clean URLs.** `/chat` must serve `chat.html`. Most hosts do this; for
  nginx: `location / { try_files $uri $uri.html $uri/ =404; }`.
- **GitHub Pages.** `.github/workflows/pages.yml` builds with `/ASKK` and
  publishes to the `gh-pages` branch on every push to `main`. The site is at
  https://kaush4l.github.io/ASKK/.

To try the hosted restrictions locally, run `bun run dev:browser` (the dev
server without the host API).

## Features

| Page | What it does |
|---|---|
| **Chat** | Talk to an agent. Shows each step: thoughts, tool calls and results, quests handed to other agents, and approval cards for every change. The `<>` button shows the exact prompt sent to the model. The engine bar switches between agents and opens more. |
| **Agents** | Every agent's definition: role, tools, artifacts, model. Edits are saved in this browser; reset returns to the file. |
| **Home** | The live dashboard. A welcome in which one light splits into your team, then the team as a live picture: who works, who waits, quests travelling from the lead. Below it: ask the lead, agent cards, recent activity and the workspace. |
| **Files** | The workspace agents work on: your folder (local) or the browser's (hosted). |
| **Settings** | Model connections, and the default model. |
| **Status bar** | Pinned to the bottom of every page. Shows where ASKK runs, then one dot per agent: green working, amber waiting or needs approval (with a count), red error. Hover a dot for its quests and inbox, and click it to open that agent's chat. On the right: what the selected agent is doing, its model, speed and context use. |

**How the agents work**

- **Soul and role.** Every agent shares one identity (`public/agents/soul.md`).
  Each agent wears its own hat: the body of its `agent.md`. See
  `docs/soul-and-role.md`.
- **Lead and team.** Ask the lead anything the internet knows: it quests the
  searcher (web search + page reading, sources linked), then the humaniser,
  and answers with the humaniser's reply. Its quests end its turn; the
  reports wake it. Press **Call back** to recall quests that are still out.
- **Long-running work.** There is no step or round limit. Instead, a
  supervisor sends the lead a status check with each agent's latest work
  (every 5 minutes or 10 steps). The lead lets it run, steers it, or calls it
  back. Set `check_minutes` or `check_steps` in the lead's `agent.md` to
  change the cadence, and `max_steps` or `max_rounds` to cap an agent
  anyway.
- **Artifacts.** These are live objects shown in the prompt in their latest
  state:
  - **filesystem**: the folder tree and the files the agent has open.
  - **skills**: procedures loaded on demand.

  See `docs/artifacts.md`.
- **Skills** are in `public/skills/<name>/SKILL.md`. To add one, create its
  folder and list it in `public/skills/index.json`.
- **Memory.** Each agent's conversation is saved as Markdown in browser
  storage. It is summarized automatically when the context window fills up.
- **Your Mac.** Running locally on a Mac, agents can use Apple's apps
  through `apple.*` tools: run your Shortcuts, add or read Reminders, search
  with Spotlight, use the clipboard, speak, notify and open links. The agent
  proposes each request, and the approval card says in plain words what it
  will do; nothing runs until you approve (macOS also asks once per app).
  See `docs/apple.md`.
- **Dictation.** The microphone in the chat box uses Apple's dictation. It
  works in Safari and in every browser on iOS, on `localhost` or `https`
  only.

## Models

ASKK ships with **no model**: `public/models.json` is empty and served
publicly, so it must never hold an endpoint or a key. You supply your own,
in one of two places:

- **`.env`**, when you run locally with Bun (`bun run dev`, `askk`,
  `askk ask`):

  ```bash
  cp .env.example .env    # then set ASKK_MODEL_BASE_URL, ASKK_MODEL_ID, …
  ```

  `.env` is git-ignored and read at startup, so restart after editing it.
  `bun run dev` reads it from this project folder; `askk` reads it from the
  folder you start it in. The local server passes it to the page on your
  machine only (`/__askk/models`), and the header shows "Your model from
  .env" when it is set. Headless jobs read it directly.
- **Settings**, in any browser, including the hosted site. Enter the
  provider (`openai` or `anthropic`), base URL, model id and API key. These
  are saved only in that browser's storage.

Pick one model as the default; every agent uses it unless its `agent.md`
names another (`model: <key>`).

## Integrations (Telegram, …)

Connections to outside services live in `integrations/<name>/index.js`
(kept out of git, like `vendor/`), configured from `.env`. Each one gives
agents tools, named `<name>.<tool>` and listed like MCP servers
(`mcp: [telegram]`, or the lead's `mcp: ["*"]`), and may also **listen**.

**Telegram**: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (your
personal chat) in `.env` and restart. `TELEGRAM_SEND_CHATS` adds chats the
agents may send to but that are never listened to (e.g. a group).

- Tools: `telegram.send_message` (asks you first) and
  `telegram.read_messages`.
- While ASKK runs continuously (`bun run dev` or `askk`, not `askk ask`), it
  polls the bot. A message from your chat goes to the lead, and the lead's
  answer is sent back as a reply. Keep the app open in one tab: it does the
  hand-over and shows the conversation in the lead's chat.
- Other chats are ignored. Messages older than five minutes at start-up are
  skipped. Only one program may poll a bot at a time.

## MCP tools

Agents can use the tools of any [MCP](https://modelcontextprotocol.io)
server, when ASKK runs locally. List the servers in `.mcp.json` in the
folder you start ASKK in (git-ignored; the usual `mcpServers` format):

```bash
cp mcp.example.json .mcp.json   # then edit, and restart ASKK
```

- `"command"` + `"args"` (+ `"env"`, `"cwd"`) runs a local server (stdio);
  `"url"` (+ `"headers"`) connects to a remote one (Streamable HTTP).
- Each tool becomes an agent tool named `<server>.<tool>`. The lead gets
  every server (`mcp: ["*"]` in its `agent.md`); give another agent
  `mcp: [server]` or one tool, `mcp: [server.tool]`.
- **Approval** per server, `"approval"`: `auto` (default) asks you before
  every call except tools the server marks read-only; `always`; `never`.
  The card says which tool on which server, with the inputs.
- Servers start on first use and stay up; a failed server is reported to
  the agent, the rest work. Agents cannot edit `.mcp.json` or `.env`.
- The hosted site has no MCP (it needs the local server).

## Project layout

```
app/, components/     the pages and UI (static export)
backend/core/         the contracts and the flow: engine, artifact, tool, prompt template
backend/engines/      strategies (ReAct)
backend/features/     implementations: filesystem, skills, mcp, apple (+ catalogue)
backend/runtime/      engine threads (Web Workers), routing between inboxes
public/agents/        soul.md, agent definitions (index.json lists them)
public/skills/        skills
companion/, scripts/  host API, companion server, dev server, companion build
```

- [docs/philosophy.md](docs/philosophy.md): the engineering philosophy.
- [docs/artifacts.md](docs/artifacts.md): artifacts, design and roadmap.
- [docs/soul-and-role.md](docs/soul-and-role.md): soul vs role, with the research behind it.
- [docs/apple.md](docs/apple.md): Apple capabilities (on-device model, Safari, macOS tools and frameworks) and the plan to use them.
- `CLAUDE.md`: project rules and how the engines work.
