// REALM: host
/**
 * Serves the built export from a subpath, because "it works at the root" has
 * never been the question. The production site lives under /ASKK/ and a chunk
 * URL that silently resolves to the origin root 404s there and nowhere else —
 * the failure that has bricked this project before.
 *
 * The basePath is imported from next.config.ts rather than repeated here, so
 * the server cannot drift from the build it is serving.
 *
 *   bun scripts/serve-subpath.ts            # out/ at http://localhost:4599/ASKK/
 *   ASKK_PORT=5000 bun scripts/serve-subpath.ts ./out
 */
import { basePath } from '../next.config';

const root = (process.argv[2] ?? 'out').replace(/\/$/, '');
const port = Number(process.env.ASKK_PORT ?? 4599);

/** Map a request path to a file in the export, honouring trailingSlash:true. */
async function resolve(pathname: string): Promise<Response | null> {
  let p = pathname.slice(basePath.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  const file = Bun.file(root + p);
  if (await file.exists()) return new Response(file);
  // An extensionless path is a route; trailingSlash:true exports it as a
  // directory, so try the index before calling it missing.
  if (!p.includes('.')) {
    const index = Bun.file(`${root}${p}/index.html`);
    if (await index.exists()) return new Response(index);
  }
  return null;
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith(basePath)) {
      return Response.redirect(`${basePath}/`, 302);
    }
    const hit = await resolve(pathname);
    if (hit) return hit;
    // A miss is answered 404 with the export's own 404 page. Never 200 —
    // a masked 404 on a chunk is precisely what this server exists to expose.
    const notFound = Bun.file(`${root}/404.html`);
    if (await notFound.exists()) {
      return new Response(notFound, { status: 404 });
    }
    return new Response(`404 ${pathname}\n`, { status: 404 });
  },
});

console.log(`serving ${root} at http://localhost:${server.port}${basePath}/`);
