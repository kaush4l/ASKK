/**
 * OUR scaffold, lifted from the tree rather than rewritten.
 *
 * Nothing in this file is a paraphrase of our design. Every part that decides
 * what the model sees is the real module, imported by relative path out of
 * `src/`, which bun loads unchanged because there is no transpile over `src/`
 * and because none of these modules touches a browser global — `Environment.js`
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
 *   prompt order       `src/core/prompt/PromptTemplate.js` DEFAULT_ORDER, via
 *                      `Engine.blocks()` and `Engine.plan()`.
 *   tool rendering     `src/core/tools/Tool.js` `signature` + `render`.
 *   tool listing       `src/core/tools/Toolbox.js` `render`.
 *   call syntax+parse  `Toolbox.parse` / `_parseLine` / `runOne` / `run`.
 *   response contract  `src/core/response/ReActResponse.js` FIELDS, rendered by
 *                      `BaseResponse.instructions` and `BaseResponse.reminder`.
 *                      There is no prose block behind the field table any more —
 *                      the `formatNotes` hook an earlier draft of this file
 *                      named was deleted with its last caller, and this scaffold
 *                      sends what the tree sends today.
 *   reply parsing      `BaseResponse.parse` — TOON, then JSON as a repair, then
 *                      the whole reply as the answer. One argument: the `Format`
 *                      enum it used to take is gone.
 *   scratchpad         `ReActEngine.run` keeps actions and observations OUT of
 *                      the conversation and puts them in a `WORK SO FAR` block
 *                      (`Engine.blocks`), and answers a repeated call without
 *                      running it (`ReActEngine.observe`). Both are used here.
 *   the budget         `src/core/engine/Budget.js`, constructed from the agent
 *                      file's own terms exactly as `ChatService` does, and
 *                      opened / closed / measured at the three moments
 *                      `ReActEngine.run` and `Engine.step` do it.
 *   context facts      `src/core/agent/Environment.js` describeEnvironment(),
 *                      which is what `ChatService` passes in production.
 *   one user message   `src/core/inference/OpenAICompatible.js` sends the whole
 *                      assembled prompt as a single `user` message. That is a
 *                      real property of our scaffold and it is preserved here.
 *                      Note where the single message now comes from: the class's
 *                      own `_body` builds it in production, and `request()`
 *                      below builds it here, because the rig's transport takes a
 *                      message array so that the reference arm can send its two.
 *                      Same shape, one hop further out; `bench/transport.js`
 *                      argues that override.
 *   the transport      `src/core/inference/OpenAICompatible.js` itself, through
 *                      `bench/transport.js`. GENUINE, and it was not: the rig
 *                      carried its own fetch and its own `message.content ?? ''`
 *                      until this slice, so this arm was measured WITHOUT the
 *                      four-state classifier that is the whole of what our
 *                      transport contributes. Twelve of the thirty-four replies
 *                      in `bench/transcripts/` are replies it refuses.
 *   the shell tool     `src/core/tools/ShellTool.js`, the real class, holding a
 *                      real `Sandbox` port — the tree's own pattern, a
 *                      capability that needs the outside world arriving as a
 *                      port passed to a constructor. Its output clipping and its
 *                      exit-code rendering are its own.
 *
 * ── what is reimplemented, and why ─────────────────────────────────────────
 *
 * 1. THE LOOP BODY, and nothing else. `ReActEngine.run` owns its own
 *    `while (true)` and calls `this.inference` itself. The rig's driver owns the
 *    HTTP call, the transcript and the 12-turn cap, so the loop cannot be
 *    imported — it would be a second loop inside the first. What is
 *    reimplemented is the SEQUENCING; every decision inside it is delegated back
 *    to the real modules: the answer/tool branch reads `parsed.isAnswer`, the
 *    scratchpad entries are `{action, observation}` in the shape `Engine.blocks`
 *    reads, the repeat rule and the dispatch are the real `ReActEngine.observe`,
 *    and the budget is the real `Budget`. Note that our engine has NO turn cap
 *    of its own — the cap here is the rig's, imposed identically on both arms,
 *    and that difference is a finding rather than a fix.
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
import { Budget } from '../../src/core/engine/Budget.js'
import { Role } from '../../src/core/Message.js'
import { Outcome } from '../../src/core/Outcome.js'
import { Sandbox } from '../../src/core/sandbox/Sandbox.js'
import { ShellTool } from '../../src/core/tools/ShellTool.js'
import { Tool } from '../../src/core/tools/Tool.js'
import { Toolbox } from '../../src/core/tools/Toolbox.js'

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

/**
 * Our four tools.
 *
 * `description` and `parameters` are the whole of what the model is shown about
 * a tool (`Tool.render`), so the three written here are written the way the tree
 * writes them: what it is for, and what happens when it is the wrong choice.
 */
function ourTools(shared) {
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
  const shell = new ShellTool({
    sandbox: new WorkspaceSandbox(shared),
    description:
      'Run a command in the workspace with /bin/sh and read its output, including the exit code. The workspace persists between calls, so a command can see what an earlier one wrote. A command that has not finished after 30 seconds is killed.',
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
 * null because the driver owns the HTTP call — the engine is never `run`, only
 * `plan`ned and `observe`d.
 */
export function buildRigAgent(spec, shared) {
  return buildAgent({
    spec,
    inference: null,
    tools: ourTools(shared),
    context: describeEnvironment(),
  })
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
      cut: 'the shipped sentence: no network, a clean filesystem on every call, a 1024-byte command line',
      why: "true of the browser sandbox, false of this rig. It is replaced through the class's own `description` option rather than by forking the class, so the tool the model calls is still `ShellTool`.",
    },
    {
      where: 'src/core/response/BaseResponse.js parse',
      cut: 'nothing',
      why: 'recorded because it makes two reported columns asymmetric. `parse` tries TOON, then JSON as a repair, then RETURNS THE WHOLE REPLY AS THE ANSWER — so this arm cannot produce a malformed action at all, and a reply that agent-zero scores `misformat` and pays a turn for ends this arm\'s run as an answer. Measured: "Sure! I think the battery is at 87%." parses here as `{kind:"answer"}` and there as `{kind:"malformed", reason:"misformat"}`. `turns` and `stop` must be read with that; no misformat rate may be quoted from this rig as if both arms could earn one.',
    },
    {
      where: 'agents/main/agent.md body',
      cut: 'nothing',
      why: 'recorded because it looks like a cut. The body still says the sandbox is "roughly a hundred times slower than a real machine", which is not this rig. It is left unedited: it is our real system text, and softening it would be exactly the thumb on the scale this rig exists to prevent.',
    },
  ],

  init({ task, tools }) {
    const spec = loadSpec()
    const built = buildRigAgent(spec.value, tools)
    return {
      engine: built.value,
      notes: [...spec.notes, ...built.notes],
      workdir: tools.workdir,
      // The terms the agent file declares, or none — in which case `Budget`
      // applies its own, which is what `ChatService` passes too. Not the rig's
      // 12-turn cap: writing the cap in here would hand our arm a "this is your
      // last turn" sentence that agent-zero has no equivalent of, which is a
      // difference the rig invented rather than one it found.
      budget: new Budget(spec.value.budget),
      // Our engine keeps the conversation and the scratchpad apart on purpose.
      // Both live here in the same two shapes it uses.
      history: [
        {
          role: Role.USER,
          text: `${task.prompt}\n\nThe workspace is ${tools.workdir}. Every path is relative to it.`,
        },
      ],
      scratchpad: [],
      seen: new Map(),
    }
  },

  request(state) {
    // The three budget moments, in the order the real loop takes them:
    // `ReActEngine.run` closes before assembling, `Engine.step` opens with the
    // assembled cost, and `observe` below measures once the endpoint has said
    // what the pass really cost.
    state.budget.close()
    const assembled = state.engine.plan(state.history, state.scratchpad, state.budget)
    state.budget.open(assembled.total)
    // OpenAICompatible — one user message carrying the whole prompt.
    return { messages: [{ role: 'user', content: assembled.text }] }
  },

  parse(replyText, state) {
    const parsed = state.engine.responseModel.parse(String(replyText ?? ''))
    if (parsed.isAnswer) {
      return {
        kind: 'answer',
        text: parsed.answer,
        raw: String(replyText ?? ''),
        parsed: parsed.toJSON(),
      }
    }
    return {
      kind: 'tool',
      call: String(parsed.answer).trim(),
      raw: String(replyText ?? ''),
      parsed: parsed.toJSON(),
    }
  },

  async act(action, state) {
    const call = action.call ?? ''
    const times = (state.seen.get(call) ?? 0) + 1
    state.seen.set(call, times)
    // The real repeat rule and the real dispatch, both from
    // `ReActEngine.observe` / `Toolbox.run` — reached through the engine so the
    // text the model reads is the tree's text.
    const observation = await state.engine.observe({ answer: call }, times)
    const ran = Toolbox.parse(call)
      .flat()
      .map((c) => ({ name: c.name, args: c.argText }))
    return { observation, ran }
  },

  observe(state, { action, observation, usage }) {
    state.budget.measure(usage)
    state.scratchpad.push({ action: action.call ?? '', observation })
  },

  /**
   * The hard stop behind the last word, which `ReActEngine.run` checks at the
   * top of every iteration.
   *
   * `Budget.render` writes "THIS IS YOUR LAST TURN" into the prompt when the
   * next step would exhaust the run; the engine then refuses to run a tool
   * call written after that sentence, so a run cannot end with a severed rope
   * dressed as an answer. Omitting it here left our arm reading the sentence
   * with nothing behind it. It is reachable: `agents/main/agent.md` declares no
   * budget, so `Budget` applies its own 600 seconds, and a run on this endpoint
   * spends 30 to 60 of them per task.
   *
   * The driver calls this after a turn's observation, which is the same
   * position — `ReActEngine` reads the `closing` its PREVIOUS `close()` set.
   */
  stopped(state) {
    return state.budget.closing
      ? `${state.budget.closing} is spent and the last turn wrote a tool call instead of an answer`
      : ''
  },
}

export default scaffold
