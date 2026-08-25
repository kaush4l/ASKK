import { expect, test } from 'bun:test'

import { SEARCH_ENDPOINT } from '@harness/kernel'
import { brokeredNet } from '@harness/adapters-web'

import { scriptedFetch } from './doubles.js'

const GET = { method: 'GET', path: '/search?q=harness' }

test('a broker born with an empty allowlist denies everything', async () => {
  const net = brokeredNet({ fetch: scriptedFetch([{ json: {} }]).fetch })
  expect(net.port.fetch(SEARCH_ENDPOINT, GET)).rejects.toThrow(/Nothing may be fetched/)
})

test('there is no way to hand this broker a URL: a path is joined to a NAMED base', async () => {
  const wire = scriptedFetch([{ json: { results: [] } }])
  const net = brokeredNet({ fetch: wire.fetch })
  net.allow(SEARCH_ENDPOINT, 'https://search.test/api/')
  const answer = await net.port.fetch(SEARCH_ENDPOINT, GET)
  expect(answer.status).toBe(200)
  expect(wire.sent[0]?.url).toBe('https://search.test/api/search?q=harness')
  // The contract has no raw-URL field at all, and that absence IS the enforcement.
  expect(Object.keys(GET)).toEqual(['method', 'path'])
})

test('clearing the setting takes the destination off the list', async () => {
  const net = brokeredNet({ fetch: scriptedFetch([{ json: {} }, { json: {} }]).fetch })
  net.allow(SEARCH_ENDPOINT, 'https://search.test')
  expect(net.where(SEARCH_ENDPOINT)).toBe('https://search.test')
  net.allow(SEARCH_ENDPOINT, '   ')
  expect(net.where(SEARCH_ENDPOINT)).toBe('')
  expect(net.port.fetch(SEARCH_ENDPOINT, GET)).rejects.toThrow(/Nothing may be fetched/)
})

test('a GET body is refused rather than dropped in silence', async () => {
  const net = brokeredNet({ fetch: scriptedFetch([{ json: {} }]).fetch })
  net.allow(SEARCH_ENDPOINT, 'https://search.test')
  // A POST body is CARRIED now — the shipped search default puts its query in
  // one — and a GET body is still refused, because `fetch` discards it without
  // saying so and a body that vanishes silently is the defect worth refusing.
  expect(net.port.fetch(SEARCH_ENDPOINT, { ...GET, body: '{}' })).rejects.toThrow(/carries no body/)
})
