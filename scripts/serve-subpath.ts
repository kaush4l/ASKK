// REALM: host
/**
 * Serves the built export from a subpath, because "it works at the root" has
 * never been the question. The production site lives under /ASKK/ and a chunk
 * URL that silently resolves to the origin root 404s there and nowhere else —
 * the failure that has bricked this project before.
 *
 *   bun scripts/serve-subpath.ts            # out/ at http://localhost:4599/ASKK/
 *   ASKK_PORT=5000 bun scripts/serve-subpath.ts ./out
 *
 * Two things this file got wrong, both found by the critic, both of the same
 * kind — a server that answers 200 to a request the real host would 404:
 *
 * 1. A catch-all redirect sent every path outside the basePath to the index,
 *    so `/nope.woff2` and a root-absolute `/_next/...` chunk both came back
 *    200 text/html. That is precisely the brick this file exists to expose,
 *    reported as a success. Only `''` and `/` redirect now. Everything else
 *    outside the prefix is a 404.
 * 2. The basePath was read from `next.config.ts`, whose value comes from an
 *    environment variable read *in this process* — so a build made at one
 *    prefix was happily served at another, every asset 404ing in the real
 *    world and 200 here. The prefix is now read out of the export's own asset
 *    references, which is the only copy that cannot drift from the build, and
 *    the server refuses to start when the two disagree.
 */
import { basePath as configured } from '../next.config';

const root = (process.argv[2] ?? 'out').replace(/\/$/, '');
const port = Number(process.env.ASKK_PORT ?? 4599);

const indexPath = `${root}/index.html`;
const indexHtml = await Bun.file(indexPath).text().catch(() => '');
if (!indexHtml) {
  console.error(`no export at ${indexPath} — run \`bun run build\` first`);
  process.exit(1);
}

/** The prefix the export's own `_next` references carry: the basePath the build recorded. */
const built = indexHtml.match(/(?:src|href)="(\/[^"]*?)\/_next\//)?.[1] ?? '';
if (built !== configured) {
  console.error(
    `the export at ${root} was built for ${built || '(root)'}, but next.config.ts says ${configured}.\n` +
      `Serving it anyway would answer 200 to paths the real host 404s. Rebuild, or unset ASKK_BASE_PATH.`,
  );
  process.exit(1);
}
const basePath = built;

/** Map a request path to a file in the export, honouring trailingSlash:true.
 * The path is percent-decoded: a font at `ui/fonts/…` is requested encoded and
 * would otherwise be looked up under its literal `%20`. */
async function resolve(pathname: string): Promise<Response | null> {
  let p = decodeURIComponent(pathname).slice(basePath.length) || '/';
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

/** The export's own 404 page, at status 404. Never 200 — a masked 404 on a
 * chunk is precisely what this server exists to expose. */
async function notFound(pathname: string): Promise<Response> {
  const page = Bun.file(`${root}/404.html`);
  if (await page.exists()) return new Response(page, { status: 404 });
  return new Response(`404 ${pathname}\n`, { status: 404 });
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    // The origin root is a convenience for a human typing the hostname, and it
    // is the ONLY path outside the prefix that is answered with anything but a
    // 404. `/nope.woff2` and `/_next/...` are what a wrong build asks for, and
    // the real host answers those 404.
    if (pathname === '' || pathname === '/') {
      return Response.redirect(`${basePath}/`, 302);
    }
    // `/ASKK` without the slash is a 301 on GitHub Pages. Answering it 200
    // here would make this server more forgiving than production, in the one
    // direction that hides failures.
    if (pathname === basePath) {
      return new Response(null, { status: 301, headers: { location: `${basePath}/` } });
    }
    if (!pathname.startsWith(`${basePath}/`)) {
      return notFound(pathname);
    }
    const hit = await resolve(pathname);
    return hit ?? (await notFound(pathname));
  },
});

console.log(`serving ${root} at http://localhost:${server.port}${basePath}/`);
