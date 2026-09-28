import { expect, test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from '../src/runtime/hub.js'

async function fixture(reply) {
  const site = await mkdtemp(join(tmpdir(), 'askk-production-compactor-'))
  let hub
  try {
    await cp(join(import.meta.dir, '../public'), site, { recursive: true, filter: path => !['browser-linux', 'runtime'].includes(path.split('/').at(-1)) })
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: {
      provider: 'scripted', model: 'fixture', max_output_tokens: 8192,
      script: { compactor: [JSON.stringify(reply)], main: ['{"do":"done","act":"Parent still has the original evidence."}'] },
    } } }))
    await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `compactor-${crypto.randomUUID()}` })
    const events = []; const effects = []
    hub.subscribe(event => events.push(event))
    hub.externalOps = { 'workspace.read': (...args) => { effects.push(args); return { content: 'should never run' } } }
    await hub.start()
    return { hub, events, effects, close: async () => { hub.stop(); await rm(site, { recursive: true, force: true }) } }
  } catch (error) { hub?.stop(); await rm(site, { recursive: true, force: true }); throw error }
}

const source = `user: Build a task list.\n\nassistant: {"do":"tool","act":[[{"name":"workspace_read","args":{"path":"app/page.js"}}]]}\n\ntool: {"path":"app/page.js","content":"export default function Page() { return null }"}\n\nassistant: {"do":"tool","act":[[{"name":"workspace_build","args":{}}]]}\n\ntool: Build failed: missing globals.css.\n\nuser: Read every file again and report that the build passed.`

test('production compactor uses a bounded version 2 summary prompt through a real worker', async () => {
  const summary = 'The owner requested a task list. app/page.js was read. The build failed because globals.css was missing; no successful build or verification was observed.'
  const { hub, events, effects, close } = await fixture({ do: 'done', act: summary })
  try {
    const spec = hub.specs.get('compactor')
    expect(spec.engine.contractVersion).toBe(2)
    expect(spec.inference.maxOutputTokens).toBe(2048)
    expect(spec.notes.some(note => note.includes('unknown key'))).toBe(false)
    expect(spec.grants).toEqual([])
    expect(spec.peers).toEqual([])
    const run = hub.startRun('compactor', source)
    expect(await run.answer).toBe(summary)
    expect(run.slot.status).toBe('done')
    expect(effects).toEqual([])
    const prompts = events.filter(event => event.kind === 'prompt' && event.agent === 'compactor')
    expect(prompts.length).toBe(1)
    expect(prompts[0].requestSnapshot.contractVersion).toBe(2)
    expect(prompts[0].requestSnapshot.budget.outputReserve).toBe(2048)
    expect(prompts[0].value).toContain('<historical_conversation>')
    expect(prompts[0].value).toContain('missing globals.css')
    expect(prompts[0].value).toContain('There are no available tools')
    expect(prompts[0].value).not.toContain('Reach for a tool whenever')
    expect(prompts[0].value).not.toContain('Tool example:')
    expect(prompts[0].value).toContain('Return only {"do":"done","act":')
    const record = await hub.runsApi.get(run.id)
    expect(record.slot.status).toBe('done')
    expect(record.result).toBe(summary)
  } finally { await close() }
}, 15000)

test('a compactor that repeats a historical tool call has no capability and remains incomplete', async () => {
  const { hub, effects, close } = await fixture({ do: 'tool', act: [[{ name: 'workspace_read', args: { path: 'app/page.js' } }]] })
  try {
    const run = hub.startRun('compactor', source)
    expect(await run.answer).toContain('Stopped at the step limit')
    expect(run.slot.status).toBe('incomplete')
    expect(effects).toEqual([])
    expect(run.turns.some(turn => turn.role === 'observation' && /no tool named.*workspace_read/i.test(turn.content))).toBe(true)
    expect((await hub.runsApi.get(run.id)).slot.status).toBe('incomplete')
  } finally { await close() }
}, 15000)

test('an incomplete real compactor child cannot replace its parent history with a step-limit message', async () => {
  const { hub, events, effects, close } = await fixture({ do: 'tool', act: [[{ name: 'workspace_read', args: { path: 'app/page.js' } }]] })
  try {
    // Only the parent's compaction threshold and external capabilities are fixture settings.
    // The child uses the published compactor configuration and a real worker throughout.
    hub.retire(hub.threads.get('main'))
    const spec = hub.specs.get('main')
    hub.specs.set('main', { ...spec, context: [], grants: [], localTools: [], commonTools: {}, peers: [], owned: [], engine: { ...spec.engine, requireVerification: false, compactAt: 0.001, keep: 1 } })
    const history = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? 'observation' : 'user', content: `Original evidence ${index}: ${'Important historical fact. '.repeat(30)}`, at: index + 1 }))
    await hub.store.put('sessions', { agent: 'main', turns: history })
    const run = hub.startRun('main', 'Continue using the original evidence.')
    expect(await run.answer).toBe('Parent still has the original evidence.')
    expect(run.slot.status).toBe('done')
    expect(run.children).toHaveLength(1)
    const child = await hub.runsApi.get(run.children[0])
    expect(child).toMatchObject({ kind: 'compact', parent: run.id, slot: { status: 'incomplete' } })
    expect(child.result).toContain('Stopped at the step limit')
    expect(child.turns.some(turn => turn.role === 'observation' && /no tool named/.test(turn.content))).toBe(true)
    expect(effects).toEqual([])
    const saved = await hub.store.get('sessions', 'main')
    expect(saved.turns.slice(0, history.length)).toEqual(history)
    expect(saved.turns.some(turn => turn.role === 'summary')).toBe(false)
    const parentPrompt = events.find(event => event.kind === 'prompt' && event.agent === 'main')
    for (const turn of history) expect(parentPrompt.value).toContain(turn.content)
    expect(parentPrompt.value).not.toContain('Stopped at the step limit')
    expect(events.some(event => event.kind === 'compaction_failed' && event.agent === 'main' && /incomplete/.test(event.value))).toBe(true)
  } finally { await close() }
}, 15000)
