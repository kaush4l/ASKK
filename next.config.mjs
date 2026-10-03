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
};

export default nextConfig;
