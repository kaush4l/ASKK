// Three servers, each deliberately hostile to the thing being measured.
//
// 1. `staticServer` — the header-free host. It sends NO Cross-Origin-Embedder-
//    Policy, NO Cross-Origin-Opener-Policy and NO Cross-Origin-Resource-Policy,
//    because the whole point of the C1 probe is that a page reaches
//    crossOriginIsolated on a host that sends nothing. It does send a
//    distinctive `Server:` header so a browser-executed 404 control can prove
//    the page under test is talking to THIS process and not a disk cache.
//
// 2. `echoServer` — a cross-origin SSE endpoint that sends ACAO but NO CORP,
//    the same header profile as api.anthropic.com and the local testbed, and
//    RECORDS every request it receives. It is the server-side half of "does the
//    CORS preflight still reach the network under COEP" — a client-side
//    "it worked" cannot distinguish a preflight that was sent from one the
//    browser skipped.
//
// 3. `crossOriginHost` — a SECOND ORIGIN for the guest image, one port over,
//    which serves the same bytes under three header profiles so the page can be
//    told to load its guest from somewhere that is not its own host.

import { existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
}

/**
 * Serve `roots` in order, first match wins. Nothing is added to a response but
 * Content-Type, Content-Length and Server — no isolation headers, ever.
 *
 * The first root is `scripts/probe/page` and the second `public/sandbox`, so a
 * name the probe does not carry itself falls through to the tree's own file —
 * `wasi-util.js`, `browser_wasi_shim/`, and `vm-worker.js`, which no probe page
 * shadows.
 *
 * WHICH LOADER A STAGE MEASURES IS NOT UNIFORM, and reading this as "the probes
 * run what ships" is how this tree gets a claim refuted. Only the pty probe's
 * `oneshot` stage boots the shipped `vm-worker.js`. Its `session`, `bench`,
 * `speed`, `install` and `reload` stages boot `page/sandbox-pty.js`, a COPY —
 * `vm-worker.js` with one substitution, and a copy that has already drifted:
 * neither it nor `page/vm-worker-streaming.js` carries the gzip inflate the
 * shipped loader gained, so neither can boot the artifact the deploy serves.
 * A stage's evidence is worth what its loader is.
 */
export function staticServer({ port, roots }) {
  const resolved = roots.filter((r) => existsSync(r))
  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      const rel = normalize(decodeURIComponent(url.pathname))
        .replace(/^(\.\.[/\\])+/, '')
        .replace(/^\//, '')
      const name = rel === '' ? 'isolation.html' : rel
      for (const root of resolved) {
        const path = join(root, name)
        if (!path.startsWith(root)) continue
        if (!existsSync(path) || statSync(path).isDirectory()) continue
        return new Response(Bun.file(path), {
          headers: {
            'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
            server: 'askk-probe/1',
          },
        })
      }
      // The 404 control lands here. It must carry the same (absent) isolation
      // headers as everything else, or the control proves nothing.
      return new Response(`not found: ${name}\n`, {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', server: 'askk-probe/1' },
      })
    },
  })
  return {
    server,
    url: `http://127.0.0.1:${server.port}/`,
    roots: resolved,
    stop: () => server.stop(true),
  }
}

/** Cross-origin, ACAO `*`, deliberately CORP-less, and it keeps a log. */
export function echoServer({ port, frames = 40 }) {
  let log = []
  const cors = {
    'access-control-allow-origin': '*',
    // No cross-origin-resource-policy. On purpose. This is the header profile
    // that COEP was suspected of killing.
  }
  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      log.push({
        t: Date.now(),
        method: req.method,
        path: url.pathname,
        origin: req.headers.get('origin'),
        acrm: req.headers.get('access-control-request-method'),
        acrh: req.headers.get('access-control-request-headers'),
        sec_fetch_mode: req.headers.get('sec-fetch-mode'),
        sec_fetch_site: req.headers.get('sec-fetch-site'),
        cookie: req.headers.get('cookie'),
        custom: Object.fromEntries(
          ['x-api-key', 'anthropic-version', 'anthropic-dangerous-direct-browser-access']
            .map((h) => [h, req.headers.get(h)])
            .filter(([, v]) => v != null),
        ),
      })
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers':
              req.headers.get('access-control-request-headers') ?? 'content-type',
            'access-control-max-age': '0',
          },
        })
      }
      if (url.pathname.startsWith('/log')) {
        return Response.json(log, { headers: cors })
      }
      if (url.pathname.startsWith('/reset')) {
        log = []
        return Response.json([], { headers: cors })
      }
      if (req.method !== 'POST') return new Response('hello', { headers: cors })
      await req.arrayBuffer()
      const stream = new ReadableStream({
        async start(c) {
          const enc = new TextEncoder()
          for (let i = 0; i < frames; i++) {
            c.enqueue(
              enc.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: `tok${i} ` } }] })}\n\n`,
              ),
            )
            await Bun.sleep(20)
          }
          c.enqueue(enc.encode('data: [DONE]\n\n'))
          c.close()
        },
      })
      return new Response(stream, {
        headers: {
          ...cors,
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        },
      })
    },
  })
  return {
    server,
    url: `http://127.0.0.1:${server.port}`,
    read: () => log.slice(),
    stop: () => server.stop(true),
  }
}

/**
 * A SECOND ORIGIN for the guest image, with the header profile chosen per
 * request.
 *
 * The deploy question this exists for is not "can a browser fetch an image this
 * large" — it is "can it fetch that image from somewhere that is not the page's
 * own host, while the page is cross-origin isolated". Under COEP a subresource
 * needs either CORP or a passed CORS check, and the two hosts that would
 * actually take a file this size differ on exactly that: cdn.jsdelivr.net sends
 * `cross-origin-resource-policy: cross-origin`, huggingface.co's LFS CDN sends
 * only `access-control-allow-origin: *`. Both profiles are servable here, along
 * with the control that has neither.
 *
 * Different port, same host, which IS a different origin — the browser's own
 * definition includes the port, and every check under test is the browser's.
 *
 *   /corp/<file>   ACAO * and CORP cross-origin      (the cdnjs / jsDelivr profile)
 *   /cors/<file>   ACAO * only, deliberately no CORP (the huggingface profile)
 *   /bare/<file>   neither                           (the C2 control; must fail)
 *   ?part=i/n      byte range i of n, so a split artifact can be reassembled
 */
export function crossOriginHost({ port, dir }) {
  const profiles = {
    corp: { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' },
    cors: { 'access-control-allow-origin': '*' },
    bare: {},
  }
  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      const [, profile, name] = url.pathname.split('/')
      if (!profiles[profile] || !name) return new Response('not found\n', { status: 404 })
      const path = join(dir, name)
      if (!existsSync(path)) return new Response('not found\n', { status: 404 })
      const headers = {
        'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
        server: 'askk-guest-host/1',
        ...profiles[profile],
      }
      const part = url.searchParams.get('part')
      if (!part) return new Response(Bun.file(path), { headers })
      const [i, n] = part.split('/').map(Number)
      const total = statSync(path).size
      const size = Math.ceil(total / n)
      return new Response(Bun.file(path).slice(i * size, Math.min((i + 1) * size, total)), {
        headers,
      })
    },
  })
  return { server, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}
