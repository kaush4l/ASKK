# Per-user curation strategy

> "I cannot have one application that fits all; instead, I need a strategy for how
> to curate this for every kind of user. However, the primary user is still me, and
> it will be curated for me until it reaches MVP."

This document states how ASKK is shaped *per user* rather than as a single
one-size-fits-all product, and shows that the curation surface is not new machinery
— it already exists in the config that the agent loop reads on every run. The work is
to *name* it (a persona abstraction) and to sequence it (owner first, then
generalize), not to build a new subsystem.

See also: [`VISION.md`](./VISION.md) for the product north star, and
[`extensibility.md`](./extensibility.md) for the contracts that make every curatable
thing a piece of data rather than a code edit.

## The principle: primary-user-first, generalize after MVP

There is exactly one user who matters until MVP: the owner. ASKK is curated *for the
owner* — the owner's providers, the owner's tool risk tolerance, the owner's agents
and soul — and the persona system below is designed but **not** built out into a
shipping multi-persona UI yet. Generalization is a post-MVP move: once the owner's
workflow is load-bearing and the config surfaces have stabilized under real use, the
same surfaces are repackaged as named profiles for other user types.

Concretely, this means:

- **Now (pre-MVP):** there is effectively one persona, "Owner". Defaults
  (`AppSnapshot::default`, the bundled `soul.md` / `agents/` / `skills/`) *are* the
  owner's persona. We tune those defaults, not a persona-picker.
- **After MVP:** the bundled defaults become *one* persona among several. The persona
  abstraction (below) is layered over the existing config with no change to the agent
  loop, the orchestrator, or the prompt assembly.

Do not exceed this. Building a full multi-persona onboarding flow before the owner's
single curated path is MVP-solid is out of scope.

## Why one app cannot fit all

ASKK spans a wide capability range — from a read-only web-research assistant that
never touches a filesystem, to a full browser IDE that writes the virtual FS and runs
`bun` / `node` through the bridge. The right *amount* of ASKK differs sharply by user:

- A researcher wants `web_search` / `web_fetch` and a synthesis soul; they should
  never see code execution.
- A developer wants `run_js` / `run_command` / `fs_*` and a terse, code-first soul.
- A cautious newcomer wants every destructive write and outbound fetch gated, and a
  small, legible tool set.
- The owner wants all of it, with approval gates relaxed where the owner has decided
  the risk is acceptable.

Shipping the union of all of these to everyone is both unsafe (it widens the blast
radius of the BYOK + exec surface for users who never asked for it) and confusing
(too many surfaces). Curation is therefore a *subtraction* problem: start from the
full capability set and remove what a given user should not see or run.

## What gets curated

Curation operates on five already-configurable axes. Each is **data**, read by the
agent loop per run; none requires touching the loop, the orchestrator, or
`agent_prompt`.

### 1. Enabled tools (the allowlist)

The canonical built-in tool set is `default_tool_names()`
([`src/state/tool_types.rs`](../src/state/tool_types.rs)): `run_js`, `web_search`,
`web_fetch`, `run_command`, `fs_read`, `fs_write`, `fs_list`, `file_read`,
`file_write`, `file_list`.

Every agent carries its own `enabled_tools: Vec<String>` allowlist
([`Agent` in `src/state/manifest.rs`](../src/state/manifest.rs)). An agent manifest
declares it as a `tools:` line in frontmatter; `parse_tools` normalizes it (`all`
expands to the full set, unknown / invalid names are dropped). The prompt only ever
advertises the tools on that allowlist (`describe_tools` in
[`src/agent_prompt.rs`](../src/agent_prompt.rs)), so **narrowing the allowlist removes
a capability from the model's view entirely** — the model is never told the tool
exists.

This is the most important curation lever: a researcher persona ships agents whose
allowlists contain only `web_search`, `web_fetch`, and the read-side
`fs_*` / `file_*` tools; the execution tools (`run_js`, `run_command`) simply are not
in the manifest.

> Note: today the Agents page renders the per-agent tool checkboxes as `disabled`
> ([`src/components/agents_page.rs`](../src/components/agents_page.rs)) — the allowlist
> is authored in the manifest frontmatter and loaded, not yet toggled in the UI. A
> persona ships its allowlists *as manifests*. Making the checkboxes live is a
> reasonable post-MVP UI step but is not required for persona curation, because the
> data path already honors the allowlist.

### 2. Agent souls and roles (the behavioral charter)

Identity is split, and both halves are curatable:

- **Soul** (`AppSnapshot.soul`, bundled from [`soul.md`](../soul.md), default in
  `default_soul_prompt`): the shared behavioral charter, rendered **first** in every
  prompt. Edited on the [Soul page](../src/components/soul_page.rs).
- **Agent role** (`Agent.role`, the markdown body of `agents/*.md`): the
  task-specific identity that follows the soul. Edited on the
  [Agents page](../src/components/agents_page.rs).

The fixed render order (`soul → "You are {name}" → role → ReAct guidance →
sub-agents → tools → skills → response-format`, see
[`agent-prompting.md`](./agent-prompting.md)) means a persona can set tone and
operating doctrine *once* in the soul and specialize per-agent in the roles. A
"cautious newcomer" persona ships a soul that emphasizes explaining each step and
asking before acting; a "developer" persona ships a soul that is terse and
code-first. Same machinery, different text.

Skills ([`Skill` in `src/state/manifest.rs`](../src/state/manifest.rs),
`skills/<id>/SKILL.md`) are the third behavioral input: enabled skills are composed
into the prompt by `describe_skills`. A persona enables the skills relevant to it
(research, coding, synthesis) and disables the rest.

### 3. Providers and model profiles (the inference connection)

Provider connection and tuning are separate, saveable, switchable objects
([`src/state/provider.rs`](../src/state/provider.rs)):

- `ProviderConfig` / `ProviderProfile` — base URL, model, auth mode, persistence,
  sampling. ASKK is OpenAI-compatible across OpenAI, Ollama, LM Studio, and the local
  bridge (see [`README.md`](../README.md)).
- `ModelProfile` — a named sampling bundle (`Precise`, `Balanced`, `Creative` by
  default) applied onto the active connection. An `Agent` may pin a
  `model_profile_id`, falling back to the workspace's active profile.

A persona therefore curates *which providers are even offered* and *which model
profile is the default*. A privacy-first persona defaults to a local Ollama / LM
Studio profile and a `Precise` model profile; a power persona offers the full provider
roster. These are edited on the
[Provider settings page](../src/components/provider_settings.rs).

### 4. UI surfaces (what pages are even shown)

ASKK's pages are themselves a capability surface: Soul, Agents, Tools, Provider,
Workspace IDE
([`src/components/workspace_page.rs`](../src/components/workspace_page.rs)), MCP. A
researcher does not need the Workspace IDE; a newcomer does not need the MCP page.
Curation includes *which pages a persona exposes* — hiding a page removes a whole
class of configuration and action from that user's reach without removing the
underlying capability for personas that keep it.

### 5. Approval-gate posture (risk tolerance)

Per the project constitution (invariant 7), every destructive virtual-FS write and
every outbound fetch passes an approval gate unless the user has turned it off for
that action class. The *default posture* is itself per-persona: a newcomer persona
ships with all gates on and no opt-out exposed; the owner persona may ship with gates
relaxed for the action classes the owner has accepted. The gate mechanism does not
change — only its default configuration per persona.

## How the existing system already enables curation

The key insight is that ASKK is already a *data-driven* harness, by design. The
[extensibility contracts](./extensibility.md) guarantee that the agent loop,
orchestrator, prompt assembly, and state store are **not edited** to add a tool,
agent, skill, or provider. That same guarantee is what makes curation cheap:

- An **agent manifest** (`agents/*.md`) already bundles a role, an `enabled_tools`
  allowlist, a `response_format`, an optional `model_profile_id`, and an optional
  `workflow_id` — i.e. a manifest is *already most of a per-role curation unit*.
- The **enabled-tools allowlist** already gates which tools reach the model, with
  `all` / explicit-list parsing in `parse_tools`.
- The **soul + skills** already let behavior be set globally and specialized per
  agent, all as editable markdown loaded into state.
- **Provider / model profiles** already let connections and sampling be saved, named,
  and switched.

So a "persona" is not a new kind of object. It is a *named bundle of selections over
objects that already exist*.

## Proposed abstraction: the Persona profile (design only — do not build yet)

Layer a thin `Persona` over the existing snapshot. It is a manifest, in the same
markdown-frontmatter spirit as agents and skills, that *selects and defaults* rather
than introducing new capability. Sketch:

```md
---
id: researcher
name: Researcher
# which bundled agents this persona ships (by id); others are not loaded
agents: planner, researcher, synthesizer
# which skills are on by default
skills: research, synthesis
# the soul this persona uses (path, or inline override of the shared soul)
soul: souls/researcher.md
# default provider + model profile selections (by id)
default_provider_profile: openai
default_model_profile: precise
# which UI pages this persona exposes
pages: chat, soul, agents, tools, provider
# approval-gate default posture
approvals: all_on            # all_on | relaxed_writes | owner
---

A research-focused persona. No code execution; web research and synthesis only.
```

Design properties, chosen to respect the invariants:

1. **It is pure data.** A `Persona` resolves to selections over the existing
   `AppSnapshot` fields (`agents`, `skills`, `soul`,
   `provider_profiles` / `active_provider_profile_id`,
   `model_profiles` / `active_model_profile_id`, `tool_config`) plus a UI page
   allowlist and an approval-posture default. It never adds a tool or a provider —
   those still come from `register_builtin_tools` and the `InferenceProvider` trait.
   Curation can only *subtract and default*, never *grant new capability*, which keeps
   the safety surface bounded.

2. **The allowlist is the floor, the persona is a view.** A persona's effective tool
   set is the *intersection* of each agent's `enabled_tools` and a persona-level tool
   allowlist. A persona can never widen an agent beyond its manifest. This makes a
   persona safe to hand to a less-trusted user: the worst it can do is show fewer
   tools than the agent already allows.

3. **The loop is untouched.** Resolving a persona happens at load time, populating the
   same snapshot the loop already reads. `agent_prompt::render_system_prompt`,
   `engine::pick_agent`, and the orchestrator see exactly the data they see today.
   This satisfies invariants 1 and 2 (the FSM and trait polymorphism are unchanged;
   no new code path in the loop).

4. **Owner is just the maximal persona.** The `owner` persona ships every agent,
   every page, every provider, and a `relaxed` / `owner` approval posture. The bundled
   defaults *are* the owner persona today; naming it is the only change.

5. **Composition, not inheritance.** Personas do not subclass each other (invariant
   2). A persona is a flat selection; sharing is by referencing the same underlying
   agents / skills / souls, not by an inheritance chain.

### Resolution sketch

```
load persona manifest
  -> select bundled agents whose id is in `agents:`        (filter AppSnapshot.agents)
  -> enable skills in `skills:`, disable the rest           (set Skill.enabled)
  -> set AppSnapshot.soul from `soul:` (path or inline)
  -> set active_provider_profile_id / active_model_profile_id from defaults
  -> intersect each agent.enabled_tools with persona tool allowlist (floor stays floor)
  -> hand the UI shell the `pages:` allowlist
  -> hand the approval layer the `approvals:` posture as its default
```

No new trait, no new effect, no new state-machine arm. A persona is a *pre-flight
projection* of the snapshot.

## Sequencing (what to actually do, in order)

1. **Pre-MVP — owner only.** Keep tuning the bundled defaults as the owner persona.
   Do not build a persona picker. (We are here.)
2. **At MVP — name the owner persona.** Introduce the `Persona` manifest format and
   ship exactly one: `owner`, equal to today's defaults. This is a no-behavior-change
   refactor that proves the resolution path.
3. **Post-MVP — author 2–3 more personas as data.** `researcher`, `developer`,
   `newcomer`, each as a manifest selecting existing agents / skills / souls /
   providers and a page + approval posture. No loop changes.
4. **Later — persona UI.** A persona selector / onboarding chooser, and (optionally)
   making the per-agent tool checkboxes live so a persona can be tweaked in-app.

## Invariant check

- Invariant 1 (typed FSM loop): untouched — personas resolve before the loop runs.
- Invariant 2 (trait polymorphism, no inheritance): personas are flat data selections,
  composed not inherited.
- Invariant 3 (tool results are untrusted data): unaffected.
- Invariant 4 / 5 (platform boundary, `core` purity): persona resolution is pure data
  manipulation over the snapshot; no platform dependency required in `core`.
- Invariant 6 (BYOK keys client-side, disclosed): persona provider defaults reuse the
  existing `persist_api_key` rule; no key handling changes.
- Invariant 7 (approval gates default to ask): a persona may only *select among
  existing postures*; a more-trusted posture is an explicit owner choice, and the
  default for any new / unknown persona is all-gates-on.
