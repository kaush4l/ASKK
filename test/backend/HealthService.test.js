import { describe, expect, test } from 'bun:test'
import { HealthService } from '../../src/backend/services/HealthService.js'
import { Outcome } from '../../src/core/Outcome.js'
import { Blocked } from '../../src/core/tools/HttpPort.js'

/**
 * Two different answers to "why can this app not answer a question", and the
 * app used to give only one of them.
 *
 * `composition.test.js` covers the probe itself — the GET, the statuses, the
 * CORS discriminator — against a configuration that is complete. This file
 * covers the case that is true on a first visit and was true of nobody's
 * machine: a configuration that names nothing yet. A setup that was never
 * finished is not a server that is down, and telling someone to start a server
 * they were never asked to install sends them to look for a fault in the one
 * place there isn't one.
 *
 * The distinction is asserted twice over — in `configured`, which is what a
 * header can read without parsing English, and in the sentence, which is what
 * the person reads.
 */

/** Settings the service reads, with only the fields under test spelled out. */
const settingsOf = (values) => ({
  async get() {
    return Outcome.ok({ kind: 'openai', baseUrl: '', apiKey: '', model: '', ...values })
  },
})

/** A port that answers with one status, and records whether it was asked at all. */
const port = (answer = {}) => {
  const asked = []
  const fn = async (request) => {
    asked.push(request)
    return Outcome.ok({
      url: request.url,
      status: 0,
      contentType: '',
      text: '',
      bytes: 0,
      truncated: false,
      stopped: '',
      blocked: Blocked.NONE,
      ...answer,
    })
  }
  fn.asked = asked
  return fn
}

describe('a configuration that names nothing', () => {
  test('is reported as unfinished setup, not as a server that is down', async () => {
    const http = port()
    const said = await new HealthService({ settings: settingsOf({}), http }).model()

    expect(said.value.configured).toBe(false)
    expect(said.value.reachable).toBe(false)
    // The words that sent a first-time visitor hunting for a server problem
    // they do not have. Whatever this sentence says, it may not say that.
    expect(said.value.detail).not.toContain('Start the server')
    expect(said.value.detail).toContain('model')
    expect(said.value.detail).toContain('settings')
    // Nothing is asked of the network, because there is no address to ask and
    // no model to ask about. A probe here would only invent a second failure.
    expect(http.asked).toEqual([])
  })

  test('with an address but no model, names the model as the thing missing and the address as set', async () => {
    // Half-configured is still not configured — a server that is up cannot
    // answer a question that names no model — but the address is the one fact
    // the person already gave, so the sentence repeats it rather than making
    // them go and check what they typed.
    const http = port({ status: 200 })
    const said = await new HealthService({
      settings: settingsOf({ baseUrl: 'http://127.0.0.1:9/v1' }),
      http,
    }).model()

    expect(said.value.configured).toBe(false)
    expect(said.value.reachable).toBe(false)
    expect(said.value.detail).toContain('http://127.0.0.1:9/v1')
    expect(said.value.detail).not.toContain('Start the server')
    expect(http.asked).toEqual([])
  })

  test('with a model but no address, names the address as the thing missing', async () => {
    const said = await new HealthService({
      settings: settingsOf({ model: 'a-real-model' }),
      http: port({ status: 200 }),
    }).model()

    expect(said.value.configured).toBe(false)
    expect(said.value.detail).toContain('a-real-model')
    expect(said.value.detail).toContain('address')
    expect(said.value.detail).not.toContain('Start the server')
  })

  test('is what whitespace in a field means, because a cleared field is cleared', async () => {
    // `SettingsService.save` trims, but a record written by an older build can
    // still hold spaces, and ` ` is truthy — which would have built a probe URL
    // out of a blank and reported the emptiness as an unreachable server.
    const http = port()
    const said = await new HealthService({
      settings: settingsOf({ model: '  ', baseUrl: '   ' }),
      http,
    }).model()

    expect(said.value.configured).toBe(false)
    expect(http.asked).toEqual([])
  })
})

describe('a configuration that names a server', () => {
  test('that nothing answers is unreachable, is configured, and names the address it tried', async () => {
    // The other half of the distinction: everything the app was told to use is
    // there, so this IS a server problem and the sentence may say so.
    const said = await new HealthService({
      settings: settingsOf({ model: 'm', baseUrl: 'http://127.0.0.1:8873/v1' }),
      http: port({ status: 0, blocked: Blocked.UNREACHABLE }),
    }).model()

    expect(said.value.configured).toBe(true)
    expect(said.value.reachable).toBe(false)
    expect(said.value.detail).toContain('http://127.0.0.1:8873/v1')
  })

  test('that answers is reachable and configured, with nothing to say', async () => {
    const said = await new HealthService({
      settings: settingsOf({ model: 'm', baseUrl: 'http://127.0.0.1:8873/v1' }),
      http: port({ status: 200 }),
    }).model()

    expect(said.value.configured).toBe(true)
    expect(said.value.reachable).toBe(true)
    expect(said.value.detail).toBe('')
  })

  test('in a build that cannot make a request says that, rather than blaming the setup', async () => {
    // The configuration is complete here, so the limitation being reported is
    // this build's and not the person's, and there is nothing for them to fix.
    const said = await new HealthService({
      settings: settingsOf({ model: 'm', baseUrl: 'http://127.0.0.1:8873/v1' }),
      http: null,
    }).model()

    expect(said.value.configured).toBe(true)
    expect(said.value.reachable).toBe(false)
    expect(said.value.detail).toContain('cannot make an HTTP request')
  })
})

describe('a model that runs in this tab', () => {
  test('is configured by a model id alone, because there is no address to name', async () => {
    // `transformers` downloads weights into the page. Asking it for an endpoint
    // would be asking for a setting that has no meaning, so a model id is the
    // whole configuration.
    const http = port({ status: 200 })
    const said = await new HealthService({
      settings: settingsOf({ kind: 'transformers', model: 'onnx-community/whisper-base' }),
      http,
    }).model()

    expect(said.value.configured).toBe(true)
    expect(said.value.reachable).toBe(true)
    expect(said.value.detail).toBe('')
    expect(http.asked).toEqual([])
  })

  test('with no model id is unfinished setup like any other, and says what to name', async () => {
    // It used to answer `reachable: true` here, which the page reads as "ask
    // away" — so the one sentence explaining that nothing had been chosen was
    // written into a field the page could never render.
    const said = await new HealthService({
      settings: settingsOf({ kind: 'transformers' }),
      http: port({ status: 200 }),
    }).model()

    expect(said.value.configured).toBe(false)
    expect(said.value.reachable).toBe(false)
    expect(said.value.detail).toContain('model')
    expect(said.value.detail).not.toContain('Start the server')
  })
})

/**
 * The third answer, which the probe had in its hand and threw away.
 *
 * A reviewer set the model to `this-model-does-not-exist-xyz`, pointed it at a
 * server that was up, and got `✓ answered` — because the check only ever asked
 * whether SOMETHING was there. The listing that came back in the same request
 * said what that server actually serves, and the person was left typing a name
 * into a field nobody can fill from memory.
 *
 * So these are two facts, asserted apart: the ids, which a form can offer, and
 * whether the configured name is one of them. The second has three states and
 * not two. A server that lists nothing has not said the name is wrong — many
 * OpenAI-compatible servers ignore the endpoint and answer with whatever is
 * loaded — and reporting that silence as "your model is wrong" would be the ✓'s
 * own mistake told backwards, with more confidence.
 */
describe('what a server says it serves', () => {
  /** The shape both wires answer with, kept in one place so the tests read as the sentence under test. */
  const listing = (...ids) => JSON.stringify({ object: 'list', data: ids.map((id) => ({ id })) })

  /** A complete configuration pointed at a server that is up. */
  const named = (model) => settingsOf({ model, baseUrl: 'http://127.0.0.1:8873/v1' })

  test('is handed back as ids, because the person is being asked to type one of them', async () => {
    const said = await new HealthService({
      settings: named('testbed'),
      http: port({ status: 200, text: listing('testbed', 'other') }),
    }).model()

    expect(said.value.listed).toEqual(['testbed', 'other'])
    expect(said.value.modelListed).toBe(true)
    expect(said.value.detail).toBe('')
  })

  test('says in plain words when the configured name is not one of them, and names ones that are', async () => {
    const said = await new HealthService({
      settings: named('this-model-does-not-exist-xyz'),
      http: port({ status: 200, text: listing('testbed', 'other') }),
    }).model()

    expect(said.value.modelListed).toBe(false)
    expect(said.value.detail).toContain('this-model-does-not-exist-xyz')
    expect(said.value.detail).toContain('testbed')
    // The server is up and its answer was read. Only the name is wrong, so
    // this may not become "unreachable" — that would send someone to restart a
    // server that is running perfectly and answer the wrong question again.
    expect(said.value.reachable).toBe(true)
    expect(said.value.configured).toBe(true)
  })

  test('is undecided rather than an accusation when the server lists nothing', async () => {
    const said = await new HealthService({
      settings: named('whatever-is-loaded'),
      http: port({ status: 200, text: JSON.stringify({ object: 'list', data: [] }) }),
    }).model()

    expect(said.value.listed).toEqual([])
    expect(said.value.modelListed).toBe(null)
    expect(said.value.detail).toBe('')
  })

  test('is an empty list and a note when the body cannot be read, never a throw', async () => {
    const said = await new HealthService({
      settings: named('m'),
      http: port({ status: 200, text: '<html>not a listing</html>' }),
    }).model()

    expect(said.ok).toBe(true)
    expect(said.value.listed).toEqual([])
    expect(said.value.modelListed).toBe(null)
    expect(said.value.detail).toBe('')
    // Said somewhere, because "lists nothing" and "answered something this app
    // could not read" are different faults and only one of them is the server's.
    expect(said.notes.join(' ')).toContain('listing')
  })

  test('blames the probe, not the server, when the listing was longer than it reads', async () => {
    const said = await new HealthService({
      settings: named('m'),
      http: port({ status: 200, text: '{"object":"list","data":[{"id":"a"', truncated: true }),
    }).model()

    expect(said.value.listed).toEqual([])
    expect(said.value.modelListed).toBe(null)
    expect(said.notes.join(' ')).toContain('longer')
  })

  test('is read the same way from Anthropic, which answers the same shape', async () => {
    const said = await new HealthService({
      settings: settingsOf({
        kind: 'anthropic',
        model: 'claude-sonnet-4-5',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'k',
      }),
      http: port({
        status: 200,
        text: JSON.stringify({
          data: [
            { type: 'model', id: 'claude-sonnet-4-5' },
            { type: 'model', id: 'claude-opus-4-1' },
          ],
        }),
      }),
    }).model()

    expect(said.value.listed).toEqual(['claude-sonnet-4-5', 'claude-opus-4-1'])
    expect(said.value.modelListed).toBe(true)
  })

  test('is undecided when the key was refused, and the key is still what the sentence names', async () => {
    // A refusal is not a listing. The server never got as far as saying what it
    // serves, so the name is unchecked — and the one thing to go and fix is
    // still the key.
    const said = await new HealthService({
      settings: named('m'),
      http: port({ status: 401, text: JSON.stringify({ error: { message: 'no key' } }) }),
    }).model()

    expect(said.value.listed).toEqual([])
    expect(said.value.modelListed).toBe(null)
    expect(said.value.detail).toContain('refused the key')
  })

  test('is empty and undecided when nothing answered, because silence lists nothing', async () => {
    const said = await new HealthService({
      settings: named('m'),
      http: port({ status: 0, blocked: Blocked.UNREACHABLE }),
    }).model()

    expect(said.value.listed).toEqual([])
    expect(said.value.modelListed).toBe(null)
    expect(said.value.detail).toContain('http://127.0.0.1:8873/v1')
  })

  test('is empty and undecided for a model that runs in this tab, which has no listing to answer', async () => {
    const http = port({ status: 200, text: listing('something-else') })
    const said = await new HealthService({
      settings: settingsOf({ kind: 'transformers', model: 'onnx-community/whisper-base' }),
      http,
    }).model()

    expect(said.value.listed).toEqual([])
    expect(said.value.modelListed).toBe(null)
    expect(said.value.detail).toBe('')
    expect(http.asked).toEqual([])
  })

  test('is empty and undecided before anything is configured, because nothing has been asked', async () => {
    const said = await new HealthService({ settings: settingsOf({}), http: port() }).model()

    expect(said.value.listed).toEqual([])
    expect(said.value.modelListed).toBe(null)
  })

  test('is empty and undecided in a build that cannot make a request', async () => {
    const said = await new HealthService({ settings: named('m'), http: null }).model()

    expect(said.value.listed).toEqual([])
    expect(said.value.modelListed).toBe(null)
    expect(said.value.detail).toContain('cannot make an HTTP request')
  })
})

describe('checking a configuration before committing it', () => {
  test('probes what it was handed, and leaves the stored record alone', async () => {
    // A settings form has to be able to ask "does this address answer" before
    // Save. Measured otherwise: the check wrote the address it was testing, so
    // editing it, pressing the check and then pressing Escape left the edited
    // value stored — a dialog with two commit points, one of them undisclosed,
    // whose Cancel does not cancel.
    const asked = []
    const settings = {
      async get() {
        return Outcome.ok({
          kind: 'openai',
          model: 'stored-model',
          baseUrl: 'http://stored/v1',
          apiKey: 'the key set earlier',
        })
      },
    }
    const http = async ({ url, headers }) => {
      asked.push({ url, headers: headers ?? {} })
      return Outcome.ok({ status: 200, text: JSON.stringify({ data: [{ id: 'typed-model' }] }) })
    }

    const found = await new HealthService({ settings, http }).model({
      try: { model: 'typed-model', baseUrl: 'http://typed/v1' },
    })

    expect(found.ok).toBe(true)
    expect(asked[0].url).toContain('http://typed/v1')
    expect(found.value.model).toBe('typed-model')
    expect(found.value.modelListed).toBe(true)
    // Merged over the stored record, not replacing it: a form that sends only
    // the two fields it is asking about must still probe with the key.
    expect(JSON.stringify(asked[0].headers)).toContain('the key set earlier')
  })

  test('with nothing handed to it, it is the stored configuration exactly as before', async () => {
    const settings = {
      async get() {
        return Outcome.ok({ kind: 'openai', model: 'm', baseUrl: 'http://h/v1' })
      },
    }
    const asked = []
    const http = async ({ url }) => {
      asked.push(url)
      return Outcome.ok({ status: 200, text: '{"data":[]}' })
    }
    const found = await new HealthService({ settings, http }).model()
    expect(found.value.model).toBe('m')
    expect(asked[0]).toContain('http://h/v1')
  })
})
