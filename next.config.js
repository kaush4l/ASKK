// Plain JS on purpose. A .ts config is loaded through the TypeScript compiler
// API, which broke this tree once already when `typescript` resolved to the 7.x
// Go rewrite and the API Next calls no longer existed. A .js config has no
// loader to break.

// One definition, used for the route prefix and exposed to the bundle so that
// code running in a worker — which has no router and no <base> — can build the
// URL of a public file. NEXT_PUBLIC_* is inlined at build time, so it reaches
// the worker chunk as a literal.
const BASE_PATH = '/ASKK'

/**
 * Where the guest image sits inside the export, relative to the base path.
 *
 * Exported because it was spelled out nine times across this file, three scripts
 * and `src/`, and the deploy's guards, the smoke's guards and the check's server
 * all have to be looking for the SAME string as the build. A guard that searches
 * for a path the build no longer writes passes on a broken artifact.
 */
export const SANDBOX_IMAGE_PATH = '/sandbox/sandbox.wasm.gz'

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',

  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
    // An OVERRIDE, not the location. `composition.js` derives the image URL
    // from the base path, because `public/sandbox/` is copied into the export
    // whole and the image ships beside the worker that loads it. Empty
    // therefore means "use the one in the export", not "there is none".
    //
    // Set it — `SANDBOX_IMAGE=<url> bun run build` — only for a deploy whose
    // host will not serve the guest image at all, which redirects every visitor
    // at once rather than asking each of them to know a URL. `docs/GATE.md`.
    NEXT_PUBLIC_SANDBOX_IMAGE: process.env.SANDBOX_IMAGE ?? '',
  },

  // The deploy target is GitHub Pages at a subpath, so the subpath is built in
  // rather than patched in afterwards: a previous tree sed-ed only the HTML and
  // the paths embedded in the JS still pointed at the root, which white-screened
  // with no console error. Dev runs at the same prefix as production on purpose.
  basePath: BASE_PATH,

  images: { unoptimized: true },

  // Not the default. Under a previous bundler a double-invoked mount stopped
  // passive effects flushing at all, which no test without a browser can see.
  // Set deliberately, never by inheritance.
  reactStrictMode: false,

  // Next 16 writes AGENTS.md and CLAUDE.md into the repo root on every dev boot.
  // This tree deleted its CLAUDE.md on purpose, so the framework is told not to
  // put one back.
  agentRules: false,
}

export default config
