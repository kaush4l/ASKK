import { expect, test, describe } from 'bun:test'
import { Glob } from 'bun'
import { CAPABILITIES, ok, problem } from '@harness/kernel'
import { testPorts, fakeClock } from '@harness/adapters-test'
import { createApp, install, handle, ModuleError } from '@harness/core'

/** @typedef {import('@harness/kernel').Manifest} Manifest */

const SEAM = new URL('../../../docs/SEAM.md', import.meta.url)
const SRC = new URL('../src/', import.meta.url).pathname

/**
 * The frozen route table, read from `docs/SEAM.md` itself. Copying it here
 * would be a second authority: the doc is the freeze point between this lane
 * and FACE, so the test that says "every seam route dispatches" has to be
 * checkable against the file that decides what a seam route is (I16).
 * @returns {Promise<Array<{method: string, path: string, view: string}>>}
 */
async function seamRoutes() {
  const rows = (await Bun.file(SEAM).text()).split('\n')
  const cells = rows.map((line) => line.split('|').map((c) => c.trim().replace(/^`|`$/g, '')))
  return cells
    .filter((c) => c.length === 7 && (c[1] === 'GET' || c[1] === 'POST') && c[2]?.startsWith('/'))
    .map((c) => ({ method: String(c[1]), path: String(c[2]), view: String(c[3]) }))
}

/**
 * @param {string} id
 * @param {Array<{method: string, path: string}>} routes
 * @param {import('@harness/kernel').CapabilityId[]} [capabilities]
 * @returns {Manifest}
 */
function manifest(id, routes, capabilities = []) {
  return { id, version: '1', title: id, summary: '', routes, capabilities, view: id }
}

/** A module that projects what it was asked and what it was granted. @param {string} view */
function echo(view) {
  return (/** @type {any} */ request, /** @type {any} */ ctx) =>
    ok(view, { path: request.path, method: request.method, clock: ctx.clock, granted: ctx.grant.granted })
}

/** @param {Array<[string, Array<{method: string, path: string}>, import('@harness/kernel').CapabilityId[]?]>} mods */
function appWith(...mods) {
  const app = createApp(testPorts({ clock: fakeClock({ start: 1000, step: 0 }) }), [...CAPABILITIES])
  for (const [id, routes, caps] of mods) install(app, manifest(id, routes, caps), echo(id))
  return app
}

describe('the registry', () => {
  test('installing a manifest appends module_installed, naming id and version', () => {
    const app = appWith(['chat', [{ method: 'GET', path: '/chat' }]])
    expect([...app.log].map((e) => e.fact)).toEqual([
      { type: 'module_installed', module: 'chat', version: '1' },
    ])
  })

  test('refuses a duplicate route by naming the route and the module that holds it', () => {
    const app = appWith(['chat', [{ method: 'GET', path: '/chat' }]])
    /** @type {any} */
    let thrown = null
    try {
      install(app, manifest('impostor', [{ method: 'GET', path: '/chat' }]), echo('impostor'))
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(ModuleError)
    expect(thrown.kind).toBe('route_conflict')
    expect(thrown.message).toContain('GET /chat')
    expect(thrown.message).toContain('chat')
    expect(app.registry.get('impostor')).toBe(null)
    expect(app.log.ofType('module_installed')).toHaveLength(1)
  })

  test('a module cannot join a live id — a version replaces, it does not stack', () => {
    const app = appWith(['chat', [{ method: 'GET', path: '/chat' }]])
    expect(() => install(app, manifest('chat', [{ method: 'GET', path: '/other' }]), echo('chat')))
      .toThrow(/already live at version 1/)
  })
})

describe('dispatch', () => {
  test('every route in the frozen seam table reaches the module that declared it', async () => {
    const routes = await seamRoutes()
    // Two parses that must agree. The cell parse is what dispatch is driven
    // from; this one counts rows a person reading the table would count, so a
    // row that stops having seven cells is a failure and not silent coverage
    // of four fewer routes (I16).
    const declared = (await Bun.file(SEAM).text()).split('\n')
      .filter((line) => /^\|\s*`?(GET|POST)`?\s*\|/.test(line)).length
    expect(routes.length).toBeGreaterThan(20)
    expect(routes.length).toBe(declared)
    /** @type {Map<string, Array<{method: string, path: string}>>} */
    const byView = new Map()
    for (const r of routes) byView.set(r.view, [...(byView.get(r.view) ?? []), { method: r.method, path: r.path }])
    const app = appWith(...[...byView].map(([view, rs]) => /** @type {[string, typeof rs]} */ ([view, rs])))
    for (const { method, path, view } of routes) {
      const res = handle(app, { method, path, headers: {}, body: {} })
      expect({ ...res, at: path }).toEqual({ status: 200, view, data: res.data, at: path })
      expect(res.data.path).toBe(path)
      expect(res.data.method).toBe(method)
    }
  })

  test('an unregistered path is the problem projection, and the sentence names the address', () => {
    const app = appWith(['chat', [{ method: 'GET', path: '/chat' }]])
    const res = handle(app, { method: 'GET', path: '/nowhere', headers: {}, body: {} })
    expect(res.status).toBe(404)
    expect(res.view).toBe('problem')
    expect(res.data.message).toBe('Nothing here answers GET /nowhere.')
    expect(res.data.repair).not.toBe('')
    expect(res).toEqual(problem(404, String(res.data.message), {
      kind: 'no_route', detail: String(res.data.detail), repair: String(res.data.repair),
    }))
  })

  test('a failure and a write are facts; a successful GET is not', () => {
    const app = appWith(['chat', [{ method: 'GET', path: '/chat' }, { method: 'POST', path: '/chat' }]])
    handle(app, { method: 'GET', path: '/chat', headers: {}, body: {} })
    expect(app.log.ofType('request_handled')).toHaveLength(0)
    handle(app, { method: 'POST', path: '/chat', headers: {}, body: {} })
    handle(app, { method: 'GET', path: '/nowhere', headers: {}, body: {} })
    expect(app.log.ofType('request_handled').map((e) => e.fact)).toEqual([
      { type: 'request_handled', path: '/chat', status: 200 },
      { type: 'request_handled', path: '/nowhere', status: 404 },
    ])
  })

  test('no file outside dispatch.js calls a module handler', async () => {
    const callers = []
    for await (const file of new Glob('*.js').scan({ cwd: SRC })) {
      if (file !== 'dispatch.js' && (await Bun.file(SRC + file).text()).includes('.handler(')) callers.push(file)
    }
    expect(callers).toEqual([])
  })
})

describe('the context a handler is handed', () => {
  test('a module granted nothing cannot read the clock, and one granted it reads the injected one', () => {
    const app = appWith(
      ['blind', [{ method: 'GET', path: '/blind' }]],
      ['timed', [{ method: 'GET', path: '/timed' }], ['clock']],
    )
    expect(handle(app, { method: 'GET', path: '/blind', headers: {}, body: {} }).data)
      .toMatchObject({ clock: null, granted: [] })
    expect(handle(app, { method: 'GET', path: '/timed', headers: {}, body: {} }).data)
      .toMatchObject({ clock: 1000, granted: ['clock'] })
  })

  test('a grant is narrowed to what this build offers, never to what was asked', () => {
    const app = createApp(testPorts(), ['clock'])
    install(app, manifest('greedy', [{ method: 'GET', path: '/g' }], ['clock', 'workspace']), echo('greedy'))
    expect(handle(app, { method: 'GET', path: '/g', headers: {}, body: {} }).data.granted).toEqual(['clock'])
  })

  test('emit is absent without the grant, and appends to the log with it', () => {
    /** @type {any} */
    let seen = null
    const app = createApp(testPorts({ clock: fakeClock({ start: 7, step: 0 }) }), [...CAPABILITIES])
    const speak = (/** @type {any} */ _req, /** @type {any} */ ctx) => {
      seen = ctx.emit
      ctx.emit?.({ type: 'agent_status', agent: 'main', status: 'idle', detail: '' })
      return ok('spoken', {})
    }
    install(app, manifest('mute', [{ method: 'GET', path: '/mute' }]), speak)
    handle(app, { method: 'GET', path: '/mute', headers: {}, body: {} })
    expect(seen).toBe(null)
    expect(app.log.ofType('agent_status')).toHaveLength(0)

    install(app, manifest('loud', [{ method: 'GET', path: '/loud' }], ['emit']), speak)
    handle(app, { method: 'GET', path: '/loud', headers: {}, body: {} })
    expect(app.log.ofType('agent_status')[0]).toMatchObject({ at: 7, fact: { agent: 'main' } })
  })
})
