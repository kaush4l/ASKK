// Plain JS on purpose. A .ts config is loaded through the TypeScript compiler
// API, which broke this tree once already when `typescript` resolved to the 7.x
// Go rewrite and the API Next calls no longer existed. A .js config has no
// loader to break.

// One definition, used for the route prefix and exposed to the bundle so that
// code running in a worker — which has no router and no <base> — can build the
// URL of a public file. NEXT_PUBLIC_* is inlined at build time, so it reaches
// the worker chunk as a literal.
const BASE_PATH = '/ASKK'

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',

  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
    // Where the sandbox guest image is served from. Empty by default: the
    // artifact is ~100 MB and cannot live in a repository, so a build says
    // where it was published rather than carrying it. With no URL the shell
    // tool reports that it cannot run anything, which is true.
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
