/** Authenticated capability descriptions. Configuration never establishes readiness. */
const adapters = Object.freeze({ fs: 'root-filesystem', exec: 'host-process', terminal: 'bun-pty', fetch: 'http-fetch', 'model-relay': 'http-model-relay', 'network-relay': 'http-network-relay', 'browser-control': null })
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const equal = (left, right) => {
  if (left === right) return true
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]))
  if (!record(left) || !record(right)) return false
  const keys = Object.keys(left).sort()
  return equal(keys, Object.keys(right).sort()) && keys.every(key => equal(left[key], right[key]))
}
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
const invalid = () => { throw Object.assign(new Error('The companion returned an unsupported or inconsistent capability manifest. Update or reconnect the companion.'), { code: 'companion_manifest' }) }

function scopeFor(id, host) {
  if (id === 'fs') return { kind: 'root', root: host.root }
  if (id === 'exec' || id === 'terminal') return { kind: 'host-process', cwd: host.root, filesystemIsolation: false }
  if (id === 'model-relay') return { kind: 'model-endpoints', endpoint: '/model/fetch', endpoints: [...host.modelRelay.endpoints] }
  if (id === 'fetch' || id === 'network-relay') return { kind: 'http-network', endpoint: id === 'fetch' ? '/fetch' : '/network/fetch', protocols: ['http:', 'https:'] }
  return null
}

/** Only the host calls this builder; consumers must validate the authenticated response. */
export function createCompanionManifest(host, platform) {
  return freeze({
    protocol: { name: 'askk-capabilities', version: 1 }, instanceId: host.runtimeId,
    platform: { os: platform.os, arch: platform.arch }, runtime: { kind: host.runtime, version: host.version },
    capabilities: Object.entries(adapters).map(([id, adapter]) => ({
      id, adapter, supported: adapter !== null, grant: host.capabilities.includes(id) ? 'allowed' : 'denied',
      availability: adapter === null ? 'unsupported' : id === 'model-relay' && !host.modelRelay.endpoints.length ? 'scope-required' : 'configured',
      dependencies: 'unchecked', readiness: 'unverified', scope: scopeFor(id, host),
    })),
  })
}

/** Missing manifests are legacy/unreported, never fabricated implementation or probe evidence. */
export function readCompanionManifest(authenticated) {
  if (!Object.hasOwn(authenticated ?? {}, 'capabilityManifest')) return null
  const manifest = authenticated.capabilityManifest
  if (!record(manifest) || !equal(manifest.protocol, { name: 'askk-capabilities', version: 1 })
    || typeof authenticated.runtimeId !== 'string' || !authenticated.runtimeId || manifest.instanceId !== authenticated.runtimeId
    || typeof authenticated.runtime !== 'string' || !authenticated.runtime || typeof authenticated.version !== 'string' || !authenticated.version
    || !equal(manifest.runtime, { kind: authenticated.runtime, version: authenticated.version })
    || !record(manifest.platform) || typeof manifest.platform.os !== 'string' || !manifest.platform.os || typeof manifest.platform.arch !== 'string' || !manifest.platform.arch
    || typeof authenticated.root !== 'string' || !authenticated.root
    || !Array.isArray(authenticated.capabilities) || new Set(authenticated.capabilities).size !== authenticated.capabilities.length
    || authenticated.capabilities.some(id => !Object.hasOwn(adapters, id) || id === 'browser-control')
    || !record(authenticated.modelRelay) || authenticated.modelRelay.version !== 1 || authenticated.modelRelay.endpoint !== '/model/fetch'
    || !Array.isArray(authenticated.modelRelay.endpoints) || authenticated.modelRelay.endpoints.length > 32
    || new Set(authenticated.modelRelay.endpoints).size !== authenticated.modelRelay.endpoints.length
    || authenticated.modelRelay.endpoints.some(endpoint => {
      if (typeof endpoint !== 'string') return true
      try { const url = new URL(endpoint); return !['http:', 'https:'].includes(url.protocol) || !!(url.username || url.password || url.search || url.hash) } catch { return true }
    })
    || authenticated.modelRelay.status !== (authenticated.modelRelay.endpoints.length ? 'configured' : 'scope-required')
    || !Array.isArray(manifest.capabilities) || manifest.capabilities.length !== Object.keys(adapters).length) invalid()
  const expected = createCompanionManifest(authenticated, manifest.platform)
  const seen = new Set()
  for (const capability of manifest.capabilities) {
    if (!record(capability) || seen.has(capability.id) || !equal(capability, expected.capabilities.find(row => row.id === capability.id))) invalid()
    seen.add(capability.id)
  }
  // Canonical row order and known fields keep identity stable across equivalent replies.
  return expected
}
