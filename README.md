# ASKK

A team of AI agents that runs in your browser. You talk to the **lead**; it
works out what you need, does small things itself, and hands larger parts
to its team (planner, critic) as quests. Every agent runs on its own thread,
keeps its memory in browser storage, and calls your LLM directly from the
page. There is no ASKK server holding state: the app is a static web page.

It also runs headless: one query in, the answer out, for scripts and cron
(section 3).

Every agent is a live object: its own thread, its own inbox, its own tools
and status, and a UI attached to that state. You see everything as it
happens: thinking, each tool call, quests handed out, who is waiting for
whom, and every change waiting for your approval. See
[docs/philosophy.md](docs/philosophy.md).

What changes between the ways of running it is **where the agents' files
live**:

| | Folder on your computer | Files in the browser |
|---|---|---|
| How | Run ASKK as a process (dev server or companion) | Host the static build anywhere |
| Agents read/write | the folder you start it in (`--root`) | a workspace stored in the browser (OPFS) |
| Header shows | "This computer" | the missing capabilities, with the fallback |

Everything else (chat, agents, memory, skills, models, dictation) is the
same in both.

## Requirements

- [Bun](https://bun.com) 1.4 or newer: `bun install` once.
- An LLM the browser can reach. The shipped default is a local
  OpenAI-compatible server at `http://127.0.0.1:8873/v1` (`public/models.json`).
  Add or change models on the **Settings** page (see [Models](#models)).

## 1. Run as a process (your folder)

The agents work on a real folder: they can read your project and, with your
approval for each change, write and delete files in it.

### Development: `bun run dev`

```bash
bun run dev                          # http://127.0.0.1:3000, workspace = this folder
bun run dev -- --root ~/code/my-app  # work on another folder
bun run dev -- --read-only           # agents may read, never change
bun run dev -- --port 4000
bun run dev -- --hostname 0.0.0.0    # let phones on your network open it
```

The Next.js dev server with hot reload, plus the host API on the same origin
(`/__askk/`). Use this while working on ASKK itself.

Phones and other devices on the network get the app in browser-only mode:
the host API answers only to this machine.

### A single program: `dist/askk`

```bash
bun run build:companion              # builds the app and compiles dist/askk
cd ~/code/my-app && /path/to/askk    # http://localhost:7717, workspace = this folder
askk --root ~/notes --port 7800 --read-only
```

One executable with the built app embedded. Copy it anywhere and run it from
the folder you want the agents to work in. It listens on `127.0.0.1` only.

To build for another platform, run
`bun --bun next build && bun scripts/build-companion.js --target bun-linux-x64`.
Any Bun `--target` works.

### Without compiling: `bun run companion`

```bash
bun run build                        # static export to out/
bun run companion -- --root ~/code/my-app --port 7717
```

This is the same server as `dist/askk`, serving `out/` from this checkout.

**Options (dev and companion)**

| Option | Default | Meaning |
|---|---|---|
| `--root <dir>` | the folder you start in | The workspace agents read and write |
| `--port <n>` | 3000 (dev), 7717 (companion) | Port |
| `--read-only` | off | Agents can read, never write or delete |
| `--hostname <h>` | 127.0.0.1 | Dev only: interface to listen on |

**Safety.** Every change an agent makes waits for your approval in the chat.
The host API refuses:

- requests whose Host is not this machine (DNS rebinding);
- cross-origin pages;
- paths that leave the root, including through symlinks.

## 2. Host the static build (browser-only)

```bash
bun run build      # writes out/
bun run start      # preview out/ at http://localhost:3000 (uses `serve`)
```

`out/` is plain files. Upload it to any static host: Netlify, Vercel,
Cloudflare Pages, GitHub Pages, S3, or nginx. Agents then work in a workspace
stored in each visitor's browser. The **Files** page lets you browse it.

Two hosting requirements:

- **Serve it at the root of a domain** (`https://askk.example.com/`), not
  under a sub-path. The app loads `/agents/`, `/skills/` and `/models.json`
  from the root.
- **Clean URLs.** `/chat` must serve `chat.html`. Most static hosts do this
  already. For nginx:

  ```nginx
  location / { try_files $uri $uri.html $uri/ =404; }
  ```

**Reaching your LLM from a hosted page.** The browser calls the model
directly, so:

- The model server must allow the page's origin (CORS).
- A page served over `https://` calling `http://127.0.0.1:…` works in Chrome
  and Firefox, which treat localhost as secure. Other browsers may block it as
  mixed content. Running ASKK as a process (section 1) avoids this, because
  the page itself is on localhost.

You can also run the dev server without the host API, to try browser-only
mode locally: `bun run dev:browser`.

## 3. Run a query as a job (scripts, cron)

```bash
askk ask "Summarize what changed in docs/ this week"     # compiled binary
bun run ask -- "Summarize what changed in docs/ this week" # from this checkout
echo "Draft release notes from CHANGELOG.md" | askk ask --json
```

This sends one query to an agent (the lead, by default), prints the answer
on stdout and exits. The run uses the same agents, team, skills and prompts
as the app. The agents work on the current folder (or `--root`), exactly
like local mode, through the host API in the same process; no port is
opened. Progress goes to stderr.

| Option | Meaning |
|---|---|
| `[query]` | The query; read from stdin when omitted |
| `--agent <name>` | Agent to ask (default: the first in `agents/index.json`, the lead) |
| `--root <dir>` | Workspace folder (default: the current folder) |
| `--read-only` | Agents may read, never change files |
| `--yes` | Approve every change the agents ask for. Without it, changes are declined and the answer says so |
| `--model <key>` | Model from `models.json` (default: its default) |
| `--models <file>` | Extra model connections in the `models.json` format. Keep API keys here or in `ASKK_API_KEY`, never in `public/` |
| `--timeout <sec>` | Stop after this long (default 1800) |
| `--json` | Print `{ ok, agent, answer, error, seconds }` |
| `--quiet` | No progress on stderr (errors still print) |

Exit codes: `0` answered, `1` failed, `2` usage error, `124` timed out.

Each run starts with fresh memory. All the agents run in the one process
here, rather than one thread each, but quests and reports work the same.

**Cron example.** Every weekday at 08:00, report on a project and keep the
answer:

```cron
0 8 * * 1-5  cd ~/code/my-app && /usr/local/bin/askk ask --quiet --read-only "List TODOs added this week, by file" >> ~/askk-todos.log 2>&1
```

## Features

| Page | What it does |
|---|---|
| **Chat** | Talk to an agent. Shows each step: thoughts, tool calls and results, quests handed to other agents, and approval cards for every change. The `<>` button shows the exact prompt sent to the model. The engine bar switches between agents and opens more. |
| **Agents** | Every agent's definition: role, tools, artifacts, model. Edits are saved in this browser; reset returns to the file. |
| **Files** | The workspace agents work on: your folder (process) or the browser's (static). |
| **Settings** | Model connections, and the default model. |
| **Status bar** | Pinned to the bottom of every page. Shows where ASKK runs, then one dot per agent: green working, amber waiting or needs approval (with a count), red error. Hover a dot for its quests and inbox, and click it to open that agent's chat. On the right: what the selected agent is doing, its model, speed and context use. |

**How the agents work**

- **Soul and role.** Every agent shares one identity (`public/agents/soul.md`).
  Each agent wears its own hat: the body of its `agent.md`. See
  `docs/soul-and-role.md`.
- **Lead and team.** The lead turns your goal into complete quests for the
  planner and critic and stops. Their reports wake it, and it answers in its
  own words. Press **Call back** to recall quests that are still out.
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
- **Dictation.** The microphone in the chat box uses Apple's dictation. It
  works in Safari and in every browser on iOS, on `localhost` or `https`
  only.

## Models

`public/models.json` ships the default connections. It is served publicly,
so **never put an API key in it**.

To add a connection, open **Settings** and enter the provider (`openai` or
`anthropic` protocol), base URL, model id and API key. These are saved only
in this browser's storage.

Pick one model as the default; every agent uses it unless its `agent.md`
names another (`model: <key>`).

## Project layout

```
app/, components/     the pages and UI (static export)
backend/core/         the contracts and the flow: engine, artifact, tool, prompt template
backend/engines/      strategies (ReAct)
backend/features/     implementations: filesystem, skills (+ catalogue)
backend/runtime/      engine threads (Web Workers), routing between inboxes
public/agents/        soul.md, agent definitions (index.json lists them)
public/skills/        skills
companion/, scripts/  host API, companion server, dev server, companion build
```

- [docs/philosophy.md](docs/philosophy.md): the engineering philosophy.
- [docs/artifacts.md](docs/artifacts.md): artifacts, design and roadmap.
- [docs/soul-and-role.md](docs/soul-and-role.md): soul vs role, with the research behind it.
- `CLAUDE.md`: project rules and how the engines work.
