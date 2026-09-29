import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Hub } from '../src/runtime/hub.js'
import { installationDecision } from '../src/runtime/agent-installations.js'
import { listing } from '../scripts/listing.js'

const done = JSON.stringify({ do: 'done', act: 'Package response complete.' })
const action = (name, args = {}) => JSON.stringify({ do: 'tool', act: [[{ name, args }]] })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const bundled = id => `bundled/fixture/${id}`
const records = (extra = '', child = '') => [
  { path: 'agent.md', content: `---\npackage_id: example.desk\npackage_version: 1.0.0\nid: coordinator\nname: PackageMain\nmodel: reasoning\nmax_steps: 3\n${extra}\n---\nAuthored package instructions, unchanged.\n` },
  ...(child ? [{ path: 'review/agent.md', content: `---\nid: reviewer\nname: Reviewer\nmodel: reasoning\n${child}\n---\nReview only the requested facts.\n` }] : []),
]
async function fixture(script = {}, files = []) {
  const site = await mkdtemp(join(tmpdir(), 'askk-runtime-package-')); let hub
  try {
    await mkdir(join(site, 'agents'), { recursive: true })
    for (const name of ['main', 'compactor', 'dreamer']) {
      const directory = join(site, 'packages/fixture', ...(name === 'main' ? [] : [name]))
      await mkdir(directory, { recursive: true })
      const identity = name === 'main' ? 'package_id: test.bundled\npackage_version: 1.0.0\n' : ''
      await writeFile(join(directory, 'agent.md'), `---\n${identity}id: ${name}\nname: ${name}\ncontract_version: 2\nmax_steps: 1\ntools: []\n---\nDesk bundled fixture.`)
    }
    await writeFile(join(site, 'desk.json'), JSON.stringify({ version: 1, defaultAgent: bundled('main'), packages: [{ id: 'fixture', path: 'packages/fixture', models: { $default: '$default' }, tools: [] }] }))
    await mkdir(join(site, 'skills'), { recursive: true })
    await writeFile(join(site, 'skills', 'check.md'), '---\nname: global-check\n---\nGLOBAL SKILL MUST NOT LEAK')
    for (const file of files) { await mkdir(join(site, file.path, '..'), { recursive: true }); await writeFile(join(site, file.path), file.content) }
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: { provider: 'scripted', model: 'fixture-model', max_output_tokens: 512, script: { main: [done], dreamer: [done], compactor: [done], PackageMain: [done], Reviewer: [done], ...script } } } }))
    await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `packages-${crypto.randomUUID()}` })
    await hub.start()
    expect(hub.defaultAgentPath()).toBe(bundled('main'))
    expect([...hub.specs.values()].every(spec => spec.package.namespace === 'bundled')).toBe(true)
    // Bun has no IndexedDB here. Its acknowledged in-memory store exercises runtime
    // boundaries; a separate assertion verifies the normal non-durable refusal.
    return { hub, site, durable() { hub.store.durable = true }, close: async () => { hub.stop(); await rm(site, { recursive: true, force: true }) } }
  } catch (error) { hub?.stop(); await rm(site, { recursive: true, force: true }); throw error }
}
const install = async (f, input, options = {}) => { f.durable(); const stage = await f.hub.packages.preview(input); return f.hub.packages.install(stage.stageId, { models: { reasoning: 'fixture' }, tools: [], ...options }) }

test('preview is immutable metadata and install durably registers without creating agent work', async () => {
  const f = await fixture()
  try {
    f.hub.fileCatalogue.models.unrelated = null
    const input = records('tools: [host]')
    const stage = await f.hub.packages.preview(input)
    input[0].content = 'tampered after preview'
    expect(Object.isFrozen(stage.agents[0])).toBe(true)
    expect(stage.files.every(file => Object.keys(file).sort().join(',') === 'bytes,path')).toBe(true)
    expect(stage).toMatchObject({ packageId: 'example.desk', entryAgentId: 'coordinator', modelAliases: ['reasoning'] })
    expect(stage.availableModels).toEqual([{ id: 'fixture', label: 'fixture — fixture-model' }])
    expect('data' in stage).toBe(false)
    await expect(f.hub.packages.install(stage.stageId, { models: { reasoning: 'fixture' }, tools: ['host'] })).rejects.toThrow('durable browser storage')
    f.durable()
    const item = await f.hub.packages.install(stage.stageId, { models: { reasoning: 'fixture' }, tools: ['host'] })
    expect(item).toMatchObject({ status: 'ready', packageId: 'example.desk', leadModel: 'fixture', modelBindings: { reasoning: 'fixture' } })
    expect(f.hub.runs.size).toBe(0)
    expect(f.hub.specs.get(item.agentPath).body).toBe('Authored package instructions, unchanged.\n')
    expect(f.hub.manifest().find(agent => agent.path === item.agentPath)).toMatchObject({ package: { installationId: item.id, revisionDigest: stage.revisionDigest } })
    expect(f.hub.manifest().find(agent => agent.path === item.agentPath).unavailable.find(tool => tool.name === 'host_exec')).toMatchObject({ available: false, requires: ['host:legacy-bridge', 'host:exec'] })
    expect((await f.hub.store.get('settings', 'agent-installations:v1')).value.records).toHaveLength(1)
    expect(f.hub.packages.list()[0]).toEqual(item)
  } finally { await f.close() }
}, 15000)

test('quota failure and an admission change leave no installed specs or claimed success', async () => {
  const f = await fixture()
  try {
    f.durable()
    const stage = await f.hub.packages.preview(records())
    const original = f.hub.store.update
    f.hub.store.update = async () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') }
    await expect(f.hub.packages.install(stage.stageId, { models: { reasoning: 'fixture' }, tools: [] })).rejects.toThrow('Quota exceeded')
    expect(f.hub.packages.list()).toEqual([])
    expect([...f.hub.specs.keys()].some(path => path.startsWith('installed/'))).toBe(false)
    f.hub.store.update = original
    await expect(f.hub.packages.install(stage.stageId, { models: { reasoning: 'fixture' }, tools: [], admissionGuard: () => false })).rejects.toThrow('desk changed')
    expect(await f.hub.store.get('settings', 'agent-installations:v1')).toBeUndefined()
    expect((await f.hub.packages.install(stage.stageId, { models: { reasoning: 'fixture' }, tools: [] })).status).toBe('ready')
  } finally { await f.close() }
}, 15000)

test('a late transaction acknowledgment after stop cannot start workers or report an active installation', async () => {
  const f = await fixture()
  try {
    f.durable()
    const stage = await f.hub.packages.preview(records())
    const update = f.hub.store.update; let release; let committed
    const atCommit = new Promise(resolve => { committed = resolve })
    const barrier = new Promise(resolve => { release = resolve })
    f.hub.store.update = async (...args) => { const result = await update(...args); committed(); await barrier; return result }
    const pending = f.hub.packages.install(stage.stageId, { models: { reasoning: 'fixture' }, tools: [] })
    await atCommit; f.hub.stop(); release()
    await expect(pending).rejects.toThrow('saved, but the desk changed')
    expect(f.hub.allThreads.size).toBe(0)
    expect(f.hub.packages.list()[0].status).toBe('disabled')
    expect((await f.hub.store.get('settings', 'agent-installations:v1')).value.records).toHaveLength(1)
  } finally { await f.close() }
}, 15000)

test('real workers delegate only through package aliases and persist exact package identity in evidence', async () => {
  const f = await fixture({ PackageMain: [action('review', { query: 'Check the package facts.' }), done] })
  try {
    const item = await install(f, records('agents: {review: reviewer}', 'tools: []'))
    const root = f.hub.startRun(item.agentPath, 'Coordinate this task.')
    await root.answer
    expect(root.slot.status).toBe('done'); expect(root.children).toHaveLength(1)
    const child = f.hub.runs.get(root.children[0])
    expect(child.agent).toBe(`installed/${item.id}/reviewer`)
    expect(child.package).toMatchObject({ installationId: item.id, packageId: 'example.desk', revisionDigest: item.revisionDigest, agentId: 'reviewer' })
    expect(root.prompts[0].sheet).toContain('- review(')
    expect(root.prompts[0].sheet).not.toContain('- Reviewer(')
    expect(f.hub.run(root.id).package).toEqual(root.package)
    expect((await f.hub.initMessage(f.hub.specs.get(item.agentPath))).services).toEqual({})
    await expect(f.hub.ops.call.call(f.hub, { agent: bundled('main'), query: 'Escape' }, root)).rejects.toThrow('package-local')
    await expect(f.hub.ops.call.call(f.hub, { agent: bundled('compactor'), query: 'Escape', call: 'compactor(history)', infrastructure: 'compaction' }, root)).rejects.toThrow('configured service channel')
    expect(f.hub.dreamTimer).toBeNull()
    await f.hub.persist(root)
    expect((await f.hub.store.get('runs', root.id)).package.revisionDigest).toBe(item.revisionDigest)
  } finally { await f.close() }
}, 15000)

test('imported permission requests cannot relax owner rules and stricter declarations override saved Always rules', async () => {
  const f = await fixture({ PackageMain: [action('files_write', { path: 'proof.txt', content: 'approved' }), done, action('files_write', { path: 'proof.txt', content: 'again' }), done] })
  try {
    const approvals = []
    f.hub.saved.policy = { defaults: { read: 'allow', write: 'ask' }, rules: { '*': { files_write: 'allow' } } }
    f.hub.subscribe(event => { if (event.type === 'approval') { approvals.push(event.approval); f.hub.approvalsApi.answer(event.approval.id, { approved: true }) } })
    const item = await install(f, records('tools: [files]\nsession: agent\npermissions: {files_write: ask}'), { tools: ['files'] })
    for (const query of ['First write.', 'Second write.']) await f.hub.startRun(item.agentPath, query).answer
    expect(approvals).toHaveLength(2)
    expect((await f.hub.store.get('files', 'proof.txt')).content).toBe('again')
    const verdict = installationDecision({ name: 'files_write', risk: 'write' }, {}, { agent: item.agentPath, policy: { defaults: { write: 'deny' } } }, { files_write: 'allow' })
    expect(verdict.action).toBe('deny')
    expect(installationDecision({ name: 'files_write', risk: 'write' }, {}, { agent: item.agentPath, policy: { defaults: { write: 'ask' } } }, { files_write: 'allow' }).action).toBe('ask')
  } finally { await f.close() }
}, 15000)

test('package skill tools read only exact declared resources and never publish global skills', async () => {
  const body = 'Exact skill\r\nPreserve spacing.  \r\n'
  const f = await fixture({ PackageMain: [action('skill_load', { name: 'skills/check.md' }), done] })
  try {
    const item = await install(f, [...records('skills: [skills/check.md]'), { path: 'skills/check.md', content: body }], { tools: ['skill'] })
    const run = f.hub.startRun(item.agentPath, 'Read the package skill.'); await run.answer
    expect(run.toolEvents.find(event => event.kind === 'observation').value).toContain(body)
    expect(run.prompts.map(prompt => prompt.sheet).join('\n')).not.toContain('GLOBAL SKILL')
    expect(f.hub.manifest().find(agent => agent.path === item.agentPath).tools.some(tool => tool.name === 'skill_save')).toBe(false)
    expect(await f.hub.ops['skill.list'].call(f.hub, {}, run)).toEqual([{ name: 'skills/check.md', description: 'Package-local skill', source: 'package' }])
    expect(await f.hub.ops['skill.load'].call(f.hub, { name: 'global-check' }, run)).toBeNull()
    await expect(f.hub.ops['skill.save'].call(f.hub, { name: 'global', body: 'no' }, run)).rejects.toThrow('immutable')
  } finally { await f.close() }
}, 15000)

test('task sessions stay fresh even for writer tools; agent sessions retain prior turns across folder reload', async () => {
  for (const session of ['task', 'agent']) {
    const f = await fixture()
    try {
      const item = await install(f, records(`tools: [files]\nremembers: true\nsession: ${session}`), { tools: ['files'] })
      const first = f.hub.startRun(item.agentPath, 'UNIQUE_PREVIOUS_PACKAGE_TURN'); await first.answer
      expect(f.hub.isResident(f.hub.specs.get(item.agentPath))).toBe(session === 'agent')
      if (session === 'agent') { await pause(0); f.hub.retire(f.hub.threads.get(item.agentPath)) }
      await f.hub.readFolders()
      expect(f.hub.packages.list()[0]).toMatchObject({ id: item.id, status: 'ready' })
      const second = f.hub.startRun(item.agentPath, 'Follow up.'); await second.answer
      expect(second.prompts[0].sheet.includes('UNIQUE_PREVIOUS_PACKAGE_TURN')).toBe(session === 'agent')
    } finally { await f.close() }
  }
}, 15000)

test('restoration revalidates bytes and bindings, preserving visible disabled records without running them', async () => {
  const f = await fixture()
  try {
    const item = await install(f, records())
    const saved = await f.hub.store.get('settings', 'agent-installations:v1')
    saved.value.records[0].data.files[0].content = btoa('corrupted authored bytes')
    await f.hub.store.put('settings', saved)
    await f.hub.readFolders()
    expect(f.hub.packages.list()[0]).toMatchObject({ id: item.id, status: 'disabled', agentPath: item.agentPath })
    expect(f.hub.specs.has(item.agentPath)).toBe(false)
    expect(f.hub.runs.size).toBe(0)
    expect((await f.hub.store.get('settings', 'agent-installations:v1')).value.records[0].data.files[0].content).toBe(btoa('corrupted authored bytes'))
  } finally { await f.close() }
}, 15000)

test('missing model bindings fail install and deletion later rejects before allocating a run', async () => {
  const f = await fixture()
  try {
    f.durable(); const stage = await f.hub.packages.preview(records())
    await expect(f.hub.packages.install(stage.stageId, { models: {}, tools: [] })).rejects.toThrow('bind requested model alias')
    await expect(f.hub.packages.install(stage.stageId, { models: { reasoning: 'raw-provider-model-id' }, tools: [] })).rejects.toThrow('raw model IDs')
    const item = await f.hub.packages.install(stage.stageId, { models: { reasoning: 'fixture' }, tools: [] })
    f.hub.fileCatalogue.models.fixture = null
    expect(() => f.hub.startRun(item.agentPath, 'A null profile is not a model ID.')).toThrow('no longer configured')
    expect(f.hub.packages.list()[0].status).toBe('disabled')
    expect(f.hub.manifest().find(agent => agent.path === item.agentPath).model).toBe('')
    f.hub.fileCatalogue.models = {}
    expect(() => f.hub.startRun(item.agentPath, 'Do not silently resolve a raw ID.')).toThrow('no longer configured')
    expect(f.hub.runs.size).toBe(0)
    expect(f.hub.packages.list()[0]).toMatchObject({ status: 'disabled', leadModel: 'fixture' })
    expect(f.hub.manifest().find(agent => agent.path === item.agentPath)).toMatchObject({ model: '', alias: 'fixture' })
    await f.hub.packages.restore()
    expect(f.hub.specs.has(item.agentPath)).toBe(false)
    expect(f.hub.packages.list()[0].error).toContain('existing desk model profile')
  } finally { await f.close() }
}, 15000)

test('staging is bounded and executable package files never reach a worker', async () => {
  const f = await fixture()
  try {
    f.durable(); const first = await f.hub.packages.preview(records())
    for (let i = 0; i < 3; i++) await f.hub.packages.preview(records())
    await expect(f.hub.packages.install(first.stageId, { models: { reasoning: 'fixture' }, tools: [] })).rejects.toThrow('preview expired')
    const workers = f.hub.allThreads.size
    await expect(f.hub.packages.preview([...records(), { path: 'tools/evil.js', content: 'globalThis.unsafe = true' }])).rejects.toThrow('executable source')
    expect(f.hub.allThreads.size).toBe(workers); expect(f.hub.runs.size).toBe(0)
  } finally { await f.close() }
}, 15000)

test('install captures choices before queued work and transaction merges concurrent installations', async () => {
  const f = await fixture()
  try {
    f.durable()
    const one = await f.hub.packages.preview(records()), two = await f.hub.packages.preview(records())
    const options = { models: { reasoning: 'fixture' }, tools: [] }
    const first = f.hub.packages.install(one.stageId, options)
    options.models.reasoning = 'invalid-after-call'; options.tools.push('host')
    const second = f.hub.packages.install(two.stageId, { models: { reasoning: 'fixture' }, tools: [] })
    const [a, b] = await Promise.all([first, second])
    expect(a.modelBindings).toEqual({ reasoning: 'fixture' }); expect(a.id).not.toBe(b.id)
    expect(f.hub.packages.list()).toHaveLength(2)
    expect((await f.hub.store.get('settings', 'agent-installations:v1')).value.records).toHaveLength(2)
  } finally { await f.close() }
}, 15000)

test('installed memories isolate private agents and explicitly shared task scope; session reads cannot cross agents', async () => {
  const f = await fixture()
  try {
    const item = await install(f, records('agents: [reviewer]\ntools: [memory, sessions]', 'tools: [memory]'), { tools: ['memory', 'sessions'] })
    const root = f.hub.startRun(item.agentPath, 'FIRST_PRIVATE_SESSION'); await root.answer
    const sameTask = f.hub.startRun(`installed/${item.id}/reviewer`, 'CHILD_PRIVATE_SESSION', { parent: root.id }); await sameTask.answer
    const otherTask = f.hub.startRun(item.agentPath, 'SECOND_PRIVATE_SESSION'); await otherTask.answer
    const native = f.hub.startRun(bundled('main'), 'NATIVE_PRIVATE_SESSION'); await native.answer
    const save = (run, text, scope) => f.hub.ops['memory.save'].call(f.hub, { text, scope }, run)
    const shared = await save(root, 'TASK SHARED', 'shared')
    const own = await save(root, 'PRIVATE OWNER', 'agent')
    await save(sameTask, 'PRIVATE REVIEWER', 'agent'); const global = await save(native, 'DESK GLOBAL', 'shared')
    const list = run => f.hub.ops['memory.list'].call(f.hub, {}, run)
    expect((await list(root)).map(row => row.text).sort()).toEqual(['PRIVATE OWNER', 'TASK SHARED'])
    expect((await list(sameTask)).map(row => row.text).sort()).toEqual(['PRIVATE REVIEWER', 'TASK SHARED'])
    expect((await list(otherTask)).map(row => row.text)).toEqual(['PRIVATE OWNER'])
    expect((await list(native)).map(row => row.text)).toEqual(['DESK GLOBAL'])
    await expect(f.hub.ops['memory.forget'].call(f.hub, { id: global.id }, root)).rejects.toThrow('their own')
    await expect(f.hub.ops['memory.forget'].call(f.hub, { id: own.id }, sameTask)).rejects.toThrow('their own')
    expect(await f.hub.ops['memory.forget'].call(f.hub, { id: shared.id }, sameTask)).toBe(true)
    await expect(f.hub.ops['sessions.read'].call(f.hub, { id: native.id }, root)).rejects.toThrow('only their own')
    await expect(f.hub.ops['sessions.read'].call(f.hub, { id: sameTask.id }, root)).rejects.toThrow('only their own')
    expect(await f.hub.ops['sessions.read'].call(f.hub, { id: root.id }, otherTask)).toContain('FIRST_PRIVATE_SESSION')
    expect(await f.hub.ops['sessions.search'].call(f.hub, { query: 'NATIVE_PRIVATE_SESSION' }, root)).toEqual([])
    await expect(f.hub.ops['schedule.add'].call(f.hub, { agent: bundled('main'), query: 'escape', in_minutes: 1 }, root)).rejects.toThrow('deferred run authority')
    expect(() => f.hub.ops['schedule.list'].call(f.hub, {}, root)).toThrow('unavailable')
    expect(() => f.hub.ops['schedule.cancel'].call(f.hub, { id: 1 }, root)).toThrow('unavailable')
    expect(f.hub.scheduled.items).toEqual([])
  } finally { await f.close() }
}, 15000)

test('reloading a changed trusted common module rebuilds an installed resident from its compiled hash', async () => {
  const toolSource = value => `export const trusted_read = {description:'Trusted desk module',parameters:{},risk:'read',run:()=>${JSON.stringify(value)}}`
  const f = await fixture({ PackageMain: [action('trusted_read'), done] }, [{ path: 'tools/trusted.js', content: toolSource('before') }])
  try {
    const item = await install(f, records('tools: [trusted]\nsession: agent'), { tools: ['trusted'] })
    const first = f.hub.startRun(item.agentPath, 'Read first version.'); await first.answer
    const worker = f.hub.threads.get(item.agentPath)
    expect(first.toolEvents.find(event => event.kind === 'observation').value).toBe('before')
    await writeFile(join(f.site, 'tools/trusted.js'), toolSource('after'))
    await writeFile(join(f.site, 'agents/index.json'), JSON.stringify(await listing(f.site)))
    const refreshed = await f.hub.reloadAgents()
    expect(refreshed.changed.some(row => row.path === item.agentPath)).toBe(true)
    expect(f.hub.threads.get(item.agentPath)).not.toBe(worker)
    const second = f.hub.startRun(item.agentPath, 'Read changed version.'); await second.answer
    expect(second.toolEvents.find(event => event.kind === 'observation').value).toBe('after')
  } finally { await f.close() }
}, 15000)

test('a package delegate collision is visibly disabled after persistence instead of claiming a runnable agent', async () => {
  const f = await fixture()
  try {
    const item = await install(f, records('tools: [files]\nagents: {files_read: reviewer}', 'tools: []'), { tools: ['files'] })
    expect(item.status).toBe('disabled')
    expect(item.error).toContain('collides with a tool')
    expect(f.hub.specs.has(item.agentPath)).toBe(false)
    expect(f.hub.runs.size).toBe(0)
    expect((await f.hub.store.get('settings', 'agent-installations:v1')).value.records).toHaveLength(1)
  } finally { await f.close() }
}, 15000)

test('a restored package is disabled when its fresh startup worker fails initialization', async () => {
  const f = await fixture(); let restored
  try {
    const item = await install(f, records('tools: [files]\nagents: {files_read: reviewer}', 'tools: []'), { tools: ['files'] })
    expect(item.status).toBe('disabled')
    // A new Hub has no cached readyInfo. Exercise the same verified restore and
    // thread initialization phases as start(), using the acknowledged saved record.
    restored = new Hub({ base: f.hub.base })
    restored.store = f.hub.store
    await restored.readFolders()
    expect(restored.defaultAgentPath()).toBe(bundled('main'))
    expect(['main', 'compactor', 'dreamer'].every(id => restored.specs.get(bundled(id))?.package.namespace === 'bundled')).toBe(true)
    expect(restored.readyInfo.has(item.agentPath)).toBe(false)
    await restored.startThreads()
    expect(restored.packages.list()[0]).toMatchObject({ id: item.id, status: 'disabled' })
    expect(restored.packages.list()[0].error).toContain('collides with a tool')
    expect(restored.runs.size).toBe(0)
    expect((await restored.store.get('settings', 'agent-installations:v1')).value.records).toHaveLength(1)
  } finally { restored?.stop(); await f.close() }
}, 15000)

test('a new Hub restores owner packages beside bundled packages through the same desk loader', async () => {
  const f = await fixture(); let restored
  try {
    const item = await install(f, records('agents: {review: reviewer}', 'tools: []'))
    const originalBundled = f.hub.specs.get(bundled('main'))
    const originalImported = f.hub.specs.get(item.agentPath)
    restored = new Hub({ base: f.hub.base })
    // Share the acknowledged store, not any compiled spec or cached worker state.
    restored.store = f.hub.store
    await restored.readFolders()
    expect(restored.defaultAgentPath()).toBe(bundled('main'))
    expect([...restored.specs.keys()].sort()).toEqual([
      ...['main', 'compactor', 'dreamer'].map(bundled), item.agentPath, `installed/${item.id}/reviewer`,
    ].sort())
    expect(restored.specs.get(bundled('main'))).toEqual(originalBundled)
    expect(restored.specs.get(item.agentPath)).toEqual(originalImported)
    expect(restored.packages.list()[0]).toMatchObject({ id: item.id, status: 'ready' })
    expect(restored.allThreads.size).toBe(0)
    await restored.startThreads()
    const ownerRun = restored.startRun(item.agentPath, 'Use the restored owner definition.')
    const deskRun = restored.startRun(bundled('main'), 'Use the restored bundled definition.')
    await Promise.all([ownerRun.answer, deskRun.answer])
    expect(ownerRun.slot.status).toBe('done'); expect(deskRun.slot.status).toBe('done')
    expect(ownerRun.package.namespace).toBe('installed'); expect(deskRun.package.namespace).toBe('bundled')
  } finally { restored?.stop(); await f.close() }
}, 15000)
