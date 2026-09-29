import { test, expect } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Hub } from '../src/runtime/hub.js'
import { listing } from '../scripts/listing.js'
import { createObservedWorkspace } from '../src/core/write-observations.js'

for (const mode of ['accept', 'refuse', 'concurrent', 'create', 'create-race']) test(`observed write resolves before real worker approval: ${mode}`, async () => {
  const site = await mkdtemp(join(tmpdir(), 'askk-observed-worker-'))
  const absent = mode.startsWith('create'), succeeds = ['accept', 'create'].includes(mode), races = ['concurrent', 'create-race'].includes(mode)
  let hub, content = absent ? null : 'original', rev = absent ? 0 : 'r1', writes = 0
  const approvals = []
  try {
    for (const name of ['packages', 'tools']) await cp(join(import.meta.dir, '../public', name), join(site, name), { recursive: true })
    await cp(join(import.meta.dir, '../public/desk.json'), join(site, 'desk.json'))
    await mkdir(join(site, 'agents'))
    const action = (name, args) => JSON.stringify({ do: 'tool', act: [[{ name, args }]] })
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: { provider: 'scripted', model: 'fixture', max_output_tokens: 256, script: { builder: [action('workspace_read', { path: 'a.txt' }), action('workspace_write', { path: 'a.txt', content: 'agent edit', observed: true }), JSON.stringify({ do: 'done', act: 'Fixture ended; no independent verification configured.' })] } } } }))
    await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `observed-${crypto.randomUUID()}` })
    const workspace = createObservedWorkspace({ identity: () => 'fixture-runtime', read: () => content === null ? null : ({ path: 'a.txt', content, rev }), write: args => {
      writes++
      if (args.expect !== rev) return { conflict: true, rev, current: { content, rev } }
      content = args.content; rev = 'r2'
      return { ok: true, path: args.path, content, rev }
    } })
    hub.externalOps = { 'workspace.environment': () => ({ target: 'fixture', status: 'ready', files: ['a.txt'] }), 'workspace.read': workspace.read, 'workspace.write': workspace.write }
    await hub.start()
    await hub.settings.set({ policy: { defaults: { read: 'allow', write: 'ask' } } })
    hub.subscribe(event => {
      if (event.type !== 'approval') return
      approvals.push(event.approval)
      if (races) { content = 'owner edit'; rev = 'owner-r2' }
      hub.approvalsApi.answer(event.approval.id, { approved: mode !== 'refuse' })
    })
    const run = hub.startRun('bundled/starter/builder', 'Read and edit the fixture')
    await run.answer
    expect(approvals).toHaveLength(1)
    expect(approvals[0].args).toMatchObject({ path: 'a.txt', content: 'agent edit', expect: absent ? 0 : 'r1', observed: true })
    expect(typeof approvals[0].args.observationId).toBe('string')
    const call = run.toolEvents.find(row => row.kind === 'call' && row.name === 'workspace_write')
    const result = run.toolEvents.find(row => row.kind === 'observation' && row.callId === call.callId)
    expect(call.args).toEqual({ path: 'a.txt', content: 'agent edit', observed: true })
    expect(result.resolvedArgs).toEqual(approvals[0].args)
    expect(result.ok).toBe(succeeds)
    expect(result.activity).toEqual(succeeds ? { path: 'a.txt' } : {})
    expect(content).toBe(succeeds ? 'agent edit' : races ? 'owner edit' : 'original')
    expect(writes).toBe(mode === 'refuse' ? 0 : 1)
    if (absent) expect(run.toolEvents.find(row => row.kind === 'observation').activity).toEqual({})
  } finally { hub?.stop(); await rm(site, { recursive: true, force: true }) }
}, 15000)
