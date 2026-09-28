import { describe, expect, test } from 'bun:test'
import {
  WORKSPACE_CONTRACT_VERSION, createWorkspaceBinding, assertWorkspaceBinding,
  assertWorkspacePort, assertExecutionPort, createArtifactManifest, assertArtifactManifest,
  createBoundRunSnapshot, assertPromptSnapshot, assertProviderRequest,
} from '../src/workspace/contracts.js'

const bindingInput = () => ({ workspaceId: 'project-a', target: 'browser', runtimeId: 'browser-linux:image-7:boot-1', root: '/workspace', toolchain: { kind: 'node', version: '22.22.0', packageManager: 'npm', packages: { next: '16.3.6' } } })
const descriptor = (overrides = {}) => ({ ...bindingInput(), capabilities: ['files', 'shell', 'pty'], ...overrides })
const port = description => ({
  describeCapabilities: () => description,
  prepare() { throw new Error('Validation must not boot an executor') },
  startJob() { throw new Error('Validation must not execute a command') },
  cancelJob() {}, dispose() {}, list() {}, read() {}, write() {}, rename() {}, remove() {}, snapshot() {},
  openTerminal() {}, terminalInput() {}, resizeTerminal() {}, closeTerminal() {}, subscribeTerminal() {},
})
const prompt = () => ({ attemptId: 'run-a:1:1', step: 1, attempt: 1, contractVersion: 2, model: 'local-model', messages: [{ role: 'system', content: 'Use this workspace.' }, { role: 'user', content: 'Make a tool.' }], budget: { inputTokens: 40, outputReserve: 1024, window: 8192, total: 1064, estimated: true } })
const request = () => ({ provider: 'openai', transportAttempt: 1, url: 'https://model.example/v1/chat/completions', method: 'POST', headers: { authorization: '[redacted]', 'content-type': 'application/json' }, body: { model: 'local-model', messages: [{ role: 'user', content: 'Make a tool.' }] } })
const artifactInput = () => ({ id: 'artifact-a', sourceRevision: 8, sourceFingerprint: 'source-content-fingerprint', runtime: bindingInput(), build: { id: 'build-a', runtimeId: bindingInput().runtimeId, exitCode: 0, sourceRevision: 8 }, resources: ['index.html', { path: 'assets/main.js', size: 120, mime: 'text/javascript', sha256: 'a'.repeat(64) }] })

describe('immutable workspace identity', () => {
  test('pins nested toolchain data without freezing or retaining the mutable source', () => {
    const input = bindingInput()
    const bound = createWorkspaceBinding(input)
    input.root = '/other'
    input.toolchain.packages.next = 'later'
    expect(bound.version).toBe(WORKSPACE_CONTRACT_VERSION)
    expect(bound.root).toBe('/workspace')
    expect(bound.toolchain.packages.next).toBe('16.3.6')
    expect(Object.isFrozen(bound.toolchain.packages)).toBe(true)
    expect(Object.isFrozen(input.toolchain)).toBe(false)
    expect(() => { bound.toolchain.kind = 'bun' }).toThrow()
  })

  test.each([
    ['workspaceId', 'project-b'], ['target', 'local'], ['runtimeId', 'browser-linux:image-7:boot-2'],
    ['root', '/other'], ['toolchain', { kind: 'node', version: '24.0.0' }],
  ])('rejects stale %s at a handoff', (field, replacement) => {
    const bound = createWorkspaceBinding(bindingInput())
    expect(() => assertWorkspaceBinding({ ...bindingInput(), [field]: replacement }, bound)).toThrow(`binding ${field} changed`)
  })

  test('semantic toolchain identity does not depend on object key insertion order', () => {
    const expected = createWorkspaceBinding(bindingInput())
    expect(assertWorkspaceBinding({ ...bindingInput(), toolchain: { packages: { next: '16.3.6' }, packageManager: 'npm', version: '22.22.0', kind: 'node' } }, expected)).toEqual(expected)
  })

  test('requires a complete, canonical versioned identity', () => {
    expect(() => createWorkspaceBinding({ ...bindingInput(), version: 2 })).toThrow('Unsupported workspace contract version')
    expect(() => createWorkspaceBinding({ ...bindingInput(), runtimeId: '' })).toThrow('runtimeId')
    expect(() => createWorkspaceBinding({ ...bindingInput(), toolchain: 'node' })).toThrow('toolchain must be an object')
    for (const root of ['.', 'workspace', '/workspace/../other', '/workspace//other', '/workspace/']) expect(() => createWorkspaceBinding({ ...bindingInput(), root })).toThrow('canonical absolute POSIX')
  })

  test('rejects silent JSON coercion, sparse arrays, getters and cycles', () => {
    const getter = {}; let invoked = false
    Object.defineProperty(getter, 'kind', { enumerable: true, get() { invoked = true; return 'node' } })
    expect(() => createWorkspaceBinding({ ...bindingInput(), toolchain: getter })).toThrow('accessors')
    expect(invoked).toBe(false)
    for (const value of [new Date(), new Set(), { setting: undefined }, { run() {} }, { setting: Infinity }, [,'missing']]) {
      expect(() => createWorkspaceBinding({ ...bindingInput(), toolchain: { kind: 'node', value } })).toThrow()
    }
    const toolchain = { kind: 'node' }; toolchain.self = toolchain
    expect(() => createWorkspaceBinding({ ...bindingInput(), toolchain })).toThrow('cycles')
  })
})

describe('ports grant only explicitly advertised capabilities', () => {
  test('checks both adapter vocabularies without booting or running anything', () => {
    for (const capabilities of [['files', 'shell', 'pty'], ['fs', 'exec', 'terminal']]) {
      const adapter = port(descriptor({ capabilities }))
      expect(assertWorkspacePort(adapter)).toBe(adapter)
      expect(assertExecutionPort(adapter, { binding: createWorkspaceBinding(bindingInput()), requireTerminal: true })).toBe(adapter)
    }
  })

  test('model/network pairing is never filesystem, native execution or terminal authority', () => {
    const paired = port(descriptor({ capabilities: ['model-relay', 'network-relay', 'fetch'] }))
    expect(() => assertWorkspacePort(paired)).toThrow('files capability')
    expect(() => assertExecutionPort(paired)).toThrow('shell capability')
    const shellOnly = port(descriptor({ capabilities: ['shell'] }))
    expect(assertExecutionPort(shellOnly)).toBe(shellOnly)
    expect(() => assertExecutionPort(shellOnly, { requireTerminal: true })).toThrow('pty capability')
  })

  test('fails closed when methods or capability declarations are missing', () => {
    const adapter = port(descriptor())
    delete adapter.write
    expect(() => assertWorkspacePort(adapter)).toThrow('write()')
    delete adapter.cancelJob
    expect(() => assertExecutionPort(adapter)).toThrow('cancelJob()')
    expect(() => assertExecutionPort(port({ filesystem: true, shell: true }))).toThrow('explicit string array')
    expect(() => assertExecutionPort(port(descriptor({ version: 9 })))).toThrow('Unsupported workspace contract version')
  })

  test('a restarted port cannot satisfy the old bound run even with the same methods and permissions', () => {
    const bound = createWorkspaceBinding(bindingInput())
    const restarted = port(descriptor({ runtimeId: 'browser-linux:image-7:boot-2' }))
    expect(() => assertWorkspacePort(restarted, { binding: bound })).toThrow('runtimeId changed')
    expect(() => assertExecutionPort(restarted, { binding: bound })).toThrow('runtimeId changed')
    expect(() => assertExecutionPort(port(descriptor({ root: '/moved' })), { binding: bound })).toThrow('root changed')
  })

  test('the storage owner can supply a descriptor for a framework-free workspace backend', () => {
    const backend = port(descriptor()); delete backend.describeCapabilities
    expect(assertWorkspacePort(backend, { descriptor: descriptor(), binding: bindingInput() })).toBe(backend)
    expect(() => assertWorkspacePort(backend)).toThrow('explicit string array')
  })
})

describe('artifact and run handoffs', () => {
  test('artifact manifest pins source, build and resource metadata without claiming interaction verification', () => {
    const input = artifactInput()
    const manifest = createArtifactManifest(input)
    input.resources[1].size = 900
    input.build.exitCode = 1
    input.runtime.toolchain.kind = 'bun'
    expect(manifest.resources[0]).toEqual({ path: 'index.html' })
    expect(manifest.resources[1].size).toBe(120)
    expect(manifest.build.exitCode).toBe(0)
    expect(manifest.runtime.toolchain.kind).toBe('node')
    expect(Object.isFrozen(manifest.resources[1])).toBe(true)
    expect(manifest.verified).toBeUndefined()
    expect(assertArtifactManifest(JSON.parse(JSON.stringify(manifest)), { binding: bindingInput(), sourceRevision: 8, sourceFingerprint: 'source-content-fingerprint' })).toEqual(manifest)
  })

  test('rejects failed builds and stale source/runtime receipts', () => {
    expect(() => createArtifactManifest({ ...artifactInput(), build: { id: 'build-a', exitCode: 1 } })).toThrow('successful build')
    expect(() => createArtifactManifest({ ...artifactInput(), build: { id: 'build-a', exitCode: 0, runtimeId: 'old-boot' } })).toThrow('runtimeId changed')
    expect(() => createArtifactManifest({ ...artifactInput(), build: { id: 'build-a', exitCode: 0, sourceRevision: 7 } })).toThrow('sourceRevision differ')
    const manifest = createArtifactManifest(artifactInput())
    expect(() => assertArtifactManifest(manifest, { sourceRevision: 9 })).toThrow('sourceRevision is stale')
    expect(() => assertArtifactManifest(manifest, { sourceFingerprint: 'different files' })).toThrow('fingerprint is stale')
    expect(() => assertArtifactManifest(manifest, { binding: { ...bindingInput(), runtimeId: 'another-boot' } })).toThrow('runtimeId changed')
  })

  test('resource inventories cannot contain duplicate, escaping or external paths', () => {
    for (const resources of [['index.html', 'index.html'], ['../escape.js'], ['/absolute.js'], ['https://remote/script.js'], ['asset.js?other']]) expect(() => createArtifactManifest({ ...artifactInput(), resources })).toThrow()
  })

  test('model relay identity stays separate from immutable browser execution identity', () => {
    const input = { runId: 'run-a', binding: bindingInput(), sourceRevision: 8, modelTransport: { kind: 'bridge', provider: 'openai', model: 'local-model', endpoint: 'http://127.0.0.1:8873/v1', token: 'not-part-of-a-public-binding' }, promptSnapshot: prompt(), providerRequests: [request()] }
    const bound = createBoundRunSnapshot(input)
    input.binding.target = 'local'
    input.promptSnapshot.messages[0].content = 'Changed later'
    input.providerRequests[0].body.messages[0].content = 'Changed later'
    expect(bound.binding.target).toBe('browser')
    expect(bound.modelTransport.kind).toBe('bridge')
    expect(bound.modelTransport.token).toBeUndefined()
    expect(bound.promptSnapshot.messages[0].content).toBe('Use this workspace.')
    expect(bound.providerRequests[0].body.messages[0].content).toBe('Make a tool.')
    expect(Object.isFrozen(bound.providerRequests[0].body.messages)).toBe(true)
    expect(createBoundRunSnapshot(JSON.parse(JSON.stringify(bound)))).toEqual(bound)
  })

  test('prompt/provider records reuse the core data shape and reject invalid attempts', () => {
    expect(assertPromptSnapshot(prompt())).toEqual(prompt())
    expect(assertProviderRequest(request())).toEqual(request())
    expect(() => assertPromptSnapshot({ ...prompt(), contractVersion: 99 })).toThrow('contractVersion')
    expect(() => assertProviderRequest({ ...request(), transportAttempt: 0 })).toThrow('transportAttempt')
    const input = { runId: 'run-a', binding: bindingInput(), sourceRevision: 8, modelTransport: { kind: 'direct', provider: 'openai', model: 'local-model' } }
    expect(() => createBoundRunSnapshot({ ...input, version: 2 })).toThrow('Unsupported workspace contract version')
    expect(() => createBoundRunSnapshot({ ...input, modelTransport: { ...input.modelTransport, endpoint: 'https://user:secret@model.example/v1' } })).toThrow('credential-free')
    expect(() => createBoundRunSnapshot({ ...input, modelTransport: { ...input.modelTransport, endpoint: 'https://model.example/v1?token=secret' } })).toThrow('credential-free')
  })
})
