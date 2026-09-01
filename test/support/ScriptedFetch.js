/**
 * A `fetch` that answers from a captured response instead of from a network.
 *
 * `ScriptedInference` replaces the transport, so it can measure what the engine
 * SENDS and nothing about what a transport DOES with what comes back. The
 * defect this file was built for lives entirely in that second half: a
 * `finish_reason` the transport never read, on a reply the transport parsed
 * wrongly. No amount of scripting at the `invoke()` seam can see it, because
 * `invoke()` is the thing that is broken.
 *
 * So this swaps the seam one layer lower — `globalThis.fetch` — and the real
 * `OpenAICompatible.invoke` and `.stream` run against a real captured HTTP
 * response, headers, chunk boundaries and all. What the test asserts is then
 * what the shipped code would do with what the endpoint really said.
 *
 * Chunking is deliberate. A streamed fixture handed over as one chunk would
 * never exercise the buffering in `Inference._postStream`, and a frame split
 * mid-line is exactly the case that buffering exists for — so the body is cut at
 * an awkward size that lands inside frames rather than between them. It is a
 * constant rather than an option because every test wants the awkward case and
 * none has ever wanted a different one.
 */
const CHUNK = 997

export class ScriptedFetch {
  /**
   * @param {Array<{json?: object, sse?: string, hang?: boolean}>} replies
   *   answered in order. `json` is serialised; `sse` is streamed as
   *   `text/event-stream`. Running out is an HTTP 599, not a hang — a test that
   *   asks for one more call than it scripted should fail loudly and quickly.
   *
   *   `hang: true` is the one that could not be faked at any higher seam: a
   *   response that NEVER arrives and settles only when the signal aborts. It
   *   is what tells a stop that reaches the socket apart from a stop that is
   *   polled between iterations, and every claim in this tree about the second
   *   kind was made without one.
   */
  constructor(replies = []) {
    this.replies = [...replies]
    /** What the transport asked for, parsed. The other half of the measurement. */
    this.bodies = []
    this._real = null
  }

  /** Swap in this fetch. Returns the function that puts the real one back. */
  install() {
    this._real = globalThis.fetch
    globalThis.fetch = (url, init) => this._answer(String(url), init)
    return () => {
      globalThis.fetch = this._real
    }
  }

  async _answer(_url, init = {}) {
    this.bodies.push(init.body ? JSON.parse(init.body) : null)

    // Aborts are honoured, because the timeout and stop paths in `Inference`
    // are the ones most likely to be got wrong and least likely to be tested.
    if (init.signal?.aborted) {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }

    const reply = this.replies.shift()
    if (!reply) {
      return new Response('the script ran out of replies', {
        status: 599,
        statusText: 'no scripted reply',
      })
    }

    if (reply.hang) {
      // Never resolves on its own. An abort rejects it exactly as fetch does,
      // which is what puts the transport's catch on the path under test.
      return new Promise((_resolve, reject) => {
        const fail = () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        }
        if (init.signal?.aborted) fail()
        else init.signal?.addEventListener('abort', fail, { once: true })
      })
    }

    if (reply.sse === undefined) {
      return new Response(JSON.stringify(reply.json ?? {}), {
        headers: { 'content-type': 'application/json' },
      })
    }

    const bytes = new TextEncoder().encode(reply.sse)
    const stream = new ReadableStream({
      start(controller) {
        for (let at = 0; at < bytes.length; at += CHUNK) {
          controller.enqueue(bytes.slice(at, at + CHUNK))
        }
        controller.close()
      },
    })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  }
}
