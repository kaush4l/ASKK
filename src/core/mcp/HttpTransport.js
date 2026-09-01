import { Outcome, Reason } from '../Outcome.js'

/**
 * MCP over HTTP — one POST per request.
 *
 * The Streamable HTTP transport allows a server to answer either with JSON or
 * with an SSE stream. Both are read here, because which one arrives is the
 * server's choice and a client that only handles JSON simply fails against half
 * of them.
 *
 * A session id, if the server issues one, is echoed on every later request. That
 * is the whole of MCP's session handling and it costs one header.
 *
 * This is the transport for a server someone else is running. It needs CORS on
 * that server, which is the usual reason a public MCP endpoint does not work
 * from a page — said plainly in the failure, because the alternative is a bare
 * "Failed to fetch" that looks like the app's fault.
 */
export class HttpTransport {
  constructor({ url, headers = {}, timeout = 60_000 }) {
    this.url = url
    this.headers = headers
    this.timeout = timeout
    this.sessionId = ''
  }

  async send(request) {
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), this.timeout)

    let response
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Both, because the server picks.
          accept: 'application/json, text/event-stream',
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
          ...this.headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
    } catch (err) {
      return Outcome.failed(
        Reason.UNAVAILABLE,
        err?.name === 'AbortError'
          ? `${this.url} did not answer within ${this.timeout}ms`
          : `could not reach ${this.url}: ${err?.message ?? err}`,
        {
          hint: 'A browser can only reach an MCP server that sends CORS headers. A server meant for a desktop client usually does not.',
        },
      )
    } finally {
      clearTimeout(deadline)
    }

    const issued = response.headers.get('mcp-session-id')
    if (issued) this.sessionId = issued

    if (!response.ok) {
      const detail = await response
        .text()
        .then((t) => t.slice(0, 300))
        .catch(() => '')
      return Outcome.failed(
        Reason.UNAVAILABLE,
        `HTTP ${response.status} from ${this.url} ${detail}`,
      )
    }

    const body = await response.text()
    const type = response.headers.get('content-type') ?? ''
    return type.includes('text/event-stream')
      ? HttpTransport.fromEventStream(body, request.id)
      : Outcome.attempt(() => JSON.parse(body), {
          code: Reason.UNAVAILABLE,
          hint: 'The server answered with something that is not JSON.',
        })
  }

  /**
   * A message with no id.
   *
   * The Streamable HTTP transport answers a notification with 202 and no body,
   * so there is nothing to read and nothing to match. A server that refuses one
   * is not a fault worth failing a run over — the note goes nowhere and the
   * next real request will say so properly.
   */
  async notify(message) {
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
          ...this.headers,
        },
        body: JSON.stringify(message),
      })
    } catch {
      // Deliberately swallowed. See above: a notification has no result, and a
      // transport failure here will recur on the next request that has one.
    }
    return Outcome.ok(null)
  }

  /**
   * Pull one reply out of an SSE body.
   *
   * A stream may carry notifications and progress alongside the answer, so the
   * frames are matched on the request id rather than taking the first or the
   * last — either of those reads a progress notification as the result.
   */
  static fromEventStream(body, id) {
    let last = null
    for (const frame of String(body).split(/\r?\n\r?\n/)) {
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        let parsed
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        if (parsed?.id === id) return Outcome.ok(parsed)
        last = parsed
      }
    }
    return last
      ? Outcome.ok(last, ['the server answered without matching the request id'])
      : Outcome.failed(Reason.UNAVAILABLE, 'the event stream carried no reply')
  }
}
