// HTTP helpers shared by the host API and its capabilities.
//
//   throw new HttpError(404, "Not found.")   an error the host API answers with that status
//   httpError(403, "…")                      the same, as an expression
//   json(status, body)                       a no-store JSON Response
//   forward(prefix, api, { route: "method" })  POST routes "<prefix>/<route>" that hand the body to api[method]
//   sseResponse(request, open)               a Server-Sent Events Response, pinged; open(send, end) → a cleanup

import { SSE_PING_MS } from "./config.js"

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export const httpError = (status, message) => new HttpError(status, message)

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

// POST routes "<prefix>/<route>" that hand the JSON body to api[method].
export const forward = (prefix, api, methods) => Object.fromEntries(Object.entries(methods).map(([route, method]) => [`${prefix}/${route}`, (body) => api[method](body)]))

// A Server-Sent Events Response. open(send, end) runs when the stream starts: send(event) writes a `data:` row of JSON, end()
// closes the stream; what open returns runs once when the stream ends (the tab left, end(), a send that failed).
export function sseResponse(request, open) {
  const encoder = new TextEncoder()
  let controller = null
  let ping = null
  let cleanup = null
  let ended = false
  const write = (text) => {
    try {
      controller.enqueue(encoder.encode(text))
    } catch {
      end()
    }
  }
  function end() {
    if (ended) return
    ended = true
    clearInterval(ping)
    cleanup?.()
    try {
      controller?.close()
    } catch {}
  }
  const body = new ReadableStream({
    start(c) {
      controller = c
      cleanup = open((event) => write(`data: ${JSON.stringify(event)}\n\n`), end)
      if (ended) return cleanup?.()
      ping = setInterval(() => write(": ping\n\n"), SSE_PING_MS)
      request?.signal?.addEventListener("abort", end, { once: true })
    },
    cancel: end,
  })
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } })
}
