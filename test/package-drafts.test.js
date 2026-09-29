import { expect, test } from 'bun:test'
import { PackageDrafts } from '../src/runtime/package-drafts.js'
import { AgentInstallations } from '../src/runtime/agent-installations.js'
import { openStore } from '../src/runtime/store.js'

const files = [{ path: 'agent.md', content: '---\npackage_id: example.draft\npackage_version: 1.0.0\nid: lead\n---\nOriginal instructions.\n' }]
const bindings = { models: { $default: '$default' }, tools: [] }
async function fixture() {
  const store = await openStore(`drafts-${crypto.randomUUID()}`); store.durable = true
  const hub = { store, started: true, disposed: false, lockState: 'leader', catalogue: () => ({ default: 'local', models: { local: { provider: 'scripted', script: [] } } }), index: { files: {} }, specs: new Map(), failed: new Map(), readyInfo: new Map(), publish() {}, async probe() {} }
  hub.packages = new AgentInstallations(hub)
  return { hub, drafts: new PackageDrafts(hub) }
}

test('incomplete drafts survive reload and compiler errors without entering the agent catalogue', async () => {
  const { hub, drafts } = await fixture()
  const draft = await drafts.create({ label: 'Unfinished', files: [{ path: 'agent.md', content: '---\nbroken: [' }] })
  await expect(drafts.preview(draft.id)).rejects.toThrow()
  const restored = new PackageDrafts(hub)
  expect((await restored.read(draft.id)).files[0].content).toBe('---\nbroken: [')
  expect(await restored.list()).toMatchObject([{ label: 'Unfinished', version: 1, fileCount: 1 }])
  expect(hub.specs.size).toBe(0)
  expect(hub.packages.list()).toEqual([])
})

test('save uses optimistic concurrency and rejects unsafe or generated paths', async () => {
  const { drafts } = await fixture()
  const draft = await drafts.create({ files })
  const next = await drafts.save(draft.id, { expectedVersion: 1, files: [] })
  expect(next).toMatchObject({ version: 2, files: [] })
  await expect(drafts.save(draft.id, { expectedVersion: 1, files })).rejects.toThrow('changed')
  for (const path of ['../outside.md', '/absolute.md', 'askk.lock.json', 'nested/ASKK.lock.json']) await expect(drafts.save(draft.id, { expectedVersion: 2, files: [{ path, content: '' }] })).rejects.toThrow()
  expect((await drafts.read(draft.id)).files).toEqual([])
})

test('review is tied to exact saved draft version and new installation preserves previous immutable specs', async () => {
  const { hub, drafts } = await fixture()
  const draft = await drafts.create({ files })
  const firstPreview = await drafts.preview(draft.id)
  const first = await drafts.install(draft.id, { ...bindings, expectedVersion: 1, stageId: firstPreview.stageId })
  const original = hub.specs.get(first.agentPath)
  const stale = await drafts.preview(draft.id)
  await drafts.save(draft.id, { expectedVersion: 1, files: [{ ...files[0], content: files[0].content.replace('Original', 'Revised') }] })
  await expect(drafts.install(draft.id, { ...bindings, expectedVersion: 2, stageId: stale.stageId })).rejects.toThrow('review')
  const preview = await drafts.preview(draft.id)
  const second = await drafts.install(draft.id, { ...bindings, expectedVersion: 2, stageId: preview.stageId })
  expect(second.id).not.toBe(first.id)
  expect(hub.specs.get(first.agentPath)).toBe(original)
  expect(original.body).toContain('Original')
  expect(hub.specs.get(second.agentPath).body).toContain('Revised')
  expect(original.package.revisionDigest).not.toBe(second.revisionDigest)
})

test('quota failures preserve saved draft, reviewed stage and previous installed bytes', async () => {
  const { hub, drafts } = await fixture()
  const draft = await drafts.create({ files })
  const preview = await drafts.preview(draft.id)
  const update = hub.store.update.bind(hub.store)
  hub.store.update = async () => { throw new Error('QuotaExceededError') }
  await expect(drafts.save(draft.id, { expectedVersion: 1, files: [] })).rejects.toThrow('Quota')
  expect((await drafts.read(draft.id)).files).toEqual(files)
  await expect(drafts.install(draft.id, { ...bindings, expectedVersion: 1, stageId: preview.stageId })).rejects.toThrow('Quota')
  expect(hub.specs.size).toBe(0)
  expect(hub.packages.list()).toEqual([])
  hub.store.update = update
  const installed = await drafts.install(draft.id, { ...bindings, expectedVersion: 1, stageId: preview.stageId })
  expect(installed.status).toBe('ready')
})

test('invalid binding cannot install and non-durable storage cannot claim to save', async () => {
  const { hub, drafts } = await fixture()
  const draft = await drafts.create({ files })
  const preview = await drafts.preview(draft.id)
  await expect(drafts.install(draft.id, { models: {}, tools: [], expectedVersion: 1, stageId: preview.stageId })).rejects.toThrow('bind requested model')
  expect(hub.specs.size).toBe(0)
  hub.store.durable = false
  await expect(drafts.save(draft.id, { expectedVersion: 1, files: [] })).rejects.toThrow('durable')
  expect((await drafts.read(draft.id)).files).toEqual(files)
})

test('sparse files, non-plain entries and malformed stored metadata never overwrite existing drafts', async () => {
  const { hub, drafts } = await fixture()
  const draft = await drafts.create({ files })
  for (const malformed of [Array(1), [null], [Object.create({ path: 'agent.md', content: '' })]]) {
    await expect(drafts.save(draft.id, { expectedVersion: 1, files: malformed })).rejects.toThrow()
    expect((await drafts.read(draft.id)).version).toBe(1)
  }
  const good = await hub.store.get('settings', 'package-drafts:v1')
  for (const record of [{ ...draft, id: 123 }, { ...draft, unexpected: 'must not leak into summaries' }, { ...draft, files: Array(1) }, { ...draft, files: [{ path: 'agent.md', content: 9 }] }]) {
    const bad = { key: 'package-drafts:v1', value: { version: 1, records: [record] } }
    await hub.store.put('settings', bad)
    await expect(drafts.list()).rejects.toThrow()
    await expect(drafts.create({ files })).rejects.toThrow()
    expect(await hub.store.get('settings', 'package-drafts:v1')).toEqual(bad)
  }
  await hub.store.put('settings', good)
  expect((await drafts.read(draft.id)).files).toEqual(files)
})

test('revision overflow is rejected while saved bytes remain readable', async () => {
  const { hub, drafts } = await fixture()
  const draft = await drafts.create({ files })
  await hub.store.put('settings', { key: 'package-drafts:v1', value: { version: 1, records: [{ ...draft, version: Number.MAX_SAFE_INTEGER }] } })
  await expect(drafts.save(draft.id, { expectedVersion: Number.MAX_SAFE_INTEGER, files: [] })).rejects.toThrow('revision limit')
  expect((await drafts.read(draft.id)).files).toEqual(files)
})

test('separate managers serialize a save behind a reviewed installation waiting on the package queue', async () => {
  const { hub, drafts } = await fixture()
  const other = new PackageDrafts(hub)
  const draft = await drafts.create({ files })
  const preview = await drafts.preview(draft.id)
  let release, entered
  const barrier = new Promise(resolve => { release = resolve })
  const waiting = new Promise(resolve => { entered = resolve })
  const originalInstall = hub.packages.install.bind(hub.packages)
  hub.packages.install = async (...args) => { entered(); await barrier; return originalInstall(...args) }
  const installing = drafts.install(draft.id, { ...bindings, expectedVersion: 1, stageId: preview.stageId })
  await waiting
  const editedFiles = [{ path: 'agent.md', content: 'Saved later, invalid for now.' }]
  const saving = other.save(draft.id, { expectedVersion: 1, files: editedFiles })
  editedFiles[0].content = 'Caller mutation must not change saved content.'
  expect((await other.read(draft.id)).version).toBe(1)
  release()
  const installed = await installing
  const saved = await saving
  expect(hub.specs.get(installed.agentPath).body).toContain('Original instructions')
  expect(saved).toMatchObject({ version: 2, files: [{ content: 'Saved later, invalid for now.' }] })
  await expect(drafts.install(draft.id, { ...bindings, expectedVersion: 1, stageId: preview.stageId })).rejects.toThrow('changed')
})

test('closing during preview rejects admission; closing after acknowledged save keeps durable bytes', async () => {
  const { hub, drafts } = await fixture()
  const draft = await drafts.create({ files })
  const preview = hub.packages.preview.bind(hub.packages)
  hub.packages.preview = async (...args) => { const result = await preview(...args); hub.disposed = true; return result }
  await expect(drafts.preview(draft.id)).rejects.toThrow('active agent desk')
  expect(drafts.reviews.size).toBe(0)
  hub.disposed = false
  const update = hub.store.update.bind(hub.store)
  hub.store.update = async (...args) => { const result = await update(...args); hub.disposed = true; return result }
  const saved = await drafts.save(draft.id, { expectedVersion: 1, label: 'Saved before close' })
  expect(saved).toMatchObject({ label: 'Saved before close', version: 2 })
  expect(await new PackageDrafts(hub).read(draft.id)).toEqual(saved)
})

test('portable backup preserves unfinished text and imports with a new identity without activation', async () => {
  const { hub, drafts } = await fixture()
  const authored = [{ path: 'agent.md', content: '---\nbroken: [\r\n\u0000😀\ud800' }, { path: 'notes/unfinished.txt', content: '' }]
  const draft = await drafts.create({ label: 'Unfinished 🧰', files: authored })
  await hub.store.put('settings', { key: 'provider-secret', value: { apiKey: 'never-export-this' } })
  const backup = await drafts.exportBackup(draft.id, { expectedVersion: 1 })
  expect(backup).toMatchObject({ filename: 'agent-draft.askk-draft.json', mimeType: 'application/json' })
  expect(JSON.parse(backup.text)).toEqual({ format: 'askk-agent-draft', version: 1, label: draft.label, files: authored })
  expect(backup.text).not.toContain('never-export-this')
  const imported = await drafts.importBackup(backup.text)
  const importedAgain = await drafts.importBackup(backup.text)
  expect(new Set([draft.id, imported.id, importedAgain.id]).size).toBe(3)
  expect(imported).toMatchObject({ version: 1, files: authored, label: draft.label })
  expect(await drafts.read(draft.id)).toEqual(draft)
  expect(drafts.reviews.size).toBe(0)
  expect(hub.packages.stages.size).toBe(0)
  expect(hub.packages.list()).toEqual([])
  expect(hub.specs.size).toBe(0)
})

test('backup export refuses stale revisions and follows preceding queued saves', async () => {
  const { drafts } = await fixture()
  const draft = await drafts.create({ files })
  const saving = drafts.save(draft.id, { expectedVersion: 1, label: 'Changed' })
  const exporting = drafts.exportBackup(draft.id, { expectedVersion: 1 })
  await saving
  await expect(exporting).rejects.toThrow('changed')
  await expect(drafts.exportBackup(draft.id)).rejects.toThrow('changed')
  const backup = await drafts.exportBackup(draft.id, { expectedVersion: 2 })
  expect(JSON.parse(backup.text).label).toBe('Changed')
})

test('backup rejects unsupported envelopes and unsafe files before creating anything', async () => {
  const { drafts } = await fixture()
  const draft = await drafts.create({ files })
  const good = { format: 'askk-agent-draft', version: 1, label: 'Imported', files }
  for (const value of [null, [], { ...good, version: 2 }, { ...good, format: 'package' }, { ...good, id: draft.id }, { ...good, bindings: {} }, { ...good, credentials: {} }, { ...good, history: [] }, { ...good, label: null }, { ...good, files: [{ path: '../agent.md', content: '' }] }, { ...good, files: [{ path: 'askk.lock.json', content: '' }] }, { ...good, files: [{ ...files[0], mode: 'text' }] }, { ...good, files: [files[0], { ...files[0], path: 'AGENT.md' }] }]) {
    await expect(drafts.importBackup(JSON.stringify(value))).rejects.toThrow()
  }
  await expect(drafts.importBackup('{')).rejects.toThrow('JSON')
  await expect(drafts.importBackup(good)).rejects.toThrow('text JSON')
  expect(await drafts.list()).toHaveLength(1)
  expect(await drafts.read(draft.id)).toEqual(draft)
})

test('backup import respects admission and failed writes preserve all prior work', async () => {
  const { hub, drafts } = await fixture()
  const draft = await drafts.create({ files })
  const backup = await drafts.exportBackup(draft.id, { expectedVersion: 1 })
  hub.store.durable = false
  await expect(drafts.importBackup(backup.text)).rejects.toThrow('durable')
  hub.store.durable = true
  hub.store.update = async () => { throw new Error('QuotaExceededError') }
  await expect(drafts.importBackup(backup.text)).rejects.toThrow('Quota')
  expect(await drafts.list()).toHaveLength(1)
  expect(await drafts.read(draft.id)).toEqual(draft)
  expect(drafts.reviews.size).toBe(0)
})
