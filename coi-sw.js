// Cross-origin isolation without server headers (plan: "COI by service
// worker"; amends ADR-008). GitHub Pages cannot set COOP/COEP, and the Linux
// engine cannot start without SharedArrayBuffer, so the worker rewrites its own
// responses — isolation "independent of the server config", the same trick the
// predecessor shipped at 80564a2:docs/askk-sw.js.
//
// STILL LOAD-BEARING AFTER THE ENGINE CHANGED (2026-08-18). This file was
// written for CheerpX, which is gone; container2wasm needs the same thing —
// `c2w/dist/runcontainer.js` and `c2w/vendor/xterm-pty.js` both build on
// SharedArrayBuffer for the pty bridge and the worker stack. Deleting the
// header rewrite would take the shell down with it.
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
  // A reconstructed Response loses the resolved URL a redirect landed on, so a
  // redirect is bounced back through the worker as a 301 instead of being
  // rebuilt with the request's URL and quietly reported as the wrong file.
  if (response.redirected) headers.set("location", response.url);
  return new Response(response.redirected ? null : response.body, {
    headers,
    status: response.redirected ? 301 : response.status,
    statusText: response.statusText,
  });
};
