import { Outcome, Reason } from '../Outcome.js'

/**
 * One HTTP request, as a capability handed in from outside.
 *
 * A port and not a call to `fetch`, for the reason `src/core/mcp/HttpTransport.js`
 * demonstrates by counterexample: it calls the global directly, and as a result
 * it cannot be exercised without a network and has no test. The two web tools
 * are the ones most worth testing — every interesting case is a failure — so
 * they take a function instead and `src/backend/composition.js` supplies the
 * real one.
 *
 * The contract:
 *
 *     port({ url, method?, headers?, body?, limit?, timeout? })
 *       -> Outcome<{ url, status, contentType, text, bytes, truncated, stopped, blocked }>
 *
 * `limit` is a cap in BYTES on how much of the body is read; `truncated` says
 * the cap was hit. `url` in the value is the FINAL url, after redirects, which
 * is not always the one that was asked for. `stopped` is why a body ended
 * before it was finished, empty when it did not — and the text that DID arrive
 * comes back beside it, because a body that broke half-way is half an answer
 * and reporting it as nothing is a lie about a page that was half received.
 *
 * `timeout` covers the body and not only the headers. It has to: an origin that
 * answers and then trickles is indistinguishable from a healthy slow one until
 * the deadline says otherwise, and a deadline that stops at the headers is a
 * turn that never ends.
 *
 * A refusal is a RESULT, not a failure — the same rule `Sandbox` uses for a
 * non-zero exit code. `blocked` carries which one, and the port stops there:
 * deciding what a refusal MEANS is the tool's job, because the tool is the
 * thing that has to say it to a model. An `Outcome.failed` from a port means
 * the port itself is unusable, which in practice means there is no port.
 */

/**
 * Why nothing came back.
 *
 * These are separate values because a browser cannot tell them apart from the
 * rejection alone — every one of them arrives as `TypeError: Failed to fetch`
 * with no detail (measured, `docs/CORS-PROBE.md` §4). The adapter has to go and
 * establish which, and it needs somewhere to write the answer down.
 */
export const Blocked = Object.freeze({
  /** The response was read. */
  NONE: '',
  /** The host answered, but sent no CORS header, so the page may not read it. */
  REFUSED: 'refused',
  /** Nothing answered at all. */
  UNREACHABLE: 'unreachable',
  /** Something answered, too slowly. */
  TIMEOUT: 'timeout',
})

/**
 * The port used when nobody supplied one.
 *
 * Present so that a tool built without a port still answers instead of failing
 * on `this.http is not a function` — the observation says the build cannot make
 * a request, which is a thing the agent can work around, and a TypeError is not.
 */
export const NO_HTTP = async () =>
  Outcome.failed(Reason.UNAVAILABLE, 'this build cannot make an HTTP request')
