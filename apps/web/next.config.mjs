/**
 * The page is STATIC (I1): no server runtime is required for it to work, so
 * every Next feature that needs one is off by design rather than by omission.
 *
 * `basePath` is `/ASKK` because GitHub Pages serves this repo under its name.
 * It is read from an env var so a local `next dev` and a preview build are the
 * same code path as the deploy — a base path that only exists in CI is a base
 * path nobody tests.
 * @type {import('next').NextConfig}
 */
const base = process.env.HARNESS_BASE_PATH ?? ''

export default {
  output: 'export',
  basePath: base,
  assetPrefix: base || undefined,
  // GitHub Pages has no rewrite rules, so every route must be a real directory
  // with an index.html in it.
  trailingSlash: true,
  // ON, AND MEASURED ON. It was turned off for a round on a reproduction that
  // was not measuring this build: the export was served through a `Bun.serve`
  // `dir` route, which answered the page 200 and every chunk under it 404 —
  // named exactly as the HTML asked for them, sitting on the disk. A page whose
  // chunks all 404 renders its exported HTML, hydrates nothing and runs no
  // effect, which is indistinguishable from the symptom that was being chased.
  // Served file-by-file off the disk, this build flushes passive effects with
  // strict mode on: `scripts-js/smoke.js` opens the artifact, types into it and
  // reads the answer back, on every publish.
  reactStrictMode: true,
  // No server, therefore no image optimizer. Unoptimized is the honest setting;
  // the alternative is a loader pointing at a service we do not run.
  images: { unoptimized: true },
  // The whole application runs in the browser and imports the pure packages
  // directly, so they must be transpiled from the workspace rather than
  // resolved as pre-built dependencies.
  transpilePackages: ['@harness/kernel', '@harness/core', '@harness/adapters-web'],
  // Next writes its own AGENTS.md/CLAUDE.md next to this file. The project has
  // its own, and a second one a build step keeps rewriting is a second
  // authority nobody edited.
  agentRules: false,
  env: { HARNESS_BASE_PATH: base },
}
