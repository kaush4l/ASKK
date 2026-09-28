import { snapshot } from '../core/prompt.js'

/** Version of these workspace records, independent of the engine response contract. */
export const WORKSPACE_CONTRACT_VERSION = 1

/**
 * @typedef {Object} WorkspaceBinding
 * @property {1} version
 * @property {string} workspaceId Logical project identity, not a host path.
 * @property {'browser'|'local'} target Where files and commands execute.
 * @property {string} runtimeId Boot/session identity supplied by the executor.
 * @property {string} root Absolute POSIX execution root.
 * @property {{kind:string, version?:string|null, packageManager?:string}} toolchain
 *
 * @typedef {Object} WorkspacePort
 * @property {function(string=):Promise<Array>} list Metadata includes path, revision/rev, size, and optional editable.
 * @property {function(string):Promise<Object|null>} read Missing files return null.
 * @property {function(Object):Promise<Object>} write Receives path, content/base64 and expectedRevision; conflicts cannot silently overwrite.
 * @property {function(Object):Promise<Object>} rename Receives path, destination and expectedRevision.
 * @property {function(Object):Promise<Object>} remove Receives path and expectedRevision.
 * @property {function(string=):Promise<Object>} snapshot Produces a detached source/resource snapshot.
 * @property {function():Object} [describeCapabilities] Explicit fs/files authority; methods alone grant nothing.
 *
 * @typedef {Object} ExecutionPort
 * @property {function(Object=):Promise<Object>} prepare Resolves only when usable; rejects failed boot/pairing.
 * @property {function():Object} describeCapabilities Current runtimeId, root, toolchain and explicit capabilities.
 * Browser Linux also publishes independent lifecycle `state`, responsiveness
 * `health`, and sanitized `unresolvedRequests`; `ready` is false while receipts
 * are delayed. Existing receipts still validate against their original binding.
 * A response deadline does not authorize replay, restart, or an invented exit.
 * @property {function(Object):Promise<Object>} startJob Receives id, program, args, cwd, signal, onOutput; resolves an exit receipt.
 * @property {function(string):Promise<*>} cancelJob
 * @property {function():Promise<*>|void} dispose
 * @property {function(Object):Promise<{id:string}>} [openTerminal]
 * @property {function(string,string):*} [terminalInput]
 * @property {function(string,number,number):*} [resizeTerminal]
 * @property {function(string):Promise<*>} [closeTerminal]
 * @property {function(string,function):function} [subscribeTerminal]
 *
 * @typedef {Object} PromptSnapshot Engine record from core/engine.js, frozen by core/prompt.js snapshot().
 * @property {string} attemptId
 * @property {number} step
 * @property {number} attempt
 * @property {1|2} contractVersion
 * @property {string} model
 * @property {Array<{role:string,content:string|Array}>} messages
 * @property {Object} budget
 *
 * @typedef {Object} ProviderRequest Redacted attempt emitted by core/inference.js; not a prompt or execution grant.
 * @property {string} provider
 * @property {number} transportAttempt
 * @property {Object} body
 * @property {string} [url]
 * @property {string} [method]
 * @property {Object<string,string>} [headers]
 *
 * @typedef {Object} ArtifactRecord Immutable build manifest; interaction verification is a separate receipt.
 * @property {1} version
 * @property {string} id
 * @property {number|string} sourceRevision
 * @property {WorkspaceBinding} runtime
 * @property {{id:string,exitCode:0}} build
 * @property {Array<{path:string,size?:number,mime?:string,sha256?:string}>} resources
 * @property {string} [sourceFingerprint]
 */

const fail = (code, message) => { throw Object.assign(new TypeError(message), { code }) }
const record = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_CONTRACT', `${label} must be an object`)
  return value
}
const string = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) fail('INVALID_CONTRACT', `${label} must be a nonempty string without NUL`)
  return value
}
const version = value => { if (value !== undefined && value !== WORKSPACE_CONTRACT_VERSION) fail('UNSUPPORTED_CONTRACT_VERSION', `Unsupported workspace contract version: ${String(value)}`) }
const integer = (value, label, minimum = 0) => { if (!Number.isSafeInteger(value) || value < minimum) fail('INVALID_CONTRACT', `${label} must be an integer >= ${minimum}`); return value }
const revision = (value, label = 'sourceRevision') => typeof value === 'number' ? integer(value, label) : string(value, label)

// Reject data that JSON would silently coerce/drop before using the core snapshot
// implementation. Record constructors must not preserve live objects or callbacks.
function jsonData(value, label = 'record', parents = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object') fail('INVALID_CONTRACT', `${label} must contain only JSON data`)
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) fail('INVALID_CONTRACT', `${label} must contain plain JSON objects`)
  if (parents.has(value)) fail('INVALID_CONTRACT', `${label} must not contain cycles`)
  parents.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !property.enumerable || !('value' in property)) fail('INVALID_CONTRACT', `${label} must not contain symbols, accessors, or hidden properties`)
    jsonData(property.value, `${label}.${key}`, parents)
  }
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index)))) fail('INVALID_CONTRACT', `${label} must be a dense JSON array`)
  parents.delete(value)
}
const immutable = value => { jsonData(value); return snapshot(value) }
const stable = value => JSON.stringify(value, (_, part) => part && typeof part === 'object' && !Array.isArray(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part)
const changed = (field, actual, expected) => { if (stable(actual) !== stable(expected)) fail('WORKSPACE_IDENTITY_CHANGED', `Workspace binding ${field} changed; bind a new run explicitly`) }

/** Copy a complete identity. No inference/model/relay settings are execution authority. */
export function createWorkspaceBinding(input) {
  record(input, 'workspace binding'); jsonData(input); version(input.version)
  const { workspaceId, target, runtimeId, root, toolchain } = input
  string(workspaceId, 'workspaceId'); string(runtimeId, 'runtimeId'); string(root, 'root')
  if (!['browser', 'local'].includes(target)) fail('INVALID_CONTRACT', 'target must be browser or local')
  if (!root.startsWith('/') || root.includes('\\') || root !== '/' && root.split('/').slice(1).some(part => !part || part === '.' || part === '..')) fail('INVALID_CONTRACT', 'root must be a canonical absolute POSIX path')
  record(toolchain, 'toolchain'); string(toolchain.kind, 'toolchain.kind')
  if (toolchain.version !== undefined && toolchain.version !== null) string(toolchain.version, 'toolchain.version')
  if (toolchain.packageManager !== undefined) string(toolchain.packageManager, 'toolchain.packageManager')
  return immutable({ version: WORKSPACE_CONTRACT_VERSION, workspaceId, target, runtimeId, root, toolchain })
}

/** Check again at asynchronous handoffs; a restart, root or toolchain change is stale identity. */
export function assertWorkspaceBinding(actual, expected) {
  const current = createWorkspaceBinding(actual)
  const pinned = createWorkspaceBinding(expected)
  for (const field of ['workspaceId', 'target', 'runtimeId', 'root', 'toolchain']) changed(field, current[field], pinned[field])
  return current
}

const capabilityNames = Object.freeze({ files: ['files', 'fs'], shell: ['shell', 'exec'], pty: ['pty', 'terminal'] })
function capabilities(descriptor, required) {
  record(descriptor, 'capability descriptor')
  version(descriptor.version)
  if (!Array.isArray(descriptor.capabilities) || descriptor.capabilities.some(value => typeof value !== 'string' || !value)) fail('INVALID_CONTRACT', 'capabilities must be an explicit string array')
  for (const capability of required) if (!(capabilityNames[capability] ?? [capability]).some(name => descriptor.capabilities.includes(name))) fail('MISSING_CAPABILITY', `The port does not grant ${capability} capability`)
}
function methods(port, names, label) {
  record(port, label)
  for (const name of names) if (typeof port[name] !== 'function') fail('MISSING_PORT_METHOD', `${label} requires ${name}()`)
}
function descriptorFor(port, provided, binding) {
  const descriptor = provided ?? (typeof port.describeCapabilities === 'function' ? port.describeCapabilities() : port)
  record(descriptor, 'capability descriptor')
  if (binding) {
    const pinned = createWorkspaceBinding(binding)
    // Project and target belong to the owner; root/runtime/toolchain belong to the executor.
    assertWorkspaceBinding({ ...pinned, runtimeId: descriptor.runtimeId, root: descriptor.root, toolchain: descriptor.toolchain }, pinned)
  }
  return descriptor
}

/** Validate the mounted filesystem backend, not ProjectFiles' editor convenience API. Returns the original port. */
export function assertWorkspacePort(port, { descriptor, binding } = {}) {
  methods(port, ['list', 'read', 'write', 'rename', 'remove', 'snapshot'], 'WorkspacePort')
  capabilities(descriptorFor(port, descriptor, binding), ['files'])
  return port
}

/** Presence of a model relay or network relay never satisfies shell/terminal authority. */
export function assertExecutionPort(port, { descriptor, binding, requireTerminal = false } = {}) {
  methods(port, ['prepare', 'describeCapabilities', 'startJob', 'cancelJob', 'dispose'], 'ExecutionPort')
  const advertised = descriptorFor(port, descriptor, binding)
  capabilities(advertised, ['shell', ...(requireTerminal ? ['pty'] : [])])
  if (requireTerminal) methods(port, ['openTerminal', 'terminalInput', 'resizeTerminal', 'closeTerminal', 'subscribeTerminal'], 'Terminal port')
  return port
}

function resource(value) {
  const input = typeof value === 'string' ? { path: value } : record(value, 'artifact resource')
  const path = string(input.path, 'resource.path')
  if (path.startsWith('/') || path.includes('\\') || path.includes('?') || path.includes('#') || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..')) fail('INVALID_CONTRACT', 'resource.path must be a local relative artifact path')
  if (input.size !== undefined) integer(input.size, 'resource.size')
  if (input.mime !== undefined) string(input.mime, 'resource.mime')
  if (input.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(input.sha256)) fail('INVALID_CONTRACT', 'resource.sha256 must be a hex SHA-256 digest')
  return input
}

/** Build provenance only. A successful build is not an interaction-verification receipt. */
export function createArtifactManifest(input) {
  record(input, 'artifact manifest'); jsonData(input); version(input.version)
  const { id, sourceRevision, build, resources, sourceFingerprint } = input
  string(id, 'artifact.id'); revision(sourceRevision)
  const runtime = createWorkspaceBinding(input.runtime)
  record(build, 'artifact.build'); string(build.id, 'build.id')
  if (build.exitCode !== 0) fail('BUILD_NOT_SUCCESSFUL', 'An artifact requires an explicit successful build exitCode of 0')
  if (build.runtimeId !== undefined) changed('runtimeId', build.runtimeId, runtime.runtimeId)
  if (build.sourceRevision !== undefined && build.sourceRevision !== sourceRevision) fail('STALE_ARTIFACT_SOURCE', 'Build receipt and artifact sourceRevision differ')
  if (!Array.isArray(resources)) fail('INVALID_CONTRACT', 'artifact.resources must be an array')
  const records = resources.map(resource)
  if (new Set(records.map(row => row.path)).size !== records.length) fail('INVALID_CONTRACT', 'Artifact resource paths must be unique')
  if (sourceFingerprint !== undefined) string(sourceFingerprint, 'sourceFingerprint')
  return immutable({ version: WORKSPACE_CONTRACT_VERSION, id, sourceRevision, runtime, build, resources: records, ...(sourceFingerprint !== undefined ? { sourceFingerprint } : {}) })
}

export function assertArtifactManifest(input, { binding, sourceRevision, sourceFingerprint } = {}) {
  const manifest = createArtifactManifest(input)
  if (binding) assertWorkspaceBinding(manifest.runtime, binding)
  if (sourceRevision !== undefined && manifest.sourceRevision !== sourceRevision) fail('STALE_ARTIFACT_SOURCE', 'Artifact sourceRevision is stale')
  if (sourceFingerprint !== undefined && manifest.sourceFingerprint !== sourceFingerprint) fail('STALE_ARTIFACT_SOURCE', 'Artifact source fingerprint is stale')
  return manifest
}

/** Validate the engine's existing snapshot shape without introducing a second prompt renderer. */
export function assertPromptSnapshot(input) {
  record(input, 'PromptSnapshot'); jsonData(input); string(input.attemptId, 'prompt.attemptId'); string(input.model, 'prompt.model')
  integer(input.step, 'prompt.step'); integer(input.attempt, 'prompt.attempt', 1)
  if (![1, 2].includes(input.contractVersion)) fail('UNSUPPORTED_CONTRACT_VERSION', 'Unsupported prompt response contractVersion')
  if (!Array.isArray(input.messages) || !input.messages.length) fail('INVALID_CONTRACT', 'prompt.messages must be a nonempty array')
  for (const message of input.messages) {
    record(message, 'prompt message')
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string' && !Array.isArray(message.content)) fail('INVALID_CONTRACT', 'Prompt messages require a supported role and content')
  }
  record(input.budget, 'prompt.budget')
  return immutable(input)
}

/** Provider records arrive already redacted from core/inference.js; never pass live provider settings. */
export function assertProviderRequest(input) {
  record(input, 'ProviderRequest'); jsonData(input); string(input.provider, 'request.provider'); integer(input.transportAttempt, 'request.transportAttempt', 1)
  record(input.body, 'request.body')
  if (input.url !== undefined) string(input.url, 'request.url')
  if (input.method !== undefined) string(input.method, 'request.method')
  if (input.headers !== undefined) record(input.headers, 'request.headers')
  return immutable(input)
}

/**
 * Freeze a run handoff using core snapshot semantics. A model transport describes inference
 * only; this record never manufactures an ExecutionPort or grants native execution.
 */
export function createBoundRunSnapshot(input) {
  record(input, 'bound run'); jsonData(input); version(input.version)
  const { runId, sourceRevision, sourceFingerprint, modelTransport, promptSnapshot, providerRequests = [] } = input
  string(runId, 'runId'); revision(sourceRevision)
  const binding = createWorkspaceBinding(input.binding)
  record(modelTransport, 'modelTransport')
  if (!['direct', 'bridge', 'cli'].includes(modelTransport.kind)) fail('INVALID_CONTRACT', 'modelTransport.kind must be direct, bridge, or cli')
  string(modelTransport.provider, 'modelTransport.provider'); string(modelTransport.model, 'modelTransport.model')
  // Deliberately select public identity fields. No tokens, headers, or connection objects.
  const transport = { kind: modelTransport.kind, provider: modelTransport.provider, model: modelTransport.model }
  if (modelTransport.endpoint !== undefined) {
    const url = new URL(string(modelTransport.endpoint, 'modelTransport.endpoint'))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('INVALID_CONTRACT', 'modelTransport.endpoint must be a credential-free HTTP(S) base URL without query or fragment')
    transport.endpoint = url.href
  }
  if (sourceFingerprint !== undefined) string(sourceFingerprint, 'sourceFingerprint')
  if (!Array.isArray(providerRequests)) fail('INVALID_CONTRACT', 'providerRequests must be an array')
  return immutable({ version: WORKSPACE_CONTRACT_VERSION, runId, binding, sourceRevision, ...(sourceFingerprint !== undefined ? { sourceFingerprint } : {}), modelTransport: transport,
    ...(promptSnapshot !== undefined ? { promptSnapshot: assertPromptSnapshot(promptSnapshot) } : {}), providerRequests: providerRequests.map(assertProviderRequest) })
}
