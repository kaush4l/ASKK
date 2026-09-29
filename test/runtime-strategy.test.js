import { afterEach, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from '../src/runtime/hub.js'

const fixtures = []
afterEach(async () => { for (const { hub, site } of fixtures.splice(0)) { hub.stop(); await rm(site, { recursive: true, force: true }) } })
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const done = act => JSON.stringify({ do: 'done', act })
const context = { workflow: { workspace: false }, toolPolicy: { disabledTools: ['web_fetch'], approvalRisks: ['write'], allowDelegation: true } }
async function fixture() {
  const site = await mkdtemp(join(tmpdir(), 'askk-strategy-'))
  for (const name of ['agents', 'prompts', 'strategies']) await mkdir(join(site, name), { recursive: true })
  for (const name of ['planner', 'critic', 'synthesizer']) await cp(join(import.meta.dir, '../public/agents', name), join(site, 'agents', name), { recursive: true })
  await cp(join(import.meta.dir, '../public/agents/soul.md'), join(site, 'agents/soul.md'))
  await cp(join(import.meta.dir, '../public/prompts/workbench.md'), join(site, 'prompts/workbench.md'))
  await cp(join(import.meta.dir, '../public/prompts/strategies'), join(site, 'prompts/strategies'), { recursive: true })
  await cp(join(import.meta.dir, '../public/strategies/parallel-review.json'), join(site, 'strategies/parallel-review.json'))
  const path = join(site, 'agents/planner/agent.md')
  await writeFile(path, (await readFile(path, 'utf8')).replace('remembers: false', 'remembers: true'))
  await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: { provider: 'scripted', model: 'fixture', max_output_tokens: 512, delay: 20, script: { planner: [done('approach-result')], critic: [done('risk-result')], synthesizer: [done('combined-result')] } } } }))
  await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
  const hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `strategy-${crypto.randomUUID()}` })
  fixtures.push({ hub, site }); await hub.start(); await hub.settings.set({ dreaming: false })
  return hub
}

test('real graph workers run concurrently, isolate resident history, and fan in exact declared outputs', async () => {
  const hub = await fixture()
  const resident = hub.startRun('planner', 'private-resident-marker', { context }); await resident.answer
  const saved = await hub.store.get('sessions', 'planner')
  const definition = (await hub.loadStrategy('strategies/parallel-review.json')).definition
  const sameRole = structuredClone(definition); sameRole.nodes[1].agent = 'planner'
  const observed = []; hub.subscribe(event => { if (event.type === 'strategy') observed.push(event.task) })
  const run = await hub.startStrategy(sameRole, 'owner-goal', { context })
  expect(await run.answer).toBe('combined-result')
  expect(run.thread).toBeUndefined(); expect(run.prompts).toEqual([])
  expect(run.children).toHaveLength(3)
  expect(observed.some(state => state.nodes.filter(node => node.status === 'running').length === 2)).toBe(true)
  const [left, right, final] = run.children.map(id => hub.runs.get(id))
  expect(left.thread.worker).not.toBe(right.thread.worker)
  expect(left.thread.resident).toBe(false); expect(right.thread.resident).toBe(false)
  expect(left.context.toolPolicy).toEqual({ ...context.toolPolicy, allowDelegation: false })
  expect(left.taskId).toBe(run.id); expect(left.stageId).toBe('approach')
  for (const child of [left, right, final]) {
    expect(child.prompts[0].sheet).not.toContain('private-resident-marker')
    expect(child.context).not.toBe(run.context)
    expect(Object.isFrozen(child.context.toolPolicy)).toBe(true)
  }
  expect(final.query).toContain('approach-result'); expect(final.query).toContain('owner-goal')
  expect((final.query.match(/approach-result/g) ?? []).length).toBe(2)
  expect(await hub.store.get('sessions', 'planner')).toEqual(saved)
  const trace = await hub.traces.export(run.id)
  expect(trace.runs).toHaveLength(4)
  expect(trace.runs.find(row => row.id === run.id).strategyDefinition).toEqual(sameRole)
  expect(trace.runs.filter(row => row.kind === 'strategy-role').every(row => row.prompts.length === 1)).toBe(true)
  await expect(hub.resume(run.id)).rejects.toThrow('new configured workflow')
}, 15000)

test('published strategy loader rejects paths, changed definitions and owner denial before dispatch', async () => {
  const hub = await fixture()
  await expect(hub.loadStrategy('strategies/../models.json')).rejects.toThrow('published')
  const loaded = await hub.loadStrategy('strategies/parallel-review.json')
  expect(loaded.definitionHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(loaded.files['prompts/strategies/synthesis.md']).toBeTruthy()
  await expect(hub.startStrategy(loaded.definition, 'goal', { context: { toolPolicy: { disabledTools: [], approvalRisks: [], allowDelegation: false } } })).rejects.toThrow('Allow delegation')
  await expect(hub.startStrategy(loaded.definition, 'goal', { definitionHash: 'sha256:incorrect' })).rejects.toThrow('changed after selection')
  await expect(hub.startStrategy(loaded.definition, 'goal', { admissionGuard: () => false })).rejects.toThrow('cancelled')
  expect(hub.runs.size).toBe(0)
}, 15000)

test('strategy storage failure and stop during admission cannot launch a role', async () => {
  const hub = await fixture(); const { definition } = await hub.loadStrategy('strategies/parallel-review.json')
  const original = hub.writeRunRecord.bind(hub)
  hub.writeRunRecord = record => record.kind === 'strategy' ? Promise.reject(new Error('quota fixture')) : original(record)
  const failed = await hub.startStrategy(definition, 'goal', { context })
  expect(failed.slot.status).toBe('failed'); expect(failed.children).toEqual([])
  const entered = deferred(); const release = deferred(); let allowed = true
  hub.writeRunRecord = async record => { if (record.kind === 'strategy' && record.slot.status === 'starting') { entered.resolve(); await release.promise } return original(record) }
  const pending = hub.startStrategy(definition, 'cancel before admission', { context, admissionGuard: () => allowed })
  await entered.promise; allowed = false; release.resolve()
  const cancelled = await pending; await cancelled.answer
  expect(cancelled.slot.status).toBe('cancelled'); expect(cancelled.children).toEqual([])
}, 15000)

test('independent completion verification fails closed and cannot override owner cancellation', async () => {
  const hub = await fixture(); const { definition } = await hub.loadStrategy('strategies/parallel-review.json')
  const rejected = await hub.startStrategy(definition, 'goal', { context, verifyCompletion: async () => ({ ok: false, reason: 'No delivered revision passed checks' }) })
  await rejected.answer
  expect(rejected.slot.status).toBe('incomplete'); expect(rejected.strategyState.verification.ok).toBe(false)
  const entered = deferred(); const release = deferred()
  const run = await hub.startStrategy(definition, 'stop verification', { context, verifyCompletion: async () => { entered.resolve(); return release.promise } })
  await entered.promise
  expect(run.slot.status).toBe('verifying')
  hub.abort(run); await run.answer
  release.resolve({ ok: true }); await Promise.resolve(); await Promise.resolve()
  expect(run.slot.status).toBe('cancelled'); expect(run.strategyState.status).toBe('cancelled')
}, 15000)

test('startup preserves completed graph records and marks unfinished roles interrupted without replay', async () => {
  const hub = await fixture(); const { definition } = await hub.loadStrategy('strategies/parallel-review.json')
  const run = await hub.startStrategy(definition, 'complete before reload', { context }); await run.answer; await hub.persist(run)
  const before = await hub.store.get('runs', run.id)
  const unfinished = { ...before, id: 'unfinished-root', trace: 'unfinished-root', slot: { ...before.slot, status: 'running' }, strategyState: { ...before.strategyState, status: 'running', nodes: [{ nodeId: 'approach', status: 'running', runId: 'unfinished-child' }, { nodeId: 'synthesis', status: 'queued', runId: null }] } }
  await hub.store.put('runs', unfinished)
  const count = hub.runs.size
  await hub.markInterrupted()
  expect(await hub.store.get('runs', run.id)).toEqual(before)
  const restored = await hub.store.get('runs', unfinished.id)
  expect(restored.slot.status).toBe('interrupted'); expect(restored.strategyState.status).toBe('interrupted')
  expect(restored.strategyState.nodes.every(node => node.status === 'interrupted')).toBe(true)
  expect(hub.runs.size).toBe(count)
}, 15000)
