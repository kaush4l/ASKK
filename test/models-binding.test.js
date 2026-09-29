import { expect, test } from 'bun:test'
import { boundModelAvailable, merge, resolve } from '../src/core/models.js'
import { installedModelAvailable } from '../src/runtime/agent-installations.js'

test('explicit default binding bootstraps from shipped catalogue and follows saved workbench profile', () => {
  const file = { default: 'local', models: { local: { model: 'initial', base_url: 'http://127.0.0.1:1234/v1' } } }
  expect(resolve({ model: '$default' }, merge(file))).toMatchObject({ alias: 'local', model: 'initial' })
  const catalogue = merge(file, { default: 'workbench', models: { workbench: { model: 'selected', base_url: 'https://model.invalid/v1', via: 'bridge' } } })
  expect(resolve({ model: '$default', temperature: 0 }, catalogue)).toMatchObject({ alias: 'workbench', model: 'selected', via: 'bridge', temperature: 0 })
  expect(resolve({ model: 'local' }, catalogue).model).toBe('initial')
  expect(installedModelAvailable(catalogue, '$default')).toBe(true)
})

test('invalid or recursive default bindings fail closed instead of becoming raw provider model IDs', () => {
  for (const catalogue of [
    { models: { local: {} } }, { default: 'missing', models: {} },
    { default: '$default', models: { $default: {} } },
    { default: 'toString', models: {} },
    ...[null, [], 'model', 0].map(value => ({ default: 'local', models: { local: value } })),
  ]) {
    expect(boundModelAvailable(catalogue, '$default')).toBe(false)
    expect(installedModelAvailable(catalogue, '$default')).toBe(false)
    expect(() => resolve({ model: '$default' }, catalogue)).toThrow('default model profile')
  }
  expect(resolve({ model: 'raw-provider-id' }, { models: {} })).toMatchObject({ alias: '', model: 'raw-provider-id' })
  expect(boundModelAvailable({ models: {} }, 'raw-provider-id')).toBe(false)
})
