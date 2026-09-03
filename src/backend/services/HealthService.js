import { Outcome } from '../../core/Outcome.js'
import { Blocked } from '../../core/tools/HttpPort.js'

/**
 * Can this app actually answer a question right now?
 *
 * Everything else in the boot path reports on THIS app — storage, the worker,
 * the guest — and the one thing that decides whether a question gets an answer
 * is the one thing nobody asked: a model. Ready is a claim about the app; this
 * is a claim about the setup.
 *
 * There are two ways a setup can fail to answer and they are not the same
 * sentence. A model that was NEVER NAMED is unfinished configuration: nothing
 * is wrong anywhere, the person simply has not told this app what to call yet,
 * and the only useful thing to say is which field is empty. A model that was
 * named and does not answer is an UNREACHABLE server: something is wrong, it is
 * out there rather than in here, and the address is the fact worth repeating.
 * Reporting the first as the second is how a first visit used to end — with
 * someone hunting for a server they had never been asked to install, for a
 * model that only ever existed on the machine this was written on. So the
 * configuration is read first and the network is not touched until there is
 * something to ask and somewhere to ask it.
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
   *   `{configured, reachable, kind, endpoint, model, detail}` — `detail` is a
   *   sentence for a person, empty when there is nothing to say.
   *
   *   `configured` and `reachable` are two facts and not one. `reachable`
   *   answers "did something answer", which nothing can while there is nothing
   *   to call; `configured` answers "is there anything here to ask at all",
   *   which is the question a header is really asking when it decides whether
   *   to light a dot. With only the first of them to read, a surface had to
   *   infer the second from a model name it found in settings — and a name that
   *   shipped as a default made that inference wrong on every first visit.
   */
  async model() {
    const stored = await this.settings.get()
    if (!stored.ok) return stored
    const { kind, apiKey } = stored.value
    // Trimmed here as well as in `SettingsService.save`, because a record
    // written by an older build is not covered by today's save, and ` ` is
    // truthy: untrimmed, a blank address becomes a probe of `%20/models` and an
    // empty field is reported as a server that will not answer.
    const model = String(stored.value.model ?? '').trim()
    const baseUrl = String(stored.value.baseUrl ?? '').trim()
    // The in-tab model has no endpoint to answer, so a model id is the whole of
    // its configuration and an address would be a setting with no meaning.
    const needsAddress = kind !== 'transformers'

    const unfinished = missing({ model, baseUrl, needsAddress })
    if (unfinished) {
      return Outcome.ok({
        configured: false,
        reachable: false,
        kind,
        endpoint: needsAddress ? baseUrl : '',
        model,
        detail: unfinished,
      })
    }

    // Nothing to probe: the weights come down into this page. Saying
    // "unreachable" about a model that is downloaded rather than called would
    // be a warning about a configuration that is fine.
    if (kind === 'transformers') {
      return Outcome.ok({
        configured: true,
        reachable: true,
        kind,
        endpoint: '',
        model,
        detail: '',
      })
    }

    if (!this.http) {
      return Outcome.ok({
        configured: true,
        reachable: false,
        kind,
        endpoint: baseUrl,
        model,
        detail: 'This build cannot make an HTTP request, so the model cannot be checked.',
      })
    }

    // `/models` on both wires. Anthropic wants its version header and a key; an
    // OpenAI-compatible server on the same machine usually wants neither, and
    // the ones that do answer 401, which is still an answer.
    const headers = { accept: 'application/json' }
    if (kind === 'anthropic') {
      if (apiKey) headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
      // The header that makes Anthropic answer a browser at all. Without it
      // this probe was measuring a request the app never makes: a refusal here
      // would have been reported as "that server will not let a browser read
      // it" while the actual chat, which sends it, works. A probe that tests a
      // different path than the one it predicts is worse than no probe.
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
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
        configured: true,
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
    // "Start the server" belongs here and only here. Everything the app was
    // told to use is named, so the fault really is a server that is not up —
    // which is exactly the advice that was useless above, where there was no
    // server anyone had chosen yet.
    return Outcome.ok({
      configured: true,
      reachable: false,
      kind,
      endpoint: baseUrl,
      model,
      detail,
    })
  }
}

/**
 * The sentence for a setup nobody has finished, or empty when it is finished.
 *
 * Each case names the field that is empty and the one place to go and fill it,
 * and the address is repeated whenever it is already known — the person gave
 * that fact, and asking them to go and look up what they typed is a small
 * cruelty a sentence can avoid. None of these may say "start the server":
 * there is no server here that anybody has named, so there is nothing to start.
 */
function missing({ model, baseUrl, needsAddress }) {
  if (model && (baseUrl || !needsAddress)) return ''
  if (!needsAddress) {
    return 'No model is named, so there is nothing to download and run. Open settings and name one.'
  }
  if (!model && !baseUrl) {
    return 'Nothing is configured yet: no model, and no address to reach one. Open settings and name both.'
  }
  if (!model) {
    return `No model is named for ${baseUrl}. Open settings and name the model that server should run.`
  }
  return `No address is set for ${model}. Open settings and name where it runs.`
}
