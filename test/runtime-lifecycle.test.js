import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from '../src/runtime/hub.js'

const done = text => JSON.stringify({ do: 'done', act: text })
const action = (name, args) => JSON.stringify({ do: 'tool', act: [[{ name, args }]] })
const path = name => `bundled/renamed/${name}`
const policy = overrides => ({ disabledTools: [], approvalRisks: [], allowDelegation: true, ...overrides })
const history = () => Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? 'observation' : 'user', content: `Observed fact ${index}. ${'Keep exact failure evidence. '.repeat(25)}`, at: index }))

async function fixture({ compact = false, script = {}, delay = 0 } = {}) {
  const site = await mkdtemp(join(tmpdir(), 'askk-renamed-lifecycle-')); let hub
  const definitions = {
    captain: `package_id: tests.renamed\npackage_version: 1.0.0\nid: captain\nname: Captain\nsession: agent\ntools: [todo]\nagents: {scribe: writer}\nservices: {compaction: digest, retrospective: reflect}\n${compact ? 'compact_at: 0.001\nkeep: 1\n' : ''}`,
    digest: 'id: digest\nname: Digest\nsession: task\ntools: []\ncontext: []\nmax_steps: 1\n',
    writer: 'id: writer\nname: Writer\nsession: task\ntools: [files]\npermissions: {files_write: allow}\n',
    reflect: 'id: reflect\nname: Reflect\nsession: agent\ntools: [memory, reflection]\npermissions: {memory_save: allow}\n',
  }
  const records = Object.entries(definitions).map(([name, front]) => ({ path: name === 'captain' ? 'agent.md' : `${name}/agent.md`, content: `---\n${front}contract_version: 2\nresponse_format: json\nmax_output_tokens: 512\n${name === 'digest' ? '' : 'max_steps: 3\n'}---\nUse only the supplied evidence and configured capabilities.` }))
  try {
    for (const record of records) { const file = join(site, 'packages/renamed', record.path); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, record.content) }
    await mkdir(join(site, 'tools'), { recursive: true }); await mkdir(join(site, 'agents'), { recursive: true })
    await cp(join(import.meta.dir, '../public/tools/reflection.js'), join(site, 'tools/reflection.js'))
    await writeFile(join(site, 'desk.json'), JSON.stringify({ version: 1, defaultAgent: path('captain'), packages: [{ id: 'renamed', path: 'packages/renamed', models: { $default: '$default' }, tools: ['todo', 'files', 'memory', 'reflection'] }] }))
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: { provider: 'scripted', model: 'fixture', delay, max_output_tokens: 512, script: { Captain: [done('Captain answered.')], Digest: [done('The prior work remains unverified.')], Writer: [done('Writer answered.')], Reflect: [done('No changes proposed.')], ...script } } } }))
    const relist = async () => writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
    await relist()
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `renamed-${crypto.randomUUID()}` })
    await hub.start(); await hub.settings.set({ dreaming: false })
    return { hub, site, records, relist, close: async () => { hub.stop(); await rm(site, { recursive: true, force: true }) } }
  } catch (error) { hub?.stop(); await rm(site, { recursive: true, force: true }); throw error }
}

test('renamed declarative default and explicit sessions are independent of names and writer capabilities', async () => {
  const f = await fixture()
  try {
    expect(f.hub.defaultAgent).toBe(path('captain'))
    expect(f.hub.specs.has('main')).toBe(false)
    expect(f.hub.isResident(f.hub.specs.get(path('writer')))).toBe(false)
    expect(f.hub.threads.has(path('writer'))).toBe(false)
    const first = f.hub.runs.get(f.hub.ask('First owner request'))
    await first.answer
    const second = f.hub.runs.get(f.hub.ask('Follow-up request'))
    await second.answer
    expect(second.prompts[0].sheet).toContain('First owner request')
    expect((await f.hub.session()).some(turn => turn.content === 'First owner request')).toBe(true)
    const a = f.hub.startRun(path('writer'), 'Private first task'); await a.answer
    const b = f.hub.startRun(path('writer'), 'Fresh second task'); await b.answer
    expect(b.prompts[0].sheet).not.toContain('Private first task')
    expect(await f.hub.session(path('writer'))).toEqual([])
    await f.hub.store.put('sessions', { agent: 'main', turns: [{ role: 'user', content: 'Archived old identity' }] })
    await f.hub.clearSession()
    expect(await f.hub.session()).toEqual([])
    expect((await f.hub.session('main'))[0].content).toBe('Archived old identity')
    f.hub.defaultAgent = null
    expect(() => f.hub.ask('No fallback')).toThrow('default agent')
  } finally { await f.close() }
}, 15000)

test('renamed compaction uses a pinned dedicated channel, fresh tool-free child, and cannot be impersonated by ordinary calls', async () => {
  const f = await fixture({ compact: true })
  try {
    f.hub.retire(f.hub.threads.get(path('captain')))
    await f.hub.store.put('sessions', { agent: path('captain'), turns: history() })
    const run = f.hub.startRun(path('captain'), 'Continue carefully', { context: { toolPolicy: policy({ allowDelegation: false }) } })
    await run.answer
    expect(run.slot.status).toBe('done'); expect(run.children).toHaveLength(1)
    const child = f.hub.runs.get(run.children[0])
    expect(child).toMatchObject({ agent: path('digest'), kind: 'compact', service: { kind: 'compaction', sourceRunId: run.id, sourceTrace: run.trace }, slot: { status: 'done' } })
    expect(child.prompts[0].sheet).not.toContain('## TOOLS')
    expect(child.toolEvents).toEqual([])
    expect(await f.hub.session(path('digest'))).toEqual([])
    await expect(f.hub.ops.call.call(f.hub, { agent: path('digest'), query: 'Escalate', infrastructure: 'compaction' }, run)).rejects.toThrow('service channel')
    await expect(f.hub.ops['service.compact'].call(f.hub, { query: 'Wrong target', agent: path('writer') }, run)).rejects.toThrow('bounded historical text')
    const pending = f.hub.createRun(path('captain'), 'Pinned pending run')
    const digest = f.hub.specs.get(path('digest'))
    f.hub.specs.set(digest.path, { ...digest, hash: 'changed-definition' })
    await expect(f.hub.ops['service.compact'].call(f.hub, { query: 'Old evidence' }, pending)).rejects.toThrow('changed or is unavailable')
    f.hub.abort(pending)
  } finally { await f.close() }
}, 15000)

test('retrospective inherits restrictions, exposes only source-task evidence, and cannot propose outside its source participants', async () => {
  const f = await fixture({ script: { Reflect: [action('memory_save', { text: 'Do not save this', scope: 'shared' }), action('propose', { agent: path('captain'), text: 'Preserve observed failures.', why: 'Task evidence' }), done('Proposed one scoped improvement.')] } })
  try {
    await f.hub.store.put('learned', { agent: path('captain'), text: 'Source-specific prior learning' })
    await f.hub.store.put('learned', { agent: 'installed/foreign/agent', text: 'UNRELATED PRIVATE LEARNING' })
    const context = { toolPolicy: policy({ disabledTools: ['memory_save'], approvalRisks: ['exec'] }), ownerMarker: 'pinned-owner-context' }
    const source = f.hub.runs.get(f.hub.ask('Review only this completed task', { context })); await source.answer
    const id = await f.hub.dream(source.trace); const retrospective = f.hub.runs.get(id); await retrospective.answer
    expect(retrospective.agent).toBe(path('reflect'))
    expect(retrospective.context).toMatchObject({ ownerMarker: context.ownerMarker, toolPolicy: { ...context.toolPolicy, allowDelegation: false } })
    expect(retrospective.service).toMatchObject({ kind: 'retrospective', sourceRunId: source.id, sourceTrace: source.trace, allowedTargets: [path('captain')] })
    expect(retrospective.query).toContain('Source-specific prior learning')
    expect(retrospective.query).not.toContain('UNRELATED PRIVATE LEARNING')
    expect(await f.hub.store.all('memory')).toEqual([])
    expect(await f.hub.session(path('reflect'))).toEqual([])
    const [proposal] = await f.hub.dreams.list()
    expect(proposal).toMatchObject({ agent: path('captain'), trace: source.trace, status: 'pending' })
    expect(proposal.targetHash).toBe(f.hub.specs.get(path('captain')).hash)
    await expect(f.hub.ops['dream.propose'].call(f.hub, { agent: path('writer'), text: 'Not a participant' }, retrospective)).rejects.toThrow('source-task agent target')
    await expect(f.hub.ops.call.call(f.hub, { agent: path('writer'), query: 'Escalate' }, retrospective)).rejects.toThrow('package-local')
    expect(await f.hub.dream(retrospective.trace)).toBeNull()
    const target = f.hub.specs.get(path('captain'))
    f.hub.specs.set(target.path, { ...target, hash: 'new-revision' })
    await expect(f.hub.ops['dream.propose'].call(f.hub, { agent: target.path, text: 'Stale target' }, retrospective)).rejects.toThrow('target changed')
    await expect(f.hub.dreams.accept(proposal.id)).rejects.toThrow('target is unavailable or changed')
    expect(await f.hub.learned.get(target.path)).toBe('Source-specific prior learning')
  } finally { await f.close() }
}, 15000)

test('authored permissions cannot weaken owner denial in a bundled real worker', async () => {
  const f = await fixture({ script: { Writer: [action('files_write', { path: 'denied.txt', content: 'never', expect: 0 }), done('Observed denial.')] } })
  try {
    await f.hub.settings.set({ policy: { defaults: { write: 'deny' } } })
    const metadata = f.hub.manifest().find(agent => agent.path === path('writer'))
    expect(metadata.tools.find(tool => tool.name === 'files_write').effectiveAction).toBe('deny')
    const run = f.hub.startRun(path('writer'), 'Attempt configured write'); await run.answer
    expect(run.toolEvents.find(event => event.kind === 'observation')).toMatchObject({ ok: false })
    expect(await f.hub.store.get('files', 'denied.txt')).toBeUndefined()
  } finally { await f.close() }
}, 15000)

test('owner-imported services retain package identity and task memory isolation without named runtime exceptions', async () => {
  const f = await fixture({ compact: true })
  try {
    f.hub.store.durable = true
    const preview = await f.hub.packages.preview(f.records)
    const installed = await f.hub.packages.install(preview.stageId, { models: { $default: '$default' }, tools: ['todo', 'files', 'memory', 'reflection'] })
    const sourcePath = installed.agentPath
    if (f.hub.threads.has(sourcePath)) f.hub.retire(f.hub.threads.get(sourcePath))
    await f.hub.store.put('sessions', { agent: sourcePath, turns: history() })
    const source = f.hub.startRun(sourcePath, 'Use only this installation', { context: { toolPolicy: policy({ allowDelegation: false }) } }); await source.answer
    const child = f.hub.runs.get(source.children[0])
    expect(child.package).toMatchObject({ namespace: 'installed', installationId: installed.id, revisionDigest: installed.revisionDigest })
    expect(child.agent).toBe(`installed/${installed.id}/digest`)
    expect(child.context.toolPolicy.allowDelegation).toBe(false)
    await f.hub.ops['memory.save'].call(f.hub, { text: 'Task-local memory', scope: 'shared' }, source)
    const review = f.hub.runs.get(await f.hub.dream(source.trace)); await review.answer
    expect((await f.hub.ops['memory.list'].call(f.hub, {}, review)).map(row => row.text)).toEqual(['Task-local memory'])
    expect(review.service.allowedTargets).toEqual([sourcePath])
    const unrelated = f.hub.runs.get(f.hub.ask('A different package task')); await unrelated.answer
    expect(await f.hub.ops['memory.list'].call(f.hub, {}, unrelated)).toEqual([])
    await f.hub.reloadAgents()
    expect(f.hub.packages.list().find(item => item.id === installed.id)).toMatchObject({ status: 'ready', agentPath: sourcePath })
    expect(f.hub.specs.get(sourcePath).services.compaction).toBe(`installed/${installed.id}/digest`)
  } finally { await f.close() }
}, 15000)

test('synchronous cancellation blocks a service request already queued for delivery', async () => {
  const f = await fixture()
  try {
    const parent = f.hub.createRun(path('captain'), 'A cancellation boundary')
    let abortSent = false
    parent.thread = { run: parent.id, worker: { postMessage(message) { abortSent = message.type === 'abort' } } }
    f.hub.abort(parent)
    expect(abortSent).toBe(true); expect(parent.ended).toBe(false)
    await expect(f.hub.ops['service.compact'].call(f.hub, { query: 'Arrived after abort' }, parent)).rejects.toThrow('No active run')
    await expect(f.hub.ops.call.call(f.hub, { agent: path('writer'), query: 'Late delegate' }, parent)).rejects.toThrow('No active run')
    expect(parent.children).toEqual([])
    f.hub.end(parent, 'Stopped', false, 'Stopped', { status: 'cancelled' })
  } finally { await f.close() }
}, 15000)

test('shared memory scopes separate bundled and installed namespaces while retaining historical installed keys', async () => {
  const f = await fixture()
  try {
    const base = { trace: 'same-trace', agent: 'test', package: { installationId: 'same-id', namespace: 'installed' } }
    const shipped = { ...base, package: { ...base.package, namespace: 'bundled' } }
    await f.hub.ops['memory.save'].call(f.hub, { text: 'Imported private scope', scope: 'shared' }, base)
    expect(await f.hub.ops['memory.list'].call(f.hub, {}, shipped)).toEqual([])
    expect(f.hub.memoryScope(base)).toBe('package-task:same-id:same-trace')
    expect(f.hub.memoryScope(shipped)).not.toBe(f.hub.memoryScope(base))
  } finally { await f.close() }
}, 15000)

test('a live compaction child receives parent cancellation and a finished parent cannot invoke another service', async () => {
  const f = await fixture({ compact: true, delay: 20 })
  try {
    f.hub.retire(f.hub.threads.get(path('captain')))
    await f.hub.store.put('sessions', { agent: path('captain'), turns: history() })
    const parent = f.hub.startRun(path('captain'), 'Cancel during the configured service')
    const deadline = Date.now() + 2000
    while (!parent.children.length || f.hub.runs.get(parent.children[0]).slot.status !== 'thinking') {
      if (Date.now() > deadline) throw new Error('Compaction child did not enter its worker')
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    const child = f.hub.runs.get(parent.children[0])
    f.hub.abort(parent)
    await Promise.all([parent.answer, child.answer])
    expect(parent.slot.status).toBe('cancelled'); expect(child.slot.status).toBe('cancelled')
    await expect(f.hub.ops['service.compact'].call(f.hub, { query: 'Too late' }, parent)).rejects.toThrow('No active run')
    expect((await f.hub.session(path('captain'))).some(turn => turn.role === 'summary')).toBe(false)
  } finally { await f.close() }
}, 15000)

test('a session configuration change retires the resident instead of retaining hidden history for future task invocations', async () => {
  const f = await fixture()
  try {
    const first = f.hub.runs.get(f.hub.ask('Earlier resident message')); await first.answer
    await writeFile(join(f.site, 'packages/renamed/agent.md'), f.records[0].content.replace('session: agent', 'session: task'))
    await f.relist(); await f.hub.reloadAgents()
    expect(f.hub.threads.has(path('captain'))).toBe(false)
    const second = f.hub.runs.get(f.hub.ask('New task session')); await second.answer
    expect(second.prompts[0].sheet).not.toContain('Earlier resident message')
    expect((await f.hub.session(path('captain'))).some(turn => turn.content === 'Earlier resident message')).toBe(true)
  } finally { await f.close() }
}, 15000)

test('invalid shipped reload preserves the last validated definitions, default, index and resident session', async () => {
  const f = await fixture()
  try {
    const index = f.hub.index, spec = f.hub.specs.get(path('captain')), resident = f.hub.threads.get(path('captain'))
    await writeFile(join(f.site, 'desk.json'), JSON.stringify({ version: 1, defaultAgent: 'missing', packages: [] })); await f.relist()
    await expect(f.hub.reloadAgents()).rejects.toThrow('Agent desk configuration')
    expect(f.hub.index).toBe(index); expect(f.hub.specs.get(spec.path)).toBe(spec); expect(f.hub.defaultAgent).toBe(spec.path)
    expect(f.hub.threads.get(spec.path)).toBe(resident)
    const run = f.hub.runs.get(f.hub.ask('Use the last validated definition')); await run.answer
    expect(run.slot.status).toBe('done')
  } finally { await f.close() }
}, 15000)

test('failed installed-record read during reload never exposes a partially loaded shipped catalogue', async () => {
  const f = await fixture()
  try {
    const index = f.hub.index, spec = f.hub.specs.get(path('captain')), resident = f.hub.threads.get(path('captain'))
    await writeFile(join(f.site, 'packages/renamed/agent.md'), f.records[0].content.replace('name: Captain', 'name: Changed'))
    await f.relist()
    const get = f.hub.store.get.bind(f.hub.store)
    f.hub.store.get = async (store, key) => { if (store === 'settings' && key === 'agent-installations:v1') throw new Error('Stored installations unavailable'); return get(store, key) }
    await expect(f.hub.reloadAgents()).rejects.toThrow('Stored installations unavailable')
    expect(f.hub.index).toBe(index); expect(f.hub.specs.get(spec.path)).toBe(spec); expect(f.hub.defaultAgent).toBe(spec.path)
    expect(f.hub.threads.get(spec.path)).toBe(resident)
    f.hub.store.get = get
    const run = f.hub.runs.get(f.hub.ask('Use the complete previous catalogue')); await run.answer
    expect(run.slot.status).toBe('done'); expect(run.prompts[0].sheet).not.toContain('Changed')
  } finally { await f.close() }
}, 15000)
