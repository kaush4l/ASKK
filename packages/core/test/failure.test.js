import { expect, test, describe } from 'bun:test'
import { fakeClock } from '@harness/adapters-test'
import { install, handle, ModuleError } from '@harness/core'
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
    expect(ofType(app, 'request_handled').map((e) => e.fact)).toEqual([
      { type: 'request_handled', path: '/chat', status: 500 },
    ])
  })

  test('an untyped bug is caught too — the catch-all runs, it is not assumed', () => {
    const app = appThatThrows(new TypeError('cannot read properties of undefined'))
    const res = handle(app, { method: 'GET', path: '/chat', headers: {}, body: {} })
    expect(res.status).toBe(500)
    expect(res.view).toBe('problem')
    expect(res.data.kind).toBe('handler_crashed')
    expect(res.data.message).toBe('The chat module failed while answering GET /chat.')
    expect(res.data.detail).toBe('cannot read properties of undefined')
    expect(ofType(app, 'request_handled')).toHaveLength(1)
  })
})
