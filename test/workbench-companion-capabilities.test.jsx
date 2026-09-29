import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import CompanionCapabilities from '../src/workbench/CompanionCapabilities.jsx'

const row = (patch = {}) => ({ id: 'exec', adapter: 'bun-spawn', supported: true, grant: 'denied', availability: 'configured', dependencies: 'unchecked', readiness: 'unverified', scope: null, ...patch })
const manifest = capabilities => ({ protocol: { name: 'askk-capabilities', version: 1 }, instanceId: 'local-bun:fixture', platform: { os: 'darwin', arch: 'arm64' }, runtime: { kind: 'bun', version: '1.0' }, capabilities })
const render = (capabilities, extra = {}) => renderToStaticMarkup(<CompanionCapabilities companion={{ status: 'connected', capabilityManifest: manifest(capabilities), ...extra }}/>)

test('implemented support and a denied connection grant remain separate from checks', () => {
  const html = render([row()])
  expect(html).toContain('Host commands')
  expect(html).toContain('<dt>Built in</dt><dd>Yes</dd>')
  expect(html).toContain('<dt>Connection grant</dt><dd>Not granted</dd>')
  expect(html).toContain('<dt>Check status</dt><dd>Not checked</dd>')
  expect(html).not.toContain('<button')
})

test('an allowed grant and even an untrusted readiness claim never verify an operation', () => {
  const html = render([row({ grant: 'allowed', readiness: 'passed' })])
  expect(html).toContain('<dt>Connection grant</dt><dd>Allowed</dd>')
  expect(html).toContain('<dt>Check status</dt><dd>Not checked</dd>')
  expect(html).not.toContain('passed')
})

test('legacy and unsupported manifests report missing details without fabricating support', () => {
  for (const capabilityManifest of [null, undefined, { protocol: { name: 'askk-capabilities', version: 2 }, capabilities: [] }]) {
    const html = render([], { capabilityManifest, capabilities: ['exec'] })
    expect(html).toContain('Capability details unreported')
    expect(html).not.toContain('Host commands')
  }
})

test('disconnect hides stale grants and checks', () => {
  const html = render([row({ grant: 'allowed' })], { status: 'disconnected' })
  expect(html).toContain('Previous connection grants do not apply')
  expect(html).not.toContain('Allowed')
  expect(html).not.toContain('local-bun:fixture')
})

test('scope requirements and missing implementations explain distinct blocked states', () => {
  const html = render([row({ id: 'model-relay', availability: 'scope-required' }), row({ id: 'browser-control', supported: false, availability: 'unsupported' })])
  expect(html).toContain('Configure an allowed scope')
  expect(html).toContain('<dt>Built in</dt><dd>No</dd>')
  expect(html).toContain('does not implement this capability')
})

test('developer details expose only selected fields and remain collapsed', () => {
  const html = render([row({ token: 'row-secret', scope: { kind: 'host-process', cwd: '/workspace', filesystemIsolation: false, token: 'scope-secret', payload: 'payload-secret' } })], { token: 'connection-secret' })
  expect(html).toContain('<details><summary>Developer details</summary>')
  expect(html).toContain('/workspace')
  expect(html).toContain('filesystemIsolation')
  for (const secret of ['row-secret', 'scope-secret', 'payload-secret', 'connection-secret']) expect(html).not.toContain(secret)
})
