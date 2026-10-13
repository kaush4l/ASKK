// Served at the root ("") or under a sub-path (GitHub Pages: "/ASKK"), set
// at build time: NEXT_PUBLIC_BASE_PATH=/ASKK bun run build. App code reads
// the same value (backend/platform/base-path.js).
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "")

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: no Node server at runtime, everything runs in the browser.
  output: "export",
  images: { unoptimized: true },
  basePath,
  // Each desk's dev server builds into its own folder (scripts/dev.js sets
  // ASKK_DIST_DIR=.next-desks/<desk>): Next allows one `next dev` per distDir.
  ...(process.env.ASKK_DIST_DIR ? { distDir: process.env.ASKK_DIST_DIR } : {}),
};

export default nextConfig;
