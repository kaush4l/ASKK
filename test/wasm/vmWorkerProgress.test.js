import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

/**
 * The download report `public/sandbox/vm-worker.js` posts, executed.
 *
 * That file is a CLASSIC worker — it opens with `importScripts` for a vendored
 * UMD shim — so no test can import it and, until this one, nothing anywhere ran
 * a line of it outside a browser. What it says about the largest download this
 * app makes was wrong on both of the host profiles it ships to, and both are
 * driven by `scripts/deploy-check.js` on every run: GitHub Pages answers this
 * file with no `content-length`, and a host that answers a `.gz` with
 * `Content-Encoding: gzip` sends a length that counts the compressed body while
 * the decoded one is what arrives.
 *
 * So the file is evaluated the way the worker realm evaluates it, with
 * `importScripts` and `self` supplied, and the functions it declares are handed
 * back. This is the same trade `test/wasm/buildGuard.test.js` makes with
 * `build.sh`: deliberately brittle, because a file that no longer declares
 * `counted` fails here rather than passing over a report nobody executes.
 *
 * What it cannot prove is the boot around it — a real body, a real
 * `WebAssembly.compile`, a real guest — which is `scripts/smoke.js` and
 * `scripts/deploy-check.js`, and only they can.
 */
const WORKER = join(import.meta.dir, '..', '..', 'public', 'sandbox', 'vm-worker.js')

async function worker(path = WORKER) {
  const source = await Bun.file(path).text()
  const posted = []
  const evaluate = new Function('importScripts', 'self', `${source}\nreturn { counted, inflated }`)
  const declared = evaluate(() => {}, { postMessage: (message) => posted.push(message) })
  return { ...declared, posted }
}

/** A body that arrives in megabyte pieces, as this one does over a network. */
const arriving = (bytes, piece = 1024 * 1024) =>
  new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes; at += piece)
        controller.enqueue(new Uint8Array(Math.min(piece, bytes - at)))
      controller.close()
    },
  })

describe('what the guest download says while it is arriving', () => {
  test('a host that declares no length is reported without one, not as a total of zero', async () => {
    // What GitHub Pages sends for this file. Reported as 0 it was a number, so
    // every reader divided by it: a bar frozen at 0% for the whole of a fifty
    // megabyte download.
    const { counted, posted } = await worker()

    await counted(new Response(arriving(4 * 1024 * 1024)))

    expect(posted.length).toBeGreaterThan(1)
    expect(posted.every((message) => message.total === null)).toBe(true)
    expect(posted.at(-1)).toEqual({
      type: 'boot-progress',
      loaded: 4 * 1024 * 1024,
      total: null,
    })
  })

  test('a length that counts the compressed body is not reported against the decoded one', async () => {
    // The other measured arm: 52,602,121 declared for a body that arrives as
    // 143,205,983 decoded bytes, which was a bar that read 272%.
    const { counted, posted } = await worker()

    await counted(
      new Response(arriving(4 * 1024 * 1024), {
        headers: { 'content-length': '1048576', 'content-encoding': 'gzip' },
      }),
    )

    expect(posted.every((message) => message.total === null)).toBe(true)
  })

  test('a length the body then runs past stops being reported the moment it does', async () => {
    // The same defect read off the bytes rather than off a header, because a
    // header is something a browser may decline to show and an overrun is not:
    // a body longer than its declared length was declared in some other unit.
    const { counted, posted } = await worker()

    await counted(
      new Response(arriving(4 * 1024 * 1024), { headers: { 'content-length': '1048576' } }),
    )

    expect(posted[0].total).toBe(1048576)
    expect(posted.at(-1).total).toBe(null)
  })

  test('a length that is a count of the bytes arriving is reported, so a fraction can be drawn', async () => {
    const { counted, posted } = await worker()

    await counted(
      new Response(arriving(4 * 1024 * 1024), { headers: { 'content-length': '4194304' } }),
    )

    expect(posted.at(-1)).toEqual({ type: 'boot-progress', loaded: 4194304, total: 4194304 })
  })

  test('counting the body does not change it, gzip and all', async () => {
    // The counter sits in front of the same `arrayBuffer()` it replaced rather
    // than joining a list of chunks, and the thing that must survive that is
    // the body: what comes out is what `inflated` sniffs and what
    // `WebAssembly.compile` is handed.
    const { counted, inflated } = await worker()
    const image = new Uint8Array(3 * 1024 * 1024).map((_, at) => at % 251)

    const carried = await counted(new Response(new Blob([Bun.gzipSync(image)]).stream()))
    const out = new Uint8Array(await inflated(carried))

    expect(carried.byteLength).toBe(Bun.gzipSync(image).byteLength)
    expect(Buffer.compare(Buffer.from(out), Buffer.from(image))).toBe(0)
  })
})
