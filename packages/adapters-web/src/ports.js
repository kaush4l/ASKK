/**
 * THE SMALL BROWSER PORTS: the wall clock, the randomness, the timer the driver
 * waits on, and the brokered net. The two big ones have files of their own —
 * the model broker in `model.js`, storage in `idb.js`.
 * @module
 */

import { NetError } from '@harness/kernel'

import { globalFetch, netFailed } from './wire.js'

/** @typedef {import('@harness/kernel').ClockPort} ClockPort */
/** @typedef {import('@harness/kernel').RngPort} RngPort */
/** @typedef {import('@harness/kernel').NetPort} NetPort */

/** A search is not a generation: nothing about one is worth waiting five minutes for. */
const SEARCH_TIMEOUT_MS = 20_000

/** `Date.now()`, once, HERE — everything downstream receives time as data (I7). */
export function browserClock() {
  return /** @type {ClockPort} */ ({ now: () => Date.now() })
}

/** `crypto.getRandomValues`, for the same one-door reason. */
export function browserRng() {
  return /** @type {RngPort} */ ({
    bytes(n) {
      return crypto.getRandomValues(new Uint8Array(n))
    },
  })
}

/**
 * How the driver waits. `setTimeout` lives here and not in the core because a
 * deadline is a clock, and the core's is injected so a test can fire it (I7).
 * The signal is honoured so a race that has already been decided stops holding
 * a timer open.
 */
export function browserTimer() {
  return {
    /** @param {number} ms @param {AbortSignal} [signal] @returns {Promise<void>} */
    wait: (ms, signal) => new Promise((resolve) => {
      const id = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(id)
        resolve()
      }, { once: true })
    }),
  }
}

/**
 * `NetPort` over fetch, WITH AN ALLOWLIST AND NOTHING ELSE REACHABLE.
 *
 * The allowlist IS the address book: a name with no entry cannot be called, and
 * there is no way to hand this broker a URL — the core names `search` and this
 * file is the only place that knows where that is. An empty list, which is the
 * shipped state, therefore denies everything. That is the I6 property worth
 * having: no module gets raw fetch. It is not "only two destinations exist".
 * @param {{fetch?: typeof fetch, timeoutMs?: number}} [opts]
 */
export function brokeredNet(opts = {}) {
  /** @type {Map<string, string>} */
  const allowed = new Map()
  const timeoutMs = opts.timeoutMs ?? SEARCH_TIMEOUT_MS
  return {
    /** Point one name at one base URL, or REMOVE it when the URL is blank — clearing a setting has to take the destination off the list. */
    allow(/** @type {string} */ endpoint, /** @type {string} */ baseUrl) {
      const base = baseUrl.trim().replace(/\/+$/, '')
      if (base === '') allowed.delete(endpoint)
      else allowed.set(endpoint, base)
    },
    /** Where a name currently points, or '' — what Settings shows, never a second door. */
    where: (/** @type {string} */ endpoint) => allowed.get(endpoint) ?? '',
    port: /** @type {NetPort} */ ({
      async fetch(endpoint, request, callOpts) {
        const base = allowed.get(endpoint)
        if (base === undefined) {
          throw new NetError('not_allowed', `Nothing may be fetched from "${endpoint}".`, {
            detail: 'no base URL is configured for that name, and this build reaches only names that have one',
          })
        }
        return await get(opts.fetch ?? globalFetch(), `${base}${request.path}`, request, {
          timeoutMs,
          ...(callOpts?.signal ? { signal: callOpts.signal } : {}),
        })
      },
    }),
  }
}

/**
 * @param {typeof fetch} send @param {string} url
 * @param {import('@harness/kernel').BrokeredRequest} request
 * @param {{timeoutMs: number, signal?: AbortSignal}} opts
 * @returns {Promise<import('@harness/kernel').BrokeredResponse>}
 */
async function get(send, url, request, opts) {
  if (request.body !== undefined && request.method === 'GET') {
    throw new NetError('not_allowed', 'A GET carries no body, so this one was refused rather than dropped.', {
      detail: 'fetch discards a body on GET without saying so, and a body that vanishes in silence is the defect this refusal exists to prevent',
    })
  }
  const deadline = AbortSignal.timeout(opts.timeoutMs)
  try {
    const response = await send(url, {
      method: request.method,
      headers: request.headers ?? {},
      // A BODY IS ALLOWED NOW, AND IT HAD TO BE. The shipped search default is
      // Firecrawl's `POST /v2/search`, whose query IS its body; refusing one
      // meant the only browser-callable general index was unreachable through
      // the one broker every outbound call goes through.
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline,
    })
    return { status: response.status, body: await response.text() }
  } catch (cause) {
    throw netFailed(url, cause, Math.round(opts.timeoutMs / 1000))
  }
}
