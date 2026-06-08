// Tiny static file server for the WASIX spike.
//
// @wasmer/sdk needs SharedArrayBuffer, which browsers only expose to
// cross-origin-isolated documents. That requires these two response headers on
// the top-level HTML document (and the worker):
//
//   Cross-Origin-Opener-Policy:   same-origin
//   Cross-Origin-Embedder-Policy: require-corp
//
// On gh-pages we cannot set response headers, so the same isolation is faked by
// a service worker (coi-serviceworker). See docs/spikes/coi-serviceworker.md.
// This local server sets the real headers so the spike runs without the SW.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8107);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  // Cross-origin isolation headers on EVERY response (document + worker + wasm).
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  // Let our own subresources be embedded under require-corp.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "no-store");

  try {
    let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";

    // Resolve against the spike dir and refuse path traversal.
    const filePath = normalize(join(here, urlPath));
    if (!filePath.startsWith(here)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found: " + urlPath);
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error: " + (err?.message ?? String(err)));
  }
});

server.listen(PORT, () => {
  console.log(`WASIX spike serving on http://localhost:${PORT}/`);
  console.log("COOP/COEP cross-origin isolation headers are ON.");
});
