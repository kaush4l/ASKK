// Cross-origin isolation without server headers (plan: "COI by service
// worker"; amends ADR-008). GitHub Pages cannot set COOP/COEP and CheerpX
// refuses to start without SharedArrayBuffer, so the worker rewrites its own
// responses — isolation "independent of the server config", the same trick the
// predecessor shipped at 80564a2:docs/askk-sw.js.
//
// This file owns HEADERS ONLY and installs no listener: a worker may call
// respondWith exactly once per fetch, so sw.js (caching/updates, ADR-007) owns
// the single fetch handler and calls this on the way out. Two responsibilities,
// two files, one handler — which is all the platform allows.

self.withCoiHeaders = function (response) {
  if (response.status === 0) return response; // opaque/error: nothing to rewrite
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  // CheerpOS reads the resolved response URL; a reconstructed Response loses
  // it, so a redirect is bounced back through the worker as a 301 instead.
  if (response.redirected) headers.set("location", response.url);
  return new Response(response.redirected ? null : response.body, {
    headers,
    status: response.redirected ? 301 : response.status,
    statusText: response.statusText,
  });
};
