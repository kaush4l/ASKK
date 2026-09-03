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
