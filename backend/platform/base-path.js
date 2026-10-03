// Where the app is served: "" at the root of a domain (dev, companion,
// most hosts), or a sub-path such as "/ASKK" (GitHub Pages project sites).
// Set at build time with NEXT_PUBLIC_BASE_PATH (next.config.mjs uses the
// same value); Next inlines it in every bundle, workers included.
// Every root-relative fetch goes through withBase(); next/link and the
// router add it on their own.

export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "")

export const withBase = (path) => `${BASE_PATH}${path}`
