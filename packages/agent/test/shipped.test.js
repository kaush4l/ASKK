import { expect, test, describe } from 'bun:test'
import {
  ALL_TOOLS, FAULT, NO_TOOLS, PASS, STAGES_OF, adoptSpec, arg, grant, loadAgents, loadBriefs,
  newAgentState, parseAgentFile, resolveStage, roleHolder, routeOf, tool, usages,
} from '@harness/agent'

/** The two files this product actually ships, and the five briefs they walk. Read from disk, not fixtured: a spec reader that passes against a fixture somebody wrote for it has proved nothing about the file the page fetches. */
const PUBLIC = `${import.meta.dir}/../../../apps/web/public`
const read = (/** @type {string} */ path) => Bun.file(`${PUBLIC}/${path}`).text()

const files = [
  { path: 'public/agents/main/agent.md', text: await read('agents/main/agent.md') },
  { path: 'public/agents/critic/agent.md', text: await read('agents/critic/agent.md') },
]
const briefs = await Promise.all(
  ['strategy', 'plan', 'verify', 'critique', 'durable'].map(async (key) => ({ key, text: await read(`stages/${key}.md`) })),
)

const { specs, refusals } = loadAgents(files)
const main = specs.find((s) => s.name === 'main')
const critic = specs.find((s) => s.name === 'critic')
if (!main || !critic) throw new Error('the shipped roster did not load')

/** A catalogue standing in for the built-ins, with the two that need a capability declared as needing it. */
const CATALOGUE = [
  tool({ name: 'now', description: 'The current date and time in this browser.' }),
  tool({ name: 'exec', description: 'Run a command in the workspace.', args: [arg('command', 'string', 'the command')], evidence: true, needs: 'workspace' }),
  tool({ name: 'write_file', description: 'Write a file in the workspace.', args: [arg('path', 'string', 'where'), arg('text', 'string', 'the whole contents')], mutates: true, needs: 'workspace' }),
  tool({ name: 'web_search', description: 'Search the web.', args: [arg('query', 'string', 'what to look for')], needs: 'net' }),
]

describe('the two shipped agent files', () => {
  test('both parse, and nothing in either is refused', () => {
    expect(refusals).toEqual([])
    expect(specs.map((s) => s.name)).toEqual(['critic', 'main'])
  })

  test('every field main declares lands on the spec — not one of them silently defaulted', () => {
    expect(main.description).toContain('General-purpose assistant')
    expect([main.model, main.temperature, main.engine, main.role]).toEqual(['local', 0.7, 'react', 'entry'])
    expect(main.stages).toEqual(['strategy'])
    expect([main.space, main.compactAt, main.keepRecent]).toEqual(['research', 8, 3])
    expect(main.faculties).toEqual(['memory', 'artifacts'])
    expect(main.tools).toContain('critic')
    expect(main.prompt.startsWith('You are a helpful assistant.')).toBe(true)
  })

  test('and every one of them is READ: adopting the file puts each on the state that runs it', () => {
    const adopted = adoptSpec(newAgentState(), main, { catalogue: CATALOGUE, offered: ['workspace', 'net'], peers: specs })
    expect([adopted.state.model, adopted.state.temperature]).toEqual(['local', 0.7])
    expect([adopted.state.compactAt, adopted.state.keepRecent]).toEqual([8, 3])
    expect(adopted.state.space).toEqual({ name: 'research', facts: [], notes: [] })
    // Naming a space declares the space faculty on its own, ahead of the two written out.
    expect(adopted.state.faculties).toEqual(['space', 'memory', 'artifacts'])
    expect(adopted.state.declared).toEqual(['strategy'])
    // `role: critic` in the OTHER file is what hooks up the verdict — not the name.
    expect(adopted.state.critic).toBe('critic')
    expect(roleHolder(specs, 'entry')?.name).toBe('main')
  })

  test('the peer named in tools: becomes an ordinary tool carrying the peer file own description (I9)', () => {
    const { toolbox } = adoptSpec(newAgentState(), main, { catalogue: CATALOGUE, offered: ['workspace', 'net'], peers: specs }).state
    const asTool = toolbox.find((t) => t.name === 'critic')
    expect(asTool?.description).toBe(critic.description)
    expect(asTool?.args.map((a) => a.name)).toEqual(['query'])
  })

  test('the two words the loop reads are the two words the file asks for', () => {
    // `passed` tests for PASS alone, so the file and this module agreeing on the
    // vocabulary is the whole of what makes a FAULT reply a fault rather than an
    // unrecognised one. Renaming either word in the file breaks HERE, not in production.
    expect(critic.prompt).toContain(`\`${PASS}\``)
    expect(critic.prompt).toContain(`\`${FAULT}\``)
  })

  test('critic ships engine: base, and that is the empty toolbox — enforced, not described', () => {
    expect([critic.engine, critic.role, critic.temperature]).toEqual(['base', 'critic', 0.2])
    expect(critic.tools).toEqual([])
    const adopted = adoptSpec(newAgentState(), critic, { catalogue: CATALOGUE, offered: ['workspace', 'net'], peers: specs })
    expect(adopted.state.toolbox).toEqual([])
    // It is not its own reviewer.
    expect(adopted.state.critic).toBe('')
  })
})

describe('the loop main declares, walked against the shipped briefs', () => {
  const loaded = loadBriefs(briefs)
  if ('refusal' in loaded) throw new Error(loaded.refusal.message)

  test('every shipped brief loads, and the set is complete', () => {
    expect(Object.keys(loaded.briefs).sort()).toEqual(['critique', 'durable', 'plan', 'strategy', 'verify'])
  })

  test('[strategy] resolves to ONE call that may not act and must answer in the vote shape', () => {
    expect(main.stages).toEqual(['strategy'])
    const first = resolveStage('strategy', { briefs: loaded.briefs })
    if ('refusal' in first) throw new Error(first.refusal.message)
    expect(first.stage.brief).toContain('Three routes')
    expect(first.stage.toolAllowlist).toEqual(NO_TOOLS)
    expect(first.stage.responseSchema?.fields.map((f) => f.name)).toEqual(['ROUTE', 'WHY'])
  })

  test('…and the vote then REPLACES that list: a greeting costs one call, a build costs four', () => {
    expect(STAGES_OF[routeOf('ROUTE: answer\nWHY: nothing to look up')]).toEqual(['answer'])
    expect(STAGES_OF[routeOf('**ROUTE:** project\nWHY: a script has to run')]).toEqual(['plan', 'work', 'verify', 'critique'])
  })

  test('the plan stage of an agent with a space carries the durable paragraph, and gets the two skill tools', () => {
    const plan = resolveStage('plan', { briefs: loaded.briefs, hasSpace: true })
    if ('refusal' in plan) throw new Error(plan.refusal.message)
    expect(plan.stage.brief).toContain('call `list_skills`')
    expect(plan.stage.brief).toContain('key `outcome`')
    expect(grant(plan.stage.toolAllowlist, CATALOGUE)).toEqual([])
    expect(plan.stage.toolAllowlist).toEqual({ kind: 'only', tools: ['list_skills', 'read_skill'] })
  })

  test('work acts with the whole toolbox; nothing else takes it by omission', () => {
    const work = resolveStage('work', { briefs: loaded.briefs })
    if ('refusal' in work) throw new Error(work.refusal.message)
    expect(work.stage.brief).toBe('')
    expect(work.stage.toolAllowlist).toEqual(ALL_TOOLS)
    expect(usages(grant(work.stage.toolAllowlist, CATALOGUE)).length).toBe(CATALOGUE.length)
  })
})
