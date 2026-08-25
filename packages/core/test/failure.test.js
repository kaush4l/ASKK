import { expect, test, describe } from 'bun:test'
import { fakeClock } from '@harness/adapters-test'
import { install, handle, ModuleError, REFUSALS_KEPT } from '@harness/core'
import { testApp, history, ofType } from './doubles.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */

/** @param {string} id @returns {Manifest} */
function manifest(id) {
  return {
    id,
    version: '1',
    title: id,
    summary: '',
    routes: [{ method: 'GET', path: `/${id}` }],
    capabilities: [],
    view: id,
  }
}

describe('a handler that throws', () => {
  /** @param {unknown} err @returns {import('@harness/core').App} */
  function appThatThrows(err) {
    const app = testApp(fakeClock({ start: 5, step: 0 }))
    install(app, manifest('chat'), () => {
      throw err
    })
    return app
  }

  test('a typed failure becomes the problem projection, keeping its kind and naming the module', () => {
    const app = appThatThrows(new ModuleError('invalid_manifest', 'the roster row has no id', { detail: 'row 4' }))
    const res = handle(app, { method: 'GET', path: '/chat', headers: {}, body: {} })
    expect(res.status).toBe(500)
    expect(res.view).toBe('problem')
    expect(res.data.kind).toBe('invalid_manifest')
    expect(res.data.message).toBe('The chat module failed while answering GET /chat.')
    expect(res.data.detail).toContain('the roster row has no id')
    expect(res.data.detail).toContain('row 4')
    expect(res.data.repair).not.toBe('')
    // A GET that crashed still changed nothing, so it is not a fact — it is a
    // refusal the debug view carries (`dispatch.js`).
    expect(ofType(app, 'request_handled')).toHaveLength(0)
    expect(app.refusals[0]).toMatchObject({ path: '/chat', status: 500, kind: 'invalid_manifest' })
  })

  test('an untyped bug is caught too — the catch-all runs, it is not assumed', () => {
    const app = appThatThrows(new TypeError('cannot read properties of undefined'))
    const res = handle(app, { method: 'GET', path: '/chat', headers: {}, body: {} })
    expect(res.status).toBe(500)
    expect(res.view).toBe('problem')
    expect(res.data.kind).toBe('handler_crashed')
    expect(res.data.message).toBe('The chat module failed while answering GET /chat.')
    expect(res.data.detail).toBe('cannot read properties of undefined')
    expect(ofType(app, 'request_handled')).toHaveLength(0)
    expect(app.refusals[0]).toMatchObject({ path: '/chat', status: 500, kind: 'handler_crashed' })
  })
})

describe('a request the seam would not answer', () => {
  test('a failed read grows the log by NOTHING, however many times it is polled', () => {
    const app = testApp(fakeClock({ start: 5, step: 0 }))
    const before = app.log.length
    for (let i = 0; i < REFUSALS_KEPT + 10; i++) handle(app, { method: 'GET', path: '/nowhere', headers: {}, body: {} })
    expect(app.log.length).toBe(before)
    // And it is not lost: the debug view is where a person meets it — bounded,
    // so a page left polling a wrong address does not grow memory either.
    expect(app.refusals).toHaveLength(REFUSALS_KEPT)
    expect(app.refusals[0]).toMatchObject({ method: 'GET', path: '/nowhere', status: 404, kind: 'no_route' })
  })
})
