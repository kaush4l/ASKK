#!/usr/bin/env bun
/** Serve the isolated browser acceptance page; drive it through the browser UI. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const port = Number(process.env.ASKK_BROWSER_PROBE_PORT ?? 5199)
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }
const server = Bun.serve({ hostname: '127.0.0.1', port, async fetch(request) {
  const url = new URL(request.url)
  const relative = url.pathname === '/source-browser-linux.js' ? 'src/execution/browser-linux.js' : `public${decodeURIComponent(url.pathname)}`
  const filePath = path.resolve(root, relative)
  if (!filePath.startsWith(`${root}/`)) return new Response('Forbidden', { status: 403, headers })
  const file = Bun.file(filePath)
  return await file.exists() ? new Response(file, { headers }) : new Response('Not found', { status: 404, headers })
} })
console.log(`Runtime proof server: http://127.0.0.1:${port}/browser-linux/probe.html`)
await new Promise(() => {})
