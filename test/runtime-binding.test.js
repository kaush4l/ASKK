import { afterEach, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from './helpers/trusted-fixture-hub.js'
import { createWorkspaceBinding } from '../src/workspace/contracts.js'

const fixtures = []
afterEach(async () => {
  for (const { hub, site, release } of fixtures.splice(0)) {
    release?.()
    hub.stop()
    await rm(site, { recursive: true, force: true })
  }
})

const deferred = () => {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
const reply = answer => JSON.stringify({ do: 'done', act: answer })
const call = (...names) => JSON.stringify({ do: 'tool', act: [names.map(name => ({ name, args: { query: `Complete ${name}'s independent part` } }))] })
const context = () => ({
  binding: createWorkspaceBinding({ workspaceId: 'fixture-project', target: 'browser', runtimeId: 'browser:session-original', root: '/workspace', toolchain: { kind: 'node', version: '24.fixture', packageManager: 'npm' } }),
  sourceRevision: 8,
  sourceFingerprint: 'fixture-source-eight',
  modelTransport: { kind: 'direct', provider: 'scripted', model: 'fixture' },
})

async function fixture({ script, waiting = false } = {}) {
  const site = await mkdtemp(join(tmpdir(), 'askk-runtime-binding-'))
  // Runtime assets are hundreds of megabytes and play no part in this worker test.
  await cp(join(import.meta.dir, '../public'), site, { recursive: true, filter: path => !['browser-linux', 'runtime'].includes(path.split('/').at(-1)) })
  for (const name of ['main', 'alpha', 'beta']) {
    await mkdir(join(site, 'agents', name), { recursive: true })
    await writeFile(join(site, 'agents', name, 'agent.md'), `---\nname: ${name}\ncontract_version: 2\nresponse_format: json\ncontext: [workspace, runtime, plan]\nmax_steps: 4\ntools: []\nagents: ${name === 'main' ? '[alpha, beta]' : '[]'}\n---\nRead the owner-provided binding, complete this fixture task, and report the result.`)
    if (waiting && name !== 'main') await writeFile(join(site, 'agents', name, 'tools.js'), 'export const fixture_wait = { description: "Wait for this fixture part to finish", parameters: {}, risk: "read", run: (_, ctx) => ctx.request("fixture.wait") }\n')
  }
  await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: { provider: 'scripted', model: 'fixture', max_output_tokens: 256, script } } }))
  await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
  const hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `binding-${crypto.randomUUID()}` })
  const environmentRequests = []
  hub.externalOps['workspace.environment'] = (_, run) => {
    environmentRequests.push(run.id)
    return { target: 'browser', status: 'ready', binding: run.context?.binding ?? null, capabilities: ['fs', 'exec'] }
  }
  const row = { hub, site, environmentRequests }
  fixtures.push(row)
  await hub.start()
  await hub.settings.set({ dreaming: false })
  return row
}

test('real delegated workers inherit a detached binding in prompts, records, and exported trace', async () => {
  const { hub, environmentRequests } = await fixture({ script: { main: [call('alpha'), reply('Parent finished')], alpha: [reply('Child finished')] } })
  const supplied = structuredClone(context())
  const original = structuredClone(supplied)
  const run = hub.startRun('main', 'Delegate one independent part', { context: supplied })
  supplied.binding.runtimeId = 'browser:caller-mutation'
  supplied.sourceRevision = 99
  expect(await run.answer).toBe('Parent finished')
  expect(run.children).toHaveLength(1)
  const child = hub.runs.get(run.children[0])
  expect(child.result).toBe('Child finished')
  expect(child.parent).toBe(run.id)
  expect(child.trace).toBe(run.trace)
  expect(child.thread.worker).not.toBe(run.thread.worker)
  expect(child.context).toEqual(original)
  expect(child.context).not.toBe(run.context)
  expect(Object.isFrozen(child.context.binding)).toBe(true)
  expect(environmentRequests).toEqual(expect.arrayContaining([run.id, child.id]))
  for (const row of [run, child]) {
    expect(row.prompts[0].sheet).toContain('browser:session-original')
    expect(row.prompts[0].sheet).not.toContain('browser:caller-mutation')
    const stored = await hub.store.get('runs', row.id)
    expect(stored.context).toEqual(original)
    expect(stored.prompts[0].snapshot.messages).toEqual(row.prompts[0].snapshot.messages)
  }
  const exported = await hub.traces.export(run.trace)
  expect(exported.runs).toHaveLength(2)
  expect(exported.runs.every(row => row.context.binding.runtimeId === original.binding.runtimeId)).toBe(true)
  expect(exported.runs.find(row => row.id === child.id).prompts[0].snapshot.contractVersion).toBe(2)
}, 15000)

test('resume from persisted history and invoke on a prior run retain its pinned context', async () => {
  const { hub } = await fixture({ script: { main: [reply('Completed bound invocation')] } })
  const original = context()
  const initial = hub.startRun('main', 'First task', { context: original })
  await initial.answer
  const plan = [{ text: 'Inspect the existing fixture', status: 'done' }, { text: 'Check the remaining fixture', status: 'doing' }]
  hub.ops['todo.set'].call(hub, { items: plan }, initial)
  await hub.persist(initial)
  const originalRecord = await hub.store.get('runs', initial.id)
  expect((await hub.store.get('runs', initial.id)).context).toEqual(original)
  // Force resume to use the stored record, not the live map's convenient copy.
  hub.runs.delete(initial.id)
  const resumedId = await hub.resume(initial.id)
  const resumed = hub.runs.get(resumedId)
  expect(await resumed.answer).toBe('Completed bound invocation')
  expect(resumed.id).not.toBe(initial.id)
  expect(resumed.context).toEqual(original)
  expect(resumed).toMatchObject({ taskId: initial.id, resumedFrom: initial.id, resumeAttempt: 1, originalQuery: 'First task', todo: plan })
  expect(resumed.todo).not.toBe(plan)
  expect(resumed.prompts[0].sheet).toContain('browser:session-original')
  expect(resumed.prompts[0].sheet).toContain('Check the remaining fixture')
  expect(resumed.query).toContain('No previous process or tool call has been restarted')
  expect(await hub.store.get('runs', initial.id)).toEqual(originalRecord)
  const repeated = hub.runs.get(await hub.resume(resumed.id))
  await repeated.answer
  expect(repeated).toMatchObject({ taskId: initial.id, resumedFrom: resumed.id, resumeAttempt: 2, originalQuery: 'First task', todo: plan })
  expect(repeated.query.match(/Original task:/g)).toHaveLength(1)
  const invokedId = hub.send(resumed.id, { type: 'invoke', query: 'Another explicitly requested invocation' })
  const invoked = hub.runs.get(invokedId)
  expect(await invoked.answer).toBe('Completed bound invocation')
  expect(invoked.context).toEqual(original)
  expect(invoked.prompts[0].sheet).toContain('fixture-source-eight')
  expect((await hub.store.get('runs', invoked.id)).context).toEqual(original)
}, 15000)

test('aborting one delegated child leaves its sibling and parent able to finish', async () => {
  const waitCall = JSON.stringify({ do: 'tool', act: [[{ name: 'fixture_wait', args: {} }]] })
  const row = await fixture({ waiting: true, script: { main: [call('alpha', 'beta'), reply('Parent received both outcomes')], alpha: [waitCall, reply('Alpha should have been stopped')], beta: [waitCall, reply('Beta completed')] } })
  const { hub } = row
  const started = { alpha: deferred(), beta: deferred() }
  const finish = { alpha: deferred(), beta: deferred() }
  row.release = () => { finish.alpha.resolve('released'); finish.beta.resolve('released') }
  hub.externalOps['fixture.wait'] = async (_, run) => { started[run.agent].resolve(run); return finish[run.agent].promise }
  const parent = hub.startRun('main', 'Delegate two independent parts', { context: context() })
  const [alpha, beta] = await Promise.all([started.alpha.promise, started.beta.promise])
  expect(alpha.parent).toBe(parent.id)
  expect(beta.parent).toBe(parent.id)
  await expect(hub.resume(alpha.id)).rejects.toThrow('Stop the active run')
  hub.abort(alpha)
  await alpha.answer
  expect(alpha.slot).toMatchObject({ status: 'cancelled', terminationReason: 'cancelled' })
  expect(alpha.slot.error).toMatch(/stopped|abort/i)
  expect(beta.ended).not.toBe(true)
  expect(parent.ended).not.toBe(true)
  finish.alpha.resolve('Late reply must not restart the stopped child')
  finish.beta.resolve('Sibling may complete')
  expect(await beta.answer).toBe('Beta completed')
  expect(await parent.answer).toBe('Parent received both outcomes')
  expect(beta.slot.status).toBe('done')
  expect(parent.slot.status).toBe('done')
  expect(parent.children).toHaveLength(2)
  expect(alpha.result).not.toBe('Alpha should have been stopped')
  const trace = await hub.traces.export(parent.trace)
  expect(trace.runs.find(run => run.id === alpha.id).slot.status).toBe('cancelled')
  expect(trace.runs.find(run => run.id === beta.id).slot.status).toBe('done')
}, 15000)

test('reload interruption never automatically replays work and page shutdown settles live callers', async () => {
  const waitCall = JSON.stringify({ do: 'tool', act: [[{ name: 'fixture_wait', args: {} }]] })
  const row = await fixture({ waiting: true, script: { main: [call('alpha'), reply('Must not finish')], alpha: [waitCall, reply('Must not restart')] } })
  const started = deferred()
  const release = deferred()
  row.release = () => release.resolve('released')
  row.hub.externalOps['fixture.wait'] = async (_, run) => { started.resolve(run); return release.promise }
  const parent = row.hub.startRun('main', 'Wait for a side effect', { context: context() })
  const child = await started.promise
  row.hub.stop('the tab closed')
  expect(await parent.answer).toContain('interrupted: the tab closed')
  expect(await child.answer).toContain('interrupted: the tab closed')
  for (const run of [parent, child]) expect(run.slot).toMatchObject({ status: 'interrupted', terminationReason: 'interrupted' })
  const old = { ...await row.hub.store.get('runs', child.id), id: 'previous-tab-active', slot: { status: 'thinking' }, todo: [{ text: 'Do not replay this command', status: 'doing' }] }
  await row.hub.store.put('runs', old)
  const count = row.hub.runs.size
  await row.hub.markInterrupted()
  expect((await row.hub.store.get('runs', old.id)).slot).toMatchObject({ status: 'interrupted', terminationReason: 'interrupted' })
  expect(row.hub.runs.size).toBe(count)
  expect(row.hub.runs.has(old.id)).toBe(false)
}, 15000)
