# Agent: default

Version: 2

This file is a RENDER TEMPLATE, not an inventory. It does not list
tools, models, files, or skills literally — it names the elements
the template composes, and each element says which live variable
it is filled from at runtime. The renderer (src/core/render-template.js)
takes this template + the current desk object and produces the
instructions string at that moment. Changing the desk (a tool added
to the registry, a file opened in the live artifact, a new session
message) changes the rendered instructions with NO edit to this file.
The renderer is src/core/agent-md.js (renderAgentInstructions),
which fills each element from the live desk and caches per
element: a Tools change re-renders Tools only, an unchanged
object returns the cache, a registry change invalidates it.

A user-added personal/agent.md wins over this file when present;
user-added agent.md saves go to personal/, never to public/defaults/.

## Soul

- variable: desk.soul
- carries: soul text (who the agent is — character, role, north star), from personal/soul.md else public/defaults/soul.md
- note: soul is NOT instructions — the two are separate files and are never merged into one string
- preview: generated at render time (first line, truncated) — never stored here as a separate copy

## Instructions

- variable: desk.engine.instructions
- carries: instructions text (how the agent answers), from personal/instructions.md else public/defaults/instructions.md
- note: shown as its own element, not folded into Soul

## Agent

- variable: desk.engine twin + desk.defaultInference
- carries: engine twin (model, instructions preview), desk default model, provider, endpoint, status, inference count
- key: never written here — resolved server-side from personal/.env

## History

- variable: session messages + agent history.md entries
- carries: session history AND agent history, labelled separately, never merged
- session: the current conversation messages, in order
- agent: parsed history.md entries (timestamp · action · agent · path · detail)

## Tools

- variable: desk.tools (the live tool registry)
- carries: tool specs at render time — name, description, input, expectation — for exactly the tools in the registry at that moment
- web: none — the registry must contain no web.* tool; this is a guard on the registry, not a list in this file
- note: adding, removing, or changing a tool in the registry changes the rendered Tools section, with no edit to this file

## Live Artifacts

- variable: desk.liveArtifact twin
- carries: artifact id, open files, focus, modified files (summary only in the instructions string; bounded previews live in the UI, not here)
- id: default
- state: personal/memory/agent/default/state.md
- history: personal/memory/agent/default/history.md

## Skills

- variable: desk.skills
- carries: the skills list at render time
- note: Skills will be added later — the current list is empty, and this template invents no skill definitions

## Memory

- variable: desk.memory (live artifact state + history)
- carries: agent memory — state (open, focus, modified) + agent history entries, labelled, never merged with session chat
- state: personal/memory/agent/default/state.md
- history: personal/memory/agent/default/history.md
- note: personal memory wins when present, else the public template in public/defaults/memory/agent/default/ (empty state, no fake history); writes never go to public/defaults/

## Observations

Template-level observations only — lessons that apply to every
agent, written by subagents improving this template. Shape,
machine-parseable like history.md entries: each observation is
a bullet whose four fields, in order, are date, agent-id,
observation, and improvement, separated by middle dots, with
an optional following improvesOn line naming the previous
version or element it changes. (The shape is described here
in prose on purpose, so this description itself is never
parsed as an observation entry.)

Run-specific observations (what happened in one run, file
paths, results) do NOT go here — they go to
personal/memory/agent/<id>/history.md and are never pushed.
No keys, no absolute paths, no .env content in either place.

## Initialization

How an agent is initialized from this template, in order:

1. createDesk — load the desk (personal/ else public/defaults/ fallback)
2. load agent.md — read this template: section structure + variable references above
3. createEngine — create the engine with the soul instructions
4. load core tools — attach the live tool registry (the Tools variable's source)
5. create/load live artifact — create or load the live artifact for the location
6. render — renderAgentInstructions(template, desk): fill each element from the desk at runtime, per-element cached (see src/core/agent-md.js)
7. twin — return the rendered twin (engine twin + rendered sections) for the UI

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
