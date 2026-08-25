import { expect, test } from 'bun:test'

import { SEARCH_ENDPOINT } from '@harness/kernel'
import { memoryKv } from '@harness/adapters-test'
import { PROFILE_KEY, brokeredNet, makeEndpoint, offered, readEndpoints, resetEndpoints, saveEndpoint, saveSearchEndpoint, useBroker } from '@harness/adapters-web'

const FILE = JSON.stringify({
  default: 'local',
  models: {
    local: { model: 'gemma-4', base_url: 'http://127.0.0.1:8873/v1' },
    openrouter: { model: 'openai/gpt-4o-mini', base_url: 'https://openrouter.ai/api/v1' },
  },
})

function broker() {
  const endpoint = makeEndpoint()
  endpoint.setCatalogue(FILE)
  const kv = memoryKv()
  const net = brokeredNet()
  useBroker({ endpoint, kv, key: PROFILE_KEY, net })
  return { endpoint, kv, net }
}

test('a key is saved through the broker\'s own door and never through the seam', async () => {
  const { kv } = broker()
  await saveEndpoint('openrouter', { apiKey: 'sk-router' })
  expect(JSON.parse(kv.map.get(PROFILE_KEY) ?? '{}').keys).toEqual({ openrouter: 'sk-router' })
})

test('the pane is told WHETHER a key is set and is never handed one', async () => {
  broker()
  await saveEndpoint('openrouter', { apiKey: 'sk-router' })
  const read = readEndpoints()
  expect(read.hasKey).toEqual({ local: false, openrouter: true })
  expect(read.selected).toBe('openrouter')
  expect(read.entries.map((e) => e.name)).toEqual(['local', 'openrouter'])
  expect(JSON.stringify(read)).not.toContain('sk-router')
})

test('saving a key into an entry repoints every agent at it', async () => {
  const { endpoint } = broker()
  expect(endpoint.resolve('local')?.name).toBe('local')
  await saveEndpoint('openrouter', { apiKey: 'sk-router' })
  // `local` is what an agent file asks for by name, and openrouter answers it.
  expect(endpoint.resolve('local')?.name).toBe('openrouter')
  expect(readEndpoints().selected).toBe('openrouter')
})

test('saving the search endpoint is what puts anything on the network allowlist', async () => {
  const { net } = broker()
  expect(net.where(SEARCH_ENDPOINT)).toBe('')
  await saveSearchEndpoint('https://search.test/')
  expect(net.where(SEARCH_ENDPOINT)).toBe('https://search.test')
  await saveSearchEndpoint('')
  expect(net.where(SEARCH_ENDPOINT)).toBe('')
})

test('a reset forgets the keys and takes the search destination off the list', async () => {
  const { net, kv } = broker()
  await saveEndpoint('openrouter', { apiKey: 'sk-router' })
  await saveSearchEndpoint('https://search.test')
  await resetEndpoints()
  expect(net.where(SEARCH_ENDPOINT)).toBe('')
  expect(JSON.parse(kv.map.get(PROFILE_KEY) ?? '{}').keys).toEqual({})
})

test('this build states what it offers: delegation only where a Worker can start, files only where the browser has them', () => {
  expect(offered(true, false)).not.toContain('agents')
  expect(offered(true, true)).toContain('workspace')
  expect(offered(false, true)).not.toContain('workspace')
  expect(offered(true, true)).toContain('model')
  expect(offered(true, true)).toContain('agents')
})
