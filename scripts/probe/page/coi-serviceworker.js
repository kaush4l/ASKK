// Minimal coi-serviceworker, written from the technique.
// Re-serves SAME-ORIGIN responses with COOP/COEP added. Cross-origin requests
// are NOT intercepted at all, so what happens to them is the browser's native
// COEP enforcement -- which is exactly what we are here to measure.

const COEP = new URL(self.location.href).searchParams.get("coep") || "require-corp";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (ev) => {
  if (ev.data && ev.data.type === "mode") {
    ev.source.postMessage({ type: "mode", coep: COEP });
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // native path, on purpose

  event.respondWith(
    fetch(req).then((res) => {
      if (res.status === 0) return res;
      const headers = new Headers(res.headers);
      headers.set("Cross-Origin-Embedder-Policy", COEP);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    })
  );
});
