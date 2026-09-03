# Engine architecture — soul, skills, phases, and an agent that can ask

Date: 2026-09-03
Status: approved design, not yet implemented
Scope: `src/core/`, `src/backend/`, `src/protocol/`, `src/app/`, `agents/`, new `skills/`

This spec turns the owner's architecture brief into a buildable shape. It is an
**evolution of the existing tree**, decided explicitly: the 56 test files, the
worker/protocol split, the wasm sandbox, the workspace, speech and schedules all
keep running while the engine layer changes underneath them.

---

## 1. What the tree already is

The audit that preceded this spec found the brief's skeleton largely present and
load-bearing, not nominal. Recorded here so the plan does not rebuild it:

- `Engine` (`src/core/engine/Engine.js`) already owns the prompt render and the
  response parse; `run()` is abstract.
- `Inference` (`src/core/inference/Inference.js`) is an abstract base with
  **one** required method, `invoke`. OpenAI-compatible, Anthropic-compatible and
  in-tab transformers.js implementations exist. It is injected at construction.
- The whole prompt is rendered as **one sheet** and sent as a single user
  message (`OpenAICompatible.js`, `AnthropicCompatible.js`). History is rendered
  into the sheet, never sent as a messages array. Images are attached alongside,
  never fused into the text.
- `BaseResponse` (`src/core/response/BaseResponse.js`) reads its own `FIELDS`
  declaration to write the LLM's contract, and parses the reply back into an
  object. Subclasses declare fields.
- `Tool` (`src/core/tools/Tool.js`) is a base; an MCP tool and a sub-agent are
  both `Tool` subclasses.
- `buildAgent` (`src/core/agent/loadAgent.js`) reads `agents/<name>/agent.md`
  through a hand-written YAML-subset parser and returns a configured engine.
- The fully assembled prompt is shown to the user per pass of the loop
  (`src/app/PromptPanel.jsx`), with per-block token cost and volatility.
- Runtime dependencies are `next`, `react`, `react-dom`, `@huggingface/transformers`.
  Nothing else.

## 2. What this spec adds

Four capabilities are absent from the tree and named in the brief:

1. A **strategy engine** with phases. One engine kind exists today.
2. **Skills** — a folder of procedures, chosen per turn by the model.
3. **User escalation** — the agent has no way to ask the human anything.
4. **Instance context the model can navigate** — files render today as a flat,
   space-separated list of up to 40 names.

Three further items were built in this tree, measured, and deliberately deleted.
The owner has ruled that all three come back:

| Item | Why it was deleted | Ruling |
|---|---|---|
| Soul file | Built, never wired, no caller for four waves | Reinstate as a second identity layer |
| Pluggable response formats | The `Format` enum's JSON arm was never chosen | Reinstate the machinery, TOON stays default |
| Token metrics in the prompt | Measured out; they go to the UI panel instead | Reinstate, paired with the file tools |

And one further ruling: the **primary agent gets its own thread**, like every
sub-agent already does.

---

## 3. Engine layer

### 3.1 The base absorbs dispatch

Today the base holds `toolbox` as a field, but the only code that calls it lives
in `ReActEngine.observe`, alongside the check protocol, the repeat guard, the
retry policy and three exit constructors — 552 lines in a class the brief
describes as "only a while-true loop".

Moving to the base (`src/core/engine/Engine.js`):

- `observe(parsed, { emit })` — parse a response's action into calls, run them
  through the toolbox, return scratchpad entries.
- `verify(answer, { emit })` — run the agent's own `check` call once before an
  answer is allowed to land, and return its observation. The loop still does not
  judge the result; that argument is unchanged and its comment moves with it.

Staying in `ReActEngine`:

- The loop, its budget checks, the repeat guard, the unsaid/overrun retry
  policy, and the exit constructors. Those are loop *policy*, and a second loop
  is entitled to a different policy.

Target: `ReActEngine.js` under 300 lines with no behaviour change. Existing
tests pin the behaviour and must pass untouched.

### 3.2 StrategyEngine

New file `src/core/engine/StrategyEngine.js`, registered as `strategy` in
`src/core/engine/index.js` beside `react`. It runs an ordered list of phases,
each as a **nested ReAct run** with its own contract, tool subset and budget:

```js
class StrategyEngine extends Engine {
  async run(input, options) {
    let carry = { input, notes: [], repeats: 0 }
    // The run's whole allowance, spent down by every phase in turn.
    const pool = options.budget
    for (let index = 0; index < this.phases.length; index++) {
      const phase = this.phases[index]
      options.emit?.(EventName.PHASE, { name: phase.name, index, total: this.phases.length })
      const sub = new ReActEngine({
        ...this.shared,
        responseModel: phase.response,
        toolbox: this.toolbox.only(phase.tools),
      })
      const outcome = await sub.run(phase.render(carry), { ...options, budget: pool.share(phase.cap) })
      carry = phase.absorb(carry, outcome)
      if (phase.exits(carry)) break
      // A phase may hand the run backwards exactly once, which is how
      // `critique` returns to `act`. `repeats` is on the carry so the rule is
      // enforced in one place rather than inside a phase.
      const back = phase.repeat?.(carry)
      if (back && carry.repeats < 1 && !pool.exhausted) {
        carry = { ...carry, repeats: carry.repeats + 1 }
        index = this.phases.findIndex((p) => p.name === back) - 1
      }
    }
    return carry.answer
  }
}
```

`pool.share(cap)` is a new `Budget` method: it returns a view over the run's own
remaining allowance, capped at what the phase asks for. A phase therefore cannot
mint budget, only claim a slice of what is left.

`ReActEngine` learns nothing about phases. This is the object-oriented shell
with a functional interior the brief asks for: the engine is an object, a phase
is data plus three pure functions.

### 3.3 A phase module

One file per phase under `src/core/engine/phases/`, each exporting a frozen
object:

```js
export const Plan = Object.freeze({
  name: 'plan',
  response: PlanResponse,
  tools: ['read_file', 'search'],   // names; ['*'] means every tool the agent has
  cap: { steps: 6 },                // the most this phase may claim from the run's pool
  render(carry) { /* pure: carry -> the input string for the nested loop */ },
  absorb(carry, outcome) { /* pure: returns a NEW carry */ },
  exits(carry) { /* pure: true stops the whole strategy early */ },
  repeat(carry) { /* pure: a phase name to go back to, or nothing. Optional. */ },
})
```

The four phases:

- **onboard** — one call, no tools. Turns the user's words into a goal and a
  quest statement, names the skills worth loading from the skill index, and
  names the tools the work needs. `exits` when the model says the request is
  conversational, so a greeting does not pay for three more phases.
- **plan** — a reactive loop that may read and search, and produces ordered
  steps.
- **act** — a reactive loop with the agent's full toolbox that works the plan
  and ticks off its own steps. Reuses the existing `ReActResponse` contract
  rather than inventing a fourth, per the owner's reuse-before-new rule.
- **critique** — a reactive loop with read-only tools that compares the goal
  against what happened and returns a verdict, gaps, and what to do next.
  `absorb` may set `carry.answer`. On a verdict of not-done its `repeat` returns
  `'act'`, and the engine honours that at most once per run and only while the
  pool has room, both enforced in `StrategyEngine` rather than in the phase.

`Toolbox` gains `only(names)` returning a new `Toolbox` over the subset, which
is also how a phase gets a small toolkit without a second toolbox being built.

An agent file opts in:

```yaml
engine: strategy
phases: [onboard, plan, act, critique]
```

Absent `phases:`, a strategy agent takes the four above in that order.

### 3.4 Cost, stated plainly

A strategy turn is at least four model calls where a ReAct turn is one, and each
carries its own rendered sheet. Two mitigations are part of the design, not
follow-ups: `onboard` exits early on conversational input, and the budget is
declared **per strategy run**, with each phase claiming a capped slice of the
same pool through `Budget.share`. A long plan phase therefore leaves less for
act rather than granting act a fresh allowance, and the critique loop-back is
refused outright once the pool is spent.

---

## 4. Response contracts

### 4.1 The format arm returns

`src/core/response/formats/toon.js` and `src/core/response/formats/json.js`,
each exporting:

```js
{ name, render(fields, example), parse(text, fields) }
```

`BaseResponse` selects one via `static FORMAT` (default TOON), overridable per
agent by un-retiring the `format:` frontmatter key in
`src/core/agent/AgentSpec.js`. Subclasses still declare fields only.

The existing JSON repair path stays regardless of the chosen format: a reply
that arrives as JSON when TOON was asked for is still read. That is a repair,
not a form an agent may request — the distinction the deleted enum lost.

### 4.2 New contracts

Three, and one reuse:

| Contract | Fields | Used by |
|---|---|---|
| `OnboardResponse` | `goal`, `quest`, `skills`, `tools`, `conversational` | onboard |
| `PlanResponse` | `think`, `steps` | plan |
| `ReActResponse` (existing) | `think`, `plan`, `act`, `result` | act |
| `CritiqueResponse` | `verdict`, `gaps`, `next` | critique |

Five contracts total across the app. Registered in `src/core/response/index.js`.

---

## 5. Prompt layer

### 5.1 Three new blocks

`DEFAULT_ORDER` in `src/core/prompt/PromptTemplate.js` becomes:

```
soul          static     baseline character, shared by every agent
instructions  static     this agent's persona, from agent.md's body
skills        static     the bodies the onboard phase chose, for this run
tools         static     what it can do
contract      static     the full response spec
── cache breakpoint ──
conversation  append
scratchpad    append
files         volatile   the tree, with expand/collapse state
context       volatile   carries the clock
budget        volatile   spend, ceiling, and the last-turn hand-over
reminder      static     one line, for recency
cue           static
```

Ordering stays by cache volatility, which is measured and paid for in this tree.
The brief's order and the cache order agree where it matters: soul is the most
stable block in the app, so it goes first under either rule.

`soul` renders with no heading, for the same reason `instructions` does — it is
a document, and labelling a document as a document adds a level without adding a
distinction.

### 5.2 The soul file

`agents/soul.md`, body only, no frontmatter. `scripts/agents.js` copies it to
`public/agents/soul.md` and records `"soul": true` in `index.json` when it
exists. `AgentCatalogue` fetches it once per session; `buildAgent` takes it as
an explicit named parameter — never through a spread bag, which is exactly how
`soul` stayed arguable for four waves the last time.

An absent `agents/soul.md` is not an error. The block renders empty and is
dropped, as every empty block already is.

### 5.3 Files as a navigable tree

`FilesPort` gains `tree()`, returning `{ path, bytes, tokens }` per file.
A new `src/core/context/FileView.js` holds, for the duration of one run, which
paths are expanded. It is instance context: it lives on the engine, is rendered
fresh every pass, and is never appended to history.

Rendered:

```
# YOUR FILES   14 files, 22.4k tokens, 2 expanded

  src/
    app/
      page.jsx        1.2k  collapsed
      Header.jsx      0.3k  collapsed
    core/
      Engine.js       0.9k  EXPANDED
        <file body>
  notes.md            0.1k  EXPANDED
    <file body>
```

Two tools in `src/core/tools/FileViewTools.js`: `expand_file({ path })` and
`collapse_file({ path })`, both mutating the `FileView` and returning the new
totals as their observation. They are ordinary tools, listed in an agent file's
`tools:` like any other, and they are the only way the model changes what it is
shown.

**What the model may not touch:** soul, instructions, skills, tools, contract.
Those are fixed for the run by construction — they are not addressable, carry no
path, and no tool accepts them. This is the "carefully consider" the owner
flagged: compression is offered only where compression is meaningful, and the
identity and the contract are never at risk of being collapsed away.

### 5.4 Token metrics reach the model

The `budget` block regains counted lines, from the same numbers
`src/app/PromptPanel.jsx` already renders:

```
# BUDGET
prompt: 6.1k tokens of a 32k window; your files are 3.4k of it
steps: 3 of 12
```

Paired with the file tools this is actionable: the model is told what its view
costs and given the two calls that change it. Without the tools it was noise,
which is why it was deleted the first time, and the pairing is the reason it
comes back.

---

## 6. Skills

Layout mirrors agents, deliberately:

```
skills/
  writing-tests/skill.md      --- name, description --- then the procedure
  reviewing-a-diff/skill.md
```

`scripts/agents.js` gains a second pass that copies `skills/` to
`public/skills/` and writes `public/skills/index.json` holding `name` and
`description` per skill — the same reason `agents/index.json` exists: a
directory cannot be listed over HTTP.

`src/core/agent/SkillCatalogue.js` fetches the index and, on demand, a body.

Flow: the **onboard** phase is given the index (names and one-line descriptions
only, which is what keeps it cheap) and returns the names worth loading. Those
bodies are fetched once and rendered into the `skills` block for every later
phase of that run. A named skill that does not exist costs a note, not the run.

A ReAct agent with no strategy engine never sees skills. That is intentional:
selection is a phase, and an agent without phases has nowhere to put it.

---

## 7. The wire, and the UI

### 7.1 Protocol additions

`src/protocol/Envelope.js`:

- `EventName.PHASE` — `{ name, index, total }`, emitted as each phase opens.
- `EventName.ASK` — `{ askId, question, options }`, emitted when the agent asks.
- `export const REPLY = 'calls.reply'` — a protocol-owned method name, alongside
  `CANCEL`, for the same reason `CANCEL` is: no service owns it. Params are
  `{ askId, answer }`.

Both realms spell every name out. Nothing is discovered at runtime.

### 7.2 The ask tool

`src/core/tools/AskTool.js extends Tool`. Calling it emits `ASK` and returns a
promise that settles when the matching `REPLY` arrives. The backend holds the
pending map, keyed by `askId`, in the Kernel — the same side that already holds
the abort signal a page cannot send.

While parked:

- The loop is suspended. It is inside a tool call, so no engine change is needed.
- `Budget` gains `pause()` / `resume()` so a human thinking for two minutes does
  not spend the run's seconds. Steps and tokens are unaffected; they were not
  spent.
- `CANCEL` on the parent call settles every pending ask for that call as a
  refusal, so cancelling never leaves a promise nobody will settle.

The agent decides when to ask. There is no consent gate on risky tools in this
spec; that was considered and not chosen.

### 7.3 What the page shows

- `src/app/Composer.jsx` renders the question and its options when an ask is
  outstanding, and sends `REPLY`. The normal send path is disabled while one is
  open, so an answer cannot be mistaken for a new turn.
- `src/app/RunPanel.jsx` gains a phase rail beside the existing step rail.
- `src/app/PromptPanel.jsx` labels each sheet with the phase that produced it,
  so the rendered prompt stays the golden truth per phase rather than per run.

---

## 8. The primary agent gets a thread

Today `ChatService.send` runs the main agent inline in the single backend
worker; only sub-agents get threads through `AgentWorkerPool`. The owner's
ruling is that every agent runs on its own thread.

Shape: the primary run moves into a pool worker like any other agent. What makes
this larger than it looks is that the backend worker owns things a threaded
agent still needs — IndexedDB (conversations, settings, files), the wasm
sandbox, and the MCP transports that run inside it.

So `src/backend/agentWorker.js` gains a **service proxy**: a `MessagePort` back
to the backend worker over which `FilesPort`, `HttpPort`, `TasksPort` and the
sandbox are called. The backend worker stays the sole owner of storage and of
the guest. Events already flow from a pool worker as progress; that channel
widens to carry every `EventName` so a threaded primary is no quieter than an
inline one.

Risks, stated: every tool call from the primary now crosses a port, the sandbox
stays single-owner so two threads calling shell still serialise, and cancel must
reach a thread rather than a local signal. This is the last increment for those
reasons, and it is revertable on its own.

---

## 9. Increments

Each is independently shippable, ends green on `bun run check`, and is deployed
before the next begins.

1. **Soul.** `agents/soul.md`, the block, the build-script copy, the named
   parameter through `buildAgent`.
2. **Base absorbs dispatch.** `observe` and `verify` move down; `ReActEngine`
   shrinks to the loop. No behaviour change; existing tests unmodified.
3. **Format arm.** `formats/toon.js`, `formats/json.js`, `static FORMAT`,
   `format:` un-retired in `AgentSpec`.
4. **Files tree and metrics.** `FilesPort.tree()`, `FileView`, `expand_file`,
   `collapse_file`, the `files` block, the budget counted lines.
5. **Ask.** `AskTool`, `EventName.ASK`, `REPLY`, the Kernel pending map,
   `Budget.pause/resume`, the composer affordance.
6. **Skills.** `skills/`, the build pass, `SkillCatalogue`, `OnboardResponse`.
7. **Strategy.** `StrategyEngine`, the four phase modules, `PlanResponse` and
   `CritiqueResponse`, `Toolbox.only`, `EventName.PHASE`, the phase rail.
8. **Critique pass.** A fresh-context agent verifies the tree against this spec
   and against the owner's brief, and its findings are worked to zero.
9. **Primary on a thread.** The service proxy, the widened event channel, cancel
   across the port.

---

## 10. How each increment is verified

- `bun test` for the unit. New files arrive with tests: phase modules are pure
  functions and are tested as such; `StrategyEngine` is tested against a
  scripted inference with no network.
- `bun run smoke` for anything that must be true in a real browser. The tree's
  own recorded lesson applies: an event that is declared but never emitted is
  this codebase's recurring defect, and only the browser smoke can see it. Every
  new event name — `PHASE`, `ASK` — gets a smoke assertion that it actually
  arrived, not merely that it is spelled in both realms.
- `test/architecture/layers.test.js` stays green: nothing added to `core/`
  touches the DOM or storage. `FileView` holds state but reaches nothing.
- The prompt audit already in `PromptTemplate` reports a wasteful block
  arrangement as a note. Adding `soul` and `skills` ahead of the cache
  breakpoint should improve it; if it does not, the note is the evidence and the
  order is revisited.
- `ARCHITECTURE.md` is updated in the same commit as the code it describes, as
  this tree already requires. An increment that changes a realm boundary, an
  event name or a prompt block and leaves that document stale is not finished.
- After each increment, a fresh-context critique agent reads this spec and the
  diff and reports what is claimed but not built. Increment 8 is that check run
  against the whole.

---

## 11. Deliberately not in this spec

- A consent gate on risky tools. Considered, not chosen; the ask tool is the
  agent's own call.
- A second response format beyond JSON. The machinery returns; a new format
  needs a run that wants one.
- A hard ceiling on tool count. The brief notes degradation past roughly fifty
  tools; the pressure here is the per-server `include_tools` allowlist, the
  depth-one sub-agent rule, and now the per-phase tool subset. A numeric cap is
  not added without a measurement in this tree.
- Anything that makes a run survive the tab closing. It remains impossible
  without a server, and this app has none.
