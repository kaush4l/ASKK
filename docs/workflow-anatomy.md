# Workflow anatomy: parameters, tools, tool calls, the action loop

2026-10-24 owner: "I now to understand workflows. The internal work flow elements are coded. For a configurable
workflow, I want to understand parameters, tools, tool calls and action loop. I have an idea of making it
configurable."

Two loops, one inside the other. The **phase loop** (`backend/kernel/builtin/workflow.js`) schedules steps; a step
that is an agent runs the **action loop** (`backend/kernel/agent/agent.js`), a ReAct loop of model call → tool calls →
results → model call. The markdown file configures the outer loop and the inner loop's inputs; the inner loop's
mechanics are code. The format itself is in `docs/phases.md`; this is how the pieces fit, and where the seams are.

```
workflow.md ──parseWorkflowMarkdown──▶ {settings, vars, steps}
                                          │
 Workflow.run ── phase loop ──────────────┤  for each step whose waits settled (concurrency cap)
                                          ▼
         kind code      → the desk's function (data)
         kind research  → one host llm/research call (Claude CLI + web)
         kind phase     → a named desk agent, tools/artifacts granted for the phase
         kind agent     → a step agent spawned <flow>-<id>           ─┐
                                          │                          │ action loop (Agent.#run):
                          checkStep: report / schema / derive / check │  render prompt → infer → parseReply
                          problems → ask again (retries)             │  → calls run together (Promise.all)
                          output → board + {{step.field}} vars       │  → results into WORK DONE → repeat
                                                                     │  → answer → gates → done
```

## 1. Parameters — three layers

| Layer | Where | Keys | Checked by |
|---|---|---|---|
| Run-wide settings | the file's frontmatter | `deadline_minutes` (60), `retries` (1), `critical`, `past_deadline`, `concurrency` (0 = no cap), `board`, `title` — `WORKFLOW_DEFAULTS` `workflow.js:66` | `Workflow.settings()` |
| Run variables | frontmatter `vars:` (name: default) + the run's own `request`, `date`, `now` (`RUN_VARS` `workflow.js:205`) | any `{{name}}` in a step body | `parseWorkflowMarkdown` `workflow.js:261`: every `{{x}}` must be a run var or an upstream step's output, else the file does not load |
| Per step | the lines after `## <id> — <title>` | `STEP_KEYS` `workflow.js:64`: `kind`, `agent`, `after`, `inputs`, `tools`, `artifacts`, `model`, `max_steps` (1–60), `min_calls` (0–20), `max_turns`/`seconds` (research), `report`, `schema`, `derive`, `check`, `code`, `board`, `barrier` | `parseStep` `:86`, `checkSteps` `:132` |

Values flow forward only: a step's `### Output` lines (`field: what it holds`) become its `report` fields;
`reportFields` (`:345`) reads them from its answer, and a later step reads `{{plan.item}}` (one field) or `{{plan}}`
(the whole report; a code step's whole data). Who fills the run vars: the owner's Run box, or a caller —
`flow.run({}, {vars})`; `runVars` (`:646`) takes only names the file declares. The goal artifact is one such caller:
`Goal.vars()` fills `goal-cycle.md`'s ten vars at every resume.

## 2. Tools — what a step can call

A tool is one shape (`tool/tool.js:18` `Tool`; a desk's `defineTool` `:119`): `name`, `description`, `input`
(`{field: "what it is"}` — text, not JSON Schema), `run(input, ctx)`, `type`, `view`. Five sources end in one
`# TOOLS` list, each line from `describe()` (`:45`): `- name {field: hint, …} — description`.

| Source | How it gets to the agent |
|---|---|
| a function tool (`tools/<name>.js`, the kit: `web.search`, `web.read`, `agent.spawn` …) | named in `tools:` |
| an artifact's commands (`goal.claim`, `files.write`, `preview.show` …) | holding the artifact (`artifacts:`) — every command, or a subset `{type, commands}` |
| another agent (`AgentTool`, input = the brief `{requirement, ask, outcome}`) | being its lead / spawner |
| an MCP tool | the desk's `mcp.json` |
| an artifact read by name | always: calling the artifact's id returns its view |

In a workflow, `tools:`/`artifacts:` mean different things by kind: **phase** grants them to the named agent for this
phase and takes them back after (`callPhase` `:1250`); **agent** (step agent) builds the agent with exactly those
(`callStepAgent` `:1296`) plus a `StepContract` artifact whose gate is the step's check; **research** passes `tools`
as host bridges (`market`, `orders`, `data`) to the CLI. Artifacts are the stateful half: rendered fresh into every
prompt and never compacted (why the goal lives in one).

## 3. Tool calls — what the model writes and what happens

The model never writes JSON. `RESPONSE_FORMAT` (`agent/reply.js`) is fields, one per line:

```
thought: one line
call: goal.claim
id: m2
call: web.search              ← every call: block in one reply runs together
q: kokoro tts voices
```

`parseReply` reads it (`<<< … >>>` for lists and long text). Each call goes through `Agent.#call` (`agent.js:712`):
resolve the name (a team prefix allowed) → the same data call within 3 min (`REPEAT_MS`) answers "see step n" → an
artifact id returns its view → an unknown name answers `no tool x; have …` → else `tool.run(input, {...context, agent,
signal, outside})`; a throw becomes `ok: false` with the message (the model fixes the input and calls again). Events
`call {tool, input, index}` and `result {tool, ok, output, ms, index}` feed the Live feed; `index` pairs them.

## 4. The action loop — `Agent.#run` (`agent.js:623`)

For `n = 1 … maxSteps`:

1. `refreshArtifacts()` — host-backed artifacts read fresh state.
2. `render(request, steps)` (`:375`) — the prompt, in fixed order: soul → `# YOU ARE` + role → each artifact's block →
   `# REQUEST` (+ `# OWNER GUIDANCE`) → `# EARLIER RUNS` → `# WORK DONE ON THIS REQUEST` (old results clipped to 700
   chars) → `# TOOLS` → `# RESPONSE`. At 90% of the budget (`COMPACT_AT`) old steps fold into one summary.
3. `collectImages()` → `infer(prompt, agent, {images})` → `parseReply`.
4. Answer and no calls → **gates** (`#gates` `:424`): every artifact's `gate()` (open checklist, unrecorded goal
   progress, a running dispatch, a StepContract's problems), `minCalls` not met, report fields missing. Refused → a
   `gate` row in WORK DONE and the loop goes on; after `gateRetries` soft refusals it goes through flagged; a hard
   reason never gives way.
5. No calls and no answer → a `format` row, go on.
6. Calls → all run together (`Promise.all` `:678`), results appended as a step; an answer written beside data calls is
   not taken (it was written before their results).

Ends: an answer through the gates, `maxSteps` reached, `stop()`, or an error.

The workflow wraps it: `judgedStep` (`workflow.js:1154`) renders the step prompt (`renderPhase` `:371`: `# PHASE n of
m`, the filled body, the owner's note, `# BOARD` of upstream reports, `# PHASE REPORT` fields), calls the step,
`checkStep` (`:1404`) — report fields / `schema` + `derive` / `check` — and on problems asks once more with
`<check_failed>` (`retries`, loop at `:1199`). A step agent is checked inside its own loop instead (its contract's
gate), so its retries are `gateRetries` = `retries + 1`. Problems that survive flow on to later steps. The scheduler
(`run`, around `:1080`) starts every waiting step whose `settledBefore` has settled, up to `concurrency`, until none
waits; the deadline skips steps not yet started (except `check` and `past_deadline` ones).

## 5. Coded vs configurable — the seams

| Element | Configurable now (file) | Coded (where) | Seam to open it |
|---|---|---|---|
| Step order, parallelism | `after`, `inputs`, `concurrency`, `barrier` | scheduler `workflow.js:~1080` | — already config |
| Step wording | the body, `### Output` | `renderPhase` section order and headings | a `render` plug-in exists (desk code); a `template:` per step would move it to the file |
| What a step may call | `tools`, `artifacts` (by catalogue name) | the catalogue (`builtin/index.js`, desk `tools/`) | tools stay code; the file only names them |
| Which commands of an artifact | — | `addArtifact(a, {commands})` supports a subset | a `goal[claim,done]` form in `artifacts:` |
| Loop length / effort | `max_steps`, `min_calls`, `model`, `retries` | defaults `maxSteps` 12, `gateRetries` 2 (`agent.js:202`) | — already config |
| When an answer is accepted | `report`, `schema`/`derive`/`check` (names a desk function) | `#gates`, `checkStep` | a declarative check in the file (`must: value is a number`) instead of a named function |
| Prompt order, reply format | — | `render`, `RESPONSE_FORMAT` | `config.system` replaces `# RESPONSE` whole; not reachable from a step file |
| Repeat-call cache, clipping, compaction | — | `REPEAT_MS`, `CLIP_OLD_STEP`, `COMPACT_AT` (`agent.js:39–53`) | Agent config fields (`contextChars` already is one) |
| Branching / loops between steps | — (a DAG, each step once per run) | the scheduler | a `when:` on a step (run only if `{{judge.toward}}` …) or `repeat_until:` — the one control-flow gap |

The short reading: the **graph and the words** are configuration; the **loop mechanics and the acceptance rules** are
code with named plug-ins. Making a workflow fully configurable mostly means two additions — conditional or repeating
steps (`when:` / `repeat_until:`) and declarative checks — since parameters, tools and the per-step loop budget are
already file keys.
