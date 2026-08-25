/**
 * What a host test needs to stand in for the browser: a segment store in a Map,
 * and a `fetch` that answers from a script and REMEMBERS WHAT WAS SENT — which
 * is the half these tests are about, because the credential rules are the part
 * worth executing and a network is not required to execute them.
 */

/** @typedef {import('@harness/core').SegmentStore} SegmentStore */

/** @returns {SegmentStore & {all: () => string}} */
export function memorySegments() {
  /** @type {Map<string, Map<number, string>>} */
  const streams = new Map()
  const of = (/** @type {string} */ stream) => {
    const held = streams.get(stream) ?? new Map()
    streams.set(stream, held)
    return held
  }
  return {
    /** Every persisted byte, as one string — what a test greps for a secret. */
    all: () => [...streams.values()].flatMap((held) => [...held.values()]).join('\n'),
    async put(stream, index, text) {
      of(stream).set(index, text)
    },
    async range(stream, from = 0) {
      return [...of(stream)]
        .filter(([index]) => index >= from)
        .sort((a, b) => a[0] - b[0])
        .map(([index, text]) => ({ index, text }))
    },
    async delete(stream, index) {
      of(stream).delete(index)
    },
  }
}

/** @typedef {{url: string, headers: Record<string, string>, body: Record<string, unknown>}} Sent */

/**
 * A `fetch` that answers each call with the next scripted reply and records the
 * request. A reply is either whole JSON or a list of SSE frames, so one double
 * covers both halves of the protocol.
 * @param {Array<{status?: number, json?: unknown, sse?: string[], body?: string}>} script
 * @returns {{fetch: typeof fetch, sent: Sent[]}}
 */
export function scriptedFetch(script) {
  /** @type {Sent[]} */
  const sent = []
  let next = 0
  const send = async (/** @type {string|URL|Request} */ url, /** @type {RequestInit} */ init = {}) => {
    sent.push({
      url: String(url),
      headers: /** @type {Record<string, string>} */ (init.headers ?? {}),
      body: JSON.parse(typeof init.body === 'string' ? init.body : '{}'),
    })
    const turn = script[next++] ?? { status: 500, body: `the script ran out after ${next - 1} call(s)` }
    if (turn.sse) return new Response(sseStream(turn.sse), { status: turn.status ?? 200 })
    const body = turn.body ?? JSON.stringify(turn.json ?? {})
    return new Response(body, { status: turn.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetch: /** @type {typeof fetch} */ (/** @type {unknown} */ (send)), sent }
}

/** The frames, one enqueue at a time, so a reader really does see them arrive separately. */
function sseStream(/** @type {string[]} */ frames) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
}

/** A workspace held in a Map — enough to run the four file tools against, and no OPFS. @param {Record<string, string>} files */
export function fakeWorkspace(files) {
  /** @param {string} at */
  const under = (at) => Object.keys(files).filter((p) => (at === '.' ? !p.includes('/') : p.startsWith(`${at}/`) && !p.slice(at.length + 1).includes('/')))
  return {
    exec: async () => ({ code: 1, stdout: '', stderr: 'no shell here', truncated: false, ms: 0 }),
    read: async (/** @type {string} */ path) => {
      const text = files[path]
      if (text === undefined) throw new Error(`no file at ${path}`)
      return { text, truncated: false, lines: text.split('\n').length }
    },
    write: async (/** @type {string} */ path, /** @type {string} */ text) => void (files[path] = text),
    list: async (/** @type {string} */ at) => {
      const dirs = new Set(Object.keys(files)
        .filter((p) => (at === '.' ? p.includes('/') : p.startsWith(`${at}/`) && p.slice(at.length + 1).includes('/')))
        .map((p) => (at === '.' ? p : p.slice(at.length + 1)).split('/')[0] ?? ''))
      return [
        ...[...dirs].map((name) => ({ name, dir: true, size: 0 })),
        ...under(at).map((p) => ({ name: p.slice(at === '.' ? 0 : at.length + 1), dir: false, size: (files[p] ?? '').length })),
      ]
    },
    interrupt: () => 'nothing to interrupt',
    durable: () => false,
  }
}

