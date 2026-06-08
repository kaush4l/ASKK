#!/usr/bin/env node
// server.js — tiny static file server that sets the cross-origin-isolation
// headers container2wasm needs for SharedArrayBuffer:
//     Cross-Origin-Opener-Policy:   same-origin
//     Cross-Origin-Embedder-Policy: require-corp
//
// No dependencies (Node http + fs only). Serves experiments/container2wasm/htdocs
// on port 8105 (chosen to avoid colliding with sibling spike servers).
//
//     node server.js            # http://localhost:8105/
//     PORT=9000 node server.js  # override port

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "htdocs");
const PORT = parseInt(process.env.PORT || "8105", 10);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  // Cross-origin isolation headers on every response.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "no-store");

  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/") urlPath = "/index.html";

  // Resolve safely under ROOT (no path traversal). Require the resolved path to be
  // ROOT itself or live under ROOT + separator, so "/htdocs-evil" can't slip past.
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404: " + urlPath + "\n(did you run ./fetch-assets.sh for the container chunks?)");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
    res.setHeader("Content-Length", stat.size);
    // HEAD (used by spike.js to sum chunk sizes) must not stream a body.
    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log("container2wasm spike server: http://localhost:" + PORT + "/");
  console.log("serving " + ROOT);
  console.log("COOP/COEP isolation headers are ON (SharedArrayBuffer enabled).");
});
