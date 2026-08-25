/**
 * WHERE THIS BUILD IS SERVED FROM. GitHub Pages serves the repo under its name,
 * so the deploy lives at `/ASKK` and a local `next dev` lives at the root.
 *
 * `next/link` prefixes this for us; `location.pathname` arrives with it already
 * on. Anything that compares the two has to know the number, so it is named
 * once here rather than read from the environment at each call site — a base
 * path that only exists in CI is a base path nobody tests.
 */
export const BASE = process.env.HARNESS_BASE_PATH ?? ''
