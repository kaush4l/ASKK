import { afterEach, describe, expect, test } from 'bun:test'
import { browserHttp, buildKernel } from '../../src/backend/composition.js'
import { Blocked } from '../../src/core/tools/HttpPort.js'
import { Request } from '../../src/protocol/Envelope.js'

/**
 * The half of the web tools that had no tests and all of the risk.
 *
 * `FetchTool` and `SearchTool` are trivially fakeable — they take a port — and
 * they are thoroughly covered. `browserHttp` is the port, and it holds every
 * behaviour the port abstraction was introduced to make testable: the streaming
 * cap, the decoder fallback, the CORS-versus-unreachable discriminator, and the
 * deadline. Four defects lived in exactly the half nothing exercised, three of
 * which are asserted below.
 *
 * `globalThis.fetch` is replaced rather than a server being started. Not to
 * avoid the network — a loopback server is not the network — but because two of
 * these cases cannot be produced by a real server at all: a stream that stalls
 * for ever, and a body that breaks mid-flight. The fake honours the abort signal
 * the same way a real `fetch` does, which is the one behaviour of the real thing
 * this depends on.
 */

const REAL_FETCH = globalThis.fetch
afterEach(() => {
  globalThis.fetch = REAL_FETCH
})

/**
 * A response whose body is whatever the chunks are, driven by the test.
 *
 * Fed one chunk per `pull` rather than all of them in `start`, because
 * `controller.error()` discards a queue: enqueuing everything up front and then
 * erroring produces a stream the reader never sees a byte of, which is the
 * opposite of the case being written down — bytes that DID arrive before the
 * connection went.
 */
function streaming({ chunks = [], close = true, breakAfter = -1, status = 200, headers = {} }) {
  return (signal) => {
    let index = 0
    const body = new ReadableStream({
      start(controller) {
        // The signal is what ends an unclosed stream — exactly what a real
        // fetch does, and the only way to write down a trickling origin.
        signal?.addEventListener('abort', () => {
          if (!close) controller.error(new Error('aborted'))
        })
      },
      pull(controller) {
        if (index > breakAfter && breakAfter >= 0) {
          controller.error(new Error('the connection reset'))
          return
        }
        if (index < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[index++]))
          return
        }
        if (close) controller.close()
      },
    })
    return new Response(body, { status, headers })
  }
}

describe('browserHttp', () => {
  test('a body arrives whole, and the address that answered is the one reported', async () => {
    globalThis.fetch = async (url, init) => {
      const response = streaming({
        chunks: ['hello ', 'world'],
        headers: { 'content-type': 'text/plain' },
      })(init?.signal)
      // A redirect, which is the case the `url` field exists for.
      Object.defineProperty(response, 'url', { value: 'https://example.com/landed' })
      expect(url).toBe('https://example.com/asked')
      return response
    }

    const got = await browserHttp({ url: 'https://example.com/asked', limit: 1000, timeout: 5000 })

    expect(got.ok).toBe(true)
    expect(got.value.text).toBe('hello world')
    expect(got.value.truncated).toBe(false)
    expect(got.value.stopped).toBe('')
    expect(got.value.blocked).toBe(Blocked.NONE)
    expect(got.value.url).toBe('https://example.com/landed')
  })

  test('a body of exactly the cap is whole; one byte more is truncated', async () => {
    globalThis.fetch = async (_url, init) => streaming({ chunks: ['a'.repeat(100)] })(init?.signal)
    const exact = await browserHttp({ url: 'https://example.com/', limit: 100, timeout: 5000 })

    // The off-by-one that told the model a complete page might be missing its
    // end. `>=` took the truncation branch on a body that had all of itself.
    expect(exact.value.truncated).toBe(false)
    expect(exact.value.text.length).toBe(100)
    expect(exact.value.bytes).toBe(100)

    const over = await browserHttp({ url: 'https://example.com/', limit: 99, timeout: 5000 })
    expect(over.value.truncated).toBe(true)
    expect(over.value.text.length).toBe(99)
    expect(over.value.bytes).toBe(99)
  })

  test('an origin that answers and then trickles is a timeout, not a turn that never ends', async () => {
    globalThis.fetch = async (_url, init) =>
      streaming({
        chunks: ['the headers arrived and then nothing did'],
        close: false,
        headers: { 'content-type': 'text/html' },
      })(init?.signal)

    const started = Date.now()
    const got = await browserHttp({ url: 'https://slow.example/', limit: 5000, timeout: 60 })
    const waited = Date.now() - started

    // The deadline used to be cleared the instant the HEADERS arrived, so this
    // call did not return at all — measured still pending at 30s against a 20s
    // advertised deadline. It has to come back, and it has to say which kind of
    // nothing it is, because "timeout" and "refused" are different next moves.
    expect(got.value.blocked).toBe(Blocked.TIMEOUT)
    expect(waited).toBeLessThan(3000)
  })

  test('a body that breaks part-way keeps what arrived and says why', async () => {
    globalThis.fetch = async (_url, init) =>
      streaming({
        chunks: ['the first half of the answer', 'never sent'],
        breakAfter: 0,
        headers: { 'content-type': 'text/plain' },
      })(init?.signal)

    const got = await browserHttp({ url: 'https://example.com/', limit: 5000, timeout: 5000 })

    // What was thrown away before: six bytes of a real body binned, and the
    // tool then told the model the response had no readable content.
    expect(got.ok).toBe(true)
    expect(got.value.text).toBe('the first half of the answer')
    expect(got.value.stopped).toContain('connection reset')
  })

  test('a refusal and a dead host are told apart by a second request, sent as the first one was', async () => {
    const seen = []
    const failing = (answerNoCors) => async (url, init) => {
      seen.push({ url, mode: init?.mode, method: init?.method, body: init?.body })
      if (init?.mode === 'no-cors') {
        if (answerNoCors) return new Response(null, { status: 204 })
        throw new TypeError('Failed to fetch')
      }
      throw new TypeError('Failed to fetch')
    }

    globalThis.fetch = failing(true)
    const refused = await browserHttp({
      url: 'https://api.example/search',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"query":"zig"}',
      timeout: 5000,
    })

    globalThis.fetch = failing(false)
    const gone = await browserHttp({ url: 'https://no-such-host.invalid/', timeout: 5000 })

    expect(refused.value.blocked).toBe(Blocked.REFUSED)
    expect(gone.value.blocked).toBe(Blocked.UNREACHABLE)

    // The probe is the SAME request. A bare GET would diagnose a failed POST by
    // asking an endpoint a question it was never asked, and an endpoint that
    // answers GET and refuses POST would be reported as a permanent refusal.
    const probe = seen[1]
    expect(probe.mode).toBe('no-cors')
    expect(probe.method).toBe('POST')
    expect(probe.body).toBe('{"query":"zig"}')
  })
})

/**
 * The one statement in this file that nothing could witness.
 *
 * `buildKernel` hands the chat service its ports, and deleting the `http` line
 * was measured to leave the whole gate green — lint, 316 tests, the export and
 * the browser smoke — while every web tool answered `this build cannot make an
 * HTTP request` for ever, silently, in every build. Lint cannot see it because
 * `browserHttp` is exported, so the value is never unused; the suite cannot see
 * it because a Kernel route is a bound method and a caller holding the kernel
 * cannot reach the object behind it. So the service comes back beside the
 * kernel and this reads the ports off it.
 *
 * Identity, not shape: `typeof chat.services.http === 'function'` would pass on
 * any function at all, and the failure being written down is a port that was
 * never connected rather than one connected to the wrong thing.
 */
describe('the ports buildKernel hands the chat service', () => {
  test('the real HTTP port is the one the chat service holds', async () => {
    const { chat } = await buildKernel()

    expect(chat.services.http).toBe(browserHttp)
  })

  /**
   * This test used to assert that the sandbox was truthy and had a `run`
   * method, and it was green for the entire life of a build in which every
   * `shell` call returned UNAVAILABLE without one byte being fetched: the image
   * URL came from a variable nothing anywhere set, so `available` was false and
   * the object it was asserting about could not run a command. Truthiness is
   * the assertion that cost this tree the sandbox.
   */
  test('and the sandbox it built can actually run something', async () => {
    const { chat } = await buildKernel()

    expect(chat.services.sandbox.available).toBe(true)
  })

  test('the image is fetched from beside the worker it is paired with', async () => {
    const { imageUrl, workerUrl } = (await buildKernel()).chat.services.sandbox

    // Written as one URL derived from the other rather than as two literals:
    // the claim is that they share a directory, which is what makes deriving
    // the image the same way as the worker correct. Two spelled-out constants
    // would pass with the pair pointing at different hosts.
    expect(imageUrl).toBe(workerUrl.replace('vm-worker.js', 'sandbox.wasm.gz'))
    expect(workerUrl.endsWith('/sandbox/vm-worker.js')).toBe(true)
  })

  /**
   * The extension is the deploy, not a preference. 107,054,914 bytes is 2,197,314
   * over GitHub's 100 MiB per-file block, so the raw module can be in neither the
   * repository nor the Pages branch and the live page answered 404 for it; the
   * gzipped image is 40,029,960 bytes and GitHub takes it. Asserted here because
   * `.wasm` reads as the obvious spelling and is the one that ships a dead page.
   */
  test('and it asks for the compressed image, which is the only one a repository can carry', async () => {
    const { imageUrl } = (await buildKernel()).chat.services.sandbox

    expect(imageUrl.endsWith('.wasm.gz')).toBe(true)
  })

  test('a deploy whose host will not serve the image can point the build elsewhere', async () => {
    // The override that replaces the setting the failure hint used to promise.
    // It is read at build time, so this is the only realm it can be exercised
    // in; in the browser Next has already inlined it as a literal.
    process.env.NEXT_PUBLIC_SANDBOX_IMAGE = 'https://cdn.example/guest.wasm'
    try {
      const { chat } = await buildKernel()

      expect(chat.services.sandbox.imageUrl).toBe('https://cdn.example/guest.wasm')
    } finally {
      delete process.env.NEXT_PUBLIC_SANDBOX_IMAGE
    }
  })
})

/**
 * The route the page reaches the agent's files through.
 *
 * Driven through `kernel.handle` and a real `Request` rather than by calling
 * `FilesService` directly, because the thing that was missing was never the
 * class: `Workspace` has had `list` and `read` since the store landed, and a
 * unit test of either would have been green throughout the wave in which the
 * accountant wrote "the human cannot open, list, download or add one file".
 * What was missing was a NAME on the kernel, and only the front door can say
 * whether a name is there.
 */
describe('the files routes', () => {
  test('the page can ask for them by name', async () => {
    const { kernel } = await buildKernel()

    expect(kernel.methods).toContain('files.list')
    expect(kernel.methods).toContain('files.read')
  })

  /**
   * Identity, for the reason the HTTP port above is asserted by identity: two
   * `Workspace` objects over one store would be two write queues over one
   * store, and every assertion below would still pass while the page read a
   * workspace the agent never wrote to.
   */
  test('and they are the workspace the agent writes to, not a second one', async () => {
    const { kernel, chat } = await buildKernel()

    const handler = kernel._routes.get('files.read')
    expect(chat.services.files).toBeTruthy()
    // Reached through the bound method the kernel actually calls: `register`
    // binds `service[name]`, so this is the object on the other side of the
    // route and not one this test constructed.
    const written = await chat.services.files.write('through-the-agent.md', 'kiwi-7742-anchor')
    expect(written.ok).toBe(true)

    const read = await handler({ path: 'through-the-agent.md' })
    expect(read.value).toEqual({
      path: 'through-the-agent.md',
      text: 'kiwi-7742-anchor',
      bytes: 16,
    })
  })

  test('a file written by the agent is listed and read back over the wire', async () => {
    const { kernel, chat } = await buildKernel()
    await chat.services.files.write('src/deep.txt', 'deep')
    await chat.services.files.write('notes.md', '# plan\n')

    const listed = await kernel.handle(new Request('a', 'files.list'))
    expect(listed.ok).toBe(true)
    // Sorted, and the order is `Workspace`'s so that the in-memory fallback and
    // IndexedDB are not two different products.
    expect(listed.value).toEqual([{ path: 'notes.md' }, { path: 'src/deep.txt' }])

    const opened = await kernel.handle(new Request('b', 'files.read', { path: 'notes.md' }))
    expect(opened.ok).toBe(true)
    expect(opened.value.text).toBe('# plan\n')
    expect(opened.value.bytes).toBe(7)
  })

  test('a file that is not there is an answer, not an error on screen', async () => {
    const { kernel } = await buildKernel()

    const opened = await kernel.handle(new Request('c', 'files.read', { path: 'gone.md' }))
    expect(opened.ok).toBe(true)
    expect(opened.value).toBe(null)
    expect(opened.error).toBe(null)
  })

  test('an unusable path is refused in a sentence, over the wire, and nothing throws', async () => {
    const { kernel } = await buildKernel()

    const opened = await kernel.handle(new Request('d', 'files.read', { path: '../etc/passwd' }))
    expect(opened.ok).toBe(false)
    expect(opened.error.code).toBe('BAD_REQUEST')
    expect(opened.error.message).toContain('not a usable path')
    // Not the Kernel's backstop. A handler that THREW would arrive here with
    // this note attached, and the refusal being written down is a value.
    expect(opened.notes).not.toContain('this is a bug: a handler threw')
  })

  /**
   * The decision, pinned. Read-only is argued at length in `FilesService`, and
   * an argument in a comment is not a constraint — this is. A `files.write`
   * appearing on the kernel means somebody added a route without the
   * compare-and-set that comment says it must arrive with.
   */
  test('and there is no way for the page to write one', async () => {
    const { kernel } = await buildKernel()

    expect(kernel.methods.filter((name) => name.startsWith('files.'))).toEqual([
      'files.list',
      'files.read',
    ])
  })
})
