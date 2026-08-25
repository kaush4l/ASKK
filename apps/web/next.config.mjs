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
  // OFF, AND MEASURED, NOT PREFERRED. With `reactStrictMode: true` this build
  // never flushes a PASSIVE effect: reduced to one page with one client
  // component holding a `useLayoutEffect` and a `useEffect`, the layout effect
  // ran and the passive one did not — in the static export, in headless AND in
  // a real headed Chromium, with no console error, no warning and no rejection.
  // Every effect in this application is passive, so with it on the page renders
  // its pre-boot sentence forever and nothing anywhere says why. Turning it off
  // is the symptom's cure and not the disease's; the reproduction is in
  // STATUS.md so the next person starts where this one stopped.
  reactStrictMode: false,
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
