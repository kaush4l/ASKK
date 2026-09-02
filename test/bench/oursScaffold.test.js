import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSystemPrompt } from '../../bench/scaffolds/agent-zero.js'
import {
  AGENT_FILE,
  actionOf,
  buildRigAgent,
  hostRuntimes,
  loadSpec,
  scaffold,
  scratchpadAdded,
  taskHistory,
} from '../../bench/scaffolds/ours.js'
import { makeTools } from '../../bench/tools.js'
import { describeEnvironment } from '../../src/core/agent/Environment.js'
import { buildAgent } from '../../src/core/agent/loadAgent.js'
import { Budget } from '../../src/core/engine/Budget.js'
import { ReActEngine } from '../../src/core/engine/ReActEngine.js'
import { Outcome, Reason } from '../../src/core/Outcome.js'
import { DEFAULT_ORDER } from '../../src/core/prompt/PromptTemplate.js'
import { ReActResponse } from '../../src/core/response/ReActResponse.js'
import { ShellTool } from '../../src/core/tools/ShellTool.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
/**
 * The agent file, named HERE and not imported from the file under test.
 *
 * `AGENT_FILE` is exported by `bench/scaffolds/ours.js`, so a test that read the
 * body through it would follow the scaffold to a prompt-engineered copy and stay
 * green. Their arm is pinned to sha256s in `PROVENANCE.md`; ours was pinned to a
 * path the file under test chose, and the asymmetry ran in favour of the arm
 * that stands to gain from it.
 */
const REAL_AGENT_FILE = join(REPO, 'agents', 'main', 'agent.md')
const OURS_FILE = join(REPO, 'bench', 'scaffolds', 'ours.js')

/**
 * Our arm, held to the claim that makes the comparison worth anything: that it
 * is the tree's code and not a flattering copy of it.
 *
 * Every assertion here is of the form "the thing the scaffold produced IS what
 * the real module produces", derived by calling the real module in the test
 * rather than by pinning a string this file wrote. A pinned string would go
 * green over a scaffold that had quietly forked.
 */

const rigTools = () => makeTools(mkdtempSync(join(tmpdir(), 'askk-bench-ours-')))

describe('the spec comes out of agents/main/agent.md', () => {
  test('the scaffold reads the tree’s agent file and not a copy of it', () => {
    // The path, first: every assertion below is worthless if the scaffold is
    // pointed somewhere else. Compared against a path this file builds itself.
    expect(AGENT_FILE).toBe(REAL_AGENT_FILE)
  })

  test('the system text is the file body of agents/main/agent.md, uncut', () => {
    const spec = loadSpec()
    const body = readFileSync(REAL_AGENT_FILE, 'utf8').split('\n---\n')[1].trim()
    expect(spec.value.system).toBe(body)
    // The rig cuts the frontmatter's tool list; it does not touch the body. The
    // sentence about a hundred-times-slower emulator is not true of this rig and
    // is deliberately left in — softening it is the thumb on the scale.
    expect(spec.value.system).toContain('roughly a hundred times slower')
  })

  test('the body is the shipped one byte for byte, hashed the way their arm is', () => {
    // agent-zero's prompt bytes are held to a sha256 in PROVENANCE.md. Ours are
    // held to the file the app itself loads: a sentence added, removed or
    // softened anywhere in the body changes this digest, so a helpful edit
    // cannot ride in behind a `toContain`.
    const spec = loadSpec()
    const digest = new Bun.CryptoHasher('sha256').update(spec.value.system).digest('hex')
    const shipped = readFileSync(REAL_AGENT_FILE, 'utf8').split('\n---\n')[1].trim()
    expect(digest).toBe(new Bun.CryptoHasher('sha256').update(shipped).digest('hex'))
  })

  test('the loop and the contract are the file’s, not this file’s', () => {
    const spec = loadSpec()
    expect(spec.value.engine).toBe(ReActEngine.LABEL)
    expect(spec.value.response).toBe('react')
  })
})

describe('the engine is the production builder’s', () => {
  const built = buildRigAgent(loadSpec().value, rigTools())

  test('it is BUILT BY buildAgent, and not assembled here', () => {
    // Provenance, not shape. `createEngine` is three lines, so a hand-written
    // `new ReActEngine({name, system, responseModel, toolbox, context,
    // template})` is indistinguishable from a built one by inspection — every
    // other assertion in this file passes over it. What distinguishes them is
    // whether the call happens, and this rig runs its source unmodified (no
    // transpile over `bench/` or `src/`), so the source IS what executes.
    //
    // A `mock.module` spy would be the better instrument and is not available:
    // on Bun 1.4.0, `mock.module` on this path kills the test process with no
    // output and no failure — measured, `bun test` printing the file name and
    // then exiting 0 having run nothing.
    const source = readFileSync(OURS_FILE, 'utf8')
    expect(source).toContain('return buildAgent({')
    expect(source).not.toContain('new ReActEngine(')
    expect(source).not.toContain('createEngine(')
  })

  test('what it returns is what buildAgent returns for the same inputs', () => {
    // Behavioural drift, which the source check cannot see: if `buildAgent`
    // grows a note, a default or an attached tool, a rig that had stopped
    // going through it would diverge from this re-derivation.
    const spec = loadSpec().value
    const tools = rigTools()
    const mine = buildRigAgent(spec, tools)
    const theirs = buildAgent({
      spec,
      inference: null,
      tools: mine.value.toolbox.names.map((name) => mine.value.toolbox.tools.get(name)),
      context: describeEnvironment(),
    })
    expect(mine.notes).toEqual(theirs.notes)
    expect(mine.value.name).toBe(theirs.value.name)
    expect(mine.value.system).toBe(theirs.value.system)
    expect(mine.value.responseModel).toBe(theirs.value.responseModel)
    expect(mine.value.template.order).toEqual(theirs.value.template.order)
    expect(mine.value.toolbox.render()).toBe(theirs.value.toolbox.render())
    expect(mine.value.constructor).toBe(theirs.value.constructor)
  })

  test('it is a ReActEngine carrying the ReAct contract', () => {
    expect(built.value).toBeInstanceOf(ReActEngine)
    expect(built.value.responseModel).toBe(ReActResponse)
  })

  test('the prompt arrangement is the tree’s default, not a list written here', () => {
    expect(built.value.template.order).toEqual([...DEFAULT_ORDER])
  })

  test('shell is the real ShellTool over a port, not a reimplementation', () => {
    const shell = built.value.toolbox.tools.get('shell')
    expect(shell).toBeInstanceOf(ShellTool)
    expect(shell.sandbox.available).toBe(true)
  })

  test('the four tools are the four capabilities and nothing else', () => {
    expect(built.value.toolbox.names).toEqual(['read_file', 'write_file', 'list_files', 'shell'])
  })
})

/**
 * A stand-in for the driver's recording port: replies in order, the last one
 * repeating, as the tree's own Outcomes. `maxTokens` is read by the loop to
 * name the ceiling to the model; `lastReply` is what the scaffold reads a
 * refusal's words off. Nothing here classifies — a test that wants the real
 * classifier drives `bench/driver.js` instead (`test/bench/driver.test.js`).
 */
function fakePort(replies) {
  const prompts = []
  const port = {
    maxTokens: 1200,
    lastReply: null,
    async invoke(prompt) {
      prompts.push(prompt)
      const reply = replies[Math.min(prompts.length - 1, replies.length - 1)]
      port.lastReply = { failure: reply.ok ? null : reply.failure.toJSON() }
      return reply
    },
  }
  return { port, prompts }
}

/** Run the scaffold over `replies`, collecting what it records. */
async function runWith(replies, tools = rigTools(), task = { prompt: 'Do a thing.' }) {
  const { port, prompts } = fakePort(replies)
  const actions = []
  const observations = []
  const finished = await scaffold.run({
    task,
    tools,
    inference: port,
    signal: new AbortController().signal,
    record: {
      action: (action) => actions.push(action),
      observation: (text, ran) => observations.push({ text, ran }),
    },
  })
  return { finished, prompts, actions, observations }
}

const say = (text) => Outcome.ok(text)
const TOOL = (call) => say(`think: [look]\n\nplan: [do]\n\nact: tool\n\nresult: ${call}`)
const ANSWER = (text) => say(`think: [done]\n\nplan: [say]\n\nact: answer\n\nresult: ${text}`)

/** The prompt with its clock line removed, so two assemblies a moment apart compare. */
const timeless = (text) =>
  text
    .split('\n')
    .filter((line) => !line.startsWith('now: '))
    .join('\n')

describe('the run is ReActEngine.run, and this file reaches into the engine for nothing else', () => {
  test('the grep: `.run(` and no plan, parse, observe, step or responseModel', () => {
    // The proof the brief asks for, as a test rather than a sentence. The
    // scaffold used to call `engine.plan`, `engine.responseModel.parse` and
    // `engine.observe` in its own sequence, and that sequence drifted from the
    // loop the first time the loop changed. `bench/` is run unmodified, so the
    // source is what executes.
    const source = readFileSync(OURS_FILE, 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const reaches = [...code.matchAll(/\b(?:engine|built\.value)\.(\w+)\(/g)].map((m) => m[1])
    expect(reaches).toEqual(['run'])
    for (const name of ['plan', 'parse', 'observe', 'step', 'responseModel', 'blocks']) {
      expect(code).not.toContain(`.${name}(`)
    }
  })

  test('the prompt the loop sends is the engine’s plan over the task, as one user message', async () => {
    const tools = rigTools()
    const task = { prompt: 'Do a thing.' }
    const { prompts } = await runWith([ANSWER('ok')], tools, task)
    expect(prompts.length).toBe(1)

    // Re-derived from a second engine built the same way rather than compared
    // to a literal: this is the assertion that would go red if the scaffold
    // started composing its own text or its own history line.
    const again = buildRigAgent(loadSpec().value, tools).value
    const expected = again.plan(taskHistory(task, tools), [], new Budget(loadSpec().value.budget))
    expect(timeless(prompts[0])).toBe(timeless(expected.text))
    expect(prompts[0]).toContain(again.toolbox.render())
    expect(prompts[0]).toContain(ReActResponse.instructions())
    expect(prompts[0]).toContain(ReActResponse.reminder())
  })

  test('the budget is the agent file’s, silent while there is room, exactly as in production', async () => {
    // agents/main/agent.md declares no budget, so `Budget` applies its own 24
    // steps — more than the rig's 12-turn cap, so the hand-over sentence can
    // never fire here. Writing the cap into the budget instead would hand our
    // arm a last-turn instruction agent-zero has no equivalent of. The hard
    // stop behind that sentence is the loop's own and is pinned where the loop
    // is: `test/core/engine/ReActEngine.test.js`.
    const { prompts } = await runWith([TOOL('list_files({})'), ANSWER('ok')])
    expect(prompts[0]).not.toContain('# BUDGET')
    expect(prompts[1]).not.toContain('# BUDGET')
    expect(new Budget(loadSpec().value.budget).limits.steps).toBe(24)
  })

  test('an observation lands in WORK SO FAR and never in the conversation', async () => {
    const { prompts, observations } = await runWith([TOOL('list_files({})'), ANSWER('ok')])
    const sent = prompts[1]
    const work = sent.slice(sent.indexOf('# WORK SO FAR'))
    expect(work).toContain('observation: list_files -> (the directory is empty)')
    expect(sent.slice(0, sent.indexOf('# WORK SO FAR'))).not.toContain('list_files ->')
    // And what was recorded is what was sent, byte for byte.
    expect(observations[0].text).toBe('list_files -> (the directory is empty)')
  })

  test('scratchpadAdded reads the observation off the real Engine.blocks rendering', () => {
    // Pinned against the engine and not against a string this file wrote: a
    // change to how `Engine.blocks` renders a pair, or to the block growing
    // anywhere but its end, goes red here before it goes silent in a run.
    const engine = buildRigAgent(loadSpec().value, rigTools()).value
    const history = taskHistory({ prompt: 'x' }, rigTools())
    const first = engine.plan(history, [], null)
    expect(scratchpadAdded('', first)).toEqual({ rendered: '', observation: null })

    const one = engine.plan(history, [{ action: 'a({})', observation: 'first\nresult' }], null)
    const got = scratchpadAdded('', one)
    expect(got.observation).toBe('first\nresult')

    const two = engine.plan(
      history,
      [
        { action: 'a({})', observation: 'first\nresult' },
        // A call whose argument carries the label: the LAST label wins.
        { action: 'b({"x": "\\nobservation: decoy"})', observation: 'second' },
      ],
      null,
    )
    expect(scratchpadAdded(got.rendered, two).observation).toBe('second')
    // Read from the rendered prompt, not from the pairs handed in.
    expect(one.text.slice(one.parts.find((p) => p.id === 'scratchpad').start)).toContain(
      'observation: first\nresult',
    )
  })

  test('actionOf reads the response’s own verdict and decides nothing', () => {
    expect(actionOf(ReActResponse.parse('act: answer\n\nresult: forty-two'), null)).toMatchObject({
      kind: 'answer',
      text: 'forty-two',
    })
    const tool = actionOf(
      ReActResponse.parse('think: [a]\n\nplan: [b]\n\nact: tool\n\nresult: list_files({})'),
    )
    expect(tool).toMatchObject({ kind: 'tool', call: 'list_files({})' })
    expect(tool.parsed.think).toEqual(['a'])
    const unsaid = actionOf(ReActResponse.parse('think: hi\nplan: do\nact: banana\nresult: x'))
    expect(unsaid.kind).toBe('malformed')
    expect(unsaid.reason).toContain("neither 'tool' nor 'answer'")
    const overran = actionOf(null, { message: 'ran out', hint: 'do less' })
    expect(overran).toEqual({ kind: 'malformed', reason: 'overran', note: 'ran out — do less' })
  })
})

describe('what the loop does with the tools is the tree’s, not the rig’s', () => {
  test('a repeated call is answered with the engine’s own refusal, and is not re-run', async () => {
    const tools = rigTools()
    const { observations } = await runWith(
      [TOOL('list_files({})'), TOOL('list_files({})'), ANSWER('ok')],
      tools,
    )
    expect(observations[0].text).toContain('list_files ->')
    expect(observations[1].text).toContain('was already made 1 time(s), so it was not run again')
    // One call reached the shared implementation, not two.
    expect(tools.calls.filter((c) => c.name === 'list_files').length).toBe(1)
  })

  test('an unknown tool comes back as Toolbox’s sentence, so the rig can score a hallucinated capability', async () => {
    const { observations } = await runWith([TOOL('read_battery({})'), ANSWER('ok')])
    // `tasks.js` scans observations for this exact phrasing.
    expect(observations[0].text).toContain('there is no tool called read_battery')
  })

  test('the shell tool reaches the shared implementation and reports the exit code', async () => {
    const tools = rigTools()
    const { observations } = await runWith(
      [TOOL('shell({"command": "false"})'), ANSWER('ok')],
      tools,
    )
    // ShellTool's own rendering: a non-zero status is appended by the class.
    expect(observations[0].text).toContain('(exit 1)')
    expect(tools.calls.some((c) => c.name === 'run')).toBe(true)
  })

  test('a failure survives an observation long enough to be clipped', async () => {
    // The status used to be rendered into the text by `bench/tools.js` and
    // parsed back out here with a regex, and `clip` truncates from the end — so
    // any failing command with more than MAX_OUTPUT of output reached OUR agent
    // as a success while agent-zero read the same text unchanged. Same command,
    // two arms, and the false one was ours.
    const call = 'shell({"command": "head -c 6000 /dev/zero | tr \'\\\\0\' x; exit 3"})'
    const { observations } = await runWith([TOOL(call), ANSWER('ok')])
    expect(observations[0].text).toContain('(exit 3)')
  })

  test('the loop’s own ending is returned as `ended`, in its words', async () => {
    const overrun = Outcome.failed(Reason.OVERRUN, 'the reply ran out', { hint: 'less' })
    const { finished, actions, observations } = await runWith([overrun, overrun])
    expect(finished.answer).toBe('')
    expect(finished.ended).toContain('2 replies in a row ended without saying')
    expect(actions.map((a) => a.kind)).toEqual(['malformed', 'malformed'])
    expect(actions[0].note).toBe('the reply ran out — less')
    expect(observations.length).toBe(1)
    expect(observations[0].text).toContain('1,200-token reply limit went on reasoning')
  })
})

/**
 * `docs/LEDGER.md` row S37: this scaffold's `cuts` and `bench/README.md` both
 * certified that this arm "cannot produce a malformed action at all". P1 made
 * that false, and `ours.js` stamps `cuts` into every transcript the rig records
 * — so the sentence was not merely stale documentation, it was being written
 * into new evidence.
 *
 * The close is not an edit, it is this block: the claim is re-derived from
 * `src/core/response/ReActResponse.js` on every test run, so the next change to
 * the parser takes the sentence with it.
 */
describe('what this arm does with a reply that does not say what to do', () => {
  const cutRow = () =>
    scaffold.cuts.find((entry) => entry.where === 'src/core/response/BaseResponse.js parse')

  test('a reply carrying NO contract field at all is an answer — the asymmetry is real', () => {
    const parsed = ReActResponse.parse('Sure! I think the battery is at 87%.')
    expect(parsed.act).toBe('answer')
    expect(cutRow().why).toContain(
      '"Sure! I think the battery is at 87%." is `{act:"answer"}` here',
    )
  })

  test('but a reply that reaches the contract and gets `act` wrong is NAMED, not waved through', () => {
    const parsed = ReActResponse.parse('think: hi\nplan: do\nact: banana\nresult: x')
    expect(parsed.act).toBe('unsaid')
    expect(parsed.unsaidBecause).toContain("neither 'tool' nor 'answer'")
  })

  test('and a reply cut off before the `act` line is named as the other of the two', () => {
    const parsed = ReActResponse.parse('think: hi\nplan: do')
    expect(parsed.act).toBe('unsaid')
    expect(parsed.unsaidBecause).toBe('the reply stopped before it reached the act line')
  })

  test('so the row stamped into every transcript names ACT_UNSAID and its ceiling', () => {
    // The half that can rot silently: `cuts` travels into the artifact a reader
    // judges. Mutating the row back to "cannot produce a malformed action at
    // all" fails here; mutating `ReActResponse` back to `default: ACT_ANSWER`
    // fails the two tests above.
    expect(cutRow().why).toContain('ACT_UNSAID')
    expect(cutRow().why).toContain('unreadable')
    expect(cutRow().why).toContain('S37')
  })

  test('and so does the README, which certified the same sentence', () => {
    const readme = readFileSync(join(REPO, 'bench', 'README.md'), 'utf8')
    expect(readme).toContain('`ACT_UNSAID`, echoed back with which of the two it was')
    expect(readme).toContain('S37')
  })
})

describe('both arms are told the same thing about the machine', () => {
  /**
   * The asymmetry this rig existed with, and the reason it is a test and not a
   * paragraph.
   *
   * `agent-zero.js` `environmentSection` has always told its model "python3 and
   * node are installed and on PATH". Our arm's shell description said nothing
   * about runtimes, so the rig handed one side a fact about the host and
   * withheld it from the other — measured before this test existed: our arm's
   * assembled prompt did not contain the string `python3` and theirs did.
   *
   * That is not a difference between two scaffold designs, which is what this
   * rig is for. It is a difference the rig invented, running against the arm
   * whose shipped `ShellTool` states the same kind of fact about the browser
   * guest. It belongs in a test because prose about it would sit below the
   * numbers it invalidates.
   */

  test('both prompts carry the same runtime sentence, and this host is what it says', async () => {
    const shared = rigTools()
    const ours = (await runWith([ANSWER('x')], shared, { prompt: 'x' })).prompts[0]

    // The SENTENCE, not the word. `node` occurs six times in agent-zero's own
    // prompt — the `code_execution_tool` runtime list, its `python nodejs linux
    // libraries` line and a worked example among them — and five of those six
    // are not claims about this host's PATH. Measured with a substring oracle
    // in place: rewriting `environmentSection` to say "python3 is installed and
    // on PATH", the exact asymmetry in the exact direction this test exists to
    // catch, left this file at 28 pass / 0 fail.
    //
    // It is also the only writer for what `hostRuntimes` claims about itself —
    // that its wording is agent-zero's and not a paraphrase. A reword on either
    // side now goes red here.
    const bothPresent = hostRuntimes(() => '/somewhere')
    // Their line, not their prompt: `toContain` over 12 KB of prose prints the
    // whole manual on failure, and reading the one line back is the stronger
    // claim anyway — their sentence IS ours, rather than somewhere inside.
    const theirLine = buildSystemPrompt(shared.workdir)
      .split('\n')
      .find((line) => line.includes('installed and on PATH'))
    expect(theirLine).toBe(bothPresent.replace(/\.$/, ''))

    // Their line is hard-coded, so the two arms are symmetric only on a host
    // that really has what it asserts. Asserted, not assumed: a host missing
    // one fails HERE, naming the reason, rather than in a bench result nobody
    // re-reads.
    expect(hostRuntimes()).toBe(bothPresent)
    expect(ours).toContain(bothPresent)
  })

  test('and ours derives the sentence rather than copying the machine it was written on', () => {
    // The assertion above cannot separate deriving from asserting, because this
    // machine has both runtimes and a hard-coded sentence would satisfy it.
    // These can: the lookup is a parameter, so a host that has neither can be
    // asked what it would be told.
    expect(hostRuntimes(() => null)).toBe('')
    expect(hostRuntimes((name) => (name === 'node' ? '/somewhere/node' : null))).toBe(
      'node is installed and on PATH.',
    )
    // And the default really is the PATH lookup, not a third spelling.
    expect(hostRuntimes()).toBe(hostRuntimes(Bun.which))
  })

  test('and the prompt derives it too, not just the function', () => {
    // The one that covers the CALL. `hostRuntimes` had exactly one caller and
    // no test observed it, so replacing `hostRuntimes(which)` in `ourTools`
    // with the literal sentence left the whole suite at 670 pass / 0 fail and
    // left the function exported, argued for, and called by nothing — measured.
    //
    // Driving the lookup from out here is what closes that: on a host with
    // neither runtime the rendered tool listing must name neither, which no
    // literal can do. The sentence is dropped whole rather than left as a gap,
    // so the two around it still read as one line.
    const bare = buildRigAgent(loadSpec().value, rigTools(), {
      which: () => null,
    }).value.toolbox.render()

    expect(bare).not.toMatch(/(^|\s)python3(\s|$)/)
    expect(bare).not.toMatch(/(^|\s)node(\s|$)/)
    expect(bare).toContain('including the exit code. The workspace persists between calls')
  })
})
