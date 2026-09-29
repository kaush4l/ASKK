import { expect, test } from 'bun:test'
import { AgentInstallations } from '../src/runtime/agent-installations.js'
import { importAgentPackage } from '../src/core/agent-package.js'
import { compileAgentPackage } from '../src/core/package-spec.js'
import { openStore } from '../src/runtime/store.js'

const source = [{ path: 'agent.md', content: '---\npackage_id: example.same\npackage_version: 1.0.0\nid: lead\n---\nKeep the recorded identity.\n' }]
const bindings = { models: { $default: '$default' }, tools: [] }
async function fixture(records = []) {
  const catalogue = { default: 'local', models: { local: { provider: 'scripted', script: [] } } }
  const store = await openStore(`installations-${crypto.randomUUID()}`)
  const hub = { store, catalogue: () => catalogue, index: { files: {} }, specs: new Map(), failed: new Map(), readyInfo: new Map(), publish() {} }
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
