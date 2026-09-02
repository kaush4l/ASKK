import { Outcome } from '../../core/Outcome.js'
import { Blocked } from '../../core/tools/HttpPort.js'

/**
 * Can this app actually answer a question right now?
 *
 * Everything else in the boot path reports on THIS app — storage, the worker,
 * the guest — and the one thing that decides whether a question gets an answer
 * is the one thing nobody asked: a model. The defaults name a server on
 * `127.0.0.1` that most people are not running, so a first visit says "ready"
 * and then answers the first question with a transport failure. Ready is a
 * claim about the app; this is a claim about the setup.
 *
 * It is a GET and nothing else. Not a completion — a probe that spends tokens
 * on every page load is a probe that costs money to open a tab — and not a
 * HEAD, because several OpenAI-compatible servers answer 405 to one.
 *
 * A failure here is a RESULT, not an `Outcome.failed`: an unreachable endpoint
 * is a state of the world, and reporting it as a failure would put a red error
 * on screen for someone who has simply not started their server yet.
 */

/** Long enough for a laptop's own server to wake, short enough not to delay a boot. */
const TIMEOUT = 4000

/** Nothing is read; only the status matters, and a listing can be long. */
const LIMIT = 8 * 1024

export class HealthService {
  constructor({ settings, http = null } = {}) {
    this.settings = settings
    this.http = http
  }

  /**
   * @returns {Promise<Outcome>} value is
   *   `{reachable, kind, endpoint, model, detail}` — `detail` is a sentence for
   *   a person, empty when there is nothing to say.
   */
  async model() {
    const stored = await this.settings.get()
    if (!stored.ok) return stored
    const { kind, baseUrl, apiKey, model } = stored.value

    // The in-tab model has no endpoint to answer, and saying "unreachable"
    // about a model that is downloaded rather than called would be a warning
    // about a configuration that is fine.
    if (kind === 'transformers') {
      return Outcome.ok({
        reachable: true,
        kind,
        endpoint: '',
        model,
        detail: model ? '' : 'No model is named, so there is nothing to download and run.',
      })
    }

    if (!this.http) {
      return Outcome.ok({
        reachable: false,
        kind,
        endpoint: baseUrl,
        model,
        detail: 'This build cannot make an HTTP request, so the model cannot be checked.',
      })
    }
    if (!baseUrl) {
      return Outcome.ok({
        reachable: false,
        kind,
        endpoint: '',
        model,
        detail: 'No address is set. Open settings and name where the model runs.',
      })
    }

    // `/models` on both wires. Anthropic wants its version header and a key; an
    // OpenAI-compatible server on the same machine usually wants neither, and
    // the ones that do answer 401, which is still an answer.
    const headers = { accept: 'application/json' }
    if (apiKey && kind === 'anthropic') {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`
    }

    const asked = await this.http({
      url: `${String(baseUrl).replace(/\/+$/, '')}/models`,
      headers,
      limit: LIMIT,
      timeout: TIMEOUT,
    })
    if (!asked.ok) return asked

    const { status, blocked } = asked.value
    // An answer of any status means something is there and the address is
    // right, which is the question being asked. 401 and 404 are answers: a key
    // problem and a server that does not list models are both a running server,
    // and the first real question will say which.
    if (status > 0) {
      return Outcome.ok({
        reachable: true,
        kind,
        endpoint: baseUrl,
        model,
        detail:
          status === 401 || status === 403
            ? 'The server answered and refused the key. Check the key in settings.'
            : '',
      })
    }

    const detail =
      blocked === Blocked.REFUSED
        ? `${baseUrl} answered, but will not let a browser read it. That is a CORS setting on that server, not something this page can change.`
        : blocked === Blocked.TIMEOUT
          ? `${baseUrl} did not answer within ${TIMEOUT / 1000}s. It may still be starting.`
          : `Nothing answered at ${baseUrl}. Start the server, or open settings and name a different one.`
    return Outcome.ok({ reachable: false, kind, endpoint: baseUrl, model, detail })
  }
}
