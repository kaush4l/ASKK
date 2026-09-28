#!/usr/bin/env node
/**
 * Development server: the tree exactly as the browser will run it, with the listing live.
 *
 *     node scripts/serve.js            # http://127.0.0.1:5173
 *     node scripts/serve.js --port 8080
 *
 * A request is answered from public/ first, then from the project root (index.html, src/).
 * `agents/index.json` is regenerated on every request, so an edited, added or removed agent
 * folder is seen on the next reload. Nothing is compiled: the file you edit is the file served.
 */

import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, relative, resolve } from 'node:path'
import { listing } from './listing.js'

const ROOT = resolve(import.meta.dirname, '..')
const PUBLIC = join(ROOT, 'public')
const args = process.argv.slice(2)
const PORT = Number(args[args.indexOf('--port') + 1] || 5173)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

async function file(path) {
  try {
    return (await stat(path)).isFile() ? path : null
  } catch {
    return null
  }
}

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname)
  response.setHeader('cache-control', 'no-cache')
  if (pathname === '/agents/index.json') {
    response.setHeader('content-type', TYPES['.json'])
    return response.end(JSON.stringify(await listing(PUBLIC)))
  }
  const wanted = pathname.endsWith('/') ? `${pathname}index.html` : pathname
  const found = (await file(join(PUBLIC, wanted))) ?? (await file(join(ROOT, wanted)))
  const from = found ? relative(ROOT, found) : '..'
  if (from.startsWith('..') || /(^|\/)(node_modules|\.git|host)(\/|$)/.test(from)) {
    response.statusCode = 404
    return response.end('not found')
  }
  response.setHeader('content-type', TYPES[extname(found)] ?? 'application/octet-stream')
  response.end(await readFile(found))
}).listen(PORT, '127.0.0.1', () => console.log(`harness dev server: http://127.0.0.1:${PORT}/  (agents from public/agents; reload to pick up edits)`))
