# AGENT-BOUNDARY — what the core knows that the agents folder should declare

Read-only audit against the stated goal:

> "no matter how complex the loop sounds, I want the agents details to be fully present in the
> agents folder with data and metadata. The core or other parts of the project should only be
> taking the agents, setting them up and keep them running."
> "The agents are plugins, similar to tools, skills and multiagent setup."

Every claim below cites `file:line` from the tree as it stands (concurrent edits in progress; no
build was run). Where a thing could not be determined it says **unverified**.

---

## 1. The declaration format as it stands today

The parser is `crates/agent/src/spec.rs:44` (`parse_agent_file`), the frontmatter reader is
`spec.rs:79`, and the per-key dispatch is `spec.rs:102` (`set_field`). Many files are loaded by
`crates/agent/src/loader.rs:15`.

Shape read: `---` must be the first three bytes (`spec.rs:49-51`), closed by `\n---`
(`spec.rs:52-54`). The body after it is the prompt (`spec.rs:68`). The reader understands three
value shapes and no more: `key: value`, an inline `[a, b]`, and a block list of `- item` lines that
belongs to `tools:` alone (`spec.rs:86-91`, `spec.rs:127`). Comment lines and blanks are skipped
(`spec.rs:83`). **There is no YAML nesting** — no sub-maps, no lists of maps.

| Key | What it does | Absent | Malformed | Enforced? |
|---|---|---|---|---|
| `name` | The agent's identity everywhere. `spec.rs:106` | Falls back to the folder name (`spec.rs:57`) | Empty value also falls back to the folder (`spec.rs:107`); an empty *result* is refused (`spec.rs:71-73`) | **Enforced** |
| `description` | One line. Becomes the sub-agent tool's description when a peer names it (`subagent.rs:74`), the `read_agent` output (`core/tools.rs:127-131`), the identity section (`paper.rs:116-119`), and the card (`agentcard.rs:139-148`) | Empty string; card prints a substitute sentence (`agentcard.rs:141-147`) | n/a — any string is legal | **Enforced** (it is model-visible text) |
| `model` | Catalogue key carried on `Effect::CallModel` (`paper.rs:97` → `state.rs:30` → `ask.rs:51`) | Empty = endpoint default (`state.rs:31`) | n/a | **Enforced** |
| `temperature` | Parsed to `Option<f32>` (`spec.rs:115-119`) | `None` | **Refused** with a typed error (`spec.rs:116-118`) | **INERT.** Written back out (`author.rs:39`) and printed on the card (`agentcard.rs:50`), but `Effect::CallModel` has no temperature field (`effect.rs:20-33`) and no grep hit reaches a request body. A file that sets it looks applied and is not. |
| `engine` | Stored as a string (`spec.rs:110`) | Defaults to `"base"` (`spec.rs:62`) | n/a — any string parses | **INERT.** See §2.3. Its only readers are `agentcard.rs:34-40` (display) and `author.rs:42` (re-render). |
| `space` | Names the shared space; grants the space + workspace tool *vocabulary* (`paper.rs:101`, `subagent.rs:52-55`); becomes `/root/spaces/<name>` (`space.rs:66`) | Empty = no space, no workspace, default deny (`subagent.rs:54`) | An unusable name (slash, dot, empty) silently yields `None` (`space.rs:49-60`) — **not refused** | **Enforced** |
| `tools` | The allowlist. Empty list = every built-in *plus* the space set if a space is named (`subagent.rs:61-63`); non-empty = the whole grant, nothing appended (`subagent.rs:69-79`) | Absent key = empty list = **everything** | A value that is neither `[...]` nor a bare `tools:` is **refused** (`spec.rs:128-136`), explicitly because dropping the line would grant more, not less | **Enforced** |
| `compact_at` | History length at which compaction fires; `0` never compacts (`window.rs:51-53`) | 75 (`state.rs:126`) | **Refused** (`spec.rs:151-155`) | **Enforced** |
| `keep_recent` | Newest entries kept verbatim through a compaction (`window.rs:72-84`) | 24 (`state.rs:129`) | **Refused** | **Enforced** |
| `max_rounds` | Tool-loop ceiling for one turn (`step.rs:184`) | 64 (`state.rs:121`) | **Refused** | **Enforced** |
| *(body)* | The system prompt; becomes the `soul` section (`paper.rs:112-115`) | Empty soul | n/a | **Enforced** |
| *(any other key)* | Ignored in silence (`spec.rs:138`) | — | — | — |

Two further behaviours the table cannot hold:

- **A file that will not parse costs that one agent, not the boot** (`loader.rs:22-32`), and the
  reason is surfaced as one sentence per file (`loader.rs:25`).
- **A name in `tools:` that resolves to nothing is reported, not refused** (`subagent.rs:39-41`),
  deliberately: a peer agent may not be written yet. The asymmetry is stated in the source — a
  dropped `tools:` line grants *more*, a dropped name grants *less*.
- Precedence: compiled-in built-ins, then `public/agents/`, then browser-authored; last wins
  (`install.rs:75-79`). Result order is by name (`loader.rs:38`), so `index.json` order is
  decorative — as its own comment says.

The **manifest** `public/agents/index.json` is the directory listing (a static host cannot list a
folder); it is fetched at `crates/adapters_web/src/assets.rs:51`, each named folder at
`assets.rs:63`. A missing manifest degrades to built-ins with a console warning (`assets.rs:52`).

---

## 2. What the core hardcodes that is an agent's business

### 2.1 Named agents, by string literal

| Literal | Where | What breaks if that agent is deleted |
|---|---|---|
| `"main"` | `crates/core/src/app.rs:15` (`ENTRY_AGENT`) — used at `boot.rs:162`, `install.rs:29`, `adapters_web/roster.rs:37`, `adapters_web/lib.rs:140` | `install_agents_as` still sets `app.me = "main"` (`install.rs:82`), but the adoption at `install.rs:111-113` finds no matching spec, so `adopt_spec` never runs and the page's agent keeps `AgentState::new()` — **empty toolbox** (`state.rs:151`), the seeded placeholder soul (`seed.rs:49-51`), no space, default budgets. No row is `Waiting`; every row is `Starting` (`install.rs:103-107`). It does not panic; it silently becomes a prompt-less, tool-less agent. |
| `"main"` again | `crates/ui/src/route.rs:22` (`DEFAULT_AGENT`) — `main.rs:83`, `adopt.rs:57`, `route.rs:88` | Degrades correctly: `adopt.rs:59` falls back to the first name on the roster. This one is a preference, not a dependency. |
| `"summarizer"` | `crates/agent/src/paper.rs:12`, matched at `paper.rs:108`; used as the effect's `speaker` at `window.rs:118` | **Compaction stops, silently and everywhere.** `window.rs:93` returns `None` when `summarizer_prompt` is empty, so every agent's `compact_at` becomes inert with no event, no warning and no UI trace. This is the single most consequential name in the tree. |
| `"summarizer"` (again) | `crates/core/src/install.rs:19-21` — its `agent.md` is `include_str!`'d into the binary | The only agent compiled in. Deleting the folder breaks the build. |
| `"author"` | `crates/ui/src/authoring.rs:75`, `crates/ui/src/agentkeys.rs:49`, `agentkeys.rs:57` | Graceful: the "Ask author to write one" block is guarded by an `any(|a| a == "author")` test and simply disappears. Cosmetic coupling only. |
| `"write_agent"`, `"now"`, `"list_agents"`, `"read_agent"` | executor table `crates/core/src/tools.rs:75-92`; descriptors `crates/agent/src/tools.rs:107-143` | Not agents, but the same class: tool identity is a Rust `match` arm. A descriptor with no arm refuses like an unknown tool (`core/tools.rs:83-91`) — the correct fallback. |
| `"react"` / `"base"` | `spec.rs:62` (default), `author.rs:74` (authored default), `ui/agentfile.rs:159` (blank template), `agentcard.rs:36-38` (display) | Nothing. See 2.3. |

There is **no** hardcoded `"researcher"`, `"plan"`, `"ask"` or `"research"` (the space name) anywhere
in `crates/*/src` — verified by grep. Those four are fully data.

### 2.2 The prompt's structure and section order

The eleven sections, their ids, intents, stability class, priority, floor and placeholder text are
Rust literals in `crates/agent/src/seed.rs:40-138`. `assemble` then:

- sorts by **stability class** (`assemble.rs:94-95`) — static prefix first, for cache reuse;
- degrades highest-`priority`-number first, one fidelity level at a time, never past a `floor`
  (`assemble.rs:103-121`);
- takes its ceiling from the **phase's** `Budget` (`assemble.rs:87`, supplied at `ask.rs:44`).

`render_chat` (`render.rs:79-172`) emits one system message of `## id\n(intent)\n…` blocks, then a
**fixed user message**: `"Proceed as the response_contract instructs."` (`render.rs:167-169`).

What an agent file controls today:

| Section | Controlled by the file? |
|---|---|
| `soul` | **Yes** — the markdown body (`paper.rs:112-115`) |
| `identity` | Partly — `"Name: {name}. {description}"`, format fixed (`paper.rs:116-119`) |
| `affordances` | Indirectly — via `tools:`; the surrounding layout-rule paragraph is a Rust literal (`toolbox.rs:57-64`) |
| `response_contract` | **No** — one of two fixed strings chosen by `(contract, tools.is_empty())` (`ask.rs:57-65`) |
| `environment` | **No** — generated (`now.rs:51-66`), plus the space block (`space.rs:72-80`) |
| `task`, `history`, `observations` | Runtime, not declarable |
| `operating_rules`, `user`, `memory` | **No** — `operating_rules` is a hardcoded three-sentence rule (`seed.rs:63-70`) that every agent gets whether or not its own prompt contradicts it |
| section *set*, *order*, *priority*, *floor* | **No** — entirely `seed.rs` |

So the honest measure: an agent file controls roughly two of eleven sections' contents and none of
the structure. The framing "the core takes the agents and sets them up" is met for the prompt body
and violated for everything around it.

### 2.3 The loop shape — `engine:` selects nothing

Traced end to end:

- `spec.engine` is written at `spec.rs:110` and defaults to `"base"` at `spec.rs:62`.
- Its **only** readers are `agentcard.rs:34-40` (turns the word into a sentence for a human) and
  `author.rs:42` (writes it back out). Grep over `crates/*/src` finds no `match` on it that changes
  behaviour.
- Therefore `summarizer`'s `engine: base` (`public/agents/summarizer/agent.md`) and the other five
  files' `engine: react` produce **identical** machinery. The summarizer is toolless because
  `tools: []`… no — because `subagent.rs:61-63` gives an empty list *everything*; it is toolless
  because nothing calls it as an agent and its compaction sheet blanks affordances explicitly
  (`window.rs:106`). The `engine:` key is not what makes it one-shot.

The phase machine, measured:

- `PhaseConfig` (`phase.rs:76-88`) is fully `Serialize`/`Deserialize` data: sections+fidelity,
  contract, tool scope, budget, exits.
- `v1_phases()` (`phase.rs:93-147`) returns exactly two phases: `Work` and `Verify`. `PhaseId::Plan`
  (`kernel/src/ids.rs:53-58`) exists in the vocabulary and **has no configuration**.
- `ask.rs:17-22` looks the current phase up in `v1_phases()` and `.expect("current phase is
  configured")` — so reaching `Plan` would panic.
- `state.phase` is initialised to `Work` (`state.rs:139`) and **never assigned anywhere else**
  (verified by grep over `crates/`). `Verify` is unreachable; the source says so (`phase.rs:133`).
- **`exits` has zero readers.** Grep for `.exits` across `crates/` returns only the field
  declaration (`phase.rs:87`) and the two literals that populate it (`phase.rs:128`, `phase.rs:140`).
  There is no transition interpreter.
- `parse_reply` panics on the two structured contracts: `todo!("Plan/Verify contracts")`
  (`reply.rs:33-35`).
- `App` carries a `phases: Vec<PhaseConfig>` field (`app.rs:56`) populated at `boot.rs:150` and
  **never read** — `ask.rs:18` calls `v1_phases()` directly. Dead field.

Conclusion: an agent file cannot select a phase machine today, and no value of `engine:` is
reachable. `on_reply` (`step.rs:111-159`) *is* the loop, hardcoded: tool calls act, anything else
ends the turn.

### 2.4 The tool catalogue

- Built-ins: `crates/agent/src/tools.rs:107-143` — four `Tool::new(name, description, &[args])`
  literals. The usage line is generated from those three (`tools.rs:44-52`), so nothing can describe
  itself twice.
- Workspace set: `crates/agent/src/workspace.rs:22-89` — ten tools, same shape, plus a membership
  predicate that repeats the names (`workspace.rs:92-106`).
- Space set: `crates/agent/src/space.rs:177-195` — three tools, plus `is_space_tool` at
  `space.rs:198-200`.
- Sub-agents: `Tool::from_engine` (`tools.rs:58-65`) — name and description come from the *peer's
  agent file*. This is already the data path, and it works.
- Execution: one `match` on the name (`core/tools.rs:75-92`), the workspace/space executors
  elsewhere in `core`.

`Tool` is already `Serialize`/`Deserialize` (`tools.rs:27`). Nothing about a tool's *declaration*
needs Rust; only its executor does. The distinction is already documented at `tools.rs:103-106`
("DESCRIPTORS only") and the missing-arm case already refuses honestly.

### 2.5 What the UI knows

- `DEFAULT_AGENT = "main"` (`route.rs:22`) with a graceful fallback (`adopt.rs:56-60`).
- Ordering is alphabetical, from `loader.rs:38` — no fixed list.
- The frontmatter glossary `KEYS` (`agentkeys.rs:24-35`) is a hand-maintained mirror of the parser,
  including a gloss for `engine` and `temperature` — the two keys that do nothing. The comment at
  `agentkeys.rs:15-17` claims "a key that exists in the parser and not here is a visible gap"; the
  reverse gap (a key here that the parser reads but the machine ignores) is not covered.
- Starter tasks (`examples.rs:32-53`) are six constant strings, chosen by one boolean — whether the
  agent has a workspace. This is a per-agent property carried nowhere in the agent file; the file
  header (`examples.rs:1-24`) records that constants were already the wrong subject once.
- The blank agent template (`agentfile.rs:159`) hardcodes `engine: react`.

### 2.6 Termination, budgets, compaction

| Setting | Per-agent | Global constant |
|---|---|---|
| Tool-round ceiling | `max_rounds` (`spec.rs:36`, enforced `step.rs:184`) | default 64 (`state.rs:121`) |
| Compaction trigger | `compact_at` (`window.rs:51-53`) | default 75 (`state.rs:126`) |
| Compaction tail | `keep_recent` (`window.rs:72-84`) | default 24 (`state.rs:129`) |
| Model | `model:` (`ask.rs:51`) | — |
| Token budget per call | — | `Budget { max_tokens: 4096 }` Work, `2048` Verify (`phase.rs:127`, `phase.rs:139`) |
| Endpoint | — | `EndpointName("model")` (`ask.rs:50`, `window.rs:116`) |
| Provider format | — | `OpenAiChat { vision: false, audio: false }` (`ask.rs:46-49`) |
| Compaction prompt | — | `COMPACT_PROMPT` (`window.rs:26-34`) |
| Summary heading | — | `SUMMARY_HEADING` (`window.rs:21`) |
| Mechanical summary length | — | `KEEP = 200` (`assemble.rs:57`) |
| Space noticeboard depth | — | `NOTE_LIMIT = 20` (`space.rs:21`) |
| Ending vocabulary | — | `answered` / `no answer` / `round ceiling` (`ending.rs:30-37`), stop (`stop.rs:24`) |
| Temperature | *declared, ignored* | — |

The per-agent trio is genuinely per-agent, and the reasoning at `state.rs:64-70` is sound. The rest
is global by omission rather than by argument.

---

## 3. The gap table

| # | What the core decides | Decided at | Could be data? | What the agent file would carry | Size | What would break |
|---|---|---|---|---|---|---|
| 1 | The entry agent is called `main` | `app.rs:15` | **Yes** | Nothing in the file — `index.json` gains an `"entry"` field, or a per-file `entry: true` | S | Nothing; `install.rs:111` already tolerates a miss (badly — see §6) |
| 2 | The compactor is called `summarizer` | `paper.rs:12`, matched `paper.rs:108` | **Yes** | `summarizer: <peer name>` per agent, or `index.json`'s `"summarizer"` | S | Silent no-compaction today if absent; a refusal would be an improvement, not a regression |
| 3 | `engine:` selects nothing | `spec.rs:110` + no reader | **Yes** — that is the whole of §5 | A phase-set selector | M–L | Nothing today; every current value is a no-op |
| 4 | Phase set is `v1_phases()` | `phase.rs:93`, read `ask.rs:18` | **Yes** — `PhaseConfig` is already `Deserialize` (`phase.rs:76`) | A `phases.json` beside `agent.md`, or a named built-in set | M | `app.phases` (`app.rs:56`) becomes live instead of dead |
| 5 | No transition interpreter (`exits` unread) | `phase.rs:87`, `step.rs:111-159` | **Partly** — the table is data, the interpreter must be code | — | M | A new file; `step.rs` is at 200 lines (I12) |
| 6 | `Plan`/`Verdict` replies unparsable | `reply.rs:33-35` `todo!()` | No — parsers are code | — | M | Reachable panic once a phase set names them |
| 7 | Section set, order, priority, floor | `seed.rs:40-138` | **Partly** — contents yes, the *classes* are what `assemble` sorts on | A section list per phase (already a `PhaseConfig` field, unread) | M | `paper::find` `.expect` (`paper.rs:14-20`) panics on an unknown id |
| 8 | `operating_rules` text | `seed.rs:63-70` | **Yes** | An optional `rules:` body section | S | Nothing — worst case an agent overrides sensible defaults |
| 9 | `response_contract` wording | `ask.rs:57-65` | **Yes** | Per-phase contract text | S | Contract text and parser must stay in step |
| 10 | Affordances layout paragraph | `toolbox.rs:57-64` | **Yes**, but shouldn't be — it describes the parser (`calls.rs`), not the agent | — | S | A file that rewrites it desynchronises the model from `parse_batches` |
| 11 | Tool name/description/args | `tools.rs:107-143`, `workspace.rs:22-89`, `space.rs:177-195` | **Yes for descriptors**, no for executors | A `public/tools/<name>.json` mirroring `public/agents/` | M | `is_workspace_tool`/`is_space_tool` (`workspace.rs:92`, `space.rs:198`) would need to read the same source |
| 12 | Token budget per call | `phase.rs:127`, `phase.rs:139` | **Yes** (it is already a `PhaseConfig` field) | `budget:` per phase | S | An absurd value degrades nothing and the endpoint refuses — needs a clamp |
| 13 | Endpoint name | `ask.rs:50`, `window.rs:116` | **Yes** | `endpoint:` | S | A name with no configured endpoint must refuse, not default |
| 14 | Provider format flags | `ask.rs:46-49` | **Yes** | `vision:` / `audio:` | S | `render.rs:70` `todo!()` for Anthropic/Gemini is still a live panic |
| 15 | `temperature` ignored | `effect.rs:20-33` | **Yes** — it is already declared | Nothing new; wire the existing field | S | Behaviour of every existing agent changes the moment it starts working |
| 16 | Compaction prompt + heading | `window.rs:21`, `window.rs:26` | **Yes** | `compact_prompt:` or the summarizer's own file | S | Nothing; `ALIGNMENT.md` C5 already calls this a string edit |
| 17 | Starter tasks | `examples.rs:32-53` | **Yes** | `examples:` block list | S | Nothing |
| 18 | Space noticeboard depth | `space.rs:21` | **Yes** | Space-level, not agent-level — spaces have no file | M | Spaces would need `public/spaces/<name>.json`; today a space is only a name |
| 19 | Endings vocabulary | `ending.rs:30-37` | **No** | — | — | These are machine facts folded by four surfaces; see §4 |
| 20 | The parser's own shape | `spec.rs:79-98` | **No** | — | — | Nesting is what §5 needs and what this cannot express |

---

## 4. What must stay in the core, and why

Measured against "takes the agents, sets them up, keeps them running". A thing stays only if the
*running* would be unsound without it.

1. **`step(state, input) -> (state, effects)`** (`step.rs:20`). Not because it is Rust: because
   determinism, replay, snapshot-and-restore and host-testability all rest on it being a total
   function over serializable data (`PROMPT.md` §11, `state.rs:1-4`, I7). A declared loop *feeds*
   this function a different table; it must never become the function.
2. **The refusal machinery** — `Toolbox::check` (`toolbox.rs:69`), `swallowed` (`toolbox.rs:124`),
   `goal_from` (`subagent.rs:89`), `relative_path` (`workspace.rs:134`), `process_name`
   (`workspace.rs:113`), `Space::named` (`space.rs:49`). These are the enforcement that makes an
   allowlist a boundary rather than a suggestion (`ALIGNMENT.md` §1). A declared boundary enforced by
   declared code is not a boundary.
3. **The event log and every projection over it** (I8; `install.rs:38-60`, `ending.rs:56-69`). An
   agent file describing its own history would be a second source of truth.
4. **`assemble`'s degradation algorithm** (`assemble.rs:87-144`) and `validate` (`assemble.rs:151`).
   The *inputs* (which sections, at what fidelity, under what budget) are already `PhaseConfig`
   fields and should be data. The *rule* — stable-first, highest priority number degraded first,
   never past a floor — is what makes I14 checkable; a per-agent ordering rule would make the golden
   suite meaningless.
5. **`render`** (`render.rs:67`). Provider quirks, by definition not an agent's business.
6. **The port traits and the browser adapters** (`kernel/src/ports.rs`, `crates/adapters_web/`).
   I2/I6: an agent file that could name a URL would be an agent file that could exfiltrate.
7. **The call syntax and its parser** (`calls.rs`, `parse_batches`). One calling convention is a
   stated non-goal to break (`ALIGNMENT.md` §1 "No second calling convention"). Note that
   `toolbox.rs:57-64` *describes* this syntax in prose to the model — that text must stay pinned to
   the parser, so it belongs beside it, not in an agent file. This is the one place where "must stay"
   applies to prompt text.
8. **Tool executors** (`core/tools.rs:75`, the workspace and space handlers). Descriptors can be
   data; the code that runs a shell cannot.
9. **The stop boundary** (`stop.rs:51-58`) and the ending vocabulary (`ending.rs:30-37`). A person
   pressing Stop is not an agent's decision, and four surfaces fold these three constants.

Everything else in §3 fails the test. In particular `operating_rules` (`seed.rs:63-70`),
`response_contract` wording (`ask.rs:57-65`), the starter tasks (`examples.rs:32-53`), the compaction
prompt (`window.rs:26`) and the endpoint/format/temperature triple are agent business held in Rust
for no stated reason.

---

## 5. The smallest change that would let an agent declare a non-ReAct loop

**`phase.rs` is about half of it.** It has the vocabulary (`ToolScope`, `ResponseContract`,
`Verdict`, `ExitCondition`, `PhaseExit`, `phase.rs:14-71`) and the record (`PhaseConfig`,
`phase.rs:76-88`), and the record already derives `Serialize`/`Deserialize`. What is missing is every
one of: a way to *say* it, a place to *put* it, an interpreter to *walk* it, and parsers for two of
its four contracts.

Minimum, file by file:

1. **A declaration surface.** The frontmatter reader cannot carry a nested table (`spec.rs:79-98`
   handles `key: value`, `- item`, `[a, b]` only). The lazy shape is a sibling file: an agent folder
   gains an optional `phases.json`, `serde_json::from_str::<Vec<PhaseConfig>>` straight onto the
   existing type. `spec.rs` gains one key naming it (or the loader just looks for the file). Loader
   change in `assets.rs:63` to fetch it. **S** — roughly 25 lines across `spec.rs`, `loader.rs`,
   `assets.rs`.
2. **Carry it on the agent.** `AgentState` gains `phases: Vec<PhaseConfig>` (`state.rs:24`), set by
   `adopt_spec` (`paper.rs:92`), defaulting to `v1_phases()`. `ask.rs:17-22` reads `state.phases`
   instead of calling `v1_phases()`, and returns a typed error instead of `.expect` on a miss. The
   dead `App::phases` field (`app.rs:56`) either becomes the source or is deleted. **S** — ~15 lines.
3. **The transition interpreter.** Today `on_reply` (`step.rs:111-159`) hardcodes the Work rule.
   The change is: parse against `cfg.contract`, map the result to an `ExitCondition`, look it up in
   `cfg.exits`, and either set `state.phase` and re-call, or `ending::end`. `step.rs` is at exactly
   200 lines (I12), so this is a **new file** — `crates/agent/src/transition.rs`. **M** — ~70 lines
   plus tests. This is the only genuinely new logic.
4. **The two missing parsers.** `reply.rs:33-35` is a `todo!()`. `PlanSteps` → `Vec<PlanStep>`
   (`state.rs:15-18` already exists), `Verdict` → `Verdict` + reason (`phase.rs:44-49` exists).
   `reply.rs` is 70 lines, so both fit. **M** — ~60 lines plus tests.
5. **Validation at load.** A phase set must be refused (never defaulted, per `spec.rs`'s stated
   discipline) when: an exit names a phase the set does not configure; no path reaches
   `PhaseExit::Answer`; a `sections` entry names an id `seed.rs` does not seed (else `paper::find`
   panics at `paper.rs:19`); `ToolScope::Only` names a tool `tools:` never granted. **S** — ~30 lines
   in a `phase::validate`, reusing the `unresolved_tools` reporting shape (`subagent.rs:39`).

Nothing else is required. `Plan → Work → Verify → critique` is then a `phases.json` naming four
`PhaseConfig` records with `ToolScope::None` on the non-acting ones — which is exactly what
`phase.rs:11-13` and `phase.rs:133-145` were written for. Note that `ALIGNMENT.md` §1 currently
argues *against* doing this ("No mode enum, no per-mode `PhaseId`, no phase machine expansion");
that recommendation predates the goal stated at the top of this document and is now in tension with
it. Resolving that tension is the owner's call, not this audit's.

Not in scope of the minimum, and deliberately: `PhaseId` is a closed enum (`kernel/src/ids.rs:53`,
already marked PROVISIONAL). A fourth phase name — `Critique` — is one variant plus one match arm.
A *user-named* phase would mean making it a newtype string, which is a bigger change and is not
needed for plan/work/verify/critique.

---

## 6. Risks — where data becomes a way to break the app

The existing discipline is stated at `spec.rs:9-10`: *"Unknown keys are ignored; a key whose VALUE is
a shape this cannot read is refused, never defaulted."* And at `spec.rs:123-126`: silence must never
fail towards more capability. Extending declarability means extending that rule. Concretely:

1. **Reachable panics.** Four `.expect`/`todo!` sites become reachable the moment phases are data:
   `ask.rs:21` (unconfigured phase), `paper.rs:19` (unknown section id), `reply.rs:34` (unimplemented
   contract), `render.rs:70` (non-OpenAI provider). Each must become a typed error refused at load,
   in the `spec.rs` style — not a defaulted phase.
2. **A loop with no exit.** `max_rounds` counts *tool rounds* (`step.rs:174`), not phase
   transitions. A phase set whose exits cycle `Plan → Verify → Plan` with no tool call would spin
   model calls with no ceiling. Two guards: refuse a set with no reachable `PhaseExit::Answer`, and
   count transitions against `max_rounds` as well as rounds.
3. **Silent capability inflation.** `ToolScope::Only` naming an ungranted tool yields an empty
   toolbox silently (`toolbox.rs:40-46`). That fails safe, but invisibly — the same defect
   `subagent.rs:39-41` was written to fix. It should be reported the same way, on the card and in the
   agent's own affordances.
4. **Silent capability *deflation*.** A phase declaring `sections` without `affordances` produces a
   model told about no tools while `Toolbox::check` still holds — the agent looks broken rather than
   restricted. Refuse a phase whose contract is `ToolEnvelope` and whose sections omit
   `affordances`/`response_contract`.
5. **Amnesia by declaration.** A phase omitting `history` gives an agent that cannot see the
   conversation, and `assemble` will report nothing amiss. This is arguably legitimate (the
   summarizer's own sheet blanks sections deliberately at `window.rs:104-112`) — but it should be a
   thing a file *says*, visible on the card, not a thing a reader discovers from behaviour.
6. **Prompt text that lies about the parser.** If the affordances layout paragraph
   (`toolbox.rs:57-64`) or the response-contract wording (`ask.rs:57-65`) becomes declarable, a file
   can describe a calling convention `calls.rs` does not implement. The precedent is already on the
   record: `tools.rs:126-130` documents a tool description that overstated a capability boundary and
   calls it "the worst place in the product to be out of date". Contract *text* should move with the
   contract *parser*, not into the agent file.
7. **Budgets and endpoints.** `budget.max_tokens` as data invites a value no endpoint accepts;
   `endpoint:` as data invites a name with no configuration. Both must refuse at load rather than
   fail at the first call — an agent that installs cleanly and cannot take a single turn is worse
   than one that refuses to install.
8. **The two inert keys are already this bug.** `temperature` and `engine` parse cleanly, render
   back out, print on the card, and do nothing (`effect.rs:20-33`; no reader for `spec.engine`).
   That is precisely the failure `spec.rs:150` refuses for `compact_at: lots` — "a setting that looks
   applied". Whatever is done about phases, these two should either be wired or refused; leaving them
   is a standing counterexample to the project's own rule.

---

## Unverified

- Whether any test under `crates/*/tests` depends on the literal names `"main"` or `"summarizer"`
  (tests were out of scope for this read).
- Whether `adapters_web/src/lib.rs:140`'s use of `ENTRY_AGENT` has behaviour beyond passing the name
  to `workers.spawn` — only the call site was read.
- Runtime behaviour of any of the above: nothing was built or run, per the audit's terms.

---

## SHIPPED — 2026-08-14 (increment 20)

Four of the findings above are closed; the rest stand as written.

- **The two inert keys** (§8 of the risk list). `temperature` reaches
  `openai_request_body` through `Effect::CallModel`; `engine: base` returns an
  empty toolbox and any third value is refused at parse. Increment 19.
- **`ENTRY_AGENT = "main"`** (`app.rs:15`) is no longer the answer to "who does
  a person talk to". `role: entry` in the agent file is, and
  `core::install::entry_name` looks the holder up. The constant survives as the
  fallback for a manifest with no role line — including one already sitting in
  somebody's browser.
- **`SUMMARIZER = "summarizer"`** (`paper.rs:12`) likewise: `adopt_spec` finds
  the holder of `role: summarizer` and falls back to the name.
- **The phase question** ("should a file be able to declare its own loop?").
  Answered YES, narrowly: `stages: [plan, work, verify, critique]`, four names
  and no more, each a fixed instruction and one model call. What was NOT made
  declarable is everything §6 and §7 of the risk list warned about — no
  contract text, no budgets, no endpoints, no arbitrary graph. A stage cannot
  invent a transition the loop did not already have.

The two `Unverified` items above were checked in the course of this: no test
depended on the literal names, and `adapters_web/src/lib.rs:140` does only pass
the name onward.
