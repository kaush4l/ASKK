import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_FILE, buildRigAgent, loadSpec, scaffold } from '../../bench/scaffolds/ours.js'
import { makeTools } from '../../bench/tools.js'
import { describeEnvironment } from '../../src/core/agent/Environment.js'
import { buildAgent } from '../../src/core/agent/loadAgent.js'
import { Budget } from '../../src/core/engine/Budget.js'
import { ReActEngine } from '../../src/core/engine/ReActEngine.js'
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

const workdir = '/tmp/askk-bench-ours-test'
const rigTools = () => makeTools(workdir)

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

describe('the prompt sent is the prompt the engine assembles', () => {
  test('request() is engine.plan(), verbatim, as one user message', () => {
    const state = scaffold.init({ task: { prompt: 'Do a thing.' }, tools: rigTools() })
    const sent = scaffold.request(state)
    expect(sent.messages.length).toBe(1)
    // OpenAICompatible sends one `user` message carrying the whole prompt.
    expect(sent.messages[0].role).toBe('user')

    // Re-derived from the engine rather than compared to a literal: this is the
    // assertion that would go red if the scaffold started composing its own text.
    const again = state.engine.plan(state.history, state.scratchpad, state.budget)
    expect(sent.messages[0].content).toBe(again.text)
  })

  test('the tool block is Toolbox.render(), and the contract is ReActResponse’s', () => {
    const state = scaffold.init({ task: { prompt: 'Do a thing.' }, tools: rigTools() })
    const sent = scaffold.request(state).messages[0].content
    expect(sent).toContain(state.engine.toolbox.render())
    expect(sent).toContain(ReActResponse.instructions())
    expect(sent).toContain(ReActResponse.reminder())
  })

  test('the budget block is silent while there is room, exactly as in production', () => {
    // agents/main/agent.md declares no budget, so `Budget` applies its own 24
    // steps — more than the rig's 12-turn cap, so the hand-over sentence can
    // never fire here. Writing the cap into the budget instead would hand our
    // arm a last-turn instruction agent-zero has no equivalent of.
    const state = scaffold.init({ task: { prompt: 'Do a thing.' }, tools: rigTools() })
    scaffold.request(state)
    expect(state.budget.render()).toBe('')
    expect(state.budget.limits.steps).toBe(24)
  })

  test('the budget’s hard stop is behind the last word, as it is in ReActEngine.run', () => {
    // `Budget.render` writes "THIS IS YOUR LAST TURN" into the prompt and
    // `ReActEngine.run` then refuses a tool call written after it. Our arm had
    // the sentence and not the refusal, so the run would have continued past a
    // budget it had already told the model was spent.
    const state = scaffold.init({ task: { prompt: 'Do a thing.' }, tools: rigTools() })
    expect(scaffold.stopped(state)).toBe('')

    // A two-step budget, then the same two moments the loop takes: `close()`
    // inside `request` decides before the prompt is assembled, and the hook is
    // read after the turn. `limits` is frozen, so the terms are declared rather
    // than poked — which is how `ChatService` sets them too.
    state.budget = new Budget({ steps: 2 })
    scaffold.request(state)
    expect(state.budget.render()).toBe('')
    expect(scaffold.stopped(state)).toBe('')

    scaffold.request(state)
    expect(state.budget.render()).toContain('THIS IS YOUR LAST TURN')
    expect(scaffold.stopped(state)).toContain('2-step budget is spent')
  })

  test('an observation lands in WORK SO FAR and never in the conversation', () => {
    const state = scaffold.init({ task: { prompt: 'Do a thing.' }, tools: rigTools() })
    scaffold.observe(state, {
      action: { call: 'list_files({})' },
      observation: 'a-distinctive-observation',
      usage: { prompt: 10, completion: 5 },
    })
    const sent = scaffold.request(state).messages[0].content
    const work = sent.slice(sent.indexOf('# WORK SO FAR'))
    expect(work).toContain('a-distinctive-observation')
    expect(sent.slice(0, sent.indexOf('# WORK SO FAR'))).not.toContain('a-distinctive-observation')
  })
})

describe('parse and act are the tree’s, not the rig’s', () => {
  test('a TOON reply parses through ReActResponse into a tool action', () => {
    const state = scaffold.init({ task: { prompt: 'x' }, tools: rigTools() })
    const reply = 'think: [a]\n\nplan: [b]\n\nact: tool\n\nresult: list_files({})'
    const action = scaffold.parse(reply, state)
    expect(action.kind).toBe('tool')
    expect(action.call).toBe('list_files({})')
  })

  test('act answer ends the run', () => {
    const state = scaffold.init({ task: { prompt: 'x' }, tools: rigTools() })
    const action = scaffold.parse('act: answer\n\nresult: forty-two', state)
    expect(action.kind).toBe('answer')
    expect(action.text).toBe('forty-two')
  })

  test('a repeated call is answered with the engine’s own refusal, and is not re-run', async () => {
    const tools = rigTools()
    const state = scaffold.init({ task: { prompt: 'x' }, tools })
    const action = { kind: 'tool', call: 'list_files({})' }
    const first = await scaffold.act(action, state)
    const second = await scaffold.act(action, state)
    expect(first.observation).toContain('list_files ->')
    expect(second.observation).toContain('was already made 1 time(s), so it was not run again')
    // One call reached the shared implementation, not two.
    expect(tools.calls.filter((c) => c.name === 'list_files').length).toBe(1)
  })

  test('an unknown tool comes back as Toolbox’s sentence, so the rig can score a hallucinated capability', async () => {
    const state = scaffold.init({ task: { prompt: 'x' }, tools: rigTools() })
    const said = await scaffold.act({ kind: 'tool', call: 'read_battery({})' }, state)
    // `tasks.js` scans observations for this exact phrasing.
    expect(said.observation).toContain('there is no tool called read_battery')
  })

  test('the shell tool reaches the shared implementation and reports the exit code', async () => {
    const tools = rigTools()
    const state = scaffold.init({ task: { prompt: 'x' }, tools })
    const said = await scaffold.act({ kind: 'tool', call: 'shell({"command": "false"})' }, state)
    // ShellTool's own rendering: a non-zero status is appended by the class.
    expect(said.observation).toContain('(exit 1)')
    expect(tools.calls.some((c) => c.name === 'run')).toBe(true)
  })

  test('a failure survives an observation long enough to be clipped', async () => {
    // The status used to be rendered into the text by `bench/tools.js` and
    // parsed back out here with a regex, and `clip` truncates from the end — so
    // any failing command with more than MAX_OUTPUT of output reached OUR agent
    // as a success while agent-zero read the same text unchanged. Same command,
    // two arms, and the false one was ours.
    const state = scaffold.init({ task: { prompt: 'x' }, tools: rigTools() })
    const call = 'shell({"command": "head -c 6000 /dev/zero | tr \'\\\\0\' x; exit 3"})'
    const said = await scaffold.act({ kind: 'tool', call }, state)
    expect(said.observation).toContain('(exit 3)')
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
