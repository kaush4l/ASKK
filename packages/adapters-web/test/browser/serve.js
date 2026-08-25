#!/usr/bin/env bun
/**
 * Serve the workspace so a browser can import the real package sources — no
 * bundler, no build step, an import map in the page instead. Open the printed
 * address; the page runs the suite and every line says PASS or FAIL.
 *
 *   bun packages/adapters-web/test/browser/serve.js
 */
const ROOT = new URL('../../../../', import.meta.url).pathname
const PORT = Number(Bun.env['PORT'] ?? 4321)
const PAGE = '/packages/adapters-web/test/browser/index.html'

Bun.serve({
  port: PORT,
  async fetch(request) {
    const path = new URL(request.url).pathname
    const file = Bun.file(ROOT + (path === '/' ? PAGE : path).slice(1))
    if (!(await file.exists())) return new Response(`no such file: ${path}`, { status: 404 })
    return new Response(file, { headers: { 'content-type': contentType(path) } })
  },
})

/** Bun infers most of these; `.js` must be a module or the browser refuses to import it. */
function contentType(/** @type {string} */ path) {
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'text/html; charset=utf-8'
}

console.log(`browser checks: http://localhost:${PORT}${PAGE}`)
