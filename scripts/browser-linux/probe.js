#!/usr/bin/env bun
/** Serve the isolated browser acceptance page; drive it through the browser UI. */
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const publicRoot = path.join(root, 'public')
const port = Number(process.env.ASKK_BROWSER_PROBE_PORT ?? 5199)
const proofRoot = path.join(root, '.cache/browser-linux')
const fixture = process.env.ASKK_BROWSER_PROBE_HTML && path.resolve(process.env.ASKK_BROWSER_PROBE_HTML)
const runtimeFixture = process.env.ASKK_BROWSER_PROBE_RUNTIME && path.resolve(process.env.ASKK_BROWSER_PROBE_RUNTIME)
const candidateAssets = process.env.ASKK_BROWSER_PROBE_CANDIDATE === '1' ? path.join(proofRoot, 'candidate/generated') : null
if (fixture && !fixture.startsWith(`${proofRoot}/`)) throw new Error('A diagnostic fixture must be inside .cache/browser-linux')
if (runtimeFixture && !runtimeFixture.startsWith(`${proofRoot}/`)) throw new Error('A diagnostic runtime must be inside .cache/browser-linux')
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }
const server = Bun.serve({ hostname: '127.0.0.1', port, maxRequestBodySize: 2 * 1024 * 1024, async fetch(request) {
  const url = new URL(request.url)
  if (url.pathname === '/__receipt' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403, headers })
    const name = url.searchParams.get('name')
    if (!/^[a-z0-9][a-z0-9-]{1,100}$/.test(name ?? '')) return new Response('Bad name', { status: 400, headers })
    const receipt = await request.text()
    if (new TextEncoder().encode(receipt).byteLength > 2 * 1024 * 1024) return new Response('Too large', { status: 413, headers })
    try { JSON.parse(receipt) } catch { return new Response('Bad JSON', { status: 400, headers }) }
    const output = path.join(proofRoot, `${name}.json`)
    try { await writeFile(output, receipt, { flag: 'wx' }) } catch (error) {
      if (error.code === 'EEXIST') return new Response('Receipt already exists', { status: 409, headers })
      throw error
    }
    return new Response(JSON.stringify({ saved: output }), { headers })
  }
  const adapter = url.pathname === '/source-browser-linux.js'
  let pathname
  try { pathname = decodeURIComponent(url.pathname) } catch { return new Response('Bad path', { status: 400, headers }) }
  const customFixture = fixture && pathname === '/browser-linux/probe.html'
  const customRuntime = runtimeFixture && pathname === '/browser-linux/runtime.js'
  const candidateAsset = candidateAssets && pathname.startsWith('/browser-linux/generated/')
  const filePath = candidateAsset ? path.resolve(candidateAssets, pathname.slice('/browser-linux/generated/'.length)) : customRuntime ? runtimeFixture : customFixture ? fixture : adapter ? path.join(root, 'src/execution/browser-linux.js') : path.resolve(publicRoot, `.${pathname}`)
  if (candidateAsset ? !filePath.startsWith(`${candidateAssets}/`) : !adapter && !customFixture && !customRuntime && !filePath.startsWith(`${publicRoot}/`)) return new Response('Forbidden', { status: 403, headers })
  const file = Bun.file(filePath)
  return await file.exists() ? new Response(file, { headers }) : new Response('Not found', { status: 404, headers })
} })
console.log(`Runtime proof server: http://127.0.0.1:${port}/browser-linux/probe.html`)
await new Promise(() => {})
