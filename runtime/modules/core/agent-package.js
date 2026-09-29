import { assertMessageHistoryTemplate } from './prompt.js'
import { validateLoopBudget } from './loop-budget.js'
/**
 * Portable, declarative folder ingestion. This module does not fetch, execute,
 * install, grant capabilities, or rewrite authored files.
 *
 * importAgentPackage([{path, content}], {limits}) -> {data, source}
 * data is frozen JSON suitable for storage/export; source.list/read is the
 * package-local adapter. Restore always revalidates the original bytes.
 */
import { resolvePackageWorkflows } from './package-workflows.js'

export const PACKAGE_LOCK = 'askk.lock.json'
export const PACKAGE_LIMITS = Object.freeze({ maxFiles: 256, maxFileBytes: 8 * 1024 * 1024, maxExpandedBytes: 32 * 1024 * 1024, maxAgents: 64 })
const CEILINGS = { maxFiles: 4096, maxFileBytes: 128 * 1024 * 1024, maxExpandedBytes: 256 * 1024 * 1024, maxAgents: 256 }
const ID = /^[a-z][a-z0-9_-]{0,63}$/
const PACKAGE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const KNOWN = new Set(['workflows', 'package_id', 'package_version', 'id', 'name', 'description', 'agents', 'services', 'tools', 'context', 'skills', 'private', 'permissions', 'model', 'temperature', 'max_output_tokens', 'context_length', 'response_format', 'observation_format', 'history_format', 'contract_version', 'prompt_template', 'output_reserve', 'require_verification', 'max_steps', 'repairs', 'compact_at', 'keep', 'remembers', 'session'])
const UNSUPPORTED_CONFIG = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credentials?|authorization|headers|private[_-]?key|provider|base[_-]?url|via)$/i
const SCRIPT = /\.(?:[cm]?js|jsx|tsx?|wasm|sh|bash|zsh|py|pyc|exe|dll|dylib|so)$/i
const SECRET_FILE = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx)$/i
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const fail = (code, message) => { throw Object.assign(new Error(`Agent package: ${message}`), { code }) }
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const canonical = value => JSON.stringify(order(value))
function order(value) {
  if (Array.isArray(value)) return value.map(order)
  if (!plain(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, order(value[key])]))
}
function frozen(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value) }
  return value
}
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')

/** NFC normalization is explicit; path separators/relative traversal are never repaired. */
function pathName(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\:%\u0000-\u001f\u007f]/.test(value)) fail('PACKAGE_PATH', 'a file path is invalid')
  const path = value.normalize('NFC')
  const parts = path.split('/')
  if (parts.length > 32 || parts.some(part => !part || part === '.' || part === '..' || part.trim() !== part || part.endsWith('.'))) fail('PACKAGE_PATH', `unsafe relative path: ${path}`)
  return path
}
function limitsFor(supplied = {}) {
  if (!plain(supplied) || Object.keys(supplied).some(key => !(key in PACKAGE_LIMITS))) fail('PACKAGE_LIMIT', 'unknown import limit')
  const limits = { ...PACKAGE_LIMITS, ...supplied }
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > CEILINGS[key]) fail('PACKAGE_LIMIT', `invalid ${key}`)
  return limits
}
function utf8(bytes, path) {
  try { return decoder.decode(bytes) } catch { fail('PACKAGE_TEXT', `${path} is not valid UTF-8`) }
}
function base64(bytes) {
  const chunks = []
  for (let at = 0; at < bytes.length; at += 16384) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 16384)))
  return btoa(chunks.join(''))
}
function unbase64(value) {
  if (typeof value !== 'string' || value.length % 4 || /[^A-Za-z0-9+/]/.test(value.replace(/={1,2}$/, ''))) fail('PACKAGE_DATA', 'invalid encoded file bytes')
  const decoded = Uint8Array.from(atob(value), character => character.charCodeAt(0))
  if (base64(decoded) !== value) fail('PACKAGE_DATA', 'noncanonical encoded file bytes')
  return decoded
}
function checkConfig(value, file, depth = 0) {
  if (depth > 32) fail('PACKAGE_SCHEMA', `${file} configuration is too deeply nested`)
  if (Array.isArray(value)) { for (const part of value) checkConfig(part, file, depth + 1); return }
  if (!plain(value)) return
  for (const [key, part] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('PACKAGE_SCHEMA', `${file} contains an unsupported configuration key`)
    if (UNSUPPORTED_CONFIG.test(key)) fail('PACKAGE_SECRET_CONFIG', `${file} contains unsupported credential or transport configuration (${key}); bind it in the desk`)
    checkConfig(part, file, depth + 1)
  }
}
// The existing Markdown reader deliberately tolerates malformed YAML. Import is
// an authorization boundary, so accept its useful scalar/list/map subset strictly:
// every token must be consumed, every mapping key is unique, and no tags/anchors
// or multiline scalar syntax is interpreted. Authored source remains untouched.
function frontmatter(front, path) {
  const bad = () => fail('PACKAGE_SCHEMA', `${path} has ambiguous or unsupported frontmatter syntax`)
  function scan(text, separator, comments = false) {
    const parts = []; let quote = '', depth = 0, from = 0
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (quote) {
        if (quote === '"' && c === '\\') { i++; continue }
        if (c === quote) { if (quote === "'" && text[i + 1] === "'") { i++; continue }; quote = '' }
      } else if ((c === '"' || c === "'") && (i === 0 || /[\s,[{:]/.test(text[i - 1]))) quote = c
      else if (comments && c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i)
      else if ('[{'.includes(c)) depth++
      else if (']}'.includes(c)) { depth--; if (depth < 0) bad() }
      else if (depth === 0 && c === separator && (separator !== ':' || i + 1 === text.length || /\s/.test(text[i + 1]))) { parts.push(text.slice(from, i)); from = i + 1; if (separator === ':') { parts.push(text.slice(from)); return parts } }
    }
    if (quote || depth) bad()
    if (comments) return text
    parts.push(text.slice(from)); return parts
  }
  const keyName = raw => {
    const key = raw.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) bad()
    return key
  }
  const put = (out, key, value) => { if (Object.hasOwn(out, key)) bad(); out[key] = value }
  function scalar(raw, depth = 0) {
    if (depth > 32) bad()
    const value = raw.trim()
    if (!value) bad()
    if (value.startsWith('[')) {
      if (!value.endsWith(']')) bad()
      const inner = value.slice(1, -1).trim()
      return inner ? scan(inner, ',').map(part => scalar(part, depth + 1)) : []
    }
    if (value.startsWith('{')) {
      if (!value.endsWith('}')) bad()
      const out = {}, inner = value.slice(1, -1).trim()
      if (inner) for (const pair of scan(inner, ',')) { const parts = scan(pair, ':'); if (parts.length !== 2) bad(); put(out, keyName(parts[0]), scalar(parts[1], depth + 1)) }
      return out
    }
    if (value.startsWith('"')) { try { const parsed = JSON.parse(value); if (typeof parsed !== 'string') bad(); return parsed } catch { bad() } }
    if (value.startsWith("'")) { if (!/^'(?:[^']|'')*'$/.test(value)) bad(); return value.slice(1, -1).replaceAll("''", "'") }
    if (/^[&*!>|]/.test(value) || /[\[\]{}]/.test(value)) bad()
    if (/^(true|yes)$/i.test(value)) return true
    if (/^(false|no)$/i.test(value)) return false
    if (/^(null|~)$/.test(value)) return null
    if (/^-?\d+(?:\.\d+)?$/.test(value)) { const number = Number(value); if (!Number.isFinite(number)) bad(); return number }
    return value
  }
  const lines = front.split('\n').map(raw => {
    if (raw.includes('\t')) bad()
    const text = scan(raw, null, true).trim()
    return { indent: raw.length - raw.trimStart().length, text }
  }).filter(line => line.text)
  const item = text => text === '-' || text.startsWith('- ')
  function block(rows, start, depth = 0) {
    if (depth > 32) bad()
    const indent = rows[start].indent, list = item(rows[start].text), out = list ? [] : {}
    let index = start
    while (index < rows.length && rows[index].indent >= indent) {
      const row = rows[index]
      if (row.indent !== indent || item(row.text) !== list) bad()
      index++
      if (list) {
        const rest = row.text.slice(1).trim()
        if (rest && scan(rest, ':').length === 2) {
          let end = index
          while (end < rows.length && rows[end].indent > indent) end++
          const nested = [{ indent: indent + 2, text: rest }, ...rows.slice(index, end)]
          const [value, used] = block(nested, 0, depth + 1)
          if (used !== nested.length) bad()
          out.push(value); index = end
        } else if (rest) out.push(scalar(rest))
        else if (index < rows.length && rows[index].indent > indent) { let value; [value, index] = block(rows, index, depth + 1); out.push(value) }
        else out.push(null)
      } else {
        const parts = scan(row.text, ':')
        if (parts.length !== 2) bad()
        const key = keyName(parts[0]), rest = parts[1].trim()
        let value = null
        if (rest) value = scalar(rest)
        else if (index < rows.length && rows[index].indent > indent) [value, index] = block(rows, index, depth + 1)
        else if (index < rows.length && rows[index].indent === indent && item(rows[index].text)) {
          // YAML permits a block sequence at its owning key's indentation.
          let end = index + 1
          while (end < rows.length && (rows[end].indent > indent || item(rows[end].text))) end++
          const [nested, used] = block(rows.slice(index, end), 0, depth + 1)
          if (used !== end - index) bad()
          value = nested; index = end
        }
        put(out, key, value)
      }
      if (index < rows.length && rows[index].indent > indent) bad()
    }
    return [out, index]
  }
  if (!lines.length || lines[0].indent !== 0 || item(lines[0].text)) bad()
  const [settings, used] = block(lines, 0)
  if (used !== lines.length) bad()
  return settings
}
function definition(bytes, path) {
  const raw = utf8(bytes, path)
  const lines = raw.split(/\r?\n/)
  if (lines[0] !== '---') fail('PACKAGE_SCHEMA', `${path} requires frontmatter`)
  const end = lines.findIndex((line, index) => index > 0 && line === '---')
  if (end < 0) fail('PACKAGE_SCHEMA', `${path} has unterminated frontmatter`)
  const front = lines.slice(1, end).join('\n')
  if (front.length > 32768) fail('PACKAGE_SCHEMA', `${path} frontmatter exceeds 32768 characters`)
  const settings = frontmatter(front, path)
  checkConfig(settings, path)
  // Keep the exact body, including CRLF, indentation and trailing whitespace.
  const header = /^(---\r?\n)([\s\S]*?)(\r?\n---)(?:\r?\n|$)/.exec(raw)
  return { settings, body: raw.slice(header[0].length) }
}
function stringList(value, label) {
  if (!Array.isArray(value) || value.length > 256 || Array.from(value).some(item => typeof item !== 'string' || !item || item.length > 256) || new Set(value).size !== value.length) fail('PACKAGE_SCHEMA', `${label} must be a list of distinct bounded strings`)
  return [...value]
}
function validateSettings(settings, path, root) {
  try { validateLoopBudget(settings, { authored: true, prefix: `${path}.` }) }
  catch (error) { fail('PACKAGE_SCHEMA', error.message) }
  if (typeof settings.id !== 'string' || !ID.test(settings.id)) fail('PACKAGE_SCHEMA', `${path} requires a stable lowercase id`)
  if (settings.workflows !== undefined && (!root || typeof settings.workflows !== 'string')) fail('PACKAGE_SCHEMA', `${path}.workflows must be a root-only manifest reference`)
  if (!root && (Object.hasOwn(settings, 'package_id') || Object.hasOwn(settings, 'package_version'))) fail('PACKAGE_SCHEMA', `${path} cannot redefine root package identity`)
  for (const key of ['name', 'description', 'model']) if (settings[key] !== undefined && (typeof settings[key] !== 'string' || !settings[key].trim() || settings[key].length > (key === 'description' ? 4000 : 256))) fail('PACKAGE_SCHEMA', `${path}.${key} must be bounded text`)
  if (settings.model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(settings.model)) fail('PACKAGE_SCHEMA', `${path}.model must be a desk profile alias, not a transport URL`)
  for (const key of ['private', 'remembers', 'require_verification']) if (settings[key] !== undefined && typeof settings[key] !== 'boolean') fail('PACKAGE_SCHEMA', `${path}.${key} must be boolean`)
  for (const [key, min, max] of [['output_reserve', 1, 1000000], ['max_output_tokens', 1, 1000000], ['context_length', 1, 10000000]]) if (settings[key] !== undefined && (!Number.isSafeInteger(settings[key]) || settings[key] < min || settings[key] > max)) fail('PACKAGE_SCHEMA', `${path}.${key} is outside the supported bound`)
  if (settings.temperature !== undefined && (typeof settings.temperature !== 'number' || !Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 2)) fail('PACKAGE_SCHEMA', `${path}.temperature is invalid`)
  if (settings.compact_at !== undefined && (typeof settings.compact_at !== 'number' || settings.compact_at <= 0 || settings.compact_at > 1)) fail('PACKAGE_SCHEMA', `${path}.compact_at is invalid`)
  if (settings.session !== undefined && !['agent', 'task'].includes(settings.session)) fail('PACKAGE_SCHEMA', `${path}.session must be agent or task`)
  if (settings.contract_version !== undefined && ![1, 2, 3].includes(settings.contract_version)) fail('PACKAGE_SCHEMA', `${path} has an unsupported response contract`)
  if (settings.response_format !== undefined && !['json', 'toon'].includes(settings.response_format)) fail('PACKAGE_SCHEMA', `${path} has an unsupported response format`)
  if ((settings.contract_version ?? 2) >= 2 && settings.response_format !== undefined && settings.response_format !== 'json') fail('PACKAGE_SCHEMA', `${path} contract version ${settings.contract_version ?? 2} requires json`)
  if (settings.history_format !== undefined && !['transcript', 'messages'].includes(settings.history_format)) fail('PACKAGE_SCHEMA', `${path} has an unsupported history format`)
  if (settings.observation_format !== undefined && !['legacy', 'compact'].includes(settings.observation_format)) fail('PACKAGE_SCHEMA', `${path} has an unsupported observation format`)
  if (settings.tools !== undefined) stringList(settings.tools, `${path}.tools`)
  if (settings.context !== undefined && !plain(settings.context)) stringList(settings.context, `${path}.context`)
  if (settings.skills !== undefined && typeof settings.skills !== 'boolean') stringList(settings.skills, `${path}.skills`)
  if (settings.permissions !== undefined && (!plain(settings.permissions) || Object.values(settings.permissions).some(value => !['allow', 'ask', 'deny'].includes(value)))) fail('PACKAGE_SCHEMA', `${path}.permissions must contain allow, ask or deny requests`)
  if (settings.services !== undefined && (!plain(settings.services) || Object.entries(settings.services).some(([name, id]) => !['compaction', 'retrospective'].includes(name) || typeof id !== 'string' || !ID.test(id)))) fail('PACKAGE_SCHEMA', `${path}.services must map compaction or retrospective to package-local agent IDs`)
}

/** Infrastructure is explicit package composition, never inferred from a filename. */
function validateServices(agents) {
  const byId = new Map(agents.map(agent => [agent.id, agent]))
  for (const agent of agents) for (const [name, id] of Object.entries(agent.settings.services ?? {})) {
    const target = byId.get(id)
    if (!target || id === agent.id) fail('PACKAGE_REFERENCE', `${agent.path} has a missing or self-referencing ${name} service: ${id}`)
  }
  const visiting = new Set(), visited = new Set()
  function visit(agent) {
    if (visiting.has(agent.id)) fail('PACKAGE_REFERENCE', `cyclic agent service references include ${agent.id}`)
    if (visited.has(agent.id)) return
    visiting.add(agent.id)
    for (const id of Object.values(agent.settings.services ?? {})) visit(byId.get(id))
    visiting.delete(agent.id); visited.add(agent.id)
  }
  agents.forEach(visit)
  for (const agent of agents) {
    const target = byId.get(agent.settings.services?.compaction)
    if (!target) continue
    const settings = target.settings
    if (settings.tools?.length || Object.keys(target.delegates).length || Object.keys(settings.services ?? {}).length || settings.skills === true || settings.skills?.length || settings.require_verification === true) fail('PACKAGE_REFERENCE', `compaction service ${target.id} must request no tools, delegates, services, skills or verification`)
  }
}

/** Input paths are relative to the selected folder root, not prefixed by its UI name. */
export async function importAgentPackage(records, { limits: requestedLimits } = {}) {
  const limits = limitsFor(requestedLimits)
  if (!Array.isArray(records) || !records.length || records.length > limits.maxFiles + 1) fail('PACKAGE_LIMIT', 'file count exceeds the import limit')
  const bytesByPath = new Map(), aliases = new Set()
  let total = 0
  // Detach every byte before the first await: caller mutation cannot change a staged revision.
  for (const record of records) {
    if (!plain(record) || Object.keys(record).some(key => !['path', 'content'].includes(key))) fail('PACKAGE_SCHEMA', 'expected only a file path and content')
    const path = pathName(record.path), alias = path.toLowerCase()
    if (aliases.has(alias)) fail('PACKAGE_DUPLICATE', `duplicate normalized file path: ${path}`)
    aliases.add(alias)
    if (path.toLowerCase().endsWith('/askk.lock.json') || alias === PACKAGE_LOCK && path !== PACKAGE_LOCK) fail('PACKAGE_LOCK', 'only the root askk.lock.json is supported')
    if (SECRET_FILE.test(path)) fail('PACKAGE_SECRET_CONFIG', `${path} is credential-bearing configuration; keep it outside the portable folder`)
    if (SCRIPT.test(path)) fail('PACKAGE_EXECUTABLE', `${path} is executable source; script descriptors and execution are not supported by this declarative importer`)
    if (typeof record.content !== 'string' && !(record.content instanceof Uint8Array)) fail('PACKAGE_SCHEMA', `${path} must contain text or Uint8Array bytes`)
    // UTF-16 length is a lower bound on its UTF-8 byte length. Reject obvious
    // excess before encoding/copying, then check the actual encoded size below.
    const minimumBytes = typeof record.content === 'string' ? record.content.length : record.content.byteLength
    if (minimumBytes > limits.maxFileBytes || total + minimumBytes > limits.maxExpandedBytes) fail('PACKAGE_LIMIT', 'expanded file bytes exceed the import limit')
    const bytes = typeof record.content === 'string' ? encoder.encode(record.content) : new Uint8Array(record.content)
    if (bytes.length > limits.maxFileBytes || (total += bytes.length) > limits.maxExpandedBytes) fail('PACKAGE_LIMIT', 'expanded file bytes exceed the import limit')
    bytesByPath.set(path, bytes)
  }
  if (bytesByPath.size - Number(bytesByPath.has(PACKAGE_LOCK)) > limits.maxFiles) fail('PACKAGE_LIMIT', 'file count exceeds the import limit')
  if (!bytesByPath.has('agent.md')) fail('PACKAGE_SCHEMA', 'the selected folder requires root agent.md')
  const paths = [...bytesByPath.keys()].sort()
  const agentPaths = paths.filter(path => path === 'agent.md' || path.endsWith('/agent.md'))
  if (agentPaths.length > limits.maxAgents) fail('PACKAGE_LIMIT', 'agent count exceeds the import limit')
  const agents = agentPaths.map(path => {
    const { settings, body } = definition(bytesByPath.get(path), path)
    validateSettings(settings, path, path === 'agent.md')
    return { id: settings.id, path, settings, body, contractVersion: settings.contract_version ?? 2, responseFormat: settings.response_format ?? ((settings.contract_version ?? 2) >= 2 ? 'json' : 'toon'), references: [], delegates: {}, notes: Object.keys(settings).filter(key => !KNOWN.has(key)).map(key => `Uninterpreted frontmatter preserved: ${key}`) }
  })
  const root = agents.find(agent => agent.path === 'agent.md')
  const packageId = root.settings.package_id, packageVersion = root.settings.package_version
  if (typeof packageId !== 'string' || packageId.length > 128 || !PACKAGE_ID.test(packageId)) fail('PACKAGE_SCHEMA', 'root agent.md requires package_id')
  if (typeof packageVersion !== 'string' || packageVersion.length > 128 || !VERSION.test(packageVersion)) fail('PACKAGE_SCHEMA', 'root agent.md requires a semantic package_version')
  const ids = new Set()
  for (const agent of agents) { if (ids.has(agent.id)) fail('PACKAGE_DUPLICATE', `duplicate agent id: ${agent.id}`); ids.add(agent.id) }
  for (const agent of agents) {
    const refer = value => {
      const path = pathName(value)
      if (path === PACKAGE_LOCK) fail('PACKAGE_LOCK', 'agent resources cannot reference the generated lock')
      if (!bytesByPath.has(path)) fail('PACKAGE_REFERENCE', `${agent.path} references missing package file ${path}`)
      if (!agent.references.includes(path)) agent.references.push(path)
      return path
    }
    if (agent.settings.prompt_template !== undefined) {
      const path = refer(agent.settings.prompt_template)
      if (!path.endsWith('.md') || !utf8(bytesByPath.get(path), path).replace(/\r\n/g, '\n').includes('\n<!-- user -->\n')) fail('PACKAGE_REFERENCE', `${agent.path} prompt template requires Markdown with a <!-- user --> separator`)
    }
    if (agent.settings.history_format === 'messages') {
      let template
      if (agent.settings.prompt_template) {
        const text = utf8(bytesByPath.get(pathName(agent.settings.prompt_template)), agent.settings.prompt_template).replace(/\r\n/g, '\n')
        const at = text.indexOf('\n<!-- user -->\n')
        template = { system: text.slice(0, at), user: text.slice(at + '\n<!-- user -->\n'.length) }
      }
      try { assertMessageHistoryTemplate(template) } catch (error) { fail('PACKAGE_SCHEMA', `${agent.path}: ${error.message}`) }
    }
    const directory = agent.path.slice(0, -'agent.md'.length)
    for (const name of ['soul.md', 'learned.md']) if (bytesByPath.has(`${directory}${name}`)) { refer(`${directory}${name}`); utf8(bytesByPath.get(`${directory}${name}`), `${directory}${name}`) }
    if (Array.isArray(agent.settings.skills)) for (const name of agent.settings.skills) { const path = refer(name); if (!path.endsWith('.md')) fail('PACKAGE_REFERENCE', 'skill references must name Markdown files'); utf8(bytesByPath.get(path), path) }
    else if (agent.settings.skills === true) for (const path of paths) if (path.startsWith(`${directory}skills/`) && path.endsWith('.md')) { refer(path); utf8(bytesByPath.get(path), path) }
    const targets = agent.settings.agents ?? []
    if (!Array.isArray(targets) && !plain(targets)) fail('PACKAGE_SCHEMA', `${agent.path}.agents must contain IDs or alias-to-ID mappings`)
    const entries = Array.isArray(targets) ? stringList(targets, `${agent.path}.agents`).map(id => [id, id]) : Object.entries(targets)
    if (entries.length > limits.maxAgents) fail('PACKAGE_LIMIT', 'too many delegation aliases')
    for (const [alias, id] of entries) {
      if (!ID.test(alias) || typeof id !== 'string' || !ids.has(id) || id === agent.id) fail('PACKAGE_REFERENCE', `${agent.path} has an invalid or unknown delegation target for ${alias}`)
      if ((agent.settings.tools ?? []).includes(alias)) fail('PACKAGE_REFERENCE', `${agent.path} delegation alias collides with a requested tool: ${alias}`)
      agent.delegates[alias] = id
    }
    agent.references.sort()
  }
  if (root.settings.workflows !== undefined) {
    await resolvePackageWorkflows(root.settings.workflows, {
      agents: ids, agentSettings: new Map(agents.map(agent => [agent.id, agent.settings])),
      refer: path => { if (!root.references.includes(path)) root.references.push(path) },
      read: path => { if (!bytesByPath.has(path)) fail('PACKAGE_REFERENCE', `missing workflow resource ${path}`); return utf8(bytesByPath.get(path), path) },
    })
    root.references.sort()
  }
  validateServices(agents)
  const inventory = []
  for (const path of paths) if (path !== PACKAGE_LOCK) inventory.push({ path, bytes: bytesByPath.get(path).length, sha256: await sha256(bytesByPath.get(path)) })
  const identity = { schemaVersion: 1, packageId, packageVersion, entryAgentId: root.id, files: inventory }
  const lock = { ...identity, revisionDigest: `sha256:${await sha256(encoder.encode(canonical(identity)))}` }
  if (bytesByPath.has(PACKAGE_LOCK)) {
    let supplied
    try { supplied = JSON.parse(utf8(bytesByPath.get(PACKAGE_LOCK), PACKAGE_LOCK)) } catch (error) { if (error.code) throw error; fail('PACKAGE_LOCK', 'supplied lock is not valid JSON') }
    if (plain(supplied) && Array.isArray(supplied.files) && supplied.files.some(file => file?.path === PACKAGE_LOCK)) fail('PACKAGE_LOCK', 'the lock cannot inventory itself')
    if (canonical(supplied) !== canonical(lock)) fail('PACKAGE_LOCK', 'supplied lock does not match authored identity and exact file bytes; it was not regenerated')
  } else {
    const bytes = encoder.encode(`${canonical(lock)}\n`)
    if (bytes.length > limits.maxFileBytes || total + bytes.length > limits.maxExpandedBytes) fail('PACKAGE_LIMIT', 'generated lock exceeds the expanded byte limit')
    bytesByPath.set(PACKAGE_LOCK, bytes)
  }
  const listing = [...inventory, { path: PACKAGE_LOCK, bytes: bytesByPath.get(PACKAGE_LOCK).length, sha256: await sha256(bytesByPath.get(PACKAGE_LOCK)) }].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const data = frozen({ schemaVersion: 1, packageId, packageVersion, entryAgentId: root.id, revisionDigest: lock.revisionDigest, agents, lock, files: listing.map(({ path }) => ({ path, encoding: 'base64', content: base64(bytesByPath.get(path)) })) })
  const source = Object.freeze({
    async list() { return frozen(listing.map(row => ({ ...row }))) },
    async read(input, { as = 'text' } = {}) {
      const path = pathName(input), bytes = bytesByPath.get(path)
      if (!bytes) fail('PACKAGE_REFERENCE', `package file not found: ${path}`)
      if (as === 'bytes') return new Uint8Array(bytes)
      if (as !== 'text') fail('PACKAGE_SCHEMA', 'read format must be text or bytes')
      return utf8(bytes, path)
    },
  })
  return Object.freeze({ data, source })
}

/** JSON storage is untrusted: revalidate bytes/lock, then compare derived metadata. */
export async function restoreAgentPackage(data, options) {
  const limits = limitsFor(options?.limits)
  if (!plain(data) || Object.keys(data).some(key => !['schemaVersion', 'packageId', 'packageVersion', 'entryAgentId', 'revisionDigest', 'agents', 'lock', 'files'].includes(key)) || data.schemaVersion !== 1 || !Array.isArray(data.files) || data.files.length > limits.maxFiles + 1 || !Array.isArray(data.agents) || data.agents.length > limits.maxAgents) fail('PACKAGE_DATA', 'unsupported stored package')
  let expanded = 0
  const records = data.files.map(file => {
    if (!plain(file) || file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > Math.ceil(limits.maxFileBytes / 3) * 4) fail('PACKAGE_DATA', 'invalid stored file')
    expanded += file.content.length / 4 * 3 - (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0)
    if (expanded > limits.maxExpandedBytes) fail('PACKAGE_LIMIT', 'stored expanded bytes exceed the import limit')
    return { path: file.path, content: unbase64(file.content) }
  })
  const restored = await importAgentPackage(records, options)
  if (canonical(data) !== canonical(restored.data)) fail('PACKAGE_DATA', 'stored derived metadata does not match the verified package')
  return restored
}
