# Agent: default

The default way to write and initialize an agent: one page,
human-readable, machine-parseable by headings and lists (the same way
history.md entries are read), so a loader can read it without a JSON
parser. This is the shipped default. A user-added personal/agent.md
wins over this file when present; user-added agent.md saves go to
personal/, never to public/defaults/.

## Soul

- instructions: personal/instructions.md
- fallback: public/defaults/instructions.md
- preview: You are ASKK, a helpful assistant. Answer plainly.

## Model

- default: desk default (first entry in personal/model.json)
- model: (resolved from the desk default at load time, never written here)
- key: (never written here — resolved server-side from personal/.env)

## Tools

Default tools, loaded for every agent. No web tools.

### files

- files.list — immediate — list files under the live artifact root
- files.read — immediate — read a file, with from/lines slice for big files
- files.write — immediate — write a file inside the root
- files.edit — immediate — replace one exact passage, old must match once
- files.append — immediate — append to a file
- files.search — immediate — case-insensitive text search under a folder/file
- files.open — live-state — keep a file open, re-read on open (max 25)
- files.close — live-state — close an open file
- files.focus — live-state — focus a section of a big file, or a folder as tree root

### terminal

- terminal.run — done — run a command to its end, return exit + last lines
- terminal.start — stream — start a long session, keep it running
- terminal.wait — stream — wait until exit, until text appears, or seconds pass
- terminal.read — stream — read a session's last lines
- terminal.send — stream — send a line to a session's stdin
- terminal.stop — stream — stop a session
- terminal.list — immediate — list every session

## Live artifact

- id: default
- location: (project root — the desk's root at load time)
- state: personal/memory/agent/default/state.md
- history: personal/memory/agent/default/history.md

## Initialization

How an agent is initialized from this file, in order:

1. createDesk — load the desk (personal/ else public/defaults/ fallback)
2. load agent.md — read Soul, Model, Tools, and Live artifact above
3. createEngine — create the engine with the soul instructions
4. load core tools — attach the 16 default tools listed above
5. create/load live artifact — create or load the live artifact for the location
6. twin — return the live object (engine twin + tools + artifact twin) for the UI

## Live-object test

The test this definition enables:

> As soon as an event happens (LLM start, tool call, artifact open, error),
> the UI object reflects it without fetch/manual update.

In this app that test is the client live-event bus (see
src/lib/live-events.js): the combined view takes an initial snapshot
from /api/engine, /api/tools, /api/artifact, /api/agent and /api/soul
on load, then updates immediately on bus events emitted by the chat
flow — no refetch after a reply. A server SSE stream is a later step,
not claimed here.
