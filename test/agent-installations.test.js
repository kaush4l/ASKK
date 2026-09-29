import { expect, test } from 'bun:test'
import { AgentInstallations } from '../src/runtime/agent-installations.js'
import { importAgentPackage } from '../src/core/agent-package.js'
import { compileAgentPackage } from '../src/core/package-spec.js'
import { openStore } from '../src/runtime/store.js'

const source = [{ path: 'agent.md', content: '---\npackage_id: example.same\npackage_version: 1.0.0\nid: lead\n---\nKeep the recorded identity.\n' }]
const bindings = { models: { $default: '$default' }, tools: [] }
const workflowSource = () => [
  { path: 'agent.md', content: '---\npackage_id: example.workflow\npackage_version: 1.0.0\nid: lead\nworkflows: workflows.json\n---\nUse verified evidence.\n' },
  { path: 'workflows.json', content: JSON.stringify({ version: 1, default: 'inspect', workflows: [{ id: 'inspect', label: 'Inspect evidence', description: 'No execution required', strategy: 'strategies/inspect.json', execution: { workspace: 'none' }, completion: { checks: [] } }] }) },
  { path: 'strategies/inspect.json', content: JSON.stringify({ version: 1, kind: 'agent', id: 'inspect', agent: 'lead', delegation: 'none', session: 'agent' }) },
]
async function fixture(records = []) {
  const catalogue = { default: 'local', models: { local: { provider: 'scripted', script: [] } } }
  const store = await openStore(`installations-${crypto.randomUUID()}`)
  const hub = { store, started: true, lockState: 'leader', disposed: false, catalogue: () => catalogue, index: { files: {} }, specs: new Map(), failed: new Map(), readyInfo: new Map(), publish() {}, async probe() {} }
  await store.put('settings', { key: 'agent-installations:v1', value: { version: 1, records } })
  return { hub, manager: new AgentInstallations(hub), catalogue }
}

test('restoring owner installations preserves bundled definitions and failures even with the same installation ID', async () => {
  const pkg = await importAgentPackage(source)
  const record = { version: 1, id: 'starter', createdAt: 1, data: pkg.data, bindings, leadAgentId: 'lead' }
  const { hub, manager, catalogue } = await fixture([record])
  const [bundled] = await compileAgentPackage(pkg, { namespace: 'bundled', installationId: 'starter', bindings, catalogue })
  hub.specs.set(bundled.path, bundled); hub.failed.set('bundled/invalid/lead', 'Existing bundled diagnostic')
  hub.specs.set('installed/stale/lead', { path: 'installed/stale/lead' })
  await manager.restore()
  expect(hub.specs.get('bundled/starter/lead')).toBe(bundled)
  expect(hub.failed.get('bundled/invalid/lead')).toBe('Existing bundled diagnostic')
  expect(hub.specs.get('installed/starter/lead').package.namespace).toBe('installed')
  expect(hub.specs.has('installed/stale/lead')).toBe(false)
  expect(manager.list()[0].status).toBe('ready')
  catalogue.default = 'missing'
  expect(manager.list()[0].status).toBe('disabled')
  await manager.restore()
  expect(hub.specs.has('installed/starter/lead')).toBe(false)
  expect(hub.specs.get(bundled.path)).toBe(bundled)
  expect(manager.list()[0].status).toBe('disabled')
})

test('workflow preview is declarative metadata and install exposes compiled workflows only after storage acknowledgment', async () => {
  const { hub, manager } = await fixture(); hub.store.durable = true
  const preview = await manager.preview(workflowSource())
  expect(preview).toMatchObject({ defaultWorkflow: 'inspect', workflows: [{ id: 'inspect', agentId: 'lead', execution: { workspace: 'none' }, completion: { checks: [] } }] })
  expect(Object.isFrozen(preview.workflows[0])).toBe(true)
  expect(preview.workflows[0].strategy).toBeUndefined()
  const update = hub.store.update.bind(hub.store); let release; let entered
  const barrier = new Promise(resolve => { release = resolve })
  const waiting = new Promise(resolve => { entered = resolve })
  hub.store.update = async (...args) => { entered(); await barrier; return update(...args) }
  const pending = manager.install(preview.stageId, bindings)
  await waiting
  expect(hub.specs.size).toBe(0); expect(manager.list()).toEqual([])
  release()
  const installed = await pending
  expect(installed.defaultWorkflow).toBe('inspect')
  expect(installed.leadRequireVerification).toBe(false)
  expect(installed.workflows[0]).toMatchObject({ agent: installed.agentPath, strategy: { agent: installed.agentPath }, package: { namespace: 'installed', installationId: installed.id, revisionDigest: preview.revisionDigest } })
  expect(Object.isFrozen(installed.workflows[0].strategy)).toBe(true)
  expect((await hub.store.get('settings', 'agent-installations:v1')).value.records[0].workflows).toBeUndefined()
})

test('restore rederives workflows from verified bytes, ignores forged record metadata and disables corrupted sources', async () => {
  const pkg = await importAgentPackage(workflowSource())
  const record = { version: 1, id: 'source', createdAt: 1, data: pkg.data, bindings, leadAgentId: 'lead', workflows: [{ id: 'forged', agent: 'bundled/escape/main' }], defaultWorkflow: 'forged', leadRequireVerification: true }
  const { hub, manager, catalogue } = await fixture([record])
  await manager.restore()
  const restored = manager.list()[0]
  expect(restored).toMatchObject({ defaultWorkflow: 'inspect', leadRequireVerification: false })
  expect(restored.workflows.map(row => row.id)).toEqual(['inspect'])
  expect(restored.workflows[0].agent).toBe('installed/source/lead')
  delete catalogue.models.local
  expect(manager.list()[0]).toMatchObject({ status: 'disabled', workflows: [], defaultWorkflow: null })
  catalogue.models.local = { provider: 'scripted' }
  hub.readyInfo.set('installed/source/lead', { error: 'Worker initialization failed' })
  expect(manager.list()[0]).toMatchObject({ status: 'disabled', workflows: [], defaultWorkflow: null })
  const row = await hub.store.get('settings', 'agent-installations:v1')
  row.value.records[0].data.files.find(file => file.path === 'workflows.json').content = btoa('{"forged":true}')
  await hub.store.put('settings', row)
  await manager.restore()
  expect(manager.list()[0]).toMatchObject({ status: 'disabled', workflows: [], defaultWorkflow: null, leadRequireVerification: false })
  expect(hub.specs.has('installed/source/lead')).toBe(false)
})

test('stop during post-commit tool inspection retains saved bytes but exposes no usable workflows', async () => {
  const { hub, manager } = await fixture(); hub.store.durable = true
  const preview = await manager.preview(workflowSource())
  let release; let entered
  const gate = new Promise(resolve => { release = resolve })
  const waiting = new Promise(resolve => { entered = resolve })
  hub.probe = async () => { entered(); await gate }
  const pending = manager.install(preview.stageId, bindings)
  await waiting
  expect((await hub.store.get('settings', 'agent-installations:v1')).value.records).toHaveLength(1)
  hub.disposed = true; release()
  await expect(pending).rejects.toThrow('stopped before its tools were inspected')
  expect(manager.list()[0]).toMatchObject({ status: 'disabled', workflows: [], defaultWorkflow: null })
  expect(hub.specs.size).toBe(0)
  expect((await hub.store.get('settings', 'agent-installations:v1')).value.records[0].data.revisionDigest).toBe(preview.revisionDigest)
})

test('a no-manifest installation preserves selected lead and derives its legacy verification requirement', async () => {
  const pkg = await importAgentPackage([...source, { path: 'coding/agent.md', content: '---\nid: coder\nrequire_verification: true\n---\nCheck the artifact.\n' }])
  const record = { version: 1, id: 'legacy', createdAt: 1, data: pkg.data, bindings, leadAgentId: 'coder' }
  const { manager } = await fixture([record]); await manager.restore()
  expect(manager.list()[0]).toMatchObject({ agentPath: 'installed/legacy/coder', leadAgentId: 'coder', leadRequireVerification: true, workflows: [], defaultWorkflow: null })
})

test('duplicate stored installation identities disable the conflicting installation without touching source records or bundled specs', async () => {
  const pkg = await importAgentPackage(source)
  const record = { version: 1, id: 'same', createdAt: 1, data: pkg.data, bindings, leadAgentId: 'lead' }
  const { hub, manager } = await fixture([record, { ...record, createdAt: 2 }])
  const bundled = { path: 'bundled/same/lead' }; hub.specs.set(bundled.path, bundled)
  await manager.restore()
  expect(manager.list()[0]).toMatchObject({ status: 'disabled', error: 'Duplicate installation identity in saved packages.' })
  expect(hub.specs.has('installed/same/lead')).toBe(false)
  expect(hub.specs.get(bundled.path)).toBe(bundled)
  expect((await hub.store.get('settings', 'agent-installations:v1')).value.records).toHaveLength(2)
})
