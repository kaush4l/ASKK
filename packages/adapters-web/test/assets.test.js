import { afterEach, expect, test } from 'bun:test'

import { StoreError } from '@harness/kernel'
import { fetchText } from '@harness/adapters-web'

const real = globalThis.fetch

afterEach(() => {
  globalThis.fetch = real
})

/** @param {(url: string) => Response|Promise<Response>} answer */
function scripted(answer) {
  globalThis.fetch = /** @type {typeof fetch} */ (/** @type {unknown} */ ((/** @type {string} */ url) => Promise.resolve(answer(String(url)))))
}

test('an asset that is there comes back as text', async () => {
  scripted(() => new Response('{"default":"local"}', { status: 200 }))
  const got = await fetchText('./', 'models.json')
  expect(got instanceof StoreError).toBe(false)
  expect(got instanceof StoreError ? '' : got.text).toBe('{"default":"local"}')
})

test('a 404 catalogue names the address and the status instead of coming back empty', async () => {
  scripted(() => new Response('nope', { status: 404, statusText: 'Not Found' }))
  const got = await fetchText('/ASKK/', 'models.json')
  expect(got instanceof StoreError).toBe(true)
  if (!(got instanceof StoreError)) throw new Error('unreachable')
  expect(got.key).toBe('/ASKK/models.json')
  expect(got.message).toContain('404')
  expect(got.detail).toContain('/ASKK/models.json')
})

test('a fetch that never completes is a reason, not a null', async () => {
  scripted(() => {
    throw new TypeError('Failed to fetch')
  })
  const got = await fetchText('./', 'models.json')
  expect(got instanceof StoreError).toBe(true)
  if (!(got instanceof StoreError)) throw new Error('unreachable')
  expect(got.detail).toContain('Failed to fetch')
})
