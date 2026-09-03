# Engine Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give this browser agent harness a second identity layer, a skills folder, a strategy engine with phases, a file view the model can navigate, and a way for the agent to ask the human a question.

**Architecture:** The base `Engine` absorbs tool dispatch so `ReActEngine` becomes only a loop, and a new `StrategyEngine` runs ordered phases as nested ReAct runs. A phase is a frozen data object plus four pure functions. Everything crossing the worker/page boundary goes through `src/protocol/Envelope.js`, which both realms spell out by hand.

**Tech Stack:** Vanilla JavaScript, ES modules, Bun test runner, Next 16 static export, React 19, Biome. No new dependencies are added by any task in this plan.

**Spec:** `docs/superpowers/specs/2026-09-03-engine-architecture-design.md`

## Global Constraints

- **No new dependencies.** Runtime deps stay exactly `next`, `react`, `react-dom`, `@huggingface/transformers`. Dev deps stay exactly `@biomejs/biome`.
- **Nothing throws.** Every failure is a value: return `Outcome.failed(Reason.X, message, { hint })` from `src/core/Outcome.js`. A tool that fails returns a string the agent reads.
- **`src/core/` touches no DOM and no storage.** Enforced by `test/architecture/layers.test.js`. Capabilities arrive as injected ports.
- **`src/protocol/Envelope.js` is the only module both realms import.** It must stay structured-clone safe: no class instances on the wire, no functions, no `AbortSignal`.
- **Test command is `bun test ./test`.** Not `bun test --isolate` when you want to see failures; `--isolate` has been measured in this tree to hide failures that plain `bun test` shows.
- **Full gate is `bun run check`** = `bun run lint && bun run test && bun run smoke && bun run toolchain`. Every task ends green on it.
- **Commit subjects in this repo are sentences, not conventional-commit prefixes.** See `git log --oneline`: "A settings sheet that crashed on open, with 911 tests green over it". Write subjects in that voice. Never `feat:` or `fix:`.
- **Every commit ends with the trailers:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
  ```
- **A declared-but-never-emitted event is this tree's recurring defect.** Any task adding an `EventName` also adds a smoke assertion that the event actually arrived, not merely that the string is spelled in both realms.
- **`ARCHITECTURE.md` is updated in the same commit as the code it describes.** A task that changes a realm boundary, an event name or a prompt block and leaves that document stale is not finished.
- **Prompt block order is decided by cache volatility**, argued at length in `src/core/prompt/PromptTemplate.js`. A block added ahead of the cache breakpoint must be `Volatility.STATIC`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `agents/soul.md` | The baseline character every agent shares. Body only, no frontmatter. |
| `src/core/response/formats/toon.js` | Render a field table as TOON instructions; supply the TOON example. |
| `src/core/response/formats/json.js` | The same two functions for JSON. |
| `src/core/response/formats/index.js` | Format name to module, and the default. |
| `src/core/response/OnboardResponse.js` | goal, quest, skills, tools, conversational. |
| `src/core/response/PlanResponse.js` | think, steps. |
| `src/core/response/CritiqueResponse.js` | verdict, gaps, next. |
| `src/core/context/FileView.js` | Which workspace paths are expanded, for one run. Holds no I/O. |
| `src/core/tools/FileViewTools.js` | `expand_file` and `collapse_file`, both mutating a `FileView`. |
| `src/core/tools/AskTool.js` | Emits an ask and waits for the human's reply. |
| `src/core/agent/SkillCatalogue.js` | Fetches `public/skills/index.json` and skill bodies. |
| `src/core/engine/StrategyEngine.js` | Runs ordered phases as nested ReAct runs. |
| `src/core/engine/phases/index.js` | Phase name to module, and the default order. |
| `src/core/engine/phases/onboard.js` | Goal, quest, skill choice. One call, no tools. |
| `src/core/engine/phases/plan.js` | Ordered steps, read-only tools. |
| `src/core/engine/phases/act.js` | The work, full toolbox, reuses `ReActResponse`. |
| `src/core/engine/phases/critique.js` | Verdict against the goal, read-only tools. |
| `src/backend/ServiceProxy.js` | Storage and network reached across a `MessagePort`, for a threaded agent. |
| `skills/writing-a-plan/skill.md` | One real skill, so the folder is not empty on arrival. |

**Modified:** `src/core/engine/Engine.js`, `ReActEngine.js`, `Budget.js`, `engine/index.js`, `src/core/response/BaseResponse.js`, `response/index.js`, `src/core/prompt/PromptTemplate.js`, `src/core/tools/Toolbox.js`, `tools/index.js`, `FilesPort.js`, `src/core/agent/AgentSpec.js`, `AgentCatalogue.js`, `loadAgent.js`, `src/protocol/Envelope.js`, `src/backend/Kernel.js`, `composition.js`, `services/ChatService.js`, `agentWorker.js`, `AgentWorkerPool.js`, `src/backend/files/Workspace.js`, `src/client/BackendClient.js`, `src/app/page.jsx`, `Composer.jsx`, `RunPanel.jsx`, `PromptPanel.jsx`, `globals.css`, `agents/main/agent.md`, `scripts/agents.js`, `scripts/smoke.js`, `ARCHITECTURE.md`.

---

## Task 1: The soul block

**Files:**
- Create: `agents/soul.md`
- Modify: `src/core/prompt/PromptTemplate.js` (`DEFAULT_ORDER`)
- Modify: `src/core/engine/Engine.js` (constructor, `blocks`)
- Modify: `src/core/agent/loadAgent.js` (`buildAgent` signature)
- Modify: `src/core/agent/AgentCatalogue.js` (add `soul()`)
- Modify: `src/backend/services/ChatService.js:523` (pass soul)
- Modify: `src/backend/agentWorker.js:124` (pass soul)
- Modify: `scripts/agents.js` (copy `agents/soul.md`)
- Test: `test/core/engine/Engine.test.js`, `test/core/agent/AgentCatalogue.test.js` (new file)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `new Engine({ soul })` renders a block with id `soul` first; `AgentCatalogue.soul(): Promise<Outcome>` whose value is a string, empty when absent; `buildAgent({ soul })` accepts and forwards it.

- [ ] **Step 1: Write the failing engine test**

Append to `test/core/engine/Engine.test.js`, inside the existing `describe('the prompt blocks the kernel builds', …)`:

```js
  test('the soul block is first and carries the shared character', () => {
    const engine = new Engine({
      soul: 'You are careful and you say what you did.',
      system: 'You research things.',
      responseModel: ReActResponse,
    })
    const blocks = engine.blocks([])

    expect(blocks[0].id).toBe('soul')
    expect(blocks[0].body).toBe('You are careful and you say what you did.')
    expect(blocks[0].volatility).toBe('static')
  })

  test('an agent with no soul renders no soul block body', () => {
    const blocks = new Engine({ system: 'x', responseModel: ReActResponse }).blocks([])
    expect(blocks.find((block) => block.id === 'soul').isEmpty).toBe(true)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test ./test/core/engine/Engine.test.js`
Expected: FAIL. The first block is `instructions`, so `blocks[0].id` is `"instructions"`.

- [ ] **Step 3: Add the field and the block**

In `src/core/engine/Engine.js`, add `soul = ''` to the constructor's destructured options beside `system`, and assign `this.soul = soul`. Make the soul block the first entry of the array `blocks()` returns:

```js
      // No heading, for the reason `instructions` has none: this is a document,
      // and labelling a document as a document adds a level without adding a
      // distinction. First because it is the most stable text in the app —
      // identical for every agent on every call — so it is the cheapest
      // possible start to a cacheable prefix.
      new PromptBlock({
        id: 'soul',
        body: this.soul,
        volatility: Volatility.STATIC,
      }),
```

In `src/core/prompt/PromptTemplate.js`, put `'soul'` first in `DEFAULT_ORDER` and add one line to the block-order comment above it: `soul  static  the baseline character, shared by every agent`.

- [ ] **Step 4: Run the engine and prompt tests**

Run: `bun test ./test/core/engine ./test/core/prompt`
Expected: PASS.

- [ ] **Step 5: Write the failing catalogue test**

Create `test/core/agent/AgentCatalogue.test.js`:

```js
import { describe, expect, test } from 'bun:test'
import { AgentCatalogue } from '../../../src/core/agent/AgentCatalogue.js'

/**
 * The soul is fetched like an agent file and is allowed to be missing. A tree
 * with no `agents/soul.md` must load agents exactly as it did before, which is
 * why absence is an empty string rather than a failure.
 */
const catalogueServing = (bodies) => {
  const catalogue = new AgentCatalogue('')
  catalogue._fetchText = async (url) =>
    url in bodies
      ? { ok: true, value: bodies[url], notes: [] }
      : { ok: false, value: null, notes: [], failure: { message: 'HTTP 404' } }
  return catalogue
}

describe('the shared soul', () => {
  test('is read once and kept', async () => {
    const catalogue = catalogueServing({ 'agents/soul.md': 'Be careful.' })
    expect((await catalogue.soul()).value).toBe('Be careful.')
    expect((await catalogue.soul()).value).toBe('Be careful.')
  })

  test('is empty rather than a failure when the file is not there', async () => {
    const got = await catalogueServing({}).soul()
    expect(got.ok).toBe(true)
    expect(got.value).toBe('')
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `bun test ./test/core/agent/AgentCatalogue.test.js`
Expected: FAIL with `catalogue.soul is not a function`.

- [ ] **Step 7: Implement `soul()`**

In `src/core/agent/AgentCatalogue.js`, add `this._soul = null` to the constructor and this method after `names()`:

```js
  /**
   * The character every agent in this build shares.
   *
   * Absent is ok and is an empty string, not a failure: a tree with no
   * `agents/soul.md` must load its agents exactly as it did before this block
   * existed. `_soul` is a string once read, so `null` is the only "not yet"
   * and an empty file cannot be re-fetched on every turn.
   *
   * @returns {Promise<Outcome>} value is the soul text, possibly empty
   */
  async soul() {
    if (this._soul !== null) return Outcome.ok(this._soul)
    const read = await this._fetchText(this._url('soul.md'), 'the shared soul')
    this._soul = read.ok ? read.value.trim() : ''
    return Outcome.ok(this._soul)
  }
```

`soul.md` sits directly under `public/agents/`, so `_url('soul.md')` is the right call and no agent name is involved.

- [ ] **Step 8: Run it and watch it pass**

Run: `bun test ./test/core/agent/AgentCatalogue.test.js`
Expected: PASS.

- [ ] **Step 9: Thread it through `buildAgent` and both call sites**

In `src/core/agent/loadAgent.js`, add `soul = ''` to `buildAgent`'s destructured options and pass `soul` into the `createEngine({ … })` call, directly above `system`. Keep it a named parameter: that file's own comment records that a spread `overrides` bag is how `soul` stayed arguable for four waves, so do not reintroduce one.

In `src/backend/services/ChatService.js`, immediately before the `buildAgent({` call at line 523, read the soul and add `soul: soul.value,` to the options:

```js
    // Read once per session by the catalogue and cached there, so this is a
    // map lookup on every turn after the first.
    const soul = await this.catalogue.soul()
```

In `src/backend/agentWorker.js`, do the same before the `buildAgent({` call at line 124, using `catalogueFor(basePath ?? '')` — the same catalogue instance the spec came from, so a sub-agent pays no second fetch.

- [ ] **Step 10: Write the soul file**

Create `agents/soul.md`. It is the baseline character, and it must not repeat anything the response contract or the tool table already says:

```markdown
You are a careful assistant that runs entirely inside someone's browser tab.

Say what you actually did and what you did not get to. When a tool answers with
something you did not expect, say so rather than writing around it. Prefer
finding out over recalling: you have tools, and a wrong answer given quickly is
worth less than a right one given a turn later.

You are one of several agents in this app, each with its own instructions and
its own tools. What is written below this is what makes you the one you are.
```

- [ ] **Step 11: Copy it at build time**

In `scripts/agents.js`, the glob `*/**` only matches files inside a folder, so a top-level `soul.md` is skipped. After the loop, add:

```js
// The soul sits at the top of `agents/`, not inside an agent's folder, so the
// `*/**` glob above cannot see it. Copied by name, and its absence is normal.
const soulFile = Bun.file(join(SOURCE, 'soul.md'))
const hasSoul = await soulFile.exists()
if (hasSoul) await Bun.write(join(TARGET, 'soul.md'), await soulFile.text())
```

and change the `index.json` write to record it:

```js
await Bun.write(
  join(TARGET, 'index.json'),
  `${JSON.stringify({ agents: names, soul: hasSoul }, null, 2)}\n`,
)
```

Add one line to the script's output: `console.log(\`  soul: ${hasSoul ? 'agents/soul.md' : '(none)'}\`)`.

- [ ] **Step 12: Run the whole gate**

Run: `bun run check`
Expected: PASS, all suites green.

- [ ] **Step 13: Update ARCHITECTURE.md**

Find the prompt-block list (search for `instructions  static`) and add the `soul` row at the top with its one-sentence reason: it is the most stable text in the app and every agent shares it.

- [ ] **Step 14: Commit**

```bash
git add agents/soul.md scripts/agents.js src/core/engine/Engine.js src/core/prompt/PromptTemplate.js src/core/agent/loadAgent.js src/core/agent/AgentCatalogue.js src/backend/services/ChatService.js src/backend/agentWorker.js test/core/engine/Engine.test.js test/core/agent/AgentCatalogue.test.js ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Two identity layers, where there had been one and an argument about a second

The soul is the character every agent shares and the agent file is the persona
on top of it. It was built once before and deleted after four waves in which no
caller ever passed it, so it arrives here as a named parameter on buildAgent
rather than through a spread bag, and with the two call sites that pass it.

It is the most stable text in the app, so it starts the cacheable prefix. An
absent agents/soul.md is normal and renders nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
EOF
)"
```

---

## Task 2: The base absorbs tool dispatch

`ReActEngine` is 552 lines and owns dispatch, the check protocol, retry policy and the exits. Dispatch and the check are wanted by any loop; the rest is this loop's policy. This task moves two methods down and changes no behaviour.

**Files:**
- Modify: `src/core/engine/Engine.js` (add `observe`, `verify`)
- Modify: `src/core/engine/ReActEngine.js` (delete `observe`, call `verify`)
- Test: `test/core/engine/Engine.test.js`; `test/core/engine/ReActEngine.test.js` must pass unmodified

**Interfaces:**
- Consumes: Task 1's `soul` field on the same constructor.
- Produces: `Engine.observe(parsed, times, signal): Promise<string>` and `Engine.verify(signal): Promise<{note: string, entry: {action: string, observation: string}} | null>`.

- [ ] **Step 1: Write the failing base test**

Append to `test/core/engine/Engine.test.js`:

```js
describe('what the kernel does with a tool call', () => {
  const toolbox = {
    isEmpty: false,
    isRepeatable: () => false,
    run: async (text) => ({ observation: `ran ${text}`, count: 1 }),
  }

  test('a first call is dispatched to the toolbox', async () => {
    const engine = new Engine({ toolbox, responseModel: ReActResponse })
    const said = await engine.observe({ answer: 'search({"q":"x"})' }, 1, null)
    expect(said).toBe('ran search({"q":"x"})')
  })

  test('a repeat is answered without running anything', async () => {
    const engine = new Engine({ toolbox, responseModel: ReActResponse })
    const said = await engine.observe({ answer: 'search({"q":"x"})' }, 2, null)
    expect(said).toContain('was already made')
    expect(said).not.toContain('ran search')
  })

  test('an agent with no tools is told to answer instead', async () => {
    const engine = new Engine({ responseModel: ReActResponse })
    const said = await engine.observe({ answer: 'search({})' }, 1, null)
    expect(said).toContain('no tools are available')
  })

  test("verify runs the agent's own check once and hands back what it said", async () => {
    const engine = new Engine({
      toolbox,
      check: 'shell({"cmd":"test"})',
      responseModel: ReActResponse,
    })
    const first = await engine.verify(null)

    expect(first.entry.action).toBe('shell({"cmd":"test"})')
    expect(first.entry.observation).toContain('ran shell')
    expect(first.note).toContain("ran this agent's check")
    // Once per engine, so a check the agent keeps failing cannot spend a run.
    expect(await engine.verify(null)).toBe(null)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test ./test/core/engine/Engine.test.js`
Expected: FAIL with `engine.observe is not a function`.

- [ ] **Step 3: Move `observe` down verbatim**

Cut the whole `async observe(parsed, times = 1, signal = null)` method, including its doc comment, from the bottom of `src/core/engine/ReActEngine.js` and paste it into `src/core/engine/Engine.js` above `run()`. Do not change a character of its body. Add one sentence to the head of its comment:

```
   * On the base and not on a loop: every loop that can call a tool needs this,
   * and the repeat guard is a property of calling tools rather than of any one
   * control flow.
```

- [ ] **Step 4: Add `verify` to the base**

Add to `src/core/engine/Engine.js`, below `observe`. This is the check protocol lifted out of `ReActEngine.run`'s answer branch, with the same once-per-run rule and the same words:

```js
  /**
   * The agent's own check, run once, before an answer is allowed to end a run.
   *
   * Who judges the result is the design question and the answer is: not the
   * engine. A check's output is a test runner's summary or an exit status, and
   * reading pass or fail out of that text would be guessing at a vocabulary
   * this file does not own — guessing wrong means an answer thrown away or a
   * broken one waved through. So the result goes back to the agent, and the
   * next reply is an answer that has seen its own test.
   *
   * Once per engine, held on `_checked`, because a check the agent keeps
   * failing would otherwise spend the whole budget on it.
   *
   * @returns {Promise<{note: string, entry: {action: string, observation: string}}|null>}
   *   null when there is nothing to run or it has already run.
   */
  async verify(signal = null) {
    if (!this.check || this._checked || !this.toolbox || this.toolbox.isEmpty) return null
    this._checked = true
    const ran = await this.toolbox.run(this.check, signal)
    return {
      note: `ran this agent's check: ${this.check}`,
      entry: {
        action: this.check,
        observation: `${ran?.observation ?? ''}\n\nThat is this agent's own check, run because you were about to finish. Read it: if it shows your work is done and correct, answer now. If it shows a problem, fix that first.`,
      },
    }
  }
```

Add `this._checked = false` to the constructor, beside `this.check = check`.

- [ ] **Step 5: Run the base test and watch it pass**

Run: `bun test ./test/core/engine/Engine.test.js`
Expected: PASS.

- [ ] **Step 6: Rewrite the loop's answer branch to call `verify`**

In `src/core/engine/ReActEngine.js`, delete the local `checked` variable and replace the two `if (this.check && !checked …)` blocks in the answer branch with this. The budget-closing branch keeps its own words, because that branch is the loop's policy and not the check's:

```js
        // Said out loud when the terms of the run swallowed it. An author who
        // declared a check and a one-step budget has claimed a test that never
        // runs, and silence there is the same defect as a `max_steps` that
        // stopped a run without telling anyone.
        if (this.check && !this._checked && budget.closing) {
          this._checked = true
          notes.push(
            `this agent's check did not run: the ${budget.closing} budget was spent, and the last turn is for answering`,
          )
        }
        // Skipped when the budget is closing: the last turn was told it is the
        // last, and spending its final step on a check would end the run with
        // no answer at all, which is worse than an unchecked one.
        if (!budget.closing) {
          const checked = await Promise.race([this.verify(signal), until(signal)])
          if (signal?.aborted) return this.stopped(last, budget, notes)
          if (checked) {
            notes.push(checked.note)
            scratchpad.push(checked.entry)
            continue
          }
        }
```

- [ ] **Step 7: Run the loop's own tests, unmodified**

Run: `bun test ./test/core/engine`
Expected: PASS. If `ReActEngine.test.js` needs editing to pass, the move changed behaviour — revert and redo it.

- [ ] **Step 8: Confirm the loop actually shrank**

Run: `wc -l src/core/engine/ReActEngine.js`
Expected: under 300. If not, the check protocol or `observe` is still partly inline.

- [ ] **Step 9: Run the whole gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/core/engine/Engine.js src/core/engine/ReActEngine.js test/core/engine/Engine.test.js
git commit -m "$(cat <<'EOF'
The loop that was only a loop, once dispatch and the check moved under it

Engine held the toolbox as a field while the only code calling it lived in the
subclass, alongside the check protocol, the retry policy and three exits. Tool
dispatch and the check belong to any loop that can call a tool, so they are on
the base now and ReActEngine is the control flow and its exits.

No behaviour changed: the loop's own tests pass unmodified, which is the whole
of what this claims.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
EOF
)"
```

---

## Task 3: The response format arm

**Files:**
- Create: `src/core/response/formats/toon.js`, `json.js`, `index.js`
- Modify: `src/core/response/BaseResponse.js`
- Modify: `src/core/agent/AgentSpec.js` (un-retire `format`)
- Modify: `src/core/agent/loadAgent.js` (apply the chosen form)
- Test: `test/core/response/BaseResponse.test.js`, `test/core/agent/AgentSpec.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BaseResponse.FORMAT` (a string, `'toon'` by default); `getFormat(name)` returning `{ name, instructions(fieldDocs, example), example(names, valueFor) }`; `spec.format` on `AgentSpec`.

- [ ] **Step 1: Write the failing format test**

Append to `test/core/response/BaseResponse.test.js`:

```js
describe('the format a contract is written in', () => {
  class ToonKind extends BaseResponse {
    static FIELDS = { thinking: { description: 'a' }, response: { description: 'b' } }
  }
  class JsonKind extends BaseResponse {
    static FORMAT = 'json'
    static FIELDS = { thinking: { description: 'a' }, response: { description: 'b' } }
  }

  test('TOON is the default and asks for one field per line', () => {
    expect(ToonKind.instructions()).toContain('one per line as `name: value`')
    expect(ToonKind.instructions()).toContain('thinking: <your thinking here>')
  })

  test('a JSON contract asks for one object and shows one', () => {
    const said = JsonKind.instructions()
    expect(said).toContain('a single JSON object')
    expect(said).toContain('"thinking"')
    expect(said).not.toContain('one per line as `name: value`')
  })

  test('a JSON contract still reads a TOON reply, as a repair', () => {
    expect(JsonKind.parse('thinking: quickly\n\nresponse: done').response).toBe('done')
  })

  test('a TOON contract still reads a JSON reply, as a repair', () => {
    expect(ToonKind.parse('{"thinking": "quickly", "response": "done"}').response).toBe('done')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test ./test/core/response/BaseResponse.test.js`
Expected: FAIL. `JsonKind.instructions()` returns the TOON text, so `toContain('a single JSON object')` fails.

- [ ] **Step 3: Write the TOON format module**

Create `src/core/response/formats/toon.js`. The field table and the example arrive as arguments, so this module never sees a class:

```js
/**
 * The line-oriented form, and the default.
 *
 * TOON is what small local models follow far more reliably than they produce
 * valid JSON: one `name: value` per line, blank line between, no punctuation to
 * balance. The measurement behind the SIZE of the contract block is in
 * `BaseResponse` and is not repeated here — what lives in this file is the
 * shape only.
 */
export const toon = {
  name: 'toon',

  instructions(fieldDocs, example) {
    return [
      '# RESPONSE FORMAT',
      '',
      'Reply with exactly these fields, in this order, one per line as `name: value`, blank line between:',
      '',
      fieldDocs,
      '',
      `Example:\n${example}`,
    ].join('\n')
  },

  example(names, valueFor) {
    return names.map((name) => `${name}: ${valueFor(name)}`).join('\n\n')
  },
}
```

- [ ] **Step 4: Write the JSON format module**

Create `src/core/response/formats/json.js`:

```js
/**
 * The braced form, for an endpoint whose model is better at JSON than at lines.
 *
 * It is a form a file may ASK for. That is the distinction the deleted `Format`
 * enum lost and this pair of modules restores: `BaseResponse.parse` reads JSON
 * out of a TOON contract as a REPAIR whatever this file does, and a repair is
 * not a permission. Asking for it here is the permission.
 */
export const json = {
  name: 'json',

  instructions(fieldDocs, example) {
    return [
      '# RESPONSE FORMAT',
      '',
      'Reply with a single JSON object carrying exactly these keys, and nothing outside it — no prose, no code fence:',
      '',
      fieldDocs,
      '',
      `Example:\n${example}`,
    ].join('\n')
  },

  example(names, valueFor) {
    const body = names.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(valueFor(name))}`)
    return `{\n${body.join(',\n')}\n}`
  },
}
```

- [ ] **Step 5: Write the registry**

Create `src/core/response/formats/index.js`:

```js
import { json } from './json.js'
import { toon } from './toon.js'

/** Format name -> the pair of functions that write the contract. */
export const FORMATS = { [toon.name]: toon, [json.name]: json }

export const DEFAULT_FORMAT = toon.name

/** An unknown name falls back rather than refusing, like every other registry here. */
export function getFormat(name) {
  return FORMATS[name] ?? FORMATS[DEFAULT_FORMAT]
}
```

- [ ] **Step 6: Make `BaseResponse` use it**

In `src/core/response/BaseResponse.js`, import `getFormat` from `./formats/index.js`, add the static, and rewrite `instructions()` to delegate. Keep the whole measurement comment above `instructions()` exactly as it is — it is the record of a 192-call experiment and none of it stops being true:

```js
  /** Which form this contract is written in. `formats/` holds the pair. */
  static FORMAT = 'toon'

  static instructions() {
    const format = getFormat(this.FORMAT)
    const names = this.fieldNames()
    return format.instructions(
      this._fieldDocs(),
      format.example(names, (name) => this._exampleValue(name)),
    )
  }
```

`parse()` is unchanged: it tries TOON, then JSON, then keeps the whole reply, whatever `FORMAT` says, because each is the repair of the other and the comment in `parse` already argues it.

- [ ] **Step 7: Run the response tests**

Run: `bun test ./test/core/response`
Expected: PASS.

- [ ] **Step 8: Write the failing spec test**

Append to `test/core/agent/AgentSpec.test.js`:

```js
test('an agent file may name the form its contract is written in', () => {
  const built = AgentSpec.of({ metadata: { name: 'a', format: 'json' }, body: 'x' })
  expect(built.value.format).toBe('json')
  expect(built.notes.join(' ')).not.toContain('no longer does anything')
})

test('an unknown form is corrected rather than refused', () => {
  const built = AgentSpec.of({ metadata: { name: 'a', format: 'yaml' }, body: 'x' })
  expect(built.value.format).toBe('toon')
  expect(built.notes.join(' ')).toContain('yaml')
})
```

- [ ] **Step 9: Run it and watch it fail**

Run: `bun test ./test/core/agent/AgentSpec.test.js`
Expected: FAIL. `format` is in `RETIRED`, so the note says "no longer does anything" and `spec.format` is undefined.

- [ ] **Step 10: Un-retire the key**

In `src/core/agent/AgentSpec.js`, delete the `format:` entry from `RETIRED` and replace it in the comment above with a sentence saying it came back because the machinery did. Add `format: DEFAULT_FORMAT` to the defaults, and in `AgentSpec.of`, after the alias loop:

```js
    // Corrected rather than refused, like every other unknown name in this
    // file: a typo in one line costs that line, not the agent.
    if (raw.format !== undefined && !Object.hasOwn(FORMATS, raw.format)) {
      notes.push(
        `${source}: format ${JSON.stringify(raw.format)} is not one this app writes; used ${DEFAULT_FORMAT} instead`,
      )
      raw.format = DEFAULT_FORMAT
    }
```

- [ ] **Step 11: Make the format reach the contract**

In `src/core/agent/loadAgent.js`, replace the `responseModel: getResponseModel(spec.response)` argument with:

```js
  // A file that names a form gets a subclass carrying it. Assigning
  // `Model.FORMAT = spec.format` instead would change the contract for every
  // agent in the app that shares this class, including ones already built.
  const Declared = getResponseModel(spec.response)
  const Model =
    spec.format && spec.format !== Declared.FORMAT
      ? class extends Declared {
          static FORMAT = spec.format
        }
      : Declared
```

and pass `responseModel: Model`.

- [ ] **Step 12: Run the gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 13: Update ARCHITECTURE.md**

Find where it says the contract is TOON-only and correct it: TOON is the default, JSON is a form a file may ask for, and a reply in the other form is still read as a repair.

- [ ] **Step 14: Commit**

```bash
git add src/core/response src/core/agent/AgentSpec.js src/core/agent/loadAgent.js test/core/response/BaseResponse.test.js test/core/agent/AgentSpec.test.js ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
A form a file may ask for, told apart from a form the parser will repair

The Format enum went because no run ever chose its JSON arm. What went with it
was the distinction: parse has always read a JSON reply, and there was no way
to say a contract is WRITTEN in JSON. Two small modules hold the two shapes,
BaseResponse picks one, and an agent file may name it again.

A file naming a form gets a subclass carrying it, so one agent's choice cannot
change the contract of every other agent sharing that class.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
EOF
)"
```

---

## Task 4: The files block, and what it costs

Today the agent's files reach the prompt as up to 40 space-separated names inside the volatile context block. This task makes them a tree with per-file token costs and two tools that change what is shown, and puts the prompt's own cost in the budget block beside them.

**Files:**
- Create: `src/core/context/FileView.js`, `src/core/tools/FileViewTools.js`
- Modify: `src/core/tools/FilesPort.js` (contract doc, `NO_FILES`)
- Modify: `src/backend/files/Workspace.js` (add `tree`)
- Modify: `src/core/engine/Engine.js` (the `files` block)
- Modify: `src/core/engine/Budget.js` (counted lines)
- Modify: `src/core/prompt/PromptTemplate.js` (`DEFAULT_ORDER`)
- Modify: `src/core/tools/index.js` (register both tools)
- Modify: `src/backend/services/ChatService.js` (build the view, drop the flat list)
- Test: `test/core/context/FileView.test.js`, `test/core/tools/FileViewTools.test.js`, `test/core/engine/Budget.test.js`

**Interfaces:**
- Consumes: Task 1's block ordering.
- Produces: `new FileView(entries)` with `render()`, `expand(path, body): boolean`, `collapse(path): boolean`, `has(path)`, `totals(): {files, tokens, expanded, shown}`; `FilesPort.tree(): Outcome<Array<{path, bytes, tokens}>>`; `Budget.describe(assembled)`.

- [ ] **Step 1: Write the failing view test**

Create `test/core/context/FileView.test.js`:

```js
import { describe, expect, test } from 'bun:test'
import { FileView } from '../../../src/core/context/FileView.js'

const entries = [
  { path: 'notes.md', bytes: 400, tokens: 100 },
  { path: 'src/app/page.jsx', bytes: 4800, tokens: 1200 },
  { path: 'src/core/Engine.js', bytes: 3600, tokens: 900 },
]

describe('the file tree the model reads', () => {
  test('nests folders and marks everything collapsed to begin with', () => {
    const shown = new FileView(entries).render()
    expect(shown).toContain('src/')
    expect(shown).toContain('app/')
    expect(shown).toContain('page.jsx')
    expect(shown).toContain('collapsed')
    expect(shown).not.toContain('EXPANDED')
  })

  test('an expanded file carries its body and says so', () => {
    const view = new FileView(entries)
    view.expand('src/core/Engine.js', 'export class Engine {}')
    expect(view.render()).toContain('EXPANDED')
    expect(view.render()).toContain('export class Engine {}')
  })

  test('collapsing puts the body back and frees its tokens', () => {
    const view = new FileView(entries)
    view.expand('notes.md', 'hello')
    const open = view.totals()
    view.collapse('notes.md')
    expect(view.totals().shown).toBeLessThan(open.shown)
    expect(view.render()).not.toContain('hello')
  })

  test('a path that is not in the workspace is refused by name', () => {
    expect(new FileView(entries).expand('nope.md', 'x')).toBe(false)
  })

  test('totals count every file and only the expanded bodies', () => {
    const totals = new FileView(entries).totals()
    expect(totals.files).toBe(3)
    expect(totals.tokens).toBe(2200)
    expect(totals.expanded).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test ./test/core/context/FileView.test.js`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `FileView`**

Create `src/core/context/FileView.js`. It holds state and reaches nothing, so `test/architecture/layers.test.js` stays green:

```js
/**
 * What the model is currently shown of its own files, for the length of one run.
 *
 * This is instance context and not history: it is rendered fresh on every pass
 * and never appended to a transcript, so a file expanded on step 2 and
 * collapsed on step 5 costs nothing on step 6. The engine holds one of these
 * per run and throws it away with the run.
 *
 * It holds no port. Bodies are handed IN by the tool that read them, because a
 * class in `core/` that fetched its own files would be storage in a layer the
 * architecture test forbids it in.
 */

/** Roughly four characters to a token, the same estimator the prompt uses. */
const tokensIn = (text) => Math.ceil(String(text).length / 4)

export class FileView {
  /** @param {Array<{path: string, bytes: number, tokens: number}>} entries */
  constructor(entries = []) {
    this.entries = [...entries].sort((a, b) => a.path.localeCompare(b.path))
    /** @type {Map<string, string>} path -> body, only while expanded. */
    this.open = new Map()
  }

  has(path) {
    return this.entries.some((entry) => entry.path === path)
  }

  /** @returns {boolean} false when there is no such file, which the tool reports. */
  expand(path, body) {
    if (!this.has(path)) return false
    this.open.set(path, String(body ?? ''))
    return true
  }

  collapse(path) {
    return this.open.delete(path)
  }

  totals() {
    const tokens = this.entries.reduce((sum, entry) => sum + entry.tokens, 0)
    const shown = [...this.open.values()].reduce((sum, body) => sum + tokensIn(body), 0)
    return { files: this.entries.length, tokens, expanded: this.open.size, shown }
  }

  /**
   * The `# YOUR FILES` body: a tree, a per-file cost, and a state.
   *
   * A tree rather than the flat name list this replaces, because a name list
   * cannot say where a file sits, and the one question anybody asks about a
   * workspace is what is next to what.
   */
  render() {
    if (!this.entries.length) return ''
    const { files, tokens, expanded } = this.totals()
    const lines = [`${files} files, ${tokens} tokens, ${expanded} expanded`, '']

    let shownFolder = ''
    for (const entry of this.entries) {
      const cut = entry.path.lastIndexOf('/')
      const folder = cut < 0 ? '' : entry.path.slice(0, cut)
      const name = cut < 0 ? entry.path : entry.path.slice(cut + 1)
      if (folder !== shownFolder) {
        // Every level of a new folder, so a reader sees the nesting rather than
        // a path fragment appearing from nowhere.
        const parts = folder ? folder.split('/') : []
        for (const [depth, part] of parts.entries()) {
          lines.push(`${'  '.repeat(depth + 1)}${part}/`)
        }
        shownFolder = folder
      }
      const depth = folder ? folder.split('/').length + 1 : 1
      const state = this.open.has(entry.path) ? 'EXPANDED' : 'collapsed'
      lines.push(`${'  '.repeat(depth)}${name}  ${entry.tokens} tokens  ${state}`)
      if (this.open.has(entry.path)) {
        for (const line of this.open.get(entry.path).split('\n')) {
          lines.push(`${'  '.repeat(depth + 1)}${line}`)
        }
      }
    }
    return lines.join('\n')
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test ./test/core/context/FileView.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing tool test**

Create `test/core/tools/FileViewTools.test.js`:

```js
import { describe, expect, test } from 'bun:test'
import { FileView } from '../../../src/core/context/FileView.js'
import { CollapseFileTool, ExpandFileTool } from '../../../src/core/tools/FileViewTools.js'
import { Outcome } from '../../../src/core/Outcome.js'

const port = {
  read: async (path) =>
    path === 'notes.md' ? Outcome.ok({ path, text: 'hello', bytes: 5 }) : Outcome.ok(null),
  write: async () => Outcome.ok({}),
}

describe('the two tools that change what the model sees', () => {
  test('expanding reads the file and reports the new totals', async () => {
    const view = new FileView([{ path: 'notes.md', bytes: 5, tokens: 2 }])
    const got = await new ExpandFileTool({ files: port, view }).call({ path: 'notes.md' })

    expect(got.ok).toBe(true)
    expect(got.value).toContain('notes.md is now expanded')
    expect(view.render()).toContain('hello')
  })

  test('a file that is not there is an observation, not a failure', async () => {
    const view = new FileView([{ path: 'notes.md', bytes: 5, tokens: 2 }])
    const got = await new ExpandFileTool({ files: port, view }).call({ path: 'gone.md' })

    expect(got.ok).toBe(true)
    expect(got.value).toContain('there is no file')
  })

  test('collapsing a file that was never open says so rather than pretending', async () => {
    const view = new FileView([{ path: 'notes.md', bytes: 5, tokens: 2 }])
    const got = await new CollapseFileTool({ view }).call({ path: 'notes.md' })
    expect(got.value).toContain('was not expanded')
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `bun test ./test/core/tools/FileViewTools.test.js`
Expected: FAIL, the module does not exist.

- [ ] **Step 7: Write the tools**

Create `src/core/tools/FileViewTools.js`:

```js
import { Outcome } from '../Outcome.js'
import { filesOr } from './FilesPort.js'
import { Tool } from './Tool.js'

/**
 * The two calls that change what the model is shown of its own workspace.
 *
 * `src/core/tools/index.js` argues against a `list_files` tool on the grounds
 * that the names are a FACT and a fact belongs in the prompt. That argument is
 * intact and these do not break it: the names are still in every prompt. What
 * these change is how much of a named file is there, which is a capability, and
 * no prompt can contain every body at once.
 */

const totalsLine = (view) => {
  const { files, tokens, expanded, shown } = view.totals()
  return `${files} files, ${tokens} tokens listed, ${expanded} expanded costing ${shown} tokens`
}

export class ExpandFileTool extends Tool {
  constructor({ files, view } = {}) {
    super({
      name: 'expand_file',
      description:
        "Show a file's contents in the file list from now on, so you can read it without spending a turn.",
      parameters: {
        path: { type: 'string', description: 'the path exactly as it appears in the list' },
      },
    })
    this.files = filesOr(files)
    this.view = view
  }

  async call({ path } = {}) {
    if (!this.view) {
      return Outcome.ok('this build shows no file list, so there is nothing to expand')
    }
    const read = await this.files.read(String(path ?? ''))
    if (!read.ok) return Outcome.ok(`could not read ${path}: ${read.failure.message}`)
    if (!read.value) return Outcome.ok(`there is no file called ${path}`)
    if (!this.view.expand(read.value.path, read.value.text)) {
      return Outcome.ok(`there is no file called ${path} in the list`)
    }
    return Outcome.ok(`${read.value.path} is now expanded — ${totalsLine(this.view)}`)
  }
}

export class CollapseFileTool extends Tool {
  constructor({ view } = {}) {
    super({
      name: 'collapse_file',
      description:
        "Stop showing a file's contents, freeing the tokens it costs. Use it when you are done with a file.",
      parameters: {
        path: { type: 'string', description: 'the path exactly as it appears in the list' },
      },
    })
    this.view = view
  }

  async call({ path } = {}) {
    if (!this.view) {
      return Outcome.ok('this build shows no file list, so there is nothing to collapse')
    }
    const was = this.view.collapse(String(path ?? ''))
    return Outcome.ok(
      was
        ? `${path} is collapsed again — ${totalsLine(this.view)}`
        : `${path} was not expanded, so nothing changed — ${totalsLine(this.view)}`,
    )
  }
}
```

Register both in `src/core/tools/index.js`'s `BUILTIN_TOOLS`, taking `view` from the services bag:

```js
  expand_file: ({ files, view } = {}) => new ExpandFileTool({ files, view }),
  collapse_file: ({ view } = {}) => new CollapseFileTool({ view }),
```

- [ ] **Step 8: Run it and watch it pass**

Run: `bun test ./test/core/tools/FileViewTools.test.js`
Expected: PASS.

- [ ] **Step 9: Add `tree` to the port and its one implementation**

In `src/core/tools/FilesPort.js`, add the line to the contract comment:

```
 *     port.tree()              -> Outcome<Array<{path, bytes, tokens}>>  sorted
```

and add `tree: unavailable` to `NO_FILES`. Leave `filesOr` checking `read` and `write` only: a build whose store cannot list still reads and writes, and the view is simply empty.

In `src/backend/files/Workspace.js`, add beside `list()`:

```js
  /**
   * Every file with what it costs to show, for the prompt's file block.
   *
   * The token figure is this tree's estimator over the BYTE count rather than
   * over the text, so listing a workspace never reads every file in it.
   */
  async tree() {
    const listed = await this.list()
    if (!listed.ok) return listed
    return Outcome.ok(
      listed.value.map((entry) => ({
        path: entry.path,
        bytes: entry.bytes ?? 0,
        tokens: Math.ceil((entry.bytes ?? 0) / 4),
      })),
    )
  }
```

- [ ] **Step 10: Add the `files` prompt block**

In `src/core/engine/Engine.js`, accept `fileView = null` in the constructor, assign it, and add this block between `scratchpad` and `context` in `blocks()`:

```js
      // Volatile because a tool changes it mid-run: an expanded file is bytes
      // that were not in the last prompt. It sits after the two APPEND blocks
      // so the conversation stays inside the reusable prefix, and before
      // `context` because the clock should be nearest the end of the volatile
      // run.
      new PromptBlock({
        id: 'files',
        heading: 'YOUR FILES',
        body: this.fileView?.render() ?? '',
        volatility: Volatility.VOLATILE,
      }),
```

Add `'files'` to `DEFAULT_ORDER` in `src/core/prompt/PromptTemplate.js`, between `'scratchpad'` and `'context'`, with its line in the order comment.

- [ ] **Step 11: Write the failing budget test**

Append to `test/core/engine/Budget.test.js`:

```js
test('the block tells the model what the prompt costs and what its files cost', () => {
  const budget = new Budget({ steps: 12 })
  budget.describe({ total: 6100, blocks: [{ id: 'files', tokens: 3400 }] })
  budget.open(6100)

  const said = budget.render()
  expect(said).toContain('6,100 tokens')
  expect(said).toContain('3,400')
  expect(said).toContain('1 of 12')
})

test('the hand-over sentence still stands alone on the last turn', () => {
  const budget = new Budget({ steps: 1 })
  budget.close()
  expect(budget.render()).toContain('THIS IS YOUR LAST TURN')
})
```

- [ ] **Step 12: Run it and watch it fail**

Run: `bun test ./test/core/engine/Budget.test.js`
Expected: FAIL with `budget.describe is not a function`.

- [ ] **Step 13: Give `Budget` the counted lines back**

In `src/core/engine/Budget.js`, add `this._described = null` to the constructor, then:

```js
  /**
   * What this prompt costs, so the block can say it.
   *
   * THE FIRST VERSION OF THIS FILE RENDERED THREE COUNTED LINES AND THEY WERE
   * MEASURED OUT. That measurement stands, and the reason it no longer decides
   * this is written here rather than deleted: the two arms were identical
   * because nothing in the prompt gave the model anything to DO about a number.
   * There is now — `expand_file` and `collapse_file` are two calls that change
   * the figure this reports, and the file block prices each file separately. A
   * number beside a lever is an instruction; a number alone was arithmetic, and
   * arithmetic is what was deleted.
   *
   * If a measurement of THIS pairing shows no difference either, the lines go
   * again, and this comment is the record of why they were tried twice.
   */
  describe(assembled) {
    this._described = assembled ?? null
  }
```

and rewrite `render()`:

```js
  render() {
    const lines = []
    if (this._described) {
      const files = this._described.blocks?.find((block) => block.id === 'files')
      const filePart = files?.tokens ? `; your files are ${count(files.tokens)} of it` : ''
      lines.push(`prompt: ${count(this._described.total)} tokens${filePart}`)
      lines.push(`steps: ${count(this.steps)} of ${count(this.limits.steps)}`)
    }
    if (this._closing) {
      lines.push(
        `THIS IS YOUR LAST TURN. ${this._closing} is spent, so no tool call you write now will be run — writing one ends the run with no answer at all. Set act to answer and reply with what you have: say what you found, and say plainly what you did not get to.`,
      )
    }
    return lines.join('\n')
  }
```

- [ ] **Step 14: Call it at the one moment that knows the cost, and mind the ordering**

The trap: `render()` is called during `plan()`, and `open()` runs after `plan()` returns. So a naive `describe` call placed after `open` describes an assembly the model has already been sent, and prints a step count for a pass that has not been counted.

Resolve it by describing the PREVIOUS assembly, which is the one the model is reading. In `src/core/engine/Engine.js`'s `step`, the two calls go in this order, both after `plan`:

```js
    const assembled = this.plan(history, scratchpad, budget)
    const prompt = assembled.text
    budget?.open(assembled.total)
    // For the NEXT assembly to render. This one has already been built, so a
    // figure written now would be read one pass later — which is correct: the
    // model reads what the last pass cost, and a prompt cannot state its own
    // finished length while it is being assembled.
    budget?.describe(assembled)
```

- [ ] **Step 15: Run the budget tests and watch them pass**

Run: `bun test ./test/core/engine/Budget.test.js`
Expected: PASS, with `steps: 1 of 12` after one `open`. If it reads `0 of 12`, `describe` is on the wrong side of `open`.

- [ ] **Step 16: Build the view per turn in ChatService**

In `src/backend/services/ChatService.js`, in `_context`, delete the `context.push(['your files', …])` line and its `MAX_LISTED` cap — the block replaces it. Before the `buildAgent({` call:

```js
    // One per turn, thrown away with the turn. A view that outlived a turn
    // would carry a file the user has since deleted into the next prompt.
    const listed = await this.services.files?.tree?.()
    const fileView = listed?.ok ? new FileView(listed.value) : null
```

Pass `fileView` into `buildAgent`, which forwards it to `createEngine` as `fileView`, and add it to the `services` bag as `view` so the two tools receive it.

- [ ] **Step 17: Run the gate**

Run: `bun run check`
Expected: PASS. `test/backend/ChatService.test.js` may assert on the old flat file line; if it does, update that assertion to the block, because the behaviour deliberately changed.

- [ ] **Step 18: Update ARCHITECTURE.md**

Correct the section describing files reaching the prompt as a name list, and add the `files` block to the prompt order. Say plainly that the model can now change its own view, and that soul, instructions, skills, tools and contract are not addressable.

- [ ] **Step 19: Commit**

```bash
git add src/core/context src/core/tools/FileViewTools.js src/core/tools/FilesPort.js src/core/tools/index.js src/core/engine src/core/prompt/PromptTemplate.js src/backend/files/Workspace.js src/backend/services/ChatService.js test/core/context test/core/tools/FileViewTools.test.js test/core/engine/Budget.test.js ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
A workspace the model can open and shut, and the number that makes it worth doing

The agent's files reached the prompt as forty space-separated names inside the
volatile context block. They are a tree now, priced per file, with two tools
that expand and collapse one.

The budget block regains its counted lines with them. Those lines were measured
out of this file once and the measurement stands: they bought nothing because
nothing in the prompt let the model act on a number. There are two calls now
that change it, so the number is an instruction rather than arithmetic. If a
measurement of the pairing shows nothing either, they go again.

Soul, instructions, tools and the contract carry no path and no tool accepts
them, so nothing the model does can collapse away its own identity.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
EOF
)"
```

---

## Task 5: The agent can ask

Eight event names cross from worker to page and none is a question. This adds the ninth, and the first page-to-worker verb that is not a cancel.

**Files:**
- Create: `src/core/tools/AskTool.js`
- Modify: `src/protocol/Envelope.js` (`EventName.ASK`, `REPLY`)
- Modify: `src/backend/Kernel.js` (pending asks, the `REPLY` route)
- Modify: `src/backend/services/ChatService.js` (bind the asker)
- Modify: `src/core/tools/index.js` (register `ask`)
- Modify: `src/core/engine/Budget.js` (`pause`, `resume`)
- Modify: `src/core/engine/ReActEngine.js` (hand the run's budget to the toolbox)
- Modify: `src/client/BackendClient.js` (`reply`)
- Modify: `src/app/page.jsx`, `src/app/Composer.jsx`, `src/app/globals.css`
- Modify: `agents/main/agent.md`, `scripts/smoke.js`
- Test: `test/core/tools/AskTool.test.js`, `test/backend/Kernel.test.js`, `test/core/engine/Budget.test.js`

**Interfaces:**
- Consumes: Task 4's services-bag pattern.
- Produces: `EventName.ASK` with `{ askId, question, options }`; `REPLY = 'calls.reply'` taking `{ askId, answer }`; `Kernel.ask(question, options, emit, callId): Promise<string>`; `Budget.pause()` / `resume()`; `AskTool({ ask, getBudget })`.

- [ ] **Step 1: Write the failing clock test**

Append to `test/core/engine/Budget.test.js`:

```js
test('a run parked on a question does not spend its seconds', () => {
  let clock = 0
  const budget = new Budget({ seconds: 10, now: () => clock })
  clock = 1000
  budget.pause()
  clock = 60_000
  budget.resume()

  // One second passed before the pause; the minute spent waiting for a person
  // is not the run's.
  expect(budget.seconds).toBe(1)
  expect(budget.exhausted).toBe('')
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test ./test/core/engine/Budget.test.js`
Expected: FAIL with `budget.pause is not a function`.

- [ ] **Step 3: Implement the pause**

In `src/core/engine/Budget.js`, add `this._parkedAt = 0` to the constructor and:

```js
  /**
   * Stop the clock while a person is being waited on.
   *
   * Only seconds. Steps and tokens are not paused because they were not spent:
   * a question costs one tool call and no model call, and nothing accrues while
   * nobody is computing. Time is the one currency that runs on its own, and a
   * run ending because someone took two minutes to answer a question the agent
   * asked would be the app punishing its own escalation.
   */
  pause() {
    if (!this._parkedAt) this._parkedAt = this._now()
  }

  resume() {
    if (!this._parkedAt) return
    this._startedAt += this._now() - this._parkedAt
    this._parkedAt = 0
  }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test ./test/core/engine/Budget.test.js`
Expected: PASS.

- [ ] **Step 5: Add the protocol names**

In `src/protocol/Envelope.js`, add to `EventName`:

```js
  // A question the agent is waiting on an answer to. The one event here that is
  // not advisory: the run is parked until the page sends `REPLY` with the same
  // id, so a page that ignores this leaves a run waiting until it is cancelled.
  // Every other event can be dropped with nothing lost.
  ASK: 'ask',
```

and beside `CANCEL`:

```js
/**
 * The human's answer to a question the agent asked.
 *
 * A protocol constant for the reason `CANCEL` is one: no service owns it. It is
 * the only page-to-worker verb besides a cancel, and like a cancel it names
 * something already running — an `askId` from an `ASK` event — rather than
 * starting anything.
 */
export const REPLY = 'calls.reply'
```

- [ ] **Step 6: Write the failing Kernel test**

Append to `test/backend/Kernel.test.js`, importing `REPLY` beside the existing envelope imports:

```js
test('a question parks until the page answers it', async () => {
  const kernel = new Kernel()
  const said = []
  const emit = (name, data) => said.push([name, data])

  const answer = kernel.ask('Which database?', ['postgres', 'sqlite'], emit, 'r1')
  expect(said[0][0]).toBe('ask')

  await kernel.handle(new Request('r2', REPLY, { askId: said[0][1].askId, answer: 'sqlite' }))
  expect(await answer).toBe('sqlite')
})

test('a question nobody answers is settled by cancelling the call it belongs to', async () => {
  const kernel = new Kernel()
  const answer = kernel.ask('Which?', [], () => {}, 'r1')
  kernel.cancel({ id: 'r1' })
  expect(await answer).toBe('')
})
```

- [ ] **Step 7: Run it and watch it fail**

Run: `bun test ./test/backend/Kernel.test.js`
Expected: FAIL with `kernel.ask is not a function`.

- [ ] **Step 8: Implement asking in the Kernel**

In `src/backend/Kernel.js`, add a third private field:

```js
  /** @type {Map<string, {settle: Function, callId: string}>} askId -> the parked run. */
  #asked = new Map()
```

Register the route in the constructor beside `CANCEL`:

```js
    this.#routes.set(REPLY, (params) => this.reply(params))
```

Add the two methods:

```js
  /**
   * Put a question to the person and wait for it.
   *
   * The pending promise lives here for the reason the abort controllers do:
   * this is the only object that knows what is running, and an answer arrives
   * on a DIFFERENT request from the one that is waiting. A tool cannot hold it,
   * because the tool is inside the call that is parked.
   *
   * @returns {Promise<string>} the answer, or '' when the call was cancelled.
   */
  ask(question, options = [], emit = null, callId = '') {
    const askId = `a${this.#asked.size + 1}-${callId}`
    const { promise, resolve } = Promise.withResolvers()
    this.#asked.set(askId, { settle: resolve, callId })
    emit?.(EventName.ASK, { askId, question, options })
    return promise
  }

  /** The page's answer. An unknown id is ordinary: a stale tab may answer twice. */
  reply({ askId, answer } = {}) {
    const waiting = this.#asked.get(String(askId ?? ''))
    if (!waiting) return Outcome.ok(false)
    this.#asked.delete(String(askId))
    waiting.settle(String(answer ?? ''))
    return Outcome.ok(true)
  }
```

In `cancel`, before the return, settle every question belonging to that call, so a cancelled run never leaves a promise nobody will settle:

```js
    for (const [askId, waiting] of this.#asked) {
      if (waiting.callId !== String(id ?? '')) continue
      this.#asked.delete(askId)
      waiting.settle('')
    }
```

Import `EventName` and `REPLY` at the top of the file.

- [ ] **Step 9: Run it and watch it pass**

Run: `bun test ./test/backend/Kernel.test.js`
Expected: PASS.

- [ ] **Step 10: Write the failing tool test**

Create `test/core/tools/AskTool.test.js`:

```js
import { describe, expect, test } from 'bun:test'
import { AskTool } from '../../../src/core/tools/AskTool.js'

describe('the tool that asks the person', () => {
  test('hands the question over and returns what came back', async () => {
    const asked = []
    const tool = new AskTool({
      ask: async (question, options) => {
        asked.push([question, options])
        return 'sqlite'
      },
    })
    const got = await tool.call({ question: 'Which database?', options: 'postgres, sqlite' })

    expect(asked[0][0]).toBe('Which database?')
    expect(asked[0][1]).toEqual(['postgres', 'sqlite'])
    expect(got.value).toContain('sqlite')
  })

  test('an empty answer means nobody answered, and says so', async () => {
    const got = await new AskTool({ ask: async () => '' }).call({ question: 'Which?' })
    expect(got.value).toContain('did not answer')
  })

  test('a build with nowhere to ask says so instead of hanging', async () => {
    const got = await new AskTool({}).call({ question: 'Which?' })
    expect(got.value).toContain('no one to ask')
  })

  test("the run's clock stops while the question is out", async () => {
    const seen = []
    const budget = { pause: () => seen.push('pause'), resume: () => seen.push('resume') }
    await new AskTool({ ask: async () => 'yes', getBudget: () => budget }).call({
      question: 'Which?',
    })
    expect(seen).toEqual(['pause', 'resume'])
  })
})
```

- [ ] **Step 11: Run it and watch it fail**

Run: `bun test ./test/core/tools/AskTool.test.js`
Expected: FAIL, the module does not exist.

- [ ] **Step 12: Write the tool**

Create `src/core/tools/AskTool.js`:

```js
import { Outcome } from '../Outcome.js'
import { Tool } from './Tool.js'

/**
 * The one tool whose answer comes from a person rather than from a machine.
 *
 * It is a tool and not an engine hook because the agent is the party that knows
 * when it is stuck, and because a tool call is already something the loop parks
 * on: no engine change is needed for the run to wait here.
 *
 * The alternative considered and not chosen was a consent gate — the engine
 * asking before each risky tool. That makes the app the party deciding what is
 * worth interrupting a person for, from a list somebody has to maintain, and it
 * fires on calls the agent is certain about.
 *
 * `getBudget` is a callback and not a budget, because the run's `Budget` is
 * built inside `ReActEngine.run` and does not exist when this tool is
 * constructed.
 */
export class AskTool extends Tool {
  /**
   * @param {{ask?: (question: string, options: string[]) => Promise<string>,
   *   getBudget?: () => {pause: Function, resume: Function} | null}} options
   */
  constructor({ ask, getBudget = null } = {}) {
    super({
      name: 'ask',
      description:
        'Ask the person a question and wait for their answer. Use it when a choice is theirs to make and guessing wrong would waste the run — not for anything you could find out yourself.',
      parameters: {
        question: { type: 'string', description: 'the question, in one sentence' },
        options: {
          type: 'string',
          description: 'the choices, comma separated, or leave it out for an open question',
          required: false,
        },
      },
      // Asking twice is a different question wearing the same words, exactly as
      // `check_task` polls a different moment. The repeat guard must not answer
      // a second question with "the result would be identical".
      repeatable: true,
    })
    this.ask = ask
    this.getBudget = getBudget
  }

  async call({ question, options } = {}) {
    const text = String(question ?? '').trim()
    if (!text) {
      return Outcome.ok('write the question itself, like ask({"question": "which one?"})')
    }
    if (typeof this.ask !== 'function') {
      return Outcome.ok(
        'there is no one to ask in this build — decide it yourself and say which you chose',
      )
    }

    const choices = String(options ?? '')
      .split(',')
      .map((one) => one.trim())
      .filter(Boolean)

    // The clock stops. A person taking two minutes must not end a run, and
    // seconds is the one currency that accrues while nothing is computing.
    const budget = this.getBudget?.() ?? null
    budget?.pause()
    const answer = await this.ask(text, choices)
    budget?.resume()

    return Outcome.ok(
      answer
        ? `they answered: ${answer}`
        : 'they did not answer — decide it yourself, say which you chose, and carry on',
    )
  }
}
```

Register it in `src/core/tools/index.js`: `ask: ({ ask, getBudget } = {}) => new AskTool({ ask, getBudget }),` and export the class from that file's export block.

- [ ] **Step 13: Run it and watch it pass**

Run: `bun test ./test/core/tools/AskTool.test.js`
Expected: PASS.

- [ ] **Step 14: Give the tool a way to reach the run's budget**

In `src/core/engine/ReActEngine.js`, directly after `const budget = new Budget(declared)` in `run`, publish it on the engine so the callback can find it:

```js
    // The tool that parks the run needs the run's clock, and the clock is built
    // here rather than in the constructor because a budget is per run. Held on
    // the engine, so `AskTool`'s `getBudget` callback resolves it at call time
    // instead of at build time, when it does not exist.
    this.budget = budget
```

In `src/backend/services/ChatService.js`, add to the `services` object handed to `buildAgent`:

```js
      // Bound to this call's id, so cancelling the turn settles the question.
      ask: emit ? (question, options) => this.kernel.ask(question, options, emit, id) : null,
      getBudget: () => agentRef.engine?.budget ?? null,
```

`agentRef` is a small holder assigned after `buildAgent` returns, because the services bag is built before the engine exists. Declare `const agentRef = {}` above the call and set `agentRef.engine = agent.value` after it.

`ChatService` needs the kernel: pass it in `src/backend/composition.js` the same way `catalogue` and `pool` already are, and assign it in the constructor.

- [ ] **Step 15: Add the page half**

In `src/client/BackendClient.js`, beside `stop`, importing `REPLY`:

```js
  /**
   * Answer a question the agent asked. Fire and forget, like `stop`: the run
   * that was waiting continues on its own request and reports there.
   */
  reply(askId, answer) {
    if (askId) this.call(REPLY, { askId, answer })
  }
```

In `src/app/page.jsx`, add `const [asked, setAsked] = useState(null)` beside the other run state, clear it where `setRun` is reset at the top of `ask()`, and handle the event beside the other names:

```js
        if (name === EventName.ASK) {
          setAsked(data)
          return
        }
```

Pass it to the composer:

```jsx
          asked={asked}
          onAnswer={(answer) => {
            clientRef.current?.reply(asked.askId, answer)
            setAsked(null)
          }}
```

In `src/app/Composer.jsx`, take `asked` and `onAnswer` in the props, and render the question above the `composerbox` div:

```jsx
      {asked ? (
        <div className="asked" data-testid="ask">
          <p>{asked.question}</p>
          {asked.options?.length ? (
            <div className="askoptions">
              {asked.options.map((one) => (
                <button type="button" key={one} onClick={() => onAnswer(one)}>
                  {one}
                </button>
              ))}
            </div>
          ) : null}
          {/* The way out of a question the person does not want to answer.
              An empty answer is what the tool reports as "they did not answer",
              which the agent is told to carry on from. */}
          <button type="button" className="skip" onClick={() => onAnswer('')}>
            Skip
          </button>
        </div>
      ) : null}
```

Change `canSend` to `ready && !busy && !blocked && !asked && (draft.trim() || attachments.length)`, and in both `submit` and `onKeyDown`, when `asked` is set, call `onAnswer(draft)` and clear the draft instead of `onSend()`, so a typed answer goes to the question rather than starting a second turn.

Add `.asked`, `.askoptions` and `.skip` to `src/app/globals.css`, following the existing `.dock` and `.chip` rules.

- [ ] **Step 16: Assert the event actually arrives**

In `scripts/smoke.js`, add a case driving a scripted model that writes `ask({"question": "which one?"})`, then assert the page received an `ask` event and that clicking an option lets the run finish. Follow the file's existing scripted-model pattern. Watch the recorded trap: a backtick inside a smoke template-literal body ends the string, so escape any you write.

- [ ] **Step 17: Give the main agent the tool**

In `agents/main/agent.md`, add `ask` to the `tools:` list and one sentence to the body saying when to use it: a choice that is the person's to make, never a fact the agent could find out.

- [ ] **Step 18: Run the gate**

Run: `bun run check`
Expected: PASS, including the new smoke case.

- [ ] **Step 19: Update ARCHITECTURE.md**

Add `ASK` to the event list and `REPLY` to the protocol's owned method names. Say that this is the first event that is not advisory: a page that ignores it leaves a run parked.

- [ ] **Step 20: Commit**

```bash
git add src/protocol/Envelope.js src/backend/Kernel.js src/backend/composition.js src/backend/services/ChatService.js src/core/tools/AskTool.js src/core/tools/index.js src/core/engine src/client/BackendClient.js src/app agents/main/agent.md scripts/smoke.js test ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Eight events that could only tell you things, and the ninth that asks

The user could watch a run and stop it. The agent could never ask. ASK is the
one event here that is not advisory — the run is parked inside the tool call
until REPLY arrives with the same id, and REPLY is the first page-to-worker
verb besides a cancel.

The seconds clock stops while a person is thinking, because a run ending
because someone took two minutes to answer would be the app punishing its own
escalation. Cancelling a turn settles every question it was waiting on, so no
promise is left for nobody to settle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
EOF
)"
```

---

## Task 6: Skills

**Files:**
- Create: `skills/writing-a-plan/skill.md`, `src/core/agent/SkillCatalogue.js`, `src/core/response/OnboardResponse.js`
- Modify: `scripts/agents.js` (a second pass over `skills/`)
- Modify: `src/core/engine/Engine.js` (the `skills` block)
- Modify: `src/core/prompt/PromptTemplate.js` (`DEFAULT_ORDER`)
- Modify: `src/core/response/index.js` (register `onboard`)
- Test: `test/core/agent/SkillCatalogue.test.js`, `test/core/response/OnboardResponse.test.js`

**Interfaces:**
- Consumes: Task 3's `BaseResponse.FORMAT`, Task 1's catalogue fetch pattern.
- Produces: `SkillCatalogue.index(): Promise<Outcome<Array<{name, description}>>>`, `SkillCatalogue.body(name): Promise<Outcome<string>>`, `SkillCatalogue.renderIndex(skills): string`, `OnboardResponse` with `goal, quest, skills, tools, conversational` and a getter `isConversational`, and `Engine`'s `skills` block.

- [ ] **Step 1: Write the one real skill**

Create `skills/writing-a-plan/skill.md`. A skill is a procedure and a quality bar, not a persona:

```markdown
---
name: writing-a-plan
description: Turning a goal into ordered steps someone else could follow, when the work has more than one part and the order matters.
---

# Writing a plan

Work out what "done" looks like before you write a single step. If you cannot
say how you would know the task is finished, the plan is not ready.

Then write the steps in the order they must happen, one action each. A step
that contains the word "and" is usually two steps.

## The bar

- Every step names what it changes, not what it considers.
- A step someone could skip without noticing is not a step.
- The last step is a check: how you will know the work is right.
```

- [ ] **Step 2: Write the failing catalogue test**

Create `test/core/agent/SkillCatalogue.test.js`:

```js
import { describe, expect, test } from 'bun:test'
import { SkillCatalogue } from '../../../src/core/agent/SkillCatalogue.js'

const catalogueServing = (bodies) => {
  const catalogue = new SkillCatalogue('')
  catalogue._fetchText = async (url) =>
    url in bodies
      ? { ok: true, value: bodies[url], notes: [] }
      : { ok: false, value: null, notes: [], failure: { message: 'HTTP 404' } }
  return catalogue
}

const index = JSON.stringify({
  skills: [{ name: 'writing-a-plan', description: 'Turning a goal into ordered steps.' }],
})

describe('the skills a run can load', () => {
  test('the index is names and descriptions only', async () => {
    const got = await catalogueServing({ 'skills/index.json': index }).index()
    expect(got.value).toEqual([
      { name: 'writing-a-plan', description: 'Turning a goal into ordered steps.' },
    ])
  })

  test('a build with no skills folder has no skills, not an error', async () => {
    const got = await catalogueServing({}).index()
    expect(got.ok).toBe(true)
    expect(got.value).toEqual([])
  })

  test('a body is fetched by name and the frontmatter is stripped', async () => {
    const catalogue = catalogueServing({
      'skills/index.json': index,
      'skills/writing-a-plan/skill.md':
        '---\nname: writing-a-plan\n---\n\n# Writing a plan\n\nWork it out.',
    })
    const got = await catalogue.body('writing-a-plan')

    expect(got.value).toContain('# Writing a plan')
    expect(got.value).not.toContain('---')
  })

  test('a skill that does not exist costs a note, not the run', async () => {
    const got = await catalogueServing({ 'skills/index.json': index }).body('nope')
    expect(got.ok).toBe(true)
    expect(got.value).toBe('')
    expect(got.notes.join(' ')).toContain('nope')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test ./test/core/agent/SkillCatalogue.test.js`
Expected: FAIL, the module does not exist.

- [ ] **Step 4: Write `SkillCatalogue`**

Create `src/core/agent/SkillCatalogue.js`, following `AgentCatalogue`'s shape exactly — same `_fetchText`, same caching, same "absent is ordinary" rule. Use `parseAgentFile` to strip the frontmatter, because a skill file's header is the same YAML subset an agent file's is and a second parser would be a second thing to keep in step:

```js
import { Outcome, Reason } from '../Outcome.js'
import { parseAgentFile } from './AgentFile.js'

/**
 * The procedures a run may load into its own prompt.
 *
 * The same shape as `AgentCatalogue` and for the same reason: a directory
 * cannot be listed over HTTP, so the build writes `index.json` beside the
 * folders. What differs is what is fetched WHEN — every agent file is read at
 * startup because the roster is small and fixed, while a skill BODY is read
 * only once a run has said it wants it. That is the whole economy here: the
 * index costs a line per skill in one prompt, and a body costs its length only
 * in the run that asked for it.
 */
export const SKILLS_PATH = 'skills'

export class SkillCatalogue {
  constructor(baseUrl = '') {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '')
    this._index = null
    this._bodies = new Map()
  }

  _url(...parts) {
    return [this.baseUrl, SKILLS_PATH, ...parts].filter(Boolean).join('/')
  }

  async _fetchText(url, what) {
    const got = await Outcome.attempt(async () => {
      const response = await fetch(url, { cache: 'no-cache' })
      if (!response.ok) return Promise.reject(new Error(`HTTP ${response.status}`))
      return response.text()
    })
    return got.ok
      ? got
      : Outcome.failed(Reason.UNAVAILABLE, `could not read ${what}: ${got.failure.message}`, {
          hint: `Expected it at ${url}.`,
        })
  }

  /** @returns {Promise<Outcome>} value is `[{name, description}]`, possibly empty */
  async index() {
    if (this._index) return Outcome.ok(this._index)
    const read = await this._fetchText(this._url('index.json'), 'the skill index')
    if (!read.ok) {
      // A build with no skills folder is a build with no skills. Not a failure:
      // every agent in this app worked without one until this wave.
      this._index = []
      return Outcome.ok([])
    }
    const parsed = await Outcome.attempt(() => JSON.parse(read.value))
    const skills = Array.isArray(parsed.value?.skills) ? parsed.value.skills : []
    this._index = skills.filter((skill) => skill?.name)
    return Outcome.ok(this._index)
  }

  /** @returns {Promise<Outcome>} value is the body without frontmatter, '' when absent */
  async body(name) {
    if (this._bodies.has(name)) return Outcome.ok(this._bodies.get(name))
    const read = await this._fetchText(this._url(name, 'skill.md'), `skill ${JSON.stringify(name)}`)
    if (!read.ok) {
      return Outcome.ok('', [`there is no skill called ${JSON.stringify(name)}; it was skipped`])
    }
    const { body } = parseAgentFile(read.value, `skills/${name}/skill.md`)
    this._bodies.set(name, body.trim())
    return Outcome.ok(this._bodies.get(name))
  }

  /** The index as the onboard phase reads it: one line each, and nothing else. */
  static renderIndex(skills = []) {
    if (!skills.length) return ''
    return skills.map((skill) => `- ${skill.name}: ${skill.description ?? ''}`).join('\n')
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `bun test ./test/core/agent/SkillCatalogue.test.js`
Expected: PASS.

- [ ] **Step 6: Add the build pass**

In `scripts/agents.js`, after the soul copy from Task 1, add a second pass. It mirrors the agent pass, and the description comes off the frontmatter because a skill declares one:

```js
const SKILLS_SOURCE = join(ROOT, 'skills')
const SKILLS_TARGET = join(ROOT, 'public/skills')

await rm(SKILLS_TARGET, { recursive: true, force: true })
await mkdir(SKILLS_TARGET, { recursive: true })

const skills = []
// A tree with no `skills/` folder must not fail the build, so the scan is
// guarded the way the soul copy is.
if (await Bun.file(join(SKILLS_SOURCE, '.')).exists().catch(() => false)) {
  for await (const relative of new Bun.Glob('*/**').scan({ cwd: SKILLS_SOURCE, onlyFiles: true })) {
    const text = await Bun.file(join(SKILLS_SOURCE, relative)).text()
    await Bun.write(join(SKILLS_TARGET, relative), text)
    if (!relative.endsWith('/skill.md')) continue
    // Read with a regular expression rather than the YAML subset parser,
    // because that parser lives in `src/` and this script has no business
    // importing the app to copy files. A description spanning lines gets its
    // first line, which is all the index shows.
    const described = /^description:\s*(.+)$/m.exec(text.slice(0, text.indexOf('\n---', 3)))
    skills.push({ name: dirname(relative), description: described?.[1]?.trim() ?? '' })
  }
}

skills.sort((a, b) => a.name.localeCompare(b.name))
await Bun.write(join(SKILLS_TARGET, 'index.json'), `${JSON.stringify({ skills }, null, 2)}\n`)
console.log(
  `skills -> public/skills/ : ${skills.length ? skills.map((one) => one.name).join(', ') : '(none)'}`,
)
```

If `Bun.file(...).exists()` on a directory does not behave in the installed Bun version, use `node:fs/promises`'s `stat` in a try/catch instead — the scan must simply not run when the folder is absent.

- [ ] **Step 7: Add the skills prompt block**

In `src/core/engine/Engine.js`, accept `skills = ''` in the constructor, assign it, and add the block between `instructions` and `tools` in `blocks()`:

```js
      // The procedures this run chose, loaded once by the onboard phase and
      // fixed for the rest of the run. STATIC and inside the cacheable prefix
      // for exactly that reason: it does not change again after phase one.
      new PromptBlock({
        id: 'skills',
        heading: 'SKILLS',
        body: this.skills,
        volatility: Volatility.STATIC,
      }),
```

Add `'skills'` to `DEFAULT_ORDER` between `'instructions'` and `'tools'`, with its line in the order comment.

- [ ] **Step 8: Write the failing contract test**

Create `test/core/response/OnboardResponse.test.js`:

```js
import { describe, expect, test } from 'bun:test'
import { OnboardResponse } from '../../../src/core/response/OnboardResponse.js'

describe('what the first call is asked for', () => {
  test('reads a full reply into its five fields', () => {
    const got = OnboardResponse.parse(
      [
        'goal: Ship the parser',
        '',
        'quest: A parser that reads TOON and JSON, with tests',
        '',
        'skills: [writing-a-plan]',
        '',
        'tools: [read_file, write_file]',
        '',
        'conversational: no',
      ].join('\n'),
    )

    expect(got.goal).toBe('Ship the parser')
    expect(got.skills).toEqual(['writing-a-plan'])
    expect(got.isConversational).toBe(false)
  })

  test('a greeting is marked conversational so the run stops after one call', () => {
    expect(OnboardResponse.parse('goal: say hello back\n\nconversational: yes').isConversational)
      .toBe(true)
  })

  test('anything but yes is not conversational, so ambiguity does the work', () => {
    expect(OnboardResponse.parse('conversational: maybe').isConversational).toBe(false)
  })
})
```

- [ ] **Step 9: Run it and watch it fail**

Run: `bun test ./test/core/response/OnboardResponse.test.js`
Expected: FAIL, the module does not exist.

- [ ] **Step 10: Write the contract**

Create `src/core/response/OnboardResponse.js`:

```js
import { BaseResponse } from './BaseResponse.js'

/**
 * The first call of a strategy run, and the only one with no tools.
 *
 * It does three things in one exchange because all three are the same act of
 * reading the request: saying what the person actually wants, choosing the
 * procedures worth loading, and naming the tools the work needs. Splitting them
 * would be three prompts carrying the same question.
 *
 * `conversational` is the early exit. A greeting must not pay for a plan, an
 * act and a critique, and the model is the only party that can tell a greeting
 * from a task at this point — the phase list cannot.
 */
export class OnboardResponse extends BaseResponse {
  static FIELDS = {
    goal: {
      description: 'What the person actually wants, in one sentence, in your own words.',
    },
    quest: {
      description:
        'What would have to be true for this to be done — the test you would apply to your own answer.',
    },
    skills: {
      list: true,
      description:
        'The names of skills from the list above that would genuinely help — `[a, b]`, or `[]` when none would.',
    },
    tools: {
      list: true,
      description:
        'The tools this work needs, from the list above — `[a, b]`, or `[]` when the answer needs none.',
    },
    conversational: {
      example: 'no',
      description:
        "Exactly 'yes' when this is a greeting or a question you can answer right now with no work, otherwise 'no'.",
    },
  }

  /** Anything but a plain yes is work. Ambiguity does the work rather than skipping it. */
  get isConversational() {
    return String(this.conversational ?? '')
      .trim()
      .toLowerCase() === 'yes'
  }
}
```

Register it in `src/core/response/index.js` as `onboard: OnboardResponse`.

- [ ] **Step 11: Run it and watch it pass**

Run: `bun test ./test/core/response/OnboardResponse.test.js`
Expected: PASS.

- [ ] **Step 12: Run the gate**

Run: `bun run check`
Expected: PASS. Confirm `public/skills/index.json` exists after the build and lists one skill.

- [ ] **Step 13: Commit**

```bash
git add skills src/core/agent/SkillCatalogue.js src/core/response/OnboardResponse.js src/core/response/index.js src/core/engine/Engine.js src/core/prompt/PromptTemplate.js scripts/agents.js test/core/agent/SkillCatalogue.test.js test/core/response/OnboardResponse.test.js
git commit -m "$(cat <<'EOF'
A folder of procedures, and a first call that decides which of them to read

A skill is a procedure and a quality bar in a markdown file, laid out like an
agent because the build already knows how to publish that shape. The index
costs one line per skill in one prompt; a body costs its length only in the run
that asked for it.

The onboard contract does three things in one exchange because all three are
the same act of reading the request. Its conversational field is the early exit:
a greeting must not pay for a plan, an act and a critique.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
EOF
)"
```

---

## Task 7: The strategy engine

**Files:**
- Create: `src/core/engine/StrategyEngine.js`, `src/core/engine/phases/{index,onboard,plan,act,critique}.js`, `src/core/response/PlanResponse.js`, `src/core/response/CritiqueResponse.js`
- Modify: `src/core/engine/index.js`, `Budget.js`, `src/core/tools/Toolbox.js`, `src/core/agent/AgentSpec.js`, `loadAgent.js`, `src/protocol/Envelope.js`, `src/backend/services/ChatService.js`, `src/app/page.jsx`, `RunPanel.jsx`, `PromptPanel.jsx`, `scripts/smoke.js`
- Test: `test/core/engine/StrategyEngine.test.js`, `test/core/engine/phases.test.js`, `test/core/engine/Budget.test.js`, `test/core/tools/Toolbox.test.js`

**Interfaces:**
- Consumes: Task 2 (`Engine.observe`), Task 3 (`FORMAT`), Task 6 (`OnboardResponse`, `SkillCatalogue`).
- Produces: `StrategyEngine` with `LABEL = 'strategy'`; `PHASES` and `DEFAULT_PHASES`; `Toolbox.only(names): Toolbox`; `Budget.share(cap): Budget`; `EventName.PHASE` carrying `{ name, index, total }`.

- [ ] **Step 1: Write the failing toolbox test**

Append to `test/core/tools/Toolbox.test.js`:

```js
describe('a phase getting a smaller toolkit', () => {
  const box = new Toolbox([
    { name: 'search', render: () => '- search()' },
    { name: 'shell', render: () => '- shell()' },
  ])

  test('names a subset and keeps the same tool objects', () => {
    const small = box.only(['search'])
    expect(small.names).toEqual(['search'])
    expect(small.tools.get('search')).toBe(box.tools.get('search'))
  })

  test('a star means everything, so a phase need not list the whole toolbox', () => {
    expect(box.only(['*']).names).toEqual(['search', 'shell'])
  })

  test('a name the agent does not have is simply absent, not an error', () => {
    expect(box.only(['search', 'nope']).names).toEqual(['search'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test ./test/core/tools/Toolbox.test.js`
Expected: FAIL with `box.only is not a function`.

- [ ] **Step 3: Implement `only`**

In `src/core/tools/Toolbox.js`, add after the `names` getter:

```js
  /**
   * The same toolbox with fewer tools in it.
   *
   * A phase gets a small toolkit this way rather than by building a second
   * toolbox, so the tool OBJECTS are shared: a sub-agent tool carries a worker
   * and a port, and constructing a second one per phase would be a second
   * worker per phase.
   *
   * A name that is not here is left out silently. The phase that asked is code
   * in this repo rather than a file a user wrote, so a typo is caught by the
   * tests rather than by a note in somebody's run.
   */
  only(names = []) {
    if (names.includes('*')) return new Toolbox([...this.tools.values()])
    return new Toolbox(names.map((name) => this.tools.get(name)).filter(Boolean))
  }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test ./test/core/tools/Toolbox.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing share test**

Append to `test/core/engine/Budget.test.js`:

```js
test('a phase can only claim what the run has left', () => {
  const run = new Budget({ steps: 10 })
  run.open(100)
  run.open(100)
  expect(run.share({ steps: 100 }).limits.steps).toBe(8)
})

test("a phase's spending is the run's spending", () => {
  const run = new Budget({ steps: 10 })
  run.share({ steps: 4 }).open(500)

  expect(run.steps).toBe(1)
  expect(run.tokens).toBe(500)
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `bun test ./test/core/engine/Budget.test.js`
Expected: FAIL with `run.share is not a function`.

- [ ] **Step 7: Implement `share`**

Add to `src/core/engine/Budget.js`:

```js
  /**
   * A view over what is LEFT, capped at what a phase asked for.
   *
   * A phase cannot mint budget: whatever it declares, it can only claim a slice
   * of the run's own remaining allowance. Spending is forwarded to the parent
   * as it happens rather than reconciled afterwards, so a long plan phase
   * leaves less for the act phase instead of the act phase starting fresh.
   */
  share(cap = {}) {
    const shared = new Budget({
      steps: Math.min(limit(cap.steps, this.limits.steps), this.limits.steps - this.steps),
      tokens: Math.min(limit(cap.tokens, this.limits.tokens), this.limits.tokens - this.tokens),
      seconds: Math.min(limit(cap.seconds, this.limits.seconds), this.limits.seconds - this.seconds),
      now: this._now,
    })
    const opened = shared.open.bind(shared)
    shared.open = (tokens) => {
      opened(tokens)
      this.open(tokens)
    }
    const measured = shared.measure.bind(shared)
    shared.measure = (usage) => {
      measured(usage)
      this.measure(usage)
    }
    return shared
  }
```

- [ ] **Step 8: Run it and watch it pass**

Run: `bun test ./test/core/engine/Budget.test.js`
Expected: PASS.

- [ ] **Step 9: Write the two remaining contracts**

Create `src/core/response/PlanResponse.js`:

```js
import { BaseResponse } from './BaseResponse.js'

/** What the plan phase produces: ordered steps, and the thinking that got there. */
export class PlanResponse extends BaseResponse {
  static FIELDS = {
    think: {
      list: true,
      description: 'What you considered, one item each — `[a, b]`, or `[]`.',
    },
    steps: {
      list: true,
      description:
        'The steps, in the order they must happen, one action each — `[a, b]`. Never empty: if the work is one step, say that step.',
    },
  }
}
```

Create `src/core/response/CritiqueResponse.js`:

```js
import { BaseResponse } from './BaseResponse.js'

/**
 * The judgement at the end of a strategy run.
 *
 * `verdict` is an enum for the reason `ReActResponse.act` is: a field the
 * engine BRANCHES on cannot be prose. Anything that is not a plain done reads
 * as not done, so an ambiguous verdict costs another act phase rather than
 * closing a run that was not finished.
 */
export class CritiqueResponse extends BaseResponse {
  static FIELDS = {
    verdict: {
      example: 'done',
      description:
        "Exactly 'done' when the goal is met, or exactly 'not-done' when anything in the quest is still missing.",
    },
    gaps: {
      list: true,
      description: 'What is still missing, one item each — `[a, b]`, or `[]` when nothing is.',
    },
    next: {
      description:
        'When the verdict is not-done: what to do about it, addressed to whoever picks the work back up. When it is done: the answer for the person, self-contained.',
    },
  }

  get isDone() {
    return String(this.verdict ?? '')
      .trim()
      .toLowerCase() === 'done'
  }
}
```

Register both in `src/core/response/index.js` as `plan` and `critique`.

- [ ] **Step 10: Write the failing phase test**

Create `test/core/engine/phases.test.js`:

```js
import { describe, expect, test } from 'bun:test'
import { DEFAULT_PHASES, PHASES } from '../../../src/core/engine/phases/index.js'
import { Outcome } from '../../../src/core/Outcome.js'
import { CritiqueResponse } from '../../../src/core/response/CritiqueResponse.js'
import { OnboardResponse } from '../../../src/core/response/OnboardResponse.js'

describe('a phase is data and pure functions', () => {
  test('the default order is the three acts behind the first call', () => {
    expect(DEFAULT_PHASES).toEqual(['onboard', 'plan', 'act', 'critique'])
  })

  test('onboard renders the question and the skill index, and nothing else', () => {
    const said = PHASES.onboard.render({
      input: 'fix the parser',
      skillIndex: '- writing-a-plan: ordered steps',
    })

    expect(said).toContain('fix the parser')
    expect(said).toContain('writing-a-plan')
  })

  test('onboard absorbs the goal and exits on a greeting', () => {
    const carry = PHASES.onboard.absorb(
      { input: 'hello' },
      Outcome.ok(new OnboardResponse({ goal: 'greet back', conversational: 'yes' })),
    )

    expect(carry.goal).toBe('greet back')
    expect(PHASES.onboard.exits(carry)).toBe(true)
  })

  test('critique that is done sets the answer and exits', () => {
    const carry = PHASES.critique.absorb(
      { goal: 'x' },
      Outcome.ok(new CritiqueResponse({ verdict: 'done', next: 'here it is' })),
    )

    expect(carry.answer).toBe('here it is')
    expect(PHASES.critique.exits(carry)).toBe(true)
  })

  test('critique that is not done sends the run back to act', () => {
    const carry = PHASES.critique.absorb(
      { goal: 'x' },
      Outcome.ok(new CritiqueResponse({ verdict: 'not-done', gaps: ['tests'], next: 'write them' })),
    )

    expect(PHASES.critique.repeat(carry)).toBe('act')
    expect(PHASES.critique.exits(carry)).toBe(false)
  })
})
```

- [ ] **Step 11: Run it and watch it fail**

Run: `bun test ./test/core/engine/phases.test.js`
Expected: FAIL, the modules do not exist.

- [ ] **Step 12: Write the four phases**

Create `src/core/engine/phases/onboard.js`:

```js
import { OnboardResponse } from '../../response/OnboardResponse.js'

/**
 * The first call, and the only one with no tools.
 *
 * No tools on purpose: everything it decides is a reading of the request, and a
 * tool here would be the model going and finding something out before it has
 * said what it is looking for.
 */
export const onboard = Object.freeze({
  name: 'onboard',
  response: OnboardResponse,
  tools: [],
  cap: { steps: 2 },

  render(carry) {
    const lines = [carry.input]
    if (carry.skillIndex) lines.push('', '# SKILLS AVAILABLE', '', carry.skillIndex)
    return lines.join('\n')
  },

  absorb(carry, outcome) {
    const said = outcome.ok ? outcome.value : null
    if (!said || typeof said === 'string') return { ...carry, goal: carry.input }
    return {
      ...carry,
      goal: said.goal || carry.input,
      quest: said.quest ?? '',
      chosenSkills: said.skills ?? [],
      chosenTools: said.tools ?? [],
      // The answer only when this is where the run stops. A greeting's whole
      // reply is the goal restated, which is how the model wrote it.
      answer: said.isConversational ? said.goal : carry.answer,
      conversational: said.isConversational,
    }
  },

  exits(carry) {
    return Boolean(carry.conversational)
  },
})
```

Create `src/core/engine/phases/plan.js`:

```js
import { PlanResponse } from '../../response/PlanResponse.js'

/** Read and search, then write down the order the work has to happen in. */
export const plan = Object.freeze({
  name: 'plan',
  response: PlanResponse,
  tools: ['read_file', 'search', 'fetch', 'expand_file', 'collapse_file'],
  cap: { steps: 6 },

  render(carry) {
    return [
      `# GOAL\n\n${carry.goal}`,
      carry.quest ? `# DONE MEANS\n\n${carry.quest}` : '',
      'Write the steps this needs, in order. Do not do the work yet.',
    ]
      .filter(Boolean)
      .join('\n\n')
  },

  absorb(carry, outcome) {
    const said = outcome.ok ? outcome.value : null
    return { ...carry, steps: said && typeof said !== 'string' ? (said.steps ?? []) : [] }
  },

  exits() {
    return false
  },
})
```

Create `src/core/engine/phases/act.js`:

```js
import { ReActResponse } from '../../response/ReActResponse.js'

/**
 * The work. Reuses the ReAct contract rather than declaring a fourth.
 *
 * A phase that does the work IS a react loop, and the contract that loop is
 * written against already says everything this needs: think, plan, act, result.
 * A new contract here would be the same four fields under different names.
 */
export const act = Object.freeze({
  name: 'act',
  response: ReActResponse,
  tools: ['*'],
  cap: { steps: 12 },

  render(carry) {
    const steps = carry.steps?.length
      ? `# THE PLAN\n\n${carry.steps.map((step, at) => `${at + 1}. ${step}`).join('\n')}`
      : ''
    const back = carry.gaps?.length
      ? `# WHAT WAS MISSING LAST TIME\n\n${carry.gaps.map((gap) => `- ${gap}`).join('\n')}`
      : ''
    return [`# GOAL\n\n${carry.goal}`, steps, back, 'Do the work. Say what you did.']
      .filter(Boolean)
      .join('\n\n')
  },

  absorb(carry, outcome) {
    const said = outcome.ok ? outcome.value : null
    const text = said === null ? '' : typeof said === 'string' ? said : said.answer
    return { ...carry, work: text, answer: text }
  },

  exits() {
    return false
  },
})
```

Create `src/core/engine/phases/critique.js`:

```js
import { CritiqueResponse } from '../../response/CritiqueResponse.js'

/**
 * The judgement, with read-only tools.
 *
 * Read-only because a critic that can write is a second act phase: the run has
 * to be able to say the work is unfinished without quietly finishing it.
 */
export const critique = Object.freeze({
  name: 'critique',
  response: CritiqueResponse,
  tools: ['read_file', 'expand_file', 'collapse_file'],
  cap: { steps: 4 },

  render(carry) {
    return [
      `# GOAL\n\n${carry.goal}`,
      carry.quest ? `# DONE MEANS\n\n${carry.quest}` : '',
      `# WHAT WAS DONE\n\n${carry.work ?? 'nothing was recorded'}`,
      'Judge it against the goal. If anything in it is missing, say not-done and say what.',
    ]
      .filter(Boolean)
      .join('\n\n')
  },

  absorb(carry, outcome) {
    const said = outcome.ok ? outcome.value : null
    if (!said || typeof said === 'string') return { ...carry, done: true }
    return {
      ...carry,
      done: said.isDone,
      gaps: said.gaps ?? [],
      // A done verdict's `next` IS the answer. A not-done one keeps the act
      // phase's words, because the critic's note is addressed to the run rather
      // than to the person.
      answer: said.isDone ? said.next || carry.answer : carry.answer,
    }
  },

  exits(carry) {
    return carry.done === true
  },

  /** Back to the work, when it is not finished. The once-only rule is the engine's. */
  repeat(carry) {
    return carry.done ? '' : 'act'
  },
})
```

Create `src/core/engine/phases/index.js`:

```js
import { act } from './act.js'
import { critique } from './critique.js'
import { onboard } from './onboard.js'
import { plan } from './plan.js'

/** Phase name -> module, so an agent file can name its own sequence. */
export const PHASES = { onboard, plan, act, critique }

/** What a strategy agent gets when it names no phases of its own. */
export const DEFAULT_PHASES = Object.freeze(['onboard', 'plan', 'act', 'critique'])
```

- [ ] **Step 13: Run the phase tests and watch them pass**

Run: `bun test ./test/core/engine/phases.test.js`
Expected: PASS.

- [ ] **Step 14: Write the failing engine test**

Create `test/core/engine/StrategyEngine.test.js`, using the tree's existing scripted transport from `test/support/`:

```js
import { describe, expect, test } from 'bun:test'
import { StrategyEngine } from '../../../src/core/engine/StrategyEngine.js'
import { ScriptedInference } from '../../support/ScriptedInference.js'

const replies = {
  onboard: 'goal: fix it\n\nquest: it works\n\nskills: []\n\ntools: []\n\nconversational: no',
  plan: 'think: [read it]\n\nsteps: [read the file, fix the line]',
  act: 'think: []\n\nplan: []\n\nact: answer\n\nresult: fixed the line',
  critique: 'verdict: done\n\ngaps: []\n\nnext: fixed the line, and here is how',
}

const engineWith = (script) =>
  new StrategyEngine({ inference: new ScriptedInference(script), system: 'x' })

describe('a run made of phases', () => {
  test('runs all four in order and answers with the critic’s words', async () => {
    const got = await engineWith([
      replies.onboard,
      replies.plan,
      replies.act,
      replies.critique,
    ]).run([{ role: 'user', text: 'fix it' }])

    expect(got.ok).toBe(true)
    expect(String(got.value)).toContain('here is how')
  })

  test('a greeting stops after the first call', async () => {
    const got = await engineWith([
      'goal: hello back\n\nquest: \n\nskills: []\n\ntools: []\n\nconversational: yes',
    ]).run([{ role: 'user', text: 'hi' }])

    expect(got.ok).toBe(true)
    expect(String(got.value)).toContain('hello back')
  })

  test('announces every phase it opens', async () => {
    const seen = []
    await engineWith([replies.onboard, replies.plan, replies.act, replies.critique]).run(
      [{ role: 'user', text: 'fix it' }],
      { onPhase: (event) => seen.push(event.name) },
    )

    expect(seen).toEqual(['onboard', 'plan', 'act', 'critique'])
  })

  test('a not-done verdict sends it back to act exactly once', async () => {
    const notDone = 'verdict: not-done\n\ngaps: [no tests]\n\nnext: write tests'
    const seen = []
    await engineWith([
      replies.onboard,
      replies.plan,
      replies.act,
      notDone,
      replies.act,
      notDone,
    ]).run([{ role: 'user', text: 'fix it' }], { onPhase: (event) => seen.push(event.name) })

    // act twice, critique twice, and then it stops rather than looping.
    expect(seen).toEqual(['onboard', 'plan', 'act', 'critique', 'act', 'critique'])
  })
})
```

If `ScriptedInference`'s constructor takes something other than an array of replies, read `test/support/ScriptedInference.js` and match it; do not change that file.

- [ ] **Step 15: Run it and watch it fail**

Run: `bun test ./test/core/engine/StrategyEngine.test.js`
Expected: FAIL, the module does not exist.

- [ ] **Step 16: Write `StrategyEngine`**

Create `src/core/engine/StrategyEngine.js`:

```js
import { Outcome } from '../Outcome.js'
import { Budget } from './Budget.js'
import { Engine } from './Engine.js'
import { DEFAULT_PHASES, PHASES } from './phases/index.js'
import { ReActEngine } from './ReActEngine.js'

/**
 * A run made of phases, each of which is an ordinary ReAct run.
 *
 * The alternative was a phase field on the loop, with the contract and the
 * toolkit swapped per iteration. This shape was chosen because it leaves
 * `ReActEngine` knowing nothing about phases: a phase is data plus pure
 * functions, and the loop it drives is the loop a plain agent uses. The cost is
 * one nested engine per phase, which holds no transport of its own.
 *
 * A strategy turn is at least four model calls where a react turn is one. Two
 * things bound that and both are here: `onboard` exits on a greeting, and every
 * phase claims a capped SLICE of the run's budget rather than a fresh one.
 */
export class StrategyEngine extends Engine {
  static LABEL = 'strategy'
  static DEFAULT_RESPONSE = null

  constructor({ phases = DEFAULT_PHASES, skillIndex = '', ...settings } = {}) {
    super(settings)
    this.phaseNames = [...phases]
    this.skillIndex = skillIndex
  }

  get phases() {
    return this.phaseNames.map((name) => PHASES[name]).filter(Boolean)
  }

  /**
   * @param {Array<{role: string, text: string}>} history
   * @param {{budget?: object, signal?: AbortSignal, onPhase?: Function}} [options]
   * @returns {Promise<Outcome>} value is the answer text
   */
  async run(history, { budget: declared, signal, onPhase, ...watching } = {}) {
    const pool = new Budget(declared)
    const phases = this.phases
    const notes = []
    let carry = {
      input: history.at(-1)?.text ?? '',
      answer: '',
      repeats: 0,
      skillIndex: this.skillIndex,
    }

    for (let index = 0; index < phases.length; index++) {
      if (signal?.aborted) break
      const phase = phases[index]
      onPhase?.({ name: phase.name, index, total: phases.length })

      // A fresh engine per phase, carrying this engine's inference, identity,
      // skills and file view — everything except the contract and the toolkit,
      // which are the phase's.
      const sub = new ReActEngine({
        name: `${this.name}:${phase.name}`,
        soul: this.soul,
        system: this.system,
        skills: this.skills,
        inference: this.inference,
        responseModel: phase.response,
        toolbox: this.toolbox?.only(phase.tools) ?? null,
        fileView: this.fileView,
        context: this.context,
        template: this.template,
      })

      const outcome = await sub.run([{ role: 'user', text: phase.render(carry) }], {
        ...watching,
        budget: pool.share(phase.cap),
        signal,
      })
      notes.push(...outcome.notes.map((note) => `${phase.name}: ${note}`))
      carry = phase.absorb(carry, outcome)

      if (phase.exits(carry)) break

      // A phase may hand the run backwards exactly once. `repeats` lives on the
      // carry so the rule is enforced here rather than inside a phase, where
      // four copies of it would drift.
      const back = phase.repeat?.(carry)
      if (back && carry.repeats < 1 && !pool.exhausted) {
        const to = phases.findIndex((one) => one.name === back)
        if (to >= 0) {
          carry = { ...carry, repeats: carry.repeats + 1 }
          index = to - 1
        }
      }
    }

    return Outcome.ok(carry.answer, notes)
  }
}
```

Register it in `src/core/engine/index.js`: import it, add `[StrategyEngine.LABEL]: StrategyEngine` to `ENGINES`, and add it to the re-export line.

- [ ] **Step 17: Run it and watch it pass**

Run: `bun test ./test/core/engine/StrategyEngine.test.js`
Expected: PASS. If the repeat test hangs, `index = to - 1` is being reached without `repeats` incrementing.

- [ ] **Step 18: Let an agent file ask for it**

In `src/core/agent/AgentSpec.js`, add `phases: DEFAULT_PHASES` to the defaults and parse a `phases:` list exactly as `tools:` is parsed, dropping unknown names with a note naming each. In `src/core/agent/loadAgent.js`, pass `phases: spec.phases` and `skillIndex` through to `createEngine`.

In `src/backend/services/ChatService.js`, read the skill index once per turn from a `SkillCatalogue` built in `composition.js`, and pass `skillIndex: SkillCatalogue.renderIndex(index.value)` to `buildAgent`. Load the chosen bodies through the `onPhase` callback: when the phase that just closed is `onboard`, fetch each name in `carry.chosenSkills` and assign the joined bodies to `agent.value.skills` before the next phase renders. Expose the carry to that callback by having `StrategyEngine` pass `chosen` on the phase event it emits AFTER a phase closes — add a second call, `onPhase({ name, index, total, closed: true, chosen: carry.chosenSkills })`, directly after `carry = phase.absorb(...)`.

- [ ] **Step 19: Emit the phase across the wire**

Add to `EventName` in `src/protocol/Envelope.js`:

```js
  // Which phase of a strategy run is open. A react run emits none, which is how
  // the page tells the two apart without being told which engine ran.
  PHASE: 'phase',
```

In `ChatService`, pass `onPhase: emit ? (event) => emit(EventName.PHASE, event) : undefined` into the run options. In `src/app/page.jsx`, hold `const [phases, setPhases] = useState([])`, append on the event, clear it where the other run state is cleared, and pass it to `RunPanel`. In `RunPanel.jsx`, render a rail above the step rail, one line per phase with the open one marked. In `PromptPanel.jsx`, label each sheet with the phase that was open when the prompt arrived.

- [ ] **Step 20: Assert the phase event arrives**

Add a smoke case in `scripts/smoke.js` driving a scripted strategy agent and asserting the page saw four `phase` events in order. Same trap as Task 5: no unescaped backticks inside the template-literal body.

- [ ] **Step 21: Run the gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 22: Update ARCHITECTURE.md**

Add the strategy engine, the phase list and the `PHASE` event. State the cost honestly: at least four model calls per turn, bounded by the onboard exit and the shared budget.

- [ ] **Step 23: Commit**

```bash
git add src/core/engine src/core/response src/core/tools/Toolbox.js src/core/agent src/protocol/Envelope.js src/backend/services/ChatService.js src/backend/composition.js src/app scripts/smoke.js test ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Four phases that are each an ordinary loop, and a loop that never learned about them

A strategy run is onboard, plan, act, critique. Each is a nested ReAct run with
its own contract and its own smaller toolbox, so the loop is unchanged and a
phase is data plus four pure functions.

A turn costs at least four model calls where a react turn costs one. Two things
bound it: onboard exits on a greeting, and every phase claims a capped slice of
the run's own budget rather than a fresh allowance, so a long plan leaves less
for the work. The critic can send the run back to act exactly once, and that
rule lives in the engine rather than in four copies inside the phases.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
EOF
)"
```

---

## Task 8: The critique pass

Not a code task. A fresh-context agent reads the spec and the seven commits and reports what is claimed but not built. Its findings are worked to zero before Task 9.

**Files:**
- Create: `docs/superpowers/reviews/2026-09-03-engine-architecture-critique.md`
- Modify: whatever the findings name.

**Interfaces:**
- Consumes: everything Tasks 1 through 7 produced.
- Produces: a findings document, and one commit per accepted finding.

- [ ] **Step 1: Dispatch the critic**

Launch a fresh-context agent with no memory of this work. Give it exactly this brief:

> Read `docs/superpowers/specs/2026-09-03-engine-architecture-design.md` in full. Then read every commit since `6eca40e` with `git log --oneline 6eca40e..HEAD` and `git show` on each. For every claim the spec makes, say whether the code does it, with file:line evidence. Report three lists: claims the code does not honour, claims the code honours differently than described, and code added that the spec does not mention. Verify by reading, never by grepping for a name — a greppable name proves nothing about behaviour. Do not fix anything.

- [ ] **Step 2: Record the findings**

Write the agent's report to `docs/superpowers/reviews/2026-09-03-engine-architecture-critique.md` verbatim, then add a line under each finding saying accepted or refused, and why.

- [ ] **Step 3: Close each accepted finding**

One commit per finding, each green on `bun run check`, each with a subject naming the defect in this repo's voice.

- [ ] **Step 4: Re-run the critic**

Same brief, fresh context. Repeat until the first list is empty.

- [ ] **Step 5: Commit the review**

```bash
git add docs/superpowers/reviews
git commit -m "$(cat <<'EOF'
What a stranger found between the spec and the seven commits that claimed it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
EOF
)"
```

---

## Task 9: The primary agent on its own thread

The main agent runs inline in the single backend worker while every sub-agent gets a thread. This moves it. The cost is that the backend worker owns storage, the wasm sandbox and the MCP transports the primary still needs.

**Files:**
- Create: `src/backend/ServiceProxy.js`
- Modify: `src/backend/agentWorker.js`, `AgentWorkerPool.js`, `composition.js`, `services/ChatService.js`
- Test: `test/backend/ServiceProxy.test.js`, `test/backend/AgentWorkerPool.test.js`, `test/backend/ChatService.test.js`

**Interfaces:**
- Consumes: every `EventName` from Tasks 5 and 7.
- Produces: `serveOverPort(port, services)` and `new ServiceProxy(port)` exposing `files`, `http` and `tasks`; `AgentWorkerPool.run(name, history, settings, { emit, signal, port })` for the primary.

- [ ] **Step 1: Write the failing proxy test**

Create `test/backend/ServiceProxy.test.js`:

```js
import { describe, expect, test } from 'bun:test'
import { ServiceProxy, serveOverPort } from '../../src/backend/ServiceProxy.js'

describe('a threaded agent reaching back for storage', () => {
  test('a call crosses the port and the Outcome comes back', async () => {
    const { port1, port2 } = new MessageChannel()
    serveOverPort(port1, {
      files: { read: async (path) => ({ ok: true, value: { path, text: 'hi' }, notes: [] }) },
    })

    const got = await new ServiceProxy(port2).files.read('notes.md')

    expect(got.ok).toBe(true)
    expect(got.value.text).toBe('hi')
  })

  test('a failure crosses as a value, not as a rejection', async () => {
    const { port1, port2 } = new MessageChannel()
    serveOverPort(port1, {
      files: {
        read: async () => ({ ok: false, value: null, notes: [], failure: { message: 'no store' } }),
      },
    })

    const got = await new ServiceProxy(port2).files.read('notes.md')
    expect(got.ok).toBe(false)
  })

  test('two calls in flight settle against their own ids', async () => {
    const { port1, port2 } = new MessageChannel()
    serveOverPort(port1, {
      files: { read: async (path) => ({ ok: true, value: { path }, notes: [] }) },
    })

    const proxy = new ServiceProxy(port2)
    const [a, b] = await Promise.all([proxy.files.read('a.md'), proxy.files.read('b.md')])

    expect(a.value.path).toBe('a.md')
    expect(b.value.path).toBe('b.md')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test ./test/backend/ServiceProxy.test.js`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the proxy pair**

Create `src/backend/ServiceProxy.js`. `serveOverPort(port, services)` listens for `{id, service, method, args}` and posts back `{id, outcome}` as a plain object. `ServiceProxy(port)` builds `files`, `http` and `tasks` whose methods post and await by id, the same correlation trick `BackendClient` uses. Nothing that fails to structured-clone may cross: no `AbortSignal` goes over the port, so a cancel reaches the thread as its own message and the call it was in finishes into a scratchpad nobody reads, exactly as a cancelled tool call does today. Both sides must answer an unknown id by ignoring it rather than throwing.

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test ./test/backend/ServiceProxy.test.js`
Expected: PASS.

- [ ] **Step 5: Widen the event channel**

`agentWorker.js` posts `{id, progress}` today and the pool folds it into `DELEGATE`. Change it to post `{id, event: {name, data}}` carrying any `EventName`, and have the pool forward each to the emitter it was given. Keep the `DELEGATE` fold for sub-agents: a sub-agent's events are still summarised as delegate progress on the parent's call, and only the PRIMARY's events are forwarded verbatim. Decide which by a flag on the run request, never by inspecting the agent name.

- [ ] **Step 6: Route the primary through the pool**

In `ChatService.send`, replace the inline `buildAgent` and `agent.value.run` with a pool call handing over the settings, the history, the soul, the skill index and one end of a `MessageChannel` served by `serveOverPort`. Keep persistence, the conversation record and the notes in `ChatService`: those touch IndexedDB, and the backend worker still owns it.

- [ ] **Step 7: Run every backend test**

Run: `bun test ./test/backend`
Expected: PASS. `ChatService.test.js` will need its inline-run assertions rewritten to the pool. That is a real behaviour change and the test should follow it.

- [ ] **Step 8: Run the gate, twice**

Run: `bun run check`, then run it again.
A threaded primary introduces a real ordering between the worker boot and the first turn. A failure that appears one run in two is the signal that the port is being used before it is open.

- [ ] **Step 9: Update ARCHITECTURE.md**

Redraw the realms diagram at the top: the page, the backend worker that owns storage and the guest, and one agent thread per agent including the primary, with the service port as the arrow back.

- [ ] **Step 10: Commit**

```bash
git add src/backend test ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Every agent on its own thread, including the one that never was

Sub-agents have had threads since delegation shipped; the primary ran inline in
the backend worker, which is the realm that owns IndexedDB, the wasm guest and
the MCP transports it runs. So moving the primary needed a way back: a service
port the thread calls storage and the network through, with the backend worker
still the sole owner of both.

Every tool call from the primary crosses a port now, and two threads calling
shell still serialise because the guest is single-owner. That cost is why this
went last and why it is one commit to revert.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PsraX2zRjMhCwp1MMZAiZP
EOF
)"
```

---

## Self-review

Run against the spec after the plan was written.

**Spec coverage.** Every section maps to a task. §3.1 to Task 2; §3.2 and §3.3 to Task 7; §3.4 to Task 7's `Budget.share`; §4.1 to Task 3; §4.2 to Tasks 6 and 7; §5.1 to Tasks 1, 4 and 6; §5.2 to Task 1; §5.3 and §5.4 to Task 4; §6 to Task 6; §7 to Task 5; §8 to Task 9; §9 to the task order; §10 to the gate step ending every task.

**Two defects found and fixed inline.** The spec's §5.4 shows the budget block printing the prompt's cost, but `render()` runs inside `plan()` while `open()` runs after it, so a naive `describe` call would print a step count one behind and describe an assembly the model had already been sent. Task 4 Step 14 now names that ordering and states which assembly the model reads. Second, the spec's §3.2 sample passed `phase.budget` while §3.3 declares `cap`; the plan uses `cap` everywhere and `budget` never appears as a phase key.

**Type consistency.** `FileView.expand(path, body)` returns a boolean and `ExpandFileTool` reads it as one. `Budget.share(cap)` takes the same `{steps, tokens, seconds}` shape as the constructor. `Kernel.ask(question, options, emit, callId)` matches `AskTool`'s injected `ask(question, options)` once `ChatService` binds the last two. `AskTool` takes `getBudget` and not `budget`, because the run's budget is built inside `ReActEngine.run`. `PHASES` and `DEFAULT_PHASES` are spelled identically in the phase index, the engine and the tests.

**One thing this plan asks the implementer to decide.** Task 6 Step 6 guards the skills scan against a missing folder; the exact call depends on the installed Bun version's `Bun.file().exists()` behaviour on a directory, and the step names the fallback.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-03-engine-architecture.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks, fast iteration.
2. **Inline Execution** — tasks run in this session using executing-plans, batched with checkpoints for review.
