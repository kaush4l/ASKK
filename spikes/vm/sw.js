// Spike E — cross-origin isolation without server headers.
//
// GitHub Pages cannot set COOP/COEP, and the Linux engine refuses to start
// without SharedArrayBuffer. (This spike was written against CheerpX, which
// was deleted on 2026-08-18; container2wasm needs SharedArrayBuffer for the
// same reasons — see web/coi-sw.js, which is the shipping copy of this
// reasoning.) The service worker rewrites its own responses instead, so
// isolation is "independent of the server config" — the same trick the
// predecessor shipped at 80564a2:docs/askk-sw.js and the one WebVM uses today.
// Distinct from web/sw.js, which is caching/updates only (ADR-007).

async function handleFetch(request) {
	const r = await fetch(request);
	if (r.status === 0) return r;
	const headers = new Headers(r.headers);
	headers.set("Cross-Origin-Embedder-Policy", "require-corp");
	headers.set("Cross-Origin-Opener-Policy", "same-origin");
	headers.set("Cross-Origin-Resource-Policy", "cross-origin");
	// CheerpOS reads the resolved response URL; a reconstructed Response loses
	// it, so a redirect is bounced back through the worker as a 301 instead.
	if (r.redirected) headers.set("location", r.url);
	return new Response(r.redirected ? null : r.body, {
		headers,
		status: r.redirected ? 301 : r.status,
		statusText: r.statusText,
	});
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => e.respondWith(handleFetch(e.request)));
