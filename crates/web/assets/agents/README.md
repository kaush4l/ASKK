# agents/ — the configuration IS this folder

Every agent, team, skill, and custom tool is a file here. No code change to
add one: drop a file in, list it in `manifest.json`, reload. The same files
are baked into the build as a fallback and served verbatim at
`assets/agents/*` for runtime load.

Like a movie: the software has one high-level goal (the story), a director
agent keeps the heuristics pointed at it, and every module is a scene worked
by a single agent or a team of agents. All of that staging lives in markdown
here — never in code.

## Folder layout

| Path | Meaning |
|---|---|
| `<name>.md` | One agent (file = agent). |
| `<folder>/` | A team of agents (subfolder = team); every `.md` inside is a member. |
| `<folder>/team.md` | The team declaration: lead, shared toolset, shared principles. |
| `skills/*.md` | Reusable prompt fragments agents opt into via `skills:`. |
| `soul.md` | Plain markdown identity injected into every agent. No frontmatter. |
| `manifest.json` | File roster + order (see below). |
| `*.js` | Custom JS tools, listed in the manifest's `tools` array. |
| `README.md` | This file — documentation only, never parsed as an agent. |

Unknown keys or bad values in any file fail loud at load, all problems
collected into one error (ADR-007).

## agent.md frontmatter

```
---
id: coder                # REQUIRED. Slug, unique across the folder.
name: Coder              # Display name; defaults to id.
description: ...         # Doubles as the tool card when delegated to.
enabled: true            # true|false; default true. false = not loaded as a tool.
env: vm, web             # Tool-bundle presets, expanded into `tools` at load.
tools: echo, researcher  # Tool AND agent names; unknown = hard error.
skills: concise          # skills/*.md ids; unknown = hard error.
provider: default        # Provider profile id; default "default".
contract: react          # react|plan|critique or this agent's field.* contract.
format: toon             # json|toon|text; initial output mode. Default toon.
---
(markdown body = the directive/role prompt)
```

`env` presets (union with explicit `tools`, deduplicated):

- `vm`: shell, write_file, read_file, list_files, edit_file
- `web`: web_search, news_search, fetch_url, knowledge_search, knowledge_read,
  knowledge_write, knowledge_list, artifact_publish
- `core`: echo, calc, now, js_eval
- `board`: board_add, board_list, board_move, board_check

### Phases (`phase.N.*`) — the multi-scene strategy

Numbered contiguously from 1. No phases = a single implicit react loop.

| Key | Value |
|---|---|
| `phase.N.name` | REQUIRED. Phase name (also the `on_fail` target label). |
| `phase.N.contract` | Response contract for the phase; default `react`. |
| `phase.N.tools` | Narrows the agent's tool allowlist for this phase. |
| `phase.N.loop` | `one_shot` (default) or `loop`. |
| `phase.N.max_turns` | Positive integer; implies `loop: loop` (contradiction with an explicit `one_shot`). Loop default: 16. |
| `phase.N.gate` | `true|false`. Only a gate (verifier) phase can end the run verified. |
| `phase.N.on_fail` | Phase name to route back to when the gate fails. |
| `phase.N.header` | Directive line injected while the phase runs. |
| `phase.N.fan_out` | Agent/tool each part is fanned out to in parallel. |
| `phase.N.parts` | Name of the prior-phase artifact field holding the parts list. |

### Custom contracts (`field.N.*`)

Declare the agent's own response format; it becomes a contract named by the
agent id (set `contract: <id>` to use it).

| Key | Value |
|---|---|
| `field.N.name` | REQUIRED. Field name. |
| `field.N.kind` | `text` (default), `list`, or `enum: a\|b\|c`. |
| `field.N.required` | `true` (default) or `false`. |
| `field.N.desc` | One-line description shown to the model. |
| `field.N.example` | Example value shown to the model. |

### Budgets (`budget.*`) — (wave-16)

Per-agent overrides of the session defaults: `budget.max_turns`,
`budget.deadline_s`, `budget.depth`.

## team.md — a folder as one delegation boundary

```
---
id: coding               # REQUIRED. The team's tool name.
name: Coding team
description: ...         # The team's tool card when delegated to.
enabled: true            # true|false; default true.
lead: dev-lead           # REQUIRED. Member agent that receives delegations.
env: vm                  # Same presets as agents.
tools: shell, write_file # The team's OWN toolset — the boundary resets
                         # authority to this set (not intersected with the
                         # caller's tools).
---
(markdown body = shared principles injected into every member's prompt)
```

Members are simply the other agent files in the same folder — the
micro-service analogy: a module carries its own complete requirements.

## skills/*.md

```
---
id: concise              # REQUIRED.
name: Concise            # Defaults to id.
---
(markdown body = the reusable prompt fragment)
```

## manifest.json

```json
{
  "agents": ["assistant.md", "coding/dev-lead.md", "..."],
  "teams": ["coding/team.md"],
  "skills": ["skills/concise.md"],
  "tools": ["fetch_url.js", "js_eval.js"],
  "soul": "soul.md"
}
```

`agents` fixes the roster order (unlisted files load after, alphabetically, on
the baked path). On a deployed site the manifest drives the LIVE config: the
browser fetches it plus every listed file at boot — drop in an agent.md or a
tool.js, list it, reload; no rebuild. Any fetch/parse miss falls back to the
baked set.
