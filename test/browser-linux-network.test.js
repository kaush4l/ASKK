import { describe, test, expect } from 'bun:test'
import { browserRequestOptions } from '../public/browser-linux/network-policy.js'

describe('anonymous npm browser transport', () => {
  test('removes captured optional metadata without mutating the guest request', () => {
    const signal = new AbortController().signal
    const options = { method: 'GET', signal, headers: { Accept: 'application/vnd.npm.install-v1+json', 'npm-command': 'install', 'npm-auth-type': 'web', 'pacote-pkg-id': 'registry:left-pad@1.3.0', 'pacote-req-type': 'packument', 'pacote-version': '21.0.0' } }
    const result = browserRequestOptions('https://registry.npmjs.org/left-pad', options)
    expect([...result.headers.keys()]).toEqual(['accept'])
    expect(result.headers.get('accept')).toBe(options.headers.Accept)
    expect(result.signal).toBe(signal)
    expect(options.headers['npm-command']).toBe('install')
  })
  test('supports public package archives but retains unrelated headers', () => {
    const options = { method: 'HEAD', integrity: 'sha256-test-fixture', headers: { 'npm-command': 'install', 'pacote-integrity': 'sha512-test-fixture', 'x-custom-policy': 'keep' } }
    const result = browserRequestOptions('https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', options)
    expect(result.headers.get('x-custom-policy')).toBe('keep')
    expect(result.headers.has('npm-command')).toBe(false)
    expect(result.headers.has('pacote-integrity')).toBe(false)
    expect(result.integrity).toBe(options.integrity)
  })
  test('never rewrites authenticated, scoped, custom-origin, or write requests', () => {
    for (const [url, extra] of [
      ['https://registry.npmjs.org/left-pad', { headers: { authorization: 'test-only' } }],
      ['https://registry.npmjs.org/left-pad', { headers: { 'proxy-authorization': 'test-only' } }],
      ['https://registry.npmjs.org/left-pad', { headers: { cookie: 'test-only' } }],
      ['https://registry.npmjs.org/@scope%2fpackage', {}],
      ['https://registry.npmjs.org/%40scope%2fpackage', {}],
      ['https://registry.example.test/left-pad', {}],
      ['https://registry.npmjs.org.example.test/left-pad', {}],
      ['http://registry.npmjs.org/left-pad', {}],
      ['https://registry.npmjs.org/left-pad', { method: 'POST' }],
      ['https://user:secret@registry.npmjs.org/left-pad', {}],
    ]) {
      const options = { ...extra, headers: { 'npm-command': 'install', ...extra.headers } }
      expect(browserRequestOptions(url, options)).toBe(options)
    }
  })
})
