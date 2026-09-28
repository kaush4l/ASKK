const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '')

export default {
  output: 'export',
  basePath,
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  devIndicators: false,
}
