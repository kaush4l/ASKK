/** Browser-local, declarative installations. Authored bytes never become executable modules. */
import { importAgentPackage, restoreAgentPackage } from '../core/agent-package.js'
import { compileAgentPackage, compilePackageWorkflows } from '../core/package-spec.js'
import { resolvePackageWorkflows } from '../core/package-workflows.js'
import { IMPORTABLE_TOOL_GROUPS } from '../core/builtin-registry.js'
import { commonToolFiles } from '../core/folder.js'
import { decide } from '../core/permissions.js'
import { snapshot } from '../core/prompt.js'
import { scopedToolDecision } from './tool-policy.js'
import { boundModelAvailable } from '../core/models.js'

const KEY = 'agent-installations:v1'
const STAGES = 3
const STAGE_BYTES = 64 * 1024 * 1024
const STAGE_AGE = 15 * 60 * 1000
const MAX_INSTALLATIONS = 32
const MAX_INSTALLED_BYTES = 128 * 1024 * 1024
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const bytesOf = data => (data?.lock?.files ?? []).reduce((sum, file) => sum + file.bytes, 0)
const modelsFor = hub => {
  const catalogue = hub.catalogue()
  return Object.entries(catalogue.models ?? {}).filter(([id]) => installedModelAvailable(catalogue, id)).map(([id, value]) => ({ id, label: `${id}${value.model ? ` — ${value.model}` : ''}` }))
}
const toolsFor = hub => [...new Set([...IMPORTABLE_TOOL_GROUPS, ...Object.keys(commonToolFiles(hub.index))])].filter(name => name !== 'schedule').sort()
const requestedTools = agent => [...new Set([...(agent.settings.tools ?? []), ...(agent.settings.skills === true || agent.settings.skills?.length ? ['skill'] : [])])]
export function installedModelAvailable(catalogue, alias) {
  return boundModelAvailable(catalogue, alias)
}
const summaries = data => data.agents.map(agent => ({ id: agent.id, name: agent.settings.name ?? agent.id, description: agent.settings.description ?? '', tools: requestedTools(agent), modelAlias: agent.settings.model ?? '$default', delegates: snapshot(agent.delegates), notes: [...agent.notes] }))
const envelope = row => {
  if (row == null) return { version: 1, records: [] }
  const value = row.value
  if (!value || value.version !== 1 || !Array.isArray(value.records) || value.records.length > MAX_INSTALLATIONS) fail('PACKAGE_STORAGE', 'Saved agent installations have an unsupported structure; they were not overwritten.')
  return value
}

/** Imported declarations can only add restrictions to the owner's current policy. */
export function installationDecision(item, args, options, permissions) {
  const owner = scopedToolDecision(item, args, options)
  if (!permissions || owner.action === 'deny') return owner
  const requested = decide(item, args, { agent: options.agent, policy: { defaults: { read: 'allow', net: 'allow', write: 'allow', exec: 'allow' }, rules: { [options.agent]: permissions } } })
  const rank = { allow: 0, ask: 1, deny: 2 }
  return rank[requested.action] > rank[owner.action] ? { ...requested, reason: `installed package restriction: ${requested.reason}` } : owner
}

export class AgentInstallations {
  constructor(hub) { this.hub = hub; this.stages = new Map(); this.items = new Map(); this.queue = Promise.resolve() }
  ordered(work) { const pending = this.queue.catch(() => {}).then(work); this.queue = pending; return pending }
  prune() { for (const [id, stage] of this.stages) if (Date.now() - stage.at > STAGE_AGE) this.stages.delete(id) }
  async preview(records) {
    if (this.hub.disposed) fail('PACKAGE_STOPPED', 'The agent desk has stopped.')
    const pkg = await importAgentPackage(records)
    const reference = pkg.data.agents.find(agent => agent.path === 'agent.md').settings.workflows
    const declared = reference === undefined ? null : await resolvePackageWorkflows(reference, { read: path => pkg.source.read(path), agents: new Set(pkg.data.agents.map(agent => agent.id)), agentSettings: new Map(pkg.data.agents.map(agent => [agent.id, agent.settings])) })
    const workflows = declared?.workflows.map(row => ({ id: row.id, label: row.label, description: row.description, agentId: row.outputId, execution: row.execution, completion: row.completion })) ?? []
    if (this.hub.disposed) fail('PACKAGE_STOPPED', 'The agent desk stopped during package validation.')
    this.prune()
    const size = bytesOf(pkg.data)
    while (this.stages.size && (this.stages.size >= STAGES || [...this.stages.values()].reduce((sum, stage) => sum + stage.bytes, 0) + size > STAGE_BYTES)) this.stages.delete(this.stages.keys().next().value)
    const stageId = crypto.randomUUID()
    this.stages.set(stageId, { pkg, bytes: size, at: Date.now() })
    return snapshot({ stageId, packageId: pkg.data.packageId, packageVersion: pkg.data.packageVersion, revisionDigest: pkg.data.revisionDigest, entryAgentId: pkg.data.entryAgentId, agents: summaries(pkg.data), files: (await pkg.source.list()).map(({ path, bytes }) => ({ path, bytes })), modelAliases: [...new Set(pkg.data.agents.map(agent => agent.settings.model ?? '$default'))], availableModels: modelsFor(this.hub), availableTools: toolsFor(this.hub), workflows, defaultWorkflow: declared?.default ?? null, notes: [] })
  }
  admit(guard) {
    if (this.hub.disposed || !this.hub.started || this.hub.lockState !== 'leader') fail('PACKAGE_STOPPED', 'Only the active agent desk can install a package.')
    if (!this.hub.store?.durable || typeof this.hub.store.update !== 'function') fail('PACKAGE_STORAGE', 'Installing an agent requires durable browser storage; nothing was installed.')
    if (guard && guard() === false) fail('PACKAGE_ADMISSION', 'The desk changed while this package was being installed.')
  }
  summary(record, status = 'ready', error = '', compiled = {}) {
    const text = value => typeof value === 'string' ? value.slice(0, 4000) : ''
    const data = record.data ?? {}, agents = Array.isArray(data.agents) ? data.agents.slice(0, 64).filter(agent => agent && typeof agent === 'object') : []
    const lead = agents.find(agent => agent.id === record.leadAgentId)
    const leadSpec = compiled.specs?.find(spec => spec.package.agentId === record.leadAgentId)
    const modelBindings = Object.fromEntries(Object.entries(record.bindings?.models ?? {}).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, text(value)]))
    return snapshot({ id: text(record.id), packageId: text(data.packageId), packageVersion: text(data.packageVersion), revisionDigest: text(data.revisionDigest), leadAgentId: text(record.leadAgentId), agentPath: `installed/${text(record.id)}/${text(record.leadAgentId)}`, label: text(lead?.settings?.name) || text(record.leadAgentId) || 'Unavailable package', description: text(lead?.settings?.description), modelBindings, leadModel: modelBindings[lead?.settings?.model ?? '$default'] ?? '', leadRequireVerification: leadSpec?.engine.requireVerification === true, workflows: status === 'ready' ? compiled.workflows?.workflows ?? [] : [], defaultWorkflow: status === 'ready' ? compiled.workflows?.default ?? null : null, agents: agents.map(agent => ({ id: text(agent.id), name: text(agent.settings?.name) || text(agent.id), description: text(agent.settings?.description), agentPath: `installed/${text(record.id)}/${text(agent.id)}` })), createdAt: record.createdAt, status, error })
  }
  async compile(record) {
    if (!record || record.version !== 1 || !/^[a-z0-9-]{1,80}$/.test(record.id) || !Number.isFinite(record.createdAt)) fail('PACKAGE_STORAGE', 'The saved installation identity is invalid.')
    const pkg = await restoreAgentPackage(record.data)
    if (!pkg.data.agents.some(agent => agent.id === record.leadAgentId)) fail('PACKAGE_BINDING', 'The installed lead agent is missing from its verified package.')
    const specs = await compileAgentPackage(pkg, { installationId: record.id, namespace: 'installed', bindings: record.bindings, catalogue: this.hub.catalogue(), index: this.hub.index })
    const workflows = await compilePackageWorkflows(pkg, { specs })
    return { specs, workflows }
  }
  async restore() {
    return this.ordered(async () => {
      const stored = await this.hub.store.get('settings', KEY)
      this.items.clear()
      for (const path of this.hub.specs.keys()) if (path.startsWith('installed/')) this.hub.specs.delete(path)
      for (const path of this.hub.failed.keys()) if (path.startsWith('installed/')) this.hub.failed.delete(path)
      let saved
      try { saved = envelope(stored) }
      catch (error) {
        this.items.set('invalid-store', { summary: this.summary({ id: 'invalid-store' }, 'disabled', error.message) })
        this.hub.publish({ type: 'packages', installations: this.list() })
        return
      }
      for (const record of saved.records) {
        try {
          if (this.items.has(record.id)) fail('PACKAGE_STORAGE', 'Duplicate installation identity in saved packages.')
          const compiled = await this.compile(record)
          const { specs } = compiled
          this.items.set(record.id, { record, specs, summary: this.summary(record, 'ready', '', compiled) })
          for (const spec of specs) this.hub.specs.set(spec.path, spec)
        } catch (error) {
          const id = typeof record?.id === 'string' && /^[a-z0-9-]{1,80}$/.test(record.id) ? record.id : `invalid-${this.items.size}`
          for (const path of this.hub.specs.keys()) if (path.startsWith(`installed/${id}/`)) this.hub.specs.delete(path)
          this.items.set(id, { record, specs: [], summary: this.summary({ ...record, id }, 'disabled', String(error.message ?? error)) })
          this.hub.failed.set(`installed/${id}/${record?.leadAgentId ?? 'unknown'}`, String(error.message ?? error))
        }
      }
      this.hub.publish({ type: 'packages', installations: this.list() })
    })
  }
  async install(stageId, { leadAgentId, models, tools, admissionGuard } = {}) {
    // Capture owner decisions at invocation, before a preceding install can yield.
    const choices = snapshot({ leadAgentId, models, tools })
    return this.ordered(async () => {
      this.admit(admissionGuard); this.prune()
      const stage = this.stages.get(stageId)
      if (!stage) fail('PACKAGE_STAGE', 'This package preview expired; select the folder again.')
      const record = snapshot({ version: 1, id: crypto.randomUUID(), createdAt: Date.now(), data: stage.pkg.data, bindings: { models: choices.models, tools: choices.tools }, leadAgentId: choices.leadAgentId ?? stage.pkg.data.entryAgentId })
      const compiled = await this.compile(record)
      const { specs } = compiled
      const checkModels = () => { for (const spec of specs) if (!installedModelAvailable(this.hub.catalogue(), spec.inference.model)) fail('PACKAGE_BINDING', `The bound model profile changed before installation: ${spec.inference.model}`) }
      this.admit(admissionGuard)
      checkModels()
      await this.hub.store.update('settings', KEY, current => {
        this.admit(admissionGuard)
        checkModels()
        const saved = envelope(current)
        if (saved.records.some(row => row.id === record.id) || specs.some(spec => this.hub.specs.has(spec.path))) fail('PACKAGE_STORAGE', 'The installation identity conflicts with an existing agent; it was not overwritten.')
        if (saved.records.length >= MAX_INSTALLATIONS || saved.records.reduce((sum, row) => sum + bytesOf(row.data), 0) + stage.bytes > MAX_INSTALLED_BYTES) fail('PACKAGE_LIMIT', 'The browser installation limit is reached; existing packages were preserved.')
        return { value: { key: KEY, value: { version: 1, records: [...saved.records, record] } } }
      })
      this.stages.delete(stageId)
      if (this.hub.disposed || admissionGuard && admissionGuard() === false) {
        this.items.set(record.id, { record, specs: [], summary: this.summary(record, 'disabled', 'Saved, but activation was interrupted; reload the desk to verify this installation.') })
        this.hub.publish({ type: 'packages', installations: this.list() })
        fail('PACKAGE_ACTIVATION', 'The package was saved, but the desk changed before activation; reload to verify it.')
      }
      this.items.set(record.id, { record, specs, summary: this.summary(record, 'ready', '', compiled) })
      for (const spec of specs) this.hub.specs.set(spec.path, spec)
      for (const spec of specs) await this.hub.probe(spec.path)
      if (this.hub.disposed) {
        for (const spec of specs) this.hub.specs.delete(spec.path)
        this.items.set(record.id, { record, specs: [], summary: this.summary(record, 'disabled', 'Saved, but tool inspection was interrupted; reload the desk to verify this installation.') })
        this.hub.publish({ type: 'packages', installations: this.list() })
        fail('PACKAGE_ACTIVATION', 'The package was saved, but the desk stopped before its tools were inspected.')
      }
      const error = specs.map(spec => this.hub.readyInfo.get(spec.path)?.error).filter(Boolean).join('; ')
      if (error) {
        for (const spec of specs) this.hub.specs.delete(spec.path)
        this.items.set(record.id, { record, specs: [], summary: this.summary(record, 'disabled', error) })
      }
      this.hub.publish({ type: 'packages', installations: this.list() })
      return this.list().find(item => item.id === record.id)
    })
  }
  list() {
    return snapshot([...this.items.values()].map(item => {
      const missing = item.specs?.find(spec => !installedModelAvailable(this.hub.catalogue(), spec.inference.model))
      if (missing) return { ...item.summary, status: 'disabled', workflows: [], defaultWorkflow: null, error: `Bound model profile is no longer configured: ${missing.inference.model}` }
      const failed = item.specs?.map(spec => this.hub.readyInfo.get(spec.path)?.error).filter(Boolean)
      return failed?.length ? { ...item.summary, status: 'disabled', workflows: [], defaultWorkflow: null, error: failed.join('; ') } : item.summary
    }))
  }
}
