# ASKK

Teams of AI agents you can watch work. The repository holds the **core** (`backend/kernel/`: the agent loop,
tools, artifacts, teams) and the **live UI**. A **desk** — a team with its agents and tools — lives in its own
folder under `custom/`. When the server starts a desk, the host gives it the infrastructure (files, web, MCP tool
servers, local models, a wake book, Telegram) and every browser tab follows it live.

Everything that runs has a twin on screen: each agent has a page (its role, tools, artifacts, runs, model calls),
each tool call shows in the Live feed drawn by its tool's view, each artifact is drawn by its view, and the desk's
background work (watchers, schedule, wakes, Telegram) streams into a desk log. See
[docs/philosophy.md](docs/philosophy.md).

## Requirements

- [Bun](https://bun.com) 1.4 or newer.
- A desk in `custom/<desk>/` (git-ignored; see `custom/README.md`) and the models it names (any OpenAI-compatible
  server, the Anthropic API, or the claude / codex / gemini CLIs and Apple's on-device model on this Mac).

## Run

```bash
bun install
bun run dev                                  # every desk in custom/, http://127.0.0.1:3000
bun run dev -- --desks custom --port 1111    # the same on another port (the always-on launchd agent uses this)
bun run dev -- --agents custom/<desk>        # one desk alone, on its own port and Next build folder
```

`bun run dev` is the Next dev server (hot reload) with the desks and the host API on the same origin
(`/__askk/`). One process hosts every desk; the header's desk switcher picks the one a tab shows.

| Option | Default | Meaning |
|---|---|---|
| `--desks <dir>` | `custom` | Host every desk (folder with a `main.js`) in it |
| `--desk <name>` | the first | The desk a new tab opens |
| `--only a,b` | all | Host only these desks |
| `--agents <dir>` | `ASKK_AGENTS` | Host this one desk alone |
| `--port <n>` | 3000 (dev), 7717 (askk) | Port |
| `--read-only` | off | The workspace can be read, never changed through the host API |
| `--hostname <h>` | 127.0.0.1 | Interface to listen on (other devices get the "no desk here" page) |

### As one program: `askk`

```bash
bun run build:companion        # builds the UI and compiles dist/askk
./dist/askk --desks custom     # http://localhost:7717
```

`bun run companion` is the same server without compiling (run `bun run build` first). Never run `next build`
while a dev server runs in the same folder.

### Hand a desk work: `send` (scripts, cron)

```bash
bun run send -- --agents custom/<desk> "Run the close."                      # queued for the lead
bun run send -- --agents custom/<desk> --agent grader "Grade today."         # another agent
bun run send -- --agents custom/<desk> --wait "What is the book now?"        # print the answer
bun run send -- --agents custom/<desk> --start --unless-booked 90 "Start the day."
```

With the server up the text goes to the agent (default: the lead) and every tab shows the run. `--start` starts
the server first (launchd's `askk.desks` when installed). With no server the text is booked in the desk's wake
book and runs when the server comes up. Exit codes: `0` sent (answered with `--wait`), `1` refused or failed,
`2` usage, `3` no server (booked), `124` timed out.

## The live UI

| Page | What it shows |
|---|---|
| **Home** | The desk as a live tree (who works, who waits, quests travelling), ask the lead, the desk's levels (every team as a card with its quest, members and artifacts), recent activity, the workspace. |
| **Agents** | One page per agent: description, role (its agent.md), model, folder; its tools by type and view (marked while in use); the artifacts it holds; its runs as a thread with refused answers marked; the prompt its next step would see; its model calls. Talk to it here. |
| **Live follow** | Every tool call and refused answer as it happens, drawn by the tool's view; every artifact; the desk log; the wake book. |
| **Files** | The desk's workspace (`data/`). |
| **Speech to speech** | Talk to the lead and hear it work (on-device recognition and voices on a Mac). |
| **Status bar** | Where the desk runs, one dot per agent, the desk's newest background line, the selected agent's activity and model calls. |

With no desk server (a static copy of the UI), every page says how to start one.

## Host API and safety

The host API (`companion/server/host-api.js`) answers only on this machine's loopback address and port (DNS
rebinding), refuses cross-origin pages, needs a same-origin JSON body for every write, and keeps every path
inside the desk's workspace (symlinks included). Agents cannot write `.env*` or `.mcp.json`. A desk's own
`host()` hook guards every tool call it allows (its rules live in desk code agents cannot write).

## Models

A desk names its models in its own code (e.g. `custom/<desk>/desk.config.js`) and calls them through
`backend/kernel/model/llm.js`: OpenAI-compatible `/chat/completions` or Anthropic `/messages`, keys from `.env`. Models
this Mac runs need no key: the host serves the claude, codex and gemini CLIs (signed in once in a terminal) and
Apple's on-device model as OpenAI-compatible endpoints under `/__askk/llm/<provider>/v1`.

## Integrations (Telegram, …)

`integrations/<name>/index.js` (git-ignored), configured from `.env`. A desk lists the ones it runs
(`integrations: ["telegram"]`); their tools reach the desk through `mcp/call`. **Telegram**: set
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (`TELEGRAM_OWNER_ID` when different). The owner's messages go to the
desk's lead and the answers come back, with no tab open; every run posts one live status message, edited in place.

## MCP tools

List servers in `.mcp.json` in the folder ASKK starts in (`cp mcp.example.json .mcp.json`, usual `mcpServers`
format; stdio or Streamable HTTP), or in a desk's own `mcp.json`. They start on first use and stay up. A url server
may read its bearer token from a shared OAuth token file (`"oauth": "${MY_OAUTH_FILE}"`).

## Project layout

```
backend/kernel/       the core: agent/ (Agent, reply, report), tool/ (Tool, AgentTool, defineTool), artifact/
                      (Artifact, SharedBoard, Checklist, Quality, Schedule), desk/ (buildDesk), model/ (llm wire),
                      util/; every element's twin(); index.js the one entry, README.md the map
backend/live/         the live UI's client: one team/stream per tab → agents, the desk (tree, boards, artifacts),
                      the desk log; activity, visual state, the Live feed, the wake book, the workspace
backend/hardware/     speech to speech (browser side)
components/, app/     the pages (static export): home, agents, live, files, sts; views/ draws artifacts by view
companion/            the host: server/ (host API, desks, compiled companion), team/ (desk loader, kernel-team,
                      Telegram, live status, transcripts), capabilities/, hardware/, shared/
scripts/              dev.js (dev server), send.js (hand a desk work), build-companion.js
custom/               desks (git-ignored): custom/README.md
```

- [docs/philosophy.md](docs/philosophy.md): the engineering philosophy.
- [docs/soul-and-role.md](docs/soul-and-role.md): soul vs role in an agent's prompt.
- [docs/apple.md](docs/apple.md): Apple capabilities on this Mac.
- `CLAUDE.md`: project rules and how the pieces fit.
