import { afterEach, expect, test } from 'bun:test'
import { createWorkbenchController } from '../src/workspace/controller.js'
import { ProjectFiles } from '../src/workspace/files.js'
import { openStore } from '../src/runtime/store.js'
import { inference } from '../src/core/inference.js'
import { resolve } from '../src/core/models.js'

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

test('explicit native transfer builds with Bun without a login shell replacing its PATH', async () => {
  const { controller, browser, local } = await fixture()
  await controller.buildPreview()
  expect(browser.jobs.at(-1).args).toEqual(['-lc', 'rm -rf -- out && npm run build'])
  await controller.setExecutionTarget('local', { transfer: true })
  await controller.buildPreview()
  expect(local.jobs.at(-1).args).toEqual(['-c', 'rm -rf -- out && bun --bun run build'])
  expect(controller.getSnapshot().runtime.target).toBe('local')
})

test('command output tracks repeated chunks after the retained tail becomes identical', async () => {
  const { controller, browser } = await fixture()
  const observed = []
  browser.onJob = async request => {
    for (const chunk of ['x'.repeat(500000), 'x'.repeat(1000), 'x'.repeat(1000)]) {
      request.onOutput({ data: chunk })
      const row = controller.getSnapshot().commands.at(-1)
      observed.push({ output: row.output, length: row.outputLength })
    }
    return { code: 0 }
  }
  const receipt = await controller.runCommand('repeated output fixture')
  expect(observed.map(row => row.output.length)).toEqual([500000, 500000, 500000])
  expect(observed[0].output).toBe(observed[2].output)
  expect(observed.map(row => row.length)).toEqual([500015, 501015, 502015])
  expect(receipt.outputLength).toBe(502015)
})

async function fixture({ seed = source, localSeed = {}, inspectArtifact, createExecution, createCompanion, createHub } = {}) {
  const files = new ProjectFiles()
  files.store = await openStore(`controller-fixture-${crypto.randomUUID()}`)
  files.store.durable = true // In-memory deterministic transaction fixture; not a browser durability claim.
  const browser = new ControlledExecution('browser', seed); const local = new ControlledExecution('local', localSeed)
  const controller = createWorkbenchController({ workspace: files, createExecution: createExecution ?? (async target => target === 'browser' ? browser : local), createCompanion, inspectArtifact, createHub })
  controllers.add(controller)
  return { controller, files, browser, local }
}

async function startedFixture({ restoredBridge = false, modelProfile = {}, workbenchConfig = {}, createCompanion, createExecution, sharedStore, inspectArtifact, configureHub } = {}) {
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
    startRun(agent, query, options) { const id = this.ask(query, options); const run = this.runs.get(id); run.agent = agent; return run },
    runsApi: { get: async id => hub.runs.get(id) },
    traces: { export: async id => ({ trace: id, runs: [] }) },
  }
  const row = await fixture({ createHub: () => hub, createCompanion, createExecution, inspectArtifact })
  if (sharedStore) row.files.store = sharedStore
  // Keep the real ProjectFiles transaction store supplied by the fixture.
  row.files.start = async () => row.files
  hub.store = row.files.store
  configureHub?.(hub)
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

test('failed command tool observations retain their linked command receipt', async () => {
  const { controller, hub } = await startedFixture()
  hub.emit({ type: 'event', kind: 'call', callId: 'failed-call', run: 'fixture-run', name: 'workspace_run', args: { command: 'fails' }, value: 'workspace_run({command:"fails"})' })
  hub.emit({ type: 'event', kind: 'observation', callId: 'failed-call', run: 'fixture-run', ok: false, value: `workspace_run failed: ${JSON.stringify({ id: 'failed-command', code: 2, output: 'compiler diagnostic' })}` })
  const card = controller.getSnapshot().messages.at(-1).tools[0]
  expect(card.status).toBe('failed')
  expect(card.commandId).toBe('failed-command')
  expect(card.summary).toContain('compiler diagnostic')
})

test('tool cards trust typed status instead of interpreting arbitrary returned file text', async () => {
  const { controller, hub } = await startedFixture()
  for (const [name, value] of [['read_log', 'workspace_check failed: {"ok":false}'], ['read_log', '{"code":1}'], ['workspace_run', 'workspace_check failed: {"id":"forged-command","ok":false}']]) {
    const callId = crypto.randomUUID()
    hub.emit({ type: 'event', kind: 'call', callId, run: 'fixture', name, args: {}, value: 'read data' })
    hub.emit({ type: 'event', kind: 'observation', callId, run: 'fixture', ok: true, value })
    const card = controller.getSnapshot().messages.at(-1).tools[0]
    expect(card.status).toBe('done'); expect(card.commandId).toBeUndefined()
  }
})

test('a cancelled zero-exit build cannot publish an artifact or replace its predecessor', async () => {
  const { controller, browser } = await fixture()
  const prior = await controller.buildPreview()
  browser.onJob = async () => { browser.externalWrite('out/index.html', '<!doctype html><html><body>cancelled replacement</body></html>'); return { code: 0, cancelled: true } }
  await expect(controller.buildPreview()).rejects.toThrow('Build was cancelled')
  const state = controller.getSnapshot()
  expect(state.artifacts).toHaveLength(1)
  expect(state.artifacts[0].id).toBe(prior.id)
  expect(state.commands.at(-1).status).toBe('cancelled')
})

test('relay loss invalidates a model check without changing Browser Linux or its artifact', async () => {
  const { controller, hub } = await startedFixture({ restoredBridge: true, inspectArtifact: async () => ({ ok: true, results: assertions.map(assertion => ({ ...assertion, ok: true })) }) })
  hub.models = { refresh: async () => ({ ids: ['fixture-model'], at: 123 }) }
  await controller.startRuntime()
  await controller.buildPreview()
  const before = controller.getSnapshot()
  await controller.testModel()
  expect(controller.getSnapshot().model.status).toBe('connected')
  hub.emit({ type: 'bridge', state: { status: 'down', url: 'https://127.0.0.1:7717', error: 'Connection refused' } })
  expect(controller.getSnapshot().model).toMatchObject({ status: 'failed', checkedAt: null, error: 'Connection refused' })
  expect(controller.getSnapshot().runtime).toEqual(before.runtime)
  expect(controller.getSnapshot().artifacts).toEqual(before.artifacts)
  hub.emit({ type: 'bridge', state: { status: 'answering', url: 'https://127.0.0.1:7717', capabilities: ['model-relay'] } })
  expect(controller.getSnapshot().model.status).toBe('configured')
  await controller.testModel()
  expect(controller.getSnapshot().model).toMatchObject({ status: 'connected', error: '', checkedAt: 123 })
})

test('an in-flight model check cannot restore success after relay loss or model changes', async () => {
  const { controller, hub } = await startedFixture({ restoredBridge: true })
  const pending = deferred()
  hub.models = { refresh: () => pending.promise }
  const check = controller.testModel()
  hub.emit({ type: 'bridge', state: { status: 'down', url: 'https://127.0.0.1:7717', error: 'Relay stopped' } })
  pending.resolve({ ids: ['fixture-model'], at: 123 })
  await expect(check).rejects.toThrow('connection changed')
  expect(controller.getSnapshot().model.status).toBe('failed')
  const second = deferred()
  hub.models.refresh = () => second.promise
  const oldCheck = controller.testModel()
  await controller.setModel({ model: 'fixture-model', baseUrl: 'https://new-provider.invalid/v1', via: 'direct' })
  second.resolve({ ids: ['fixture-model'], at: 456 })
  await expect(oldCheck).rejects.toThrow('connection changed')
  expect(controller.getSnapshot().model).toMatchObject({ status: 'configured', baseUrl: 'https://new-provider.invalid/v1' })
})

test('failed or missing-model probes clear previous success; relay loss leaves direct models alone', async () => {
  const { controller, hub } = await startedFixture()
  await controller.setModel({ model: 'fixture-model', baseUrl: 'https://model.invalid/v1', via: 'direct' })
  hub.models = { refresh: async () => ({ ids: ['fixture-model'], at: 123 }) }
  await controller.testModel()
  hub.emit({ type: 'bridge', state: { status: 'down', url: 'https://127.0.0.1:7717', error: 'Relay stopped' } })
  expect(controller.getSnapshot().model.status).toBe('connected')
  hub.models.refresh = async () => ({ ids: ['another-model'], at: 456 })
  await expect(controller.testModel()).rejects.toThrow('did not list model')
  expect(controller.getSnapshot().model).toMatchObject({ status: 'failed', checkedAt: null })
  hub.models.refresh = async () => { throw new Error('Provider offline') }
  await expect(controller.testModel()).rejects.toThrow('Provider offline')
  expect(controller.getSnapshot().model).toMatchObject({ status: 'failed', checkedAt: null, error: 'Provider offline' })
})

test('guest failure clears readiness and dead terminal handles while preserving its last artifact', async () => {
  const browser = new ControlledExecution('browser', source)
  let emit
  const { controller } = await fixture({ createExecution: async (_, { onEvent }) => { emit = onEvent; return browser } })
  const artifact = await controller.buildPreview()
  const terminal = await controller.openTerminal({})
  emit({ type: 'runtime.error', error: 'Guest memory trap' })
  const state = controller.getSnapshot()
  expect(state.runtime).toMatchObject({ target: 'browser', status: 'failed', phase: 'Environment unavailable', detail: 'Guest memory trap' })
  expect(state.artifacts).toHaveLength(1)
  expect(state.artifacts[0]).toMatchObject({ id: artifact.id, stale: true, verified: false })
  emit({ type: 'runtime.progress', phase: 'Ready' })
  expect(controller.getSnapshot().runtime.phase).toBe('Environment unavailable')
  browser.closeTerminal = async () => { throw new Error('A dead guest cannot receive a close RPC') }
  await expect(controller.closeTerminal(terminal.id)).resolves.toBeUndefined()
})

test('events from the previous browser guest cannot replace the selected native runtime state', async () => {
  const browser = new ControlledExecution('browser', source)
  const local = new ControlledExecution('local')
  let emitBrowser
  const { controller } = await fixture({ createExecution: async (target, { onEvent }) => { if (target === 'browser') emitBrowser = onEvent; return target === 'browser' ? browser : local } })
  await controller.startRuntime()
  await controller.setExecutionTarget('local', { transfer: true })
  const before = controller.getSnapshot().runtime
  emitBrowser({ type: 'runtime.error', error: 'Old guest stopped' })
  emitBrowser({ type: 'runtime.progress', phase: 'Booting' })
  expect(controller.getSnapshot().runtime).toEqual(before)
})

test('a guest crash during durable location saving cannot restore readiness', async () => {
  const browser = new ControlledExecution('browser', source)
  let emit
  const { controller, files } = await fixture({ createExecution: async (_, { onEvent }) => { emit = onEvent; return browser } })
  const gate = pauseOnce(files.store, 'put', { when: (table, row) => table === 'settings' && row.key === 'workspace-location:default' })
  const boot = controller.startRuntime()
  await gate.entered
  emit({ type: 'runtime.error', error: 'Guest stopped during setup' })
  gate.release()
  await expect(boot).rejects.toThrow('Guest stopped during setup')
  expect(controller.getSnapshot().runtime.status).toBe('failed')
  expect(await files.store.get('settings', 'workspace-location:default')).toBeUndefined()
})

test('a failed destination cannot commit a transfer during its durable location save', async () => {
  const browser = new ControlledExecution('browser', source); const local = new ControlledExecution('local')
  let emitLocal
  const { controller, files } = await fixture({ createExecution: async (target, { onEvent }) => { if (target === 'local') emitLocal = onEvent; return target === 'browser' ? browser : local } })
  await controller.startRuntime()
  const previous = await files.store.get('settings', 'workspace-location:default')
  const gate = pauseOnce(files.store, 'put', { when: (table, row) => table === 'settings' && row.key === 'workspace-location:default' })
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  await gate.entered
  emitLocal({ type: 'runtime.error', error: 'Destination stopped during transfer' })
  gate.release()
  await expect(transfer).rejects.toThrow('Destination stopped during transfer')
  expect(controller.getSnapshot().runtime).toMatchObject({ target: 'browser', status: 'ready' })
  expect(files.backend).toBe(browser)
  expect(await files.store.get('settings', 'workspace-location:default')).toEqual(previous)
  expect((await browser.read('app/page.jsx')).content).toBe(source['app/page.jsx'])
})

test('a source crash during transfer stays failed after transfer rollback', async () => {
  const browser = new ControlledExecution('browser', source); const local = new ControlledExecution('local')
  let emitBrowser
  const { controller, files } = await fixture({ createExecution: async (target, { onEvent }) => { if (target === 'browser') emitBrowser = onEvent; return target === 'browser' ? browser : local } })
  await controller.startRuntime()
  const gate = pauseOnce(local, 'snapshot')
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  await gate.entered
  emitBrowser({ type: 'runtime.error', error: 'Source stopped during transfer' })
  gate.release()
  await expect(transfer).rejects.toThrow('Source stopped during transfer')
  expect(controller.getSnapshot().runtime).toMatchObject({ target: 'browser', status: 'failed', detail: 'Source stopped during transfer' })
  expect(files.backend).toBe(browser)
})

test('a native reconnect lost during location saving cannot acknowledge the replacement', async () => {
  const original = new ControlledExecution('local'); const replacement = new ControlledExecution('local')
  original.url = replacement.url = 'https://companion.invalid'; original.token = replacement.token = 'fixture-only'
  replacement.descriptor.runtimeId = 'local:session-2'
  let pairs = 0
  const { controller, hub, files } = await startedFixture({ createCompanion: () => pairs++ ? replacement : original, createExecution: async () => original })
  await controller.connectCompanion({ url: original.url, token: original.token })
  await controller.setExecutionTarget('local', { transfer: true })
  await controller.createFile('retained.txt', 'native bytes before reconnect')
  replacement.files = original.files; replacement.serial = original.serial
  const previous = await files.store.get('settings', 'workspace-location:default')
  const gate = pauseOnce(files.store, 'put', { when: (table, row) => table === 'settings' && row.key === 'workspace-location:default' })
  const reconnect = controller.connectCompanion({ url: original.url, token: original.token })
  await gate.entered
  // The Hub's real health/transport event, not an invented callback on the port.
  hub.emit({ type: 'bridge', state: { status: 'down', url: original.url, error: 'Native companion stopped during reconnect' } })
  gate.release()
  await expect(reconnect).rejects.toThrow('Native companion stopped during reconnect')
  expect(controller.getSnapshot().runtime).toMatchObject({ target: 'local', status: 'failed' })
  expect(controller.getSnapshot().companion.status).toBe('down')
  expect(files.backend).toBe(original)
  expect(await files.store.get('settings', 'workspace-location:default')).toEqual(previous)
  expect((await controller.readFile('retained.txt')).content).toBe('native bytes before reconnect')
})

test('a runtime identity restart during the final location save rejects startup and its durable acknowledgement', async () => {
  const { controller, files, browser } = await fixture()
  const gate = pauseOnce(files.store, 'put', { when: (table, row) => table === 'settings' && row.key === 'workspace-location:default' })
  const boot = controller.startRuntime()
  await gate.entered
  browser.descriptor.runtimeId = 'browser:restarted-without-old-error-event'
  gate.release()
  await expect(boot).rejects.toThrow('runtimeId')
  expect(controller.getSnapshot().runtime.status).toBe('failed')
  expect(await files.store.get('settings', 'workspace-location:default')).toBeUndefined()
  expect((await browser.read('app/page.jsx')).content).toBe(source['app/page.jsx'])
})

test('a destination identity restart during final transfer saving restores the source location', async () => {
  const { controller, files, browser, local } = await fixture()
  await controller.startRuntime()
  const previous = await files.store.get('settings', 'workspace-location:default')
  const gate = pauseOnce(files.store, 'put', { when: (table, row) => table === 'settings' && row.key === 'workspace-location:default' })
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  await gate.entered
  local.descriptor.runtimeId = 'local:restarted-during-transfer'
  gate.release()
  await expect(transfer).rejects.toThrow('runtimeId')
  expect(controller.getSnapshot().runtime).toMatchObject({ target: 'browser', status: 'ready', binding: previous.value.binding })
  expect(files.backend).toBe(browser)
  expect(await files.store.get('settings', 'workspace-location:default')).toEqual(previous)
  expect((await browser.read('app/page.jsx')).content).toBe(source['app/page.jsx'])
})

test('a source identity restart during final transfer saving cannot restore stale readiness', async () => {
  const { controller, files, browser } = await fixture()
  await controller.startRuntime()
  const previous = await files.store.get('settings', 'workspace-location:default')
  const gate = pauseOnce(files.store, 'put', { when: (table, row) => table === 'settings' && row.key === 'workspace-location:default' })
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  await gate.entered
  browser.descriptor.runtimeId = 'browser:source-restarted-during-transfer'
  gate.release()
  await expect(transfer).rejects.toThrow('runtimeId')
  expect(controller.getSnapshot().runtime).toMatchObject({ target: 'browser', status: 'failed' })
  expect(files.backend).toBe(browser)
  expect(await files.store.get('settings', 'workspace-location:default')).toEqual(previous)
  expect((await browser.read('app/page.jsx')).content).toBe(source['app/page.jsx'])
})

test('a native destination disconnect during final transfer saving is observed before target selection commits', async () => {
  const browser = new ControlledExecution('browser', source); const local = new ControlledExecution('local')
  Object.assign(local, { url: 'https://companion.invalid', token: 'fixture-only' })
  const { controller, hub, files } = await startedFixture({ createCompanion: () => local, createExecution: async target => target === 'browser' ? browser : local })
  await controller.connectCompanion({ url: local.url, token: local.token })
  await controller.startRuntime()
  const previous = await files.store.get('settings', 'workspace-location:default')
  const gate = pauseOnce(files.store, 'put', { when: (table, row) => table === 'settings' && row.key === 'workspace-location:default' })
  const transfer = controller.setExecutionTarget('local', { transfer: true })
  await gate.entered
  expect(controller.getSnapshot().runtime.target).toBe('browser')
  hub.emit({ type: 'bridge', state: { status: 'down', url: local.url, error: 'Native destination stopped before commit' } })
  gate.release()
  await expect(transfer).rejects.toThrow('Native destination stopped before commit')
  expect(controller.getSnapshot().runtime).toMatchObject({ target: 'browser', status: 'ready' })
  expect(controller.getSnapshot().companion.status).toBe('down')
  expect(files.backend).toBe(browser)
  expect(await files.store.get('settings', 'workspace-location:default')).toEqual(previous)
})

function healthFixturePort() {
  const port = new ControlledExecution('browser', source)
  port.descriptor.health = 'responsive'
  let listener
  const createExecution = async (_target, options) => { listener = options.onEvent; return port }
  const emit = event => listener(event)
  const delayed = (outstanding = [{ id: 'slow-read', method: 'fs.list' }]) => { port.descriptor.health = 'unresponsive'; emit({ type: 'runtime.health', health: 'unresponsive', unresolvedRequests: outstanding }) }
  const reconciled = () => { port.descriptor.health = 'responsive'; emit({ type: 'runtime.reconciled', settled: [] }); emit({ type: 'runtime.health', health: 'responsive', outstanding: [] }) }
  return { port, createExecution, emit, delayed, reconciled }
}

function snapshotWhen(controller, predicate) {
  if (predicate(controller.getSnapshot())) return Promise.resolve(controller.getSnapshot())
  return new Promise(resolve => { const off = controller.subscribe(() => { const state = controller.getSnapshot(); if (predicate(state)) { off(); resolve(state) } }) })
}

test('delayed runtime pauses new work, preserves terminals and invalidates verified evidence once', async () => {
  const runtime = healthFixturePort()
  const { controller, hub } = await startedFixture({ createExecution: runtime.createExecution, inspectArtifact: async artifact => ({ ok: true, artifactId: artifact.id, revision: artifact.revision, buildId: artifact.buildId }) })
  await controller.buildPreview(); await controller.checkArtifact({ assertions })
  const terminal = await controller.openTerminal({})
  const binding = controller.getSnapshot().runtime.binding
  const context = { context: { binding } }
  const revision = hub.externalOps['workspace.environment']({}, context).revision
  runtime.delayed()
  runtime.delayed([{ id: 'slow-write', method: 'fs.write', path: 'app/page.jsx' }])
  runtime.emit({ type: 'runtime.progress', phase: 'Ready' })
  const state = controller.getSnapshot()
  expect(state.runtime).toMatchObject({ status: 'unresponsive', phase: 'Response delayed', outstanding: [{ id: 'slow-write', method: 'fs.write', path: 'app/page.jsx' }] })
  expect(state.runtime.detail).toContain('outcomes are unknown')
  expect(state.artifacts.at(-1)).toMatchObject({ stale: true, verified: false })
  for (const operation of [() => controller.saveFile({ path: 'app/page.jsx', content: 'not admitted' }), () => controller.runCommand('not admitted'), () => controller.startRuntime(), () => controller.openTerminal({}), () => controller.setExecutionTarget('local', { transfer: true })]) await expect(operation()).rejects.toMatchObject({ code: 'RUNTIME_UNRESPONSIVE' })
  expect(() => controller.readFile('app/page.jsx')).toThrow('outcomes are unknown')
  expect(() => hub.externalOps['workspace.list']({}, context)).toThrow('outcomes are unknown')
  expect(runtime.port.jobs).toHaveLength(1)
  await controller.closeTerminal(terminal.id)
  expect(runtime.port.closedTerminals).toEqual([terminal.id])
  const ready = snapshotWhen(controller, state => state.runtime.status === 'ready')
  runtime.reconciled(); await ready
  expect(hub.externalOps['workspace.environment']({}, context).revision).toBe(revision + 1)
  expect(controller.getSnapshot().artifacts.at(-1)).toMatchObject({ stale: true, verified: false })
})

test('late job completion waits for responses and preserves controls and terminal reservations', async () => {
  const runtime = healthFixturePort()
  const { controller } = await fixture({ createExecution: runtime.createExecution })
  await controller.startRuntime()
  const terminal = await controller.openTerminal({})
  const entered = deferred(), finished = deferred()
  runtime.port.onJob = request => { entered.resolve(request); return finished.promise }
  const command = controller.runCommand('delayed command')
  const job = await entered.promise
  const controls = []
  runtime.port.cancelJob = async id => { controls.push(['cancel', id]) }
  runtime.port.resizeTerminal = async (id, cols, rows) => { controls.push(['resize', id, cols, rows]) }
  runtime.port.terminalInput = async (id, data) => { controls.push(['input', id, data]) }
  runtime.delayed([{ id: 'unrelated-read', method: 'fs.read', path: 'package.json' }])
  await controller.resizeTerminal(terminal.id, 100, 30)
  expect(() => controller.terminalInput(terminal.id, 'echo unexpected\n')).toThrow('outcomes are unknown')
  await controller.terminalInput(terminal.id, '\u0003')
  await controller.stopCommand(job.id)
  finished.resolve({ code: 0, cancelled: false })
  await Promise.resolve(); await Promise.resolve()
  expect(controller.getSnapshot().commands.at(-1).status).toBe('running')
  const refresh = pauseOnce(runtime.port, 'list')
  const ready = snapshotWhen(controller, state => state.runtime.status === 'ready')
  runtime.reconciled()
  await refresh.entered
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
  refresh.release(); await ready
  expect((await command).code).toBe(0)
  expect(controller.getSnapshot().commands.at(-1).status).toBe('done')
  expect(controls).toEqual([['resize', terminal.id, 100, 30], ['input', terminal.id, '\u0003'], ['cancel', job.id]])
  await expect(controller.setExecutionTarget('local', { transfer: true })).rejects.toThrow('Close terminal')
  await controller.closeTerminal(terminal.id)
})

test('file watcher has one in-flight read and suspends polling throughout delayed health', async () => {
  const original = globalThis.setInterval; let tick
  globalThis.setInterval = callback => { tick = callback; return 0 }
  cleanups.push(() => { globalThis.setInterval = original })
  const runtime = healthFixturePort()
  const { controller } = await startedFixture({ createExecution: runtime.createExecution })
  await controller.startRuntime()
  const read = deferred(); const entered = deferred(); let calls = 0
  const list = runtime.port.list.bind(runtime.port)
  runtime.port.list = async (...args) => { calls++; entered.resolve(); return read.promise }
  const first = tick(); await entered.promise
  await tick(); await tick(); expect(calls).toBe(1)
  runtime.delayed()
  await tick(); expect(calls).toBe(1)
  read.resolve(await list()); await first
  await tick(); expect(calls).toBe(1)
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
  runtime.port.list = list
  const ready = snapshotWhen(controller, state => state.runtime.status === 'ready')
  runtime.reconciled(); await ready
  await tick()
  expect(controller.getSnapshot().runtime.status).toBe('ready')
})

test('initial mount timeout remains delayed and requires explicit same-port setup after reconciliation', async () => {
  const runtime = healthFixturePort(); let starts = 0; let disposed = 0
  runtime.port.dispose = () => { disposed++ }
  const { controller, files } = await fixture({ createExecution: async (...args) => { starts++; return runtime.createExecution(...args) } })
  const list = runtime.port.list.bind(runtime.port)
  const entered = deferred(), reply = deferred()
  runtime.port.list = async () => { entered.resolve(); return reply.promise }
  const setup = controller.startRuntime()
  const failure = setup.catch(error => error)
  await entered.promise; runtime.delayed(); reply.reject(Object.assign(new Error('fs.list timed out'), { code: 'RPC_TIMEOUT' }))
  expect((await failure).code).toBe('RPC_TIMEOUT')
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
  expect(await files.store.get('settings', 'workspace-location:default')).toBeUndefined()
  runtime.port.list = list
  runtime.reconciled(); await Promise.resolve(); await Promise.resolve()
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
  expect(starts).toBe(1); expect(disposed).toBe(0)
  expect(await controller.startRuntime()).toBe(runtime.port)
  expect(controller.getSnapshot().runtime.status).toBe('ready')
  expect(starts).toBe(2); expect(disposed).toBe(0)
})

test('reconciliation cannot restore Ready after the binding changes during its refresh', async () => {
  const runtime = healthFixturePort()
  const { controller } = await fixture({ createExecution: runtime.createExecution })
  await controller.startRuntime(); runtime.delayed()
  const refresh = pauseOnce(runtime.port, 'list')
  runtime.reconciled(); await refresh.entered
  runtime.port.descriptor.runtimeId = 'browser:replacement-session'
  const rejected = snapshotWhen(controller, state => state.runtime.detail.includes('binding runtimeId changed'))
  refresh.release(); await rejected
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
  await expect(controller.startRuntime()).rejects.toThrow('outcomes are unknown')
})

test('stop observes rejected asynchronous environment disposal', async () => {
  const runtime = healthFixturePort(); const disposal = deferred()
  runtime.port.dispose = () => disposal.promise
  const { controller } = await fixture({ createExecution: runtime.createExecution })
  await controller.startRuntime(); controller.stop(); controllers.delete(controller)
  disposal.reject(new Error('checkpoint outcome unknown'))
  await Promise.resolve(); await Promise.resolve()
  expect(controller.getSnapshot().error).toContain('Environment shutdown could not be confirmed: checkpoint outcome unknown')
})

test('a newer reconciled health cycle queues a fresh refresh after the obsolete one settles', async () => {
  const runtime = healthFixturePort()
  const { controller } = await fixture({ createExecution: runtime.createExecution })
  await controller.startRuntime(); runtime.delayed()
  const refresh = pauseOnce(runtime.port, 'list', { after: true })
  runtime.reconciled(); await refresh.entered
  runtime.delayed([{ id: 'second-list', method: 'fs.list' }])
  runtime.port.externalWrite('new.txt', 'only the second refresh sees this')
  runtime.reconciled()
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
  const ready = snapshotWhen(controller, state => state.runtime.status === 'ready')
  refresh.release(); await ready
  expect(controller.getSnapshot().files.some(file => file.path === 'new.txt')).toBe(true)
})

test('failed recovery read does not automatically repeat the same reconciliation cycle', async () => {
  const runtime = healthFixturePort()
  const { controller } = await fixture({ createExecution: runtime.createExecution })
  await controller.startRuntime(); runtime.delayed()
  let reads = 0
  runtime.port.list = async () => { reads++; throw new Error('controlled refresh failure') }
  const failed = snapshotWhen(controller, state => state.runtime.detail.includes('controlled refresh failure'))
  runtime.reconciled(); await failed; await Promise.resolve(); await Promise.resolve()
  expect(reads).toBe(1)
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
})

test('a post-exit checkpoint failure preserves the actual exit without accepting its build', async () => {
  const { controller, files } = await fixture()
  const prior = await controller.buildPreview()
  files.checkpoint = async () => { throw new Error('checkpoint timed out') }
  await expect(controller.buildPreview()).rejects.toThrow('checkpoint timed out')
  expect(controller.getSnapshot().commands.at(-1)).toMatchObject({ status: 'failed', exitCode: 0, cancelled: false, signal: null, executionEnded: true, stage: 'reconciliation-failed' })
  expect(controller.getSnapshot().commands.at(-1).error).toBe('Command exited with code 0; workspace reconciliation failed: checkpoint timed out')
  expect(controller.getSnapshot().artifacts).toHaveLength(1)
  expect(controller.getSnapshot().artifacts[0].id).toBe(prior.id)
})

test('an actual crash after delay releases stale health for explicit replacement setup', async () => {
  let port = new ControlledExecution('browser', source), emit
  port.descriptor.health = 'responsive'
  const { controller } = await fixture({ createExecution: async (_target, options) => { emit = options.onEvent; return port } })
  await controller.startRuntime()
  port.descriptor.health = 'unresponsive'
  emit({ type: 'runtime.health', health: 'unresponsive', unresolvedRequests: [{ id: 'delayed-before-crash', method: 'fs.list' }] })
  port.descriptor.health = 'responsive' // The crashed adapter has released its pending request journal.
  emit({ type: 'runtime.error', error: 'Actual guest failure after delay' })
  expect(controller.getSnapshot().runtime.status).toBe('failed')
  port = new ControlledExecution('browser', source)
  port.descriptor.health = 'responsive'; port.descriptor.runtimeId = 'browser:replacement-after-crash'
  await controller.startRuntime()
  expect(controller.getSnapshot().runtime).toMatchObject({ status: 'ready', binding: { runtimeId: 'browser:replacement-after-crash' } })
})

test('stopping a task observes late cancellation rejection without inventing a cancelled exit', async () => {
  const { controller, browser } = await fixture()
  const admitted = deferred(), finished = deferred(), cancellation = deferred()
  browser.onJob = request => { admitted.resolve(request); return finished.promise }
  browser.cancelJob = () => cancellation.promise
  const command = controller.runCommand('actual completion still pending', { runId: 'controlled-task' })
  await admitted.promise
  controller.stopRun()
  cancellation.reject(new Error('Cancellation receipt unavailable'))
  await Promise.resolve(); await Promise.resolve()
  expect(controller.getSnapshot().error).toBe('Cancellation receipt unavailable')
  expect(controller.getSnapshot().commands.at(-1).status).toBe('running')
  finished.resolve({ code: 0, cancelled: false })
  await command
  expect(controller.getSnapshot().commands.at(-1)).toMatchObject({ status: 'done', exitCode: 0, cancelled: false })
})

const generalWorkflows = {
  defaultWorkflow: 'assistant',
  workflows: [
    { id: 'assistant', label: 'General assistant', description: 'Research and plan', agent: 'assistant', workspace: false },
    { id: 'coding', label: 'Build an app', description: 'Build and verify', agent: 'main', workspace: true },
  ],
}

test('general workflow starts its agent without a workspace and keeps tool scope frozen', async () => {
  let executions = 0
  const { controller, hub } = await startedFixture({ workbenchConfig: generalWorkflows, createExecution: async () => { executions++; throw new Error('General work must not boot Linux') } })
  await controller.setConversationGoal('Compare primary sources')
  const supplied = { disabledTools: ['web_fetch'], approvalRisks: ['net'], allowDelegation: false }
  await controller.setToolPolicy(supplied)
  supplied.disabledTools.push('later_mutation')
  const id = await controller.sendGoal('Research the question')
  const run = hub.runs.get(id)
  expect(executions).toBe(0)
  expect(run.agent).toBe('assistant')
  expect(run.context.binding).toBeUndefined()
  expect(run.context.workflow).toEqual(generalWorkflows.workflows[0])
  expect(run.context.toolPolicy.disabledTools).toEqual(['web_fetch'])
  expect(Object.isFrozen(run.context.toolPolicy)).toBe(true)
  expect(run.context.savedGoal.text).toBe('Compare primary sources')
  expect(await hub.externalOps['workspace.goal']({}, run)).toEqual({ text: 'Compare primary sources', revision: 1 })
  expect(() => hub.externalOps['workspace.read']({ path: 'app/page.js' }, run)).toThrow('no pinned workspace')
  expect(controller.getSnapshot().runtime.status).toBe('idle')
  expect(controller.getSnapshot().agents[0]).toMatchObject({ id, agent: 'assistant', parent: null })
  await expect(controller.setWorkflow('coding')).rejects.toThrow('active work')
  await expect(controller.setToolPolicy({ allowDelegation: true })).rejects.toThrow('active work')
})

test('workflow selection and policy persist without restoring running processes', async () => {
  const first = await startedFixture({ workbenchConfig: generalWorkflows })
  await first.controller.setWorkflow('coding')
  await first.controller.setToolPolicy({ approvalRisks: ['write'], allowDelegation: false })
  const firstRun = await first.controller.sendGoal('Create a file')
  first.hub.runs.get(firstRun).slot.status = 'thinking'
  first.hub.emit({ type: 'status', run: firstRun, slot: { status: 'thinking', steps: 1 } })
  first.controller.stop(); controllers.delete(first.controller)
  await new Promise(resolve => setTimeout(resolve, 0))
  const second = await startedFixture({ sharedStore: first.files.store, workbenchConfig: generalWorkflows })
  expect(second.controller.getSnapshot().selectedWorkflowId).toBe('coding')
  expect(second.controller.getSnapshot().toolPolicy).toEqual({ disabledTools: [], approvalRisks: ['write'], allowDelegation: false })
  expect(second.controller.getSnapshot().run.status).toBe('interrupted')
  expect(second.controller.getSnapshot().agents).toEqual([])
  expect(second.hub.runs.size).toBe(0)
  expect(second.controller.getSnapshot().runtime.status).toBe('idle')
  await second.controller.setWorkflow('assistant')
  expect(second.controller.getSnapshot().selectedWorkflowId).toBe('assistant')
})

test('invalid workflow or tool policy cannot dispatch or replace the configured selection', async () => {
  const { controller, hub } = await startedFixture({ workbenchConfig: generalWorkflows })
  await expect(controller.setWorkflow('invented')).rejects.toThrow('Unknown workflow')
  await expect(controller.setToolPolicy({ approvalRisks: ['admin'] })).rejects.toThrow('Invalid run tool policy')
  await expect(controller.setToolPolicy({ arbitrary: true })).rejects.toThrow('Invalid run tool policy')
  expect(controller.getSnapshot().selectedWorkflowId).toBe('assistant')
  expect(controller.getSnapshot().toolPolicy.allowDelegation).toBe(true)
  expect(hub.runs.size).toBe(0)
})

test('definitions remain a catalogue while live parent and child status project separately', async () => {
  const { controller, hub } = await startedFixture({ workbenchConfig: generalWorkflows })
  const definitions = [{ path: 'assistant', name: 'Assistant', tools: [] }, { path: 'researcher', name: 'Researcher', tools: [] }]
  hub.manifest = () => definitions
  hub.emit({ type: 'ready' })
  hub.runs.set('owner', { id: 'owner', agent: 'assistant', query: 'Question', slot: { status: 'waiting', steps: 2, maxSteps: 24, current: 'researcher' } })
  hub.runs.set('child', { id: 'child', agent: 'researcher', parent: 'owner', query: 'Read source', slot: { status: 'thinking', steps: 1, maxSteps: 10 } })
  hub.emit({ type: 'status', run: 'child', slot: { status: 'thinking', steps: 1 } })
  expect(controller.getSnapshot().agentDefinitions).toEqual(definitions)
  expect(controller.getSnapshot().agents).toEqual([
    expect.objectContaining({ id: 'owner', agent: 'assistant', parent: null, status: 'waiting', current: 'researcher', maxSteps: 24 }),
    expect.objectContaining({ id: 'child', agent: 'researcher', parent: 'owner', status: 'thinking' }),
  ])
})

test('agent inspector returns configured composition and only the selected agent latest exact prompt', async () => {
  const { controller, hub } = await startedFixture({ workbenchConfig: generalWorkflows })
  hub.specs = new Map([['assistant', { soul: 'Shared identity', body: 'Configured instructions', context: ['goal'], engine: { contractVersion: 2, responseFormat: 'json', maxSteps: 24, promptTemplate: { system: '{{job}}', user: '{{conversation}}' } }, inference: { api_key: 'must-not-appear' } }]])
  let inspectedPolicy
  hub.manifest = options => { inspectedPolicy = options.toolPolicy; return [{ path: 'assistant', name: 'Assistant', description: 'General', tools: [{ name: 'web_fetch', requires: ['network'] }] }] }
  const messages = [{ role: 'system', content: 'Actual recorded instructions' }, { role: 'user', content: 'Actual task' }]
  hub.runs.set('selected', { id: 'selected', agent: 'assistant', at: 2, prompts: [{ step: 3, attemptId: 'attempt3', snapshot: { messages, budget: { inputTokens: 42 } } }], requests: [{ authorization: 'must-not-appear' }] })
  hub.runs.set('other', { id: 'other', agent: 'main', at: 3, prompts: [{ snapshot: { messages: [{ role: 'user', content: 'Wrong agent history' }] } }] })
  const details = await controller.getAgentDetails('assistant')
  expect(inspectedPolicy).toEqual(controller.getSnapshot().toolPolicy)
  expect(details.instructions).toBe('Configured instructions')
  expect(details.contractVersion).toBe(2)
  expect(details.promptTemplate).toEqual({ system: '{{job}}', user: '{{conversation}}' })
  expect(details.latestPrompt).toEqual({ messages, budget: { inputTokens: 42 }, attemptId: 'attempt3', step: 3 })
  expect(JSON.stringify(details)).not.toContain('must-not-appear')
  expect(JSON.stringify(details)).not.toContain('Wrong agent history')
  expect(Object.isFrozen(details.latestPrompt.messages)).toBe(true)
  await expect(controller.getAgentDetails('unknown')).rejects.toThrow('Unknown agent')
})


test('explicit null policy in configuration or restored preferences fails closed', async () => {
  await expect(startedFixture({ workbenchConfig: { ...generalWorkflows, toolPolicy: null } })).rejects.toThrow('Invalid run tool policy')
  const files = new ProjectFiles()
  files.store = await openStore(`invalid-restored-policy-${crypto.randomUUID()}`)
  files.store.durable = true
  await files.store.put('settings', { key: 'workbench-state', value: { toolPolicy: null } })
  await expect(startedFixture({ sharedStore: files.store, workbenchConfig: generalWorkflows })).rejects.toThrow('Invalid run tool policy')
})


test('explicit direct model transport escapes a disconnected relay and works independently of delayed Linux', async () => {
  const runtime = healthFixturePort()
  const { controller, hub } = await startedFixture({ workbenchConfig: generalWorkflows, createExecution: runtime.createExecution })
  await controller.startRuntime()
  runtime.delayed([{ id: 'old-read', method: 'fs.list', path: '/' }])
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
  const requested = []
  hub.models = { refresh: async alias => {
    try {
      const settings = resolve({ model: alias }, hub.settings.get().catalogue)
      const models = await inference(settings, { bridge: null, fetch: async url => { requested.push(url); return Response.json({ data: [{ id: 'fixture-model' }] }) } }).models()
      return { ids: models.map(model => model.id), at: 1 }
    } catch (error) { return { error: error.message, at: 1 } }
  } }
  await controller.setModel({ model: 'fixture-model', baseUrl: 'https://model.invalid/v1', via: 'bridge' })
  await expect(controller.testModel()).rejects.toThrow('model relay is disconnected')
  expect(requested).toEqual([])
  await controller.setModel({ model: 'fixture-model', baseUrl: 'https://model.invalid/v1', via: 'direct' })
  const checked = await controller.testModel()
  expect(checked.ids).toEqual(['fixture-model'])
  expect(requested).toEqual(['https://model.invalid/v1/models'])
  expect(hub.settings.get().catalogue.models.workbench.via).toBe('direct')
  expect(controller.getSnapshot().model).toMatchObject({ via: 'direct', status: 'connected' })
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
  const runId = await controller.sendGoal('Explain this without executing files')
  expect(hub.runs.get(runId).agent).toBe('assistant')
  expect(hub.runs.get(runId).context.binding).toBeUndefined()
  expect(controller.getSnapshot().runtime.status).toBe('unresponsive')
})

const roleDefinition = { version: 1, id: 'review', kind: 'graph', nodes: [{ id: 'answer', agent: 'assistant', dependsOn: [], template: '{{goal}}', inputs: { goal: { from: 'goal', maxChars: 12000 } } }], output: 'answer', limits: { maxParallel: 1, maxWallMs: 10000 } }
const roleWorkflow = { defaultWorkflow: 'review', workflows: [{ id: 'review', label: 'Review', description: 'Configured roles', agent: 'assistant', workspace: false, strategy: 'strategies/review.json' }] }
function strategyFixtureHub(hub) {
  hub.loadStrategy = async ref => { expect(ref).toBe('strategies/review.json'); return { definition: structuredClone(roleDefinition), definitionHash: 'sha256:fixture', files: { [ref]: 'fixture' } } }
  hub.startStrategy = async (definition, query, options) => {
    expect(definition).toEqual(roleDefinition)
    expect(options.definitionHash).toBe('sha256:fixture')
    expect(options.admissionGuard()).toBe(true)
    const run = hub.startRun('assistant', query, options); run.kind = 'strategy'; run.slot.status = 'running'
    hub.emit({ type: 'run', run })
    hub.emit({ type: 'strategy', run: run.id, task: { id: run.id, status: 'running', nodes: [{ nodeId: 'answer', runId: 'child', status: 'running' }], definition } })
    hub.emit({ type: 'status', run: run.id, slot: run.slot })
    return run
  }
}

test('configured role workflow dispatches without Linux, freezes context and rejects mid-run steering', async () => {
  let executions = 0
  const { controller, hub } = await startedFixture({ workbenchConfig: roleWorkflow, configureHub: strategyFixtureHub, createExecution: async () => { executions++; throw new Error('No guest needed') } })
  const id = await controller.sendGoal('Review this idea')
  expect(executions).toBe(0)
  expect(controller.getSnapshot().task).toMatchObject({ id, status: 'running', definition: roleDefinition })
  expect(controller.getSnapshot().agents).toEqual([])
  expect(hub.runs.get(id).context.workflow.strategy).toBeUndefined()
  expect(hub.runs.get(id).context.workflow.strategyHash).toBeUndefined()
  expect(Object.isFrozen(hub.runs.get(id).context)).toBe(true)
  await expect(controller.sendGoal('Change a role input')).rejects.toThrow('Role inputs are fixed')
  hub.runs.set('child', { id: 'child', kind: 'strategy-role', taskId: id, stageId: 'answer', parent: id, agent: 'assistant', query: 'Role input', slot: { status: 'done' }, result: 'Role output', prompts: [{ snapshot: { messages: [{ role: 'user', content: 'Role input' }] } }], requests: [{ authorization: 'secret' }] })
  hub.emit({ type: 'status', run: 'child', slot: { status: 'done' } })
  expect(controller.getSnapshot().agents).toEqual([expect.objectContaining({ id: 'child', kind: 'strategy-role', stageId: 'answer', result: 'Role output' })])
  const inspected = await controller.getRunDetails('child')
  expect(inspected.result).toBe('Role output')
  expect(inspected.prompts[0].snapshot.messages[0].content).toBe('Role input')
  expect(JSON.stringify(inspected)).not.toContain('secret')
})

test('stop during asynchronous strategy admission invalidates the launch guard', async () => {
  const entered = deferred(); const release = deferred(); let guard
  const { controller, hub } = await startedFixture({ workbenchConfig: roleWorkflow, configureHub(hub) {
    strategyFixtureHub(hub)
    hub.startStrategy = async (_, query, options) => { guard = options.admissionGuard; entered.resolve(); await release.promise; if (!guard()) throw new Error('Admission cancelled'); return hub.startRun('assistant', query, options) }
  } })
  const launch = controller.sendGoal('Cancelled goal')
  await entered.promise
  controller.stopRun()
  expect(guard()).toBe(false)
  release.resolve()
  expect(await launch).toBeNull()
  expect(hub.runs.size).toBe(0)
  expect(controller.getSnapshot().run.status).toBe('cancelled')
})

test('persisted role state restores interrupted without replaying roles', async () => {
  const first = await startedFixture({ workbenchConfig: roleWorkflow, configureHub: strategyFixtureHub })
  await first.controller.sendGoal('Pending role')
  first.controller.stop(); controllers.delete(first.controller)
  await new Promise(resolve => setTimeout(resolve, 0))
  const second = await startedFixture({ sharedStore: first.files.store, workbenchConfig: roleWorkflow, configureHub: strategyFixtureHub })
  expect(second.controller.getSnapshot().task.status).toBe('interrupted')
  expect(second.controller.getSnapshot().task.nodes[0].status).toBe('interrupted')
  expect(second.hub.runs.size).toBe(0)
})


test('late coordinator state from a stopped admission cannot replace a newer visible task', async () => {
  const { controller, hub } = await startedFixture({ workbenchConfig: roleWorkflow, configureHub: strategyFixtureHub })
  const old = await controller.sendGoal('First graph')
  hub.abort = run => { run.ended = true; run.slot.status = 'cancelled'; hub.emit({ type: 'status', run: run.id, slot: run.slot }) }
  controller.stopRun()
  const current = await controller.sendGoal('Second graph')
  const before = controller.getSnapshot()
  hub.emit({ type: 'strategy', run: old, task: { id: old, status: 'cancelled', nodes: [] } })
  hub.emit({ type: 'status', run: old, slot: { status: 'cancelled' } })
  hub.emit({ type: 'answer', run: old, text: 'Late old answer', ok: false })
  expect(controller.getSnapshot().task.id).toBe(current)
  expect(controller.getSnapshot().run).toEqual(before.run)
  expect(controller.getSnapshot().messages).toEqual(before.messages)
})
