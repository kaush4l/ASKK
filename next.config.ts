import type { NextConfig } from 'next';

/**
 * The app is served from a subpath in production (GitHub Pages, `/ASKK/`), and
 * a build that only works at the root has bricked this project before. So the
 * subpath is the default in every mode, dev included: the failure mode cannot
 * hide until deploy if it is present from the first `bun run dev`.
 *
 * **This value is the intent, not the record.** It is read from the environment
 * of whichever process imports this module, so it says what a build *would*
 * use, never what a build already did. The prefix a build actually recorded is
 * in its own output — the `/ASKK/_next/...` references in `out/index.html`.
 *
 * Two copies therefore exist and they must agree. `scripts/serve-subpath.ts`
 * trusts the built HTML, imports this value only to cross-check it, and
 * refuses to start when the two disagree — because serving one build's files
 * under another's prefix answers 200 to every path the real host 404s.
 * Changing this value means rebuilding; nothing rewrites a path afterwards.
 */
export const basePath = process.env.ASKK_BASE_PATH ?? '/ASKK';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  // OFF, deliberately: with a static export this operator has previously
  // observed strict mode stop passive effects flushing (docs/scratch/LESSONS.md).
  reactStrictMode: false,
};

export default nextConfig;
