import { Outcome } from '../core/Outcome.js'
import { Blocked } from '../core/tools/HttpPort.js'

/**
 * The real HTTP port, in its own file because it now has two callers.
 *
 * `HttpPort.js` says this "lives beside the wiring because it is the only
 * implementation ... the day there is a second one it earns its own file". That
 * day is this one: `agentWorker.js` builds a sub-agent's web tools on its own
 * thread, and importing them from `composition.js` would have pulled the whole
 * kernel — IndexedDB, the sandbox, five services — into every sub-agent thread
 * to reach one function.
 *
 * Moved unchanged. What it does and why is documented on the port itself.
 */

/** Long enough to answer "is anything there", short enough not to double a failed call. */
const REACH_TIMEOUT = 8000

/** Nothing came back, and here is which kind of nothing. */
const nothing = (url, blocked) =>
  Outcome.ok({
    url,
    status: 0,
    contentType: '',
    text: '',
    bytes: 0,
    truncated: false,
    stopped: '',
    blocked,
  })

/**
 * Read a body up to a cap, and say whether the cap was reached.
 *
 * Streamed rather than `response.text()` because `text()` has already
 * downloaded the whole thing before it can be measured — the cap would then be
 * a cap on what is remembered and not on what is paid for.
 *
 * `stopped` is why the stream ended early, empty when it ended properly. The
 * text that did arrive comes back either way: a body that broke half-way is
 * half an answer, and discarding it to report "no readable content" tells the
 * model something that is not true about a page it half received.
 */
async function readCapped(response, limit, contentType) {
  const reader = response.body?.getReader()
  if (!reader) return { text: '', bytes: 0, truncated: false, stopped: '' }

  // A server that declares a charset the runtime does not know must not cost
  // the whole body, so an unusable label falls back rather than failing.
  const label = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8'
  const decoder = (await Outcome.attempt(() => new TextDecoder(label))).unwrapOr(new TextDecoder())

  let text = ''
  let bytes = 0
  while (true) {
    const chunk = await Outcome.attempt(() => reader.read())
    if (!chunk.ok) return { text, bytes, truncated: false, stopped: chunk.failure.message }

    const { done, value } = chunk.value
    if (done) return { text: text + decoder.decode(), bytes, truncated: false, stopped: '' }
    // Strictly over, not at: a body of exactly `limit` bytes is a WHOLE body,
    // and `>=` reported it as truncated — the model was then told a complete
    // page might be missing its end.
    if (bytes + value.byteLength > limit) {
      text += decoder.decode(value.subarray(0, limit - bytes))
      await reader.cancel()
      return { text, bytes: limit, truncated: true, stopped: '' }
    }
    bytes += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
}

/**
 * Did anything answer at all?
 *
 * Sent as the SAME request, not a bare GET. An endpoint that answers GET and
 * refuses POST would otherwise have a failed POST diagnosed as "that origin
 * will not let a browser read it", which is a permanent property and sends the
 * agent away for good. `no-cors` drops the non-safelisted headers itself, so
 * this can only establish that something is THERE — establishing that it is
 * readable is the thing that already failed.
 */
async function reachable({ url, method, headers, body }) {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), REACH_TIMEOUT)
  const opaque = await Outcome.attempt(() =>
    fetch(url, { method, headers, body, mode: 'no-cors', signal: control.signal }),
  )
  clearTimeout(timer)
  return opaque.ok
}

/**
 * The real HTTP port — the whole outside world the web tools are allowed.
 *
 * It lives beside the wiring because it is the only implementation and it is a
 * thin layer of policy over `fetch`; the day there is a second one it earns its
 * own file. What the policy is: a byte cap, a deadline, and one extra request
 * on failure to find out what kind of failure it was.
 *
 * That last part is the whole reason this is not a one-liner. A page cannot see
 * why `fetch` rejected — a CORS refusal, a dead host and a DNS failure are all
 * `TypeError: Failed to fetch` with nothing else in them. But an origin that
 * merely will not let a page READ it still answers a `no-cors` request, opaquely,
 * while a host that is not there rejects that too. Measured in a module worker
 * in Chrome, and recorded in `docs/CORS-PROBE.md` §4:
 *
 *     ziglang.org        cors: REJECTED TypeError  no-cors: resolved type=opaque
 *     …no-such-host…     cors: REJECTED TypeError  no-cors: REJECTED TypeError
 *
 * One extra round trip, only on the path that already failed, buys the agent
 * the difference between "go somewhere else" and "try again".
 */
// The caps are defaulted here as well as passed by both callers, because an
// absent cap does not fail — it silently downloads everything, which is the one
// bug in this file that would never show up in a test.
export const browserHttp = async ({
  url,
  method = 'GET',
  headers = {},
  body = null,
  limit = 512 * 1024,
  timeout = 20_000,
}) => {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), timeout)
  // `finally`, and nothing else in this file uses one: the deadline has to die
  // on every path out, and the previous version cleared it the instant the
  // HEADERS arrived. A server that answered and then trickled forever was then
  // read with no deadline at all, and the turn never ended.
  try {
    const sent = await Outcome.attempt(() =>
      fetch(url, { method, headers, body, signal: control.signal, redirect: 'follow' }),
    )
    if (!sent.ok) {
      if (control.signal.aborted) return nothing(url, Blocked.TIMEOUT)
      const answered = await reachable({ url, method, headers, body })
      return nothing(url, answered ? Blocked.REFUSED : Blocked.UNREACHABLE)
    }

    const response = sent.value
    const contentType = response.headers.get('content-type') ?? ''
    const read = await readCapped(response, limit, contentType)
    // The body is inside the deadline too, so a stream that stalled is a
    // timeout and not a mystery. Checked in this order because an aborted read
    // reports itself as a broken stream and only the signal knows which it was.
    if (read.stopped && control.signal.aborted) return nothing(url, Blocked.TIMEOUT)

    return Outcome.ok({
      // The url AFTER redirects. A tool that reports the address it asked for
      // hides that it is reading something else.
      url: response.url || url,
      status: response.status,
      contentType,
      blocked: Blocked.NONE,
      ...read,
    })
  } finally {
    clearTimeout(timer)
  }
}
