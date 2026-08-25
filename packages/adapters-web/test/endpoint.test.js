import { expect, test } from 'bun:test'

import { makeEndpoint } from '@harness/adapters-web'

const FILE = JSON.stringify({
  default: 'local',
  models: {
    local: { model: 'gemma-4', base_url: 'http://127.0.0.1:8873/v1' },
    openrouter: { model: 'openai/gpt-4o-mini', base_url: 'https://openrouter.ai/api/v1' },
  },
})

/** @returns {ReturnType<typeof makeEndpoint>} */
function endpoint() {
  const e = makeEndpoint()
  e.setCatalogue(FILE)
  return e
}

test("one entry's key never travels to another entry", () => {
  const e = endpoint()
  e.selectAndSave('openrouter', { apiKey: 'sk-router' })
  expect(e.apiKeyFor('openrouter')).toBe('sk-router')
  expect(e.apiKeyFor('local')).toBe('')
  expect(e.keyed()).toEqual({ local: false, openrouter: true })
})

test('a blank key field keeps the stored secret; an empty string clears it', () => {
  const e = endpoint()
  e.selectAndSave('openrouter', { apiKey: 'sk-router' })
  e.selectAndSave('openrouter', { baseUrl: 'https://openrouter.ai/api/v2' })
  expect(e.apiKeyFor('openrouter')).toBe('sk-router')
  e.selectAndSave('openrouter', { apiKey: '' })
  expect(e.apiKeyFor('openrouter')).toBe('')
  expect(e.entry('openrouter')?.baseUrl).toBe('https://openrouter.ai/api/v2')
})

test('a save that mentions neither URL nor model leaves that entry\'s overrides standing', () => {
  const e = endpoint()
  e.selectAndSave('local', { baseUrl: 'http://custom/v1' })
  e.selectAndSave('local', { apiKey: 'sk-x' })
  expect(e.entry('local')?.baseUrl).toBe('http://custom/v1')
})

test('typing the shipped value back in UNDOES that field, and leaves the other override alone', () => {
  const e = endpoint()
  e.selectAndSave('local', { baseUrl: 'http://custom/v1', model: 'other' })
  e.selectAndSave('local', { baseUrl: 'http://127.0.0.1:8873/v1', model: 'other' })
  expect(e.entry('local')?.baseUrl).toBe('http://127.0.0.1:8873/v1')
  expect(e.entry('local')?.model).toBe('other')
})

test('saving a field equal to the file is agreement, not an override', () => {
  const e = endpoint()
  e.selectAndSave('local', { baseUrl: 'http://127.0.0.1:8873/v1', model: 'gemma-4' })
  const moved = makeEndpoint()
  moved.loadProfile(e.profileJson())
  moved.setCatalogue(JSON.stringify({ default: 'local', models: { local: { model: 'gemma-5', base_url: 'http://127.0.0.1:9000/v1' } } }))
  expect(moved.resolve('local')?.model).toBe('gemma-5')
})

test('editing one entry does not drop what was saved for another', () => {
  const e = endpoint()
  e.selectAndSave('local', { baseUrl: 'http://localhost:1234/v1' })
  e.selectAndSave('openrouter', { baseUrl: 'https://example.test/v1' })
  expect(e.entry('local')?.baseUrl).toBe('http://localhost:1234/v1')
  expect(e.entry('openrouter')?.baseUrl).toBe('https://example.test/v1')
})

test('the pick outranks the agent file, and listing entries ignores the pick', () => {
  const e = endpoint()
  e.select('openrouter')
  expect(e.resolve('local')?.name).toBe('openrouter')
  expect(e.entry('local')?.name).toBe('local')
})

test('the profile round-trips the pick, the overrides, the keys and the search endpoint', () => {
  const e = endpoint()
  e.select('openrouter')
  e.selectAndSave('openrouter', { apiKey: 'sk-router', baseUrl: 'https://example.test/v1' })
  e.setSearch('https://search.test/')
  const back = makeEndpoint()
  back.setCatalogue(FILE)
  back.loadProfile(e.profileJson())
  expect(back.current()).toBe('openrouter')
  expect(back.apiKeyFor('openrouter')).toBe('sk-router')
  expect(back.resolve('')?.baseUrl).toBe('https://example.test/v1')
  expect(back.search()).toBe('https://search.test')
})

test('reset forgets the pick, the overrides and every saved key', () => {
  const e = endpoint()
  e.selectAndSave('openrouter', { apiKey: 'sk-router', baseUrl: 'https://example.test/v1' })
  e.select('openrouter')
  e.reset()
  expect(e.current()).toBe('local')
  expect(e.apiKeyFor('openrouter')).toBe('')
  expect(e.entry('openrouter')?.baseUrl).toBe('https://openrouter.ai/api/v1')
})

test('an unreadable profile leaves this browser on the shipped catalogue', () => {
  const e = endpoint()
  e.loadProfile('{ not json')
  expect(e.current()).toBe('local')
})
