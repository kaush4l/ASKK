import type { NextConfig } from 'next'

// The deploy target is GitHub Pages at a subpath, so the subpath is built in
// rather than patched in afterwards: a previous tree sed-ed only the HTML and
// the paths embedded in the JS still pointed at the root, which white-screened
// with no console error. Dev runs at the same prefix as production on purpose.
const config: NextConfig = {
  output: 'export',
  basePath: '/ASKK',
  images: { unoptimized: true },
  // Not the default. Under this bundler a double-invoked mount has previously
  // stopped passive effects flushing at all, which is invisible to every test
  // that does not open a browser. Turn it on deliberately, never by inheritance.
  reactStrictMode: false,
}

export default config
