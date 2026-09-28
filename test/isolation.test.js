import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { prepareIsolation } from '../src/workspace/isolation.js'

const cleanups = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function fixture({ isolated = false, controller = null } = {}) {
  const calls = []; const saved = new Map(); const serviceWorker = new EventTarget()
  serviceWorker.controller = controller
  serviceWorker.register = async (url, options) => {
    calls.push({ url: url.href, ...options })
    const worker = { state: 'activated', scriptURL: url.href }
    queueMicrotask(() => { serviceWorker.controller = worker; serviceWorker.dispatchEvent(new Event('controllerchange')) })
    return { active: worker }
  }
  const window = new EventTarget(); let reloads = 0
  const replacements = { crossOriginIsolated: isolated, isSecureContext: true, navigator: { serviceWorker }, window, location: { origin: 'https://example.test', reload() { reloads++ } }, sessionStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) } }
  for (const [key, value] of Object.entries(replacements)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    cleanups.push(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key])
  }
  return { calls, saved, window, serviceWorker, reloads: () => reloads }
}

test('an already isolated legacy Pages client migrates to the current scoped worker', async () => {
  const row = fixture({ isolated: true, controller: { scriptURL: 'https://example.test/ASKK/sw.js' } })
  expect(await prepareIsolation({ base: '/ASKK/' })).toEqual({ ready: true })
  expect(row.calls).toEqual([{ url: 'https://example.test/ASKK/coi-serviceworker.js', scope: '/ASKK/', updateViaCache: 'none' }])
  expect(row.serviceWorker.controller.scriptURL).toEndWith('/coi-serviceworker.js')
  expect(row.reloads()).toBe(0)
})

test('current worker registrations still check for updated policy while header-only hosts avoid installation', async () => {
  const current = fixture({ isolated: true, controller: { scriptURL: 'https://example.test/ASKK/coi-serviceworker.js' } })
  await prepareIsolation({ base: '/ASKK/' })
  expect(current.calls).toHaveLength(1)
  const headers = fixture({ isolated: true })
  expect(await prepareIsolation({ base: '/ASKK/' })).toEqual({ ready: true })
  expect(headers.calls).toHaveLength(0)
})

test('initial isolation acknowledges persisted drafts before one bounded reload', async () => {
  const row = fixture(); let persisted = false
  const result = await prepareIsolation({ base: '/ASKK/', beforeReload: async () => { expect(row.reloads()).toBe(0); persisted = true } })
  expect(result.reloading).toBe(true); expect(persisted).toBe(true); expect(row.reloads()).toBe(1)
  const second = await prepareIsolation({ base: '/ASKK/' })
  expect(second.ready).toBe(false); expect(second.reason).toContain('after reload'); expect(row.reloads()).toBe(1)
})

test('failed draft storage cancels isolation reload without marking it attempted', async () => {
  const row = fixture()
  row.window.addEventListener('askk:before-isolation', event => event.preventDefault())
  expect((await prepareIsolation({ base: '/ASKK/' })).reason).toContain('Draft persistence failed')
  expect(row.reloads()).toBe(0); expect(row.saved.size).toBe(0)
})

test.each(['coi-serviceworker.js', 'sw.js'])('%s refreshes mutable modules but retains immutable asset caching', async entrypoint => {
  const listeners = new Map(); const calls = []
  const context = {
    URL, Headers, Response,
    self: { location: { origin: 'https://example.test' }, registration: { scope: 'https://example.test/ASKK/' }, addEventListener: (name, callback) => listeners.set(name, callback) },
    fetch: async (request, options) => { calls.push({ url: request.url, options }); return new Response('verified bytes') },
  }
  context.importScripts = script => {
    expect(script).toBe('./coi-serviceworker.js')
    runInNewContext(readFileSync(new URL('../public/coi-serviceworker.js', import.meta.url), 'utf8'), context)
  }
  runInNewContext(readFileSync(new URL(`../public/${entrypoint}`, import.meta.url), 'utf8'), context)
  async function request(path, { method = 'GET', origin = 'https://example.test' } = {}) {
    let result
    listeners.get('fetch')({ request: { url: `${origin}${path}`, method }, respondWith: value => { result = value } })
    return result ? await result : null
  }
  for (const path of ['runtime/modules/runtime/hub.js', 'agents/main/agent.md', 'models.json', 'workbench.json', 'browser-linux/generated/manifest.json', '']) {
    const response = await request(`/ASKK/${path}`)
    expect(calls.at(-1).options).toEqual({ cache: 'reload' })
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin')
  }
  for (const path of ['_next/static/chunks/abc.js', 'browser-linux/generated/c2w-node24-38d093f4a38002db/out.js']) {
    await request(`/ASKK/${path}`); expect(calls.at(-1).options).toBeUndefined()
  }
  expect(await request('/ASKK/x', { method: 'POST' })).toBeNull()
  expect(await request('/another-app/x')).toBeNull()
  expect(await request('/ASKK/x', { origin: 'https://other.test' })).toBeNull()
  expect(calls).toHaveLength(8)
})
