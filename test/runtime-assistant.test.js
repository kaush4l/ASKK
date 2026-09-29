import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from '../src/runtime/hub.js'

test('production general assistant preserves conversation in its worker and after session restoration', async () => {
  const site = await mkdtemp(join(tmpdir(), 'askk-assistant-session-')); let hub
  try {
    await mkdir(join(site, 'agents'), { recursive: true })
    await mkdir(join(site, 'prompts'), { recursive: true })
    await cp(join(import.meta.dir, '../public/agents/assistant'), join(site, 'agents/assistant'), { recursive: true })
    await cp(join(import.meta.dir, '../public/agents/soul.md'), join(site, 'agents/soul.md'))
    await cp(join(import.meta.dir, '../public/prompts/workbench.md'), join(site, 'prompts/workbench.md'))
    const initial = 'I will remember that the marker is violet.'
    const followup = 'The marker from your previous message is violet.'
    const model = { provider: 'scripted', max_output_tokens: 512, script: { assistant: [JSON.stringify({ do: 'done', act: initial }), JSON.stringify({ do: 'done', act: followup })] } }
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: model } }))
    await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `assistant-session-${crypto.randomUUID()}` })
    // General context can read the owner goal. No workspace execution port is provided.
    hub.externalOps = { 'workspace.goal': () => ({ text: '', revision: 0 }) }
    await hub.start()
    const spec = hub.specs.get('assistant')
    expect(spec.engine.remembers).toBe(true)
    expect(spec.engine.requireVerification).toBe(false)
    expect(spec.grants).not.toContain('workspace')
    expect(spec.context).not.toContain('workspace')
    const context = { workflow: { id: 'assistant', workspace: false }, toolPolicy: { disabledTools: [], approvalRisks: [], allowDelegation: true } }
    const thread = hub.threads.get('assistant')
    expect(thread?.resident).toBe(true)
    const first = hub.startRun('assistant', 'Remember the marker: violet.', { context })
    expect(await first.answer).toBe(initial)
    const second = hub.startRun('assistant', 'Which marker did I give you?', { context })
    expect(await second.answer).toBe(followup)
    expect(hub.threads.get('assistant')).toBe(thread)
    expect(second.prompts[0].sheet).toContain('Remember the marker: violet.')
    expect(second.prompts[0].sheet).toContain(initial)
    const saved = await hub.store.get('sessions', 'assistant')
    expect(saved.turns.some(turn => turn.role === 'assistant' && turn.content.includes(followup))).toBe(true)
    await hub.restart(thread, 'fixture restoration of the saved conversation')
    expect(hub.threads.get('assistant')).not.toBe(thread)
    const third = hub.startRun('assistant', 'Recall it again after restarting the worker.', { context })
    await third.answer
    const prompt = third.prompts[0].sheet
    for (const prior of ['Remember the marker: violet.', initial, 'Which marker did I give you?', followup]) expect(prompt).toContain(prior)
    expect([first, second, third].every(run => run.slot.status === 'done' && run.toolEvents.length === 0)).toBe(true)
  } finally { hub?.stop(); await rm(site, { recursive: true, force: true }) }
}, 15000)
