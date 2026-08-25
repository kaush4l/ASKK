import { expect, test } from 'bun:test'

import { ModelError } from '@harness/kernel'
import { callFailed, providerError, providerMessage } from '@harness/adapters-web'

test('a 404 naming the model asked for is about the model, not the credential', () => {
  const body = JSON.stringify({ error: { message: "Model 'locl' not found. Available models: gemma-4, qwen3" } })
  const failure = providerError(404, body, 'locl', true)
  expect(failure.kind).toBe('refused')
  expect(failure.message).toContain('locl')
  expect(failure.message).not.toContain('key')
})

test('a 401 with no key sent and a 401 with one are different failures', () => {
  const absent = providerError(401, '{}', 'gpt-5', false)
  const wrong = providerError(401, '{}', 'gpt-5', true)
  expect(absent.kind).toBe('unauthorized')
  expect(absent.message).toContain('none is saved')
  expect(wrong.message).toContain('refused the API key')
})

test('rate limiting and a server fault are told apart', () => {
  expect(providerError(429, '{}', 'gpt-5', true).kind).toBe('rate_limited')
  expect(providerError(503, 'gateway down', 'gpt-5', true).kind).toBe('server')
})

test('the provider\'s own sentence is found in all three envelopes it arrives in', () => {
  expect(providerMessage(JSON.stringify({ error: { message: 'nested' } }))).toBe('nested')
  expect(providerMessage(JSON.stringify({ error: 'flat' }))).toBe('flat')
  expect(providerMessage('not json at all')).toBe('not json at all')
})

test('an abort is a timeout and not an unreachable endpoint', () => {
  const abort = new DOMException('aborted', 'TimeoutError')
  const failure = callFailed('https://api.openai.com/v1/chat/completions', abort, 300)
  expect(failure).toBeInstanceOf(ModelError)
  expect(failure.kind).toBe('timeout')
  expect(failure.message).toContain('300 seconds')
})

test('anything else names the address it could not reach', () => {
  const failure = callFailed('https://example.test/v1/chat/completions', new TypeError('Failed to fetch'), 300)
  expect(failure.kind).toBe('offline')
  expect(failure.message).toContain('https://example.test/v1/chat/completions')
})
