/** Package-local workflow data. Resolution never fetches or executes package code. */
import { validateStrategy } from './strategy.js'
import { normalizeCompletion } from './completion.js'
import { snapshot } from './prompt.js'

const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const fail = message => { throw Object.assign(new Error(`Agent package workflows: ${message}`), { code: 'PACKAGE_WORKFLOW' }) }
const keys = (value, allowed, label) => { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`invalid ${label}`) }
const id = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value)
const text = (value, max, label, empty = false) => { if (typeof value !== 'string' || value.length > max || !empty && !value.trim()) fail(`invalid ${label}`); return value }
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
function resourcePath(value, extension) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\:%\u0000-\u001f\u007f]/.test(value)) fail('unsafe resource path')
  const path = value.normalize('NFC'), parts = path.split('/')
  if (parts.length > 32 || parts.some(part => !part || part === '.' || part === '..' || part.trim() !== part || part.endsWith('.')) || !path.endsWith(extension)) fail('unsafe resource path or unsupported resource type')
  return path
}

/** read(path) must read only inventoried package bytes; refer records the dependency. */
export async function resolvePackageWorkflows(reference, { read, agents, agentSettings = new Map(), resolveAgent = value => value, refer = () => {} }) {
  const load = async (value, extension) => {
    const path = resourcePath(value, extension)
    refer(path)
    const content = await read(path)
    if (typeof content !== 'string') fail(`${path} is not text`)
    return content
  }
  const json = async value => { const content = await load(value, '.json'); try { return JSON.parse(content) } catch { fail(`${value} is not valid JSON`) } }
  const manifest = await json(reference)
  keys(manifest, ['version', 'default', 'workflows'], 'manifest')
  if (manifest.version !== 1 || !id(manifest.default) || !Array.isArray(manifest.workflows) || !manifest.workflows.length || manifest.workflows.length > 32) fail('expected version 1, default and 1–32 workflows')
  const seen = new Set(), workflows = []
  for (const row of manifest.workflows) {
    keys(row, ['id', 'label', 'description', 'strategy', 'execution', 'completion'], 'workflow')
    if (!id(row.id) || seen.has(row.id)) fail('invalid or duplicate workflow id')
    seen.add(row.id)
    text(row.label, 512, 'workflow label'); text(row.description, 4000, 'workflow description', true)
    keys(row.execution, ['workspace'], 'execution')
    if (!['none', 'required'].includes(row.execution.workspace)) fail('unsupported workspace requirement')
    keys(row.completion, ['checks'], 'completion')
    if (!Array.isArray(row.completion.checks) || row.completion.checks.length > 16) fail('completion checks must be a bounded array')
    let completion
    try { completion = normalizeCompletion(row.completion) } catch (error) { fail(error.message) }
    if (completion.checks.length && row.execution.workspace !== 'required') fail('workspace completion checks require a workspace')
    const raw = await json(row.strategy)
    const local = value => { if (!id(value) || !agents.has(value)) fail('strategy must reference an available package-local agent ID'); return resolveAgent(value) }
    let strategy, outputId
    if (raw?.kind === 'agent') {
      keys(raw, ['version', 'kind', 'id', 'label', 'description', 'agent', 'delegation', 'session'], 'agent strategy')
      if (raw.version !== 1 || typeof raw.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(raw.id) || !['none', 'declared'].includes(raw.delegation) || raw.session !== 'agent') fail('invalid agent strategy')
      for (const key of ['label', 'description']) if (raw[key] !== undefined) text(raw[key], 4000, `strategy ${key}`, true)
      outputId = raw.agent; strategy = { ...raw, agent: local(raw.agent) }
    } else {
      if (!Array.isArray(raw?.nodes) || raw.nodes.length > 64) fail('invalid graph nodes')
      const nodes = []
      for (const node of raw.nodes) {
        keys(node, ['id', 'agent', 'dependsOn', 'template', 'templateFile', 'inputs'], 'graph node')
        if (Object.hasOwn(node, 'template') === Object.hasOwn(node, 'templateFile')) fail('graph node requires exactly one literal template or templateFile')
        const { templateFile, ...rest } = node
        nodes.push({ ...rest, agent: local(node.agent), ...(templateFile !== undefined ? { template: await load(templateFile, '.md') } : {}) })
      }
      outputId = raw.nodes.find(node => node.id === raw.output)?.agent
      try { strategy = validateStrategy({ ...raw, nodes }) } catch (error) { fail(error.message) }
    }
    const participants = raw.kind === 'agent' ? [raw.agent] : raw.nodes.map(node => node.agent)
    if (participants.some(id => agentSettings.get(id)?.require_verification === true) && row.execution.workspace !== 'required') fail('legacy verification requires a workspace')
    if (agentSettings.get(outputId)?.require_verification === true && !completion.checks.some(check => check.capability === 'workspace.artifact')) fail('workflow cannot bypass legacy output verification')
    workflows.push({ id: row.id, label: row.label, description: row.description, agent: resolveAgent(outputId), strategy: snapshot(strategy), execution: snapshot(row.execution), completion, outputId })
  }
  if (!seen.has(manifest.default)) fail('default must reference a declared workflow')
  return { default: manifest.default, workflows }
}

export async function compilePackageWorkflows(pkg, { specs } = {}) {
  const data = pkg?.data, source = pkg?.source
  if (!plain(data) || !Object.isFrozen(data) || data.schemaVersion !== 1 || !Array.isArray(data.agents) || typeof source?.read !== 'function') fail('pass a validated package')
  const root = data.agents.find(agent => agent.path === 'agent.md')
  if (root?.settings.workflows === undefined) return null
  if (!Array.isArray(specs) || specs.length !== data.agents.length) fail('compiled specs are required')
  specs = specs.map(spec => snapshot({ path: spec.path, package: spec.package }))
  const byId = new Map(), identity = specs[0]?.package
  for (const spec of specs) {
    const p = spec.package
    if (!p || p.packageId !== data.packageId || p.packageVersion !== data.packageVersion || p.revisionDigest !== data.revisionDigest || p.installationId !== identity.installationId || p.namespace !== identity.namespace || spec.path !== `${p.namespace}/${p.installationId}/${p.agentId}` || byId.has(p.agentId) || !data.agents.some(agent => agent.id === p.agentId)) fail('specs must belong to one compiled package revision and installation')
    byId.set(p.agentId, spec)
  }
  const inventory = new Map(data.lock.files.map(file => [file.path, file])), files = {}, cache = new Map()
  const read = async path => {
    if (cache.has(path)) return cache.get(path)
    const expected = inventory.get(path)
    if (!expected || !root.references.includes(path)) fail('workflow resource is not in the validated inventory')
    const supplied = await source.read(path, { as: 'bytes' })
    if (!(supplied instanceof Uint8Array)) fail('workflow resource must contain bytes')
    const bytes = new Uint8Array(supplied)
    if (bytes.length !== expected.bytes || await hash(bytes) !== expected.sha256) fail('workflow resource changed after validation')
    let content
    try { content = decoder.decode(bytes) } catch { fail('workflow resource is not UTF-8') }
    files[path] = expected.sha256; cache.set(path, content); return content
  }
  const resolved = await resolvePackageWorkflows(root.settings.workflows, { read, agents: new Set(byId.keys()), agentSettings: new Map(data.agents.map(agent => [agent.id, agent.settings])), resolveAgent: id => byId.get(id).path })
  const workflows = []
  for (const { outputId, ...row } of resolved.workflows) workflows.push({ ...row, strategyHash: `sha256:${await hash(encoder.encode(JSON.stringify(row.strategy)))}`, strategyFiles: { ...files }, package: { ...byId.get(outputId).package } })
  return snapshot({ default: resolved.default, workflows })
}
