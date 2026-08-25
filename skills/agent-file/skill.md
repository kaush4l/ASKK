---
name: agent-file
description: The house rules for an agent file in this browser — every frontmatter key, what each one refuses, and what a tools list actually grants. Read it before writing or changing an agent.
---

An agent is a file: YAML frontmatter, then a markdown body that IS its system
prompt. Nothing else defines an agent here. `write_agent` writes the same file
from five arguments — `name`, `description`, `prompt`, `tools`, `space` — so
these rules govern that call too.

The file starts with `---` on its own first line and the frontmatter ends with
another `---`. Everything after that is the prompt; no fence, no heading.

## The keys

- `name` — short, lowercase, letters digits `-` and `_`. It is the folder name.
  An empty or absent `name` falls back to the folder.
- `description` — one line, third person, what the agent does. Other agents read
  this line to decide whether to call it, so write it for them.
- `model` — a key in the model catalogue, never a URL. `local` unless you know
  otherwise.
- `temperature` — a number. `0.2` for judgement and formats, `0.7` for prose.
- `engine` — `react` or `base`, and nothing else. `react` is the tool loop;
  `base` is one reply with no tools at all. Absent means `react`.
- `role` — `entry`, `summarizer` or `critic`, or absent. It names a job the app
  looks up; do not claim one an existing agent already holds.
- `stages` — the loop, in order, from `plan`, `work`, `verify`, `critique`.
  Absent is the plain react loop, which is the right answer for most agents.
- `passes` — how many times the stages list is walked. Needs a stages list.
- `tools` — the allowlist. See below; this is the key that gets agents wrong.
- `space` — a shared space name, or empty. Naming one makes the space and
  workspace tools available for `tools` to NAME; it does not hand them over.
- `compact_at`, `keep_recent`, `max_rounds` — whole numbers.

## What the loader refuses outright

A refused file does not load. Every one of these is a real refusal:

- `engine:` that is not `react` or `base` — a misspelling would look applied and
  select nothing.
- `engine: base` with a non-empty `tools:` list, or with a `stages:` list. One
  reply, no tools, no stages — the file would be asking for two things at once.
- a `stages:` list with no `work` in it. `work` is the stage that acts.
- `passes:` above 1 with no `stages:` list to walk.
- `tools:` or `stages:` whose value is neither `[a, b]` nor a bare key with
  `- name` lines under it. A dropped `tools:` line would read as EMPTY, and
  empty grants everything — silence must never fail towards more capability.
- a number key that is not a whole number, or `temperature` that is not a
  number.

## What a tools list actually grants

- `tools: []` — or the key absent — means EVERY built-in tool, including
  `write_agent`. An agent whose job is haiku does not need to be able to write
  agents. Name the tools instead; this is the single most common mistake.
- A non-empty list is the WHOLE grant. It names built-ins and other loaded
  agents in one breath, because the model is never told which is which; naming
  an agent makes that agent callable as a tool.
- `space:` plus a non-empty list grants exactly the names in the list, so a
  read-only agent with a real folder is expressible: name `read_file`,
  `list_files`, `find_files` and no `exec`, and there is no shell.
- A name in the list that matches no tool and no loaded agent is dropped and
  reported on the agent's card. It is not a refusal, because the peer agent it
  names may be written next.

## Writing the prompt

- First sentence: what the agent is for.
- Then what a good answer looks like — how long, in what form.
- Then what it must not do: guess, pad, ask a question nobody is there to
  answer.
- Do not list the agent's tools in the prompt. It is told what it can call
  automatically, and a prompt that lists tools goes stale the moment the file
  changes.
