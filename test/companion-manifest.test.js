import { expect, test } from 'bun:test'
import { createCompanionManifest, readCompanionManifest } from '../src/core/companion-manifest.js'

function identity(grants = ['model-relay'], endpoints = ['http://127.0.0.1:8873/v1']) {
  const host = { runtimeId: 'local-bun:test', root: '/workspace', runtime: 'bun', version: '1.4.2', capabilities: grants, modelRelay: { version: 1, endpoint: '/model/fetch', endpoints, status: endpoints.length ? 'configured' : 'scope-required' } }
  host.capabilityManifest = structuredClone(createCompanionManifest(host, { os: 'darwin', arch: 'arm64' }))
  return host
}

test('legacy hosts are unreported and absent grants never become implementation or readiness claims', () => {
  expect(readCompanionManifest({ capabilities: ['fetch'] })).toBeNull()
  const manifest = readCompanionManifest(identity())
  expect(manifest.capabilities.find(row => row.id === 'exec')).toMatchObject({ supported: true, grant: 'denied', dependencies: 'unchecked', readiness: 'unverified', scope: { filesystemIsolation: false } })
  expect(manifest.capabilities.find(row => row.id === 'browser-control')).toMatchObject({ supported: false, grant: 'denied', availability: 'unsupported', adapter: null, scope: null })
  expect(manifest.capabilities.every(row => row.readiness === 'unverified')).toBe(true)
  expect(Object.isFrozen(manifest.capabilities[0].scope)).toBe(true)
})

test('scope required remains separate from implementation, grants and dependency checks', () => {
  const manifest = readCompanionManifest(identity(['model-relay'], []))
  expect(manifest.capabilities.find(row => row.id === 'model-relay')).toMatchObject({ supported: true, grant: 'allowed', availability: 'scope-required', dependencies: 'unchecked', readiness: 'unverified' })
})

test('manifest authority cannot disagree with authenticated legacy grants, scope or runtime', () => {
  const changes = [
    host => { host.capabilityManifest = null },
    host => { host.capabilityManifest.protocol.version = 2 },
    host => { host.capabilityManifest.instanceId = 'another-runtime' },
    host => { host.capabilityManifest.runtime.kind = 'python' },
    host => { host.capabilityManifest.capabilities[0].grant = 'allowed' },
    host => { host.capabilityManifest.capabilities[0].readiness = 'ready' },
    host => { host.capabilityManifest.capabilities[0].dependencies = 'verified' },
    host => { host.capabilityManifest.capabilities[1].scope.filesystemIsolation = true },
    host => { host.modelRelay.endpoints = ['https://other.example/v1'] },
    host => { host.modelRelay.status = 'scope-required' },
    host => { host.capabilities.push('browser-control') },
    host => { host.capabilityManifest.capabilities.push(host.capabilityManifest.capabilities[0]) },
    host => { host.capabilityManifest.capabilities[1] = host.capabilityManifest.capabilities[0] },
  ]
  for (const change of changes) { const host = identity(); change(host); expect(() => readCompanionManifest(host)).toThrow(expect.objectContaining({ code: 'companion_manifest' })) }
})

test('validated manifest is a detached immutable snapshot and row order is not authority', () => {
  const host = identity(); const canonical = readCompanionManifest(host); host.capabilityManifest.capabilities.reverse()
  const snapshot = readCompanionManifest(host)
  expect(snapshot).toEqual(canonical)
  host.capabilityManifest.capabilities.find(row => row.id === 'model-relay').scope.endpoints.push('https://changed.example/v1')
  expect(snapshot.capabilities.find(row => row.id === 'model-relay').scope.endpoints).toEqual(['http://127.0.0.1:8873/v1'])
})
