import { resolve, sep } from 'node:path'
const root = resolve(import.meta.dirname, '../out')
const base = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '')
const port = Number(process.env.ASKK_PORT || 5188)
const server = Bun.serve({
  hostname: '127.0.0.1', port,
  async fetch(request) {
    let path
    try { path = decodeURIComponent(new URL(request.url).pathname) } catch { return new Response('Bad URL', { status: 400 }) }
    if (base && path !== base && !path.startsWith(`${base}/`)) return new Response('Not found', { status: 404 })
    path = path.slice(base.length)
    let target = resolve(root, `.${path || '/'}`)
    if (target !== root && !target.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
    if (path.endsWith('/') || target === root) target += '/index.html'
    let file = Bun.file(target)
    if (!(await file.exists())) file = Bun.file(`${target}/index.html`)
    if (!(await file.exists())) return new Response('Not found', { status: 404 })
    return new Response(file, { headers: { 'cache-control': 'no-cache' } })
  },
})
console.log(`Export: ${server.url}${base}/`)
