/**
 * OUR scaffold, lifted from the tree rather than rewritten.
 *
 * Nothing in this file is a paraphrase of our design. Every part that decides
 * what the model sees — and, since this slice, every part that decides what
 * happens next — is the real module, imported by relative path out of `src/`,
 * which bun loads unchanged because there is no transpile over `src/` and
 * because none of these modules touches a browser global — `Environment.js`
 * reads `Intl`, which exists here, and that is the whole of it.
 *
 * ── what comes from where ───────────────────────────────────────────────────
 *
 *   the agent          agents/main/agent.md, read by the real runtime reader
 *                      `src/core/agent/AgentFile.js` parseAgentFile and turned
 *                      into a spec by `AgentSpec.of` — the same two calls
 *                      `AgentCatalogue.spec` makes, including the injected
 *                      `name` from the directory.
 *   system text        AgentSpec.system, which is the file BODY ("The body IS
 *                      the system message", AgentSpec.js).
 *   the engine         `src/core/agent/loadAgent.js` buildAgent — the SAME
 *                      builder `ChatService` and `agentWorker` call. It picks
 *                      the loop from `spec.engine`, the response contract from
 *                      `spec.response` through `getResponseModel`, and the
 *                      prompt arrangement from `spec.prompt` through
 *                      `PromptTemplate.of`. This file chooses none of them.
 *   THE LOOP           `ReActEngine.run`, called once per run with the task as
 *                      the conversation and the agent file's own budget terms,
 *                      exactly as `ChatService` calls it. It assembles every
 *                      prompt, parses every reply, keeps the scratchpad,
 *                      applies the repeat rule, sends an unsaid reply and an
 *                      overrun back as turns, counts one streak for both, and
 *                      ends the run through its own endings. This file never
 *                      calls `plan`, `parse`, `observe` or `step`; the grep
 *                      that proves it is pinned in
 *                      `test/bench/oursScaffold.test.js`.
 *   prompt order       `src/core/prompt/PromptTemplate.js` DEFAULT_ORDER, via
 *                      `Engine.blocks()` inside the loop.
 *   tool rendering     `src/core/tools/Tool.js` `signature` + `render`.
 *   tool listing       `src/core/tools/Toolbox.js` `render`.
 *   call syntax+parse  `Toolbox.parse` / `_parseLine` / `runOne` / `run`,
 *                      reached by the loop through `ReActEngine.observe`.
 *   response contract  `src/core/response/ReActResponse.js` FIELDS, rendered by
 *                      `BaseResponse.instructions` and `BaseResponse.reminder`.
 *   reply parsing      `BaseResponse.parse`, inside `Engine.step` — TOON, then
 *                      JSON as a repair, then the whole reply as the answer.
 *   the budget         `src/core/engine/Budget.js`, constructed by the loop
 *                      from the agent file's own terms, opened / closed /
 *                      measured where `ReActEngine.run` and `Engine.step` do it.
 *   context facts      `src/core/agent/Environment.js` describeEnvironment(),
 *                      which is what `ChatService` passes in production.
 *   one user message   `src/core/inference/OpenAICompatible.js` sends the whole
 *                      assembled prompt as a single `user` message. Preserved:
 *                      the recording port `bench/driver.js` hands the loop
 *                      wraps the prompt the loop gives it as that one message,
 *                      because the rig's transport takes a message array so
 *                      that the reference arm can send its two. Same shape,
 *                      one hop further out; `bench/transport.js` argues that
 *                      override.
 *   the transport      `src/core/inference/OpenAICompatible.js` itself, through
 *                      `bench/transport.js`, behind the port the driver hands
 *                      in. The loop reads `Reason.OVERRUN` off its Outcome and
 *                      takes another turn, as in production.
 *   the shell tool     `src/core/tools/ShellTool.js`, the real class, holding a
 *                      real `Sandbox` port — the tree's own pattern, a
 *                      capability that needs the outside world arriving as a
 *                      port passed to a constructor. Its output clipping and its
 *                      exit-code rendering are its own.
 *
 * ── what is reimplemented, and why ─────────────────────────────────────────
 *
 * 1. NOT THE LOOP, ANY MORE. This file used to reconstruct the loop's
 *    sequencing — `engine.plan`, then the driver's call, then
 *    `responseModel.parse`, then `engine.observe`, its own scratchpad push and
 *    its own `stopped()` — on the argument that the driver owned the HTTP call
 *    and the loop "would be a second loop inside the first". It was a
 *    paraphrase, and it drifted the first time the loop changed: `ReActEngine`
 *    learned to send an overrun back as a turn and this file, which never
 *    called `run`, went on ending on it — 8 of ours' 15 runs in the third
 *    panel's set, 0 recovered, every one of the eighteen `median-bug` and
 *    `slugify-module` cells lost (`docs/LEDGER.md` row S62). The loop is now
 *    the loop. What this file adds around `run` is RECORDING, and the two
 *    things below are the whole of it.
 *
 *    a. Each pass, as an `action`. The loop reports every pass through
 *       `onStep` as the parsed response it holds — or `null` for a pass whose
 *       reply the transport refused — and `actionOf` writes that down in the
 *       rig's event shape so `blind.js` renders both arms with one grammar.
 *       It reads the response's own `isAnswer` / `isUnsaid` and copies its
 *       `toJSON`; it decides nothing.
 *
 *    b. Each observation, read back off the next prompt. The loop reports the
 *       prompt it is about to send (`onPrompt`) and the reply it got
 *       (`onStep`), and NOT what it wrote into the scratchpad between them —
 *       there is no `onObserve` in `ReActEngine.run`, and `ChatService` never
 *       needed one because the page shows steps, not observations. The
 *       scratchpad IS in the next prompt, under WORK SO FAR, and the assembly
 *       indexes it by block id (`plan.parts`), so `scratchpadAdded` takes the
 *       bytes that block gained since the last prompt and reads the
 *       observation off them. That is the text the model read, byte for byte,
 *       rather than a copy of it. Its cost is stated rather than hidden: it
 *       depends on `Engine.blocks` rendering a pair as `action: …` /
 *       `observation: …` and on the block only growing at its end, both of
 *       which the test pins against the real engine; and the observation of a
 *       turn the loop ends on — the budget's hard stop after a tool call — is
 *       never in a later prompt and so is not recorded. A hook in `src/` would
 *       delete this paragraph and is not this file's to add.
 *
 * 2. THREE OF THE FOUR TOOLS. Our tree ships `shell`, `search` and `fetch`, plus
 *    whatever an MCP server offers. It has no read_file / write_file /
 *    list_files, so those three are constructed here — but on the REAL `Tool`
 *    base class, so their signature line, their argument table and their
 *    rendering into the prompt are all the tree's code, and their `call` ends at
 *    the shared implementations in `bench/tools.js` exactly as agent-zero's do.
 *    `shell` is not reimplemented at all: it is `ShellTool` over a `Sandbox`
 *    port that runs the command through the same `bench/tools.js`.
 *
 * 3. NOTHING ELSE. Where a real module could not be used it is said here, in
 *    this list, and in `cuts` below — which is stamped into the transcript. A
 *    quiet reimplementation is the one thing that would make this comparison a
 *    lie.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAgentFile } from '../../src/core/agent/AgentFile.js'
import { AgentSpec } from '../../src/core/agent/AgentSpec.js'
import { describeEnvironment } from '../../src/core/agent/Environment.js'
import { buildAgent } from '../../src/core/agent/loadAgent.js'
import { Role } from '../../src/core/Message.js'
import { Outcome } from '../../src/core/Outcome.js'
import { Sandbox } from '../../src/core/sandbox/Sandbox.js'
import { ShellTool } from '../../src/core/tools/ShellTool.js'
import { Tool } from '../../src/core/tools/Tool.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
export const AGENT_FILE = join(REPO, 'agents', 'main', 'agent.md')
const AGENT_SOURCE = 'agents/main/agent.md'

/**
 * The rig's workspace, behind the tree's own `Sandbox` port.
 *
 * `ShellTool` holds a port and nothing else, so the class the model's calls
 * actually go through is the shipped one and only where the command runs
 * differs. In the browser that is an x86 emulator; here it is `/bin/sh` in a
 * temp directory, reached through the shared `bench/tools.js` that agent-zero's
 * `code_execution_tool` also ends at.
 */
class WorkspaceSandbox extends Sandbox {
  static LABEL = 'bench workspace'

  constructor(shared) {
    super()
    this.shared = shared
  }

  get available() {
    return true
  }

  /**
   * `bench/tools.js` returns the exit code as a FIELD, so it is forwarded.
   *
   * It used to be parsed back out of the end of the text with a regex — and
   * `clip` truncates from the end, so any failing command with more than
   * `MAX_OUTPUT` of output reached our agent as exit 0 while agent-zero read
   * the same text unchanged. The text is passed through whole, including the
   * `[exit code N]` line every scaffold reads, because a second implementation
   * of `run` is exactly what `tools.js` exists to prevent.
   */
  async run(command) {
    const result = await this.shared.run({ command })
    return Outcome.ok({ stdout: String(result.output ?? ''), code: result.code ?? 0 })
  }
}

/**
 * The three capabilities the tree does not ship, on the real `Tool` base.
 *
 * One class and a table rather than three classes: the three bodies differed
 * only in which function of `bench/tools.js` they forwarded to, which is a
 * `static` row pretending to be a hierarchy. The forward arrives as a
 * constructor argument — the same shape `ShellTool` takes its `Sandbox` in,
 * and the tree's standing pattern for a capability that needs the outside
 * world.
 */
class ForwardingTool extends Tool {
  constructor(spec, forward) {
    super(spec)
    this.forward = forward
  }

  async call(args = {}) {
    const result = await this.forward(args)
    return Outcome.ok(result.output)
  }
}

/** The runtime names both arms are told about, in the order agent-zero says them. */
const HOST_RUNTIMES = ['python3', 'node']

/**
 * Not hand-rolled. `Intl.ListFormat` is the platform's answer to joining a list
 * in English, and at three names it writes the Oxford comma that a
 * `slice(0, -1).join(', ')` spelling of the same thing drops. This file stops
 * knowing how English joins a list.
 */
const AND = new Intl.ListFormat('en', { type: 'conjunction' })

/**
 * Which of those this machine actually has, said the way the reference arm says it.
 *
 * The wording is agent-zero's own, not a paraphrase of it, so the two arms read
 * one sentence rather than two that a reader has to decide are equivalent.
 * Empty when the host has neither, in which case the sentence is dropped
 * instead of asserting something false — `.filter(Boolean)` below.
 *
 * `which` is a parameter for one reason and it is not testability in the
 * abstract: a hard-coded sentence would pass every assertion that can be made
 * on THIS machine, because this machine has both. Handing the lookup in is what
 * lets a test ask what the sentence says on a host that has neither, which is
 * the only question that separates deriving from asserting.
 *
 * MEASURED, and it is why `ourTools` and `buildRigAgent` take the lookup too
 * rather than stopping the parameter here: with the lookup ending at this
 * function, replacing the `hostRuntimes()` CALL with the literal sentence left
 * `bun test ./test` at 670 pass / 0 fail and reduced `git grep hostRuntimes`
 * over `bench/ src/ scripts/` to this file's own `export` line. A derivation
 * nothing calls is this tree's signature defect, and it was one edit away.
 */
export function hostRuntimes(which = Bun.which) {
  const found = HOST_RUNTIMES.filter((name) => which(name))
  if (!found.length) return ''
  return `${AND.format(found)} ${found.length > 1 ? 'are' : 'is'} installed and on PATH.`
}

/**
 * Our four tools.
 *
 * `description` and `parameters` are the whole of what the model is shown about
 * a tool (`Tool.render`), so the three written here are written the way the tree
 * writes them: what it is for, and what happens when it is the wrong choice.
 */
function ourTools(shared, which) {
  const forwarded = [
    [
      {
        name: 'read_file',
        description: 'Read a file from the workspace and return its whole contents.',
        parameters: {
          path: {
            type: 'string',
            required: true,
            description: 'Path to the file, relative to the workspace.',
          },
        },
      },
      shared.read_file,
    ],
    [
      {
        name: 'write_file',
        description:
          'Create a file, or replace one entirely. There is no partial edit — pass the complete contents you want the file to end up with.',
        parameters: {
          path: {
            type: 'string',
            required: true,
            description:
              'Path to the file, relative to the workspace. Parent directories are created.',
          },
          content: {
            type: 'string',
            required: true,
            description: 'The complete new contents of the file.',
          },
        },
      },
      shared.write_file,
    ],
    [
      {
        name: 'list_files',
        description: 'List what is in a directory of the workspace, with sizes.',
        parameters: {
          path: {
            type: 'string',
            required: false,
            description: 'Directory, relative to the workspace. Defaults to the workspace root.',
          },
        },
      },
      shared.list_files,
    ],
  ].map(([spec, forward]) => new ForwardingTool(spec, forward))

  // The real class, with its `description` option written for the first time.
  // `docs/LEDGER.md` row S10 has that option down as a declaration with no
  // writer anywhere in the tree, which it was at 22e64f0; this is its first.
  // What it buys is the reason it exists: the shipped sentence describes the
  // browser sandbox, whose filesystem is discarded between calls and whose
  // command line is capped, and both are false here. Leaving it would tell the
  // model its files vanish and lose every multi-step task for a reason that has
  // nothing to do with the scaffold under test.
  //
  // The runtimes are named here because the reference arm names them, and it
  // has all along: `agent-zero.js` `environmentSection` tells its model
  // "python3 and node are installed and on PATH". Our arm was told nothing,
  // which is not a difference in scaffold design — it is the rig handing one
  // side a fact about the machine and withholding it from the other. The
  // shipped `ShellTool` states the same KIND of fact about the browser guest,
  // so omitting it here also measured an arm this tree does not ship.
  //
  // DERIVED, where their side asserts. `Bun.which` is the claim itself — on
  // PATH or not — so a host without node reports a sentence that is true of it
  // rather than one copied from the machine this was written on. It costs a
  // PATH lookup once per run and nothing per turn. That agent-zero's own copy
  // of the sentence is still asserted is a row for whoever owns that file.
  //
  // The lookup arrives rather than being reached for, all the way from
  // `buildRigAgent`, so that a test can drive THIS line with a host that has
  // neither runtime and read what the prompt then says. That is the only
  // instrument that can tell this call from the literal it produces here.
  const shell = new ShellTool({
    sandbox: new WorkspaceSandbox(shared),
    description: [
      'Run a command in the workspace with /bin/sh and read its output, including the exit code.',
      hostRuntimes(which),
      'The workspace persists between calls, so a command can see what an earlier one wrote.',
      'A command that has not finished after 30 seconds is killed.',
    ]
      .filter(Boolean)
      .join(' '),
  })

  return [...forwarded, shell]
}

/**
 * Read `agents/main/agent.md` the way the running app reads it.
 *
 * `AgentCatalogue.spec` fetches the file, calls `parseAgentFile`, and builds the
 * spec with the directory's name spread in front of the frontmatter. All three
 * happen here; only the fetch is a file read instead.
 */
export function loadSpec() {
  const text = readFileSync(AGENT_FILE, 'utf8')
  const { metadata, body } = parseAgentFile(text, AGENT_SOURCE)
  return AgentSpec.of({ metadata: { name: 'main', ...metadata }, body, source: AGENT_SOURCE })
}

/**
 * Build the agent through the production builder.
 *
 * `tools` is passed, which is the one thing this differs in: given a list,
 * `buildAgent` skips `resolveTools` and attaches exactly these. `inference` is
 * the port the driver hands `run` — the shared transport, recording — and it
 * is null only for a caller that wants the engine to look at and not to run.
 *
 * `which` is the PATH lookup `hostRuntimes` uses, carried through because the
 * shell description this builds is derived from the host and nothing else here
 * can be asked what it would say on a different one. Every caller in the rig
 * leaves it out; its writer is the test that asks for a host with neither
 * runtime.
 */
export function buildRigAgent(spec, shared, { which, inference = null } = {}) {
  return buildAgent({
    spec,
    inference,
    tools: ourTools(shared, which),
    context: describeEnvironment(),
  })
}

/**
 * The scratchpad block as rendered into `plan`, and what it gained.
 *
 * `ReActEngine.run` pushes one `{action, observation}` pair per pass and
 * `Engine.blocks` renders the block `action: A\nobservation: O`, pairs joined
 * by a blank line, growing only at its end (`Volatility.APPEND`). So the block
 * in this prompt is the block in the last prompt plus one pair, and the
 * observation is what follows the pair's own `observation:` label. The block
 * is found by id in `plan.parts` rather than by searching the text, because
 * the assembly already knows where every block starts and ends.
 *
 * Read from the END of the added text, not the start: an action is a tool
 * call line, and a call's arguments may carry any string a model writes,
 * including one that looks like a label. The observation's label is the last
 * `\nobservation: ` the loop wrote, and it is the one this finds. That leaves
 * one string that could fool it — an OBSERVATION carrying `\nobservation: `,
 * in which case the recorded observation is its tail — and `bench/tools.js`
 * output is the only observation text a model does not write.
 *
 * `null` when nothing was added, which is the first prompt and no other.
 */
export function scratchpadAdded(previous, plan) {
  const part = plan.parts.find((entry) => entry.id === 'scratchpad')
  const rendered = part ? plan.text.slice(part.start, part.end) : ''
  if (!rendered.startsWith(previous)) return { rendered, observation: null }
  const added = rendered.slice(previous.length)
  const label = '\nobservation: '
  const at = added.lastIndexOf(label)
  return { rendered, observation: at < 0 ? null : added.slice(at + label.length) }
}

/**
 * One pass of the loop, in the rig's action shape.
 *
 * `parsed` is what `ReActEngine.run` hands `onStep`: the response it holds,
 * or `null` for the pass whose reply the transport refused with
 * `Reason.OVERRUN` and the loop sent back as a turn. Three of the four kinds
 * are read off the response's own fields; the fourth is the null. `parsed` is
 * copied through `toJSON` so `blind.js` can render `think` and `plan` as
 * reasoning, and the reply text is NOT copied in beside it — the `reply` event
 * at the same turn already carries it, and an action that repeated a
 * 1,200-token reply doubled every transcript for no reader.
 */
export function actionOf(parsed, refused) {
  if (parsed === null) {
    return {
      kind: 'malformed',
      reason: 'overran',
      note: refused ? `${refused.message} — ${refused.hint}` : '',
    }
  }
  if (parsed.isUnsaid) {
    return { kind: 'malformed', reason: parsed.unsaidBecause, parsed: parsed.toJSON() }
  }
  if (parsed.isAnswer) {
    return { kind: 'answer', text: String(parsed.answer ?? ''), parsed: parsed.toJSON() }
  }
  return { kind: 'tool', call: String(parsed.answer).trim(), parsed: parsed.toJSON() }
}

/** The task, as the conversation the loop is given. One user turn. */
export function taskHistory(task, tools) {
  return [
    {
      role: Role.USER,
      text: `${task.prompt}\n\nThe workspace is ${tools.workdir}. Every path is relative to it.`,
    },
  ]
}

export const scaffold = {
  id: 'ours',
  label: 'ours (ASKK ReAct engine)',
  cuts: [
    {
      where: 'agents/main/agent.md frontmatter',
      cut: 'the `tools: [shell, search, fetch]` list and the `mcp:` block',
      why: 'the rig has no network for the agent and no browser guest to start an MCP server in, so `search`, `fetch` and the mcp-disk `disk` tool would render into every prompt as capabilities that refuse. The four capabilities `bench/tools.js` provides are attached instead, under our own naming, through the same `buildAgent({tools})` seam the production builder already has. The file BODY — the actual system text — is used verbatim.',
    },
    {
      where: 'src/core/tools/ShellTool.js description',
      cut: "the shipped sentence: no network, a clean filesystem on every call, a 1024-byte command line, and the guest's own runtime list",
      why: "true of the browser sandbox, false of this rig. It is replaced through the class's own `description` option rather than by forking the class, so the tool the model calls is still `ShellTool`. The replacement now names the host's runtimes, derived with `Bun.which`, because the shipped sentence names the guest's and because `agent-zero.js` has always told its own model \"python3 and node are installed and on PATH\". Leaving that out of ours was not a scaffold difference — it was the rig telling one arm what the machine has and not the other.",
    },
    {
      where: 'src/core/response/BaseResponse.js parse',
      cut: 'nothing',
      why: 'recorded because it makes two reported columns asymmetric — but ONLY for a reply that carries none of the contract\'s fields. `parse` tries TOON, then JSON as a repair, then RETURNS THE WHOLE REPLY AS THE ANSWER, so a reply that never reaches the contract at all ends this arm\'s run as an answer while agent-zero scores it `misformat` and pays a turn. Measured today: "Sure! I think the battery is at 87%." is `{act:"answer"}` here and `{kind:"malformed", reason:"misformat"}` there. A reply that DOES reach the contract and gets it wrong is named: `act: banana` and a reply cut off before the `act` line are both `ACT_UNSAID`, echoed back with which of the two it was, and two of them in a row end the run `unreadable`. This row said "cannot produce a malformed action at all" until that landed, and stamped the sentence into every transcript recorded after it stopped being true — `docs/LEDGER.md` row S37. `turns` and `stop` must be read with the narrowed version; no misformat rate may be quoted from this rig as if the two arms scored the same replies.',
    },
    {
      where: 'agents/main/agent.md body',
      cut: 'nothing',
      why: 'recorded because it looks like a cut. The body still says the sandbox is "roughly a hundred times slower than a real machine", which is not this rig. It is left unedited: it is our real system text, and softening it would be exactly the thumb on the scale this rig exists to prevent.',
    },
  ],

  /**
   * The run IS `ReActEngine.run`. Everything else here writes down what it
   * reported.
   *
   * `budget` is the agent file's own terms, or none — in which case `Budget`
   * applies its own, which is what `ChatService` passes too. NOT the rig's
   * 12-turn cap: writing the cap in here would hand our arm a "this is your
   * last turn" sentence that agent-zero has no equivalent of, which is a
   * difference the rig invented rather than one it found. The cap reaches
   * this arm as the port refusing the thirteenth call and pulling `signal`,
   * so the loop ends the way it ends when its user presses stop.
   *
   * `ran` is left empty on every observation this arm records. The reference
   * arm's adapters name the shared function they called; this loop runs its
   * tools itself, out of the rig's sight, and a list parsed back off the call
   * line would be a guess wearing a record's shape — the observation text is
   * the record, and nothing in `bench/` reads `ran`.
   *
   * `pending` is the one piece of state the recording needs: whether the last
   * pass was one the loop writes an observation for. An answer is not — the
   * run is over — so the next prompt, if any, adds nothing. A pass that WAS,
   * followed by a prompt that added nothing readable, is recorded as exactly
   * that rather than dropped: a transcript missing a result would read as a
   * tool the loop never ran, which is the defect this tree keeps shipping.
   */
  async run({ task, tools, inference, signal, record }) {
    const spec = loadSpec()
    const built = buildRigAgent(spec.value, tools, { inference })
    let rendered = ''
    let pending = false

    const ran = await built.value.run(taskHistory(task, tools), {
      budget: spec.value.budget,
      signal,
      onPrompt: (plan) => {
        const added = scratchpadAdded(rendered, plan)
        rendered = added.rendered
        if (!pending) return
        record.observation(
          added.observation ??
            '(the rig could not read this observation back out of the next prompt)',
        )
        pending = null
      },
      onStep: ({ parsed }) => {
        const action = actionOf(parsed, inference.lastReply?.failure)
        record.action(action)
        pending = action.kind !== 'answer'
      },
    })

    if (!ran.ok) return { answer: '', ended: ran.failure.message }
    const last = ran.value
    // A stopped run comes back ok holding whatever the loop had — a tool
    // call, or nothing — and only an answer is an answer.
    if (typeof last === 'string') return { answer: last, ended: '' }
    return { answer: last?.isAnswer ? String(last.answer ?? '') : '', ended: '' }
  },
}

export default scaffold
