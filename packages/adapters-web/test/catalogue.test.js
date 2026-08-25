import { expect, test } from 'bun:test'

import { NO_CATALOGUE, chatUrl, layer, names, readCatalogue, resolve } from '@harness/adapters-web'

const FILE = JSON.stringify({
  default: 'local',
  models: {
    local: { model: 'gemma-4', base_url: 'http://127.0.0.1:8873/v1/', api: 'completions' },
    openai: { model: 'gpt-5', base_url: 'https://api.openai.com/v1' },
    sonnet: { kind: 'anthropic', model: 'claude-sonnet-5', base_url: 'https://api.anthropic.com/v1' },
  },
})

test('an adapter with no catalogue resolves nothing rather than inventing a default', () => {
  expect(resolve(NO_CATALOGUE, '')).toBe(null)
  expect(resolve(NO_CATALOGUE, 'gpt-5')).toBe(null)
})

test('a name that is a key is that entry; one that is not is a model id on the default endpoint', () => {
  const cat = readCatalogue(FILE)
  expect(resolve(cat, 'openai')?.model).toBe('gpt-5')
  const arbitrary = resolve(cat, 'qwen3-30b')
  expect(arbitrary?.name).toBe('local')
  expect(arbitrary?.model).toBe('qwen3-30b')
  expect(resolve(cat, '')?.name).toBe('local')
})

test('the entry list is the file\'s own order, not sorted', () => {
  expect(names(readCatalogue(FILE))).toEqual(['local', 'openai', 'sonnet'])
})

test('a protocol this build does not speak is refused by name, not sent the wrong bytes', () => {
  const sonnet = resolve(readCatalogue(FILE), 'sonnet')
  expect(sonnet).not.toBe(null)
  expect(() => chatUrl(/** @type {any} */ (sonnet))).toThrow(/protocol this build does not/)
  expect(chatUrl(/** @type {any} */ (resolve(readCatalogue(FILE), 'local')))).toBe('http://127.0.0.1:8873/v1/chat/completions')
})

test('a layer overrides field by field, and a blank field means unchanged', () => {
  const layered = layer(readCatalogue(FILE), JSON.stringify({ models: { local: { base_url: 'http://localhost:1234/v1', model: '  ' } } }))
  expect(resolve(layered, 'local')?.baseUrl).toBe('http://localhost:1234/v1')
  expect(resolve(layered, 'local')?.model).toBe('gemma-4')
  expect(names(layered)).toEqual(['local', 'openai', 'sonnet'])
})

test('an unreadable catalogue costs the catalogue and not the boot', () => {
  expect(names(readCatalogue('{ not json'))).toEqual([])
})
