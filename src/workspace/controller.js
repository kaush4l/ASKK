import { ProjectFiles } from './files.js'
import { LocalExecution } from '../execution/local.js'
import { prepareIsolation } from './isolation.js'
import { createWorkspaceBinding, assertWorkspaceBinding, assertWorkspacePort, assertExecutionPort, createArtifactManifest, assertArtifactManifest, createBoundRunSnapshot } from './contracts.js'

const active = status => ['thinking', 'calling', 'waiting', 'compacting', 'running', 'starting'].includes(status)
const id = prefix => `${prefix}-${crypto.randomUUID()}`
const readSaved = key => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null } }
const saveSetting = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }

/** One owner bridges the framework-free runtime and the subscribed workbench. */
export function createWorkbenchController({ onChange, basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '', workspace: workspaceOverride, createExecution: executionFactory, createCompanion = options => new LocalExecution(options), createHub: hubFactory, inspectArtifact: inspectOverride } = {}) {
  const listeners = new Set(onChange ? [onChange] : []); const running = new Map(); const terminalListeners = new Map(); const terminals = new Set()
  const base = `${basePath.replace(/\/$/, '')}/`
  let state = { ready: false, error: '', project: { name: 'Untitled workspace', id: 'default' }, goal: '', goalRevision: 0, files: [], messages: [], run: null, runtime: { target: 'browser', status: 'idle', phase: 'Not started', capabilities: [] }, companion: { status: 'disconnected', url: 'https://127.0.0.1:7717' }, model: { status: 'unconfigured', id: '', baseUrl: '' }, commands: [], artifacts: [], agents: [], plans: [], approvals: [], activity: [] }
  let hub; let local; let executor; let browser; let started; let disposed = false; let activeRun; let projectRevision = 0; let taskStartRevision = 0; let currentArtifact; let unsubscribe; let runtimeBoot; let taskArtifactId; let watcher; let watched = ''; let acceptance = { requireArtifact: true, requireInteraction: true }
  let uiLoaded = false; let persistTimer; let savingUI = Promise.resolve()
  let binding; let workspaceLocation = null; let locationLoaded = false; let legacyNative = false; let modelProfiles = []; let launchEpoch = 0; const runBindings = new Map()
  const persistUI = ({ strict = false } = {}) => {
    clearTimeout(persistTimer)
    if (!uiLoaded || !files.store?.durable) return Promise.resolve()
    const value = { projectRevision, messages: state.messages.slice(-500), run: state.run, plans: state.plans, target: state.runtime.target, commands: state.commands.slice(-100), artifacts: state.artifacts.slice(-3).map(({ url, ...record }) => record), activeArtifactId: state.activeArtifactId }
    savingUI = savingUI.catch(() => {}).then(() => files.store.put('settings', { key: 'workbench-state', value })).catch(error => { notify({ error: `Workspace history could not be saved: ${error.message}` }); if (strict) throw error })
    return savingUI
  }
  const notify = patch => { if (disposed) return; state = { ...state, ...patch }; for (const listener of listeners) listener(); if (uiLoaded && ['messages', 'run', 'plans', 'commands', 'artifacts'].some(key => key in patch)) { clearTimeout(persistTimer); persistTimer = setTimeout(persistUI, 200) } }
  const report = error => { notify({ error: error?.message ?? String(error) }); return error }
  const activity = event => notify({ activity: [...state.activity.slice(-199), { id: id('event'), at: Date.now(), ...event }] })
  const refreshFiles = async () => notify({ files: await files.list() })
  const invalidate = () => { projectRevision++; if (currentArtifact) { currentArtifact = { ...currentArtifact, stale: true, verified: false }; notify({ artifacts: state.artifacts.map(row => row.id === currentArtifact.id ? currentArtifact : row) }) } }
  const committed = event => { invalidate(); activity(event); refreshFiles().catch(report) }
  const files = workspaceOverride ?? new ProjectFiles({ onCommit: committed })
  if (workspaceOverride) files.onCommit = committed
  const commandUpdate = (key, patch) => notify({ commands: state.commands.map(command => command.id === key ? { ...command, ...patch } : command) })
  let fileMutations = 0; let openingTerminals = 0
  const requireIdle = () => { if (active(state.run?.status) || running.size || fileMutations || openingTerminals || runtimeBoot) throw new Error('Finish or stop active work before changing its execution environment') }
  let transferring = false; let connecting = false
  const requireWritable = () => { if (transferring) throw new Error('Wait for the workspace snapshot transfer to finish'); if (connecting) throw new Error('Wait for the companion connection change to finish') }
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
  const rememberLocation = async (value, port) => {
    const next = locationOf(value, port)
    if (!files.store.durable) throw new Error('Workspace location could not be saved durably. The execution binding was not acknowledged.')
    await files.store.put('settings', { key: `workspace-location:${state.project.id}`, value: next })
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
  const forRun = handler => (args, run) => { if (!run?.context?.binding) throw new Error('This task has no pinned workspace. Start a new task from the current workspace before using its files or execution tools.'); assertBound(run.context.binding); return handler(args, run) }
  async function prepareExecutor(target) {
    if (!['browser', 'local'].includes(target)) throw new Error('Unknown execution environment')
    if (executionFactory) return executionFactory(target)
    if (target === 'local') { if (!local) throw new Error('Connect the local companion first'); const health = await local.prepare(); if (!['fs', 'exec'].every(capability => health.capabilities.includes(capability))) throw new Error('This companion does not grant host files and native commands. Model relay pairing alone cannot enable Local Bun execution.'); return local }
    const { BrowserLinuxExecution } = await import('../execution/browser-linux.js')
    browser ??= new BrowserLinuxExecution({ projectId: state.project.id, assetsURL: new URL(`${base}browser-linux/`, location.origin).href, onEvent(event) { activity(event); if (event.phase || event.stage) notify({ runtime: { ...state.runtime, phase: event.phase ?? event.stage, progress: event.progress, detail: event.message } }); if (event.type === 'output' && event.terminalId) for (const listener of terminalListeners.get(event.terminalId) ?? []) listener(event) } })
    if (state.runtime.networkRelay && !local) throw new Error('Reconnect the selected guest network relay')
    await browser.setNetworkRelay(state.runtime.networkRelay ? { url: local.url, token: local.token } : null)
    await browser.prepare({}); return browser
  }

  async function transferWorkspace(target, { transfer = false, supplied = null } = {}) {
    const previous = state.runtime; const originalBackend = files.backend; const originalExecutor = executor; const originalBinding = binding
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
      await rememberLocation(destinationBinding, destination)
      invalidate()
      const descriptor = destination.describeCapabilities()
      notify({ runtime: { target, status: 'ready', phase: 'Ready', capabilities: descriptor.capabilities ?? [], binding, savedBinding: workspaceLocation, bindingReview: null } })
      activity({ type: 'workspace.transferred', from: previous.target, to: target, files: source.length, sourceFingerprint: before, binding })
    } catch (error) { files.backend = originalBackend; executor = originalExecutor; binding = originalBinding; await files.checkpoint().catch(() => {}); await refreshFiles().catch(() => {}); notify({ runtime: previous }); throw report(error) }
    finally { transferring = false }
  }

  function onHub(message) {
    if (message.type === 'persistence-error') notify({ error: message.error })
    if (message.type === 'bridge') notify({ companion: { status: message.state.status === 'answering' ? 'connected' : message.state.status, url: message.state.url, capabilities: message.state.capabilities ?? [], root: message.state.root, error: message.state.error } })
    if (message.type === 'boot' && message.stage === 'ready') notify({ ready: true })
    if (message.type === 'lock' && message.state === 'follower') notify({ error: 'Another tab owns the agent runtime. Close it to work here.' })
    if (message.type === 'todo') notify({ plans: [...state.plans.filter(plan => plan.runId !== message.run), { runId: message.run, agent: hub.runs.get(message.run)?.agent ?? 'Agent', items: message.items }] })
    if (message.type === 'status') {
      const run = hub.runs.get(message.run)
      if (!run?.parent) notify({ run: { ...message.slot, status: message.slot.status, step: message.slot.steps, agent: run?.agent ?? 'main' } })
      notify({ agents: [...hub.roster().values()].map(row => ({ id: row.run ?? row.id, name: row.agent, status: row.status ?? row.slot?.status, description: row.goal ?? row.query })) })
    }
    if (message.type === 'answer' && !hub.runs.get(message.run)?.parent) {
      notify({ messages: [...state.messages, { id: id('message'), role: 'assistant', content: message.text, at: Date.now(), runId: message.run }], run: { ...(state.run ?? {}), status: message.ok ? (currentArtifact?.verified && !currentArtifact.stale ? 'verified' : 'done') : (hub.runs.get(message.run)?.slot.status ?? 'failed') } })
    }
    if (message.type === 'approval' || message.type === 'approved') notify({ approvals: [...hub.approvals.values()].map(({ settle, ...approval }) => approval) })
    if (message.type === 'event') {
      if (message.kind === 'call') {
        const card = { id: message.callId ?? id('tool'), name: message.name, args: message.args, path: message.args?.path, command: message.args?.command, status: 'running', summary: message.value, runId: message.run }
        notify({ messages: [...state.messages, { id: card.id, role: 'assistant', content: '', at: Date.now(), tools: [card] }] })
      } else if (message.kind === 'observation') {
        let found = false
        const messages = [...state.messages].reverse().map(row => {
          if (found || !row.tools?.some(tool => message.callId ? tool.id === message.callId : tool.runId === message.run && tool.status === 'running')) return row
          let result; try { result = JSON.parse(message.value) } catch {}
          const failed = message.ok === false || result?.conflict || result?.ok === false || Number.isInteger(result?.code ?? result?.exitCode) && (result.code ?? result.exitCode) !== 0
          found = true; return { ...row, tools: row.tools.map(tool => ({ ...tool, status: failed ? 'failed' : 'done', summary: String(message.value).slice(0, 4000), ...(tool.name === 'workspace_run' && result?.id ? { commandId: result.id } : {}), ...(tool.name === 'workspace_build' && result?.id ? { artifactId: result.id } : {}) })) }
        }).reverse(); notify({ messages })
      } else if (['error', 'repair', 'retry', 'incomplete'].includes(message.kind)) activity({ type: message.kind, text: message.value, runId: message.run })
    }
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
        const hubOptions = { base: new URL(base, location.origin).href, storeName: 'askk-agents-v2' }
        hub = hubFactory ? await hubFactory(hubOptions) : new Hub(hubOptions)
        hub.externalOps = {
          'workspace.goal': forRun(() => ({ text: state.goal, revision: state.goalRevision })),
          'workspace.list': forRun(() => files.list()),
          'workspace.read': forRun(({ path }) => files.read(path)),
          'workspace.write': forRun(args => controller.saveFile({ ...args, expect: args.expect ?? args.expectedRevision })),
          'workspace.run': forRun((args, run) => controller.runCommand(args.command, { actor: run?.agent, runId: run?.id })),
          'workspace.build': forRun((_, run) => controller.buildPreview({ actor: run?.agent, runId: run?.id })),
          'workspace.check': forRun(args => controller.checkArtifact(args)),
          'workspace.acceptance': forRun(async () => {
            const sourceFingerprint = await fingerprint()
            const receipt = currentArtifact?.checks
            return { ok: !running.size && (acceptance.requireArtifact === false && projectRevision === taskStartRevision || Boolean(currentArtifact?.verified && !currentArtifact.stale && currentArtifact.id !== taskArtifactId && currentArtifact.revision === projectRevision && currentArtifact.sourceFingerprint === sourceFingerprint && receipt?.artifactId === currentArtifact.id && receipt?.revision === currentArtifact.revision && receipt?.buildId === currentArtifact.buildId)), reason: 'This application task needs a new build and passing interaction assertions against its unchanged source files.' }
          }),
          'workspace.environment': forRun(() => ({ target: state.runtime.target, status: state.runtime.status, binding, capabilities: state.runtime.capabilities, toolchain: executor?.describeCapabilities().toolchain, template: state.template, files: state.files.map(row => row.path), revision: projectRevision, artifact: currentArtifact ? { id: currentArtifact.id, revision: currentArtifact.revision, verified: currentArtifact.verified } : null })),
        }
        unsubscribe = hub.subscribe(onHub); await hub.start()
        if (disposed) { hub.stop(); return }
        if (hub.bridgeState.status === 'answering') local = new LocalExecution({ url: hub.bridgeState.url, token: hub.bridgeState.token })
        await controller.setModel({ baseUrl: state.model.baseUrl, model: state.model.id, apiKey: hub.settings.get().catalogue.models?.workbench?.api_key ?? '' })
        notify({ ready: true, agents: hub.manifest().map(row => ({ id: row.path, name: row.name, status: 'idle', description: row.description })) })
        watcher = setInterval(async () => { if (disposed || !files.backend || running.size) return; try { const rows = await files.list(); const fingerprint = JSON.stringify(rows); if (watched && fingerprint !== watched) { invalidate(); notify({ files: rows }) } watched = fingerprint } catch {} }, 2500)
      })().catch(error => { report(error); throw error })
      return started
    },
    stop() { persistUI(); disposed = true; clearInterval(watcher); clearTimeout(persistTimer); unsubscribe?.(); hub?.stop(); for (const abort of running.values()) abort.abort(); browser?.dispose(); local?.dispose(); for (const artifact of state.artifacts) URL.revokeObjectURL(artifact.url); listeners.clear() },
    readFile: path => files.read(path),
    saveFile: args => mutateFiles(() => files.save(args)),
    createFile: (path, content = '') => mutateFiles(() => files.save({ path, content, expect: 0 })),
    renameFile: (from, to, expect) => mutateFiles(() => files.rename(from, to, expect)),
    deleteFile: (path, expect) => mutateFiles(() => files.remove(path, expect)),
    async setConversationGoal(text, expectedRevision = state.goalRevision) {
      if (typeof text !== 'string' || text.length > 12000) throw new Error('The conversation goal must be text of at most 12,000 characters')
      if (!files.store?.durable) throw new Error('Browser storage is unavailable. The conversation goal was not saved.')
      const key = `conversation-goal:${state.project.id}`
      const result = await files.store.update('settings', key, row => {
        const current = row?.value ?? { text: '', revision: 0 }
        if (current.revision !== expectedRevision) throw new Error('The conversation goal changed. Reopen it before saving.')
        return { value: { key, value: { text: text.trim(), revision: current.revision + 1 } }, revision: current.revision + 1 }
      })
      notify({ goal: text.trim(), goalRevision: result.revision })
      if (activeRun && active(state.run?.status)) hub.send(activeRun, { type: 'nudge', text: text.trim() ? 'The owner updated the saved conversation goal. Read its current context before the next action.' : 'The owner cleared the saved conversation goal. Continue with the current task and steering.' })
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
    async sendGoal(text) {
      requireWritable()
      if (!text.trim()) return
      await controller.start()
      requireWritable()
      if (active(state.run?.status)) {
        if (!activeRun) throw new Error('The current task cannot receive steering yet')
        hub.send(activeRun, { type: 'nudge', text })
        notify({ messages: [...state.messages, { id: id('message'), role: 'user', content: text, steering: true, at: Date.now(), runId: activeRun }] })
        return activeRun
      }
      taskStartRevision = projectRevision
      taskArtifactId = currentArtifact?.id
      const launch = ++launchEpoch
      activeRun = null
      notify({ error: '', messages: [...state.messages, { id: id('message'), role: 'user', content: text, at: Date.now() }], run: { status: 'starting', agent: 'main' } })
      try {
        await controller.startRuntime(); requireWritable(); assertBound()
        if (launch !== launchEpoch) return null
        const sourceFingerprint = await fingerprint()
        if (launch !== launchEpoch) return null
        const { runId: handoffId, ...context } = createBoundRunSnapshot({ runId: id('handoff'), binding, sourceRevision: projectRevision, sourceFingerprint, modelTransport: { kind: state.model.via ?? 'direct', provider: hub.settings.get().catalogue.models?.workbench?.provider ?? 'openai', model: state.model.id, endpoint: state.model.baseUrl } })
        activeRun = hub.ask(text, { context })
        runBindings.set(activeRun, createBoundRunSnapshot({ runId: activeRun, ...context }))
        return activeRun
      } catch (error) { if (launch !== launchEpoch) return null; notify({ run: { status: 'failed', agent: 'main' } }); throw report(error) }
    },
    stopRun() { launchEpoch++; if (activeRun) { const run = hub.runs.get(activeRun); if (run) hub.abort(run) } else if (state.run?.status === 'starting') notify({ run: { ...state.run, status: 'cancelled' } }); for (const [key, abort] of running) { const command = state.commands.find(row => row.id === key); if (command?.runId) { abort.abort(); executor?.cancelJob?.(key) } } },
    stopAgent(runId) {
      const run = hub?.runs.get(runId); if (!run || run.ended) return
      const affected = new Set()
      const collect = row => { if (!row || affected.has(row.id)) return; affected.add(row.id); for (const child of row.children) collect(hub.runs.get(child)) }
      collect(run); hub.abort(run)
      for (const [key, abort] of running) if (affected.has(state.commands.find(command => command.id === key)?.runId)) { abort.abort(); executor?.cancelJob?.(key) }
    },
    approve: (approvalId, approved, always = false) => hub.answerApproval(approvalId, { approved, always }),
    async setModel({ baseUrl, model, apiKey, via }) {
      const previous = hub?.settings.get().catalogue.models?.workbench ?? {}
      const configured = modelProfiles.find(profile => profile.model === model && profile.base_url === baseUrl) ?? { provider: 'openai' }
      const sameModel = previous.model === model && previous.base_url === baseUrl
      const previousKey = previous.base_url === baseUrl ? previous.api_key : ''
      const profile = { ...configured, ...(sameModel ? previous : {}), base_url: baseUrl, model, api_key: apiKey ?? previousKey ?? '', via: via ?? state.model.via ?? (local ? 'bridge' : undefined) }
      if (hub?.store) await hub.settings.set({ catalogue: { default: 'workbench', models: { workbench: profile } }, dreaming: false })
      notify({ model: { status: 'configured', id: model, baseUrl, via: profile.via } }); saveSetting('askk:workbench-settings', { model: { id: model, baseUrl, via: profile.via } })
    },
    async connectCompanion({ url, token, transfer = false, rebind = false, expectedProposal = null }) {
      requireWritable(); requireIdle()
      if (terminals.size) throw new Error('Close terminal sessions before changing companion connections')
      connecting = true
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
        await controller.setModel({ model: state.model.id, baseUrl: state.model.baseUrl, via: 'bridge' })
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
            await rememberLocation(proposed.binding, next)
            if (native) {
              if (files.backend === previousBackend && previousBackend) files.backend = next
              executor = next; binding = proposed.binding
            }
            if (!native) invalidate()
            notify({ runtime: { ...state.runtime, ...(native ? { status: 'ready', phase: 'Ready', binding } : {}), savedBinding: workspaceLocation, bindingReview: null } })
          } catch (error) {
            files.backend = previousBackend; executor = previousExecutor; binding = previousBinding
            if (native) notify({ runtime: { ...state.runtime, status: 'failed', phase: error.code === 'WORKSPACE_MOUNT_CONFLICT' ? 'Saved changes need review' : 'Reconnect incomplete', detail: error.message, conflicts: error.conflicts ?? state.runtime.conflicts ?? [] } })
            throw error
          }
        }
        local = next
        notify({ companion: { status: 'connected', url: endpointOf(next), capabilities: health.capabilities, root: health.root } })
        return health
      } finally { connecting = false }
    },
    async testModel() {
      const result = await hub.models.refresh('workbench')
      if (result.error) { notify({ model: { ...state.model, status: 'failed', error: result.error } }); throw new Error(result.error) }
      const available = result.ids.includes(state.model.id)
      if (!available) throw new Error(`The server answered, but did not list model ${state.model.id}. Available: ${result.ids.slice(0, 12).join(', ')}`)
      notify({ model: { ...state.model, status: 'connected', checkedAt: result.at } }); return result
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
    async exportRunEvidence() {
      if (!activeRun) throw new Error('Start a task to record model requests and execution receipts')
      return { version: 1, project: state.project, run: runBindings.get(activeRun), trace: await hub.traces.export(activeRun), commands: state.commands, artifacts: state.artifacts.map(({ html, url, nonce, ...record }) => record) }
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
      requireWritable()
      if (state.runtime.status === 'ready') { assertBound(); return executor }
      if (runtimeBoot) return runtimeBoot
      runtimeBoot = (async () => {
        notify({ error: '', runtime: { ...state.runtime, status: 'starting', phase: 'Preparing environment' } })
        await loadLocation()
        const next = await prepareExecutor(state.runtime.target)
        const nextBinding = bindExecutor(next, state.runtime.target)
        checkLocation(locationOf(nextBinding, next))
        executor = next; binding = nextBinding
        await files.mount(executor); await refreshFiles(); const descriptor = executor.describeCapabilities()
        assertBound()
        await rememberLocation(binding, executor)
        notify({ runtime: { ...state.runtime, status: 'ready', phase: 'Ready', capabilities: descriptor.capabilities ?? [], detail: descriptor.toolchain?.kind ?? descriptor.toolchain ?? '', binding, savedBinding: workspaceLocation, bindingReview: null, conflicts: [] } }); return executor
      })().catch(error => { notify({ runtime: { ...state.runtime, status: 'failed', phase: error.code === 'WORKSPACE_MOUNT_CONFLICT' ? 'Saved changes need review' : 'Environment unavailable', detail: error.message, conflicts: error.conflicts ?? [] } }); throw report(error) }).finally(() => { runtimeBoot = null })
      return runtimeBoot
    },
    async runCommand(command, { actor = 'You', runId } = {}) {
      requireWritable()
      await controller.startRuntime(); requireWritable(); const jobId = id('command'); const abort = new AbortController(); running.set(jobId, abort)
      invalidate()
      const jobRevision = projectRevision; const jobRuntime = state.runtime.target; const jobBinding = assertBound()
      notify({ commands: [...state.commands, { id: jobId, command, cwd: jobBinding.root, actor, runId, runtime: state.runtime.target, binding: jobBinding, revision: jobRevision, status: 'running', output: '', at: Date.now() }] })
      try {
        const result = await executor.startJob({ id: jobId, program: '/bin/sh', args: ['-lc', command], cwd: '.', signal: abort.signal, onOutput(event) { const row = state.commands.find(row => row.id === jobId); commandUpdate(jobId, { output: `${row?.output ?? ''}${event.data ?? event.text ?? ''}`.slice(-500000) }) } })
        assertBound(jobBinding)
        if (result.runtimeId && result.runtimeId !== jobBinding.runtimeId) throw new Error('The command receipt came from a different runtime session')
        const code = result.code ?? result.exitCode
        await files.checkpoint(); await refreshFiles(); watched = JSON.stringify(await files.list())
        assertBound(jobBinding)
        commandUpdate(jobId, { status: result.cancelled ? 'cancelled' : code === 0 ? 'done' : 'failed', exitCode: code })
        const row = state.commands.find(row => row.id === jobId)
        return { ...result, id: jobId, output: row.output, runtime: jobRuntime, binding: jobBinding, revision: jobRevision }
      } catch (error) { commandUpdate(jobId, { status: abort.signal.aborted ? 'cancelled' : 'failed', error: error.message }); throw error }
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
      const result = await controller.runCommand(state.runtime.target === 'browser' ? 'rm -rf -- out && npm run build' : 'rm -rf -- out && bun run build', options)
      if ((result.code ?? result.exitCode) !== 0) throw new Error('Build failed. Open Commands for the actual output.')
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
    async checkArtifact({ assertions = [] } = {}) {
      if (!currentArtifact || currentArtifact.revision !== projectRevision || running.size) return { ok: false, reason: 'Finish running commands and build the current source revision first' }
      const { inspectArtifact, validateAssertions } = await import('./artifacts.js')
      let plan; try { plan = validateAssertions(assertions, { requireInteraction: acceptance.requireInteraction }) } catch (error) { return { ok: false, reason: error.message } }
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
    terminalInput: (terminalId, data) => { invalidate(); return executor?.terminalInput(terminalId, data) },
    resizeTerminal: (terminalId, cols, rows) => executor?.resizeTerminal(terminalId, cols, rows),
    async closeTerminal(terminalId) { await executor?.closeTerminal(terminalId); terminals.delete(terminalId) },
    subscribeTerminal(terminalId, listener) { if (executor?.subscribeTerminal) return executor.subscribeTerminal(terminalId, listener); const set = terminalListeners.get(terminalId) ?? new Set(); set.add(listener); terminalListeners.set(terminalId, set); return () => set.delete(listener) },
  }
  return controller
}
