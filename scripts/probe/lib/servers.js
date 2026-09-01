// Two servers, both deliberately hostile to the thing being measured.
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

import { existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
}

/**
 * Serve `roots` in order, first match wins. Nothing is added to a response but
 * Content-Type, Content-Length and Server — no isolation headers, ever.
 *
 * The second root is normally `public/sandbox`, so the pty probe loads the
 * TREE'S OWN `vm-worker.js`, `wasi-util.js` and `browser_wasi_shim/` rather
 * than copies that can drift away from them.
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
