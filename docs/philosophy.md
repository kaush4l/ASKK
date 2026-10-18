# Engineering philosophy

ASKK is a team of agents you can watch work. Every design choice follows from one idea:

> **Everything that runs has a UI twin. The kernel is plain code, but each agent, tool, artifact, run and piece of
> background work reaches the screen as it happens, so the owner can follow the trail.**

## 1. The core, the desk, the host

- **The core** (`backend/kernel/`) is the agent loop and its parts — `Agent`, `Tool`, `Artifact`, teams, checklists,
  quality, schedule, reports — plain code with no host dependency.
- **A desk** (`custom/<desk>/`) is one team built on the core: its agents (folders with `agent.md`), its tools and
  artifacts, its background work.
- **The host** (`companion/`) starts the desk and gives it the infrastructure: files, web, MCP tool servers, local
  models, the wake book, Telegram, and the team stream every tab follows.

## 2. Agents never wait on each other's threads

An agent runs one request at a time. A call to another agent is a quest — a brief with the requirement, the ask
and the outcome — and the report comes back as its result. Calls in one step run together. Nothing blocks the
desk: the owner can message any agent, and the desk's own watchers keep running.

## 3. Every element has a twin

| In the kernel | On the screen |
|---|---|
| an agent (its agent.md, tools, artifacts) | its page: role, tools by type and view, artifacts held, runs, next prompt, model calls |
| an agent's live state | its colour in the tree, its dot in the status bar, its activity line |
| a run (request → steps → answer) | the thread on its page; the Telegram status message |
| a tool call | a row in the Live feed, drawn by the tool's `view` |
| an answer refused (gate, format) | a row in the thread and the feed, with the reason |
| an artifact | one renderer per view, on its team's card, in Live and on its holders' pages |
| a model call | the agent's stats: calls, latency, prompt and reply size |
| the desk's background work | the desk log (watchers, schedule, wakes, Telegram) |

A new kernel event or field reaches the stream and gets its view in the same change. If the kernel knows it and
the screen cannot show it, that is a bug.

## 4. State is the interface

The server keeps one immutable snapshot per agent and streams it as patches (`team/stream`). The browser keeps
one store per element (`backend/live/`): agents, the desk (tree, boards, artifacts), the log. Components subscribe
(`useSyncExternalStore`) and only render.

- **Behaviour lives in the kernel and the desk, not in components.** Components read state and call the agent's
  methods (`send`, `stop`, `preview`, `clearMemory`). They never decide what an agent does.
- **Every surface reads the same state.** Home, the agent page, Live follow, the status bar, speech to speech and
  the Telegram status all subscribe to it. A new view is a new subscriber, never a new code path in the kernel.

## 5. The owner stays in control

- **Anything in flight can be stopped**: from the page, the status bar, Telegram (`/stop`).
- **The desk's rules live where agents cannot write**: its `host()` guard checks every tool call.
- **Results are reported honestly.** A failed call is recorded as a failure, a refused answer says why, and the
  report format is checked in code.

## 6. The prompt shows the present

Every step renders the whole prompt in the owner's reading order (2026-10-17): soul → role → artifacts (latest
state only) → the request (and the owner's guidance) → earlier runs → this run's steps → tools → the response
format. Artifacts never show a log of edits, so context stays
small however much work happens; old step results keep head and tail.

## 7. Identity apart from the job

The soul is who every agent is: values and character, the same in every role. The role (`agent.md` body) is the
hat for this work: what the work looks like, its rules, and what has been learned. See `soul-and-role.md`.

## Checklist for a change

- Does the new behaviour reach the stream, and does it have a view?
- Does it live in the kernel or the desk, not in a component?
- Can the owner see it and stop it?
- Does a long or background job write to the desk log?
- Does it run on a phone-width screen as well as a desktop?
