import { afterEach, expect, test } from 'bun:test'
import { createWorkbenchController } from '../src/workspace/controller.js'
import { ProjectFiles } from '../src/workspace/files.js'
import { openStore } from '../src/runtime/store.js'

const controllers = new Set()
const cleanups = []
afterEach(() => { for (const controller of controllers) controller.stop(); controllers.clear(); for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

const deferred = () => {
  let resolve; let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Stop at an actual asynchronous port boundary, not at an arbitrary sleep.
function pauseOnce(object, method, { after = false, when = () => true } = {}) {
  const entered = deferred(); const release = deferred(); const original = object[method].bind(object)
  let used = false
  object[method] = async (...args) => {
    if (used || !when(...args)) return original(...args)
    used = true
    const value = after ? await original(...args) : undefined
    entered.resolve(args)
    await release.promise
    return after ? value : original(...args)
  }
  return { entered: entered.promise, release: release.resolve }
}

// Receipts and filesystem semantics are real at the controller boundary. Only
// execution itself is controlled; no shell, guest, browser, or Next build runs.
class ControlledExecution {
  constructor(target, seed = {}) {
    this.target = target; this.files = new Map(); this.serial = 0; this.jobs = []; this.closedTerminals = []
    this.descriptor = { runtimeId: `${target}:session-1`, root: '/workspace', toolchain: { kind: target === 'browser' ? 'node' : 'bun', version: 'fixture', packageManager: target === 'browser' ? 'npm' : 'bun' }, capabilities: ['fs', 'exec', 'pty'] }
    for (const [path, content] of Object.entries(seed)) this.externalWrite(path, content)
  }
  externalWrite(path, content) {
    const bytes = Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, 'utf8')
    this.files.set(path, { bytes, revision: `r${++this.serial}` })
  }
  async prepare() { return structuredClone(this.descriptor) }
  describeCapabilities() { return structuredClone(this.descriptor) }
  async list(directory = '') {
    return [...this.files].filter(([path]) => directory ? path.startsWith(`${directory}/`) : !['out', '.next', 'node_modules'].includes(path.split('/')[0]))
      .map(([path, value]) => ({ path, revision: value.revision, size: value.bytes.length })).sort((a, b) => a.path.localeCompare(b.path))
  }
  async read(path) {
    const value = this.files.get(path)
    return value ? { path, content: value.bytes.toString('utf8'), revision: value.revision } : null
  }
  async write({ path, content, base64, expectedRevision }) {
    const current = await this.read(path)
    if (expectedRevision !== undefined && String(expectedRevision) !== String(current?.revision ?? 0)) return { conflict: true, rev: current?.revision ?? 0, current }
    this.externalWrite(path, base64 !== undefined ? Buffer.from(base64, 'base64') : content)
    return this.read(path)
  }
  async remove({ path, expectedRevision }) {
    const current = await this.read(path)
    if (expectedRevision !== undefined && String(expectedRevision) !== String(current?.revision ?? 0)) throw new Error('Revision conflict')
    this.files.delete(path)
    return { ok: true }
  }
  async rename({ path, destination, expectedRevision }) {
    const current = await this.read(path)
    if (this.files.has(destination) || String(expectedRevision) !== String(current?.revision)) throw new Error('Revision conflict')
    this.files.set(destination, this.files.get(path)); this.files.delete(path)
    return { ok: true }
  }
  async snapshot(directory = '') {
    const rows = await this.list(directory)
    return { revision: `snapshot:${this.serial}`, files: rows.map(row => ({ path: directory ? row.path.slice(directory.length + 1) : row.path, base64: this.files.get(row.path).bytes.toString('base64'), revision: row.revision })) }
  }
  async startJob(request) {
    this.jobs.push(request)
    request.onOutput?.({ type: 'output', jobId: request.id, stream: 'stdout', data: 'fixture output\n' })
    if (this.onJob) return this.onJob(request)
    if (request.args.at(-1).includes('run build')) this.externalWrite('out/index.html', '<!doctype html><html><head></head><body><button>Count</button><output>1</output></body></html>')
    return { type: 'exit', jobId: request.id, code: 0 }
  }
  async cancelJob() { return { ok: true } }
  async openTerminal() { return { id: 'terminal-1' } }
  terminalInput() {}
  resizeTerminal() {}
  async closeTerminal(terminalId) { this.closedTerminals.push(terminalId) }
  subscribeTerminal() { return () => {} }
  dispose() {}
}

const source = { 'package.json': JSON.stringify({ scripts: { build: 'next build --webpack' } }), 'app/page.jsx': 'export default function Page() { return "original" }' }
const assertions = [{ action: 'click', selector: 'button' }, { action: 'assertText', selector: 'output', value: '1' }]

async function fixture({ seed = source, localSeed = {}, inspectArtifact, createExecution, createCompanion, createHub } = {}) {
  const files = new ProjectFiles()
  files.store = await openStore(`controller-fixture-${crypto.randomUUID()}`)
  files.store.durable = true // In-memory deterministic transaction fixture; not a browser durability claim.
  const browser = new ControlledExecution('browser', seed); const local = new ControlledExecution('local', localSeed)
  const controller = createWorkbenchController({ workspace: files, createExecution: createExecution ?? (async target => target === 'browser' ? browser : local), createCompanion, inspectArtifact, createHub })
  controllers.add(controller)
  return { controller, files, browser, local }
}

async function startedFixture({ restoredBridge = false, modelProfile = {}, workbenchConfig = {}, createCompanion, createExecution, sharedStore, inspectArtifact } = {}) {
  const saved = new Map(['fetch', 'location', 'localStorage', 'isSecureContext'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  cleanups.push(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } })
  const settings = new Map()
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://workbench.invalid' } })
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => settings.get(key) ?? null, setItem: (key, value) => settings.set(key, value) } })
  globalThis.fetch = async url => {
    if (url === '/workbench.json') return Response.json({ acceptance: { requireArtifact: true, requireInteraction: true }, ...workbenchConfig })
    if (url === '/models.json') return Response.json({ default: 'fixture', models: { fixture: { model: 'fixture-model', base_url: 'https://model.invalid/v1', ...modelProfile } } })
    throw new Error(`Unexpected network request in controller fixture: ${url}`)
  }
  const listeners = new Set(); let catalogue = { models: {} }; let serial = 0
  const bridge = { status: restoredBridge ? 'answering' : 'unpaired', url: 'https://127.0.0.1:7717', token: 'fixture-only', health: { root: '/paired-root', capabilities: ['model-relay', 'network-relay'] } }
  const hub = {
    runs: new Map(), approvals: new Map(), externalOps: {}, asks: [], bridgeState: bridge,
    bridge: { pair: async () => { bridge.status = 'answering' }, state: () => bridge },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    emit(message) { for (const listener of listeners) listener(message) },
    async start() {
      if (restoredBridge) this.emit({ type: 'bridge', state: { status: 'answering', url: bridge.url, root: bridge.health.root, capabilities: bridge.health.capabilities } })
      this.emit({ type: 'boot', stage: 'ready' })
    },
    stop() {}, manifest: () => [], roster: () => new Map(),
    settings: { get: () => ({ catalogue }), set: async patch => { catalogue = patch.catalogue ?? catalogue } },
    ask(query, options) { const id = `run-${++serial}`; this.asks.push({ id, query, ...options }); this.runs.set(id, { id, agent: 'main', context: options.context, children: [], slot: { status: 'idle' } }); return id },
    traces: { export: async id => ({ trace: id, runs: [] }) },
  }
  const row = await fixture({ createHub: () => hub, createCompanion, createExecution, inspectArtifact })
  if (sharedStore) row.files.store = sharedStore
  // Keep the real ProjectFiles transaction store supplied by the fixture.
  row.files.start = async () => row.files
  hub.store = row.files.store
  await row.controller.start()
  return { ...row, hub }
}

test('execution notices project from configuration without starting or changing execution', async () => {
  let starts = 0
  const notice = { title: 'Browser Linux preview', body: 'Startup takes several minutes. Build validation is in progress.' }
  const { controller } = await startedFixture({ workbenchConfig: { executionNotices: { browser: notice } }, createExecution: async () => { starts++; throw new Error('Notice projection must not boot an executor') } })
  const state = controller.getSnapshot()
  expect(state.executionNotices).toEqual({ browser: notice })
  expect(state.runtime.target).toBe('browser')
  expect(state.runtime.status).toBe('idle')
  expect(starts).toBe(0)
})

test('missing or malformed execution notices stay optional and do not become UI values', async () => {
  const missing = await startedFixture()
  expect(missing.controller.getSnapshot().executionNotices).toEqual({})
  const malformed = await startedFixture({ workbenchConfig: { executionNotices: { browser: { title: {}, body: 'Text' }, local: { title: ' Local preview ', body: ' Informational only. ' }, unknown: { title: 'Other', body: 'Unsupported target' } } } })
  expect(malformed.controller.getSnapshot().executionNotices).toEqual({ local: { title: 'Local preview', body: 'Informational only.' } })
})

test('runtime changes require explicit transfer and preserve a nonempty destination', async () => {
  const { controller, files, browser, local } = await fixture({ localSeed: { 'keep.txt': 'destination work' } })
  await controller.startRuntime()
  await expect(controller.setExecutionTarget('local')).rejects.toThrow('explicit workspace snapshot transfer')
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('empty destination')
  expect(files.backend).toBe(browser)
  expect(controller.getSnapshot().runtime.target).toBe('browser')
  expect((await local.read('keep.txt')).content).toBe('destination work')
  expect(await local.read('app/page.jsx')).toBeNull()
})

test('explicit transfer preserves binary bytes and switches only to the copied volume', async () => {
  const bytes = Buffer.from([0, 255, 128, 10, 0, 7])
  const { controller, files, local } = await fixture({ seed: { ...source, 'asset.bin': bytes } })
  await controller.startRuntime()
  await controller.setExecutionTarget('local', { transfer: true })
  expect(files.backend).toBe(local)
  expect(controller.getSnapshot().runtime.target).toBe('local')
  expect(local.files.get('asset.bin').bytes).toEqual(bytes)
  expect((await controller.readFile('app/page.jsx')).content).toBe(source['app/page.jsx'])
})

test('external source mutation during snapshot capture rejects transfer before destination writes', async () => {
  const { controller, files, browser, local } = await fixture()
  await controller.startRuntime()
  const gate = pauseOnce(browser, 'snapshot', { after: true })
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  await gate.entered
  browser.externalWrite('app/page.jsx', 'external edit during capture')
  gate.release()
  await expect(transfer).rejects.toThrow('source changed while capturing')
  expect(files.backend).toBe(browser)
  expect(controller.getSnapshot().runtime.target).toBe('browser')
  expect((await controller.readFile('app/page.jsx')).content).toBe('external edit during capture')
  expect(await local.list()).toHaveLength(0)
})

test('external source mutation during copying keeps the original workspace active', async () => {
  const { controller, files, browser, local } = await fixture()
  await controller.startRuntime()
  const gate = pauseOnce(local, 'write')
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  await gate.entered
  browser.externalWrite('app/page.jsx', 'external edit during copy')
  gate.release()
  await expect(transfer).rejects.toThrow('source changed during transfer')
  expect(files.backend).toBe(browser)
  expect(controller.getSnapshot().runtime.target).toBe('browser')
  expect((await controller.readFile('app/page.jsx')).content).toBe('external edit during copy')
  expect((await local.read('app/page.jsx')).content).toBe(source['app/page.jsx'])
})

test('destination conflict during copy preserves original binding and conflicting bytes', async () => {
  const { controller, files, browser, local } = await fixture()
  await controller.startRuntime()
  const gate = pauseOnce(local, 'write')
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  const [request] = await gate.entered
  local.externalWrite(request.path, 'destination won the race')
  gate.release()
  await expect(transfer).rejects.toThrow('Destination changed')
  expect(files.backend).toBe(browser)
  expect(controller.getSnapshot().runtime.target).toBe('browser')
  expect((await local.read(request.path)).content).toBe('destination won the race')
})

test('checkpoint failure after a copy restores original binding without deleting copied files', async () => {
  const { controller, files, browser, local } = await fixture()
  await controller.startRuntime()
  const put = files.store.put.bind(files.store); let failed = false
  files.store.put = async (...args) => {
    if (files.backend === local && !failed) { failed = true; throw new Error('checkpoint quota exhausted') }
    return put(...args)
  }
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('checkpoint quota exhausted')
  expect(files.backend).toBe(browser)
  expect(controller.getSnapshot().runtime.target).toBe('browser')
  expect(controller.getSnapshot().runtime.status).toBe('ready')
  expect((await controller.readFile('app/page.jsx')).content).toBe(source['app/page.jsx'])
  expect((await local.read('app/page.jsx')).content).toBe(source['app/page.jsx'])
})

test('reserved transfer blocks writes, commands, terminals, runtime starts, and another transfer', async () => {
  const { controller, local } = await fixture()
  await controller.startRuntime()
  const gate = pauseOnce(local, 'write')
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  await gate.entered
  await expect(controller.createFile('racing.txt', 'race')).rejects.toThrow('snapshot transfer')
  await expect(controller.runCommand('echo race')).rejects.toThrow('snapshot transfer')
  await expect(controller.openTerminal({})).rejects.toThrow('snapshot transfer')
  await expect(controller.startRuntime()).rejects.toThrow('snapshot transfer')
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('snapshot transfer')
  gate.release(); await transfer
  expect(await controller.readFile('racing.txt')).toBeNull()
  expect(local.jobs).toHaveLength(0)
})

test('a pending file commit blocks transfer until its acknowledgement', async () => {
  const { controller, browser } = await fixture()
  await controller.startRuntime()
  const gate = pauseOnce(browser, 'write')
  const save = controller.createFile('new.txt', 'pending commit')
  await gate.entered
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('active work')
  gate.release(); await save
  expect((await controller.readFile('new.txt')).content).toBe('pending commit')
})

test('runtime preparation blocks transfer before a command can be admitted', async () => {
  const ready = deferred(); const entered = deferred(); const port = new ControlledExecution('browser', source)
  const { controller } = await fixture({ createExecution: async target => { expect(target).toBe('browser'); entered.resolve(); await ready.promise; return port } })
  const command = controller.runCommand('echo runtime-start')
  await entered.promise
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('active work')
  ready.resolve(); await command
  expect(port.jobs).toHaveLength(1)
})

test('an admitted job blocks transfer until its exit and checkpoint', async () => {
  const { controller, browser } = await fixture()
  await controller.startRuntime()
  const gate = pauseOnce(browser, 'startJob')
  const command = controller.runCommand('echo running')
  await gate.entered
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('active work')
  expect(controller.getSnapshot().commands.at(-1).status).toBe('running')
  gate.release(); await command
  await controller.setExecutionTarget('local', { transfer: true })
  expect(controller.getSnapshot().runtime.target).toBe('local')
})

test('opening and open human terminals both block transfer until close completes', async () => {
  const { controller, browser } = await fixture()
  await controller.startRuntime()
  const opening = pauseOnce(browser, 'openTerminal')
  const terminal = controller.openTerminal({ cols: 90, rows: 30 })
  await opening.entered
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('active work')
  opening.release(); const session = await terminal
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('Close terminal')
  const closing = pauseOnce(browser, 'closeTerminal')
  const closed = controller.closeTerminal(session.id)
  await closing.entered
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('Close terminal')
  closing.release(); await closed
  await controller.setExecutionTarget('local', { transfer: true })
  expect(browser.closedTerminals).toEqual([session.id])
})

test('a source commit during a build cannot package the obsolete result', async () => {
  const { controller, browser } = await fixture()
  await controller.startRuntime()
  const gate = pauseOnce(browser, 'startJob')
  const build = controller.buildPreview()
  await gate.entered
  await controller.createFile('changed.js', 'saved while building')
  gate.release()
  await expect(build).rejects.toThrow('Source files changed during the build')
  expect(controller.getSnapshot().artifacts).toHaveLength(0)
  expect(controller.getSnapshot().commands.at(-1).exitCode).toBe(0)
  expect((await controller.checkArtifact({ assertions })).ok).toBe(false)
})

test('a source commit during artifact capture preserves the previous preview', async () => {
  const { controller, browser } = await fixture()
  await controller.startRuntime()
  const previous = await controller.buildPreview()
  const html = controller.getSnapshot().artifacts[0].html
  const gate = pauseOnce(browser, 'snapshot', { after: true, when: directory => directory === 'out' })
  const replacement = controller.buildPreview()
  await gate.entered
  await controller.createFile('changed.js', 'saved while packaging')
  gate.release()
  await expect(replacement).rejects.toThrow('workspace changed while packaging')
  expect(controller.getSnapshot().artifacts).toHaveLength(1)
  expect(controller.getSnapshot().activeArtifactId).toBe(previous.id)
  expect(controller.getSnapshot().artifacts[0].html).toBe(html)
  expect(controller.getSnapshot().artifacts[0].verified).toBe(false)
  expect(controller.getSnapshot().artifacts[0].stale).toBe(true)
})

test('a failed replacement build preserves prior immutable preview and actual failure receipt', async () => {
  const { controller, browser } = await fixture()
  await controller.startRuntime()
  const previous = await controller.buildPreview()
  const html = controller.getSnapshot().artifacts[0].html
  browser.onJob = async request => ({ type: 'exit', jobId: request.id, code: 7 })
  await expect(controller.buildPreview()).rejects.toThrow('Build failed')
  expect(controller.getSnapshot().artifacts).toHaveLength(1)
  expect(controller.getSnapshot().activeArtifactId).toBe(previous.id)
  expect(controller.getSnapshot().artifacts[0].html).toBe(html)
  expect(controller.getSnapshot().commands.at(-1)).toMatchObject({ status: 'failed', exitCode: 7 })
  expect((await controller.checkArtifact({ assertions })).ok).toBe(false)
})

test('successful inspection of old bytes cannot verify a new source revision', async () => {
  const entered = deferred(); const finish = deferred()
  const { controller } = await fixture({ inspectArtifact: async (artifact, plan) => { entered.resolve({ artifact, plan }); return finish.promise } })
  await controller.startRuntime(); await controller.buildPreview()
  const check = controller.checkArtifact({ assertions })
  const { artifact, plan } = await entered.promise
  expect(plan).toEqual(assertions)
  await controller.createFile('changed.js', 'saved while inspecting')
  finish.resolve({ ok: true, artifactId: artifact.id, revision: artifact.revision, buildId: artifact.buildId, results: [{ ok: true }, { ok: true }] })
  expect(await check).toMatchObject({ ok: false })
  expect(controller.getSnapshot().artifacts.at(-1)).toMatchObject({ verified: false, stale: true })
})

test('current-source inspection verifies the exact artifact, build, and execution binding', async () => {
  const inspected = []
  const { controller, browser } = await fixture({ inspectArtifact: async (artifact, plan) => {
    inspected.push({ artifact, plan })
    return { ok: true, artifactId: artifact.id, revision: artifact.revision, buildId: artifact.buildId, results: plan.map((_, index) => ({ index, ok: true })) }
  } })
  await controller.startRuntime()
  const built = await controller.buildPreview()
  const check = await controller.checkArtifact({ assertions })
  expect(check).toMatchObject({ ok: true, artifactId: built.id })
  const artifact = controller.getSnapshot().artifacts.at(-1)
  expect(artifact).toMatchObject({ id: built.id, verified: true })
  expect(artifact.manifest.sourceRevision).toBe(artifact.revision)
  expect(artifact.manifest.build.id).toBe(artifact.buildId)
  expect(artifact.manifest.build.commandId).toBe(controller.getSnapshot().commands.at(-1).id)
  expect(artifact.manifest.runtime).toEqual(controller.getSnapshot().runtime.binding)
  expect(artifact.manifest.runtime.runtimeId).toBe(browser.descriptor.runtimeId)
  expect(Object.isFrozen(artifact.manifest.runtime)).toBe(true)
  expect(inspected).toHaveLength(1)
})

test('external source edits during inspection invalidate a check without an editor commit event', async () => {
  const entered = deferred(); const finish = deferred()
  const { controller, browser } = await fixture({ inspectArtifact: async artifact => { entered.resolve(artifact); return finish.promise } })
  await controller.startRuntime(); await controller.buildPreview()
  const check = controller.checkArtifact({ assertions }); const artifact = await entered.promise
  browser.externalWrite('app/page.jsx', 'edited by another process')
  finish.resolve({ ok: true, artifactId: artifact.id, revision: artifact.revision, buildId: artifact.buildId, results: [{ ok: true }, { ok: true }] })
  expect(await check).toMatchObject({ ok: false })
  expect(controller.getSnapshot().artifacts.at(-1).verified).toBe(false)
})

test('an inspection cannot verify a replacement artifact produced while it was running', async () => {
  const entered = deferred(); const finish = deferred()
  const { controller } = await fixture({ inspectArtifact: async artifact => { entered.resolve(artifact); return finish.promise } })
  await controller.startRuntime(); const previous = await controller.buildPreview()
  const check = controller.checkArtifact({ assertions }); const artifact = await entered.promise
  const replacement = await controller.buildPreview()
  expect(replacement.id).not.toBe(previous.id)
  finish.resolve({ ok: true, artifactId: artifact.id, revision: artifact.revision, buildId: artifact.buildId, results: [{ ok: true }, { ok: true }] })
  expect(await check).toMatchObject({ ok: false })
  expect(controller.getSnapshot().artifacts.at(-1)).toMatchObject({ id: replacement.id, verified: false })
})

test('relay-only capabilities cannot grant native execution through target selection', async () => {
  const { controller, files, browser, local } = await fixture()
  await controller.startRuntime()
  local.descriptor.capabilities = ['model-relay', 'network-relay']
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow(/capability|grant|execution/i)
  expect(files.backend).toBe(browser)
  expect(controller.getSnapshot().runtime.target).toBe('browser')
  expect(local.jobs).toHaveLength(0)
  expect(await local.list()).toHaveLength(0)
})

test('a command receipt cannot survive a runtime restart during its checkpoint', async () => {
  const { controller, files, browser } = await fixture()
  await controller.startRuntime()
  const gate = pauseOnce(files, 'checkpoint')
  const command = controller.runCommand('echo before-restart')
  await gate.entered
  browser.descriptor.runtimeId = 'browser:session-2'
  gate.release()
  await expect(command).rejects.toThrow(/binding|runtime|session/i)
  expect(controller.getSnapshot().commands.at(-1).status).toBe('failed')
})

test('destination restart during checkpoint cannot commit a stale transfer binding', async () => {
  const { controller, files, browser, local } = await fixture()
  await controller.startRuntime()
  const previousBinding = controller.getSnapshot().runtime.binding
  const gate = pauseOnce(files, 'checkpoint', { when: () => files.backend === local })
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  await gate.entered
  local.descriptor.runtimeId = 'local:session-2'
  gate.release()
  await expect(transfer).rejects.toThrow(/binding|runtime|session/i)
  expect(files.backend).toBe(browser)
  expect(controller.getSnapshot().runtime).toMatchObject({ target: 'browser', binding: previousBinding })
})

test('file checkpoint failure reports the real mutation and invalidates prior evidence', async () => {
  const { controller, files, browser } = await fixture()
  await controller.startRuntime(); await controller.buildPreview()
  const previousId = controller.getSnapshot().activeArtifactId
  const put = files.store.put.bind(files.store)
  files.store.put = async (store, value) => {
    if (store === 'files' && value.path === 'durability.txt') throw new Error('durable store unavailable')
    return put(store, value)
  }
  await expect(controller.createFile('durability.txt', 'actually written')).rejects.toThrow('durable store unavailable')
  expect((await browser.read('durability.txt')).content).toBe('actually written')
  expect(controller.getSnapshot().activeArtifactId).toBe(previousId)
  expect(controller.getSnapshot().artifacts.at(-1)).toMatchObject({ stale: true, verified: false })
  expect(controller.getSnapshot().activity.some(event => event.type === 'workspace.committed' && event.path === 'durability.txt')).toBe(true)
  expect((await controller.checkArtifact({ assertions })).ok).toBe(false)
})

test('an executor without PTY authority cannot open a human terminal', async () => {
  const { controller, browser } = await fixture()
  browser.descriptor.capabilities = ['fs', 'exec']
  let terminalCalls = 0
  browser.openTerminal = async () => { terminalCalls++; return { id: 'unauthorized-terminal' } }
  await controller.startRuntime()
  await expect(controller.openTerminal({})).rejects.toThrow(/pty|terminal|capability/i)
  expect(terminalCalls).toBe(0)
})

test('workspace Hub operations reject missing or stale run bindings before any effect', async () => {
  const { controller, hub, browser } = await startedFixture()
  await controller.startRuntime()
  const binding = controller.getSnapshot().runtime.binding
  const request = (op, args, run) => Promise.resolve().then(() => hub.externalOps[op](args, run))
  const operations = {
    'workspace.list': {}, 'workspace.read': { path: 'app/page.jsx' },
    'workspace.write': { path: 'forbidden.txt', content: 'must not write', expect: 0 },
    'workspace.run': { command: 'must-not-execute' }, 'workspace.build': {},
    'workspace.check': { assertions }, 'workspace.acceptance': {}, 'workspace.environment': {},
  }
  for (const [op, args] of Object.entries(operations)) {
    await expect(request(op, args, { id: 'unbound' })).rejects.toThrow('no pinned workspace')
    await expect(request(op, args, { id: 'stale', context: { binding: { ...binding, runtimeId: 'browser:old-session' } } })).rejects.toThrow('binding runtimeId changed')
  }
  expect(await browser.read('forbidden.txt')).toBeNull()
  expect(browser.jobs).toHaveLength(0)
  expect(controller.getSnapshot().commands).toHaveLength(0)
  const bound = { id: 'bound', context: { binding } }
  expect((await request('workspace.read', { path: 'app/page.jsx' }, bound)).content).toBe(source['app/page.jsx'])
})

test('invalid model transport is rejected before a live Hub run can be dispatched', async () => {
  const { controller, hub, browser } = await startedFixture()
  await controller.setModel({ model: 'fixture-model', baseUrl: 'https://model.invalid/v1?fixture=not-a-secret' })
  await expect(controller.sendGoal('This task must not start')).rejects.toThrow(/credential-free|query|fragment/i)
  expect(hub.asks).toHaveLength(0)
  expect(hub.runs.size).toBe(0)
  expect(browser.jobs).toHaveLength(0)
  expect(controller.getSnapshot().run.status).toBe('failed')
})

test('a valid goal dispatches one frozen owner-bound context and exports that same run identity', async () => {
  const { controller, hub } = await startedFixture()
  const runId = await controller.sendGoal('Build the requested fixture')
  expect(hub.asks).toHaveLength(1)
  expect(hub.asks[0].id).toBe(runId)
  expect(hub.asks[0].context.binding).toEqual(controller.getSnapshot().runtime.binding)
  expect(Object.isFrozen(hub.asks[0].context.binding)).toBe(true)
  const evidence = await controller.exportRunEvidence()
  expect(evidence.run.runId).toBe(runId)
  expect(evidence.run.binding).toEqual(hub.asks[0].context.binding)
  expect(evidence.run.sourceFingerprint).toBe(hub.asks[0].context.sourceFingerprint)
})

test('restored and refreshed bridge events preserve top-level capabilities without selecting host execution', async () => {
  const { controller, hub } = await startedFixture({ restoredBridge: true })
  expect(controller.getSnapshot().companion).toMatchObject({ status: 'connected', root: '/paired-root', capabilities: ['model-relay', 'network-relay'] })
  expect(controller.getSnapshot().runtime.target).toBe('browser')
  hub.emit({ type: 'bridge', state: { status: 'answering', url: 'https://127.0.0.1:7717', root: '/paired-root', capabilities: ['model-relay', 'network-relay'] } })
  await controller.setGuestNetworkRelay(true)
  expect(controller.getSnapshot().runtime).toMatchObject({ target: 'browser', networkRelay: true, network: 'companion-network-relay' })
  expect(controller.getSnapshot().companion.capabilities).toEqual(['model-relay', 'network-relay'])
})

test('model changes scope credentials to the endpoint and provider options to the configured model', async () => {
  const requestParams = { chat_template_kwargs: { enable_thinking: false } }
  const { controller, hub } = await startedFixture({ modelProfile: { request_params: requestParams, max_output_tokens: 8192, temperature: 0 } })
  const selected = () => hub.settings.get().catalogue.models.workbench
  await controller.setModel({ model: 'fixture-model', baseUrl: 'https://model.invalid/v1', apiKey: 'unit-fixture-key' })
  await controller.setModel({ model: 'fixture-model', baseUrl: 'https://model.invalid/v1', via: 'bridge' })
  expect(selected()).toMatchObject({ api_key: 'unit-fixture-key', request_params: requestParams, max_output_tokens: 8192, temperature: 0, via: 'bridge' })
  await controller.setModel({ model: 'different-model', baseUrl: 'https://model.invalid/v1' })
  expect(selected().api_key).toBe('unit-fixture-key')
  expect(selected().request_params).toBeUndefined()
  expect(selected().max_output_tokens).toBeUndefined()
  await controller.setModel({ model: 'fixture-model', baseUrl: 'https://other-provider.invalid/v1' })
  expect(selected().api_key).toBe('')
  expect(selected().request_params).toBeUndefined()
  await controller.setModel({ model: 'fixture-model', baseUrl: 'https://model.invalid/v1' })
  expect(selected().request_params).toEqual(requestParams)
  expect(selected().api_key).toBe('')
})

test('companion pairing reserves the workspace before its first asynchronous probe', async () => {
  const probe = deferred()
  const { controller, hub, browser } = await startedFixture({ createCompanion: options => ({ ...options, prepare: () => probe.promise, dispose() {} }) })
  const pairing = controller.connectCompanion({ url: 'https://companion.invalid', token: 'fixture-only' })
  await expect(controller.sendGoal('Do not dispatch during pairing')).rejects.toThrow('connection change')
  await expect(controller.createFile('blocked.txt', 'draft')).rejects.toThrow('connection change')
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('connection change')
  await expect(controller.runCommand('echo blocked')).rejects.toThrow('connection change')
  await expect(controller.connectCompanion({ url: 'https://other.invalid', token: 'fixture-only' })).rejects.toThrow('connection change')
  expect(hub.asks).toHaveLength(0)
  expect(browser.jobs).toHaveLength(0)
  probe.resolve({ capabilities: ['model-relay'], root: '/relay' })
  await pairing
  await controller.createFile('unblocked.txt', 'saved')
  expect((await controller.readFile('unblocked.txt')).content).toBe('saved')
})

test('failed companion probes release the connection reservation', async () => {
  const { controller } = await startedFixture({ createCompanion: () => ({ prepare: async () => { throw new Error('Relay unavailable') } }) })
  await expect(controller.connectCompanion({ url: 'https://companion.invalid', token: 'fixture-only' })).rejects.toThrow('Relay unavailable')
  await controller.createFile('after-failure.txt', 'saved')
  expect((await controller.readFile('after-failure.txt')).content).toBe('saved')
})

test('re-pairing the same native root accepts a restarted session and invalidates prior verification', async () => {
  const original = new ControlledExecution('local')
  const replacement = new ControlledExecution('local')
  original.url = replacement.url = 'https://companion.invalid'
  original.token = replacement.token = 'fixture-only'
  replacement.descriptor.runtimeId = 'local:session-2'
  let pairs = 0
  const { controller, hub } = await startedFixture({ createCompanion: () => pairs++ ? replacement : original, createExecution: async () => original, inspectArtifact: async artifact => ({ ok: true, artifactId: artifact.id, revision: artifact.revision, buildId: artifact.buildId }) })
  await controller.connectCompanion({ url: original.url, token: original.token })
  await controller.setExecutionTarget('local', { transfer: true })
  await controller.createFile('retain.txt', 'original workspace')
  await controller.createFile('package.json', JSON.stringify({ scripts: { build: 'fixture' } }))
  await controller.buildPreview(); await controller.checkArtifact({ assertions })
  expect(controller.getSnapshot().artifacts.at(-1).verified).toBe(true)
  const oldBinding = controller.getSnapshot().runtime.binding
  replacement.files = original.files; replacement.serial = original.serial
  await controller.connectCompanion({ url: original.url, token: original.token })
  expect(controller.getSnapshot().runtime.binding.runtimeId).toBe('local:session-2')
  expect(controller.getSnapshot().artifacts.at(-1)).toMatchObject({ verified: false, stale: true })
  expect((await controller.readFile('retain.txt')).content).toBe('original workspace')
  expect(() => hub.externalOps['workspace.read']({ path: 'retain.txt' }, { context: { binding: oldBinding } })).toThrow('runtimeId')
})

test('successful native re-pair keeps execution and files on the validated connection and retains the next pairing guard', async () => {
  const original = new ControlledExecution('local'); const replacement = new ControlledExecution('local')
  original.url = replacement.url = 'https://companion.invalid'; original.token = replacement.token = 'fixture-only'
  let pairs = 0
  const { controller, hub, files } = await startedFixture({ createCompanion: options => { pairs++; if (options.url !== original.url) return Object.assign(new ControlledExecution('local'), options); return pairs > 1 ? replacement : original }, createExecution: async () => original })
  await controller.connectCompanion({ url: original.url, token: original.token })
  await controller.setExecutionTarget('local', { transfer: true })
  await controller.createFile('retain.txt', 'shared native volume')
  replacement.files = original.files; replacement.serial = original.serial
  const gate = pauseOnce(hub.bridge, 'pair')
  const pairing = controller.connectCompanion({ url: original.url, token: original.token })
  await gate.entered
  expect(files.backend).toBe(original)
  await expect(controller.runCommand('must wait for pairing')).rejects.toThrow('connection change')
  gate.release(); await pairing
  expect(files.backend).toBe(replacement)
  await controller.runCommand('runs through the validated replacement')
  expect(replacement.jobs).toHaveLength(1)
  expect(original.jobs).toHaveLength(0)
  await expect(controller.connectCompanion({ url: 'https://different.invalid', token: 'other-fixture' })).rejects.toThrow(/explicit.*transfer/)
  expect(pairs).toBe(3)
  expect(controller.getSnapshot().companion.url).toBe(original.url)
})

test('failed pairing publication leaves the prior native file and command connection intact', async () => {
  const original = new ControlledExecution('local'); const replacement = new ControlledExecution('local')
  original.url = replacement.url = 'https://companion.invalid'; original.token = replacement.token = 'fixture-only'
  let pairs = 0
  const { controller, hub, files } = await startedFixture({ createCompanion: options => { pairs++; if (options.url !== original.url) return Object.assign(new ControlledExecution('local'), options); return pairs > 1 ? replacement : original }, createExecution: async () => original })
  await controller.connectCompanion({ url: original.url, token: original.token })
  await controller.setExecutionTarget('local', { transfer: true })
  hub.settings.set = async () => { throw new Error('Pairing settings could not be saved') }
  await expect(controller.connectCompanion({ url: original.url, token: original.token })).rejects.toThrow('could not be saved')
  expect(files.backend).toBe(original)
  await controller.runCommand('still uses original connection')
  expect(original.jobs).toHaveLength(1)
  expect(replacement.jobs).toHaveLength(0)
  await expect(controller.connectCompanion({ url: 'https://different.invalid', token: 'other-fixture' })).rejects.toThrow(/explicit.*transfer/)
})

async function nativeFixture(options = {}) {
  const port = new ControlledExecution('local')
  Object.assign(port, { url: 'https://companion.invalid', token: 'fixture-only' })
  const row = await startedFixture({ createCompanion: () => port, createExecution: async () => port, ...options })
  await row.controller.connectCompanion({ url: port.url, token: port.token })
  await row.controller.setExecutionTarget('local', { transfer: true })
  await row.controller.createFile('saved.txt', 'original native bytes')
  return { ...row, port }
}

test('reload rejects a different native root before pairing or mounting the cached workspace', async () => {
  const first = await nativeFixture()
  const stored = await first.files.store.get('settings', 'workspace-location:default')
  expect(stored.value).toMatchObject({ endpoint: first.port.url, binding: { target: 'local', root: '/workspace', runtimeId: 'local:session-1' } })
  expect(JSON.stringify(stored)).not.toContain('fixture-only')
  first.controller.stop()
  const other = new ControlledExecution('local', { 'private.txt': 'different root data' })
  Object.assign(other, { url: first.port.url, token: first.port.token }); other.descriptor.root = '/different-project'
  const second = await startedFixture({ sharedStore: first.files.store, createCompanion: () => other, createExecution: async () => other })
  let paired = 0; second.hub.bridge.pair = async () => { paired++ }
  await expect(second.controller.connectCompanion({ url: other.url, token: other.token })).rejects.toMatchObject({ code: 'WORKSPACE_TRANSFER_REQUIRED' })
  expect(paired).toBe(0)
  expect(second.controller.getSnapshot().runtime.bindingReview).toMatchObject({ kind: 'transfer', previous: { binding: { root: '/workspace' } }, proposed: { binding: { root: '/different-project' } } })
  await expect(second.controller.startRuntime()).rejects.toMatchObject({ code: 'WORKSPACE_TRANSFER_REQUIRED' })
  expect(second.files.backend).toBeNull()
  expect((await second.controller.readFile('saved.txt')).content).toBe('original native bytes')
  expect(other.jobs).toHaveLength(0)
  expect(await second.files.store.get('settings', 'workspace-location:default')).toEqual(stored)
  await expect(second.controller.connectCompanion({ url: other.url, token: other.token, transfer: true, expectedProposal: second.controller.getSnapshot().runtime.bindingReview.proposed })).rejects.toThrow('not a complete workspace snapshot')
  await expect(second.controller.setExecutionTarget('browser', { transfer: true })).rejects.toThrow('not a complete workspace snapshot')
})

test('failed durable location publication rolls a transfer back to the original binding', async () => {
  const row = await fixture()
  await row.controller.startRuntime()
  const original = await row.files.store.get('settings', 'workspace-location:default')
  const put = row.files.store.put.bind(row.files.store)
  row.files.store.put = async (table, value) => {
    if (value.key === 'workspace-location:default' && value.value.binding.target === 'local') throw new Error('Workspace identity quota failure')
    return put(table, value)
  }
  await expect(row.controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('Workspace identity quota failure')
  expect(row.files.backend).toBe(row.browser)
  expect(row.controller.getSnapshot().runtime.binding).toEqual(original.value.binding)
  expect(await row.files.store.get('settings', 'workspace-location:default')).toEqual(original)
  expect((await row.local.read('app/page.jsx')).content).toBe(source['app/page.jsx'])
})

test('reload reconnects the same native location with a new session and preserves external file edits', async () => {
  const first = await nativeFixture(); const oldBinding = first.controller.getSnapshot().runtime.binding
  first.controller.stop()
  const restarted = new ControlledExecution('local', { 'saved.txt': 'changed while the tab was closed' })
  Object.assign(restarted, { url: first.port.url, token: 'rotated-fixture-token' }); restarted.descriptor.runtimeId = 'local:restarted'
  const second = await startedFixture({ sharedStore: first.files.store, createCompanion: () => restarted, createExecution: async () => restarted })
  await second.controller.connectCompanion({ url: restarted.url, token: restarted.token })
  expect(second.files.backend).toBeNull()
  await second.controller.startRuntime()
  expect(second.controller.getSnapshot().runtime.binding.runtimeId).toBe('local:restarted')
  expect((await second.controller.readFile('saved.txt')).content).toBe('changed while the tab was closed')
  expect(restarted.jobs).toHaveLength(0)
  expect(() => second.hub.externalOps['workspace.read']({ path: 'saved.txt' }, { context: { binding: oldBinding } })).toThrow('runtimeId')
})

test('a changed native root needs an explicit transfer into an empty destination and persists its new identity', async () => {
  const original = new ControlledExecution('local'); const other = new ControlledExecution('local')
  Object.assign(original, { url: 'https://first.invalid', token: 'first-fixture' }); Object.assign(other, { url: 'https://second.invalid', token: 'second-fixture' }); other.descriptor.root = '/second-root'
  const row = await startedFixture({ createCompanion: ({ url }) => url === original.url ? original : other, createExecution: async () => original })
  await row.controller.connectCompanion({ url: original.url, token: original.token }); await row.controller.setExecutionTarget('local', { transfer: true }); await row.controller.createFile('keep.txt', 'transfer me')
  await expect(row.controller.connectCompanion({ url: other.url, token: other.token, rebind: true })).rejects.toMatchObject({ code: 'WORKSPACE_TRANSFER_REQUIRED' })
  other.externalWrite('occupied.txt', 'preserve destination')
  await expect(row.controller.connectCompanion({ url: other.url, token: other.token, transfer: true, expectedProposal: row.controller.getSnapshot().runtime.bindingReview.proposed })).rejects.toThrow('empty destination')
  expect(row.files.backend).toBe(original)
  expect((await row.files.store.get('settings', 'workspace-location:default')).value.binding.root).toBe('/workspace')
  other.files.clear()
  await row.controller.connectCompanion({ url: other.url, token: other.token, transfer: true, expectedProposal: row.controller.getSnapshot().runtime.bindingReview.proposed })
  expect(row.files.backend).toBe(other)
  expect((await other.read('keep.txt')).content).toBe('transfer me')
  expect((await original.read('keep.txt')).content).toBe('transfer me')
  expect((await row.files.store.get('settings', 'workspace-location:default')).value).toMatchObject({ endpoint: other.url, binding: { root: '/second-root' } })
})

test('legacy native reload requires explicit root adoption and preserves saved edits for normal conflict checks', async () => {
  const first = await nativeFixture()
  await first.files.store.delete('settings', 'workspace-location:default')
  await first.files.store.put('settings', { key: 'workbench-state', value: { target: 'local' } })
  const other = new ControlledExecution('local', { 'saved.txt': 'review this current root' })
  Object.assign(other, { url: first.port.url, token: first.port.token }); other.descriptor.root = '/reviewed-root'
  const second = await startedFixture({ sharedStore: first.files.store, createCompanion: () => other, createExecution: async () => other })
  await second.controller.saveFile({ path: 'saved.txt', content: 'saved offline edit', expect: (await second.controller.readFile('saved.txt')).rev })
  await expect(second.controller.connectCompanion({ url: other.url, token: other.token })).rejects.toMatchObject({ code: 'WORKSPACE_LEGACY_REBIND' })
  expect(second.controller.getSnapshot().runtime.bindingReview).toMatchObject({ kind: 'legacy', previous: null, proposed: { endpoint: other.url, binding: { root: '/reviewed-root' } } })
  expect((await second.controller.readFile('saved.txt')).content).toBe('saved offline edit')
  const reviewed = second.controller.getSnapshot().runtime.bindingReview.proposed
  other.descriptor.root = '/changed-after-review'
  await expect(second.controller.connectCompanion({ url: other.url, token: other.token, rebind: true, expectedProposal: reviewed })).rejects.toMatchObject({ code: 'WORKSPACE_LEGACY_REBIND' })
  expect(await second.files.store.get('settings', 'workspace-location:default')).toBeUndefined()
  expect(second.controller.getSnapshot().runtime.bindingReview.proposed.binding.root).toBe('/changed-after-review')
  await second.controller.connectCompanion({ url: other.url, token: other.token, rebind: true, expectedProposal: second.controller.getSnapshot().runtime.bindingReview.proposed })
  await expect(second.controller.startRuntime()).rejects.toMatchObject({ code: 'WORKSPACE_MOUNT_CONFLICT' })
  expect((await second.controller.readFile('saved.txt')).content).toBe('saved offline edit')
  expect((await other.read('saved.txt')).content).toBe('review this current root')
  await expect(second.controller.connectCompanion({ url: other.url, token: other.token })).rejects.toMatchObject({ code: 'WORKSPACE_MOUNT_CONFLICT' })
  expect(second.controller.getSnapshot().runtime.status).not.toBe('ready')
  expect(second.files.backend).toBeNull()
})

test('legacy root adoption rechecks the prepared identity after asynchronous pairing before persisting it', async () => {
  const first = await nativeFixture()
  await first.files.store.delete('settings', 'workspace-location:default')
  await first.files.store.put('settings', { key: 'workbench-state', value: { target: 'local' } })
  const next = new ControlledExecution('local')
  Object.assign(next, { url: first.port.url, token: first.port.token })
  const second = await startedFixture({ sharedStore: first.files.store, createCompanion: () => next, createExecution: async () => next })
  await expect(second.controller.connectCompanion({ url: next.url, token: next.token })).rejects.toMatchObject({ code: 'WORKSPACE_LEGACY_REBIND' })
  const expectedProposal = second.controller.getSnapshot().runtime.bindingReview.proposed
  const gate = pauseOnce(second.hub.bridge, 'pair')
  const confirmation = second.controller.connectCompanion({ url: next.url, token: next.token, rebind: true, expectedProposal })
  await gate.entered
  next.descriptor.root = '/not-the-reviewed-root'
  gate.release()
  await expect(confirmation).rejects.toMatchObject({ code: 'WORKSPACE_LEGACY_REBIND' })
  expect(second.controller.getSnapshot().runtime.bindingReview.proposed.binding.root).toBe('/not-the-reviewed-root')
  expect(await second.files.store.get('settings', 'workspace-location:default')).toBeUndefined()
  expect(second.files.backend).toBeNull()
  expect((await second.controller.readFile('saved.txt')).content).toBe('original native bytes')
})

test('conversation goals are durable, revision checked, clearable, and independent of transcript writes', async () => {
  const { controller, files, hub } = await startedFixture()
  await controller.startRuntime()
  const binding = controller.getSnapshot().runtime.binding
  const run = { context: { binding } }
  await controller.setConversationGoal('  Build an accessible task board  ', 0)
  expect(controller.getSnapshot()).toMatchObject({ goal: 'Build an accessible task board', goalRevision: 1 })
  expect(hub.externalOps['workspace.goal']({}, run)).toEqual({ text: 'Build an accessible task board', revision: 1 })
  await files.store.put('settings', { key: 'workbench-state', value: { messages: [] } })
  expect((await files.store.get('settings', 'conversation-goal:default')).value).toEqual({ text: 'Build an accessible task board', revision: 1 })
  await expect(controller.setConversationGoal('stale overwrite', 0)).rejects.toThrow('goal changed')
  await controller.setConversationGoal('', 1)
  expect((await files.store.get('settings', 'conversation-goal:default')).value).toEqual({ text: '', revision: 2 })
  expect(hub.externalOps['workspace.goal']({}, run)).toEqual({ text: '', revision: 2 })
})

test('failed goal persistence cannot publish a saved goal or overwrite its durable value', async () => {
  const { controller, files } = await startedFixture()
  await controller.setConversationGoal('Keep this goal', 0)
  files.store.update = async () => { throw new Error('Quota exceeded') }
  await expect(controller.setConversationGoal('lost edit', 1)).rejects.toThrow('Quota exceeded')
  expect(controller.getSnapshot().goal).toBe('Keep this goal')
  expect((await files.store.get('settings', 'conversation-goal:default')).value.text).toBe('Keep this goal')
})
