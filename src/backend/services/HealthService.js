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
 * That GET is also the only moment this app is ever told what a server calls
 * the things it serves, and the listing it answers with used to be dropped on
 * the floor. Two words came back — answered — while the settings sheet asked
 * for "exactly what that server calls the model", which is the one field on
 * that form nobody can fill from memory: it is whatever a stranger's server
 * decided to name some weights. So the ids are read out and handed back, and
 * the configured name is checked against them, because a probe that holds the
 * answer and reports a tick is a probe that made the person guess.
 *
 * What the listing may NOT do is convict a name on its own. Plenty of
 * OpenAI-compatible servers ignore `/models` entirely and answer any completion
 * with whatever is loaded, so "that name is not in the listing" and "there is
 * no listing to check it against" are two different facts and only the first
 * of them is worth a sentence. Collapsing them would be this same defect told
 * backwards: a confident verdict about a setup that works.
 *
 * A failure here is a RESULT, not an `Outcome.failed`: an unreachable endpoint
 * is a state of the world, and reporting it as a failure would put a red error
 * on screen for someone who has simply not started their server yet.
 */

/** Long enough for a laptop's own server to wake, short enough not to delay a boot. */
const TIMEOUT = 4000

/**
 * Enough to hold a whole listing. This was 8 KB while nothing was read from the
 * body and only the status mattered; now that the ids are what the probe came
 * for, a cap that stops half way turns a listing this app could have read into
 * one it cannot parse at all — and an endpoint that serves a few hundred models
 * is an ordinary hosted one, not an exotic case.
 */
const LIMIT = 256 * 1024

export class HealthService {
  constructor({ settings, http = null } = {}) {
    this.settings = settings
    this.http = http
  }

  /**
   * @returns {Promise<Outcome>} value is
   *   `{configured, reachable, kind, endpoint, model, listed, modelListed,
   *   detail}` — `detail` is a sentence for a person, empty when there is
   *   nothing to say.
   *
   *   `listed` is every model id that endpoint named, in the order it named
   *   them, and it is ALWAYS an array — empty when there was no listing to
   *   read, never absent — so a form can offer it as the choices for the field
   *   a person otherwise has to type from memory. `modelListed` says whether
   *   `model` is one of them: `true`, `false`, or `null` for cannot-tell, which
   *   is what a server that lists nothing leaves behind. The last two must not
   *   be rendered alike. `false` is a name that will fail on the first real
   *   question and is worth interrupting someone over; `null` is a server
   *   keeping its own counsel, which is most of them, and saying anything about
   *   it would be inventing a fault out of a silence.
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
        // Nobody has been asked anything yet, so nothing is known about what
        // any server serves. Empty, and undecided — not "not listed".
        listed: [],
        modelListed: null,
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
        // There is no endpoint to list anything, and the id is a name on a
        // model hub rather than one a local server chose, so there is nothing
        // here to check it against and nothing to offer as a choice.
        listed: [],
        modelListed: null,
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
        listed: [],
        modelListed: null,
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
      // Only a success carries a listing. A 401 body is a refusal and a 404
      // body is somebody's error page; reading either one as "that server lists
      // no models" would attach a note about a fault the status has already
      // named, and would call a name unchecked when it was never asked about.
      const listing = ok(status) ? listingOf(asked.value) : { ids: [], note: '' }
      // Three states, and the empty listing is the reason for the third. A
      // server that named nothing has said nothing about this name either way.
      const modelListed = listing.ids.length ? listing.ids.includes(model) : null

      // The key comes first when it was refused. A server that would not read
      // the request has not told us what it serves, so there is no listing to
      // argue with, and the key is the thing to go and fix in either case.
      const detail =
        status === 401 || status === 403
          ? 'The server answered and refused the key. Check the key in settings.'
          : modelListed === false
            ? `${baseUrl} answered, but does not list ${model}. It lists ${aFewOf(listing.ids)}. Open settings and name one of them.`
            : ''

      return Outcome.ok({
        configured: true,
        // The server is up and its answer was read, so it is reachable even
        // when the name is wrong. Demoting this on a bad name would send
        // someone to restart a server that is running perfectly.
        reachable: true,
        kind,
        endpoint: baseUrl,
        model,
        listed: listing.ids,
        modelListed,
        detail,
      }).withNote(listing.note)
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
      // Silence lists nothing, and a name cannot be checked against silence.
      listed: [],
      modelListed: null,
      detail,
    })
  }
}

/** Did that answer carry a body worth reading, or only a status worth reporting? */
function ok(status) {
  return status >= 200 && status < 300
}

/**
 * The model ids in a `/models` answer, and — when there are none — which way it
 * failed to say any.
 *
 * One reader for both wires, because there is only one shape: OpenAI answers
 * `{object, data: [{id}]}` and Anthropic answers `{data: [{type, id}]}`, and
 * they differ only in fields nothing here reads. A branch on `kind` would be a
 * fork with two identical arms, and the headers above already carry the whole
 * of the difference between the two.
 *
 * Nothing here throws, and none of these is an `Outcome.failed`. A body that
 * will not parse is a fact about that server, not a fault in this app: reported
 * as a failure it would put a red error on the screen of someone whose model
 * answers questions perfectly well. The honest report is an empty list, which
 * reads as cannot-tell, plus a note saying WHICH way it could not tell — a
 * reader who sees "not JSON" knows to go and look at what that address really
 * is, and a reader told only "no models" would blame the server.
 */
function listingOf({ text = '', truncated = false }) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ids: [],
      note: truncated
        ? `the model listing was longer than the ${LIMIT} bytes this probe reads, so only part of it arrived`
        : 'the model listing was not JSON, so nothing could be read from it',
    }
  }
  const rows = parsed?.data
  if (!Array.isArray(rows))
    return {
      ids: [],
      note: 'the model listing had no `data` array, so nothing could be read from it',
    }
  // A row with no id, or an id that is not a string, is not a name anyone can
  // be asked to type, and offering one as a choice would be offering a dead end.
  return {
    ids: rows.map((row) => row?.id).filter((id) => typeof id === 'string' && id !== ''),
    note: '',
  }
}

/**
 * A few of the ids, named the way a person would name them.
 *
 * Every id would put a hosted catalogue of several hundred into one sentence,
 * and none at all would leave the reader holding a correction with no way to
 * make it — which is the dead end the tick left them in, one step further
 * along. A couple of real names is enough to show what KIND of name that server
 * wants, and the count says how much more there is to choose from.
 */
function aFewOf(ids) {
  const few = ids.slice(0, 3)
  const said = few.length > 1 ? `${few.slice(0, -1).join(', ')} and ${few.at(-1)}` : few[0]
  return ids.length > few.length ? `${said} (${ids.length} in all)` : said
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
