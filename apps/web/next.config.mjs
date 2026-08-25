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
  reactStrictMode: true,
  // No server, therefore no image optimizer. Unoptimized is the honest setting;
  // the alternative is a loader pointing at a service we do not run.
  images: { unoptimized: true },
  // The whole application runs in the browser and imports the pure packages
  // directly, so they must be transpiled from the workspace rather than
  // resolved as pre-built dependencies.
  transpilePackages: ['@harness/kernel', '@harness/core', '@harness/adapters-web'],
  env: { HARNESS_BASE_PATH: base },
}
