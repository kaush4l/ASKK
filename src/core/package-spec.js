/**
 * Compile an importAgentPackage/restoreAgentPackage result without interpreting
 * authored frontmatter again. JSON loaded from storage must first pass restore.
 * Bindings are desk decisions; authored permissions remain requests for the
 * runtime's restrictive intersection with owner policy.
 */
import { commonToolFiles } from './folder.js'
import { IMPORTABLE_TOOL_GROUPS } from './builtin-registry.js'
import { boundModelAvailable } from './models.js'

const ENGINE = {
  observation_format: 'observationFormat', history_format: 'historyFormat', output_reserve: 'outputReserve',
  require_verification: 'requireVerification', max_steps: 'maxSteps', repairs: 'repairs',
  compact_at: 'compactAt', keep: 'keep', remembers: 'remembers',
}
const INFERENCE = { temperature: 'temperature', max_output_tokens: 'maxOutputTokens', context_length: 'contextLength' }
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const fail = (code, message) => { throw Object.assign(new Error(`Agent package compilation: ${message}`), { code }) }
const clone = value => structuredClone(value)
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')

function requestedGroups(agent) {
  const groups = [...(agent.settings.tools ?? [])]
  if ((agent.settings.skills === true || Array.isArray(agent.settings.skills) && agent.settings.skills.length > 0) && !groups.includes('skill')) groups.push('skill')
  return groups
}

/**
 * -> frozen AgentSpec[]. No provider secrets, executable package tools or global
 * resources enter the result. All package aliases require explicit desk binding.
 */
export async function compileAgentPackage(pkg, { installationId, namespace = 'installed', bindings, catalogue, index = { files: {} } } = {}) {
  const data = pkg?.data, source = pkg?.source
  if (!plain(data) || !Object.isFrozen(data) || data.schemaVersion !== 1 || !Array.isArray(data.agents) || !data.agents.length || !plain(data.lock) || !Array.isArray(data.lock.files) || typeof source?.read !== 'function' || typeof source?.list !== 'function') fail('PACKAGE_COMPILE_SOURCE', 'pass a validated import or restore result, not stored JSON')
  if (typeof installationId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(installationId)) fail('PACKAGE_COMPILE_ID', 'installationId must be a bounded lowercase desk ID without path separators')
  if (!['installed', 'bundled'].includes(namespace)) fail('PACKAGE_COMPILE_ID', 'namespace must be installed or bundled')
  if (!plain(bindings) || Object.keys(bindings).some(key => !['models', 'tools'].includes(key)) || !plain(bindings.models) || !Array.isArray(bindings.tools) || bindings.tools.length > 1024 || bindings.tools.some(group => typeof group !== 'string' || !group) || new Set(bindings.tools).size !== bindings.tools.length) fail('PACKAGE_COMPILE_BINDING', 'bindings must contain explicit model mappings and distinct approved tool groups')
  if (!plain(catalogue?.models)) fail('PACKAGE_COMPILE_MODEL', 'the desk model catalogue is unavailable')
  // Capture all caller-owned decisions before any source read/hash can yield.
  const selected = new Set(bindings.tools), models = clone(bindings.models)
  const common = commonToolFiles(index)
  const commonHashes = Object.fromEntries(Object.values(common).map(file => [file, index.files?.[file] ?? '']))
  for (const file of Object.values(common)) if (!/^tools\/[^/\\:%\u0000-\u001f]+\.m?js$/.test(file)) fail('PACKAGE_COMPILE_TOOL', 'the desk common-tool index contains an unsafe path')
  const supported = new Set([...IMPORTABLE_TOOL_GROUPS, ...Object.keys(common)])
  const requested = new Set(data.agents.flatMap(requestedGroups))
  if (requested.has('schedule')) fail('PACKAGE_COMPILE_TOOL', 'schedule is not supported for imported packages: deferred work cannot yet retain package-local delegation, run policy and workspace binding; remove this request')
  for (const group of requested) if (!supported.has(group)) fail('PACKAGE_COMPILE_TOOL', `requested tool group "${group}" is not shipped by this desk; install a trusted desk tool or remove the request`)
  for (const group of selected) if (!requested.has(group)) fail('PACKAGE_COMPILE_BINDING', `approved tool group "${group}" was not requested by this package`)

  const modelAliases = new Set(data.agents.map(agent => agent.settings.model ?? '$default'))
  for (const alias of Object.keys(models)) if (!modelAliases.has(alias)) fail('PACKAGE_COMPILE_BINDING', `model binding "${alias}" was not requested by this package`)
  for (const alias of modelAliases) {
    const deskAlias = models[alias]
    if (!Object.hasOwn(models, alias) || !boundModelAvailable(catalogue, deskAlias)) fail('PACKAGE_COMPILE_MODEL', `bind requested model alias "${alias}" to an existing desk model profile or a valid $default; raw model IDs are not a fallback`)
  }

  const inventory = new Map(data.lock.files.map(row => [row.path, row]))
  const agents = new Map(data.agents.map(agent => [agent.id, agent]))
  const paths = new Map(data.agents.map(agent => [agent.id, `${namespace}/${installationId}/${agent.id}`]))
  const resources = new Map()
  const read = path => {
    if (!resources.has(path)) resources.set(path, (async () => {
      const listed = inventory.get(path)
      if (!listed) fail('PACKAGE_COMPILE_RESOURCE', `referenced resource is absent from the verified inventory: ${path}`)
      const supplied = await source.read(path, { as: 'bytes' })
      if (!(supplied instanceof Uint8Array)) fail('PACKAGE_COMPILE_RESOURCE', `referenced resource is not a byte array: ${path}`)
      const bytes = new Uint8Array(supplied)
      if (bytes.length !== listed.bytes || await digest(bytes) !== listed.sha256) fail('PACKAGE_COMPILE_RESOURCE', `referenced resource bytes changed after validation: ${path}`)
      try { return decoder.decode(bytes) } catch { fail('PACKAGE_COMPILE_RESOURCE', `referenced resource is not UTF-8 text: ${path}`) }
    })())
    return resources.get(path)
  }
  const specs = []
  for (const agent of data.agents) {
    const settings = agent.settings
    const grants = requestedGroups(agent).filter(group => selected.has(group))
    const commonTools = Object.fromEntries(grants.filter(group => Object.hasOwn(common, group)).map(group => [group, common[group]]))
    const inference = { model: models[settings.model ?? '$default'] }
    for (const [authored, key] of Object.entries(INFERENCE)) if (settings[authored] !== undefined) inference[key] = settings[authored]
    const engine = { contractVersion: agent.contractVersion, responseFormat: agent.responseFormat, session: settings.session ?? (settings.remembers ? 'agent' : 'task') }
    for (const [authored, key] of Object.entries(ENGINE)) if (settings[authored] !== undefined) engine[key] = settings[authored]
    const packageResources = Object.fromEntries(await Promise.all(agent.references.map(async path => [path, await read(path)])))
    if (settings.prompt_template) {
      const path = settings.prompt_template.normalize('NFC'), text = packageResources[path]
      const separator = /\r?\n<!-- user -->\r?\n/.exec(text)
      if (!separator) fail('PACKAGE_COMPILE_RESOURCE', `prompt template has no user separator: ${path}`)
      engine.promptTemplate = { system: text.slice(0, separator.index), user: text.slice(separator.index + separator[0].length) }
    }
    const directory = agent.path.slice(0, -'agent.md'.length)
    const soulFrom = Object.hasOwn(packageResources, `${directory}soul.md`) ? `${directory}soul.md` : ''
    const skills = Array.isArray(settings.skills) ? settings.skills.map(path => path.normalize('NFC')) : settings.skills === true ? agent.references.filter(path => path.startsWith(`${directory}skills/`) && path.endsWith('.md')) : []
    const delegates = Object.entries(agent.delegates).map(([name, id]) => ({ path: paths.get(id), name, description: agents.get(id).settings.description ?? '' }))
    const services = Object.fromEntries(Object.entries(settings.services ?? {}).map(([name, id]) => [name, paths.get(id)]))
    const packageIdentity = { namespace, installationId, packageId: data.packageId, packageVersion: data.packageVersion, revisionDigest: data.revisionDigest, agentId: agent.id }
    const hash = `sha256:${await digest(encoder.encode(canonical({ package: packageIdentity, inference, grants, commonTools: Object.fromEntries(Object.entries(commonTools).map(([name, file]) => [name, { file, hash: commonHashes[file] }])) })))}`
    specs.push({
      path: paths.get(agent.id), name: settings.name ?? agent.id, description: settings.description ?? '',
      body: agent.body, soul: soulFrom ? packageResources[soulFrom] : '', soulFrom,
      learned: packageResources[`${directory}learned.md`] ?? '', permissions: clone(settings.permissions ?? {}),
      inference, engine, context: clone(settings.context ?? []),
      peers: [...new Set(delegates.map(item => item.path))], delegates, services, owned: [],
      grants, skills: grants.includes('skill') && skills.length > 0,
      private: settings.private ?? false, localTools: [], commonTools, hash, notes: [...agent.notes],
      package: packageIdentity, packageResources,
      packageSkills: skills.map(path => ({ name: path, path, body: packageResources[path] })),
    })
  }
  return freeze(specs)
}

export { compilePackageWorkflows } from './package-workflows.js'
