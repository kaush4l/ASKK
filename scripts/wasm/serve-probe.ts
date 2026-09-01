// REALM: host
/**
 * Serves scripts/wasm/boot-probe/ with deliberately NO COOP/COEP headers, so a
 * page measured here is measured under the constraint NORTH-STAR imposes: the
 * deploy target is GitHub Pages and it cannot set response headers. If a
 * substrate needs cross-origin isolation, it must fail here, visibly.
 *
 *   bun scripts/wasm/serve-probe.ts [dir] [port]
 */
import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const dir = process.argv[2] ?? join(import.meta.dir, "boot-probe");
const port = Number(process.argv[3] ?? 4611);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const path = join(dir, rel === "/" ? "index.html" : rel);
    if (!existsSync(path) || statSync(path).isDirectory()) {
      return new Response("not found", { status: 404 });
    }
    // No Cross-Origin-Opener-Policy. No Cross-Origin-Embedder-Policy. On
    // purpose: crossOriginIsolated must read false in every measurement.
    return new Response(Bun.file(path), {
      headers: { "cache-control": "no-store" },
    });
  },
});
console.log(`serving ${dir} at http://localhost:${port}/ (no COOP/COEP)`);
