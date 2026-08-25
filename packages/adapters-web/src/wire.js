/**
 * THE WIRE ITSELF, for every caller in this package: `fetch` off whatever
 * global we are running in, a rejection turned into one sentence a person can
 * act on, and a non-2xx turned into the RIGHT typed error.
 *
 * `globalThis.fetch` and not `window.fetch`: a sub-agent's turn runs inside a
 * Worker, where there is no window, and reaching for one there would mean a
 * delegated agent could never call a model at all.
 * @module
 */

import { ModelError, NetError, isLoopback } from '@harness/kernel'

/**
 * The `fetch` of this context. Typed rather than assumed: a build running
 * somewhere without one says so instead of throwing `undefined is not a
 * function` three frames deeper.
 * @returns {typeof fetch}
 */
export function globalFetch() {
  const found = /** @type {{fetch?: typeof fetch}} */ (globalThis).fetch
  if (typeof found !== 'function') {
    throw new ModelError('offline', 'This context has no fetch, so nothing here can reach a network.')
  }
  return found.bind(globalThis)
}

/**
 * WHICH FAILURE THIS WAS. A `fetch` rejects the same way whether the host
 * refused the connection or our own deadline fired, and calling both
 * "unreachable" is what put *check your CORS settings* over a request the
 * network log showed answering. An abort is a `DOMException` and its NAME is
 * the discriminant.
 *
 * A local address gets its own sentence because it has its own repair: a page
 * on the web calling `127.0.0.1` is Local Network Access, which Chrome asks
 * permission for and Safari refuses outright, and neither is a fact about the
 * endpoint being wrong.
 * @param {string} url @param {unknown} cause @param {number} seconds
 * @returns {ModelError}
 */
export function callFailed(url, cause, seconds) {
  const named = cause instanceof Error ? cause.name : ''
  if (named === 'AbortError' || named === 'TimeoutError') {
    return new ModelError('timeout', `The model did not answer within ${seconds} seconds.`, { cause, detail: url })
  }
  if (isLoopback(url) && !isLoopback(pageOrigin()) && pageOrigin() !== '') {
    return new ModelError('offline', `This page cannot reach ${url} from ${pageOrigin()}.`, {
      cause,
      detail: 'a page served from the web calling a local address is Local Network Access: Chrome 142+ asks permission first and Safari does not allow it at all',
    })
  }
  return new ModelError('offline', `${url} could not be reached.`, { cause, detail: said(cause) })
}

/**
 * THE ONE PLACE A NON-2xx BECOMES A VARIANT. Calling every one of them
 * "provider error" made a 404 saying `Model 'locl' not found` wear the remedy
 * for a refused credential.
 *
 * The discriminant is never the prose: it is the status, plus whether the model
 * id THIS PAGE ASKED FOR appears in the answer, plus whether an `authorization`
 * header actually went out — three facts we hold, not a phrase we hope for.
 * @param {number} status @param {string} body @param {string} model
 * @param {boolean} keyed whether a credential was attached to this request
 * @returns {ModelError}
 */
export function providerError(status, body, model, keyed) {
  const said = providerMessage(body)
  if (status === 404 && model !== '' && said.includes(model)) {
    return new ModelError('refused', `The endpoint does not have a model called "${model}".`, { status, detail: said })
  }
  if (status === 401 || status === 403) {
    const message = keyed
      ? 'The endpoint refused the API key saved for this entry.'
      : 'The endpoint wants an API key and none is saved for this entry.'
    return new ModelError('unauthorized', message, { status, detail: said })
  }
  if (status === 429) {
    return new ModelError('rate_limited', 'The endpoint is rate-limiting this key.', { status, detail: said })
  }
  if (status >= 500) {
    return new ModelError('server', `The endpoint failed with ${status}.`, { status, detail: said })
  }
  return new ModelError('refused', `The endpoint refused the request with ${status}.`, { status, detail: said })
}

/**
 * The sentence inside the envelope. OpenAI-compatible servers nest it as
 * `{"error": {"message": …}}`; some send `{"error": "…"}`; some send prose. All
 * three read the same here, and an unparseable body IS its own message.
 * @param {string} body @returns {string}
 */
export function providerMessage(body) {
  /** @type {unknown} */
  let value = null
  try {
    value = JSON.parse(body)
  } catch {
    return body
  }
  if (!value || typeof value !== 'object') return body
  const doc = /** @type {Record<string, unknown>} */ (value)
  const error = doc['error'] ?? doc
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = /** @type {Record<string, unknown>} */ (error)['message']
    if (typeof message === 'string') return message
  }
  return body
}

/** A brokered request that failed, in the net port's own vocabulary. */
export function netFailed(/** @type {string} */ url, /** @type {unknown} */ cause, /** @type {number} */ seconds) {
  const failure = callFailed(url, cause, seconds)
  const kind = failure.kind === 'timeout' ? 'timeout' : 'offline'
  return new NetError(kind, failure.message, { cause, detail: failure.detail })
}

/** What a thrown thing says, without pretending an unknown one is an Error. */
export function said(/** @type {unknown} */ cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * The address this code was served from, in a window OR a Worker — `location`
 * exists on both globals and `window` exists on only one.
 */
function pageOrigin() {
  const loc = /** @type {{location?: {origin?: string}}} */ (globalThis).location
  return typeof loc?.origin === 'string' ? loc.origin : ''
}
