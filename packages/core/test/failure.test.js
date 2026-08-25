import { expect, test, describe } from 'bun:test'
import { fakeClock } from '@harness/adapters-test'
import { install, handle, ModuleError, REFUSALS_KEPT } from '@harness/core'
import { testApp, history, ofType } from './doubles.js'
import { harness } from './harness.js'

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
    // The whole build, because the second half of the claim is that the debug
    // MODULE still says it — a bare App has no route to ask.
    const { app } = harness()
    const before = app.log.length
    for (let i = 0; i < REFUSALS_KEPT + 10; i++) handle(app, { method: 'GET', path: '/nowhere', headers: {}, body: {} })
    expect(app.log.length).toBe(before)
    // And it is not lost: the debug view is where a person meets it — bounded,
    // so a page left polling a wrong address does not grow memory either.
    expect(app.refusals).toHaveLength(REFUSALS_KEPT)
    expect(app.refusals[0]).toMatchObject({ method: 'GET', path: '/nowhere', status: 404, kind: 'no_route' })
    // AND IT IS SAID THROUGH THE SEAM, not read off the array: the pane is
    // handed the sentence already worded (I5), which is the whole reason a
    // failure that grew the log by nothing is not lost.
    const data = handle(app, { method: 'GET', path: '/debug', headers: {}, body: {} }).data
    const rows = /** @type {Array<Record<string, unknown>>} */ (data.refusals)
    expect(String(rows[0]?.summary)).toContain('GET /nowhere')
    expect(String(rows[0]?.statusLabel)).toContain('404')
    expect(String(data.refusalsLabel)).toContain('50 requests')
    // AND THE ID IS THE REQUEST'S, NOT THE ROW'S. Refuse once more and the row
    // that was newest keeps the id it had — an id read off a position in a ring
    // that shifts renames every row on every refusal.
    const was = String(rows[0]?.id)
    handle(app, { method: 'GET', path: '/elsewhere', headers: {}, body: {} })
    const after = /** @type {Array<Record<string, unknown>>} */ (handle(app, { method: 'GET', path: '/debug', headers: {}, body: {} }).data.refusals)
    expect(String(after[1]?.id)).toBe(was)
  })
})
