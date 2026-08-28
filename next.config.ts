import type { NextConfig } from 'next';

/**
 * The app is served from a subpath in production (GitHub Pages, `/ASKK/`), and
 * a build that only works at the root has bricked this project before. So the
 * subpath is the default in every mode, dev included: the failure mode cannot
 * hide until deploy if it is present from the first `bun run dev`.
 *
 * `scripts/serve-subpath.ts` reads this same value rather than repeating it.
 */
export const basePath = process.env.ASKK_BASE_PATH ?? '/ASKK';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  // OFF, deliberately: with a static export this operator has previously
  // observed strict mode stop passive effects flushing (docs/scratch/LESSONS.md).
  reactStrictMode: false,
};

export default nextConfig;
