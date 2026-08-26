# Philosophy

Inherited whole from the Python original at `PythonProject1`. This file states
the principle; `PORT-MAP.md` states how each piece of it lands in JavaScript.

## 1. The principle

**Define the flow with an abstract base; let the variables passed at
construction decide the behaviour.**

The code holds the skeleton — what steps happen, in what order, with what
guarantees. Configuration holds the choice of which concrete thing fills each
slot in that skeleton, and the arguments handed to it are what actually
determine what it does.

Four places this shape appears: **inference, responses, tools, components**.
They are not four layers stacked on each other; they are four instances of one
idea. The layer stack is a *consequence*, not the organizing idea.

And what all of it exists to produce is one string. **The strength of this
application is the prompt it constructs.** Every design decision defers to that.

## 2. The one pattern, four times

| Pillar | Abstract base | Concretes | Selected by | Construction variables that decide behaviour |
|---|---|---|---|---|
| **Inference** | `Inference` — one method, `infer(prompt, multimodal) -> string` | `OpenAICompatible`, `AnthropicCompatible`, `ClaudeCLI` (host-only) | `kind` in a `models.json` entry → `KINDS` | `model`, `baseUrl`, `apiKey`, `temperature`, `maxTokens`, `timeout` |
| **Responses** | `BaseResponse` — `instructions(fmt)` / `toString(fmt)` / `parse(raw, fmt)` | `SimpleResponse`, `ReActResponse`, `UnderstandResponse`, `SkillSelectResponse`, `PlanResponse`, `VerifyResponse`, `CritiqueResponse` | `response_model:` in agent.md → `RESPONSE_MODELS` | **the declared field set itself** — names, order, descriptions, list-ness, `ANSWER_FIELD`, coercions |
| **Tools** | `Tool` — `call(args) -> ToolResult`, never throws; `Toolbox` is the set | `Tool.fromFunction` / `.fromAgent` / `.fromMcp` | the `tools:` list in agent.md | `name`, `description`, `usageArgs`, `fn` — `usageArgs` is the call shape the model is shown |
| **Components** | `Component` — `SLOT` + `render()` + `key()` + `applies()` | `Soul`, `SystemInstructions`, `ContextBlock`, `SkillCatalog`, `LoadedSkills`, `PhaseInstructions`, `CritiqueFindings`, `History`, `ToolboxComponent`, `ResponseContract` | the `components:` list in agent.md; `DEFAULT_COMPONENTS` when absent | each component's own frozen fields — they *are* the render input, and `key()` is their hash |

Read across a row and the shape is identical: an abstract type declaring a
contract, several concretes implementing it, a **string name in config** picking
one, and **constructor arguments** deciding what that one does.

The purest expression is `responses`: there are no variables *other* than the
fields. Declaring a field with a description is simultaneously the prompt
instruction, the parse target, and the routing input.

## 3. The engine is a bag of objects that convert to a prompt string

`Component` is exactly that object:

```
Component (frozen)
├─ SLOT       where it belongs; the enum order IS the prompt order
├─ render()   the object as instructions for the model      ("toString")
├─ key()      content hash — same fields, same bytes        ("hashCode")
├─ applies()  cheap emptiness check; empty components vanish
└─ TEMPLATE   the component's markdown shape, declared as data
```

A component is a **value, not a place**. Immutability is what makes `key()`
honest: the fields are frozen, so the hash of the fields is the hash of the
rendered text. Components are rebuilt each turn from the session; they hold no
live state.

`PromptAssembler.assemble(components)` holds no opinion about content:

1. filter on `applies()`
2. sort on `(SLOT, priority)`
3. check the invariants
4. join the rendered parts with **no separator** — each component carries its
   own trailing spacing

Invariants are **raised, not repaired** — a malformed prompt is a programming
bug, not a runtime condition:

1. exactly one RESPONSE component (the completion cue must exist, once);
2. at least one SOUL or SYSTEM component — an agent must be someone;
3. RESPONSE sorts last.

## 4. The prompt

| Slot | Value | Component(s) | Contributes | Cacheable |
|---|---|---|---|---|
| `SOUL` | 0 | `Soul` | who the agent is — always first | yes |
| `SYSTEM` | 10 | `SystemInstructions` | the agent.md markdown body | yes |
| `CONTEXT` | 20 | `ContextBlock` | `## CONTEXT` — clock, weekday, space facts | **no** |
| `SKILLS` | 30 | `SkillCatalog`, `LoadedSkills` | `## AVAILABLE SKILLS`, `## LOADED SKILLS` | yes |
| `PHASE` | 40 | `PhaseInstructions` (p0), `CritiqueFindings` (p10) | what this phase asks for | yes |
| `HISTORY` | 50 | `History` | `[ROLE]: content` lines | yes |
| `TOOLS` | 60 | `ToolboxComponent` | `## AVAILABLE TOOLS` + batching rules | yes |
| `RESPONSE` | 99 | `ResponseContract` | `## RESPONSE FORMAT` + `[ASSISTANT]:` | yes |

**Why memoization matters.** Rendered text is memoized per `key()`. The
expensive head of the prompt — soul, system, skills, tools, response contract —
has the same key turn after turn, so it renders once and is reused,
**byte-stable**. That is exactly what an inference server's prefix cache wants:
identical leading bytes means identical KV cache. `ContextBlock` opts out — a
cached clock is a wrong clock.

**The response contract in two directions.** TOON (line-oriented `field: value`,
blank line between fields) is the default because small local models follow it
more reliably than JSON. `parse` tries the requested format, then the other,
then drops the whole reply into the answer field — **an unparseable reply still
yields a usable object**, never an exception. Every enum-ish field coerces free
text and **fails toward the careful branch**: unknown → `complex`, `fail`,
`revise`.

**Tools: layout carries the schedule.** Calls are split on the **gaps between
matches**, not on lines, so a call whose JSON argument spans lines stays in one
piece. Comma-separated on one line = independent, run together; a newline =
"after everything above". Nothing in tools throws: unknown tool, malformed JSON,
an exploding tool — each comes back as a failed `ToolResult`, because that error
text is what lets the model correct itself next turn.

## 5. What must survive any change

- **Meta phases write nothing to the transcript.** `understand`,
  `select_skills`, `plan`, `verify`, `critique` pass `record=false`; their output
  lands on the session and components render it back. Only `react`, `work` and
  `respond` leave conversation turns. A planner's musings are not conversation.
- **verify and critique run on fresh-context reviewers.** They see the session's
  artifacts and never the transcript. A reviewer who read the worker's own
  reasoning tends to agree with it.
- **The session is data.** It never renders and never infers.
- **The repeat guard.** Independent of phases, and the only thing that stops a
  caller looping forever.
- **Nothing in the tool path throws.**
- **Errors are values the model can read**, because the model is the one that
  has to correct itself.

## 6. The seams

| # | Contract | Substitute by |
|---|---|---|
| S1 | `Inference.infer(string, Multimodality[]) -> string` | new transport class + `KINDS` entry + `kind` in models.json |
| S2 | `Component`: `SLOT`, `render`, `key`, `applies` | new component + `COMPONENTS[name]` |
| S3 | `BaseResponse`: declare `FIELDS` | new subclass + `RESPONSE_MODELS` entry |
| S4 | `Tool.call(args) -> ToolResult` (never throws) | new `Tool.from*` constructor + a registry entry |
| S5 | `Phase.run(agent, session) -> result` + a declared edge table | new phase + `PHASES` entry + an edge in the flow |
| S6 | duck type: `.name` + `.invoke` = a callable agent | any object satisfying it |
| S7 | `models.json` entry | config, no code |
| S8 | `agent.md` frontmatter | config, no code |
| S9 | `Ports`: `fs`, `clock`, `fetch`, `spawnWorker`, `cron` | the host adapter or the browser adapter |

S9 is the one seam the Python original did not need: it had a filesystem, a
clock and threads for free. In a browser none of those are free, and inventing
them inside the core would break the rule that the core is pure. So they are
handed in — which is the same principle, applied to the environment.

## 7. Rules for this tree

- Files ≤ 200 lines. Functions ≤ 40.
- No speculative generality. A registry with one entry is not a registry.
- Comments explain the reason a reader could not have guessed, never the
  mechanism.
- Every dependency justified in one line. The target is **zero runtime
  dependencies**.
- The core runs and tests on the host with `bun test` — no DOM, no network, no
  ambient clock, no ambient randomness.
- A claim the gate cannot execute is not a verified claim.
