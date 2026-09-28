import { describe, expect, test } from 'bun:test'
import { stages } from '../src/core/calls.js'
import { Engine } from '../src/core/engine.js'
import { agentPaths, localToolFiles, ownedPaths, readSpec } from '../src/core/folder.js'
import { inference } from '../src/core/inference.js'
import { read } from '../src/core/markdown.js'
import { merge, resolve } from '../src/core/models.js'
import { ReAct, responseModel } from '../src/core/responses.js'
import { fromModule, tool, toolbox } from '../src/core/tools.js'

describe('markdown', () => {
  test('frontmatter: scalars, lists, nested maps; body unwrapped', () => {
    const { settings, body } = read(
      '---\nname: coder\nmax_steps: 20\nremembers: true\ncontext:\n  - time\n  - budget\nagents: [researcher, "x y"]\nmodels:\n  local:\n    base_url: http://127.0.0.1:1234/v1 # comment\n---\n\nFirst line\nwraps here.\n\n- a list\n- stays\n',
    )
    expect(settings).toEqual({
      name: 'coder',
      max_steps: 20,
      remembers: true,
      context: ['time', 'budget'],
      agents: ['researcher', 'x y'],
      models: { local: { base_url: 'http://127.0.0.1:1234/v1' } },
    })
    expect(body).toBe('First line wraps here.\n\n- a list\n- stays')
  })

  test('no frontmatter is all body', () => {
    expect(read('just text')).toEqual({ settings: {}, body: 'just text' })
  })
})

describe('calls', () => {
  test('stages, parallel inside, sequential across', () => {
    const found = stages('[[a({"x": 1}), b({})], [c({"q": "hi"})]]')
    expect(found.map((stage) => stage.map((call) => call.name))).toEqual([['a', 'b'], ['c']])
    expect(found[1][0].args).toEqual({ q: 'hi' })
  })

  test('commas and brackets inside strings are text', () => {
    const [[call]] = stages('[[write({"text": "a, [b) c", "n": 2})]]')
    expect(call.args).toEqual({ text: 'a, [b) c', n: 2 })
  })

  test('lines are stages when there are no brackets', () => {
    expect(stages('a({})\nb({}), c({})').map((stage) => stage.length)).toEqual([1, 2])
  })

  test('bad JSON is reported, single quotes repaired', () => {
    expect(stages("x({'a': 'b'})")[0][0].args).toEqual({ a: 'b' })
    expect(stages('x({oops)')[0][0].error).toContain('not JSON')
  })
})

describe('responses', () => {
  const toon = responseModel(ReAct, 'toon')
  test('parses TOON, coerces a tool name in do', () => {
    const { value, faults } = toon.parse('thoughts: [one, two]\n\ndo: add\n\nact: [[add({"a": 1, "b": 2})]]')
    expect(faults).toEqual([])
    expect(value.do).toBe('tool')
    expect(toon.calls(value)[0][0].name).toBe('add')
  })

  test('missing do is a fault, never a default', () => {
    expect(toon.parse('act: hello').faults.length).toBe(1)
  })

  test('JSON works too, and fields stream', () => {
    const json = responseModel(ReAct, 'json')
    expect(json.answer(json.parse('{"do": "done", "act": "hi"}').value)).toBe('hi')
    expect(Object.keys(toon.fields('thoughts: [a]\n\ndo: to'))).toEqual(['thoughts'])
  })
})

describe('tools', () => {
  test('module exports become tools; local shadows built-in; requires hides', () => {
    const local = fromModule({ add: { description: 'add', parameters: { a: 'number' }, run: ({ a }) => a + 1 }, _hidden: () => 0 })
    const builtin = [tool({ name: 'add', run: () => 0 }), tool({ name: 'host_exec', requires: ['host'], run: () => 0 })]
    const { tools, shadowed, unavailable } = toolbox([local, builtin], { has: () => false })
    expect(tools.map((item) => item.name)).toEqual(['add'])
    expect(tools[0].tier).toBe('local')
    expect(shadowed[0]).toMatchObject({ name: 'add', by: 'local' })
    expect(unavailable[0]).toMatchObject({ name: 'host_exec', missing: ['host'] })
  })
})

describe('folder', () => {
  const index = {
    files: {
      'agents/soul.md': 's',
      'agents/main/agent.md': 'm',
      'agents/main/tools.js': 't',
      'agents/main/haiku/agent.md': 'h',
      'agents/coder/agent.md': 'c',
      'tools/text.js': 'x',
    },
  }
  const files = {
    'agents/soul.md': '---\nname: soul\n---\nCareful.',
    'agents/main/agent.md': '---\nname: main\nmax_steps: 5\nmodel: local\nagents: [coder, ghost]\ntools: [text]\nweird: 1\n---\nDo the job.',
  }
  const load = async (file) => files[file]

  test('paths, ownership, local tools', () => {
    expect(agentPaths(index)).toEqual(['coder', 'main', 'main/haiku'])
    expect(ownedPaths(index, 'main')).toEqual(['main/haiku'])
    expect(localToolFiles(index, 'main')).toEqual(['agents/main/tools.js'])
  })

  test('readSpec splits config and reports mistakes as notes', async () => {
    const spec = await readSpec('main', { index, load })
    expect(spec.soul).toBe('Careful.')
    expect(spec.body).toBe('Do the job.')
    expect(spec.engine).toEqual({ maxSteps: 5 })
    expect(spec.inference).toEqual({ model: 'local' })
    expect(spec.peers).toEqual(['coder'])
    expect(spec.commonTools).toEqual({ text: 'tools/text.js' })
    expect(spec.notes.join(' ')).toContain('weird')
    expect(spec.notes.join(' ')).toContain('ghost')
  })
})

describe('models', () => {
  test('alias, default, override', () => {
    const catalogue = merge({ default: 'local', models: { local: { provider: 'openai', model: 'qwen', base_url: 'u' } } }, { models: { fast: { model: 'tiny' } } })
    expect(resolve({}, catalogue)).toMatchObject({ provider: 'openai', model: 'qwen', baseUrl: 'u', alias: 'local' })
    expect(resolve({ model: 'fast', temperature: 0 }, catalogue)).toMatchObject({ model: 'tiny', temperature: 0, alias: 'fast' })
    expect(resolve({ model: 'raw-id' }, catalogue)).toMatchObject({ model: 'raw-id', alias: '' })
  })
})

describe('engine', () => {
  const make = (replies, extra = {}) => {
    const llm = inference({ provider: 'scripted', replies })
    const add = tool({ name: 'add', parameters: { a: 'number', b: 'number' }, run: ({ a, b }) => a + b })
    const slow = tool({ name: 'slow', parameters: { ms: 'number' }, run: ({ ms }) => new Promise((done) => setTimeout(() => done(`slept ${ms}`), ms)) })
    const engine = new Engine({ name: 'main', systemPrompt: 'Job.', soul: 'Soul.', llm: async () => llm, tools: [add, slow], maxSteps: 4, ...extra })
    const events = []
    engine.listen((event) => events.push(event))
    return { engine, events }
  }

  test('tool then answer; history and events', async () => {
    const { engine, events } = make(['do: tool\n\nact: [[add({"a": 2, "b": 3})]]', 'do: done\n\nact: five'])
    expect(await engine.invoke('2+3?')).toBe('five')
    expect(engine.history.map((turn) => turn.role)).toEqual(['user', 'assistant', 'observation', 'assistant'])
    expect(engine.history[2].content).toContain('-> 5')
    const kinds = new Set(events.map((event) => event.kind))
    for (const kind of ['prompt', 'call', 'observation', 'answer', 'status', 'field']) expect(kinds.has(kind)).toBe(true)
    expect(events.find((event) => event.kind === 'observation')).toMatchObject({ ok: true })
    expect(engine.progress().status).toBe('done')
  })

  test('a stage runs its calls at the same time', async () => {
    const { engine } = make(['do: tool\n\nact: [[slow({"ms": 80}), slow({"ms": 81})]]', 'do: done\n\nact: ok'])
    const started = Date.now()
    await engine.invoke('go')
    expect(Date.now() - started).toBeLessThan(150)
  })

  test('repair, then repeat detection, then the step cap', async () => {
    const same = 'do: tool\n\nact: [[add({"a": 1, "b": 1})]]'
    const { engine, events } = make(['act: no do here', same, same, same, same, 'do: done\n\nact: gave up'])
    const answer = await engine.invoke('loop')
    expect(events.some((event) => event.kind === 'repair')).toBe(true)
    expect(engine.progress().repeats).toBeGreaterThanOrEqual(2)
    expect(events.some((event) => event.kind === 'final')).toBe(true)
    expect(events.some((event) => event.kind === 'budget')).toBe(true)
    expect(answer).toBe('gave up')
  })

  test('a nudge is read before the next step', async () => {
    const { engine, events } = make(['do: tool\n\nact: [[add({"a": 1, "b": 2})]]', 'do: done\n\nact: heard'])
    engine.listen((event) => {
      events.push(event)
      if (event.kind === 'call') engine.nudge('use base 10')
    })
    await engine.invoke('x')
    expect(engine.history.some((turn) => turn.note && turn.content === 'use base 10')).toBe(true)
    expect(events.some((event) => event.kind === 'heard')).toBe(true)
  })

  test('abort ends the run as cancelled, never throws', async () => {
    const { engine } = make(['do: tool\n\nact: [[slow({"ms": 200})]]', 'do: done\n\nact: late'])
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)
    const answer = await engine.invoke('x', { signal: controller.signal })
    expect(answer).toContain('cancelled: stopped by the owner')
    expect(engine.progress()).toMatchObject({ status: 'cancelled', terminationReason: 'cancelled' })
  })

  test('an unreachable model is an answer, not a throw', async () => {
    const broken = inference({ provider: 'openai', baseUrl: 'http://127.0.0.1:9', retries: 1 })
    const engine = new Engine({ name: 'main', llm: async () => broken, maxSteps: 2 })
    const answer = await engine.invoke('hi')
    expect(answer).toContain('failed')
    expect(engine.progress().status).toBe('failed')
  })

  test('the rendered prompt keeps the skeleton order', async () => {
    const { engine } = make([])
    engine.history.push({ role: 'user', content: 'q' })
    const { sheet, messages } = await engine.render()
    const order = ['Soul.', 'Job.', '## TOOLS', '## CONVERSATION', '## RESPONSE FORMAT'].map((mark) => sheet.indexOf(mark))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).not.toContain('## CONVERSATION')
  })
})
