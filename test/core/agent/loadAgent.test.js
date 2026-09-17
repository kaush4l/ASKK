import { describe, expect, test } from 'bun:test'
import { AgentSpec } from '../../../src/core/agent/AgentSpec.js'
import { buildAgent, resolveTools } from '../../../src/core/agent/loadAgent.js'
import { Plan, StepState } from '../../../src/core/Plan.js'

/**
 * Where a name written in a markdown file becomes a thing the model can call.
 *
 * Every failure here is silent by construction. A tool that does not resolve is
 * simply not in the toolbox, and the prompt that goes out is a valid prompt for
 * a less capable agent — no exception, no failed call, just an agent that never
 * uses the tool its file says it has. So what is checked is the toolbox that
 * came out, name by name, and the note that says what went missing.
 *
 * The `Object.hasOwn` guard gets its own test because a plain `BUILTIN_TOOLS[name]`
 * lookup is the obvious simplification and is wrong: every object answers
 * `toString` and `constructor`, so an agent file naming one of those would be
 * handed something that is not a tool, with nothing anywhere saying so.
 */

const specFor = (metadata) =>
  AgentSpec.of({ metadata: { name: 'main', ...metadata }, body: 'You are careful.' }).value

describe('resolveTools', () => {
  test('a built-in name becomes the built-in tool', () => {
    const { value, notes } = resolveTools({ names: ['shell'], services: { sandbox: null } })

    expect(value.map((tool) => tool.name)).toEqual(['shell'])
    expect(notes).toEqual([])
  })

  test('a name every object answers to is NOT a tool', () => {
    // `toString` and `constructor` exist on the prototype of the table itself.
    const { value, notes } = resolveTools({ names: ['toString', 'constructor'] })

    expect(value).toEqual([])
    expect(notes).toEqual([
      'tool "toString" was not found; it is neither a built-in nor an agent',
      'tool "constructor" was not found; it is neither a built-in nor an agent',
    ])
  })

  test('an unresolvable name costs that tool and nothing else', () => {
    const { value, notes } = resolveTools({ names: ['shell', 'nope'], services: {} })

    expect(value.map((tool) => tool.name)).toEqual(['shell'])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('"nope"')
  })

  test('a peer becomes a tool named and described by its own agent file', () => {
    const peer = specFor({ name: 'writer', description: 'Drafts prose.' })

    const { value } = resolveTools({ names: ['writer'], peers: [peer], dispatch: async () => {} })

    expect(value[0].name).toBe('writer')
    expect(value[0].description).toBe('Drafts prose.')
  })

  test('a peer with no way to reach it is reported as that, not as missing', () => {
    const peer = specFor({ name: 'writer' })

    const { value, notes } = resolveTools({ names: ['writer'], peers: [peer] })

    expect(value).toEqual([])
    expect(notes[0]).toContain('is an agent, but no way to reach it was provided')
  })
})

describe('buildAgent', () => {
  test('the agent is built from the file, and tools found at runtime join the ones it named', () => {
    const built = buildAgent({
      spec: specFor({ tools: ['shell'] }),
      inference: {},
      services: { sandbox: null },
      extraTools: [{ name: 'disk', render: () => '- disk()' }],
    })

    expect(built.ok).toBe(true)
    expect(built.value.toolbox.names).toEqual(['shell', 'disk'])
    // The instructions are the file's body and nothing else was added to them.
    expect(built.value.system).toBe('You are careful.')
  })

  test('a name that resolved to nothing reaches the caller as a note, not a failure', () => {
    const built = buildAgent({ spec: specFor({ tools: ['nope'] }), inference: {} })

    expect(built.ok).toBe(true)
    expect(built.value.toolbox.isEmpty).toBe(true)
    expect(built.notes.some((note) => note.includes('"nope"'))).toBe(true)
  })
})

/**
 * A check that names a tool the agent does not have.
 *
 * Left in, it reached the toolbox at the end of a run, came back "there is no
 * tool called shell", and the agent was told to fix a problem it could do
 * nothing about — a step spent, and a confusing turn, for a line the author
 * believed was a test. It is dropped at load with a note instead, like every
 * other line this tree cannot honour.
 */
describe('the check an agent file declares', () => {
  const build = (metadata) =>
    buildAgent({
      spec: AgentSpec.of({ metadata: { name: 'a', ...metadata }, body: 'be brief' }).value,
      inference: {},
      services: { http: async () => ({}) },
    })

  test('is kept when the agent has the tool it names', () => {
    const built = build({ tools: ['fetch'], check: 'fetch({"url": "https://example.com/"})' })
    expect(built.value.check).toBe('fetch({"url": "https://example.com/"})')
    expect(built.notes.some((note) => note.includes('check'))).toBe(false)
  })

  test('is dropped, with the missing name said out loud, when it is not', () => {
    const built = build({ tools: ['fetch'], check: 'shell({"command": "true"})' })
    expect(built.value.check).toBe('')
    expect(built.notes.some((note) => note.includes('shell'))).toBe(true)
  })

  test('is dropped when it is a name and a bracket that never closes', () => {
    // `AgentSpec` accepts this — its check is a shape, `name(` — and the
    // toolbox is what knows a call needs balanced brackets. Where the two
    // disagree the toolbox is right, because it is the thing that would run it.
    const built = build({ tools: ['fetch'], check: 'fetch(' })
    expect(built.value.check).toBe('')
    expect(built.notes.some((note) => note.includes('not a call this loop can run'))).toBe(true)
  })
})

describe('the goal reaches the prompt', () => {
  test('a goal handed to buildAgent is a block the model reads', () => {
    // The whole chain in one assertion: ChatService reads the goal off the
    // conversation, hands it here, and it has to come out the other end in the
    // assembled prompt. A block that is declared and never wired is the defect
    // this tree deleted TokenScale for.
    const built = buildAgent({
      spec: specFor({ tools: [] }),
      inference: {},
      goal: 'get the suite green and keep it green',
    })
    expect(built.ok).toBe(true)

    const planned = built.value.assemble([])
    expect(planned.text).toContain('GOAL')
    expect(planned.text).toContain('get the suite green and keep it green')
  })

  test('no goal means no block, not an empty heading', () => {
    const built = buildAgent({ spec: specFor({ tools: [] }), inference: {} })
    expect(built.value.assemble([]).text).not.toContain('GOAL')
  })
})

describe('the plan reaches the prompt', () => {
  test('a plan handed to buildAgent is a block the model reads', () => {
    const plan = new Plan()
    plan.compose(['read the spec', 'write the test'])
    plan.mark(1, StepState.DONE)

    const built = buildAgent({ spec: specFor({ tools: [] }), inference: {}, plan })
    expect(built.ok).toBe(true)

    const assembled = built.value.assemble([])
    expect(assembled.text).toContain('PLAN')
    expect(assembled.text).toContain('1. [x] read the spec')
    expect(assembled.text).toContain('2. [ ] write the test')
  })

  test('an empty plan means no block, not an empty heading', () => {
    const built = buildAgent({ spec: specFor({ tools: [] }), inference: {}, plan: new Plan() })
    expect(built.value.assemble([]).text).not.toContain('PLAN')
  })

  test('a step ticked off mid-turn changes what the rest of the turn reads', () => {
    // The live object, all the way through. This is the property the whole
    // port exists for: the engine renders the plan on every step, so a step
    // that finished part of the work must be read as finished by the next one.
    const plan = new Plan()
    plan.compose(['first', 'second'])
    const built = buildAgent({ spec: specFor({ tools: [] }), inference: {}, plan })

    expect(built.value.assemble([]).text).toContain('1. [ ] first')
    plan.mark(1, StepState.DONE)
    expect(built.value.assemble([]).text).toContain('1. [x] first')
  })

  test('the goal and the plan are both there, goal first', () => {
    const plan = new Plan()
    plan.compose(['the first part of it'])
    const built = buildAgent({
      spec: specFor({ tools: [] }),
      inference: {},
      goal: 'ship the thing',
      plan,
    })

    const { text } = built.value.assemble([])
    expect(text.indexOf('# GOAL')).toBeGreaterThan(-1)
    expect(text.indexOf('# PLAN')).toBeGreaterThan(text.indexOf('# GOAL'))
  })
})
