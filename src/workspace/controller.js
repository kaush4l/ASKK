import { selectRequiredCommands, requiredCommandReason } from '../core/command-checks.js'
import { resolveCommandReference } from '../core/command-reference.js'
import { loopBudgetValue } from '../core/loop-budget.js'
import { normalizeToolActivity } from '../core/tool-activity.js'
import { ProjectFiles } from './files.js'
import { LocalExecution } from '../execution/local.js'
import { prepareIsolation } from './isolation.js'
import { normalizeToolPolicy } from '../runtime/tool-policy.js'
import { DEFAULT_PROMPT, snapshot } from '../core/prompt.js'
import { boundModelAvailable, resolve as resolveModel } from '../core/models.js'
import { openaiBase, anthropicBase } from '../core/inference.js'
import { hasModelRelay } from '../core/model-relay.js'
import { normalizeCompletion, LEGACY_ARTIFACT_COMPLETION } from '../core/completion.js'
import { projectCompletionEvidence } from '../core/completion-evidence.js'
import { renderPackageTemplate } from '../core/package-template.js'
import { copyAgentSource } from '../runtime/package-source.js'
import { createWorkspaceBinding, assertWorkspaceBinding, assertWorkspacePort, assertExecutionPort, createArtifactManifest, assertArtifactManifest, createBoundRunSnapshot } from './contracts.js'

const active = status => ['thinking', 'calling', 'waiting', 'compacting', 'running', 'starting', 'cancelling', 'verifying'].includes(status)
const id = prefix => `${prefix}-${crypto.randomUUID()}`
const readSaved = key => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null } }
const DEFAULT_TOOL_POLICY = normalizeToolPolicy({ disabledTools: [], approvalRisks: [], allowDelegation: true })
const canRelayModels = value => hasModelRelay(value?.health ?? value)
const companionIdentity = value => JSON.stringify([value?.status, value?.url, value?.runtimeId, value?.generation, value?.root, [...(value?.capabilities ?? [])].sort(), value?.modelRelay, value?.capabilityManifest])
// Provider bodies are recorded inputs, including user-authored schemas/code.
// Only transport metadata is scrubbed; legitimate body keys remain byte-faithful.
const requestEvidence = value => {
  if (Array.isArray(value)) return value.map(requestEvidence)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, key === 'body' ? part : /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|cookie|^token$/i.test(key) ? '[redacted]' : requestEvidence(part)]))
}
const installedWorkflow = item => Object.freeze({
  id: `package-${item.id}`, label: item.label, description: item.error || item.description || `Installed from ${item.packageId}`,
  agent: item.agentPath, workspace: item.leadRequireVerification === true, disabled: item.status === 'disabled', unavailableReason: item.error || '',
  ...(item.leadRequireVerification ? { execution: { workspace: 'required' }, completion: LEGACY_ARTIFACT_COMPLETION } : {}),
  leadModel: item.leadModel || '', modelBindings: Object.freeze({ ...item.modelBindings }),
  package: Object.freeze({ namespace: 'installed', installationId: item.id, packageId: item.packageId, revisionDigest: item.revisionDigest, agentId: item.leadAgentId }),
})
const packageWorkflow = (workflow, id, leadModel = '') => Object.freeze({ ...workflow, id, leadModel, workspace: workflow.execution.workspace === 'required', completion: normalizeCompletion(workflow.completion) })
function workflowsFrom(configuration) {
  if (!Array.isArray(configuration.workflows) || configuration.workflows.length > 32) throw new Error('workbench.json must declare its workflows; no agent is selected implicitly')
  const seen = new Set()
  return configuration.workflows.map(row => {
    if (row?.package !== undefined || row?.workflow !== undefined) {
      if (Object.keys(row).some(key => !['id', 'package', 'workflow'].includes(key)) || !/^[a-z][a-z0-9-]{0,63}$/.test(row.id ?? '') || seen.has(row.id) || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(row.package ?? '') || !/^[a-z][a-z0-9_-]{0,63}$/.test(row.workflow ?? '')) throw new Error('Invalid package workflow reference')
      seen.add(row.id); return Object.freeze({ id: row.id, packageRef: row.package, workflowRef: row.workflow })
    }
    if (!row || typeof row.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(row.id) || seen.has(row.id) || typeof row.label !== 'string' || !row.label.trim() || typeof row.description !== 'string' || typeof row.agent !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(row.agent) || typeof row.workspace !== 'boolean') throw new Error('Invalid workbench workflow')
    if (row.strategy !== undefined && (typeof row.strategy !== 'string' || !/^strategies\/[A-Za-z0-9_/-]+\.json$/.test(row.strategy))) throw new Error('Invalid workflow strategy reference')
    seen.add(row.id); return Object.freeze({ ...(row.strategy ? { strategyRef: row.strategy } : {}), id: row.id, label: row.label, description: row.description, agent: row.agent, workspace: row.workspace })
  })
}
const saveSetting = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }

/** One owner bridges the framework-free runtime and the subscribed workbench. */
export function createWorkbenchController({ onChange, basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '', workspace: workspaceOverride, createExecution: executionFactory, createCompanion = options => new LocalExecution(options), createHub: hubFactory, inspectArtifact: inspectOverride } = {}) {
  const listeners = new Set(onChange ? [onChange] : []); const running = new Map(); const terminalListeners = new Map(); const terminals = new Set()
  const base = `${basePath.replace(/\/$/, '')}/`
  let state = { ready: false, configurationReady: false, error: '', project: { name: 'Untitled workspace', id: 'default' }, goal: '', goalRevision: 0, files: [], messages: [], run: null, task: null, sessionBoundary: null, runtime: { target: 'browser', status: 'idle', phase: 'Not started', capabilities: [] }, companion: { status: 'disconnected', url: 'https://127.0.0.1:7717' }, model: { status: 'unconfigured', id: '', baseUrl: '' }, commands: [], artifacts: [], agents: [], agentDefinitions: [], agentPackages: [], packageInstalling: false, workflows: [], selectedWorkflowId: '', toolPolicy: DEFAULT_TOOL_POLICY, plans: [], approvals: [], activity: [] }
  let hub; let local; let executor; let browser; let started; let disposed = false; let activeRun; let projectRevision = 0; let taskStartRevision = 0; let currentArtifact; let unsubscribe; let runtimeBoot; let taskArtifactId; let watcher; let watched = ''; let acceptance = { requireArtifact: true, requireInteraction: true }
  let uiLoaded = false; let persistTimer; let savingUI = Promise.resolve()
  let binding; let workspaceLocation = null; let locationLoaded = false; let legacyNative = false; let modelProfiles = []; let modelEpoch = 0; let modelCheck; let launchEpoch = 0; const runBindings = new Map()
  let configuredWorkflows = []; let packageInstalling = false; let packageInstallEpoch = 0
  const cachedSummaryMap = new Map()
  const executionEpochs = { browser: 0, local: 0 }; const executionErrors = {}
  const executionHealth = { browser: 'responsive', local: 'responsive' }; const healthVersions = { browser: 0, local: 0 }; const healthWaiters = new Set()
  let runtimeEstablished = false; let recovering; let watching = false
  const delayedMessage = 'The environment is taking longer to respond. Outstanding operations may still complete; their outcomes are unknown. Existing processes and terminals are preserved. New work is paused and no requests will be replayed.'
  const unresponsive = () => Object.assign(new Error(delayedMessage), { code: 'RUNTIME_UNRESPONSIVE' })
  const requirePageActive = () => { if (disposed || state.pageLifecycle) throw new Error('This page has stopped. Save or copy your work and reload before starting new work.') }
  const requireResponsive = () => { if (state.runtime.status === 'unresponsive' || executor?.describeCapabilities().health === 'unresponsive') throw unresponsive() }
  const assertExecutionAlive = (target, epoch) => { if (executionEpochs[target] !== epoch) throw new Error(executionErrors[target] || 'The execution environment stopped during setup.'); if (executionHealth[target] === 'unresponsive') throw unresponsive() }
  const persistUI = ({ strict = false } = {}) => {
    clearTimeout(persistTimer)
    if (!uiLoaded || !files.store?.durable) return Promise.resolve()
    const value = { projectRevision, messages: state.messages.slice(-500), run: state.run, task: state.task, plans: state.plans, target: state.runtime.target, commands: state.commands.slice(-100), artifacts: state.artifacts.slice(-3).map(({ url, ...record }) => record), activeArtifactId: state.activeArtifactId, selectedWorkflowId: state.selectedWorkflowId, toolPolicy: state.toolPolicy }
    savingUI = savingUI.catch(() => {}).then(() => files.store.put('settings', { key: 'workbench-state', value })).catch(error => { notify({ error: `Workspace history could not be saved: ${error.message}` }); if (strict) throw error })
    return savingUI
  }
  const notify = patch => { if (disposed) return; state = { ...state, ...patch }; for (const listener of listeners) listener(); if (uiLoaded && ['messages', 'run', 'task', 'plans', 'commands', 'artifacts', 'selectedWorkflowId', 'toolPolicy'].some(key => key in patch)) { clearTimeout(persistTimer); persistTimer = setTimeout(persistUI, 200) } }
  const report = error => { notify({ error: error?.message ?? String(error) }); return error }
  const invalidateModelCheck = (reason = 'The model connection changed during this check. Test the current connection again.') => {
    modelEpoch++
    modelCheck?.abort.abort(Object.assign(new Error(reason), { code: 'MODEL_CONNECTION_CHANGED' }))
    modelCheck = null
  }
  const checkModel = async kind => {
    requirePageActive()
    if (packageInstalling) throw new Error('Wait for agent installation to finish before testing its model')
    if (active(state.run?.status)) throw new Error('Finish or stop active work before testing its model')
    if (connecting) throw new Error('Wait for the companion connection change to finish')
    if (modelCheck) throw new Error('Cancel or finish the current model check first')
    const check = { kind, epoch: ++modelEpoch, abort: new AbortController(), startedAt: Date.now() }
    modelCheck = check
    notify({ model: { ...state.model, status: 'checking', error: '', errorCode: null, checkedAt: null, probe: null, ...(kind === 'listing' ? { discovery: null } : {}), check: { kind, startedAt: check.startedAt, status: 'checking' } } })
    try {
      const result = await hub.models[kind === 'reply' ? 'probe' : 'refresh']('workbench', { signal: check.abort.signal })
      if (check.epoch !== modelEpoch) throw check.abort.signal.reason ?? new Error('The model connection changed during this check. Test the current connection again.')
      if (result.error) throw Object.assign(new Error(result.error), { code: result.errorCode })
      if (kind === 'listing') {
        if (!Array.isArray(result.ids)) throw Object.assign(new Error('The server returned an invalid model list.'), { code: 'MODEL_INVALID_LIST' })
        const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
        const ids = []; const seen = new Set(); let truncated = false; let selectedListed = false
        for (const value of result.ids) {
          if (!validId(value)) continue
          if (value === state.model.id) selectedListed = true
          if (seen.has(value)) continue
          if (ids.length === 100) { truncated = true; continue }
          seen.add(value); ids.push(value)
        }
        notify({ model: { ...state.model, discovery: { ids, truncated, at: result.at, baseUrl: state.model.baseUrl, via: state.model.via } } })
        if (!selectedListed) throw Object.assign(new Error(`The server answered, but did not list model ${state.model.id}. Choose an available model below or check its ID.`), { code: 'MODEL_NOT_LISTED' })
      }
      if (kind === 'reply' && (typeof result.text !== 'string' || !result.text.trim() || result.receipt?.status !== 'completed' || result.receipt.errorCode)) throw Object.assign(new Error('The model check returned no completed reply receipt.'), { code: 'MODEL_INCOMPLETE_REPLY' })
      notify({ model: { ...state.model, status: kind === 'reply' ? 'verified' : 'listed', error: '', errorCode: null, checkedAt: result.at, probe: kind === 'reply' ? snapshot(result) : null, check: { kind, startedAt: check.startedAt, status: 'done' } } })
      return result
    } catch (error) {
      if (check.epoch === modelEpoch) notify({ model: { ...state.model, status: 'failed', error: error.message, errorCode: error.code ?? 'MODEL_CHECK_FAILED', checkedAt: null, probe: null, check: { kind, startedAt: check.startedAt, status: 'failed' } } })
      throw check.abort.signal.aborted ? check.abort.signal.reason : error
    } finally { if (modelCheck === check) modelCheck = null }
  }
  const requestCancellation = key => { try { Promise.resolve(executor?.cancelJob?.(key)).catch(report) } catch (error) { report(error) } }
  const activity = event => notify({ activity: [...state.activity.slice(-199), { id: id('event'), at: Date.now(), ...event }] })
  const refreshFiles = async () => notify({ files: await files.list() })
  const invalidate = () => { projectRevision++; if (currentArtifact) { currentArtifact = { ...currentArtifact, stale: true, verified: false }; notify({ artifacts: state.artifacts.map(row => row.id === currentArtifact.id ? currentArtifact : row) }) } }
  const committed = event => { invalidate(); activity(event); refreshFiles().catch(report) }
  const files = workspaceOverride ?? new ProjectFiles({ onCommit: committed })
  if (workspaceOverride) files.onCommit = committed
  const commandUpdate = (key, patch) => notify({ commands: state.commands.map(command => command.id === key ? { ...command, ...patch } : command) })
  let fileMutations = 0; let openingTerminals = 0
  const requireIdle = () => { requirePageActive(); if (packageInstalling) throw new Error('Wait for agent installation to finish'); if (active(state.run?.status) || running.size || fileMutations || openingTerminals || runtimeBoot) throw new Error('Finish or stop active work before changing its execution environment') }
  let transferring = false; let connecting = false; let connectingEndpoint = null
  const requireWritable = ({ allowReconciledSetup = false } = {}) => { requirePageActive(); if (!allowReconciledSetup) requireResponsive(); if (transferring) throw new Error('Wait for the workspace snapshot transfer to finish'); if (connecting) throw new Error('Wait for the companion connection change to finish') }
  const mutateFiles = async callback => { requireWritable(); fileMutations++; try { return await callback() } finally { fileMutations-- } }
  const fingerprint = async () => {
    const manifest = JSON.stringify((await files.list()).map(row => ({ path: row.path, revision: row.rev ?? row.revision, size: row.size })).sort((a, b) => a.path.localeCompare(b.path)))
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifest))
    return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`
  }
  const bindExecutor = (port, target) => {
    assertWorkspacePort(port); assertExecutionPort(port)
    const descriptor = port.describeCapabilities()
    return createWorkspaceBinding({ workspaceId: state.project.id, target, runtimeId: descriptor.runtimeId, root: descriptor.root, toolchain: descriptor.toolchain })
  }
  const assertBound = (expected = binding) => assertWorkspaceBinding(bindExecutor(executor, state.runtime.target), expected)
  const endpointOf = port => {
    const value = port?.url ?? local?.url ?? state.companion.url
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Companion endpoints must be HTTP(S) URLs without credentials, query, or fragment')
    return url.href.replace(/\/$/, '')
  }
  const locationOf = (value, port) => ({ version: 1, binding: value, endpoint: value.target === 'local' ? endpointOf(port) : null })
  const sameLocation = (left, right) => left && right && left.binding.workspaceId === right.binding.workspaceId && left.binding.target === right.binding.target && left.binding.root === right.binding.root && left.endpoint === right.endpoint
  const loadLocation = async () => {
    if (locationLoaded) return
    const saved = (await files.store.get('settings', `workspace-location:${state.project.id}`))?.value
    if (saved) {
      if (saved.version !== 1) throw new Error('The saved workspace location has an unsupported version; it was preserved.')
      const restored = createWorkspaceBinding(saved.binding)
      if (restored.workspaceId !== state.project.id) throw new Error('The saved workspace location belongs to a different project')
      workspaceLocation = locationOf(restored, { url: saved.endpoint })
      notify({ runtime: { ...state.runtime, target: restored.target, savedBinding: workspaceLocation } })
    } else legacyNative = state.runtime.target === 'local'
    locationLoaded = true
  }
  const rememberLocation = async (value, port, validate = () => {}) => {
    const next = locationOf(value, port)
    if (!files.store.durable) throw new Error('Workspace location could not be saved durably. The execution binding was not acknowledged.')
    const key = `workspace-location:${state.project.id}`; const previous = workspaceLocation
    validate()
    await files.store.put('settings', { key, value: next })
    try { validate() } catch (error) {
      // A stopped guest cannot commit a transfer while the durable write yields.
      try { if (previous) await files.store.put('settings', { key, value: previous }); else await files.store.delete('settings', key) }
      catch (rollback) { throw new Error(`${error.message} The previous workspace location could not be restored: ${rollback.message}`) }
      throw error
    }
    workspaceLocation = next; legacyNative = false
    return next
  }
  const locationReview = (kind, proposed, message) => {
    const code = kind === 'legacy' ? 'WORKSPACE_LEGACY_REBIND' : 'WORKSPACE_TRANSFER_REQUIRED'
    const review = { kind, code, previous: workspaceLocation, proposed, message }
    notify({ runtime: { ...state.runtime, bindingReview: review } })
    return Object.assign(new Error(message), { code, review })
  }
  const checkLocation = proposed => {
    if (proposed.binding.target !== 'local') return
    if (legacyNative) throw locationReview('legacy', proposed, 'This saved native workspace has no recorded root identity. Review the companion endpoint and root, then explicitly adopt it before mounting saved files.')
    if (workspaceLocation?.binding.target === 'local' && !sameLocation(workspaceLocation, proposed)) throw locationReview('transfer', proposed, 'A different native workspace root or companion endpoint requires an explicit snapshot transfer. Reconnect the original workspace before transferring it.')
  }
  const forRun = handler => (args, run) => { requireResponsive(); if (!run?.context?.binding) throw new Error('This task has no pinned workspace. Start a new task from the current workspace before using its files or execution tools.'); assertBound(run.context.binding); return handler(args, run) }
  const settleHealthWaiters = error => { for (const waiter of healthWaiters) { if (error) waiter.reject(error); else waiter.resolve() } healthWaiters.clear() }
  const awaitReceiptHealth = async expected => {
    while (!disposed && executor?.describeCapabilities().health === 'unresponsive') await new Promise((resolve, reject) => healthWaiters.add({ resolve, reject }))
    if (disposed) throw new Error('The workspace was closed before the operation could be reconciled')
    assertBound(expected)
  }
  async function reconcileRuntime(target) {
    if (recovering) return recovering
    if (!runtimeEstablished || runtimeBoot || transferring || connecting || target !== state.runtime.target || state.runtime.status !== 'unresponsive' || executionHealth[target] !== 'responsive') return
    const port = executor; const expected = binding; const epoch = executionEpochs[target]; const version = healthVersions[target]
    recovering = (async () => {
      assertBound(expected)
      const rows = await files.list()
      if (disposed || executor !== port || state.runtime.target !== target || healthVersions[target] !== version) return
      assertExecutionAlive(target, epoch); assertBound(expected)
      if (port.describeCapabilities().health === 'unresponsive') return
      watched = JSON.stringify(rows)
      notify({ files: rows, runtime: { ...state.runtime, status: 'ready', health: 'responsive', phase: 'Ready', progress: null, detail: '', outstanding: [] } })
    })().catch(error => {
      if (!disposed && executor === port && state.runtime.target === target && state.runtime.status === 'unresponsive') notify({ runtime: { ...state.runtime, detail: `${delayedMessage} Workspace reconciliation: ${error.message}` } })
    }).finally(() => {
      recovering = null
      // A newer health cycle may have reconciled while this read was pending.
      // Follow that event once; a read failure in the same cycle is not retried.
      if (!disposed && executor === port && healthVersions[target] !== version && executionHealth[target] === 'responsive') reconcileRuntime(target)
    })
    return recovering
  }
  function runtimeEvent(target, event) {
    activity({ ...event, target })
    if (event.type === 'runtime.health') {
      executionHealth[target] = event.health
      if (event.health === 'unresponsive') healthVersions[target]++
      if (state.runtime.target !== target) return
      if (event.health === 'unresponsive') {
        if (state.runtime.status === 'failed') return
        if (state.runtime.status !== 'unresponsive') invalidate()
        notify({ runtime: { ...state.runtime, status: 'unresponsive', health: 'unresponsive', phase: 'Response delayed', detail: delayedMessage, progress: null, outstanding: event.unresolvedRequests ?? event.outstanding ?? event.requests ?? [] } })
      } else if (event.health === 'responsive') {
        settleHealthWaiters()
        reconcileRuntime(target)
      }
      return
    }
    if (event.type === 'runtime.reconciled') return // The following health event admits the same-binding refresh.
    const failed = event.type === 'runtime.error' || event.type === 'runtime.state' && event.state === 'failed'
    if (failed) { executionEpochs[target]++; executionErrors[target] = event.error || 'The execution environment stopped.'; executionHealth[target] = 'responsive'; healthVersions[target]++ }
    if (state.runtime.target !== target) return
    if (failed) {
      runtimeEstablished = false; settleHealthWaiters(new Error(event.error || 'The execution environment stopped.'))
      if (state.runtime.status === 'ready') invalidate()
      if (target === 'browser') terminals.clear() // The failed frame's PTYs no longer exist.
      notify({ runtime: { ...state.runtime, status: 'failed', phase: 'Environment unavailable', progress: null, detail: event.error || 'The execution environment stopped.' } })
    } else if (!['failed', 'unresponsive'].includes(state.runtime.status) && (event.phase || event.stage)) notify({ runtime: { ...state.runtime, phase: event.phase ?? event.stage, progress: event.progress, detail: event.message } })
    if (event.type === 'output' && event.terminalId) for (const listener of terminalListeners.get(event.terminalId) ?? []) listener(event)
  }
  async function prepareExecutor(target) {
    if (!['browser', 'local'].includes(target)) throw new Error('Unknown execution environment')
    if (executionFactory) return executionFactory(target, { onEvent: event => runtimeEvent(target, event) })
    if (target === 'local') { if (!local) throw new Error('Connect the local companion first'); const health = await local.prepare(); if (!['fs', 'exec'].every(capability => health.capabilities.includes(capability))) throw new Error('This companion does not grant host files and native commands. Model relay pairing alone cannot enable Local Bun execution.'); return local }
    const { BrowserLinuxExecution } = await import('../execution/browser-linux.js')
    browser ??= new BrowserLinuxExecution({ projectId: state.project.id, assetsURL: new URL(`${base}browser-linux/`, location.origin).href, onEvent: event => runtimeEvent('browser', event) })
    if (state.runtime.networkRelay && !local) throw new Error('Reconnect the selected guest network relay')
    await browser.setNetworkRelay(state.runtime.networkRelay ? { url: local.url, token: local.token } : null)
    await browser.prepare({}); return browser
  }

  async function transferWorkspace(target, { transfer = false, supplied = null } = {}) {
    const previous = state.runtime; const originalBackend = files.backend; const originalExecutor = executor; const originalBinding = binding
    const sourceEpoch = executionEpochs[previous.target]; const destinationEpoch = executionEpochs[target]
    const validateSource = () => { assertExecutionAlive(previous.target, sourceEpoch); if (originalExecutor && originalBinding) assertWorkspaceBinding(bindExecutor(originalExecutor, previous.target), originalBinding) }
    transferring = true
    try {
      if (workspaceLocation?.binding.target === 'local' && !files.backend) throw new Error('Reconnect and mount the original native workspace before transferring it. The offline editor cache is not a complete workspace snapshot.')
      const rows = await files.list()
      if (rows.length && !transfer) throw new Error('Changing execution requires an explicit workspace snapshot transfer')
      const before = await fingerprint(); const source = await files.snapshot()
      if (await fingerprint() !== before) throw new Error('The source changed while capturing the snapshot. Retry after edits finish.')
      notify({ runtime: { ...previous, status: 'transferring', phase: 'Transferring snapshot' } })
      const destination = supplied ?? await prepareExecutor(target)
      const destinationBinding = bindExecutor(destination, target)
      const validate = () => { validateSource(); assertExecutionAlive(target, destinationEpoch); assertWorkspaceBinding(bindExecutor(destination, target), destinationBinding) }
      if ((await destination.list('')).length) throw new Error('Transfer requires an empty destination workspace. The original workspace and destination files were preserved.')
      for (const file of source) {
        const result = await destination.write({ path: file.path, base64: file.base64, expectedRevision: 0 })
        if (result.conflict) throw new Error(`Destination changed while transferring ${file.path}; the original workspace is preserved`)
      }
      if (await fingerprint() !== before) throw new Error('The source changed during transfer. The source remains active; review the copied destination before retrying.')
      const copied = (await destination.snapshot('')).files
      const contentFingerprint = entries => JSON.stringify(entries.map(({ path, base64 }) => ({ path, base64 })).sort((a, b) => a.path.localeCompare(b.path)))
      if (contentFingerprint(copied) !== contentFingerprint(source)) throw new Error('Destination content changed during transfer. The original workspace remains active.')
      assertWorkspaceBinding(bindExecutor(destination, target), destinationBinding)
      files.backend = destination; executor = destination; binding = destinationBinding; await files.checkpoint(); await refreshFiles()
      assertWorkspaceBinding(bindExecutor(destination, target), destinationBinding)
      await rememberLocation(destinationBinding, destination, validate)
      invalidate()
      const descriptor = destination.describeCapabilities()
      assertExecutionAlive(target, destinationEpoch)
      runtimeEstablished = true
      notify({ runtime: { target, status: 'ready', phase: 'Ready', capabilities: descriptor.capabilities ?? [], binding, savedBinding: workspaceLocation, bindingReview: null } })
      activity({ type: 'workspace.transferred', from: previous.target, to: target, files: source.length, sourceFingerprint: before, binding })
    } catch (error) {
      files.backend = originalBackend; executor = originalExecutor; binding = originalBinding
      await files.checkpoint().catch(() => {}); await refreshFiles().catch(() => {})
      let restored = previous
      try { validateSource() } catch (failure) { if (state.runtime.status !== 'failed') invalidate(); restored = { ...previous, status: 'failed', phase: 'Environment unavailable', progress: null, detail: failure.message } }
      if (state.runtime.status === 'unresponsive' && previous.target === state.runtime.target) restored = { ...restored, status: 'unresponsive', health: 'unresponsive', phase: 'Response delayed', detail: delayedMessage, outstanding: state.runtime.outstanding }
      notify({ runtime: restored }); throw report(error)
    }
    finally { transferring = false; reconcileRuntime(state.runtime.target) }
  }

  const refreshDefinitions = () => notify({ agentDefinitions: hub?.manifest({ toolPolicy: state.toolPolicy }) ?? [] })
  const refreshAgents = () => {
    const instances = new Map(cachedSummaryMap)
    for (const run of hub?.runs.values() ?? []) instances.set(run.id, run)
    notify({ agents: [...instances.values()].map(run => ({ id: run.id, trace: run.trace ?? run.id, kind: run.kind, taskId: run.taskId, stageId: run.stageId, result: run.result, error: run.slot?.error, terminationReason: run.slot?.terminationReason, completionEvidence: projectCompletionEvidence(run), path: run.agent, agent: run.agent, name: state.agentDefinitions.find(row => row.path === run.agent)?.name ?? run.agent, current: run.slot?.current ?? '', maxSteps: run.slot?.maxSteps, steps: run.slot?.steps ?? 0, parent: run.parent ?? null, status: hub?.runs.get(run.id)?.ended === false && run.slot?.status === 'idle' ? 'queued' : run.slot?.status ?? 'starting', description: run.query, at: run.at })) })
  }
  const sessionBoundaryFor = (workflows = state.workflows, selectedId = state.selectedWorkflowId) => {
    const selected = workflows.find(row => row.id === selectedId)
    const previousAgent = state.run?.agent
    return previousAgent && selected && previousAgent !== selected.agent
      ? snapshot({ previousAgent, agent: selected.agent, label: selected.label }) : null
  }
  const refreshPackages = preferred => {
    const agentPackages = hub?.packages?.list() ?? []
    const workflows = Object.freeze([...configuredWorkflows, ...agentPackages.flatMap(item => [installedWorkflow(item), ...(item.status === 'ready' ? item.workflows ?? [] : []).map(workflow => packageWorkflow(workflow, `package-${item.id}:workflow:${workflow.id}`, hub.specs?.get(workflow.agent)?.inference.model))])])
    const selectedWorkflowId = preferred && workflows.some(item => item.id === preferred) ? preferred : state.selectedWorkflowId
    notify({ agentPackages, workflows, selectedWorkflowId, sessionBoundary: sessionBoundaryFor(workflows, selectedWorkflowId) })
  }
  const selectedModelTransport = workflow => {
    const catalogue = hub.catalogue?.() ?? hub.settings.get().catalogue
    const spec = hub.specs?.get(workflow.agent)
    if (hub.specs && !spec) throw new Error('The selected agent definition is unavailable. Select a current workflow before starting a task.')
    // The real Hub always supplies compiled specs. A manifest-only integration
    // can supply its alias; the workbench alias is the legacy fixture boundary.
    const alias = spec?.inference?.model ?? workflow.leadModel ?? hub.manifest?.().find(row => row.path === workflow.agent)?.alias ?? 'workbench'
    if (spec?.package && !boundModelAvailable(catalogue, alias)) throw new Error(`The selected agent's bound model profile is no longer configured: ${alias}`)
    const settings = resolveModel(spec?.inference ?? { model: alias }, catalogue)
    const provider = settings.provider ?? 'openai'
    const model = provider === 'cli' || provider === 'scripted' ? settings.model || settings.alias || 'default' : settings.model
    if (typeof model !== 'string' || !model.trim()) throw new Error('The selected agent model requires a model name')
    if (provider === 'cli') return { kind: 'cli', provider, model }
    const value = provider === 'openai' ? openaiBase(settings) : provider === 'anthropic' ? anthropicBase(settings) : settings.baseUrl
    if (provider === 'scripted' && !value) return { kind: 'direct', provider, model }
    const endpoint = new URL(value)
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('The model requires a credential-free HTTP(S) endpoint without query or fragment')
    return { kind: settings.via === 'bridge' ? 'bridge' : 'direct', provider, model, endpoint: endpoint.href }
  }

  function onHub(message) {
    if (message.type === 'stopped' && message.why === 'the tab closed') {
      launchEpoch++; packageInstallEpoch++; invalidateModelCheck(); clearInterval(watcher)
      for (const target of ['browser', 'local']) { executionEpochs[target]++; executionErrors[target] = 'The page stopped during execution setup.' }
      for (const [key, abort] of running) { abort.abort(); requestCancellation(key) }
      notify({ ready: false, pageLifecycle: 'stopped', error: 'This page left the active tab. Its agent runtime stopped; no task will restart automatically.' })
      persistUI({ strict: true }).catch(report)
    }
    if (message.type === 'page-lifecycle') notify({ ready: false, pageLifecycle: message.status, error: message.status === 'restoring' ? 'Restoring this page with a fresh agent runtime. Confirming saved drafts and history before reloading; no task will restart automatically.' : message.error })
    if (message.type === 'packages') { refreshPackages(); refreshDefinitions() }
    if (message.type === 'settings') { refreshPackages(); refreshDefinitions() }
    if (message.type === 'run' && !message.run.parent && !activeRun && state.run?.status === 'starting') activeRun = message.run.id
    if (message.type === 'run' || message.type === 'verification') refreshAgents()
    if (message.type === 'strategy' && message.run === activeRun) notify({ task: message.task })
    if (message.type === 'persistence-error') notify({ error: message.error })
    if (message.type === 'bridge') {
      refreshDefinitions()
      const connected = message.state.status === 'answering'
      const nextCompanion = { status: connected ? 'connected' : message.state.status, url: message.state.url, runtimeId: message.state.runtimeId, generation: message.state.generation, capabilities: message.state.capabilities ?? [], modelRelay: message.state.modelRelay, capabilityManifest: message.state.capabilityManifest, root: message.state.root, error: message.state.error }
      const changed = companionIdentity(state.companion) !== companionIdentity(nextCompanion)
      const nativeEndpoints = [binding?.target === 'local' ? executor?.url : null, local?.url, connectingEndpoint].filter(Boolean).map(url => url.replace(/\/$/, ''))
      const lostNative = changed && ['down', 'unpaired'].includes(message.state.status) && nativeEndpoints.length > 0 &&
        (!message.state.url || nativeEndpoints.includes(message.state.url.replace(/\/$/, '')))
      notify({ companion: nextCompanion })
      if (lostNative) runtimeEvent('local', { type: 'runtime.error', error: message.state.error || 'The native companion connection is unavailable.' })
      if (changed && state.model.via === 'bridge') {
        invalidateModelCheck()
        const available = connected && canRelayModels(nextCompanion)
        notify({ model: { ...state.model, status: available ? 'configured' : 'failed', checkedAt: null, check: null, probe: null, discovery: null, errorCode: available ? null : connected ? 'MODEL_RELAY_DENIED' : 'MODEL_RELAY_UNAVAILABLE', error: available ? '' : connected ? 'The companion does not grant model relay access.' : message.state.error || 'The model relay is unavailable.' } })
      }
    }
    if (message.type === 'boot' && message.stage === 'ready' && !state.pageLifecycle) { refreshPackages(); refreshDefinitions() }
    if (message.type === 'ready' || message.type === 'agents') { refreshPackages(); refreshDefinitions() }
    if (message.type === 'lock' && message.state === 'follower') notify({ error: 'Another tab owns the agent runtime. Close it to work here.' })
    if (message.type === 'todo') notify({ plans: [...state.plans.filter(plan => plan.runId !== message.run), { runId: message.run, agent: hub.runs.get(message.run)?.agent ?? 'Agent', items: message.items }] })
    if (message.type === 'status') {
      const run = hub.runs.get(message.run)
      if (!run?.parent && message.run === activeRun) notify({ run: { ...message.slot, status: message.slot.status, step: message.slot.steps, agent: run?.agent ?? state.run?.agent ?? '' } })
      refreshAgents()
    }
    if (message.type === 'answer' && message.run === activeRun && !hub.runs.get(message.run)?.parent) {
      notify({ messages: [...state.messages, { id: id('message'), role: 'assistant', content: message.text, at: Date.now(), runId: message.run }], run: { ...(state.run ?? {}), status: message.ok ? (hub.runs.get(message.run)?.context?.workflow?.workspace !== false && currentArtifact?.verified && !currentArtifact.stale ? 'verified' : 'done') : (hub.runs.get(message.run)?.slot.status ?? 'failed') } })
    }
    if (message.type === 'approval' || message.type === 'approved') notify({ approvals: [...hub.approvals.values()].map(({ settle, ...approval }) => approval) })
    if (message.type === 'event') {
      if (message.kind === 'call') {
        const card = { id: message.callId ?? id('tool'), ...(typeof message.providerCallId === 'string' && message.providerCallId ? { providerCallId: message.providerCallId } : {}), name: message.name, args: message.args, path: message.args?.path, command: message.args?.command, status: 'running', summary: message.value, runId: message.run, agent: message.agent ?? hub.runs.get(message.run)?.agent }
        notify({ messages: [...state.messages, { id: card.id, role: 'assistant', content: '', at: Date.now(), tools: [card] }] })
      } else if (message.kind === 'observation') {
        // A receipt belongs to one exact run/call pair. Legacy missing IDs are
        // accepted only when that run has one unambiguous outstanding call.
        const candidates = state.messages.flatMap(row => (row.tools ?? []).filter(tool =>
          tool.runId === message.run && (message.callId ? tool.id === message.callId : tool.status === 'running')))
        if (candidates.length === 1) {
          const matched = candidates[0]
          const activity = normalizeToolActivity(message.activity, { ok: message.ok })
          const resolvedArgs = message.resolvedArgs && typeof message.resolvedArgs === 'object' && !Array.isArray(message.resolvedArgs) ? snapshot(message.resolvedArgs) : null
          const messages = state.messages.map(row => !row.tools?.includes(matched) ? row : { ...row, tools: row.tools.map(tool => tool !== matched ? tool : {
            ...tool, ...activity, status: message.ok === true ? 'done' : message.ok === false ? message.failureKind === 'invalid_input' ? 'rejected' : 'failed' : 'unresolved',
            ...(resolvedArgs ? { resolvedArgs, ...(typeof resolvedArgs.command === 'string' ? { command: resolvedArgs.command } : {}), ...(typeof resolvedArgs.path === 'string' ? { path: resolvedArgs.path } : {}) } : {}),
            summary: message.value, hasResult: Object.hasOwn(message, 'value'),
          }) })
          notify({ messages })
        }
      } else if (['error', 'repair', 'retry', 'incomplete'].includes(message.kind)) activity({ type: message.kind, text: message.value, runId: message.run })
    }
  }

  async function activatePackage(activate) {
      await controller.start(); requireIdle()
      if (disposed) throw new Error('The agent desk was closed')
      if (modelCheck || connecting || transferring) throw new Error('Finish the connection check or workspace transfer before installing an agent')
      if (!hub.packages) throw new Error('This runtime does not support agent folder installation')
      const epoch = ++packageInstallEpoch
      packageInstalling = true; notify({ packageInstalling: true })
      try {
        const admissionGuard = () => !disposed && epoch === packageInstallEpoch && !active(state.run?.status) && !connecting && !transferring && !modelCheck
        const result = await activate(admissionGuard)
        if (!admissionGuard()) throw new Error('The agent desk stopped while installation was finishing. Reopen it to inspect saved installations.')
        refreshPackages(`package-${result.id}`); refreshDefinitions(); refreshAgents()
        await persistUI({ strict: true })
        if (result.status === 'disabled') throw new Error(`Agent folder saved, but unavailable: ${result.error || 'check its model and tool bindings'}`)
        return result
      } finally { packageInstalling = false; notify({ packageInstalling: false }) }
  }
  const controller = {
    get hub() { return hub },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot() { return state },
    start() {
      if (started) return started
      started = (async () => {
        await files.start(); await refreshFiles()
        notify({ storageDurable: files.store.durable })
        const savedUI = (await files.store.get('settings', 'workbench-state'))?.value
        if (savedUI) {
          projectRevision = (savedUI.projectRevision ?? 0) + 1
          if (savedUI.task) notify({ task: { ...savedUI.task, ...(active(savedUI.task.status) || savedUI.task.status === 'queued' ? { status: 'interrupted', reason: 'The page stopped; no role was restarted.', nodes: savedUI.task.nodes.map(node => ['queued', 'running', 'cancelling'].includes(node.status) ? { ...node, status: 'interrupted', waiting: null } : node) } : {}) } })
          const artifacts = (savedUI.artifacts ?? []).map(artifact => ({ ...artifact, stale: true, verified: false, url: URL.createObjectURL(new Blob([artifact.html], { type: 'text/html' })) }))
          currentArtifact = artifacts.at(-1)
          notify({ messages: (savedUI.messages ?? []).map(row => ({ ...row, tools: row.tools?.map(tool => ({ ...tool, status: tool.status === 'running' ? 'interrupted' : tool.status })) })), run: savedUI.run ? { ...savedUI.run, status: active(savedUI.run.status) ? 'interrupted' : savedUI.run.status } : null, plans: savedUI.plans ?? [], commands: (savedUI.commands ?? []).map(command => ({ ...command, status: command.status === 'running' ? 'interrupted' : command.status })), artifacts, activeArtifactId: savedUI.activeArtifactId, runtime: { ...state.runtime, target: savedUI.target ?? 'browser' } })
        }
        await loadLocation()
        const savedGoal = (await files.store.get('settings', `conversation-goal:${state.project.id}`))?.value
        if (savedGoal && typeof savedGoal.text === 'string' && Number.isSafeInteger(savedGoal.revision)) notify({ goal: savedGoal.text, goalRevision: savedGoal.revision })
        uiLoaded = true
        if (!files.store.durable) notify({ error: `Browser storage is unavailable: ${files.store.why}. File drafts cannot be acknowledged as durable saves.` })
        const isolation = await prepareIsolation({ base, beforeReload: async () => { await files.checkpoint(); await persistUI({ strict: true }) } }).catch(error => ({ ready: false, reason: error.message }))
        if (isolation.reloading) return
        if (!isolation.ready) notify({ runtime: { ...state.runtime, isolation: false, detail: isolation.reason } })
        const configuration = await fetch(`${base}workbench.json`).then(response => response.ok ? response.json() : {}).catch(() => ({})); acceptance = configuration.acceptance ?? acceptance
        const workflows = workflowsFrom(configuration)
        configuredWorkflows = workflows.filter(row => !row.packageRef)
        // Installed workflows are restored by the Hub below. Do not replace their
        // saved selection with a bundled agent while that restoration is pending.
        const selectedWorkflowId = typeof savedUI?.selectedWorkflowId === 'string' ? savedUI.selectedWorkflowId : workflows.find(row => row.id === configuration.defaultWorkflow)?.id ?? workflows[0]?.id ?? ''
        const toolPolicy = normalizeToolPolicy(savedUI && Object.hasOwn(savedUI, 'toolPolicy') ? savedUI.toolPolicy : Object.hasOwn(configuration, 'toolPolicy') ? configuration.toolPolicy : DEFAULT_TOOL_POLICY)
        notify({ workflows: Object.freeze(configuredWorkflows), selectedWorkflowId, toolPolicy, sessionBoundary: sessionBoundaryFor(configuredWorkflows, selectedWorkflowId) })
        const executionNotices = Object.fromEntries(['browser', 'local'].flatMap(target => {
          const notice = configuration.executionNotices?.[target]
          return typeof notice?.title === 'string' && notice.title.trim() && typeof notice?.body === 'string' && notice.body.trim()
            ? [[target, { title: notice.title.trim(), body: notice.body.trim() }]] : []
        }))
        notify({ executionNotices })
        const catalogue = await fetch(`${base}models.json`).then(response => response.json())
        const profile = catalogue.models[catalogue.default] ?? {}
        modelProfiles = Object.values(catalogue.models)
        notify({ template: configuration.template, model: { status: 'configured', id: profile.model ?? '', baseUrl: profile.base_url ?? '' } })
        const settings = readSaved('askk:workbench-settings')
        if (settings?.model) notify({ model: { ...state.model, ...settings.model } })
        const nativeUrl = new URL(`${base}runtime/modules/runtime/hub.js`, location.origin).href
        const { Hub } = hubFactory ? {} : await import(/* webpackIgnore: true */ nativeUrl)
        if (disposed) return
        const hubOptions = { base: new URL(base, location.origin).href, storeName: 'askk-agents-v2', beforePageReload: async () => {
          if (disposed) throw new Error('The workspace was closed during page restoration.')
          if (!files.store?.durable) throw new Error('Workspace history is not stored durably.')
          await files.checkpoint()
          await persistUI({ strict: true })
        } }
        hub = hubFactory ? await hubFactory(hubOptions) : new Hub(hubOptions)
        hub.externalOps = {
          'workspace.goal': (args, run) => run?.context?.workflow?.workspace === false ? { text: state.goal, revision: state.goalRevision } : forRun(() => ({ text: state.goal, revision: state.goalRevision }))(args, run),
          'workspace.list': forRun(() => files.list()),
          'workspace.read': forRun(({ path }) => files.read(path)),
          'workspace.write': forRun(args => {
            const supplied = ['expect', 'expectedRevision'].filter(key => Object.hasOwn(args, key))
            const valid = value => typeof value === 'string' ? Boolean(value.trim()) : Number.isSafeInteger(value) && value >= 0
            if (!supplied.length || supplied.some(key => !valid(args[key]))) throw new Error('workspace.write requires an explicit non-empty revision string or nonnegative integer in expect (or expectedRevision); read the file first, or use 0 to create it.')
            if (supplied.length === 2 && String(args.expect) !== String(args.expectedRevision)) throw new Error('workspace.write received conflicting expect and expectedRevision values')
            return controller.saveFile({ ...args, expect: args[supplied[0]] })
          }),
          'workspace.run': forRun((args, run) => controller.runCommand(resolveCommandReference(args, run?.completion, { resolved: true }).command, { actor: run?.agent, runId: run?.id })),
          'workspace.build': forRun((_, run) => controller.buildPreview({ actor: run?.agent, runId: run?.id })),
          'workspace.check': forRun((args, run) => controller.checkArtifact(args, { requireInteraction: run.context?.workflow?.completion?.checks.find(check => check.capability === 'workspace.artifact')?.options.requireInteraction ?? acceptance.requireInteraction })),
          'workspace.acceptance': forRun(async () => {
            const sourceFingerprint = await fingerprint()
            const receipt = currentArtifact?.checks
            return { ok: !running.size && (acceptance.requireArtifact === false && projectRevision === taskStartRevision || Boolean(currentArtifact?.verified && !currentArtifact.stale && currentArtifact.id !== taskArtifactId && currentArtifact.revision === projectRevision && currentArtifact.sourceFingerprint === sourceFingerprint && receipt?.artifactId === currentArtifact.id && receipt?.revision === currentArtifact.revision && receipt?.buildId === currentArtifact.buildId)), reason: 'This application task needs a new build and passing interaction assertions against its unchanged source files.' }
          }),
          'workspace.environment': forRun(() => ({ target: state.runtime.target, status: state.runtime.status, binding, capabilities: state.runtime.capabilities, toolchain: executor?.describeCapabilities().toolchain, template: state.template, files: state.files.map(row => row.path), revision: projectRevision, artifact: currentArtifact ? { id: currentArtifact.id, revision: currentArtifact.revision, verified: currentArtifact.verified } : null })),
        }
        hub.completionAdapters = {
          'workspace.command': forRun(async (options, run) => {
            const reject = reason => ({ ok: false, reason })
            if (running.size || fileMutations) return reject('Wait for commands to finish before completing.')
            const latestCommand = () => state.commands.findLast(row => {
              const producer = hub.runs.get(row.runId)
              return producer && producer.trace === run.trace
            })
            const command = latestCommand()
            if (!command || command.status !== 'done' || command.exitCode !== 0 || command.cancelled || command.timedOut || command.stage !== 'complete') return reject('This task needs a completed command with a recorded zero exit code.')
            if (options.requireFresh && (command.sourceUnchanged !== true || !command.completedFingerprint || command.completedRevision !== projectRevision)) return reject('Run the checks again against the current saved files.')
            assertBound(run.context.binding); assertBound(command.binding)
            const currentFingerprint = await fingerprint()
            assertBound(command.binding)
            if (running.size || fileMutations || latestCommand()?.id !== command.id || options.requireFresh && (command.completedRevision !== projectRevision || command.completedFingerprint !== currentFingerprint)) return reject('Source files or command evidence changed during completion; rerun the checks.')
            return { ok: true, reason: 'A task-owned command exited successfully against the recorded workspace. This receipt alone does not prove functional correctness.', evidence: { commandId: command.id, command: command.command, exitCode: command.exitCode, revision: command.completedRevision, sourceFingerprint: command.completedFingerprint, runtime: command.binding } }
          }),
          'workspace.commands': forRun(async (options, run) => {
            const required = normalizeCompletion({ checks: [{ capability: 'workspace.commands', options }] }).checks[0].options.commands
            const reject = reason => ({ ok: false, reason })
            if (running.size || fileMutations) return reject('Wait for commands to finish before checking the required commands.')
            assertBound(run.context.binding)
            const owns = row => Boolean(row.runId && hub.runs.get(row.runId)?.trace === run.trace)
            const selected = selectRequiredCommands(state.commands, required, owns)
            for (const [index, command] of selected.entries()) {
              if (!command || command.status !== 'done' || command.exitCode !== 0 || command.cancelled || command.timedOut || command.stage !== 'complete') return reject(requiredCommandReason(required[index], command))
              assertBound(command.binding)
              if (command.sourceUnchanged !== true || !command.completedFingerprint) return reject(`Required command must be rerun against the current saved source: ${required[index]}`)
            }
            const checkedRevision = projectRevision
            const currentFingerprint = await fingerprint()
            assertBound(run.context.binding)
            const latest = selectRequiredCommands(state.commands, required, owns)
            if (running.size || fileMutations || checkedRevision !== projectRevision || selected.some((command, index) => latest[index]?.id !== command.id || command.completedFingerprint !== currentFingerprint)) return reject('Source files or required command evidence changed during completion; rerun the required commands.')
            return { ok: true, reason: 'Every configured command passed against the current saved source. This proves only the assertions those commands actually check.', evidence: { checkedRevision, sourceFingerprint: currentFingerprint, commands: selected.map(command => ({ commandId: command.id, command: command.command, exitCode: command.exitCode, revision: command.completedRevision, sourceFingerprint: command.completedFingerprint, runtime: command.binding })) } }
          }),
          'workspace.artifact': forRun(async (options, run) => {
            const artifact = currentArtifact
            const receipt = artifact?.checks
            const rejected = reason => ({ ok: false, reason })
            if (running.size || !artifact?.verified || artifact.stale || artifact.revision !== projectRevision || !receipt?.ok) return rejected('Build the current saved source and run passing artifact assertions before completing.')
            assertArtifactManifest(artifact.manifest, { binding: run.context.binding, sourceRevision: projectRevision, sourceFingerprint: artifact.sourceFingerprint })
            if (receipt.artifactId !== artifact.id || receipt.revision !== artifact.revision || receipt.buildId !== artifact.buildId) return rejected('Artifact assertions belong to a different build or source revision.')
            if (options.requireFresh) {
              const command = state.commands.find(row => row.id === artifact.manifest.build.commandId)
              const producer = hub.runs.get(command?.runId)
              if (!run.context.completionBaseline || artifact.id === run.context.completionBaseline.artifactId || !producer || producer.trace !== run.trace) return rejected('This task needs its own new build; an earlier or unrelated task’s artifact is not completion evidence.')
            }
            const { validateAssertions } = await import('./artifacts.js')
            validateAssertions(receipt.assertions, { requireInteraction: options.requireInteraction })
            const sourceFingerprint = await fingerprint()
            assertBound(run.context.binding)
            if (running.size || currentArtifact !== artifact || artifact.revision !== projectRevision || sourceFingerprint !== artifact.sourceFingerprint) return rejected('Source files or the artifact changed during completion checks.')
            return { ok: true, reason: 'The pinned artifact checks passed.', evidence: { artifactId: artifact.id, buildId: artifact.buildId, revision: artifact.revision, sourceFingerprint, runtime: run.context.binding, checks: receipt } }
          }),
        }
        unsubscribe = hub.subscribe(onHub); await hub.start()
        if (disposed) { hub.stop(); return }
        requirePageActive()
        const summaries = await hub.runsApi?.summaries?.() ?? []
        if (disposed) { hub.stop(); return }
        requirePageActive()
        for (const summary of summaries) cachedSummaryMap.set(summary.id, summary)
        const resolvedWorkflows = await Promise.all(workflows.map(async row => {
          if (row.packageRef) {
            const matches = (hub.packageWorkflows ?? []).filter(workflow => workflow.package?.namespace === 'bundled' && workflow.package.installationId === row.packageRef && workflow.id === row.workflowRef)
            if (matches.length !== 1) throw new Error(`Workflow ${row.id} requires one available package workflow ${row.packageRef}/${row.workflowRef}`)
            return packageWorkflow(matches[0], row.id, hub.specs?.get(matches[0].agent)?.inference.model)
          }
          if (!row.strategyRef) return row
          const loaded = await hub.loadStrategy(row.strategyRef)
          const outputAgent = loaded.definition.kind === 'agent' ? loaded.definition.agent : loaded.definition.nodes.find(node => node.id === loaded.definition.output)?.agent
          if (outputAgent !== row.agent) throw new Error(`Workflow ${row.id} must name its strategy output agent`)
          return Object.freeze({ ...row, strategy: loaded.definition, strategyHash: loaded.definitionHash, strategyFiles: loaded.files })
        }))
        configuredWorkflows = resolvedWorkflows
        requirePageActive()
        refreshPackages(savedUI?.selectedWorkflowId)
        if (hub.bridgeState.status === 'answering') local = new LocalExecution({ url: hub.bridgeState.url, token: hub.bridgeState.token })
        await controller.setModel({ baseUrl: state.model.baseUrl, model: state.model.id, apiKey: hub.settings.get().catalogue.models?.workbench?.api_key ?? '' })
        requirePageActive()
        refreshDefinitions(); refreshAgents(); notify({ ready: true, configurationReady: true })
        watcher = setInterval(async () => {
          if (disposed || watching || !files.backend || running.size || state.runtime.status !== 'ready') return
          watching = true
          const port = executor; const target = state.runtime.target; const version = healthVersions[target]
          try {
            const rows = await files.list()
            if (disposed || executor !== port || state.runtime.target !== target || state.runtime.status !== 'ready' || healthVersions[target] !== version) return
            const fingerprint = JSON.stringify(rows)
            if (watched && fingerprint !== watched) { invalidate(); notify({ files: rows }) }
            watched = fingerprint
          } catch (error) { if (state.runtime.status === 'ready') report(error) }
          finally { watching = false }
        }, 2500)
      })().catch(error => { report(error); throw error })
      return started
    },
    stop() { invalidateModelCheck(); packageInstallEpoch++; persistUI(); disposed = true; clearInterval(watcher); clearTimeout(persistTimer); unsubscribe?.(); hub?.stop(); settleHealthWaiters(new Error('The workspace was closed before the operation could be reconciled')); for (const abort of running.values()) abort.abort(); for (const port of new Set([browser, local, executor].filter(Boolean))) { try { Promise.resolve(port.dispose()).catch(error => { state = { ...state, error: `Environment shutdown could not be confirmed: ${error.message}` } }) } catch (error) { state = { ...state, error: `Environment shutdown could not be confirmed: ${error.message}` } } } for (const artifact of state.artifacts) URL.revokeObjectURL(artifact.url); listeners.clear() },
    readFile: path => { requireResponsive(); return files.read(path) },
    saveFile: args => mutateFiles(() => files.save(args)),
    createFile: (path, content = '') => mutateFiles(() => files.save({ path, content, expect: 0 })),
    renameFile: (from, to, expect) => mutateFiles(() => files.rename(from, to, expect)),
    deleteFile: (path, expect) => mutateFiles(() => files.remove(path, expect)),
    async setConversationGoal(text, expectedRevision = state.goalRevision) {
      requirePageActive()
      if (typeof text !== 'string' || text.length > 12000) throw new Error('The conversation goal must be text of at most 12,000 characters')
      if (!files.store?.durable) throw new Error('Browser storage is unavailable. The conversation goal was not saved.')
      const key = `conversation-goal:${state.project.id}`
      const result = await files.store.update('settings', key, row => {
        const current = row?.value ?? { text: '', revision: 0 }
        if (current.revision !== expectedRevision) throw new Error('The conversation goal changed. Reopen it before saving.')
        return { value: { key, value: { text: text.trim(), revision: current.revision + 1 } }, revision: current.revision + 1 }
      })
      notify({ goal: text.trim(), goalRevision: result.revision })
      if (activeRun && active(state.run?.status) && hub.runs.get(activeRun)?.kind !== 'strategy') hub.send(activeRun, { type: 'nudge', text: text.trim() ? 'The owner updated the saved conversation goal. Read its current context before the next action.' : 'The owner cleared the saved conversation goal. Continue with the current task and steering.' })
      return { ok: true, revision: result.revision }
    },
    async reviewOfflineConflict(path) {
      requireWritable(); requireIdle(); assertBound()
      if (!state.runtime.conflicts?.some(row => row.path === path)) throw new Error('Refresh the runtime conflict list before reviewing this file')
      return files.reviewConflict(executor, path)
    },
    async resolveOfflineConflict(resolution) {
      requireWritable(); requireIdle(); assertBound()
      const result = await mutateFiles(() => files.resolveConflict(executor, resolution))
      notify({ runtime: { ...state.runtime, conflicts: state.runtime.conflicts.filter(row => row.path !== resolution.path) } })
      await refreshFiles(); return result
    },
    async setWorkflow(workflowId) {
      await controller.start(); requireIdle()
      if (connecting || transferring) throw new Error('Wait for the environment connection change to finish')
      if (!state.workflows.some(row => row.id === workflowId)) throw new Error('Unknown workflow')
      notify({ selectedWorkflowId: workflowId, sessionBoundary: sessionBoundaryFor(state.workflows, workflowId) }); await persistUI({ strict: true })
    },
    async setToolPolicy(patch) {
      await controller.start(); requireIdle()
      if (connecting || transferring) throw new Error('Wait for the environment connection change to finish')
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Invalid run tool policy')
      const toolPolicy = normalizeToolPolicy({ ...state.toolPolicy, ...patch })
      notify({ toolPolicy }); refreshDefinitions(); await persistUI({ strict: true }); return toolPolicy
    },
    async previewAgentPackage(records) {
      await controller.start(); requireIdle()
      if (disposed) throw new Error('The agent desk was closed')
      if (modelCheck || connecting || transferring) throw new Error('Finish the connection check or workspace transfer before importing an agent')
      if (!hub.packages) throw new Error('This runtime does not support agent folder installation')
      return hub.packages.preview(records)
    },
    async listAgentDrafts() {
      await controller.start(); requirePageActive()
      return hub.packageDrafts.list()
    },
    async customizeAgentPackage(path) {
      await controller.start(); requirePageActive()
      const source = await copyAgentSource(hub, path)
      requirePageActive()
      return hub.packageDrafts.create(source)
    },
    async exportAgentDraft(draftId, options) {
      await controller.start(); requirePageActive()
      return hub.packageDrafts.exportBackup(draftId, options)
    },
    async restoreAgentDraft(text) {
      await controller.start(); requirePageActive()
      return hub.packageDrafts.importBackup(text)
    },
    async readAgentDraft(draftId) {
      await controller.start(); requirePageActive()
      return hub.packageDrafts.read(draftId)
    },
    async createAgentDraft(options = {}) {
      await controller.start(); requirePageActive()
      let records = options.files
      if (records === undefined) {
        const response = await fetch(`${base}package-templates/basic.json`)
        if (!response.ok) throw new Error('The agent starter template could not be loaded.')
        const text = await response.text()
        if (text.length > 1048576) throw new Error('The agent starter template is too large.')
        records = renderPackageTemplate(JSON.parse(text), options)
      }
      requirePageActive()
      return hub.packageDrafts.create({ label: options.label ?? 'My agent', files: records })
    },
    async saveAgentDraft(draftId, changes) {
      await controller.start(); requirePageActive()
      return hub.packageDrafts.save(draftId, changes)
    },
    async previewAgentDraft(draftId) {
      await controller.start(); requireIdle()
      if (modelCheck || connecting || transferring) throw new Error('Finish the connection check or workspace transfer before reviewing an agent')
      return hub.packageDrafts.preview(draftId)
    },
    async installAgentDraft(draftId, { expectedVersion, stageId, bindings }) {
      return activatePackage(admissionGuard => hub.packageDrafts.install(draftId, { ...bindings, expectedVersion, stageId, admissionGuard }))
    },
    async installAgentPackage(stageId, bindings) {
      return activatePackage(admissionGuard => hub.packages.install(stageId, { ...bindings, admissionGuard }))
    },
    async getAgentDetails(path) {
      await controller.start()
      const definition = hub.manifest({ toolPolicy: state.toolPolicy }).find(row => row.path === path)
      if (!definition) throw new Error('Unknown agent definition')
      const spec = hub.specs?.get(path)
      const composition = definition.composition ?? {}
      const candidates = [...hub.runs.values()].filter(run => run.agent === path)
      const stored = hub.store ? await hub.store.all('runs') : []
      const records = [...stored.filter(run => run.agent === path), ...candidates].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      let latestPrompt = null
      for (const row of records) {
        const record = await hub.runsApi?.get(row.id)
        const prompt = record?.prompts?.at(-1)
        if (!prompt?.snapshot?.messages) continue
        latestPrompt = { messages: prompt.snapshot.messages, budget: prompt.snapshot.budget, attemptId: prompt.attemptId, step: prompt.step }
        for (const field of ['nativeTools', 'toolNames', 'responseProtocol', 'responseMode', 'responseSchema', 'historyFormat', 'layers']) {
          if (prompt.snapshot[field] !== undefined) latestPrompt[field] = prompt.snapshot[field]
        }
        break
      }
      return snapshot({ path, name: definition.name, description: definition.description, package: spec?.package ?? definition.package ?? null,
        soul: spec?.soul ?? composition.soul ?? '', instructions: spec?.body ?? composition.instructions ?? '',
        promptTemplate: spec?.engine.promptTemplate ?? composition.promptTemplate ?? DEFAULT_PROMPT,
        context: spec?.context ?? definition.context ?? [], responseFormat: spec?.engine.responseFormat ?? composition.responseFormat ?? 'json',
        responseProtocol: spec?.engine.responseProtocol ?? composition.responseProtocol ?? 'envelope',
        contractVersion: spec?.engine.contractVersion ?? composition.contractVersion ?? 1,
        maxSteps: loopBudgetValue('maxSteps', spec?.engine.maxSteps ?? composition.maxSteps), tools: definition.tools ?? [], latestPrompt })
    },
    async sendGoal(text) {
      if (!text.trim()) return
      await controller.start()
      requirePageActive()
      if (modelCheck) throw new Error('Cancel or finish the current model check before starting a task')
      if (connecting) throw new Error('Wait for the companion connection change to finish')
      if (packageInstalling) throw new Error('Wait for agent installation to finish before starting a task')
      const workflow = state.workflows.find(row => row.id === state.selectedWorkflowId)
      if (!workflow) throw new Error('Select an available workflow before starting a task')
      if (workflow.disabled) throw new Error(workflow.unavailableReason || 'The selected agent folder is unavailable')
      if (workflow.package?.namespace !== 'bundled' && workflow.package && !hub.packages?.list().some(item => item.id === workflow.package.installationId && item.status === 'ready' && item.revisionDigest === workflow.package.revisionDigest && (item.agentPath === workflow.agent || item.workflows?.some(row => row.agent === workflow.agent && row.strategyHash === workflow.strategyHash)))) throw new Error('The selected agent installation changed or is unavailable. Select its current definition before running.')
      if (workflow.package && hub.specs && hub.specs.get(workflow.agent)?.package?.revisionDigest !== workflow.package.revisionDigest) throw new Error('The selected package revision changed. Reload its workflows before starting.')
      for (const check of workflow.completion?.checks ?? []) if (typeof hub.completionAdapters?.[check.capability] !== 'function') throw new Error(`Completion capability is unavailable: ${check.capability}`)
      if (workflow.workspace) requireWritable({ allowReconciledSetup: active(state.run?.status) })
      if (active(state.run?.status)) {
        if (workflow.strategy?.kind === 'graph') throw new Error('Role inputs are fixed for this run. Stop the workflow to change the goal.')
        if (!activeRun) throw new Error('The current task cannot receive steering yet')
        hub.send(activeRun, { type: 'nudge', text })
        notify({ messages: [...state.messages, { id: id('message'), role: 'user', content: text, steering: true, at: Date.now(), runId: activeRun }] })
        return activeRun
      }
      if (workflow.workspace && (connecting || transferring)) throw new Error('Wait for the environment connection change to finish')
      const policy = normalizeToolPolicy(state.toolPolicy)
      const sessionBoundary = sessionBoundaryFor()
      taskStartRevision = projectRevision; taskArtifactId = currentArtifact?.id
      const launch = ++launchEpoch; activeRun = null
      const boundaryMessages = sessionBoundary ? [{ id: id('message'), kind: 'session-boundary', role: 'system', agent: 'Desk', content: `Agent session changed to ${sessionBoundary.label}. Earlier conversation text remains saved for review and is not automatically transferred.`, at: Date.now() }] : []
      notify({ error: '', task: null, sessionBoundary: null, messages: [...state.messages, ...boundaryMessages, { id: id('message'), role: 'user', content: text, at: Date.now() }], run: { status: 'starting', agent: workflow.agent } })
      try {
        selectedModelTransport(workflow)
        const { strategy, strategyHash, strategyFiles, ...runtimeWorkflow } = workflow
        let context = snapshot({ workflow: runtimeWorkflow, completionBaseline: { artifactId: currentArtifact?.id ?? null, sourceRevision: projectRevision }, toolPolicy: policy, savedGoal: { text: state.goal, revision: state.goalRevision } })
        if (workflow.workspace) {
          await controller.startRuntime(); requireWritable(); assertBound()
          if (launch !== launchEpoch) return null
          const sourceFingerprint = await fingerprint()
          if (launch !== launchEpoch) return null
          const { runId, ...bound } = createBoundRunSnapshot({ runId: id('handoff'), binding, sourceRevision: projectRevision, sourceFingerprint, modelTransport: selectedModelTransport(workflow) })
          context = snapshot({ ...bound, ...context })
        }
        if (!strategy && !hub.startRun) throw new Error('The runtime cannot dispatch the selected agent explicitly')
        const run = strategy ? await hub.startStrategy(strategy, text, { context, definitionHash: strategyHash, admissionGuard: () => launch === launchEpoch && !disposed, ...(strategy.kind === 'graph' && !workflow.completion && workflow.workspace ? { verifyCompletion: run => hub.externalOps['workspace.acceptance']({}, run) } : {}) }) : hub.startRun(workflow.agent, text, { context })
        if (launch !== launchEpoch || disposed) { if (run && typeof run !== 'string' && !run.ended) hub.abort(run); return null }
        activeRun = typeof run === 'string' ? run : run.id
        if (workflow.workspace) runBindings.set(activeRun, createBoundRunSnapshot({ runId: activeRun, ...context }))
        refreshAgents()
        return activeRun
      } catch (error) { if (launch !== launchEpoch) return null; notify({ run: { status: 'failed', agent: workflow.agent } }); throw report(error) }
    },
    stopRun() { launchEpoch++; if (activeRun) { const run = hub.runs.get(activeRun); if (run) hub.abort(run) } else if (state.run?.status === 'starting') notify({ run: { ...state.run, status: 'cancelled' } }); for (const [key, abort] of running) { const command = state.commands.find(row => row.id === key); if (command?.runId) { abort.abort(); requestCancellation(key) } } },
    stopAgent(runId) {
      const run = hub?.runs.get(runId); if (!run || run.ended) return
      const affected = new Set()
      const collect = row => { if (!row || affected.has(row.id)) return; affected.add(row.id); for (const child of row.children) collect(hub.runs.get(child)) }
      collect(run); hub.abort(run)
      for (const [key, abort] of running) if (affected.has(state.commands.find(command => command.id === key)?.runId)) { abort.abort(); requestCancellation(key) }
    },
    approve: (approvalId, approved, always = false) => { requirePageActive(); return hub.answerApproval(approvalId, { approved, always }) },
    async setModel({ baseUrl, model, apiKey, via }) {
      requirePageActive()
      if (packageInstalling) throw new Error('Wait for agent installation to finish before changing its model binding')
      if (active(state.run?.status)) throw new Error('Finish or stop active work before changing its model')
      invalidateModelCheck()
      if (state.model.status === 'checking') notify({ model: { ...state.model, status: 'configured', check: null, checkedAt: null, probe: null } })
      const previous = hub?.settings.get().catalogue.models?.workbench ?? {}
      const configured = modelProfiles.find(profile => profile.model === model && profile.base_url === baseUrl) ?? { provider: 'openai' }
      const sameModel = previous.model === model && previous.base_url === baseUrl
      const previousKey = previous.base_url === baseUrl ? previous.api_key : ''
      const relay = hub?.bridge.state()
      const profile = { ...configured, ...(sameModel ? previous : {}), base_url: baseUrl, model, api_key: apiKey ?? previousKey ?? '', via: via ?? state.model.via ?? (relay?.status === 'answering' && canRelayModels(relay) ? 'bridge' : 'direct') }
      const savedCatalogue = hub?.settings.get().saved ?? {}
      if (hub?.store) await hub.settings.set({ catalogue: { ...savedCatalogue, default: 'workbench', models: { ...savedCatalogue.models, workbench: profile } }, dreaming: false })
      requirePageActive()
      refreshPackages(); refreshDefinitions()
      notify({ model: { status: 'configured', id: model, baseUrl, via: profile.via } }); saveSetting('askk:workbench-settings', { model: { id: model, baseUrl, via: profile.via } })
    },
    async pairModelRelay({ url, token }) {
      requireIdle()
      if (transferring) throw new Error('Wait for the workspace snapshot transfer to finish')
      if (connecting) throw new Error('Wait for the companion connection change to finish')
      if (modelCheck) throw new Error('Cancel or finish the current model check before pairing')
      if (state.runtime.target === 'local') throw new Error('Use Execution settings to change the companion while Local Bun is selected. Its workspace binding must be preserved.')
      if (state.runtime.networkRelay) throw new Error('Use Execution settings to change the companion while its guest network relay is selected.')
      connecting = true
      try {
        const paired = await hub.bridge.pair(url, token, { requireModelRelay: true, timeoutMs: 15000 })
        if (disposed) throw new Error('The desk was closed before model pairing completed.')
        if (paired?.status !== 'answering') throw Object.assign(new Error(paired?.error || 'The model relay could not be paired.'), { code: paired?.errorCode ?? 'MODEL_RELAY_UNAVAILABLE' })
        if (!canRelayModels(paired)) throw Object.assign(new Error('The companion does not grant model relay access.'), { code: 'MODEL_RELAY_DENIED' })
        onHub({ type: 'bridge', state: paired })
        local = null // Native execution requires its own explicit connection/binding.
        await controller.setModel({ model: state.model.id, baseUrl: state.model.baseUrl, via: 'bridge' })
        return { url: paired.url, capabilities: paired.capabilities, runtimeId: paired.runtimeId }
      } finally { connecting = false }
    },
    async connectCompanion({ url, token, transfer = false, rebind = false, expectedProposal = null }) {
      requireWritable(); requireIdle()
      if (modelCheck) throw new Error('Cancel or finish the current model check before pairing')
      if (terminals.size) throw new Error('Close terminal sessions before changing companion connections')
      connecting = true
      connectingEndpoint = url
      const connectionEpoch = executionEpochs.local
      try {
        await loadLocation()
        const native = state.runtime.target === 'local' ? executor : null
        const next = createCompanion({ url, token }); const health = await next.prepare()
        const proposed = state.runtime.target === 'local' ? locationOf(bindExecutor(next, 'local'), next) : null
        const moved = proposed && workspaceLocation?.binding.target === 'local' && !sameLocation(workspaceLocation, proposed)
        if (proposed && legacyNative && !rebind) throw locationReview('legacy', proposed, 'This saved native workspace has no recorded root identity. Review this endpoint and root, then explicitly adopt it before mounting saved files.')
        if (moved && !transfer) throw locationReview('transfer', proposed, 'A different native workspace root or companion endpoint requires an explicit snapshot transfer. Reconnect the original workspace before transferring it.')
        if (proposed && (legacyNative || moved)) {
          let matches = false
          try { matches = expectedProposal?.endpoint === proposed.endpoint && Boolean(assertWorkspaceBinding(proposed.binding, expectedProposal.binding)) } catch {}
          if (!matches) throw locationReview(legacyNative ? 'legacy' : 'transfer', proposed, 'The prepared companion identity does not match an explicitly reviewed proposal. Review this endpoint and root again before confirming.')
        }
        if (moved && (!native || files.backend !== native)) throw locationReview('transfer', proposed, 'Reconnect and mount the original native workspace before transferring it. The offline editor cache is not a complete workspace snapshot.')
        await hub.bridge.pair(url, token)
        if (hub.bridge.state().status !== 'answering') throw new Error(hub.bridge.state().error)
        if (state.runtime.networkRelay) await browser?.setNetworkRelay({ url: next.url, token: next.token })
        if (canRelayModels(health)) await controller.setModel({ model: state.model.id, baseUrl: state.model.baseUrl, via: 'bridge' })
        if (proposed) {
          const current = locationOf(bindExecutor(next, 'local'), next)
          try {
            assertWorkspaceBinding(current.binding, proposed.binding)
            if (current.endpoint !== proposed.endpoint) throw new Error('Companion endpoint changed')
          } catch {
            throw locationReview(legacyNative ? 'legacy' : 'transfer', current, 'The companion identity changed while connecting. Review the current endpoint and root again before confirming.')
          }
        }
        if (moved) await transferWorkspace('local', { transfer: true, supplied: next })
        else if (proposed) {
          const previousBackend = files.backend; const previousExecutor = executor; const previousBinding = binding
          const changedSession = !!binding && JSON.stringify(binding) !== JSON.stringify(proposed.binding)
          try {
            if (native) {
              if (changedSession || files.backend !== native || state.runtime.status !== 'ready') {
                invalidate()
                notify({ runtime: { ...state.runtime, status: 'starting', phase: 'Reconnecting the same workspace' } })
                await files.mount(next); await refreshFiles()
              }
              assertWorkspaceBinding(bindExecutor(next, 'local'), proposed.binding)
            }
            await rememberLocation(proposed.binding, next, () => { assertExecutionAlive('local', connectionEpoch); assertWorkspaceBinding(bindExecutor(next, 'local'), proposed.binding) })
            if (native) {
              if (files.backend === previousBackend && previousBackend) files.backend = next
              executor = next; binding = proposed.binding
            }
            if (!native) invalidate()
            if (native) runtimeEstablished = true
            notify({ runtime: { ...state.runtime, ...(native ? { status: 'ready', phase: 'Ready', binding } : {}), savedBinding: workspaceLocation, bindingReview: null } })
          } catch (error) {
            files.backend = previousBackend; executor = previousExecutor; binding = previousBinding
            if (native) notify({ runtime: { ...state.runtime, status: 'failed', phase: error.code === 'WORKSPACE_MOUNT_CONFLICT' ? 'Saved changes need review' : 'Reconnect incomplete', detail: error.message, conflicts: error.conflicts ?? state.runtime.conflicts ?? [] } })
            throw error
          }
        }
        local = next
        notify({ companion: { ...state.companion, status: 'connected', url: endpointOf(next), capabilities: health.capabilities, modelRelay: health.modelRelay, capabilityManifest: health.capabilityManifest, root: health.root, runtimeId: health.runtimeId } })
        return health
      } finally { connecting = false; connectingEndpoint = null }
    },
    testModel() { return checkModel('listing') },
    probeModel() { return checkModel('reply') },
    cancelModelCheck() {
      if (!modelCheck) return false
      const check = modelCheck
      modelEpoch++; modelCheck = null
      check.abort.abort(Object.assign(new Error('Connection check cancelled.'), { name: 'AbortError', code: 'MODEL_CHECK_CANCELLED' }))
      notify({ model: { ...state.model, status: 'configured', checkedAt: null, probe: null, error: '', errorCode: null, check: { kind: check.kind, startedAt: check.startedAt, status: 'cancelled', cancelled: true } } })
      return true
    },
    async setGuestNetworkRelay(enabled) {
      requireWritable(); requireIdle()
      if (enabled && (!local || state.companion.status !== 'connected' || !state.companion.capabilities?.includes('network-relay'))) throw new Error('Pair a companion that explicitly grants guest network relay access')
      connecting = true
      try {
        await browser?.setNetworkRelay(enabled ? { url: local.url, token: local.token } : null)
        notify({ runtime: { ...state.runtime, networkRelay: Boolean(enabled), network: enabled ? 'companion-network-relay' : 'browser-fetch-cors' } })
      } finally { connecting = false }
    },
    async getRunDetails(runId) {
      const loaded = await hub.runsApi.get(runId)
      // Loading history can yield while live work advances. Read the live run
      // and pending decisions together, then freeze them without another await.
      const live = hub.run?.(runId)
      const run = live ?? loaded
      if (!run) throw new Error('This run is no longer available')
      const approvals = live ? [...hub.approvals.values()].filter(approval => approval.run === run.id).map(({ settle, ...approval }) => approval) : []
      return snapshot({ id: run.id, capturedAt: Date.now(), approvals, trace: run.trace ?? run.id, parent: run.parent ?? null, taskId: run.taskId ?? run.id, stageId: run.stageId ?? null, package: run.package ?? null, agent: run.agent, query: run.query, slot: run.slot, result: run.result, error: run.slot?.error, completion: run.completion, completionReceipts: run.completionReceipts ?? [], prompts: run.prompts ?? [], toolEvents: run.toolEvents ?? [], requests: requestEvidence(run.requests ?? []), completions: run.completions ?? [], notes: (run.turns ?? []).filter(turn => turn.note === true) })
    },
    async exportRunEvidence(requestedRunId) {
      // Reloaded history is inspectable without restoring control authority over
      // an old worker, command or execution environment.
      if (requestedRunId !== undefined && (typeof requestedRunId !== 'string' || !requestedRunId.trim())) throw new TypeError('Select a recorded run ID to export')
      const runId = requestedRunId ?? activeRun ?? state.run?.run ?? state.task?.id
      if (!runId) throw new Error('Start a task to record model requests and execution receipts')
      const missing = () => Object.assign(new Error('Saved evidence for this task is no longer retained. The visible conversation is not a substitute for its recorded trace.'), { code: 'RUN_EVIDENCE_MISSING' })
      const view = snapshot({ project: state.project, commands: state.commands, artifacts: state.artifacts.map(({ html, url, nonce, ...record }) => record) })
      const selected = await hub.runsApi.get(runId)
      if (!selected) throw missing()
      const trace = await hub.traces.export(selected.trace ?? selected.id)
      const recorded = trace.runs?.find(run => run.id === selected.id)
      if (!recorded) throw missing()
      const bound = recorded.context?.binding ? createBoundRunSnapshot({ ...recorded.context, runId: recorded.id }) : runBindings.get(recorded.id) ?? null
      const traceIds = new Set(trace.runs.map(run => run.id))
      const commands = view.commands.filter(command => traceIds.has(command.runId))
      const commandIds = new Set(commands.map(command => command.id))
      // A matching workspace/revision or the currently visible preview is not
      // task provenance. Only its recorded build-command link associates it.
      const artifacts = view.artifacts.filter(artifact => commandIds.has(artifact.manifest?.build?.commandId))
      return { version: 1, project: view.project, run: bound, trace, commands, artifacts }
    },
    async setExecutionTarget(target, { transfer = false } = {}) {
      requireWritable(); requireIdle()
      if (!['browser', 'local'].includes(target)) throw new Error('Unknown execution environment')
      transferring = true
      try {
        await loadLocation()
        if (target === state.runtime.target) return
        if (terminals.size) throw new Error('Close terminal sessions before transferring the workspace')
        return await transferWorkspace(target, { transfer })
      } finally { transferring = false }
    },
    async startRuntime() {
      const reconciledSetup = state.runtime.status === 'unresponsive' && executionHealth[state.runtime.target] === 'responsive' && executor?.describeCapabilities().health !== 'unresponsive'
      requireWritable({ allowReconciledSetup: reconciledSetup })
      if (state.runtime.status === 'unresponsive' && runtimeEstablished) {
        await reconcileRuntime(state.runtime.target); requireResponsive(); return executor
      }
      if (state.runtime.status === 'ready') { assertBound(); return executor }
      if (runtimeBoot) return runtimeBoot
      runtimeBoot = (async () => {
        runtimeEstablished = false
        const target = state.runtime.target; const epoch = executionEpochs[target]
        notify({ error: '', runtime: { ...state.runtime, status: 'starting', phase: 'Preparing environment' } })
        await loadLocation()
        const next = await prepareExecutor(state.runtime.target)
        const nextBinding = bindExecutor(next, state.runtime.target)
        checkLocation(locationOf(nextBinding, next))
        executor = next; binding = nextBinding
        await files.mount(executor); await refreshFiles(); const descriptor = executor.describeCapabilities()
        assertBound()
        await rememberLocation(binding, executor, () => { assertExecutionAlive(target, epoch); assertBound() })
        if (executionHealth[target] === 'unresponsive' || executor.describeCapabilities().health === 'unresponsive') throw unresponsive()
        runtimeEstablished = true
        notify({ runtime: { ...state.runtime, status: 'ready', health: 'responsive', phase: 'Ready', capabilities: descriptor.capabilities ?? [], detail: descriptor.toolchain?.kind ?? descriptor.toolchain ?? '', binding, savedBinding: workspaceLocation, bindingReview: null, conflicts: [], outstanding: [] } }); return executor
      })().catch(error => { if (state.runtime.status !== 'unresponsive') notify({ runtime: { ...state.runtime, status: 'failed', phase: error.code === 'WORKSPACE_MOUNT_CONFLICT' ? 'Saved changes need review' : 'Environment unavailable', detail: error.message, conflicts: error.conflicts ?? [] } }); throw report(error) }).finally(() => { runtimeBoot = null })
      return runtimeBoot
    },
    async runCommand(command, { actor = 'You', runId } = {}) {
      requireWritable()
      await controller.startRuntime(); requireWritable(); const jobId = id('command'); const abort = new AbortController(); running.set(jobId, abort)
      invalidate()
      const jobRevision = projectRevision; const jobRuntime = state.runtime.target; const jobBinding = assertBound()
      notify({ commands: [...state.commands, { id: jobId, command, cwd: jobBinding.root, actor, runId, runtime: state.runtime.target, binding: jobBinding, revision: jobRevision, status: 'running', output: '', outputLength: 0, at: Date.now() }] })
      let receivedExit
      try {
        const inputRevision = projectRevision
        const inputFingerprint = await fingerprint()
        assertBound(jobBinding)
        if (inputRevision !== projectRevision) throw new Error('Source changed while preparing the command; retry against the saved files.')
        const result = await executor.startJob({ id: jobId, program: '/bin/sh', args: [jobRuntime === 'local' ? '-c' : '-lc', command], cwd: '.', signal: abort.signal, onOutput(event) { const row = state.commands.find(row => row.id === jobId); const chunk = String(event.data ?? event.text ?? ''); commandUpdate(jobId, { output: `${row?.output ?? ''}${chunk}`.slice(-500000), outputLength: (row?.outputLength ?? 0) + chunk.length }) } })
        assertBound(jobBinding)
        if (result.runtimeId && result.runtimeId !== jobBinding.runtimeId) throw new Error('The command receipt came from a different runtime session')
        const code = result.code ?? result.exitCode
        receivedExit = { exitCode: code, cancelled: Boolean(result.cancelled), signal: result.signal ?? null }
        commandUpdate(jobId, { ...receivedExit, executionEnded: true, stage: 'reconciling' })
        await awaitReceiptHealth(jobBinding)
        await files.checkpoint(); await refreshFiles(); watched = JSON.stringify(await files.list())
        assertBound(jobBinding)
        const completedFingerprint = await fingerprint()
        assertBound(jobBinding)
        commandUpdate(jobId, { inputFingerprint, sourceUnchanged: inputFingerprint === completedFingerprint && inputRevision === projectRevision, completedFingerprint, completedRevision: projectRevision, status: result.cancelled ? 'cancelled' : result.timedOut || code !== 0 ? 'failed' : 'done', cancelled: result.cancelled === true, timedOut: result.timedOut === true, stage: 'complete', exitCode: code })
        const row = state.commands.find(row => row.id === jobId)
        return { ...result, id: jobId, output: row.output, outputLength: row.outputLength, runtime: jobRuntime, binding: jobBinding, revision: jobRevision }
      } catch (error) { commandUpdate(jobId, { status: receivedExit?.cancelled ? 'cancelled' : 'failed', stage: receivedExit ? 'reconciliation-failed' : 'outcome-unknown', error: receivedExit ? `Command exited${receivedExit.exitCode != null ? ` with code ${receivedExit.exitCode}` : ''}; workspace reconciliation failed: ${error.message}` : error.message }); throw error }
      finally { running.delete(jobId) }
    },
    async stopCommand(commandId) { running.get(commandId)?.abort(); await executor?.cancelJob?.(commandId) },
    async buildPreview(options = {}) {
      requireWritable()
      if (running.size) throw new Error('Finish running commands before building a source snapshot')
      await controller.startRuntime()
      const inputFingerprint = await fingerprint()
      const packageFile = await files.read('package.json'); if (!packageFile) throw new Error('Create a package.json with a build script first')
      const manifest = JSON.parse(packageFile.content); if (!manifest.scripts?.build) throw new Error('package.json does not define a build script')
      const result = await controller.runCommand(state.runtime.target === 'browser' ? 'rm -rf -- out && npm run build' : 'rm -rf -- out && bun --bun run build', options)
      if (result.cancelled || (result.code ?? result.exitCode) !== 0) throw new Error(result.cancelled ? 'Build was cancelled. The last successful preview is preserved.' : 'Build failed. Open Commands for the actual output.')
      const revision = result.revision; const target = result.runtime; const buildExecutor = executor; const sourceFingerprint = await fingerprint()
      if (sourceFingerprint !== inputFingerprint) throw new Error('Source files changed during the build. Review the saved files and build again; the last successful preview is preserved.')
      const unchanged = async () => { assertBound(result.binding); if (revision !== projectRevision || target !== state.runtime.target || buildExecutor !== executor || running.size || await fingerprint() !== sourceFingerprint) throw new Error('The workspace changed while packaging this build. Build the current saved files again; the last successful preview is preserved.') }
      await unchanged()
      const snapshot = await buildExecutor.snapshot('out'); const { packageArtifact } = await import('./artifacts.js')
      const artifact = await packageArtifact(snapshot, { revision, runtime: target })
      try { await unchanged() } catch (error) { URL.revokeObjectURL(artifact.url); throw error }
      const provenance = createArtifactManifest({ id: artifact.id, sourceRevision: revision, sourceFingerprint, runtime: result.binding, build: { id: artifact.buildId, commandId: result.id, exitCode: 0, sourceRevision: revision, runtimeId: result.binding.runtimeId }, resources: [...new Set(['index.html', ...artifact.resources])] })
      currentArtifact = { ...artifact, manifest: provenance, sourceFingerprint, status: 'ready', verified: false }; notify({ artifacts: [...state.artifacts, currentArtifact], activeArtifactId: artifact.id }); return { id: artifact.id, revision, status: 'ready', manifest: provenance, message: 'Built and packaged. Use workspace_check to run interaction assertions before claiming verification.' }
    },
    async checkArtifact({ assertions = [] } = {}, { requireInteraction = acceptance.requireInteraction } = {}) {
      requireResponsive()
      if (!currentArtifact || currentArtifact.revision !== projectRevision || running.size) return { ok: false, reason: 'Finish running commands and build the current source revision first' }
      const { inspectArtifact, validateAssertions } = await import('./artifacts.js')
      let plan; try { plan = validateAssertions(assertions, { requireInteraction }) } catch (error) { return { ok: false, reason: error.message } }
      const artifact = currentArtifact; const revision = projectRevision
      assertArtifactManifest(artifact.manifest, { binding: assertBound(), sourceRevision: revision, sourceFingerprint: artifact.sourceFingerprint })
      const checks = await (inspectOverride ?? inspectArtifact)(artifact, plan)
      assertBound(artifact.manifest.runtime)
      if (currentArtifact.id !== artifact.id || projectRevision !== revision || running.size || await fingerprint() !== artifact.sourceFingerprint) return { ok: false, reason: 'Source files or the selected artifact changed while checks ran.' }
      currentArtifact = { ...artifact, checks, verified: checks.ok }; notify({ artifacts: state.artifacts.map(row => row.id === currentArtifact.id ? currentArtifact : row) }); return checks
    },
    selectArtifact(artifactId) { notify({ activeArtifactId: artifactId }) },
    refreshPreview() { if (currentArtifact) notify({ artifacts: state.artifacts.map(row => row.id === currentArtifact.id ? { ...row, reload: (row.reload ?? 0) + 1 } : row) }) },
    async openTerminal(size) { requireWritable(); openingTerminals++; try { await controller.startRuntime(); requireWritable(); assertExecutionPort(executor, { binding, requireTerminal: true }); const terminal = await executor.openTerminal(size); terminals.add(terminal.id); return terminal } finally { openingTerminals-- } },
    terminalInput: (terminalId, data) => { requirePageActive(); if (data !== '\u0003') requireResponsive(); invalidate(); return executor?.terminalInput(terminalId, data) },
    resizeTerminal: (terminalId, cols, rows) => { requirePageActive(); return executor?.resizeTerminal(terminalId, cols, rows) },
    async closeTerminal(terminalId) { if (!terminals.has(terminalId)) return; await executor?.closeTerminal(terminalId); terminals.delete(terminalId) },
    subscribeTerminal(terminalId, listener) { if (executor?.subscribeTerminal) return executor.subscribeTerminal(terminalId, listener); const set = terminalListeners.get(terminalId) ?? new Set(); set.add(listener); terminalListeners.set(terminalId, set); return () => set.delete(listener) },
  }
  return controller
}
