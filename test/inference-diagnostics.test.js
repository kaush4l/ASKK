import { expect, test } from 'bun:test'
import { inference } from '../src/core/inference.js'

const blocked = async () => { throw new TypeError('Load failed') }
const pageURL = 'https://kaush4l.github.io/ASKK/'

test('HTTPS to HTTP loopback errors identify possible browser restrictions without claiming the model is offline', async () => {
  for (const baseUrl of ['http://127.0.0.1:8873/v1', 'http://localhost:8873/v1', 'http://[::1]:8873/v1']) {
    const llm = inference({ provider: 'openai', model: 'fixture', baseUrl, retries: 1 }, { fetch: blocked, pageURL })
    for (const action of [() => llm.models(), () => llm.invoke([{ role: 'user', content: 'fixture' }])]) {
      let error; try { await action() } catch (value) { error = value }
      expect(error.message).toContain('page origin https://kaush4l.github.io')
      expect(error.message).toContain('mixed-content protection may block')
      expect(error.message).toContain('local-network permission')
      expect(error.message).toContain('trusted HTTPS companion relay')
      expect(error.message).toContain('does not establish that the model server is offline')
    }
  }
})

test('relay errors describe the actual companion route rather than the model HTTP URL', async () => {
  const llm = inference({ provider: 'openai', baseUrl: 'http://127.0.0.1:8873/v1', via: 'bridge', retries: 1 }, { bridge: blocked, bridgeURL: 'https://owner:secret@127.0.0.1:7717/?token=secret', pageURL })
  let error; try { await llm.models() } catch (value) { error = value }
  expect(error.message).toContain('configured companion relay (https://127.0.0.1:7717/)')
  expect(error.message).toContain('trusted HTTPS certificate')
  expect(error.message).not.toContain('8873')
  expect(error.message).not.toContain('mixed-content')
  expect(error.message).not.toContain('secret')
})

test('ordinary remote requests and explicit HTTP errors do not acquire a loopback diagnosis', async () => {
  const remote = inference({ provider: 'openai', baseUrl: 'https://model.example/v1' }, { fetch: blocked, pageURL })
  let error; try { await remote.models() } catch (value) { error = value }
  expect(error.message).toContain('CORS')
  expect(error.message).not.toContain('loopback')
  const refused = inference({ provider: 'openai', baseUrl: 'http://127.0.0.1:8873/v1' }, { fetch: async () => new Response('invalid credentials', { status: 401 }), pageURL })
  await expect(refused.models()).rejects.toThrow('HTTP 401')
})
