/* Scoped response headers for static hosting. Never proxies third-party requests. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return
  event.respondWith((async () => {
    const path = url.href.slice(self.registration.scope.length)
    const immutable = path.startsWith('_next/static/') || /^browser-linux\/generated\/c2w-node24-[a-f0-9]{16}\//.test(path)
    // The module graph, prompts and current manifest have stable URLs. A browser
    // HTTP-cache hit must not combine yesterday's modules with today's shell.
    const response = await fetch(event.request, immutable ? undefined : { cache: 'reload' })
    if (response.type === 'opaque' || response.status === 0) return response
    const headers = new Headers(response.headers)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
    headers.set('Cross-Origin-Resource-Policy', 'same-origin')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })())
})
