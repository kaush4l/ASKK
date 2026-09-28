/** Run actual component render benchmarks through CUA only at the printed URL. */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const build = await Bun.build({ entrypoints: [resolve('scripts/fixtures/workbench-performance.jsx')], target: 'browser', minify: true, define: { 'process.env.NODE_ENV': JSON.stringify('production') } })
if (!build.success) throw new Error(build.logs.join('\n'))
const bundle = await build.outputs[0].text()
const html = `<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8"><title>ASKK synthetic UI performance</title><link rel="stylesheet" href="/workbench.css"><link rel="stylesheet" href="/xterm.css"><style>body{overflow:auto}main{max-width:1250px;margin:auto;padding:24px}h1{font-size:22px;margin-bottom:8px}p{max-width:920px;color:var(--secondary)}.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:18px 0}button{padding:9px 12px;border:1px solid var(--line-strong);border-radius:5px}label{display:flex;gap:8px;align-items:center}input{background:var(--editor);padding:8px;border:1px solid var(--line-strong)}.panes{display:grid;grid-template-columns:320px 1fr;height:420px;gap:16px}.fixture-explorer{display:block;min-height:0;border:1px solid var(--line-strong);overflow:auto}.fixture-terminal{display:flex;min-height:0;min-width:0;border:1px solid var(--line-strong)}.terminal-viewport{flex:1;min-width:0;min-height:0}pre{font:12px/1.6 monospace;white-space:pre-wrap;margin-top:20px;max-height:360px;overflow:auto}</style><div id="root"></div><script src="/fixture.js" type="module"></script></html>`
const server = Bun.serve({ hostname: '127.0.0.1', port: 5201, async fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(bundle, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } })
  if (path === '/workbench.css') return new Response(Bun.file('src/workbench/workbench.css'))
  if (path === '/xterm.css') return new Response(Bun.file('node_modules/@xterm/xterm/css/xterm.css'))
  if (path === '/results' && request.method === 'POST') { const data = await request.json(); await mkdir('.cache/workbench-performance', { recursive: true }); await writeFile('.cache/workbench-performance/latest.json', JSON.stringify(data, null, 2)); return Response.json({ saved: true }) }
  if (path !== '/') return new Response('Not found', { status: 404 })
  return new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } })
} })
console.log(`Synthetic component performance fixture: ${server.url}`)
