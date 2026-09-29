/**
 * The hub — the page side of the harness. It spawns, routes and records, and has no opinions.
 *
 *     const hub = new Hub({ base: document.baseURI })
 *     hub.subscribe((message) => render(message))
 *     await hub.start()
 *     const run = hub.ask('hello')                    // main's next run
 *
 * One Web Worker per agent thread (runtime/agent.worker.js). Resident threads (main, agents
 * that remember, agents that write) live as long as the page; any other agent called as a tool
 * gets a fresh thread per call, so parallel calls never share history. Every run is on the
 * roster with a status slot posted by its loop, so the page reads progress without asking.
 *
 * Only the hub touches storage, the board, memory, the host bridge and the owner's approvals,
 * so every one of those has a single writer and cannot race. A thread asks with `request` and
 * gets exactly one `reply`.
 *
 * See docs/rewrite/ARCHITECTURE.md §6 (threads), §7 (bridge), §13–§16 (permissions, memory,
 * dreaming, tracing).
 */

import { agentHash, agentPaths, headPaths, loader, loadIndex, readSpec, skillFiles } from '../core/folder.js'
import { assertModelRelay, inference, InferenceError, redactedURL } from '../core/inference.js'
import { describeTool, mcp } from '../core/mcp.js'
import { read } from '../core/markdown.js'
import { merge, resolve } from '../core/models.js'
import { DEFAULT_POLICY, withAgentRules } from '../core/permissions.js'
import { snapshot } from '../core/prompt.js'
import { loadStrategy, startHubStrategy, strategyChildState } from './strategy-hub.js'
import { openStore } from './store.js'
import { hasToolRequirement, normalizeToolPolicy, scopedToolDecision, toolSelected } from './tool-policy.js'

const LIMITS = { depth: 3, outstanding: 3 }
const KEEP_RUNS = 200
const TICK_MS = 20000
const READY_TIMEOUT = 10000
const DREAM_AFTER = 20000
const ACTIVE = new Set(['thinking', 'calling', 'waiting', 'compacting', 'starting', 'running', 'cancelling', 'verifying'])
const WRITERS = new Set(['host', 'files', 'workspace'])
const HOSTED = new Set(['host', 'web', 'mcp'])
const TOOL_EVENT_STORAGE = 'separate-v1'
const EVIDENCE_TIMEOUT_MS = 15000
const MODEL_PROBE_PROMPT = Object.freeze([{ role: 'user', content: 'Reply with exactly: Connected.' }])

const bridgeIdentity = value => JSON.stringify({ name: value?.name, version: value?.version, runtimeId: value?.runtimeId, root: value?.root, capabilities: [...(value?.capabilities ?? [])].sort(), mcp: [...(value?.mcp ?? [])].sort(), clis: value?.clis })

/** A hard caller bound, including fetch implementations that ignore AbortSignal. */
async function boundedModelCheck(callback, { signal, timeoutMs } = {}, defaultMs = 15000) {
  const requested = timeoutMs ?? defaultMs
  if (!Number.isFinite(requested) || requested <= 0) throw new InferenceError('Connection timeout must be a positive number of milliseconds.', 'configuration')
  const limit = Math.min(requested, 120000)
  const controller = new AbortController()
  const cancelled = () => controller.abort(new InferenceError('Model connection check cancelled.', 'aborted'))
  if (signal?.aborted) cancelled()
  else signal?.addEventListener('abort', cancelled, { once: true })
  let timer; let rejectAbort
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', rejectAbort, { once: true }) })
  try {
    if (controller.signal.aborted) throw controller.signal.reason
    timer = setTimeout(() => controller.abort(new InferenceError(`Model connection check timed out after ${limit} ms.`, 'timeout')), limit)
    return await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw controller.signal.reason; return callback(controller.signal, limit) }), aborted])
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancelled); controller.signal.removeEventListener('abort', rejectAbort)
  }
}

/** Provider bodies/errors can echo credentials; redact known values as well as named fields. */
function modelEvidence(value, settings = {}, bridge = {}) {
  const secrets = [settings.apiKey, bridge.token, ...Object.entries(settings.headers ?? {}).filter(([key]) => !['content-type', 'accept'].includes(key.toLowerCase())).map(([, val]) => val)].filter(val => typeof val === 'string' && val.length > 0)
  const clean = input => {
    if (typeof input === 'string') return secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), input)
    if (Array.isArray(input)) return input.map(clean)
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, val]) => [key, /api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token|^token$/i.test(key) ? '[redacted]' : clean(val)]))
    return input
  }
  return snapshot(clean(value))
}

const modelFailure = (error, settings, bridge) => modelEvidence({ error: String(error?.message ?? error), errorCode: error?.code ?? (error?.name === 'AbortError' ? 'aborted' : 'provider_error'), ...(error?.metadata?.status ? { httpStatus: error.metadata.status } : {}), at: Date.now() }, settings, bridge)

const lastOpen = (spans, kind) => {
  for (let index = spans.length - 1; index >= 0; index -= 1) if (spans[index].kind === kind && spans[index].ms == null) return spans[index]
  return null
}

// The archive owner appends internally. Public run/trace views must not expose
// that mutable collection; records read from storage also need frozen entries.
const evidenceView = record => record && ({ ...record, toolEvents: Object.freeze((record.toolEvents ?? []).map(event => Object.isFrozen(event) ? event : snapshot(event))) })

const boundedEvidence = async (work, timeoutMs = EVIDENCE_TIMEOUT_MS) => {
  const budget = Math.max(1, Math.min(60000, Number(timeoutMs) || EVIDENCE_TIMEOUT_MS))
  let timer
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Evidence export did not finish within ${budget} ms; no partial export was produced`)), budget) })]) }
  finally { clearTimeout(timer) }
}

/** Partial provider counts, never estimates. Missing counters stay absent, including totals. */
function traceUsage(runs) {
  const result = { attempts: 0, reportedAttempts: 0, unknownAttempts: 0, reportedTokens: {}, tokenCoverage: {} }
  const numeric = values => values.find(value => Number.isSafeInteger(value) && value >= 0)
  for (const run of runs) {
    const attempts = (run.requests ?? []).map(() => ({ usage: null }))
    const completions = run.completions ?? (run.log ?? []).filter(event => event.kind === 'completion')
    for (const completion of completions) {
      const index = completion.requestIndex
      const request = Number.isInteger(index) && index >= 0 ? run.requests?.[index] : null
      if (request && request.attemptId === completion.attemptId && !attempts[index].completed) attempts[index] = { completed: true, usage: completion.usage }
      else if (!run.completions && attempts.length) continue // Older traces lack the association and all requests remain unknown.
      else attempts.push({ completed: true, usage: completion.usage })
    }
    for (const attempt of attempts) {
      const usage = attempt.usage ?? {}
      const counters = {
        inputTokens: numeric([usage.prompt_tokens, usage.input_tokens]),
        outputTokens: numeric([usage.completion_tokens, usage.output_tokens]),
        totalTokens: numeric([usage.total_tokens]),
        cachedInputTokens: numeric([usage.prompt_tokens_details?.cached_tokens, usage.cache_read_input_tokens]),
        cacheCreationInputTokens: numeric([usage.cache_creation_input_tokens]),
        reasoningOutputTokens: numeric([usage.completion_tokens_details?.reasoning_tokens, usage.output_tokens_details?.reasoning_tokens]),
      }
      result.attempts++
      if (Object.values(counters).every(value => value === undefined)) result.unknownAttempts++
      else result.reportedAttempts++
      for (const [name, value] of Object.entries(counters)) if (value !== undefined) {
        result.reportedTokens[name] = (result.reportedTokens[name] ?? 0) + value
        result.tokenCoverage[name] = (result.tokenCoverage[name] ?? 0) + 1
      }
    }
  }
  return result
}

export class Hub {
  constructor({ base = globalThis.document?.baseURI, workerUrl = new URL('./agent.worker.js', import.meta.url), storeName = 'harness', fetch: fetcher } = {}) {
    this.base = base
    this.workerUrl = workerUrl
    this.storeName = storeName
    this.fetch = fetcher ?? globalThis.fetch.bind(globalThis)
    this.listeners = new Set()
    this.threads = new Map() // key → resident thread
    this.runs = new Map() // id → run
    this.toolEventWrites = new Map() // id → ordered writes and retryable failures
    this.runRecordWrites = new Map() // id → pending metadata writes, including the event watermark
    this.runEvictions = new Map() // id → retention reservation; later writes wait outside its drain
    this.evictedEvidence = new Set() // completed runs still visible in memory, no longer retained on disk
    this.retentionQueue = Promise.resolve()
    this.scheduled = { items: [], next: 1 } // schedules, saved in settings
    this.mcpServers = new Map() // name → {name, url, from, status, tools, error, client}
    this.mcpRefreshSequence = 0
    this.boards = new Map() // trace → {entries, next, released}
    this.approvals = new Map() // id → approval
    this.index = { files: {} }
    this.specs = new Map() // path → spec
    this.failed = new Map() // path → error
    this.readyInfo = new Map() // path → {tools, notes, shadowed, unavailable}
    this.changed = new Map() // path → files changed at the last reload
    this.fileCatalogue = {}
    this.saved = { catalogue: {}, policy: DEFAULT_POLICY, dreaming: true }
    this.bridgeState = { status: 'unpaired', generation: 0, since: Date.now(), url: '', token: '', health: null, error: '' }
    this.bridgeCheckSequence = 0
    this.bridgeSettingsWrites = Promise.resolve()
    this.lockState = 'starting'
    this.nextRun = 1
    this.nextApproval = 1
    this.dreamTimer = null
    this.started = false
    this.disposed = false
    this.allThreads = new Set()
    this.externalOps = {}
  }

  // ─── events ────────────────────────────────────────────────────────────────

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(message) {
    if (message.type === 'approval' || message.type === 'approved') strategyChildState(this, this.runs.get(message.approval?.run ?? message.run))
    for (const listener of this.listeners) {
      try {
        listener(message)
      } catch (error) {
        console.error('hub listener failed', error)
      }
    }
  }

  // ─── boot ──────────────────────────────────────────────────────────────────

  async start() {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startOnce()
    return this.startPromise
  }

  async startOnce() {
    this.store = await openStore(this.storeName)
    if (this.disposed) return this
    // Settings and folders are read before the lock, so a second tab can still show Team and
    // Settings read-only while it waits (UX U10). They are read again once this tab leads.
    const loadSettings = async () => {
      const [catalogue, policy, dreaming, bridge, servers] = await Promise.all(
        ['catalogue', 'policy', 'dreaming', 'bridge', 'mcp'].map((key) => this.store.get('settings', key).then((row) => row?.value)),
      )
      this.saved = { catalogue: catalogue ?? {}, policy: policy ?? DEFAULT_POLICY, dreaming: dreaming ?? true, mcp: servers ?? {} }
      return bridge
    }
    await loadSettings()
    this.publish({ type: 'boot', stage: 'agents' })
    await this.readFolders()
    this.publish({ type: 'boot', stage: 'agents', build: this.index.build ?? '', total: this.specs.size })
    const waited = await this.lead()
    if (this.disposed) return this
    const bridge = await loadSettings()
    await this.markInterrupted()
    if (waited) await this.readFolders()
    if (bridge?.url) await this.bridgeCheck(bridge.url, bridge.token)
    await this.mcpRefresh({ restart: false })
    this.publish({ type: 'boot', stage: 'threads', done: 0, total: this.specs.size })
    await this.startThreads()
    this.started = true
    this.publish({ type: 'boot', stage: 'ready', durable: this.store.durable, why: this.store.why, build: this.index.build ?? '' })
    this.poll = setInterval(() => this.bridgeState.url && this.bridgeCheck(this.bridgeState.url, this.bridgeState.token), 30000)
    this.scheduled = (await this.store.get('settings', 'schedules'))?.value ?? { items: [], next: 1 }
    for (const item of this.scheduled.items) item.next = item.next == null ? Infinity : item.next
    this.tick()
    this.ticker = setInterval(() => this.tick(), TICK_MS)
    globalThis.addEventListener?.('pagehide', () => this.stop('the tab closed'))
    return this
  }

  /** Only one tab runs the agents. A second tab waits for the lock and takes over when it frees. */
  async lead() {
    const locks = globalThis.navigator?.locks
    if (!locks) {
      this.lockState = 'leader'
      return false
    }
    let waited = false
    this.leadAbort = new AbortController()
    await new Promise((granted) => {
      const hold = () => {
        if (this.disposed) { granted(); return }
        this.lockState = 'leader'
        granted()
        return new Promise((release) => (this.releaseLock = release))
      }
      locks
        .request('harness:leader', { ifAvailable: true }, (lock) => (lock ? hold() : null))
        .then(() => {
          if (this.disposed) { granted(); return }
          if (this.lockState === 'leader') return
          this.lockState = 'follower'
          waited = true
          this.publish({ type: 'lock', state: 'follower' })
          locks.request('harness:leader', { signal: this.leadAbort.signal }, () => {
            this.publish({ type: 'lock', state: 'leader' })
            return hold()
          }).catch(() => granted())
        })
    })
    return waited
  }

  lock() {
    return this.lockState
  }

  stop(why = 'stopped') {
    this.disposed = true
    this.bridgeCheckSequence++
    this.leadAbort?.abort()
    clearTimeout(this.dreamTimer)
    clearInterval(this.poll)
    clearInterval(this.ticker)
    for (const run of this.runs.values()) if (!run.ended) {
      this.abort(run)
      // The page is about to terminate its workers, so their abort replies cannot be relied on.
      const status = why === 'the tab closed' ? 'interrupted' : 'cancelled'
      if (run.strategyState) run.strategyState = snapshot({ ...run.strategyState, status, reason: why, nodes: run.strategyState.nodes.map(node => ['queued', 'running', 'waiting', 'cancelling'].includes(node.status) ? { ...node, status, waiting: null, reason: why } : node) })
      this.end(run, `(${status}: ${why})`, false, why, { status, terminationReason: status })
    }
    for (const thread of this.allThreads) thread.worker.terminate()
    this.allThreads.clear()
    this.threads.clear()
    this.releaseLock?.()
    this.publish({ type: 'stopped', why })
  }

  /** Runs that were active when the page last went away are interrupted, and can be resumed. */
  async markInterrupted() {
    for (const record of await this.store.all('runs')) {
      if (ACTIVE.has(record.slot?.status) || record.slot?.status === 'idle') {
        record.slot = { ...record.slot, status: 'interrupted', terminationReason: 'interrupted' }
        if (record.strategyState) record.strategyState = { ...record.strategyState, status: 'interrupted', reason: 'The page stopped; no role was restarted.', nodes: record.strategyState.nodes.map(node => ['pending', 'queued', 'running', 'waiting', 'cancelling'].includes(node.status) ? { ...node, status: 'interrupted', waiting: null, reason: 'The page stopped; no role was restarted.' } : node) }
        await this.store.put('runs', record)
      }
    }
  }

  async readFolders() {
    this.index = await loadIndex(this.base, this.fetch)
    const load = loader(this.base, this.index, this.fetch)
    try {
      this.fileCatalogue = JSON.parse(await load('models.json'))
    } catch {
      this.fileCatalogue = {}
    }
    this.specs.clear()
    this.failed.clear()
    await Promise.all(
      agentPaths(this.index).map(async (path) => {
        try {
          this.specs.set(path, await readSpec(path, { index: this.index, load }))
        } catch (error) {
          this.failed.set(path, String(error?.message ?? error))
        }
      }),
    )
  }

  catalogue() {
    return merge(this.fileCatalogue, this.saved.catalogue)
  }

  isResident(spec) {
    return spec.path === 'main' || Boolean(spec.engine.remembers) || spec.grants.some((grant) => WRITERS.has(grant))
  }

  /** Start every resident thread; probe every other agent once so its tools and notes are known. */
  async startThreads() {
    let done = 0
    await Promise.all(
      [...this.specs.values()].map(async (spec) => {
        if (this.isResident(spec)) await this.thread(spec.path)
        else await this.probe(spec.path)
        done += 1
        this.publish({ type: 'boot', stage: 'threads', done, total: this.specs.size })
      }),
    )
  }

  // ─── threads ───────────────────────────────────────────────────────────────

  /** Everything a worker needs to build its engine. */
  async initMessage(spec) {
    const agents = [...spec.peers, ...spec.owned]
      .map((path) => this.specs.get(path))
      .filter(Boolean)
      .map((peer) => ({ path: peer.path, name: peer.name, description: peer.description }))
    const heads = new Set(headPaths(this.index))
    return {
      type: 'init',
      spec,
      catalogue: this.catalogue(),
      policy: withAgentRules(this.saved.policy, spec.path, spec.permissions),
      host: this.hostInfo(),
      base: String(this.base),
      index: this.index,
      agents,
      learned: await this.learnedFor(spec),
      mcp: spec.grants.includes('mcp') ? this.mcpTools() : [],
      compactor: heads.has('compactor') && !['compactor', 'dreamer'].includes(spec.path) ? 'compactor' : null,
    }
  }

  async learnedFor(spec) {
    return [spec.learned, (await this.store.get('learned', spec.path))?.text].filter(Boolean).join('\n')
  }

  hostInfo() {
    const bridge = this.bridgeState
    if (bridge.status !== 'answering') return null
    return { name: bridge.health?.name, url: bridge.url, token: bridge.token, root: bridge.health?.root, capabilities: bridge.health?.capabilities ?? [] }
  }

  /** A resident thread, started if it is not running. */
  async thread(path) {
    const existing = this.threads.get(path)
    if (existing) return existing.ready
    const session = await this.store.get('sessions', path)
    return this.spawn(this.specs.get(path), { key: path, resident: true, history: session?.turns ?? [] })
  }

  /** Start a worker for a spec and wait for `ready`, or fail it after ten seconds. */
  async spawn(spec, { key, resident, history = [] }) {
    if (this.disposed) throw new Error('The runtime has been disposed')
    const worker = new Worker(this.workerUrl, { type: 'module', name: spec.path })
    const thread = { key, path: spec.path, spec, worker, resident, busy: false, queue: [], run: null, stale: false }
    this.allThreads.add(thread)
    let readied
    thread.ready = new Promise((resolveReady) => (readied = resolveReady))
    const timer = setTimeout(() => {
      thread.dead = `sent no ready after ${READY_TIMEOUT / 1000}s`
      this.readyInfo.set(spec.path, { ...(this.readyInfo.get(spec.path) ?? {}), error: thread.dead })
      this.publish({ type: 'ready', agent: spec.path, error: thread.dead })
      readied(thread)
    }, READY_TIMEOUT)
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        clearTimeout(timer)
        this.readyInfo.set(spec.path, data)
        this.publish({ type: 'ready', agent: spec.path, ...data })
        readied(thread)
        return
      }
      this.onThreadMessage(thread, data)
    }
    worker.onerror = (event) => {
      event.preventDefault?.()
      clearTimeout(timer)
      thread.dead = thread.dead ?? String(event.message ?? 'the thread crashed')
      readied(thread)
      this.onThreadMessage(thread, { type: 'fatal', message: event.message ?? 'the thread crashed' })
    }
    if (resident) this.threads.set(key, thread)
    worker.postMessage({ ...(await this.initMessage(spec)), history })
    return thread.ready
  }

  /** Start and immediately retire a thread, to learn an agent's tools and import notes. */
  async probe(path) {
    const thread = await this.spawn(this.specs.get(path), { key: `probe:${path}`, resident: false })
    this.retire(thread)
  }

  retire(thread) {
    thread.worker.terminate()
    this.allThreads.delete(thread)
    if (this.threads.get(thread.key) === thread) this.threads.delete(thread.key)
  }

  async restart(thread, why = 'restarted') {
    this.retire(thread)
    const fresh = await this.thread(thread.path)
    fresh.queue.push(...thread.queue)
    this.publish({ type: 'restarted', agent: thread.path, why, at: Date.now() })
    this.pump(fresh)
    return fresh
  }

  // ─── runs ──────────────────────────────────────────────────────────────────

  /** Ask main something. Returns the new run's id. */
  ask(query, options) {
    return this.startRun('main', query, options).id
  }

  /** Allocate one observable run before dispatch; strategy roots own no model worker. */
  createRun(path, query, { parent = null, call = '', kind = 'task', context = null, resume = null, stageId = null, strategyDefinition = null, strategyDefinitionHash = null } = {}) {
    const spec = this.specs.get(path)
    const up = parent ? this.runs.get(parent) : null
    const inherited = up?.context ?? context
    const contextSnapshot = snapshot(up?.kind === 'strategy' ? { ...inherited, toolPolicy: { disabledTools: [], approvalRisks: [], ...normalizeToolPolicy(inherited?.toolPolicy), allowDelegation: false } } : inherited)
    normalizeToolPolicy(contextSnapshot?.toolPolicy)
    const id = `r${Date.now().toString(36)}${(this.nextRun++).toString(36)}`
    const run = {
      id,
      trace: up?.trace ?? id,
      agent: path,
      parent,
      depth: up ? up.depth + 1 : 0,
      kind,
      ended: false,
      query,
      taskId: up?.taskId ?? resume?.taskId ?? id,
      stageId,
      strategyDefinition,
      strategyDefinitionHash,
      resumedFrom: resume?.id ?? null,
      resumeAttempt: resume ? (resume.resumeAttempt ?? 0) + 1 : 0,
      originalQuery: resume?.originalQuery ?? resume?.query ?? query,
      todo: resume ? snapshot((Array.isArray(resume.todo) ? resume.todo : []).slice(0, 50)) : [],
      context: contextSnapshot,
      call,
      turns: [],
      prompts: [],
      requests: [],
      completions: [],
      toolEvents: [],
      spans: [],
      log: [],
      children: [],
      at: Date.now(),
    }
    run.slot = {
      run: id,
      agent: path,
      parent,
      depth: run.depth,
      trace: run.trace,
      status: 'idle',
      goal: query,
      steps: 0,
      maxSteps: spec?.engine.maxSteps ?? 10,
      seconds: 0,
      startedAt: run.at,
      calls: 0,
      repeats: 0,
      current: '',
      model: '',
      error: '',
    }
    run.answer = new Promise((resolveAnswer) => (run.finish = resolveAnswer))
    this.runs.set(id, run)
    if (up) {
      up.children.push(id)
      this.publish({ type: 'event', run: parent, agent: up.agent, kind: 'child', name: call, value: id, at: Date.now() })
    }
    this.publish({ type: 'run', run: this.describe(run) })
    if (run.todo.length) this.publish({ type: 'todo', run: id, items: run.todo })
    this.persist(run)
    clearTimeout(this.dreamTimer)

    return run
  }

  loadStrategy(reference) { return loadStrategy(this, reference) }

  startStrategy(definition, query, options = {}) { return startHubStrategy(this, definition, query, options) }

  /** Resident agents queue; explicit fresh role invocations never read/write resident history. */
  startRun(path, query, options = {}) {
    const spec = this.specs.get(path)
    const run = this.createRun(path, query, options)
    const { id } = run
    if (!spec) {
      this.end(run, `(failed: no agent at agents/${path})`, false, `no agent at agents/${path}`)
      return run
    }
    const begin = async () => {
      const thread = !options.fresh && this.isResident(spec) ? await this.thread(path) : await this.spawn(spec, { key: `call:${id}`, resident: false })
      if (thread.dead) {
        this.retire(thread)
        return this.end(run, `(failed: ${thread.dead})`, false, thread.dead)
      }
      if (run.ended) { if (!thread.resident) this.retire(thread); return }
      thread.queue.push(run)
      this.pump(thread)
    }
    begin().catch((error) => this.end(run, `(failed: ${error.message})`, false, error.message))
    return run
  }

  pump(thread) {
    if (thread.busy || !thread.queue.length) return
    const run = thread.queue.shift()
    if (run.ended) return this.pump(thread)
    thread.busy = true
    thread.run = run.id
    run.thread = thread
    thread.worker.postMessage({ type: 'invoke', query: run.query, context: run.context })
  }

  onThreadMessage(thread, message) {
    const run = thread.run ? this.runs.get(thread.run) : null
    switch (message.type) {
      case 'status':
        if (!run) return
        run.slot = { ...run.slot, ...message.slot, run: run.id, agent: run.agent, parent: run.parent, depth: run.depth, trace: run.trace, startedAt: run.slot.startedAt }
        this.publish({ type: 'status', run: run.id, slot: run.slot })
        strategyChildState(this, run)
        return
      case 'event':
        if (run) this.record(run, message)
        return
      case 'history':
        if (!run) return
        if (thread.resident) {
          if (run.turnsFrom == null) {
            const at = message.turns.findLastIndex((turn) => turn.role === 'user' && turn.content === run.query)
            run.turnsFrom = at === -1 ? 0 : at
          }
          run.turns = message.turns.slice(run.turnsFrom)
          this.store.put('sessions', { agent: thread.path, turns: message.turns }).catch(error => this.publish({ type: 'persistence-error', run: run.id, error: `Conversation could not be saved: ${error.message}` }))
        } else run.turns = message.turns
        this.publish({ type: 'history', run: run.id, agent: run.agent, turns: run.turns, session: thread.resident ? message.turns : null })
        this.persist(run)
        return
      case 'request':
        this.handle(thread, run, message)
        return
      case 'answer':
        if (run) this.end(run, message.text, message.ok, message.ok ? '' : message.slot?.error, message.slot)
        this.idle(thread)
        return
      case 'fatal':
        if (run) this.end(run, `(failed: the thread stopped: ${message.message})`, false, `the thread stopped: ${message.message}`)
        thread.busy = false
        thread.run = null
        this.retire(thread)
        this.publish({ type: 'fatal', agent: thread.path, message: message.message })
        return
      default:
    }
  }

  /** Keep what the thread view needs: prompts, spans and the system lines. Deltas pass through. */
  record(run, event) {
    const at = Date.now()
    const spans = run.spans
    // Model-facing observations may be projected. Keep the exact paired calls
    // and results independently of the bounded UI log and later compaction.
    if (event.kind === 'call' || event.kind === 'observation') {
      const entries = run.toolEvents ??= []
      const entry = snapshot({ ...event, sequence: entries.length + 1, at })
      entries.push(entry)
      this.queueToolEvent(run.id, entry)
    }
    if (event.kind === 'prompt') {
      run.prompts.push(snapshot({ step: event.step, attemptId: event.attemptId, attempt: event.attempt, sheet: event.value, tokens: event.tokens, snapshot: event.requestSnapshot }))
      const open = lastOpen(spans, 'step')
      if (open) open.ms = at - open.start
      spans.push({ kind: 'step', step: event.step, start: at, tokens: event.tokens })
    } else if (event.kind === 'request') {
      // Preserve exact redacted provider attempts separately from compiled prompt snapshots.
      ;(run.requests ??= []).push(snapshot({ ...event, at }))
    } else if (event.kind === 'completion') {
      // One compiled attempt may retry transport. Link to the last actual request, not
      // the prompt's repair counter; earlier failed requests still have unknown usage.
      const requestIndex = (run.requests ?? []).findLastIndex(request => request.attemptId === event.attemptId)
      ;(run.completions ??= []).push(snapshot({ ...event, at, requestIndex: requestIndex < 0 ? null : requestIndex }))
    } else if (event.kind === 'call') {
      const open = lastOpen(spans, 'step')
      if (open) open.ms = at - open.start
    } else if (event.kind === 'observation') {
      spans.push({ kind: 'call', name: event.name, start: at - (event.ms ?? 0), ms: event.ms ?? 0, ok: event.ok })
    } else if (event.kind === 'approval') {
      spans.push({ kind: 'approval', name: event.value, start: at })
    } else if (event.kind === 'approved') {
      const open = lastOpen(spans, 'approval')
      if (open) {
        open.ms = at - open.start
        open.ok = event.value === 'approved'
      }
    }
    if (!['delta', 'reasoning', 'prompt', 'field'].includes(event.kind)) {
      run.log.push({ at, kind: event.kind, name: event.name, value: String(event.value).slice(0, 4000), ms: event.ms, ok: event.ok, step: event.step, ...(event.attemptId ? { attemptId: event.attemptId } : {}), ...(event.kind === 'completion' ? { finishReason: event.finishReason } : {}) })
      if (run.log.length > 400) run.log.shift()
    }
    this.publish({ ...event, type: 'event', run: run.id, agent: run.agent, at })
    if (['prompt', 'request', 'completion', 'call', 'observation', 'repair', 'retry'].includes(event.kind)) this.persist(run)
  }

  end(run, text, ok, error = '', slot = null) {
    if (run.ended) return
    run.ended = true
    run.result = text
    const terminal = slot?.status ?? run.slot.status
    run.slot = { ...run.slot, ...(slot ?? {}), run: run.id, status: ok ? 'done' : ['incomplete', 'cancelled', 'interrupted'].includes(terminal) ? terminal : 'failed', error: ok ? '' : error || run.slot.error || 'failed', current: '', startedAt: run.slot.startedAt }
    const open = lastOpen(run.spans, 'step')
    if (open) open.ms = Date.now() - open.start
    this.publish({ type: 'status', run: run.id, slot: run.slot })
    this.publish({ type: 'answer', run: run.id, agent: run.agent, text, ok })
    for (const approval of [...this.approvals.values()]) if (approval.run === run.id) this.answerApproval(approval.id, { approved: false, note: 'the run ended', by: 'system' })
    this.persist(run)
    run.finish(text)
    if (!run.parent && run.kind !== 'strategy') this.finishTask(run)
  }

  idle(thread) {
    thread.busy = false
    thread.run = null
    if (!thread.resident) return this.retire(thread)
    if (thread.stale) {
      thread.stale = false
      this.restart(thread, 'restarted with your edits')
      return
    }
    this.pump(thread)
  }

  queueToolEvent(runId, event, { retry = false } = {}) {
    if (this.runEvictions.has(runId)) return this.runEvictions.get(runId).then(() => this.queueToolEvent(runId, event, { retry }))
    if (this.evictedEvidence.has(runId)) return Promise.resolve()
    let state = this.toolEventWrites.get(runId)
    if (!state) { state = { tail: Promise.resolve(), pending: new Map(), failures: new Map() }; this.toolEventWrites.set(runId, state) }
    if (state.pending.has(event.sequence)) return state.pending.get(event.sequence)
    // Retrying an older immutable key does not depend on newer queued events.
    // Otherwise a captured export could wait for work beyond its own boundary.
    const job = (retry ? Promise.resolve() : state.tail).then(() => this.store.appendToolEvent(runId, event)).then(() => state.failures.delete(event.sequence), error => {
      state.failures.set(event.sequence, { event, error })
      this.publish({ type: 'persistence-error', run: runId, error: `Tool evidence ${event.sequence} could not be saved: ${error.message}` })
    })
    state.pending.set(event.sequence, job); if (!retry) state.tail = job
    job.then(() => state.pending.delete(event.sequence))
    return job
  }

  async flushToolEvents(runId, through) {
    if (this.runEvictions.has(runId)) await this.runEvictions.get(runId)
    if (this.evictedEvidence.has(runId)) return
    const state = this.toolEventWrites.get(runId)
    if (!state) return
    // Retry persistence only, never the tool. A failure stays available in memory
    // and keeps export from presenting an incomplete durable archive as complete.
    for (const [sequence, { event }] of state.failures) if (sequence <= through) this.queueToolEvent(runId, event, { retry: true })
    await Promise.all([...state.pending].filter(([sequence]) => sequence <= through).map(([, job]) => job))
    const failed = [...state.failures].find(([sequence]) => sequence <= through)
    if (failed) throw new Error(`Tool evidence ${runId}/${failed[0]} is not saved: ${failed[1].error.message}`)
  }

  async storedRun(record) {
    if (!record || record.toolEventStorage !== TOOL_EVENT_STORAGE) return evidenceView(record)
    const count = record.toolEventCount
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid tool evidence count for run ${record.id}`)
    const toolEvents = await this.store.readToolEvents(record.id)
    if (toolEvents.length !== count || toolEvents.some((event, index) => event.sequence !== index + 1)) throw new Error(`Stored tool evidence for run ${record.id} is incomplete; expected ${count} ordered events`)
    return evidenceView({ ...record, toolEvents })
  }

  async retainRuns() {
    const all = await this.store.all('runs')
    if (all.length <= KEEP_RUNS) return
    // Keep an entire strategy trace together; never retain a coordinator whose role evidence
    // was independently evicted, or remove finished siblings while another role is active.
    const groups = new Map()
    for (const record of all) { const key = record.trace || record.id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(record) }
    const terminal = record => ['done', 'failed', 'incomplete', 'cancelled', 'interrupted'].includes(record.slot?.status) && this.runs.get(record.id)?.ended !== false
    const candidates = [...groups.values()].filter(records => records.every(terminal)).sort((a, b) => Math.min(...a.map(row => row.at)) - Math.min(...b.map(row => row.at)))
    const old = []; let remaining = all.length
    for (const records of candidates) {
      if (remaining <= KEEP_RUNS || records.length === remaining) break
      old.push(...records); remaining -= records.length
    }
    for (const stale of old) {
      // Reserve synchronously: subsequent appends/metadata retries wait outside
      // this drain, then observe eviction or resume if deletion failed.
      let release
      this.runEvictions.set(stale.id, new Promise(resolve => { release = resolve }))
      try {
        await Promise.allSettled([...(this.toolEventWrites.get(stale.id)?.pending.values() ?? []), ...[...(this.runRecordWrites.get(stale.id) ?? [])].map(entry => entry.job)])
        await this.store.deleteRun(stale.id)
        this.evictedEvidence.add(stale.id); this.toolEventWrites.delete(stale.id); this.runRecordWrites.delete(stale.id)
      } finally { this.runEvictions.delete(stale.id); release() }
    }
  }

  runRecord(run) {
    return { ...this.describe(run), turns: run.turns, prompts: run.prompts, requests: run.requests ?? [], completions: run.completions ?? [], toolEventStorage: TOOL_EVENT_STORAGE, toolEventCount: run.toolEvents?.length ?? 0, spans: run.spans, log: run.log, result: run.result ?? '', todo: run.todo ?? [] }
  }

  writeRunRecord(record) {
    if (this.runEvictions.has(record.id)) return this.runEvictions.get(record.id).then(() => this.writeRunRecord(record))
    if (this.evictedEvidence.has(record.id)) return Promise.resolve()
    let pending = this.runRecordWrites.get(record.id)
    if (!pending) { pending = new Set(); this.runRecordWrites.set(record.id, pending) }
    // Dispatch before yielding: an eviction either reserves first or waits for
    // this already-started write. No delayed put can cross its deletion boundary.
    let job; try { job = Promise.resolve(this.store.put('runs', record)) } catch (error) { job = Promise.reject(error) }
    const entry = { count: record.toolEventCount, job }
    pending.add(entry)
    entry.job.then(() => pending.delete(entry), () => pending.delete(entry))
    return entry.job
  }

  async flushRunRecord(runId, through) {
    if (this.runEvictions.has(runId)) await this.runEvictions.get(runId)
    if (this.evictedEvidence.has(runId)) return
    await Promise.allSettled([...(this.runRecordWrites.get(runId) ?? [])].filter(entry => entry.count <= through).map(entry => entry.job))
    if (this.runEvictions.has(runId)) await this.runEvictions.get(runId)
    if (this.evictedEvidence.has(runId)) return
    let record = await this.store.get('runs', runId)
    if (this.runEvictions.has(runId)) await this.runEvictions.get(runId)
    if (this.evictedEvidence.has(runId)) return
    if (record?.toolEventStorage !== TOOL_EVENT_STORAGE || record.toolEventCount < through) {
      const live = this.runs.get(runId)
      if (live) {
        try { await this.writeRunRecord(this.runRecord(live)); if (this.evictedEvidence.has(runId)) return; record = await this.store.get('runs', runId) }
        catch (error) { this.publish({ type: 'persistence-error', run: runId, error: `Run evidence metadata could not be saved: ${error.message}` }); throw new Error(`Run evidence metadata is not saved: ${error.message}`) }
      }
    }
    if (this.runEvictions.has(runId)) await this.runEvictions.get(runId)
    if (this.evictedEvidence.has(runId)) return
    if (!record || record.toolEventStorage !== TOOL_EVENT_STORAGE || record.toolEventCount < through) throw new Error(`Run evidence metadata for ${runId} is incomplete; no partial export was produced`)
  }

  async persist(run) {
    if (this.evictedEvidence.has(run.id)) return
    const record = this.runRecord(run)
    try {
      await this.writeRunRecord(record)
      await this.flushToolEvents(run.id, record.toolEventCount)
      if (!run.ended) return
      this.retentionQueue = this.retentionQueue.catch(() => {}).then(() => this.retainRuns())
      await this.retentionQueue
    } catch (error) {
      this.publish({ type: 'persistence-error', run: run.id, error: `Run evidence could not be saved: ${error.message}` })
    }
  }

  describe(run) {
    return { id: run.id, trace: run.trace, taskId: run.taskId ?? run.id, resumedFrom: run.resumedFrom ?? null, resumeAttempt: run.resumeAttempt ?? 0, originalQuery: run.originalQuery ?? run.query, agent: run.agent, parent: run.parent, depth: run.depth, kind: run.kind, stageId: run.stageId ?? null, strategyDefinition: run.strategyDefinition ?? null, strategyDefinitionHash: run.strategyDefinitionHash ?? null, strategyState: run.strategyState ?? null, query: run.query, context: run.context, call: run.call, children: [...run.children], slot: run.slot, at: run.at }
  }

  // ─── what the page may send to a run ───────────────────────────────────────

  /** `invoke` (an agent), `nudge`, `abort`, `resume`. */
  send(target, message) {
    if (message.type === 'invoke') { const previous = this.runs.get(target); return this.startRun(previous?.agent ?? target, message.query, { context: previous?.context ?? null }).id }
    if (message.type === 'resume') return this.resume(target)
    const run = this.runs.get(target)
    if (!run) return null
    if (message.type === 'nudge') {
      if (run.thread?.run === run.id) run.thread.worker.postMessage({ type: 'nudge', text: String(message.text) })
      return run.id
    }
    if (message.type === 'abort') {
      this.abort(run)
      return run.id
    }
    return null
  }

  abort(run) {
    if (run.cancelStrategy && !run.ended) { run.cancelStrategy(); return }
    for (const child of run.children) {
      const below = this.runs.get(child)
      if (below && !below.ended) this.abort(below)
    }
    for (const approval of [...this.approvals.values()]) if (approval.run === run.id) this.answerApproval(approval.id, { approved: false, note: 'the run was stopped', by: 'system' })
    if (run.thread?.run === run.id) run.thread.worker.postMessage({ type: 'abort' })
    else if (!run.ended) this.end(run, '(cancelled: stopped by the owner)', false, 'stopped by the owner', { status: 'cancelled', terminationReason: 'cancelled' })
  }

  /** The number of active runs under a run, for "Abort this run and 2 below". */
  below(id) {
    const run = this.runs.get(id)
    if (!run) return 0
    return run.children.reduce((count, child) => {
      const below = this.runs.get(child)
      return count + (below && !below.ended ? 1 + this.below(child) : 0)
    }, 0)
  }

  async resume(id) {
    const record = this.runs.get(id) ?? (await this.store.get('runs', id))
    if (!record) return null
    if (record.kind === 'strategy') throw new Error('Start a new configured workflow; prior role actions are never replayed.')
    if (ACTIVE.has(record.slot?.status) || record.slot?.status === 'idle') throw new Error('Stop the active run before starting a new continuation.')
    // A continuation is an explicit new attempt. It does not restore processes, replay tools,
    // inherit verification, or overwrite the original evidence. Keep the summary bounded.
    const note = `The owner requested a new attempt continuing run ${record.id} (${record.slot?.status ?? 'unknown'}).\nOriginal task: ${record.originalQuery ?? record.query}\nPrior result (up to 4000 characters): ${String(record.result ?? '').slice(0, 4000)}\nThe saved plan is carried forward as prior work state, not proof of completion. Inspect the current workspace and prior evidence before deciding what remains. No previous process or tool call has been restarted. Do not repeat completed side effects without checking them.`
    return this.startRun(record.agent, note, { context: record.context ?? null, resume: { ...record, taskId: record.taskId ?? record.id } }).id
  }

  // ─── requests from threads ─────────────────────────────────────────────────

  async handle(thread, run, { id, op, args }) {
    try {
      const handler = this.externalOps[op] ?? this.ops[op]
      if (!handler) throw new Error(`unknown request "${op}"`)
      const value = await handler.call(this, args ?? {}, run, thread)
      thread.worker.postMessage({ type: 'reply', id, ok: true, value })
    } catch (error) {
      thread.worker.postMessage({ type: 'reply', id, ok: false, error: String(error?.message ?? error) })
    }
  }

  ops = {
    async call({ agent, query, call, infrastructure }, run) {
      if (!run) throw new Error('no run is active on this thread')
      const toolPolicy = normalizeToolPolicy(run.context?.toolPolicy)
      const internalCompaction = infrastructure === 'compaction' && agent === 'compactor' && call === 'compactor(history)'
      if (toolPolicy?.allowDelegation === false && !internalCompaction) throw new Error('delegation is disabled for this run')
      if (run.depth + 1 > LIMITS.depth) throw new Error(`calls may nest ${LIMITS.depth} deep; ${agent} would be deeper`)
      for (let up = run; up; up = up.parent ? this.runs.get(up.parent) : null) {
        if (up.agent === agent) throw new Error(`${agent} is already working on this chain; calling it again would loop`)
      }
      const active = run.children.filter((child) => !this.runs.get(child)?.ended).length
      if (active >= LIMITS.outstanding) throw new Error(`${run.agent} already has ${active} agents working; wait for one to answer`)
      const kind = agent === 'compactor' ? 'compact' : run.kind === 'dream' ? 'dream' : 'task'
      const child = this.startRun(agent, query, { parent: run.id, call: call ?? `${agent}(…)`, kind })
      const answer = await child.answer
      // Terminal text is also returned for failed and incomplete runs. It is evidence for
      // ordinary callers, but must never replace conversation history as a valid summary.
      if (kind === 'compact' && child.slot.status !== 'done') throw new Error(`Compactor ${child.id} ended with ${child.slot.status}; no summary was accepted.`)
      return answer
    },

    'board.post'({ kind, text }, run) {
      const board = this.boardFor(run)
      const entry = { id: board.next++, kind: ['plan', 'question', 'finding', 'note'].includes(kind) ? kind : 'note', text: String(text), author: run.agent, rev: 1, resolved: false, at: Date.now() }
      board.entries.push(entry)
      this.publish({ type: 'board', trace: run.trace, entries: board.entries, released: false })
      return entry
    },
    'board.list'(_, run) {
      return run ? this.boardFor(run).entries : []
    },
    'board.resolve'({ id, note }, run) {
      const board = this.boardFor(run)
      const entry = board.entries.find((item) => item.id === id)
      if (!entry) throw new Error(`no board entry #${id}`)
      entry.resolved = true
      entry.rev += 1
      if (note) entry.text += ` — resolved: ${note}`
      this.publish({ type: 'board', trace: run.trace, entries: board.entries, released: false })
      return entry
    },
    'board.tell'({ agent, text }, run) {
      const target = [...this.runs.values()].find((other) => other.trace === run.trace && other.agent === agent && !other.ended && other.thread?.run === other.id)
      if (!target) return { delivered: false }
      target.thread.worker.postMessage({ type: 'nudge', text: `(from ${run.agent}) ${text}` })
      return { delivered: true }
    },

    async 'memory.save'({ text, scope }, run) {
      const entry = { agent: scope === 'shared' ? 'shared' : run.agent, text: String(text).trim(), source: run.kind === 'dream' ? 'dream' : run.id, at: Date.now() }
      entry.id = await this.store.put('memory', entry)
      this.publish({ type: 'memory' })
      return entry
    },
    async 'memory.list'(_, run) {
      const all = await this.store.all('memory')
      return all.filter((entry) => entry.agent === 'shared' || entry.agent === run?.agent).sort((a, b) => b.at - a.at)
    },
    async 'memory.search'({ query }, run) {
      const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      const all = await this.ops['memory.list'].call(this, {}, run)
      return all.filter((entry) => words.every((word) => entry.text.toLowerCase().includes(word)))
    },
    async 'memory.forget'({ id }) {
      await this.store.delete('memory', id)
      this.publish({ type: 'memory' })
      return true
    },

    async 'files.list'({ prefix = '' }) {
      return (await this.store.all('files')).filter((file) => file.path.startsWith(prefix)).map((file) => ({ path: file.path, rev: file.rev, size: file.content.length }))
    },
    async 'files.read'({ path }) {
      return (await this.store.get('files', clean(path))) ?? null
    },
    async 'files.write'({ path, content, expect }) {
      const key = clean(path)
      const result = await this.store.update('files', key, (current) => {
        const rev = current?.rev ?? 0
        if (expect != null && expect !== '' && Number(expect) !== rev) return { conflict: true, rev }
        return { value: { path: key, content, rev: rev + 1, at: Date.now() }, rev: rev + 1 }
      })
      this.publish({ type: 'files' })
      return { conflict: Boolean(result.conflict), rev: result.rev }
    },

    async 'skill.list'() {
      const load = loader(this.base, this.index, this.fetch)
      const published = await Promise.all(
        Object.entries(skillFiles(this.index)).map(async ([name, file]) => {
          const { settings } = read(await load(file))
          return { name: settings.name ?? name, description: settings.description ?? '', source: 'published' }
        }),
      )
      const names = new Set(published.map((skill) => skill.name))
      const saved = (await this.savedSkills()).filter((skill) => !names.has(skill.name))
      return [...published, ...saved.map((skill) => ({ name: skill.name, description: `${skill.description} (saved by ${skill.by})`, source: 'saved' }))]
    },
    async 'skill.load'({ name }) {
      const file = skillFiles(this.index)[name]
      if (file) return { name, body: read(await loader(this.base, this.index, this.fetch)(file)).body }
      const saved = (await this.savedSkills()).find((skill) => skill.name === name)
      return saved ? { name, body: saved.body } : null
    },
    /** A skill an agent wrote. It lives in the page's files under skills/, never over a published one. */
    async 'skill.save'({ name, description = '', body = '' }, run) {
      const slug = String(name ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      if (!slug) throw new Error('a skill needs a name')
      if (skillFiles(this.index)[slug]) throw new Error(`"${slug}" is a published skill in skills/; choose another name`)
      if (!String(body).trim()) throw new Error('a skill needs a body: the steps')
      const text = `---\nname: ${slug}\ndescription: ${String(description).replace(/\n/g, ' ')}\nby: ${run?.agent ?? 'owner'}\n---\n\n${String(body).trim()}\n`
      const result = await this.ops['files.write'].call(this, { path: `skills/${slug}.md`, content: text })
      this.publish({ type: 'skills' })
      return { name: slug, rev: result.rev }
    },

    async 'sessions.search'({ query, agent, limit = 5 }, run) {
      const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      if (!words.length) return []
      const seen = new Map()
      for (const record of await this.store.all('runs')) seen.set(record.id, record)
      for (const live of this.runs.values()) if (live.ended) seen.set(live.id, { ...this.describe(live), turns: live.turns, result: live.result ?? '' })
      const hits = []
      for (const record of seen.values()) {
        if (record.id === run?.id || record.trace === run?.trace) continue
        if (agent && record.agent !== agent) continue
        const parts = [record.query, record.result, ...(record.turns ?? []).map((turn) => turn.content)].map((part) => String(part ?? ''))
        const all = parts.join('\n').toLowerCase()
        if (!words.every((word) => all.includes(word))) continue
        // The snippet shows where most of the words meet, preferring what was said over what was asked.
        const score = (part) => words.filter((word) => part.toLowerCase().includes(word)).length
        const where = [...parts.slice(1), parts[0]].reduce((best, part) => (score(part) > score(best) ? part : best), '')
        const first = words.find((word) => where.toLowerCase().includes(word)) ?? ''
        const at = Math.max(where.toLowerCase().indexOf(first) - 80, 0)
        hits.push({ id: record.id, agent: record.agent, at: record.at, when: new Date(record.at).toISOString().slice(0, 16).replace('T', ' '), query: String(record.query).slice(0, 160), snippet: `${at ? '…' : ''}${where.slice(at, at + 240).replace(/\s+/g, ' ')}` })
      }
      return hits.sort((a, b) => b.at - a.at).slice(0, Math.min(Number(limit) || 5, 20))
    },
    async 'sessions.read'({ id }) {
      const live = this.runs.get(id)
      const record = live?.ended ? { ...this.describe(live), turns: live.turns, result: live.result } : await this.store.get('runs', String(id))
      if (!record) return null
      const steps = (record.turns ?? []).map((turn) => `### ${turn.role}\n${String(turn.content).slice(0, 2000)}`)
      return `run ${record.id} · ${record.agent} · ${new Date(record.at).toISOString()}\n\n## asked\n${record.query}\n\n${steps.join('\n\n')}\n\n## answer\n${record.result ?? ''}`.slice(0, 16000)
    },

    async 'mcp.call'({ server, tool, args }) {
      const found = this.mcpServers.get(server)
      if (!found || found.status !== 'answering') throw new Error(`MCP server "${server}" is not connected`)
      return found.client.call(tool, args ?? {})
    },

    'todo.set'({ items }, run) {
      if (!run) throw new Error('no run is active on this thread')
      const STATUSES = ['todo', 'doing', 'done', 'dropped']
      run.todo = items
        .map((item) => (typeof item === 'string' ? { text: item, status: 'todo' } : item))
        .filter((item) => item && String(item.text ?? '').trim())
        .slice(0, 50)
        .map((item) => ({ text: String(item.text).trim(), status: STATUSES.includes(item.status) ? item.status : 'todo' }))
      this.publish({ type: 'todo', run: run.id, items: run.todo })
      this.persist(run)
      return run.todo
    },
    'todo.get'(_, run) {
      return run?.todo ?? []
    },

    async 'schedule.add'({ agent, query, every_minutes, in_minutes }, run) {
      return this.schedules.add({ agent, query, every: every_minutes, in: in_minutes, by: run?.agent ?? 'owner' })
    },
    'schedule.list'() {
      return this.schedules.list()
    },
    'schedule.cancel'({ id }) {
      return this.schedules.cancel(id)
    },

    host({ endpoint, body }) {
      // Recheck at dispatch: a paired endpoint can revoke a grant while its worker
      // is busy and waiting to rebuild. Model relay alone never authorizes web tools.
      const requirements = endpoint === '/fetch' ? ['host:fetch']
        : endpoint === '/exec' ? ['host:legacy-bridge', 'host:exec']
          : endpoint === '/run' ? ['host:legacy-bridge', 'host:cli']
            : ['/fs/list', '/fs/read', '/fs/write'].includes(endpoint) ? ['host:legacy-bridge', 'host:fs'] : null
      if (!requirements) throw new Error(`unsupported host tool endpoint: ${endpoint}`)
      const missing = requirements.filter(need => !hasToolRequirement(need, this.hostInfo()))
      if (missing.length) throw new Error(`host tool unavailable: requires ${missing.join(', ')}`)
      return this.bridgeCall(endpoint, body)
    },

    approve({ tool, call, callId, risk, reason, args }, run) {
      const approval = { id: this.nextApproval++, run: run?.id, agent: run?.agent ?? '?', trace: run?.trace, tool, call, callId, risk, reason, args, at: Date.now() }
      return new Promise((settle) => {
        approval.settle = settle
        this.approvals.set(approval.id, approval)
        this.publish({ type: 'approval', approval: publicApproval(approval) })
      })
    },

    async 'dream.propose'({ agent, text, why }, run) {
      if (!this.specs.has(agent)) throw new Error(`no agent at agents/${agent}; propose for one of: ${[...this.specs.keys()].join(', ')}`)
      const root = run ? this.rootOf(run) : null
      const proposal = { agent, text: String(text).trim(), why: String(why ?? ''), trace: root?.reviewing ?? root?.trace ?? '', dream: root?.id ?? '', status: 'pending', at: Date.now() }
      proposal.id = await this.store.put('dreams', proposal)
      this.publish({ type: 'dreams' })
      return { id: proposal.id }
    },
  }

  // ─── MCP servers: the owner's, plus each one the paired bridge runs ─────────

  /** Every server the owner configured, and every stdio server the bridge runs for them. */
  mcpConfigured() {
    const out = Object.entries(this.saved.mcp ?? {}).map(([name, server]) => ({ name, url: server.url, headers: server.headers ?? {}, from: 'settings' }))
    const bridge = this.bridgeState
    if (bridge.status === 'answering') {
      for (const name of bridge.health?.mcp ?? []) {
        if (out.some((server) => server.name === name)) continue
        out.push({ name, url: `${bridge.url}/mcp/${encodeURIComponent(name)}`, headers: { authorization: `Bearer ${bridge.token}` }, from: 'bridge' })
      }
    }
    return out.filter((server) => /^[A-Za-z0-9_-]+$/.test(server.name) && server.url)
  }

  /** List each server's tools. Threads granting `mcp` restart when what they would see changed. */
  async mcpRefresh({ restart = true } = {}) {
    const sequence = ++this.mcpRefreshSequence
    const bridgeGeneration = this.bridgeState.generation
    const before = JSON.stringify(this.mcpTools())
    const next = new Map()
    await Promise.all(
      this.mcpConfigured().map(async (server) => {
        const client = mcp({ url: server.url, headers: server.headers }, { fetch: this.fetch })
        const row = { ...server, client, status: 'answering', tools: [], error: '', at: Date.now() }
        try {
          row.tools = (await client.tools()).map((tool) => describeTool(server.name, tool))
        } catch (error) {
          row.status = 'down'
          row.error = String(error.message ?? error)
        }
        next.set(server.name, row)
      }),
    )
    // Discovery may outlive a pairing change or shutdown. Never restore old clients.
    if (this.disposed || sequence !== this.mcpRefreshSequence || bridgeGeneration !== this.bridgeState.generation) return this.mcp.list()
    this.mcpServers = next
    this.publish({ type: 'mcp', servers: this.mcp.list() })
    if (restart && JSON.stringify(this.mcpTools()) !== before) this.hostChanged('MCP tools changed')
    return this.mcp.list()
  }

  mcpTools() {
    return [...this.mcpServers.values()].filter((server) => server.status === 'answering').map((server) => ({ name: server.name, tools: server.tools }))
  }

  mcp = {
    list: () => [...this.mcpServers.values()].map(({ client, headers, ...row }) => ({ ...row, tools: row.tools.map((tool) => ({ name: tool.name, risk: tool.risk, description: tool.description })) })),
    /** Replace the owner's servers: {name: {url, headers?}}. */
    set: async (servers) => {
      this.saved.mcp = servers ?? {}
      await this.store.put('settings', { key: 'mcp', value: this.saved.mcp })
      return this.mcpRefresh()
    },
    configured: () => ({ ...(this.saved.mcp ?? {}) }),
    refresh: () => this.mcpRefresh(),
  }

  async savedSkills() {
    const files = (await this.store.all('files')).filter((file) => /^skills\/[^/]+\.md$/.test(file.path))
    return files.map((file) => {
      const { settings, body } = read(file.content)
      return { name: settings.name ?? file.path.slice(7, -3), description: settings.description ?? '', by: settings.by ?? 'an agent', body, path: file.path, rev: file.rev }
    })
  }

  // ─── schedules: tasks that start themselves while a tab is open ─────────────

  /** Start every schedule that is due. One that fell due while no tab was open runs once now. */
  tick(now = Date.now()) {
    if (!this.started || this.lockState === 'follower') return
    let changed = false
    for (const item of this.scheduled.items) {
      if (item.next > now || item.running) continue
      if (!this.specs.has(item.agent)) {
        item.last = { status: 'failed', at: now, error: `no agent at agents/${item.agent}` }
        item.next = item.every ? now + item.every * 60000 : Infinity
        changed = true
        continue
      }
      const run = this.startRun(item.agent, item.query, { kind: 'scheduled' })
      item.running = run.id
      item.last = { run: run.id, status: 'running', at: now }
      item.next = item.every ? now + item.every * 60000 : Infinity
      changed = true
      run.answer.then(() => {
        item.running = null
        item.last = { run: run.id, status: run.slot.status, at: Date.now() }
        if (!item.every) this.scheduled.items = this.scheduled.items.filter((other) => other !== item)
        this.saveSchedules()
      })
    }
    if (changed) this.saveSchedules()
  }

  saveSchedules() {
    const value = { ...this.scheduled, items: this.scheduled.items.map(({ running, ...item }) => ({ ...item, next: Number.isFinite(item.next) ? item.next : null })) }
    this.publish({ type: 'schedules', items: this.schedules.list() })
    return this.store.put('settings', { key: 'schedules', value }).catch(() => {})
  }

  schedules = {
    list: () => this.scheduled.items.map(({ running, ...item }) => ({ ...item, running: Boolean(running) })),
    add: ({ agent, query, every, in: later, by = 'owner' }) => {
      if (!this.specs.has(agent)) throw new Error(`no agent at agents/${agent}; schedule one of: ${[...this.specs.keys()].join(', ')}`)
      if (!String(query ?? '').trim()) throw new Error('a schedule needs a query: what the agent should do')
      const minutes = every != null && every !== '' ? Number(every) : null
      if (minutes != null && !(minutes >= 1)) throw new Error('every_minutes must be at least 1')
      const delay = later != null && later !== '' ? Math.max(Number(later) || 0, 0) : (minutes ?? 0)
      const item = { id: this.scheduled.next++, agent, query: String(query).trim(), every: minutes, next: Date.now() + delay * 60000, by, at: Date.now(), last: null }
      this.scheduled.items.push(item)
      this.saveSchedules()
      return item
    },
    cancel: (id) => {
      const before = this.scheduled.items.length
      this.scheduled.items = this.scheduled.items.filter((item) => item.id !== Number(id))
      if (this.scheduled.items.length === before) return false
      this.saveSchedules()
      return true
    },
  }

  rootOf(run) {
    let up = run
    while (up?.parent) up = this.runs.get(up.parent)
    return up
  }

  boardFor(run) {
    if (!this.boards.has(run.trace)) this.boards.set(run.trace, { entries: [], next: 1, released: false })
    return this.boards.get(run.trace)
  }

  board(trace) {
    return this.boards.get(trace) ?? { entries: [], released: false }
  }

  // ─── the end of a task: board released, dreaming scheduled ──────────────────

  finishTask(run) {
    const board = this.boards.get(run.trace)
    if (board) {
      board.released = true
      this.publish({ type: 'board', trace: run.trace, entries: board.entries, released: true })
    }
    if (run.kind === 'task' && this.saved.dreaming && this.specs.has('dreamer')) {
      clearTimeout(this.dreamTimer)
      this.dreamTimer = setTimeout(() => this.dream(run.trace), DREAM_AFTER)
    }
  }

  /** Review a finished task: save what stays true, propose prompt changes for the owner. */
  async dream(trace) {
    if ([...this.runs.values()].some((run) => !run.ended)) return null
    const runs = [...this.runs.values()].filter((run) => run.trace === trace)
    if (!runs.length) return null
    const learned = await this.store.all('learned')
    const lines = runs.map((run) => {
      const calls = run.spans.filter((span) => span.kind === 'call')
      const failed = calls.filter((span) => span.ok === false).map((span) => span.name)
      return [
        `## ${run.agent} (${run.slot.status}, ${run.slot.steps} steps, ${Math.round(run.slot.seconds)}s, repeated calls ${run.slot.repeats})`,
        `task: ${run.query.slice(0, 600)}`,
        `calls: ${calls.map((span) => span.name).join(' | ').slice(0, 1500) || 'none'}`,
        failed.length ? `failed calls: ${failed.join(' | ').slice(0, 800)}` : '',
        run.slot.error ? `error: ${run.slot.error}` : '',
        `answer: ${String(run.result ?? '').slice(0, 800)}`,
      ]
        .filter(Boolean)
        .join('\n')
    })
    const already = learned.map((row) => `- ${row.agent}: ${row.text.replace(/\n/g, ' ').slice(0, 400)}`).join('\n') || '(nothing yet)'
    const agents = [...this.specs.keys()].filter((path) => !['dreamer', 'compactor'].includes(path)).join(', ')
    const query = `A task just finished. Review it.\n\nAgents you may propose for: ${agents}\n\n${lines.join('\n\n')}\n\n## Already learned\n\n${already}`
    const dreaming = this.startRun('dreamer', query, { kind: 'dream' })
    dreaming.reviewing = trace
    this.lastDream = { run: dreaming.id, trace, at: Date.now() }
    this.publish({ type: 'dreams' })
    return dreaming.id
  }

  // ─── approvals ─────────────────────────────────────────────────────────────

  answerApproval(id, { approved, note = '', always = false, by = 'owner' }) {
    const approval = this.approvals.get(id)
    if (!approval) return false
    this.approvals.delete(id)
    if (approved && always) {
      const policy = structuredClone(this.saved.policy)
      policy.rules = policy.rules ?? {}
      policy.rules[approval.agent] = { ...(policy.rules[approval.agent] ?? {}), [approval.tool]: 'allow' }
      this.setSettings({ policy })
    }
    approval.settle({ approved: Boolean(approved), note, by })
    this.publish({ type: 'approved', id, run: approval.run, approved: Boolean(approved), note, by })
    return true
  }

  // ─── the host bridge ───────────────────────────────────────────────────────

  async bridgeCall(endpoint, body) {
    const bridge = this.bridgeState
    if (bridge.status !== 'answering') throw new Error('the host bridge is not paired or not answering')
    let response
    try {
      response = await this.fetch(`${bridge.url}${endpoint}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
    } catch (error) {
      this.setBridge('down', error.message)
      throw new Error(`the host bridge did not answer: ${error.message}`)
    }
    if ((response.headers.get('content-type') ?? '').includes('ndjson')) return collectRun(await response.text())
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error ?? `the host bridge answered ${response.status}`)
    return data
  }

  async bridgeCheck(url, token, options = {}) {
    const base = String(url).trim().replace(/\/+$/, '')
    const sequence = ++this.bridgeCheckSequence
    const previous = this.bridgeState
    const was = previous.status
    try {
      if (this.disposed) throw new InferenceError('The agent desk stopped before companion pairing completed.', 'aborted')
      const health = await boundedModelCheck(async signal => {
        const response = await this.fetch(`${base}/health`, { signal })
        if (!response.ok) throw new InferenceError(`The companion health check answered HTTP ${response.status}.`, 'relay_unavailable')
        const health = await response.json()
        const check = await this.fetch(`${base}/whoami`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal })
        if (check.status === 401) throw new InferenceError('The companion refused the pairing token.', 'relay_auth')
        if (check.status === 403) throw new InferenceError('The companion refused this page’s origin; configure its exact allowed origin.', 'relay_origin')
        if (!check.ok) throw new InferenceError(`The companion answered HTTP ${check.status}.`, 'relay_unavailable')
        const authenticated = await check.json()
        const capabilities = authenticated.capabilities ?? health.capabilities
        if (!Array.isArray(capabilities) || capabilities.some(item => typeof item !== 'string')) throw new InferenceError('The companion returned invalid capability information.', 'relay_capability')
        const verified = { ...health, root: authenticated.root ?? health.root, capabilities, ...(authenticated.runtimeId ? { runtimeId: authenticated.runtimeId } : {}) }
        if (options.requireModelRelay) assertModelRelay(verified)
        return verified
      }, options)
      if (this.disposed) throw new InferenceError('The agent desk stopped before companion pairing completed.', 'aborted')
      if (sequence !== this.bridgeCheckSequence) throw new InferenceError('A newer companion connection check replaced this result.', 'configuration')
      const changed = was !== 'answering' || previous.url !== base || previous.token !== token || bridgeIdentity(previous.health) !== bridgeIdentity(health)
      this.bridgeState = { url: base, token, health, generation: (previous.generation ?? 0) + Number(changed), status: 'answering', since: was === 'answering' ? previous.since : Date.now(), error: '', errorCode: '' }
      if (changed) {
        this.bridgeToolsChanged(was === 'answering' ? 'the bridge identity or capabilities changed' : 'the bridge is answering')
      }
    } catch (error) {
      if (error instanceof TypeError) error = new InferenceError('The browser could not read the HTTPS companion. Check its running state, trusted certificate and allowed page origin; this does not establish whether the model is online.', 'browser_unreadable')
      const failed = modelFailure(error, {}, { token })
      // A failed candidate must never replace an already paired, authorized service.
      if (this.disposed || options.requireModelRelay || sequence !== this.bridgeCheckSequence) return { url: base, status: 'down', since: Date.now(), capabilities: [], root: '', ...failed }
      const changed = was !== 'down' || previous.url !== base || previous.token !== token
      this.bridgeState = { ...previous, url: base, token, generation: (previous.generation ?? 0) + Number(changed), status: 'down', since: was === 'down' ? previous.since : Date.now(), error: failed.error, errorCode: failed.errorCode }
      if (was === 'answering') {
        this.bridgeToolsChanged('the bridge stopped answering')
      }
    }
    this.publish({ type: 'bridge', state: this.bridge.state() })
    return this.bridge.state()
  }

  setBridge(status, error = '') {
    if (this.bridgeState.status === status) return
    this.bridgeState = { ...this.bridgeState, generation: (this.bridgeState.generation ?? 0) + 1, status, since: Date.now(), error }
    this.bridgeToolsChanged(status === 'down' ? 'the bridge stopped answering' : 'host changed')
    this.publish({ type: 'bridge', state: this.bridge.state() })
  }

  /** Host tools are decided when a thread builds, so resident threads restart when idle. */
  hostChanged(why) {
    if (!this.started || this.disposed) return
    for (const thread of [...this.threads.values()]) {
      if (thread.busy) thread.stale = true
      else this.restart(thread, why)
    }
    // An agent with no resident thread is known by its last probe; probe again the ones whose
    // tools hang on the bridge or on MCP, so Team shows what they would get now.
    for (const spec of this.specs.values()) {
      if (this.isResident(spec) || !spec.grants.some((grant) => HOSTED.has(grant))) continue
      this.probe(spec.path).catch(() => {})
    }
  }

  bridgeToolsChanged(why) {
    // Revoke old bridge clients immediately. Optional discovery cannot delay pairing,
    // cancellation or disconnect; mcpRefresh guards its eventual publication.
    for (const [name, server] of this.mcpServers) if (server.from === 'bridge') this.mcpServers.delete(name)
    this.hostChanged(why)
    if (!this.disposed) this.mcpRefresh().catch(() => {})
  }

  bridgeSettingsWrite(work) {
    const pending = this.bridgeSettingsWrites.catch(() => {}).then(work)
    this.bridgeSettingsWrites = pending
    return pending
  }

  bridgePairFailure(state, token, signal) {
    let error
    if (this.disposed || signal?.aborted) error = new InferenceError('The agent desk stopped or companion pairing was cancelled before its save completed.', 'aborted')
    else if (this.bridgeState.status !== 'answering' || state.generation !== this.bridgeState.generation || state.url !== this.bridgeState.url || token !== this.bridgeState.token) error = new InferenceError('The companion connection changed before pairing could be saved.', 'configuration')
    return error ? { ...state, status: 'down', capabilities: [], ...modelFailure(error) } : null
  }

  bridge = {
    state: () => {
      const { url, status, since, health, error, errorCode, generation } = this.bridgeState
      return { url, status, since, generation: generation ?? 0, runtimeId: health?.runtimeId ?? '', root: health?.root ?? '', capabilities: health?.capabilities ?? [], version: health?.version ?? '', error: error ?? '', errorCode: errorCode ?? '' }
    },
    pair: async (url, token, options = {}) => {
      const state = await this.bridgeCheck(url, token, options)
      if (state.status === 'answering') {
        return this.bridgeSettingsWrite(async () => {
          const before = this.bridgePairFailure(state, token, options.signal)
          if (before) return before
          await this.store.put('settings', { key: 'bridge', value: { url: state.url, token } })
          const after = this.bridgePairFailure(state, token, options.signal)
          if (after) {
            // Still inside the ordered write: cleanup cannot erase a newer pairing.
            await this.store.delete('settings', 'bridge')
            return after
          }
          return state
        })
      }
      return state
    },
    check: () => (this.bridgeState.url ? this.bridgeCheck(this.bridgeState.url, this.bridgeState.token) : this.bridge.state()),
    disconnect: async () => {
      const was = this.bridgeState.status
      this.bridgeCheckSequence++
      this.bridgeState = { status: 'unpaired', generation: (this.bridgeState.generation ?? 0) + 1, since: Date.now(), url: '', token: '', health: null, error: '' }
      const cleared = this.bridgeSettingsWrite(() => this.store.delete('settings', 'bridge'))
      if (was === 'answering') this.bridgeToolsChanged('the bridge was disconnected')
      this.publish({ type: 'bridge', state: this.bridge.state() })
      await cleared
    },
  }

  // ─── reading for the page ──────────────────────────────────────────────────

  roster() {
    return new Map([...this.runs.values()].map((run) => [run.id, run.slot]))
  }

  history(id) {
    return this.runs.get(id)?.turns ?? []
  }

  run(id) {
    const run = this.runs.get(id)
    return run ? evidenceView({ ...this.describe(run), turns: run.turns, prompts: run.prompts, requests: run.requests ?? [], completions: run.completions ?? [], toolEvents: run.toolEvents ?? [], spans: run.spans, log: run.log, result: run.result ?? '', todo: run.todo ?? [] }) : null
  }

  runsApi = {
    get: async (id) => this.run(id) ?? await this.storedRun(await this.store.get('runs', id)) ?? null,
    list: async () => {
      const byId = new Map((await this.store.all('runs')).map((record) => [record.id, record]))
      for (const run of this.runs.values()) byId.set(run.id, this.run(run.id))
      return Promise.all([...byId.values()].sort((a, b) => b.at - a.at).map(record => this.runs.has(record.id) ? record : this.storedRun(record)))
    },
  }

  async session(agent = 'main') {
    return (await this.store.get('sessions', agent))?.turns ?? []
  }

  async clearSession(agent = 'main') {
    await this.store.delete('sessions', agent)
    const thread = this.threads.get(agent)
    if (thread && !thread.busy) await this.restart(thread, 'the conversation was cleared')
  }

  manifest({ toolPolicy: requestedPolicy } = {}) {
    const toolPolicy = normalizeToolPolicy(requestedPolicy)
    const catalogue = this.catalogue()
    const rows = [...this.specs.values()].map((spec) => {
      const info = this.readyInfo.get(spec.path) ?? {}
      const model = resolve(spec.inference, catalogue)
      const policy = withAgentRules(this.saved.policy ?? DEFAULT_POLICY, spec.path, spec.permissions)
      const describe = item => {
        const verdict = scopedToolDecision(item, {}, { policy, agent: spec.path, toolPolicy })
        const missing = (item.requires ?? []).filter(need => !hasToolRequirement(need, this.hostInfo()))
        // Old unavailable entries cannot become available until a fresh worker has
        // actually loaded them; revoked requirements take effect immediately.
        return { ...item, missing, available: item.available !== false && missing.length === 0, effectiveAction: verdict.action, actionReason: verdict.reason, selected: toolSelected(item, toolPolicy) }
      }
      return {
        path: spec.path,
        name: spec.name,
        description: spec.description,
        model: model.model ?? '',
        alias: model.alias,
        pinned: Boolean(spec.inference.model),
        resident: this.isResident(spec),
        peers: spec.peers,
        owned: spec.owned,
        grants: spec.grants,
        context: spec.context,
        composition: {
          loop: 'react',
          responseFormat: spec.engine.responseFormat ?? 'toon',
          observationFormat: spec.engine.observationFormat ?? 'legacy',
          contractVersion: spec.engine.contractVersion,
          maxSteps: spec.engine.maxSteps ?? 10,
          repairs: spec.engine.repairs ?? 2,
          compactAt: spec.engine.compactAt ?? 0.9,
          keep: spec.engine.keep ?? 4,
          requireVerification: Boolean(spec.engine.requireVerification),
          context: snapshot(spec.context ?? []),
          // readSpec resolves the published template; no source path survives that load.
          promptTemplate: spec.engine.promptTemplate ? snapshot(spec.engine.promptTemplate) : null,
          instructions: spec.body,
          soul: spec.soul,
        },
        permissions: spec.permissions,
        soulFrom: spec.soulFrom,
        files: Object.keys(this.index.files).filter((file) => file.startsWith(`agents/${spec.path}/`) && !file.slice(`agents/${spec.path}/`.length).includes('/')),
        tools: (info.tools ?? []).map(describe),
        shadowed: info.shadowed ?? [],
        unavailable: (info.unavailable ?? []).map(describe),
        notes: [...new Set([...(spec.notes ?? []), ...(info.notes ?? [])])],
        error: info.error ?? '',
        changed: this.changed.get(spec.path) ?? [],
        stale: [...this.threads.values()].some((thread) => thread.path === spec.path && thread.stale),
      }
    })
    const broken = [...this.failed.entries()].map(([path, error]) => ({ path, name: path, broken: true, error, notes: [], tools: [], changed: [] }))
    return [...broken, ...rows]
  }

  /** Re-read the folders; restart only changed, idle resident threads. */
  async reloadAgents() {
    const before = this.index
    const oldSpecs = new Map(this.specs)
    await this.readFolders()
    const result = { build: this.index.build ?? '', changed: [], added: [], removed: [], failed: [...this.failed.entries()].map(([path, error]) => ({ path, error })), stale: [], at: Date.now() }
    this.changed.clear()
    for (const path of this.specs.keys()) {
      if (!oldSpecs.has(path)) {
        result.added.push(path)
        continue
      }
      if (agentHash(before, path) === agentHash(this.index, path)) continue
      const prefix = `agents/${path}/`
      const files = [...new Set([...Object.keys(before.files), ...Object.keys(this.index.files)])]
        .filter((file) => (file.startsWith(prefix) && !file.slice(prefix.length).includes('/')) || file === 'agents/soul.md')
        .filter((file) => before.files[file] !== this.index.files[file])
        .map((file) => (file === 'agents/soul.md' ? 'agents/soul.md' : file.slice(prefix.length)))
      result.changed.push({ path, files })
      this.changed.set(path, files)
    }
    for (const path of oldSpecs.keys()) if (!this.specs.has(path)) result.removed.push(path)
    if (before.files['models.json'] !== this.index.files['models.json']) this.broadcastSettings()

    const touched = new Set([...result.changed.map((change) => change.path), ...result.added])
    for (const thread of [...this.threads.values()]) {
      if (result.removed.includes(thread.path)) {
        if (!thread.busy) this.retire(thread)
        continue
      }
      if (!touched.has(thread.path)) continue
      thread.spec = this.specs.get(thread.path)
      if (thread.busy) {
        thread.stale = true
        result.stale.push(thread.path)
      } else await this.restart(thread, 'restarted with your edits')
    }
    await Promise.all(
      [...touched].map((path) => {
        const spec = this.specs.get(path)
        if (!spec) return null
        if (this.isResident(spec)) return this.threads.has(path) ? null : this.thread(path)
        return this.probe(path)
      }),
    )
    this.lastReload = result
    this.publish({ type: 'reloaded', result })
    return result
  }

  // ─── settings, models, approvals, memory, dreams, learned, traces, data ────

  settings = {
    get: () => ({ catalogue: this.catalogue(), saved: this.saved.catalogue, file: this.fileCatalogue, policy: this.saved.policy, dreaming: this.saved.dreaming, durable: this.store?.durable ?? false }),
    set: (patch) => this.setSettings(patch),
  }

  async setSettings(patch) {
    for (const key of ['catalogue', 'policy', 'dreaming']) {
      if (!(key in patch)) continue
      this.saved[key] = patch[key]
      await this.store.put('settings', { key, value: patch[key] })
    }
    this.broadcastSettings()
    this.publish({ type: 'settings', settings: this.settings.get() })
  }

  broadcastSettings() {
    for (const thread of this.allThreads) {
      thread.worker.postMessage({ type: 'settings', catalogue: this.catalogue(), policy: withAgentRules(this.saved.policy, thread.path, thread.spec.permissions) })
    }
  }

  modelConnection(alias) {
    const settings = resolve(alias ? { model: alias } : {}, this.catalogue())
    const selected = this.bridgeState
    const generation = selected.generation ?? 0
    const bridge = selected.status === 'answering' ? (url, init) => {
      if ((this.bridgeState.generation ?? 0) !== generation) throw new InferenceError('The companion connection changed during this check.', 'configuration')
      return this.bridgeFetch(url, init)
    } : null
    return { settings, selected, options: { fetch: this.fetch, bridge, bridgeURL: selected.url, pageURL: globalThis.location?.href ?? this.base, run: selected.status === 'answering' && selected.health?.capabilities?.includes('cli') ? (body, options) => this.bridgeRun(body, options) : null } }
  }

  models = {
    /** Listing is optional metadata, not proof of generation. No agent is selected or started. */
    refresh: async (alias, options = {}) => {
      const { settings, selected, options: transport } = this.modelConnection(alias)
      try {
        const listed = await boundedModelCheck(signal => inference(settings, transport).models({ signal }), options)
        return { ids: listed.map(model => model.id), models: listed, at: Date.now() }
      } catch (error) {
        if (error.code === 'provider_http' && [404, 405, 501].includes(error.metadata?.status)) error = new InferenceError('This provider does not support model listing; a reply can still be tested.', 'listing_unsupported', error.metadata)
        return modelFailure(error, settings, selected)
      }
    },
    /** A fixed, tool-free transport probe. Never creates an Engine, worker, run or conversation. */
    probe: async (alias, options = {}) => {
      const { settings, selected, options: transport } = this.modelConnection(alias)
      const sequence = this.modelProbeSequence = (this.modelProbeSequence ?? 0) + 1
      const started = performance.now()
      const receipt = { version: 1, id: crypto.randomUUID(), kind: 'model-probe', startedAt: Date.now(), model: { alias: settings.alias, provider: settings.provider, id: settings.model }, route: { via: settings.via === 'bridge' ? 'bridge' : 'direct', endpoint: null, ...(settings.via === 'bridge' ? { relay: null, generation: selected.generation ?? 0, runtimeId: selected.health?.runtimeId ?? null } : {}) }, prompt: snapshot(MODEL_PROBE_PROMPT), maxOutputTokens: 128, requests: [], completions: [] }
      let text = ''; let characters = 0; let failure = null; let terminal = false
      try {
        try { receipt.route.endpoint = settings.baseUrl ? redactedURL(settings.baseUrl) : null; if (settings.via === 'bridge') receipt.route.relay = selected.url ? redactedURL(selected.url) : null } catch { throw new InferenceError('The model or relay endpoint is not a valid URL.', 'configuration') }
        if (!['openai', 'anthropic'].includes(settings.provider)) throw new InferenceError('Reply verification supports HTTP streaming model providers; it does not start model CLIs or scripted agents.', 'configuration')
        // Configured thinking/provider options are retained, but no provider tool schema is sent.
        if (settings.requestParams != null && (typeof settings.requestParams !== 'object' || Array.isArray(settings.requestParams))) throw new InferenceError('request_params must be an object.', 'configuration')
        const requestParams = { ...(settings.requestParams ?? {}) }
        for (const key of ['tools', 'tool_choice', 'functions', 'function_call', 'parallel_tool_calls']) delete requestParams[key]
        const llm = inference({ ...settings, requestParams, retries: 1 }, transport)
        await boundedModelCheck(async (signal, limit) => {
          receipt.timeoutMs = limit
          for await (const delta of llm.stream(MODEL_PROBE_PROMPT, { signal, maxOutputTokens: 128, strictCompletion: true,
            onRequest: request => { if (!terminal && !signal.aborted) receipt.requests.push(modelEvidence(request, settings, selected)) },
            onFinish: completion => { if (!terminal && !signal.aborted) receipt.completions.push(modelEvidence(completion, settings, selected)) },
          })) {
            if (terminal || signal.aborted) throw signal.reason ?? new InferenceError('Probe ended.', 'aborted')
            characters += delta.text.length
            if (characters > 32768) throw new InferenceError('The reply probe exceeded its bounded output.', 'output_limit')
            if (delta.kind === 'text') text += delta.text
          }
          if (signal.aborted) throw signal.reason
          if (!text.trim()) throw new InferenceError('The provider completed without a text reply.', 'probe_empty')
        }, options, 60000)
      } catch (error) { failure = modelFailure(error, settings, selected) }
      terminal = true
      receipt.at = Date.now(); receipt.elapsedMs = performance.now() - started
      receipt.status = failure ? failure.errorCode === 'aborted' ? 'aborted' : failure.errorCode === 'timeout' ? 'timed_out' : 'failed' : 'completed'
      receipt.text = text
      if (failure) Object.assign(receipt, { error: failure.error, errorCode: failure.errorCode })
      const frozen = modelEvidence(receipt, settings, selected)
      try {
        // Newer probes own the single last-receipt slot; late older results cannot replace them.
        const write = (this.modelProbeWrite ?? Promise.resolve()).catch(() => {}).then(() => sequence === this.modelProbeSequence ? this.store.put('settings', { key: 'model-probe:last', value: frozen }) : undefined)
        this.modelProbeWrite = write
        await boundedEvidence(write)
      } catch { return { error: 'The probe ended, but its evidence could not be saved. Retry after local storage is available.', errorCode: 'evidence_persistence', at: Date.now(), receipt: frozen } }
      return failure ? { ...failure, receipt: frozen } : { text: frozen.text, at: frozen.at, elapsedMs: frozen.elapsedMs, receipt: frozen }
    },
  }

  bridgeFetch(url, init = {}) {
    const bridge = this.bridgeState
    assertModelRelay(bridge.status === 'answering' ? bridge.health : null)
    return this.fetch(`${bridge.url}/fetch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ?? null, stream: true }),
      signal: init.signal,
    })
  }

  bridgeRun(body, { signal } = {}) {
    const bridge = this.bridgeState
    return this.fetch(`${bridge.url}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  }

  approvalsApi = {
    list: () => [...this.approvals.values()].map(publicApproval),
    answer: (id, decision) => this.answerApproval(id, decision),
  }

  memory = {
    list: async (agent) => (await this.store.all('memory')).filter((entry) => !agent || entry.agent === agent).sort((a, b) => b.at - a.at),
    remove: async (id) => {
      await this.store.delete('memory', id)
      this.publish({ type: 'memory' })
    },
    edit: async (id, text) => {
      await this.store.update('memory', id, (current) => (current ? { value: { ...current, text, source: 'owner', at: Date.now() } } : {}))
      this.publish({ type: 'memory' })
    },
  }

  learned = {
    get: async (agent) => (await this.store.get('learned', agent))?.text ?? '',
    fromFile: (agent) => this.specs.get(agent)?.learned ?? '',
    /** Replace an agent's accepted learned text (the owner removing or rewording an entry). */
    set: async (agent, text) => {
      await this.store.put('learned', { agent, text: String(text).trim(), at: Date.now() })
      const spec = this.specs.get(agent)
      if (spec) this.threads.get(agent)?.worker.postMessage({ type: 'settings', learned: await this.learnedFor(spec) })
      this.publish({ type: 'dreams' })
    },
    /** Write an agent's learned layer into its folder through the bridge, so it becomes a file. */
    writeFile: async (agent, folder = 'public/agents') => {
      const text = await this.learned.get(agent)
      const content = `---\nname: learned\ndescription: What experience taught ${agent}, accepted by the owner.\n---\n\n${text}\n`
      return this.bridgeCall('/fs/write', { path: `${folder}/${agent}/learned.md`, content })
    },
  }

  dreams = {
    list: async () => (await this.store.all('dreams')).sort((a, b) => b.at - a.at),
    last: () => this.lastDream ?? null,
    run: () => {
      const latest = [...this.runs.values()].filter((run) => !run.parent && run.kind === 'task').sort((a, b) => b.at - a.at)[0]
      return latest ? this.dream(latest.trace) : null
    },
    accept: async (id, text) => {
      const proposal = await this.store.get('dreams', id)
      if (!proposal) return false
      const line = String(text ?? proposal.text).trim()
      const current = await this.learned.get(proposal.agent)
      await this.store.put('dreams', { ...proposal, text: line, status: 'accepted', decided: Date.now() })
      await this.learned.set(proposal.agent, [current, `- ${line}`].filter(Boolean).join('\n'))
      return true
    },
    reject: async (id) => {
      const proposal = await this.store.get('dreams', id)
      if (proposal) await this.store.put('dreams', { ...proposal, status: 'rejected', decided: Date.now() })
      this.publish({ type: 'dreams' })
      return true
    },
  }

  traces = {
    /** Every run of one task, with spans and logs, as one JSON document the owner can save. */
    export: (trace, { timeoutMs = EVIDENCE_TIMEOUT_MS } = {}) => boundedEvidence((async () => {
      // Snapshot once: a continuing run cannot extend this export's wait forever.
      // Filter metadata first; unrelated large or incomplete event archives must
      // not be loaded or prevent this trace's export.
      const byId = new Map((await this.store.all('runs')).map(record => [record.id, record]))
      for (const run of this.runs.values()) byId.set(run.id, this.run(run.id))
      const selected = snapshot([...byId.values()].filter(run => run.trace === trace).sort((a, b) => b.at - a.at))
      const runs = await Promise.all(selected.map(record => this.runs.has(record.id) ? record : this.storedRun(record)))
      await Promise.all(runs.filter(run => this.runs.has(run.id)).map(async run => { await this.flushToolEvents(run.id, run.toolEvents.length); await this.flushRunRecord(run.id, run.toolEvents.length) }))
      const included = new Set(runs.map(run => run.id))
      for (const run of runs) if (run.kind === 'strategy') for (const childId of run.children ?? []) if (!included.has(childId)) throw new Error(`Strategy evidence is incomplete: missing role run ${childId}`)
      const evidence = runs.map(run => ({ ...run, toolEventPersistence: this.evictedEvidence.has(run.id) ? 'retention-evicted' : this.store.durable ? 'committed' : 'memory-only' }))
      return { harness: 'trace', version: 1, trace, exported: new Date().toISOString(), build: this.index.build ?? '', runs: evidence, usage: traceUsage(runs) }
    })(), timeoutMs),
  }

  data = {
    export: async () => {
      const [memory, dreams, learned, sessions, files] = await Promise.all(['memory', 'dreams', 'learned', 'sessions', 'files'].map((name) => this.store.all(name)))
      const catalogue = structuredClone(this.saved.catalogue ?? {})
      const secret = /auth|key|token|secret|cookie/i
      const scrub = (headers) => headers && Object.fromEntries(Object.entries(headers).filter(([name]) => !secret.test(name)))
      for (const entry of Object.values(catalogue.models ?? {})) {
        delete entry.api_key
        delete entry.apiKey
        if (entry.headers) entry.headers = scrub(entry.headers)
      }
      const mcpServers = Object.fromEntries(Object.entries(this.saved.mcp ?? {}).map(([name, server]) => [name, { ...server, headers: scrub(server.headers) }]))
      return { harness: 'data', version: 1, exported: new Date().toISOString(), settings: { catalogue, policy: this.saved.policy, dreaming: this.saved.dreaming, mcp: mcpServers }, memory, dreams, learned, sessions, files }
    },
    import: async (data) => {
      if (data?.harness !== 'data') throw new Error('not a harness data file')
      for (const name of ['memory', 'dreams', 'learned', 'sessions', 'files']) for (const row of data[name] ?? []) await this.store.put(name, row)
      if (data.settings) await this.setSettings(data.settings)
      if (data.settings?.mcp) await this.mcp.set({ ...this.saved.mcp, ...data.settings.mcp })
      this.publish({ type: 'memory' })
      this.publish({ type: 'dreams' })
      return true
    },
  }
}

/** A `/run` stream read whole: stdout joined, stderr's tail, the exit code. */
function collectRun(text) {
  const result = { out: '', err: '', code: -1, timedOut: false }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.out != null) result.out += event.out
    if (event.err != null) result.err = (result.err + event.err).slice(-4000)
    if (event.code != null) Object.assign(result, { code: event.code, timedOut: Boolean(event.timedOut) })
    if (event.error) throw new Error(event.error)
  }
  return result
}

function publicApproval({ settle: _settle, ...approval }) {
  return approval
}

function clean(path) {
  return String(path ?? '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
}
