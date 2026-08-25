/**
 * THE WALKING SKELETON: a message becomes an answer, through every layer at
 * once. Each test executes a claim the increment made — a claim asserted and
 * not executed is prose (I16, I17).
 */
import { expect, test, describe } from 'bun:test'
import { Glob } from 'bun'
import { CAPABILITIES, ModelError, get, post, withHeader } from '@harness/kernel'
import { newAgentState, tool } from '@harness/agent'
import { fakeAgents, fakeClock, testPorts } from '@harness/adapters-test'
import { boot, bootFresh, drive, handle } from '@harness/core'
import { memorySegments, manualTimer, silentTool, watchedTool } from './doubles.js'

/** One scripted turn, read off the door it arrives through — the barrel exports `testPorts` and not the type. @typedef {NonNullable<Parameters<typeof testPorts>[0]>['script']} Scripts */
/** @typedef {import('@harness/core').Row} Row */

const SRC = new URL('../src/', import.meta.url).pathname

/**
 * One build: scripted model, a tool table, and a deadline the test fires. The
 * agent's TOOLBOX is the descriptors it may call and `tools` is what runs them
 * — both are handed in here because the spec reader has not landed.
 * @param {{script?: Scripts, tools?: Record<string, import('@harness/core').ToolRun>,
 *   agents?: Record<string, string>, auto?: boolean}} [parts]
 */
function harness(parts = {}) {
  const clock = fakeClock({ start: 1_000, step: 1 })
  const ports = testPorts({ clock, script: parts.script ?? [], agents: fakeAgents(parts.agents ?? {}) })
  const segments = memorySegments()
  const toolbox = Object.keys(parts.tools ?? {}).map((name) => tool({ name, description: `the ${name} tool` }))
  const agent = { ...newAgentState(), toolbox }
  const app = bootFresh({ ports, available: [...CAPABILITIES], segments, tools: parts.tools ?? {}, agent })
  return { app, ports, segments, clock, timer: manualTimer({ auto: parts.auto }) }
}

/** @param {import('@harness/core').App} app @param {string} [who] @returns {Row[]} */
function rows(app, who) {
  const req = who ? withHeader(get('/chat'), 'x-agent', who) : get('/chat')
  return /** @type {Row[]} */ (handle(app, req).data.messages)
}

/** Turn the event loop over until `ready` — how a test fires a deadline the driver has reached. */
async function until(/** @type {() => boolean} */ ready) {
  for (let i = 0; i < 100 && !ready(); i++) await new Promise((r) => setTimeout(r, 0))
  if (!ready()) throw new Error('the driver never reached the point this test waited for')
}

describe('a message becomes an answer', () => {
  test('user message → step → effect → port → fact → projection, and the transcript holds the reply', async () => {
    const { app, timer, ports } = harness({ script: [{ text: 'Firecrawl still answers without a key.' }] })
    const sent = handle(app, post('/chat', { message: 'Does Firecrawl need a key?' }))
    expect(sent.view).toBe('chat')
    expect(rows(app).map((r) => r.said)).toEqual(['Does Firecrawl need a key?'])

    await drive(app, { timer })
    expect(rows(app).map((r) => [r.kind, r.speaker, r.said])).toEqual([
      ['user', 'You', 'Does Firecrawl need a key?'],
      ['assistant', 'main', 'Firecrawl still answers without a key.'],
    ])
    // The port was actually reached: a projection that filled itself in
    // without a model call would pass every line above.
    expect(app.agent.turnId).toBe('')
    expect(/** @type {any} */ (ports.model).calls).toHaveLength(1)
    expect(handle(app, get('/chat')).data.waitingLabel).toBe('')
  })

  test('a turn a reload landed on says so, instead of saying "thinking" for ever', async () => {
    const { app, ports, segments } = harness()
    handle(app, post('/chat', { message: 'anyone there?' }))
    await app.log.persist()

    // A NEW PAGE LOAD over the same history: the SHAPE of the log survives and
    // the fetch behind it does not — the state that left the composer disabled
    // under a clock that could not tick.
    const reloaded = await boot({ ports, available: [...CAPABILITIES], segments })
    const projected = handle(reloaded, get('/chat')).data
    expect(String(projected.waitingLabel)).toContain('not running any more')
    expect(projected.waitingStatus).toBe('stopped')
    // …and the same log while this process IS holding the turn says the opposite.
    expect(handle(app, get('/chat')).data.waitingStatus).not.toBe('stopped')
  })
})

describe('one line of tool calls', () => {
  test('two calls in one round OVERLAP, and their results land in written order', async () => {
    /** @type {string[]} */
    const ticks = []
    const { app, timer } = harness({
      script: [{ calls: [{ tool: 'alpha', args: '{"a":1}' }, { tool: 'beta', args: '{"b":2}' }] }, { text: 'both back' }],
      // beta answers in one turn of the microtask queue and alpha in six, so
      // the order the rows land in cannot be the order they finished.
      tools: { alpha: watchedTool('alpha', ticks, 6), beta: watchedTool('beta', ticks, 1) },
    })
    handle(app, post('/chat', { message: 'run both' }))
    await drive(app, { timer })

    expect(ticks.indexOf('start beta')).toBeLessThan(ticks.indexOf('end alpha'))
    expect(ticks.indexOf('end beta')).toBeLessThan(ticks.indexOf('end alpha'))
    expect(rows(app).filter((r) => r.kind === 'tool').map((r) => r.speaker)).toEqual([
      'main ran alpha', 'main ran beta',
    ])
  })

  test('a tool that never answers is ended by its deadline, and the turn finishes', async () => {
    const { app, timer } = harness({
      script: [{ calls: [{ tool: 'wedged', args: '{}' }] }, { text: 'carried on without it' }],
      tools: { wedged: silentTool() },
    })
    handle(app, post('/chat', { message: 'call the wedged one' }))
    const running = drive(app, { timer, deadlineMs: 5_000 })
    await until(() => timer.pending() > 0)
    timer.fire()
    await running

    const said = rows(app)
    expect(said.find((r) => r.kind === 'tool')?.said).toContain('did not answer within 5 seconds')
    expect(said[said.length - 1]?.said).toBe('carried on without it')
    expect(app.agent.turnId).toBe('')
    expect(app.agent.batch).toEqual([])
  })
})

describe('a failure is a fact the loop can read', () => {
  test('a model that refuses is recorded AND ends the turn, rather than leaving it waiting', async () => {
    const { app, timer } = harness({
      auto: true,
      script: [
        { fail: new ModelError('unauthorized', 'the endpoint refused the key') },
        { fail: new ModelError('unauthorized', 'the endpoint refused the key') },
        { fail: new ModelError('unauthorized', 'the endpoint refused the key') },
      ],
    })
    handle(app, post('/chat', { message: 'ask it' }))
    await drive(app, { timer })

    const notes = rows(app).filter((r) => r.kind === 'error')
    expect(notes[0]?.said).toContain('the endpoint refused the key')
    expect(notes.some((r) => r.said.includes('failed'))).toBe(true)
    expect(app.agent.turnId).toBe('') // and not left awaiting a model that is not coming
    expect(/** @type {any} */ (app.ports.model).remaining()).toBe(0) // three attempts, bounded

  })
})

describe('two conversations on one page', () => {
  test("a second agent's turn never appears in the first agent's transcript", async () => {
    const { app, timer } = harness({
      script: [{ text: "main's own answer" }],
      agents: { scout: 'scout looked and found three results' },
    })
    handle(app, post('/chat', { message: 'main, hello' }))
    handle(app, withHeader(post('/chat', { message: 'scout, go and look' }), 'x-agent', 'scout'))
    await drive(app, { timer })

    const mine = rows(app).map((r) => r.said)
    expect(mine).toEqual(['main, hello', "main's own answer"])
    expect(rows(app, 'scout').map((r) => [r.kind, r.said])).toEqual([
      ['user', 'scout, go and look'],
      ['assistant', 'scout looked and found three results'],
    ])
  })
})

describe('what an empty folder means', () => {
  test('a folder that never held files and one a reload emptied get different sentences', async () => {
    const { app, ports, segments, clock } = harness()
    expect(String(handle(app, get('/files')).data.emptyNote)).toContain('still asking for the folder')

    app.log.append({ type: 'tool_invoked', agent: '', tool: 'write_file', args: '{"path":"notes.md"}', ok: true, output: 'written' }, clock.now())
    await app.log.persist()

    // A NEW PAGE LOAD over the same store: the write is now behind `bootedAt`,
    // and this workspace does not survive one.
    const reloaded = await boot({ ports, available: [...CAPABILITIES], segments })
    const note = String(handle(reloaded, get('/files')).data.emptyNote)
    expect(note).toContain('notes.md was written in the folder, and nothing is left of it')
    expect(note).toContain('held in memory')
    expect(reloaded.log.length).toBeGreaterThan(app.bootedAt)
  })

  test('a listing that ran and found nothing says that, and never claims a loss', async () => {
    const { app, clock } = harness()
    app.log.append({ type: 'tool_invoked', agent: '', tool: 'list_files', args: '{"path":"."}', ok: true, output: '' }, clock.now())
    expect(handle(app, get('/files')).data.emptyNote).toBe('Nothing was in the folder when this listing ran.')
  })
})

test('NO HANDLER RECEIVES THE EVENT ARRAY — nothing in core reads a log as a list', async () => {
  /** @type {string[]} */
  const reaching = []
  for await (const file of new Glob('**/*.js').scan({ cwd: SRC })) {
    const text = await Bun.file(SRC + file).text()
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    for (const re of [/\blog\.events\b/, /\bctx\.recent\b/, /\bnew EventLog\b/, /\.ofType\s*\(/, /\.since\s*\(/]) {
      if (re.test(code)) reaching.push(`${file}: ${re}`)
    }
  }
  expect(reaching).toEqual([])
})
