/** Shipped declarative folders use the same validator and compiler as owner imports. */
import { importAgentPackage, PACKAGE_LIMITS } from '../core/agent-package.js'
import { compileAgentPackage } from '../core/package-spec.js'
import { versioned } from '../core/folder.js'
import { snapshot } from '../core/prompt.js'

const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const fail = message => { throw Object.assign(new Error(`Agent desk configuration: ${message}`), { code: 'DESK_PACKAGES' }) }
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key))
const safePath = value => typeof value === 'string' && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) && value.split('/').every(part => part !== '.' && part !== '..')
const safePublishedPath = value => typeof value === 'string' && value.length <= 1024 && value === value.normalize('NFC') && !/[\\:%?#\u0000-\u001f\u007f]/.test(value) && value.split('/').length <= 32 && value.split('/').every(part => part && part !== '.' && part !== '..' && part.trim() === part && !part.endsWith('.'))
const digest = async (bytes, algorithm) => [...new Uint8Array(await crypto.subtle.digest(algorithm, bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
const cancelBody = response => { try { Promise.resolve(response.body?.cancel()).catch(() => {}) } catch {} }

// Some fetch adapters ignore AbortSignal. Bound their promises as well as the
// browser transport, so a stalled resource cannot leave the desk booting forever.
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

async function publishedBytes(path, { base, index, fetch: fetcher, signal }, limit) {
  signal.throwIfAborted()
  const expected = index?.files?.[path]
  if (typeof expected !== 'string' || !/^(?:[a-f0-9]{10}|[a-f0-9]{64})$/.test(expected)) fail(`${path} is missing from the published content index`)
  const response = await abortable(Promise.resolve(fetcher(versioned(base, path, index), { cache: 'no-cache', signal })).then(response => {
    if (signal.aborted) { cancelBody(response); signal.throwIfAborted() }
    return response
  }), signal)
  if (!response.ok) { cancelBody(response); fail(`${path} answered ${response.status}`) }
  if (Number(response.headers.get('content-length')) > limit) { cancelBody(response); fail(`${path} exceeds its byte limit`) }
  const reader = response.body?.getReader()
  let bytes
  if (reader) {
    const chunks = []; let size = 0
    const cancel = () => { Promise.resolve(reader.cancel(signal.reason)).catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      for (;;) {
        signal.throwIfAborted()
        const next = await abortable(reader.read(), signal)
        if (next.done) break
        size += next.value.byteLength
        if (size > limit) { cancel(); fail(`${path} exceeds its byte limit`) }
        chunks.push(next.value)
      }
    } finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
    bytes = new Uint8Array(size); let at = 0
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength }
  } else {
    bytes = new Uint8Array(await abortable(response.arrayBuffer(), signal))
    if (bytes.byteLength > limit) fail(`${path} exceeds its byte limit`)
  }
  const actual = await digest(bytes, expected.length === 10 ? 'SHA-1' : 'SHA-256')
  signal.throwIfAborted()
  if (actual.slice(0, expected.length) !== expected) fail(`${path} does not match the published index; reload after deployment finishes`)
  return bytes
}

/**
 * No name-based discovery, implicit model grant, legacy fallback, or activation.
 * Return the complete candidate catalogue only after every configured package validates.
 */
export async function loadDeskPackages({ signal, timeoutMs = 30000, ...input }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) fail('package download timeout must be between 1 and 120000 milliseconds')
  const abort = new AbortController()
  const cancelled = () => abort.abort(signal.reason)
  signal?.addEventListener('abort', cancelled, { once: true })
  if (signal?.aborted) cancelled()
  const timer = setTimeout(() => abort.abort(Object.assign(new Error('Agent desk configuration: package download timed out. Check the connection and reload.'), { code: 'DESK_PACKAGES_TIMEOUT' })), timeoutMs)
  try { return await abortable(loadCandidate({ ...input, signal: abort.signal }), abort.signal) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); abort.abort() }
}

async function loadCandidate({ base, index, fetch: fetcher = fetch, catalogue, signal }) {
  const source = { base, index, fetch: fetcher, signal }
  let configuration
  try { configuration = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await publishedBytes('desk.json', source, 65536))) }
  catch (error) { if (error.code === 'DESK_PACKAGES') throw error; fail(`desk.json is unreadable: ${error.message}`) }
  if (!plain(configuration) || !only(configuration, ['version', 'defaultAgent', 'packages']) || configuration.version !== 1 || !Array.isArray(configuration.packages) || !configuration.packages.length || configuration.packages.length > 32 || typeof configuration.defaultAgent !== 'string') fail('desk.json requires version 1, a defaultAgent and 1–32 explicit packages')
  const ids = new Set(), roots = new Set()
  const entries = configuration.packages.map(entry => {
    if (!plain(entry) || !only(entry, ['id', 'path', 'models', 'tools']) || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(entry.id) || !safePath(entry.path) || !entry.path.startsWith('packages/') || !plain(entry.models) || !Array.isArray(entry.tools)) fail('each package requires an id, packages/ folder and explicit model/tool bindings')
    if (ids.has(entry.id) || [...roots].some(path => path === entry.path || path.startsWith(`${entry.path}/`) || entry.path.startsWith(`${path}/`))) fail('package identities and source folders must be distinct and cannot overlap')
    ids.add(entry.id); roots.add(entry.path)
    const files = Object.keys(index.files).filter(path => path.startsWith(`${entry.path}/`)).sort()
    if (!files.length || files.length > PACKAGE_LIMITS.maxFiles + 1) fail(`${entry.path} has no files or exceeds the package file limit`)
    if (files.some(path => !safePublishedPath(path))) fail(`${entry.path} contains an unsafe published file path`)
    return { ...entry, files }
  })
  const specs = [], packages = []; let total = 0
  for (const entry of entries) {
    signal.throwIfAborted()
    const prefix = `${entry.path}/`
    const { files } = entry
    const records = []
    // Bound parallel downloads. All reads settle before a failed batch is reported.
    for (let offset = 0; offset < files.length; offset += 8) {
      const batch = await Promise.allSettled(files.slice(offset, offset + 8).map(async path => ({ path: path.slice(prefix.length), content: await publishedBytes(path, source, PACKAGE_LIMITS.maxFileBytes) })))
      const failed = batch.find(row => row.status === 'rejected')
      if (failed) throw failed.reason
      for (const row of batch) { total += row.value.content.byteLength; if (total > 128 * 1024 * 1024) fail('shipped packages exceed the total byte limit'); records.push(row.value) }
    }
    const pkg = await importAgentPackage(records)
    const compiled = await compileAgentPackage(pkg, { installationId: entry.id, namespace: 'bundled', bindings: { models: entry.models, tools: entry.tools }, catalogue, index })
    signal.throwIfAborted()
    specs.push(...compiled)
    packages.push(snapshot({ id: entry.id, namespace: 'bundled', path: entry.path, packageId: pkg.data.packageId, packageVersion: pkg.data.packageVersion, revisionDigest: pkg.data.revisionDigest, agents: compiled.map(spec => spec.path) }))
  }
  if (!specs.some(spec => spec.path === configuration.defaultAgent)) fail('defaultAgent must name an available agent in a configured shipped package')
  return snapshot({ defaultAgent: configuration.defaultAgent, specs, packages })
}
